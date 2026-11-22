/**
 * The server itself: the HTTP API (accounts, invites, moderation) and one WebSocket per signed-in
 * player for parties. `startServer` is what `main.ts` runs, and what the tests start on a free port.
 *
 * It speaks plain HTTP: anywhere but on the player's own machine or network it belongs behind a
 * proxy that adds HTTPS (server/README.md shows Caddy), and the game refuses plain HTTP elsewhere.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type WebSocket } from 'ws';
import { MESSAGE_MAX, MOD_TOPICS, PROTOCOL_VERSION, type ServerInfo, type ServerMessage, type Topic } from '../../src/net/protocol.ts';
import { Accounts, Refusal } from './accounts.ts';
import type { Config } from './config.ts';
import type { Store, UserRow } from './db.ts';
import { Parties } from './parties.ts';
import { Profiles } from './profiles.ts';
import { zip } from './zip.ts';
import { Rotation } from './rotation.ts';
import { Scores } from './scores.ts';
import { joinPage } from './joinPage.ts';
import { donePage, LoginCodes, loginPage, readRequest, stopPage, validRequest } from './browserLogin.ts';
import { Songs } from './songs.ts';
import { PartySongs } from './partySongs.ts';
import { clientMessage } from './validate.ts';

/** The most bytes an HTTP request's body may have (everything it carries is small). */
const BODY_MAX = 64 * 1024;
/** How long changes are gathered before players are told (see notify): a burst becomes one message. */
const NOTIFY_MS = 250;
/** A run's inputs are bigger: a long song at a high frame rate. */
const RUN_MAX = 8 * 1024 * 1024;

type Handler = (
  req: IncomingMessage,
  body: Record<string, unknown>,
  ip: string,
  params: string[],
  raw: Buffer,
) => Promise<unknown> | unknown;

/** An answer that is a file, not JSON (a song, a cover). */
/** What a player's data export holds, file by file. */
const EXPORT_README = (server: string) => `Your data on ${server}, a Soundwave server
=============================================

Everything this server holds about your account, as it was when you saved it.

account.json       Your account (name, role, when it was made), a ban if there is one, the invites
                   you made, and what moderators did about you. Your password is stored only as an
                   Argon2id hash and sign-ins only as hashes of their tokens: neither is in here.
avatar.json        Your look on the stage: three colours, or null when you have none.
runs.json          Every run you sent to the leaderboards: the song, chart, part and difficulty, the
                   score, and the inputs it was judged from (base64; see src/game/replay.ts in the
                   game's source). Runs you shared to the replay list say so.
songs-shared.json  The songs you shared to the server's library.

To delete your account and everything with it: Play together, Delete my account.
`;

class Binary {
  readonly type: string;
  readonly body: Buffer;
  readonly name: string | undefined;
  readonly headers: Record<string, string>;
  constructor(type: string, body: Buffer, name?: string, headers: Record<string, string> = {}) {
    this.type = type;
    this.body = body;
    this.name = name;
    this.headers = headers;
  }
}

/** A bucket of attempts per address: `burst` at once, refilled at `perMinute`. */
class RateLimit {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly burst: number;
  private readonly perMinute: number;
  constructor(burst: number, perMinute: number) {
    this.burst = burst;
    this.perMinute = perMinute;
  }
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear();
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  }
}

export interface RunningServer {
  url: string;
  port: number;
  accounts: Accounts;
  parties: Parties;
  close(): Promise<void>;
}

