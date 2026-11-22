import type { Beats } from './beat/track';
import { barsOnGrid, extendGrid, findDownbeats, refineBeats, estimateTempo, smoothBeats, trackBeats } from './dsp/beats';
import { beatChroma, chromagram, estimateKey, harmonicEvents } from './dsp/chroma';
import { findSections, resampleCurve, rmsCurve } from './dsp/energy';
import { hpss } from './dsp/hpss';
import { highpass, lowpass, refineOnset } from './dsp/refine';
import { bandFlux, normalize, onsetEnvelope, pickPeaks } from './dsp/onsets';
import { hzToBin, stft, type Spectrogram } from './dsp/stft';
import { BASS_SPLIT, separateParts } from './pitch/lines';
import { bassLineFromStem, leadLineFromStem, loudness, vocalLineFromStem } from './pitch/stemLines';
import { salienceLine } from './pitch/salience';
import {
  ANALYSIS_SAMPLE_RATE,
  ANALYSIS_VERSION,
  type AnalysisProgress,
  type AnalysisResult,
  type AnalysisStep,
  type DrumHit,
  type DrumKind,
  type PartLines,
  type PitchedNote,
  type StemName,
  type StemNotes,
} from './types';

export type Transcriber = (audio: Float32Array, onProgress: (p: number) => void) => Promise<PitchedNote[]>;
export type BeatTracker = (audio: Float32Array, onProgress: (p: number) => void) => Promise<Beats>;

export interface PipelineOptions {
  /** Optional neural transcriber; falls back to harmonic-salience tracking when missing or failing. */
  transcriber?: Transcriber;
  onProgress?: (p: AnalysisProgress) => void;
  onLog?: (msg: string) => void;
  /** Lines from separated stems; when given, transcription is skipped. */
  lines?: PartLines;
  /** Isolated drum stem (same rate and length as the mix) for cleaner drum detection. */
  drumSignal?: Float32Array;
  /** Separated stems at the analysis rate; with `stemNotes`, lines are timed by their attacks. */
  stems?: Partial<Record<StemName, Float32Array>>;
  stemNotes?: StemNotes;
  /**
   * Optional beat model (see beat/track.ts): its beats and bar starts are the grid's source. The
   * tracker here decides when it is missing, fails or finds too few beats.
   */
  beatTracker?: BeatTracker;
}

const NFFT = 2048;
const HOP = 512;
/**
 * A stem quieter than this share of the song's loudness (about -34 dB) is silent: a part the song
 * does not have. Real parts measure from about a tenth of the song up; the residue the separation
 * leaves in an absent part, a thousandth or so.
 */
const SILENT_STEM = 0.02;

