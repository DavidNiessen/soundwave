import { bandFlux, normalize, percentile, pickPeaks } from '../dsp/onsets';
import { highpass, lowpass, refineOnset } from '../dsp/refine';
import { stft } from '../dsp/stft';
import type { PitchedNote } from '../types';
import { BASS_SPLIT, dropStrayVocals } from './lines';

/**
 * Lines from separated stems, timed by what you can hear.
 *
 * The transcriber's note starts are a poor rhythm source: vibrato and slides split one sung note
 * into several, reverb and pads produce notes without an attack, and soft syllables start late.
 * So each line is built from the stem's own audible attacks (spectral-flux onsets, refined to the
 * waveform), and the transcription only decides which pitch each attack is.
 */

const HOP = 512;
/** Attacks closer than this merge into one note. */
const MIN_IOI = 0.07;

export interface StemInput {
  signal: Float32Array;
  sr: number;
  /** Polyphonic transcription of this stem. */
  notes: PitchedNote[];
  /** Beat times, when known: steady strumming is looked for on the eighth-note grid. */
  beats?: number[];
  /**
   * How loud the whole song is (see loudness). A stem's level is judged against its own loud
   * parts, and against this too: nothing far quieter than the song counts as loud, so the faint
   * residue left in a stem the song hardly has never reads as playing.
   */
  mixLoudness?: number;
}

/** A stem's level is never judged against less than this share of the song's loudness. */
const MIX_FLOOR = 0.05;

interface Attack {
  t: number;
  strength: number;
}

interface Envelope {
  fps: number;
  rms: Float32Array;
  /** 95th percentile, the "loud" reference. */
  ref: number;
}

/** How loud a signal is: the 95th percentile of its short-term level, its "loud" parts. */
export function loudness(signal: Float32Array): number {
  const n = Math.floor(signal.length / HOP);
  if (n < 1) return 0;
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    for (let i = f * HOP; i < (f + 1) * HOP; i++) s += signal[i] * signal[i];
    rms[f] = Math.sqrt(s / HOP);
  }
  return percentile(rms, 0.95);
}

function envelope(signal: Float32Array, sr: number, mixLoudness = 0): Envelope {
  const n = Math.ceil(signal.length / HOP);
  const rms = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const a = f * HOP;
    const b = Math.min(signal.length, a + HOP);
    for (let i = a; i < b; i++) s += signal[i] * signal[i];
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  return { fps: sr / HOP, rms, ref: Math.max(percentile(rms, 0.95), mixLoudness * MIX_FLOOR) || 1 };
}

const level = (env: Envelope, from: number, to: number) => {
  const a = Math.max(0, Math.floor(from * env.fps));
  const b = Math.min(env.rms.length, Math.max(a + 1, Math.ceil(to * env.fps)));
  let s = 0;
  for (let f = a; f < b; f++) s += env.rms[f];
  return s / (b - a) / env.ref;
};

/** A stem's sound in one band: its flux (normalised) and the waveform filtered to the band. */
interface Band {
  flux: Float32Array;
  filtered: Float32Array;
}

function band(signal: Float32Array, sr: number, loHz: number, hiHz: number): Band {
  const spec = stft(signal, sr, 2048, HOP);
  return { flux: normalize(bandFlux(spec.mag, spec, loHz, hiHz)), filtered: highpass(lowpass(signal, sr, hiHz), sr, loHz) };
}

/** Audible attacks in a stem: flux peaks in a band, moved to the attack in the filtered waveform. */
export function attacks(
  signal: Float32Array,
  sr: number,
  loHz: number,
  hiHz: number,
  delta = 0.08,
  heard = band(signal, sr, loHz, hiHz),
): Attack[] {
  const { flux, filtered } = heard;
  const fps = sr / HOP;
  const peaks = pickPeaks(flux, { maxWin: 2, avgWin: Math.round(0.2 * fps), delta, wait: Math.round(MIN_IOI * fps) });
  const out: Attack[] = [];
  for (const f of peaks) {
    const t = refineOnset(filtered, sr, f / fps, 0.03, 0.09);
    const prev = out[out.length - 1];
    if (prev && t - prev.t < MIN_IOI) {
      prev.strength = Math.max(prev.strength, flux[f]);
      continue;
    }
    out.push({ t, strength: Math.min(1, flux[f]) });
  }
  return out;
}

