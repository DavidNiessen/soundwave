import { smooth } from './onsets';

export interface BeatResult {
  tempo: number;
  /** Beat times in seconds. */
  beats: number[];
}

/** Global tempo from the autocorrelation of the onset envelope, with a log-normal prior around 120 BPM. */
export function estimateTempo(env: Float32Array, fps: number, minBpm = 60, maxBpm = 200): number {
  const n = env.length;
  const local = smooth(env, Math.round(fps));
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.max(0, env[i] - local[i]);
  const minLag = Math.floor((60 * fps) / maxBpm);
  const maxLag = Math.ceil((60 * fps) / minBpm);
  const MULTIPLES = 4;
  const acLen = maxLag * MULTIPLES + 2;
  const ac = new Float64Array(acLen + 1);
  for (let lag = Math.max(1, minLag - 1); lag <= acLen; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    ac[lag] = s / Math.max(1, n - lag);
  }
  // Onset peaks are only a frame or two wide; widen them so fractional periods still line up.
  const acS = new Float64Array(ac.length);
  for (let i = 1; i < ac.length - 1; i++) acS[i] = Math.max(ac[i], 0.75 * Math.max(ac[i - 1], ac[i + 1]));
  const at = (l: number) => {
    const i = Math.floor(l);
    const f = l - i;
    return i + 1 < acS.length ? acS[i] * (1 - f) + acS[i + 1] * f : 0;
  };
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag += 0.05) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    // Comb over multiples of the period: the true beat is periodic at 1, 2, 3 and 4 beats.
    let comb = 0;
    for (let k = 1; k <= MULTIPLES; k++) comb += at(lag * k) / k;
    const score = comb * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Backbeat patterns repeat every two beats; if the half period is nearly as periodic, take it.
  while ((60 * fps) / (best / 2) <= 170 && best / 2 >= minLag && at(best / 2) > 0.55 * at(best)) best /= 2;
  return (60 * fps) / best;
}

/**
 * Dynamic-programming beat tracker (Ellis 2007): beats land on strong onsets while keeping
 * inter-beat intervals close to the global period.
 */
export function trackBeats(env: Float32Array, fps: number, tempo: number, tightness = 100): number[] {
  const n = env.length;
  const period = (60 * fps) / tempo;
  // Local score: onset envelope smoothed by a Gaussian matched to the period.
  const width = Math.max(1, Math.round(period / 16));
  const local = new Float32Array(n);
  let norm = 0;
  for (let j = -width * 2; j <= width * 2; j++) norm += Math.exp(-0.5 * (j / width) ** 2);
  const std = Math.sqrt(env.reduce((s, v) => s + v * v, 0) / Math.max(1, n)) || 1;
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -width * 2; j <= width * 2; j++) {
      const k = i + j;
      if (k >= 0 && k < n) s += env[k] * Math.exp(-0.5 * (j / width) ** 2);
    }
    local[i] = s / norm / std;
  }
  const cum = new Float32Array(n);
  const back = new Int32Array(n).fill(-1);
  const lo = Math.round(period / 2);
  const hi = Math.round(period * 2);
  for (let i = 0; i < n; i++) {
    let best = 0;
    let arg = -1;
    for (let t = i - hi; t <= i - lo; t++) {
      if (t < 0) continue;
      const r = Math.log((i - t) / period);
      const s = cum[t] - tightness * r * r;
      if (arg < 0 || s > best) {
        best = s;
        arg = t;
      }
    }
    cum[i] = local[i] + (arg >= 0 ? best : 0);
    back[i] = arg;
  }
  // Start the backtrace from the best-scoring frame near the end.
  let end = n - 1;
  let bestEnd = -Infinity;
  for (let i = Math.max(0, n - Math.round(period * 2)); i < n; i++) {
    if (cum[i] > bestEnd) {
      bestEnd = cum[i];
      end = i;
    }
  }
  const frames: number[] = [];
  for (let i = end; i >= 0; i = back[i]) frames.push(i);
  frames.reverse();
  return frames;
}

/** Refines integer beat frames to sub-frame peaks, then smooths timing with a local linear fit. */
export function refineBeats(frames: number[], env: Float32Array, fps: number, radius = 4): number[] {
  const t = frames.map((f) => {
    let best = f;
    for (let j = f - 1; j <= f + 1; j++) if (j > 0 && j < env.length - 1 && env[j] > env[best]) best = j;
    const a = env[best - 1] ?? 0;
    const b = env[best];
    const c = env[best + 1] ?? 0;
    const d = a - 2 * b + c;
    const shift = d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0;
    // Prefer the DP frame unless the nearby onset peak is clearly better.
    return (env[best] > env[f] * 1.2 ? best + shift : f) / fps;
  });
  return smoothBeats(t, radius);
}

