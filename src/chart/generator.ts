import type { AnalysisResult, DrumKind, PitchedNote } from '../analysis/types';
import { atLeastAt120, barCap, PROFILES, sustainMinBeats, type DifficultyProfile } from './profiles';
import { DIFFICULTIES, type Chart, type Difficulty, type Note, type Part } from './types';

export const CHART_VERSION = 2;

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Maps times to beat positions and back using the (possibly uneven) beat grid. */
export class Grid {
  private readonly beats: number[];
  private readonly spb: number;

  constructor(beats: number[], spb: number) {
    this.beats = beats;
    this.spb = spb;
  }

  pos(t: number): number {
    const b = this.beats;
    if (b.length < 2) return t / this.spb;
    if (t <= b[0]) return (t - b[0]) / (b[1] - b[0]);
    if (t >= b[b.length - 1]) return b.length - 1 + (t - b[b.length - 1]) / (b[b.length - 1] - b[b.length - 2]);
    let lo = 0;
    let hi = b.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (b[mid] <= t) lo = mid;
      else hi = mid;
    }
    return lo + (t - b[lo]) / (b[lo + 1] - b[lo]);
  }

  time(pos: number): number {
    const b = this.beats;
    if (b.length < 2) return pos * this.spb;
    const i = Math.max(0, Math.min(b.length - 2, Math.floor(pos)));
    return b[i] + (pos - i) * (b[i + 1] - b[i]);
  }
}

const EPS = 1e-6;
const isMultiple = (pos: number, step: number) => Math.abs(pos / step - Math.round(pos / step)) < 1e-4;

/** A musical event before lane assignment. Positions are in beats. */
interface Ev {
  pos: number;
  /** Sustain length in beats (0 = tap). */
  len: number;
  midi: number;
  /** Ascending pitches when the event is a chord. */
  chord?: number[];
  strength: number;
  kind?: DrumKind;
}

/** Below Expert, the weaker of two drum hits on one beat makes a chord only from this share of the stronger. */
export const CHORD_SHARE = 0.75;

/**
 * Snaps a beat position to the part's rhythmic grid. Straight parts use sixteenths (a clearly
 * triplet note keeps its triplet); triplet-feel parts (shuffles, triplet rap flows) use triplets,
 * plus eighths and quarters, keeping a sixteenth only when it is clearly one.
 */

function snap(pos: number, feel: Feel): number {
  const q16 = Math.round(pos * 4) / 4;
  const q12 = Math.round(pos * 3) / 3;
  const q8 = Math.round(pos * 2) / 2;
  const e16 = Math.abs(pos - q16);
  const e12 = Math.abs(pos - q12);
  if (feel === 'triplet') {
    const e8 = Math.abs(pos - q8);
    if (e8 <= e12) return q8;
    return e16 < 0.03 && e12 > 0.06 ? q16 : q12;
  }
  // Only clearly-triplet timing counts; small timing errors in straight music stay on sixteenths.
  return e16 > 0.09 && e12 < 0.035 ? q12 : q16;
}

type Feel = 'straight' | 'triplet';

/**
 * Whether a part's notes sit on triplets: compares how many positions are clearly nearer a
 * triplet (1/3, 2/3) than a sixteenth (1/4, 3/4) and the other way round.
 */
export function detectFeel(positions: number[]): Feel {
  let trip = 0;
  let six = 0;
  for (const p of positions) {
    const k = subdivision(p);
    if (k > 0) trip++;
    else if (k < 0) six++;
  }
  return trip >= 12 && trip > six * 1.5 ? 'triplet' : 'straight';
}

/** 1 when a position is clearly on a triplet, -1 when clearly on a sixteenth, else 0. */
function subdivision(p: number): number {
  const f = p - Math.floor(p);
  const d12 = Math.min(Math.abs(f - 1 / 3), Math.abs(f - 2 / 3));
  const d16 = Math.min(Math.abs(f - 0.25), Math.abs(f - 0.75));
  return d12 < 0.05 && d16 > 0.06 ? 1 : d16 < 0.05 && d12 > 0.06 ? -1 : 0;
}

/** Beats on either side that decide the local feel (about a bar each way). */
const FEEL_WINDOW = 4;
/** Clear triplets (or sixteenths) needed in that window to switch feel. */
const FEEL_MIN = 4;

/**
 * Feel at each position: a straight song can switch to a triplet flow for a few bars (and a
 * shuffle can straighten out), so the notes around each beat decide, with the whole part's feel
 * as the default when they are too few or mixed.
 */
