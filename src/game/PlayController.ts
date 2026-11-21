import type { Chart } from '../chart/types';
import { AudioEngine } from '../audio/AudioEngine';
import { BandMeter } from '../audio/bands';
import { Highway } from '../render/Highway';
import { StageView } from '../render/stage/StageView';
import type { Avatars } from '../render/aurora/AuroraStage';
import type { RingPlace, RingSeat } from '../render/aurora/ring';
import { barAt, barIntensity } from '../render/stage/LightShow';
import { resolveGraphics } from './graphics';
import { GameSession, PHRASE_REWARD, type Results } from './GameSession';
import { ReplayPlayback, ReplayRecorder, replayResults, showdownMarks, type ReplayInputs, type ShowdownMarks } from './replay';
import { BufferAnalyser } from '../audio/bufferAnalyser';
import type { StageInput } from '../render/stage/protocol';
import { Rumbler } from '../input/rumble';
import { barsLeft, findBreaks, type Break } from './breaks';
import { GamepadInput, KeyboardInput, TouchInput, type InputHandlers } from './input';
import { WINDOWS } from './judge';
import { GOLD_STARS, MAX_MULTIPLIER, multiplierFor, STREAK_PER_MULTIPLIER } from './scoring';
import { highwaySpeed, type Settings } from './settings';
import { DRAIN_CAP } from '../net/protocol';

export interface HudRefs {
  score: HTMLElement;
  multiplier: HTMLElement;
  /** The five stars' container; each child is one star. */
  stars: HTMLElement;
  /** The song's timeline (takes --song-p and --segments) and the time left beside it. */
  timeline: HTMLElement;
  remaining: HTMLElement;
  /** The tag that says how the last note was hit, the word on it, and the streak above it. */
  feedback: HTMLElement;
  feedbackWord: HTMLElement;
  feedbackStreak: HTMLElement;
  root: HTMLElement;
  /** One label per lane, positioned under its strike pad. */
  keys: HTMLElement[];
  /** The layer that takes touches for the lanes. */
  touchLayer: HTMLElement;
  /** The overdrive meter, which is also the button that starts overdrive. */
  overdriveButton: HTMLElement;
  /** Countdown shown during long breaks: the root, its number and its ring. */
  breakTimer: HTMLElement;
  breakNumber: HTMLElement;
  breakRing: SVGCircleElement;
}

/** Something playing together does to a run for a while (see PlayController.effects). */
interface Effect {
  from: number;
  to: number;
  kind: 'drain' | 'fog';
  state: 0 | 1 | 2;
}

export type PlayPhase = 'countdown' | 'playing' | 'paused' | 'finished';

/** A video frame on its way: what it was begun with, and the stage's picture of it, coming. */
export interface FrameJob {
  t: number;
  now: number;
  beat: 'none' | 'beat' | 'downbeat';
  pulse: number;
  picture: Promise<ImageBitmap | null>;
}

const LEAD_IN = 3;
/** Song time a replay starts at: a moment before the song, without a countdown. */
export const REPLAY_START = -1.5;
/** How long the stage celebrates after the last note before the result comes up, seconds. */
export const FINALE_SECONDS = 4;

/**
 * Drives one play-through: audio, input, session and both renderers. Lives outside React
 * so the frame loop never triggers re-renders; React only sees phase changes and results.
 *
 * Played, every call into the session goes through a recorder, so the run can be saved as a
 * replay. Given a recorded run instead, it plays that back: no input is taken, the session follows
 * the recording, and the song can be paused, sped up, slowed down and jumped through (`seek`).
 */
export class PlayController {
  /** The run's state. A replay that jumps gets a new one (see `seek`). */
  session: GameSession;
  /** Writes down every call into the session while a song is played (absent in a replay). */
  private readonly recorder: ReplayRecorder | null = null;
  /** The recorded run being played back (absent while a song is played). */
  private readonly playback: ReplayPlayback | null = null;
  /** A replay's playback speed. */
  private rate = 1;
  private unwire: () => void = () => {};
  /** Song time from the audio graph rather than the speakers (see AudioEngine.graphTime): a video is recorded. */
  private readonly graphClock: boolean;
  /** Takes the stage's frames while a video is recorded (see `captureStage`). */
  private stageTaker: ((frame: ImageBitmap) => void) | null = null;
  /** How the last note went, for a HUD drawn elsewhere (a video's): the word, its kind and when (performance.now ms). */
  lastFeedback: { text: string; kind: string; at: number } | null = null;
  /** Resolves once the highway can draw and the stage (when there is one) has drawn, or could not be built. */
  readonly ready: Promise<void>;
  private stageSettled: () => void = () => {};
  /** The clock of the frame being made (performance.now ms, or a video's own while it is made frame by frame). */
  private clock = performance.now();
  /** Frames are made one by one for a video (see `beginFrames`): the frame loop does not run. */
  private frames = false;
  /** Called after every frame is drawn, with its song time: a video takes the highway's picture then. */
  onFrame: ((t: number) => void) | null = null;
  private readonly highway: Highway;
  /** How loud the song is in the bass, middle and treble: for the highway's glow and the stage. */
  private readonly meter = new BandMeter();
  private meterAt = performance.now();
  /**
   * The 3D stage, drawn in a worker of its own (see StageView): the highway and the input never wait
   * for it. The highway stands before the plain night until it is built.
   */
  private stage: StageView | null = null;
  /** The stage on screen; while a rebuilt one (new graphics settings) is still being built, the old one. */
  private shownStage: StageView | null = null;
  private stageHost: HTMLElement | null = null;
  /** The graphics the newest stage was built with, as JSON. */
  private graphicsKey = '';
  private readonly barLevels: number[];
  private readonly input: KeyboardInput | null = null;
  private readonly padInput: GamepadInput | null = null;
  private readonly touchInput: TouchInput | null = null;
  private readonly observer: ResizeObserver;
  private readonly rumble: Rumbler;
  private raf = 0;
  private phase: PlayPhase = 'countdown';
  private lastBeat = -1;
  /** When the latest beat landed (performance.now ms), for the highway's swell of light. */
  private beatAt = -Infinity;
  private hudCache = {
    score: -1,
    mult: -1,
    streak: -1,
    od: -1,
    stars: -1,
    starP: -1,
    odActive: false,
    breakSec: -1,
    songP: -1,
    left: -1,
    scoreLen: -1,
  };
  private readonly breaks: Break[];
  /** A beat fell in the frame being drawn, and how much bass there is right now (0..1). */
  private readonly barTimes: number[];
  private feedbackTimer = 0;
  private disposed = false;
  private lastCount = -1;
  private readonly downbeats: Set<number>;
  /** Song time the run starts at (0 unless a chart is test-played from the middle of the song). */
  private startAt = 0;
  /** Overdrive meter when overdrive was activated, for the progressive rumble. */
  private odMeterAtStart = 1;

