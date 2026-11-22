/**
 * The player's identity: how this installation of the game signs in to every server, with no name
 * and password (server/src/identity.ts is the other side).
 *
 * It is one secret, made the first time it is needed. From it the game makes a key of its own for
 * each server (Ed25519, from HKDF of the secret and the server's id), so a server sees one public
 * key for the player and two servers cannot tell they see the same player. One backup still brings
 * every account back.
 *
 * The secret is kept where the system keeps secrets in the desktop app (Windows Credential Manager,
 * the macOS keychain; a file only its user reads on Linux: src-tauri/src/identity.rs), and in the
 * browser's storage in the web game, where clearing the site's data loses it: the game asks for a
 * backup. A backup is a small file locked with a passphrase (PBKDF2, AES-GCM).
 */
import { signInMessage } from './protocol';

const STORE_KEY = 'soundwave.identity';
const FILE_FORMAT = 'soundwave-identity';
/** PBKDF2 rounds for a backup's passphrase (OWASP's for SHA-256). */
const ROUNDS = 600_000;
/** An Ed25519 private key in PKCS #8 is this prefix and the 32-byte seed. */
const PKCS8_PREFIX = Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]);

export interface IdentityState {
  /** The name the player goes by when they join a server (each server may have them by another). */
  name: string;
  created: number;
  /** A backup was saved since the identity was made or brought in. */
  backedUp: boolean;
}

interface Stored extends IdentityState {
  v: 1;
  /** 32 random bytes, base64url. */
  secret: string;
}

const utf8 = new TextEncoder();
const b64url = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const desktop = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/* Where the secret is kept ------------------------------------------------------------------- */

async function read(): Promise<Stored | null> {
  let raw: string | null = null;
  try {
    if (desktop()) {
      const { invoke } = await import('@tauri-apps/api/core');
      raw = await invoke<string | null>('identity_load');
    } else raw = localStorage.getItem(STORE_KEY);
  } catch {
    raw = null;
  }
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Stored;
    return s.v === 1 && typeof s.secret === 'string' && fromB64url(s.secret).length === 32 ? s : null;
  } catch {
    return null;
  }
}

async function write(s: Stored) {
  const raw = JSON.stringify(s);
  if (desktop()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('identity_save', { value: raw });
  } else localStorage.setItem(STORE_KEY, raw);
}

/* The identity -------------------------------------------------------------------------------- */

let current: Stored | null = null;
let loaded: Promise<Stored | null> | null = null;
const listeners = new Set<() => void>();
let snap: IdentityState | null = null;

function changed(s: Stored | null) {
  current = s;
  snap = s ? { name: s.name, created: s.created, backedUp: s.backedUp } : null;
  keys.clear();
  for (const l of listeners) l();
}