export function localFeel(positions: number[]): (pos: number) => Feel {
  const global = detectFeel(positions);
  if (!positions.length) return () => global;
  const first = Math.floor(Math.min(...positions));
  const last = Math.floor(Math.max(...positions));
  // Prefix sums of clear triplets and sixteenths per beat.
  const trip = new Array<number>(last - first + 2).fill(0);
  const six = new Array<number>(last - first + 2).fill(0);
  for (const p of positions) {
    const k = subdivision(p);
    const b = Math.floor(p) - first + 1;
    if (k > 0) trip[b]++;
    else if (k < 0) six[b]++;
  }
  for (let i = 1; i < trip.length; i++) {
    trip[i] += trip[i - 1];
    six[i] += six[i - 1];
  }
  const count = (arr: number[], b: number) => {
    const lo = Math.max(0, Math.min(arr.length - 1, b - FEEL_WINDOW - first));
    const hi = Math.max(0, Math.min(arr.length - 1, b + FEEL_WINDOW - first));
    return arr[hi] - arr[lo];
  };
  return (pos) => {
    const b = Math.floor(pos);
    const t = count(trip, b);
    const x = count(six, b);
    if (global === 'triplet') return x >= FEEL_MIN && x > t * 1.5 ? 'straight' : 'triplet';
    return t >= FEEL_MIN && t > x * 1.5 ? 'triplet' : 'straight';
  };
}

// ---------------------------------------------------------------------------------------------
// Expert transcription

function pitchedExpert(line: PitchedNote[], grid: Grid, duration: number, chords: boolean): Ev[] {
  const byPos = new Map<number, Ev>();
  const feel = localFeel(line.map((n) => grid.pos(n.t)));
  for (const n of line) {
    if (n.t < 0.2 || n.t > duration - 0.05) continue;
    const raw = grid.pos(n.t);
    const pos = snap(raw, feel(raw));
    const endPos = grid.pos(n.t + n.dur);
    const ev: Ev = {
      pos,
      len: Math.max(0, endPos - pos),
      midi: n.midi,
      strength: n.strength,
      ...(chords && n.chord && n.chord.length > 1 ? { chord: n.chord } : {}),
    };
    const key = Math.round(pos * 48);
    const prev = byPos.get(key);
    if (!prev || ev.strength > prev.strength) byPos.set(key, ev);
  }
  return [...byPos.values()].sort((a, b) => a.pos - b.pos);
}

function drumsExpert(a: AnalysisResult, grid: Grid): Ev[] {
  const byKey = new Map<string, Ev>();
  const feel = localFeel(a.drums.map((d) => grid.pos(d.t)));
  for (const d of a.drums) {
    if (d.t < 0.2 || d.t > a.duration - 0.05) continue;
    const raw = grid.pos(d.t);
    const pos = snap(raw, feel(raw));
    const key = `${Math.round(pos * 48)}:${d.kind}`;
    const prev = byKey.get(key);
    if (!prev || d.strength > prev.strength) byKey.set(key, { pos, len: 0, midi: 0, strength: d.strength, kind: d.kind });
  }
  return [...byKey.values()].sort((x, y) => x.pos - y.pos || kindOrder(x.kind!) - kindOrder(y.kind!));
}

const kindOrder = (k: DrumKind) => (k === 'kick' ? 0 : k === 'snare' ? 1 : 2);

// ---------------------------------------------------------------------------------------------
// Reductions: each difficulty simplifies the one above it.