  /** Keeps the song paused whatever is pressed (while the settings are open over the pause menu). */
  holdPause = false;
  /**
   * A party's song is played live with everyone, so it never stops: pausing only opens the menu
   * over it (`menuOpen`), while the music, the notes and the hits carry on underneath.
   */
  private live = false;
  private menu = false;
  /** The menu over a live song opened or closed (a live song's phase never becomes paused). */
  onMenu: (open: boolean) => void = () => {};
  private isFrozen = false;
  private frozenFrame = 0;

  /**
   * All but stops drawing the stage and the highway while the song is paused (the settings are open
   * over it): the picture stays on screen and the screen on top gets the machine to itself. A frame
   * is still drawn now and then, so a resized window is not left blank.
   */
  get frozen() {
    return this.isFrozen;
  }
  set frozen(on: boolean) {
    if (on === this.isFrozen) return;
    this.isFrozen = on;
    this.stage?.setRate(on ? 'frozen' : 'full');
    if (this.shownStage !== this.stage) this.shownStage?.setRate(on ? 'frozen' : 'full');
  }

  /** Seconds until the song is over, at the speed it plays (the lead-in counted). */
  get songLeft() {
    return Math.max(0, this.chart.duration - this.engine.time()) / this.engine.playbackRate;
  }

  /** Song time now, seconds (negative before the song starts). */
  get time() {
    return this.now();
  }

  private now() {
    return this.graphClock ? this.engine.graphTime() : this.engine.time();
  }

  /** How long the song is, seconds. */
  get duration() {
    return Math.max(this.chart.duration, this.engine.duration, this.playback?.end ?? 0);
  }

  get playbackRate() {
    return this.rate;
  }

  get currentPhase() {
    return this.phase;
  }

  /** The menu is open over a live (party) song. */
  get menuOpen() {
    return this.menu;
  }

  onPhase: (p: PlayPhase, countdown?: number) => void = () => {};
  /** The song is over: how it went, and the run as recorded (absent in a replay). */
  onFinish: (r: Results, inputs?: ReplayInputs) => void = () => {};
  /**
   * Showdown: asked when the overdrive button is pressed with charge to spend. True: the press is a
   * Strike, sent off to be aimed (`spendCharge` or `overdriveNow` follows the answer). False: it is
   * an overdrive, as in any song.
   */
  strike: ((charge: number) => boolean) | null = null;
  private readonly avatars: Avatars | undefined;
  /** A Showdown's players on the stage's ring, and the board's places as last heard. */
  private readonly ring: RingSeat[] | undefined;
  private places: RingPlace[] | null = null;
  /**
   * What playing together does to this run for a while, in song time: Showdown's Drain caps the
   * multiplier and its Fog hazes the far highway.
   * `state`: 0 before it starts, 1 while it lasts, 2 once over.
   */
  private effects: Effect[] = [];
  /** The multiplier rule last recorded (GameSession's RULE). */
  private ruleNow = 0;

