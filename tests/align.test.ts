import { describe, expect, it } from 'vitest';
import { lagBetween } from '../src/audio/align';

/** Noise with a beat in it, `seconds` long at `rate`, the same every run. */
function signal(seconds: number, rate: number): Float32Array {
  const out = new Float32Array(seconds * rate);
  let x = 12345;
  for (let i = 0; i < out.length; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[i] = (x / 0x7fffffff - 0.5) * (i % rate < rate / 8 ? 1 : 0.2);
  }
  return out;
}

describe('lining a copy of a song up with the song', () => {
  const rate = 8000;
  const a = signal(20, rate);
  it('finds how many samples later a copy plays, to the sample', () => {
    for (const lag of [0, 1, 7, 1024, 1500]) {
      const b = new Float32Array(a.length + lag);
      b.set(a, lag);
      expect(lagBetween([a], [b], rate)).toBe(lag);
    }
  });
  it('and how many earlier', () => {
    const b = a.slice(300);
    expect(lagBetween([a], [b], rate)).toBe(-300);
  });
});
