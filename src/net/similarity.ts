/**
 * Whether two songs are the same recording, or likely to be, for a server's library: the same song
 * shared twice in other files (an MP3 and a FLAC of it, another rip) has other bytes and so another
 * id, but the same loudness from moment to moment, the same length and, usually, the same name.
 *
 * Pure and dependency-free: the server (server/src/songs.ts) and the game share it.
 */

/** What a song is compared by: its loudness curve (from its analysis), its length, its name. */
export interface Fingerprint {
  /** Loudness, every `HOP` seconds (empty where the song has no analysis). */
  energy: number[];
  duration: number;
  /** The title and artist, made comparable (see nameKey). */
  title: string;
  artist: string;
}

export type Likeness = 'same' | 'likely';

/** Seconds between the loudness values compared (the analysis keeps one every 0.1 s). */
export const HOP = 0.5;
/** How far apart in time two files may start (a different encoder delay, a silence trimmed), seconds. */
const MAX_SHIFT = 2;
/** The same recording: loudness this alike, and lengths this close. */
const SAME_R = 0.95;
const SAME_DURATION = 3;
/** Likely the same song: a little less alike (another master), or the same name and length. */
const LIKELY_R = 0.85;
const LIKELY_DURATION = 6;

/** A loudness curve sampled every `hop` seconds, averaged down to one value every HOP seconds. */
export function coarseEnergy(energy: readonly number[], hop: number): number[] {
  if (!energy.length || !(hop > 0)) return [];
  const per = Math.max(1, Math.round(HOP / hop));
  const out: number[] = [];
  for (let i = 0; i + per <= energy.length; i += per) {
    let sum = 0;
    for (let k = 0; k < per; k++) sum += energy[i + k];
    out.push(sum / per);
  }
  return out;
}

/**
 * A title or artist as it is compared: lower case, letters and digits only, without what is in
 * brackets ("(Remastered 2011)", "[Live]") or after a dash, and without "feat." and the rest.
 */
export function nameKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/\s+-\s+.*$/, ' ')
    .replace(/\b(feat|ft|featuring)\b.*$/, ' ')
    .replace(/[^a-z0-9]+/g, '');
}

/** How alike two loudness curves are: the best Pearson correlation with one shifted up to MAX_SHIFT. */
export function energyLikeness(a: readonly number[], b: readonly number[]): number {
  const max = Math.round(MAX_SHIFT / HOP);
  let best = -1;
  for (let lag = -max; lag <= max; lag++) {
    const from = Math.max(0, -lag);
    const to = Math.min(a.length, b.length - lag);
    const n = to - from;
    // Too little overlap says nothing.
    if (n < 20) continue;
    let sa = 0;
    let sb = 0;
    for (let i = from; i < to; i++) {
      sa += a[i];
      sb += b[i + lag];
    }
    const ma = sa / n;
    const mb = sb / n;
    let cov = 0;
    let va = 0;
    let vb = 0;
    for (let i = from; i < to; i++) {
      const x = a[i] - ma;
      const y = b[i + lag] - mb;
      cov += x * y;
      va += x * x;
      vb += y * y;
    }
    if (va > 0 && vb > 0) best = Math.max(best, cov / Math.sqrt(va * vb));
  }
  return best;
}

/** Whether two songs are the same recording ('same'), probably the same song ('likely'), or neither (null). */
export function likeness(a: Fingerprint, b: Fingerprint): { kind: Likeness; score: number } | null {
  const apart = Math.abs(a.duration - b.duration);
  if (apart > LIKELY_DURATION) return null;
  const r = a.energy.length && b.energy.length ? energyLikeness(a.energy, b.energy) : -1;
  const named = !!a.title && a.title === b.title && (!a.artist || !b.artist || a.artist === b.artist);
  if (r >= SAME_R && apart <= SAME_DURATION) return { kind: 'same', score: r };
  if (r >= LIKELY_R || (named && r < 0)) return { kind: 'likely', score: Math.max(r, named ? 0.9 : 0) };
  // The same name, but the loudness says another recording (a live take, a remix): still worth a look.
  if (named && r >= 0.5) return { kind: 'likely', score: r };
  return null;
}
