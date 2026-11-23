import type * as Ort from 'onnxruntime-web';
import { nudgeCollector } from '../runtime';
import type { PitchedNote } from '../types';
import { addPitchBends, bendActivity, CONTOUR_BINS, decodeNotes, notesToTime, PITCHES } from './noteEvents';

/**
 * Basic Pitch (Spotify, Apache-2.0) on ONNX Runtime: the same network as the TF.js transcriber in
 * basicPitch.ts, from the ONNX file Spotify ships with its Python package
 * (public/models/basic-pitch/nmp.onnx). The audio is cut into windows exactly as the TF.js package
 * does it, and the notes are decoded as its own post-processing does (noteEvents.ts, much faster),
 * so both give the same notes. It runs on whatever the stem model already runs on (WebGPU or
 * WebAssembly), several windows per call.
 */

// From basic_pitch/constants.py, as in @spotify/basic-pitch's inference.ts.
const SAMPLE_RATE = 22050;
const FFT_HOP = 256;
const FPS = Math.floor(SAMPLE_RATE / FFT_HOP);
const WINDOW = SAMPLE_RATE * 2 - FFT_HOP; // 43844 samples
const OVERLAP_FRAMES = 30;
const HALF_OVERLAP = OVERLAP_FRAMES / 2;
const OVERLAP = OVERLAP_FRAMES * FFT_HOP;
const HOP = WINDOW - OVERLAP;
const FRAMES_PER_WINDOW = 172;
const KEPT_PER_WINDOW = FRAMES_PER_WINDOW - OVERLAP_FRAMES;

/** Windows per call: more keeps a graphics card busier, at 175 KB of input and 1 MB of output each. */
const BATCH = 16;

const INPUT = 'serving_default_input_2:0';
const NOTES = 'StatefulPartitionedCall:1';
const ONSETS = 'StatefulPartitionedCall:2';
const CONTOURS = 'StatefulPartitionedCall:0';

/** The thresholds the game has always used (see basicPitch.ts). */
const DECODE = { onsetThresh: 0.45, frameThresh: 0.3, minNoteLen: 8, energyTolerance: 11 };

/** Where each window starts in the padded signal (half an overlap of silence in front), as tf.signal.frame with padEnd. */
function windowStarts(paddedLength: number): number[] {
  const starts: number[] = [];
  let start = 0;
  while (start + WINDOW <= paddedLength) {
    starts.push(start);
    start += HOP;
  }
  while (start < paddedLength) {
    starts.push(start);
    start += HOP;
  }
  return starts;
}

export interface Transcription {
  notes: PitchedNote[];
  /** Milliseconds in the network and in turning its output into notes. */
  modelMs: number;
  notesMs: number;
}

/**
 * Notes in mono audio at 22050 Hz, with the same thresholds as the TF.js transcriber.
 * `ort` is the runtime module the session was made with (for its Tensor class).
 */
export async function transcribeOnnx(
  ort: typeof Ort,
  session: Ort.InferenceSession,
  audio: Float32Array,
  onProgress: (p: number) => void = () => {},
): Promise<Transcription> {
  const lead = OVERLAP / 2;
  const starts = windowStarts(audio.length + lead);
  const total = Math.floor(audio.length * (FPS / SAMPLE_RATE));
  const frames = new Float32Array(total * PITCHES);
  const onsets = new Float32Array(total * PITCHES);
  const contours = new Float32Array(total * CONTOUR_BINS);
  let filled = 0;
  const started = performance.now();

  for (let b = 0; b < starts.length && filled < total; b += BATCH) {
    const batch = starts.slice(b, b + BATCH);
    const input = new Float32Array(batch.length * WINDOW);
    batch.forEach((start, w) => {
      // Samples before the audio (the leading half overlap) and after its end stay zero.
      const from = Math.max(0, start - lead);
      const to = Math.min(audio.length, start - lead + WINDOW);
      if (to > from) input.set(audio.subarray(from, to), w * WINDOW + (from - (start - lead)));
    });
    const out = await session.run({ [INPUT]: new ort.Tensor('float32', input, [batch.length, WINDOW, 1]) });
    const n = (await out[NOTES].getData()) as Float32Array;
    const o = (await out[ONSETS].getData()) as Float32Array;
    const c = (await out[CONTOURS].getData()) as Float32Array;
    for (const name of [NOTES, ONSETS, CONTOURS]) out[name].dispose();
    nudgeCollector();
    // Each window keeps its middle: half the overlap is dropped at both ends.
    for (let w = 0; w < batch.length && filled < total; w++) {
      const keep = Math.min(KEPT_PER_WINDOW, total - filled);
      const first = w * FRAMES_PER_WINDOW + HALF_OVERLAP;
      frames.set(n.subarray(first * PITCHES, (first + keep) * PITCHES), filled * PITCHES);
      onsets.set(o.subarray(first * PITCHES, (first + keep) * PITCHES), filled * PITCHES);
      contours.set(c.subarray(first * CONTOUR_BINS, (first + keep) * CONTOUR_BINS), filled * CONTOUR_BINS);
      filled += keep;
    }
    onProgress((filled / Math.max(1, total)) * 0.9);
  }
  const modelMs = performance.now() - started;

  const notesStarted = performance.now();
  const events = notesToTime(addPitchBends(contours, decodeNotes(frames, onsets, filled, DECODE)));
  const maxAmp = events.reduce((m, e) => Math.max(m, e.amplitude), 0) || 1;
  const notes = events
    .map((e) => ({
      t: e.startTimeSeconds,
      dur: e.durationSeconds,
      midi: e.pitchMidi,
      strength: Math.min(1, e.amplitude / maxAmp),
      bend: bendActivity(e.pitchBends),
      fine: e.pitchBends?.length ? e.pitchMidi + e.pitchBends.reduce((a, b) => a + b, 0) / e.pitchBends.length / 3 : e.pitchMidi,
    }))
    .sort((a, b) => a.t - b.t);
  onProgress(1);
  return { notes, modelMs, notesMs: performance.now() - notesStarted };
}
