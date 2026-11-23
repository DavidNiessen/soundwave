import { addInversePair, BINS, FRAMES, SEGMENT, spectrogram } from './stft';

/** The stems in the order the model gives them. */
export const MODEL_STEMS = ['drums', 'bass', 'other', 'vocals'] as const;
export const MODEL_RATE = 44100;

/** How much of its length a segment shares with the next: a quarter, as in Demucs. */
export const OVERLAP = 0.25;
const PLANE = BINS * FRAMES;

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

/** What is needed to read the network's output for one segment. */
export interface SegmentInfo {
  offset: number;
  /** Samples of the song in it, and where they start in it (a short last segment is centred). */
  span: number;
  lead: number;
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
export function segmentOffsets(length: number, overlap = OVERLAP): number[] {
  const stride = Math.floor((1 - overlap) * SEGMENT);
  const offsets: number[] = [];
  for (let offset = 0; offset < length; offset += stride) {
    offsets.push(offset);
    if (offset + SEGMENT >= length) break;
  }
  return offsets;
}

/** How a song is levelled for the network: by its mono mix's mean, and its deviation as the scale. */
export interface SongLevel {
  mean: number;
  scale: number;
}

export function songLevel(left: Float32Array, right: Float32Array): SongLevel {
  const length = left.length;
  let sum = 0;
  for (let i = 0; i < length; i++) sum += (left[i] + right[i]) / 2;
  const mean = sum / length;
  let sq = 0;
  for (let i = 0; i < length; i++) sq += ((left[i] + right[i]) / 2 - mean) ** 2;
  return { mean, scale: Math.sqrt(sq / Math.max(1, length - 1)) + 1e-8 };
}

/** The network's input for the segment at `offset`, written into `x` (4 planes) and `xt` (2 channels). */
export function prepareSegment(
  left: Float32Array,
  right: Float32Array,
  level: SongLevel,
  offset: number,
  x: Float32Array,
  xt: Float32Array,
): SegmentInfo {
  const { mean, scale } = level;
  const length = left.length;
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
  return { offset, span, lead, xMean, xDev, tMean, tDev };
}

/**
 * The stems are turned into sound two at a time (one inverse transform serves two, see
 * addInversePair): drums with bass, the other instruments with vocals. A pair's share of the
 * network's output is its 8 planes and its 4 channels, which follow each other in the output.
 */
export const PAIRS = 2;
export const PAIR_PLANES = 8 * PLANE;
export const PAIR_CHANNELS = 4 * SEGMENT;

/** One pair's share of the network's output for a segment. */
export interface PairOutput {
  x: Float32Array;
  xt: Float32Array;
}

/** A pair's share of the network's whole output (views, not copies). */
export function pairOutput(out: { x: Float32Array; xt: Float32Array }, pair: number): PairOutput {
  return {
    x: out.x.subarray(pair * PAIR_PLANES, (pair + 1) * PAIR_PLANES),
    xt: out.xt.subarray(pair * PAIR_CHANNELS, (pair + 1) * PAIR_CHANNELS),
  };
}

const HALF = SEGMENT / 2;
/** Each segment counts by a triangle over its length, as in Demucs. */
const weight = (i: number) => (i < HALF ? i + 1 : SEGMENT - i) / HALF;

/**
 * What a run of segments adds to one pair of stems, from sample `from` to `to`: each stem's weighted
 * sum (still levelled) and, when `withWeights`, the weights summed there. Segments must be added in
 * order, so every sum is added up the same way wherever it is done.
 */
export class PairSums {
  readonly sums: [Float32Array, Float32Array];
  readonly weights: Float32Array | null;
  private readonly monos = [new Float32Array(SEGMENT), new Float32Array(SEGMENT)];

  constructor(
    readonly from: number,
    to: number,
    withWeights: boolean,
  ) {
    this.sums = [new Float32Array(to - from), new Float32Array(to - from)];
    this.weights = withWeights ? new Float32Array(to - from) : null;
  }

  add(seg: SegmentInfo, out: PairOutput) {
    const at0 = seg.offset - this.from;
    const [m1, m2] = this.monos;
    m1.fill(0);
    m2.fill(0);
    addInversePair(out.x, 0, 4 * PLANE, seg.xDev, seg.xMean, m1, m2);
    for (const [j, mono] of [m1, m2].entries()) {
      const l = j * 2 * SEGMENT;
      const r = l + SEGMENT;
      const sum = this.sums[j];
      for (let i = 0; i < seg.span; i++) {
        const at = seg.lead + i;
        sum[at0 + i] += weight(i) * (mono[at] + ((out.xt[l + at] + out.xt[r + at]) / 2) * seg.tDev + seg.tMean);
      }
    }
    if (this.weights) for (let i = 0; i < seg.span; i++) this.weights[at0 + i] += weight(i);
  }
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

/** Where a run of `count` segments from segment `first` starts and ends, and their offsets. */
export function partSpan(length: number, first: number, count: number, overlap = OVERLAP): { offsets: number[]; from: number; to: number } {
  const offsets = segmentOffsets(length, overlap).slice(first, first + count);
  const from = offsets[0] ?? 0;
  const to = offsets.length ? Math.min(length, offsets[offsets.length - 1] + SEGMENT) : from;
  return { offsets, from, to };
}

/**
 * Runs the model on `count` segments from segment `first` (see segmentOffsets), the way Demucs
 * applies it: overlapping 7.8 s segments, each weighted by a triangle. Unlike Demucs' default there
 * is no random time shift, so the same song always gives the same stems.
 *
 * Everything runs on this thread: the next segment is prepared and the last one turned into sound
 * while the network works, which helps where the network runs elsewhere (a processor's threads, the
 * app). Where the network needs this thread to keep a graphics card fed, the work around it is done
 * by helper workers instead (see transform.ts).
 */
export async function separatePart(
  left: Float32Array,
  right: Float32Array,
  model: SegmentModel,
  first: number,
  count: number,
  onProgress: (p: number) => void = () => {},
  aborted: () => boolean = () => false,
  overlap = OVERLAP,
): Promise<StemPart> {
  const length = left.length;
  const level = songLevel(left, right);
  const { offsets, from, to } = partSpan(length, first, count, overlap);
  const pairs = [new PairSums(from, to, true), new PairSums(from, to, false)];
  const part = (): StemPart => ({ from, sums: pairs.flatMap((p) => p.sums), weights: pairs[0].weights! });
  // Two sets of input buffers: one is with the network while the other is filled.
  const buffers = [0, 1].map(() => ({ x: new Float32Array(4 * PLANE), xt: new Float32Array(2 * SEGMENT) }));
  const prepare = (k: number) => {
    const b = buffers[k % 2];
    return { ...b, info: prepareSegment(left, right, level, offsets[k], b.x, b.xt) };
  };

  if (!offsets.length) return part();
  let current = prepare(0);
  let pending = model.run(current.x, current.xt);
  for (let k = 0; k < offsets.length; k++) {
    if (aborted()) throw new DOMException('analysis cancelled', 'AbortError');
    const next = k + 1 < offsets.length ? prepare(k + 1) : null;
    const out = await pending;
    if (next) pending = model.run(next.x, next.xt);
    pairs.forEach((p, i) => p.add(current.info, pairOutput(out, i)));
    onProgress(Math.min(1, (current.info.offset + current.info.span) / length));
    if (next) current = next;
  }
  return part();
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