  constructor(
    private readonly engine: AudioEngine,
    private readonly buffer: AudioBuffer,
    private readonly chart: Chart,
    settings: Settings,
    highwayCanvas: HTMLCanvasElement,
    private readonly hud: HudRefs,
    stageHost?: HTMLElement,
    /** A recorded run to play back instead of taking input. */
    replay?: ReplayInputs,
    /**
     * `graphClock`: follow the audio graph's clock instead of what the speakers play (recording a
     * video). `avatars`: the players' looks for the band on stage. `ring`: a Showdown's players,
     * on a ring of podiums in place of the band.
     */
    options: { graphClock?: boolean; avatars?: Avatars; ring?: RingSeat[] } = {},
  ) {
    this.graphClock = !!options.graphClock;
    this.avatars = options.avatars;
    this.ring = options.ring;
    engine.load(buffer);
    engine.offset = settings.offsetMs / 1000;
    engine.volume = settings.volume;
    engine.onEnded = () => this.finish();

    this.downbeats = new Set(chart.downbeats);
    if (replay) {
      this.playback = new ReplayPlayback(chart, replay);
      this.session = this.playback.session;
      this.marks = showdownMarks(replay);
    } else {
      this.session = new GameSession(chart);
      this.recorder = new ReplayRecorder(this.session);
    }
    // In development the running game can be reached from the console (to start overdrive, say).
    if (import.meta.env.DEV) (window as unknown as { __play?: PlayController }).__play = this;
    this.highway = new Highway(highwayCanvas, chart);
    this.highway.speed = highwaySpeed(settings.trackSpeed);
    this.breaks = findBreaks(chart);
    this.barTimes = chart.downbeats.map((i) => chart.beats[i]).filter((x) => x !== undefined);
    this.meter.setAnalyser(engine.analyser);
    this.barLevels = barIntensity(chart);
    this.graphicsKey = JSON.stringify(resolveGraphics(settings.graphics));
    const stageDrawn = stageHost ? new Promise<void>((resolve) => (this.stageSettled = resolve)) : Promise.resolve();
    this.ready = this.highway.ready.then(() => stageDrawn);
    if (stageHost) {
      // Built once the highway is ready to draw: both compile their shaders in the same GPU process,
      // and the highway, which the player needs first, should not queue behind the stage's.
      void this.highway.ready.then(() => {
        if (this.disposed) return;
        this.stageHost = stageHost;
        this.buildStage();
      });
    }

    const padBindings = chart.lanes === 5 ? settings.pad5 : settings.pad4;
    // A replay is watched, not played: the controller stays still.
    this.rumble = new Rumbler(this.rumbleSettings(settings), chart.lanes, padBindings);
    this.wire();

    // The canvas changes size with the window and when the touch pads take the bottom of the screen.
    this.drawTimeline();
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(highwayCanvas);
    window.addEventListener('resize', this.resize);
    this.placeKeys();
    if (this.playback) return;

    const recorder = this.recorder!;
    const keys = chart.lanes === 5 ? settings.keys5 : settings.keys4;
    const handlers: InputHandlers = {
      press: (lane, ts) => {
        if (this.phase !== 'playing' || this.menu) return;
        recorder.press(lane, this.engine.time(ts));
      },
      release: (lane, ts) => {
        if (this.phase !== 'playing') return;
        recorder.release(lane, this.engine.time(ts));
      },
      overdrive: () => this.pressOverdrive(),
      pause: () => {
        // With the settings open over the pause menu, Esc and the pause button belong to them.
        if (this.holdPause) return;
        void (this.phase === 'paused' || this.menu ? this.resume() : this.pause());
      },
    };
    this.input = new KeyboardInput(keys, settings.overdriveKey, handlers);
    // Controllers drive the menus while paused, so only take their input during play.
    this.padInput = new GamepadInput(
      padBindings,
      settings.padOverdrive,
      handlers,
      () => (this.phase === 'playing' || this.phase === 'countdown') && !this.menu,
    );

    // Touch: a finger anywhere in a lane's column plays that lane (the highway lights the lane).
    const vibrate = settings.touchHaptics && typeof navigator.vibrate === 'function';
    this.touchInput = new TouchInput(
      hud.touchLayer,
      (x, y) => this.highway.laneAt(x, y),
      handlers,
      (_lane, down) => {
        if (down && vibrate && this.phase === 'playing') navigator.vibrate(8);
      },
    );
    hud.overdriveButton.addEventListener('pointerdown', this.overdrivePress);
  }

  private rumbleSettings(s: Settings): Settings {
    return this.playback ? { ...s, rumble: 'off' } : s;
  }

  /** Listens to the session for the feedback tag, the rumble, the stage and the highway. */
  private wire() {
    this.unwire();
    const chart = this.chart;
    this.highway.attach(this.session);
    this.unwire = this.session.on((e) => {
      if (e.type === 'hit') {
        this.flashFeedback(e.grade.toUpperCase(), e.grade, e.delta);
        this.rumble.hit(e.lane, e.grade);
        if (chart.notes[e.noteIndex].dur > 0) this.rumble.sustainStart(e.lane);
      } else if (e.type === 'miss') {
        this.flashFeedback('MISS', 'miss');
        this.rumble.miss(e.lane);
      } else if (e.type === 'release') {
        this.flashFeedback(e.grade.toUpperCase(), e.grade, e.delta);
        this.rumble.hit(e.lane, e.grade);
      } else if (e.type === 'release-miss') {
        this.flashFeedback(e.early ? 'TOO EARLY' : 'LET GO!', 'miss');
        this.rumble.miss(e.lane);
      } else if (e.type === 'sustain-end') this.rumble.sustainEnd(e.lane);
      else if (e.type === 'overdrive-start') {
        this.stage?.overdriveStart();
        this.odMeterAtStart = Math.max(this.session.overdrive, 0.01);
        this.rumble.overdrive();
      } else if (e.type === 'overdrive-end') this.rumble.overdriveEnd();
      else if (e.type === 'phrase-complete') {
        this.flashFeedback('CHARGED', 'od');
        this.rumble.phraseComplete();
      }
    });
  }

  private readonly resize = () => {
    this.highway.resize();
    this.placeKeys();
    this.fitScore();
  };

  /**
   * Sets the score smaller when it would not fit beside its label in the panel (a long score, a
   * small window): measured when it gains a digit and when the window changes size.
   */
  private fitScore() {
    const el = this.hud.score;
    const panel = el.parentElement;
    const label = panel?.querySelector('.hud-part');
    if (!panel || !label) return;
    el.style.removeProperty('--fit');
    const edge = panel.getBoundingClientRect().right - parseFloat(getComputedStyle(panel).paddingRight);
    const room = edge - label.getBoundingClientRect().right - parseFloat(getComputedStyle(panel).columnGap || '0');
    const width = el.getBoundingClientRect().width;
    if (room > 0 && width > room) el.style.setProperty('--fit', (room / width).toFixed(3));
  }

  private readonly overdrivePress = (e: Event) => {
    e.preventDefault();
    this.pressOverdrive();
  };

  /** The overdrive button: overdrive, or in a Showdown a Strike when there is someone to strike. */
  private pressOverdrive() {
    if (this.phase !== 'playing' || !this.recorder || this.menu) return;
    const s = this.session;
    if (this.strike && !s.overdriveActive && s.overdrive >= PHRASE_REWARD && this.strike(s.overdrive)) return;
    this.recorder.overdrive(this.engine.time());
  }

  /** Showdown: the Strike found its target, so the charge is spent now. */
  spendCharge() {
    if (this.phase === 'playing') this.recorder?.strike(this.engine.time());
  }

  /** Showdown: nobody could be struck, so the press was an overdrive after all. */
  overdriveNow() {
    if (this.phase === 'playing') this.recorder?.overdrive(this.engine.time());
  }

