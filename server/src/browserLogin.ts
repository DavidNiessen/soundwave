/**
 * Signing in through the browser (docs/specs/online-play.md): the game opens the server's own
 * sign-in page (`GET /login`) in the player's browser, where a plain form takes their name and
 * password, so the browser's password manager fills them in and saves new ones. Signed in, the page
 * hands the game a one-time code at the address it asked for (`soundwave://auth` for the desktop
 * app, the web game's own page for the web game), and the game trades the code for its session
 * (`POST /auth/exchange`).
 *
 * The code alone is worth nothing: the game proves it started the sign-in with the secret whose
 * hash it sent first (PKCE, S256). A code lives two minutes and is used once.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Session } from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Config } from './config.ts';

/** How long a code waits to be traded for its session. */
const CODE_MS = 2 * 60_000;

const b64url = (b: Buffer) => b.toString('base64url');
export const challengeOf = (verifier: string) => b64url(createHash('sha256').update(verifier).digest());

/** What the game asked for when it opened the page: kept in the form as it goes back and forth. */
export interface LoginRequest {
  /** Where the code goes: `soundwave://auth`, or the web game's page. */
  redirect: string;
  /** The hash of the game's secret. */
  challenge: string;
  /** The game's own token, handed back so it knows the answer is to its question. */
  state: string;
  /** Sign in, or make an account. */
  mode: 'signin' | 'signup';
  /** An invite the game already had. */
  invite: string;
}

/**
 * Whether the code may go to `redirect`: the desktop app, the web game this server names, or a game
 * on this machine (a development build).
 */
