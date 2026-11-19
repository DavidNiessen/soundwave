import { describe, expect, it } from 'vitest';
import { BackupError, packBackup, preferenceKeys, readBackup } from '../src/storage/backup';
import { readSoundwave, writeSoundwave } from '../src/storage/soundwaveFile';
import { readReplay, writeReplay, type Replay } from '../src/storage/replays';

const song = (title: string, n: number) =>
  writeSoundwave({
    meta: { title, artist: 'Test', duration: 3, fileName: `${title}.wav` },
    audio: new Blob([Uint8Array.from({ length: n }, (_, i) => i & 255)], { type: 'audio/wav' }),
  });

const score = {
  songId: 'abc',
  part: 'drums',
  difficulty: 'hard',
  score: 12345,
  stars: 4,
  accuracy: 0.9,
  fullCombo: false,
  key: 'abc:drums:hard',
  date: 1,
};

describe('library backups', () => {
  it('carry the songs whole, the scores and the preferences', async () => {
    const songs = [await song('One', 3000), await song('Two', 5000)];
    const file = await packBackup({
      createdAt: 1700000000000,
      preferences: { 'soundwave.settings.v1': '{"volume":0.5}', 'soundwave.setlist': '["abc"]' },
      scores: [score],
      songs,
    });
    const b = await readBackup(file);
    expect(b.createdAt).toBe(1700000000000);
    expect(b.songs).toHaveLength(2);
    expect((await readSoundwave(b.songs[1])).meta.title).toBe('Two');
    expect(new Uint8Array(await b.songs[0].arrayBuffer())).toEqual(new Uint8Array(await songs[0].arrayBuffer()));
    expect(b.scores).toEqual([
      { songId: 'abc', part: 'drums', difficulty: 'hard', score: 12345, stars: 4, accuracy: 0.9, fullCombo: false },
    ]);
    expect(b.preferences).toEqual({ 'soundwave.settings.v1': '{"volume":0.5}', 'soundwave.setlist': '["abc"]' });
  });

  it('take only the game’s own preferences, never developer overrides or other sites’ keys', async () => {
    expect(
      preferenceKeys(['soundwave.settings.v1', 'soundwave.dev.stem-model', 'other', 'soundwave.cache.gpu', 'soundwave.setlist']),
    ).toEqual(['soundwave.settings.v1', 'soundwave.setlist']);
    const file = await packBackup({
      createdAt: 1,
      preferences: { 'soundwave.dev.analysis-device': 'none', evil: 'x', 'soundwave.home-tab': 'sets' },
      scores: [],
      songs: [],
    });
    expect((await readBackup(file)).preferences).toEqual({ 'soundwave.home-tab': 'sets' });
  });

  it('drop scores that are not well formed', async () => {
    const bad = [{ ...score, part: 'kazoo' }, { ...score, score: 'lots' }, { ...score, stars: 99, accuracy: 3 }, null];
    const b = await readBackup(await packBackup({ createdAt: 1, preferences: {}, scores: bad, songs: [] }));
    expect(b.scores).toEqual([{ songId: 'abc', part: 'drums', difficulty: 'hard', score: 12345, stars: 6, accuracy: 1, fullCombo: false }]);
  });

  it('turn down song files, damaged backups and backups from a newer version', async () => {
    await expect(readBackup(await song('One', 100))).rejects.toThrow(/not a Soundwave library backup/);
    const good = new Uint8Array(
      await (await packBackup({ createdAt: 1, preferences: { 'soundwave.a': 'b' }, scores: [], songs: [] })).arrayBuffer(),
    );
    const damaged = good.slice();
    damaged[30] ^= 0xff; // inside the INFO payload
    await expect(readBackup(new Blob([damaged]))).rejects.toThrow(BackupError);
    await expect(readBackup(new Blob([good.subarray(0, good.length - 3)]))).rejects.toThrow(BackupError);
    const newer = good.slice();
    newer[8] = 9;
    await expect(readBackup(new Blob([newer]))).rejects.toThrow(/newer version/);
  });
});

const replay = (id: string, date: number): Replay => {
  const chart = {
    part: 'drums' as const,
    difficulty: 'hard' as const,
    lanes: 4 as const,
    notes: [{ t: 1, lane: 2, dur: 0, phrase: -1 }],
    beats: [0, 0.5, 1],
    downbeats: [0],
    secondsPerBeat: 0.5,
    duration: 3,
  };
  const results = {
    score: 50,
    stars: 1,
    accuracy: 1,
    counts: { perfect: 1, great: 0, good: 0, miss: 0 },
    bestStreak: 1,
    totalNotes: 1,
    fullCombo: true,
    overdriveActivations: 0,
    releases: { hit: 0, total: 0 },
  };
  return {
    meta: {
      id,
      date,
      songId: 'abc',
      title: 'One',
      artist: 'Test',
      part: 'drums',
      difficulty: 'hard',
      results,
      best: true,
      kept: false,
      duration: 3,
    },
    data: { id, chart, inputs: { ops: Uint8Array.of(1 | (2 << 3), 0), times: Float32Array.of(1, 2) } },
  };
};

describe('library backups with replays', () => {
  it('carry every replay whole, before the songs', async () => {
    const file = await packBackup({
      createdAt: 1,
      preferences: {},
      scores: [],
      songs: [await song('One', 2000)],
      replays: [writeReplay(replay('a-1', 10)), async () => writeReplay(replay('b-2', 20)), async () => null],
    });
    const b = await readBackup(file);
    expect(b.songs).toHaveLength(1);
    expect(b.replays).toHaveLength(2);
    const back = await readReplay(b.replays[1]);
    expect(back.meta).toEqual(replay('b-2', 20).meta);
    expect(back.data.inputs.ops).toEqual(Uint8Array.of(1 | (2 << 3), 0));
  });

  it('leave out a damaged replay and keep the rest', async () => {
    const good = new Uint8Array(
      await (
        await packBackup({ createdAt: 1, preferences: {}, scores: [], songs: [], replays: [writeReplay(replay('a-1', 10))] })
      ).arrayBuffer(),
    );
    // Flip a byte inside the replay's payload: its checksum no longer matches.
    const at = new TextDecoder().decode(good).indexOf('SWREPLAY') + 20;
    good[at] ^= 0xff;
    expect((await readBackup(new Blob([good]))).replays).toHaveLength(0);
  });

  it('from before replays read as having none', async () => {
    const b = await readBackup(await packBackup({ createdAt: 1, preferences: {}, scores: [], songs: [] }));
    expect(b.replays).toEqual([]);
  });
});