/**
 * A real attack is loud enough and followed by at least as much sound as just before it. The end
 * of a note can splatter across the spectrum and look like an attack, but it is followed by less.
 */
function isOnset(env: Envelope, t: number, minLevel: number, keep = 0.9): boolean {
  const after = level(env, t + 0.01, t + 0.1);
  return after >= minLevel && after >= level(env, t - 0.1, t - 0.01) * keep;
}

/**
 * End of a held pitch: transcribers split long notes (vibrato, breathy tone) into back-to-back
 * pieces of the same pitch, so follow the chain of same-pitch pieces. `byTime` is the notes in
 * order of their starts.
 */
function heldUntil(byTime: PitchedNote[], start: PitchedNote): number {
  let end = start.t + start.dur;
  for (const n of byTime) {
    if (n.midi !== start.midi || n.t <= start.t) continue;
    if (n.t - end > 0.12) break;
    end = Math.max(end, n.t + n.dur);
  }
  return end;
}

/** Notes sounding at time t (started up to `lead` seconds later count as sounding). */
const soundingAt = (notes: PitchedNote[], t: number, lead = 0) => notes.filter((n) => n.t <= t + lead && n.t + n.dur > t);

/** Dominant (strongest, then highest) pitch sounding during [a, b]. */
function dominantPitch(notes: PitchedNote[], a: number, b: number): PitchedNote | undefined {
  let best: PitchedNote | undefined;
  let bestScore = 0;
  for (const n of notes) {
    const overlap = Math.min(b, n.t + n.dur) - Math.max(a, n.t);
    if (overlap <= 0) continue;
    const score = overlap * n.strength;
    if (score > bestScore || (score === bestScore && best && n.midi > best.midi)) {
      bestScore = score;
      best = n;
    }
  }
  return best;
}

/** When the sound has faded below `frac` of its level just after `t`. */
function fadeEnd(env: Envelope, t: number, limit: number, frac: number): number {
  const peak = level(env, t, t + 0.08);
  const start = Math.floor((t + 0.08) * env.fps);
  const stop = Math.min(env.rms.length, Math.ceil(limit * env.fps));
  for (let f = start; f < stop; f++) if (env.rms[f] / env.ref < peak * frac) return f / env.fps;
  return limit;
}

/** Spectral flux jump that counts as a vocal attack (consonants and vowel starts are subtle). */
const VOCAL_ATTACK_DELTA = 0.08;
/** Quietest level (relative to the stem's loud parts) at which a syllable still counts. */
const VOCAL_MIN_LEVEL = 0.1;
/** How far (s) an unpitched syllable may look for a sung pitch to borrow. */
const BORROW_WINDOW = 0.5;
/** Unpitched sounds quieter than this are breaths, not syllables. */
const BORROW_MIN_LEVEL = 0.25;
/** Transcribed notes at least this confident start a syllable even without an audible attack. */
const SOFT_ONSET_STRENGTH = 0.5;
/** Shortest syllable kept (s): quick rap syllables are often barely longer than this. */
const MIN_SYLLABLE = 0.04;

/**
 * Sung line: one note per audible syllable, plus legato pitch changes inside a held vowel.
 * Quiet breaths produce nothing; spoken or rapped syllables without a stable pitch take the
 * nearest sung pitch.
 */
