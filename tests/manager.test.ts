import { describe, expect, it } from 'vitest';
import { AnalysisManager, type Assist, type LocalAnalyzer } from '../src/analysis/manager';
import type { StemAnalyzer } from '../src/analysis/separation/analyzer';
import { ANALYSIS_VERSION, type AnalysisResult } from '../src/analysis/types';
import type { SongEdits } from '../src/editor/edits';

const result = (): AnalysisResult => ({
  version: 1,
  source: 'local',
  duration: 10,
  tempo: 120,
  beats: [0.5, 1],
  downbeats: [0],
  drums: [],
  bass: [],
  lead: [],
  vocals: [],
  harmony: [],
  sections: [],
  energy: [],
  energyHop: 0.1,
  pitchSource: 'salience',
});

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('AnalysisManager', () => {
  it('does not keep a failure from a song removed mid-analysis, and re-analyzes on re-import', async () => {
    let calls = 0;
    let failFirst: (e: Error) => void = () => {};
    let aborted = false;
    const local: LocalAnalyzer = (_id, _p, signal) => {
      calls++;
      if (calls === 1) {
        signal.addEventListener('abort', () => (aborted = true));
        // The first run outlives the removal and then fails, like reading deleted audio.
        return new Promise((_, reject) => (failFirst = reject));
      }
      return Promise.resolve(result());
    };
    const m = new AnalysisManager(local);

    m.enqueue('song');
    await tick();
    expect(m.snapshot().song?.state).toBe('analyzing');

    m.forget('song'); // removed while analyzing
    expect(aborted).toBe(true);
    failFirst(new Error('The audio file for this song is missing.'));
    await tick();
    expect(m.snapshot().song).toBeUndefined();

    await m.check('song', true); // re-imported: no cached analysis, so it queues again
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'ready'; i++) await tick();
    expect(m.snapshot().song?.state).toBe('ready');
    expect(calls).toBe(2);
  });

  it('ignores a successful result that arrives after the song was removed', async () => {
    let finish: (r: AnalysisResult) => void = () => {};
    const m = new AnalysisManager(() => new Promise((res) => (finish = res)));
    m.enqueue('song');
    await tick();
    m.forget('song');
    finish(result());
    await tick();
    await tick();
    expect(m.snapshot().song).toBeUndefined();
    expect(await m.chart('song', 'drums', 'easy')).toBeUndefined();
  });

  it('separates a song into stems first and hands them to the rest of the analysis', async () => {
    const wav = () => new ArrayBuffer(8);
    const separator: StemAnalyzer = async (_id, onProgress) => {
      onProgress(0.5, 'Separating stems');
      return {
        stems: { drums: wav(), bass: wav(), vocals: wav(), other: wav() },
        notes: { bass: [{ t: 1, dur: 0.2, midi: 40, strength: 1 }], vocals: [], other: [] },
      };
    };
    let got: Assist | undefined;
    const m = new AnalysisManager((_id, _p, _signal, assist) => {
      got = assist;
      return Promise.resolve({ ...result(), source: 'ml' });
    }, separator);
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'ready'; i++) await tick();
    expect(m.snapshot().song?.state).toBe('ready');
    expect(Object.keys(got?.stems ?? {}).sort()).toEqual(['bass', 'drums', 'other', 'vocals']);
    expect(got?.drumStem).toBeInstanceOf(ArrayBuffer);
    expect(got?.stemNotes?.bass).toHaveLength(1);
  });

  it('shows a model download in the bar of the song waiting for it, before its own progress', async () => {
    const wav = () => new ArrayBuffer(8);
    const seen: number[] = [];
    const steps = new Set<string>();
    const m = new AnalysisManager(
      (_id, onProgress) => {
        onProgress({ step: 'rhythm', progress: 0.5 });
        return Promise.resolve(result());
      },
      async (_id, onProgress) => {
        onProgress(0.5, 'Downloading the analysis model', true);
        onProgress(1, 'Downloading the analysis model', true);
        onProgress(0, 'Separating stems');
        onProgress(1, 'Separating stems');
        return { stems: { drums: wav(), bass: wav(), vocals: wav(), other: wav() }, notes: { bass: [], vocals: [], other: [] } };
      },
    );
    m.subscribe(() => {
      const s = m.snapshot().song;
      if (s?.state === 'analyzing') {
        seen.push(s.progress ?? 0);
        if (s.step) steps.add(s.step);
      }
    });
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'ready'; i++) await tick();
    expect(steps.has('Downloading the analysis model')).toBe(true);
    // The bar only moves forward, and the download is its first part.
    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    expect(seen[0]).toBeCloseTo(0.2);
    expect(seen[seen.length - 1]).toBeLessThan(1);
  });

  it('does not chart a song it could not separate', async () => {
    let charted = false;
    const m = new AnalysisManager(
      () => {
        charted = true;
        return Promise.resolve(result());
      },
      () => Promise.reject(new Error('The analysis model could not be downloaded.')),
    );
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'error'; i++) await tick();
    expect(m.snapshot().song).toMatchObject({ state: 'error', error: 'The analysis model could not be downloaded.' });
    expect(charted).toBe(false);
  });

  it('reports real failures', async () => {
    const m = new AnalysisManager(() => Promise.reject(new Error('decode failed')));
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'error'; i++) await tick();
    expect(m.snapshot().song).toMatchObject({ state: 'error', error: 'decode failed' });
  });
});

describe('AnalysisManager after the analysis version is raised', () => {
  const ownGrid: SongEdits = {
    version: 1,
    grid: { kind: 'fixed', bpm: 120, offset: 0, beatsPerBar: 4 },
    duration: 10,
    charts: {},
    updatedAt: 1,
  };
  const env = (canAnalyze: boolean, older: boolean) => ({
    olderAnalyses: async () => (older ? [{ version: ANALYSIS_VERSION - 1, data: { ...result(), source: 'ml' } }] : []),
    canAnalyze: async () => canAnalyze,
  });
  const settle = async (m: AnalysisManager, id: string) => {
    for (let i = 0; i < 10 && m.snapshot()[id]?.state !== 'ready'; i++) await tick();
  };

  it('analyzes a song again that was analyzed before and then given a grid of its own', async () => {
    let calls = 0;
    const m = new AnalysisManager(async () => (calls++, result()), null, env(true, true));
    await m.saveEdits('song', ownGrid);
    await m.check('song', true);
    expect(['queued', 'analyzing']).toContain(m.snapshot().song?.state);
    await settle(m, 'song');
    expect(m.snapshot().song?.state).toBe('ready');
    expect(calls).toBe(1);
  });

  it('leaves a song started from scratch alone: it was never analyzed', async () => {
    let calls = 0;
    const m = new AnalysisManager(async () => (calls++, result()), null, env(true, false));
    await m.saveEdits('song', ownGrid);
    await m.check('song', true);
    await tick();
    expect(m.snapshot().song?.state).toBe('ready');
    expect(calls).toBe(0);
  });

  it('plays by the older analysis on a device that cannot analyze', async () => {
    let calls = 0;
    const m = new AnalysisManager(async () => (calls++, result()), null, env(false, true));
    await m.check('song', true);
    expect(m.snapshot().song?.state).toBe('ready');
    expect((await m.analysis('song'))?.beats).toEqual(result().beats);
    expect(calls).toBe(0);
  });

  it('still analyzes where it can rather than play by an older analysis', async () => {
    let calls = 0;
    const m = new AnalysisManager(async () => (calls++, result()), null, env(true, true));
    await m.check('song', true);
    await settle(m, 'song');
    expect(calls).toBe(1);
  });
});
