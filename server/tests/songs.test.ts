import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, type ServerInfo, type ServerMessage, type Session, type SharedSong } from '../../src/net/protocol.ts';
import { readSoundwave, writeSoundwave } from '../../src/storage/soundwaveFile.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS, type Config } from '../src/config.ts';
import { Store } from '../src/db.ts';

let server: RunningServer;
let store: Store;
const start = async (over: Partial<Config> = {}) => {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:', ...over }, store, () => {});
};
afterEach(async () => {
  await server.close();
  store.close();
});

const api = async <T>(method: string, path: string, body?: unknown, token?: string) => {
  const raw = body instanceof Uint8Array;
  const res = await fetch(server.url + path, {
    method,
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : raw ? (body as Uint8Array<ArrayBuffer>) : JSON.stringify(body),
  });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, body: (type.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer())) as T };
};
const signUp = async (name: string, extra = {}) =>
  (await api<Session>('POST', '/auth/signup', { name, password: 'correct horse', ...extra })).body;

/** A made-up song: a few bytes of "audio", a cover and an analysis. */
async function songFile(seed = 1) {
  const audio = new Uint8Array(4000).map((_, i) => (i * seed) % 251);
  const file = await writeSoundwave({
    meta: { title: `Song ${seed}`, artist: 'Band', duration: 30, fileName: 'song.mp3' },
    cover: new Blob([new Uint8Array([255, 216, 255, 1, 2, 3])], { type: 'image/jpeg' }),
    analysis: { version: 1, data: { tempo: 120 } },
    audio: new Blob([audio], { type: 'audio/mpeg' }),
  });
  return { bytes: new Uint8Array(await file.arrayBuffer()), id: createHash('sha256').update(audio).digest('hex') };
}

describe('shared songs', () => {
  it('are off until the owner turns them on', async () => {
    await start();
    const a = await signUp('Ana');
    expect((await api<ServerInfo>('GET', '/info')).body.sharing).toBe('off');
    expect((await api('POST', '/songs', (await songFile()).bytes, a.access)).status).toBe(403);
  });

  it('take whole songs under the id of their audio, hand them out, and remove them', async () => {
    await start({ songSharing: 'songs', publicCovers: true });
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const ana = await signUp('Ana');
    const bo = await signUp('Bo');
    const f = await songFile(3);
    const shared = await api<SharedSong>('POST', '/songs', f.bytes, ana.access);
    expect(shared.status).toBe(200);
    expect(shared.body).toMatchObject({ id: f.id, title: 'Song 3', audio: true, cover: true, by: 'Ana' });

    const list = await api<SharedSong[]>('GET', '/songs?q=song', undefined, bo.access);
    expect(list.body.map((s) => s.id)).toEqual([f.id]);
    const file = await api<Uint8Array<ArrayBuffer>>('GET', `/songs/${f.id}/file`, undefined, bo.access);
    const back = await readSoundwave(new Blob([file.body]));
    expect(back.meta.title).toBe('Song 3');

    // The cover is public here, for the Discord status: no sign-in needed.
    const cover = await api<Uint8Array>('GET', `/covers/${f.id}.jpg`);
    expect(cover.type).toBe('image/jpeg');

    // A report, then the moderators' removal everywhere.
    expect((await api('POST', `/songs/${f.id}/report`, { reason: 'Not theirs to share' }, bo.access)).status).toBe(200);
    expect((await api<unknown[]>('GET', '/mod/reports', undefined, owner.access)).body).toHaveLength(1);
    expect((await api('DELETE', `/songs/${f.id}`, undefined, bo.access)).status).toBe(403);
    expect((await api('DELETE', `/songs/${f.id}?reason=takedown`, undefined, owner.access)).status).toBe(200);
    expect((await api<SharedSong[]>('GET', '/songs', undefined, bo.access)).body).toEqual([]);
    expect((await api('GET', `/covers/${f.id}.jpg`)).status).toBe(404);
  });

  it('keep only the charts on a charts-only server, and hold each player to their quota', async () => {
    await start({ songSharing: 'charts' });
    const ana = await signUp('Ana');
    const f = await songFile(5);
    expect((await api<SharedSong>('POST', '/songs', f.bytes, ana.access)).body).toMatchObject({ audio: false, size: 0 });
    expect((await api('GET', `/songs/${f.id}/file`, undefined, ana.access)).status).toBe(404);
    const charts = await api<{ meta: { title: string }; analysis: { data: unknown } }>(
      'GET',
      `/songs/${f.id}/charts`,
      undefined,
      ana.access,
    );
    expect(charts.body.meta.title).toBe('Song 5');
    expect(charts.body.analysis.data).toEqual({ tempo: 120 });
    // Covers are for signed-in players unless the owner makes them public.
    expect((await api('GET', `/covers/${f.id}`)).status).toBe(401);

    await server.close();
    store.close();
    await start({ songSharing: 'songs', quotaMb: 0.001 });
    const bo = await signUp('Bo');
    expect((await api('POST', '/songs', (await songFile(7)).bytes, bo.access)).status).toBe(413);
  });

  it('pass a player’s request for a missing song to the party’s host, and the host’s answer back', async () => {
    await start({ songSharing: 'songs' });
    const sessions = [await signUp('Host'), await signUp('Guest')];
    const [host, guest] = await Promise.all(
      sessions.map(async (s) => {
        const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
        const got: ServerMessage[] = [];
        ws.on('message', (d) => got.push(JSON.parse(d.toString())));
        await new Promise((r) => ws.once('open', r));
        ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: s.access }));
        return { ws, got, send: (m: object) => ws.send(JSON.stringify(m)) };
      }),
    );
    const wait = async (who: { got: ServerMessage[] }, type: string, test: (m: ServerMessage) => boolean = () => true) => {
      const found = () => who.got.find((m) => m.type === type && test(m));
      for (let i = 0; i < 100 && !found(); i++) await new Promise((r) => setTimeout(r, 20));
      return found()!;
    };
    const f = await songFile(9);
    host.send({ type: 'party-create' });
    const party = (await wait(host, 'party', (m) => m.type === 'party' && !!m.party)) as Extract<ServerMessage, { type: 'party' }>;
    guest.send({ type: 'party-join', code: party.party!.code });
    host.send({ type: 'set', songs: [{ id: f.id, title: 'Song 9', artist: 'Band', duration: 30 }] });
    await new Promise((r) => setTimeout(r, 100));
    guest.send({ type: 'request-song', songId: f.id });
    const asked = (await wait(host, 'song-request')) as Extract<ServerMessage, { type: 'song-request' }>;
    expect(asked).toMatchObject({ songId: f.id, name: 'Guest' });
    await api('POST', '/songs', f.bytes, sessions[0].access);
    host.send({ type: 'song-sent', songId: f.id, to: asked.from, ok: true });
    expect(await wait(guest, 'song-ready')).toMatchObject({ songId: f.id, ok: true });
    host.ws.close();
    guest.ws.close();
  });
});
