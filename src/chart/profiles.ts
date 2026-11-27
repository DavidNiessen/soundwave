import type { Difficulty } from './types';

/**
 * Per-difficulty reduction rules, following common five-lane authoring practice:
 * expert is a literal transcription; each lower difficulty simplifies the one above it.
 */
export interface DifficultyProfile {
  lanes: 4 | 5;
  /** Rhythmic grid kept, in notes per beat (4 = sixteenths, 2 = eighths, 1 = quarters). */
  grid: number;
  /** Whether eighth-note triplets survive (expert/hard). */
  triplets: boolean;
  /** Minimum seconds between consecutive note times. */
  minGap: number;
  /** Maximum notes sounding at the same time. */
  maxChord: number;
  /** Widest lane distance inside a two-note chord (medium forbids split chords). */
  maxChordSpread: number;
  /** Notes at least this many beats long become sustains. */
  sustainBeats: number;
  /** Silence left between a sustain's end and the next note, in beats. */
  sustainGapBeats: number;
  /** Most note times in a bar of four beats (chords count once; see barCap); the weakest off-beats go first. */
  maxPerBar: number;
  /** Chords only on this grid (1 = on the beat, 0.5 = eighths, 0.25 = anywhere). */
  chordGrid: number;
  /** Most chords as a fraction of note times; the strongest stabs (on the beat, held) win. */
  chordRate: number;
  /** Lanes pitched parts actually use (easy keeps to the first three, like classic charts). */
  pitchedLanes: number;
}

export const PROFILES: Record<Difficulty, DifficultyProfile> = {
  easy: {
    lanes: 4,
    grid: 1,
    triplets: false,
    minGap: 0.3,
    maxChord: 1,
    maxChordSpread: 0,
    sustainBeats: 1.5,
    sustainGapBeats: 0.5,
    maxPerBar: 2,
    chordGrid: 1,
    chordRate: 0,
    pitchedLanes: 3,
  },
  medium: {
    lanes: 4,
    grid: 2,
    triplets: false,
    minGap: 0.16,
    maxChord: 2,
    maxChordSpread: 2,
    sustainBeats: 1,
    sustainGapBeats: 0.5,
    maxPerBar: 3,
    chordGrid: 0.5,
    chordRate: 0.35,
    pitchedLanes: 4,
  },
  hard: {
    lanes: 4,
    grid: 4,
    triplets: true,
    minGap: 0.11,
    maxChord: 2,
    maxChordSpread: 3,
    sustainBeats: 0.75,
    sustainGapBeats: 0.25,
    maxPerBar: 6,
    chordGrid: 0.5,
    chordRate: 0.4,
    pitchedLanes: 4,
  },
  expert: {
    lanes: 5,
    grid: 4,
    triplets: true,
    minGap: 0.065,
    maxChord: 3,
    maxChordSpread: 4,
    sustainBeats: 0.5,
    sustainGapBeats: 0.25,
    maxPerBar: 16,
    chordGrid: 0.25,
    chordRate: 0.45,
    pitchedLanes: 5,
  },
};

/** Seconds per beat (120 BPM) at which the beat lengths above hold as they are. */
const BASE_SECONDS_PER_BEAT = 0.5;

/**
 * A length in beats that should not get shorter in time on a fast song: as given at 120 BPM and
 * slower, and the same number of seconds as at 120 BPM when faster.
 */
export const atLeastAt120 = (beats: number, secondsPerBeat: number): number => beats * Math.max(1, BASE_SECONDS_PER_BEAT / secondsPerBeat);

/**
 * Shortest note held on this difficulty, in beats. On a fast song half a beat is barely a moment,
 * and taking sustainBeats as it is would turn nearly every note of a quick bass line into a hold.
 */
export const sustainMinBeats = (p: DifficultyProfile, secondsPerBeat: number): number => atLeastAt120(p.sustainBeats, secondsPerBeat);

/** Most note times in a bar of `beats` beats: maxPerBar is for four, so a bar of three keeps three quarters as many. */
export const barCap = (p: DifficultyProfile, beats: number): number => Math.max(1, Math.round((p.maxPerBar * beats) / 4));