/** Keeps events on the profile's grid; lone off-grid notes move to the nearest free grid slot. */
function reduceRhythm(evs: Ev[], p: DifficultyProfile, spb: number, drums: boolean, downbeats: number[]): Ev[] {
  const step = 1 / p.grid;
  const kept = new Map<number, Ev[]>();
  const key = (pos: number) => Math.round(pos * 48);
  const onGrid = (pos: number) => isMultiple(pos, step) || (p.triplets && isMultiple(pos, 1 / 3));
  for (const e of evs) if (onGrid(e.pos)) kept.set(key(e.pos), [...(kept.get(key(e.pos)) ?? []), e]);
  if (!drums) {
    // A note off the grid with no neighbour on its grid slot keeps its place in the melody, moved.
    for (const e of evs) {
      if (onGrid(e.pos)) continue;
      const target = Math.round(e.pos / step) * step;
      if (kept.has(key(target))) continue;
      const near = evs.some((o) => o !== e && Math.abs(o.pos - target) < step * 0.75 && o.strength >= e.strength);
      if (!near) kept.set(key(target), [{ ...e, pos: target, len: Math.max(0, e.len - (target - e.pos)) }]);
    }
  }
  // Minimum spacing in seconds: drop the weaker note of a too-fast pair (strong beats win ties).
  const times = [...kept.entries()].sort((x, y) => x[0] - y[0]);
  // Rhythmic position first, so repeated bars reduce the same way; loudness only breaks ties.
  // Position in the bar and held length (in half beats) decide, so repeated bars reduce the same
  // way; loudness varies between repeats and only breaks exact ties.
  const weight = (pos: number, list: Ev[]) =>
    metricWeight(pos, downbeats) + 0.25 * Math.min(1, Math.round(Math.max(...list.map((e) => e.len)) * 2) / 4);
  const loudness = (list: Ev[]) => Math.max(...list.map((e) => e.strength));
  const out: [number, Ev[]][] = [];
  for (const [k, list] of times) {
    const pos = k / 48;
    const last = out[out.length - 1];
    if (last && (pos - last[0] / 48) * spb < p.minGap - EPS) {
      const wNew = weight(pos, list);
      const wOld = weight(last[0] / 48, last[1]);
      if (wNew > wOld || (wNew === wOld && loudness(list) > loudness(last[1]) + 0.25)) out[out.length - 1] = [k, list];
      continue;
    }
    out.push([k, list]);
  }
  // Density cap per bar: keep the strongest, most on-beat note times.
  const bars = new Map<number, [number, Ev[]][]>();
  for (const entry of out) {
    const b = barIndex(entry[0] / 48, downbeats);
    bars.set(b, [...(bars.get(b) ?? []), entry]);
  }
  const keep = new Set<number>();
  for (const [b, entries] of bars) {
    const ranked = [...entries].sort((x, y) => weight(y[0] / 48, y[1]) - weight(x[0] / 48, x[1]) || x[0] - y[0]);
    for (const [k] of ranked.slice(0, barCap(p, barBeats(b, downbeats)))) keep.add(k);
  }
  return out.filter(([k]) => keep.has(k)).flatMap(([, list]) => list);
}

/**
 * How rhythmically important a position is: the bar line > the middle of an even bar (beat 3 of
 * four, beat 4 of six) > other beats > eighths > the rest. Bars of three, five or seven beats have
 * no strong middle.
 */
function metricWeight(pos: number, downbeats: number[]): number {
  if (isMultiple(pos, 1)) {
    const b = barIndex(pos, downbeats);
    if (b < 0) return 1.5;
    const inBar = pos - downbeats[b];
    if (Math.abs(inBar) < EPS) return 2;
    const len = barBeats(b, downbeats);
    return len >= 4 && len % 2 === 0 && Math.abs(inBar - len / 2) < EPS ? 1.7 : 1.5;
  }
  return isMultiple(pos, 0.5) ? 1.2 : 1;
}

/** Beats in a bar (the one before the first bar line, and the last, count as long as their neighbour). */
function barBeats(b: number, downbeats: number[]): number {
  if (downbeats.length < 2) return 4;
  const i = Math.max(0, Math.min(downbeats.length - 2, b));
  return Math.max(1, Math.round(downbeats[i + 1] - downbeats[i]));
}

