import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Chart } from '../../src/chart/types';
import { GameSession } from '../../src/game/GameSession';
import { OP, ReplayRecorder, replayResults, type ReplayInputs } from '../../src/game/replay';
import type { Board, Run, Session } from '../../src/net/protocol.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { chartIdOf } from '../src/scores.ts';
import { players } from './identity.ts';

const SONG = 'd'.repeat(64);
const chart: Chart = {
  part: 'lead',
  difficulty: 'hard',
  lanes: 4,
  notes: Array.from({ length: 40 }, (_, i) => ({ t: 1 + i * 0.4, lane: i % 4, dur: i % 10 === 0 ? 0.3 : 0, phrase: i < 8 ? 0 : -1 })),
  beats: Array.from({ length: 40 }, (_, i) => i * 0.5),
  downbeats: [0, 4, 8],
  secondsPerBeat: 0.5,
  duration: 20,
};

/** A run: most notes hit a little off, a few missed, at 60 frames a second. */
function play(miss = 5) {
  const rec = new ReplayRecorder(new GameSession(chart));
  chart.notes.forEach((n, i) => {
    if (i % miss === 0) return;
    rec.update(n.t - 0.01);
    rec.press(n.lane, n.t + ((i % 3) - 1) * 0.02);
    rec.release(n.lane, n.t + n.dur + 0.03);
  });
  rec.end();
  const inputs = rec.take();
  return { inputs, results: rec.session.results() };
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const timesB64 = (t: Float32Array) => {
  const buf = Buffer.alloc(t.length * 4);
  t.forEach((x, i) => buf.writeFloatLE(x, i * 4));
  return buf.toString('base64');
};
const submission = (inputs: ReplayInputs, result: object, extra: object = {}) => ({
  songId: SONG,
  title: 'Test song',
  artist: 'Band',
  chart,
  ops: b64(inputs.ops),
  times: timesB64(inputs.times),
  result,
  ...extra,
});

let server: RunningServer;
let store: Store;
const api = async <T>(method: string, path: string, body?: unknown, token?: string) => {
  const res = await fetch(server.url + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};
let signUp: (name: string, extra?: Record<string, unknown>) => Promise<Session>;

beforeAll(async () => {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:' }, store, () => {});
  signUp = players(server.url).signUp;
});
afterAll(async () => {
  await server.close();
  store.close();
});

describe('leaderboards', () => {
  it('take a score only when its run, judged again, gives exactly it', async () => {
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const ana = await signUp('Ana');
    const run = play();
    const ok = await api<{ id: string; rank: number; best: boolean }>('POST', '/scores', submission(run.inputs, run.results), ana.access);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ rank: 1, best: true });

    // One point more than the run earned is refused.
    const cheat = await api('POST', '/scores', submission(run.inputs, { ...run.results, score: run.results.score + 1 }), ana.access);
    expect(cheat.status).toBe(422);

    const better = play(1000);
    const own = await api<{ id: string }>('POST', '/scores', submission(better.inputs, better.results), owner.access);
    expect(own.status).toBe(200);

    const chartId = chartIdOf(chart);
    const board = await api<Board>('GET', `/boards/${SONG}/${chartId}/lead/hard`, undefined, ana.access);
    expect(board.body.lines.map((l) => l.name)).toEqual(['Owner', 'Ana']);
    expect(board.body.me).toMatchObject({ name: 'Ana', rank: 2 });

    // A run on the board can be watched, and gives the same result again.
    const watched = await api<Run>('GET', `/scores/${ok.body.id}/run`, undefined, owner.access);
    expect(watched.body.result.score).toBe(run.results.score);
    expect(watched.body.chart.notes).toHaveLength(40);

    // Shared to the server's list of replays.
    expect((await api('POST', `/scores/${ok.body.id}/share`, {}, ana.access)).status).toBe(200);
    expect((await api('POST', `/scores/${ok.body.id}/share`, {}, owner.access)).status).toBe(404);
    const shared = await api<{ name: string }[]>('GET', `/replays?song=${SONG}`, undefined, owner.access);
    expect(shared.body.map((r) => r.name)).toEqual(['Ana']);

    // A moderator removes a cheated run everywhere.
    expect((await api('DELETE', `/scores/${own.body.id}?reason=test`, undefined, owner.access)).status).toBe(200);
    const after = await api<Board>('GET', `/boards/${SONG}/${chartId}/lead/hard`, undefined, ana.access);
    expect(after.body.lines.map((l) => l.name)).toEqual(['Ana']);
  });

  it('refuse a chart no song can have, and inputs no game records', async () => {
    const mo = await signUp('Mo');
    const send = (c: object, ops: number[], times: number[]) => {
      const inputs = { ops: new Uint8Array(ops), times: new Float32Array(times) };
      const r = replayResults(c as Chart, inputs);
      return api('POST', '/scores', submission(inputs, r, { chart: c }), mo.access);
    };
    // One endless hold on a beat of a ten-thousandth of a second.
    const endless = { ...chart, notes: [{ t: 1, lane: 0, dur: 1e7, phrase: 0 }], secondsPerBeat: 1e-4, duration: 1e7 + 2 };
    expect((await send(endless, [OP.press, OP.update], [1, Infinity])).status).toBe(422);
    // A plausible chart, but far more points a second than a song can hold.
    const crammed = { ...chart, notes: Array.from({ length: 800 }, (_, i) => ({ t: 1, lane: i % 4, dur: 18, phrase: -1 })) };
    expect((await send(crammed, [OP.update], [Infinity])).status).toBe(422);

    // Winding back again and again over a held note, without the pause that drops it.
    const hold = { ...chart, notes: [{ t: 1, lane: 0, dur: 2, phrase: -1 }] };
    const ops: number[] = [OP.press];
    const times = [1];
    for (let i = 0; i < 100; i++) {
      ops.push(OP.release, OP.rewind);
      times.push(4.9, 1);
    }
    expect((await send(hold, [...ops, OP.release, OP.update], [...times, 3, Infinity])).status).toBe(422);
    // A pause's wind-back further than the game winds back.
    expect((await send(hold, [OP.press, OP.dropHolds, OP.rewind, OP.update], [1, 6, 1, Infinity])).status).toBe(422);
    // A frame (a finite update), which winds back in an old run's format.
    expect((await send(hold, [OP.press, OP.update, OP.release, OP.update], [1, 0.5, 3, Infinity])).status).toBe(422);
    // An input at no time, or at none in the song.
    expect((await send(hold, [OP.press, OP.overdrive, OP.update], [1, Number.NaN, Infinity])).status).toBe(422);
    expect((await send(hold, [OP.press, OP.release, OP.update], [1, 1e6, Infinity])).status).toBe(422);
    // A lane the chart does not have.
    expect((await send(hold, [OP.press | (6 << 3), OP.update], [1, Infinity])).status).toBe(422);
    // An input stamped well before the one ahead of it.
    expect((await send(hold, [OP.press, OP.release, OP.press, OP.update], [1, 3, 1.5, Infinity])).status).toBe(422);

    // A real pause is fine: the holds dropped, the song wound back a little.
    const rec = new ReplayRecorder(new GameSession(hold as Chart));
    rec.press(0, 1);
    rec.dropHolds(2);
    rec.rewind(0.5);
    rec.press(0, 2.1);
    rec.release(0, 3);
    rec.end();
    const paused = await api('POST', '/scores', submission(rec.take(), rec.session.results(), { chart: hold }), mo.access);
    expect(paused.status).toBe(200);
  });

  it('keep each player’s best few runs on a board, and count only shared charts in the week’s top', async () => {
    const own = { ...chart, difficulty: 'easy' as const };
    const solo = { ...chart, difficulty: 'medium' as const, notes: chart.notes.map((n) => ({ ...n, t: n.t + 0.1 })) };
    const [kim, lu] = [await signUp('Kim'), await signUp('Lu')];
    const submit = (c: Chart, miss: number, token: string) => {
      const rec = new ReplayRecorder(new GameSession(c));
      c.notes.forEach((n, i) => i % miss && (rec.press(n.lane, n.t), rec.release(n.lane, n.t + n.dur + 0.03)));
      rec.end();
      return api('POST', '/scores', submission(rec.take(), rec.session.results(), { chart: c }), token);
    };
    for (let i = 0; i < 8; i++) expect((await submit(own, 2 + i, kim.access)).status).toBe(200);
    const kept = store.db.prepare("SELECT COUNT(*) AS n FROM scores WHERE difficulty = 'easy'").get() as { n: number };
    expect(kept.n).toBe(5);
    // A chart only Lu played counts for nothing in the top; once Kim plays it too, it counts.
    expect((await submit(solo, 1000, lu.access)).status).toBe(200);
    const top = async () => (await api<{ name: string }[]>('GET', '/boards/top', undefined, lu.access)).body.map((t) => t.name);
    expect(await top()).not.toContain('Lu');
    expect((await submit(solo, 3, kim.access)).status).toBe(200);
    expect(await top()).toEqual(expect.arrayContaining(['Lu', 'Kim']));
  });
});