const STEPS: Record<AnalysisStep, [number, number]> = {
  decoding: [0, 0.03],
  spectrum: [0.03, 0.15],
  separating: [0.15, 0.32],
  rhythm: [0.32, 0.4],
  harmony: [0.4, 0.45],
  melody: [0.45, 0.96],
  finishing: [0.96, 1],
};

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/** Full analysis of a mono signal at ANALYSIS_SAMPLE_RATE. Pure apart from the optional transcriber. */
export async function analyzeSignal(signal: Float32Array, opts: PipelineOptions = {}): Promise<AnalysisResult> {
  const sr = ANALYSIS_SAMPLE_RATE;
  const duration = signal.length / sr;
  const report = (step: AnalysisStep, p = 0) => {
    const [a, b] = STEPS[step];
    opts.onProgress?.({ step, progress: a + (b - a) * Math.min(1, Math.max(0, p)) });
  };
  const yieldNow = () => new Promise((r) => setTimeout(r, 0));

  // 1. Spectrum
  report('spectrum');
  const spec = stft(signal, sr, NFFT, HOP, (p) => report('spectrum', p));
  const fps = sr / HOP;
  await yieldNow();

  // 2. Harmonic / percussive separation
  report('separating');
  const { harmonic, percussive } = hpss(spec, 17, 17, (p) => report('separating', p));
  await yieldNow();

  // 3. Rhythm: onset envelope, tempo, beats, drum hits
  report('rhythm');
  const rms = rmsCurve(signal, HOP);
  // Band-balanced onset envelope so kicks count as much as broadband noise.
  const env = onsetEnvelope(spec);
  // The beat model's beats when there are enough of them to be a grid; else the tracker here.
  let modelled: Beats | undefined;
  if (opts.beatTracker) {
    try {
      const found = await opts.beatTracker(signal, (p) => report('rhythm', p * 0.3));
      if (found.beats.length >= 8) modelled = found;
      else opts.onLog?.('the beat model found too few beats; using the beat tracker');
    } catch (err) {
      opts.onLog?.(`the beat model failed (${(err as Error).message || String(err)}); using the beat tracker`);
    }
  }
  let tempo: number;
  let beats: number[];
  if (modelled) {
    // The model answers in steps of 20 ms: the local fit takes the step out of a steady pulse.
    beats = smoothBeats(modelled.beats);
    const gaps = beats
      .slice(1)
      .map((t, i) => t - beats[i])
      .sort((a, b) => a - b);
    tempo = 60 / gaps[gaps.length >> 1];
  } else {
    tempo = estimateTempo(env, fps);
    report('rhythm', 0.3);
    const beatFrames = trackBeats(env, fps, tempo);
    beats = refineBeats(beatFrames, env, fps);
    // Drop beats the tracker invented in silence.
    beats = beats.filter((t) => (rms[Math.min(rms.length - 1, Math.round(t * fps))] ?? 0) > 0.06);
  }
  report('rhythm', 0.6);
  let drums: DrumHit[];
  if (opts.drumSignal) {
    // A separated drum stem is already "percussive": detect on its own spectrum.
    const drumSpec = stft(opts.drumSignal, sr, NFFT, HOP);
    drums = detectDrums(drumSpec.mag, drumSpec, fps, opts.drumSignal, drumSpec.mag, { stem: true });
  } else {
    drums = detectDrums(percussive, spec, fps, signal, spec.mag);
  }
  // Align the grid with the actual attacks, then extend it at constant tempo to cover the song.
  beats = extendGrid(calibrateBeats(beats, drums), duration);
  report('rhythm', 1);
  await yieldNow();

  // 4. Harmony: chroma, chord changes, key
  report('harmony');
  const chroma = chromagram(harmonic, spec);
  const bc = beatChroma(chroma, spec.frames, fps, beats);
  const harmony = harmonicEvents(beats, bc);
  const key = estimateKey(bc);
  const lowEnv = normalize(bandFlux(percussive, spec, 30, 150));
  const changeAt = new Map(harmony.map((h) => [h.t, h.strength]));
  const accent = beats.map((t) => {
    const f = Math.round(t * fps);
    const kick = Math.max(lowEnv[f - 1] ?? 0, lowEnv[f] ?? 0, lowEnv[f + 1] ?? 0);
    return kick + (changeAt.get(t) ?? 0) * 1.2;
  });
  // Where the model heard no bar at all, the accents decide as before.
  const modelBars = modelled ? barsOnGrid(beats, modelled.downbeats) : [];
  const downbeats = modelBars.length ? modelBars : findDownbeats(accent);
  report('harmony', 1);
  await yieldNow();

  // 5. Melody: bass, lead (instrument incl. chords) and vocal lines
  report('melody');
  let bass: PitchedNote[] = [];
  let lead: PitchedNote[] = [];
  let vocals: PitchedNote[] = [];
  let pitchSource: AnalysisResult['pitchSource'] = 'salience';
  if (opts.lines) {
    ({ bass, lead, vocals } = opts.lines);
    pitchSource = 'ml';
    // With the stems themselves, rebuild each line from its audible attacks.
    const st = opts.stems;
    const sn = opts.stemNotes;
    if (st && sn) {
      // A stem all but silent next to the song (an instrumental's vocals) is a part the song does
      // not have: no notes, whatever the transcriber made of its faint residue.
      const mixLoudness = loudness(signal);
      const silent = (stem: Float32Array) => loudness(stem) < mixLoudness * SILENT_STEM;
      opts.onLog?.(
        `stem levels (of the song's): ${(['vocals', 'other', 'bass'] as const)
          .map((k) => `${k} ${st[k] ? (loudness(st[k]) / (mixLoudness || 1)).toFixed(3) : '-'}`)
          .join(', ')}`,
      );
      if (st.vocals && silent(st.vocals)) vocals = [];
      else if (st.vocals && sn.vocals.length) vocals = vocalLineFromStem({ signal: st.vocals, sr, notes: sn.vocals, mixLoudness });
      report('melody', 0.4);
      // Lead follows the instrument only: where no instrument plays, the part rests (like a real chart).
      if (st.other && silent(st.other)) lead = [];
      else if (st.other && sn.other.length) lead = leadLineFromStem({ signal: st.other, sr, notes: sn.other, beats, mixLoudness });
      report('melody', 0.8);
      if (st.bass && silent(st.bass)) bass = [];
      else if (st.bass && sn.bass.length) bass = bassLineFromStem({ signal: st.bass, sr, notes: sn.bass, mixLoudness });
      opts.onLog?.(`stem lines: ${bass.length} bass, ${lead.length} lead, ${vocals.length} vocals`);
    }
  } else if (opts.transcriber) {
    try {
      const notes = await opts.transcriber(signal, (p) => report('melody', p * 0.9));
      ({ bass, lead, vocals } = separateParts(notes, duration));
      pitchSource = 'basic-pitch';
      opts.onLog?.(`transcribed ${notes.length} notes (${bass.length} bass, ${lead.length} lead, ${vocals.length} vocals)`);
    } catch (e) {
      opts.onLog?.(`transcriber unavailable: ${(e as Error).message}`);
    }
  }
  const harmOnsets = (lo: number, hi: number) =>
    new Set(pickPeaks(normalize(bandFlux(harmonic, spec, lo, hi)), { maxWin: 2, avgWin: 10, delta: 0.1, wait: 3 }));
  if (!opts.lines && bass.length < duration * 0.1) {
    bass = salienceLine(harmonic, spec, 28, BASS_SPLIT - 1, harmOnsets(30, 260), 0.45);
  }
  if (!opts.lines && lead.length < duration * 0.1 && vocals.length < duration * 0.2) {
    lead = salienceLine(harmonic, spec, BASS_SPLIT, 88, harmOnsets(250, 4000), 0.5);
    if (pitchSource === 'basic-pitch') pitchSource = 'salience';
    // Without a transcriber the best guess for the voice is the same melodic line.
    if (!vocals.length) vocals = lead;
  }
  report('melody', 1);

  // 6. Sections and energy
  report('finishing');
  const barTimes = downbeats.map((i) => beats[i]);
  const barEnergy: number[] = [];
  const barFeatures: Float32Array[] = [];
  for (let b = 0; b < barTimes.length; b++) {
    const a = barTimes[b];
    const e = barTimes[b + 1] ?? duration;
    const fa = Math.floor(a * fps);
    const fe = Math.max(fa + 1, Math.floor(e * fps));
    let en = 0;
    const v = new Float32Array(13);
    for (let f = fa; f < fe && f < rms.length; f++) {
      en += rms[f];
      for (let p = 0; p < 12; p++) v[p] += chroma[f * 12 + p] ?? 0;
    }
    en /= fe - fa;
    const hits = drums.filter((d) => d.t >= a && d.t < e).length;
    v[12] = (hits / Math.max(0.5, e - a)) * 2;
    barEnergy.push(en);
    barFeatures.push(v);
  }
  const sections = findSections(barTimes, barEnergy, barFeatures, duration);

  const result: AnalysisResult = {
    version: ANALYSIS_VERSION,
    source: opts.lines ? 'ml' : 'local',
    duration: round3(duration),
    tempo: Math.round(tempo * 100) / 100,
    beats: beats.map(round3),
    downbeats,
    drums,
    bass: bass.map(roundNote),
    lead: lead.map(roundNote),
    vocals: vocals.map(roundNote),
    harmony: harmony.map((h) => ({ ...h, t: round3(h.t), strength: round3(h.strength) })),
    sections,
    energy: resampleCurve(rms, fps, 0.1),
    energyHop: 0.1,
    key,
    pitchSource,
  };
  report('finishing', 1);
  return result;
}

