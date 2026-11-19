import { describe, expect, it } from 'vitest';
import type { Chart, Note } from '../src/chart/types';
import { GameSession } from '../src/game/GameSession';
import { OP, ReplayPlayback, ReplayRecorder, replayMisses, replayResults } from '../src/game/replay';
import { readReplay, replaysToPrune, writeReplay, ReplayFileError, type ReplayMeta } from '../src/storage/replays';

/** A busy chart: taps, sustains, release notes and overdrive phrases across four lanes. */
function chart(): Chart {
  const notes: Note[] = [];
  for (let i = 0; i < 160; i++) {
    const t = 1 + i * 0.25;
    const sustain = i % 9 === 0;
    notes.push({
      t,
      lane: (i * 7) % 4,
      dur: sustain ? 0.6 : 0,
      ...(sustain && i % 18 === 0 ? { release: true } : {}),
      phrase: Math.floor(i / 8) % 3 === 0 ? Math.floor(i / 8) : -1,
    });
  }
  notes.sort((a, b) => a.t - b.t || a.lane - b.lane);
  const beats = Array.from({ length: 100 }, (_, i) => i * 0.5);
  return {
    part: 'lead',
    difficulty: 'hard',
    lanes: 4,
    notes,
    beats,
    downbeats: beats.map((_, i) => i).filter((i) => i % 4 === 0),
    secondsPerBeat: 0.5,
    duration: 45,
  };
}

/**
 * A seeded player: hits most notes a little off, misses some, presses a few stray lanes, pauses once.
 * `fps`: the frame rate it plays at; `late`: inputs reach the session only at the frame after
 * them, as they do in the game, instead of before the frame that passes their time.
 */
