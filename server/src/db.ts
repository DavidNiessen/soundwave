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
  /** The public key of the player's identity for this server (base64url, server/src/identity.ts). */
  pubkey: string;
  role: Role;
  created: number;
  /** Banned until this time (ms), or null; Infinity is stored as a very large number. */
  banned_until: number | null;
  ban_reason: string | null;
  /** Raised to end every sign-in the account has (a recovery, a ban): access tokens carry the one they were made in. */
  epoch: number;
}

export interface InviteRow {
  code: string;
  by: string | null;
  /** Uses left; null for no limit. */
  uses: number | null;
  expires: number | null;
  /** The role an account made with it gets: 'owner' for the set-up code, otherwise 'player'. */
  role: Role;
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
        pubkey TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        created INTEGER NOT NULL,
        banned_until INTEGER,
        ban_reason TEXT,
        epoch INTEGER NOT NULL DEFAULT 0
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
      CREATE TABLE IF NOT EXISTS recoveries (
        code TEXT PRIMARY KEY,
        user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires INTEGER NOT NULL
      );
    `);
    this.migrate();
  }

  close() {
    this.db.close();
  }

  /** The columns a table has now (in a database a server made before, its own). */
  columnsOf(table: string): string[] {
    return (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  }

  /**
   * Brings a database made by an earlier server up to the tables above: `CREATE TABLE IF NOT
   * EXISTS` leaves a table that is there as it was. Columns added since are added; columns dropped
   * since go, as nothing writes them any more and those that may not be empty would refuse every
   * new row (an invite, a sign-up).
   */
  private migrate() {
    const users = this.columnsOf('users');
    // Identities came after passwords: a server from before had no column for keys.
    if (!users.includes('pubkey')) {
      this.db.exec('ALTER TABLE users ADD COLUMN pubkey TEXT');
      this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS users_pubkey ON users(pubkey)');
    }
    // Passwords are gone.
    if (users.includes('hash')) this.db.exec('ALTER TABLE users DROP COLUMN hash');
    if (!users.includes('epoch')) this.db.exec('ALTER TABLE users ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0');
    // Invites were once of two kinds (links and key files); key files were dropped.
    if (this.columnsOf('invites').includes('kind')) this.db.exec('ALTER TABLE invites DROP COLUMN kind');
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

  addUser(u: Omit<UserRow, 'name_key' | 'banned_until' | 'ban_reason' | 'epoch'>) {
    this.db
      .prepare('INSERT INTO users (id, name, name_key, pubkey, role, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(u.id, u.name, u.name.toLowerCase(), u.pubkey, u.role, u.created);
  }

  userByKey(pubkey: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE pubkey = ?').get(pubkey) as UserRow | undefined;
  }

  /** Gives an account another identity's key (a recovery link): from then on it signs in with that one. */
  setKey(id: string, pubkey: string) {
    this.db.prepare('UPDATE users SET pubkey = ? WHERE id = ?').run(pubkey, id);
  }

  rename(id: string, name: string) {
    this.db.prepare('UPDATE users SET name = ?, name_key = ? WHERE id = ?').run(name, name.toLowerCase(), id);
  }

  addRecovery(code: string, user: string, expires: number) {
    this.db.prepare('DELETE FROM recoveries WHERE user = ?').run(user);
    this.db.prepare('INSERT INTO recoveries (code, user, expires) VALUES (?, ?, ?)').run(code, user, expires);
  }

  /** Takes a recovery code out (they are single-use): the account it is for, if it is still good. */
  takeRecovery(code: string, now: number): string | undefined {
    const row = this.db.prepare('DELETE FROM recoveries WHERE code = ? RETURNING user, expires').get(code) as
      { user: string; expires: number } | undefined;
    return row && row.expires > now ? row.user : undefined;
  }

  hasOwner(): boolean {
    return !!this.db.prepare("SELECT 1 FROM users WHERE role = 'owner' LIMIT 1").get();
  }

  /** How many admins (owners) the server has. */
  owners(): number {
    return (this.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'owner'").get() as { n: number }).n;
  }

  setRole(id: string, role: Role) {
    this.db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
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

  /** Signs a user out everywhere (a ban, a recovery link used): their refresh tokens go, and their access tokens stop working. */
  dropRefreshes(user: string) {
    this.db.prepare('DELETE FROM refresh_tokens WHERE user = ?').run(user);
    this.db.prepare('UPDATE users SET epoch = epoch + 1 WHERE id = ?').run(user);
  }

  /* Invites -------------------------------------------------------------------------------- */

  addInvite(i: InviteRow) {
    this.db
      .prepare('INSERT INTO invites (code, by, uses, expires, role, created) VALUES (?, ?, ?, ?, ?, ?)')
      .run(i.code, i.by, i.uses, i.expires, i.role, i.created);
  }

  invite(code: string): InviteRow | undefined {
    return this.db.prepare('SELECT * FROM invites WHERE code = ?').get(code) as InviteRow | undefined;
  }

  /** Uses an invite once: false when it is spent or out of date. */
  useInvite(code: string, now: number): InviteRow | undefined {
    const i = this.invite(code);
    if (!i || (i.expires !== null && i.expires <= now) || (i.uses !== null && i.uses <= 0)) return undefined;
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
