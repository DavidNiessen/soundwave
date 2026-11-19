import type { Chart } from '../chart/types';
import { gradeFor, WINDOWS, type Grade } from './judge';
import { goldThreshold, multiplierFor, NOTE_POINTS, OVERDRIVE_FACTOR, starProgress, starsFor, SUSTAIN_POINTS_PER_BEAT } from './scoring';

export type GameEvent =
  /** `delta`: how far off the press was, in seconds (negative = early, positive = late). */
  | { type: 'hit'; lane: number; grade: Grade; noteIndex: number; delta: number }
  | { type: 'miss'; lane: number; noteIndex: number }
  | { type: 'ghost'; lane: number }
  | { type: 'sustain-end'; lane: number; complete: boolean }
  | { type: 'release'; lane: number; grade: Grade; noteIndex: number; delta: number }
  | { type: 'release-miss'; lane: number; noteIndex: number; early: boolean }
  | { type: 'phrase-complete'; phrase: number }
  | { type: 'phrase-failed'; phrase: number }
  | { type: 'overdrive-start' }
  | { type: 'overdrive-end' };

const enum NoteState {
  Pending = 0,
  Hit = 1,
  Missed = 2,
}

/** How early a sustain may be released and still count as complete. */
const SUSTAIN_RELEASE_GRACE = 0.12;
/** Fraction of the overdrive meter a completed phrase awards. */
export const PHRASE_REWARD = 0.25;
/** Beats of overdrive per PHRASE_REWARD of meter. */
const BEATS_PER_REWARD = 8;

export interface Results {
  score: number;
  stars: number;
  accuracy: number;
  counts: Record<Grade | 'miss', number>;
  bestStreak: number;
  totalNotes: number;
  fullCombo: boolean;
  overdriveActivations: number;
  /** Hold-and-release notes let go on time, of all release notes in the chart. */
  releases: { hit: number; total: number };
}

/**
 * Pure gameplay state machine. It knows nothing about audio or rendering:
 * callers feed it song time (seconds) and lane presses/releases.
 *
 * A run is decided by its inputs alone (each press, release and overdrive start with its time), not
 * by how often `update` is called: what happens by itself (a note's window closing, a hold ending,
 * overdrive running out) happens at its own time, in order, and sustain points and the overdrive
 * meter are worked out between those times. The same inputs give the same result at any frame rate.
 */
export class GameSession {
  readonly chart: Chart;
  readonly state: Uint8Array;
  /** Per-lane index of the note currently being sustained, or -1. */
  readonly holding: Int32Array;
  readonly laneDown: Uint8Array;
  /** Per note: 0 = release pending (or not a release note), 1 = released on time, 2 = missed. */
  readonly releaseState: Uint8Array;
  releasesHit = 0;

  streak = 0;
  bestStreak = 0;
  overdriveActive = false;
  overdriveActivations = 0;
  counts: Record<Grade | 'miss', number> = { perfect: 0, great: 0, good: 0, miss: 0 };

  private cursor = 0;
  /** Points settled so far: every hit, and sustain points up to `mark`. */
  private points = 0;
  /** The overdrive meter (0..1) as it stood at `mark`. */
  private meter = 0;
  /** The song time up to which sustain points and the overdrive drain are settled. */
  private mark = 0;
  /** The song time the session was last advanced to. */
  private now = 0;
  /** Overdrive meter drained per second while it is active. */
  private readonly drain: number;
  private readonly phraseFailed = new Set<number>();
  private readonly phraseLast = new Map<number, number>();
  /** The score of a flawless run without overdrive: what the stars are measured against. */
  private readonly par: number;
  /** The share of par that turns the stars gold on this chart (it depends on how much overdrive the chart offers). */
  private readonly goldAt: number;
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor(chart: Chart) {
    this.chart = chart;
    this.state = new Uint8Array(chart.notes.length);
    this.holding = new Int32Array(chart.lanes).fill(-1);
    this.laneDown = new Uint8Array(chart.lanes);
    this.releaseState = new Uint8Array(chart.notes.length);
    let par = 0;
    chart.notes.forEach((n, i) => {
      // Every note perfect and the streak unbroken: note i is scored at the multiplier of a streak of i + 1.
      const points = NOTE_POINTS.perfect + (n.dur / chart.secondsPerBeat) * SUSTAIN_POINTS_PER_BEAT + (n.release ? NOTE_POINTS.perfect : 0);
      par += points * multiplierFor(i + 1);
      if (n.phrase >= 0) this.phraseLast.set(n.phrase, i);
    });
    this.par = par;
    // What overdrive can cover if every phrase is played: each one buys a fixed number of beats.
    const notes = chart.notes;
    const span = notes.length ? notes[notes.length - 1].t + notes[notes.length - 1].dur - notes[0].t : 0;
    const overdriveTime = this.phraseLast.size * BEATS_PER_REWARD * chart.secondsPerBeat;
    this.goldAt = goldThreshold(span > 0 ? overdriveTime / span : 0);
    this.drain = PHRASE_REWARD / (BEATS_PER_REWARD * chart.secondsPerBeat);
  }

