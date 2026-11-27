import type { Spectrogram } from './stft';
import { medianFilter } from './median';

export interface Hpss {
  harmonic: Float32Array;
  percussive: Float32Array;
}

/**
 * Harmonic/percussive separation by median filtering (Fitzgerald 2010) with soft masks.
 * Harmonic content is smooth over time, percussive content is smooth over frequency.
 *
 * Only the bins below `top` are separated (the rest stay zero): a caller that reads nothing above
 * a few kilohertz is spared most of the work, and the bins it does read come out exactly as they
 * would from the whole spectrum (the median across frequency still sees the bins above).
 */
export function hpss(s: Spectrogram, timeWin = 17, freqWin = 17, onProgress?: (p: number) => void, top = s.bins): Hpss {
  const { mag, frames, bins } = s;
  const used = Math.min(bins, Math.max(0, top));
  const harmonic = new Float32Array(mag.length);
  const percussive = new Float32Array(mag.length);
  const scratch = new Float32Array(Math.max(timeWin, freqWin) + 2);
  // Across time each bin is read as a column: copied out first, so the filter walks memory in order.
  const column = new Float32Array(frames);
  const filtered = new Float32Array(frames);
  for (let k = 0; k < used; k++) {
    for (let f = 0, i = k; f < frames; f++, i += bins) column[f] = mag[i];
    medianFilter(column, filtered, 0, 1, frames, timeWin, scratch);
    for (let f = 0, i = k; f < frames; f++, i += bins) harmonic[i] = filtered[f];
    if (onProgress && (k & 127) === 0) onProgress((k / used) * 0.5);
  }
  for (let f = 0; f < frames; f++) {
    medianFilter(mag, percussive, f * bins, 1, bins, freqWin, scratch, used);
    if (onProgress && (f & 2047) === 0) onProgress(0.5 + (f / frames) * 0.5);
  }
  for (let f = 0; f < frames; f++) {
    for (let i = f * bins, end = i + used; i < end; i++) {
      const h = harmonic[i] * harmonic[i];
      const p = percussive[i] * percussive[i];
      const sum = h + p + 1e-12;
      harmonic[i] = (mag[i] * h) / sum;
      percussive[i] = (mag[i] * p) / sum;
    }
  }
  return { harmonic, percussive };
}
