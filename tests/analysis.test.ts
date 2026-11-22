import { describe, expect, it } from 'vitest';
import { barsOnGrid, estimateTempo, trackBeats } from '../src/analysis/dsp/beats';
import { onsetEnvelope } from '../src/analysis/dsp/onsets';
import { stft } from '../src/analysis/dsp/stft';
import { hpss } from '../src/analysis/dsp/hpss';
import { analyzeSignal, standOutKicks } from '../src/analysis/pipeline';
import { ANALYSIS_SAMPLE_RATE as SR } from '../src/analysis/types';

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
type Add = (t0: number, dur: number, fn: (t: number) => number) => void;

/** Kick on every beat, snare on 2 & 4, hats on 8ths, a bass note per beat and a lead melody per beat. */
function song(bpm: number, seconds: number, opts: { drums?: boolean; bass?: number[]; lead?: number[] } = {}) {
  const x = new Float32Array(Math.floor(seconds * SR));
  const spb = 60 / bpm;
  let seed = 1;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (t0: number, dur: number, fn: (t: number) => number) => {
    const a = Math.floor(t0 * SR);
    for (let i = 0; i < dur * SR && a + i < x.length; i++) x[a + i] += fn(i / SR);
  };
  const beats = Math.floor(seconds / spb);
  for (let b = 0; b < beats; b++) {
    const t = 0.5 + b * spb;
    if (opts.drums !== false) {
      add(t, 0.2, (s) => Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-s * 30)) * s) * Math.exp(-s * 15) * 0.8);
      if (b % 2 === 1) add(t, 0.15, (s) => noise() * Math.exp(-s * 25) * 0.4);
      add(t + spb / 2, 0.04, (s) => noise() * Math.exp(-s * 90) * 0.15);
    }
    if (opts.bass) {
      const f = midiHz(opts.bass[b % opts.bass.length]);
      add(t, spb * 0.9, (s) => Math.sin(2 * Math.PI * f * s) * 0.3 * Math.min(1, s * 100));
    }
    if (opts.lead) {
      const f = midiHz(opts.lead[b % opts.lead.length]);
      add(
        t,
        spb * 0.9,
        (s) =>
          (Math.sin(2 * Math.PI * f * s) + 0.4 * Math.sin(4 * Math.PI * f * s) + 0.2 * Math.sin(6 * Math.PI * f * s)) *
          0.15 *
          Math.min(1, s * 100),
      );
    }
  }
  return x;
}

describe('dsp', () => {
  it.each([90, 128, 174])('estimates %i BPM', (bpm) => {
    const x = song(bpm, 20);
    const s = stft(x, SR);
    const env = onsetEnvelope(s);
    const tempo = estimateTempo(env, SR / 512);
    // Allow octave-equivalent answers only within the prior's preferred range.
    const ratio = tempo / bpm;
    expect([0.5, 1, 2].some((r) => Math.abs(ratio - r) < 0.03)).toBe(true);
    if (bpm === 128) expect(Math.abs(tempo - 128)).toBeLessThan(2);
  });

  it('tracks beats on the clicks', () => {
    const bpm = 120;
    const x = song(bpm, 16);
    const s = stft(x, SR);
    const fps = SR / 512;
    const env = onsetEnvelope(s);
    const frames = trackBeats(env, fps, estimateTempo(env, fps));
    const times = frames.map((f) => f / fps).filter((t) => t > 2 && t < 14);
    for (const t of times) {
      const off = (((t - 0.5) % 0.5) + 0.5) % 0.5;
      expect(Math.min(off, 0.5 - off)).toBeLessThan(0.035);
    }
  });

  it('separates a sustained tone from clicks', () => {
    const x = song(120, 6, { drums: true, lead: [69] });
    const s = stft(x, SR);
    const { harmonic, percussive } = hpss(s);
    const k440 = Math.round(440 / (SR / 2048));
    let h = 0;
    let p = 0;
    for (let f = 0; f < s.frames; f++) {
      h += harmonic[f * s.bins + k440];
      p += percussive[f * s.bins + k440];
    }
    expect(h).toBeGreaterThan(p * 3);
  });
});

