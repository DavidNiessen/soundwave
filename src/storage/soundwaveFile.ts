/**
 * The .soundwave song file: one file that carries a song whole, so it can be kept, moved and shared.
 *
 * It holds the song's details (title, artist, album, length), its cover, the analysis its charts are
 * built from, any charts edited by hand, and the original audio file byte for byte. A friend who opens it plays the same charts
 * without analyzing the song again, and because the song's id is the hash of its audio, the same song
 * imported twice is recognised.
 *
 * Layout, every integer little-endian:
 *
 *     offset  size  field
 *     0       8     magic, the ASCII bytes "SOUNDWAV"
 *     8       2     format version (FORMAT_VERSION)
 *     10      2     reserved, 0
 *     12      ...   chunks, one after another to the end of the file
 *
 *     chunk:  4     type, four ASCII letters
 *             4     payload length n
 *             n     payload
 *             4     CRC-32 of the type and the payload
 *
 * Chunk types:
 *
 *     META  required. UTF-8 JSON: { title, artist, album?, duration, fileName, addedAt?, copyOf? }
 *           (copyOf: on a server's smaller copy of a song for streaming, the id of the song it is of).
 *     COVR  optional. The cover image: u8 length m, m bytes of ASCII MIME type, then the image.
 *     ANLS  optional. The analysis: u16 analysis version, then gzip-compressed UTF-8 JSON of it.
 *     EDIT  optional. Charts made or changed by hand in the track editor, and the beat grid they sit
 *           on: u16 edits version, then gzip-compressed UTF-8 JSON (src/editor/edits.ts).
 *     AUDI  required. The audio: u8 length m, m bytes of ASCII MIME type, then the audio file.
 *
 * Readers skip chunk types they do not know, so later versions can add chunks. AUDI is written
 * last: everything before it is small, and the audio can be sliced out without reading it.
 */

export const SOUNDWAVE_EXT = '.soundwave';
export const SOUNDWAVE_MIME = 'application/x-soundwave';
export const FORMAT_VERSION = 1;

const MAGIC = 'SOUNDWAV';
const HEADER = 12;
const CHUNK_HEAD = 8;
const CRC = 4;

/** Longest text kept from a file's details; anything past it is cut. */
const MAX_TEXT = 300;
/** Largest META, ANLS or EDIT payload read (analysis JSON of a long song is well under this, compressed). */
const MAX_SMALL_CHUNK = 32 * 1024 * 1024;
/**
 * The most an ANLS or EDIT payload may inflate to. An hour-long song's analysis is a few MB of
 * JSON, so this is far past any real one; a small file made to inflate to gigabytes stops here
 * instead of filling the memory of whoever opens it (a player's browser, or a server).
 */
export const MAX_INFLATED = 64 * 1024 * 1024;
/** The most chunks a file may have: a real one has five at most, and walking each costs a read. */
const MAX_CHUNKS = 1000;
const COVER_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface SoundwaveMeta {
  title: string;
  artist: string;
  album?: string;
  duration: number;
  fileName: string;
  addedAt?: number;
  /** A server's smaller copy of a song, for streaming: the id (audio hash) of the song it was made of. */
  copyOf?: string;
}

export interface SoundwaveAnalysis {
  version: number;
  data: unknown;
}

/** Hand-edited charts, as the editor stores them. Readers check `data` before using it. */
export interface SoundwaveEdits {
  version: number;
  data: unknown;
}

export interface SoundwaveContents {
  meta: SoundwaveMeta;
  cover?: Blob;
  analysis?: SoundwaveAnalysis;
  edits?: SoundwaveEdits;
  /** The original audio file, typed with its MIME type. */
  audio: Blob;
}

export class SoundwaveFileError extends Error {}

/* CRC-32 (IEEE) --------------------------------------------------------------------------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(parts: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const p of parts) for (let i = 0; i < p.length; i++) c = CRC_TABLE[(c ^ p[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* Writing --------------------------------------------------------------------------------- */

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0x7f);
const utf8 = new TextEncoder();

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const typeBytes = ascii(type);
  const out = new Uint8Array(CHUNK_HEAD + payload.length + CRC);
  out.set(typeBytes, 0);
  const view = new DataView(out.buffer);
  view.setUint32(4, payload.length, true);
  out.set(payload, CHUNK_HEAD);
  view.setUint32(CHUNK_HEAD + payload.length, crc32([typeBytes, payload]), true);
  return out;
}

/** A payload that starts with its MIME type (COVR, AUDI). */
function typed(mime: string, data: Uint8Array): Uint8Array {
  const m = ascii(mime.slice(0, 255));
  const out = new Uint8Array(1 + m.length + data.length);
  out[0] = m.length;
  out.set(m, 1);
  out.set(data, 1 + m.length);
  return out;
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const gzip = (data: Uint8Array) => bytesOf(new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('gzip')));
/** Inflates gzip data, counting what comes out, and gives up past MAX_INFLATED. */
async function gunzip(data: Uint8Array): Promise<Uint8Array> {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_INFLATED) {
      await reader.cancel().catch(() => {});
      throw new SoundwaveFileError('This song file is damaged.');
    }
    parts.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** A payload that starts with a version and carries gzip-compressed JSON (ANLS, EDIT). */
