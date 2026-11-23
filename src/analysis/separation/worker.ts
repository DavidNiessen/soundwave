/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { proxyWorkerFetch } from '../../app/workerFetch';
import { transcribeOnnx } from '../pitch/basicPitchOnnx';
import { nativeSession, PITCH_MODEL } from '../native';
import { GpuReader, loadRuntime, nudgeCollector, openOnDevice } from '../runtime';
import type { StemNotes } from '../types';
import type { LoadedModel } from './model';
import { PAIR_CHANNELS, PAIR_PLANES, pairOutput, separatePart, type SegmentModel, type StemPart } from './separate';
import { BINS, FRAMES, SEGMENT } from './stft';
import { HELPERS, separateWithHelpers, type PairModel } from './transform';

/**
 * Two kinds of work, each in a worker of its own. Separating: the stem model is run on a run of the
 * song's segments, and what they add to the stems is handed back at the model's rate (the page puts
 * the runs together, see analyzer.ts). Transcribing: the page brings the stems to the analysis rate
 * (the browser's own resampler is far faster than any done here) and hands the pitched ones over.
 */
/** Where a model runs: the graphics card or processor in the browser, or the app (analysis/native.ts). */
export type ModelDevice = 'gpu' | 'cpu' | 'native';

export type SeparationRequest =
  | {
      type: 'separate';
      /** The song in stereo at 44.1 kHz. */
      left: Float32Array;
      right: Float32Array;
      /** The model, for the browser's runtime; the app keeps its own copy (see analysis/native.ts). */
      model?: LoadedModel;
      /** The key and file the app keeps the model under, when it runs it. */
      native?: { key: string; entry: string };
      device: ModelDevice;
      /** The segments to run (see segmentOffsets). */
      first: number;
      count: number;
      /** Ports to the helpers that do the work around the model (see transform.ts), when there are. */
      helpers?: MessagePort[];
    }
  | {
      type: 'transcribe';
      stems: Record<'bass' | 'vocals' | 'other', Float32Array>;
      device: ModelDevice;
      pitchModelUrl: string;
    };

export type SeparationResponse =
  | { type: 'progress'; progress: number; step: string }
  | { type: 'log'; message: string }
  /** What the segments add to the stems, and where the model ran. */
  | { type: 'part'; part: StemPart; device: ModelDevice }
  | { type: 'done'; notes: StemNotes; device: ModelDevice }
  | { type: 'error'; message: string };