export function vocalLineFromStem({ signal, sr, notes, mixLoudness }: StemInput): PitchedNote[] {
  const env = envelope(signal, sr, mixLoudness);
  const voiced = notes.filter((n) => n.strength >= 0.15 && n.midi >= 40 && n.midi <= 88);
  // Syllables follow each other closely and often start softer than the previous one ended, so
  // the onset test only rejects attacks clearly quieter than what came before (note endings).
  const events = attacks(signal, sr, 120, 6000, VOCAL_ATTACK_DELTA).filter((a) => isOnset(env, a.t, VOCAL_MIN_LEVEL, 0.5));

  // Syllables with soft onsets (no jump in the sound) still start a confidently transcribed note,
  // unless it is a weaker continuation of the same pitch (a held note the transcriber split).
  for (const n of voiced) {
    if (n.strength < SOFT_ONSET_STRENGTH || events.some((e) => Math.abs(e.t - n.t) < 0.08)) continue;
    const before = dominantPitch(voiced, n.t - 0.12, n.t - 0.02);
    if (before && before.midi === n.midi && before.strength >= n.strength) continue;
    if (level(env, n.t, n.t + 0.1) >= VOCAL_MIN_LEVEL) events.push({ t: n.t, strength: 0.45 });
  }

  // Legato: the pitch moves to a new note inside a held syllable, with no new attack.
  const sorted = [...voiced].sort((x, y) => x.t - y.t);
  for (const n of sorted) {
    if (n.dur < 0.1) continue;
    if (events.some((e) => Math.abs(e.t - n.t) < 0.12)) continue;
    const before = dominantPitch(voiced, n.t - 0.12, n.t - 0.02);
    if (before && Math.abs(before.midi - n.midi) >= 1 && level(env, n.t, n.t + 0.1) >= 0.12) events.push({ t: n.t, strength: 0.5 });
  }
  events.sort((x, y) => x.t - y.t);

  const out: PitchedNote[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    const next = events[i + 1]?.t ?? e.t + 2;
    let pitch = dominantPitch(voiced, e.t + 0.03, Math.min(next, e.t + 0.2));
    // Rapped or spoken syllables often have no stable pitch; borrow the nearest sung one.
    if (!pitch && level(env, e.t, e.t + 0.1) >= BORROW_MIN_LEVEL) pitch = dominantPitch(voiced, e.t - BORROW_WINDOW, e.t + BORROW_WINDOW);
    if (!pitch) continue;
    // A borrowed pitch (from a note that ended before this syllable) sets the pitch, not the length.
    const held = Math.max(heldUntil(sorted, pitch) + 0.1, e.t + 0.1);
    const end = Math.min(next - 0.02, held, fadeEnd(env, e.t, next, 0.3));
    if (end - e.t < MIN_SYLLABLE) continue;
    out.push({
      t: e.t,
      dur: end - e.t,
      midi: pitch.midi,
      strength: Math.min(1, 0.4 + e.strength * 0.6),
      bend: pitch.bend,
      fine: pitch.fine,
    });
  }
  // A note or two alone in a long break is usually bleed from an instrument.
  return dropStrayVocals(stabilizePitches(out), (n) => level(env, n.t, n.t + Math.min(0.3, Math.max(0.1, n.dur))));
}

/**
 * Singers slide and drift: a held E can read as E one time and F the next. Within a phrase, notes
 * whose fine pitches lie within PITCH_MERGE semitones of each other are one sung note; each group
 * gets the median of its fine pitches, corrected by the song's overall tuning, rounded. Repeated
 * notes then stay in one lane and real steps still move.
 *
 * A group never spans more than PITCH_SPAN: in a long phrase the fine pitches of neighbouring notes
 * (a step sung a little flat, a slide between them) fill the gaps between semitones, and chaining
 * them would make the whole phrase one pitch. A group that is too wide splits at its widest gap.
 */
const PITCH_MERGE = 0.5;
const PITCH_SPAN = 1;

