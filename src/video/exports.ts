/**
 * Replay videos made in the background: a queue of them, made one at a time in a worker of their
 * own (see video.worker.ts) while the player goes on using the game. They wait while a song is
 * played or the editor is open, so nothing takes the machine away from the song; each one is
 * written where the player chose when they asked for it.
 */
import { serveWorkerFetch } from '../app/workerFetch';
import type { SaveTarget } from '../storage/share';
import type { FromVideo, ToVideo, VideoJob } from './protocol';

export type ExportState = 'waiting' | 'rendering' | 'held' | 'saving' | 'saved' | 'failed' | 'cancelled';

export interface ExportItem {
  id: string;
  replayId: string;
  title: string;
  fileName: string;
  state: ExportState;
  /** The share of the video made, 0..1. */
  progress: number;
  /** Seconds of video made per second of work, once known. */
  speed: number | null;
  error?: string;
}

/** True while an export is still to be finished (not saved, failed or cancelled). */
export const isActive = (s: ExportState) => s === 'waiting' || s === 'rendering' || s === 'held' || s === 'saving';

interface Queued {
  job: VideoJob;
  target: SaveTarget;
}

class VideoExports {
  private items: ExportItem[] = [];
  private queued = new Map<string, Queued>();
  private worker: Worker | null = null;
  private running: string | null = null;
  private held = false;
  private probe: Promise<boolean> | null = null;
  private probeAnswer: ((ok: boolean) => void) | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly finishers = new Set<(item: ExportItem) => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };

  snapshot = (): readonly ExportItem[] => this.items;

  /** Called when an export is saved, fails or is cancelled (it has then left the list). */
  onFinished(fn: (item: ExportItem) => void) {
    this.finishers.add(fn);
    return () => void this.finishers.delete(fn);
  }

  /** Whether videos can be made in the background here: a worker that draws with WebGL and encodes. */
  available(): Promise<boolean> {
    this.probe ??= new Promise<boolean>((resolve) => {
      const w = this.getWorker();
      if (!w) return resolve(false);
      const timer = setTimeout(() => resolve(false), 10_000);
      this.probeAnswer = (ok) => {
        clearTimeout(timer);
        resolve(ok);
        if (!this.running) this.stopWorker();
      };
      w.postMessage({ type: 'probe' } satisfies ToVideo);
    });
    return this.probe;
  }

  /** Queues a video; it is written to `target` when it is done. */
  add(item: Omit<ExportItem, 'state' | 'progress' | 'speed'>, job: VideoJob, target: SaveTarget) {
    this.items = [...this.items, { ...item, state: this.held ? 'held' : 'waiting', progress: 0, speed: null }];
    this.queued.set(item.id, { job, target });
    this.changed();
    this.next();
  }

  cancel(id: string) {
    const q = this.queued.get(id);
    if (!q) return;
    if (this.running === id) {
      this.worker?.postMessage({ type: 'cancel', id } satisfies ToVideo);
      return;
    }
    this.queued.delete(id);
    void q.target.abort().catch(() => {});
    this.finish(id, { state: 'cancelled' });
  }

  /** Holds the exports while a song is played (or the editor is open), and lets them go on after. */
  hold(on: boolean) {
    if (on === this.held) return;
    this.held = on;
    this.worker?.postMessage({ type: on ? 'pause' : 'resume' } satisfies ToVideo);
    this.items = this.items.map((i) =>
      on && (i.state === 'rendering' || i.state === 'waiting')
        ? { ...i, state: 'held' }
        : !on && i.state === 'held'
          ? { ...i, state: i.id === this.running ? 'rendering' : 'waiting' }
          : i,
    );
    this.changed();
    if (!on) this.next();
  }

  private changed() {
    for (const l of this.listeners) l();
  }

  private patch(id: string, change: Partial<ExportItem>) {
    this.items = this.items.map((i) => (i.id === id ? { ...i, ...change } : i));
    this.changed();
  }

  /** An export is over: those listening hear how it went, and it leaves the list. */
  private finish(id: string, change: Partial<ExportItem>) {
    const was = this.items.find((i) => i.id === id);
    if (!was) return;
    const item = { ...was, ...change };
    this.items = this.items.filter((i) => i.id !== id);
    this.changed();
    for (const f of this.finishers) f(item);
  }

  private getWorker(): Worker | null {
    if (this.worker) return this.worker;
    if (typeof Worker !== 'function') return null;
    try {
      const w = new Worker(new URL('./video.worker.ts', import.meta.url), { type: 'module', name: 'video' });
      w.onmessage = (e: MessageEvent<FromVideo>) => {
        // The worker's fetches, where it cannot make them itself (see workerFetch).
        if (!serveWorkerFetch(w, e.data)) void this.receive(e.data);
      };
      w.onerror = (e) => {
        console.warn('The video worker failed', e.message);
        const id = this.running;
        this.stopWorker();
        if (id) this.fail(id, e.message || 'the video worker stopped');
        this.probeAnswer?.(false);
      };
      if (this.held) w.postMessage({ type: 'pause' } satisfies ToVideo);
      this.worker = w;
      return w;
    } catch {
      return null;
    }
  }

  /** The worker holds the stage while it is alive: it goes once there is nothing left to make. */
  private stopWorker() {
    this.worker?.terminate();
    this.worker = null;
  }

  private next() {
    // A new one is not even begun while a song is played: building its stage would take from the song.
    if (this.running || this.held) return;
    const id = this.items.find((i) => (i.state === 'waiting' || i.state === 'held') && this.queued.has(i.id))?.id;
    if (!id) return this.stopWorker();
    const w = this.getWorker();
    if (!w) return this.fail(id, 'this device cannot make videos in the background');
    this.running = id;
    const { job } = this.queued.get(id)!;
    this.patch(id, { state: this.held ? 'held' : 'rendering' });
    // The song's samples are handed over, not copied again.
    w.postMessage(
      { type: 'start', job } satisfies ToVideo,
      job.song.channels.map((c) => c.buffer as ArrayBuffer),
    );
  }

  private fail(id: string, message: string) {
    const q = this.queued.get(id);
    this.queued.delete(id);
    if (this.running === id) this.running = null;
    void q?.target.abort().catch(() => {});
    this.finish(id, { state: 'failed', error: message });
    this.next();
  }

  private async receive(m: FromVideo) {
    switch (m.type) {
      case 'probe':
        return this.probeAnswer?.(m.ok);
      case 'progress':
        return this.patch(m.id, { progress: m.done, speed: m.speed ?? this.items.find((i) => i.id === m.id)?.speed ?? null });
      case 'cancelled': {
        const q = this.queued.get(m.id);
        this.queued.delete(m.id);
        if (this.running === m.id) this.running = null;
        void q?.target.abort().catch(() => {});
        this.finish(m.id, { state: 'cancelled' });
        return this.next();
      }
      case 'failed':
        return this.fail(m.id, m.message);
      case 'done': {
        const q = this.queued.get(m.id);
        this.queued.delete(m.id);
        this.running = null;
        // The next one starts while this one is written.
        this.next();
        if (!q) return;
        this.patch(m.id, { state: 'saving', progress: 1 });
        try {
          await q.target.write(m.file);
          await q.target.close();
          this.finish(m.id, { state: 'saved' });
        } catch (e) {
          await q.target.abort().catch(() => {});
          this.finish(m.id, { state: 'failed', error: (e as Error).message });
        }
      }
    }
  }
}

export const videoExports = new VideoExports();
