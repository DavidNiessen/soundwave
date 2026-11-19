/**
 * The library backup: every song, best score, replay and setting in one file, to move the game to
 * another computer or keep it safe.
 *
 * The file is laid out like a song file (src/storage/soundwaveFile.ts): a 12-byte header, then
 * chunks of type, length, payload and CRC-32. Only the magic differs, so the two cannot be mixed
 * up. Every integer is little-endian.
 *
 *     offset  size  field
 *     0       8     magic, the ASCII bytes "SWBACKUP"
 *     8       2     format version (BACKUP_VERSION)
 *     10      2     reserved, 0
 *     12      ...   chunks
 *
 * Chunk types:
 *
 *     INFO  required, first. UTF-8 JSON: { createdAt, songs, replays } (the number of SONG and RPLY
 *           chunks).
 *     PREF  UTF-8 JSON: the game's stored preferences, { [storage key]: stored string }.
 *     SCOR  UTF-8 JSON: the best scores, as the database keeps them.
 *     RPLY  repeated. A saved replay's file (src/storage/replays.ts): its result, the chart it was
 *           played on and the run. Backups from before replays have none; readers that do not know
 *           the chunk pass it by.
 *     SONG  repeated, last. A whole song file, exactly as it would be exported on its own: details,
 *           cover, analysis, hand-edited charts and the audio.
 *
 * Songs are written last and are never read whole into memory: a backup is assembled from the
 * stored song files and written out piece by piece, and restoring reads one song at a time.
 */
import { DIFFICULTIES, PARTS, type Difficulty, type Part } from '../chart/types';
import { GOLD_STARS } from '../game/scoring';
import { getReplay, getSong, listAllScores, listReplays, listSongs, putReplay, submitScore, type BestScore } from './db';
import { readReplay, writeReplay } from './replays';
import { readSongPackage, songFile, storeSongPackage } from './songFile';

export const BACKUP_EXT = '.soundwave-backup';
export const BACKUP_MIME = 'application/x-soundwave-backup';
export const BACKUP_VERSION = 1;

const MAGIC = 'SWBACKUP';
const HEADER = 12;
const CHUNK_HEAD = 8;
const CRC = 4;
/** Largest INFO, PREF or SCOR payload read. */
const MAX_SMALL = 16 * 1024 * 1024;
/** Longest stored preference kept. */
const MAX_PREF = 1024 * 1024;

export class BackupError extends Error {}

/* CRC-32 (IEEE), fed piece by piece ------------------------------------------------------- */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const crcStep = (c: number, bytes: Uint8Array) => {
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return c;
};

/** CRC-32 of a chunk's type and payload, reading the payload as a stream. */
async function chunkCrc(type: string, payload: Blob): Promise<number> {
  let c = crcStep(0xffffffff, ascii(type));
  const reader = payload.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    c = crcStep(c, value);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/* Writing --------------------------------------------------------------------------------- */

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0x7f);
const utf8 = new TextEncoder();

/** A chunk as blob parts: the payload stays a reference to its blob, never copied. */
async function chunk(type: string, payload: Blob): Promise<BlobPart[]> {
  const head = new Uint8Array(CHUNK_HEAD);
  head.set(ascii(type), 0);
  new DataView(head.buffer).setUint32(4, payload.size, true);
  const crc = new Uint8Array(CRC);
  new DataView(crc.buffer).setUint32(0, await chunkCrc(type, payload), true);
  return [head, payload, crc];
}

const json = (v: unknown) => new Blob([utf8.encode(JSON.stringify(v))]);

/**
 * The game's own stored preferences: settings, setlist, sort orders. Not developer overrides, and
 * not what is only remembered about this machine (`soundwave.cache.`, such as its graphics card).
 */
export function preferenceKeys(keys: Iterable<string>): string[] {
  return [...keys].filter((k) => k.startsWith('soundwave.') && !k.startsWith('soundwave.dev.') && !k.startsWith('soundwave.cache.'));
}

function readPreferences(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k);
    for (const k of preferenceKeys(keys)) {
      const v = localStorage.getItem(k);
      if (v !== null) out[k] = v;
    }
  } catch {
    /* storage unavailable: the backup carries no preferences */
  }
  return out;
}

/** Removes the game's stored preferences (the same ones a backup carries), back to how it came. */
export function clearPreferences() {
  try {
    const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((k): k is string => !!k);
    for (const k of preferenceKeys(keys)) localStorage.removeItem(k);
  } catch {
    /* storage unavailable: nothing is stored */
  }
}

export interface BackupProgress {
  /** Songs packed (export) or added (import) so far, of `total` (the replays are not counted: they are small). */
  done: number;
  total: number;
}

