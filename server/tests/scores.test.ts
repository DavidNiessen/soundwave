import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Chart } from '../../src/chart/types';
import { GameSession } from '../../src/game/GameSession';
import { ReplayRecorder, type ReplayInputs } from '../../src/game/replay';
import type { Board, Challenge, Run, Session, Weekly } from '../../src/net/protocol.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { chartIdOf } from '../src/scores.ts';

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
const signUp = async (name: string, extra = {}) =>
  (await api<Session>('POST', '/auth/signup', { name, password: 'correct horse', ...extra })).body;

beforeAll(async () => {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:' }, store, () => {});
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

    // Beat my run: Owner sends theirs to Ana, who answers it.
    const ch = await api<{ id: string }>('POST', '/challenges', { to: 'ana', scoreId: own.body.id }, owner.access);
    expect(ch.status).toBe(200);
    const answer = play(7);
    await api('POST', '/scores', submission(answer.inputs, answer.results, { challenge: ch.body.id }), ana.access);
    const sent = await api<{ sent: Challenge[] }>('GET', '/me/challenges', undefined, owner.access);
    expect(sent.body.sent[0]).toMatchObject({ to: 'Ana', score: better.results.score, answer: answer.results.score });

    // The weekly challenge adds up each player's best on its songs.
    expect((await api('POST', '/weekly', { songs: [{ id: SONG, title: 'Test song' }] }, ana.access)).status).toBe(403);
    const weekly = await api<Weekly>('POST', '/weekly', { songs: [{ id: SONG, title: 'Test song' }], days: 7 }, owner.access);
    // Only runs played while it runs count.
    expect(weekly.body.standings).toEqual([]);
    const again = await api<{ id: string }>('POST', '/scores', submission(better.inputs, better.results), owner.access);
    const standings = await api<Weekly>('GET', '/weekly', undefined, ana.access);
    expect(standings.body.standings[0]).toMatchObject({ name: 'Owner', score: better.results.score, songs: 1 });

    // A moderator removes a cheated run everywhere.
    for (const id of [own.body.id, again.body.id])
      expect((await api('DELETE', `/scores/${id}?reason=test`, undefined, owner.access)).status).toBe(200);
    const after = await api<Board>('GET', `/boards/${SONG}/${chartId}/lead/hard`, undefined, ana.access);
    expect(after.body.lines.map((l) => l.name)).toEqual(['Ana']);
  });
});
