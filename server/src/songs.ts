/**
 * Songs shared on a server (docs/specs/online-play.md, 3.4): whole `.soundwave` files, or, on a
 * charts-only server, everything but the audio. Sharing music can infringe copyright, and the owner
 * answers for what the server hands out, so it is off until the owner turns it on, and comes with
 * the tools to run it: who shared what and when, reports, removal everywhere at once, a size limit
 * per song and a quota per account.
 *
 * Files live in the data folder: songs/<id>.soundwave (whole songs), charts/<id>.json (details,
 * analysis and hand-made charts) and covers/<id> (the cover, which the Discord status can show).
 * A whole song can have smaller copies for streaming, songs/<id>.medium.soundwave and
 * <id>.low.soundwave: the server cannot make them itself (it has no audio encoder), so the game of
 * whoever shared the song, or of an admin or moderator, makes and sends them (src/net/streamQuality.ts).
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSoundwave, writeSoundwave } from '../../src/storage/soundwaveFile.ts';
import { STREAM_QUALITIES, type SharedSong, type StreamQuality } from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Config } from './config.ts';
import type { Store, UserRow } from './db.ts';

const MB = 1024 * 1024;
const canModerate = (u: UserRow) => u.role === 'owner' || u.role === 'moderator';

interface SongRow {
  id: string;
  /** The song's own id on this server, which never changes. */
  uid: string;
  /** SHA-256 of the file the server keeps now: it changes with every edit, so a copy can be checked. */
  hash: string;
  uploader: string | null;
  title: string;
  artist: string;
  duration: number;
  size: number;
  audio: number;
  cover_type: string | null;
  created: number;
}

export class Songs {
  private readonly store: Store;
  private readonly config: Config;
  private readonly dirs: { songs: string; charts: string; covers: string };
  private readonly now: () => number;

