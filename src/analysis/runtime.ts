import type * as Ort from 'onnxruntime-web/webgpu';
import { onWebKit } from './separation/support';

/**
 * The runtime's WebAssembly file, unpacked. A server may already have undone the compression on the
 * way (a gzip file sent as gzip-encoded), so the file's first bytes decide.
 */
async function fetchWasm(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`the analysis runtime could not be loaded (${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const unpacked = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(unpacked).arrayBuffer());
}

/** WebAssembly pages (64 KiB each) the runtime may grow to, largest first: 4, 2 and 1 GiB, then 512 MiB. */
export const MEMORY_MAXIMA = [65536, 32768, 16384, 8192];

/** The runtime's own memory: shared between its threads, and as large as its build allows (4 GiB). */
const MEMORY_CALL = 'new WebAssembly.Memory({initial:256,maximum:65536,shared:!0})';
/** What it tells its allocator it may grow to, in bytes (4 GiB less a page). */
const HEAP_MAX = 'function rc(){return 4294901760}';

/**
 * The runtime's script, made to ask for less memory when the browser will not give it 4 GiB.
 *
 * A shared memory cannot move once it is made, so the browser sets its whole maximum aside at once,
 * and iOS refuses 4 GiB ("RangeError: Out of memory") before any model is opened. The memory is now
 * asked for at each of MEMORY_MAXIMA in turn, and the allocator told the maximum it got. A smaller
 * memory is one the runtime's module accepts: its import only sets the largest it may be. Should a
 * newer runtime build its memory differently, the script is left as it is (`patched` false).
 */
export function fitMemory(script: string): { script: string; patched: boolean } {
  if (!script.includes(MEMORY_CALL) || !script.includes(HEAP_MAX)) return { script, patched: false };
  const prelude =
    `let __swHeapMax=4294901760;function __swMemory(){let last;for(const maximum of ${JSON.stringify(MEMORY_MAXIMA)}){` +
    `try{const m=new WebAssembly.Memory({initial:256,maximum,shared:!0});__swHeapMax=maximum*65536-65536;globalThis.__swRuntimeMemory=m;return m}` +
    `catch(e){if(!(e instanceof RangeError))throw e;last=e}}throw last}\n`;
  return {
    script: prelude + script.replace(MEMORY_CALL, '__swMemory()').replace(HEAP_MAX, 'function rc(){return __swHeapMax}'),
    patched: true,
  };
}

/**
 * Gets ONNX Runtime ready in a worker, before its first model is opened.
 *
 * The runtime's script and WebAssembly file are served next to the app (public/ort). The script
 * is handed over as a blob, because the runtime starts its threads from the script's own address:
 * from a blob that needs no request, and a request for an app file made by a thread of a worker
 * is never answered in the desktop app's window, and patched to fit its memory to the device (see
 * fitMemory). The WebAssembly file comes gzip-compressed (scripts/copy-models.mjs) and is handed
 * over unpacked.
 */
export async function loadRuntime(ort: typeof Ort, device: 'gpu' | 'cpu'): Promise<void> {
  const base = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.href).href;
  const [script, binary] = await Promise.all([
    fetch(`${base}ort-wasm-simd-threaded.asyncify.mjs`).then((r) => r.text()),
    fetchWasm(`${base}ort-wasm-simd-threaded.asyncify.wasm.gz`),
  ]);
  const fitted = fitMemory(script);
  if (!fitted.patched) console.warn('the analysis runtime builds its memory in a way not known here: it asks for 4 GiB as it is');
  ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([fitted.script], { type: 'text/javascript' })) };
  ort.env.wasm.wasmBinary = binary;
  // A graphics card does the arithmetic itself; threads are for the processor path.
  ort.env.wasm.numThreads = device === 'gpu' ? 1 : processorThreads();
  // A laptop with two graphics cards is given the faster one, not the one that saves power.
  if (device === 'gpu') ort.env.webgpu.powerPreference = 'high-performance';
  ort.env.logLevel = 'error';
}

/**
 * Threads for a model on the processor: every core but one, which the page keeps for itself. The
 * runtime's own default is half the cores and never more than four, which left a 16-thread
 * desktop separating a song in three minutes with most of its cores idle.
 */
export function processorThreads(cores = typeof navigator === 'undefined' ? 4 : navigator.hardwareConcurrency || 4): number {
  return Math.max(1, Math.min(16, cores - 1));
}

/**
 * How much memory the runtime of this worker holds, in MB (0 before it started). Its memory only
 * grows: what a model needed at its largest stays held until the worker ends.
 */
export function runtimeMemory(): number {
  const memory = (globalThis as { __swRuntimeMemory?: WebAssembly.Memory }).__swRuntimeMemory;
  return memory ? Math.round(memory.buffer.byteLength / 2 ** 20) : 0;
}

/**
 * Why the runtime failed, said plainly. Every build of it keeps its memory shared between threads,
 * which a browser only allows a page that is cross-origin isolated: when it is not, that is the
 * reason, whatever the runtime itself says.
 */
export function runtimeError(err: unknown): Error {
  const message = err instanceof Error ? err.message : String(err);
  if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated)
    return new Error(`this browser did not isolate the page, which the analysis needs for its shared memory; the runtime said: ${message}`);
  return err instanceof Error ? err : new Error(message);
}

/**
 * Opens a model on the graphics card, or on the processor when that fails. Should the processor fail
 * too, the first failure is the one reported: once the runtime has failed to start, a second try
 * only says that it did ("previous call to 'initWasm()' failed").
 */
export async function openOnDevice<T>(
  device: 'gpu' | 'cpu',
  open: (provider: 'webgpu' | 'wasm') => Promise<T>,
  onFallback: (err: Error) => void,
): Promise<{ value: T; device: 'gpu' | 'cpu' }> {
  try {
    return { value: await open(device === 'gpu' ? 'webgpu' : 'wasm'), device };
  } catch (err) {
    if (device !== 'gpu') throw runtimeError(err);
    onFallback(err as Error);
    try {
      return { value: await open('wasm'), device: 'cpu' };
    } catch {
      throw runtimeError(err);
    }
  }
}

/**
 * Lets the worker's garbage collector see how much it may free, after a model run.
 *
 * The runtime makes GPU buffers, bind groups and read-backs for every run and lets go of them, but
 * a browser frees what they hold only when the JavaScript objects standing for them are collected.
 * A worker's own JavaScript heap stays small, so its collector barely runs: in WebKit (Safari, the
 * macOS app) a song's separation piled up 15 GB and more that way, until the system closed the
 * game. Allocating a few large arrays and dropping them at once makes the collector run, and the
 * GPU memory and WebKit's bookkeeping for it are freed as the work goes. At most once a second.
 */
let nudged = 0;
/** Only WebKit needs the nudge; elsewhere it would only zero 256 MB every second. */
const nudges = onWebKit();
export function nudgeCollector() {
  if (!nudges) return;
  const now = performance.now();
  if (now - nudged < 1000) return;
  nudged = now;
  for (let i = 0; i < 8; i++) new Uint8Array(32 << 20)[0] = 1;
}

/** WebGPU, as far as reading a tensor back needs it. */
interface Gpu {
  createBuffer(d: { size: number; usage: number }): GpuBuffer;
  createCommandEncoder(): {
    copyBufferToBuffer(from: unknown, fromOffset: number, to: GpuBuffer, toOffset: number, size: number): void;
    finish(): unknown;
  };
  queue: { submit(buffers: unknown[]): void };
}
interface GpuBuffer {
  size: number;
  mapAsync(mode: number): Promise<void>;
  getMappedRange(): ArrayBuffer;
  unmap(): void;
  destroy(): void;
}
/** GPUBufferUsage.MAP_READ | COPY_DST, and GPUMapMode.READ. */
const MAP_READ = 0x0001;
const COPY_DST = 0x0008;
const READ = 0x0001;

/**
 * Reads tensors the runtime left on the graphics card (`preferredOutputLocation: 'gpu-buffer'`)
 * into arrays of its own, through one staging buffer per output kept for every run. The runtime's
 * own read-back makes a new staging buffer and a new array each time: for the stem model 55 MB a
 * segment, which WebKit holds until it collects them. The arrays returned are reused by the next
 * read of the same output, so they must be done with by then.
 */
export class GpuReader {
  private staging = new Map<string, GpuBuffer>();
  private arrays = new Map<string, Float32Array>();
  constructor(private readonly device: Gpu) {}

  async read(name: string, tensor: Ort.Tensor): Promise<Float32Array> {
    const bytes = tensor.size * 4;
    let staging = this.staging.get(name);
    if (!staging || staging.size !== bytes) {
      staging?.destroy();
      staging = this.device.createBuffer({ size: bytes, usage: MAP_READ | COPY_DST });
      this.staging.set(name, staging);
      this.arrays.set(name, new Float32Array(tensor.size));
    }
    const encoder = this.device.createCommandEncoder();
    encoder.copyBufferToBuffer(tensor.gpuBuffer, 0, staging, 0, bytes);
    this.device.queue.submit([encoder.finish()]);
    await staging.mapAsync(READ);
    const array = this.arrays.get(name)!;
    array.set(new Float32Array(staging.getMappedRange()));
    staging.unmap();
    return array;
  }

  /**
   * Copies stretches of tensors into staging buffers now, and gives back a function that reads them
   * into the caller's arrays: each part `into.length` values of `tensor` from value `from` on. The
   * copies are queued straight after the work that made the tensors, so the tensors may be let go
   * and the next run started before the function is called. Each `key` keeps its staging buffer
   * for the next time: a part still to be read must not share its key with one being staged.
   */
  stageParts(parts: { key: string; tensor: Ort.Tensor; from: number; into: Float32Array }[]): () => Promise<void> {
    const encoder = this.device.createCommandEncoder();
    const staged = parts.map((p) => {
      const bytes = p.into.length * 4;
      let staging = this.staging.get(p.key);
      if (!staging || staging.size !== bytes) {
        staging?.destroy();
        staging = this.device.createBuffer({ size: bytes, usage: MAP_READ | COPY_DST });
        this.staging.set(p.key, staging);
      }
      encoder.copyBufferToBuffer(p.tensor.gpuBuffer, p.from * 4, staging, 0, bytes);
      return staging;
    });
    this.device.queue.submit([encoder.finish()]);
    return async () => {
      await Promise.all(staged.map((s) => s.mapAsync(READ)));
      parts.forEach((p, i) => {
        p.into.set(new Float32Array(staged[i].getMappedRange()));
        staged[i].unmap();
      });
    };
  }

  release() {
    for (const b of this.staging.values()) b.destroy();
    this.staging.clear();
    this.arrays.clear();
  }
}