export async function startServer(config: Config, store: Store, log: (line: string) => void = console.log): Promise<RunningServer> {
  const accounts = new Accounts(store, config);
  const scores = new Scores(store);
  const songs = new Songs(store, config);
  const partySongs = new PartySongs(config);
  const rotation = new Rotation(store);
  const profiles = new Profiles(store);
  /** Each signed-in player's socket (one per player: signing in elsewhere replaces it). */
  const sockets = new Map<string, WebSocket>();
  const clock = () => performance.now();
  const send = (to: string, msg: ServerMessage) => {
    const ws = sockets.get(to);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const parties = new Parties(
    send,
    clock,
    () => rotation.songs(),
    // A song in the server's own library is there for a party as much as one a host sent.
    (id) => partySongs.has(id) || songs.hasFile(id),
  );
  /** What each player online says they are doing. */
  const activity = new Map<string, string>();
  const authLimit = new RateLimit(10, 10);
  /** Sign-ins done in the browser, waiting for the game to trade their code (browserLogin.ts). */
  const loginCodes = new LoginCodes();
  const writeLimit = new RateLimit(30, 30);

  /** Closes a player's connection, telling them why. */
  /*
   * Live updates: what changed is gathered for a moment, then every player online is told which
   * topics changed (the owner and moderators about their own topics too), and their games fetch
   * those again. Nothing is pushed but the names of what changed.
   */
  const changed = new Set<Topic>();
  const boardSongs = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const notify = (topics: Topic[], songIds: string[] = []) => {
    for (const t of topics) changed.add(t);
    for (const id of songIds) boardSongs.add(id);
    flushTimer ??= setTimeout(flush, NOTIFY_MS);
  };
  const flush = () => {
    flushTimer = null;
    const topics = [...changed];
    const songIds = [...boardSongs];
    changed.clear();
    boardSongs.clear();
    if (!topics.length) return;
    const everyone = topics.filter((t) => !MOD_TOPICS.includes(t));
    for (const id of sockets.keys()) {
      const role = store.userById(id)?.role;
      const theirs = role === 'owner' || role === 'moderator' ? topics : everyone;
      if (theirs.length)
        send(id, { type: 'changed', topics: theirs, ...(theirs.includes('boards') && songIds.length ? { songs: songIds } : {}) });
    }
  };

  const drop = (user: string, reason: string) => {
    const ws = sockets.get(user);
    if (!ws) return;
    send(user, { type: 'bye', reason });
    sockets.delete(user);
    parties.leave(user);
    ws.close(4000, 'bye');
    notify(['users', 'presence']);
  };

  const addressOf = (req: IncomingMessage) =>
    (config.trustProxy
      ? String(req.headers['x-forwarded-for'] ?? '')
          .split(',')[0]
          .trim()
      : '') ||
    req.socket.remoteAddress ||
    '?';

  const routes: Record<string, Handler> = {
    // For a container's healthcheck (Docker, Coolify): the server answers, and its database too.
    'GET /health': () => ({ ok: true, players: sockets.size, parties: parties.count, users: store.countUsers() }),
    'GET /info': (): ServerInfo => ({
      name: config.name,
      description: config.description,
      protocol: PROTOCOL_VERSION,
      mode: config.mode,
      online: sockets.size,
      sharing: config.songSharing,
      publicCovers: config.publicCovers,
      partySongs: config.partySongs,
      browserLogin: true,
      id: accounts.identities.serverId,
    }),
    'POST /songs': async (req, _body, ip, _p, raw) => {
      if (!writeLimit.take(ip)) throw new Refusal(429, 'Too many songs at once. Wait a minute.');
      const force = new URL(req.url ?? '/', 'http://x').searchParams.get('force') === '1';
      const shared = await songs.share(me(req), raw, force);
      notify(['songs']);
      return shared;
    },
    'GET /songs': (req) => (me(req), songs.list(new URL(req.url ?? '/', 'http://x').searchParams.get('q') ?? '')),
    'GET /mod/reports': (req) => songs.reports(me(req)),
    'GET /mod/duplicates': (req) => songs.duplicates(me(req)),
    'POST /mod/duplicates/ok': (req, body) => {
      songs.notDuplicates(me(req), body.a, body.b);
      notify(['songs']);
      return { ok: true };
    },
    'GET /presence': (req) => {
      me(req);
      return [...sockets.keys()]
        .map((id) => ({ name: store.userById(id)?.name ?? '', activity: activity.get(id) ?? 'Online' }))
        .filter((p) => p.name)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    'POST /auth/signup': async (_req, body, ip) => {
      if (!authLimit.take(ip)) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      const session = await accounts.signUp(body);
      notify(['users']);
      return session;
    },
    'POST /auth/signin': (_req, body, ip) => {
      if (!authLimit.take(ip)) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      return accounts.signIn(body.name, body.password);
    },
    'POST /auth/refresh': (_req, body) => accounts.refresh(body.refresh),
    // Signing in with an identity: a challenge, then the challenge signed (identity.ts).
    'POST /auth/challenge': (_req, _body, ip) => {
      if (!authLimit.take(ip)) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      return { nonce: accounts.identities.challenge() };
    },
    'POST /auth/key': (_req, body) => accounts.keySignIn(body),
    'POST /auth/recover': (_req, body, ip) => {
      if (!authLimit.take(ip)) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      return accounts.recover(body.code, body);
    },
    // An account made with a password takes the player's identity (and loses the password).
    'POST /me/key': (req, body) => {
      accounts.linkKey(me(req), body);
      return { ok: true };
    },
    'POST /me/name': (req, body) => {
      const you = accounts.rename(me(req), body.name);
      notify(['users', 'presence', 'boards', 'replays', 'log']);
      return you;
    },
    // The game trades the code a browser sign-in handed it, with the secret it started with.
    'POST /auth/exchange': (_req, body, ip) => {
      if (!authLimit.take(ip)) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      return loginCodes.exchange(body.code, body.verifier);
    },
    'GET /me': (req) => {
      const u = me(req);
      return { id: u.id, name: u.name, role: u.role };
    },
    'DELETE /me': (req) => {
      const u = me(req);
      accounts.deleteAccount(u);
      drop(u.id, 'Your account was deleted.');
      notify(['users', 'presence', 'boards', 'replays']);
      return { ok: true };
    },
    'GET /me/export': (req) => {
      const u = me(req);
      const json = (v: unknown) => JSON.stringify(v, null, 2);
      // One zip of everything held about the player, with a README of what each file is.
      return new Binary(
        'application/zip',
        zip({
          'README.txt': EXPORT_README(config.name),
          'account.json': json(accounts.export(u)),
          'avatar.json': json(profiles.avatarOf(u.id) ?? null),
          'runs.json': json(scores.exportOf(u)),
          'songs-shared.json': json(songs.exportOf(u)),
        }),
        'soundwave-my-data.zip',
      );
    },
    'GET /me/profile': (req) => ({ avatar: profiles.avatarOf(me(req).id) ?? null }),
    'PUT /me/profile': (req, body) => {
      const u = me(req);
      const a = profiles.setAvatar(u, body.avatar ?? null);
      parties.setAvatar(u.id, a ?? undefined);
      return { avatar: a };
    },
    'POST /scores': async (req, body, ip) => {
      if (!writeLimit.take(ip)) throw new Refusal(429, 'Too many scores at once. Wait a minute.');
      const taken = await scores.submit(me(req), body);
      notify(['boards'], typeof body.songId === 'string' ? [body.songId] : []);
      return taken;
    },
    'GET /boards/top': (req) => (me(req), scores.topThisWeek()),
    'GET /showdown/rotation': (req) => (me(req), rotation.songs()),
    'POST /showdown/rotation': (req, body) => {
      const set = rotation.set(me(req), body.songs);
      notify(['rotation', 'log']);
      return set;
    },
    'GET /replays': (req) => {
      me(req);
      const song = new URL(req.url ?? '/', 'http://x').searchParams.get('song') ?? undefined;
      return scores.shared(song);
    },
    'POST /invites': (req, body, ip) => {
      if (!writeLimit.take(ip)) throw new Refusal(429, 'Too many invites at once. Wait a minute.');
      return accounts.makeInvite(me(req), body.uses, body.hours);
    },
    'POST /mod/kick': (req, body) => {
      const u = accounts.kick(me(req), body.name, body.reason);
      drop(
        u.id,
        `A moderator removed you from the server.${typeof body.reason === 'string' && body.reason ? ` Reason: ${body.reason}` : ''}`,
      );
      notify(['users', 'log']);
      return { ok: true };
    },
    'POST /mod/ban': (req, body) => {
      const u = accounts.ban(me(req), body.name, body.hours, body.reason);
      drop(u.id, `You were banned from this server.${typeof body.reason === 'string' && body.reason ? ` Reason: ${body.reason}` : ''}`);
      notify(['users', 'log']);
      return { ok: true };
    },
    'POST /mod/unban': (req, body) => {
      accounts.unban(me(req), body.name, body.reason);
      notify(['users', 'log']);
      return { ok: true };
    },
    'POST /mod/role': (req, body) => {
      accounts.setRole(me(req), body.name, body.role);
      // The player's game learns its new role at once (the Admin page appears, or goes).
      const target = typeof body.name === 'string' ? store.userByName(body.name.trim()) : undefined;
      if (target) send(target.id, { type: 'you', you: { id: target.id, name: target.name, role: target.role } });
      notify(['users', 'log']);
      return { ok: true };
    },
    'POST /mod/recovery': (req, body) => {
      const recovery = accounts.makeRecovery(me(req), body.name);
      notify(['log']);
      return recovery;
    },
    'GET /mod/audit': (req) => accounts.audit(me(req)),
    'GET /mod/users': (req) => accounts.users(me(req), (id) => sockets.has(id)),
  };

  const ID = '([0-9a-f-]{36})';
  const patterns: [string, RegExp, Handler][] = [
    [
      'GET',
      /^\/boards\/([0-9a-f]{64})\/([0-9a-f]{64})\/(vocals|lead|bass|drums)\/(easy|medium|hard|expert)$/,
      (req, _b, _ip, [song, chart, part, difficulty]) =>
        scores.board(me(req), song, chart, part, difficulty, new URL(req.url ?? '/', 'http://x').searchParams.get('week') === '1'),
    ],
    [
      'GET',
      /^\/songs\/([0-9a-f]{64})\/file$/,
      (req, _b, _ip, [id]) => {
        me(req);
        // A smaller copy for streaming where one is asked for and kept; the song as shared otherwise.
        const asked = new URL(req.url ?? '/', 'http://x').searchParams.get('quality');
        const f = songs.file(id, asked === 'medium' || asked === 'low' ? asked : 'high');
        return new Binary('application/x-soundwave', f.body, `${id}.soundwave`, { 'X-Soundwave-Quality': f.quality });
      },
    ],
    [
      'PUT',
      /^\/songs\/([0-9a-f]{64})\/copies\/(medium|low)$/,
      async (req, _b, ip, [id, quality], raw) => {
        if (!writeLimit.take(ip)) throw new Refusal(429, 'Too many songs at once. Wait a minute.');
        await songs.putCopy(me(req), id, quality as 'medium' | 'low', raw);
        notify(['songs']);
        return { ok: true };
      },
    ],
    [
      'PUT',
      /^\/party\/songs\/([0-9a-f]{64})$/,
      async (req, _b, ip, [id], raw) => {
        const u = me(req);
        if (!writeLimit.take(ip)) throw new Refusal(429, 'Too many songs at once. Wait a minute.');
        if (!parties.inSet(u.id, id)) throw new Refusal(403, 'Only a song in your party’s set can be sent.');
        await partySongs.put(id, raw);
        parties.songCached(id);
        return { ok: true };
      },
    ],
    [
      'GET',
      /^\/party\/songs\/([0-9a-f]{64})$/,
      (req, _b, _ip, [id]) => {
        const u = me(req);
        if (!parties.inSet(u.id, id)) throw new Refusal(403, 'Only the players of a party with this song in its set can get it.');
        if (!partySongs.has(id) && songs.hasFile(id)) return new Binary('application/x-soundwave', songs.file(id).body, `${id}.soundwave`);
        return new Binary('application/x-soundwave', partySongs.get(id), `${id}.soundwave`);
      },
    ],
    ['GET', /^\/songs\/([0-9a-f]{64})\/charts$/, (req, _b, _ip, [id]) => (me(req), songs.charts(id))],
    [
      'DELETE',
      /^\/songs\/([0-9a-f]{64})$/,
      (req, _b, _ip, [id]) => {
        songs.remove(me(req), id, new URL(req.url ?? '/', 'http://x').searchParams.get('reason'));
        notify(['songs', 'reports', 'log', 'rotation']);
        return { ok: true };
      },
    ],
    [
      'POST',
      /^\/songs\/([0-9a-f]{64})\/edit$/,
      (req, body, _ip, [id]) => {
        const edited = songs.edit(me(req), id, body);
        notify(['songs', 'log']);
        return edited;
      },
    ],
    [
      'POST',
      /^\/songs\/([0-9a-f]{64})\/report$/,
      (req, body, _ip, [id]) => {
        songs.report(me(req), id, body.reason);
        notify(['reports']);
        return { ok: true };
      },
    ],
    [
      'GET',
      /^\/covers\/([0-9a-f]{64})(?:\.(?:jpg|jpeg|png|webp))?$/,
      (req, _b, _ip, [id]) => {
        // Public where the owner allows it: Discord fetches the picture with no sign-in.
        if (!config.publicCovers) me(req);
        const c = songs.cover(id);
        return new Binary(c.type, c.body);
      },
    ],
    ['GET', /^\/boards\/([0-9a-f]{64})$/, (req, _b, _ip, [song]) => (me(req), scores.boardsOf(song))],
    ['GET', new RegExp(`^/scores/${ID}/run$`), (req, _b, _ip, [id]) => (me(req), scores.run(id))],
    [
      'POST',
      new RegExp(`^/scores/${ID}/share$`),
      (req, body, _ip, [id]) => {
        scores.share(me(req), id, body.shared !== false);
        notify(['replays', 'boards']);
        return { ok: true };
      },
    ],
    [
      'DELETE',
      new RegExp(`^/scores/${ID}$`),
      (req, _b, _ip, [id]) => {
        scores.remove(me(req), id, new URL(req.url ?? '/', 'http://x').searchParams.get('reason'));
        notify(['boards', 'replays', 'log']);
        return { ok: true };
      },
    ],
  ];

  const me = (req: IncomingMessage): UserRow => {
    const auth = req.headers.authorization;
    return accounts.authenticate(auth?.startsWith('Bearer ') ? auth.slice(7) : undefined);
  };

  const reply = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  const http = createServer(async (req, res) => {
    // Any page may call the API: it is signed in by a bearer token, never a cookie, so another
    // site can do nothing with it that it could not do without the browser.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    // A file's size, readable by the game: a proxy that compresses answers drops Content-Length.
    res.setHeader('Access-Control-Expose-Headers', 'X-File-Size, X-Soundwave-Quality');
    // The game's page is cross-origin isolated (for analysis threads): answers must say they may be read there.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
    // An invite link's page: plain HTML, with nothing on it that runs.
    if (req.method === 'GET' && path === '/join') {
      const q = new URL(req.url ?? '/', 'http://x').searchParams;
      const code = q.get('invite') ?? '';
      const recover = q.get('recover') ?? '';
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        'Cache-Control': 'no-store',
      });
      if (recover) return void res.end(joinPage(config, recover.slice(0, 64), true, 'recover'));
      return void res.end(joinPage(config, code, code.length <= 64 && accounts.inviteValid(code)));
    }
    // Signing in through the browser: the server's own page, a plain form (browserLogin.ts).
    if (path === '/login' && (req.method === 'GET' || req.method === 'POST')) return void browserSignIn(req, res);
    let params: string[] = [];
    let route = routes[`${req.method} ${path}`];
    if (!route)
      for (const [method, pattern, handler] of patterns) {
        const m = req.method === method ? pattern.exec(path) : null;
        if (!m) continue;
        route = handler;
        params = m.slice(1).map(decodeURIComponent);
        break;
      }
    if (!route) return reply(res, 404, { error: 'There is nothing here.' });
    const upload =
      (req.method === 'POST' && path === '/songs') ||
      (req.method === 'PUT' && (path.startsWith('/party/songs/') || /^\/songs\/[0-9a-f]{64}\/copies\//.test(path)));
    const limit = path === '/scores' ? RUN_MAX : upload ? config.songMaxMb * 1024 * 1024 + 1 : BODY_MAX;
    try {
      let body: Record<string, unknown> = {};
      let raw = Buffer.alloc(0);
      if (req.method === 'POST' || req.method === 'PUT') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > limit) throw new Refusal(413, 'That request is too big.');
          chunks.push(c as Buffer);
        }
        raw = Buffer.concat(chunks);
        if (size && !upload) {
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (typeof parsed === 'object' && parsed && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
          } catch {
            throw new Refusal(400, 'That request is not JSON.');
          }
        }
      }
      const answer = await route(req, body, addressOf(req), params, raw);
      if (answer instanceof Binary) {
        res.writeHead(200, {
          'Content-Type': answer.type,
          'Content-Length': answer.body.length,
          'X-File-Size': answer.body.length,
          'Cache-Control': path.startsWith('/covers/') ? 'public, max-age=86400' : 'no-store',
          ...(answer.name ? { 'Content-Disposition': `attachment; filename="${answer.name}"` } : {}),
          ...answer.headers,
        });
        return void res.end(answer.body);
      }
      reply(res, 200, answer);
    } catch (e) {
      if (e instanceof Refusal) return reply(res, e.status, { error: e.message });
      log(`Error on ${req.method} ${path}: ${(e as Error).stack ?? e}`);
      reply(res, 500, { error: 'Something went wrong on the server.' });
    }
  });

  /** The sign-in page, and the form sent from it: signed in, the game gets its code. */
  const browserSignIn = async (req: IncomingMessage, res: ServerResponse) => {
    // Where a form may send the player on to: this server, and the web game (the desktop app's
    // soundwave:// link is opened from the page itself).
    let game = '';
    try {
      game = new URL(config.webGameUrl).origin;
    } catch {
      /* none */
    }
    const html = (status: number, body: string, extra: Record<string, string> = {}) => {
      res.writeHead(status, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${game} http://localhost:* http://127.0.0.1:*; frame-ancestors 'none'`,
        'Cache-Control': 'no-store',
        'X-Frame-Options': 'DENY',
        ...extra,
      });
      res.end(body);
    };
    let params: URLSearchParams;
    if (req.method === 'GET') params = new URL(req.url ?? '/', 'http://x').searchParams;
    else {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > BODY_MAX) return html(413, stopPage('That is too much to send.'));
        chunks.push(c as Buffer);
      }
      params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
    }
    const r = readRequest(params);
    const wrong = validRequest(r, config);
    if (wrong) return html(400, stopPage(wrong));
    if (req.method === 'GET') return html(200, loginPage(config, r));

    const name = params.get('name') ?? '';
    const password = params.get('password') ?? '';
    try {
      if (!authLimit.take(addressOf(req))) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      // Only accounts made with a password before identities sign in here, to move them over.
      const session = await accounts.signIn(name, password);
      const code = loginCodes.issue(session, r.challenge);
      const to = `${r.redirect}${r.redirect.includes('?') ? '&' : '?'}${new URLSearchParams({ code, state: r.state, server: config.publicUrl })}`;
      // The desktop app is opened by its own link from a page that says what happened; the web
      // game is simply gone back to.
      if (to.startsWith('soundwave:')) return html(200, donePage(config, session.user.name, to));
      res.writeHead(303, { Location: to, 'Cache-Control': 'no-store' });
      return void res.end();
    } catch (e) {
      if (!(e instanceof Refusal)) {
        log(`Error on POST /login: ${(e as Error).stack ?? e}`);
        return html(500, loginPage(config, r, 'Something went wrong on the server. Try again.', name));
      }
      return html(e.status, loginPage(config, r, e.message, name));
    }
  };

  /* Parties, over WebSocket ----------------------------------------------------------------- */

  const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: MESSAGE_MAX });
  wss.on('connection', (ws) => {
    let user: UserRow | null = null;
    // A connection that does not say hello in time is closed.
    const helloTimer = setTimeout(() => !user && ws.close(4001, 'hello'), 10_000);
    // At most 60 messages a second on average (a song sends 10).
    let budget = 120;
    let budgetAt = performance.now();
    const say = (msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

    ws.on('message', (data, isBinary) => {
      const now = performance.now();
      budget = Math.min(120, budget + ((now - budgetAt) / 1000) * 60);
      budgetAt = now;
      if (--budget < 0) return void ws.close(4008, 'too fast');
      if (isBinary) return;
      let msg;
      try {
        msg = clientMessage(JSON.parse(data.toString()));
      } catch {
        msg = undefined;
      }
      if (!msg) return say({ type: 'error', message: 'The server did not understand that message. Is the game up to date?' });
      if (msg.type === 'ping') return say({ type: 'pong', t: msg.t, serverT: performance.now() });
      if (!user) {
        if (msg.type !== 'hello') return;
        if (msg.protocol !== PROTOCOL_VERSION) {
          say({
            type: 'bye',
            reason:
              msg.protocol < PROTOCOL_VERSION
                ? 'This server needs a newer version of Soundwave. Update the game to play here.'
                : 'This server runs an older version than your game. Its owner needs to update it.',
          });
          return void ws.close(4002, 'protocol');
        }
        try {
          user = accounts.authenticate(msg.token);
        } catch (e) {
          say({ type: 'bye', reason: e instanceof Refusal ? e.message : 'Sign in again.' });
          return void ws.close(4003, 'auth');
        }
        clearTimeout(helloTimer);
        const before = sockets.get(user.id);
        if (before && before !== ws) {
          before.send(JSON.stringify({ type: 'bye', reason: 'You signed in to this server somewhere else.' } satisfies ServerMessage));
          before.removeAllListeners('close');
          before.close(4004, 'replaced');
        }
        sockets.set(user.id, ws);
        notify(['users', 'presence']);
        say({ type: 'welcome', you: { id: user.id, name: user.name, role: user.role }, server: config.name, protocol: PROTOCOL_VERSION });
        parties.reconnected(user.id);
        return;
      }
      if (msg.type === 'hello') return;
      if (msg.type === 'status') {
        activity.set(user.id, msg.activity);
        return void notify(['presence']);
      }
      // The avatar is only needed when the player comes into a party.
      const joining = msg.type === 'party-create' || msg.type === 'party-join';
      parties.handle({ id: user.id, name: user.name, avatar: joining ? profiles.avatarOf(user.id) : undefined }, msg);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (user && sockets.get(user.id) === ws) {
        sockets.delete(user.id);
        activity.delete(user.id);
        parties.disconnected(user.id);
        notify(['users', 'presence']);
      }
    });
    ws.on('error', () => ws.close());
  });

  const ticker = setInterval(() => parties.tick(), 50);

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(config.port, config.host, () => resolve());
  });
  const port = (http.address() as AddressInfo).port;
  return {
    url: `http://localhost:${port}`,
    port,
    accounts,
    parties,
    close: async () => {
      clearInterval(ticker);
      if (flushTimer) clearTimeout(flushTimer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
