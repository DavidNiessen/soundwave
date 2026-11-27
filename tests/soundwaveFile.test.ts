import { describe, expect, it } from 'vitest';
import { ANALYSIS_VERSION } from '../src/analysis/types';
import { readSongPackage } from '../src/storage/songFile';
import {
  soundwaveAudio,
  soundwaveFileName,
  SoundwaveFileError,
  isSoundwave,
  MAX_INFLATED,
  readSoundwave,
  writeSoundwave,
  type SoundwaveContents,
} from '../src/storage/soundwaveFile';

const audioBytes = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
const coverBytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 13) & 255);

function contents(extra: Partial<SoundwaveContents> = {}): SoundwaveContents {
  return {
    meta: {
      title: 'Night Drive',
      artist: 'The Lanes',
      album: 'Highway',
      duration: 201.5,
      fileName: 'night-drive.mp3',
      addedAt: 1700000000000,
    },
    cover: new Blob([coverBytes], { type: 'image/png' }),
    analysis: { version: 2, data: { tempo: 128, beats: [0.5, 0.97, 1.44], note: 'ü' } },
    audio: new Blob([audioBytes], { type: 'audio/mpeg' }),
    ...extra,
  };
}

const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

describe('.soundwave files', () => {
  it('carries a song whole: details, cover, analysis and the audio byte for byte', async () => {
    const file = await writeSoundwave(contents());
    expect(await isSoundwave(file)).toBe(true);
    const back = await readSoundwave(file);
    expect(back.meta).toEqual(contents().meta);
    expect(back.analysis).toEqual({ version: 2, data: { tempo: 128, beats: [0.5, 0.97, 1.44], note: 'ü' } });
    expect(back.cover?.type).toBe('image/png');
    expect(await bytes(back.cover!)).toEqual(coverBytes);
    expect(back.audio.type).toBe('audio/mpeg');
    expect(await bytes(back.audio)).toEqual(audioBytes);
  });

  it('starts with its magic and version, and slices the audio out without reading the rest', async () => {
    const file = await writeSoundwave(contents());
    const head = await bytes(file.slice(0, 12));
    expect(String.fromCharCode(...head.subarray(0, 8))).toBe('SOUNDWAV');
    expect(head[8] | (head[9] << 8)).toBe(1);
    const audio = await soundwaveAudio(file);
    expect(audio.type).toBe('audio/mpeg');
    expect(await bytes(audio)).toEqual(audioBytes);
  });

  it('works without a cover or an analysis', async () => {
    const back = await readSoundwave(await writeSoundwave(contents({ cover: undefined, analysis: undefined })));
    expect(back.cover).toBeUndefined();
    expect(back.analysis).toBeUndefined();
    expect(await bytes(back.audio)).toEqual(audioBytes);
  });

  it('turns down what is not a song file, is damaged, cut short or from a newer version', async () => {
    await expect(readSoundwave(new Blob([audioBytes]))).rejects.toThrow(SoundwaveFileError);
    const good = await bytes(await writeSoundwave(contents()));

    const flipped = good.slice();
    flipped[flipped.length - 100] ^= 0xff; // inside the audio
    await expect(readSoundwave(new Blob([flipped]))).rejects.toThrow(/damaged/);

    await expect(readSoundwave(new Blob([good.subarray(0, good.length - 10)]))).rejects.toThrow(SoundwaveFileError);

    const newer = good.slice();
    newer[8] = 9;
    await expect(readSoundwave(new Blob([newer]))).rejects.toThrow(/newer version/);
  });

  it('skips chunks it does not know, so later versions can add their own', async () => {
    const good = await bytes(await writeSoundwave(contents()));
    const extra = new Uint8Array([...'XTRA'].map((c) => c.charCodeAt(0)).concat([3, 0, 0, 0, 1, 2, 3, 0, 0, 0, 0]));
    const withExtra = new Blob([good.subarray(0, 12), extra, good.subarray(12)]);
    expect(await bytes((await readSoundwave(withExtra)).audio)).toEqual(audioBytes);
  });

  it('keeps out what it cannot trust in a file from elsewhere', async () => {
    const back = await readSoundwave(
      await writeSoundwave(
        contents({
          meta: { title: 'x'.repeat(1000), artist: '  ', duration: Number.NaN, fileName: 'a.mp3' },
          cover: new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }),
        }),
      ),
    );
    expect(back.meta.title).toHaveLength(300);
    expect(back.meta.artist).toBe('Unknown artist');
    expect(back.meta.duration).toBe(0);
    expect(back.cover).toBeUndefined();
  });

  it('leaves out an analysis that inflates past the limit, rather than fill the memory with it', async () => {
    // A string of JSON that just fits is read; one past the limit (as a gzip bomb would be) is not.
    const near = await readSoundwave(await writeSoundwave(contents({ analysis: { version: 2, data: 'a'.repeat(MAX_INFLATED - 2) } })));
    expect(near.analysis?.data).toHaveLength(MAX_INFLATED - 2);
    const past = await readSoundwave(await writeSoundwave(contents({ analysis: { version: 2, data: 'a'.repeat(MAX_INFLATED) } })));
    expect(past.analysis).toBeUndefined();
    expect(await bytes(past.audio)).toEqual(audioBytes);
  });

  it('reads only the details and audio when asked to, leaving the analysis uninflated', async () => {
    const back = await readSoundwave(await writeSoundwave(contents()), { analysis: false });
    expect(back.meta.title).toBe('Night Drive');
    expect(back.analysis).toBeUndefined();
  });

  it('turns down a file of endless empty chunks', async () => {
    const good = await bytes(await writeSoundwave(contents()));
    const empty = new Uint8Array([...'ZZZZ'].map((c) => c.charCodeAt(0)).concat([0, 0, 0, 0, 0, 0, 0, 0]));
    const many = new Blob([good.subarray(0, 12), ...Array.from({ length: 5000 }, () => empty), good.subarray(12)]);
    await expect(readSoundwave(many)).rejects.toThrow(/damaged/);
  });

  it('names files "Artist - Title.soundwave", safe on every system', () => {
    expect(soundwaveFileName({ artist: 'AC/DC', title: 'T.N.T.' })).toBe('AC DC - T.N.T.soundwave');
    expect(soundwaveFileName({ artist: 'A', title: 'Why? <Live>: "2024"' })).toBe('A - Why Live 2024.soundwave');
    expect(soundwaveFileName({ artist: 'Unknown artist', title: 'Night Drive' })).toBe('Night Drive.soundwave');
    expect(soundwaveFileName({ artist: '', title: '' })).toBe('song.soundwave');
  });
});

