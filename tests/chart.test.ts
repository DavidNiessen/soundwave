import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from '../src/analysis/types';
import { CHORD_SHARE, detectFeel, generateChart, thumbOf } from '../src/chart/generator';
import { PROFILES } from '../src/chart/profiles';
import { DIFFICULTIES, PARTS, lanesFor } from '../src/chart/types';

function fakeAnalysis(): AnalysisResult {
  const spb = 0.5;
  const beats = Array.from({ length: 240 }, (_, i) => 1 + i * spb);
  const drums: AnalysisResult['drums'] = [];
  const bass: AnalysisResult['bass'] = [];
  const lead: AnalysisResult['lead'] = [];
  const scale = [60, 62, 64, 65, 67, 69, 71, 72];
  beats.forEach((t, i) => {
    drums.push({ t: t + 0.01, kind: 'kick', strength: 0.9 });
    if (i % 2) drums.push({ t: t - 0.008, kind: 'snare', strength: 0.8 });
    drums.push({ t: t + spb / 2, kind: 'hat', strength: 0.4 });
    drums.push({ t: t + spb / 4, kind: 'hat', strength: 0.2 });
    bass.push({ t, dur: i % 8 === 0 ? spb * 2 : spb * 0.4, midi: 40 + (i % 4) * 2, strength: 0.7 });
    lead.push({ t: t + 0.01, dur: spb * 0.45, midi: scale[(i * 3) % scale.length], strength: 0.6 });
    lead.push({ t: t + spb / 2, dur: i % 4 === 3 ? spb * 1.5 : spb * 0.2, midi: scale[(i * 5) % scale.length], strength: 0.4 });
  });
  return {
    version: 1,
    source: 'local',
    duration: 1 + 240 * spb,
    tempo: 120,
    beats,
    downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0),
    drums,
    bass,
    lead,
    vocals: lead.map((n) => ({ ...n, midi: n.midi + 2, bend: 0.2 })),
    harmony: beats.filter((_, i) => i % 8 === 0).map((t, i) => ({ t, root: i % 12, minor: false, strength: 0.8 })),
    sections: [
      { start: 0, end: 40, energy: 0.4 },
      { start: 40, end: 121, energy: 1 },
    ],
    energy: [],
    energyHop: 0.1,
    pitchSource: 'salience',
  };
}

