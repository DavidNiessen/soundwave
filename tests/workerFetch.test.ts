import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchesThroughPage, proxyWorkerFetch, serveWorkerFetch } from '../src/app/workerFetch';

describe('fetching for a worker through its page', () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.unstubAllGlobals();
  });

  it('is only needed off the web (the macOS app serves the game from tauri://)', () => {
    expect(fetchesThroughPage('tauri:')).toBe(true);
    expect(fetchesThroughPage('https:')).toBe(false);
    expect(fetchesThroughPage('http:')).toBe(false);
  });

  it('hands the worker the bytes the page fetched, and the page’s failure', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:', href: 'tauri://localhost/assets/stage.worker.js' });
    // The page's own fetch, which can reach the app's files.
    const pageFetch = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('venue.json') ? new Response('{"ok":1}', { status: 200 }) : new Response('', { status: 404 }),
    );
    const page = { postMessage: (m: unknown) => void worker(m) };
    const worker = proxyWorkerFetch((ask) => serveWorkerFetch(page, ask, pageFetch));
    const r = await fetch('/stage/aurora/venue.json');
    expect(pageFetch).toHaveBeenCalledWith('tauri://localhost/stage/aurora/venue.json', expect.anything());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: 1 });
    expect((await fetch('/missing.glb')).status).toBe(404);
    // Messages that are not answers go on to the stage.
    expect(worker({ type: 'input' })).toBe(false);
  });

  it('sends a request body along (the app’s model runs are POSTs with tensors)', async () => {
    vi.stubGlobal('location', { protocol: 'tauri:', href: 'tauri://localhost/assets/worker.js' });
    const seen: { method?: string; body?: number[] }[] = [];
    const pageFetch = vi.fn<typeof fetch>(async (_url, init) => {
      seen.push({ method: init?.method, body: [...new Uint8Array(init?.body as ArrayBuffer)] });
      return new Response(new Uint8Array([9, 8]), { status: 200 });
    });
    const page = { postMessage: (m: unknown) => void worker(m) };
    const worker = proxyWorkerFetch((ask) => serveWorkerFetch(page, ask, pageFetch));
    const r = await fetch('swmodel://localhost/run?model=m&entry=m.onnx', { method: 'POST', body: new Uint8Array([1, 2, 3]) });
    expect(seen).toEqual([{ method: 'POST', body: [1, 2, 3] }]);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([9, 8]);
  });
});
