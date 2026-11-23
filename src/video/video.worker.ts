/// <reference lib="webworker" />
/**
 * The worker replay videos are made in (see makeReplayVideo): one job at a time, held between two
 * frames while the page asks it to wait (a song is being played), and dropped when cancelled.
 */
import { proxyWorkerFetch } from '../app/workerFetch';
import italic from '../ui/fonts/archivo/archivo-latin-wdth-italic.woff2?url';
import upright from '../ui/fonts/archivo/archivo-latin-wdth-normal.woff2?url';
import type { FromVideo, ToVideo } from './protocol';
import { makeReplayVideo, VideoCancelled } from './replayVideo';

const scope = self as unknown as DedicatedWorkerGlobalScope & { fonts?: FontFaceSet };
const post = (m: FromVideo) => scope.postMessage(m);
// Where a worker cannot fetch the game's files itself (the macOS app), the page fetches them.
const fetched = proxyWorkerFetch((m, transfer) => scope.postMessage(m, transfer));

/** The HUD's typeface, loaded here as well: a worker does not share the page's fonts. */
let fonts: Promise<unknown> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all(
    [
      { url: upright, style: 'normal' },
      { url: italic, style: 'italic' },
    ].map(async ({ url, style }) => {
      if (!scope.fonts || typeof FontFace !== 'function') return;
      const face = new FontFace('Archivo Variable', `url(${url})`, { style, weight: '100 900', stretch: '62% 125%' });
      scope.fonts.add(await face.load());
    }),
  ).catch(() => undefined));

let paused = false;
let wake: (() => void) | null = null;
const cancelled = new Set<string>();
const mayGoOn = () => (paused ? new Promise<void>((resolve) => (wake = resolve)) : Promise.resolve());

function canMakeVideos(): boolean {
  try {
    if (typeof VideoEncoder !== 'function' || typeof OffscreenCanvas !== 'function') return false;
    return !!new OffscreenCanvas(16, 16).getContext('webgl2');
  } catch {
    return false;
  }
}

scope.onmessage = async (e: MessageEvent<ToVideo>) => {
  if (fetched(e.data)) return;
  const m = e.data;
  switch (m.type) {
    case 'probe':
      return post({ type: 'probe', ok: canMakeVideos() });
    case 'pause':
      paused = true;
      return;
    case 'resume':
      paused = false;
      wake?.();
      wake = null;
      return;
    case 'cancel':
      cancelled.add(m.id);
      // A job waiting for a song to end is dropped now, not when the song ends.
      wake?.();
      wake = null;
      return;
    case 'start': {
      const { job } = m;
      try {
        await loadFonts();
        const file = await makeReplayVideo(job, {
          progress: (done, speed) => post({ type: 'progress', id: job.id, done, speed }),
          mayGoOn: () => (cancelled.has(job.id) ? Promise.resolve() : mayGoOn()),
          cancelled: () => cancelled.has(job.id),
        });
        post({ type: 'done', id: job.id, file });
      } catch (err) {
        if (err instanceof VideoCancelled || cancelled.has(job.id)) post({ type: 'cancelled', id: job.id });
        else post({ type: 'failed', id: job.id, message: err instanceof Error ? err.message : String(err) });
      } finally {
        cancelled.delete(job.id);
      }
    }
  }
};
