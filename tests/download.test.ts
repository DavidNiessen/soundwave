import { describe, expect, it } from 'vitest';
import { readWithProgress } from '../src/net/client';

/** An answer whose body comes in three pieces, with the headers given. */
const answer = (headers: Record<string, string>) => {
  const pieces = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5]), new Uint8Array([6])];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of pieces) c.enqueue(p);
      c.close();
    },
  });
  return new Response(body, { headers });
};

describe('a file downloaded with its progress', () => {
  it('comes whole, and says how far it got when the server tells its size', async () => {
    const seen: number[] = [];
    const blob = await readWithProgress(answer({ 'X-File-Size': '6' }), (d) => seen.push(d));
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(seen).toEqual([2 / 6, 5 / 6, 1]);
  });

  it('comes whole without any size (a proxy dropped it), telling no progress', async () => {
    const seen: number[] = [];
    const blob = await readWithProgress(answer({}), (d) => seen.push(d));
    expect(blob.size).toBe(6);
    expect(seen).toEqual([]);
  });
});
