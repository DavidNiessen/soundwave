import { gpuFound, type GraphicsSettings } from '../../game/graphics';
import type { Part } from '../../chart/types';
import type { Avatars, StageOptions } from '../aurora/AuroraStage';
import type { RingPlace } from '../aurora/ring';
import { serveWorkerFetch } from '../../app/workerFetch';
import type { Beat, FromStage, StageInput, StageRate, ToStage } from './protocol';

/**
 * The 3D stage as the page sees it: a canvas in the page, drawn by a worker of its own.
 *
 * The stage is by far the heaviest thing the game draws. Run on the page, every one of its frames
 * (and building it, which takes the better part of a second) would hold up everything else there:
 * the menus, the highway, the input. So the page hands the canvas over to a worker
 * (OffscreenCanvas) that builds and draws the stage on a frame loop of its own, and only tells it
 * what the music is doing. Where a worker cannot draw with WebGL, the same host runs on the page,
 * as before (see stageHost).
 */

/** Messages to the stage are sent at most this often, ms (beats go at once). */
const INPUT_MS = 1000 / 120;

type Target = 'worker' | 'page';

/** undefined: not started yet; null: the worker cannot be used here. */
let worker: Worker | null | undefined;
/** The worker can draw with WebGL (false once it has been seen not to). */
/**
 * The worker can draw with WebGL (false once it has been seen not to). Not in the macOS app: WebKit
 * there, serving the game from the app's own scheme, does not get a stage built in a worker onto
 * the screen, so the stage is drawn on the page from the start.
 */
let workerDraws = typeof location === 'undefined' || /^https?:$/.test(location.protocol);
/** A stage in the worker that has not drawn by then is built on the page instead, ms. */
const WORKER_PATIENCE = 15_000;
let pageHost: Promise<(m: ToStage) => void> | null = null;
let nextId = 1;
const views = new Map<number, StageView>();
const debugAsks = new Map<number, (info: Record<string, unknown>) => void>();

let venueShare = 0;
const venueWatchers = new Set<(share: number) => void>();

function receive(m: FromStage) {
  switch (m.type) {
    case 'gpu':
      gpuFound(m.name);
      return;
    case 'venue':
      // Two hosts may report (the worker and, after a fallback, the page): the furthest counts.
      venueShare = Math.max(venueShare, m.share);
      venueWatchers.forEach((w) => w(venueShare));
      return;
    case 'shown':
      views.get(m.id)?.onShown();
      return;
    case 'failed':
      views.get(m.id)?.onFailed(m.message, m.webgl);
      return;
    case 'debug':
      debugAsks.get(m.id)?.(m.info);
      debugAsks.delete(m.id);
      return;
    case 'frame': {
      const view = views.get(m.id);
      if (view) view.onFrame(m.frame, m.seq);
      else m.frame.close();
      return;
    }
    case 'no-frame':
      views.get(m.id)?.onStep(m.seq, null);
      return;
  }
}

