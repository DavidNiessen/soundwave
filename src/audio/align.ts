/**
 * Lining two recordings of the same audio up to the sample: how much later `b` plays what `a` does.
 * Used to keep a server's smaller copy of a song in time with the song (src/net/streamQuality.ts).
 */

/** The channels added together, and each run of `step` samples added into one (a rough low-pass, so no lag is lost between the samples kept). */
export function downmix(channels: Float32Array[], step: number): Float32Array {
  const n = Math.floor((channels[0]?.length ?? 0) / step);
  const out = new Float32Array(n);
  for (const d of channels) for (let i = 0; i < n * step; i++) out[(i / step) | 0] += d[i];
  return out;
}

/** The lag at which `b` matches `a` best: from `guess - max` to `guess + max`, over `a[from..from+len]`. */
export function bestLag(a: Float32Array, b: Float32Array, from: number, len: number, guess: number, max: number): number {
  let best = guess;
  let top = -Infinity;
  for (let lag = guess - max; lag <= guess + max; lag++) {
    let sum = 0;
    const end = Math.min(from + len, a.length, b.length - lag);
    for (let i = Math.max(from, -lag); i < end; i++) sum += a[i] * b[i + lag];
    if (sum > top) {
      top = sum;
      best = lag;
    }
  }
  return best;
}

/**
 * How many samples later `b` plays `a`'s audio (negative: earlier), within `maxSeconds`: found
 * coarsely on every fourth sample over a few seconds from a third of the way in (past any quiet
 * start), then to the sample.
 */
export function lagBetween(a: Float32Array[], b: Float32Array[], rate: number, maxSeconds = 0.2): number {
  const step = 4;
  const ca = downmix(a, step);
  const cb = downmix(b, step);
  const from = Math.floor(ca.length / 3);
  const coarse = bestLag(ca, cb, from, Math.floor((6 * rate) / step), 0, Math.ceil((maxSeconds * rate) / step));
  return bestLag(downmix(a, 1), downmix(b, 1), from * step, rate, coarse * step, step * 2);
}
