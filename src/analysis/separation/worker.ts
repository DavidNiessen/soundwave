/// <reference lib="webworker" />
import * as ort from 'onnxruntime-web/webgpu';
import { proxyWorkerFetch } from '../../app/workerFetch';
import { transcribeOnnx } from '../pitch/basicPitchOnnx';
import { nativeSession, PITCH_MODEL } from '../native';
import { GpuReader, loadRuntime, nudgeCollector, openOnDevice, runtimeMemory } from '../runtime';
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
      /** How much the segments overlap, when not the usual (see OVERLAP; development only). */
      overlap?: number;
      /** Whether analyzing is held as it starts (see analysis/hold.ts); `hold` messages say when that changes. */
      held?: boolean;
    }
  | { type: 'hold'; on: boolean }
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

/** The stem model run on one segment: its two outputs, valid until `done` is called or the next run starts. */
interface Network {
  run(x: Float32Array, xt: Float32Array): Promise<{ x: ort.Tensor; xt: ort.Tensor; done(): void }>;
  release(): Promise<void>;
}

/** A session run the usual way: the inputs are uploaded and every operator dispatched for each segment. */
function sessionNetwork(session: ort.InferenceSession): Network {
  return {
    async run(x, xt) {
      const out = await session.run({
        x: new ort.Tensor('float32', x, [1, 4, BINS, FRAMES]),
        xt: new ort.Tensor('float32', xt, [1, 2, SEGMENT]),
      });
      return {
        x: out.x_out,
        xt: out.xt_out,
        done: () => {
          out.x_out.dispose();
          out.xt_out.dispose();
        },
      };
    },
    release: () => session.release(),
  };
}

/** WebGPU, as far as running the captured model needs it. */
interface Card {
  createBuffer(d: { size: number; usage: number }): { destroy(): void };
  queue: { writeBuffer(buffer: unknown, offset: number, data: Float32Array): void };
}
/** GPUBufferUsage.STORAGE | COPY_DST | COPY_SRC. */
const BOUND = 0x80 | 0x08 | 0x04;
/** An ONNX model of one Identity node (float [1] in, float [1] out), 79 bytes. */
const FIRST_SESSION = Uint8Array.from(
  atob('CAgSCXNvdW5kd2F2ZTo6ChAKAWESAWIiCElkZW50aXR5EgR3YXJtWg8KAWESCgoICAESBAoCCAFiDwoBYhIKCggIARIECgIIAUIECgAQEQ=='),
  (c) => c.charCodeAt(0),
);

/**
 * The stem model on a graphics card, recorded once and replayed for every segment (the runtime's
 * graph capture), into input and output buffers of its own that every segment reuses. Dispatching
 * its 3,500 operators one by one kept this worker's thread busy about 56 ms a segment, during which
 * the card waited; a replay takes 3 ms, and gives exactly the same numbers. Each output must be
 * copied out (see GpuReader.stageParts) before the next segment runs. Two runs on silence record
 * and replay it: a card or runtime that cannot fails there, and the model is then run as usual.
 */
async function capturedNetwork(model: LoadedModel): Promise<Network> {
  const entry = model.files.find((f) => f.name === model.entry)!;
  // The first session a runtime opens on the card cannot replay its recording (ONNX Runtime Web
  // 1.31: its second run fails setting up the bound buffers); any later one can. A one-node model
  // opened and closed first takes that place.
  await (await ort.InferenceSession.create(FIRST_SESSION, { executionProviders: ['webgpu'] })).release();
  const session = await ort.InferenceSession.create(new Uint8Array(entry.data), {
    executionProviders: [{ name: 'webgpu', storageBufferCacheMode: 'simple' }],
    enableGraphCapture: true,
    externalData: model.files.filter((f) => f !== entry).map((f) => ({ path: f.name, data: new Uint8Array(f.data) })),
  });
  const card = (await ort.env.webgpu.device) as unknown as Card;
  const buffers: { destroy(): void }[] = [];
  const bound = (dims: number[]) => {
    const buffer = card.createBuffer({ size: dims.reduce((n, d) => n * d, 4), usage: BOUND });
    buffers.push(buffer);
    return { buffer, tensor: ort.Tensor.fromGpuBuffer(buffer as never, { dataType: 'float32', dims }) };
  };
  const x = bound([1, 4, BINS, FRAMES]);
  const xt = bound([1, 2, SEGMENT]);
  const xOut = bound([1, 16, BINS, FRAMES]);
  const xtOut = bound([1, 8, SEGMENT]);
  const network: Network = {
    async run(xIn, xtIn) {
      // Copied as they are queued: the caller may reuse its arrays at once.
      card.queue.writeBuffer(x.buffer, 0, xIn);
      card.queue.writeBuffer(xt.buffer, 0, xtIn);
      await session.run({ x: x.tensor, xt: xt.tensor }, { x_out: xOut.tensor, xt_out: xtOut.tensor });
      return { x: xOut.tensor, xt: xtOut.tensor, done: () => {} };
    },
    async release() {
      await session.release();
      for (const b of buffers) b.destroy();
    },
  };
  try {
    // Twice: the first run records, the second replays.
    const silence = [new Float32Array(4 * BINS * FRAMES), new Float32Array(2 * SEGMENT)] as const;
    for (let i = 0; i < 2; i++) await network.run(...silence);
  } catch (err) {
    await network.release().catch(() => {});
    throw err;
  }
  return network;
}

