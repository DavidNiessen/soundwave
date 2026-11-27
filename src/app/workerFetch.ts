/**
 * Fetching for a worker, through the page that started it.
 *
 * The desktop app on macOS serves the game from its own scheme (tauri://localhost). WebKit routes
 * the page's requests for it to the app, but a worker's do not get through: they never answer, so
 * a stage built in a worker waited for its venue for good (and an analysis for its runtime). There the worker hands each request to
 * the page, which fetches it and sends the bytes back. Everywhere else (http and https, the
 * website and the Windows and Linux apps) the worker fetches for itself, as before.
 */

const TYPE = 'fetch-proxy';

interface Ask {
  type: typeof TYPE;
  id: number;
  url: string;
  init?: { method?: string; headers?: [string, string][]; body?: ArrayBuffer };
}

interface Answer {
  type: typeof TYPE;
  id: number;
  ok?: { status: number; statusText: string; headers: [string, string][]; body: ArrayBuffer };
  error?: string;
}

/** Whether a worker here must fetch through its page (the page's own scheme is not http or https). */
export const fetchesThroughPage = (protocol = globalThis.location?.protocol ?? 'https:') => !/^https?:$/.test(protocol);

/**
 * In the worker: sends its fetches to the page, when it needs to. `post` sends a message to the
 * page; the returned function takes the page's messages, and says whether one was an answer.
 */
export function proxyWorkerFetch(post: (m: Ask, transfer: Transferable[]) => void): (data: unknown) => boolean {
  if (!fetchesThroughPage()) return () => false;
  let next = 1;
  const waiting = new Map<number, { resolve(r: Response): void; reject(e: Error): void }>();
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, globalThis.location.href).href;
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    // A body (the app's model runs send one) goes along as bytes, handed over rather than copied.
    const body = init?.body != null ? await new Response(init.body).arrayBuffer() : undefined;
    const id = next++;
    return new Promise<Response>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      post({ type: TYPE, id, url, init: { method: init?.method ?? 'GET', headers: [...headers.entries()], body } }, body ? [body] : []);
    });
  };
  return (data: unknown) => {
    const a = data as Answer | null;
    if (!a || a.type !== TYPE) return false;
    const w = waiting.get(a.id);
    waiting.delete(a.id);
    if (w && a.ok) w.resolve(new Response(a.ok.body, { status: a.ok.status, statusText: a.ok.statusText, headers: a.ok.headers }));
    else w?.reject(new TypeError(a.error ?? 'Failed to fetch'));
    return true;
  };
}

/** On the page: answers a worker's fetches. Returns whether the message was one (and is handled). */
export function serveWorkerFetch(worker: Pick<Worker, 'postMessage'>, data: unknown, get: typeof fetch = fetch): boolean {
  const ask = data as Ask | null;
  if (!ask || ask.type !== TYPE) return false;
  void get(ask.url, { method: ask.init?.method, headers: ask.init?.headers, body: ask.init?.body }).then(
    async (r) => {
      const body = await r.arrayBuffer();
      const answer: Answer = {
        type: TYPE,
        id: ask.id,
        ok: { status: r.status, statusText: r.statusText, headers: [...r.headers.entries()], body },
      };
      worker.postMessage(answer, [body]);
    },
    (e: unknown) => worker.postMessage({ type: TYPE, id: ask.id, error: String((e as Error)?.message ?? e) } satisfies Answer),
  );
  return true;
}