  /** The score right now: what is settled, and the sustain points of the holds since. */
  get score() {
    return this.points + this.sustainPoints(this.now);
  }

  /** The overdrive meter right now, 0..1. */
  get overdrive() {
    return this.overdriveActive ? Math.max(0, this.meter - Math.max(0, this.now - this.mark) * this.drain) : this.meter;
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  private emit(e: GameEvent) {
    for (const l of this.listeners) l(e);
  }

  get multiplier() {
    return multiplierFor(this.streak) * (this.overdriveActive ? OVERDRIVE_FACTOR : 1);
  }

  press(lane: number, t: number) {
    if (lane < 0 || lane >= this.chart.lanes) return;
    this.reach(t);
    this.laneDown[lane] = 1;
    const notes = this.chart.notes;
    let best = -1;
    for (let i = this.cursor; i < notes.length; i++) {
      const n = notes[i];
      if (n.t - t > WINDOWS.good) break;
      if (n.lane !== lane || this.state[i] !== NoteState.Pending) continue;
      if (Math.abs(n.t - t) <= WINDOWS.good) {
        best = i;
        break;
      }
    }
    if (best < 0) {
      this.streak = 0;
      this.emit({ type: 'ghost', lane });
      return;
    }
    const n = notes[best];
    const grade = gradeFor(t - n.t)!;
    this.state[best] = NoteState.Hit;
    this.counts[grade]++;
    this.streak++;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    this.points += NOTE_POINTS[grade] * this.multiplier;
    if (n.dur > 0) this.holding[lane] = best;
    this.emit({ type: 'hit', lane, grade, noteIndex: best, delta: t - n.t });
    this.checkPhrase(best);
  }

  release(lane: number, t: number) {
    if (lane < 0 || lane >= this.chart.lanes) return;
    this.reach(t);
    this.laneDown[lane] = 0;
    const idx = this.holding[lane];
    if (idx < 0) return;
    const n = this.chart.notes[idx];
    this.holding[lane] = -1;
    const end = n.t + n.dur;
    if (n.release) {
      // Let go within the timing windows of the end: a graded release; earlier is a miss.
      const grade = gradeFor(t - end);
      if (grade) this.releaseHit(idx, lane, grade, t - end);
      else this.releaseMiss(idx, lane, true);
      this.emit({ type: 'sustain-end', lane, complete: grade !== null });
      return;
    }
    this.emit({ type: 'sustain-end', lane, complete: t >= end - SUSTAIN_RELEASE_GRACE });
  }

  private releaseHit(i: number, lane: number, grade: Grade, delta = 0) {
    this.releaseState[i] = 1;
    this.releasesHit++;
    this.points += NOTE_POINTS[grade] * this.multiplier;
    this.emit({ type: 'release', lane, grade, noteIndex: i, delta });
  }

  private releaseMiss(i: number, lane: number, early: boolean) {
    this.releaseState[i] = 2;
    this.streak = 0;
    this.emit({ type: 'release-miss', lane, noteIndex: i, early });
  }

  /**
   * Ends every hold without judging it (pausing rewinds the song, so a hold can't be finished).
   * A release note dropped this way counts as not released, but doesn't break the streak.
   */
  dropHolds(t = this.now) {
    this.reach(t);
    for (let lane = 0; lane < this.holding.length; lane++) {
      this.laneDown[lane] = 0;
      const idx = this.holding[lane];
      if (idx < 0) continue;
      this.holding[lane] = -1;
      if (this.chart.notes[idx].release) this.releaseState[idx] = 2;
      this.emit({ type: 'sustain-end', lane, complete: false });
    }
  }

  isReleased(i: number) {
    return this.releaseState[i] === 1;
  }

  isReleaseMissed(i: number) {
    return this.releaseState[i] === 2;
  }

  activateOverdrive(t = this.now) {
    this.reach(t);
    if (this.overdriveActive || this.meter < PHRASE_REWARD) return false;
    this.overdriveActive = true;
    this.overdriveActivations++;
    this.emit({ type: 'overdrive-start' });
    return true;
  }

  /** Advance to song time t: what is due before t happens, each thing at its own time. */
  update(t: number) {
    // The song was wound back (after a pause): time counts on from there.
    if (t < this.now) this.mark = Math.min(this.mark, t);
    this.advance(t);
    this.now = t;
  }

  /** Brings the session to the time of an input: what was due before it has happened, and the points up to it are settled. */
  private reach(t: number) {
    this.advance(t);
    this.settle(t);
    if (t > this.now) this.now = t;
  }

  /** Sustain points of the holds from `mark` to `to`, at the multiplier that holds now. */
  private sustainPoints(to: number): number {
    let sum = 0;
    for (let lane = 0; lane < this.holding.length; lane++) {
      const idx = this.holding[lane];
      if (idx < 0) continue;
      const n = this.chart.notes[idx];
      const start = Math.max(n.t, this.mark);
      const end = Math.min(n.t + n.dur, to);
      if (end > start) sum += ((end - start) / this.chart.secondsPerBeat) * SUSTAIN_POINTS_PER_BEAT * this.multiplier;
    }
    return sum;
  }

  /**
   * Settles sustain points and the overdrive drain up to `to`. Called only at the times of inputs
   * and of the things that happen by themselves, never at a frame: between those the multiplier
   * does not change, and a run adds up the same however often it is drawn.
   */
  private settle(to: number) {
    if (to <= this.mark) return;
    this.points += this.sustainPoints(to);
    if (this.overdriveActive) this.meter = Math.max(0, this.meter - (to - this.mark) * this.drain);
    this.mark = to;
  }

  /** Lets everything happen that is due before t, in order of time. */
  private advance(t: number) {
    const notes = this.chart.notes;
    for (;;) {
      while (this.cursor < notes.length && this.state[this.cursor] !== NoteState.Pending) this.cursor++;
      // The earliest of: the next note's window closing, a hold ending, overdrive running out.
      let at = Infinity;
      let what: 'miss' | 'overdrive' | number = 'miss';
      if (this.cursor < notes.length) at = notes[this.cursor].t + WINDOWS.good;
      for (let lane = 0; lane < this.holding.length; lane++) {
        const idx = this.holding[lane];
        if (idx < 0) continue;
        const n = notes[idx];
        // A hold that must be let go on time is missed once its release window has passed.
        const due = n.t + n.dur + (n.release ? WINDOWS.good : 0);
        if (due < at) {
          at = due;
          what = lane;
        }
      }
      if (this.overdriveActive) {
        const out = this.mark + this.meter / this.drain;
        if (out < at) {
          at = out;
          what = 'overdrive';
        }
      }
      if (!(at < t)) return;
      this.settle(at);
      if (what === 'miss') this.miss(this.cursor++);
      else if (what === 'overdrive') {
        this.meter = 0;
        this.overdriveActive = false;
        this.emit({ type: 'overdrive-end' });
      } else {
        const idx = this.holding[what];
        this.holding[what] = -1;
        if (notes[idx].release) {
          this.releaseMiss(idx, what, false);
          this.emit({ type: 'sustain-end', lane: what, complete: false });
        } else this.emit({ type: 'sustain-end', lane: what, complete: true });
      }
    }
  }

  private miss(i: number) {
    const n = this.chart.notes[i];
    this.state[i] = NoteState.Missed;
    if (n.release) this.releaseState[i] = 2;
    this.counts.miss++;
    this.streak = 0;
    this.emit({ type: 'miss', lane: n.lane, noteIndex: i });
    if (n.phrase >= 0 && !this.phraseFailed.has(n.phrase)) {
      this.phraseFailed.add(n.phrase);
      this.emit({ type: 'phrase-failed', phrase: n.phrase });
    }
  }

  isHit(i: number) {
    return this.state[i] === NoteState.Hit;
  }

  isMissed(i: number) {
    return this.state[i] === NoteState.Missed;
  }

  isPhraseFailed(phrase: number) {
    return this.phraseFailed.has(phrase);
  }

  private checkPhrase(i: number) {
    const p = this.chart.notes[i].phrase;
    if (p < 0 || this.phraseFailed.has(p) || this.phraseLast.get(p) !== i) return;
    // The last note of a phrase was hit; every earlier note must have been hit too.
    for (let j = i; j >= 0 && this.chart.notes[j].t >= this.chart.notes[i].t - 60; j--) {
      if (this.chart.notes[j].phrase === p && this.state[j] !== NoteState.Hit) {
        this.phraseFailed.add(p);
        this.emit({ type: 'phrase-failed', phrase: p });
        return;
      }
    }
    this.meter = Math.min(1, this.meter + PHRASE_REWARD);
    this.emit({ type: 'phrase-complete', phrase: p });
  }

  /** How far the score is toward the next star, or toward gold after the fifth, 0..1 (1 once they are gold). */
  get nextStarProgress() {
    return starProgress(this.score, this.par, this.goldAt);
  }

  get progressStars() {
    return starsFor(this.score, this.par, this.goldAt);
  }

  results(): Results {
    const total = this.chart.notes.length;
    const hits = this.counts.perfect + this.counts.great + this.counts.good;
    return {
      score: Math.round(this.score),
      stars: starsFor(this.score, this.par, this.goldAt),
      accuracy: total ? hits / total : 0,
      counts: { ...this.counts },
      bestStreak: this.bestStreak,
      totalNotes: total,
      fullCombo: total > 0 && hits === total,
      overdriveActivations: this.overdriveActivations,
      releases: { hit: this.releasesHit, total: this.chart.notes.filter((n) => n.release).length },
    };
  }
}
