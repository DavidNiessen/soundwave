import { FPS, logMel, MELS } from './spectrogram';

/** Frames the model takes at once: thirty seconds. */
export const WINDOW = 1500;
/**
 * Frames at either end of a window whose answers are not used: the model was not trained on the
 * edges of its input. Neighbouring windows overlap by twice this.
 */
const BORDER = 6;
/** A frame nobody answered for: no beat. */
const SILENT = -1000;

/**
 * The network itself (Beat This), for one window: `spect` is WINDOW frames of the log-mel
 * spectrogram, row-major (WINDOW x MELS). It returns, per frame, the logit of a beat and of the
 * start of a bar. The input must not be changed until the returned promise settles.
 */
export interface BeatModel {
  run(spect: Float32Array): Promise<{ beat: Float32Array; downbeat: Float32Array }>;
}

export interface Beats {
  /** Seconds from the start of the signal. */
  beats: number[];
  /** The beats that start a bar: each one is also in `beats`. */
  downbeats: number[];
}

/**
 * Frames that are the highest within 70 ms either side and more likely a beat than not, as frame
 * numbers. Neighbouring frames that tie count once, in their middle.
 */
function peaks(logits: Float32Array): number[] {
  const out: number[] = [];
  let run = 0;
  for (let t = 0; t < logits.length; t++) {
    const v = logits[t];
    if (v <= 0) continue;
    let highest = true;
    for (let j = Math.max(0, t - 3); j <= Math.min(logits.length - 1, t + 3); j++) {
      if (logits[j] > v) {
        highest = false;
        break;
      }
    }
    if (!highest) continue;
    const last = out.length - 1;
    if (last >= 0 && t - out[last] <= 1) {
      run++;
      out[last] += (t - out[last]) / run;
    } else {
      out.push(t);
      run = 1;
    }
  }
  return out;
}

/**
 * The beats and bar starts of a mono signal at 22.05 kHz, the way Beat This finds them without its
 * optional DBN: the spectrogram goes through the model in thirty-second windows that overlap a
 * little, where two windows answer for the same frame the earlier one counts, and a beat is a peak
 * of the answer. A bar start is moved onto the beat nearest to it.
 *
 * The model always takes a full window, so a signal shorter than thirty seconds is followed by
 * silence (Beat This itself would hand the model a shorter window).
 */
export async function beatsAndBars(signal: Float32Array, model: BeatModel, onProgress: (p: number) => void = () => {}): Promise<Beats> {
  const spect = logMel(signal);
  const frames = spect.frames;
  const beat = new Float32Array(frames).fill(SILENT);
  const downbeat = new Float32Array(frames).fill(SILENT);

  // Where each window starts: the first one BORDER frames before the signal, the last one moved
  // back so that it ends with the signal.
  const starts: number[] = [];
  for (let start = -BORDER; start < frames - BORDER; start += WINDOW - 2 * BORDER) starts.push(start);
  if (frames > WINDOW - 2 * BORDER) starts[starts.length - 1] = frames - (WINDOW - BORDER);

  const input = new Float32Array(WINDOW * MELS);
  // Later windows first, so the earlier ones write over them where they overlap.
  for (let i = starts.length - 1; i >= 0; i--) {
    const start = starts[i];
    input.fill(0);
    const from = Math.max(start, 0);
    const to = Math.min(start + WINDOW, frames);
    input.set(spect.data.subarray(from * MELS, to * MELS), (from - start) * MELS);
    const answer = await model.run(input);
    for (let t = Math.max(BORDER, -start); t < WINDOW - BORDER && start + t < frames; t++) {
      beat[start + t] = answer.beat[t];
      downbeat[start + t] = answer.downbeat[t];
    }
    onProgress((starts.length - i) / starts.length);
  }

  const beats = peaks(beat).map((f) => f / FPS);
  const bars = new Set<number>();
  if (beats.length) {
    for (const f of peaks(downbeat)) {
      const t = f / FPS;
      bars.add(beats.reduce((nearest, b) => (Math.abs(b - t) < Math.abs(nearest - t) ? b : nearest)));
    }
  }
  return { beats, downbeats: [...bars].sort((a, b) => a - b) };
}
