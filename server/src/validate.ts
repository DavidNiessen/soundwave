/**
 * Checks what players send before the server acts on it: every message comes from the internet,
 * so each one is taken apart field by field, and anything off is dropped whole.
 */
import {
  PARTY_MAX,
  SONG_ID,
  type ClientMessage,
  type Difficulty,
  type Part,
  type SetSong,
  type SongScore,
  type WireChart,
} from '../../src/net/protocol.ts';

const PARTS: Part[] = ['vocals', 'lead', 'bass', 'drums'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
/** The most songs in a party's set. */
export const SET_LIMIT = 20;
/** The most notes in one chart: far beyond any real song, a bound on what one message can hold. */
const NOTES_LIMIT = 30_000;
const BEATS_LIMIT = 20_000;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

function setSong(v: unknown): SetSong | undefined {
  if (!isObj(v) || !str(v.id, 64) || !SONG_ID.test(v.id)) return undefined;
  return { id: v.id, title: text(v.title, 200), artist: text(v.artist, 200), duration: num(v.duration) ? Math.max(0, v.duration) : 0 };
}

function score(v: unknown): SongScore | undefined {
  if (!isObj(v) || !num(v.score) || !num(v.stars) || !num(v.accuracy) || !num(v.bestStreak)) return undefined;
  return {
    score: Math.max(0, Math.round(v.score)),
    stars: Math.max(0, Math.min(6, Math.round(v.stars))),
    accuracy: Math.max(0, Math.min(1, v.accuracy)),
    bestStreak: Math.max(0, Math.round(v.bestStreak)),
    fullCombo: v.fullCombo === true,
  };
}

export function chart(v: unknown): WireChart | undefined {
  if (!isObj(v)) return undefined;
  const { part, difficulty, lanes, notes, beats, downbeats, secondsPerBeat, duration } = v;
  if (!PARTS.includes(part as Part) || !DIFFICULTIES.includes(difficulty as Difficulty)) return undefined;
  if ((lanes !== 4 && lanes !== 5) || !num(secondsPerBeat) || secondsPerBeat <= 0 || !num(duration) || duration <= 0) return undefined;
  if (!Array.isArray(notes) || notes.length > NOTES_LIMIT || !Array.isArray(beats) || beats.length > BEATS_LIMIT) return undefined;
  if (!Array.isArray(downbeats) || downbeats.length > BEATS_LIMIT) return undefined;
  const out: WireChart['notes'] = [];
  for (const n of notes) {
    if (!isObj(n) || !num(n.t) || !num(n.dur) || !num(n.phrase) || !Number.isInteger(n.lane)) return undefined;
    const lane = n.lane as number;
    if (lane < 0 || lane >= lanes || n.dur < 0) return undefined;
    out.push({ t: n.t, lane, dur: n.dur, phrase: Math.trunc(n.phrase), ...(n.release === true ? { release: true } : {}) });
  }
  if (!beats.every(num) || !downbeats.every((d) => Number.isInteger(d))) return undefined;
  return {
    part: part as Part,
    difficulty: difficulty as Difficulty,
    lanes,
    notes: out,
    beats: beats as number[],
    downbeats: downbeats as number[],
    secondsPerBeat,
    duration,
  };
}

/** A message from a player, checked; undefined when it is not one the server knows. */
export function clientMessage(raw: unknown): ClientMessage | undefined {
  if (!isObj(raw) || typeof raw.type !== 'string') return undefined;
  switch (raw.type) {
    case 'hello':
      return num(raw.protocol) && str(raw.token, 2000) ? { type: 'hello', protocol: raw.protocol, token: raw.token } : undefined;
    case 'ping':
      return num(raw.t) ? { type: 'ping', t: raw.t } : undefined;
    case 'party-create':
    case 'party-leave':
    case 'lobby':
      return { type: raw.type };
    case 'party-join':
      return str(raw.code, 20) ? { type: 'party-join', code: raw.code } : undefined;
    case 'set': {
      if (!Array.isArray(raw.songs) || raw.songs.length > SET_LIMIT) return undefined;
      const songs = raw.songs.map(setSong);
      if (songs.some((s) => !s) || new Set(songs.map((s) => s!.id)).size !== songs.length) return undefined;
      return { type: 'set', songs: songs as SetSong[] };
    }
    case 'ready': {
      if (!PARTS.includes(raw.part as Part) || !DIFFICULTIES.includes(raw.difficulty as Difficulty) || typeof raw.ready !== 'boolean')
        return undefined;
      if (!Array.isArray(raw.have) || raw.have.length > SET_LIMIT || !raw.have.every((h) => str(h, 64) && SONG_ID.test(h)))
        return undefined;
      return {
        type: 'ready',
        part: raw.part as Part,
        difficulty: raw.difficulty as Difficulty,
        ready: raw.ready,
        have: raw.have as string[],
        calibrated: raw.calibrated === true,
      };
    }
    case 'start': {
      if (!Number.isInteger(raw.songIndex) || !Array.isArray(raw.charts) || raw.charts.length > PARTY_MAX || !isObj(raw.assign))
        return undefined;
      const charts = raw.charts.map(chart);
      if (charts.some((c) => !c)) return undefined;
      const assign: Record<string, number> = {};
      for (const [id, i] of Object.entries(raw.assign)) {
        if (id.length > 64 || !Number.isInteger(i) || (i as number) < 0 || (i as number) >= charts.length) return undefined;
        assign[id] = i as number;
      }
      return { type: 'start', songIndex: raw.songIndex as number, charts: charts as WireChart[], assign };
    }
    case 'progress':
      return Number.isInteger(raw.songIndex) && num(raw.score) && num(raw.streak) && num(raw.stars)
        ? {
            type: 'progress',
            songIndex: raw.songIndex as number,
            score: Math.max(0, Math.round(raw.score)),
            streak: Math.max(0, Math.round(raw.streak)),
            stars: Math.max(0, Math.min(6, Math.round(raw.stars))),
          }
        : undefined;
    case 'finish': {
      const result = score(raw.result);
      return Number.isInteger(raw.songIndex) && result ? { type: 'finish', songIndex: raw.songIndex as number, result } : undefined;
    }
    case 'quit':
      return Number.isInteger(raw.songIndex) ? { type: 'quit', songIndex: raw.songIndex as number } : undefined;
    case 'kick':
      return str(raw.id, 64) ? { type: 'kick', id: raw.id } : undefined;
    case 'request-song':
      return str(raw.songId, 64) && SONG_ID.test(raw.songId) ? { type: 'request-song', songId: raw.songId } : undefined;
    case 'song-sent':
      return str(raw.songId, 64) && SONG_ID.test(raw.songId) && str(raw.to, 64) && typeof raw.ok === 'boolean'
        ? { type: 'song-sent', songId: raw.songId, to: raw.to, ok: raw.ok }
        : undefined;
  }
  return undefined;
}