function play(c: Chart, seed = 7, { fps = 60, late = false } = {}) {
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  const session = new GameSession(c);
  const rec = new ReplayRecorder(session);
  type Ev = { t: number; run(): void };
  const evs: Ev[] = [];
  c.notes.forEach((n) => {
    if (rand() < 0.12) return;
    const at = n.t + (rand() - 0.5) * 0.18;
    evs.push({ t: at, run: () => rec.press(n.lane, at) });
    const up = n.dur > 0 ? n.t + n.dur + (rand() - 0.5) * 0.2 : at + 0.05;
    evs.push({ t: up, run: () => rec.release(n.lane, up) });
  });
  for (let i = 0; i < 20; i++) {
    const at = 2 + rand() * 38;
    evs.push({ t: at, run: () => rec.press(3, at) }, { t: at + 0.03, run: () => rec.release(3, at + 0.03) });
  }
  for (const at of [12, 25, 33]) evs.push({ t: at, run: () => void rec.overdrive(at) });
  evs.sort((a, b) => a.t - b.t);
  // Frames at an uneven rate, as a real one runs; a pause at 20 s rewinds the song 1.5 s.
  let t = -3;
  let k = 0;
  let paused = false;
  // Frame times have a seed of their own, so the run's inputs are the same at every frame rate.
  let f = seed;
  const jitter = () => (f = (f * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  while (t < c.duration + 1) {
    if (late) rec.update(t);
    while (k < evs.length && evs[k].t <= t) evs[k++].run();
    if (!late) rec.update(t);
    if (!paused && t > 20) {
      paused = true;
      rec.dropHolds(t);
      t -= 1.5;
      rec.rewind(t);
      while (k > 0 && evs[k - 1].t > t) k--;
    }
    t += (1 / fps) * (1 + jitter() * 0.5);
  }
  rec.end();
  return { session, inputs: rec.take() };
}

describe('replays', () => {
  it('play back to the same score, stars, counts and streak as the run', () => {
    const c = chart();
    const { session, inputs } = play(c);
    const run = session.results();
    expect(run.counts.miss).toBeGreaterThan(0);
    expect(run.counts.perfect).toBeGreaterThan(0);
    expect(replayResults(c, inputs)).toEqual(run);
    expect(replayResults(c, play(c, 99).inputs)).toEqual(play(c, 99).session.results());
  });

  it('stand where the run stood at any moment, however they are reached', () => {
    const c = chart();
    const { inputs } = play(c);
    const straight = new ReplayPlayback(c, inputs);
    const jumping = new ReplayPlayback(c, inputs);
    for (const t of [5, 18, 21, 30.5, 44]) {
      straight.advance(t);
      jumping.seek(40);
      const at = jumping.seek(t);
      expect([at.score, at.streak, at.overdrive, Array.from(at.state)]).toEqual([
        straight.session.score,
        straight.session.streak,
        straight.session.overdrive,
        Array.from(straight.session.state),
      ]);
    }
    expect(straight.done).toBe(false);
    straight.finish();
    expect(straight.done).toBe(true);
  });

  it('keep operations in order through the rewind of a pause', () => {
    const c = chart();
    const p = new ReplayPlayback(c, play(c).inputs);
    for (let i = 1; i < p.due.length; i++) expect(p.due[i]).toBeGreaterThanOrEqual(p.due[i - 1]);
    // The song's end is due at the end, not at infinity.
    expect(p.end).toBeLessThan(c.duration + 2);
  });

  it('mark where notes were missed', () => {
    const c = chart();
    const { session, inputs } = play(c);
    const misses = replayMisses(c, inputs);
    const r = session.results();
    expect(misses.length).toBeGreaterThanOrEqual(r.counts.miss);
    for (const t of misses) expect(t).toBeGreaterThan(0);
  });

  it('record presses with the lane in the upper bits', () => {
    const c = chart();
    const rec = new ReplayRecorder(new GameSession(c));
    rec.press(3, 1.0000001);
    rec.update(1.2);
    rec.end();
    const { ops, times } = rec.take();
    // Frames aren't written down; the end of the song is.
    expect([...ops]).toEqual([OP.press | (3 << 3), OP.update]);
    expect(times[0]).toBe(Math.fround(1.0000001));
    expect(times[1]).toBe(Number.POSITIVE_INFINITY);
  });

  it('judge a run the same at any frame rate, with inputs reaching the session late', () => {
    const c = chart();
    const reference = replayResults(c, play(c, 7, { fps: 1000 }).inputs);
    const live: number[] = [];
    // 10 frames a second: a machine that stalls, where something often falls due between an input and its frame.
    for (const fps of [10, 30, 60, 144]) {
      const { session, inputs } = play(c, 7, { fps, late: true });
      live.push(session.results().score);
      expect(replayResults(c, inputs)).toEqual(reference);
      // Watched at another rate, it ends on the same result.
      const p = new ReplayPlayback(c, inputs);
      for (let t = -3; t < p.end; t += 1 / 24) p.advance(t);
      p.finish();
      expect(p.session.results()).toEqual(reference);
    }
    // Live, some late inputs were judged a little off: that is what judging the run again settles.
    expect(live.some((s) => s !== reference.score)).toBe(true);
  });

  it('play runs recorded with an update for every frame, whose rewind is a frame back in time', () => {
    const c = chart();
    const session = new GameSession(c);
    const ops: number[] = [];
    const times: number[] = [];
    const op = (o: number, t: number) => (ops.push(o), times.push(t));
    for (let t = 0; t < 3; t += 1 / 60) {
      const at = Math.fround(t);
      op(OP.update, at);
      session.update(at);
    }
    op(OP.overdrive, 3);
    // A pause at 3 s, resumed from 1.5 s.
    op(OP.dropHolds, 3);
    session.dropHolds(3);
    op(OP.update, 1.5);
    session.rewind(1.5);
    for (let t = 1.5; t < c.duration + 1; t += 1 / 60) {
      const at = Math.fround(t);
      op(OP.update, at);
      session.update(at);
    }
    op(OP.update, Number.POSITIVE_INFINITY);
    session.update(Number.POSITIVE_INFINITY);
    expect(replayResults(c, { ops: Uint8Array.from(ops), times: Float32Array.from(times) })).toEqual(session.results());
  });
});

const meta = (over: Partial<ReplayMeta> = {}): ReplayMeta => ({
  id: 'lx1-abc',
  date: 1700000000000,
  songId: 'song',
  title: 'Song',
  artist: 'Band',
  part: 'lead',
  difficulty: 'hard',
  results: replayResults(chart(), play(chart()).inputs),
  best: true,
  kept: false,
  duration: 45,
  ...over,
});

describe('replay files', () => {
  it('carry the chart and the run exactly', async () => {
    const c = chart();
    const { inputs } = play(c);
    const back = await readReplay(writeReplay({ meta: meta(), data: { id: 'lx1-abc', chart: c, inputs } }));
    expect(back.meta).toEqual(meta());
    expect(back.data.chart).toEqual(c);
    expect(back.data.inputs.ops).toEqual(inputs.ops);
    expect(back.data.inputs.times).toEqual(inputs.times);
    expect(replayResults(back.data.chart, back.data.inputs)).toEqual(replayResults(c, inputs));
  });

  it('refuse what is not a replay or is damaged', async () => {
    await expect(readReplay(new Blob(['hello there, not a replay']))).rejects.toBeInstanceOf(ReplayFileError);
    const c = chart();
    const good = new Uint8Array(
      await writeReplay({ meta: meta(), data: { id: 'lx1-abc', chart: c, inputs: play(c).inputs } }).arrayBuffer(),
    );
    await expect(readReplay(new Blob([good.slice(0, good.length - 10)]))).rejects.toBeInstanceOf(ReplayFileError);
    const wrongLane = await writeReplay({
      meta: meta(),
      data: { id: 'lx1-abc', chart: c, inputs: { ops: Uint8Array.of(OP.press | (6 << 3)), times: Float32Array.of(1) } },
    });
    await expect(readReplay(wrongLane)).rejects.toBeInstanceOf(ReplayFileError);
  });
});

describe('keeping replays', () => {
  it('removes the oldest beyond the limit, never the kept ones', () => {
    const list = [
      { id: 'a', date: 1, kept: false },
      { id: 'b', date: 5, kept: true },
      { id: 'c', date: 3, kept: false },
      { id: 'd', date: 4, kept: false },
      { id: 'e', date: 2, kept: true },
    ];
    expect(replaysToPrune(list, 2)).toEqual(['a']);
    expect(replaysToPrune(list, 1)).toEqual(['c', 'a']);
    expect(replaysToPrune(list, 30)).toEqual([]);
    expect(replaysToPrune(list, 0)).toEqual(['d', 'c', 'a']);
  });
});
