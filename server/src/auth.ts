/**
 * Passwords and tokens. Passwords are hashed with Argon2id (Node's own, OWASP's settings).
 * An access token is short-lived and signed with the server's secret, so checking it needs no
 * database; a refresh token is random, stored only as its hash, and single-use.
 */
import { argon2, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const argon2Async = promisify(argon2);

/** OWASP's minimum for Argon2id: 19 MiB, two passes, one lane. */
const ARGON = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 };
export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60_000;

const b64 = (b: Buffer) => b.toString('base64url');

export async function hashPassword(password: string): Promise<string> {
  const nonce = randomBytes(16);
  const tag = await argon2Async('argon2id', { message: password, nonce, ...ARGON });
  return `argon2id$m=${ARGON.memory},t=${ARGON.passes},p=${ARGON.parallelism}$${b64(nonce)}$${b64(tag)}`;
}

export async function checkPassword(password: string, stored: string): Promise<boolean> {
  const [algo, params, nonce, tag] = stored.split('$');
  if (algo !== 'argon2id' || !params || !nonce || !tag) return false;
  const p = Object.fromEntries(params.split(',').map((kv) => kv.split('=') as [string, string]));
  const want = Buffer.from(tag, 'base64url');
  const got = await argon2Async('argon2id', {
    message: password,
    nonce: Buffer.from(nonce, 'base64url'),
    memory: Number(p.m),
    passes: Number(p.t),
    parallelism: Number(p.p),
    tagLength: want.length,
  });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** A random token for a refresh or an invite, safe in a link. */
export const randomToken = (bytes = 24) => b64(randomBytes(bytes));

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Signs and checks the server's own tokens: `payload.signature`, both base64url. */
export class Signer {
  private readonly secret: Buffer;
  constructor(secret: Buffer) {
    this.secret = secret;
  }

  sign(payload: object): string {
    const body = b64(Buffer.from(JSON.stringify(payload)));
    return `${body}.${this.mac(body)}`;
  }

  /** The payload of a token this server signed, or undefined. */
  verify<T>(token: string): T | undefined {
    const dot = token.indexOf('.');
    if (dot < 1) return undefined;
    const body = token.slice(0, dot);
    const mac = Buffer.from(token.slice(dot + 1), 'base64url');
    const want = Buffer.from(this.mac(body), 'base64url');
    if (mac.length !== want.length || !timingSafeEqual(mac, want)) return undefined;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    } catch {
      return undefined;
    }
  }

  private mac(body: string) {
    return b64(createHmac('sha256', this.secret).update(body).digest());
  }
}

/** What an access token says: who, and until when. */
export interface AccessClaims {
  sub: string;
  exp: number;
  kind: 'access';
}

/** A name players are shown by: 2 to 24 letters, digits, spaces, dots, dashes or underscores. */
export function cleanName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const name = raw.trim().replace(/\s+/g, ' ');
  return /^[\p{L}\p{N} ._-]{2,24}$/u.test(name) ? name : undefined;
}

/** Passwords: at least 8 characters, at most 200 (hashing a huge one costs the server). */
export const passwordProblem = (p: unknown): string | undefined =>
  typeof p !== 'string' || p.length < 8
    ? 'A password needs at least 8 characters.'
    : p.length > 200
      ? 'A password can have at most 200 characters.'
      : undefined;
