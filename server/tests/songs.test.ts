import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  type DuplicatePair,
  type ServerInfo,
  type ServerMessage,
  type Session,
  type SharedSong,
} from '../../src/net/protocol.ts';
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
  it('let the owner build the library with sharing off, each song with its own id and a hash that follows edits', async () => {
    await start();
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const ana = await signUp('Ana');
    const f = await songFile(5);
    const added = await api<SharedSong>('POST', '/songs', f.bytes, owner.access);
    expect(added.status).toBe(200);
    expect(added.body).toMatchObject({ id: f.id, audio: true, title: 'Song 5' });
    expect(added.body.uid).toMatch(/^[0-9a-f-]{36}$/);
    expect(added.body.hash).toMatch(/^[0-9a-f]{64}$/);

    // Players still cannot share here, but they see the owner's songs.
    expect((await api('POST', '/songs', (await songFile(6)).bytes, ana.access)).status).toBe(403);
    expect((await api<SharedSong[]>('GET', '/songs', undefined, ana.access)).body.map((x) => x.uid)).toEqual([added.body.uid]);

    // An edit keeps the song's own id and gives its file a new hash, and the file says the new title.
    expect((await api('POST', `/songs/${f.id}/edit`, { title: 'Renamed' }, ana.access)).status).toBe(403);
    const edited = await api<SharedSong>('POST', `/songs/${f.id}/edit`, { title: 'Renamed', artist: 'New Band' }, owner.access);
    expect(edited.body).toMatchObject({ uid: added.body.uid, title: 'Renamed', artist: 'New Band' });
    expect(edited.body.hash).not.toBe(added.body.hash);
    const file = await api<Uint8Array<ArrayBuffer>>('GET', `/songs/${f.id}/file`, undefined, ana.access);
    expect(createHash('sha256').update(file.body).digest('hex')).toBe(edited.body.hash);
    expect((await readSoundwave(new Blob([file.body]))).meta).toMatchObject({ title: 'Renamed', artist: 'New Band' });
  });

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

  it('pass a party’s songs on through the server, to the party’s players only', async () => {
    await start();
    const sessions = [await signUp('Host'), await signUp('Guest'), await signUp('Stranger')];
    const [host, guest] = await Promise.all(
      sessions.slice(0, 2).map(async (s) => {
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
    const other = await songFile(10);
    // On by default, and nothing to do with sharing songs to the library (off here).
    expect((await api<ServerInfo>('GET', '/info')).body).toMatchObject({ partySongs: true, sharing: 'off' });
    host.send({ type: 'party-create' });
    const party = (await wait(host, 'party', (m) => m.type === 'party' && !!m.party)) as Extract<ServerMessage, { type: 'party' }>;
    guest.send({ type: 'party-join', code: party.party!.code });
    host.send({ type: 'mode', mode: 'versus' });
    host.send({ type: 'set', songs: [{ id: f.id, title: 'Song 9', artist: 'Band', duration: 30 }] });
    await wait(guest, 'party', (m) => m.type === 'party' && m.party?.set.length === 1);

    // Only a song in the party's set, and only the song its id names.
    expect((await api('PUT', `/party/songs/${other.id}`, other.bytes, sessions[0].access)).status).toBe(403);
    expect((await api('PUT', `/party/songs/${f.id}`, other.bytes, sessions[0].access)).status).toBe(400);
    expect((await api('PUT', `/party/songs/${f.id}`, f.bytes, sessions[0].access)).status).toBe(200);
    // The party hears that the server has it.
    await wait(guest, 'party', (m) => m.type === 'party' && !!m.party?.set[0]?.cached);

    const got = await api<Uint8Array<ArrayBuffer>>('GET', `/party/songs/${f.id}`, undefined, sessions[1].access);
    expect(got.status).toBe(200);
    expect((await readSoundwave(new Blob([got.body]))).meta.title).toBe('Song 9');
    // Not a library: someone outside the party cannot get it, and nothing lists it.
    expect((await api('GET', `/party/songs/${f.id}`, undefined, sessions[2].access)).status).toBe(403);
    expect((await api<SharedSong[]>('GET', '/songs', undefined, sessions[2].access)).body).toEqual([]);
    host.ws.close();
    guest.ws.close();
  });

  it('keep smaller copies for streaming from whoever shared a song, and hand them to who asks', async () => {
    await start({ songSharing: 'songs' });
    const ana = await signUp('Ana');
    const bo = await signUp('Bo');
    const f = await songFile(7);
    expect((await api<SharedSong>('POST', '/songs', f.bytes, ana.access)).body.qualities).toEqual([]);
    const copy = async (of: string, bytes = 1000, duration = 30) =>
      new Uint8Array(
        await (
          await writeSoundwave({
            meta: { title: 'Song 7', artist: 'Band', duration, fileName: 'song.mp3', copyOf: of },
            audio: new Blob([new Uint8Array(bytes).fill(7)], { type: 'audio/mp4' }),
          })
        ).arrayBuffer(),
      );
    // Only its sharer (or the owner and moderators); of this song; smaller; as long.
    expect((await api('PUT', `/songs/${f.id}/copies/low`, await copy(f.id), bo.access)).status).toBe(403);
    expect((await api('PUT', `/songs/${f.id}/copies/low`, await copy('a'.repeat(64)), ana.access)).status).toBe(400);
    expect((await api('PUT', `/songs/${f.id}/copies/low`, await copy(f.id, 9000), ana.access)).status).toBe(400);
    expect((await api('PUT', `/songs/${f.id}/copies/low`, await copy(f.id, 1000, 12), ana.access)).status).toBe(400);
    expect((await api('PUT', `/songs/${f.id}/copies/low`, await copy(f.id), ana.access)).status).toBe(200);
    expect((await api<SharedSong[]>('GET', '/songs', undefined, bo.access)).body[0].qualities).toEqual(['low']);
    // Asked for low: the copy. Asked for medium, which is not there: the song as shared. Each says which.
    const low = await fetch(`${server.url}/songs/${f.id}/file?quality=low`, { headers: { Authorization: `Bearer ${bo.access}` } });
    expect(low.headers.get('x-soundwave-quality')).toBe('low');
    expect((await readSoundwave(await low.blob())).meta.copyOf).toBe(f.id);
    const medium = await fetch(`${server.url}/songs/${f.id}/file?quality=medium`, { headers: { Authorization: `Bearer ${bo.access}` } });
    expect(medium.headers.get('x-soundwave-quality')).toBe('high');
  });

  it('tell the players online what changed, the owner and moderators about players too', async () => {
    await start({ songSharing: 'songs' });
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const ana = await signUp('Ana');
    const [o, a] = await Promise.all(
      [owner, ana].map(async (s) => {
        const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
        const got: ServerMessage[] = [];
        ws.on('message', (d) => got.push(JSON.parse(d.toString())));
        await new Promise((r) => ws.once('open', r));
        ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, token: s.access }));
        return { ws, got };
      }),
    );
    const topics = (who: { got: ServerMessage[] }) => new Set(who.got.flatMap((m) => (m.type === 'changed' ? m.topics : [])));
    const settle = () => new Promise((r) => setTimeout(r, 400));
    await settle();
    o.got.length = a.got.length = 0;
    await api('POST', '/songs', (await songFile(8)).bytes, ana.access);
    await api('POST', '/mod/role', { name: 'Ana', role: 'moderator' }, owner.access);
    await settle();
    expect([...topics(a)]).toContain('songs');
    expect([...topics(o)]).toEqual(expect.arrayContaining(['songs', 'users', 'log']));
    // Ana hears of her new role at once.
    expect(a.got.find((m) => m.type === 'you')).toMatchObject({ you: { name: 'Ana', role: 'moderator' } });
    o.ws.close();
    a.ws.close();
  });

  it('refuse the same recording in another file, and list possible duplicates for the admin', async () => {
    await start({ songSharing: 'songs' });
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const ana = await signUp('Ana');
    // Two files of one song (other bytes, the same loudness), and another song as long.
    const energy = Array.from({ length: 1800 }, (_, i) => 0.5 + 0.3 * Math.sin(i / 37) + (i % 400 < 200 ? 0.2 : 0));
    const other = Array.from({ length: 1800 }, (_, i) => 0.5 + 0.3 * Math.cos(i / 11));
    const file = async (seed: number, title: string, loud: number[]) => {
      const audio = new Uint8Array(5000).map((_, i) => (i * seed) % 251);
      const f = await writeSoundwave({
        meta: { title, artist: 'Band', duration: 180, fileName: 'song.mp3' },
        analysis: { version: 1, data: { energy: loud, energyHop: 0.1 } },
        audio: new Blob([audio], { type: 'audio/mpeg' }),
      });
      return new Uint8Array(await f.arrayBuffer());
    };
    expect((await api('POST', '/songs', await file(3, 'Song', energy), ana.access)).status).toBe(200);
    expect((await api('POST', '/songs', await file(4, 'Another', other), ana.access)).status).toBe(200);
    const twice = await api<{ error: string }>('POST', '/songs', await file(5, 'Song (FLAC)', energy), ana.access);
    expect(twice.status).toBe(409);
    expect(twice.body.error).toContain('already on the server as "Song"');
    // A player cannot force it in; an admin can, and then it is listed as a duplicate.
    expect((await api('POST', '/songs?force=1', await file(5, 'Song (FLAC)', energy), ana.access)).status).toBe(409);
    expect((await api('POST', '/songs?force=1', await file(5, 'Song (FLAC)', energy), owner.access)).status).toBe(200);
    expect((await api('GET', '/mod/duplicates', undefined, ana.access)).status).toBe(403);
    const pairs = await api<DuplicatePair[]>('GET', '/mod/duplicates', undefined, owner.access);
    expect(pairs.body.map((p) => [p.kind, [p.a.title, p.b.title].sort()])).toEqual([['same', ['Song', 'Song (FLAC)']]]);
    // Said to differ, the pair is not listed again.
    expect((await api('POST', '/mod/duplicates/ok', { a: pairs.body[0].a.id, b: pairs.body[0].b.id }, owner.access)).status).toBe(200);
    expect((await api<DuplicatePair[]>('GET', '/mod/duplicates', undefined, owner.access)).body).toEqual([]);
  });

  it('do not pass a party’s songs on where the owner turned that off', async () => {
    await start({ partySongs: false });
    expect((await api<ServerInfo>('GET', '/info')).body.partySongs).toBe(false);
  });
});
