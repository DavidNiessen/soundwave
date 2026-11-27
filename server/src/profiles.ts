/**
 * Players' profiles (docs/specs/online-play.md, 4.2): for now, their avatar, a few colours stored as
 * a small JSON value, not an image.
 */
import { AVATAR_COLOR, type Avatar } from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Store, UserRow } from './db.ts';

/** An avatar as sent, checked; undefined when it is not one. */
export function avatar(v: unknown): Avatar | undefined {
  if (typeof v !== 'object' || v === null) return undefined;
  const { top, bottom, finish } = v as Record<string, unknown>;
  const ok = (c: unknown): c is string => typeof c === 'string' && AVATAR_COLOR.test(c);
  return ok(top) && ok(bottom) && ok(finish) ? { top, bottom, finish } : undefined;
}

export class Profiles {
  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
    store.db.exec(`CREATE TABLE IF NOT EXISTS profiles (
      user TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      avatar TEXT
    )`);
  }

  /** A player's avatar, if they made one. */
  avatarOf(user: string): Avatar | undefined {
    const row = this.store.db.prepare('SELECT avatar FROM profiles WHERE user = ?').get(user) as { avatar: string | null } | undefined;
    return row?.avatar ? avatar(JSON.parse(row.avatar)) : undefined;
  }

  /** Stores a player's avatar; null removes it. */
  setAvatar(user: UserRow, value: unknown): Avatar | null {
    const a = value === null ? null : avatar(value);
    if (a === undefined) throw new Refusal(400, 'That avatar is not one: it needs a top, a bottom and a finish colour.');
    this.store.db
      .prepare('INSERT INTO profiles (user, avatar) VALUES (?, ?) ON CONFLICT(user) DO UPDATE SET avatar = excluded.avatar')
      .run(user.id, a ? JSON.stringify(a) : null);
    return a;
  }
}