export function redirectAllowed(redirect: string, config: Config): boolean {
  let url: URL;
  try {
    url = new URL(redirect);
  } catch {
    return false;
  }
  if (url.protocol === 'soundwave:') return url.host === 'auth' || url.pathname.replace(/^\/+/, '') === 'auth';
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true;
  try {
    return url.origin === new URL(config.webGameUrl).origin && url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** An invite as it is typed: a code, or a whole invite link (`…/join?invite=…`), which holds one. */
export function inviteCode(typed: string): string {
  const t = typed.trim();
  try {
    return new URL(t).searchParams.get('invite')?.trim() || t;
  } catch {
    return t;
  }
}

/** Reads the game's question from a query string or a form. */
export function readRequest(p: URLSearchParams): LoginRequest {
  return {
    redirect: p.get('redirect') ?? '',
    challenge: p.get('challenge') ?? '',
    state: p.get('state') ?? '',
    mode: p.get('mode') === 'signup' ? 'signup' : 'signin',
    invite: p.get('invite') ?? '',
  };
}

export function validRequest(r: LoginRequest, config: Config): string | null {
  if (!redirectAllowed(r.redirect, config)) return 'This sign-in was not started by Soundwave. Start it again from the game.';
  if (!/^[A-Za-z0-9_-]{43}$/.test(r.challenge) || !/^[A-Za-z0-9_-]{8,128}$/.test(r.state))
    return 'This sign-in link is broken. Start it again from the game.';
  return null;
}

/** The codes handed out and not yet traded. */
export class LoginCodes {
  private codes = new Map<string, { session: Session; challenge: string; until: number }>();
  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  issue(session: Session, challenge: string): string {
    this.sweep();
    const code = b64url(randomBytes(32));
    this.codes.set(code, { session, challenge, until: this.now() + CODE_MS });
    return code;
  }

  /** The session for a code, once, to the game holding the secret it was asked for with. */
  exchange(code: unknown, verifier: unknown): Session {
    this.sweep();
    const entry = typeof code === 'string' ? this.codes.get(code) : undefined;
    if (!entry || typeof verifier !== 'string') throw new Refusal(400, 'That sign-in has run out. Sign in again.');
    this.codes.delete(code as string);
    const a = Buffer.from(challengeOf(verifier));
    const b = Buffer.from(entry.challenge);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Refusal(400, 'That sign-in was not started here. Sign in again.');
    return entry.session;
  }

  private sweep() {
    const now = this.now();
    for (const [k, v] of this.codes) if (v.until < now) this.codes.delete(k);
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background:
    radial-gradient(80% 60% at 50% 0%, #2a1670, transparent 70%), #0e0828; color: #f6f3ff; font: 17px/1.5 system-ui, sans-serif; }
  main { width: min(26rem, 100%); padding: 2rem 1.2rem; display: flex; flex-direction: column; gap: 1rem; }
  .brand { margin: 0; font-size: 0.9rem; font-weight: 900; letter-spacing: 0.12em; text-transform: uppercase; color: #ff7ab8; }
  h1 { margin: 0; font-size: 1.9rem; line-height: 1.1; font-style: italic; font-weight: 900; text-transform: uppercase; }
  .server { margin: -0.4rem 0 0; color: #aba1e6; }
  .tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 0.3rem; padding: 0.3rem; border-radius: 0.9rem; background: rgb(0 0 0 / 0.32); }
  .tabs a { padding: 0.55rem; border-radius: 0.65rem; color: #d2c9fa; text-align: center; font-weight: 800; text-decoration: none; }
  .tabs a[aria-current] { background: #f6f3ff; color: #1a0f4c; }
  form { display: flex; flex-direction: column; gap: 0.8rem; padding: 1.2rem; border-radius: 1.1rem; background: rgb(8 6 18 / 0.6);
    box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.11); }
  label { display: flex; flex-direction: column; gap: 0.3rem; color: #aba1e6; font-size: 0.92rem; font-weight: 700; }
  input { width: 100%; padding: 0.75rem 0.85rem; border: 0; border-radius: 0.7rem; background: rgb(0 0 0 / 0.38); color: #f6f3ff;
    font: inherit; font-weight: 700; }
  input:focus { outline: 2px solid #ff4d9d; }
  .note { margin: 0; color: #aba1e6; font-size: 0.88rem; }
  button, .btn { display: block; width: 100%; padding: 0.85rem 1rem; border: 0; border-radius: 0.8rem; background: #ff4d9d; color: #2c0421;
    font: inherit; font-weight: 900; font-style: italic; text-transform: uppercase; letter-spacing: 0.02em; text-align: center;
    text-decoration: none; cursor: pointer; }
  button:focus-visible, .btn:focus-visible, .tabs a:focus-visible { outline: 3px solid #5df2d6; outline-offset: 2px; }
  .error { margin: 0; padding: 0.7rem 0.9rem; border-radius: 0.7rem; background: rgb(255 90 114 / 0.18); color: #ff8597; font-weight: 700; }
  .small { margin: 0; color: #aba1e6; font-size: 0.88rem; text-align: center; }
`;

function page(title: string, body: string, head = '') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
${head}<style>${STYLE}</style>
</head>
<body>
<main>
<p class="brand">Soundwave</p>
${body}
</main>
</body>
</html>`;
}

/** The sign-in page: a form the browser's password manager knows, for signing in or making an account. */
export function loginPage(config: Config, r: LoginRequest, error: string | null = null, name = ''): string {
  const signup = r.mode === 'signup';
  const keep = (mode: string) =>
    `/login?${new URLSearchParams({ redirect: r.redirect, challenge: r.challenge, state: r.state, mode, ...(r.invite ? { invite: r.invite } : {}) })}`;
  const hidden = (['redirect', 'challenge', 'state', 'mode'] as const)
    .map((k) => `<input type="hidden" name="${k}" value="${esc(r[k])}">`)
    .join('');
  const modeNote = {
    public: 'Anyone can make an account here.',
    password: 'Making an account here needs the server’s password, or an invite.',
    invite: 'Making an account here needs an invite from someone on it.',
  }[config.mode];
  const extra = signup
    ? `${
        config.mode === 'password' && !r.invite
          ? `<label>The server’s password<input type="password" name="serverPassword" autocomplete="off"></label>`
          : ''
      }
      ${
        r.invite
          ? `<input type="hidden" name="invite" value="${esc(r.invite)}"><p class="note">Your invite lets you in.</p>`
          : `<label>${config.mode === 'invite' ? 'Your invite link or code' : 'An invite link or code (if you have one)'}<input name="invite" autocomplete="off" spellcheck="false"${config.mode === 'invite' ? ' required' : ''}></label>
             <p class="note">Setting up this server? Enter the set-up code it printed when it first started: it makes you its owner.</p>`
      }`
    : '';
  const body = `
<h1>${signup ? 'Make an account' : 'Sign in'}</h1>
<p class="server">on <strong>${esc(config.name)}</strong></p>
<nav class="tabs" aria-label="Sign in or make an account">
  <a href="${esc(keep('signin'))}"${signup ? '' : ' aria-current="page"'}>I have an account</a>
  <a href="${esc(keep('signup'))}"${signup ? ' aria-current="page"' : ''}>I’m new here</a>
</nav>
<form method="post" action="/login">
  ${hidden}
  ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
  ${signup ? `<p class="note">${modeNote}</p>` : ''}
  <label>Name<input name="name" value="${esc(name)}" autocomplete="username" maxlength="24" required autofocus spellcheck="false" autocapitalize="off"></label>
  <label>Password<input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" maxlength="200"${signup ? ' minlength="8"' : ''} required></label>
  ${signup ? '<p class="note">At least 8 characters.</p>' : ''}
  ${extra}
  <button type="submit">${signup ? 'Make my account' : 'Sign in'}</button>
</form>
<p class="small">You go back to Soundwave once you are in. Your password stays between your browser and this server.</p>`;
  return page(`${signup ? 'Make an account' : 'Sign in'} · ${config.name}`, body);
}

/** Signed in: the code goes to the game. The desktop app is opened by its link (the browser may ask first). */
export function donePage(config: Config, name: string, to: string): string {
  const body = `
<h1>You’re in</h1>
<p class="server">Signed in to <strong>${esc(config.name)}</strong> as <strong>${esc(name)}</strong>.</p>
<a class="btn" href="${esc(to)}">Back to Soundwave</a>
<p class="small">If the game did not come up by itself, press the button above (your browser may ask to open Soundwave). Then you can close this tab.</p>`;
  return page(`Signed in · ${config.name}`, body, `<meta http-equiv="refresh" content="0;url=${esc(to)}">\n`);
}

/** A sign-in that cannot go on (a broken or foreign request). */
export function stopPage(message: string): string {
  return page('Soundwave', `<h1>Sign in</h1><p class="error" role="alert">${esc(message)}</p>`);
}
