import { hzToBin, type Spectrogram } from './stft';

/**
 * Half-wave rectified spectral flux of log-compressed magnitudes within [loHz, hiHz].
 * `spec` has the same layout as the spectrogram (it may be a separated component).
 */
export function bandFlux(spec: Float32Array, s: Spectrogram, loHz: number, hiHz: number): Float32Array {
  const lo = hzToBin(s, loHz);
  const hi = hzToBin(s, hiHz);
  const width = hi - lo + 1;
  const out = new Float32Array(s.frames);
  // Each frame's logs are taken once and kept for the next frame's difference.
  let prev = new Float64Array(width);
  let cur = new Float64Array(width);
  for (let k = 0; k < width; k++) prev[k] = Math.log1p(spec[lo + k]);
  for (let f = 1; f < s.frames; f++) {
    const row = f * s.bins + lo;
    let sum = 0;
    for (let k = 0; k < width; k++) {
      const v = Math.log1p(spec[row + k]);
      cur[k] = v;
      const d = v - prev[k];
      if (d > 0) sum += d;
    }
    out[f] = sum / width;
    [prev, cur] = [cur, prev];
  }
  return out;
}

/** Value at the given percentile (0..1) without modifying the input. */
export function percentile(x: ArrayLike<number>, p: number): number {
  if (x.length === 0) return 0;
  const a = Float32Array.from(x).sort();
  return a[Math.min(a.length - 1, Math.max(0, Math.floor(p * (a.length - 1))))];
}

/** Scales so the given percentile maps to 1, clipping at `clip`. */
export function normalize(x: Float32Array, p = 0.99, clip = 1.5): Float32Array {
  const ref = percentile(x, p) || 1;
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.min(clip, x[i] / ref);
  return out;
}

export interface PeakOptions {
  /** Frames on each side that the peak must dominate. */
  maxWin: number;
  /** Frames on each side for the local mean. */
  avgWin: number;
  /** Absolute margin above the local mean (on normalized input). */
  delta: number;
  /** Minimum frames between peaks. */
  wait: number;
}

/** Picks onset peaks from a normalized novelty curve. Returns frame indices. */
export function pickPeaks(x: Float32Array, o: PeakOptions): number[] {
  const peaks: number[] = [];
  const n = x.length;
  // Prefix sums for O(1) local means.
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + x[i];
  let last = -Infinity;
  for (let i = 1; i < n - 1; i++) {
    const v = x[i];
    if (v <= 0) continue;
    let isMax = true;
    for (let j = Math.max(0, i - o.maxWin); j <= Math.min(n - 1, i + o.maxWin); j++) {
      if (x[j] > v || (x[j] === v && j < i)) {
        isMax = false;
        break;
      }
    }
    if (!isMax) continue;
    const a = Math.max(0, i - o.avgWin);
    const b = Math.min(n, i + o.avgWin + 1);
    const mean = (pre[b] - pre[a]) / (b - a);
    if (v < mean + o.delta) continue;
    if (i - last < o.wait) continue;
    peaks.push(i);
    last = i;
  }
  return peaks;
}

/** Simple moving average (box filter) of width 2r+1. */
export function smooth(x: Float32Array, r: number): Float32Array {
  const out = new Float32Array(x.length);
  let sum = 0;
  let count = 0;
  for (let i = -r; i < x.length; i++) {
    const add = i + r;
    if (add < x.length) {
      sum += x[add];
      count++;
    }
    const rem = i - r - 1;
    if (rem >= 0) {
      sum -= x[rem];
      count--;
    }
    if (i >= 0) out[i] = sum / count;
  }
  return out;
}

/** Band-balanced onset envelope: kick, mid and top bands normalized separately, then summed. */
export function onsetEnvelope(s: Spectrogram): Float32Array {
  const env = new Float32Array(s.frames);
  const bands: [number, number, number][] = [
    [30, 160, 1],
    [160, 2500, 1],
    [2500, 10000, 0.6],
  ];
  for (const [lo, hi, w] of bands) {
    const b = normalize(bandFlux(s.mag, s, lo, hi));
    for (let i = 0; i < env.length; i++) env[i] += w * b[i];
  }
  return env;
}
