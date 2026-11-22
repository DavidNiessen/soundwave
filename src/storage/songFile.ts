/**
 * Songs as .soundwave files: every song in the library is stored as one (src/storage/soundwaveFile.ts),
 * kept up to date as it is analyzed, and that same file is what is exported and shared. The song
 * list and the analysis cache in the database are indexes of it, for listing and playing quickly.
 */
import { ANALYSIS_VERSION, isAnalysisResult, type AnalysisResult } from '../analysis/types';
import { EDITS_VERSION, sanitizeEdits, type SongEdits } from '../editor/edits';
import {
  analysisKey,
  getAnalysis,
  getEdits,
  getSong,
  getStoredFile,
  putAnalysis,
  putEdits,
  putSong,
  putStoredFile,
  type SongMeta,
} from './db';
import { readSoundwave, soundwaveAudio, writeSoundwave, type SoundwaveAnalysis } from './soundwaveFile';
import { hashBytes } from './hash';

/** One write of a song's file at a time, so an export and a finished analysis cannot cross. */
let writes: Promise<unknown> = Promise.resolve();
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = writes.then(job, job);
  writes = next.catch(() => {});
  return next;
}

/** The analysis a song's file should carry: the cached one for the current analyzer, if any. */
async function cachedAnalysis(id: string): Promise<AnalysisResult | undefined> {
  for (const source of ['ml', 'local']) {
    const r = await getAnalysis<AnalysisResult>(analysisKey(id, ANALYSIS_VERSION, source)).catch(() => undefined);
    if (r && isAnalysisResult(r)) return r;
  }
  return undefined;
}

/** The charts edited by hand for a song, if any. */
const storedEdits = (id: string) => getEdits(id).catch(() => undefined);

function build(meta: SongMeta, audio: Blob, analysis?: AnalysisResult, edits?: SongEdits) {
  return writeSoundwave({
    meta: {
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      duration: meta.duration,
      fileName: meta.fileName,
      addedAt: meta.addedAt,
    },
    cover: meta.cover,
    analysis: analysis ? { version: ANALYSIS_VERSION, data: analysis } : undefined,
    edits: edits ? { version: EDITS_VERSION, data: edits } : undefined,
    audio: audio.type ? audio : new Blob([audio], { type: meta.mime }),
  });
}

/**
 * Adds a song from an audio file: it is stored as a .soundwave file. `edits` come with a song that is
 * started from scratch in the track editor (its beat grid), and are stored before the song is.
 */
export async function storeNewSong(meta: SongMeta, audio: Blob, edits?: SongEdits) {
  if (edits) await putEdits(meta.id, edits);
  await putSong(meta, await build(meta, audio, undefined, edits));
}

/** Writes a finished analysis into the song's file, so the file carries its charts. */
export function writeAnalysisToFile(id: string, analysis: AnalysisResult): Promise<void> {
  return serial(async () => {
    const [meta, stored] = await Promise.all([getSong(id), getStoredFile(id)]);
    if (!meta || !stored) return;
    await putStoredFile(id, await build(meta, await soundwaveAudio(stored), analysis, await storedEdits(id)));
  });
}

/**
 * A song's .soundwave file, for exporting: with its cover, its current analysis and the charts edited
 * by hand. (The editor saves those to the database as it goes; they are written into the file here.)
 */
export function songFile(id: string): Promise<Blob> {
  return serial(async () => {
    const [meta, stored] = await Promise.all([getSong(id), getStoredFile(id)]);
    if (!meta || !stored) throw new Error('This song is no longer in your library.');
    const [analysis, edits] = await Promise.all([cachedAnalysis(id), storedEdits(id)]);
    // The stored file is current unless the analysis or the edited charts changed since it was written.
    const has = await readSoundwave(stored);
    const sameAnalysis =
      !analysis || (has.analysis?.version === ANALYSIS_VERSION && JSON.stringify(has.analysis.data) === JSON.stringify(analysis));
    const sameEdits = JSON.stringify(has.edits?.data ?? null) === JSON.stringify(edits ?? null);
    if (sameAnalysis && sameEdits) return stored;
    const file = await build(meta, has.audio, analysis, edits);
    await putStoredFile(id, file);
    return file;
  });
}