/** What goes into a backup. */
export interface BackupInput {
  createdAt: number;
  preferences: Record<string, string>;
  scores: unknown[];
  /** Each song's .soundwave file, or how to get it (fetched only when its turn comes). */
  songs: (Blob | (() => Promise<Blob>))[];
  /** Each saved replay's file, or how to get it (absent: none). */
  replays?: (Blob | (() => Promise<Blob | null>))[];
}

/** Lays a backup out. The song files are referenced, not copied. */
export async function packBackup(b: BackupInput, onSong?: (done: number) => void): Promise<Blob> {
  const header = new Uint8Array(HEADER);
  header.set(ascii(MAGIC), 0);
  new DataView(header.buffer).setUint16(8, BACKUP_VERSION, true);
  const parts: BlobPart[] = [header];
  const replays: Blob[] = [];
  for (const r of b.replays ?? []) {
    const file = typeof r === 'function' ? await r() : r;
    if (file) replays.push(file);
  }
  parts.push(...(await chunk('INFO', json({ createdAt: b.createdAt, songs: b.songs.length, replays: replays.length }))));
  parts.push(...(await chunk('PREF', json(b.preferences))));
  parts.push(...(await chunk('SCOR', json(b.scores))));
  for (const r of replays) parts.push(...(await chunk('RPLY', r)));
  for (let i = 0; i < b.songs.length; i++) {
    const s = b.songs[i];
    parts.push(...(await chunk('SONG', typeof s === 'function' ? await s() : s)));
    onSong?.(i + 1);
  }
  return new Blob(parts, { type: BACKUP_MIME });
}

/** Packs this library into one backup file. */
export async function writeBackup(onProgress?: (p: BackupProgress) => void): Promise<{ file: Blob; songs: number }> {
  const list = await listSongs();
  const total = list.length;
  onProgress?.({ done: 0, total });
  // Each song's own file, brought up to date with its analysis and edits as it is packed.
  const songs = list.map((s) => () => songFile(s.id));
  const replays = (await listReplays().catch(() => [])).map((r) => async () => {
    const whole = await getReplay(r.id);
    return whole ? writeReplay(whole) : null;
  });
  const file = await packBackup(
    { createdAt: Date.now(), preferences: readPreferences(), scores: await listAllScores().catch(() => []), songs, replays },
    (done) => onProgress?.({ done, total }),
  );
  return { file, songs: total };
}

/** "Soundwave library 2026-11-18.soundwave-backup" */
export function backupFileName(date = new Date()): string {
  const d = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `Soundwave library ${d}${BACKUP_EXT}`;
}

/* Reading --------------------------------------------------------------------------------- */

interface ChunkRef {
  type: string;
  offset: number;
  length: number;
}

