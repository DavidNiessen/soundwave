/**
 * Rate limits, and what they are keyed by: nothing a client sends lets it out of its own limit,
 * and nothing it sends can lock everyone else out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS, type Config } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { Identities, weakKey } from '../src/identity.ts';
import { addressKey, RateLimit } from '../src/limits.ts';
import { newKey, signed } from './identity.ts';

let server: RunningServer | undefined;
let store: Store | undefined;
afterEach(async () => {
  await server?.close();
  store?.close();
  server = undefined;
  store = undefined;
});

async function start(over: Partial<Config> = {}) {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:', ...over }, store, () => {});
  return server;
}

describe('rate limits', () => {
  it('take a player’s address from the entry their proxy added, not from what they sent', async () => {
    const s = await start({ trustProxy: true });
    const ask = (forwarded: string) =>
      fetch(`${s.url}/auth/challenge`, { method: 'POST', headers: { 'X-Forwarded-For': forwarded }, body: '{}' }).then((r) => r.status);
    // A new made-up first entry every time, then the address the proxy saw.
    const answers = [];
    for (let i = 0; i < 61; i++) answers.push(await ask(`10.0.${i >> 8}.${i & 255}, 203.0.113.9`));
    expect(answers.slice(0, 60).every((a) => a === 200)).toBe(true);
    expect(answers[60]).toBe(429);
    // Someone else behind the same proxy is not held to that address's limit.
    expect(await ask('198.51.100.7')).toBe(200);
  });

  it('count back as many proxies as stand in front, for a player behind two', async () => {
    const s = await start({ trustProxy: 2 });
    const ask = (forwarded: string) =>
      fetch(`${s.url}/auth/challenge`, { method: 'POST', headers: { 'X-Forwarded-For': forwarded }, body: '{}' }).then((r) => r.status);
    // The outer proxy added the player's address, the inner one the outer proxy's.
    for (let i = 0; i < 60; i++) expect(await ask(`10.9.9.${i}, 203.0.113.9, 192.0.2.50`)).toBe(200);
    expect(await ask('10.9.9.200, 203.0.113.9, 192.0.2.50')).toBe(429);
    // Another player through the same two proxies has their own limit.
    expect(await ask('198.51.100.7, 192.0.2.50')).toBe(200);
  });

  it('forget the address heard from longest ago, never all at once', () => {
    const limit = new RateLimit(1, 1);
    expect(limit.take('worn out', 0)).toBe(true);
    expect(limit.take('worn out', 0)).toBe(false);
    // A flood of new addresses, each heard from once, while the worn out one keeps trying.
    for (let i = 0; i < 30_000; i++) {
      limit.take(`flood ${i}`, 0);
      if (i % 1000 === 0) expect(limit.take('worn out', 0)).toBe(false);
    }
    expect(limit.take('worn out', 0)).toBe(false);
  });

  it('count an IPv6 address by its /64, and an IPv4 one by itself', () => {
    expect(addressKey('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8:1:2::9')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(addressKey('::1')).toBe('0:0:0:0::/64');
    expect(addressKey('::ffff:192.0.2.1')).toBe('192.0.2.1');
    expect(addressKey('192.0.2.1')).toBe('192.0.2.1');
  });
});

describe('challenges', () => {
  it('cannot run out, however many are asked for, and are each spent once', () => {
    store = new Store(':memory:');
    let now = 1_000_000;
    const ids = new Identities(store, Buffer.alloc(32, 7), () => now);
    for (let i = 0; i < 20_000; i++) ids.challenge();
    const key = newKey();
    const proof = signed(ids.serverId, ids.challenge(), key);
    expect(ids.check(proof)).toBe(key.publicKey);
    expect(() => ids.check(proof)).toThrow(/too long/);
    // One the server did not make (another secret), and one past its two minutes.
    const other = new Identities(store, Buffer.alloc(32, 8), () => now);
    expect(() => ids.check(signed(ids.serverId, other.challenge(), key))).toThrow(/too long/);
    const late = signed(ids.serverId, ids.challenge(), key);
    now += 2 * 60_000 + 1;
    expect(() => ids.check(late)).toThrow(/too long/);
  });
});

describe('identity keys', () => {
  it('refuse a key of small order, which would make any signature check out', async () => {
    const s = await start();
    const { nonce } = (await (await fetch(`${s.url}/auth/challenge`, { method: 'POST', body: '{}' })).json()) as { nonce: string };
    const zero = (n: number) => Buffer.alloc(n).toString('base64url');
    const res = await fetch(`${s.url}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Nobody', publicKey: zero(32), nonce, signature: zero(64) }),
    });
    expect(res.status).toBe(400);
    expect(store!.countUsers()).toBe(0);
  });

  it('know every small-order encoding, canonical or not, and pass a real key', () => {
    const hex = (h: string) => Buffer.from(h, 'hex');
    const weak = [
      '0000000000000000000000000000000000000000000000000000000000000000',
      '0000000000000000000000000000000000000000000000000000000000000080',
      '0100000000000000000000000000000000000000000000000000000000000080',
      '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85',
      'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa',
      'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
      'f3ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
    ];
    expect(weak.filter((w) => !weakKey(hex(w)))).toEqual([]);
    expect(weakKey(Buffer.from(newKey().publicKey, 'base64url'))).toBe(false);
  });
});
