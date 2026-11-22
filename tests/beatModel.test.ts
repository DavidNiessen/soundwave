import { describe, expect, it } from 'vitest';
import { FPS, logMel, MELS } from '../src/analysis/beat/spectrogram';
import { beatsAndBars, WINDOW, type BeatModel } from '../src/analysis/beat/track';

const SR = 22050;

describe('the beat model spectrogram', () => {
  // A low tone, a high one that decays twice a second, and a third that is on every other quarter second.
  const signal = Float32Array.from({ length: 3 * SR }, (_, i) => {
    const t = i / SR;
    return (
      0.5 * Math.sin(2 * Math.PI * 220 * t) +
      0.25 * Math.sin(2 * Math.PI * 1760 * t) * Math.exp(-8 * (t % 0.5)) +
      0.2 * Math.sin(2 * Math.PI * 5000 * t) * (Math.floor(t * 4) % 2)
    );
  });
  const spect = logMel(signal);

  // Values of Beat This's own spectrogram (beat_this.preprocessing.LogMelSpect, PyTorch) for the same signal.
  it('gives the spectrogram Beat This computes', () => {
    expect(spect.frames).toBe(151);
    const expected: [number, number, number][] = [
      [0, 0, 6.48731],
      [0, 10, 6.36136],
      [5, 20, 0.21735],
      [50, 25, 2.85174],
      [50, 64, 4.82033],
      [75, 100, 5.5932],
      [100, 40, 3.29027],
      [120, 127, 0.00042],
      [149, 90, 0.33466],
      [150, 3, 6.89542],
    ];
    for (const [frame, band, value] of expected) expect(spect.data[frame * MELS + band]).toBeCloseTo(value, 3);
    expect(spect.data.reduce((a, b) => a + b, 0) / spect.data.length).toBeCloseTo(1.0735742, 4);
    expect(Math.max(...spect.data)).toBeCloseTo(8.1482687, 3);
  });

  it('has no frames for a signal without samples', () => {
    expect(logMel(new Float32Array(0)).frames).toBe(0);
  });
});

/**
 * A stand-in for the network that answers from a list: which frames of the whole signal are beats
 * and bar starts. It cannot see where a window starts, so the test tells it (`starts`, in the
 * order of the signal); beatsAndBars asks for the later windows first.
 */
function answering(starts: number[], beatFrames: number[], barFrames: number[] = []): BeatModel & { asked: number } {
  const left = [...starts];
  return {
    asked: 0,
    async run(spect) {
      expect(spect.length).toBe(WINDOW * MELS);
      this.asked++;
      const start = left.pop()!;
      const logits = (frames: number[]) => Float32Array.from({ length: WINDOW }, (_, t) => (frames.includes(start + t) ? 4 : -4));
      return { beat: logits(beatFrames), downbeat: logits(barFrames) };
    },
  };
}
const quiet = (seconds: number) => new Float32Array(seconds * SR).fill(0.01);

describe('beats from the beat model', () => {
  it('reads one window and turns frames into seconds', async () => {
    // Ten seconds: one window, starting six frames before the signal.
    const model = answering([-6], [25, 50, 75, 100], [50]);
    const found = await beatsAndBars(quiet(10), model);
    expect(model.asked).toBe(1);
    expect(found.beats).toEqual([25, 50, 75, 100].map((f) => f / FPS));
    expect(found.downbeats).toEqual([1]);
  });

  it('joins windows, and where two answer for a frame takes the earlier one', async () => {
    // Seventy seconds are 3501 frames: windows at -6, 1482 and (moved back to end with the signal) 2007.
    const starts = [-6, 1482, 2007];
    const beatFrames = [100, 1480, 1490, 2000, 2990, 3400];
    let asked = 0;
    const model: BeatModel = {
      async run() {
        const start = starts.pop()!;
        asked++;
        // The last window also claims a beat at frame 2500, in the stretch the window before it covers: it must lose.
        const frames = start === 2007 ? [...beatFrames, 2500] : beatFrames;
        return {
          beat: Float32Array.from({ length: WINDOW }, (_, t) => (frames.includes(start + t) ? 4 : -4)),
          downbeat: new Float32Array(WINDOW).fill(-4),
        };
      },
    };
    const progress: number[] = [];
    const found = await beatsAndBars(quiet(70), model, (p) => progress.push(p));
    expect(asked).toBe(3);
    expect(found.beats).toEqual(beatFrames.map((f) => f / FPS));
    expect(found.downbeats).toEqual([]);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('counts frames that tie as one beat in their middle, and puts a bar start on the nearest beat', async () => {
    // Frames 200 and 201 tie; the bar start at 304 belongs to the beat at 300.
    const found = await beatsAndBars(quiet(10), answering([-6], [100, 200, 201, 300], [304]));
    expect(found.beats).toEqual([2, 4.01, 6]);
    expect(found.downbeats).toEqual([6]);
  });

  it('takes only the highest frame within 70 ms either side', async () => {
    const model: BeatModel = {
      async run() {
        const beat = new Float32Array(WINDOW).fill(-4);
        // Around frame 100 of the signal (106 of the window): a rise to a peak, then a lower bump three frames on.
        beat.set([1, 3, 5, 2, 1, 3, 0.5], 104);
        return { beat, downbeat: new Float32Array(WINDOW).fill(-4) };
      },
    };
    expect((await beatsAndBars(quiet(10), model)).beats).toEqual([2]);
  });
});
