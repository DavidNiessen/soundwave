import { describe, expect, it } from 'vitest';
import {
  HIT_PROTECTION_MS,
  HIT_WARNING_MS,
  type ClientMessage,
  type ServerMessage,
  type SetSong,
  type ShowdownOptions,
  type WireChart,
} from '../../src/net/protocol.ts';
import { hitLength, Parties, survivors } from '../src/parties.ts';

const SONG = 'a'.repeat(64);
const SONG2 = 'b'.repeat(64);
const SET: SetSong[] = [
  { id: SONG, title: 'One', artist: '', duration: 30 },
  { id: SONG2, title: 'Two', artist: '', duration: 30 },
];
/**
 * Ten notes: a flawless run (the par) is worth 550 points, the tenth note at ×2. A share is score / 550.
 * Each note is a phrase of its own, all over by 3 s, so the meter is full early on for Strikes.
 */
const chart: WireChart = {
  part: 'lead',
  difficulty: 'medium',
  lanes: 4,
  notes: Array.from({ length: 10 }, (_, i) => ({ t: 0.2 + i * 0.3, lane: 0, dur: 0, phrase: i })),
  beats: [0, 0.5, 1],
  downbeats: [0],
  secondsPerBeat: 0.5,
  duration: 30,
};
const PAR = 550;
const result = (score: number) => ({ score, stars: 1, accuracy: 1, bestStreak: 1, fullCombo: false });

/** A Showdown of `n` players (p0 hosts) on a clock the test moves, every player in the first song. */
function showdown(n: number, options: ShowdownOptions = { hits: true, part: null, rotation: false }, rotation: SetSong[] = []) {
  let now = 1000;
  const inbox = new Map<string, ServerMessage[]>();
  const parties = new Parties(
    (to, msg) => inbox.set(to, [...(inbox.get(to) ?? []), structuredClone(msg)]),
    () => now,
    () => rotation,
  );
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
  const say = (i: number, m: ClientMessage) => parties.handle(players[i], m);
  say(0, { type: 'party-create' });
  const code = parties.stateOf('p0')!.code;
  for (let i = 1; i < n; i++) say(i, { type: 'party-join', code });
  say(0, { type: 'mode', mode: 'showdown' });
  say(0, { type: 'showdown', options });
  if (!options.rotation) say(0, { type: 'set', songs: SET });
  players.forEach((_, i) => say(i, { type: 'ready', part: 'lead', difficulty: 'medium', ready: true, have: [SONG, SONG2] }));
  const assign = Object.fromEntries(players.map((p) => [p.id, 0]));
  const start = (songIndex: number) => say(0, { type: 'start', songIndex, charts: [chart], assign });
  const last = <K extends ServerMessage['type']>(who: number, type: K) =>
    (inbox.get(`p${who}`) ?? []).filter((m): m is Extract<ServerMessage, { type: K }> => m.type === type).at(-1);
  const progress = (i: number, score: number) =>
    say(i, { type: 'progress', songIndex: parties.stateOf('p0')!.songIndex, score, streak: 0, stars: 0 });
  return {
    parties,
    say,
    start,
    last,
    progress,
    advance: (ms: number) => ((now += ms), parties.tick()),
    state: () => parties.stateOf('p0')!,
  };
}