  /**
   * Showdown: a hit on this player from `at` (performance.now ms) for `ms`. Every hit is both: Fog
   * hazes the far highway and Drain holds the multiplier at ×2, for as long as it lasts.
   */
  hit(at: number, ms: number) {
    this.addEffect(at, ms, 'fog');
    this.addEffect(at, ms, 'drain');
  }

  /** Showdown: the board as it stands, for the stage's ring (sent on only when it changed). */
  setPlaces(places: RingPlace[]) {
    if (!this.ring || JSON.stringify(places) === JSON.stringify(this.places)) return;
    this.places = places;
    this.stage?.setPlaces(places);
    if (this.shownStage !== this.stage) this.shownStage?.setPlaces(places);
  }

  /** Showdown: a Strike between two players, drawn on the stage's ring; it lands at `at` (performance.now ms). */
  showStrike(from: string, to: string, at: number) {
    const ms = Math.max(0, at - performance.now());
    this.stage?.strike(from, to, ms);
    if (this.shownStage !== this.stage) this.shownStage?.strike(from, to, ms);
  }

  private addEffect(at: number, ms: number, kind: 'drain' | 'fog') {
    if (this.playback) return;
    const from = this.engine.time(at);
    this.effects.push({ from, to: from + (ms / 1000) * this.engine.playbackRate, kind, state: 0 });
  }

  /**
   * Starts and ends the effects that fall due by song time t, each at its own time and in order, so
   * the run records the multiplier's rule as it changed.
   */
  private applyEffects(t: number) {
    const due: { at: number; e: Effect; next: 1 | 2 }[] = [];
    for (const e of this.effects) {
      if (e.state === 0 && t >= e.from) due.push({ at: e.from, e, next: 1 });
      if (e.state !== 2 && t >= e.to) due.push({ at: e.to, e, next: 2 });
    }
    due.sort((a, b) => a.at - b.at);
    for (const d of due) {
      d.e.state = d.next;
      this.recordRule(d.at);
    }
    this.effects = this.effects.filter((e) => e.state !== 2);
    this.highway.fog = this.effects.some((e) => e.state === 1 && e.kind === 'fog') ? 1 : 0;
    // The dial shows a Drain holding the multiplier down (see .hud.drained).
    this.hud.root.classList.toggle('drained', this.ruleNow !== 0);
  }

  /** Records the multiplier's rule at song time `at`, if it changed. */
  private recordRule(at: number) {
    const on = (kind: string) => this.effects.some((e) => e.state === 1 && e.kind === kind);
    const rule = on('drain') ? DRAIN_CAP : 0;
    if (rule === this.ruleNow) return;
    this.ruleNow = rule;
    this.recorder?.rule(rule, at);
  }

  /** A replayed Showdown: the player's Strikes and the hits on them, found in the run (see showdownMarks). */
  private marks: ShowdownMarks = { strikes: [], hits: [] };
  /** Song time the replay's Showdown marks were last looked at, to tell which were passed since. */
  private markAt = -Infinity;
  /** A replay passed a Strike the player made, or the start of a hit on them. */
  onReplayMark: ((kind: 'strike' | 'hit') => void) | null = null;

  /** A replay shows a Showdown as it was: the haze through each hit, and a word for each Strike and hit. */
  private replayShowdown(t: number) {
    const { strikes, hits } = this.marks;
    if (!strikes.length && !hits.length) return;
    const from = this.markAt;
    this.markAt = t;
    for (const s of strikes) if (s > from && s <= t) this.onReplayMark?.('strike');
    for (const [h] of hits) if (h > from && h <= t) this.onReplayMark?.('hit');
    this.highway.fog = hits.some(([a, b]) => t >= a && t < b) ? 1 : 0;
  }

  /** Lays the highway out again after the layout changed without the canvas changing size (another input in use). */
  relayout() {
    this.resize();
  }

  /** The timeline's shape (see timelineShape). */
  private drawTimeline() {
    const shape = timelineShape(this.chart);
    if (shape) this.hud.timeline.style.setProperty('--segments', shape);
  }

