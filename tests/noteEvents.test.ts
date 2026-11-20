import { addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } from '@spotify/basic-pitch/esm/toMidi.js';
import { describe, expect, it } from 'vitest';
import { addPitchBends, CONTOUR_BINS, decodeNotes, notesToTime, PITCHES } from '../src/analysis/pitch/noteEvents';

/** A small deterministic random source, so a failure can be reproduced. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/**
 * Model-like output: notes held for a while at random pitches, a few with octave and neighbour
 * bleed, onsets at their starts, noise everywhere, contours peaking near each held pitch; values
 * stored as float32, like the network's.
 */
function fakeOutput(nFrames: number, seed: number) {
  const rnd = random(seed);
  const frames = new Float32Array(nFrames * PITCHES);
  const onsets = new Float32Array(nFrames * PITCHES);
  const contours = new Float32Array(nFrames * CONTOUR_BINS);
  for (let i = 0; i < frames.length; i++) frames[i] = rnd() * 0.25;
  for (let i = 0; i < onsets.length; i++) onsets[i] = rnd() * 0.3;
  for (let i = 0; i < contours.length; i++) contours[i] = rnd() * 0.2;
  for (let n = 0; n < nFrames / 6; n++) {
    const start = Math.floor(rnd() * nFrames);
    const len = 3 + Math.floor(rnd() * 40);
    const pitch = Math.floor(rnd() * PITCHES);
    const level = 0.3 + rnd() * 0.7;
    if (rnd() < 0.7) onsets[start * PITCHES + pitch] = Math.min(1, level + 0.2);
    for (let r = start; r < Math.min(nFrames, start + len); r++) {
      frames[r * PITCHES + pitch] = Math.max(frames[r * PITCHES + pitch], level - rnd() * 0.2);
      if (pitch + 12 < PITCHES && rnd() < 0.3) frames[r * PITCHES + pitch + 12] = level * 0.6;
      const bin = pitch * 3 + 1 + Math.floor(rnd() * 3) - 1;
      if (bin >= 0 && bin < CONTOUR_BINS) contours[r * CONTOUR_BINS + bin] = level;
    }
  }
  // Exact ties, which the original resolves in a particular way.
  for (let r = 10; r < 20 && r < nFrames; r++) {
    frames[r * PITCHES + 40] = 0.9;
    frames[r * PITCHES + 41] = 0.9;
  }
  return { frames, onsets, contours };
}

const rows = (a: Float32Array, width: number) =>
  Array.from({ length: a.length / width }, (_, r) => Array.from(a.subarray(r * width, (r + 1) * width)));

describe('note decoding', () => {
  for (const [nFrames, seed] of [
    [400, 1],
    [1200, 7],
    [3000, 42],
  ]) {
    it(`gives exactly the notes Basic Pitch's own decoding gives (${nFrames} frames)`, () => {
      const { frames, onsets, contours } = fakeOutput(nFrames, seed);
      const options = { onsetThresh: 0.45, frameThresh: 0.3, minNoteLen: 8, energyTolerance: 11 };
      const expected = noteFramesToTime(
        addPitchBendsToNoteEvents(
          rows(contours, CONTOUR_BINS),
          outputToNotesPoly(rows(frames, PITCHES), rows(onsets, PITCHES), 0.45, 0.3, 8, true, null, null, true, 11),
        ),
      );
      const got = notesToTime(addPitchBends(contours, decodeNotes(frames, onsets, nFrames, options)));
      expect(expected.length).toBeGreaterThan(20);
      expect(got).toEqual(expected);
      // Basic Pitch's own decoding is slow: seconds for the long run, more while the other test files share the processor.
    }, 20_000);
  }
});
