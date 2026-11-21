/**
 * Everything the server keeps, in one SQLite file (easy to back up): accounts, sign-ins, invites,
 * bans and the moderation log. Only what the features need is stored (docs/specs/online-play.md, 3.5).
 */
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { Role } from '../../src/net/protocol.ts';

export interface UserRow {
  id: string;
  name: string;
  /** The name in lower case: names are unique whatever their case. */
  name_key: string;
  hash: string;
  role: Role;
  created: number;
  /** Banned until this time (ms), or null; Infinity is stored as a very large number. */
  banned_until: number | null;
  ban_reason: string | null;
}

export interface InviteRow {
  code: string;
  by: string | null;
  /** Uses left; null for no limit. */
  uses: number | null;
  expires: number | null;
  /** The role an account made with it gets: 'owner' for the set-up code, otherwise 'player'. */
  role: Role;
  /** Always 'invite' (key files, the other kind once planned, were dropped for invite links). */
  kind: 'invite' | 'key';
  created: number;
}

export interface AuditRow {
  id: number;
  at: number;
  actor: string;
  action: string;
  target: string;
  reason: string;
}

/** Bans "for ever" end here (ms): far beyond any real date, and still an ordinary number. */
export const FOREVER = 8.64e15;

export class Store {
  readonly db: DatabaseSync;

  constructor(dataDir: string | ':memory:') {
    this.db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : join(dataDir, 'soundwave.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        name_key TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL,
        role TEXT NOT NULL,
        created INTEGER NOT NULL,
        banned_until INTEGER,
        ban_reason TEXT
      );
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        hash TEXT PRIMARY KEY,
        user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        by TEXT REFERENCES users(id) ON DELETE SET NULL,
        uses INTEGER,
        expires INTEGER,
        role TEXT NOT NULL,
        kind TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL,
        reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  close() {
    this.db.close();
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value;
  }

  setMeta(key: string, value: string) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  /* Accounts --------------------------------------------------------------------------------- */

  userById(id: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  }

  userByName(name: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE name_key = ?').get(name.toLowerCase()) as UserRow | undefined;
  }

  addUser(u: Omit<UserRow, 'name_key' | 'banned_until' | 'ban_reason'>) {
    this.db
      .prepare('INSERT INTO users (id, name, name_key, hash, role, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, u.name, u.name.toLowerCase(), u.hash, u.role, u.created);
  }

  hasOwner(): boolean {
    return !!this.db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get();
  }

  setRole(id: string, role: Role) {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  }

  setHash(id: string, hash: string) {
    this.db.prepare('UPDATE users SET hash = ? WHERE id = ?').run(hash, id);
  }

  setBan(id: string, until: number | null, reason: string | null) {
    this.db.prepare('UPDATE users SET banned_until = ?, ban_reason = ? WHERE id = ?').run(until, reason, id);
  }

  deleteUser(id: string) {
    this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
  }

  /** Every account, oldest first. */
  users(): UserRow[] {
    return this.db.prepare('SELECT * FROM users ORDER BY created').all() as unknown as UserRow[];
  }

  countUsers(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  }

  /* Sign-ins --------------------------------------------------------------------------------- */

  addRefresh(hash: string, user: string, expires: number) {
    this.db.prepare('INSERT INTO refresh_tokens (hash, user, expires) VALUES (?, ?, ?)').run(hash, user, expires);
  }

  /** Takes a refresh token out (they are single-use): the user it belonged to, if it was valid. */
  takeRefresh(hash: string, now: number): string | undefined {
    const row = this.db.prepare('DELETE FROM refresh_tokens WHERE hash = ? RETURNING user, expires').get(hash) as
      { user: string; expires: number } | undefined;
    return row && row.expires > now ? row.user : undefined;
  }

  /** Signs a user out everywhere (a ban, a password reset). */
  dropRefreshes(user: string) {
    this.db.prepare('DELETE FROM refresh_tokens WHERE user = ?').run(user);
  }

  /* Invites -------------------------------------------------------------------------------- */

  addInvite(i: InviteRow) {
    this.db
      .prepare('INSERT INTO invites (code, by, uses, expires, role, kind, created) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(i.code, i.by, i.uses, i.expires, i.role, i.kind, i.created);
  }

  invite(code: string): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as InviteRow | undefined;
  }

  /** Uses an invite once: false when it is spent or out of date. */
  useInvite(code: string, kind: InviteRow['kind'], now: number): InviteRow | undefined {
    const i = this.invite(code);
    if (!i || i.kind !== kind || (i.expires !== null && i.expires <= now) || (i.uses !== null && i.uses <= 0)) return undefined;
    if (i.uses !== null) this.db.prepare('UPDATE invites SET uses = uses - 1 WHERE code = ?').run(code);
    return i;
  }

  invitesBy(user: string): InviteRow[] {
    return this.db.prepare('SELECT * FROM invites WHERE by = ? ORDER BY created').all(user) as unknown as InviteRow[];
  }

  /* The moderation log ----------------------------------------------------------------------- */

  log(a: Omit<AuditRow, 'id'>) {
    this.db
      .prepare('INSERT INTO audit (at, actor, action, target, reason) VALUES (?, ?, ?, ?, ?)')
      .run(a.at, a.actor, a.action, a.target, a.reason);
  }

  auditLog(limit = 200): AuditRow[] {
    return this.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit) as unknown as AuditRow[];
  }

  auditAbout(user: string): AuditRow[] {
    return this.db.prepare('SELECT * FROM audit WHERE target = ? ORDER BY id').all(user) as unknown as AuditRow[];
  }
}