/** A song's details as the player can change them: `cover` null takes the cover away, absent keeps it. */
export interface MetaChange {
  title: string;
  artist: string;
  album?: string;
  cover?: Blob | null;
}

/**
 * Changes a song's details. They are written into the song's own .soundwave file (and the library's
 * index of it), never into the audio file it was made from: the audio, its analysis and the charts
 * edited by hand go along unchanged.
 */
export function updateSongMeta(id: string, change: MetaChange): Promise<SongMeta> {
  return serial(async () => {
    const [meta, stored] = await Promise.all([getSong(id), getStoredFile(id)]);
    if (!meta || !stored) throw new Error('This song is no longer in your library.');
    const next: SongMeta = {
      ...meta,
      title: change.title.trim() || meta.title,
      artist: change.artist.trim(),
      album: change.album?.trim() || undefined,
      cover: change.cover === null ? undefined : (change.cover ?? meta.cover),
    };
    const has = await readSoundwave(stored);
    const [analysis, edits] = await Promise.all([cachedAnalysis(id), storedEdits(id)]);
    await putSong(next, await build(next, has.audio, analysis ?? usableAnalysis(has.analysis), edits));
    return next;
  });
}

function usableAnalysis(a: SoundwaveAnalysis | undefined): AnalysisResult | undefined {
  if (!a || a.version !== ANALYSIS_VERSION || !isAnalysisResult(a.data)) return undefined;
  const r = a.data as AnalysisResult;
  return r.source === 'ml' || r.source === 'local' ? r : undefined;
}

export interface SongPackage {
  meta: SongMeta;
  audio: Blob;
  analysis?: AnalysisResult;
  /**
   * An analysis an earlier version of the game made, with that version: it is not charted from
   * where songs can be analyzed again, but a device that cannot analyze (a phone) plays by it.
   */
  olderAnalysis?: { version: number; data: AnalysisResult };
  edits?: SongEdits;
}

/**
 * Reads a .soundwave file from elsewhere. The song's id is worked out from its audio again (never
 * taken from the file), and its analysis is kept only when this version of the game charts from it.
 */
export async function readSongPackage(file: Blob, fileName: string): Promise<SongPackage> {
  const c = await readSoundwave(file);
  const id = await hashBytes(await c.audio.arrayBuffer());
  const meta: SongMeta = {
    id,
    title: c.meta.title,
    artist: c.meta.artist,
    album: c.meta.album,
    fileName: c.meta.fileName || fileName,
    mime: c.audio.type,
    size: c.audio.size,
    duration: c.meta.duration,
    addedAt: Date.now(),
    cover: c.cover,
  };
  // Charts edited by hand come along; what is malformed in them is left out.
  const edits = c.edits && c.edits.version <= EDITS_VERSION ? sanitizeEdits(c.edits.data) : undefined;
  const analysis = usableAnalysis(c.analysis);
  const older =
    !analysis && c.analysis && c.analysis.version < ANALYSIS_VERSION && isAnalysisResult(c.analysis.data)
      ? { version: c.analysis.version, data: c.analysis.data as AnalysisResult }
      : undefined;
  return { meta, audio: c.audio, analysis, ...(older ? { olderAnalysis: older } : {}), edits };
}

/** Adds a song read from a .soundwave file, with its analysis and edited charts when it came with usable ones. */
export async function storeSongPackage(p: SongPackage) {
  // The edits first: with them stored, a song that needs no analysis is never queued for one.
  if (p.edits) await putEdits(p.meta.id, p.edits);
  await putSong(p.meta, await build(p.meta, p.audio, p.analysis, p.edits));
  if (p.analysis) await putAnalysis(analysisKey(p.meta.id, ANALYSIS_VERSION, p.analysis.source), p.meta.id, p.analysis);
  // Kept under the version that made it, so it is never taken for a current one.
  else if (p.olderAnalysis)
    await putAnalysis(analysisKey(p.meta.id, p.olderAnalysis.version, p.olderAnalysis.data.source), p.meta.id, p.olderAnalysis.data);
}