  /** Puts the lane labels on the deck under their lanes and tells the HUD where the highway is. */
  private placeKeys() {
    const pos = this.highway.padScreenPositions();
    if (!pos.length) return;
    // The labels stand at the foot of the screen; the dial sits between them and the strike line.
    const foot = this.highway.footRow(Math.max(24, Math.min(46, window.innerHeight * 0.034)));
    foot.forEach((p, i) => {
      const key = this.hud.keys[i];
      if (key) key.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -50%)`;
    });
    const first = pos[0];
    const last = pos[pos.length - 1];
    const laneW = pos.length > 1 ? (last.x - first.x) / (pos.length - 1) : 90;
    // On the play screen itself, so the highway canvas can read them as well as the HUD.
    const root = (this.hud.root.parentElement ?? this.hud.root).style;
    root.setProperty('--hw-x', `${((first.x + last.x) / 2).toFixed(1)}px`);
    root.setProperty('--hw-y', `${first.y.toFixed(1)}px`);
    root.setProperty('--hw-foot', `${(foot[0]?.y ?? first.y + 120).toFixed(1)}px`);
    root.setProperty('--lane-w', `${laneW.toFixed(1)}px`);
    root.setProperty('--hw-w', `${(laneW * pos.length).toFixed(1)}px`);
  }

  /**
   * Takes over the settings that can change in the middle of a song: volume, audio offset, note
   * speed, rumble and the stage's graphics. Bindings are read when a song starts.
   */
  applySettings(s: Settings) {
    this.engine.offset = s.offsetMs / 1000;
    this.engine.volume = s.volume;
    this.highway.speed = highwaySpeed(s.trackSpeed);
    this.rumble.update(this.rumbleSettings(s));
    const key = JSON.stringify(resolveGraphics(s.graphics));
    if (key === this.graphicsKey) return;
    this.graphicsKey = key;
    if (this.stageHost) this.buildStage();
  }

  /**
   * Builds the stage with the newest graphics settings. A stage already on screen stays there until
   * the new one has drawn, so changing the graphics in the middle of a song never shows a black
   * frame; a new one still being built when the settings change again is dropped for the next.
   */
  private buildStage() {
    const pending = this.stage !== this.shownStage ? this.stage : null;
    pending?.dispose();
    const stage = new StageView(this.stageHost!, JSON.parse(this.graphicsKey), {
      mode: 'play',
      part: this.chart.part,
      avatars: this.avatars,
      ring: this.ring,
    });
    if (this.places) stage.setPlaces(this.places);
    if (this.isFrozen) stage.setRate('frozen');
    this.stage = stage;
    if (this.stageTaker) stage.capture(this.stageTaker);
    stage.ready.then(
      () => {
        if (this.stage !== stage) return;
        if (this.shownStage !== stage) this.shownStage?.dispose();
        this.shownStage = stage;
        this.stageSettled();
      },
      (err) => {
        console.warn('3D stage unavailable', err);
        this.stageSettled();
        if (this.stage !== stage) return;
        stage.dispose();
        this.stage = this.shownStage;
      },
    );
  }

  /** Starts the run with its countdown. `from`: song time of its first moment, for a chart tested from the middle. */
  async start(from = 0) {
    if (this.playback) {
      // A replay starts straight away, a moment before the song.
      this.seekTo(REPLAY_START);
      this.setPhase('playing');
      await this.engine.play(REPLAY_START, 0.05, this.rate);
      this.loop();
      return;
    }
    this.startAt = Math.max(0, from);
    this.lastBeat = -1;
    while (this.lastBeat + 1 < this.chart.beats.length && this.chart.beats[this.lastBeat + 1] <= this.startAt - LEAD_IN) this.lastBeat++;
    this.setPhase('countdown');
    await this.engine.play(this.startAt - LEAD_IN, 0.05);
    this.loop();
  }

  /**
   * Starts a party's song so that its countdown begins at `at` (performance.now ms): every player
   * hears the first note at the same moment. A player whose song loaded late starts as far in as
   * the others already are.
   */
  async startTogether(at: number) {
    if (this.playback) return this.start();
    this.live = true;
    if (this.engine.ctx.state !== 'running') await this.engine.ctx.resume();
    const wait = (at - performance.now()) / 1000;
    const from = -LEAD_IN + Math.max(0, -wait);
    this.startAt = 0;
    this.lastBeat = -1;
    while (this.lastBeat + 1 < this.chart.beats.length && this.chart.beats[this.lastBeat + 1] <= from) this.lastBeat++;
    this.setPhase(from < 0 ? 'countdown' : 'playing');
    await this.engine.play(from, Math.max(0.02, wait));
    this.loop();
  }

  pause() {
    if (this.phase !== 'playing' && this.phase !== 'countdown') return;
    if (this.live) {
      if (this.menu) return;
      this.menu = true;
      this.onMenu(true);
      return;
    }
    this.engine.pause(this.now());
    for (let l = 0; l < this.chart.lanes; l++) this.rumble.sustainEnd(l);
    this.rumble.overdriveEnd(true);
    this.setPhase('paused');
  }

  async resume() {
    if (this.playback) {
      if (this.phase === 'finished') this.seekTo(REPLAY_START);
      else if (this.phase !== 'paused') return;
      this.setPhase('playing');
      await this.engine.play(this.now(), 0.05, this.rate);
      return;
    }
    if (this.live) {
      if (!this.menu) return;
      this.menu = false;
      this.onMenu(false);
      return;
    }
    if (this.phase !== 'paused') return;
    // Rewind slightly so the player can re-enter the groove.
    const at = Math.max(this.startAt - LEAD_IN, this.engine.time() - 1.5);
    this.recorder!.dropHolds(this.engine.time());
    this.recorder!.rewind(at);
    await this.engine.play(at, 0.05);
    this.highway.reset();
    this.lastCount = -1;
    this.lastBeat = -1;
    while (this.lastBeat + 1 < this.chart.beats.length && this.chart.beats[this.lastBeat + 1] <= at) this.lastBeat++;
    this.setPhase(at < this.startAt ? 'countdown' : 'playing');
  }

  private setPhase(p: PlayPhase, countdown?: number) {
    this.phase = p;
    this.onPhase(p, countdown);
  }

  /**
   * A replay jumps to song time `t`: the session is rebuilt as it stood then, without a sound or a
   * flash for what was skipped, and the song carries on from there (or stays paused).
   */
  async seek(t: number) {
    if (!this.playback) return;
    const at = this.seekTo(t);
    if (this.phase === 'finished') {
      this.engine.pause();
      this.setPhase('paused');
    }
    if (this.phase === 'playing') await this.engine.play(at, 0.02, this.rate);
    else await this.engine.seek(at);
  }

  /** Puts the replay's session, the highway and the HUD where they stand at song time `t`. */
  private seekTo(t: number): number {
    const at = Math.max(REPLAY_START, Math.min(this.playback!.end, t));
    // A jump says nothing of the Strikes and hits it skips; the haze is as it stands at `at`.
    this.markAt = at;
    this.highway.fog = this.marks.hits.some(([from, to]) => at >= from && at < to) ? 1 : 0;
    this.session = this.playback!.seek(at);
    this.wire();
    this.highway.reset();
    this.lastBeat = -1;
    while (this.lastBeat + 1 < this.chart.beats.length && this.chart.beats[this.lastBeat + 1] <= at) this.lastBeat++;
    this.hud.feedback.classList.remove('pop');
    // Everything on the HUD is drawn afresh for the new session.
    for (const k of Object.keys(this.hudCache) as (keyof typeof this.hudCache)[]) if (k !== 'odActive') this.hudCache[k] = -1;
    this.hudCache.odActive = !this.session.overdriveActive;
    return at;
  }

  /**
   * Hands every frame the stage draws to `take`, or stops with null (recording a video). A stage
   * rebuilt meanwhile hands its frames over too.
   */
  captureStage(take: ((frame: ImageBitmap) => void) | null) {
    this.stageTaker = take;
    this.stage?.capture(take);
    if (this.shownStage !== this.stage) this.shownStage?.capture(take);
  }

  /** Where the highway stands on its canvas (CSS pixels): the strike line, its foot and its width. */
  hudLayout() {
    const pos = this.highway.padScreenPositions();
    if (!pos.length) return null;
    const first = pos[0];
    const last = pos[pos.length - 1];
    const laneW = pos.length > 1 ? (last.x - first.x) / (pos.length - 1) : 90;
    const foot = this.highway.footRow(Math.max(24, Math.min(46, window.innerHeight * 0.034)));
    return { x: (first.x + last.x) / 2, y: first.y, foot: foot[0]?.y ?? first.y + 120, width: laneW * pos.length };
  }

  /** A replay's playback speed (1 = as played). The song's pitch follows it. */
  async setRate(rate: number) {
    if (!this.playback || rate === this.rate) return;
    this.rate = rate;
    if (this.phase === 'playing') await this.engine.play(this.now(), 0.02, rate);
  }

  private finish() {
    if (this.phase === 'finished') return;
    if (this.playback) this.playback.finish();
    else this.recorder!.end();
    this.setPhase('finished');
    this.stage?.finale(FINALE_SECONDS);
    // The score of record is the run judged again from its inputs alone. Live, an input can reach
    // the session after a frame has already moved past its time, and be judged a few milliseconds
    // off; judged again, every input is taken at its own time, as a replay or a server would.
    const inputs = this.recorder?.take();
    this.onFinish(inputs ? replayResults(this.chart, inputs) : this.session.results(), inputs);
  }

  private loop = () => {
    if (this.disposed || this.frames) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.frozen && this.phase === 'paused') {
      const now = performance.now();
      if (now - this.frozenFrame < 500) return;
      this.frozenFrame = now;
    }
    const t = this.now();
    const f = this.advance(t, performance.now());
    const stage = this.stage;
    if (stage && f.stage) {
      if (f.beat !== 'none') stage.beat(f.beat);
      stage.input(f.stage);
    }
    this.highway.render(t, this.session, f.pulse, this.clock);
    this.updateHud(t, f.beat);
    this.onFrame?.(t);
  };

  /**
   * Everything one frame moves on, but the drawing: the countdown, the session, the beats, the
   * rumble and how loud the music is. `now` is the clock it runs on (ms): the real one, or a video's.
   */
  private advance(t: number, now: number) {
    this.clock = now;
    if (this.phase === 'countdown') {
      const n = Math.ceil(this.startAt - t);
      if (t >= this.startAt) this.setPhase('playing');
      else if (n !== this.lastCount) {
        this.lastCount = n;
        this.onPhase('countdown', n);
      }
    }
    if (this.phase === 'playing') {
      if (this.playback) {
        this.playback.advance(t);
        this.replayShowdown(t);
      } else this.recorder!.update(t);
      if (this.effects.length) this.applyEffects(t);
      if (t > this.chart.duration + 0.5 && t > this.engine.duration) this.finish();
    }

    // Beat accents for the track glow and background.
    const beats = this.chart.beats;
    let beat: 'none' | 'beat' | 'downbeat' = 'none';
    while (this.lastBeat + 1 < beats.length && beats[this.lastBeat + 1] <= t) {
      this.lastBeat++;
      this.beatAt = now;
      beat = this.downbeats.has(this.lastBeat) ? 'downbeat' : 'beat';
    }
    if (this.phase === 'playing' && this.session.overdriveActive)
      this.rumble.overdriveTick(this.session.overdrive / this.odMeterAtStart, beat);
    // Each beat swells the highway's light in quickly and lets it ebb away softly: a rise of a few
    // hundredths of a second and a long fall, on the clock, so it is the same at any frame rate and
    // dies away during a pause. The curve peaks at 1, about 0.05 s after the beat.
    const since = (now - this.beatAt) / 1000;
    const beatPulse = since >= 0 && since < 1.5 ? ((1 - Math.exp(-since / 0.02)) * Math.exp(-since / 0.2)) / 0.715 : 0;
    const bands = this.meter.update(Math.min(0.1, Math.max(0, now - this.meterAt) / 1000));
    this.meterAt = now;
    const low = bands.low;
    let stage: StageInput | null = null;
    if (this.stage) {
      const bar = barAt(this.barTimes, t);
      const busy = bar >= 0 ? (this.barLevels[bar] ?? 0.3) : 0.15;
      stage = {
        intensity: busy * 0.75 + low * 0.25,
        overdrive: this.session.overdriveActive,
        barSeconds: this.chart.secondsPerBeat * 4,
        bands,
      };
    }
    return { beat, stage, pulse: beatPulse * 0.5 + low * 0.5 };
  }

  /**
   * Makes a replay's video frame by frame, as fast as the frames can be drawn rather than as the
   * song plays: the song is not played, its loudness is read from its samples, and everything moves
   * on the video's clock. Call once, before the first `renderFrame`.
   */
  beginFrames(clock: number) {
    if (!this.playback) return;
    this.frames = true;
    cancelAnimationFrame(this.raf);
    this.meter.setAnalyser(this.bufferBands() as unknown as AnalyserNode);
    this.meterAt = clock;
    this.beatAt = -Infinity;
    this.seekTo(REPLAY_START);
    this.setPhase('playing');
  }

  /**
   * Moves the replay on to the frame of song time `t` at the video's clock `now` (ms), and asks the
   * stage for its picture of it, which it draws in its own worker while the page carries on with
   * the frame before (see `drawFrame`).
   */
  beginFrame(t: number, now: number): FrameJob {
    this.bands?.at(t);
    const f = this.advance(t, now);
    const picture = this.stage && f.stage && !this.disposed ? this.stage.step(now, f.stage, f.beat) : Promise.resolve(null);
    return { t, now, beat: f.beat, pulse: f.pulse, picture };
  }

  /**
   * Draws a frame begun with `beginFrame`: the highway and the HUD at once (`onHighway` is called
   * while the highway's picture is on its canvas), then resolves with the stage's picture (null
   * without a stage).
   */
  drawFrame(job: FrameJob, onHighway: () => void): Promise<ImageBitmap | null> {
    if (this.disposed) return Promise.resolve(null);
    this.highway.render(job.t, this.session, job.pulse, job.now);
    this.updateHud(job.t, job.beat);
    onHighway();
    return job.picture;
  }

  private bands: BufferAnalyser | null = null;
  private bufferBands() {
    const b = this.buffer;
    this.bands ??= new BufferAnalyser({
      sampleRate: b.sampleRate,
      channels: Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i)),
    });
    return this.bands;
  }

  /**
   * Shows how the last note went on the tag beside the strike line. `delta` (seconds, negative =
   * early) moves the bar in the tag's little target above or below its middle.
   */
  private flashFeedback(text: string, kind: string, delta?: number) {
    this.lastFeedback = { text, kind, at: this.clock };
    const el = this.hud.feedback;
    this.hud.feedbackWord.textContent = text;
    el.dataset.kind = kind;
    if (delta === undefined) delete el.dataset.timing;
    else {
      // A perfect hit sits dead centre. Anything else is shown clearly off it, further the later or
      // earlier it was, so early and late can be told apart at a glance.
      const on = kind === 'perfect';
      el.dataset.timing = on ? 'on' : delta < 0 ? 'early' : 'late';
      const off = on ? 0 : Math.sign(delta || 1) * Math.min(1, 0.45 + 0.55 * (Math.abs(delta) / WINDOWS.good));
      el.style.setProperty('--off', off.toFixed(2));
    }
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = window.setTimeout(() => el.classList.remove('pop'), 1150);
  }

  private updateHud(t: number, beat: 'none' | 'beat' | 'downbeat' = 'none') {
    const s = this.session;
    const c = this.hudCache;
    const score = Math.round(s.score);
    if (score !== c.score) {
      const text = score.toLocaleString();
      this.hud.score.textContent = text;
      if (text.length !== c.scoreLen) {
        c.scoreLen = text.length;
        this.fitScore();
      }
    }
    const mult = s.multiplier;
    if (mult !== c.mult) {
      this.hud.multiplier.textContent = `×${mult}`;
      // The dial's colour follows the streak's own step; overdrive recolours it (see .hud.overdrive).
      this.hud.multiplier.dataset.level = String(multiplierFor(s.streak));
    }
    if (s.streak !== c.streak) {
      // The dial's ring: how far the streak is toward the next multiplier step (full at the top one).
      const top = multiplierFor(s.streak) >= MAX_MULTIPLIER;
      this.hud.root.style.setProperty('--streak-p', top ? '1' : ((s.streak % STREAK_PER_MULTIPLIER) / STREAK_PER_MULTIPLIER).toFixed(2));
      // The streak stands above the tag once it is worth showing, and burns at the top multiplier.
      this.hud.feedbackStreak.textContent = s.streak >= 5 ? String(s.streak) : '';
      this.hud.feedbackStreak.toggleAttribute('data-hot', top);
    }
    const od = Math.round(s.overdrive * 100);
    if (od !== c.od) {
      // (--od itself is the overdrive colour.)
      this.hud.root.style.setProperty('--od-level', (od / 100).toFixed(2));
      this.hud.root.classList.toggle('od-ready', od >= 25 && !s.overdriveActive);
      // In a Showdown the meter is the Strike's charge too: a quarter of it is a Strike ready.
      this.hud.root.classList.toggle('strike-ready', !!this.strike && od >= 25 && !s.overdriveActive);
    }
    if (s.overdriveActive !== c.odActive) {
      this.hud.root.classList.toggle('overdrive', s.overdriveActive);
      this.hud.root.classList.toggle('strike-ready', !!this.strike && od >= 25 && !s.overdriveActive);
    }
    const stars = s.progressStars;
    if (stars !== c.stars) {
      this.hud.stars.dataset.count = String(stars);
      Array.from(this.hud.stars.children).forEach((el, i) => {
        (el as HTMLElement).dataset.state = stars >= GOLD_STARS ? 'gold' : i < stars ? 'on' : i === stars ? 'next' : 'off';
      });
    }
    const starP = Math.round(s.nextStarProgress * 50) / 50;
    if (starP !== c.starP) this.hud.stars.style.setProperty('--star-p', String(starP));
    const songP = Math.round(Math.max(0, Math.min(1, t / this.chart.duration)) * 1000) / 1000;
    if (songP !== c.songP) this.hud.timeline.style.setProperty('--song-p', String(songP));
    const left = Math.max(0, Math.ceil(this.chart.duration - Math.max(0, t)));
    if (left !== c.left) this.hud.remaining.textContent = `-${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    this.updateBreak(t, beat);
    Object.assign(c, { score, mult, streak: s.streak, od, stars, starP, odActive: s.overdriveActive, songP, left });
  }

  /**
   * The break countdown: bars left until the next note, with a ring that drains until the note is
   * due. It holds still; on every beat its ring breathes a little, the same each time; on every bar line the new number rolls up into place
   * as the old one rolls away, and a ripple runs out from the ring. It takes its last two beats to
   * leave, gone just before the notes kick in.
   */
  private updateBreak(t: number, beat: 'none' | 'beat' | 'downbeat') {
    const b = this.phase === 'playing' || this.phase === 'paused' ? this.breaks.find((x) => t >= x.from && t < x.to) : undefined;
    const el = this.hud.breakTimer;
    const c = this.hudCache;
    if (!b) {
      if (c.breakSec !== -1) {
        el.classList.remove('on', 'final', 'leaving');
        c.breakSec = -1;
      }
      return;
    }
    this.hud.breakRing.style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, (b.to - t) / (b.to - b.from))));
    // The last two beats of the countdown are spent going, within reason.
    const fade = Math.max(0.7, Math.min(1.5, this.chart.secondsPerBeat * 2));
    const leaving = t >= b.to - fade;
    if (leaving && !el.classList.contains('leaving')) el.style.setProperty('--break-fade', `${fade.toFixed(2)}s`);
    el.classList.toggle('leaving', leaving);
    const moving = !leaving && !reducedMotion();
    // Without a bar grid, fall back to seconds.
    const bars = this.barTimes.length > 1 ? barsLeft(t, b.next, this.barTimes) : Math.max(1, Math.ceil(b.next - t));
    if (bars === c.breakSec) {
      if (beat !== 'none' && moving) breakBeat(this.hud.breakRing);
      return;
    }
    const first = c.breakSec === -1;
    const was = this.hud.breakNumber.textContent ?? '';
    c.breakSec = bars;
    this.hud.breakNumber.textContent = String(bars);
    el.classList.add('on');
    el.classList.toggle('final', bars <= 1);
    if (!first && moving) breakBar(el, this.hud.breakNumber, this.hud.breakRing, was);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.feedbackTimer);
    window.removeEventListener('resize', this.resize);
    this.observer.disconnect();
    this.hud.overdriveButton.removeEventListener('pointerdown', this.overdrivePress);
    this.unwire();
    this.touchInput?.dispose();
    this.input?.dispose();
    this.padInput?.dispose();
    this.rumble.dispose();
    this.engine.stop();
    this.engine.onEnded = null;
    this.highway.dispose();
    this.stage?.dispose();
    this.shownStage?.dispose();
  }
}

