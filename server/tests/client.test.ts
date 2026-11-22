/**
 * The game's own connection (src/net/client.ts) against a real server: joining with the game's
 * identity (src/net/identity.ts, WebCrypto as in a browser), the socket, the clock, a party and a
 * song started together, signing out and in, and a recovery link on a new installation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WireChart } from '../../src/net/protocol.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS } from '../src/config.ts';
import { Store } from '../src/db.ts';

// What the client needs of a browser: a window for its timers, and storage.
const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
});
const { joinSecret, online, parseInvite, parseJoinSecret, parseRecovery, partyId, serverAddress } = await import('../../src/net/client.ts');
const { forgetLoadedIdentity } = await import('../../src/net/identity.ts');

const SONG = 'c'.repeat(64);
const chart: WireChart = {
  part: 'drums',
  difficulty: 'easy',
  lanes: 4,
  notes: [{ t: 1, lane: 1, dur: 0, phrase: -1 }],
  beats: [0, 0.5],
  downbeats: [0],
  secondsPerBeat: 0.5,
  duration: 20,
};

let server: RunningServer;
let store: Store;

/** Waits until the client's state passes `test`. */
const until = (test: (s: ReturnType<typeof online.snapshot>) => boolean) =>
  new Promise<void>((resolve, reject) => {
    if (test(online.snapshot())) return resolve();
    const timer = setTimeout(() => (stop(), reject(new Error(`state never came: ${JSON.stringify(online.snapshot())}`))), 4000);
    const stop = online.subscribe(() => {
      if (!test(online.snapshot())) return;
      clearTimeout(timer);
      stop();
      resolve();
    });
  });

beforeAll(async () => {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:' }, store, () => {});
});
afterAll(async () => {
  online.forget();
  await server.close();
  store.close();
});

describe('server addresses', () => {
  it('take HTTPS by default, and plain HTTP only on this machine or network', () => {
    expect(serverAddress('play.example.com')).toBe('https://play.example.com');
    expect(serverAddress('localhost:7420')).toBe('http://localhost:7420');
    expect(serverAddress('192.168.1.20:7420/')).toBe('http://192.168.1.20:7420');
    expect(() => serverAddress('http://play.example.com')).toThrow(/HTTPS/);
    expect(() => serverAddress('')).toThrow(/address/);
  });

  it('read an invite from its join page, a soundwave:// link or the web game’s address', () => {
    const want = { server: 'https://play.example.com', invite: 'AbC123' };
    expect(parseInvite('https://play.example.com/join?invite=AbC123')).toEqual(want);
    expect(parseInvite('  https://play.example.com/join/?invite=AbC123 ')).toEqual(want);
    expect(parseInvite('soundwave://join?server=https%3A%2F%2Fplay.example.com&invite=AbC123')).toEqual(want);
    expect(parseInvite('https://soundwave.niessen.dev/?server=https%3A%2F%2Fplay.example.com&invite=AbC123')).toEqual(want);
    // A plain address, or a link to a server outside the network over plain HTTP, is no invite.
    expect(parseInvite('play.example.com')).toBeNull();
    expect(parseInvite('http://play.example.com/join?invite=AbC123')).toBeNull();
    // A recovery link comes in the same shapes, and is no invite.
    const recovery = { server: 'https://play.example.com', code: 'XyZ789' };
    expect(parseRecovery('https://play.example.com/join?recover=XyZ789')).toEqual(recovery);
    expect(parseRecovery('soundwave://join?server=https%3A%2F%2Fplay.example.com&recover=XyZ789')).toEqual(recovery);
    expect(parseInvite('https://play.example.com/join?recover=XyZ789')).toBeNull();
  });

  it('carry a party on Discord as its code and server, and read nothing else as one', () => {
    const secret = joinSecret('https://play.example.com', 'B7KQX');
    expect(secret.length).toBeLessThanOrEqual(128);
    expect(parseJoinSecret(secret)).toEqual({ server: 'https://play.example.com', code: 'B7KQX' });
    expect(parseJoinSecret('B7KQX http://play.example.com')).toBeNull();
    expect(parseJoinSecret('not a party')).toBeNull();
    expect(parseJoinSecret('B7KQX')).toBeNull();
    expect(parseJoinSecret('B7K Q https://play.example.com')).toBeNull();
    // Discord refuses a party whose id is its join secret; the id names the party on its server.
    const id = partyId('https://play.example.com', 'B7KQX');
    expect(id).not.toBe(secret);
    expect(id).toMatch(/^B7KQX-[0-9a-z]+$/);
    expect(partyId('https://other.example.com', 'B7KQX')).not.toBe(id);
  });
});