const roundNote = (n: PitchedNote): PitchedNote => ({
  t: round3(n.t),
  dur: round3(n.dur),
  midi: n.midi,
  strength: round3(n.strength),
  ...(n.bend ? { bend: round3(n.bend) } : {}),
  ...(n.chord ? { chord: n.chord } : {}),
});

/**
 * A hit's strength is its band's flux at the hit over the band's 99th-percentile frame (clipped at
 * 1): the weakest that counts is `min`.
 */
const BANDS: { kind: DrumKind; lo: number; hi: number; wait: number; min: number }[] = [
  { kind: 'kick', lo: 30, hi: 150, wait: 0.1, min: 0.15 },
  { kind: 'snare', lo: 180, hi: 2500, wait: 0.08, min: 0.15 },
  { kind: 'hat', lo: 5000, hi: 10500, wait: 0.06, min: 0.15 },
];
const BAND = Object.fromEntries(BANDS.map((b) => [b.kind, b])) as Record<DrumKind, (typeof BANDS)[number]>;

/**
 * On a separated drum stem the low band also moves with toms, the body of the snare and what is
 * left of the bass. Against kicks marked by hand (MDB Drums, 23 recordings, on the stem) only 55%
 * of what it finds down to 0.15 is a kick; from 0.55 of the strongest kicks up 81% is, for 88% of
 * the kicks instead of 94% (measured with the floor taken of the whole song's strongest kicks).
 *
 * Here it is taken of the strongest kick nearby (KICK_NEAR seconds either side), so a quiet verse
 * keeps its kicks: only what is far weaker than the kicks around it goes. A kick with no other kick
 * that near (a lone low thump in a break) has nothing to be compared with there, so it is judged
 * against the song's median kick instead. On the full mix (no stem) the floor was not measured,
 * and kicks keep the plain `min`.
 */