  constructor(store: Store, config: Config, now: () => number = Date.now) {
    this.store = store;
    this.config = config;
    this.now = now;
    // A server whose database is in memory (the tests) keeps its files in a temporary folder.
    const base = config.dataDir === ':memory:' ? mkdtempSync(join(tmpdir(), 'soundwave-')) : config.dataDir;
    this.dirs = { songs: join(base, 'songs'), charts: join(base, 'charts'), covers: join(base, 'covers') };
    for (const d of Object.values(this.dirs)) mkdirSync(d, { recursive: true });
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS songs (
        id TEXT PRIMARY KEY,
        uploader TEXT REFERENCES users(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        duration REAL NOT NULL,
        size INTEGER NOT NULL,
        audio INTEGER NOT NULL,
        cover_type TEXT,
        created INTEGER NOT NULL,
        uid TEXT,
        hash TEXT
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song TEXT NOT NULL,
        by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `);
    this.migrate();
  }

  /** Gives songs stored before internal ids and hashes theirs (a server updated from an older version). */
  private migrate() {
    const cols = (this.store.db.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes('uid')) this.store.db.exec('ALTER TABLE songs ADD COLUMN uid TEXT');
    if (!cols.includes('hash')) this.store.db.exec('ALTER TABLE songs ADD COLUMN hash TEXT');
    const missing = this.store.db.prepare('SELECT id, audio FROM songs WHERE uid IS NULL OR hash IS NULL').all() as {
      id: string;
      audio: number;
    }[];
    for (const r of missing)
      this.store.db
        .prepare('UPDATE songs SET uid = COALESCE(uid, ?), hash = COALESCE(hash, ?) WHERE id = ?')
        .run(randomUUID(), this.fileHash(r.id, !!r.audio), r.id);
  }

  /** The hash of what the server keeps of a song: its whole file, or its charts without the audio. */
  private fileHash(id: string, audio: boolean): string {
    const path = audio ? join(this.dirs.songs, `${id}.soundwave`) : join(this.dirs.charts, `${id}.json`);
    return existsSync(path) ? createHash('sha256').update(readFileSync(path)).digest('hex') : '';
  }

  /** Whether players can share songs here, and what of them is kept. */
  get sharing() {
    return this.config.songSharing;
  }

  private row(id: string): SongRow | undefined {
    return this.store.db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined;
  }

  private copyPath(id: string, quality: Exclude<StreamQuality, 'high'>) {
    return join(this.dirs.songs, `${id}.${quality}.soundwave`);
  }

  /** The smaller copies kept of a song. */
  private copies(id: string): StreamQuality[] {
    return STREAM_QUALITIES.filter((q) => q !== 'high' && existsSync(this.copyPath(id, q)));
  }

  private shared(r: SongRow & { name?: string | null }): SharedSong {
    return {
      qualities: r.audio ? this.copies(r.id) : [],
      id: r.id,
      uid: r.uid,
      hash: r.hash,
      title: r.title,
      artist: r.artist,
      duration: r.duration,
      size: r.size,
      audio: !!r.audio,
      cover: !!r.cover_type,
      by: r.name ?? null,
      created: r.created,
    };
  }

  /**
   * Takes a shared `.soundwave` file. The song's id is worked out here from its audio, so nobody can
   * share a song under another's id; on a charts-only server the audio is then thrown away.
   */
  async share(user: UserRow, body: Buffer): Promise<SharedSong> {
    // The owner and moderators build the server's library whatever players may share.
    const curator = canModerate(user);
    if (this.sharing === 'off' && !curator)
      throw new Refusal(403, 'This server does not take shared songs. Its owner can turn sharing on.');
    if (body.length > this.config.songMaxMb * MB) throw new Refusal(413, `A shared song can be at most ${this.config.songMaxMb} MB here.`);
    let c;
    try {
      c = await readSoundwave(new Blob([new Uint8Array(body)]));
    } catch (e) {
      throw new Refusal(400, (e as Error).message || 'That is not a Soundwave song file.');
    }
    const id = createHash('sha256')
      .update(new Uint8Array(await c.audio.arrayBuffer()))
      .digest('hex');
    const had = this.row(id);
    if (had) return this.shared({ ...had, name: this.store.userById(had.uploader ?? '')?.name });
    const keepAudio = curator || this.sharing === 'songs';
    const size = keepAudio ? body.length : 0;
    const used = (this.store.db.prepare('SELECT COALESCE(SUM(size), 0) AS n FROM songs WHERE uploader = ?').get(user.id) as { n: number })
      .n;
    if (!curator && used + size > this.config.quotaMb * MB)
      throw new Refusal(413, `That would take you past the ${this.config.quotaMb} MB each player can share here. Remove a song first.`);
    if (keepAudio) writeFileSync(join(this.dirs.songs, `${id}.soundwave`), body);
    writeFileSync(
      join(this.dirs.charts, `${id}.json`),
      JSON.stringify({ meta: c.meta, analysis: c.analysis ?? null, edits: c.edits ?? null }),
    );
    let coverType: string | null = null;
    if (c.cover) {
      coverType = c.cover.type;
      writeFileSync(join(this.dirs.covers, id), new Uint8Array(await c.cover.arrayBuffer()));
    }
    this.store.db
      .prepare(
        'INSERT INTO songs (id, uploader, title, artist, duration, size, audio, cover_type, created, uid, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        user.id,
        c.meta.title,
        c.meta.artist,
        c.meta.duration,
        size,
        keepAudio ? 1 : 0,
        coverType,
        this.now(),
        randomUUID(),
        this.fileHash(id, keepAudio),
      );
    return this.shared({ ...this.row(id)!, name: user.name });
  }

  /** The library, newest first, or the songs whose title or artist has `query` in it. */
  list(query = ''): SharedSong[] {
    const q = `%${query.trim().toLowerCase().replace(/[%_]/g, '')}%`;
    const rows = this.store.db
      .prepare(
        `SELECT s.*, u.name AS name FROM songs s LEFT JOIN users u ON u.id = s.uploader
         WHERE lower(s.title) LIKE ? OR lower(s.artist) LIKE ? ORDER BY s.created DESC LIMIT 200`,
      )
      .all(q, q) as unknown as (SongRow & { name: string | null })[];
    return rows.map((r) => this.shared(r));
  }

  /** Whether the server keeps this song's whole file (its audio too), for a party to fetch. */
  hasFile(id: string): boolean {
    return !!this.row(id)?.audio;
  }

  /** A whole song file to download, where the server keeps audio: in `quality` where that copy is kept, else as shared. */
  file(id: string, quality: StreamQuality = 'high'): { body: Buffer; quality: StreamQuality } {
    const r = this.row(id);
    if (!r) throw new Refusal(404, 'That song is not on this server.');
    if (!r.audio) throw new Refusal(404, 'This server keeps only the charts of shared songs: add your own copy of the song.');
    if (quality !== 'high' && existsSync(this.copyPath(id, quality))) return { body: readFileSync(this.copyPath(id, quality)), quality };
    return { body: readFileSync(join(this.dirs.songs, `${id}.soundwave`)), quality: 'high' };
  }

  /**
   * A smaller copy of a song for streaming, sent by a game (whoever shared the song, the owner or a
   * moderator): a song file whose details name the song it is of, smaller than the song as shared
   * and as long. It replaces a copy kept before.
   */
  async putCopy(actor: UserRow, id: string, quality: Exclude<StreamQuality, 'high'>, body: Buffer) {
    const r = this.row(id);
    if (!r?.audio) throw new Refusal(404, 'That song is not on this server.');
    if (r.uploader !== actor.id && !canModerate(actor))
      throw new Refusal(403, 'Only whoever shared a song, the owner and moderators send its smaller copies.');
    if (body.length >= r.size) throw new Refusal(400, 'A smaller copy has to be smaller than the song.');
    let c;
    try {
      c = await readSoundwave(new Blob([new Uint8Array(body)]));
    } catch (e) {
      throw new Refusal(400, (e as Error).message || 'That is not a Soundwave song file.');
    }
    if (c.meta.copyOf !== id) throw new Refusal(400, 'That copy is of another song.');
    if (Math.abs(c.meta.duration - r.duration) > 2) throw new Refusal(400, 'That copy is not as long as the song.');
    writeFileSync(this.copyPath(id, quality), body);
  }

  /** A song's details, analysis and hand-made charts, for a player who has the same audio. */
  charts(id: string): unknown {
    if (!this.row(id)) throw new Refusal(404, 'That song is not on this server.');
    return JSON.parse(readFileSync(join(this.dirs.charts, `${id}.json`), 'utf8'));
  }

  /** A shared song's cover, for the Discord status (only where the owner lets covers be public). */
  cover(id: string): { type: string; body: Buffer } {
    const r = this.row(id);
    const path = join(this.dirs.covers, id);
    if (!r?.cover_type || !existsSync(path)) throw new Refusal(404, 'That song has no cover here.');
    return { type: r.cover_type, body: readFileSync(path) };
  }

  /**
   * The owner or a moderator changes a song's title and artist on the server. Its file is written
   * anew, so its hash changes and every downloaded copy updates itself (the game checks).
   */
  async edit(actor: UserRow, id: string, change: { title?: unknown; artist?: unknown }): Promise<SharedSong> {
    if (!canModerate(actor)) throw new Refusal(403, 'Only the owner and moderators edit the server’s songs.');
    const r = this.row(id);
    if (!r) throw new Refusal(404, 'That song is not on this server.');
    const title = typeof change.title === 'string' ? change.title.trim().slice(0, 200) : r.title;
    const artist = typeof change.artist === 'string' ? change.artist.trim().slice(0, 200) : r.artist;
    if (!title) throw new Refusal(400, 'A song needs a title.');
    const chartsPath = join(this.dirs.charts, `${id}.json`);
    const charts = JSON.parse(readFileSync(chartsPath, 'utf8')) as { meta: Record<string, unknown> };
    charts.meta = { ...charts.meta, title, artist };
    writeFileSync(chartsPath, JSON.stringify(charts));
    if (r.audio)
      for (const path of [
        join(this.dirs.songs, `${id}.soundwave`),
        ...this.copies(id).map((q) => this.copyPath(id, q as 'medium' | 'low')),
      ]) {
        const c = await readSoundwave(new Blob([new Uint8Array(readFileSync(path))]));
        const file = await writeSoundwave({ ...c, meta: { ...c.meta, title, artist } });
        writeFileSync(path, new Uint8Array(await file.arrayBuffer()));
      }
    this.store.db
      .prepare('UPDATE songs SET title = ?, artist = ?, hash = ? WHERE id = ?')
      .run(title, artist, this.fileHash(id, !!r.audio), id);
    this.store.log({
      at: this.now(),
      actor: actor.id,
      action: `edit song "${r.title}"`,
      target: r.uploader ?? actor.id,
      reason: `now "${title}" by ${artist}`,
    });
    return this.shared({ ...this.row(id)!, name: this.store.userById(r.uploader ?? '')?.name });
  }

  /** Removes a song everywhere at once: its uploader can, and the owner and moderators. */
  remove(actor: UserRow, id: string, reason: unknown) {
    const r = this.row(id);
    if (!r) throw new Refusal(404, 'That song is not on this server.');
    const mod = canModerate(actor);
    if (r.uploader !== actor.id && !mod) throw new Refusal(403, 'Only whoever shared a song, and the moderators, can remove it.');
    this.store.db.prepare('DELETE FROM songs WHERE id = ?').run(id);
    this.store.db.prepare('DELETE FROM reports WHERE song = ?').run(id);
    for (const p of [
      join(this.dirs.songs, `${id}.soundwave`),
      this.copyPath(id, 'medium'),
      this.copyPath(id, 'low'),
      join(this.dirs.charts, `${id}.json`),
      join(this.dirs.covers, id),
    ])
      rmSync(p, { force: true });
    if (mod && r.uploader !== actor.id)
      this.store.log({
        at: this.now(),
        actor: actor.id,
        action: `remove song "${r.title}"`,
        target: r.uploader ?? actor.id,
        reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
      });
  }

  /** A player reports a song (a takedown request, say) for the owner and moderators to look at. */
  report(user: UserRow, id: string, reason: unknown) {
    if (!this.row(id)) throw new Refusal(404, 'That song is not on this server.');
    const why = typeof reason === 'string' ? reason.trim().slice(0, 1000) : '';
    if (!why) throw new Refusal(400, 'Say why you report it.');
    this.store.db.prepare('INSERT INTO reports (song, by, reason, at) VALUES (?, ?, ?, ?)').run(id, user.id, why, this.now());
  }

  reports(actor: UserRow) {
    if (!canModerate(actor)) throw new Refusal(403, 'Only the owner and moderators read the reports.');
    return this.store.db
      .prepare(
        `SELECT r.id, r.song AS songId, s.title, s.artist, u.name AS by, r.reason, r.at, up.name AS uploader
         FROM reports r JOIN songs s ON s.id = r.song LEFT JOIN users u ON u.id = r.by LEFT JOIN users up ON up.id = s.uploader
         ORDER BY r.at DESC LIMIT 200`,
      )
      .all();
  }

  /** What a player's data export carries of the songs they shared. */
  exportOf(user: UserRow) {
    return (this.store.db.prepare('SELECT * FROM songs WHERE uploader = ? ORDER BY created').all(user.id) as unknown as SongRow[]).map(
      (r) => ({
        id: r.id,
        title: r.title,
        artist: r.artist,
        sharedAt: new Date(r.created).toISOString(),
        withAudio: !!r.audio,
      }),
    );
  }
}
