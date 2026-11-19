import FFT from 'fft.js';

/** The samples a BufferAnalyser reads: one channel, or several to mix down. */
export interface Samples {
  sampleRate: number;
  channels: Float32Array[];
}

/**
 * What a Web Audio AnalyserNode says about a song at any moment of it, read straight from its
 * samples: for a video, which is made frame by frame faster than the song plays, so no live
 * analyser hears it. It follows the analyser's own steps (a Blackman window, an FFT, smoothing over
 * time, decibels mapped onto bytes), so the highway and the stage move to it as they do in a song.
 * It stands in for the analyser where only these members are used (see BandMeter).
 */
export class BufferAnalyser {
  readonly fftSize: number;
  readonly frequencyBinCount: number;
  readonly smoothingTimeConstant = 0.6;
  readonly minDecibels = -100;
  readonly maxDecibels = -30;
  readonly context: { sampleRate: number };
  private readonly fft: FFT;
  private readonly window: Float32Array;
  private readonly frame: Float32Array;
  private readonly spectrum: number[];
  private readonly smoothed: Float32Array;
  /** The song time the next reading is taken at, seconds. */
  private time = 0;

  constructor(
    private readonly samples: Samples,
    fftSize = 2048,
  ) {
    this.fftSize = fftSize;
    this.frequencyBinCount = fftSize / 2;
    this.context = { sampleRate: samples.sampleRate };
    this.fft = new FFT(fftSize);
    this.spectrum = this.fft.createComplexArray();
    this.frame = new Float32Array(fftSize);
    this.smoothed = new Float32Array(this.frequencyBinCount);
    // The analyser's window: Blackman, alpha 0.16.
    this.window = new Float32Array(fftSize);
    const a = 0.16;
    for (let i = 0; i < fftSize; i++) {
      const x = (2 * Math.PI * i) / fftSize;
      this.window[i] = (1 - a) / 2 - 0.5 * Math.cos(x) + (a / 2) * Math.cos(2 * x);
    }
  }

  /** Moves to song time `t` (seconds): the next reading is of the samples just before it. */
  at(t: number) {
    this.time = t;
  }

  getByteFrequencyData(out: Uint8Array) {
    const { channels, sampleRate } = this.samples;
    const end = Math.round(this.time * sampleRate);
    const n = this.fftSize;
    const scale = 1 / channels.length;
    for (let i = 0; i < n; i++) {
      const at = end - n + i;
      let v = 0;
      for (const ch of channels) v += at >= 0 && at < ch.length ? ch[at] : 0;
      this.frame[i] = v * scale * this.window[i];
    }
    this.fft.realTransform(this.spectrum, this.frame);
    const k = this.smoothingTimeConstant;
    const range = this.maxDecibels - this.minDecibels;
    const bins = Math.min(out.length, this.frequencyBinCount);
    for (let i = 0; i < bins; i++) {
      const re = this.spectrum[2 * i];
      const im = this.spectrum[2 * i + 1];
      const mag = Math.sqrt(re * re + im * im) / n;
      this.smoothed[i] = k * this.smoothed[i] + (1 - k) * mag;
      const db = 20 * Math.log10(this.smoothed[i] || 1e-12);
      out[i] = Math.max(0, Math.min(255, Math.floor((255 / range) * (db - this.minDecibels))));
    }
  }
}