export const identity = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  /** The identity as the menus show it, or null before it is loaded or made. */
  snapshot: () => snap,

  /** Loads the identity kept here (once). Null when there is none yet. */
  load(): Promise<Stored | null> {
    loaded ??= read().then((s) => (changed(s), s));
    return loaded;
  },

  /** The identity, made now if there is none yet (`name`: the name it starts with). */
  async ensure(name = ''): Promise<IdentityState> {
    const had = await this.load();
    if (had) return snap!;
    const s: Stored = { v: 1, secret: b64url(crypto.getRandomValues(new Uint8Array(32))), name, created: Date.now(), backedUp: false };
    await write(s);
    loaded = Promise.resolve(s);
    changed(s);
    return snap!;
  },

  /** The name the player joins servers with from now on. */
  async setName(name: string) {
    const s = current ?? (await this.load());
    if (!s) return void (await this.ensure(name));
    const next = { ...s, name };
    await write(next);
    changed(next);
  },

  /**
   * The proof a server asks for to sign in: this identity's key for the server (`serverId`, from
   * its /info), and the server's challenge signed with it.
   */
  async prove(serverId: string, nonce: string): Promise<{ publicKey: string; nonce: string; signature: string }> {
    await this.ensure();
    const key = await keyFor(serverId);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key.privateKey, utf8.encode(signInMessage(serverId, nonce))));
    return { publicKey: key.publicKey, nonce, signature: b64url(signature) };
  },

  /** A backup of the identity, locked with `passphrase`: a small file to keep anywhere. */
  async export(passphrase: string): Promise<Blob> {
    const s = current ?? (await this.load());
    if (!s) throw new Error('There is no identity here yet: it is made when you first join a server.');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      await lockKey(passphrase, salt),
      utf8.encode(JSON.stringify({ secret: s.secret, name: s.name, created: s.created })),
    );
    const file = {
      format: FILE_FORMAT,
      v: 1,
      kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: ROUNDS, salt: b64url(salt) },
      cipher: { name: 'AES-GCM', iv: b64url(iv) },
      data: b64url(new Uint8Array(data)),
    };
    const next = { ...s, backedUp: true };
    await write(next);
    changed(next);
    return new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  },

  /** Brings an identity back from its backup (replacing the one here, if any). */
  async import(file: Blob, passphrase: string): Promise<IdentityState> {
    let f: { format?: string; v?: number; kdf?: { iterations?: number; salt?: string }; cipher?: { iv?: string }; data?: string };
    try {
      f = JSON.parse(await file.text());
    } catch {
      throw new Error('That is not a Soundwave identity file.');
    }
    // A file asking for far more rounds than any backup has would hold the game up for minutes.
    const rounds = f.kdf?.iterations ?? ROUNDS;
    if (f.format !== FILE_FORMAT || f.v !== 1 || !f.kdf?.salt || !f.cipher?.iv || !f.data || !(rounds >= 1 && rounds <= 10 * ROUNDS))
      throw new Error('That is not a Soundwave identity file.');
    let plain: { secret?: string; name?: string; created?: number };
    try {
      const key = await lockKey(passphrase, fromB64url(f.kdf.salt), rounds);
      const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(f.cipher.iv) }, key, fromB64url(f.data));
      plain = JSON.parse(new TextDecoder().decode(data));
    } catch {
      throw new Error('That passphrase does not open this identity.');
    }
    if (typeof plain.secret !== 'string' || fromB64url(plain.secret).length !== 32) throw new Error('This identity file is damaged.');
    const s: Stored = {
      v: 1,
      secret: plain.secret,
      name: typeof plain.name === 'string' ? plain.name : '',
      created: typeof plain.created === 'number' ? plain.created : Date.now(),
      backedUp: true,
    };
    await write(s);
    loaded = Promise.resolve(s);
    changed(s);
    return snap!;
  },
};

/** Whether this browser can sign with Ed25519 (every one from 2023 on). */
export async function identitySupported(): Promise<boolean> {
  try {
    await crypto.subtle.importKey('pkcs8', pkcs8(new Uint8Array(32)), { name: 'Ed25519' }, false, ['sign']);
    return true;
  } catch {
    return false;
  }
}

/* Keys ---------------------------------------------------------------------------------------- */

const keys = new Map<string, Promise<{ privateKey: CryptoKey; publicKey: string }>>();

function pkcs8(seed: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(PKCS8_PREFIX.length + 32);
  out.set(PKCS8_PREFIX);
  out.set(seed, PKCS8_PREFIX.length);
  return out;
}

/** This identity's key for one server: its seed is HKDF of the secret, with the server's id. */
function keyFor(serverId: string) {
  let k = keys.get(serverId);
  if (!k) {
    k = (async () => {
      const base = await crypto.subtle.importKey('raw', fromB64url(current!.secret), 'HKDF', false, ['deriveBits']);
      const seed = new Uint8Array(
        await crypto.subtle.deriveBits(
          { name: 'HKDF', hash: 'SHA-256', salt: utf8.encode('soundwave-identity-v1'), info: utf8.encode(serverId) },
          base,
          256,
        ),
      );
      const privateKey = await crypto.subtle.importKey('pkcs8', pkcs8(seed), { name: 'Ed25519' }, true, ['sign']);
      const jwk = await crypto.subtle.exportKey('jwk', privateKey);
      return { privateKey, publicKey: jwk.x! };
    })();
    keys.set(serverId, k);
  }
  return k;
}

async function lockKey(passphrase: string, salt: Uint8Array, iterations = ROUNDS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as Uint8Array<ArrayBuffer>, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** For tests: forget the identity loaded (as a new start of the game would). */
export function forgetLoadedIdentity() {
  loaded = null;
  changed(null);
}
