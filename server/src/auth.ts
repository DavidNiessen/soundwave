/**
 * Tokens. An access token is short-lived and signed with the server's secret, so checking it needs
 * no database; a refresh token is random, stored only as its hash, and single-use. Signing in itself
 * is a signed challenge (identity.ts).
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const ACCESS_TTL_MS = 15 * 60_000;
export const REFRESH_TTL_MS = 60 * 24 * 60 * 60_000;

const b64 = (b: Buffer) => b.toString('base64url');

/** A random token for a refresh, an invite or a recovery link, safe in a link. */
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
