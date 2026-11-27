import { describe, expect, it } from 'vitest';
import { decodeTensors, encodeTensors } from '../src/analysis/native';

describe('tensors for the app’s models', () => {
  it('come back as they went, names, shapes and values', () => {
    const tensors = [
      { name: 'x', dims: [1, 2, 3], data: Float32Array.from({ length: 6 }, (_, i) => i * 0.5) },
      { name: 'xt_out', dims: [2], data: new Float32Array([-1, 3.25]) },
    ];
    const back = decodeTensors(encodeTensors(tensors));
    expect(back.map((t) => [t.name, t.dims, [...t.data]])).toEqual(tensors.map((t) => [t.name, t.dims, [...t.data]]));
  });

  it('take values that start at any byte of their buffer', () => {
    const buffer = new ArrayBuffer(4 * 5);
    const data = new Float32Array(buffer, 4, 3);
    data.set([1.5, 2.5, 3.5]);
    const [t] = decodeTensors(encodeTensors([{ name: 'spect', dims: [3], data }]));
    expect([...t.data]).toEqual([1.5, 2.5, 3.5]);
  });

  it('are laid out as the app reads them: count, name, shape, then little-endian floats', () => {
    const bytes = new Uint8Array(encodeTensors([{ name: 'a', dims: [1], data: new Float32Array([1]) }]));
    // count 1 | name length 1 | "a" | 1 dimension | 1 (i64) | 1.0f
    expect([...bytes]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 97, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 128, 63]);
  });
});