async function versioned(v: { version: number; data: unknown }): Promise<Uint8Array> {
  const json = await gzip(utf8.encode(JSON.stringify(v.data)));
  const payload = new Uint8Array(2 + json.length);
  new DataView(payload.buffer).setUint16(0, v.version, true);
  payload.set(json, 2);
  return payload;
}

async function readVersioned(data: Uint8Array): Promise<{ version: number; data: unknown } | undefined> {
  try {
    const version = new DataView(data.buffer, data.byteOffset, 2).getUint16(0, true);
    const json = await gunzip(data.subarray(2));
    return { version, data: JSON.parse(new TextDecoder().decode(json)) };
  } catch {
    return undefined;
  }
}

/** Builds a .soundwave file. */
export async function writeSoundwave(c: SoundwaveContents): Promise<Blob> {
  const header = new Uint8Array(HEADER);
  header.set(ascii(MAGIC), 0);
  new DataView(header.buffer).setUint16(8, FORMAT_VERSION, true);
  const meta: SoundwaveMeta = {
    title: c.meta.title,
    artist: c.meta.artist,
    ...(c.meta.album ? { album: c.meta.album } : {}),
    duration: c.meta.duration,
    fileName: c.meta.fileName,
    ...(c.meta.addedAt ? { addedAt: c.meta.addedAt } : {}),
    ...(c.meta.copyOf ? { copyOf: c.meta.copyOf } : {}),
  };
  const parts: Uint8Array[] = [header, chunk('META', utf8.encode(JSON.stringify(meta)))];
  if (c.cover) parts.push(chunk('COVR', typed(c.cover.type || 'image/jpeg', new Uint8Array(await c.cover.arrayBuffer()))));
  if (c.analysis) parts.push(chunk('ANLS', await versioned(c.analysis)));
  if (c.edits) parts.push(chunk('EDIT', await versioned(c.edits)));
  parts.push(chunk('AUDI', typed(c.audio.type || 'application/octet-stream', new Uint8Array(await c.audio.arrayBuffer()))));
  return new Blob(parts as Uint8Array<ArrayBuffer>[], { type: SOUNDWAVE_MIME });
}

/* Reading --------------------------------------------------------------------------------- */

interface ChunkRef {
  type: string;
  /** Where the payload starts in the file. */
  offset: number;
  length: number;
}

async function read(blob: Blob, start: number, length: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, start + length).arrayBuffer());
}

/** Whether a blob starts like a .soundwave file. */
export async function isSoundwave(blob: Blob): Promise<boolean> {
  if (blob.size < HEADER) return false;
  const head = await read(blob, 0, MAGIC.length);
  return String.fromCharCode(...head) === MAGIC;
}

/** The file's chunks, found by reading only their headers. */
async function index(blob: Blob): Promise<ChunkRef[]> {
  if (!(await isSoundwave(blob))) throw new SoundwaveFileError('This is not a Soundwave song file.');
  const version = new DataView((await read(blob, 8, 2)).buffer).getUint16(0, true);
  if (version > FORMAT_VERSION)
    throw new SoundwaveFileError('This song file was made by a newer version of Soundwave. Update the game to open it.');
  const refs: ChunkRef[] = [];
  let at = HEADER;
  while (at < blob.size) {
    if (at + CHUNK_HEAD + CRC > blob.size) throw new SoundwaveFileError('This song file is cut short.');
    const head = await read(blob, at, CHUNK_HEAD);
    const type = String.fromCharCode(...head.subarray(0, 4));
    const length = new DataView(head.buffer).getUint32(4, true);
    if (!/^[A-Z0-9]{4}$/.test(type) || at + CHUNK_HEAD + length + CRC > blob.size)
      throw new SoundwaveFileError('This song file is damaged.');
    if (refs.length >= MAX_CHUNKS) throw new SoundwaveFileError('This song file is damaged.');
    refs.push({ type, offset: at + CHUNK_HEAD, length });
    at += CHUNK_HEAD + length + CRC;
  }
  return refs;
}

async function payload(blob: Blob, ref: ChunkRef, verify: boolean): Promise<Uint8Array> {
  const data = await read(blob, ref.offset, ref.length);
  if (verify) {
    const stored = new DataView((await read(blob, ref.offset + ref.length, CRC)).buffer).getUint32(0, true);
    if (crc32([ascii(ref.type), data]) !== stored) throw new SoundwaveFileError('This song file is damaged.');
  }
  return data;
}