async function read(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

async function index(blob: Blob): Promise<ChunkRef[]> {
  const head = blob.size >= HEADER ? await read(blob, 0, HEADER) : new Uint8Array();
  if (String.fromCharCode(...head.subarray(0, 8)) !== MAGIC) throw new BackupError('This is not a Soundwave library backup.');
  if (new DataView(head.buffer).getUint16(8, true) > BACKUP_VERSION)
    throw new BackupError('This backup was made by a newer version of Soundwave. Update the game to import it.');
  const refs: ChunkRef[] = [];
  let at = HEADER;
  while (at < blob.size) {
    if (at + CHUNK_HEAD + CRC > blob.size) throw new BackupError('This backup is cut short.');
    const h = await read(blob, at, CHUNK_HEAD);
    const type = String.fromCharCode(...h.subarray(0, 4));
    const length = new DataView(h.buffer).getUint32(4, true);
    if (!/^[A-Z0-9]{4}$/.test(type) || at + CHUNK_HEAD + length + CRC > blob.size) throw new BackupError('This backup is damaged.');
    refs.push({ type, offset: at + CHUNK_HEAD, length });
    at += CHUNK_HEAD + length + CRC;
  }
  return refs;
}

/** A chunk's payload, checked against its CRC. */
async function payload(blob: Blob, ref: ChunkRef): Promise<Blob> {
  const data = blob.slice(ref.offset, ref.offset + ref.length);
  const stored = new DataView((await read(blob, ref.offset + ref.length, CRC)).buffer).getUint32(0, true);
  if ((await chunkCrc(ref.type, data)) !== stored) throw new BackupError('This backup is damaged.');
  return data;
}

async function smallJson(blob: Blob, ref: ChunkRef | undefined): Promise<unknown> {
  if (!ref) return undefined;
  if (ref.length > MAX_SMALL) throw new BackupError('This backup is damaged.');
  try {
    return JSON.parse(await (await payload(blob, ref)).text());
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError('This backup is damaged.');
  }
}

const isPart = (v: unknown): v is Part => PARTS.includes(v as Part);
const isDifficulty = (v: unknown): v is Difficulty => DIFFICULTIES.includes(v as Difficulty);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function cleanScores(raw: unknown): Omit<BestScore, 'key' | 'date'>[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((s) => {
    if (!s || typeof s !== 'object') return [];
    const { songId, part, difficulty, score, stars, accuracy, fullCombo } = s as Record<string, unknown>;
    if (
      typeof songId !== 'string' ||
      songId.length > 200 ||
      !isPart(part) ||
      !isDifficulty(difficulty) ||
      !finite(score) ||
      !finite(stars) ||
      !finite(accuracy)
    )
      return [];
    return [
      {
        songId,
        part,
        difficulty,
        score: Math.max(0, score),
        stars: Math.min(GOLD_STARS, Math.max(0, Math.round(stars))),
        accuracy: Math.min(1, Math.max(0, accuracy)),
        fullCombo: fullCombo === true,
      },
    ];
  });
}

function cleanPreferences(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter(
    (e): e is [string, string] => typeof e[1] === 'string' && e[1].length <= MAX_PREF,
  );
  const keys = new Set(preferenceKeys(entries.map(([k]) => k)));
  return Object.fromEntries(entries.filter(([k]) => keys.has(k)));
}

/** What a backup holds, read without unpacking its songs. */
export interface BackupContents {
  createdAt?: number;
  /** Each song's file, a slice of the backup. */
  songs: Blob[];
  /** Each saved replay's file, a slice of the backup. */
  replays: Blob[];
  scores: Omit<BestScore, 'key' | 'date'>[];
  preferences: Record<string, string>;
}

export async function readBackup(file: Blob): Promise<BackupContents> {
  const refs = await index(file);
  const info = (await smallJson(
    file,
    refs.find((r) => r.type === 'INFO'),
  )) as { createdAt?: unknown } | undefined;
  if (!info || typeof info !== 'object') throw new BackupError('This backup is damaged.');
  return {
    createdAt: finite(info.createdAt) ? info.createdAt : undefined,
    // Each song is checked by its own file's checksums as it is restored, one at a time.
    songs: refs.filter((r) => r.type === 'SONG').map((r) => file.slice(r.offset, r.offset + r.length)),
    // Replays are small: each is checked against its checksum here, and a damaged one is left out.
    replays: (await Promise.all(refs.filter((r) => r.type === 'RPLY').map((r) => payload(file, r).catch(() => null)))).filter(
      (r): r is Blob => r !== null,
    ),
    scores: cleanScores(
      await smallJson(
        file,
        refs.find((r) => r.type === 'SCOR'),
      ),
    ),
    preferences: cleanPreferences(
      await smallJson(
        file,
        refs.find((r) => r.type === 'PREF'),
      ),
    ),
  };
}

export interface RestoreResult {
  added: number;
  /** Already in the library: left as they are. */
  kept: number;
  failed: number;
  /** Replays added (ones already here are left as they are). */
  replays: number;
}

/**
 * Restores a backup into this library. Songs not here yet are added with their charts; songs
 * already here are left as they are. Each best score is kept where it beats the one here. The
 * backup's preferences replace this device's. The caller reloads the game afterwards.
 */
export async function restoreBackup(b: BackupContents, onProgress?: (p: BackupProgress) => void): Promise<RestoreResult> {
  const result: RestoreResult = { added: 0, kept: 0, failed: 0, replays: 0 };
  onProgress?.({ done: 0, total: b.songs.length });
  for (let i = 0; i < b.songs.length; i++) {
    try {
      const song = await readSongPackage(b.songs[i], 'song');
      if (await getSong(song.meta.id)) result.kept++;
      else {
        await storeSongPackage(song);
        result.added++;
      }
    } catch (e) {
      console.warn('could not restore a song from the backup', e);
      result.failed++;
    }
    onProgress?.({ done: i + 1, total: b.songs.length });
  }
  // Replays carry their own chart, so they are kept whether or not their song came along. A
  // damaged one is passed by.
  for (const r of b.replays) {
    try {
      if (await putReplay(await readReplay(r))) result.replays++;
    } catch (e) {
      console.warn('could not restore a replay from the backup', e);
    }
  }
  // Scores only for songs the library now has.
  const here = new Map<string, boolean>();
  for (const s of b.scores) {
    if (!here.has(s.songId)) here.set(s.songId, !!(await getSong(s.songId).catch(() => undefined)));
    if (here.get(s.songId)) await submitScore(s).catch(() => {});
  }
  try {
    for (const [k, v] of Object.entries(b.preferences)) localStorage.setItem(k, v);
  } catch {
    /* storage unavailable: the preferences stay as they were */
  }
  return result;
}

export const isBackupFile = (f: File) => f.name.toLowerCase().endsWith(BACKUP_EXT);
