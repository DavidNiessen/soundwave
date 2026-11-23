import type * as Ort from 'onnxruntime-web/webgpu';

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
    `try{const m=new WebAssembly.Memory({initial:256,maximum,shared:!0});__swHeapMax=maximum*65536-65536;return m}` +
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
export async function loadRuntime(ort: typeof Ort): Promise<void> {
  const base = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.href).href;
  const [script, binary] = await Promise.all([
    fetch(`${base}ort-wasm-simd-threaded.asyncify.mjs`).then((r) => r.text()),
    fetchWasm(`${base}ort-wasm-simd-threaded.asyncify.wasm.gz`),
  ]);
  const fitted = fitMemory(script);
  if (!fitted.patched) console.warn('the analysis runtime builds its memory in a way not known here: it asks for 4 GiB as it is');
  ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([fitted.script], { type: 'text/javascript' })) };
  ort.env.wasm.wasmBinary = binary;
  // No thread count is set, so the runtime picks one (up to four) on either device. It starts its
  // threads once, when its first model opens, and keeps them: a graphics card does not need them,
  // but when it cannot open a model the same runtime falls back to the processor, which with the
  // single thread the graphics card path used to be given ran up to four times slower.
  ort.env.logLevel = 'error';
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
