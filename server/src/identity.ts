/**
 * Signing in with a player's identity (docs/specs/online-play.md, identities): no name and password,
 * a key. Each installation of the game has one secret, and from it a key of its own for each server
 * (made from the server's id, so two servers cannot tell the same player apart). The server keeps
 * only the public half. To sign in, the game asks for a challenge, signs it with the key's private
 * half, and the server checks the signature.
 *
 * A challenge lives two minutes and is used once, so a signature heard on the way is worth nothing.
 */
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { signInMessage, type KeyProof } from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Store } from './db.ts';

const CHALLENGE_MS = 2 * 60_000;
/** An Ed25519 public key, raw, in base64url: 32 bytes. */
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/;
/** An Ed25519 signature in base64url: 64 bytes. */
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/;

export class Identities {
  /** This server's own id, which every player's key for it is made from: it never changes. */
  readonly serverId: string;
  private readonly challenges = new Map<string, number>();
  private readonly now: () => number;

  constructor(store: Store, now: () => number = Date.now) {
    this.now = now;
    let id = store.getMeta('server-id');
    if (!id) {
      id = randomBytes(16).toString('base64url');
      store.setMeta('server-id', id);
    }
    this.serverId = id;
  }

  /** A challenge to sign. */
  challenge(): string {
    this.sweep();
    if (this.challenges.size > 10_000) throw new Refusal(429, 'The server is busy. Try again in a moment.');
    const nonce = randomBytes(24).toString('base64url');
    this.challenges.set(nonce, this.now() + CHALLENGE_MS);
    return nonce;
  }

  /** Checks that `proof` signs a challenge this server gave out (and spends it): the public key it proves. */
  check(proof: unknown): string {
    const p = proof as Partial<KeyProof> | null;
    if (
      !p ||
      typeof p.publicKey !== 'string' ||
      !PUBLIC_KEY.test(p.publicKey) ||
      typeof p.signature !== 'string' ||
      !SIGNATURE.test(p.signature)
    )
      throw new Refusal(400, 'That sign-in is broken. Update the game.');
    const until = typeof p.nonce === 'string' ? this.challenges.get(p.nonce) : undefined;
    if (until === undefined || until < this.now()) throw new Refusal(401, 'That sign-in took too long. Try again.');
    this.challenges.delete(p.nonce!);
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
    for (const [k, until] of this.challenges) if (until < now) this.challenges.delete(k);
  }
}