describe('a song file from an earlier version of the game', () => {
  const analysis = (version: number) => ({
    version,
    data: {
      version,
      source: 'ml',
      duration: 3,
      tempo: 120,
      beats: [0.5, 1, 1.5],
      downbeats: [0],
      drums: [],
      bass: [],
      lead: [],
      vocals: [],
      harmony: [],
      sections: [],
      energy: [],
      energyHop: 0.1,
      pitchSource: 'basic-pitch',
    },
  });
  const file = (version: number) =>
    writeSoundwave({
      meta: { title: 'Old', artist: 'Test', duration: 3, fileName: 'old.wav' },
      audio: new Blob([Uint8Array.from({ length: 2000 }, (_, i) => (i * 7) & 255)], { type: 'audio/wav' }),
      analysis: analysis(version),
    });

  it('keeps its analysis aside, with its version, rather than chart from it as a current one', async () => {
    const p = await readSongPackage(await file(ANALYSIS_VERSION - 1), 'old.soundwave');
    expect(p.analysis).toBeUndefined();
    expect(p.olderAnalysis?.version).toBe(ANALYSIS_VERSION - 1);
    expect(p.olderAnalysis?.data.beats).toEqual([0.5, 1, 1.5]);
  });

  it('takes a current analysis as it is', async () => {
    const p = await readSongPackage(await file(ANALYSIS_VERSION), 'new.soundwave');
    expect(p.analysis?.beats).toEqual([0.5, 1, 1.5]);
    expect(p.olderAnalysis).toBeUndefined();
  });
});
