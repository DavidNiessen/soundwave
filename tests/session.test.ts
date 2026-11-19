import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '../src/chart/types';
import { GameSession, PHRASE_REWARD } from '../src/game/GameSession';
import { gradeFor } from '../src/game/judge';
import { goldThreshold, multiplierFor, starsFor } from '../src/game/scoring';

const chart = (notes: Partial<Note>[], lanes: 4 | 5 = 4): Chart => ({
  part: 'lead',
  difficulty: lanes === 5 ? 'expert' : 'easy',
  lanes,
  notes: notes.map((n) => ({ t: 0, lane: 0, dur: 0, phrase: -1, ...n })),
  beats: [],
  downbeats: [],
  secondsPerBeat: 0.5,
  duration: 60,
});

describe('judge', () => {
  it('grades by window', () => {
    expect(gradeFor(0.01)).toBe('perfect');
    expect(gradeFor(-0.07)).toBe('great');
    expect(gradeFor(0.12)).toBe('good');
    expect(gradeFor(0.2)).toBeNull();
  });
});

describe('scoring', () => {
  it('ramps multiplier every 10 notes up to x6', () => {
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(10)).toBe(2);
    expect(multiplierFor(49)).toBe(5);
    expect(multiplierFor(50)).toBe(6);
    expect(multiplierFor(999)).toBe(6);
  });
  it('awards stars by the share of par, and gold stars at par', () => {
    expect(starsFor(0, 100)).toBe(0);
    expect(starsFor(3, 100)).toBe(0);
    expect(starsFor(4, 100)).toBe(1);
    expect(starsFor(15, 100)).toBe(3);
    expect(starsFor(46, 100)).toBe(4);
    expect(starsFor(77, 100)).toBe(5);
    expect(starsFor(112, 100)).toBe(5);
    expect(starsFor(113, 100)).toBe(6);
    expect(starsFor(300, 100)).toBe(6);
    // A chart with no overdrive to give turns gold at par; one with a little asks for a little more.
    expect(goldThreshold(0)).toBe(1);
    expect(goldThreshold(0.1)).toBeCloseTo(1.075);
    expect(goldThreshold(0.5)).toBe(1.13);
    expect(starsFor(100, 100, goldThreshold(0))).toBe(6);
  });
});

describe('GameSession', () => {
  it('hits notes in the right lane and misses late ones', () => {
    const s = new GameSession(
      chart([
        { t: 1, lane: 0 },
        { t: 2, lane: 1 },
      ]),
    );
    s.press(0, 1.01);
    s.update(3);
    const r = s.results();
    expect(r.counts.perfect).toBe(1);
    expect(r.counts.miss).toBe(1);
    expect(s.streak).toBe(0);
  });

  it('breaks the streak on a ghost press', () => {
    const s = new GameSession(chart([{ t: 1 }, { t: 3 }]));
    s.press(0, 1);
    expect(s.streak).toBe(1);
    s.press(0, 2);
    expect(s.streak).toBe(0);
  });

  it('judges each chord note separately', () => {
    const s = new GameSession(
      chart([
        { t: 1, lane: 0 },
        { t: 1, lane: 2 },
      ]),
    );
    s.press(0, 1);
    s.press(2, 1.05);
    expect(s.results().fullCombo).toBe(true);
  });

  it('scores sustains while held', () => {
    const s = new GameSession(chart([{ t: 1, dur: 1 }]));
    s.press(0, 1);
    const tap = s.score;
    s.update(1.5);
    s.update(2.1);
    expect(s.score).toBeGreaterThan(tap + 40);
    expect(s.holding[0]).toBe(-1);
  });

  it('fills overdrive on a completed phrase and drains while active', () => {
    const s = new GameSession(chart([{ t: 1, phrase: 0 }, { t: 2, phrase: 0 }, { t: 3 }]));
    s.press(0, 1);
    s.press(0, 2);
    expect(s.overdrive).toBeCloseTo(PHRASE_REWARD);
    expect(s.activateOverdrive()).toBe(true);
    expect(s.multiplier).toBe(2);
    s.update(2);
    s.update(10);
    expect(s.overdriveActive).toBe(false);
  });

  it('fails a phrase when one note is missed', () => {
    const s = new GameSession(
      chart([
        { t: 1, phrase: 0 },
        { t: 2, phrase: 0 },
      ]),
    );
    s.update(1.5);
    s.press(0, 2);
    expect(s.overdrive).toBe(0);
  });
});

