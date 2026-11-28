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
 *
 * The same song shared twice in other files (an MP3 and a FLAC) has another id, so songs are also
 * compared by their loudness, length and name (src/net/similarity.ts): the same recording again is
 * refused (an admin can add it anyway), and the admin page lists what may be the same song twice.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSoundwave, writeSoundwave } from '../../src/storage/soundwaveFile.ts';
import { STREAM_QUALITIES, type DuplicatePair, type SharedSong, type StreamQuality } from '../../src/net/protocol.ts';
import { coarseEnergy, likeness, nameKey, type Fingerprint } from '../../src/net/similarity.ts';
import { Refusal } from './accounts.ts';
import type { Config } from './config.ts';
import type { Store, UserRow } from './db.ts';
import { contentsOf, hashOf } from './soundwave.ts';

const MB = 1024 * 1024;
/** The biggest cover kept of a shared song (a bigger one is left out): a cover is a picture of a few hundred KB. */
const COVER_MAX = 4 * MB;
/** The most a song's details, analysis and hand-made charts may take as JSON: a real one is a few MB. */
const CHARTS_MAX = 32 * MB;
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
        uid TEXT NOT NULL UNIQUE,
        hash TEXT NOT NULL,
        stored INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS not_duplicates (
        a TEXT NOT NULL,
        b TEXT NOT NULL,
        PRIMARY KEY (a, b)
      );
      CREATE TABLE IF NOT EXISTS reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        song TEXT NOT NULL,
        by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `);
    // Songs shared on a server from before songs had internal ids and file hashes get theirs.
    const had = store.columnsOf('songs');
    if (!had.includes('uid')) store.db.exec('ALTER TABLE songs ADD COLUMN uid TEXT');
    if (!had.includes('hash')) store.db.exec('ALTER TABLE songs ADD COLUMN hash TEXT');
    const missing = store.db.prepare('SELECT id, audio FROM songs WHERE uid IS NULL OR hash IS NULL').all() as {
      id: string;
      audio: number;
    }[];
    for (const r of missing)
      store.db
        .prepare('UPDATE songs SET uid = COALESCE(uid, ?), hash = COALESCE(hash, ?) WHERE id = ?')
        .run(randomUUID(), this.fileHash(r.id, !!r.audio), r.id);
    store.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS songs_uid ON songs(uid)');
    // What each song takes on disk, for the quota (servers from before kept only the audio's size).
    const columns = store.db.prepare('PRAGMA table_info(songs)').all() as { name: string }[];
    if (!columns.some((c) => c.name === 'stored')) {
      store.db.exec('ALTER TABLE songs ADD COLUMN stored INTEGER NOT NULL DEFAULT 0');
      for (const r of store.db.prepare('SELECT id FROM songs').all() as { id: string }[]) {
        const bytes = [join(this.dirs.songs, `${r.id}.soundwave`), this.copyPath(r.id, 'medium'), this.copyPath(r.id, 'low')]
          .concat([join(this.dirs.charts, `${r.id}.json`), join(this.dirs.covers, r.id)])
          .reduce((n, p) => n + (existsSync(p) ? statSync(p).size : 0), 0);
        store.db.prepare('UPDATE songs SET stored = ? WHERE id = ?').run(bytes, r.id);
      }
    }
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

  /** Each song's fingerprint, read from its charts once. */
  private prints = new Map<string, Fingerprint>();

  private static fingerprintOf(meta: { title?: unknown; artist?: unknown; duration?: unknown }, analysis: unknown): Fingerprint {
    const a = (analysis as { data?: { energy?: unknown; energyHop?: unknown } } | null)?.data;
    const energy = Array.isArray(a?.energy) && typeof a.energyHop === 'number' ? coarseEnergy(a.energy as number[], a.energyHop) : [];
    return {
      energy,
      duration: typeof meta.duration === 'number' ? meta.duration : 0,
      title: nameKey(typeof meta.title === 'string' ? meta.title : ''),
      artist: nameKey(typeof meta.artist === 'string' ? meta.artist : ''),
    };
  }

  private fingerprint(id: string): Fingerprint {
    let fp = this.prints.get(id);
    if (!fp) {
      try {
        const charts = JSON.parse(readFileSync(join(this.dirs.charts, `${id}.json`), 'utf8')) as {
          meta: Record<string, unknown>;
          analysis: unknown;
        };
        fp = Songs.fingerprintOf(charts.meta, charts.analysis);
      } catch {
        const r = this.row(id);
        fp = { energy: [], duration: r?.duration ?? 0, title: nameKey(r?.title ?? ''), artist: nameKey(r?.artist ?? '') };
      }
      this.prints.set(id, fp);
    }
    return fp;
  }

  /** The songs here that `fp` is like, most alike first. */
  private like(fp: Fingerprint, except?: string): { row: SongRow; kind: 'same' | 'likely'; score: number }[] {
    const rows = this.store.db
      .prepare('SELECT * FROM songs WHERE duration BETWEEN ? AND ?')
      .all(fp.duration - 6, fp.duration + 6) as unknown as SongRow[];
    return rows
      .filter((r) => r.id !== except)
      .map((row) => ({ row, match: likeness(fp, this.fingerprint(row.id)) }))
      .filter((x): x is { row: SongRow; match: { kind: 'same' | 'likely'; score: number } } => !!x.match)
      .map(({ row, match }) => ({ row, ...match }))
      .sort((a, b) => (a.kind === b.kind ? b.score - a.score : a.kind === 'same' ? -1 : 1));
  }

  /**
   * Songs on the server that may be the same song twice, for the owner and moderators to look at:
   * every pair alike enough, but those already said not to be.
   */
  duplicates(actor: UserRow): DuplicatePair[] {
    if (!canModerate(actor)) throw new Refusal(403, 'Only the owner and moderators look for duplicates.');
    const rows = this.store.db
      .prepare('SELECT s.*, u.name AS name FROM songs s LEFT JOIN users u ON u.id = s.uploader ORDER BY s.duration')
      .all() as unknown as (SongRow & { name: string | null })[];
    const ok = new Set(
      (this.store.db.prepare('SELECT a, b FROM not_duplicates').all() as { a: string; b: string }[]).map((p) => `${p.a}/${p.b}`),
    );
    const pairs: DuplicatePair[] = [];
    // Sorted by length, each song is only compared with those close to it in length.
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length && rows[j].duration - rows[i].duration <= 6; j++) {
        const [a, b] = [rows[i], rows[j]].sort((x, y) => (x.id < y.id ? -1 : 1));
        if (ok.has(`${a.id}/${b.id}`)) continue;
        const match = likeness(this.fingerprint(a.id), this.fingerprint(b.id));
        if (match) pairs.push({ a: this.shared(a), b: this.shared(b), ...match });
      }
    return pairs.sort((x, y) => (x.kind === y.kind ? y.score - x.score : x.kind === 'same' ? -1 : 1));
  }

  /** The owner or a moderator says two songs are not the same: the pair is not listed again. */
  notDuplicates(actor: UserRow, a: unknown, b: unknown) {
    if (!canModerate(actor)) throw new Refusal(403, 'Only the owner and moderators look for duplicates.');
    if (typeof a !== 'string' || typeof b !== 'string' || !this.row(a) || !this.row(b))
      throw new Refusal(404, 'That song is not on this server.');
    const [x, y] = [a, b].sort();
    this.store.db.prepare('INSERT OR IGNORE INTO not_duplicates (a, b) VALUES (?, ?)').run(x, y);
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
  async share(user: UserRow, body: Buffer, force = false): Promise<SharedSong> {
    // The owner and moderators build the server's library whatever players may share.
    const curator = canModerate(user);
    if (this.sharing === 'off' && !curator)
      throw new Refusal(403, 'This server does not take shared songs. Its owner can turn sharing on.');
    if (body.length > this.config.songMaxMb * MB) throw new Refusal(413, `A shared song can be at most ${this.config.songMaxMb} MB here.`);
    const c = await contentsOf(body);
    const id = await hashOf(c.audio);
    // Everything that takes waiting is done first: from here to the insert nothing awaits, so no
    // other upload can come between the quota check and the song taking its place.
    const cover = c.cover && c.cover.size <= COVER_MAX ? { type: c.cover.type, bytes: new Uint8Array(await c.cover.arrayBuffer()) } : null;
    const charts = JSON.stringify({ meta: c.meta, analysis: c.analysis ?? null, edits: c.edits ?? null });
    if (charts.length > CHARTS_MAX) throw new Refusal(413, 'This song’s analysis is too big to share here.');
    const had = this.row(id);
    if (had) return this.shared({ ...had, name: this.store.userById(had.uploader ?? '')?.name });
    // The same recording in another file is not taken twice (an admin may add it anyway).
    const fp = Songs.fingerprintOf(c.meta, c.analysis ?? null);
    const twin = this.like(fp).find((x) => x.kind === 'same');
    if (twin && !(force && curator))
      throw new Refusal(409, `This song is already on the server as "${twin.row.title}" by ${twin.row.artist}.`);
    const keepAudio = curator || this.sharing === 'songs';
    const size = keepAudio ? body.length : 0;
    // What the song takes on the server's disk, its charts and cover too, counts against the quota.
    const stored = size + Buffer.byteLength(charts) + (cover?.bytes.length ?? 0);
    if (!curator && this.used(user.id) + stored > this.config.quotaMb * MB)
      throw new Refusal(413, `That would take you past the ${this.config.quotaMb} MB each player can share here. Remove a song first.`);
    if (keepAudio) writeFileSync(join(this.dirs.songs, `${id}.soundwave`), body);
    writeFileSync(join(this.dirs.charts, `${id}.json`), charts);
    if (cover) writeFileSync(join(this.dirs.covers, id), cover.bytes);
    const hash = createHash('sha256')
      .update(keepAudio ? body : charts)
      .digest('hex');
    this.store.db
      .prepare(
        'INSERT INTO songs (id, uploader, title, artist, duration, size, audio, cover_type, created, uid, hash, stored) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        user.id,
        c.meta.title,
        c.meta.artist,
        c.meta.duration,
        size,
        keepAudio ? 1 : 0,
        cover?.type ?? null,
        this.now(),
        randomUUID(),
        hash,
        stored,
      );
    return this.shared({ ...this.row(id)!, name: user.name });
  }

  /** What a player's shared songs take on the server's disk, bytes. */
  private used(user: string): number {
    return (this.store.db.prepare('SELECT COALESCE(SUM(stored), 0) AS n FROM songs WHERE uploader = ?').get(user) as { n: number }).n;
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
    // Only its details are needed: its analysis is not inflated.
    const c = await contentsOf(body, false);
    if (c.meta.copyOf !== id) throw new Refusal(400, 'That copy is of another song.');
    if (Math.abs(c.meta.duration - r.duration) > 2) throw new Refusal(400, 'That copy is not as long as the song.');
    // The copy counts against its sharer's quota, in place of one it replaces. Read again after the
    // wait above, and nothing awaited from here on, so two copies at once cannot both slip past it.
    const now = this.row(id);
    if (!now?.audio) throw new Refusal(404, 'That song is not on this server.');
    const path = this.copyPath(id, quality);
    const before = existsSync(path) ? statSync(path).size : 0;
    const uploader = now.uploader ? this.store.userById(now.uploader) : undefined;
    if (uploader && !canModerate(uploader) && this.used(uploader.id) - before + body.length > this.config.quotaMb * MB)
      throw new Refusal(413, `That copy would take its sharer past the ${this.config.quotaMb} MB each player can share here.`);
    writeFileSync(path, body);
    this.store.db.prepare('UPDATE songs SET stored = stored - ? + ? WHERE id = ?').run(before, body.length, id);
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
    this.prints.delete(id);
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
    this.store.db.prepare('DELETE FROM not_duplicates WHERE a = ? OR b = ?').run(id, id);
    this.prints.delete(id);
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
