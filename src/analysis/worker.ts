/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { proxyWorkerFetch } from '../app/workerFetch';
import { openBeatModel } from './beat/model';
import { beatsAndBars } from './beat/track';
import { analyzeSignal, type BeatTracker } from './pipeline';
import { loadRuntime } from './runtime';
import type { AnalysisProgress, AnalysisResult, PartLines, StemName, StemNotes } from './types';

export type WorkerRequest = {
  type: 'analyze';
  signal: Float32Array;
  lines?: PartLines;
  drumSignal?: Float32Array;
  stems?: Partial<Record<StemName, Float32Array>>;
  stemNotes?: StemNotes;
  /** Where the beat model is and what to run it on; without it the beat tracker finds the grid. */
  beatModel?: { url: string; device: 'gpu' | 'cpu' };
};

export type WorkerResponse =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'log'; message: string }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };

const post = (m: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);

/** The song's beats and bar starts from the beat model, which is opened for this one song. */
const beatTracker =
  (at: NonNullable<WorkerRequest['beatModel']>): BeatTracker =>
  async (audio, onProgress) => {
    const started = performance.now();
    await loadRuntime(ort, at.device);
    const model = await openBeatModel(ort, at.url, at.device, (message) => post({ type: 'log', message }));
    try {
      const found = await beatsAndBars(audio, model, onProgress);
      post({
        type: 'log',
        message: `beat model on ${model.device}: ${found.beats.length} beats, ${found.downbeats.length} bars in ${Math.round(performance.now() - started)} ms`,
      });
      return found;
    } finally {
      await model.release();
    }
  };

// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m));

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (fetched(e.data)) return;
  const req = e.data;
  if (req.type !== 'analyze') return;
  try {
    const result = await analyzeSignal(req.signal, {
      onProgress: (progress) => post({ type: 'progress', progress }),
      onLog: (message) => post({ type: 'log', message }),
      lines: req.lines,
      drumSignal: req.drumSignal,
      stems: req.stems,
      stemNotes: req.stemNotes,
      beatTracker: req.beatModel && beatTracker(req.beatModel),
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};