describe('hold and release notes', () => {
  const holdThenRelease = () => {
    const s = new GameSession(chart([{ t: 1, dur: 1, release: true }, { t: 3 }]));
    const events: string[] = [];
    s.on((e) =>
      events.push(
        e.type === 'release' ? `release ${e.grade}` : e.type === 'release-miss' ? `release-miss ${e.early ? 'early' : 'late'}` : e.type,
      ),
    );
    s.update(0.99);
    s.press(0, 1.0);
    return { s, events };
  };

  it('scores a release on time', () => {
    const { s, events } = holdThenRelease();
    s.update(1.98);
    const before = s.score;
    s.release(0, 2.01);
    expect(events).toContain('release perfect');
    expect(s.score).toBeGreaterThan(before);
    expect(s.results().releases).toEqual({ hit: 1, total: 1 });
  });

  it('letting go clearly early is a miss that breaks the streak', () => {
    const { s, events } = holdThenRelease();
    s.update(1.5);
    s.release(0, 1.5);
    expect(events).toContain('release-miss early');
    expect(s.streak).toBe(0);
    expect(s.isReleaseMissed(0)).toBe(true);
  });

  it('holding past the window is a late miss', () => {
    const { s, events } = holdThenRelease();
    s.update(2.0);
    expect(events).not.toContain('release-miss late');
    s.update(2.2);
    expect(events).toContain('release-miss late');
    expect(s.holding[0]).toBe(-1);
  });

  it('a pause drops the hold without breaking the streak', () => {
    const { s, events } = holdThenRelease();
    s.update(1.4);
    s.dropHolds();
    expect(s.streak).toBe(1);
    expect(s.isReleaseMissed(0)).toBe(true);
    expect(events.filter((e) => e.startsWith('release'))).toEqual([]);
  });

  it('a missed head misses its release too', () => {
    const s = new GameSession(chart([{ t: 1, dur: 1, release: true }]));
    s.update(1.5);
    expect(s.isReleaseMissed(0)).toBe(true);
    expect(s.results().releases).toEqual({ hit: 0, total: 1 });
  });
});

describe('one run, whatever the frame rate', () => {
  // Twenty seconds: taps on every half second, a chord, sustains, a hold to let go on time, and a
  // phrase early on that fills the overdrive meter.
  const notes: Partial<Note>[] = [];
  for (let i = 0; i < 36; i++) notes.push({ t: 1 + i * 0.5, lane: i % 3, phrase: i < 4 ? 0 : -1 });
  // The holds have the fourth lane to themselves, so no tap ends one.
  notes.push({ t: 4, lane: 3 }, { t: 6.25, lane: 3, dur: 2 }, { t: 9.25, lane: 3, dur: 1.5, release: true }, { t: 12.25, lane: 3, dur: 3 });
  notes.sort((a, b) => a.t! - b.t! || a.lane! - b.lane!);
  const song = chart(notes);

  type Input = { t: number; kind: 'press' | 'release' | 'overdrive'; lane: number };
  const inputs: Input[] = [];
  song.notes.forEach((n, i) => {
    if (n.dur === 0 && i % 7 === 5) return; // not played
    const off = ((i * 37) % 11) * 0.012 - 0.06; // early and late, within the windows
    inputs.push({ t: n.t + off, kind: 'press', lane: n.lane });
    // Sustains are let go a little early, on time, or (the hold to let go on time) too late.
    inputs.push({
      t: n.dur > 0 ? n.t + n.dur + (n.release ? 0.3 : -0.2 + (i % 3) * 0.15) : n.t + off + 0.07,
      kind: 'release',
      lane: n.lane,
    });
  });
  inputs.push({ t: 5.31, kind: 'press', lane: 2 }, { t: 3.47, kind: 'overdrive', lane: 0 }, { t: 7.013, kind: 'overdrive', lane: 0 });
  inputs.sort((a, b) => a.t - b.t);

  /** The run with the frames of a display at `fps`: the inputs since the last frame first, each at its own time. */
  const play = (fps: number) => {
    const s = new GameSession(song);
    const events: string[] = [];
    s.on((e) => events.push(e.type));
    let next = 0;
    for (let frame = 0; frame / fps <= 21; frame++) {
      const t = frame / fps;
      for (; next < inputs.length && inputs[next].t <= t; next++) {
        const e = inputs[next];
        if (e.kind === 'press') s.press(e.lane, e.t);
        else if (e.kind === 'release') s.release(e.lane, e.t);
        else s.activateOverdrive(e.t);
      }
      s.update(t);
    }
    s.update(Number.POSITIVE_INFINITY);
    return { results: s.results(), events };
  };

  it('gives the same score, counts and events at 30, 60, 144 and 1000 frames a second', () => {
    const reference = play(1000);
    // The run has everything in it that could differ: sustain points, a miss, a stray press, overdrive.
    expect(reference.results.counts.miss).toBeGreaterThan(1);
    expect(reference.results.overdriveActivations).toBe(1);
    expect(reference.events).toContain('overdrive-end');
    expect(reference.events).toContain('release-miss');
    for (const fps of [30, 60, 144]) expect(play(fps)).toEqual(reference);
  });

  it('shows the sustain points of a hold between two frames', () => {
    const s = new GameSession(chart([{ t: 1, dur: 2 }]));
    s.press(0, 1);
    s.update(2);
    // One beat is half a second: two beats held so far, at 25 points a beat.
    expect(s.score).toBeCloseTo(50 + 2 * 25, 6);
    s.update(4);
    expect(s.results().score).toBe(50 + 4 * 25);
  });
});
