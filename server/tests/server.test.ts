import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  type Account,
  type Recovery,
  type ServerMessage,
  type Session,
  type UserEntry,
  type WireChart,
} from '../../src/net/protocol.ts';
import { Accounts, Refusal } from '../src/accounts.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS, type Config } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { Parties } from '../src/parties.ts';
import { challenge, newKey, players, proof, serverId, signed } from './identity.ts';

/** The files of a data export (a zip whose files are stored as they are), by name. */
async function exported(token: string): Promise<Record<string, string>> {
  const res = await fetch(server.url + '/me/export', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.headers.get('content-type')).toBe('application/zip');
  const zip = Buffer.from(await res.arrayBuffer());
  const files: Record<string, string> = {};
  for (let at = 0; zip.readUInt32LE(at) === 0x04034b50;) {
    const size = zip.readUInt32LE(at + 18);
    const nameLength = zip.readUInt16LE(at + 26);
    const name = zip.toString('utf8', at + 30, at + 30 + nameLength);
    files[name] = zip.toString('utf8', at + 30 + nameLength, at + 30 + nameLength + size);
    at += 30 + nameLength + size;
  }
  return files;
}

const SONG = 'a'.repeat(64);
const SONG2 = 'b'.repeat(64);
const chart = (duration = 30): WireChart => ({
  part: 'lead',
  difficulty: 'medium',
  lanes: 4,
  notes: [{ t: 1, lane: 0, dur: 0, phrase: -1 }],
  beats: [0, 0.5, 1],
  downbeats: [0],
  secondsPerBeat: 0.5,
  duration,
});

let server: RunningServer;
let store: Store;
/** The players of the server started, each with their own identity. */
let who: ReturnType<typeof players>;
const quiet = () => {};

async function start(over: Partial<Config> = {}) {
  store = new Store(':memory:');
  server = await startServer({ ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'public', dataDir: ':memory:', ...over }, store, quiet);
  who = players(server.url);
}