function canHandOver(): boolean {
  return (
    typeof Worker === 'function' &&
    typeof OffscreenCanvas === 'function' &&
    typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function'
  );
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (!canHandOver()) return (worker = null);
  try {
    const w = new Worker(new URL('./stage.worker.ts', import.meta.url), { type: 'module', name: 'stage' });
    w.onmessage = (e: MessageEvent<FromStage>) => {
      // The worker's fetches, where it cannot make them itself (see fetchProxy).
      if (!serveWorkerFetch(w, e.data)) receive(e.data);
    };
    // The worker's script would not load or run: every stage it holds goes to the page instead.
    w.onerror = (e) => {
      console.warn('Stage worker failed; drawing the stage on the page', e.message);
      worker = null;
      w.terminate();
      for (const view of views.values()) view.onFailed('the stage worker stopped', true);
    };
    w.postMessage({ type: 'visible', visible: document.visibilityState !== 'hidden' } satisfies ToStage);
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

function getPageHost(): Promise<(m: ToStage) => void> {
  pageHost ??= import('./stageHost').then(({ createStageHost }) => {
    const host = createStageHost(receive);
    host.handle({ type: 'visible', visible: document.visibilityState !== 'hidden' });
    return host.handle;
  });
  return pageHost;
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    const m: ToStage = { type: 'visible', visible: document.visibilityState !== 'hidden' };
    worker?.postMessage(m);
    void pageHost?.then((handle) => handle(m));
  });

/** Starts loading the venue now, ahead of the first stage, so it is there sooner. */
export function preloadStage() {
  const w = workerDraws ? getWorker() : null;
  if (w) w.postMessage({ type: 'preload' } satisfies ToStage);
  else void getPageHost().then((handle) => handle({ type: 'preload' }));
}

/** Calls back with how much of the venue has loaded (0..1), now and as more of it arrives. */
export function watchStageLoading(cb: (share: number) => void): () => void {
  venueWatchers.add(cb);
  cb(venueShare);
  return () => void venueWatchers.delete(cb);
}

export class StageView {
  /** Resolves once the stage's first frame is drawn; rejects if it cannot be built. */
  readonly ready: Promise<void>;
  private canvas!: HTMLCanvasElement;
  private readonly id = nextId++;
  private target: Target = 'page';
  private pageHandle: ((m: ToStage) => void) | null = null;
  /** Messages for the page's host until it has loaded. */
  private queue: ToStage[] = [];
  private readonly observer: ResizeObserver;
  private resolve!: () => void;
  private reject!: (err: Error) => void;
  private settled = false;
  private patience: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private lastInput = 0;
  private lastSize = '';
  /** Takes each frame drawn while a video is recorded (see `capture`). */
  private frameTaker: ((frame: ImageBitmap) => void) | null = null;

  constructor(
    private host: HTMLElement,
    private readonly graphics: GraphicsSettings,
    private readonly options: StageOptions,
  ) {
    this.ready = new Promise<void>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // Whoever waits on it reports the failure; nobody waiting is not an error.
    this.ready.catch(() => undefined);
    this.observer = new ResizeObserver(() => this.sendSize());
    window.addEventListener('resize', this.sendSize);
    views.set(this.id, this);
    this.start(workerDraws && getWorker() ? 'worker' : 'page');
  }

  /** Puts a fresh canvas in the host and builds the stage on it, in the worker or on the page. */
  private start(target: Target) {
    this.target = target;
    clearTimeout(this.patience);
    // Should the worker never get the stage drawn (and never say why), the page builds it.
    if (target === 'worker')
      this.patience = setTimeout(() => {
        if (this.settled || this.disposed || this.target !== 'worker') return;
        console.warn('The stage did not draw in its worker; drawing it on the page');
        this.send({ type: 'dispose', id: this.id });
        workerDraws = false;
        this.start('page');
      }, WORKER_PATIENCE);
    this.canvas?.remove();
    const canvas = document.createElement('canvas');
    canvas.className = 'stage3d';
    this.host.appendChild(canvas);
    this.canvas = canvas;
    this.observer.disconnect();
    this.observer.observe(canvas);
    this.lastSize = '';
    const { width, height, dpr } = this.measure();
    const base = { type: 'create' as const, id: this.id, graphics: this.graphics, options: this.options, width, height, dpr };
    if (target === 'worker') {
      const offscreen = canvas.transferControlToOffscreen();
      worker!.postMessage({ ...base, canvas: offscreen } satisfies ToStage, [offscreen]);
      if (this.frameTaker) worker!.postMessage({ type: 'capture', id: this.id, on: true } satisfies ToStage);
    } else {
      this.send({ ...base, canvas });
      if (this.frameTaker) this.send({ type: 'capture', id: this.id, on: true });
      void getPageHost().then((handle) => {
        this.pageHandle = handle;
        const queued = this.queue;
        this.queue = [];
        if (this.target === 'page') queued.forEach(handle);
      });
    }
  }

  private send(m: ToStage) {
    if (this.disposed && m.type !== 'dispose') return;
    if (this.target === 'worker') worker?.postMessage(m);
    else if (this.pageHandle) this.pageHandle(m);
    else this.queue.push(m);
  }

  private measure() {
    const c = this.canvas;
    return {
      width: c.clientWidth || window.innerWidth,
      height: c.clientHeight || window.innerHeight,
      dpr: window.devicePixelRatio || 1,
    };
  }

  private readonly sendSize = () => {
    const { width, height, dpr } = this.measure();
    const key = `${width}x${height}@${dpr}`;
    if (key === this.lastSize) return;
    this.lastSize = key;
    this.send({ type: 'size', id: this.id, width, height, dpr });
  };

  /** @internal The first frame is on screen: the canvas fades in. */
  onShown() {
    this.canvas.classList.add('on');
    if (!this.settled) {
      this.settled = true;
      this.resolve();
    }
  }

  /** @internal The stage could not be built. Without WebGL in the worker, it is built on the page. */
  onFailed(message: string, webgl: boolean) {
    if (this.disposed) return;
    if (webgl && this.target === 'worker') {
      workerDraws = false;
      this.start('page');
      return;
    }
    if (!this.settled) {
      this.settled = true;
      this.reject(new Error(message));
    }
  }

  /** Moves the stage's canvas into another host; the stage carries on as it is. */
  attach(host: HTMLElement) {
    this.host = host;
    if (this.canvas.parentElement !== host) host.appendChild(this.canvas);
    this.sendSize();
  }

  /** What the music is doing now. Cheap to call every frame: it is passed on at most 120 times a second. */
  input(input: StageInput) {
    const now = performance.now();
    if (now - this.lastInput < INPUT_MS) return;
    this.lastInput = now;
    const { low, mid, high } = input.bands;
    this.send({ type: 'input', id: this.id, input: { ...input, bands: { low, mid, high } } });
  }

  beat(beat: Beat) {
    this.send({ type: 'beat', id: this.id, beat });
  }

  setRate(rate: StageRate) {
    this.send({ type: 'rate', id: this.id, rate });
  }

  overdriveStart() {
    this.send({ type: 'overdrive', id: this.id });
  }

  finale(seconds: number) {
    this.send({ type: 'finale', id: this.id, seconds });
  }

  /** Dresses the band as the players on its parts. */
  setAvatars(avatars: Avatars) {
    this.send({ type: 'avatars', id: this.id, avatars });
  }

  /** A Showdown's board as it stands: the ring's podiums follow it. */
  setPlaces(places: RingPlace[]) {
    this.send({ type: 'places', id: this.id, places });
  }

  /** A Showdown Strike from one player to another, landing in `ms` milliseconds. */
  strike(from: string, to: string, ms: number) {
    this.send({ type: 'strike', id: this.id, from, to, ms });
  }

  /** Keeps the camera on one part's band member, or lets it roam again (null). */
  lookAt(part: Part | null) {
    this.send({ type: 'hold', id: this.id, part });
  }

  /**
   * Hands every frame the stage draws to `take` (an ImageBitmap it then owns), or stops with null:
   * for recording a video, where the stage's picture is laid under the highway's.
   */
  capture(take: ((frame: ImageBitmap) => void) | null) {
    this.frameTaker = take;
    this.send({ type: 'capture', id: this.id, on: !!take });
  }

  /** @internal A frame drawn while capture is on, or one a `step` asked for. */
  onFrame(frame: ImageBitmap, seq?: number) {
    if (seq !== undefined) return this.onStep(seq, frame);
    if (this.frameTaker && !this.disposed) this.frameTaker(frame);
    else frame.close();
  }

  private steps = new Map<number, (frame: ImageBitmap | null) => void>();
  private nextStep = 1;

  /**
   * Draws one frame of a video on its clock (`now`, ms), with what the music is doing then, and
   * resolves with it (null when there is none: the stage is not built). From the first step on, the
   * stage draws only when asked, so the video's frames come as fast as they can be made.
   */
  step(now: number, input: StageInput, beat: Beat | 'none'): Promise<ImageBitmap | null> {
    if (this.disposed) return Promise.resolve(null);
    const seq = this.nextStep++;
    const { low, mid, high } = input.bands;
    return new Promise((resolve) => {
      this.steps.set(seq, resolve);
      this.send({ type: 'step', id: this.id, seq, now, input: { ...input, bands: { low, mid, high } }, beat });
    });
  }

  /** @internal The frame a step asked for. */
  onStep(seq: number, frame: ImageBitmap | null) {
    const resolve = this.steps.get(seq);
    this.steps.delete(seq);
    if (resolve && !this.disposed) resolve(frame);
    else frame?.close();
  }

  /** Dev diagnostics from the stage, wherever it runs. */
  debugInfo(): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      debugAsks.set(this.id, resolve);
      this.send({ type: 'debug', id: this.id });
    });
  }

  dispose() {
    if (this.disposed) return;
    clearTimeout(this.patience);
    this.send({ type: 'dispose', id: this.id });
    this.disposed = true;
    for (const resolve of this.steps.values()) resolve(null);
    this.steps.clear();
    views.delete(this.id);
    this.observer.disconnect();
    window.removeEventListener('resize', this.sendSize);
    this.canvas.remove();
  }
}
