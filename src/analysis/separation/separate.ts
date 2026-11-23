import { addInversePair, BINS, FRAMES, SEGMENT, spectrogram } from './stft';

/** The stems in the order the model gives them. */
export const MODEL_STEMS = ['drums', 'bass', 'other', 'vocals'] as const;
export const MODEL_RATE = 44100;

/** Neighbouring segments share a quarter of their length. */
const STRIDE = Math.floor(0.75 * SEGMENT);
const PLANE = BINS * FRAMES;
const SOURCES = MODEL_STEMS.length;

/**
 * The network itself, for one segment: `x` is the normalised spectrogram (4 planes of BINS x FRAMES:
 * left re, left im, right re, right im) and `xt` the normalised segment (left, then right). It
 * returns, still normalised, 4 such planes per stem and 2 channels per stem. The input arrays must
 * not be changed until the returned promise settles.
 */
export interface SegmentModel {
  run(x: Float32Array, xt: Float32Array): Promise<{ x: Float32Array; xt: Float32Array }>;
}

function meanAndDeviation(a: Float32Array): [number, number] {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i];
  const mean = sum / a.length;
  let sq = 0;
  for (let i = 0; i < a.length; i++) sq += (a[i] - mean) ** 2;
  return [mean, Math.sqrt(sq / (a.length - 1))];
}

function normalise(a: Float32Array): [number, number] {
  const [mean, dev] = meanAndDeviation(a);
  const k = 1 / (1e-5 + dev);
  for (let i = 0; i < a.length; i++) a[i] = (a[i] - mean) * k;
  return [mean, dev];
}

/** One segment's input to the network, and what is needed to read its output. */
interface Segment {
  offset: number;
  /** Samples of the song in it, and where they start in it (a short last segment is centred). */
  span: number;
  lead: number;
  x: Float32Array;
  xt: Float32Array;
  xMean: number;
  xDev: number;
  tMean: number;
  tDev: number;
}

/**
 * Where each segment starts in a song of `length` samples. The last one is the first that reaches
 * the end of the song: Demucs itself goes on while a segment starts inside the song, which for about
 * one song in three runs the network once more on a segment of mostly silence.
 */
export function segmentOffsets(length: number): number[] {
  const offsets: number[] = [];
  for (let offset = 0; offset < length; offset += STRIDE) {
    offsets.push(offset);
    if (offset + SEGMENT >= length) break;
  }
  return offsets;
}

/** The whole song is levelled by its mono mix: its mean, and its deviation as the scale. */
function songLevel(left: Float32Array, right: Float32Array): { mean: number; scale: number } {
  const length = left.length;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += (left[i] + right[i]) / 2;
  const mean = sum / length;
  let sq = 0;
  for (let i = 0; i < length; i++) sq += ((left[i] + right[i]) / 2 - mean) ** 2;
  return { mean, scale: Math.sqrt(sq / Math.max(1, length - 1)) + 1e-8 };
}

/**
 * What a run of segments adds to the stems: from sample `from` on, each stem's weighted sum (still
 * levelled) and the weights summed there. Parts of a song are put together with joinParts.
 */
export interface StemPart {
  from: number;
  sums: Float32Array[];
  weights: Float32Array;
}

/**
 * Runs the model on `count` segments from segment `first` (see segmentOffsets), the way Demucs
 * applies it: overlapping 7.8 s segments, each weighted by a triangle. Unlike Demucs' default there
 * is no random time shift, so the same song always gives the same stems.
 *
 * The network and the work around it overlap: while the network runs on one segment, the next one
 * is prepared and the previous one's output turned into sound.
 */
