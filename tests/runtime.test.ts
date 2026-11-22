import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fitMemory, MEMORY_MAXIMA } from '../src/analysis/runtime';

const runtime = readFileSync('node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs', 'utf8');

/** Runs the patched script's memory call with a browser that refuses shared memories above `cap` pages. */
function memoryUnder(cap: number) {
  const { script } = fitMemory('new WebAssembly.Memory({initial:256,maximum:65536,shared:!0});function rc(){return 4294901760}');
  const asked: number[] = [];
  const fake = {
    Memory: function (d: { maximum: number }) {
      asked.push(d.maximum);
      if (d.maximum > cap) throw new RangeError('Out of memory');
      return { maximum: d.maximum };
    },
  };
  // The prelude on its own: __swMemory and what rc() then reports.
  const prelude = script.slice(0, script.indexOf('\n'));
  const run = new Function('WebAssembly', `${prelude}; const m = __swMemory(); return { m, heap: __swHeapMax };`);
  return { ...(run(fake) as { m: { maximum: number }; heap: number }), asked };
}

describe('the analysis runtime', () => {
  it('is patched to ask for less memory when 4 GiB is refused', () => {
    const { script, patched } = fitMemory(runtime);
    expect(patched).toBe(true);
    expect(script).not.toContain('new WebAssembly.Memory({initial:256,maximum:65536,shared:!0})');
    expect(script).toContain('__swMemory()');
    expect(script).toContain('function rc(){return __swHeapMax}');
  });

  it('takes the largest memory the browser will set aside, and tells the allocator so', () => {
    expect(memoryUnder(65536)).toEqual({ m: { maximum: 65536 }, heap: 65536 * 65536 - 65536, asked: [65536] });
    expect(memoryUnder(20000)).toEqual({ m: { maximum: 16384 }, heap: 16384 * 65536 - 65536, asked: [65536, 32768, 16384] });
    expect(() => memoryUnder(100)).toThrow(RangeError);
    expect(MEMORY_MAXIMA[0]).toBe(65536);
  });

  it('leaves a runtime that builds its memory some other way as it is', () => {
    expect(fitMemory('const m = makeMemory();')).toEqual({ script: 'const m = makeMemory();', patched: false });
  });
});