describe('the game’s connection', () => {
  it('joins with its identity, joins the socket, syncs its clock and plays a song with a party', async () => {
    const info = await online.choose(server.url);
    expect(info.mode).toBe('public');
    // A new installation has no account here yet.
    expect(await online.signInWithIdentity()).toBe(false);
    await online.join({ name: 'Player One' });
    await until((s) => s.status === 'online');
    expect(online.snapshot().account?.name).toBe('Player One');
    // The sign-in is kept, apart from the settings, and so is the identity, apart from both.
    expect(JSON.parse(storage.get('soundwave.online')!)).toMatchObject({ server: server.url });
    expect(JSON.parse(storage.get('soundwave.identity')!)).toMatchObject({ v: 1, name: 'Player One', backedUp: false });
    expect(store.userByName('Player One')!.pubkey).toMatch(/^[A-Za-z0-9_-]{43}$/);

    online.createParty();
    await until((s) => !!s.party);
    online.setMode('versus');
    online.setSet([{ id: SONG, title: 'Song', artist: 'Band', duration: 20 }]);
    await until((s) => s.party?.set.length === 1);
    online.ready('drums', 'easy', true, [SONG]);
    await until((s) => !!s.party?.members[0].ready);

    const started = new Promise<{ at: number; chart: WireChart | null }>((resolve) => {
      const stop = online.onStart((st) => (stop(), resolve(st)));
    });
    const me = online.snapshot().account!.id;
    online.start(0, [chart], { [me]: 0 });
    const st = await started;
    expect(st.chart?.part).toBe('drums');
    // The start is a few seconds ahead on this machine's own clock (the clocks are the same here).
    const ahead = st.at - performance.now();
    expect(ahead).toBeGreaterThan(3000);
    expect(ahead).toBeLessThan(5500);

    online.progress(0, 420, 12, 1);
    await new Promise<void>((resolve) => {
      const stop = online.subscribeBoard(() => {
        if (online.board()?.lines[0]?.score !== 420) return;
        stop();
        resolve();
      });
    });
    online.finish(0, { score: 900, stars: 2, accuracy: 0.8, bestStreak: 12, fullCombo: false });
    await until((s) => s.party?.phase === 'results');
    expect(online.snapshot().party!.results[0].lines[0]).toMatchObject({ name: 'Player One', result: { score: 900 } });
  });

  it('signs out, stays out, and signs in again with its identity', async () => {
    online.signOut();
    expect(online.snapshot().status).toBe('signed-out');
    expect(JSON.parse(storage.get('soundwave.online')!)).toMatchObject({ out: true });
    // The game starting again does not sign the player straight back in.
    online.resume();
    expect(online.snapshot().status).toBe('signed-out');
    expect(await online.signInWithIdentity()).toBe(true);
    await until((s) => s.status === 'online');
    expect(online.snapshot().account?.name).toBe('Player One');
    expect(JSON.parse(storage.get('soundwave.online')!).out).toBeUndefined();
    // The party waited for its host to come back.
    await until((s) => s.party?.phase === 'results');
  });

  it('gets its account back on a new installation with a recovery link', async () => {
    const before = store.userByName('Player One')!.pubkey;
    online.signOut();
    // A new installation: no identity, and none of the old one's accounts.
    storage.delete('soundwave.identity');
    forgetLoadedIdentity();
    expect(await online.signInWithIdentity()).toBe(false);
    const { code } = server.accounts.makeRecovery(null, 'Player One');
    await online.recover(server.url, code);
    await until((s) => s.status === 'online');
    expect(online.snapshot().account?.name).toBe('Player One');
    expect(store.userByName('Player One')!.pubkey).not.toBe(before);
    // The new identity signs in from now on, and the link is spent.
    online.signOut();
    expect(await online.signInWithIdentity()).toBe(true);
    await expect(online.recover(server.url, code)).rejects.toThrow(/run out or was used/);
  });
});
