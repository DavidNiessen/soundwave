/**
 * Replays: a run recorded as its inputs, in order, so that it can be played again exactly. The
 * session judges by song time, not by frames (src/game/GameSession.ts), so the presses, releases,
 * overdrive starts and pauses with their song times are the whole run: played into a new session
 * they give the same hits, misses and score, down to the last sustain point, at any frame rate.
 *
 * A run is a list of operations, each a byte (what it was, and for a press or release its lane in
 * the upper bits) and a song time stored as a 32-bit float. The recorder rounds every time to that
 * float before the session sees it, so what is stored is exactly what was judged.
 *
 * Runs recorded before the session judged by time (replay format 1) also hold an update for every
 * frame; a frame that went back in time is how they show a pause's rewind.
 */
import type { Chart } from '../chart/types';
import { GameSession, type Results } from './GameSession';

/** What a recorded operation was (its byte's lower three bits). */
export const OP = { update: 0, press: 1, release: 2, overdrive: 3, dropHolds: 4, rewind: 5 } as const;
/** The highest operation byte's lower bits a run may hold. */
export const LAST_OP = OP.rewind;

/** A recorded run: one byte and one song time per operation. */
export interface ReplayInputs {
  ops: Uint8Array;
  times: Float32Array;
}

/** Grows by doubling, so a long song never copies its inputs more than a handful of times. */
class Tape {
  ops = new Uint8Array(4096);
  times = new Float32Array(4096);
  length = 0;
  push(op: number, t: number) {
    if (this.length === this.ops.length) {
      const ops = new Uint8Array(this.length * 2);
      const times = new Float32Array(this.length * 2);
      ops.set(this.ops);
      times.set(this.times);
      this.ops = ops;
      this.times = times;
    }
    this.ops[this.length] = op;
    this.times[this.length] = t;
    this.length++;
  }
}

/**
 * Stands between a song and its session while it is played: each call is written down, then
 * passed on with its time rounded the way it is stored.
 */
export class ReplayRecorder {
  private tape = new Tape();

  constructor(readonly session: GameSession) {}

  press(lane: number, t: number) {
    const at = Math.fround(t);
    this.tape.push(OP.press | (lane << 3), at);
    this.session.press(lane, at);
  }

  release(lane: number, t: number) {
    const at = Math.fround(t);
    this.tape.push(OP.release | (lane << 3), at);
    this.session.release(lane, at);
  }

  /** A frame: moves the session on, but isn't written down, since frames don't change a run. */
  update(t: number) {
    this.session.update(t);
  }

  /** The song is over: everything still due happens. Written down, so a replay knows where it ends. */
  end() {
    this.tape.push(OP.update, Number.POSITIVE_INFINITY);
    this.session.update(Number.POSITIVE_INFINITY);
  }

  overdrive(t: number) {
    const at = Math.fround(t);
    this.tape.push(OP.overdrive, at);
    return this.session.activateOverdrive(at);
  }

  dropHolds(t: number) {
    const at = Math.fround(t);
    this.tape.push(OP.dropHolds, at);
    this.session.dropHolds(at);
  }

  /** The song was wound back to `t` (resuming from a pause). */
  rewind(t: number) {
    const at = Math.fround(t);
    this.tape.push(OP.rewind, at);
    this.session.rewind(at);
  }

  /** The run so far, copied out. */
  take(): ReplayInputs {
    return { ops: this.tape.ops.slice(0, this.tape.length), times: this.tape.times.slice(0, this.tape.length) };
  }
}

/**
 * Plays one recorded operation into a session. `framed`: the run holds an update for every frame
 * (format 1), and one that went back in time was the rewind of a pause.
 */
function apply(session: GameSession, op: number, t: number, framed: boolean) {
  const lane = op >> 3;
  switch (op & 7) {
    case OP.update:
      if (framed && t < session.time) return session.rewind(t);
      return session.update(t);
    case OP.press:
      return session.press(lane, t);
    case OP.release:
      return session.release(lane, t);
    case OP.overdrive:
      return void session.activateOverdrive(t);
    case OP.dropHolds:
      return session.dropHolds(t);
    case OP.rewind:
      return session.rewind(t);
  }
}

/** Whether a run holds an update for every frame (recorded before the session judged by time). */
function isFramed(inputs: ReplayInputs) {
  const n = Math.min(inputs.ops.length, inputs.times.length);
  for (let i = 0; i < n; i++) if ((inputs.ops[i] & 7) === OP.update && Number.isFinite(inputs.times[i])) return true;
  return false;
}

/**
 * A recorded run played back on the song's own clock. Each operation is due at its song time; a
 * pause rewinds the song a little, so the times after one run back for a moment: those operations
 * are due once playback reaches the latest time recorded before them, which keeps them in order.
 * The last update of a run (the song ending) is due at its end.
 */
export class ReplayPlayback {
  session: GameSession;
  /** Song time each operation is due at; never decreasing. */
  readonly due: Float64Array;
  /** Song time the run ended at. */
  readonly end: number;
  private next = 0;
  private readonly framed: boolean;

  constructor(
    readonly chart: Chart,
    readonly inputs: ReplayInputs,
  ) {
    const n = Math.min(inputs.ops.length, inputs.times.length);
    this.due = new Float64Array(n);
    let latest = Number.NEGATIVE_INFINITY;
    let finite = chart.duration;
    for (let i = 0; i < n; i++) if (Number.isFinite(inputs.times[i])) finite = Math.max(finite, inputs.times[i]);
    for (let i = 0; i < n; i++) {
      const t = inputs.times[i];
      latest = Math.max(latest, Number.isFinite(t) ? t : finite);
      this.due[i] = latest;
    }
    this.end = n ? this.due[n - 1] : chart.duration;
    this.framed = isFramed(inputs);
    this.session = new GameSession(chart);
  }

  /** Whether every operation has been played. */
  get done() {
    return this.next >= this.due.length;
  }

  /**
   * Plays every operation due by song time `t` into the session, then moves it on to `t`, so that
   * misses show as they happen. Moving on changes nothing the operations still to come would not:
   * one of them is earlier than `t` only after one that is later, which moves the session on first.
   */
  advance(t: number) {
    const { ops, times } = this.inputs;
    while (this.next < this.due.length && this.due[this.next] <= t) {
      apply(this.session, ops[this.next], times[this.next], this.framed);
      this.next++;
    }
    if (!this.framed) this.session.update(t);
  }

  /**
   * A new session as it stood at song time `t`, built from the start of the run. The old one is
   * left as it was, so whatever listens to it hears nothing of the jump.
   */
  seek(t: number): GameSession {
    this.session = new GameSession(this.chart);
    this.next = 0;
    this.advance(t);
    return this.session;
  }

  /** Plays what is left. */
  finish() {
    this.advance(Number.POSITIVE_INFINITY);
  }
}

/** How a recorded run went, played through from start to end. */
export function replayResults(chart: Chart, inputs: ReplayInputs): Results {
  const p = new ReplayPlayback(chart, inputs);
  p.finish();
  return p.session.results();
}

/** The song times of every note missed in a run, and of every hold let go at the wrong moment. */
export function replayMisses(chart: Chart, inputs: ReplayInputs): number[] {
  const p = new ReplayPlayback(chart, inputs);
  const out: number[] = [];
  p.session.on((e) => {
    if (e.type === 'miss') out.push(chart.notes[e.noteIndex].t);
    else if (e.type === 'release-miss') out.push(chart.notes[e.noteIndex].t + chart.notes[e.noteIndex].dur);
  });
  p.finish();
  return out;
}
