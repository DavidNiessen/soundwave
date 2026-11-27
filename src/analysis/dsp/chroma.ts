import type { HarmonicEvent } from '../types';
import { binHz, type Spectrogram } from './stft';

/** The highest frequency the chroma reads. */
export const CHROMA_TOP_HZ = 4200;

/** Per-frame 12-bin chroma (pitch class energy) from a magnitude spectrogram. */
export function chromagram(spec: Float32Array, s: Spectrogram, loHz = 55, hiHz = CHROMA_TOP_HZ): Float32Array {
  const hz = binHz(s);
  const lo = Math.max(1, Math.ceil(loHz / hz));
  const hi = Math.min(s.bins - 1, Math.floor(hiHz / hz));
  const pc = new Int8Array(s.bins).fill(-1);
  for (let k = lo; k <= hi; k++) {
    const midi = 69 + 12 * Math.log2((k * hz) / 440);
    pc[k] = ((Math.round(midi) % 12) + 12) % 12;
  }
  const out = new Float32Array(s.frames * 12);
  for (let f = 0; f < s.frames; f++) {
    const row = f * s.bins;
    const o = f * 12;
    for (let k = lo; k <= hi; k++) out[o + pc[k]] += Math.log1p(spec[row + k]);
  }
  return out;
}

/** Averages frame chroma within each beat interval; each vector is L2-normalized. */
export function beatChroma(chroma: Float32Array, frames: number, fps: number, beats: number[]): Float32Array[] {
  const out: Float32Array[] = [];
  for (let i = 0; i < beats.length; i++) {
    const a = Math.max(0, Math.floor(beats[i] * fps));
    const b = Math.min(frames, Math.max(a + 1, Math.floor((beats[i + 1] ?? beats[i] + (beats[i] - (beats[i - 1] ?? 0))) * fps)));
    const v = new Float32Array(12);
    for (let f = a; f < b; f++) for (let p = 0; p < 12; p++) v[p] += chroma[f * 12 + p];
    out.push(l2(v));
  }
  return out;
}

function l2(v: Float32Array) {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

const TEMPLATES: { root: number; minor: boolean; v: Float32Array }[] = [];
for (let r = 0; r < 12; r++) {
  for (const minor of [false, true]) {
    const v = new Float32Array(12);
    v[r] = 1;
    v[(r + (minor ? 3 : 4)) % 12] = 0.8;
    v[(r + 7) % 12] = 0.9;
    TEMPLATES.push({ root: r, minor, v: l2(v) });
  }
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < 12; i++) s += a[i] * b[i];
  return s;
};

/** Chord label per beat (triad template matching), mode-filtered over 3 beats. */
export function beatChords(bc: Float32Array[]): { root: number; minor: boolean; conf: number }[] {
  const raw = bc.map((v) => {
    let best = 0;
    let score = -1;
    TEMPLATES.forEach((t, i) => {
      const s = dot(v, t.v);
      if (s > score) {
        score = s;
        best = i;
      }
    });
    return { idx: best, conf: score };
  });
  return raw.map((r, i) => {
    const a = raw[i - 1]?.idx;
    const b = raw[i + 1]?.idx;
    const idx = a !== undefined && a === b && a !== r.idx ? a : r.idx;
    return { root: TEMPLATES[idx].root, minor: TEMPLATES[idx].minor, conf: r.conf };
  });
}

/** Harmonic events: beats where the chord or the chroma vector changes noticeably. */
export function harmonicEvents(beats: number[], bc: Float32Array[]): HarmonicEvent[] {
  const chords = beatChords(bc);
  const events: HarmonicEvent[] = [];
  for (let i = 0; i < beats.length; i++) {
    const c = chords[i];
    const prev = chords[i - 1];
    const dist = i > 0 ? 1 - dot(bc[i], bc[i - 1]) : 1;
    const changed = !prev || prev.root !== c.root || prev.minor !== c.minor;
    if (changed || dist > 0.25) {
      events.push({ t: beats[i], root: c.root, minor: c.minor, strength: Math.min(1, (changed ? 0.5 : 0) + dist) });
    }
  }
  return events;
}

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

/** Krumhansl-Schmuckler key estimate from total chroma. */
export function estimateKey(bc: Float32Array[]): { tonic: number; minor: boolean } {
  const total = new Float32Array(12);
  for (const v of bc) for (let i = 0; i < 12; i++) total[i] += v[i];
  const corr = (profile: number[], shift: number) => {
    const mx = total.reduce((a, b) => a + b, 0) / 12;
    const my = profile.reduce((a, b) => a + b, 0) / 12;
    let num = 0;
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 12; i++) {
      const x = total[(i + shift) % 12] - mx;
      const y = profile[i] - my;
      num += x * y;
      dx += x * x;
      dy += y * y;
    }
    return num / (Math.sqrt(dx * dy) || 1);
  };
  let best = { tonic: 0, minor: false };
  let score = -Infinity;
  for (let s = 0; s < 12; s++) {
    for (const minor of [false, true]) {
      const c = corr(minor ? MINOR : MAJOR, s);
      if (c > score) {
        score = c;
        best = { tonic: s, minor };
      }
    }
  }
  return best;
}
