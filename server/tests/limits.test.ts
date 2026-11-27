/**
 * Rate limits, and what they are keyed by: nothing a client sends lets it out of its own limit,
 * and nothing it sends can lock everyone else out.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS, type Config } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { Identities } from '../src/identity.ts';
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
