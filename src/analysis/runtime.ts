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

/**
 * Gets ONNX Runtime ready in a worker, before its first model is opened.
 *
 * The runtime's script and WebAssembly file are served next to the app (public/ort). The script
 * is handed over as a blob, because the runtime starts its threads from the script's own address:
 * from a blob that needs no request, and a request for an app file made by a thread of a worker
 * is never answered in the desktop app's window. The WebAssembly file comes gzip-compressed
 * (scripts/copy-models.mjs) and is handed over unpacked.
 */
export async function loadRuntime(ort: typeof Ort, device: 'gpu' | 'cpu'): Promise<void> {
  const base = new URL(`${import.meta.env.BASE_URL}ort/`, self.location.href).href;
  const [script, binary] = await Promise.all([
    fetch(`${base}ort-wasm-simd-threaded.asyncify.mjs`).then((r) => r.text()),
    fetchWasm(`${base}ort-wasm-simd-threaded.asyncify.wasm.gz`),
  ]);
  ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([script], { type: 'text/javascript' })) };
  ort.env.wasm.wasmBinary = binary;
  // A graphics card does the arithmetic itself; threads are for the processor path.
  if (device === 'gpu') ort.env.wasm.numThreads = 1;
  ort.env.logLevel = 'error';
}
