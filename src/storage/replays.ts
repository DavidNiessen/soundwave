/**
 * Saved replays: what is kept of a run, how many are kept, and the replay file a library backup
 * carries for each one (src/storage/backup.ts).
 *
 * A replay keeps the chart as it was played, every note of it, so it plays back the same after the
 * song's charts change (a new analysis, an edit) or the song leaves the library.
 *
 * The file is little-endian:
 *
 *     offset  size  field
 *     0       8     magic, the ASCII bytes "SWREPLAY"
 *     8       2     format version (REPLAY_VERSION)
 *     10      2     reserved, 0
 *     12      4     length of the JSON that follows, n
 *     16      n     UTF-8 JSON: { meta, chart } (ReplayMeta, Chart)
 *     16+n    4     number of operations, k
 *     20+n    k     each operation's byte (src/game/replay.ts)
 *     ...     4k    each operation's song time, float32, starting at the next multiple of 4
 */
import { DIFFICULTIES, PARTS, type Chart, type Difficulty, type Note, type Part } from '../chart/types';
import type { Results } from '../game/GameSession';
import { GOLD_STARS } from '../game/scoring';
import { LAST_OP, OP, type ReplayInputs } from '../game/replay';

/** 2: a run is its inputs, with a rewind for each pause (1 also held an update for every frame). */
export const REPLAY_VERSION = 2;
const MAGIC = 'SWREPLAY';
/** Most operations read from one file: a long song at a high frame rate stays far below it. */
const MAX_OPS = 4_000_000;
const MAX_NOTES = 200_000;

/** What the list of replays shows: everything but the chart and the inputs. */
export interface ReplayMeta {
  id: string;
  /** When it was played (ms since 1970). */
  date: number;
  songId: string;
  title: string;
  artist: string;
  part: Part;
  difficulty: Difficulty;
  results: Results;
  /** The score beat the best before it on this song, part and difficulty. */
  best: boolean;
  /** Kept by the player: never removed to make room for newer ones. */
  kept: boolean;
  /** Length of the song, seconds. */
  duration: number;
  /** How it was played: alone, or in a party's Versus or Showdown (missing in older replays: alone). */
  mode?: ReplayMode;
}

export type ReplayMode = 'solo' | 'versus' | 'showdown';
/** A replay's mode, said in a word. */
export const MODE_LABEL: Record<ReplayMode, string> = { solo: 'Solo', versus: 'Versus', showdown: 'Showdown' };

/** What is needed to play a replay: the chart it was played on and the run itself. */
export interface ReplayData {
  id: string;
  chart: Chart;
  inputs: ReplayInputs;
}

export interface Replay {
  meta: ReplayMeta;
  data: ReplayData;
}

export const DEFAULT_REPLAY_LIMIT = 30;
export const REPLAY_LIMIT = { min: 5, max: 100, step: 5 } as const;