const post = (m: SeparationResponse, transfer: Transferable[] = []) => (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** The transcription model (Basic Pitch, 230 KB) on the same device as the stem model. */
async function openPitchSession(url: string, device: 'gpu' | 'cpu'): Promise<ort.InferenceSession> {
  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const opened = await openOnDevice(
    device,
    // Its few shape operations run on the processor by design; the runtime would warn about that.
    (provider) => ort.InferenceSession.create(bytes, { executionProviders: [provider], logSeverityLevel: 3 }),
    (err) =>
      post({ type: 'log', message: `the graphics card could not load the transcription model (${err.message}); using the processor` }),
  );
  return opened.value;
}

async function openSession(model: LoadedModel, provider: 'webgpu' | 'wasm'): Promise<ort.InferenceSession> {
  const entry = model.files.find((f) => f.name === model.entry)!;
  return ort.InferenceSession.create(new Uint8Array(entry.data), {
    // On the graphics card the runtime keeps each buffer it made for reuse at exactly its size: the
    // model's shapes never change, so a song's segments use the same buffers over and over. Its
    // default ('bucket') makes the largest ones anew for every segment and leaves them to the garbage
    // collector, about 700 MB a segment, which WebKit charges to the page until it collects them.
    // The outputs stay there too and are read back by the runner (see GpuReader).
    executionProviders: [provider === 'webgpu' ? { name: 'webgpu', storageBufferCacheMode: 'simple' } : provider],
    ...(provider === 'webgpu' ? { preferredOutputLocation: 'gpu-buffer' as const } : {}),
    externalData: model.files.filter((f) => f !== entry).map((f) => ({ path: f.name, data: new Uint8Array(f.data) })),
  });
}

function runner(session: ort.InferenceSession, reader: GpuReader | null): SegmentModel {
  return {
    async run(x, xt) {
      const out = await session.run({
        x: new ort.Tensor('float32', x, [1, 4, BINS, FRAMES]),
        xt: new ort.Tensor('float32', xt, [1, 2, SEGMENT]),
      });
      // The reader's arrays are reused by the next segment, which separate() starts only after it
      // has used these (see SegmentModel).
      const result = reader
        ? { x: await reader.read('x', out.x_out), xt: await reader.read('xt', out.xt_out) }
        : { x: (await out.x_out.getData()) as Float32Array, xt: (await out.xt_out.getData()) as Float32Array };
      out.x_out.dispose();
      out.xt_out.dispose();
      nudgeCollector();
      return result;
    },
  };
}

/**
 * The same as runner, writing each pair of stems' share of the output where the helpers want it.
 * On a graphics card the share is only queued for reading when it resolves (see PairModel).
 */
function pairRunner(session: ort.InferenceSession, reader: GpuReader | null): PairModel {
  let slot = 0;
  return async (x, xt, outs) => {
    const out = await session.run({
      x: new ort.Tensor('float32', x, [1, 4, BINS, FRAMES]),
      xt: new ort.Tensor('float32', xt, [1, 2, SEGMENT]),
    });
    let collect = async () => {};
    if (reader) {
      // Two sets of staging buffers: one is read while the next segment's output is copied to the other.
      slot ^= 1;
      collect = reader.stageParts(
        outs.flatMap((o, p) => [
          { key: `x${p}:${slot}`, tensor: out.x_out, from: p * PAIR_PLANES, into: o.x },
          { key: `xt${p}:${slot}`, tensor: out.xt_out, from: p * PAIR_CHANNELS, into: o.xt },
        ]),
      );
    } else {
      const whole = { x: (await out.x_out.getData()) as Float32Array, xt: (await out.xt_out.getData()) as Float32Array };
      outs.forEach((o, p) => {
        const share = pairOutput(whole, p);
        o.x.set(share.x);
        o.xt.set(share.xt);
      });
    }
    out.x_out.dispose();
    out.xt_out.dispose();
    nudgeCollector();
    return collect;
  };
}

/** The request's segments, with the helpers when the page started them, else all on this thread. */
function separateSegments(
  req: Extract<SeparationRequest, { type: 'separate' }>,
  session: ort.InferenceSession,
  reader: GpuReader | null,
  onProgress: (p: number) => void,
): Promise<StemPart> {
  if (req.helpers?.length === HELPERS)
    return separateWithHelpers(req.left, req.right, pairRunner(session, reader), req.first, req.count, req.helpers, onProgress);
  return separatePart(req.left, req.right, runner(session, reader), req.first, req.count, onProgress);
}

// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m, transfer) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer));

self.onmessage = async (e: MessageEvent<SeparationRequest>) => {
  if (fetched(e.data)) return;
  const req = e.data;
  if (req.type === 'transcribe') return transcribeStems(req.stems, req.pitchModelUrl, req.device);
  if (req.device === 'native') return separateInApp(req);
  try {
    await loadRuntime(ort, req.device);
    if (req.first === 0) post({ type: 'progress', progress: 0, step: 'Loading the stem model' });
    const opened = performance.now();
    const { value: session, device } = await openOnDevice(
      req.device,
      (provider) => openSession(req.model!, provider),
      (err) => post({ type: 'log', message: `the graphics card could not load the stem model (${err.message}); using the processor` }),
    );
    post({ type: 'log', message: `stem model on ${device} loaded in ${Math.round(performance.now() - opened)} ms` });

    const reader = device === 'gpu' ? new GpuReader(await ort.env.webgpu.device) : null;
    const seconds = (req.left.length / 44100).toFixed(0);
    const started = performance.now();
    const part = await separateSegments(req, session, reader, (p) =>
      post({ type: 'progress', progress: p * share, step: 'Separating stems' }),
    );
    const took = performance.now() - started;
    post({
      type: 'log',
      message: `separated ${seconds} s on ${device} in ${Math.round(took)} ms (${req.count} segments, ${Math.round(took / req.count)} ms each${req.helpers ? ', with helpers' : ''})`,
    });
    reader?.release();
    await session.release();
    if (device === 'gpu') await letGoOfGpu();
    post({ type: 'part', part, device }, [...part.sums.map((s) => s.buffer), part.weights.buffer]);
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
};

/** Separating with the stem model the app runs (see analysis/native.ts). */
async function separateInApp(req: Extract<SeparationRequest, { type: 'separate' }>) {
  try {
    if (req.first === 0) post({ type: 'progress', progress: 0, step: 'Loading the stem model' });
    const { session, device } = nativeSession(req.native!.key, req.native!.entry);
    const seconds = (req.left.length / 44100).toFixed(0);
    const started = performance.now();
    let opened = false;
    const part = await separateSegments(req, session, null, (p) => {
      if (!opened) {
        opened = true;
        post({
          type: 'log',
          message: `stem model in the app (${device()}), first segment in ${Math.round(performance.now() - started)} ms`,
        });
      }
      post({ type: 'progress', progress: p * share, step: 'Separating stems' });
    });
    await session.release();
    post({
      type: 'log',
      message: `separated ${seconds} s in the app in ${Math.round(performance.now() - started)} ms${req.helpers ? ' (with helpers)' : ''}`,
    });
    post({ type: 'part', part, device: 'native' }, [...part.sums.map((s) => s.buffer), part.weights.buffer]);
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
}

/**
 * Destroys the graphics card device the runtime worked on. Everything made on it is freed at once:
 * WebKit (Safari, the macOS app) otherwise holds a finished worker's GPU memory for a good while
 * after the worker has ended, and the next round's would come on top of it.
 */
async function letGoOfGpu() {
  try {
    (await ort.env.webgpu.device).destroy();
  } catch {
    /* no device was made */
  }
}

/** Separation is nearly all of the work, on a graphics card and on a processor alike. */
const share = 0.9;

async function transcribeStems(stems: Record<'bass' | 'vocals' | 'other', Float32Array>, url: string, device: ModelDevice) {
  try {
    if (device !== 'native') await loadRuntime(ort, device);
    const notes = {} as StemNotes;
    const pitched = ['bass', 'vocals', 'other'] as const;
    const transcriber =
      device === 'native' ? nativeSession(PITCH_MODEL.key, PITCH_MODEL.entry).session : await openPitchSession(url, device);
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
    if (device === 'gpu') await letGoOfGpu();
    post({ type: 'done', notes, device });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
}
