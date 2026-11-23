import { describe, expect, it } from 'vitest';
import {
  joinParts,
  MODEL_STEMS,
  segmentOffsets,
  separate,
  separatePart,
  type SegmentModel,
  type StemPart,
} from '../src/analysis/separation/separate';
import { addInverse, addInversePair, BINS, FRAMES, SEGMENT, spectrogram } from '../src/analysis/separation/stft';

const PLANE = BINS * FRAMES;
const tone = (i: number) => Math.fround(Math.sin(0.01 * i) + 0.5 * Math.sin(0.37 * i + 1));
const left = Float32Array.from({ length: SEGMENT }, (_, i) => tone(i));
const right = Float32Array.from({ length: SEGMENT }, (_, i) => tone(SEGMENT - 1 - i));

describe('the stem model transform', () => {
  const planes = new Float32Array(4 * PLANE);
  spectrogram(left, planes, 0);
  spectrogram(right, planes, 2);

  // Values of Demucs' own transform (HTDemucs._spec in PyTorch) for the same two signals.
  it('gives the spectrogram Demucs computes', () => {
    const expected: [number, number, number, number, number][] = [
      [0, 0, 0, 2.7123203, 0],
      [0, 7, 0, 8.4252815, -1.3430045],
      [0, 6, 1, 4.199441, 12.7649422],
      [0, 241, 100, -5.6133399, -5.4022985],
      [1, 241, 335, -5.8176765, 4.6615067],
      [1, 2047, 17, 0, 0],
      [0, 100, 335, 0.0311209, 0.0159586],
    ];
    for (const [channel, bin, frame, re, im] of expected) {
      const at = bin * FRAMES + frame;
      expect(planes[channel * 2 * PLANE + at]).toBeCloseTo(re, 3);
      expect(planes[(channel * 2 + 1) * PLANE + at]).toBeCloseTo(im, 3);
    }
  });

  // HTDemucs._ispec of that spectrogram: the signal again, except near the ends, where the frames
  // the model never sees are missing.
  it('inverts it the way Demucs does', () => {
    const back = [new Float32Array(SEGMENT), new Float32Array(SEGMENT)];
    addInverse(planes, 0, PLANE, back[0], 1);
    addInverse(planes, 2 * PLANE, 3 * PLANE, back[1], 1);
    const expected: [number, number, number][] = [
      [0, 0, 0.2103746],
      [0, 1, 0.2503317],
      [0, 500, -1.042137],
      [0, 1535, 0.192258],
      [0, 4000, 0.2620387],
      [0, 170000, -0.3719783],
      [1, 343979, 0.2361629],
      [1, 343000, -0.8136026],
      [0, 342500, 0.8272322],
    ];
    for (const [channel, i, v] of expected) expect(back[channel][i]).toBeCloseTo(v, 4);
  });
});

describe('the paired inverse transform', () => {
  it('gives each of two stems what transforming its averaged channels on its own gives', () => {
    // Model-like output for two stems: four planes each, still normalised.
    const rnd = (() => {
      let v = 7;
      return () => ((v = (v * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
    })();
    const planes = Float32Array.from({ length: 8 * PLANE }, rnd);
    const dev = 3.5;
    const mean = 0.02;
    const pair = [new Float32Array(SEGMENT), new Float32Array(SEGMENT)];
    addInversePair(planes, 0, 4 * PLANE, dev, mean, pair[0], pair[1]);
    for (const [j, base] of [0, 4 * PLANE].entries()) {
      // The plain way: undo the normalisation, average the channels, transform.
      const avg = new Float32Array(2 * PLANE);
      for (let i = 0; i < 2 * PLANE; i++) avg[i] = (planes[base + i] * dev + mean + (planes[base + 2 * PLANE + i] * dev + mean)) / 2;
      const single = new Float32Array(SEGMENT);
      addInverse(avg, 0, PLANE, single, 1);
      let worst = 0;
      let peak = 0;
      for (let i = 0; i < SEGMENT; i++) {
        worst = Math.max(worst, Math.abs(single[i] - pair[j][i]));
        peak = Math.max(peak, Math.abs(single[i]));
      }
      expect(worst / peak).toBeLessThan(1e-5);
    }
  });
});

describe('separating a song', () => {
  // A stand-in network: every stem gets a quarter of the song through the spectrogram and none
  // through the time branch, so the four stems must add up to the song.
  const quarter: SegmentModel = {
    async run(x) {
      const out = new Float32Array(MODEL_STEMS.length * 4 * PLANE);
      for (let s = 0; s < MODEL_STEMS.length; s++) for (let i = 0; i < x.length; i++) out[s * x.length + i] = x[i] / 4;
      return { x: out, xt: new Float32Array(MODEL_STEMS.length * 2 * SEGMENT) };
    },
  };

  it('puts overlapping segments back together, also for a song that ends inside one', async () => {
    const length = Math.round(SEGMENT * 1.9);
    const l = Float32Array.from({ length }, (_, i) => 0.3 * tone(i));
    const r = Float32Array.from({ length }, (_, i) => 0.2 * tone(i * 2));
    const seen: number[] = [];
    const stems = await separate(l, r, quarter, (p) => seen.push(p));
    expect(stems).toHaveLength(4);
    expect(seen.length).toBe(3);
    expect(seen[seen.length - 1]).toBe(1);
    // Away from the very ends the stems add up to the mono mix. Not exactly: the stand-in gives each
    // stem the whole of the (small) means the inputs were normalised by, not a quarter of them.
    let worst = 0;
    for (let i = 6000; i < length - 6000; i += 97) {
      const sum = stems[0][i] + stems[1][i] + stems[2][i] + stems[3][i];
      worst = Math.max(worst, Math.abs(sum - (l[i] + r[i]) / 2));
    }
    expect(worst).toBeLessThan(0.02);
  }, 120_000);

  it('runs no segment after the first one that reaches the end of the song', () => {
    const stride = Math.floor(0.75 * SEGMENT);
    expect(segmentOffsets(0)).toEqual([]);
    expect(segmentOffsets(SEGMENT)).toEqual([0]);
    // The second segment already ends past the song: Demucs would start a third, nearly all silence.
    expect(segmentOffsets(2 * stride + 1000)).toEqual([0, stride]);
    expect(segmentOffsets(stride + SEGMENT + 1)).toEqual([0, stride, 2 * stride]);
  });

  it('gives the same stems when the song is separated in runs of a few segments', async () => {
    const length = Math.round(SEGMENT * 4.3);
    const l = Float32Array.from({ length }, (_, i) => 0.3 * tone(i));
    const r = Float32Array.from({ length }, (_, i) => 0.2 * tone(i * 3));
    const whole = await separate(l, r, quarter);
    const count = segmentOffsets(length).length;
    const parts: StemPart[] = [];
    for (let first = 0; first < count; first += 2) parts.push(await separatePart(l, r, quarter, first, Math.min(2, count - first)));
    const joined = joinParts(l, r, parts);
    let worst = 0;
    for (let s = 0; s < 4; s++) for (let i = 0; i < length; i += 31) worst = Math.max(worst, Math.abs(joined[s][i] - whole[s][i]));
    expect(worst).toBeLessThan(1e-6);
  }, 120_000);

  it('stops when the analysis is cancelled', async () => {
    const l = new Float32Array(SEGMENT);
    await expect(
      separate(
        l,
        l,
        quarter,
        () => {},
        () => true,
      ),
    ).rejects.toThrow(/cancelled/);
  });
});
