/**
 * Replays: a run recorded as every call the song made into its GameSession, in order, so that it
 * can be played again exactly. The session is a pure state machine, so the same calls with the same
 * song times give the same hits, misses and score, down to the last sustain point.
 *
 * A run is a list of operations, each a byte (what it was, and for a press or release its lane in
 * the upper bits) and a song time stored as a 32-bit float. The recorder rounds every time to that
 * float before the session sees it, so what is stored is exactly what was judged.
 */
import type { Chart } from '../chart/types';
import { GameSession, type Results } from './GameSession';

/** What a recorded operation was (its byte's lower three bits). */
export const OP = { update: 0, press: 1, release: 2, overdrive: 3, dropHolds: 4 } as const;

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

  update(t: number) {
    const at = Math.fround(t);
    this.tape.push(OP.update, at);
    this.session.update(at);
  }

  /** `t`: the song time it happened at (overdrive itself takes none). */
  overdrive(t: number) {
    this.tape.push(OP.overdrive, Math.fround(t));
    return this.session.activateOverdrive();
  }

  dropHolds(t: number) {
    this.tape.push(OP.dropHolds, Math.fround(t));
    this.session.dropHolds();
  }

  /** The run so far, copied out. */
  take(): ReplayInputs {
    return { ops: this.tape.ops.slice(0, this.tape.length), times: this.tape.times.slice(0, this.tape.length) };
  }
}

/** Plays one recorded operation into a session. */
function apply(session: GameSession, op: number, t: number) {
  const lane = op >> 3;
  switch (op & 7) {
    case OP.update:
      return session.update(t);
    case OP.press:
      return session.press(lane, t);
    case OP.release:
      return session.release(lane, t);
    case OP.overdrive:
      return void session.activateOverdrive();
    case OP.dropHolds:
      return session.dropHolds();
  }
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
    this.session = new GameSession(chart);
  }

  /** Whether every operation has been played. */
  get done() {
    return this.next >= this.due.length;
  }

  /** Plays every operation due by song time `t` into the session. */
  advance(t: number) {
    const { ops, times } = this.inputs;
    while (this.next < this.due.length && this.due[this.next] <= t) {
      apply(this.session, ops[this.next], times[this.next]);
      this.next++;
    }
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