/** Local linear fit over ±radius beats: removes frame jitter while following tempo changes. */
export function smoothBeats(t: number[], radius = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i < t.length; i++) {
    const a = Math.max(0, i - radius);
    const b = Math.min(t.length - 1, i + radius);
    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    const m = b - a + 1;
    for (let j = a; j <= b; j++) {
      sx += j;
      sy += t[j];
      sxx += j * j;
      sxy += j * t[j];
    }
    const den = m * sxx - sx * sx;
    const slope = den ? (m * sxy - sx * sy) / den : 0;
    const icpt = (sy - slope * sx) / m;
    const fit = slope * i + icpt;
    // Blend: steady songs snap to the fit, rubato keeps its detected timing.
    out.push(Math.abs(fit - t[i]) < 0.04 ? fit : t[i]);
  }
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 1e-3;
  return out;
}

/** Chooses which beat phase (0..3) starts each bar by accent strength. Returns downbeat indices. */
export function findDownbeats(beatAccent: number[], beatsPerBar = 4): number[] {
  let bestPhase = 0;
  let bestScore = -Infinity;
  for (let p = 0; p < beatsPerBar; p++) {
    let s = 0;
    let c = 0;
    for (let i = p; i < beatAccent.length; i += beatsPerBar) {
      s += beatAccent[i];
      c++;
    }
    const score = c ? s / c : 0;
    if (score > bestScore) {
      bestScore = score;
      bestPhase = p;
    }
  }
  const out: number[] = [];
  for (let i = bestPhase; i < beatAccent.length; i += beatsPerBar) out.push(i);
  return out;
}

/**
 * Bar starts given as times, as indices into the beat grid: each on the beat nearest to it, and the
 * bars carried on at their usual length before the first and after the last one, so the whole grid
 * has bars (the grid is longer than what the bar starts were found in).
 */
