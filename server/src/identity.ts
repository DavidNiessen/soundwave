/**
 * Signing in with a player's identity (docs/specs/online-play.md, identities): no name and password,
 * a key. Each installation of the game has one secret, and from it a key of its own for each server
 * (made from the server's id, so two servers cannot tell the same player apart). The server keeps
 * only the public half. To sign in, the game asks for a challenge, signs it with the key's private
 * half, and the server checks the signature.
 *
 * A challenge lives two minutes and is used once, so a signature heard on the way is worth nothing.
 * It carries its own expiry, signed with the server's secret, so handing one out keeps nothing:
 * however many anyone asks for, there is no table of them to fill, and only those spent are
 * remembered (until they would have expired).
 */
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { signInMessage, type KeyProof } from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Store } from './db.ts';

const CHALLENGE_MS = 2 * 60_000;
/** An Ed25519 public key, raw, in base64url: 32 bytes. */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
/** An Ed25519 signature in base64url: 64 bytes. */
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

/**
 * The Ed25519 points of small order, as their y coordinate is encoded (the top bit, x's sign, left
 * out): 0, 1, the two of order 8, and p − 1, p and p + 1 (the last two not canonical, standing for
 * 0 and 1). A key that is one of them makes any signature of the right shape check out (all zero
 * bytes, say), whatever the message: such a key proves nothing, so none is taken.
 */
const SMALL_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05',
  'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
];

/** Whether a raw public key is a point of small order, or y is not below p (not canonical). */
export function weakKey(raw: Buffer): boolean {
  if (raw.length !== 32) return true;
  const y = Buffer.from(raw);
  y[31] &= 0x7f;
  if (SMALL_ORDER.includes(y.toString('hex'))) return true;
  // y ≥ p = 2^255 − 19: the top byte 0x7f, every byte between 0xff, the lowest 0xed or more.
  return y[31] === 0x7f && y.subarray(1, 31).every((b) => b === 0xff) && y[0] >= 0xed;
}

/** A challenge: its expiry (ms, 8 bytes), 16 random bytes, and the first 16 bytes of their HMAC. */
const NONCE_BYTES = 8 + 16 + 16;

export class Identities {
  /** This server's own id, which every player's key for it is made from: it never changes. */
  readonly serverId: string;
  /** The challenges spent, until they expire. */
  private readonly spent = new Map<string, number>();
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(store: Store, secret: Buffer, now: () => number = Date.now) {
    this.now = now;
    this.secret = secret;
    let id = store.getMeta('server-id');
    if (!id) {
      id = randomBytes(16).toString('base64url');
      store.setMeta('server-id', id);
    }
    this.serverId = id;
  }

  private mac(body: Buffer) {
    return createHmac('sha256', this.secret).update('challenge').update(body).digest().subarray(0, 16);
  }

  /** A challenge to sign. */
  challenge(): string {
    const body = Buffer.alloc(24);
    body.writeDoubleBE(this.now() + CHALLENGE_MS, 0);
    randomBytes(16).copy(body, 8);
    return Buffer.concat([body, this.mac(body)]).toString('base64url');
  }

  /** When a challenge this server gave out expires, or undefined for one it did not give out. */
  private expiry(nonce: unknown): number | undefined {
    if (typeof nonce !== 'string' || nonce.length > 64) return undefined;
    const raw = Buffer.from(nonce, 'base64url');
    if (raw.length !== NONCE_BYTES || raw.toString('base64url') !== nonce) return undefined;
    const body = raw.subarray(0, 24);
    if (!timingSafeEqual(raw.subarray(24), this.mac(body))) return undefined;
    return body.readDoubleBE(0);
  }

  /** Checks that `proof` signs a challenge this server gave out (and spends it): the public key it proves. */
  check(proof: unknown): string {
    const p = proof as Partial<KeyProof> | null;
    if (
      !p ||
      typeof p.publicKey !== 'string' ||
      !PUBLIC_KEY.test(p.publicKey) ||
      typeof p.signature !== 'string' ||
      !SIGNATURE.test(p.signature) ||
      weakKey(Buffer.from(p.publicKey, 'base64url'))
    )
      throw new Refusal(400, 'That sign-in is broken. Update the game.');
    this.sweep();
    const until = this.expiry(p.nonce);
    if (until === undefined || until < this.now() || this.spent.has(p.nonce!))
      throw new Refusal(401, 'That sign-in took too long. Try again.');
    this.spent.set(p.nonce!, until);
    let ok = false;
    try {
      const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: p.publicKey }, format: 'jwk' });
      ok = verify(null, Buffer.from(signInMessage(this.serverId, p.nonce!)), key, Buffer.from(p.signature, 'base64url'));
    } catch {
      ok = false;
    }
    if (!ok) throw new Refusal(401, 'That sign-in was not made with your identity. Try again.');
    return p.publicKey;
  }

  private sweep() {
    const now = this.now();
    // Spent in order of their expiry, more or less: the oldest are first.
    for (const [k, until] of this.spent) {
      if (until >= now) break;
      this.spent.delete(k);
    }
  }
}
