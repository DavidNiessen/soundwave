/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { proxyWorkerFetch } from '../app/workerFetch';
import { appBeatModel, openBeatModel } from './beat/model';
import { beatsAndBars } from './beat/track';
import { analyzeMix, analyzeParts, analyzeSignal, type BeatTracker, type MixAnalysis } from './pipeline';
import { loadRuntime } from './runtime';
import { Stopwatch } from './timing';
import type { AnalysisProgress, AnalysisResult, PartLines, StemName, StemNotes } from './types';

/** Where the beat model is and what to run it on; without it the beat tracker finds the grid. */
export type BeatModelAt = { url: string; device: 'gpu' | 'cpu' | 'native' };

/** What the stems give the analysis (see PipelineOptions). */
export interface StemInputs {
  lines?: PartLines;
  drumSignal?: Float32Array;
  stems?: Partial<Record<StemName, Float32Array>>;
  stemNotes?: StemNotes;
}

/**
 * The whole analysis at once (`analyze`), or in two halves: `mix` starts on the song alone while its
 * stems are still being separated, and `parts` finishes it once they are there.
 */
export type WorkerRequest =
  | ({ type: 'analyze'; signal: Float32Array; beatModel?: BeatModelAt } & StemInputs)
  | { type: 'mix'; signal: Float32Array; beatModel?: BeatModelAt }
  | ({ type: 'parts' } & StemInputs);

export type WorkerResponse =
  | { type: 'progress'; progress: AnalysisProgress }
  | { type: 'log'; message: string }
  | { type: 'done'; result: AnalysisResult }
  | { type: 'error'; message: string };

const post = (m: WorkerResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);

/** The song's beats and bar starts from the beat model, which is opened for this one song. */
const beatTracker =
  (at: BeatModelAt): BeatTracker =>
  async (audio, onProgress) => {
    const clock = new Stopwatch();
    const device = at.device;
    let model;
    if (device === 'native') model = appBeatModel(ort);
    else {
      await loadRuntime(ort, device);
      model = await openBeatModel(ort, at.url, device, (message) => post({ type: 'log', message }));
    }
    clock.lap('opening');
    try {
      const found = await beatsAndBars(audio, model, onProgress, clock);
      post({
        type: 'log',
        message: `beat model on ${model.device}: ${found.beats.length} beats, ${found.downbeats.length} bars, ${clock}`,
      });
      return found;
    } finally {
      await model.release();
    }
  };

// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m, transfer) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer));

const report = {
  onProgress: (progress: AnalysisProgress) => post({ type: 'progress', progress }),
  onLog: (message: string) => post({ type: 'log', message }),
};

/** The mix's half of the analysis, started by a `mix` request, for the `parts` request after it. */
let mixed: Promise<{ signal: Float32Array; mix: MixAnalysis }> | null = null;

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  if (fetched(e.data)) return;
  const req = e.data;
  try {
    if (req.type === 'mix') {
      const { signal } = req;
      mixed = analyzeMix(signal, { ...report, withStems: true, beatTracker: req.beatModel && beatTracker(req.beatModel) }).then((mix) => {
        post({ type: 'log', message: `the mix was analyzed before its stems were ready: ${mix.clock}` });
        return { signal, mix };
      });
      // A failure is reported when the parts are asked for.
      mixed.catch(() => {});
      return;
    }
    if (req.type === 'parts') {
      if (!mixed) throw new Error('the song itself was not analyzed first');
      const { signal, mix } = await mixed;
      // Its own clock: the time spent waiting for the stems is not the analysis'.
      const result = await analyzeParts(signal, { ...mix, clock: new Stopwatch() }, { ...report, ...stemOptions(req) });
      return post({ type: 'done', result });
    }
    if (req.type !== 'analyze') return;
    const result = await analyzeSignal(req.signal, {
      ...report,
      ...stemOptions(req),
      beatTracker: req.beatModel && beatTracker(req.beatModel),
    });
    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};

const stemOptions = (req: StemInputs) => ({ lines: req.lines, drumSignal: req.drumSignal, stems: req.stems, stemNotes: req.stemNotes });