const KICK_FLOOR = 0.55;
const KICK_NEAR = 3;

/**
 * The kicks that stand out from what is around them on a drum stem (see KICK_FLOOR). Their
 * strengths stay as measured, on the same scale as the snare's and the hi-hat's: the chart
 * generator weighs them against each other.
 */
export function standOutKicks(kicks: DrumHit[]): DrumHit[] {
  const sorted = kicks.map((k) => k.strength).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  return kicks.filter((k) => {
    let ref = k.strength;
    let alone = true;
    for (const o of kicks) {
      if (o === k || Math.abs(o.t - k.t) > KICK_NEAR) continue;
      alone = false;
      ref = Math.max(ref, o.strength);
    }
    if (alone) ref = Math.max(ref, median);
    return k.strength >= Math.max(BAND.kick.min, KICK_FLOOR * ref);
  });
}

/** Kick / snare / hat hits from band-limited flux of the percussive component. */
export function detectDrums(
  percussive: Float32Array,
  s: Spectrogram,
  fps: number,
  signal?: Float32Array,
  mag?: Float32Array,
  opts: { stem?: boolean } = {},
): DrumHit[] {
  const curves = BANDS.map((b) => normalize(bandFlux(percussive, s, b.lo, b.hi)));
  const peaks = curves.map((c, i) =>
    pickPeaks(c, { maxWin: 2, avgWin: Math.round(0.25 * fps), delta: 0.12, wait: Math.max(2, Math.round(BANDS[i].wait * fps)) }),
  );
  const [kickC, snareC, hatC] = curves;
  const near = (list: number[], f: number) => list.some((p) => Math.abs(p - f) <= 1);
  const hits: DrumHit[] = [];
  for (const f of peaks[0]) {
    // A bass note's attack also lands in the kick band, but it is followed by sustained low
    // harmonic energy; a kick is a short burst that is mostly percussive.
    if (mag && isBassAttack(mag, s, f)) continue;
    hits.push({ t: f / fps, kind: 'kick', strength: Math.min(1, kickC[f]) });
  }
  for (const f of peaks[1]) {
    // Kick drums leak into the snare band; drop snare hits that are mostly kick.
    if (near(peaks[0], f) && kickC[f] > snareC[f] * 1.3) continue;
    hits.push({ t: f / fps, kind: 'snare', strength: Math.min(1, snareC[f]) });
  }
  for (const f of peaks[2]) {
    // Snare noise reaches the hat band; keep hats only when the top end dominates.
    if (near(peaks[1], f) && hatC[f] < snareC[f] * 1.1) continue;
    hits.push({ t: f / fps, kind: 'hat', strength: Math.min(1, hatC[f]) });
  }
  let kept = hits.filter((h) => h.strength >= BAND[h.kind].min);
  if (opts.stem) kept = [...kept.filter((h) => h.kind !== 'kick'), ...standOutKicks(kept.filter((h) => h.kind === 'kick'))];
  if (signal) {
    // Move each hit to the attack in a band-filtered copy of the signal.
    const sr = s.sr;
    const filtered: Record<DrumKind, Float32Array> = {
      kick: lowpass(lowpass(signal, sr, 160), sr, 160),
      snare: highpass(lowpass(signal, sr, 4000), sr, 200),
      hat: highpass(highpass(signal, sr, 5000), sr, 5000),
    };
    kept = kept.map((h) => ({ ...h, t: refineOnset(filtered[h.kind], sr, h.t, 0.03, 0.09) }));
  }
  kept.sort((a, b) => a.t - b.t);
  // Refinement can pull two detections onto the same attack.
  const out: DrumHit[] = [];
  const last: Partial<Record<DrumKind, DrumHit>> = {};
  for (const h of kept) {
    const prev = last[h.kind];
    if (prev && h.t - prev.t < BAND[h.kind].wait * 0.9) {
      prev.strength = Math.max(prev.strength, h.strength);
      continue;
    }
    const copy = { ...h };
    out.push(copy);
    last[h.kind] = copy;
  }
  return out.map((h) => ({ ...h, t: round3(h.t), strength: round3(h.strength) }));
}

