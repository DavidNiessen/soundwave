import { loadSongBuffer } from '../../audio/songAudio';
import { serveWorkerFetch } from '../../app/workerFetch';
import { wavBytes } from '../../audio/wav';
import { ANALYSIS_SAMPLE_RATE, STEM_NAMES, type StemName, type StemNotes } from '../types';
import { stemModel } from './model';
import { MODEL_RATE } from './separate';
import { analysisDevice } from './support';
import type { SeparationRequest, SeparationResponse } from './worker';

/** What separating a song gives the rest of the analysis. */
export interface StemResult {
  /** Each stem as WAV bytes (mono, 16-bit, at the analysis rate), also kept for listening. */
  stems: Record<StemName, ArrayBuffer>;
  /** What the transcriber heard in the bass, vocal and instrument stems. */
  notes: StemNotes;
}

/** `download` marks progress of fetching the model, which comes before the song's own work. */
export type StemAnalyzer = (
  songId: string,
  onProgress: (p: number, label: string, download?: boolean) => void,
  signal: AbortSignal,
) => Promise<StemResult>;

const abortError = () => new DOMException('analysis cancelled', 'AbortError');

/** A stem at the model's rate, mono, brought to the analysis rate by the browser's resampler. */
async function toAnalysisRate(stem: Float32Array): Promise<Float32Array> {
  const buffer = new AudioBuffer({ length: stem.length, numberOfChannels: 1, sampleRate: MODEL_RATE });
  buffer.copyToChannel(stem as Float32Array<ArrayBuffer>, 0);
  const ctx = new OfflineAudioContext(1, Math.ceil((stem.length * ANALYSIS_SAMPLE_RATE) / MODEL_RATE), ANALYSIS_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** The song in stereo at the model's rate. */
async function modelInput(buffer: AudioBuffer): Promise<[Float32Array, Float32Array]> {
  const ctx = new OfflineAudioContext(2, Math.ceil(buffer.duration * MODEL_RATE), MODEL_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

/**
 * Separates a song into drums, bass, vocals and the other instruments with the stem model, and
 * transcribes the pitched stems. It downloads the model first when it is not on this device yet.
 */
export const stemAnalyzer: StemAnalyzer = async (songId, onProgress, signal) => {
  const device = await analysisDevice();
  if (device === 'none')
    throw new Error('Analyzing is switched off on this device (the development switch). Charts can still be made by hand.');

  if (stemModel.snapshot().state !== 'ready') {
    const report = () => {
      const s = stemModel.snapshot();
      if (s.state === 'downloading') onProgress(s.received / s.total, 'Downloading the analysis model', true);
    };
    report();
    const stop = stemModel.subscribe(report);
    try {
      await stemModel.ensure();
    } finally {
      stop();
    }
  }
  if (signal.aborted) throw abortError();

  onProgress(0, 'Decoding');
  const [left, right] = await modelInput(await loadSongBuffer(songId));
  const model = await stemModel.load();
  if (signal.aborted) throw abortError();

  return new Promise<StemResult>((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const wavs = {} as Record<StemName, ArrayBuffer>;
    const stop = () => {
      worker.terminate();
      reject(abortError());
    };
    signal.addEventListener('abort', stop, { once: true });
    const end = () => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
    };
    worker.onmessage = (e: MessageEvent<SeparationResponse>) => {
      // The worker's fetches, where it cannot make them itself (see app/workerFetch).
      if (serveWorkerFetch(worker, e.data)) return;
      const m = e.data;
      if (m.type === 'progress') onProgress(m.progress, m.step);
      else if (m.type === 'log') console.info('[analysis]', m.message);
      else if (m.type === 'separated') {
        void (async () => {
          try {
            const rated = {} as Record<StemName, Float32Array>;
            for (const name of STEM_NAMES) rated[name] = await toAnalysisRate(m.stems[name]);
            for (const name of STEM_NAMES) wavs[name] = wavBytes(rated[name], ANALYSIS_SAMPLE_RATE);
            const pitched = { bass: rated.bass, vocals: rated.vocals, other: rated.other };
            const next: SeparationRequest = { type: 'transcribe', stems: pitched };
            worker.postMessage(
              next,
              Object.values(pitched).map((s) => s.buffer),
            );
          } catch (err) {
            end();
            reject(new Error(`The stems could not be prepared (${(err as Error).message}).`));
          }
        })();
      } else {
        end();
        if (m.type === 'error') return reject(new Error(`The song could not be separated into stems (${m.message}).`));
        resolve({ stems: wavs, notes: m.notes });
      }
    };
    worker.onerror = (e) => {
      end();
      reject(new Error(`The song could not be separated into stems (${e.message || 'the analysis stopped unexpectedly'}).`));
    };
    const req: SeparationRequest = {
      type: 'separate',
      left,
      right,
      model,
      device,
      pitchModelUrl: new URL(`${import.meta.env.BASE_URL}models/basic-pitch/nmp.onnx`, location.href).href,
    };
    worker.postMessage(req, [left.buffer, right.buffer, ...model.files.map((f) => f.data)]);
  });
};