describe('drum detection', () => {
  /** Sixteen seconds of a four-on-the-floor kick at 120 BPM, with `extra` laid over each beat. */
  const kicks = (gain: (beat: number) => number, extra?: (add: Add, t: number, beat: number) => void) => {
    const x = new Float32Array(16 * SR);
    const add: Add = (t0, dur, fn) => {
      const a = Math.floor(t0 * SR);
      for (let i = 0; i < dur * SR && a + i < x.length; i++) x[a + i] += fn(i / SR);
    };
    for (let b = 0; b < 30; b++) {
      const t = 0.5 + b * 0.5;
      const g = gain(b);
      add(t, 0.2, (s) => Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-s * 30)) * s) * Math.exp(-s * 15) * 0.8 * g);
      extra?.(add, t, b);
    }
    return x;
  };
  /** The kicks found between 1 and 15 s, and those of them off the beat. */
  const found = (drums: { t: number; kind: string; strength: number }[]) => {
    const all = drums.filter((d) => d.kind === 'kick' && d.t > 1 && d.t < 15);
    const offBeat = all.filter((k) => {
      const o = (((k.t - 0.5) % 0.5) + 0.5) % 0.5;
      return Math.min(o, 0.5 - o) > 0.08;
    });
    return { all, offBeat, onBeat: all.length - offBeat.length };
  };

  it('does not mistake off-beat bass notes for kicks', async () => {
    const x = kicks(
      () => 1,
      (add, t, b) => {
        const f = midiHz([33, 36, 31, 33][b % 4]);
        add(t + 0.25, 0.24, (s) => Math.sin(2 * Math.PI * f * s) * 0.35 * Math.min(1, s * 300) * Math.min(1, (0.24 - s) * 100));
      },
    );
    const { all, offBeat } = found((await analyzeSignal(x)).drums);
    expect(all.length).toBeGreaterThan(20);
    expect(offBeat.length).toBeLessThanOrEqual(2);
  }, 60_000);

  // A floor tom left ringing at an eighth of the kick's level on every off-beat, in the drum stem.
  const tom = (scale: (b: number) => number) => (add: Add, t: number, b: number) =>
    add(t + 0.25, 0.3, (s) => Math.sin(2 * Math.PI * (85 + 25 * Math.exp(-s * 20)) * s) * Math.exp(-s * 9) * 0.1 * scale(b));

  it('does not take quiet low thumps between the kicks for kicks', async () => {
    const x = kicks(
      () => 1,
      tom(() => 1),
    );
    const { onBeat, offBeat } = found((await analyzeSignal(x, { drumSignal: x })).drums);
    expect(onBeat).toBeGreaterThan(20);
    expect(offBeat.length).toBeLessThanOrEqual(2);
  }, 60_000);

  it('keeps the kicks of a quiet section, judged against the kicks around them', async () => {
    // The first half sixteen decibels down: kick and tom alike, as in a quiet verse.
    const quiet = (b: number) => (b < 15 ? 0.16 : 1);
    const x = kicks(quiet, tom(quiet));
    const { all, onBeat, offBeat } = found((await analyzeSignal(x, { drumSignal: x })).drums);
    // Away from where it gets loud again (the kicks there are judged against the loud ones too).
    const verse = all.filter((k) => k.t < 4.6);
    expect(verse.length).toBeGreaterThanOrEqual(7);
    expect(onBeat).toBeGreaterThan(24);
    expect(offBeat.length).toBeLessThanOrEqual(2);
  }, 60_000);

  it('judges a lone low thump in a break against the song’s kicks, not against itself alone', async () => {
    // Kicks, then a break of eight seconds with one quiet tom thump in the middle of it.
    const x = kicks(
      (b) => (b >= 10 && b < 26 ? 0 : 1),
      (add, t, b) => {
        if (b === 18) add(t, 0.3, (s) => Math.sin(2 * Math.PI * (85 + 25 * Math.exp(-s * 20)) * s) * Math.exp(-s * 9) * 0.1);
      },
    );
    const { all } = found((await analyzeSignal(x, { drumSignal: x })).drums);
    expect(all.filter((k) => k.t > 6 && k.t < 13)).toEqual([]);
    expect(all.length).toBeGreaterThan(10);
  }, 60_000);

  it('keeps the strengths kicks were measured with, on the scale of the snare and hi-hat', () => {
    const k = (t: number, strength: number) => ({ t, kind: 'kick' as const, strength });
    // A loud bar, a quiet verse, a lone thump in a break and a weak thump among loud kicks.
    const kept = standOutKicks([
      k(1, 1),
      k(1.5, 0.9),
      k(2, 0.95),
      k(10, 0.3),
      k(10.5, 0.28),
      k(11, 0.31),
      k(20, 0.43),
      k(30, 1),
      k(30.25, 0.4),
      k(30.5, 1),
    ]);
    expect(kept.map((h) => [h.t, h.strength])).toEqual([
      [1, 1],
      [1.5, 0.9],
      [2, 0.95],
      [10, 0.3],
      [10.5, 0.28],
      [11, 0.31],
      [30, 1],
      [30.5, 1],
    ]);
  });
});

