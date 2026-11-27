import type { Chart } from '../chart/types';

/** Gaps without notes at least this long (seconds) get a countdown. */
export const BREAK_MIN = 5;
/** The countdown appears this long after the last note (or its sustain) ends. */
const SHOW_AFTER = 0.6;
/** Countdowns that would be visible for less than this (seconds) aren't shown at all. */
const MIN_VISIBLE = 1.5;
/** The countdown is gone this long before the next note is due. */
const GONE_BEFORE = 0.12;

export interface Break {
  /** When the countdown shows and hides (seconds). It stays until just before the next note is due. */
  from: number;
  to: number;
  /** When the next note reaches the strike line. */
  next: number;
}

/** Long stretches without notes, including an intro before the first note. */
export function findBreaks(chart: Chart, min = BREAK_MIN): Break[] {
  const out: Break[] = [];
  let free = 0;
  for (const n of chart.notes) {
    if (n.t - free >= min) {
      const from = free + (free > 0 ? SHOW_AFTER : 0);
      const to = n.t - GONE_BEFORE;
      if (to - from >= MIN_VISIBLE) out.push({ from, to, next: n.t });
    }
    free = Math.max(free, n.t + n.dur);
  }
  return out;
}

/** A break at least this long (seconds without notes) is an interlude: the highway leaves the screen. */
export const INTERLUDE_MIN = 7;
/** How long the highway takes to leave, and to come back (seconds). */
const LEAVE = 0.8;
const RETURN = 0.9;
/** The highway is back this long before the next note, for the player to get ready. */
const BACK_BEFORE = 1.6;

/** The breaks long enough to be interludes (the intro before the first note is not one). */
export function interludes(breaks: Break[]): Break[] {
  // A break shows SHOW_AFTER after the last note: its stretch without notes is from then to `next`.
  return breaks.filter((b) => b.from > 0 && b.next - (b.from - SHOW_AFTER) >= INTERLUDE_MIN);
}

/**
 * How far the highway is gone at song time `t` (0: in place, 1: out of sight): it eases away as an
 * interlude starts, once the last note has passed the strike line, and eases back in so that it is
 * in place BACK_BEFORE seconds before the next note. Only song time decides it, so it is the same at
 * any frame rate, in a replay and in a video.
 */
export function highwayAway(t: number, list: Break[]): number {
  for (const b of list) {
    const back = b.next - BACK_BEFORE;
    if (t < b.from || t >= back) continue;
    const leaving = (t - b.from) / LEAVE;
    const returning = (back - t) / RETURN;
    const x = Math.min(1, leaving, returning);
    return x * x * (3 - 2 * x);
  }
  return 0;
}

/**
 * Bars left before the next note: bar lines still to come before it, plus the bar it falls in.
 * A note on a bar line counts that bar line as the last one.
 */
export function barsLeft(t: number, next: number, barTimes: number[]): number {
  let n = 0;
  for (const b of barTimes) if (b > t && b < next - 0.05) n++;
  return n + 1;
}
