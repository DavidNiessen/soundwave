/**
 * The game's connection (src/net/client.ts) where it can go wrong: a server that passes another
 * server's sign-in on, a drop that outlasts the access token, signing out while the connection is
 * being made, and the start of the game asking for the connection twice.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket as ServerSocket } from 'ws';
import type { ServerMessage } from '../../src/net/protocol.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { players } from './identity.ts';

const storage = new Map<string, string>();
Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  },
});
// Counts the sockets the client opens.
const NativeSocket = globalThis.WebSocket;
let opened = 0;
globalThis.WebSocket = class extends NativeSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, protocols);
    opened++;
  }
};
const { online } = await import('../../src/net/client.ts');
const { PROTOCOL_VERSION } = await import('../../src/net/protocol.ts');

let server: RunningServer;
let store: Store;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (test: () => boolean, ms = 8000) => {
  for (const end = Date.now() + ms; !test(); await sleep(25))
    if (Date.now() > end) throw new Error(`never: ${JSON.stringify(online.snapshot())}`);
};
/** The client's insides the tests reach into, to make the situations they are about. */
const inside = online as unknown as { access: string | null; ws: WebSocket | null };

beforeAll(async () => {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:' }, store, () => {});
  await online.choose(server.url);
  await online.join({ name: 'ana' });
  await until(() => online.snapshot().status === 'online');
});
afterAll(async () => {
  online.forget();
  await server.close();
  store.close();
});

it('comes back after a drop that outlasts the access token, rather than signing the player out', async () => {
  inside.access = 'run.out.token';
  inside.ws!.close();
  await until(() => online.snapshot().status === 'online');
  expect(online.snapshot().account?.name).toBe('ana');
});

it('stays signed out when the player signs out while the connection is being made', async () => {
  online.signOut();
  online.letIdentitySignIn();
  online.resume();
  online.signOut();
  await sleep(1500);
  const s = online.snapshot();
  expect(s.status).toBe('signed-out');
  expect(s.account).toBeNull();
  expect(s.signedOut).toBe(true);
  expect(inside.ws).toBeNull();
});

it('opens one connection when it is asked for twice at once', async () => {
  online.letIdentitySignIn();
  opened = 0;
  online.resume();
  online.resume();
  await until(() => online.snapshot().status === 'online');
  await sleep(500);
  expect(opened).toBe(1);
});

it('gives a server that passes on another server’s challenge nothing it can sign in there with', async () => {
  // An impostor gives the real server's id as its own and passes the real server's challenge on.
  let taken: { status: number; body: string } | null = null;
  const pass = async (path: string, body?: string) => {
    const r = await fetch(
      server.url + path,
      body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
    );
    return { status: r.status, body: await r.text() };
  };
  const impostor: Server = createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    let out = { status: 404, body: '{}' };
    if (req.url === '/info') out = await pass('/info');
    else if (req.url === '/auth/challenge') out = await pass('/auth/challenge', '{}');
    else if (req.url === '/auth/key') out = taken = await pass('/auth/key', body);
    res.writeHead(out.status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(out.body);
  });
  await new Promise<void>((r) => impostor.listen(0, '127.0.0.1', () => r()));
  try {
    await online.choose(`http://127.0.0.1:${(impostor.address() as AddressInfo).port}`);
    expect(await online.signInWithIdentity()).toBe(false);
    // The real server saw a key it has no account for.
    expect(taken!.status).toBe(404);
  } finally {
    impostor.close();
  }
});

it('joins the party a Discord Join named, when the game was not on its server before', async () => {
  // A friend hosts a party on the server.
  const host = await players(server.url).signUp('Host');
  const ws = new ServerSocket(server.url.replace('http', 'ws') + '/ws');
  await new Promise((r) => ws.once('open', r));
  const code = await new Promise<string>((resolve) => {
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString()) as ServerMessage;
      if (m.type === 'welcome') ws.send(JSON.stringify({ type: 'party-create' }));
      if (m.type === 'party' && m.party) resolve(m.party.code);
    });
    ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: host.access }));
  });
  try {
    // This game is on no server at all when the Join comes.
    online.forget();
    online.joinFrom(server.url, code);
    await until(() => !!online.snapshot().info);
    // Signing in there (as the party screen does) lands in the party.
    expect(await online.signInWithIdentity()).toBe(true);
    await until(() => online.snapshot().party?.code === code);
    expect(
      online
        .snapshot()
        .party!.members.map((m) => m.name)
        .sort(),
    ).toEqual(['Host', 'ana']);
  } finally {
    ws.close();
  }
}, 20_000);