function splitTyped(data: Uint8Array): { mime: string; body: Uint8Array } {
  const m = data[0] ?? 0;
  if (1 + m > data.length) throw new SoundwaveFileError('This song file is damaged.');
  return { mime: String.fromCharCode(...data.subarray(1, 1 + m)), body: data.subarray(1 + m) };
}

const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_TEXT) : fallback);

function parseMeta(data: Uint8Array): SoundwaveMeta {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new SoundwaveFileError('This song file is damaged.');
  }
  if (!raw || typeof raw !== 'object') throw new SoundwaveFileError('This song file is damaged.');
  const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration > 0 ? raw.duration : 0;
  const addedAt = typeof raw.addedAt === 'number' && Number.isFinite(raw.addedAt) ? raw.addedAt : undefined;
  const album = text(raw.album, '');
  return {
    title: text(raw.title, 'Untitled'),
    artist: text(raw.artist, 'Unknown artist'),
    ...(album ? { album } : {}),
    duration,
    fileName: text(raw.fileName, 'song'),
    ...(addedAt ? { addedAt } : {}),
    ...(typeof raw.copyOf === 'string' && /^[0-9a-f]{64}$/.test(raw.copyOf) ? { copyOf: raw.copyOf } : {}),
  };
}

const MIME = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/i;

/**
 * Reads a whole .soundwave file and checks every chunk. For files from elsewhere: whatever is
 * malformed throws a SoundwaveFileError, and a cover or analysis that cannot be used is left out.
 * `analysis: false` leaves the analysis and edits out unread, for a reader that needs only the
 * details and the audio (a server checking whose song a file is), so it never inflates them.
 */
export async function readSoundwave(blob: Blob, options: { analysis?: boolean } = {}): Promise<SoundwaveContents> {
  const refs = await index(blob);
  const find = (type: string) => refs.find((r) => r.type === type);
  const metaRef = find('META');
  const audioRef = find('AUDI');
  if (!metaRef || !audioRef) throw new SoundwaveFileError('This song file has no song in it.');
  if (metaRef.length > MAX_SMALL_CHUNK) throw new SoundwaveFileError('This song file is damaged.');
  const meta = parseMeta(await payload(blob, metaRef, true));

  const audioData = splitTyped(await payload(blob, audioRef, true));
  if (!audioData.body.length) throw new SoundwaveFileError('This song file has no song in it.');
  const audio = new Blob([audioData.body as Uint8Array<ArrayBuffer>], {
    type: MIME.test(audioData.mime) ? audioData.mime : 'application/octet-stream',
  });

  let cover: Blob | undefined;
  const coverRef = find('COVR');
  if (coverRef) {
    const c = splitTyped(await payload(blob, coverRef, true));
    if (COVER_TYPES.includes(c.mime.toLowerCase()) && c.body.length)
      cover = new Blob([c.body as Uint8Array<ArrayBuffer>], { type: c.mime.toLowerCase() });
  }

  // An analysis or edits that cannot be read are left out: the song is analyzed again when played.
  const small = async (type: string) => {
    const ref = find(type);
    if (!ref || ref.length <= 2 || ref.length > MAX_SMALL_CHUNK) return undefined;
    return readVersioned(await payload(blob, ref, true));
  };
  const inflate = options.analysis !== false;
  const analysis: SoundwaveAnalysis | undefined = inflate ? await small('ANLS') : undefined;
  const edits: SoundwaveEdits | undefined = inflate ? await small('EDIT') : undefined;
  return { meta, cover, analysis, edits, audio };
}

/**
 * The audio inside a .soundwave file, sliced out without reading or checking the rest: for the
 * game's own stored files, read every time a song plays.
 */
export async function soundwaveAudio(blob: Blob): Promise<Blob> {
  const ref = (await index(blob)).find((r) => r.type === 'AUDI');
  if (!ref) throw new SoundwaveFileError('This song file has no song in it.');
  const m = (await read(blob, ref.offset, 1))[0];
  const mime = String.fromCharCode(...(await read(blob, ref.offset + 1, m)));
  return blob.slice(ref.offset + 1 + m, ref.offset + ref.length, MIME.test(mime) ? mime : 'application/octet-stream');
}

/** A file name for a song's .soundwave file: "Artist - Title.soundwave" (or the title alone), safe on every system. */
export function soundwaveFileName(meta: { title: string; artist: string }): string {
  const known = meta.artist.trim() && meta.artist !== 'Unknown artist';
  const name = (known ? `${meta.artist} - ${meta.title}` : meta.title)
    // oxlint-disable-next-line no-control-regex -- control characters are not allowed in file names
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  return `${/[\p{L}\p{N}]/u.test(name) ? name : 'song'}${SOUNDWAVE_EXT}`;
}

export const isSoundwaveFile = (f: File) => f.name.toLowerCase().endsWith(SOUNDWAVE_EXT);