/**
 * A song's timeline as a CSS mask: thick where there are notes to play, a thin line through every
 * longer stretch without any (the intro, a break, the fade-out). Null for a song of no length.
 */
export function timelineShape(chart: Chart, length = chart.duration): string | null {
  const d = length;
  if (!(d > 0)) return null;
  const min = Math.max(4, d * 0.02);
  const pct = (t: number) => `${((Math.min(d, Math.max(0, t)) / d) * 100).toFixed(2)}%`;
  let css = 'linear-gradient(to right';
  let free = 0;
  let from = 0;
  const quiet = (a: number, b: number) => {
    if (b - a < min) return;
    css += `, #000 ${pct(from)} ${pct(a)}, transparent ${pct(a)} ${pct(b)}`;
    from = b;
  };
  for (const n of chart.notes) {
    quiet(free, n.t);
    free = Math.max(free, n.t + n.dur);
  }
  quiet(free, d);
  return `${css}, #000 ${pct(from)} 100%)`;
}

function reducedMotion(): boolean {
  const m = document.documentElement.dataset.motion;
  return m === 'reduced' || (m !== 'full' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * A beat in a break: the ring breathes out a little and brightens, then eases back. The same on
 * every beat, loud or quiet, and on the ring alone (`scale`, apart from the ring's own turn), so it
 * never pulls at the timer's place or its number.
 */
function breakBeat(fill: SVGCircleElement) {
  fill.ownerSVGElement?.animate(
    [
      { scale: 1, opacity: 1 },
      { scale: 1.03, opacity: 1, offset: 0.18 },
      { scale: 1, opacity: 1 },
    ],
    { duration: 480, easing: 'cubic-bezier(0.25, 0.6, 0.35, 1)' },
  );
  fill.animate(
    [
      { filter: 'drop-shadow(0 0 8px currentColor) brightness(1)' },
      { filter: 'drop-shadow(0 0 14px currentColor) brightness(1.25)', offset: 0.18 },
      { filter: 'drop-shadow(0 0 8px currentColor) brightness(1)' },
    ],
    { duration: 480, easing: 'ease-out' },
  );
}

/**
 * A bar line in a break: like a counter, the old number rolls up out of the ring's window as the
 * new one rolls up in after it (together, one number's height apart, so they never overlap); the
 * ring lights up and a thin ripple runs out from it.
 */
function breakBar(timer: HTMLElement, num: HTMLElement, fill: SVGCircleElement, was: string) {
  // Far enough that the next number waits wholly out of sight below the window.
  const step = '125%';
  const roll = { duration: 460, easing: 'cubic-bezier(0.6, 0, 0.2, 1)' };
  num.animate([{ transform: `translateY(${step})` }, { transform: 'none' }], roll);
  if (was) {
    const ghost = num.cloneNode() as HTMLElement;
    ghost.textContent = was;
    ghost.classList.add('ghost');
    ghost.setAttribute('aria-hidden', 'true');
    num.after(ghost);
    // It fades as it goes, so its tail does not linger at the top edge as the roll eases out.
    ghost
      .animate(
        [
          { transform: 'none', opacity: 1 },
          { opacity: 1, offset: 0.45 },
          { transform: `translateY(-${step})`, opacity: 0 },
        ],
        { ...roll, fill: 'forwards' },
      )
      .finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
  }
  fill.animate(
    [
      { filter: 'drop-shadow(0 0 8px currentColor) brightness(1)' },
      { filter: 'drop-shadow(0 0 20px currentColor) brightness(1.5)', offset: 0.2 },
      { filter: 'drop-shadow(0 0 8px currentColor) brightness(1)' },
    ],
    { duration: 700, easing: 'ease-out' },
  );
  timer.animate(
    [
      { transform: 'scale(1)', opacity: 0.7 },
      { transform: 'scale(1.28)', opacity: 0 },
    ],
    { duration: 800, easing: 'cubic-bezier(0.2, 0.6, 0.3, 1)', pseudoElement: '::before' },
  );
}