/** Shifts the beat grid by the median offset to nearby kick/snare attacks (removes analysis latency). */
export function calibrateBeats(beats: number[], drums: DrumHit[]): number[] {
  const hits = drums.filter((d) => d.kind !== 'hat').map((d) => d.t);
  if (hits.length < 8) return beats;
  const diffs: number[] = [];
  let j = 0;
  for (const b of beats) {
    while (j < hits.length - 1 && hits[j + 1] <= b) j++;
    let best = Infinity;
    for (const k of [j, j + 1]) if (k < hits.length && Math.abs(hits[k] - b) < Math.abs(best)) best = hits[k] - b;
    if (Math.abs(best) < 0.08) diffs.push(best);
  }
  if (diffs.length < Math.max(8, beats.length * 0.2)) return beats;
  diffs.sort((a, b) => a - b);
  const shift = diffs[Math.floor(diffs.length / 2)];
  // After the global shift, pull each beat onto an attack that is very close to it.
  let k = 0;
  const snapped = beats.map((b0) => {
    const b = b0 + shift;
    while (k < hits.length - 1 && hits[k + 1] <= b) k++;
    let best = 0;
    let dist = 0.03;
    for (const i of [k, k + 1]) {
      if (i < hits.length && Math.abs(hits[i] - b) < dist) {
        dist = Math.abs(hits[i] - b);
        best = hits[i] - b;
      }
    }
    return b + best;
  });
  return smoothBeats(snapped).filter((b) => b >= 0);
}

/**
 * True when a low-band onset at frame f looks like a bass note rather than a kick: a kick's low end
 * dies away within ~100 ms, while a bass note keeps sounding at a steady level.
 */
export function isBassAttack(mag: Float32Array, s: Spectrogram, f: number): boolean {
  const lo = hzToBin(s, 30);
  const hi = hzToBin(s, 150);
  const energy = (a: number, b: number) => {
    let sum = 0;
    let n = 0;
    for (let fr = Math.max(0, a); fr <= Math.min(s.frames - 1, b); fr++, n++) {
      for (let k = lo; k <= hi; k++) sum += mag[fr * s.bins + k] ** 2;
    }
    return sum / Math.max(1, n);
  };
  // STFT onsets fire a little early, so measure from the energy peak that follows.
  let peak = f;
  for (let fr = f + 1; fr <= f + 4; fr++) if (energy(fr, fr) > energy(peak, peak)) peak = fr;
  const attack = energy(peak, peak);
  const later = energy(peak + 4, peak + 6);
  return attack > 0 && later / attack > BASS_SUSTAIN_RATIO;
}

/** Fraction of its peak energy a low onset must keep ~90-140 ms later to count as a bass note. */
export const BASS_SUSTAIN_RATIO = 0.45;