async function api<T>(method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(server.url + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

const signUp = (name: string, extra: Record<string, unknown> = {}) => who.signUp(name, extra);

/** A player's connection: every message it gets, and a way to wait for the next of a kind. */
async function connect(session: Session) {
  const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
  const got: ServerMessage[] = [];
  const waiting: { type: string; test: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = [];
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString()) as ServerMessage;
    got.push(m);
    for (const w of waiting.slice())
      if (w.type === m.type && w.test(m)) {
        waiting.splice(waiting.indexOf(w), 1);
        w.resolve(m);
      }
  });
  await new Promise((r) => ws.once('open', r));
  const next = <K extends ServerMessage['type']>(type: K, test: (m: Extract<ServerMessage, { type: K }>) => boolean = () => true) =>
    new Promise<Extract<ServerMessage, { type: K }>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no ${type} came`)), 3000);
      waiting.push({
        type,
        test: test as (m: ServerMessage) => boolean,
        resolve: (m) => (clearTimeout(timer), resolve(m as Extract<ServerMessage, { type: K }>)),
      });
    });
  const send = (m: object) => ws.send(JSON.stringify(m));
  const welcome = next('welcome');
  send({ type: 'hello', protocol: PROTOCOL_VERSION, token: session.access });
  await welcome;
  return { ws, got, next, send };
}

describe('accounts', () => {
  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('answers its healthcheck once it is up', async () => {
    await start();
    const res = await fetch(server.url + '/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, users: 0 });
  });

  it('join with an identity, sign in with it again, and refresh once', async () => {
    await start();
    const s = await signUp('Robin');
    expect(s.user).toMatchObject({ name: 'Robin', role: 'player' });
    // The name is taken in any case, by anyone else.
    expect((await api('POST', '/auth/signup', { name: 'robin', ...(await proof(server.url, newKey())) })).status).toBe(409);
    const again = await who.signIn('Robin');
    expect(again.status).toBe(200);
    expect(again.body.user).toEqual(s.user);
    const r = await api<Session>('POST', '/auth/refresh', { refresh: again.body.refresh });
    expect(r.status).toBe(200);
    // A refresh token works once.
    expect((await api('POST', '/auth/refresh', { refresh: again.body.refresh })).status).toBe(401);
    expect((await api<{ name: string }>('GET', '/me', undefined, r.body.access)).body.name).toBe('Robin');
    // A key with no account here is told so (the game offers to join then).
    expect((await api('POST', '/auth/key', await proof(server.url, newKey()))).status).toBe(404);
    // There is no other way in: no passwords, no sign-in page.
    expect((await api('POST', '/auth/signin', { name: 'Robin', password: 'x' })).status).toBe(404);
    expect((await fetch(`${server.url}/login`)).status).toBe(404);
  });

  it('refuse a challenge used twice, one it never gave, a signature not made with the key, and one for another server', async () => {
    await start();
    await signUp('Robin');
    const key = who.keyOf('Robin');
    const id = await serverId(server.url);
    const good = signed(id, await challenge(server.url), key);
    expect((await api('POST', '/auth/key', good)).status).toBe(200);
    expect((await api('POST', '/auth/key', good)).status).toBe(401);
    expect((await api('POST', '/auth/key', signed(id, 'x'.repeat(32), key))).status).toBe(401);
    const forged = { ...signed(id, await challenge(server.url), newKey()), publicKey: key.publicKey };
    expect((await api('POST', '/auth/key', forged)).status).toBe(401);
    expect((await api('POST', '/auth/key', signed('another-server', await challenge(server.url), key))).status).toBe(401);
    // A refused signature spends its challenge too.
    const nonce = await challenge(server.url);
    expect((await api('POST', '/auth/key', { ...signed(id, nonce, newKey()), publicKey: key.publicKey })).status).toBe(401);
    expect((await api('POST', '/auth/key', signed(id, nonce, key))).status).toBe(401);
    // Not a key or signature at all.
    expect((await api('POST', '/auth/key', { publicKey: 'short', nonce, signature: 'short' })).status).toBe(400);
  });

  it('let a key join once: a second account for it is refused', async () => {
    await start();
    await signUp('Robin');
    const second = await api('POST', '/auth/signup', { name: 'Robin again', ...(await proof(server.url, who.keyOf('Robin'))) });
    expect(second.status).toBe(409);
    expect(store.countUsers()).toBe(1);
  });

  it('refuse a challenge or a recovery link that ran out', async () => {
    await start();
    // The server's accounts again, on a clock the test moves.
    let now = 1_000_000;
    const accounts = new Accounts(store, { ...DEFAULTS, mode: 'public', dataDir: ':memory:' }, () => now);
    const key = newKey();
    const mine = () => signed(accounts.identities.serverId, accounts.identities.challenge(), key);
    await accounts.signUp({ name: 'Robin', ...mine() });
    const late = mine();
    now += 2 * 60_000 + 1;
    expect(() => accounts.keySignIn(late)).toThrow(Refusal);
    expect(accounts.keySignIn(mine()).user.name).toBe('Robin');
    const link = accounts.makeRecovery(null, 'Robin');
    now += 7 * 24 * 60 * 60_000 + 1;
    expect(() => accounts.recover(link.code, mine())).toThrow(/run out or was used/);
  });

  it('makes the owner with the set-up code, and lets the owner hand out invite links', async () => {
    await start({ mode: 'invite', publicUrl: 'https://play.example.com' });
    expect((await who.join('Stranger')).status).toBe(403);
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    expect(owner.user.role).toBe('owner');
    // It works once.
    expect((await who.join('Second', { invite: server.accounts.ownerCode })).status).toBe(403);
    // An invite for two, with no end date; the link is the server's own join page.
    const inv = await api<{ code: string; link: string; uses: number; expires: number | null }>(
      'POST',
      '/invites',
      { uses: 2, hours: null },
      owner.access,
    );
    expect(inv.body).toMatchObject({ uses: 2, expires: null, link: `https://play.example.com/join?invite=${inv.body.code}` });
    await signUp('First', { invite: inv.body.code });
    await signUp('Second', { invite: inv.body.code });
    expect((await who.join('Third', { invite: inv.body.code })).status).toBe(403);
  });

  it('serve the join page an invite link opens, which opens the game', async () => {
    await start({ mode: 'invite', name: 'Our <server>', publicUrl: 'https://play.example.com' });
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const inv = await api<{ code: string }>('POST', '/invites', {}, owner.access);
    const page = await fetch(`${server.url}/join?invite=${inv.body.code}`);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain(`soundwave://join?server=${encodeURIComponent('https://play.example.com')}&amp;invite=${inv.body.code}`);
    expect(html).toContain('https://soundwave.niessen.dev/?server=');
    // The server's name is shown as text, never as markup.
    expect(html).toContain('Our &lt;server&gt;');
    const spent = await (await fetch(`${server.url}/join?invite=nope`)).text();
    expect(spent).toContain('has run out or was used up');
  });

  it('asks for the server password in password mode', async () => {
    await start({ mode: 'password', password: 'letmein' });
    expect((await who.join('Robin', { serverPassword: 'nope' })).status).toBe(403);
    expect((await who.join('Robin')).status).toBe(403);
    await signUp('Robin', { serverPassword: 'letmein' });
    // An invite lets its holder in without the password.
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const inv = await api<{ code: string }>('POST', '/invites', {}, owner.access);
    await signUp('Invited', { invite: inv.body.code });
  });

  it('lets members invite on an invite-only server', async () => {
    await start({ mode: 'invite' });
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const inv = await api<{ code: string }>('POST', '/invites', { uses: 1 }, owner.access);
    const friend = await signUp('Friend', { invite: inv.body.code });
    const theirs = await api<{ code: string }>('POST', '/invites', {}, friend.access);
    expect(theirs.status).toBe(200);
    await signUp('Friend of friend', { invite: theirs.body.code });
    expect((await who.join('Late', { invite: inv.body.code })).status).toBe(403);
    expect((await who.join('Late')).status).toBe(403);
    // The server's password means nothing on an invite-only server.
    expect((await who.join('Late', { serverPassword: '' })).status).toBe(403);
  });

  it('lets an admin name admins, who only step down themselves, and keeps one admin always', async () => {
    await start();
    const first = await signUp('First', { invite: server.accounts.ownerCode });
    const second = await signUp('Second');
    // Alone, the first admin cannot step down.
    expect((await api('POST', '/mod/role', { name: 'First', role: 'player' }, first.access)).status).toBe(409);
    expect((await api('POST', '/mod/role', { name: 'Second', role: 'owner' }, first.access)).status).toBe(200);
    const users = await api<UserEntry[]>('GET', '/mod/users', undefined, second.access);
    expect(users.body.map((u) => [u.name, u.role])).toEqual([
      ['First', 'owner'],
      ['Second', 'owner'],
    ]);
    // Neither admin can change or ban the other.
    expect((await api('POST', '/mod/role', { name: 'First', role: 'player' }, second.access)).status).toBe(403);
    expect((await api('POST', '/mod/ban', { name: 'Second' }, first.access)).status).toBe(403);
    // With two, either can step down, and then the other is the last.
    expect((await api('POST', '/mod/role', { name: 'First', role: 'moderator' }, first.access)).status).toBe(200);
    expect((await api('POST', '/mod/role', { name: 'Second', role: 'player' }, second.access)).status).toBe(409);
    const log = await api<{ action: string; target: string }[]>('GET', '/mod/audit', undefined, second.access);
    expect(log.body.slice(0, 2).map((l) => [l.action, l.target])).toEqual([
      ['role moderator', 'First'],
      ['role admin', 'Second'],
    ]);
  });

  it('bans, logs it, keeps the banned out, and exports what it holds', async () => {
    await start();
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const mod = await signUp('Mod');
    const player = await signUp('Player');
    expect((await api('POST', '/mod/ban', { name: 'Player' }, mod.access)).status).toBe(403);
    expect((await api('POST', '/mod/role', { name: 'Mod', role: 'moderator' }, owner.access)).status).toBe(200);
    const modAgain = (await who.signIn('Mod')).body;
    const c = await connect(player);
    const bye = c.next('bye');
    expect((await api('POST', '/mod/ban', { name: 'Player', hours: 2, reason: 'Cheating' }, modAgain.access)).status).toBe(200);
    expect((await bye).reason).toContain('Cheating');
    expect((await who.signIn('Player')).status).toBe(403);
    // A moderator cannot touch the owner.
    expect((await api('POST', '/mod/ban', { name: 'Owner' }, modAgain.access)).status).toBe(403);
    const log = await api<{ action: string; target: string; reason: string }[]>('GET', '/mod/audit', undefined, owner.access);
    expect(log.body[0]).toMatchObject({ action: 'ban 2 h', target: 'Player', reason: 'Cheating' });
    const users = await api<UserEntry[]>('GET', '/mod/users', undefined, modAgain.access);
    expect(users.body.map((u) => [u.name, u.role, u.bannedUntil !== null])).toEqual([
      ['Owner', 'owner', false],
      ['Mod', 'moderator', false],
      ['Player', 'player', true],
    ]);
    expect(users.body[2].banReason).toBe('Cheating');
    expect((await api('GET', '/mod/users', undefined, player.access)).status).not.toBe(200);
    const exp = await exported(owner.access);
    expect(Object.keys(exp).sort()).toEqual(['README.txt', 'account.json', 'avatar.json', 'runs.json', 'songs-shared.json']);
    expect(JSON.parse(exp['account.json']).account.name).toBe('Owner');
    expect(Object.values(exp).join('\n')).not.toContain('argon2id$');
  });

  it('let a player rename themselves to a free name, and log it', async () => {
    await start();
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const ana = await signUp('Ana');
    await signUp('Bo');
    expect((await api('POST', '/me/name', { name: 'bo' }, ana.access)).status).toBe(409);
    expect((await api('POST', '/me/name', { name: 'x' }, ana.access)).status).toBe(400);
    const r = await api<Account>('POST', '/me/name', { name: 'Anabel' }, ana.access);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ id: ana.user.id, name: 'Anabel' });
    // The same key signs in, as the new name; the old name is free for someone else.
    expect((await who.signIn('Ana')).body.user.name).toBe('Anabel');
    expect((await api('POST', '/auth/signup', { name: 'Ana', ...(await proof(server.url, newKey())) })).status).toBe(200);
    const log = await api<{ actor: string; action: string; target: string; reason: string }[]>(
      'GET',
      '/mod/audit',
      undefined,
      owner.access,
    );
    expect(log.body[0]).toMatchObject({ actor: 'Anabel', action: 'rename', target: 'Anabel', reason: 'was Ana' });
  });

  it('give a player who lost their identity their account back, with a one-time link an admin makes', async () => {
    await start({ publicUrl: 'https://play.example.com' });
    const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
    const ana = await signUp('Ana');
    expect((await api('POST', '/mod/recovery', { name: 'Ana' }, ana.access)).status).toBe(403);
    expect((await api('POST', '/mod/recovery', { name: 'Nobody' }, owner.access)).status).toBe(404);
    const rec = await api<Recovery>('POST', '/mod/recovery', { name: 'Ana' }, owner.access);
    expect(rec.status).toBe(200);
    expect(rec.body.link).toBe(`https://play.example.com/join?recover=${rec.body.code}`);
    // The link's page opens the game with it.
    const page = await (await fetch(`${server.url}/join?recover=${rec.body.code}`)).text();
    expect(page).toContain(`soundwave://join?server=${encodeURIComponent('https://play.example.com')}&amp;recover=${rec.body.code}`);

    const lost = newKey();
    const back = await api<Session>('POST', '/auth/recover', { code: rec.body.code, ...(await proof(server.url, lost)) });
    expect(back.status).toBe(200);
    expect(back.body.user).toEqual(ana.user);
    // Once only.
    expect((await api('POST', '/auth/recover', { code: rec.body.code, ...(await proof(server.url, newKey())) })).status).toBe(403);
    // The new key signs in; the old one has no account any more, and the old sign-ins ended.
    expect((await api<Session>('POST', '/auth/key', await proof(server.url, lost))).body.user.name).toBe('Ana');
    expect((await who.signIn('Ana')).status).toBe(404);
    expect((await api('POST', '/auth/refresh', { refresh: ana.refresh })).status).toBe(401);
    const log = await api<{ action: string; target: string }[]>('GET', '/mod/audit', undefined, owner.access);
    expect(log.body[0]).toMatchObject({ action: 'recovery link', target: 'Ana' });
  });

  it('make admins’ recovery links on the server’s command line, not from another admin', async () => {
    await start();
    const first = await signUp('First', { invite: server.accounts.ownerCode });
    await signUp('Second');
    expect((await api('POST', '/mod/role', { name: 'Second', role: 'owner' }, first.access)).status).toBe(200);
    expect((await api('POST', '/mod/recovery', { name: 'Second' }, first.access)).status).toBe(403);
    // An admin's own is fine (a second computer, say).
    expect((await api('POST', '/mod/recovery', { name: 'First' }, first.access)).status).toBe(200);
    // What `node server/src/cli.ts recover Second` does.
    const cli = server.accounts.makeRecovery(null, 'Second');
    const back = await api<Session>('POST', '/auth/recover', { code: cli.code, ...(await proof(server.url, newKey())) });
    expect(back.status).toBe(200);
    expect(back.body.user).toMatchObject({ name: 'Second', role: 'owner' });
    const log = await api<{ action: string; target: string; reason: string }[]>('GET', '/mod/audit', undefined, first.access);
    expect(log.body[0]).toMatchObject({ action: 'recovery link', target: 'Second', reason: 'from the command line' });
  });
});

