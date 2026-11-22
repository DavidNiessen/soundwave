import { describe, expect, it } from 'vitest';
import type { ClientMessage, ServerMessage, SetSong } from '../../src/net/protocol.ts';
import { Parties } from '../src/parties.ts';

const song = (n: number): SetSong => ({ id: String(n).repeat(64).slice(0, 64), title: `Song ${n}`, artist: '', duration: 30 });

/** A Versus party of `n` players (p0 hosts). */
function versus(n: number) {
  const errors: string[] = [];
  const parties = new Parties(
    (_to, msg: ServerMessage) => msg.type === 'error' && errors.push(msg.message),
    () => 1000,
  );
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Player ${i}` }));
  const say = (i: number, m: ClientMessage) => parties.handle(players[i], m);
  say(0, { type: 'party-create' });
  const code = parties.stateOf('p0')!.code;
  for (let i = 1; i < n; i++) say(i, { type: 'party-join', code });
  say(0, { type: 'mode', mode: 'versus' });
  return { say, errors, players, code, parties, titles: () => parties.stateOf('p0')!.set.map((s) => s.title) };
}

describe('Versus with everyone picking', () => {
  it('takes two songs from each of two players, in turn, the host first', () => {
    const p = versus(2);
    p.say(1, { type: 'picks', songs: [song(3)] });
    expect(p.errors.at(-1)).toContain('host picks the set');
    p.say(0, { type: 'everyone-picks', on: true });
    p.say(1, { type: 'picks', songs: [song(3), song(4), song(5)] });
    p.say(0, { type: 'picks', songs: [song(1), song(2)] });
    expect(p.titles()).toEqual(['Song 1', 'Song 3', 'Song 2', 'Song 4']);
    // The host cannot pick the whole set meanwhile.
    p.say(0, { type: 'set', songs: [song(9)] });
    expect(p.errors.at(-1)).toContain('Everyone picks');
  });

  it('takes one song each from three players or more, a song picked twice once, and drops a leaver’s', () => {
    const p = versus(3);
    p.say(0, { type: 'everyone-picks', on: true });
    p.say(0, { type: 'picks', songs: [song(1), song(2)] });
    p.say(1, { type: 'picks', songs: [song(1)] });
    p.say(2, { type: 'picks', songs: [song(3)] });
    expect(p.titles()).toEqual(['Song 1', 'Song 3']);
    p.say(2, { type: 'party-leave' });
    // Two players again: two each.
    expect(p.titles()).toEqual(['Song 1', 'Song 2']);
  });
});