export function barsOnGrid(beats: number[], barTimes: number[]): number[] {
  if (!beats.length || !barTimes.length) return [];
  const at = new Set<number>();
  let i = 0;
  for (const t of [...barTimes].sort((a, b) => a - b)) {
    while (i < beats.length - 1 && Math.abs(beats[i + 1] - t) <= Math.abs(beats[i] - t)) i++;
    at.add(i);
  }
  const bars = [...at].sort((a, b) => a - b);
  // The usual number of beats in a bar: the most frequent distance between bar starts.
  const counts = new Map<number, number>();
  for (let j = 1; j < bars.length; j++) counts.set(bars[j] - bars[j - 1], (counts.get(bars[j] - bars[j - 1]) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 4;
  for (let b = bars[0] - usual; b >= 0; b -= usual) bars.unshift(b);
  for (let b = bars[bars.length - 1] + usual; b < beats.length; b += usual) bars.push(b);
  return bars;
}

const medianInterval = (b: number[]) => {
  const d = b
    .slice(1)
    .map((x, i) => x - b[i])
    .sort((x, y) => x - y);
  return d[Math.floor(d.length / 2)];
};

/** Extends the beat grid at constant tempo to cover [0, duration]. */
export function extendGrid(beats: number[], duration: number): number[] {
  if (beats.length < 2) return beats;
  const head = medianInterval(beats.slice(0, 9));
  const tail = medianInterval(beats.slice(-9));
  const pre: number[] = [];
  for (let t = beats[0] - head; t >= 0; t -= head) pre.unshift(t);
  const post: number[] = [];
  for (let t = beats[beats.length - 1] + tail; t <= duration; t += tail) post.push(t);
  return [...pre, ...beats, ...post];
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

/**
 * The beat model now and then loses the pulse for a while (an intro without drums, a break, a fill):
 * its beats bunch up, go missing or flip between half and double time, and everything counted on
 * them (the chart's notes, the highway's beat lines, the break countdown) speeds up and slows down
 * with them. Runs of at least `minRun` steady beats (each gap within `tolerance`, or 25 ms, of the
 * gaps around it and of the run's own) are kept as they are; between two runs, and before the first and after
 * the last, the beats are laid out evenly at the tempo of the runs beside them. A run at half or
 * double the tempo of a longer one beside it is brought to that one's level. A song without any
 * steady run is left as it is.
 */
export function steadyBeats(beats: number[], minRun = 8, tolerance = 0.05): number[] {
  if (beats.length < minRun + 1) return beats;
  const gaps = beats.slice(1).map((t, i) => t - beats[i]);
  // The model answers in steps of 20 ms: at a fast tempo that alone is more than `tolerance`.
  const near = (g: number, ref: number) => Math.abs(g - ref) <= Math.max(tolerance * ref, 0.025);
  // A gap is steady when it matches the gaps just before it or just after it (at a change of
  // tempo, each side matches its own).
  const steady = gaps.map((g, i) => {
    const before = i > 0 ? median(gaps.slice(Math.max(0, i - 8), i)) : 0;
    const after = i + 1 < gaps.length ? median(gaps.slice(i + 1, i + 9)) : 0;
    return (before > 0 && near(g, before)) || (after > 0 && near(g, after));
  });
  // Runs of steady gaps, split where their tempo moves: each as its first and last beat.
  const runs: { from: number; to: number; period: number }[] = [];
  const close = (from: number, to: number) => {
    if (to - from >= minRun) runs.push({ from, to, period: median(gaps.slice(from, to)) });
  };
  for (let i = 0; i < gaps.length;) {
    if (!steady[i]) {
      i++;
      continue;
    }
    let start = i;
    let k = i + 1;
    for (; k < gaps.length && steady[k]; k++) {
      if (k - start >= 2 && !near(gaps[k], median(gaps.slice(start, k)))) {
        close(start, k);
        start = k;
      }
    }
    close(start, k);
    i = k;
  }
  if (!runs.length) return beats;
  // Each run as its own beats, so a run can be brought to another level of the pulse.
  const parts = runs.map((r) => ({ beats: beats.slice(r.from, r.to + 1), period: r.period }));
  // A run at half or double the tempo of a longer run beside it is the model counting every half
  // beat, or every other one, for a while: it is brought to its neighbour's level.
  const length = (p: (typeof parts)[number]) => p.beats[p.beats.length - 1] - p.beats[0];
  parts.forEach((part, i) => {
    const ref = [parts[i - 1], parts[i + 1]].filter((n) => n && length(n) > length(part)).sort((x, y) => length(y) - length(x))[0];
    if (!ref) return;
    const ratio = part.period / ref.period;
    if (ratio > 0.45 && ratio < 0.55) {
      // Every other beat: the half that keeps to the neighbour's beats where the two meet.
      const anchor = ref === parts[i - 1] ? ref.beats[ref.beats.length - 1] : ref.beats[0];
      const offBy = (t: number) => Math.abs((((((t - anchor) / ref.period) % 1) + 1.5) % 1) - 0.5);
      const even = part.beats.filter((_, k) => k % 2 === 0);
      const odd = part.beats.filter((_, k) => k % 2 === 1);
      part.beats = offBy(odd[0]) < offBy(even[0]) ? odd : even;
      part.period *= 2;
    } else if (ratio > 1.8 && ratio < 2.2) {
      part.beats = part.beats.flatMap((t, k) => (k + 1 < part.beats.length ? [t, (t + part.beats[k + 1]) / 2] : [t]));
      part.period /= 2;
    }
  });
  const out: number[] = [];
  const first = parts[0];
  // Before the first run, back to where the model's beats began.
  for (let k = Math.round((first.beats[0] - beats[0]) / first.period); k >= 1; k--) out.push(first.beats[0] - k * first.period);
  parts.forEach((part, r) => {
    // Neighbouring runs share the beat where they meet.
    for (const t of part.beats) if (!out.length || t > out[out.length - 1] + 1e-6) out.push(t);
    const next = parts[r + 1];
    if (!next) return;
    // Between two runs: as many beats as fit at their tempo, evenly spaced.
    const a = part.beats[part.beats.length - 1];
    const b = next.beats[0];
    const n = Math.max(1, Math.round((b - a) / ((part.period + next.period) / 2)));
    for (let k = 1; k < n; k++) out.push(a + ((b - a) * k) / n);
  });
  const last = parts[parts.length - 1];
  const tail = last.beats[last.beats.length - 1];
  // After the last run, on to where the model's beats ended.
  const end = Math.round((beats[beats.length - 1] - tail) / last.period);
  for (let k = 1; k <= end; k++) out.push(tail + k * last.period);
  return out;
}

/**
 * Bar starts (indices into the beat grid) kept to the song's usual bar length: the beat model now
 * and then marks a bar start in the middle of a bar, or every other beat for a stretch, and the
 * break countdown counted those bars twice as fast. A bar start that comes early counts only when
 * the next two follow it at the usual length (the song really moved its bars, as with a short bar);
 * a missing one is filled in.
 */
export function steadyBars(bars: number[]): number[] {
  if (bars.length < 3) return bars;
  const counts = new Map<number, number>();
  for (let j = 1; j < bars.length; j++) counts.set(bars[j] - bars[j - 1], (counts.get(bars[j] - bars[j - 1]) ?? 0) + 1);
  const usual = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  const confirmed = (i: number) => bars[i + 1] === bars[i] + usual && bars[i + 2] === bars[i] + 2 * usual;
  const out = [bars[0]];
  for (let i = 1; i < bars.length;) {
    const due = out[out.length - 1] + usual;
    const c = bars[i];
    if (c === due) {
      out.push(c);
      i++;
    } else if (c < due) {
      if (confirmed(i)) out.push(c);
      i++;
    } else if (c < due + usual && confirmed(i)) {
      // The bars moved on by less than a bar: a longer bar, then the new ones.
      out.push(c);
      i++;
    } else {
      out.push(due);
    }
  }
  return out;
}