/** Splits ascending values into runs at gaps over PITCH_MERGE, then each run at its widest gaps until it spans at most PITCH_SPAN. */
function pitchGroups(sorted: number[], fine: (i: number) => number): number[][] {
  const runs: number[][] = [];
  for (const i of sorted) {
    const run = runs[runs.length - 1];
    if (run && fine(i) - fine(run[run.length - 1]) <= PITCH_MERGE) run.push(i);
    else runs.push([i]);
  }
  const out: number[][] = [];
  const split = (g: number[]) => {
    if (g.length < 2 || fine(g[g.length - 1]) - fine(g[0]) <= PITCH_SPAN) return void out.push(g);
    let at = 1;
    for (let k = 2; k < g.length; k++) if (fine(g[k]) - fine(g[k - 1]) > fine(g[at]) - fine(g[at - 1])) at = k;
    split(g.slice(0, at));
    split(g.slice(at));
  };
  runs.forEach(split);
  return out;
}

export function stabilizePitches(notes: PitchedNote[]): PitchedNote[] {
  const withFine = notes.filter((n) => n.fine !== undefined);
  if (withFine.length < 8) return notes;
  // Song tuning: circular mean of how far fine pitches sit from the nearest semitone.
  let sx = 0;
  let sy = 0;
  for (const n of withFine) {
    const a = 2 * Math.PI * (n.fine! - Math.round(n.fine!));
    sx += Math.cos(a) * n.dur;
    sy += Math.sin(a) * n.dur;
  }
  const tuning = Math.atan2(sy, sx) / (2 * Math.PI);
  const out = notes.map((n) => ({ ...n }));
  let start = 0;
  while (start < out.length) {
    let end = start + 1;
    while (end < out.length && out[end].t - (out[end - 1].t + out[end - 1].dur) < 0.8) end++;
    const idx = Array.from({ length: end - start }, (_, k) => start + k).filter((i) => out[i].fine !== undefined);
    const sorted = [...idx].sort((a, b) => out[a].fine! - out[b].fine!);
    for (const group of pitchGroups(sorted, (i) => out[i].fine!)) {
      const vals = group.map((i) => out[i].fine!);
      const midi = Math.round(vals[vals.length >> 1] - tuning);
      for (const i of group) out[i].midi = midi;
    }
    start = end;
  }
  return out;
}

/** Intervals (semitones) at which overtones of a lower note appear: octaves, twelfths, the 17th. */
const OVERTONES = new Set([12, 19, 24, 28, 31, 36]);

/**
 * Drops pitches that are overtones of a lower struck pitch. Distortion and octave effects make
 * overtones as loud as real notes, which would turn a two-note power chord into a "five-note chord".
 * The lowest pitch and anything not explained by a lower one stay.
 */
export function pruneOvertones(pitches: number[]): number[] {
  const sorted = [...new Set(pitches)].sort((a, b) => a - b);
  return sorted.filter((p, i) => !sorted.slice(0, i).some((q) => OVERTONES.has(p - q)));
}

/**
 * Chord or single note from the pitches struck at one attack. Power chords (root with a fifth or
 * fourth) count as chords, like a guitarist plays and a charter writes them.
 */
function voicing(pitches: number[]): { top: number; chord?: number[] } {
  const kept = pruneOvertones(pitches);
  const top = kept[kept.length - 1];
  const pcs = new Set(kept.map((m) => m % 12));
  if (pcs.size < 2) return { top };
  const span = top - kept[0];
  const power = kept.length === 2 && (span === 5 || span === 7);
  if (kept.length >= 3 || power) return { top, chord: kept.slice(-6) };
  return { top };
}

/**
 * Strums that barely change the sound (sustained, distorted chords re-struck on every eighth note).
 * Only at eighth-note grid positions where the instrument is playing: a small dip-and-recovery
 * in the flux close to the grid counts there, where it would be noise anywhere else.
 */
