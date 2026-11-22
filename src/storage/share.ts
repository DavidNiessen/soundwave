/**
 * Getting files in and out: saving a song's file or a library backup to disk, and, in the desktop
 * app, the song files the system opens the game with (a song file double-clicked in Explorer).
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { inDesktopApp } from '../game/displayMode';
import { BACKUP_EXT, BACKUP_MIME } from './backup';
import { SOUNDWAVE_EXT, SOUNDWAVE_MIME } from './soundwaveFile';

export type SaveKind = 'song' | 'backup' | 'video-mp4' | 'video-webm' | 'identity';

const TYPES: Record<SaveKind, { description: string; mime: string; ext: string }> = {
  song: { description: 'Soundwave song', mime: SOUNDWAVE_MIME, ext: SOUNDWAVE_EXT },
  backup: { description: 'Soundwave library backup', mime: BACKUP_MIME, ext: BACKUP_EXT },
  'video-mp4': { description: 'MP4 video', mime: 'video/mp4', ext: '.mp4' },
  'video-webm': { description: 'WebM video', mime: 'video/webm', ext: '.webm' },
  identity: { description: 'Soundwave identity', mime: 'application/json', ext: '.soundwave-id' },
};

/** How much is handed to the desktop app in one message. */
const PIECE = 8 * 1024 * 1024;

/** A file being saved where the player chose: written in order, then finished or abandoned. */
export interface SaveTarget {
  write(data: Blob): Promise<void>;
  /** Finishes the file. */
  close(): Promise<void>;
  /** Gives up part way: an unfinished file is removed where that is possible. */
  abort(): Promise<void>;
}

/**
 * Asks where to save a file and opens it there; null when the player cancelled. Ask first, then
 * produce the file: a browser shows its save dialog only straight after a press.
 */
export async function chooseSaveTarget(name: string, kind: SaveKind): Promise<SaveTarget | null> {
  if (inDesktopApp()) {
    // The app's own commands show the system's save dialog and write the file in pieces.
    const id = await invoke<number | null>('save_file_begin', { name, kind });
    if (id === null) return null;
    return {
      async write(data) {
        for (let at = 0; at < data.size; at += PIECE) {
          const bytes = new Uint8Array(await data.slice(at, at + PIECE).arrayBuffer());
          await invoke('save_file_write', bytes, { headers: { 'x-save-id': String(id) } });
        }
      },
      close: () => invoke('save_file_end', { id, keep: true }).then(() => {}),
      abort: () => invoke('save_file_end', { id, keep: false }).then(() => {}),
    };
  }
  const t = TYPES[kind];
  const picker = (window as { showSaveFilePicker?: (o: object) => Promise<FileSystemFileHandle> }).showSaveFilePicker;
  if (picker) {
    let handle: FileSystemFileHandle;
    try {
      // The dialog takes only letters and digits after the dot of a file type, and refuses the rest
      // outright ('.soundwave-backup'): such a file is offered under its own name, without a type.
      const typed = /^\.[a-z0-9]{1,16}$/i.test(t.ext);
      handle = await picker({
        suggestedName: name,
        ...(typed ? { types: [{ description: t.description, accept: { [t.mime]: [t.ext] } }] } : {}),
      });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return null;
      throw e;
    }
    const out = await handle.createWritable();
    return { write: (data) => out.write(data), close: () => out.close(), abort: () => out.abort() };
  }
  // Browsers without a save dialog download it once it is complete.
  const parts: Blob[] = [];
  return {
    async write(data) {
      parts.push(data);
    },
    async close() {
      const url = URL.createObjectURL(new Blob(parts, { type: t.mime }));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    async abort() {
      parts.length = 0;
    },
  };
}

/** Asks where to save a song file and writes it. False when the player cancelled. */
export async function saveSongFile(file: Blob, name: string): Promise<boolean> {
  const target = await chooseSaveTarget(name, 'song');
  if (!target) return false;
  try {
    await target.write(file);
    await target.close();
  } catch (e) {
    await target.abort().catch(() => {});
    throw e;
  }
  return true;
}

interface OpenedFile {
  id: number;
  name: string;
}

let handler: ((files: File[]) => void) | null = null;
/** Files read while nothing was listening, handed over when something does. */
let waiting: File[] = [];
let queue: Promise<void> = Promise.resolve();
let listening = false;

function deliver(files: File[]) {
  if (!files.length) return;
  if (handler) handler(files);
  else waiting.push(...files);
}

/** Reads the files the app has been asked to open and not yet handed over. */
function take() {
  queue = queue.then(async () => {
    const opened = await invoke<OpenedFile[]>('take_opened_files').catch(() => [] as OpenedFile[]);
    const files: File[] = [];
    for (const f of opened) {
      try {
        const bytes = await invoke<ArrayBuffer>('read_opened_file', { id: f.id });
        files.push(new File([bytes], f.name, { type: SOUNDWAVE_MIME }));
      } catch (e) {
        console.warn(`could not read ${f.name}`, e);
      }
    }
    deliver(files);
  });
}

/**
 * Hands every song file the system opens the desktop app with to `onFiles`: the ones it was started
 * with, and any opened while it runs (the app stays one window; a second launch passes its files
 * on to this one). Returns a function that stops handing them over.
 */
export function watchOpenedFiles(onFiles: (files: File[]) => void): () => void {
  if (!inDesktopApp()) return () => {};
  handler = onFiles;
  if (waiting.length) {
    const files = waiting;
    waiting = [];
    onFiles(files);
  }
  if (!listening) {
    listening = true;
    // Listen first, then take what is already waiting: a file that arrives in between is still taken.
    void listen('soundwave://opened', take).then(take, take);
  }
  return () => {
    if (handler === onFiles) handler = null;
  };
}
