import { describe, expect, it } from 'vitest';
import { wellFormed } from '../src/net/check';
import type { PartyState } from '../src/net/protocol';

const party: PartyState = {
  code: 'B7KQX',
  host: 'u1',
  members: [
    { id: 'u1', name: 'Ana', part: 'lead', difficulty: 'hard', ready: true, have: ['s1'], connected: true, calibrated: false },
    {
      id: 'u2',
      name: 'Bo',
      part: 'drums',
      difficulty: 'easy',
      ready: false,
      have: [],
      connected: false,
      calibrated: true,
      eliminated: true,
    },
  ],
  set: [{ id: 's1', title: 'Song', artist: 'Band', duration: 180 }],
  phase: 'lobby',
  songIndex: -1,
  results: [{ songIndex: 0, lines: [{ id: 'u1', name: 'Ana', result: null, missing: 'left' }] }],
  mode: 'versus',
  showdown: null,
  private: false,
};

describe('what a server sends', () => {
  it('takes the messages the game knows', () => {
    expect(wellFormed({ type: 'party', party })).toBe(true);
    expect(wellFormed({ type: 'party', party: null })).toBe(true);
    expect(wellFormed({ type: 'welcome', you: { id: 'u1', name: 'Ana', role: 'player' }, server: 'S', protocol: 5 })).toBe(true);
    expect(wellFormed({ type: 'board', songIndex: 0, lines: [{ id: 'u1', score: 10, streak: 2, stars: 1 }] })).toBe(true);
    expect(wellFormed({ type: 'struck', songIndex: 0, target: null })).toBe(true);
  });

  it('leaves a party with no players list, or anything else out of shape, unread', () => {
    expect(wellFormed({ type: 'party', party: { ...party, members: null } })).toBe(false);
    expect(wellFormed({ type: 'party', party: { ...party, set: [{ id: 's1' }] } })).toBe(false);
    expect(wellFormed({ type: 'party', party: { ...party, phase: 'dancing' } })).toBe(false);
    expect(wellFormed({ type: 'board', songIndex: 0, lines: [{ id: 'u1', score: Infinity }] })).toBe(false);
    expect(wellFormed({ type: 'hit', songIndex: 0, from: 'Bo', at: 'soon', ms: 1 })).toBe(false);
    expect(wellFormed({ type: 'what' })).toBe(false);
    expect(wellFormed(null)).toBe(false);
    expect(wellFormed([])).toBe(false);
  });
});