function gridStrums(sound: Band, sr: number, env: Envelope, beats: number[], heard: Attack[]): Attack[] {
  const { flux, filtered } = sound;
  const fps = sr / HOP;
  const out: Attack[] = [];
  for (let i = 0; i + 1 < beats.length; i++) {
    for (const frac of [0, 0.5]) {
      const g = beats[i] + frac * (beats[i + 1] - beats[i]);
      if (heard.some((h) => Math.abs(h.t - g) < 0.07)) continue;
      if (level(env, g - 0.1, g + 0.1) < 0.25) continue;
      // Strongest flux frame near the grid point, compared with its surroundings.
      const c = Math.round(g * fps);
      let best = -1;
      for (let f = c - 2; f <= c + 2; f++) if (f > 0 && f < flux.length && (best < 0 || flux[f] > flux[best])) best = f;
      if (best < 0) continue;
      let around = 0;
      let n = 0;
      for (let f = best - 6; f <= best + 6; f++) {
        if (f < 0 || f >= flux.length || Math.abs(f - best) < 2) continue;
        around += flux[f];
        n++;
      }
      if (flux[best] < (around / Math.max(1, n)) * GRID_STRUM_RATIO) continue;
      out.push({ t: refineOnset(filtered, sr, best / fps, 0.03, 0.05), strength: 0.5 });
    }
  }
  return out;
}

/** How much a near-grid flux peak must stand out from its neighbourhood to count as a strum. */
const GRID_STRUM_RATIO = 1.5;

/**
 * Attack times for an instrument stem: audible jumps in the sound, plus quieter strums on the
 * eighth-note grid (re-strummed distorted chords barely change the sound level).
 */
function instrumentAttacks(signal: Float32Array, sr: number, env: Envelope, beats?: number[]): Attack[] {
  const sound = band(signal, sr, 150, 8000);
  const heard = attacks(signal, sr, 150, 8000, 0.08, sound).filter((a) => isOnset(env, a.t, 0.1));
  if (beats && beats.length > 1) heard.push(...gridStrums(sound, sr, env, beats, heard));
  heard.sort((a, b) => a.t - b.t);
  const out = heard;
  return out.filter((a, i) => i === 0 || a.t - out[i - 1].t >= MIN_IOI);
}

/**
 * Instrument line: one note per attack. Several pitches struck together become a chord (melody on
 * top, overtones removed); a lone note keeps its pitch. Attacks without a newly struck pitch (pad
 * swells, noise) produce nothing.
 */
export function leadLineFromStem({ signal, sr, notes, beats, mixLoudness }: StemInput): PitchedNote[] {
  const env = envelope(signal, sr, mixLoudness);
  const pitched = notes.filter((n) => n.strength >= 0.2 && n.midi >= 45);
  const out: PitchedNote[] = [];
  const hits = instrumentAttacks(signal, sr, env, beats);
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1]?.t ?? h.t + 2;
    const struck = pitched.filter((n) => n.t >= h.t - 0.05 && n.t <= h.t + 0.08);
    const prev = out[out.length - 1];
    let top: number;
    let chord: number[] | undefined;
    let longest: number;
    if (struck.length) {
      const loud = Math.max(...struck.map((n) => n.strength));
      const voice = struck.filter((n) => n.strength >= loud * 0.5);
      const pitches = voice.map((n) => n.midi);
      // Strumming the same chord again often re-triggers only some strings in the transcription;
      // the rest of the chord is still ringing and belongs to this strum too.
      if (prev?.chord && h.t - (prev.t + prev.dur) < 0.15 && pitches.every((m) => prev.chord!.includes(m))) {
        for (const n of soundingAt(pitched, h.t + 0.05)) if (prev.chord.includes(n.midi)) pitches.push(n.midi);
      }
      // A lone root with its fifth (or fourth) still ringing from just before is a power chord.
      if (new Set(pitches).size === 1) {
        const root = pitches[0];
        for (const n of soundingAt(pitched, h.t + 0.05)) {
          const iv = Math.abs(n.midi - root);
          if (n.t >= h.t - 0.5 && n.strength >= 0.4 && (iv === 5 || iv === 7)) pitches.push(n.midi);
        }
      }
      ({ top, chord } = voicing(pitches));
      longest = Math.max(h.t + 0.1, ...voice.map((n) => n.t + n.dur));
    } else if (
      prev &&
      h.t - (prev.t + prev.dur) < 0.15 &&
      soundingAt(pitched, h.t + 0.05).some((n) => (prev.chord ?? [prev.midi]).includes(n.midi))
    ) {
      // A re-strum: no new pitch, the previous chord still ringing. Same chord again.
      top = prev.midi;
      chord = prev.chord;
      longest = Math.max(h.t + 0.1, ...soundingAt(pitched, h.t + 0.05).map((n) => n.t + n.dur));
    } else continue;
    const end = Math.min(next - 0.02, longest + 0.05, fadeEnd(env, h.t, next, 0.35));
    if (end - h.t < 0.05) continue;
    out.push({ t: h.t, dur: end - h.t, midi: top, strength: Math.min(1, 0.4 + h.strength * 0.6), ...(chord ? { chord } : {}) });
  }
  return out;
}