describe('bar starts on the grid', () => {
  const beats = Array.from({ length: 16 }, (_, i) => 0.5 + i * 0.5);

  it('puts each bar start on the nearest beat and carries the bars on to both ends', () => {
    // Bars heard at the third, seventh and eleventh beat, a little off the grid.
    expect(barsOnGrid(beats, [1.52, 3.49, 5.51])).toEqual([2, 6, 10, 14]);
    // Three beats to a bar, heard from the fifth beat on: carried back to the second.
    expect(barsOnGrid(beats, [2.5, 4, 5.5])).toEqual([1, 4, 7, 10, 13]);
  });

  it('has no bars without bar starts or without beats', () => {
    expect(barsOnGrid(beats, [])).toEqual([]);
    expect(barsOnGrid([], [1])).toEqual([]);
  });
});

describe('pipeline', () => {
  it('finds drums, beats, bass and lead in a synthetic song', async () => {
    const bass = [40, 40, 43, 45];
    const lead = [72, 74, 76, 79];
    const x = song(120, 24, { bass, lead });
    const a = await analyzeSignal(x);
    expect(Math.abs(a.tempo - 120)).toBeLessThan(3);
    expect(a.beats.length).toBeGreaterThan(40);
    const kicks = a.drums.filter((d) => d.kind === 'kick');
    expect(kicks.length).toBeGreaterThan(30);
    for (const k of kicks.filter((k) => k.t > 1 && k.t < 22)) {
      const off = (((k.t - 0.5) % 0.5) + 0.5) % 0.5;
      expect(Math.min(off, 0.5 - off)).toBeLessThan(0.05);
    }
    // Pitch classes of the detected lines should match the written ones.
    const pcs = (notes: { midi: number }[]) => new Set(notes.map((n) => n.midi % 12));
    const leadPcs = pcs(a.lead);
    expect(lead.filter((m) => leadPcs.has(m % 12)).length).toBeGreaterThanOrEqual(3);
    const bassPcs = pcs(a.bass);
    expect(bass.filter((m) => bassPcs.has(m % 12)).length).toBeGreaterThanOrEqual(2);
    expect(a.sections.length).toBeGreaterThan(0);
    expect(a.downbeats.length).toBeGreaterThan(8);
  }, 60_000);
  it('takes its grid from the beat model when given one', async () => {
    // The song is in four; the model is made to hear three beats to a bar, at 20 ms steps a little off.
    const x = song(120, 24, { bass: [40, 40, 43, 45] });
    const heard = Array.from({ length: 44 }, (_, i) => Math.round((0.5 + i * 0.5 + (i % 2 ? 0.01 : -0.01)) * 50) / 50);
    const a = await analyzeSignal(x, { beatTracker: async () => ({ beats: heard, downbeats: heard.filter((_, i) => i % 3 === 1) }) });
    expect(Math.abs(a.tempo - 120)).toBeLessThan(1);
    // The grid is the model's, smoothed, moved onto the kicks and carried to both ends of the song.
    expect(a.beats.length).toBeGreaterThanOrEqual(46);
    for (const t of a.beats) {
      const off = (((t - 0.5) % 0.5) + 0.5) % 0.5;
      expect(Math.min(off, 0.5 - off)).toBeLessThan(0.02);
    }
    const bars = a.downbeats.map((i) => a.beats[i]);
    expect(bars.length).toBeGreaterThan(12);
    for (let i = 1; i < bars.length; i++) expect(bars[i] - bars[i - 1]).toBeCloseTo(1.5, 1);
  }, 60_000);

  it('finds the grid by itself when the beat model fails or hears too little', async () => {
    const x = song(120, 24, { bass: [40, 40, 43, 45] });
    const alone = await analyzeSignal(x);
    const logs: string[] = [];
    const failing = await analyzeSignal(x, {
      onLog: (m) => logs.push(m),
      beatTracker: async () => {
        throw new Error('no model');
      },
    });
    const sparse = await analyzeSignal(x, { onLog: (m) => logs.push(m), beatTracker: async () => ({ beats: [1, 2, 3], downbeats: [1] }) });
    expect(failing.beats).toEqual(alone.beats);
    expect(failing.downbeats).toEqual(alone.downbeats);
    expect(sparse.beats).toEqual(alone.beats);
    expect(logs.some((m) => m.includes('no model'))).toBe(true);
    expect(logs.some((m) => m.includes('too few beats'))).toBe(true);
  }, 60_000);
});