describe('Showdown', () => {
  it('cuts the field evenly to a final of four, and the last song leaves one', () => {
    expect([0, 1, 2, 3].map((i) => survivors(16, i, 4))).toEqual([12, 8, 4, 1]);
    expect([0, 1, 2].map((i) => survivors(2, i, 3))).toEqual([2, 2, 1]);
    expect([0, 1].map((i) => survivors(6, i, 2))).toEqual([4, 1]);
    expect(survivors(5, 0, 1)).toBe(1);
  });

  it('tells the party how many go through after each song, for the cut line', () => {
    const { start, state } = showdown(6);
    start(0);
    expect(state().cut).toBe(survivors(6, 0, 2));
  });

  it('makes a hit 6 s for a quarter meter and 14 s for a full one, half as long when repeated', () => {
    expect(hitLength(0.25, false)).toBe(6000);
    expect(hitLength(1, false)).toBe(14000);
    expect(hitLength(0.625, false)).toBe(10000);
    expect(hitLength(1, true)).toBe(7000);
  });

  it('ranks by score and knocks out the lowest after a song', () => {
    const { say, start, state } = showdown(6);
    start(0);
    // Shares 1.0, 0.9, … 0.5: the two lowest go out (6 → 4).
    for (let i = 0; i < 6; i++) say(i, { type: 'finish', songIndex: 0, result: result(Math.round(PAR * (1 - i / 10))) });
    const s = state();
    expect(s.phase).toBe('results');
    expect(s.results[0].lines.map((l) => [l.id, l.share, !!l.eliminated])).toEqual([
      ['p0', 1, false],
      ['p1', 0.9, false],
      ['p2', 0.8, false],
      ['p3', 0.7, false],
      ['p4', 0.6, true],
      ['p5', 0.5, true],
    ]);
    expect(s.members.filter((m) => m.eliminated).map((m) => m.id)).toEqual(['p4', 'p5']);
    // The next song is played by the four left; the others watch.
    start(1);
    expect(state().phase).toBe('playing');
  });

  it('counts a missing result as the player’s last score, and keeps players level at the cut', () => {
    const { say, start, progress, advance, state } = showdown(6);
    start(0);
    advance(6000);
    progress(5, 539);
    for (let i = 0; i < 5; i++) say(i, { type: 'finish', songIndex: 0, result: result(Math.round(i < 4 ? PAR * 0.9 : PAR * 0.2)) });
    advance(120_000);
    const lines = state().results[0].lines;
    expect(lines.find((l) => l.id === 'p5')).toMatchObject({ result: null, share: 539 / PAR });
    expect(lines.find((l) => l.id === 'p5')!.eliminated).toBeFalsy();
    // Five level at 0.9 and above the cut of four: all stay, only the lowest goes.
    expect(lines.filter((l) => l.eliminated).map((l) => l.id)).toEqual(['p4']);
  });

  it('strikes the player just above, warns them half a second ahead with the striker’s name', () => {
    const { say, start, progress, advance, last } = showdown(3);
    start(0);
    advance(6000);
    progress(0, 300);
    progress(1, 200);
    progress(2, 100);
    say(2, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(2, 'struck')).toMatchObject({ target: 'p1' });
    const hit = last(1, 'hit')!;
    expect(hit).toMatchObject({ from: 'Player 2', ms: 14000 });
    expect(hit.at).toBe(7000 + HIT_WARNING_MS);
    // Everyone sees the Strike fly, the players it is not about too.
    for (const i of [0, 1, 2]) expect(last(i, 'strikeFired')).toMatchObject({ from: 'p2', to: 'p1', at: hit.at });
    // First place has nobody above: their press stays an overdrive.
    say(0, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(0, 'struck')).toMatchObject({ target: null });
    // The board shows who aims at whom, and who is under a hit.
    advance(600);
    const board = last(0, 'board')!.lines;
    expect(board.find((l) => l.id === 'p1')).toMatchObject({ hit: true, aim: 'p0' });
  });

  it('hits one at a time, protects for 6 s after, and halves a repeat within 30 s', () => {
    const { say, start, progress, advance, last } = showdown(3);
    start(0);
    advance(6000);
    progress(0, 300);
    progress(1, 200);
    progress(2, 100);
    say(2, { type: 'strike', songIndex: 0, charge: 0.25 });
    expect(last(1, 'hit')).toMatchObject({ ms: 6000 });
    // A Strike spends the meter: another one at once is refused.
    say(2, { type: 'strike', songIndex: 0, charge: 0.25 });
    expect(last(2, 'struck')).toMatchObject({ target: null });
    // p1 is still under the hit: p2's next Strike goes on up, to p0.
    advance(2000);
    say(2, { type: 'strike', songIndex: 0, charge: 0.25 });
    expect(last(2, 'struck')).toMatchObject({ target: 'p0' });
    // Both are under a hit or protected: nobody can be hit, the charge is not spent.
    advance(HIT_WARNING_MS + 6000 + HIT_PROTECTION_MS - 2100);
    say(2, { type: 'strike', songIndex: 0, charge: 0.25 });
    expect(last(2, 'struck')).toMatchObject({ target: null });
    // Protection over, still within 30 s of the first hit: half as long.
    advance(200);
    say(2, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(2, 'struck')).toMatchObject({ target: 'p1' });
    expect(last(1, 'hit')).toMatchObject({ ms: 7000 });
  });

  it('lets at most two players aim at the same player', () => {
    const { say, start, progress, advance, last } = showdown(5);
    start(0);
    advance(6000);
    [500, 400, 300, 200, 100].forEach((score, i) => progress(i, score));
    // p1 and p2 are under hits: p3 and p4 would both look past them…
    say(2, { type: 'strike', songIndex: 0, charge: 0.25 }); // p2 hits p1
    say(3, { type: 'strike', songIndex: 0, charge: 0.25 }); // p3 hits p2
    advance(100);
    const aims = new Map(last(0, 'board')!.lines.map((l) => [l.id, l.aim]));
    // p1 and p2 cannot be hit: p1 and p2 aim at p0, which makes two, so p3 has nobody left to aim
    // at; p4 aims at p3, its nearest open player.
    expect(aims.get('p1')).toBe('p0');
    expect(aims.get('p2')).toBe('p0');
    expect(aims.get('p3')).toBeUndefined();
    expect(aims.get('p4')).toBe('p3');
    // With p3 under a hit as well, p4 would be a third attacker on p0: nobody is left for it either.
    say(4, { type: 'strike', songIndex: 0, charge: 0.25 }); // p4 hits p3
    advance(100);
    const after = new Map(last(0, 'board')!.lines.map((l) => [l.id, l.aim]));
    expect(after.get('p4')).toBeUndefined();
  });

  it('strikes nobody with hits off, and only lets watching players cheer', () => {
    const { say, start, progress, advance, last } = showdown(2, { hits: false, part: null, rotation: false });
    start(0);
    advance(6000);
    progress(0, 300);
    say(1, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(1, 'struck')).toMatchObject({ target: null });
    say(1, { type: 'cheer' });
    expect(last(0, 'cheer')).toBeUndefined();
  });

  it('plays the server’s rotation when the host chooses it, and every player on one part', () => {
    const none = showdown(2, { hits: true, part: null, rotation: true });
    expect(none.last(0, 'error')?.message).toMatch(/no Showdown rotation/);
    const { state, say, last } = showdown(2, { hits: true, part: 'drums', rotation: true }, SET);
    expect(state().set.map((s) => s.id)).toEqual([SONG, SONG2]);
    expect(state().members.every((m) => m.part === 'drums')).toBe(true);
    say(0, { type: 'set', songs: [SET[0]] });
    expect(last(0, 'error')?.message).toMatch(/rotation/);
  });

  it('takes a player who drops mid-song back into the song, and tells one who comes back too late where the party is', () => {
    const { parties, say, start, last, advance, state } = showdown(3);
    start(0);
    // p1 drops and comes back while the song plays: the party is still in that song, and their score counts.
    parties.disconnected('p1');
    advance(5000);
    parties.reconnected('p1');
    expect(last(1, 'party')?.party).toMatchObject({ phase: 'playing', songIndex: 0 });
    say(0, { type: 'finish', songIndex: 0, result: result(500) });
    say(1, { type: 'finish', songIndex: 0, result: result(400) });
    say(2, { type: 'finish', songIndex: 0, result: result(300) });
    expect(state().phase).toBe('results');
    expect(state().results[0].lines.find((l) => l.id === 'p1')?.result?.score).toBe(400);

    // In the next song p2 drops, and the song ends without them: back, they are told it is over.
    start(1);
    parties.disconnected('p2');
    say(0, { type: 'finish', songIndex: 1, result: result(500) });
    say(1, { type: 'finish', songIndex: 1, result: result(400) });
    expect(state().phase).toBe('playing');
    advance(60_000 * 10);
    parties.reconnected('p2');
    const back = last(2, 'party')?.party;
    // Either still in the party at its results, or out of it after the grace: never in the song.
    expect(back === null || back?.phase !== 'playing').toBe(true);
  });

  it('keeps a knocked-out player out when they leave and come back, and lets a newcomer only watch', () => {
    const { parties, say, start, last, state } = showdown(6);
    start(0);
    for (let i = 0; i < 6; i++) say(i, { type: 'finish', songIndex: 0, result: result(Math.round(PAR * (1 - i / 10))) });
    expect(state().members.find((m) => m.id === 'p5')?.eliminated).toBe(true);
    const code = state().code;
    say(5, { type: 'party-leave' });
    say(5, { type: 'party-join', code });
    const late = { id: 'late', name: 'Late' };
    parties.handle(late, { type: 'party-join', code });
    for (const who of ['p5', 'late']) expect(state().members.find((m) => m.id === who)?.eliminated).toBe(true);
    // Neither is given a chart for the next song, whatever the host's game assigns.
    say(5, { type: 'ready', part: 'lead', difficulty: 'medium', ready: true, have: [SONG, SONG2] });
    parties.handle(late, { type: 'ready', part: 'lead', difficulty: 'medium', ready: true, have: [SONG, SONG2] });
    say(0, { type: 'start', songIndex: 1, charts: [chart], assign: { p0: 0, p1: 0, p2: 0, p3: 0, p5: 0, late: 0 } });
    expect(last(5, 'start')?.chart).toBeNull();
    expect(state().members.filter((m) => !m.eliminated)).toHaveLength(4);
  });

  it('does not let a player the host removed back in', () => {
    const { say, last, state } = showdown(3);
    const code = state().code;
    say(0, { type: 'kick', id: 'p2' });
    expect(state().members.map((m) => m.id)).toEqual(['p0', 'p1']);
    say(2, { type: 'party-join', code });
    expect(last(2, 'error')?.message).toMatch(/removed you/);
    expect(state().members.map((m) => m.id)).toEqual(['p0', 'p1']);
  });

  it('holds Strikes to the charge the chart’s phrases can have given, one every two seconds', () => {
    const { say, start, progress, advance, last } = showdown(3);
    start(0);
    // Before the song's first phrase ends there is no charge, whatever the game says.
    advance(4000);
    progress(0, 300);
    progress(1, 200);
    say(2, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(2, 'struck')).toMatchObject({ target: null });
    // A second in (and the server's second of slack): the phrases ended by 2 s gave 1.75 of meter.
    advance(2000);
    say(2, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(1, 'hit')).toMatchObject({ ms: 14000 });
    // Not again within two seconds, whatever the charge.
    advance(1000);
    say(2, { type: 'strike', songIndex: 0, charge: 0.25 });
    expect(last(2, 'struck')).toMatchObject({ target: null });
    // Every phrase ended: 2.5 in all, 1.5 left, a full meter's Strike…
    advance(30_000);
    progress(0, 400);
    progress(1, 300);
    say(2, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(1, 'hit')).toMatchObject({ ms: 14000 });
    // …and then only half a meter's, however full the game says it is.
    advance(21_000);
    say(2, { type: 'strike', songIndex: 0, charge: 1 });
    expect(last(2, 'struck')).toMatchObject({ target: 'p1' });
    expect(last(1, 'hit')).toMatchObject({ ms: hitLength(0.5, true) });
  });
});