/** The stem model on `provider`: replayed on a graphics card where it can be (see capturedNetwork). */
async function openNetwork(model: LoadedModel, provider: 'webgpu' | 'wasm'): Promise<Network> {
  if (provider === 'webgpu') {
    try {
      return await capturedNetwork(model);
    } catch (err) {
      post({ type: 'log', message: `the graphics card could not replay the stem model (${(err as Error).message}); running it as usual` });
    }
  }
  return sessionNetwork(await openSession(model, provider));
}

function runner(network: Network, reader: GpuReader | null): SegmentModel {
  return {
    async run(x, xt) {
      const out = await network.run(x, xt);
      // The reader's arrays are reused by the next segment, which separate() starts only after it
      // has used these (see SegmentModel).
      const result = reader
        ? { x: await reader.read('x', out.x), xt: await reader.read('xt', out.xt) }
        : { x: (await out.x.getData()) as Float32Array, xt: (await out.xt.getData()) as Float32Array };
      out.done();
      nudgeCollector();
      return result;
    },
  };
}

/**
 * The same as runner, writing each pair of stems' share of the output where the helpers want it.
 * On a graphics card the share is only queued for reading when it resolves (see PairModel).
 */
function pairRunner(network: Network, reader: GpuReader | null): PairModel {
  let slot = 0;
  return async (x, xt, outs) => {
    const out = await network.run(x, xt);
    let collect = async () => {};
    if (reader) {
      // Two sets of staging buffers: one is read while the next segment's output is copied to the other.
      slot ^= 1;
      collect = reader.stageParts(
        outs.flatMap((o, p) => [
          { key: `x${p}:${slot}`, tensor: out.x, from: p * PAIR_PLANES, into: o.x },
          { key: `xt${p}:${slot}`, tensor: out.xt, from: p * PAIR_CHANNELS, into: o.xt },
        ]),
      );
    } else {
      const whole = { x: (await out.x.getData()) as Float32Array, xt: (await out.xt.getData()) as Float32Array };
      outs.forEach((o, p) => {
        const share = pairOutput(whole, p);
        o.x.set(share.x);
        o.xt.set(share.xt);
      });
    }
    out.done();
    nudgeCollector();
    return collect;
  };
}

/** Whether analyzing is held (see analysis/hold.ts), and what lets the separation go on. */
let held = false;
let resume: (() => void) | null = null;
const free = () => (held ? new Promise<void>((resolve) => (resume = resolve)) : Promise.resolve());

/** The request's segments, with the helpers when the page started them, else all on this thread. */
function separateSegments(
  req: Extract<SeparationRequest, { type: 'separate' }>,
  network: Network,
  reader: GpuReader | null,
  onProgress: (p: number) => void,
): Promise<StemPart> {
  held = !!req.held;
  if (req.helpers?.length === HELPERS)
    return separateWithHelpers(
      req.left,
      req.right,
      pairRunner(network, reader),
      req.first,
      req.count,
      req.helpers,
      onProgress,
      req.overlap,
      free,
    );
  return separatePart(req.left, req.right, runner(network, reader), req.first, req.count, onProgress, undefined, req.overlap, free);
}

// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m, transfer) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer));

self.onmessage = async (e: MessageEvent<SeparationRequest>) => {
  if (fetched(e.data)) return;
  const req = e.data;
  if (req.type === 'hold') {
    held = req.on;
    if (!held) resume?.();
    return;
  }
  if (req.type === 'transcribe') return transcribeStems(req.stems, req.pitchModelUrl, req.device);
  if (req.device === 'native') return separateInApp(req);
  try {
    await loadRuntime(ort, req.device);
    if (req.first === 0) post({ type: 'progress', progress: 0, step: 'Loading the stem model' });
    const opened = performance.now();
    const { value: network, device } = await openOnDevice(
      req.device,
      (provider) => openNetwork(req.model!, provider),
      (err) => post({ type: 'log', message: `the graphics card could not load the stem model (${err.message}); using the processor` }),
    );
    post({
      type: 'log',
      message: `stem model on ${device} loaded in ${Math.round(performance.now() - opened)} ms, runtime memory ${runtimeMemory()} MB`,
    });
    // The runtime holds its own copy now: the file's 90 MB need not stay for the whole song.
    req.model = undefined;

    const reader = device === 'gpu' ? new GpuReader(await ort.env.webgpu.device) : null;
    const seconds = (req.left.length / 44100).toFixed(0);
    const started = performance.now();
    const part = await separateSegments(req, network, reader, (p) =>
      post({ type: 'progress', progress: p * share, step: 'Separating stems' }),
    );
    const took = performance.now() - started;
    post({
      type: 'log',
      message: `separated ${seconds} s on ${device} in ${Math.round(took)} ms (${req.count} segments, ${Math.round(took / req.count)} ms each${req.helpers ? ', with helpers' : ''}), runtime memory ${runtimeMemory()} MB`,
    });
    reader?.release();
    await network.release();
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
    const part = await separateSegments(req, sessionNetwork(session), null, (p) => {
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
        message: `transcribed ${name} on ${device} in ${Math.round(t.modelMs + t.notesMs)} ms (${Math.round(t.notesMs)} ms of it decoding notes), runtime memory ${runtimeMemory()} MB`,
      });
    }
    await transcriber.release();
    if (device === 'gpu') await letGoOfGpu();
    post({ type: 'done', notes, device });
  } catch (err) {
    post({ type: 'error', message: (err as Error).message || String(err) });
  }
}
