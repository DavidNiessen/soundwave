/**
 * Songs streamed from a server, kept on this device for a while (the browser's Cache Storage), so a
 * song streamed once plays at once the next time, and a setlist with streamed songs in it survives
 * closing the game. They are not in the library: nothing here is the player's, and the oldest go
 * once more than `KEEP` are kept. Where the browser has no Cache Storage, nothing is kept.
 */
import type { StreamQuality } from './protocol';

const NAME = 'soundwave-stream';
/** How many streamed songs are kept on the device. */
const KEEP = 24;

const prefixOf = (server: string) => `https://stream.soundwave.invalid/${encodeURIComponent(server)}/`;
const key = (server: string, id: string, quality: StreamQuality) => `${prefixOf(server)}${id}/${quality}`;

async function open(): Promise<Cache | null> {
  try {
    return typeof caches === 'undefined' ? null : await caches.open(NAME);
  } catch {
    return null;
  }
}

/** A kept song, in the quality asked for if it is kept in that one, else in any quality kept. */
export async function cachedSong(
  server: string,
  id: string,
  quality: StreamQuality,
): Promise<{ blob: Blob; quality: StreamQuality } | null> {
  const cache = await open();
  if (!cache) return null;
  const order: StreamQuality[] = [quality, ...(['high', 'medium', 'low'] as const).filter((q) => q !== quality)];
  for (const q of order) {
    try {
      const hit = await cache.match(key(server, id, q));
      if (hit) return { blob: await hit.blob(), quality: q };
    } catch {
      /* a damaged entry: as if it were not kept */
    }
  }
  return null;
}

/** The ids of the songs kept for `server`. */
export async function cachedIds(server: string): Promise<Set<string>> {
  const cache = await open();
  const ids = new Set<string>();
  if (!cache) return ids;
  const prefix = prefixOf(server);
  try {
    for (const req of await cache.keys()) {
      if (!req.url.startsWith(prefix)) continue;
      const id = req.url.slice(prefix.length).split('/')[0];
      if (id) ids.add(id);
    }
  } catch {
    /* nothing kept that can be read */
  }
  return ids;
}

/** Keeps a streamed song, and lets the oldest go beyond `KEEP`. */
export async function keepSong(server: string, id: string, quality: StreamQuality, blob: Blob) {
  const cache = await open();
  if (!cache) return;
  try {
    await cache.put(key(server, id, quality), new Response(blob, { headers: { 'X-Kept': String(Date.now()) } }));
    const all = await cache.keys();
    if (all.length <= KEEP) return;
    const dated = await Promise.all(all.map(async (req) => ({ req, at: Number((await cache.match(req))?.headers.get('X-Kept')) || 0 })));
    dated.sort((a, b) => a.at - b.at);
    for (const { req } of dated.slice(0, dated.length - KEEP)) await cache.delete(req);
  } catch {
    /* storage full or refused: the song is still played, only not kept */
  }
}

/** Lets a kept song go (it was removed from the server). */
export async function dropSong(server: string, id: string) {
  const cache = await open();
  if (!cache) return;
  for (const q of ['high', 'medium', 'low'] as const) await cache.delete(key(server, id, q)).catch(() => false);
}
