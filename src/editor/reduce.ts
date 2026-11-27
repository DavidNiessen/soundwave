/**
 * Writes an easier chart from a harder one, the way the game's own difficulties step down from
 * Expert: the same skeleton with fewer notes. Notes off the easier difficulty's rhythm go, notes too
 * close together or too many in a bar thin out from the weakest beat upwards, chords shrink, short
 * holds become taps and a fifth lane folds into four. It works on notes in beats and knows nothing
 * about pitch, so it suits charts written by hand.
 */
import { barCap, PROFILES, sustainMinBeats } from '../chart/profiles';
import type { Difficulty } from '../chart/types';

export interface BeatNote {
  pos: number;
  lane: number;
  len: number;
  phrase: number;
  release?: boolean;
}

export interface Bars {
  /** Whether a beat (a whole position) starts a bar. */
  isBar(beat: number): boolean;
  /** The bar line at or before a position. */
  barStart(pos: number): number;
  secondsPerBeat: number;
}

const on = (pos: number, step: number) => Math.abs(pos / step - Math.round(pos / step)) < 2e-3;

/** How strong a place in the bar is: the bar line, a beat, half a beat, anything else. */
function weight(pos: number, bars: Bars): number {
  if (on(pos, 1)) return bars.isBar(Math.round(pos)) ? 4 : 3;
  return on(pos, 0.5) ? 2 : 1;
}

/** Beats from a bar line to the next (four when none follows within sixteen). */
function barLength(bar: number, bars: Bars): number {
  for (let k = 1; k <= 16; k++) if (bars.isBar(Math.round(bar) + k)) return k;
  return 4;
}

export function reduceNotes(notes: readonly BeatNote[], fromLanes: number, to: Difficulty, bars: Bars): BeatNote[] {
  const p = PROFILES[to];
  const sorted = [...notes].sort((a, b) => a.pos - b.pos || a.lane - b.lane);
  // Notes struck together are one moment of the chart.
  let moments: { pos: number; w: number; notes: BeatNote[] }[] = [];
  for (const n of sorted) {
    const last = moments[moments.length - 1];
    if (last && Math.abs(last.pos - n.pos) < 2e-3) last.notes.push(n);
    else moments.push({ pos: n.pos, w: weight(n.pos, bars), notes: [n] });
  }
  // Only the rhythm this difficulty plays.
  moments = moments.filter((m) => on(m.pos, 1 / p.grid) || (p.triplets && on(m.pos, 1 / 3)));
  // Never closer together than its hands can go: of two that are, the weaker beat gives way.
  const gap = p.minGap / bars.secondsPerBeat;
  const spaced: typeof moments = [];
  for (const m of moments) {
    const prev = spaced[spaced.length - 1];
    if (prev && m.pos - prev.pos < gap - 1e-3) {
      if (m.w > prev.w) spaced[spaced.length - 1] = m;
      continue;
    }
    spaced.push(m);
  }
  // And no more in a bar than it asks for, the weakest places first.
  const byBar = new Map<number, typeof moments>();
  for (const m of spaced) {
    const bar = bars.barStart(m.pos);
    byBar.set(bar, [...(byBar.get(bar) ?? []), m]);
  }
  const kept = new Set<(typeof moments)[number]>();
  for (const [bar, list] of byBar) {
    const ranked = [...list].sort((a, b) => b.w - a.w || a.pos - b.pos).slice(0, barCap(p, barLength(bar, bars)));
    for (const m of ranked) kept.add(m);
  }
  const fold = (lane: number) =>
    fromLanes <= p.lanes ? Math.min(p.lanes - 1, lane) : Math.round((lane * (p.lanes - 1)) / (fromLanes - 1));
  const out: BeatNote[] = [];
  for (const m of spaced) {
    if (!kept.has(m)) continue;
    // A chord keeps its outer notes, as far apart as this difficulty reaches, each in a lane of its own.
    let chord = m.notes.map((n) => ({ ...n, lane: fold(n.lane) })).filter((n, i, all) => all.findIndex((x) => x.lane === n.lane) === i);
    const chordsHere = p.maxChord > 1 && on(m.pos, p.chordGrid);
    if (chord.length > 1 && !chordsHere) chord = [chord[0]];
    if (chord.length > p.maxChord) chord = p.maxChord === 1 ? [chord[0]] : [chord[0], ...chord.slice(-(p.maxChord - 1))];
    chord = chord.filter((n) => n.lane - chord[0].lane <= p.maxChordSpread);
    for (const n of chord) {
      const long = n.len >= sustainMinBeats(p, bars.secondsPerBeat) - 1e-3;
      out.push({
        pos: n.pos,
        lane: n.lane,
        len: long ? n.len : 0,
        phrase: n.phrase,
        ...(n.release && long && to !== 'easy' ? { release: true } : {}),
      });
    }
  }
  // A phrase needs at least two notes to be worth lighting up.
  const counts = new Map<number, number>();
  for (const n of out) if (n.phrase >= 0) counts.set(n.phrase, (counts.get(n.phrase) ?? 0) + 1);
  return out.map((n) => (n.phrase >= 0 && (counts.get(n.phrase) ?? 0) < 2 ? { ...n, phrase: -1 } : n));
}