/** Index of the bar containing a beat position (-1 before the first downbeat). */
function barIndex(pos: number, downbeats: number[]): number {
  if (!downbeats.length) return Math.floor(pos / 4);
  if (pos < downbeats[0] - EPS) return -1;
  let lo = 0;
  let hi = downbeats.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (downbeats[mid] <= pos + EPS) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Fewest kicks and snares on the beat in a bar for easy to leave out its hi-hats. Where the hats
 * carry the groove (trap, house, a verse with only a hat), dropping them would leave easy all but empty.
 */
const EASY_KIT_MIN = 2;

function reduceDrums(evs: Ev[], d: Difficulty, downbeats: number[]): Ev[] {
  if (d === 'expert') return evs;
  const kitOnBeat = new Map<number, number>();
  for (const e of evs) {
    if (e.kind === 'hat' || !isMultiple(e.pos, 1)) continue;
    const b = barIndex(e.pos, downbeats);
    kitOnBeat.set(b, (kitOnBeat.get(b) ?? 0) + 1);
  }
  return evs.filter((e) => {
    if (e.kind !== 'hat') return true;
    // Hi-hats thin out first: on easy only on the beat where the kick and snare leave the bar
    // nearly empty, quarters on medium, eighths on hard.
    if (d === 'easy') return isMultiple(e.pos, 1) && (kitOnBeat.get(barIndex(e.pos, downbeats)) ?? 0) < EASY_KIT_MIN;
    return d === 'medium' ? isMultiple(e.pos, 1) : isMultiple(e.pos, 0.5);
  });
}

// ---------------------------------------------------------------------------------------------
// Lane assignment for pitched parts

interface PhraseCtx {
  lanes: number;
  partLo: number;
  partHi: number;
  memo: Map<string, number[]>;
  /** Pitch-to-lane mappings already used in this chart; reused when they cover a new block. */
  mappings?: Map<number, number>[];
}

/** Lane step for an interval: small steps move one lane, leaps more. */
const stepFor = (interval: number) => (interval <= 4 ? 1 : interval <= 9 ? 2 : 3);

/**
 * Lanes for one segment with at most `lanes` distinct pitches: lowest pitch to the left, highest to
 * the right, the same pitch always in the same lane, wider intervals further apart. The block sits
 * where the segment's register falls within the part's overall range.
 */
function segmentLanes(pitches: number[], ctx: PhraseCtx, anchor?: { lane: number; midi: number; firstMidi: number }): Map<number, number> {
  const distinct = [...new Set(pitches)].sort((a, b) => a - b);
  const pos: number[] = [0];
  for (let i = 1; i < distinct.length; i++) pos.push(pos[i - 1] + stepFor(distinct[i] - distinct[i - 1]));
  let span = pos[pos.length - 1];
  if (span > ctx.lanes - 1) {
    // Too wide: fall back to plain ranks, which always fit.
    for (let i = 0; i < pos.length; i++) pos[i] = i;
    span = distinct.length - 1;
  }
  const room = ctx.lanes - 1 - span;
  let offset: number;
  if (anchor) {
    // Continue from the previous segment in the direction the melody moves.
    const idx = distinct.indexOf(anchor.firstMidi);
    const dir = Math.sign(anchor.firstMidi - anchor.midi);
    const want = Math.max(0, Math.min(ctx.lanes - 1, anchor.lane + (dir === 0 ? 0 : dir)));
    offset = Math.max(0, Math.min(room, want - pos[idx]));
  } else {
    const median = [...pitches].sort((a, b) => a - b)[pitches.length >> 1];
    const reg = ctx.partHi > ctx.partLo ? (median - ctx.partLo) / (ctx.partHi - ctx.partLo) : 0.5;
    offset = Math.round(Math.max(0, Math.min(1, reg)) * room);
  }
  return new Map(distinct.map((m, i) => [m, pos[i] + offset]));
}

/** Lanes for a phrase (melody pitches in order). Long runs are wrapped into segments. */
function phraseLanes(pitches: number[], ctx: PhraseCtx): number[] {
  const out: number[] = [];
  let start = 0;
  let prev: { lane: number; midi: number } | undefined;
  while (start < pitches.length) {
    const seen = new Set<number>();
    let end = start;
    while (end < pitches.length && (seen.has(pitches[end]) || seen.size < ctx.lanes)) seen.add(pitches[end++]);
    const seg = pitches.slice(start, end);
    const map = segmentLanes(seg, ctx, prev ? { ...prev, firstMidi: seg[0] } : undefined);
    for (const m of seg) out.push(map.get(m)!);
    prev = { lane: out[out.length - 1], midi: seg[seg.length - 1] };
    start = end;
  }
  return out;
}

/**
 * Lanes for a whole part, mapped over the largest stretch that fits: a section whose pitches fit
 * the lanes gets one mapping, so a riff sits in the same lanes everywhere and up always means right.
 * Stretches with too many pitches split in half (8 bars, 4, 2, 1) and finally wrap within a bar.
 * Each block is shifted, when it can be, so the move into it follows the melody's direction.
 */
function assignPitchedLanes(evs: Ev[], downbeats: number[], sectionStarts: number[], ctx: PhraseCtx): number[] {
  const lanes: number[] = new Array(evs.length);
  if (!evs.length) return lanes;
  const starts = [...new Set([...sectionStarts, Infinity])].sort((a, b) => a - b);
  let prev: { lane: number; midi: number } | undefined;

  const place = (idx: number[]) => {
    const pitches = idx.map((i) => evs[i].midi);
    ctx.mappings ??= [];
    // Reuse an earlier mapping that already covers these pitches, so a riff that comes back in
    // another section lands in the same lanes.
    let map = ctx.mappings.find((m) => pitches.every((p) => m.has(p)));
    if (!map) {
      map = segmentLanes(pitches, ctx);
      // A new mapping is shifted once (when it can be) so the move into it follows the melody;
      // it is stored shifted, so every later reuse is identical.
      if (prev) {
        const ls = [...map.values()];
        const want = Math.sign(pitches[0] - prev.midi);
        const lo = -Math.min(...ls);
        const hi = ctx.lanes - 1 - Math.max(...ls);
        const first = map.get(pitches[0])!;
        const ok = (k: number) => Math.sign(first + k - prev!.lane) === want;
        let shift = 0;
        if (!ok(0)) {
          for (let d = 1; d <= ctx.lanes; d++) {
            if (d <= hi && ok(d)) {
              shift = d;
              break;
            }
            if (-d >= lo && ok(-d)) {
              shift = -d;
              break;
            }
          }
        }
        if (shift) map = new Map([...map].map(([m, l]) => [m, l + shift]));
      }
      ctx.mappings.push(map);
    }
    idx.forEach((i) => (lanes[i] = map!.get(evs[i].midi)!));
    const last = idx[idx.length - 1];
    prev = { lane: lanes[last], midi: evs[last].midi };
  };

  const bars = (idx: number[]) => [...new Set(idx.map((i) => barIndex(evs[i].pos, downbeats)))].sort((a, b) => a - b);
  const map = (idx: number[]) => {
    if (!idx.length) return;
    if (new Set(idx.map((i) => evs[i].midi)).size <= ctx.lanes) return place(idx);
    const bs = bars(idx);
    if (bs.length <= 1) {
      // One bar with more pitches than lanes: wrap the run.
      const ls = phraseLanes(
        idx.map((i) => evs[i].midi),
        ctx,
      );
      idx.forEach((i, k) => (lanes[i] = ls[k]));
      const last = idx[idx.length - 1];
      prev = { lane: lanes[last], midi: evs[last].midi };
      return;
    }
    const mid = bs[Math.floor(bs.length / 2)];
    map(idx.filter((i) => barIndex(evs[i].pos, downbeats) < mid));
    map(idx.filter((i) => barIndex(evs[i].pos, downbeats) >= mid));
  };

  // One mapping for the whole part when its pitches fit; otherwise section by section.
  const all = evs.map((_, i) => i);
  if (new Set(evs.map((e) => e.midi)).size <= ctx.lanes) {
    place(all);
    return lanes;
  }
  for (let s = 0; s + 1 < starts.length; s++) {
    map(all.filter((i) => evs[i].pos >= starts[s] - EPS && evs[i].pos < starts[s + 1] - EPS));
  }
  // Events before the first section start (if any).
  map(evs.map((_, i) => i).filter((i) => lanes[i] === undefined));
  return lanes;
}

/**
 * Which thumb plays a lane on a controller: the left thumb has the two leftmost lanes (D-pad left
 * and right), the right thumb the face-button lanes. One thumb presses one button at a time.
 */
export const thumbOf = (lane: number) => (lane <= 1 ? 0 : 1);

/**
 * Chord lanes: the melody lane first, plus one partner under the other thumb (a thumb can't hold
 * two buttons). The interval decides how far apart they sit; the partner prefers the left side.
 */
function chordShape(top: number, chord: number[], p: DifficultyProfile): number[] {
  const span = chord[chord.length - 1] - chord[0];
  const gap = Math.min(span <= 4 ? 1 : span <= 8 ? 2 : 3, p.maxChordSpread);
  if (gap < 1) return [top];
  let best = -1;
  let bestCost = Infinity;
  for (let lane = 0; lane < p.lanes; lane++) {
    const d = top - lane;
    if (thumbOf(lane) === thumbOf(top) || Math.abs(d) > p.maxChordSpread) continue;
    const cost = Math.abs(Math.abs(d) - gap) + (d < 0 ? 0.5 : 0);
    if (cost < bestCost) {
      bestCost = cost;
      best = lane;
    }
  }
  return best < 0 ? [top] : [top, best];
}

// ---------------------------------------------------------------------------------------------
// Overdrive: the same musical windows on every difficulty

function overdriveWindows(expert: Ev[], a: AnalysisResult, grid: Grid, r: () => number): [number, number][] {
  if (a.downbeats.length < 8 || expert.length < 8) return [];
  const barPos = a.downbeats;
  const energyAt = (t: number) => a.sections.find((s) => t >= s.start && t < s.end)?.energy ?? 0.6;
  const windows: [number, number][] = [];
  let bar = 4 + Math.floor(r() * 4);
  while (bar < barPos.length - 2) {
    let best = bar;
    for (let k = bar; k < Math.min(barPos.length - 2, bar + 4); k++) {
      if (energyAt(grid.time(barPos[k])) > energyAt(grid.time(barPos[best])) + 0.1) best = k;
    }
    const count = (l: number) => expert.filter((e) => e.pos >= barPos[best] - EPS && e.pos < (barPos[best + l] ?? Infinity) - EPS).length;
    const len = count(1) < 4 ? 2 : 1;
    if (count(len) >= 3) windows.push([barPos[best], barPos[best + len] ?? barPos[best] + 4 * len]);
    bar = best + len + 7 + Math.floor(r() * 6);
  }
  return windows;
}

// ---------------------------------------------------------------------------------------------

function lineFor(a: AnalysisResult, part: Part): PitchedNote[] {
  if (part === 'bass') return a.bass;
  if (part === 'vocals') return a.vocals ?? [];
  return a.lead;
}

function medianInterval(beats: number[], tempo: number) {
  const intervals = beats
    .slice(1)
    .map((b, i) => b - beats[i])
    .sort((x, y) => x - y);
  return intervals.length ? intervals[Math.floor(intervals.length / 2)] : 60 / (tempo || 120);
}

/** Builds a playable chart for one part and difficulty from an analysis result. */
export function generateChart(a: AnalysisResult, part: Part, difficulty: Difficulty, seedKey = ''): Chart {
  return generateAll(a, part, seedKey)[difficulty];
}

/**
 * Builds all difficulties of a part together: expert is transcribed, then each difficulty reduces
 * the one above it, so lower difficulties keep the same musical skeleton.
 */
export function generateAll(a: AnalysisResult, part: Part, seedKey = ''): Record<Difficulty, Chart> {
  const spb = medianInterval(a.beats, a.tempo);
  const grid = new Grid(a.beats, spb);
  const r = rng(seedFrom(`${seedKey}:${part}:${CHART_VERSION}`));
  const drums = part === 'drums';
  const line = lineFor(a, part);

  const expertEvs = drums ? drumsExpert(a, grid) : pitchedExpert(line, grid, a.duration, part === 'lead');
  const windows = overdriveWindows(expertEvs, a, grid, r);
  const midis = line.map((n) => n.midi).sort((x, y) => x - y);
  const partLo = midis[Math.floor(midis.length * 0.05)] ?? 48;
  const partHi = midis[Math.floor(midis.length * 0.95)] ?? 72;

  const sectionStarts = a.sections.map((s) => grid.pos(s.start));
  const out = {} as Record<Difficulty, Chart>;
  let source = expertEvs;
  for (const d of [...DIFFICULTIES].reverse()) {
    const p = PROFILES[d];
    const evs = drums
      ? reduceRhythm(reduceDrums(source, d, a.downbeats), p, spb, true, a.downbeats)
      : reduceRhythm(source, p, spb, false, a.downbeats);
    const notes = drums
      ? drumNotes(evs, p, d)
      : pitchedNotes(
          evs,
          p,
          d,
          a.downbeats,
          sectionStarts,
          { lanes: p.pitchedLanes, partLo, partHi, memo: new Map() },
          spb,
          part === 'vocals',
        );
    const timed: Note[] = notes.map((n) => ({ ...n, t: grid.time(n.t), dur: n.dur > 0 ? grid.time(n.t + n.dur) - grid.time(n.t) : 0 }));
    timed.sort((x, y) => x.t - y.t || x.lane - y.lane);
    const clean = validate(timed, p.lanes, p, spb);
    windows.forEach(([s, e], id) => {
      const ts = grid.time(s) - 1e-3;
      const te = grid.time(e) - 1e-3;
      const members = clean.filter((n) => n.t >= ts && n.t < te);
      if (members.length >= 2) for (const n of members) n.phrase = id;
    });
    out[d] = {
      part,
      difficulty: d,
      lanes: p.lanes,
      notes: clean,
      beats: a.beats,
      downbeats: a.downbeats,
      secondsPerBeat: spb,
      duration: a.duration,
    };
    source = evs;
  }
  return out;
}

/** Lane move for a sung interval: singers' steps are small, so leaps of a third already move two. */
const sungStep = (interval: number) => (interval <= 2 ? 1 : interval <= 5 ? 2 : 3);

/** Rests at least this long (beats) start a new sung phrase, placed afresh from its register. */
const PHRASE_GAP_BEATS = 2;
/** Notes closer than this (seconds) never share a lane: one finger per lane can't hammer them. */
const FAST_REPEAT = 0.25;

/**
 * Sung lines walk the lanes, as human vocal charts for one-finger-per-lane play do. A phrase starts
 * where its pitch sits in the singer's range; then the lane follows the melody (up = right, wider
 * intervals further), and a syllable on the same pitch still moves on, rolling in the current
 * direction and turning at the edges: two lanes on the beat and on sixteenths, one on the eighth
 * between, so the pattern carries the rhythm and a repeated phrase charts the same. Fast notes
 * never repeat a lane.
 */
function walkLanes(evs: Ev[], ctx: PhraseCtx, spb: number): number[] {
  const n = ctx.lanes;
  const lanes: number[] = [];
  const home = (midi: number) => {
    const reg = ctx.partHi > ctx.partLo ? (midi - ctx.partLo) / (ctx.partHi - ctx.partLo) : 0.5;
    return Math.round(Math.max(0, Math.min(1, reg)) * (n - 1));
  };
  let dir = 1;
  evs.forEach((e, i) => {
    const prev = evs[i - 1];
    if (!prev || e.pos - prev.pos >= PHRASE_GAP_BEATS - EPS) {
      lanes.push(home(e.midi));
      dir = lanes[i] >= (n - 1) / 2 ? -1 : 1;
      return;
    }
    const last = lanes[i - 1];
    const gap = (e.pos - prev.pos) * spb;
    const interval = e.midi - prev.midi;
    let lane: number;
    if (interval !== 0) {
      dir = Math.sign(interval);
      lane = last + dir * sungStep(Math.abs(interval));
    } else {
      lane = last + dir * (isMultiple(e.pos, 1) ? 2 : isMultiple(e.pos, 0.5) ? 1 : 2);
    }
    if (lane < 0 || lane > n - 1) {
      // Out of room: a repeated pitch turns around; a melody step goes as far as it can.
      lane = interval === 0 ? last - dir : Math.max(0, Math.min(n - 1, lane));
      if (interval === 0) dir = -dir;
    }
    if (lane === last && gap < FAST_REPEAT) {
      // Pinned at the edge by a rising or falling run: step back rather than hammer one lane.
      lane = last + (last === 0 ? 1 : last === n - 1 ? -1 : dir);
    }
    lanes.push(Math.max(0, Math.min(n - 1, lane)));
  });
  return lanes;
}

/**
 * Where a held note can end in a release, or 0: a note held at least a beat (1.5 on medium) whose
 * end falls on a beat or half-beat (snapped when close) and is followed by a rest of half a beat
 * (three quarters on medium), so letting go is part of the rhythm. Easy keeps plain holds.
 */
function releaseEnd(pos: number, len: number, nextPos: number | undefined, d: Difficulty): number {
  if (d === 'easy' || len < (d === 'medium' ? 1.5 : 1)) return 0;
  const end = Math.round((pos + len) * 2) / 2;
  if (Math.abs(end - (pos + len)) > 0.25 || end - pos < (d === 'medium' ? 1.5 : 1)) return 0;
  if (nextPos !== undefined && nextPos - end < (d === 'medium' ? 0.75 : 0.5)) return 0;
  return end;
}

/** Notes in beat positions (t and dur are positions here; converted to seconds by the caller). */
function pitchedNotes(
  evs: Ev[],
  p: DifficultyProfile,
  d: Difficulty,
  downbeats: number[],
  sectionStarts: number[],
  ctx: PhraseCtx,
  spb: number,
  walk: boolean,
): Note[] {
  const lanes = walk ? walkLanes(evs, ctx, spb) : assignPitchedLanes(evs, downbeats, sectionStarts, ctx);
  // Chord budget: the most important stabs (beat position, then length) up to the profile's rate.
  // A score threshold instead of a count keeps repeated stabs consistent.
  const chordScore = (e: Ev) => metricWeight(e.pos, downbeats) + 0.5 * Math.min(1, e.len / 2);
  const eligible = evs.filter((e) => e.chord && p.maxChord >= 2 && d !== 'easy' && isMultiple(e.pos, p.chordGrid));
  const budget = Math.floor(evs.length * p.chordRate);
  const ranked = eligible.map(chordScore).sort((x, y) => y - x);
  let threshold = budget > 0 && ranked.length ? ranked[Math.min(ranked.length, budget) - 1] : Infinity;
  // Equal stabs all get the chord (consistency), unless that overshoots the budget by half; then
  // only stabs scoring strictly higher do.
  if (ranked.filter((x) => x >= threshold).length > budget * 1.5) threshold = ranked.find((x) => x > threshold) ?? Infinity;
  const notes: Note[] = [];
  evs.forEach((e, i) => {
    const next = evs[i + 1];
    // Chords and their sustains are reserved for the right places on each difficulty.
    const chordHere = eligible.includes(e) && chordScore(e) >= threshold;
    const hold = sustainMinBeats(p, spb);
    const minLen = chordHere ? Math.max(hold, atLeastAt120(1.5, spb)) : hold;
    let len = e.len >= minLen ? e.len : 0;
    if (len && next) len = Math.min(len, next.pos - e.pos - p.sustainGapBeats);
    if (len < minLen * 0.75) len = 0;
    const release = len > 0 && releaseEnd(e.pos, len, next?.pos, d);
    if (release) len = release - e.pos;
    const shape = chordHere ? chordShape(lanes[i], e.chord!, p) : [lanes[i]];
    for (const lane of new Set(shape)) notes.push({ t: e.pos, lane, dur: len, phrase: -1, ...(release ? { release: true } : {}) });
  });
  return notes;
}

const DRUM_LANES: Record<4 | 5, Record<DrumKind, [number, number]>> = {
  4: { kick: [0, 1], snare: [2, 1], hat: [3, 2] },
  5: { kick: [0, 1], snare: [2, 3], hat: [4, 3] },
};

/** Fixed kit layout (kick left, snare middle, hats right); quick repeats alternate hands. */
function drumNotes(evs: Ev[], p: DifficultyProfile, d: Difficulty): Note[] {
  const notes: Note[] = [];
  const last: Record<DrumKind, { lane: number; pos: number; bar: number }> = {
    kick: { lane: -1, pos: -9, bar: -1 },
    snare: { lane: -1, pos: -9, bar: -1 },
    hat: { lane: -1, pos: -9, bar: -1 },
  };
  const byPos = new Map<number, Ev[]>();
  for (const e of evs) byPos.set(Math.round(e.pos * 48), [...(byPos.get(Math.round(e.pos * 48)) ?? []), e]);
  for (const [, group] of [...byPos.entries()].sort((x, y) => x[0] - y[0])) {
    let hits = [...group].sort((x, y) => y.strength - x.strength);
    if (d === 'easy') {
      // One hit per beat: backbeat snares, otherwise kick.
      const snare = hits.find((h) => h.kind === 'snare');
      const kick = hits.find((h) => h.kind === 'kick');
      const backbeat = snare && Math.round(snare.pos) % 2 === 1;
      hits = [(backbeat || !kick ? snare : kick) ?? hits[0]];
    }
    // Chords on lower difficulties: only strong kick+snare backbeats, so the kit doesn't turn into
    // constant two-hand hits. The weaker hit must be strong by itself and also close to the
    // stronger one: a kick that only just made it in beside a loud snare stays a single note.
    const backbeat = isMultiple(group[0].pos, 1) && Math.round(group[0].pos) % 2 === 1;
    const second = hits[1]?.strength ?? 0;
    const close = second >= CHORD_SHARE * hits[0].strength;
    const allowChord = d === 'expert' || (close && (d === 'hard' ? second >= 0.45 : backbeat && second >= 0.5));
    hits = hits.slice(0, allowChord ? p.maxChord : 1);
    // One hit per thumb: a hit whose thumb is busy takes its other lane if that is under the free
    // thumb, otherwise it drops (hits are in order of strength).
    const thumbs = new Set<number>();
    for (const h of hits) {
      const [first, second] = DRUM_LANES[p.lanes][h.kind!];
      const prev = last[h.kind!];
      const bar = Math.floor(h.pos / 4);
      // Alternate on quick repeats; reset each bar so repeated bars chart identically.
      let lane = prev.bar === bar && prev.lane === first && h.pos - prev.pos <= 0.5 + EPS ? second : first;
      if (thumbs.has(thumbOf(lane))) lane = lane === first ? second : first;
      if (thumbs.has(thumbOf(lane))) continue;
      thumbs.add(thumbOf(lane));
      last[h.kind!] = { lane, pos: h.pos, bar };
      notes.push({ t: h.pos, lane, dur: 0, phrase: -1 });
    }
  }
  return notes;
}

/**
 * Removes duplicates, keeps at most one note per thumb at any moment (see thumbOf), and makes sure
 * sustains never run into later notes, so a held note never needs its thumb for anything else.
 */
export function validate(notes: Note[], lanes: number, p: DifficultyProfile, spb: number): Note[] {
  const out: Note[] = [];
  const seen = new Set<string>();
  for (const n of notes) {
    if (n.lane < 0 || n.lane >= lanes || !Number.isFinite(n.t)) continue;
    const k = `${n.t.toFixed(4)}:${n.lane}`;
    const thumb = `${n.t.toFixed(4)}:thumb${thumbOf(n.lane)}`;
    if (seen.has(k) || seen.has(thumb)) continue;
    seen.add(k);
    seen.add(thumb);
    out.push({ ...n });
  }
  const gap = Math.max(0.05, spb * p.sustainGapBeats);
  for (let i = 0; i < out.length; i++) {
    const n = out[i];
    if (n.dur <= 0) continue;
    for (let j = i + 1; j < out.length && out[j].t < n.t + n.dur + gap; j++) {
      const m = out[j];
      if (m.t <= n.t + 1e-6) continue;
      const dur = Math.min(n.dur, m.t - n.t - gap);
      if (dur < n.dur) delete n.release;
      n.dur = dur;
    }
    if (n.dur < spb * 0.4) {
      n.dur = 0;
      delete n.release;
    }
  }
  return out;
}