describe('parties over the network', () => {
  beforeEach(() => start());
  afterEach(async () => {
    await server.close();
    store.close();
  });

  it('play a song together: lobby, the host’s charts, one start time, the board and results', async () => {
    const hostS = await signUp('Host');
    const guestS = await signUp('Guest');
    const host = await connect(hostS);
    const guest = await connect(guestS);

    host.send({ type: 'party-create' });
    const made = await host.next('party', (m) => !!m.party);
    const code = made.party!.code;
    expect(code).toMatch(/^[A-HJ-KMNP-Z2-9]{5}$/);

    // Typed in lower case with a space, as someone might, it still finds the party.
    guest.send({ type: 'party-join', code: `${code.slice(0, 2)} ${code.slice(2)}`.toLowerCase() });
    await host.next('party', (m) => m.party?.members.length === 2);

    // A party is just its players until the host picks what to play.
    expect(made.party!.mode).toBeNull();
    host.send({ type: 'mode', mode: 'versus' });
    host.send({ type: 'set', songs: [{ id: SONG, title: 'One', artist: 'Band', duration: 30 }] });
    await guest.next('party', (m) => m.party?.set.length === 1 && m.party.mode === 'versus');
    guest.send({ type: 'ready', part: 'bass', difficulty: 'hard', ready: true, have: [SONG, SONG2] });
    const ready = await host.next('party', (m) => !!m.party?.members.find((x) => x.id === guestS.user.id)?.ready);
    // Only songs in the set count as had.
    expect(ready.party!.members.find((x) => x.id === guestS.user.id)!.have).toEqual([SONG]);
    host.send({ type: 'ready', part: 'lead', difficulty: 'hard', ready: true, have: [SONG] });

    const bass = { ...chart(), part: 'bass' as const };
    const hostStart = host.next('start');
    const guestStart = guest.next('start');
    host.send({ type: 'start', songIndex: 0, charts: [chart(), bass], assign: { [hostS.user.id]: 0, [guestS.user.id]: 1 } });
    const [hs, gs] = await Promise.all([hostStart, guestStart]);
    expect(hs.at).toBe(gs.at);
    expect(hs.chart!.part).toBe('lead');
    expect(gs.chart!.part).toBe('bass');

    guest.send({ type: 'progress', songIndex: 0, score: 1234, streak: 7, stars: 2 });
    const board = await host.next('board', (m) => m.lines.some((l) => l.score === 1234));
    expect(board.lines.find((l) => l.id === guestS.user.id)).toMatchObject({ score: 1234, streak: 7 });

    const result = { score: 5000, stars: 3, accuracy: 0.9, bestStreak: 40, fullCombo: false };
    host.send({ type: 'finish', songIndex: 0, result });
    guest.send({ type: 'finish', songIndex: 0, result: { ...result, score: 6000 } });
    const done = await host.next('party', (m) => m.party?.phase === 'results');
    const lines = done.party!.results[0].lines;
    expect(lines.map((l) => [l.name, l.result?.score])).toEqual([
      ['Guest', 6000],
      ['Host', 5000],
    ]);
  });

  it('keep a player’s avatar, and show it to their party as soon as it changes', async () => {
    const hostS = await signUp('Host');
    const guestS = await signUp('Guest');
    const look = { top: '#ff5a72', bottom: '#1a1a2e', finish: '#ffd23d' };
    expect((await api('PUT', '/me/profile', { avatar: { ...look, top: 'red' } }, hostS.access)).status).toBe(400);
    expect((await api('PUT', '/me/profile', { avatar: look }, hostS.access)).status).toBe(200);
    expect((await api<{ avatar: unknown }>('GET', '/me/profile', undefined, hostS.access)).body.avatar).toEqual(look);

    const host = await connect(hostS);
    const guest = await connect(guestS);
    host.send({ type: 'party-create' });
    const made = await host.next('party', (m) => !!m.party);
    expect(made.party!.members[0].avatar).toEqual(look);
    guest.send({ type: 'party-join', code: made.party!.code });
    await guest.next('party', (m) => m.party?.members.length === 2);
    const theirs = { top: '#5df2d6', bottom: '#ffffff', finish: '#000000' };
    const shown = host.next('party', (m) => !!m.party?.members.find((x) => x.name === 'Guest')?.avatar);
    await api('PUT', '/me/profile', { avatar: theirs }, guestS.access);
    const seen = await shown;
    expect(seen.party!.members.find((x) => x.name === 'Guest')!.avatar).toEqual(theirs);
    const exp = await exported(guestS.access);
    expect(JSON.parse(exp['avatar.json'])).toEqual(theirs);
  });

  it('end for everyone when the host leaves, and refuse what only the host may do', async () => {
    const hostS = await signUp('Host');
    const guestS = await signUp('Guest');
    const host = await connect(hostS);
    const guest = await connect(guestS);
    host.send({ type: 'party-create' });
    const code = (await host.next('party', (m) => !!m.party)).party!.code;
    guest.send({ type: 'party-join', code });
    await guest.next('party', (m) => !!m.party);
    guest.send({ type: 'set', songs: [] });
    expect((await guest.next('error')).message).toContain('Only the host');
    const ended = guest.next('error');
    host.send({ type: 'party-leave' });
    expect((await ended).message).toBe('The host ended the party.');
  });

  it('answer clock pings and refuse a game too old for the server', async () => {
    const s = await signUp('Pinger');
    const c = await connect(s);
    c.send({ type: 'ping', t: 42 });
    const pong = await c.next('pong');
    expect(pong.t).toBe(42);
    expect(pong.serverT).toBeGreaterThan(0);

    const ws = new WebSocket(server.url.replace('http', 'ws') + '/ws');
    await new Promise((r) => ws.once('open', r));
    const bye = new Promise<ServerMessage>((r) => ws.once('message', (d) => r(JSON.parse(d.toString()))));
    ws.send(JSON.stringify({ type: 'hello', protocol: 0, token: s.access }));
    expect(await bye).toMatchObject({ type: 'bye' });
  });
});

