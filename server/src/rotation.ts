/**
 * The server's Showdown rotation (docs/specs/online-play.md, 4.1): the songs a Showdown plays when
 * its host chooses the server's set instead of their own. The owner and moderators set it.
 */
import { SONG_ID, type SetSong } from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Store, UserRow } from './db.ts';
import { SET_LIMIT } from './validate.ts';

export class Rotation {
  private readonly store: Store;
  private readonly now: () => number;

  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    store.db.exec(`CREATE TABLE IF NOT EXISTS showdown_rotation (id INTEGER PRIMARY KEY CHECK (id = 1), songs TEXT NOT NULL)`);
  }

  /** The rotation's songs, in order (none until it is set). */
  songs(): SetSong[] {
    const row = this.store.db.prepare('SELECT songs FROM showdown_rotation WHERE id = 1').get() as { songs: string } | undefined;
    return row ? (JSON.parse(row.songs) as SetSong[]) : [];
  }

  /** The owner or a moderator sets the rotation; an empty list clears it. */
  set(actor: UserRow, songs: unknown): SetSong[] {
    if (actor.role !== 'owner' && actor.role !== 'moderator')
      throw new Refusal(403, 'Only the owner and moderators set the Showdown rotation.');
    if (!Array.isArray(songs) || songs.length > SET_LIMIT) throw new Refusal(400, `A rotation has up to ${SET_LIMIT} songs.`);
    const list: SetSong[] = songs.map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      if (typeof o.id !== 'string' || !SONG_ID.test(o.id)) throw new Refusal(400, 'A song of the rotation is not named.');
      return {
        id: o.id,
        title: String(o.title ?? '').slice(0, 200),
        artist: String(o.artist ?? '').slice(0, 200),
        duration: Number(o.duration) || 0,
      };
    });
    this.store.db
      .prepare('INSERT INTO showdown_rotation (id, songs) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET songs = excluded.songs')
      .run(JSON.stringify(list));
    this.store.log({
      at: this.now(),
      actor: actor.id,
      action: 'showdown rotation',
      target: actor.id,
      reason: list.map((s) => s.title).join(', '),
    });
    return list;
  }
}