/**
 * How long after a bass attack (s) its transcribed pitch may start. On electric and picked bass the
 * transcription starts within a few hundredths of a second of the attack; on 808 and sub-bass most
 * notes start 0.13 to 0.27 s late (measured on separated bass stems).
 */
const BASS_LAG = 0.3;

/** Bass line: one note per audible attack in the bass stem, lowest struck pitch, octave-folded. */
export function bassLineFromStem({ signal, sr, notes, mixLoudness }: StemInput): PitchedNote[] {
  const env = envelope(signal, sr, mixLoudness);
  const low = notes.filter((n) => n.strength >= 0.12);
  const hits = attacks(signal, sr, 30, 400, 0.1).filter((a) => isOnset(env, a.t, 0.12));
  const raw: PitchedNote[] = [];
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const next = hits[i + 1]?.t ?? h.t + 2;
    const struck = low.filter((n) => n.t >= h.t - 0.06 && n.t <= h.t + 0.1);
    // Sub-bass (808s, synth bass) is recognised late: the transcribed note can start a fifth of a
    // second after the attack is heard. A note starting that late, before the next attack, is this one.
    const late = struck.length ? [] : low.filter((n) => n.t > h.t + 0.1 && n.t <= Math.min(h.t + BASS_LAG, next - 0.03));
    const first = late.length ? Math.min(...late.map((n) => n.t)) : 0;
    const pool = struck.length ? struck : late.length ? late.filter((n) => n.t - first < 0.05) : soundingAt(low, h.t + 0.05);
    if (!pool.length) continue;
    const lowest = pool.reduce((m, n) => (n.midi < m.midi ? n : m));
    const end = Math.min(next - 0.02, fadeEnd(env, h.t, next, 0.3));
    if (end - h.t < 0.05) continue;
    raw.push({ t: h.t, dur: end - h.t, midi: lowest.midi, strength: Math.min(1, 0.4 + h.strength * 0.6) });
  }
  return foldOctaves(raw);
}

/**
 * Moves each bass note to the octave nearest the recent bass register (pitch class unchanged).
 * Every attack is kept: repeated notes are real here, not re-detections.
 */
export function foldOctaves(notes: PitchedNote[]): PitchedNote[] {
  const recent: number[] = [];
  const sorted = notes.map((n) => n.midi).sort((a, b) => a - b);
  let ref = sorted[sorted.length >> 1] ?? 36;
  return notes.map((n) => {
    let midi = n.midi;
    for (let m = n.midi % 12; m < BASS_SPLIT + 12; m += 12) if (Math.abs(m - ref) < Math.abs(midi - ref)) midi = m;
    recent.push(midi);
    if (recent.length > 8) recent.shift();
    ref = [...recent].sort((a, b) => a - b)[recent.length >> 1];
    return { ...n, midi };
  });
}
