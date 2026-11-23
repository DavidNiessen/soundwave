import { describe, expect, it } from 'vitest';
import { analyzeMix, analyzeParts, analyzeSignal, stemsMix } from '../src/analysis/pipeline';
import { Stopwatch } from '../src/analysis/timing';
import { ANALYSIS_SAMPLE_RATE as SR, type AnalysisResult, type PitchedNote, type StemNotes } from '../src/analysis/types';
import { generateAll } from '../src/chart/generator';
import { PARTS } from '../src/chart/types';

/**
 * The whole analysis of a synthesized band, pinned: work that only makes the analysis faster must
 * leave every beat, hit, note and chart exactly as it was. A change that is meant to alter what the
 * analysis finds updates the snapshot (and raises ANALYSIS_VERSION).
 */

const midiHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const BPM = 112;
const SECONDS = 30;

/** Four stems of a band in 4/4 with a break, the notes played on each, and the beats. */
function band() {
  const length = SECONDS * SR;
  const stems = {
    drums: new Float32Array(length),
    bass: new Float32Array(length),
    other: new Float32Array(length),
    vocals: new Float32Array(length),
  };
  const notes: StemNotes = { bass: [], vocals: [], other: [] };
  const spb = 60 / BPM;
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const add = (x: Float32Array, t0: number, dur: number, fn: (s: number) => number) => {
    const a = Math.floor(t0 * SR);
    for (let i = 0; i < dur * SR && a + i < x.length; i++) x[a + i] += fn(i / SR);
  };
  const tone = (f: number, level: number, harmonics: number[]) => (s: number) =>
    harmonics.reduce((sum, h, k) => sum + h * Math.sin(2 * Math.PI * f * (k + 1) * s), 0) *
    level *
    Math.min(1, s * 120) *
    Math.exp(-s * 1.5);
  const note = (list: PitchedNote[], t: number, dur: number, midi: number, strength: number, chord?: number[]) =>
    list.push({ t, dur, midi, strength, ...(chord ? { chord } : {}) });

  const bassLine = [40, 40, 43, 45, 38, 38, 41, 43];
  const chords = [
    [52, 55, 59],
    [50, 53, 57],
    [48, 52, 55],
    [47, 50, 55],
  ];
  const melody = [64, 66, 67, 69, 67, 66, 64, 62, 64, 67];
  const beats: number[] = [];
  for (let b = 0; 0.5 + b * spb < SECONDS - 0.5; b++) {
    const t = 0.5 + b * spb;
    beats.push(t);
    const bar = Math.floor(b / 4);
    // Bars 4 and 5 are a break: no drums, only a held chord.
    const breakBar = bar === 4 || bar === 5;
    if (!breakBar) {
      add(stems.drums, t, 0.2, (s) => Math.sin(2 * Math.PI * (50 + 80 * Math.exp(-s * 30)) * s) * Math.exp(-s * 15) * 0.8);
      if (b % 2 === 1) add(stems.drums, t, 0.15, (s) => noise() * Math.exp(-s * 25) * 0.4);
      add(stems.drums, t + spb / 2, 0.04, (s) => noise() * Math.exp(-s * 90) * 0.15);
      const m = bassLine[b % bassLine.length];
      add(stems.bass, t, spb * 0.85, tone(midiHz(m), 0.3, [1, 0.3]));
      note(notes.bass, t, spb * 0.85, m, 0.7);
    }
    if (b % 2 === 0) {
      // Strummed chords on every other beat: three tones a few milliseconds apart.
      const chord = chords[bar % chords.length];
      chord.forEach((m, k) => add(stems.other, t + k * 0.012, spb * 1.8, tone(midiHz(m), 0.08, [1, 0.5, 0.25])));
      for (const m of chord) note(notes.other, t, spb * 1.8, m, 0.6);
    }
    if (!breakBar && b % 4 !== 3) {
      // A sung syllable on most beats, with some vibrato.
      const m = melody[b % melody.length];
      const f = midiHz(m);
      add(
        stems.vocals,
        t + 0.02,
        spb * 0.7,
        (s) => Math.sin(2 * Math.PI * f * s + 0.3 * Math.sin(2 * Math.PI * 5.5 * s)) * 0.2 * Math.min(1, s * 40),
      );
      note(notes.vocals, t + 0.02, spb * 0.7, m, 0.65);
    }
  }
  const mix = new Float32Array(length);
  for (const x of Object.values(stems)) for (let i = 0; i < length; i++) mix[i] += x[i];
  return { mix, stems, notes, beats, downbeats: beats.filter((_, i) => i % 4 === 0) };
}

/** Everything the game takes from an analysis: the result itself and every part's charts. */
function summary(a: AnalysisResult) {
  return { analysis: a, charts: Object.fromEntries(PARTS.map((p) => [p, generateAll(a, p, 'golden')])) };
}

describe('the analysis of a synthesized band', () => {
  const { mix, stems, notes, beats, downbeats } = band();

  it('is unchanged with stems and the beat model, as the game runs it', async () => {
    const a = await analyzeSignal(mix.slice(), {
      lines: { bass: [], lead: [], vocals: [] },
      drumSignal: stems.drums.slice(),
      stems: { bass: stems.bass.slice(), vocals: stems.vocals.slice(), other: stems.other.slice() },
      stemNotes: notes,
      beatTracker: async () => ({ beats, downbeats }),
    });
    expect(a.bass.length).toBeGreaterThan(20);
    expect(a.lead.length).toBeGreaterThan(10);
    expect(a.vocals.length).toBeGreaterThan(20);
    expect(summary(a)).toMatchSnapshot();
  });

  it('is the same when the mix is analyzed before its stems are there', async () => {
    const opts = () => ({
      lines: { bass: [], lead: [], vocals: [] },
      drumSignal: stems.drums.slice(),
      stems: { bass: stems.bass.slice(), vocals: stems.vocals.slice(), other: stems.other.slice() },
      stemNotes: notes,
    });
    const beatTracker = async () => ({ beats, downbeats });
    const whole = await analyzeSignal(mix.slice(), { ...opts(), beatTracker });
    const first = await analyzeMix(mix, { withStems: true, beatTracker });
    expect(await analyzeParts(mix, first, opts())).toEqual(whole);
    // As the game hands it to another worker: only what the second half reads.
    const small = await analyzeMix(mix, { withStems: true, beatTracker });
    expect(await analyzeParts(mix, { ...stemsMix(small), clock: new Stopwatch() }, opts())).toEqual(whole);
  });

  it('is unchanged on the mix alone, with the beat tracker', async () => {
    const a = await analyzeSignal(mix.slice());
    expect(summary(a)).toMatchSnapshot();
  });
});
