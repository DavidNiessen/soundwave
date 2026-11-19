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
import { MESSAGE_MAX, PROTOCOL_VERSION, type ServerInfo, type ServerMessage } from '../../src/net/protocol.ts';
import { Accounts, Refusal } from './accounts.ts';
import type { Config } from './config.ts';
import type { Store, UserRow } from './db.ts';
import { Parties } from './parties.ts';
import { clientMessage } from './validate.ts';

/** The most bytes an HTTP request's body may have (everything it carries is small). */
const BODY_MAX = 64 * 1024;

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
  /** Each signed-in player's socket (one per player: signing in elsewhere replaces it). */
  const sockets = new Map<string, WebSocket>();
  const clock = () => performance.now();
  const send = (to: string, msg: ServerMessage) => {
    const ws = sockets.get(to);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  const parties = new Parties(send, clock);
  const authLimit = new RateLimit(10, 10);
  const writeLimit = new RateLimit(30, 30);

  /** Closes a player's connection, telling them why. */
  const drop = (user: string, reason: string) => {
    const ws = sockets.get(user);
    if (!ws) return;
    send(user, { type: 'bye', reason });
    sockets.delete(user);
    parties.leave(user);
    ws.close(4000, 'bye');
  };

  const addressOf = (req: IncomingMessage) =>
    (config.trustProxy
      ? String(req.headers['x-forwarded-for'] ?? '')
          .split(',')[0]
          .trim()
      : '') ||
    req.socket.remoteAddress ||
    '?';

  const routes: Record<string, (req: IncomingMessage, body: Record<string, unknown>, ip: string) => Promise<unknown> | unknown> = {
    'GET /info': (): ServerInfo => ({
      name: config.name,
      description: config.description,
      protocol: PROTOCOL_VERSION,
      mode: config.mode,
      online: sockets.size,
    }),
    'POST /auth/signup': (_req, body, ip) => {
      if (!authLimit.take(ip)) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      return accounts.signUp(body);
    },
    'POST /auth/signin': (_req, body, ip) => {
      if (!authLimit.take(ip)) throw new Refusal(429, 'Too many tries. Wait a minute and try again.');
      return accounts.signIn(body.name, body.password);
    },
    'POST /auth/refresh': (_req, body) => accounts.refresh(body.refresh),
    'GET /me': (req) => {
      const u = me(req);
      return { id: u.id, name: u.name, role: u.role };
    },
    'DELETE /me': (req) => {
      const u = me(req);
      accounts.deleteAccount(u);
      drop(u.id, 'Your account was deleted.');
      return { ok: true };
    },
    'GET /me/export': (req) => accounts.export(me(req)),
    'POST /invites': (req, body, ip) => {
      if (!writeLimit.take(ip)) throw new Refusal(429, 'Too many invites at once. Wait a minute.');
      return accounts.makeInvite(me(req), body.uses, body.hours);
    },
    'POST /keys': (req, body) => accounts.makeKey(me(req), body.hours),
    'POST /mod/kick': (req, body) => {
      const u = accounts.kick(me(req), body.name, body.reason);
      drop(
        u.id,
        `A moderator removed you from the server.${typeof body.reason === 'string' && body.reason ? ` Reason: ${body.reason}` : ''}`,
      );
      return { ok: true };
    },
    'POST /mod/ban': (req, body) => {
      const u = accounts.ban(me(req), body.name, body.hours, body.reason);
      drop(u.id, `You were banned from this server.${typeof body.reason === 'string' && body.reason ? ` Reason: ${body.reason}` : ''}`);
      return { ok: true };
    },
    'POST /mod/unban': (req, body) => {
      accounts.unban(me(req), body.name, body.reason);
      return { ok: true };
    },
    'POST /mod/role': (req, body) => {
      accounts.setRole(me(req), body.name, body.role);
      return { ok: true };
    },
    'POST /mod/reset-password': async (req, body) => ({ password: await accounts.resetPassword(me(req), body.name) }),
    'GET /mod/audit': (req) => accounts.audit(me(req)),
  };

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
    // The game's page is cross-origin isolated (for analysis threads): answers must say they may be read there.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method === 'OPTIONS') return void res.writeHead(204).end();
    const path = (req.url ?? '/').split('?')[0].replace(/\/+$/, '') || '/';
    const route = routes[`${req.method} ${path}`];
    if (!route) return reply(res, 404, { error: 'There is nothing here.' });
    try {
      let body: Record<string, unknown> = {};
      if (req.method === 'POST') {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const c of req) {
          size += (c as Buffer).length;
          if (size > BODY_MAX) throw new Refusal(413, 'That request is too big.');
          chunks.push(c as Buffer);
        }
        if (size) {
          try {
            const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            if (typeof parsed === 'object' && parsed && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
          } catch {
            throw new Refusal(400, 'That request is not JSON.');
          }
        }
      }
      reply(res, 200, await route(req, body, addressOf(req)));
    } catch (e) {
      if (e instanceof Refusal) return reply(res, e.status, { error: e.message });
      log(`Error on ${req.method} ${path}: ${(e as Error).stack ?? e}`);
      reply(res, 500, { error: 'Something went wrong on the server.' });
    }
  });

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
        say({ type: 'welcome', you: { id: user.id, name: user.name, role: user.role }, server: config.name, protocol: PROTOCOL_VERSION });
        parties.reconnected(user.id);
        return;
      }
      if (msg.type === 'hello') return;
      parties.handle({ id: user.id, name: user.name }, msg);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (user && sockets.get(user.id) === ws) {
        sockets.delete(user.id);
        parties.disconnected(user.id);
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
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
