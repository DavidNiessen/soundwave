/**
 * The analysis models run by the desktop app itself (src-tauri/src/models.rs), where the webview's
 * own way would fail or crawl: in WebKit (the macOS app, and Linux) WebGPU keeps gigabytes for every
 * song it separates until WebKit closes the page, and without it the browser runtime gets no
 * threads there. The app runs them in its own process, with Core ML on a Mac.
 *
 * The page keeps doing everything around the models; only each model run goes to the app, on its
 * `swmodel` scheme. `nativeSession` looks like the part of ONNX Runtime's InferenceSession the
 * analysis uses, so the same code runs a model here or in the browser.
 */
import type * as Ort from 'onnxruntime-web/webgpu';

/** Where the app answers: its own scheme, written the way each system's webview takes it. */
export const MODELS_URL =
  typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent) ? 'http://swmodel.localhost' : 'swmodel://localhost';

interface NamedTensor {
  name: string;
  dims: readonly number[];
  data: Float32Array;
}

/** The tensors as the app takes them (see read_tensors in models.rs). */
export function encodeTensors(tensors: readonly NamedTensor[]): ArrayBuffer {
  const names = tensors.map((t) => new TextEncoder().encode(t.name));
  let size = 4;
  tensors.forEach((t, i) => (size += 4 + names[i].length + 4 + t.dims.length * 8 + t.data.length * 4));
  const out = new ArrayBuffer(size);
  const view = new DataView(out);
  let at = 0;
  view.setUint32(at, tensors.length, true);
  at += 4;
  tensors.forEach((t, i) => {
    view.setUint32(at, names[i].length, true);
    new Uint8Array(out, at + 4, names[i].length).set(names[i]);
    at += 4 + names[i].length;
    view.setUint32(at, t.dims.length, true);
    at += 4;
    for (const d of t.dims) {
      view.setBigInt64(at, BigInt(d), true);
      at += 8;
    }
    // The values may sit at any byte: copied through a view of their own.
    new Uint8Array(out, at, t.data.length * 4).set(new Uint8Array(t.data.buffer, t.data.byteOffset, t.data.length * 4));
    at += t.data.length * 4;
  });
  return out;
}

/** The app's answer back into tensors. */
export function decodeTensors(body: ArrayBuffer): NamedTensor[] {
  const view = new DataView(body);
  let at = 0;
  const count = view.getUint32(at, true);
  at += 4;
  const tensors: NamedTensor[] = [];
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(at, true);
    const name = new TextDecoder().decode(new Uint8Array(body, at + 4, len));
    at += 4 + len;
    const ndims = view.getUint32(at, true);
    at += 4;
    const dims: number[] = [];
    for (let d = 0; d < ndims; d++, at += 8) dims.push(Number(view.getBigInt64(at, true)));
    const size = dims.reduce((n, d) => n * d, 1);
    const data = new Float32Array(size);
    new Uint8Array(data.buffer).set(new Uint8Array(body, at, size * 4));
    at += size * 4;
    tensors.push({ name, dims, data });
  }
  return tensors;
}

async function ask(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(`${MODELS_URL}${path}`, init);
  if (res.ok) return res;
  let message = `${res.status}`;
  try {
    message = ((await res.json()) as { error?: string }).error ?? message;
  } catch {
    /* no explanation sent */
  }
  throw new Error(message);
}

/**
 * Hands a model's files to the app, once: it keeps them under `key` (which must change whenever the
 * model does). `files` gives each file's bytes when they are needed.
 */
export async function storeModel(key: string, names: readonly string[], files: () => Promise<{ name: string; data: ArrayBuffer }[]>) {
  const { has } = (await (await ask(`/has?model=${key}&files=${names.join(',')}`)).json()) as { has: boolean };
  if (has) return;
  for (const file of await files()) await ask(`/store?model=${key}&file=${file.name}`, { method: 'POST', body: file.data });
}

/** Hands a model the app keeps under `key` the tensors to run on, and answers with its outputs. */
async function run(key: string, entry: string, tensors: readonly NamedTensor[]): Promise<{ outputs: NamedTensor[]; device: string }> {
  const res = await ask(`/run?model=${key}&entry=${entry}`, {
    method: 'POST',
    body: encodeTensors(tensors),
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  return { outputs: decodeTensors(await res.arrayBuffer()), device: res.headers.get('X-Model-Device') ?? 'app' };
}

/** What the app said it ran the model on last (Core ML or the processor), for the analysis log. */
export interface NativeSession {
  readonly session: Ort.InferenceSession;
  device(): string;
}

/**
 * A model the app runs, in the shape of an InferenceSession as far as the analysis uses one: `run`
 * with float tensors by name, outputs read with getData(), and `release`.
 */
export function nativeSession(key: string, entry: string): NativeSession {
  let device = 'app';
  const session = {
    async run(feeds: Record<string, Ort.Tensor>) {
      const tensors = Object.entries(feeds).map(([name, t]) => ({ name, dims: t.dims, data: t.data as Float32Array }));
      const answer = await run(key, entry, tensors);
      device = answer.device;
      const outputs: Record<string, { dims: readonly number[]; data: Float32Array; getData(): Promise<Float32Array>; dispose(): void }> =
        {};
      for (const t of answer.outputs) outputs[t.name] = { dims: t.dims, data: t.data, getData: async () => t.data, dispose() {} };
      return outputs;
    },
    async release() {
      await ask(`/release?model=${key}`, { method: 'POST' }).catch(() => {});
    },
  };
  return { session: session as unknown as Ort.InferenceSession, device: () => device };
}

/**
 * The keys the app keeps the models under. The stem model's is its source's id; the two bundled
 * models' must change whenever their files in public/models do.
 */
export const PITCH_MODEL = { key: 'basic-pitch-nmp-1', entry: 'nmp.onnx' };
export const BEAT_MODEL = { key: 'beat-this-small0-1', entry: 'small0.onnx' };

/** Hands one of the game's bundled models (by its URL) to the app, once. */
export function storeBundledModel(model: { key: string; entry: string }, url: string) {
  return storeModel(model.key, [model.entry], async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the model ${model.entry} could not be loaded (${res.status})`);
    return [{ name: model.entry, data: await res.arrayBuffer() }];
  });
}
