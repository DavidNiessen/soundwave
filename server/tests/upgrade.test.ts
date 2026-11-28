/**
 * A server updated over the data folder of an earlier build: its tables are brought to the current
 * shape on start (db.ts migrate, songs.ts), and joining, invites and the songs it already has work.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import type { Session } from '../../src/net/protocol.ts';
import { startServer, type RunningServer } from '../src/app.ts';
import { DEFAULTS } from '../src/config.ts';
import { Store } from '../src/db.ts';
import { players } from './identity.ts';

let dir = '';
let server: RunningServer | null = null;
let store: Store | null = null;
afterEach(async () => {
  await server?.close();
  store?.close();
  server = store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** The tables as a server made them before identities replaced passwords, with a player and a song in them. */
function oldDatabase(at: string) {
  const db = new DatabaseSync(join(at, 'soundwave.db'));
  db.exec(`
    CREATE TABLE users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, hash TEXT NOT NULL,
      role TEXT NOT NULL, created INTEGER NOT NULL, banned_until INTEGER, ban_reason TEXT
    );
    CREATE TABLE invites (
      code TEXT PRIMARY KEY, by TEXT REFERENCES users(id) ON DELETE SET NULL, uses INTEGER, expires INTEGER,
      role TEXT NOT NULL, kind TEXT NOT NULL, created INTEGER NOT NULL
    );
    CREATE TABLE songs (
      id TEXT PRIMARY KEY, uploader TEXT REFERENCES users(id) ON DELETE SET NULL, title TEXT NOT NULL,
      artist TEXT NOT NULL, duration REAL NOT NULL, size INTEGER NOT NULL, audio INTEGER NOT NULL,
      cover_type TEXT, created INTEGER NOT NULL
    );
    INSERT INTO users VALUES ('u-old', 'Old', 'old', 'argon2-hash', 'player', 1, NULL, NULL);
    INSERT INTO invites VALUES ('OLDCODE', 'u-old', 1, NULL, 'player', 'invite', 1);
    INSERT INTO songs VALUES ('${'a'.repeat(64)}', 'u-old', 'Old song', 'Band', 120, 1000, 0, NULL, 1);
  `);
  db.close();
}

it('takes a data folder from an earlier build: an owner joins, makes invites, and a friend joins with one', async () => {
  dir = mkdtempSync(join(tmpdir(), 'soundwave-upgrade-'));
  oldDatabase(dir);
  store = new Store(dir);
  server = await startServer(
    { ...DEFAULTS, port: 0, host: '127.0.0.1', mode: 'invite', dataDir: dir, songSharing: 'charts' },
    store,
    () => {},
  );
  expect(store.columnsOf('users')).not.toContain('hash');
  expect(store.columnsOf('users')).toContain('pubkey');
  expect(store.columnsOf('invites')).not.toContain('kind');

  const { signUp } = players(server.url);
  const owner = await signUp('Owner', { invite: server.accounts.ownerCode });
  const made = await fetch(`${server.url}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${owner.access}` },
    body: '{}',
  });
  expect(made.status).toBe(200);
  const { code } = (await made.json()) as { code: string };
  const friend: Session = await signUp('Friend', { invite: code });
  expect(friend.user.name).toBe('Friend');
  // The invite the old server made still lets someone in.
  expect((await signUp('Third', { invite: 'OLDCODE' })).user.name).toBe('Third');

  // The song it had got an id of its own and a file hash, and is listed.
  const row = store.db.prepare('SELECT uid, hash FROM songs').get() as { uid: string | null; hash: string | null };
  expect(row.uid).toBeTruthy();
  expect(row.hash).not.toBeNull();
  const listed = await fetch(`${server.url}/songs`, { headers: { Authorization: `Bearer ${owner.access}` } });
  expect(((await listed.json()) as { title: string }[]).map((s) => s.title)).toEqual(['Old song']);
});
