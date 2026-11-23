import { describe, expect, it } from 'vitest';
import { AnalysisHold } from '../src/analysis/hold';
import { AnalysisManager, DIED, type Assist, type LocalAnalyzer } from '../src/analysis/manager';
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

  it('begins on the mix while the song is separated, and lets go of it when separating fails', async () => {
    const wav = () => new ArrayBuffer(8);
    const events: string[] = [];
    const local: LocalAnalyzer = Object.assign(
      (id: string) => {
        events.push(`analyze ${id}`);
        return Promise.resolve(result());
      },
      {
        begin(id: string) {
          events.push(`begin ${id}`);
          return () => events.push(`let go ${id}`);
        },
      },
    );
    const m = new AnalysisManager(local, async (id) => {
      events.push(`separate ${id}`);
      if (id === 'broken') throw new Error('The song could not be separated into stems.');
      return { stems: { drums: wav(), bass: wav(), vocals: wav(), other: wav() }, notes: { bass: [], vocals: [], other: [] } };
    });
    m.enqueue('song');
    m.enqueue('broken');
    for (let i = 0; i < 10 && m.snapshot().broken?.state !== 'error'; i++) await tick();
    expect(events).toEqual(['begin song', 'separate song', 'analyze song', 'begin broken', 'separate broken', 'let go broken']);
  });

  it('waits while it is held: no song starts, and one under way waits after its stems', async () => {
    const wav = () => new ArrayBuffer(8);
    const hold = new AnalysisHold();
    const events: string[] = [];
    let separated: () => void = () => {};
    const m = new AnalysisManager(
      async (id) => (events.push(`analyze ${id}`), result()),
      (id) =>
        new Promise((resolve) => {
          events.push(`separate ${id}`);
          separated = () =>
            resolve({ stems: { drums: wav(), bass: wav(), vocals: wav(), other: wav() }, notes: { bass: [], vocals: [], other: [] } });
        }),
      { olderAnalyses: async () => [], canAnalyze: async () => true, hold },
    );
    hold.set('Paused while you play');
    m.enqueue('first');
    for (let i = 0; i < 5; i++) await tick();
    expect(events).toEqual([]);
    expect(m.snapshot().first?.state).toBe('queued');
    hold.set(null);
    for (let i = 0; i < 5; i++) await tick();
    expect(events).toEqual(['separate first']);
    // Held again while it separates: the rest of its analysis waits, and the bar says why.
    hold.set('Paused while you play');
    separated();
    for (let i = 0; i < 5; i++) await tick();
    expect(events).toEqual(['separate first']);
    expect(m.snapshot().first?.step).toBe('Paused while you play');
    hold.set(null);
    for (let i = 0; i < 10 && m.snapshot().first?.state !== 'ready'; i++) await tick();
    expect(events).toEqual(['separate first', 'analyze first']);
    expect(m.snapshot().first?.state).toBe('ready');
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

describe('a page that closed while analyzing', () => {
  /** What the page keeps across reloads (localStorage in the game). */
  const store = () => {
    let kept: string | null = null;
    return { read: () => kept, write: (id: string | null) => void (kept = id) };
  };
  const env = (running: ReturnType<typeof store>) => ({ olderAnalyses: async () => [], canAnalyze: async () => true, running });

  it('starts no song by itself until an analysis ends, so the page does not close every time it opens', async () => {
    const running = store();
    let calls = 0;
    // The first page: the analysis never ends (the browser closes the page for its memory).
    const first = new AnalysisManager(() => (calls++, new Promise<AnalysisResult>(() => {})), null, env(running));
    await first.check('song', true);
    await tick();
    expect(first.snapshot().song?.state).toBe('analyzing');
    expect(running.read()).toBe('song');

    // The page opens again: the song it closed on says why, and no song starts by itself.
    const second = new AnalysisManager(() => (calls++, Promise.resolve(result())), null, env(running));
    await second.check('song', true);
    await second.check('other', true);
    await tick();
    expect(second.snapshot().song).toMatchObject({ state: 'error', error: DIED });
    expect(second.snapshot().other?.state).toBe('idle');
    expect(calls).toBe(1);

    // And not on the next opening either, while nothing has been analyzed since.
    const third = new AnalysisManager(() => (calls++, Promise.resolve(result())), null, env(running));
    await third.check('other', true);
    await tick();
    expect(third.snapshot().other?.state).toBe('idle');

    // Asked for by the player, a song runs; once it ended, songs start by themselves again.
    third.enqueue('other');
    for (let i = 0; i < 5 && third.snapshot().other?.state !== 'ready'; i++) await tick();
    expect(third.snapshot().other?.state).toBe('ready');
    expect(running.read()).toBeNull();
    await third.check('new', true);
    for (let i = 0; i < 5 && third.snapshot().new?.state !== 'ready'; i++) await tick();
    expect(third.snapshot().new?.state).toBe('ready');
  });

  it('notes nothing once an analysis has ended, failed ones too', async () => {
    const running = store();
    const m = new AnalysisManager(() => Promise.reject(new Error('no')), null, env(running));
    m.enqueue('song');
    for (let i = 0; i < 5 && m.snapshot().song?.state !== 'error'; i++) await tick();
    expect(running.read()).toBeNull();
  });
});
