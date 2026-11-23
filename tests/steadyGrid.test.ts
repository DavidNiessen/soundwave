import { describe, expect, it } from 'vitest';
import { steadyBars, steadyBeats } from '../src/analysis/dsp/beats';

const grid = (from: number, period: number, n: number) => Array.from({ length: n }, (_, i) => from + i * period);
const gaps = (b: number[]) => b.slice(1).map((t, i) => t - b[i]);

describe('steady beats', () => {
  it('leaves a steady song as it is', () => {
    const beats = grid(0.5, 0.5, 64);
    expect(steadyBeats(beats)).toEqual(beats);
  });

  it('lays out evenly where the model lost the pulse between two steady stretches', () => {
    // 120 BPM, with a stretch where the model's beats bunched up and went missing.
    const before = grid(0.5, 0.5, 20);
    const lost = [10.62, 10.8, 11.6, 11.75, 12.9, 13.1, 13.6];
    const after = grid(14.5, 0.5, 20);
    const out = steadyBeats([...before, ...lost, ...after]);
    expect(out.slice(0, 20)).toEqual(before);
    expect(out.slice(-20)).toEqual(after);
    // 10.0 .. 14.5 holds nine beats at 120 BPM: eight new ones between the two stretches.
    expect(out).toHaveLength(48);
    for (const g of gaps(out)) expect(g).toBeCloseTo(0.5, 6);
  });

  it('keeps a real change of tempo between two steady stretches', () => {
    const slow = grid(0.5, 0.5, 24);
    const fast = grid(12.5, 0.4, 24);
    const out = steadyBeats([...slow, ...fast]);
    expect(out.slice(0, 24)).toEqual(slow);
    expect(out.slice(-24)).toEqual(fast);
  });

  it('keeps a song that gradually speeds up as it is', () => {
    // From 100 to 130 BPM over 96 beats, as a live band might.
    const beats = [0.5];
    for (let i = 1; i < 96; i++) beats.push(beats[i - 1] + 60 / (100 + (30 * i) / 95));
    expect(steadyBeats(beats)).toEqual(beats);
  });

  it('carries the first steady stretch back over an intro the model could not follow', () => {
    const intro = [0.3, 0.55, 1.4, 1.62, 2.7, 3.05];
    const song = grid(4, 0.5, 32);
    const out = steadyBeats([...intro, ...song]);
    expect(out.slice(-32)).toEqual(song);
    for (const g of gaps(out)) expect(g).toBeCloseTo(0.5, 6);
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it('counts a stretch the model heard at double time at the tempo around it', () => {
    const before = grid(0.5, 0.5, 32);
    const double = grid(16.5, 0.25, 24);
    const after = grid(22.5, 0.5, 32);
    const out = steadyBeats([...before, ...double, ...after]);
    expect(out.slice(0, 32)).toEqual(before);
    expect(out.slice(-32)).toEqual(after);
    for (const g of gaps(out)) expect(g).toBeCloseTo(0.5, 6);
  });

  it('leaves a song alone that has no steady stretch at all', () => {
    const beats = [0, 0.4, 1.1, 1.3, 2.2, 2.4, 3.5, 3.6, 4.8, 5.0, 6.3];
    expect(steadyBeats(beats)).toEqual(beats);
  });
});

describe('steady bars', () => {
  it('counts whole bars where the model marked every other beat', () => {
    expect(steadyBars([0, 4, 8, 10, 12, 14, 16, 20, 24])).toEqual([0, 4, 8, 12, 16, 20, 24]);
  });

  it('drops a lone bar start in the middle of a bar', () => {
    expect(steadyBars([0, 4, 8, 9, 12, 16])).toEqual([0, 4, 8, 12, 16]);
  });

  it('keeps bars that really moved: a short bar, then the new ones', () => {
    expect(steadyBars([0, 4, 8, 10, 14, 18, 22])).toEqual([0, 4, 8, 10, 14, 18, 22]);
  });

  it('fills in a missing bar start', () => {
    expect(steadyBars([0, 4, 12, 16, 20])).toEqual([0, 4, 8, 12, 16, 20]);
  });
});
