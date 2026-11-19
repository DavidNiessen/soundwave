/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { proxyWorkerFetch } from '../../app/workerFetch';
import { transcribeOnnx } from '../pitch/basicPitchOnnx';
import { loadRuntime } from '../runtime';
import type { StemName, StemNotes } from '../types';
import type { LoadedModel } from './model';
import { MODEL_STEMS, separate, type SegmentModel } from './separate';
import { BINS, FRAMES, SEGMENT } from './stft';

/**
 * Two steps: the song is separated and its stems handed back at the model's rate; the page brings
 * them to the analysis rate (the browser's own resampler is far faster than any done here) and
 * hands the pitched ones back for transcription.
 */
export type SeparationRequest =
  | {
      type: 'separate';
      /** The song in stereo at 44.1 kHz. */
      left: Float32Array;
      right: Float32Array;
      model: LoadedModel;
      device: 'gpu' | 'cpu';
      pitchModelUrl: string;
    }
  | { type: 'transcribe'; stems: Record<'bass' | 'vocals' | 'other', Float32Array> };

export type SeparationResponse =
  | { type: 'progress'; progress: number; step: string }
  | { type: 'log'; message: string }
  /** Each stem in mono at 44.1 kHz. */
  | { type: 'separated'; stems: Record<StemName, Float32Array> }
  | { type: 'done'; notes: StemNotes; device: 'gpu' | 'cpu' }
  | { type: 'error'; message: string };

const post = (m: SeparationResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** The transcription model (Basic Pitch, 230 KB) on the same device as the stem model. */
async function openPitchSession(url: string, device: 'gpu' | 'cpu'): Promise<ort.InferenceSession> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  try {
    // Its few shape operations run on the processor by design; the runtime would warn about that.
    return await ort.InferenceSession.create(bytes, { executionProviders: [device === 'gpu' ? 'webgpu' : 'wasm'], logSeverityLevel: 3 });
  } catch (err) {
    if (device !== 'gpu') throw err;
    post({
      type: 'log',
      message: `the graphics card could not load the transcription model (${(err as Error).message}); using the processor`,
    });
    return ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], logSeverityLevel: 3 });
  }
}

async function openSession(model: LoadedModel, provider: 'webgpu' | 'wasm'): Promise<ort.InferenceSession> {
  const entry = model.files.find((f) => f.name === model.entry)!;
  return ort.InferenceSession.create(new Uint8Array(entry.data), {
    executionProviders: [provider],
    externalData: model.files.filter((f) => f !== entry).map((f) => ({ path: f.name, data: new Uint8Array(f.data) })),
  });
}

function runner(session: ort.InferenceSession): SegmentModel {
  return {
    async run(x, xt) {
      const out = await session.run({
        x: new ort.Tensor('float32', x, [1, 4, BINS, FRAMES]),
        xt: new ort.Tensor('float32', xt, [1, 2, SEGMENT]),
      });
      const result = { x: (await out.x_out.getData()) as Float32Array, xt: (await out.xt_out.getData()) as Float32Array };
      out.x_out.dispose();
      out.xt_out.dispose();
      return result;
    },
  };
}

/** Set by the separation step for the transcription step. */
let pitch: { url: string; device: 'gpu' | 'cpu' } | null = null;

// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m));

self.onmessage = async (e: MessageEvent<SeparationRequest>) => {
  if (fetched(e.data)) return;
  const req = e.data;
  if (req.type === 'transcribe') return transcribeStems(req.stems);
  try {
    await loadRuntime(ort, req.device);
    post({ type: 'progress', progress: 0, step: 'Loading the stem model' });
    let device = req.device;
    let session: ort.InferenceSession;
    const opened = performance.now();
    try {
      session = await openSession(req.model, device === 'gpu' ? 'webgpu' : 'wasm');
    } catch (err) {
      if (device !== 'gpu') throw err;
      post({ type: 'log', message: `the graphics card could not load the stem model (${(err as Error).message}); using the processor` });
      device = 'cpu';
      session = await openSession(req.model, 'wasm');
    }
    post({ type: 'log', message: `stem model on ${device} loaded in ${Math.round(performance.now() - opened)} ms` });

    const started = performance.now();
    const full = await separate(req.left, req.right, runner(session), (p) =>
      post({ type: 'progress', progress: p * share, step: 'Separating stems' }),
    );
    await session.release();
    post({ type: 'log', message: `separated ${(req.left.length / 44100).toFixed(0)} s in ${Math.round(performance.now() - started)} ms` });

    const stems = {} as Record<StemName, Float32Array>;
    MODEL_STEMS.forEach((name, i) => (stems[name] = full[i]));
    pitch = { url: req.pitchModelUrl, device };
    post(
      { type: 'separated', stems },
      full.map((s) => s.buffer),
    );
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};

/** Separation is nearly all of the work, on a graphics card and on a processor alike. */
const share = 0.9;

async function transcribeStems(stems: Record<'bass' | 'vocals' | 'other', Float32Array>) {
  try {
    const { url, device } = pitch!;
    const notes = {} as StemNotes;
    const pitched = ['bass', 'vocals', 'other'] as const;
    const transcriber = await openPitchSession(url, device);
    for (const [i, name] of pitched.entries()) {
      const at = share + ((1 - share) * i) / pitched.length;
      const label = name === 'other' ? 'Transcribing instruments' : `Transcribing ${name}`;
      post({ type: 'progress', progress: at, step: label });
      const t = await transcribeOnnx(ort, transcriber, stems[name], (p) =>
        post({ type: 'progress', progress: at + ((1 - share) * p) / pitched.length, step: label }),
      );
      notes[name] = t.notes;
      post({
        type: 'log',
        message: `transcribed ${name} on ${device} in ${Math.round(t.modelMs + t.notesMs)} ms (${Math.round(t.notesMs)} ms of it decoding notes)`,
      });
    }
    await transcriber.release();
    post({ type: 'done', notes, device });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
}