export async function separatePart(
  left: Float32Array,
  right: Float32Array,
  model: SegmentModel,
  first: number,
  count: number,
  onProgress: (p: number) => void = () => {},
  aborted: () => boolean = () => false,
): Promise<StemPart> {
  const length = left.length;
  const { mean, scale } = songLevel(left, right);
  const offsets = segmentOffsets(length).slice(first, first + count);
  const from = offsets[0] ?? 0;
  const to = offsets.length ? Math.min(length, offsets[offsets.length - 1] + SEGMENT) : from;

  const sums = MODEL_STEMS.map(() => new Float32Array(to - from));
  const weights = new Float32Array(to - from);
  const monos = [new Float32Array(SEGMENT), new Float32Array(SEGMENT)];
  const half = SEGMENT / 2;
  const weight = (i: number) => (i < half ? i + 1 : SEGMENT - i) / half;
  // Two sets of input buffers: one is with the network while the other is filled.
  const buffers = [0, 1].map(() => ({ x: new Float32Array(4 * PLANE), xt: new Float32Array(2 * SEGMENT) }));

  const prepare = (offset: number, buffer: (typeof buffers)[number]): Segment => {
    const { x, xt } = buffer;
    const span = Math.min(length - offset, SEGMENT);
    const lead = Math.floor((SEGMENT - span) / 2);
    const start = offset - lead;
    for (let i = 0; i < SEGMENT; i++) {
      const src = start + i;
      const inside = src >= 0 && src < length;
      xt[i] = inside ? (left[src] - mean) / scale : 0;
      xt[SEGMENT + i] = inside ? (right[src] - mean) / scale : 0;
    }
    spectrogram(xt.subarray(0, SEGMENT), x, 0);
    spectrogram(xt.subarray(SEGMENT), x, 2);
    const [xMean, xDev] = normalise(x);
    const [tMean, tDev] = normalise(xt);
    return { offset, span, lead, x, xt, xMean, xDev, tMean, tDev };
  };

  const finish = (seg: Segment, out: { x: Float32Array; xt: Float32Array }) => {
    const at0 = seg.offset - from;
    for (let s = 0; s < SOURCES; s += 2) {
      const [m1, m2] = monos;
      m1.fill(0);
      m2.fill(0);
      addInversePair(out.x, s * 4 * PLANE, (s + 1) * 4 * PLANE, seg.xDev, seg.xMean, m1, m2);
      for (const [j, mono] of [m1, m2].entries()) {
        const l = (s + j) * 2 * SEGMENT;
        const r = l + SEGMENT;
        const sum = sums[s + j];
        for (let i = 0; i < seg.span; i++) {
          const at = seg.lead + i;
          sum[at0 + i] += weight(i) * (mono[at] + ((out.xt[l + at] + out.xt[r + at]) / 2) * seg.tDev + seg.tMean);
        }
      }
    }
    for (let i = 0; i < seg.span; i++) weights[at0 + i] += weight(i);
  };

  if (!offsets.length) return { from, sums, weights };
  let current = prepare(offsets[0], buffers[0]);
  let pending = model.run(current.x, current.xt);
  for (let k = 0; k < offsets.length; k++) {
    if (aborted()) throw new DOMException('analysis cancelled', 'AbortError');
    const next = k + 1 < offsets.length ? prepare(offsets[k + 1], buffers[(k + 1) % 2]) : null;
    const out = await pending;
    if (next) pending = model.run(next.x, next.xt);
    finish(current, out);
    onProgress(Math.min(1, (current.offset + current.span) / length));
    if (next) current = next;
  }
  return { from, sums, weights };
}

/** Puts the parts of a song separated in runs (separatePart) together into its four stems. */
export function joinParts(left: Float32Array, right: Float32Array, parts: readonly StemPart[]): Float32Array[] {
  const length = left.length;
  const { mean, scale } = songLevel(left, right);
  const stems = MODEL_STEMS.map(() => new Float32Array(length));
  const weights = new Float32Array(length);
  for (const part of parts) {
    part.sums.forEach((sum, s) => {
      const stem = stems[s];
      for (let i = 0; i < sum.length; i++) stem[part.from + i] += sum[i];
    });
    for (let i = 0; i < part.weights.length; i++) weights[part.from + i] += part.weights[i];
  }
  for (const stem of stems) for (let i = 0; i < length; i++) stem[i] = weights[i] > 0 ? (stem[i] / weights[i]) * scale + mean : mean;
  return stems;
}

/** Splits a stereo song at 44.1 kHz into its four stems, each mixed to mono, in one run. */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  model: SegmentModel,
  onProgress: (p: number) => void = () => {},
  aborted: () => boolean = () => false,
): Promise<Float32Array[]> {
  const count = segmentOffsets(left.length).length;
  return joinParts(left, right, [await separatePart(left, right, model, 0, count, onProgress, aborted)]);
}
