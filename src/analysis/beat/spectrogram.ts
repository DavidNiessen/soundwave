import FFT from 'fft.js';

/**
 * The spectrogram the beat model listens to, which the model file leaves out. It matches Beat
 * This's own (beat_this.preprocessing.LogMelSpect): mono at 22.05 kHz, 1024-point Hann frames
 * every 441 samples (50 a second), reflected at the edges, magnitudes scaled by 1/sqrt(1024),
 * folded onto 128 mel bands between 30 Hz and 11 kHz (Slaney's scale, bands not normalised), and
 * compressed as log(1 + 1000·x).
 */
export const MELS = 128;
/** Frames per second. */
export const FPS = 50;

const RATE = 22050;
const NFFT = 1024;
const HOP = RATE / FPS;
const BINS = NFFT / 2 + 1;
const SCALE = 1 / Math.sqrt(NFFT);

// Slaney's mel scale: linear up to 1 kHz, logarithmic above.
const LINEAR = 200 / 3;
const KNEE_HZ = 1000;
const KNEE_MEL = KNEE_HZ / LINEAR;
const LOG_STEP = Math.log(6.4) / 27;
const toMel = (hz: number) => (hz < KNEE_HZ ? hz / LINEAR : KNEE_MEL + Math.log(hz / KNEE_HZ) / LOG_STEP);
const toHz = (mel: number) => (mel < KNEE_MEL ? mel * LINEAR : KNEE_HZ * Math.exp(LOG_STEP * (mel - KNEE_MEL)));

/** Per mel band: the first bin it takes from and its weight for that bin and the ones after it. */
const BANDS: { from: number; weights: Float32Array }[] = (() => {
  const low = toMel(30);
  const high = toMel(11000);
  const edges = Array.from({ length: MELS + 2 }, (_, i) => toHz(low + ((high - low) * i) / (MELS + 1)));
  return Array.from({ length: MELS }, (_, m) => {
    const weights: number[] = [];
    let from = -1;
    for (let k = 0; k < BINS; k++) {
      const hz = (k * (RATE / 2)) / (BINS - 1);
      const w = Math.min((hz - edges[m]) / (edges[m + 1] - edges[m]), (edges[m + 2] - hz) / (edges[m + 2] - edges[m + 1]));
      if (w <= 0) continue;
      if (from < 0) from = k;
      weights[k - from] = w;
    }
    return { from: Math.max(0, from), weights: Float32Array.from(weights) };
  });
})();

const fft = new FFT(NFFT);
const HANN = Float64Array.from({ length: NFFT }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / NFFT));
const frame = new Float64Array(NFFT);
const spectrum = fft.createComplexArray();
const magnitudes = new Float64Array(BINS);

const reflect = (i: number, n: number) => {
  while (i < 0 || i >= n) i = i < 0 ? -i : 2 * (n - 1) - i;
  return i;
};

export interface LogMel {
  /** Row-major: frame f, band m at f * MELS + m. */
  data: Float32Array;
  frames: number;
}

/** The log-mel spectrogram of a mono signal at 22.05 kHz. Frame f is centred on sample f * 441. */
export function logMel(signal: Float32Array): LogMel {
  const n = signal.length;
  const frames = n > 1 ? 1 + Math.floor(n / HOP) : 0;
  const data = new Float32Array(frames * MELS);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP - NFFT / 2;
    for (let i = 0; i < NFFT; i++) frame[i] = signal[reflect(start + i, n)] * HANN[i];
    fft.realTransform(spectrum, frame);
    for (let k = 0; k < BINS; k++) magnitudes[k] = Math.hypot(spectrum[2 * k], spectrum[2 * k + 1]) * SCALE;
    const row = f * MELS;
    for (let m = 0; m < MELS; m++) {
      const { from, weights } = BANDS[m];
      let sum = 0;
      for (let j = 0; j < weights.length; j++) sum += weights[j] * magnitudes[from + j];
      data[row + m] = Math.log1p(1000 * sum);
    }
  }
  return { data, frames };
}
