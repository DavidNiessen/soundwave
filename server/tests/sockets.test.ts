/** The WebSocket's limits: what a connection may send before it says who it is, and how much after. */
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { ServerMessage } from '../../src/net/protocol.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { Parties } from '../src/parties.ts';

let server: RunningServer | undefined;
let store: Store | undefined;
afterEach(async () => {
  await server?.close();
  store?.close();
  server = undefined;
  store = undefined;
});

async function start() {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:' }, store, () => {});
  return server;
}

const open = (url: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(url.replace('http', 'ws') + '/ws');
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
const closed = (ws: WebSocket) =>
  new Promise<number>((resolve) => (ws.readyState === ws.CLOSED ? resolve(-1) : ws.once('close', (code) => resolve(code))));

describe('the WebSocket', () => {
  it('closes a connection that sends a big message before it says hello', async () => {
    const s = await start();
    const ws = await open(s.url);
    ws.on('error', () => {});
    ws.send(JSON.stringify({ type: 'ping', t: 1, pad: 'x'.repeat(10_000) }));
    expect(await closed(ws)).toBe(1009);
  });

  it('closes one that sends what is not a message before hello', async () => {
    const s = await start();
    const ws = await open(s.url);
    ws.send('[1, 2, 3]');
    expect(await closed(ws)).toBe(4001);
  });

  it('holds one address to a few dozen connections', async () => {
    const s = await start();
    const all = await Promise.all(Array.from({ length: 40 }, () => open(s.url)));
    const extra = await open(s.url);
    expect(await closed(extra)).toBe(4009);
    for (const ws of all) ws.close();
  });
});

describe('a party', () => {
  it('sends its state to all its players as one message, not one per player', () => {
    const one: string[] = [];
    const all: [string[], ServerMessage][] = [];
    const parties = new Parties(
      (to) => one.push(to),
      () => 0,
      () => [],
      () => false,
      (to, msg) => all.push([to, msg]),
    );
    parties.handle({ id: 'a', name: 'A' }, { type: 'party-create' });
    const code = parties.stateOf('a')!.code;
    for (const id of ['b', 'c', 'd']) parties.handle({ id, name: id }, { type: 'party-join', code });
    expect(one).toEqual([]);
    expect(all.at(-1)?.[0]).toEqual(['a', 'b', 'c', 'd']);
  });
});
