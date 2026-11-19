import { describe, expect, it } from 'vitest';
import type { Chart } from '../../src/chart/types.ts';
import { GameSession } from '../../src/game/GameSession.ts';
import { ReplayRecorder } from '../../src/game/replay.ts';
import type { ClientMessage, Part, ServerMessage, WireChart } from '../../src/net/protocol.ts';
import { Bands, type BandRun } from '../src/bands.ts';
import { Store } from '../src/db.ts';
import { Parties } from '../src/parties.ts';

const SONG = 'a'.repeat(64);
const chart = (part: Part): WireChart => ({
  part,
  difficulty: 'medium',
  lanes: 4,
  notes: Array.from({ length: 10 }, (_, i) => ({ t: 1 + i, lane: i % 4, dur: 0, phrase: -1 })),
  beats: [0, 0.5, 1],
  downbeats: [0],
  secondsPerBeat: 0.5,
  duration: 30,
});
const result = (score: number) => ({ score, stars: 1, accuracy: 1, bestStreak: 1, fullCombo: false });

/** A band party of players on `parts` (p0 hosts), on a clock the test moves; what the server hands the band boards. */
function band(parts: Part[]) {
  let now = 1000;
  const inbox = new Map<string, ServerMessage[]>();
  const handed: BandRun[] = [];
  const parties = new Parties(
    (to, msg) => inbox.set(to, [...(inbox.get(to) ?? []), structuredClone(msg)]),
    () => now,
    () => [],
    (run) => handed.push(run),
  );
  const players = parts.map((_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
  const say = (i: number, m: ClientMessage) => parties.handle(players[i], m);
  say(0, { type: 'party-create' });
  const code = parties.stateOf('p0')!.code;
  for (let i = 1; i < players.length; i++) say(i, { type: 'party-join', code });
  say(0, { type: 'band', on: true });
  say(0, { type: 'set', songs: [{ id: SONG, title: 'One', artist: '', duration: 30 }] });
  parts.forEach((part, i) => say(i, { type: 'ready', part, difficulty: 'medium', ready: true, have: [SONG] }));
  const charts = parts.map(chart);
  const start = () => say(0, { type: 'start', songIndex: 0, charts, assign: Object.fromEntries(players.map((p, i) => [p.id, i])) });
  const last = <K extends ServerMessage['type']>(who: number, type: K) =>
    (inbox.get(`p${who}`) ?? []).filter((m): m is Extract<ServerMessage, { type: K }> => m.type === type).at(-1);
  return { parties, say, start, last, handed, advance: (ms: number) => ((now += ms), parties.tick()), state: () => parties.stateOf('p0')! };
}

describe('band mode', () => {
  it('plays one player per part, up to four', () => {
    const same = band(['lead', 'lead']);
    same.start();
    expect(same.last(0, 'error')?.message).toMatch(/same part/);
    expect(same.state().phase).toBe('lobby');
    const five = band(['lead', 'bass', 'drums', 'vocals', 'lead']);
    five.start();
    expect(five.last(0, 'error')?.message).toMatch(/4 players at most/);
  });

  it('adds everyone up to one band score, with stars against the pars added up', () => {
    const { say, start, state, handed } = band(['lead', 'bass']);
    start();
    say(0, { type: 'finish', songIndex: 0, result: result(400) });
    say(1, { type: 'finish', songIndex: 0, result: result(300) });
    const r = state().results[0];
    expect(r.band).toEqual({ score: 700, stars: expect.any(Number) });
    expect(r.band!.stars).toBeGreaterThan(0);
    expect(handed[0]).toMatchObject({ songId: SONG, score: 700 });
    expect(handed[0].players.map((p) => p.chart.part)).toEqual(['lead', 'bass']);
  });

  it('makes band overdrive when two start overdrive in one bar, once, for the shorter of the two', () => {
    const { say, start, last, advance } = band(['lead', 'bass', 'drums']);
    start();
    advance(6000);
    say(0, { type: 'overdrive', songIndex: 0, bar: 4, seconds: 6 });
    expect(last(2, 'band-overdrive')).toBeUndefined();
    say(1, { type: 'overdrive', songIndex: 0, bar: 5, seconds: 6 });
    expect(last(2, 'band-overdrive')).toBeUndefined();
    say(2, { type: 'overdrive', songIndex: 0, bar: 5, seconds: 4 });
    expect(last(0, 'band-overdrive')).toMatchObject({ ms: 4000, at: 7000 });
    // A third in the same bar makes no second one.
    say(0, { type: 'overdrive', songIndex: 0, bar: 5, seconds: 8 });
    expect((last(0, 'band-overdrive') as { ms: number }).ms).toBe(4000);
  });

  it('brings a dropped-out player back when a bandmate completes a phrase', () => {
    const { say, start, last, advance } = band(['lead', 'bass']);
    start();
    advance(6000);
    say(1, { type: 'dropped', songIndex: 0, out: true });
    advance(200);
    expect(last(0, 'board')!.lines.find((l) => l.id === 'p1')).toMatchObject({ dropped: true });
    // A dropped-out player cannot bring anyone back.
    say(1, { type: 'revive', songIndex: 0 });
    expect(last(1, 'revive')).toBeUndefined();
    say(0, { type: 'revive', songIndex: 0 });
    expect(last(1, 'revive')).toMatchObject({ by: 'Player 0' });
    advance(200);
    expect(last(0, 'board')!.lines.find((l) => l.id === 'p1')!.dropped).toBe(false);
  });
});

describe('band boards', () => {
  /** A run that hits the chart's first `hits` notes, as the game records it. */
  const run = (c: WireChart, hits: number) => {
    const rec = new ReplayRecorder(new GameSession(c as Chart));
    for (const n of c.notes.slice(0, hits)) {
      rec.press(n.lane, n.t);
      rec.release(n.lane, n.t + 0.05);
    }
    rec.end();
    const inputs = rec.take();
    const bytes = Buffer.alloc(inputs.times.length * 4);
    inputs.times.forEach((t, i) => bytes.writeFloatLE(t, i * 4));
    return {
      score: rec.session.results().score,
      run: { ops: Buffer.from(inputs.ops).toString('base64'), times: bytes.toString('base64') },
    };
  };

  it('take a band only when every run gives its score, one board per line-up', () => {
    const store = new Store(':memory:');
    const add = (name: string) =>
      store.db
        .prepare('INSERT INTO users (id, name, name_key, hash, role, created) VALUES (?, ?, ?, ?, ?, ?)')
        .run(name, name, name, 'x', 'player', 0);
    const bands = new Bands(store);
    add('ana');
    add('bo');
    const lead = chart('lead');
    const bass = chart('bass');
    const a = run(lead, 10);
    const b = run(bass, 6);
    const entry = (bScore: number): BandRun => ({
      songId: SONG,
      score: a.score + bScore,
      stars: 3,
      players: [
        { id: 'ana', chart: lead, result: result(a.score), run: a.run },
        { id: 'bo', chart: bass, result: result(bScore), run: b.run },
      ],
    });
    // One point more than bo's run gives: refused.
    expect(bands.record(entry(b.score + 1))).toBe(false);
    expect(bands.record(entry(b.score))).toBe(true);
    const board = bands.board(SONG);
    expect(board.lineups).toHaveLength(1);
    expect(board.lineups[0].parts.map((p) => p.part).sort()).toEqual(['bass', 'lead']);
    expect(board.lineups[0].lines[0]).toMatchObject({ score: a.score + b.score });
    expect(board.lineups[0].lines[0].players.map((p) => p.name).sort()).toEqual(['ana', 'bo']);
    store.close();
  });
});
