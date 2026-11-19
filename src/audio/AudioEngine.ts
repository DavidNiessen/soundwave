import { startNativeOutput, type NativeOutput } from './native/nativeOutput';

/** Whether this is the desktop app, which plays the sound itself (src/audio/native/). */
const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Owns the AudioContext and playback of one song. The context's output clock is
 * the master game clock: everything else asks this class for song time.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  readonly gain: GainNode;
  /**
   * The song alone, at full level and before the player's volume: for recording a video of a
   * replay. Connected to nothing until something listens to it.
   */
  readonly tap: GainNode;
  /** Everything the game plays (songs, menu music, interface sounds) leaves through this. */
  readonly master: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  /** Context time (scheduling clock) at which song time `startSong` plays. */
  private startCtxTime = 0;
  private startSong = 0;
  /** Playback speed (1 = normal). Pitch changes with speed. */
  private rate = 1;
  private pausedAt = 0;
  private playing = false;
  /** User calibration in seconds; positive = audio is heard later than reported. */
  offset = 0;
  onEnded: (() => void) | null = null;
  /** In the desktop app: the app plays the sound, and this says when what is played is heard. */
  private native: NativeOutput | null = null;
  /** Seconds the sound is heard after the context's own output clock (the app's queue and device), smoothed. */
  private lead: number | null = null;
  private leadAt = 0;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.gain = this.ctx.createGain();
    this.tap = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.6;
    this.gain.connect(this.analyser);
    this.master = this.ctx.createGain();
    this.analyser.connect(this.master);
    if (!inApp()) {
      this.master.connect(this.ctx.destination);
      return;
    }
    // The desktop app plays the mix itself; should that not work, the webview plays it as in a browser.
    const toWebview = () => {
      this.native = null;
      this.lead = null;
      this.master.connect(this.ctx.destination);
      const sink = this.ctx as AudioContext & { setSinkId?(id: string): Promise<void> };
      void sink.setSinkId?.('').catch(() => {});
    };
    void startNativeOutput(this.ctx, this.master, toWebview).then((out) => (out ? (this.native = out) : toWebview()));
  }

  /** Silences or restores everything at once, with a short fade so nothing clicks. */
  set muted(m: boolean) {
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(m ? 0 : 1, now, 0.03);
  }

  set volume(v: number) {
    this.gain.gain.value = v;
  }

  async decode(data: ArrayBuffer): Promise<AudioBuffer> {
    return this.ctx.decodeAudioData(data.slice(0));
  }

  load(buffer: AudioBuffer) {
    this.stopSource();
    this.buffer = buffer;
    this.pausedAt = 0;
    this.playing = false;
  }

  get duration() {
    return this.buffer?.duration ?? 0;
  }

  get isPlaying() {
    return this.playing;
  }

  /**
   * Starts playback so that song time `from` is heard `delay` seconds from now. Negative `from` =
   * lead-in. `rate` slows down or speeds up playback (debugging); song time follows it.
   */
  async play(from = this.pausedAt, delay = 0.1, rate = 1) {
    if (!this.buffer) return;
    if (this.ctx.state !== 'running') await this.ctx.resume();
    this.stopSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.playbackRate.value = rate;
    src.connect(this.gain);
    src.connect(this.tap);
    const startAt = this.ctx.currentTime + delay;
    this.rate = rate;
    this.startCtxTime = startAt;
    this.startSong = from;
    if (from >= 0) src.start(startAt, from);
    else src.start(startAt - from / rate, 0);
    src.onended = () => {
      if (this.source === src && this.playing) {
        // It stopped at the end: that is where it now stands (a pause after this finds it stopped,
        // and would otherwise leave the time where this playback started).
        this.pausedAt = src.buffer?.duration ?? this.pausedAt;
        this.playing = false;
        this.onEnded?.();
      }
    };
    this.source = src;
    this.playing = true;
  }

  /** Jumps to song time t, keeping the current play/pause state and speed. */
  async seek(t: number) {
    if (this.playing) await this.play(t, 0.02, this.rate);
    else this.pausedAt = t;
  }

  /** `at`: the song time to stand at (by default the one heard now; see `graphTime` for a recording). */
  pause(at?: number) {
    if (!this.playing) return;
    this.pausedAt = at ?? this.time();
    this.playing = false;
    this.stopSource();
  }

  stop() {
    this.playing = false;
    this.pausedAt = 0;
    this.stopSource();
  }

  /** Context time currently reaching the speakers, mapped to a performance.now() timestamp. */
  private heardContextTime(perfNow?: number) {
    const now = perfNow ?? performance.now();
    const base = this.outputContextTime(now);
    // In the desktop app the context's output is the app's input: the sound is heard later by the
    // app's queue and the device's latency, as the app reports them. That lag is smoothed, so the
    // clock moves as evenly as the context's own and only the lag follows the reports.
    const heard = this.native?.heard(now);
    if (heard == null) return this.lead === null ? base : base - this.lead;
    const lag = base - heard;
    if (this.lead === null || Math.abs(lag - this.lead) > 0.25) {
      this.lead = lag;
      this.leadAt = now;
    } else if (now - this.leadAt >= 4) {
      this.lead += (lag - this.lead) * 0.03;
      this.leadAt = now;
    }
    return base - this.lead;
  }

  /** Context time leaving the context for its output at `now` (a performance.now() time). */
  private outputContextTime(now: number) {
    const ts = this.ctx.getOutputTimestamp?.();
    if (ts && ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
      return ts.contextTime + (now - ts.performanceTime) / 1000;
    }
    return this.ctx.currentTime - (this.ctx.outputLatency || this.ctx.baseLatency || 0);
  }

  get playbackRate() {
    return this.rate;
  }

  /** Scheduling-clock time (AudioContext.currentTime domain) at which song time `t` plays. */
  contextTimeFor(t: number) {
    return this.startCtxTime + (t - this.startSong) / this.rate;
  }

  /**
   * Song time leaving the audio graph now: what the recording tap carries (see `tap`), without the
   * output's latency or the player's offset.
   */
  graphTime() {
    if (!this.playing) return this.pausedAt;
    return this.startSong + (this.ctx.currentTime - this.startCtxTime) * this.rate;
  }

  /** Song time in seconds as heard by the player at `perfNow` (defaults to now). */
  time(perfNow?: number) {
    if (!this.playing) return this.pausedAt;
    return this.startSong + (this.heardContextTime(perfNow) - this.startCtxTime) * this.rate - this.offset;
  }

  private stopSource() {
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* already stopped */
      }
      this.source.disconnect();
      this.source = null;
    }
  }

  dispose() {
    this.stop();
    void this.ctx.close();
  }
}
