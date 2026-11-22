/**
 * Players for the server's tests, each with an identity of their own: an Ed25519 key, as the game
 * makes one from its secret for each server (src/net/identity.ts). They join and sign in as the game
 * does: a challenge from the server, signed with the key.
 */
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { signInMessage, type KeyProof, type ServerInfo, type Session } from '../../src/net/protocol.ts';

export interface TestKey {
  /** The raw public key, base64url (a JWK's `x`), as the game sends it. */
  publicKey: string;
  privateKey: KeyObject;
}

export function newKey(): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { publicKey: publicKey.export({ format: 'jwk' }).x!, privateKey };
}

/** `nonce` signed for the server `serverId` with `key`. */
export const signed = (serverId: string, nonce: string, key: TestKey): KeyProof => ({
  publicKey: key.publicKey,
  nonce,
  signature: sign(null, Buffer.from(signInMessage(serverId, nonce)), key.privateKey).toString('base64url'),
});

async function post<T>(url: string, path: string, body: unknown, token?: string): Promise<{ status: number; body: T }> {
  const res = await fetch(url + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
}

export const serverId = async (url: string) => ((await (await fetch(url + '/info')).json()) as ServerInfo).id;
export const challenge = async (url: string) => (await post<{ nonce: string }>(url, '/auth/challenge', {})).body.nonce;

/** A fresh challenge from the server at `url`, signed with `key`. */
export async function proof(url: string, key: TestKey): Promise<KeyProof> {
  return signed(await serverId(url), await challenge(url), key);
}

/**
 * The players of one server, by name (any case). Each keeps the key they joined with, so they sign
 * in again as themselves.
 */
export function players(url: string) {
  const keys = new Map<string, TestKey>();
  const keyOf = (name: string) => {
    const k = name.toLowerCase();
    if (!keys.has(k)) keys.set(k, newKey());
    return keys.get(k)!;
  };
  /** Asks to join as `name`: the server's answer, whatever it is. */
  const join = async (name: string, extra: Record<string, unknown> = {}) =>
    post<Session>(url, '/auth/signup', { name, ...extra, ...(await proof(url, keyOf(name))) });
  return {
    keyOf,
    join,
    /** Joins as `name`, which must work. */
    async signUp(name: string, extra: Record<string, unknown> = {}): Promise<Session> {
      const r = await join(name, extra);
      if (r.status !== 200) throw new Error(`${name} could not join (${r.status}): ${JSON.stringify(r.body)}`);
      return r.body;
    },
    /** Signs in as `name` with their key: the server's answer. */
    signIn: async (name: string) => post<Session>(url, '/auth/key', await proof(url, keyOf(name))),
  };
}