describe('generateChart', () => {
  const a = fakeAnalysis();
  for (const part of PARTS) {
    for (const d of DIFFICULTIES) {
      it(`${part}/${d} respects lanes, gaps, chords and sustains`, () => {
        const c = generateChart(a, part, d, 'song');
        const p = PROFILES[d];
        expect(c.lanes).toBe(lanesFor(d));
        expect(c.notes.length).toBeGreaterThan(20);
        const times = [...new Set(c.notes.map((n) => n.t))].sort((x, y) => x - y);
        for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(p.minGap - 1e-6);
        const perTime = new Map<number, number>();
        for (const n of c.notes) {
          expect(n.lane).toBeGreaterThanOrEqual(0);
          expect(n.lane).toBeLessThan(c.lanes);
          perTime.set(n.t, (perTime.get(n.t) ?? 0) + 1);
        }
        for (const v of perTime.values()) expect(v).toBeLessThanOrEqual(p.maxChord);
        for (let i = 0; i < c.notes.length; i++) {
          const n = c.notes[i];
          if (!n.dur) continue;
          for (const m of c.notes) {
            if (m.lane === n.lane && m.t > n.t) expect(m.t).toBeGreaterThan(n.t + n.dur);
          }
        }
        for (let i = 1; i < c.notes.length; i++) expect(c.notes[i].t).toBeGreaterThanOrEqual(c.notes[i - 1].t);
      });
    }
  }

  it('is deterministic', () => {
    expect(generateChart(a, 'lead', 'expert', 'x')).toEqual(generateChart(a, 'lead', 'expert', 'x'));
  });

  it('gets denser with difficulty', () => {
    for (const part of PARTS) {
      const counts = DIFFICULTIES.map((d) => generateChart(a, part, d, 's').notes.length);
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  it('marks overdrive phrases', () => {
    const c = generateChart(a, 'drums', 'medium', 's');
    const phrases = new Set(c.notes.filter((n) => n.phrase >= 0).map((n) => n.phrase));
    expect(phrases.size).toBeGreaterThan(3);
  });

  it('charts a repeated riff identically, follows its contour and keeps chords within budget', () => {
    const spb = 0.5;
    const beats = Array.from({ length: 70 }, (_, i) => 1 + i * spb);
    const lead: AnalysisResult['lead'] = [];
    for (let bar = 0; bar < 16; bar++) {
      const t = 1 + bar * 4 * spb;
      lead.push({ t, dur: 0.4, midi: 67, strength: 0.8, chord: [55, 60, 64, 67] });
      [60, 62, 64, 62, 60].forEach((m, k) => lead.push({ t: t + (k + 1) * spb * 0.5 + spb * 0.5, dur: 0.2, midi: m, strength: 0.6 }));
    }
    const riff: AnalysisResult = {
      ...fakeAnalysis(),
      beats,
      downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0),
      duration: 36,
      lead,
      sections: [
        { start: 0, end: 17, energy: 0.6 },
        { start: 17, end: 36, energy: 1 },
      ],
    };
    for (const d of DIFFICULTIES) {
      const c = generateChart(riff, 'lead', d, 'riff');
      const bars = riff.downbeats.slice(0, 16).map((i) => beats[i]);
      const patterns = bars.map((s) =>
        c.notes
          .filter((n) => n.t >= s - 0.01 && n.t < s + 4 * spb - 0.01)
          .map((n) => `${(n.t - s).toFixed(2)}:${n.lane}`)
          .join(' '),
      );
      expect(new Set(patterns).size).toBe(1);
      // Rising notes move right, falling notes move left (singles only).
      const singles = c.notes.filter((n) => c.notes.filter((m) => m.t === n.t).length === 1 && n.t < bars[1] - 0.01);
      const lanes = singles.map((n) => n.lane);
      if (d !== 'easy' && lanes.length >= 4) expect(lanes[1]).toBeGreaterThan(lanes[0]);
      const times = new Set(c.notes.map((n) => n.t)).size;
      const chordTimes = times - c.notes.filter((n) => c.notes.filter((m) => m.t === n.t).length === 1).length;
      expect(chordTimes).toBeLessThanOrEqual(Math.floor(Math.floor(times * PROFILES[d].chordRate) * 1.5));
    }
  });

  it('uses 5 lanes only on expert', () => {
    const used = new Set(generateChart(a, 'lead', 'expert', 's').notes.map((n) => n.lane));
    expect(used.has(4)).toBe(true);
    const hard = new Set(generateChart(a, 'lead', 'hard', 's').notes.map((n) => n.lane));
    expect(hard.has(4)).toBe(false);
  });
});

describe('detectFeel', () => {
  const bars = Array.from({ length: 8 }, (_, b) => b * 4);
  it('hears a shuffle as triplets', () => {
    expect(detectFeel(bars.flatMap((b) => [b, b + 2 / 3, b + 1, b + 1 + 2 / 3, b + 2 + 1 / 3]))).toBe('triplet');
  });
  it('keeps sixteenth grooves straight, even with a few loose notes', () => {
    expect(detectFeel(bars.flatMap((b) => [b, b + 0.25, b + 0.75, b + 1.5, b + 2.75, b + 3.34]))).toBe('straight');
  });
});

describe('sung lane walk', () => {
  // A rap verse on one pitch (sixteenths) followed by a rising, then falling, sung phrase.
  const base = fakeAnalysis();
  const spb = 0.5;
  const vocals: AnalysisResult['vocals'] = [];
  for (let i = 0; i < 64; i++) vocals.push({ t: 10 + i * (spb / 4), dur: 0.1, midi: 58, strength: 0.8 });
  const melody = [60, 62, 64, 67, 69, 67, 64, 62, 60];
  melody.forEach((m, i) => vocals.push({ t: 22 + i * spb, dur: 0.4, midi: m, strength: 0.8 }));
  const a = { ...base, vocals };
  const notes = generateChart(a, 'vocals', 'expert', 'song').notes;

  it('never hammers one lane with fast notes', () => {
    const hammered = notes.filter((n, i) => i > 0 && n.t - notes[i - 1].t < 0.25 && n.lane === notes[i - 1].lane);
    expect(hammered).toEqual([]);
  });

  it('spreads a monotone verse over the lanes', () => {
    const verse = notes.filter((n) => n.t < 20);
    expect(new Set(verse.map((n) => n.lane)).size).toBeGreaterThanOrEqual(4);
  });

  it('follows the melody up and down', () => {
    const sung = notes.filter((n) => n.t >= 22);
    const moves = sung.slice(1).map((n, i) => Math.sign(n.lane - sung[i].lane));
    const want = melody.slice(1).map((m, i) => Math.sign(m - melody[i]));
    const agree = moves.filter((d, i) => d === want[i]).length;
    expect(agree / moves.length).toBeGreaterThanOrEqual(0.75);
  });
});

describe('empty parts', () => {
  it('a part without notes gives an empty chart instead of failing', () => {
    const a = { ...fakeAnalysis(), bass: [], vocals: [] };
    for (const part of ['bass', 'vocals'] as const) {
      for (const d of DIFFICULTIES) expect(generateChart(a, part, d, 'song').notes).toEqual([]);
    }
  });
});

describe('local feel', () => {
  it('switches to triplets for a triplet passage inside a straight part', async () => {
    const { localFeel } = await import('../src/chart/generator');
    const straight = Array.from({ length: 64 }, (_, i) => i * 0.25 + 0.25 * (i % 2));
    const triplets = Array.from({ length: 12 }, (_, i) => 32 + i / 3);
    const feel = localFeel([...straight.filter((p) => p < 30 || p > 38), ...triplets]);
    expect(feel(10)).toBe('straight');
    expect(feel(34)).toBe('triplet');
  });
});

describe('release notes', () => {
  // Long sung notes that end on a beat, each followed by a rest.
  const base = fakeAnalysis();
  const spb = 0.5;
  const vocals: AnalysisResult['vocals'] = [];
  for (let i = 0; i < 24; i++) vocals.push({ t: 1 + i * 4 * spb, dur: 2 * spb, midi: 60 + (i % 5), strength: 0.8 });
  const a = { ...base, vocals };

  it('appear on medium and up, never on easy', () => {
    expect(generateChart(a, 'vocals', 'easy', 'song').notes.some((n) => n.release)).toBe(false);
    for (const d of ['medium', 'hard', 'expert'] as const)
      expect(generateChart(a, 'vocals', d, 'song').notes.some((n) => n.release)).toBe(true);
  });

  it('end on a beat or half-beat, with room before the next note', () => {
    const c = generateChart(a, 'vocals', 'expert', 'song');
    const times = c.notes.map((n) => n.t);
    for (const n of c.notes.filter((x) => x.release)) {
      const endBeat = (n.t + n.dur - 1) / spb;
      expect(Math.abs(endBeat * 2 - Math.round(endBeat * 2))).toBeLessThan(1e-3);
      const next = times.find((t) => t > n.t + 1e-6);
      if (next !== undefined) expect(next - (n.t + n.dur)).toBeGreaterThanOrEqual(0.5 * spb - 1e-6);
    }
  });
});

describe('one thumb, one button', () => {
  // On a controller the left thumb plays the two leftmost lanes and the right thumb the rest.
  const conflicts = (notes: { t: number; lane: number }[]) => {
    const byT = new Map<string, number[]>();
    for (const n of notes) byT.set(n.t.toFixed(4), [...(byT.get(n.t.toFixed(4)) ?? []), thumbOf(n.lane)]);
    return [...byT.values()].filter((th) => new Set(th).size < th.length).length;
  };
  const a = fakeAnalysis();
  for (const part of PARTS) {
    it(`${part}: no chord needs one thumb twice`, () => {
      for (const d of DIFFICULTIES) expect(conflicts(generateChart(a, part, d, 'song').notes)).toBe(0);
    });
  }
  it('a held note never shares its thumb with another note', () => {
    for (const part of PARTS) {
      for (const d of DIFFICULTIES) {
        const notes = generateChart(a, part, d, 'song').notes;
        for (const h of notes.filter((n) => n.dur > 0)) {
          const busy = notes.filter((n) => n !== h && thumbOf(n.lane) === thumbOf(h.lane) && n.t >= h.t - 1e-6 && n.t < h.t + h.dur);
          expect(busy).toEqual([]);
        }
      }
    }
  });
});

describe('drum chords below expert', () => {
  /** A kick on every beat at `kick`, and a snare at full strength on 2 and 4 with it. */
  const backbeats = (kick: number): AnalysisResult => {
    const a = fakeAnalysis();
    a.drums = a.beats.flatMap((t, i) => [
      { t, kind: 'kick' as const, strength: kick },
      ...(i % 2 ? [{ t, kind: 'snare' as const, strength: 1 }] : []),
    ]);
    return a;
  };
  const chords = (a: AnalysisResult, d: 'medium' | 'hard') => {
    const at = new Map<number, number>();
    for (const n of generateChart(a, 'drums', d, 's').notes) at.set(n.t, (at.get(n.t) ?? 0) + 1);
    return [...at.values()].filter((n) => n > 1).length;
  };

  it('keeps a kick well under a loud snare a single note, and chords one close to it', () => {
    // A kick that is strong by itself (over the old 0.45 and 0.5) but well under the snare.
    expect(0.6).toBeLessThan(CHORD_SHARE);
    for (const d of ['medium', 'hard'] as const) {
      expect(chords(backbeats(0.6), d)).toBe(0);
      expect(chords(backbeats(0.9), d)).toBeGreaterThan(40);
    }
  });
});

describe('holds at any tempo', () => {
  /** A bass note on every beat, each sounding for `share` of the beat, at `bpm`. */
  const quarters = (bpm: number, share: number): AnalysisResult => {
    const a = fakeAnalysis();
    const spb = 60 / bpm;
    a.tempo = bpm;
    a.beats = Array.from({ length: 200 }, (_, i) => 1 + i * spb);
    a.downbeats = a.beats.map((_, i) => i).filter((i) => i % 4 === 0);
    a.duration = 1 + 200 * spb;
    a.bass = a.beats.map((t, i) => ({ t, dur: spb * share, midi: 40 + (i % 4) * 2, strength: 0.7 }));
    return a;
  };
  const held = (a: AnalysisResult) => {
    const notes = generateChart(a, 'bass', 'expert', 's').notes;
    return notes.filter((n) => n.dur > 0).length / notes.length;
  };

  it('holds notes of most of a beat at 120 BPM', () => {
    expect(held(quarters(120, 0.7))).toBeGreaterThan(0.8);
  });

  it('does not make every note of a fast song a hold', () => {
    // At 180 BPM the same share of a beat is under a quarter of a second.
    expect(held(quarters(180, 0.7))).toBe(0);
    // A note held as long in time as at 120 BPM still is a hold.
    expect(held(quarters(180, 1.05))).toBeGreaterThan(0.8);
  });
});

describe('easy drums', () => {
  /** A hi-hat on every eighth, and a kick and snare in only some bars. */
  const kit = (kickAndSnare: (bar: number) => boolean): AnalysisResult => {
    const a = fakeAnalysis();
    a.drums = a.beats.flatMap((t, i) => [
      { t, kind: 'hat' as const, strength: 0.7 },
      { t: t + 0.25, kind: 'hat' as const, strength: 0.5 },
      ...(kickAndSnare(Math.floor(i / 4)) ? [{ t, kind: (i % 2 ? 'snare' : 'kick') as 'snare' | 'kick', strength: 0.9 }] : []),
    ]);
    return a;
  };
  const perBar = (a: AnalysisResult) => {
    const c = generateChart(a, 'drums', 'easy', 's');
    return c.notes.length / c.downbeats.length;
  };

  it('keeps a groove carried by the hi-hat', () => {
    // Kick and snare only every fourth bar: the hats are the rhythm, and easy still plays it.
    expect(perBar(kit((bar) => bar % 4 === 0))).toBeGreaterThan(1.5);
  });

  it('leaves the hats out where kick and snare play', () => {
    const a = kit(() => true);
    const c = generateChart(a, 'drums', 'easy', 's');
    const hatLane = c.notes.filter((n) => n.lane === 3).length;
    expect(hatLane).toBe(0);
    expect(perBar(a)).toBeGreaterThan(1.5);
  });
});

describe('bars of three', () => {
  it('keep three quarters of a bar of four on the difficulties that thin out', () => {
    const a = fakeAnalysis();
    a.downbeats = a.beats.map((_, i) => i).filter((i) => i % 3 === 0);
    for (const d of ['easy', 'medium', 'hard'] as const) {
      const c = generateChart(a, 'lead', d, 's');
      const bars = new Map<number, Set<number>>();
      const bar = (t: number) => a.downbeats.filter((i) => a.beats[i] <= t + 1e-3).length;
      for (const n of c.notes) bars.set(bar(n.t), (bars.get(bar(n.t)) ?? new Set()).add(n.t));
      const most = Math.max(...[...bars.values()].map((s) => s.size));
      expect(most).toBeLessThanOrEqual(Math.max(1, Math.round((PROFILES[d].maxPerBar * 3) / 4)));
    }
  });
});
