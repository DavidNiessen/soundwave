/**
 * The videos and pictures the player's stages use as backgrounds or on the stage's screens. They
 * live in a database of their own, beside the songs': it never changes the songs' database or its
 * version. A library backup carries them (src/storage/backup.ts), so the stages that use them
 * come along whole.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

export interface StageMedia {
  id: string;
  /** The file's name, to show it. */
  name: string;
  type: string;
  blob: Blob;
  addedAt: number;
}

interface MediaDB extends DBSchema {
  media: { key: string; value: StageMedia };
}

let db: Promise<IDBPDatabase<MediaDB>> | null = null;
const open = () =>
  (db ??= openDB<MediaDB>('soundwave-stage-media', 1, {
    upgrade(d) {
      d.createObjectStore('media', { keyPath: 'id' });
    },
  }));

/** Keeps a file for a stage; resolves to its id. */
export async function putMedia(file: File): Promise<string> {
  const id = `media-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await (await open()).put('media', { id, name: file.name, type: file.type, blob: file, addedAt: Date.now() });
  return id;
}

/** Every file kept, whole, for a library backup. */
export async function listMedia(): Promise<StageMedia[]> {
  try {
    return await (await open()).getAll('media');
  } catch {
    return [];
  }
}

/** Keeps a file from a backup under its own id; one already here is left as it is. Resolves to whether it was added. */
export async function restoreMedia(m: StageMedia): Promise<boolean> {
  const d = await open();
  if (await d.get('media', m.id)) return false;
  await d.put('media', m);
  return true;
}

export async function getMedia(id: string): Promise<StageMedia | null> {
  try {
    return (await (await open()).get('media', id)) ?? null;
  } catch {
    return null;
  }
}

export async function deleteMedia(id: string): Promise<void> {
  urls.get(id)?.then((u) => u && URL.revokeObjectURL(u));
  urls.delete(id);
  await (await open()).delete('media', id);
}

/** Every file kept, for tidying up after stages that are gone. */
export async function mediaIds(): Promise<string[]> {
  return (await open()).getAllKeys('media');
}

const urls = new Map<string, Promise<string | null>>();

/** A URL to show a kept file with (made once per file and kept), or null when it is gone. */
export function mediaUrl(id: string): Promise<string | null> {
  let url = urls.get(id);
  if (!url) {
    url = getMedia(id).then((m) => (m ? URL.createObjectURL(m.blob) : null));
    urls.set(id, url);
  }
  return url;
}