describe('parties, on their own clock', () => {
  /** A party with fake players and a clock the test moves. */
  const setup = () => {
    let now = 1000;
    const inbox = new Map<string, ServerMessage[]>();
    const parties = new Parties(
      (to, msg) => inbox.set(to, [...(inbox.get(to) ?? []), structuredClone(msg)]),
      () => now,
    );
    const last = (who: string, type: string) => (inbox.get(who) ?? []).filter((m) => m.type === type).at(-1);
    return { parties, last, advance: (ms: number) => ((now += ms), parties.tick()) };
  };
  const host = { id: 'h', name: 'Host' };
  const guest = { id: 'g', name: 'Guest' };

  it('keep a dropped player’s place for a while, then let them go', () => {
    const { parties, advance } = setup();
    parties.handle(host, { type: 'party-create' });
    const code = parties.stateOf('h')!.code;
    parties.handle(guest, { type: 'party-join', code });
    parties.disconnected('g');
    expect(parties.stateOf('h')!.members.find((m) => m.id === 'g')!.connected).toBe(false);
    advance(RECONNECT_GRACE_MS / 2);
    parties.reconnected('g');
    expect(parties.stateOf('g')!.members.find((m) => m.id === 'g')!.connected).toBe(true);
    parties.disconnected('g');
    advance(RECONNECT_GRACE_MS + 100);
    expect(parties.stateOf('g')).toBeUndefined();
    expect(parties.stateOf('h')!.members).toHaveLength(1);
  });

  it('make the results without a player who never finished, once the song is long over', () => {
    const { parties, last, advance } = setup();
    parties.handle(host, { type: 'party-create' });
    parties.handle(guest, { type: 'party-join', code: parties.stateOf('h')!.code });
    parties.handle(host, { type: 'mode', mode: 'versus' });
    parties.handle(host, { type: 'set', songs: [{ id: SONG, title: 'One', artist: '', duration: 10 }] });
    for (const p of [host, guest]) parties.handle(p, { type: 'ready', part: 'lead', difficulty: 'easy', ready: true, have: [SONG] });
    parties.handle(host, { type: 'start', songIndex: 0, charts: [chart(10)], assign: { h: 0, g: 0 } });
    parties.handle(host, { type: 'finish', songIndex: 0, result: { score: 10, stars: 1, accuracy: 1, bestStreak: 1, fullCombo: true } });
    expect(parties.stateOf('h')!.phase).toBe('playing');
    advance(10_000);
    expect(parties.stateOf('h')!.phase).toBe('playing');
    advance(60_000);
    const state = parties.stateOf('h')!;
    expect(state.phase).toBe('results');
    expect(state.results[0].lines.find((l) => l.id === 'g')).toMatchObject({ result: null, missing: 'left' });
    expect(last('g', 'party')).toBeDefined();
  });

  it('sit out a player who does not have the song', () => {
    const { parties, last } = setup();
    parties.handle(host, { type: 'party-create' });
    parties.handle(guest, { type: 'party-join', code: parties.stateOf('h')!.code });
    parties.handle(host, { type: 'mode', mode: 'versus' });
    parties.handle(host, { type: 'set', songs: [{ id: SONG, title: 'One', artist: '', duration: 10 }] });
    parties.handle(host, { type: 'ready', part: 'lead', difficulty: 'easy', ready: true, have: [SONG] });
    parties.handle(guest, { type: 'ready', part: 'lead', difficulty: 'easy', ready: true, have: [] });
    parties.handle(host, { type: 'start', songIndex: 0, charts: [chart(10)], assign: { h: 0, g: 0 } });
    expect(last('g', 'start')).toMatchObject({ chart: null });
    parties.handle(host, { type: 'finish', songIndex: 0, result: { score: 10, stars: 1, accuracy: 1, bestStreak: 1, fullCombo: true } });
    expect(parties.stateOf('h')!.results[0].lines.find((l) => l.id === 'g')).toMatchObject({ missing: 'sat-out' });
  });
});