/** A new replay's id: when it was played, and a little chance so two on one millisecond differ. */
export const newReplayId = (date: number) => `${date.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * The replays to remove so that no more than `limit` are kept: the oldest go first. Replays the
 * player kept are never removed and do not count towards the limit.
 */
export function replaysToPrune(list: readonly Pick<ReplayMeta, 'id' | 'date' | 'kept'>[], limit: number): string[] {
  const loose = list.filter((r) => !r.kept).sort((a, b) => b.date - a.date);
  return loose.slice(Math.max(0, Math.floor(limit))).map((r) => r.id);
}

/* The file -------------------------------------------------------------------------------- */

export class ReplayFileError extends Error {}

const ascii = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0) & 0x7f);

export function writeReplay({ meta, data }: Replay): Blob {
  const json = new TextEncoder().encode(JSON.stringify({ meta, chart: data.chart }));
  const k = Math.min(data.inputs.ops.length, data.inputs.times.length);
  const opsAt = 16 + json.length + 4;
  const timesAt = Math.ceil((opsAt + k) / 4) * 4;
  const out = new Uint8Array(timesAt + k * 4);
  const view = new DataView(out.buffer);
  out.set(ascii(MAGIC), 0);
  view.setUint16(8, REPLAY_VERSION, true);
  view.setUint32(12, json.length, true);
  out.set(json, 16);
  view.setUint32(16 + json.length, k, true);
  out.set(data.inputs.ops.subarray(0, k), opsAt);
  for (let i = 0; i < k; i++) view.setFloat32(timesAt + i * 4, data.inputs.times[i], true);
  return new Blob([out], { type: 'application/octet-stream' });
}

export async function readReplay(file: Blob): Promise<Replay> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const bad = () => new ReplayFileError('This replay is damaged.');
  if (bytes.length < 20 || String.fromCharCode(...bytes.subarray(0, 8)) !== MAGIC)
    throw new ReplayFileError('This is not a Soundwave replay.');
  if (view.getUint16(8, true) > REPLAY_VERSION) throw new ReplayFileError('This replay was made by a newer version of Soundwave.');
  const n = view.getUint32(12, true);
  if (16 + n + 4 > bytes.length) throw bad();
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes.subarray(16, 16 + n)));
  } catch {
    throw bad();
  }
  const k = view.getUint32(16 + n, true);
  const opsAt = 16 + n + 4;
  const timesAt = Math.ceil((opsAt + k) / 4) * 4;
  if (k > MAX_OPS || timesAt + k * 4 > bytes.length) throw bad();
  const ops = bytes.slice(opsAt, opsAt + k);
  const times = new Float32Array(k);
  for (let i = 0; i < k; i++) times[i] = view.getFloat32(timesAt + i * 4, true);
  const { meta, chart } = (parsed ?? {}) as { meta?: unknown; chart?: unknown };
  const m = cleanMeta(meta);
  const c = cleanChart(chart);
  if (!m || !c || c.part !== m.part || c.difficulty !== m.difficulty) throw bad();
  // The upper bits name a lane for a press or release (other operations carry a value there).
  const laned = (op: number) => (op & 7) === OP.press || (op & 7) === OP.release;
  for (let i = 0; i < k; i++)
    if ((ops[i] & 7) > LAST_OP || (laned(ops[i]) && ops[i] >> 3 >= c.lanes) || Number.isNaN(times[i])) throw bad();
  return { meta: m, data: { id: m.id, chart: c, inputs: { ops, times } } };
}

/* Checking what a file holds -------------------------------------------------------------- */

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const text = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const count = (v: unknown) => (finite(v) ? Math.max(0, Math.round(v)) : 0);

function cleanResults(raw: unknown): Results | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const counts = (r.counts ?? {}) as Record<string, unknown>;
  const releases = (r.releases ?? {}) as Record<string, unknown>;
  if (!finite(r.score) || !finite(r.stars) || !finite(r.accuracy)) return null;
  return {
    score: Math.max(0, Math.round(r.score)),
    stars: Math.min(GOLD_STARS, Math.max(0, Math.round(r.stars))),
    accuracy: Math.min(1, Math.max(0, r.accuracy)),
    counts: { perfect: count(counts.perfect), great: count(counts.great), good: count(counts.good), miss: count(counts.miss) },
    bestStreak: count(r.bestStreak),
    totalNotes: count(r.totalNotes),
    fullCombo: r.fullCombo === true,
    overdriveActivations: count(r.overdriveActivations),
    releases: { hit: count(releases.hit), total: count(releases.total) },
  };
}

function cleanMeta(raw: unknown): ReplayMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const results = cleanResults(m.results);
  if (typeof m.id !== 'string' || !/^[\w-]{1,64}$/.test(m.id) || typeof m.songId !== 'string' || m.songId.length > 200) return null;
  if (!PARTS.includes(m.part as Part) || !DIFFICULTIES.includes(m.difficulty as Difficulty) || !finite(m.date) || !results) return null;
  return {
    id: m.id,
    date: m.date,
    songId: m.songId,
    title: text(m.title) || 'Untitled',
    artist: text(m.artist),
    part: m.part as Part,
    difficulty: m.difficulty as Difficulty,
    results,
    best: m.best === true,
    kept: m.kept === true,
    duration: finite(m.duration) ? Math.max(0, m.duration) : 0,
    ...(m.mode === 'versus' || m.mode === 'showdown' ? { mode: m.mode } : {}),
  };
}

/** A chart from outside (a replay file, a party's host), checked note by note; null when it is not one. */
export function cleanChart(raw: unknown): Chart | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (!PARTS.includes(c.part as Part) || !DIFFICULTIES.includes(c.difficulty as Difficulty)) return null;
  if ((c.lanes !== 4 && c.lanes !== 5) || !Array.isArray(c.notes) || c.notes.length > MAX_NOTES) return null;
  if (!finite(c.secondsPerBeat) || c.secondsPerBeat <= 0 || !finite(c.duration) || c.duration < 0) return null;
  const lanes = c.lanes;
  const notes: Note[] = [];
  for (const raw of c.notes as unknown[]) {
    const n = (raw ?? {}) as Record<string, unknown>;
    if (!finite(n.t) || !finite(n.dur) || !Number.isInteger(n.lane) || (n.lane as number) < 0 || (n.lane as number) >= lanes) return null;
    notes.push({
      t: n.t,
      lane: n.lane as number,
      dur: Math.max(0, n.dur),
      ...(n.release === true ? { release: true } : {}),
      phrase: Number.isInteger(n.phrase) ? (n.phrase as number) : -1,
    });
  }
  const numbers = (v: unknown) => (Array.isArray(v) && v.every(finite) ? (v as number[]) : null);
  const beats = numbers(c.beats);
  const downbeats = numbers(c.downbeats);
  if (!beats || !downbeats) return null;
  return {
    part: c.part as Part,
    difficulty: c.difficulty as Difficulty,
    lanes,
    notes,
    beats,
    downbeats,
    secondsPerBeat: c.secondsPerBeat,
    duration: c.duration,
  };
}
