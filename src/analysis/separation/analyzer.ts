import { loadSongBuffer } from '../../audio/songAudio';
import { serveWorkerFetch } from '../../app/workerFetch';
import { wavBytes } from '../../audio/wav';
import { ANALYSIS_SAMPLE_RATE, STEM_NAMES, type StemName, type StemNotes } from '../types';
import { stemModel } from './model';
import { joinPartsOf, MODEL_RATE, MODEL_STEMS, segmentOffsets, songLevel } from './separate';
import { storeBundledModel, storeModel, PITCH_MODEL } from '../native';
import { analysisHold } from '../hold';
import { Stopwatch } from '../timing';
import { analysisDevice, onWebKit } from './support';
import { HELPERS, type HelperPort } from './transform';
import type { ModelDevice, SeparationRequest, SeparationResponse } from './worker';

/** What separating a song gives the rest of the analysis. */
export interface StemResult {
  /** Each stem as WAV bytes (mono, 16-bit, at the analysis rate), also kept for listening. */
  stems: Record<StemName, ArrayBuffer>;
  /** What the transcriber heard in the bass, vocal and instrument stems. */
  notes: StemNotes;
}

/** `download` marks progress of fetching the model, which comes before the song's own work. */
export type StemAnalyzer = (
  songId: string,
  onProgress: (p: number, label: string, download?: boolean) => void,
  signal: AbortSignal,
) => Promise<StemResult>;

const abortError = () => new DOMException('analysis cancelled', 'AbortError');

/** A stem at the model's rate, mono, brought to the analysis rate by the browser's resampler. */
async function toAnalysisRate(stem: Float32Array): Promise<Float32Array> {
  const buffer = new AudioBuffer({ length: stem.length, numberOfChannels: 1, sampleRate: MODEL_RATE });
  buffer.copyToChannel(stem as Float32Array<ArrayBuffer>, 0);
  const ctx = new OfflineAudioContext(1, Math.ceil((stem.length * ANALYSIS_SAMPLE_RATE) / MODEL_RATE), ANALYSIS_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/** The song in stereo at the model's rate. */
async function modelInput(buffer: AudioBuffer): Promise<[Float32Array, Float32Array]> {
  const ctx = new OfflineAudioContext(2, Math.ceil(buffer.duration * MODEL_RATE), MODEL_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const out = await ctx.startRendering();
  return [out.getChannelData(0).slice(), out.getChannelData(1).slice()];
}

/**
 * Separates a song into drums, bass, vocals and the other instruments with the stem model, and
 * transcribes the pitched stems. It downloads the model first when it is not on this device yet.
 */
export const stemAnalyzer: StemAnalyzer = async (songId, onProgress, signal) => {
  const device = await analysisDevice();
  if (device === 'none')
    throw new Error('Analyzing is switched off on this device (the development switch). Charts can still be made by hand.');

  if (stemModel.snapshot().state !== 'ready') {
    const report = () => {
      const s = stemModel.snapshot();
      if (s.state === 'downloading') onProgress(s.received / s.total, 'Downloading the analysis model', true);
    };
    report();
    const stop = stemModel.subscribe(report);
    try {
      await stemModel.ensure();
    } finally {
      stop();
    }
  }
  if (signal.aborted) throw abortError();

  onProgress(0, 'Decoding');
  const clock = new Stopwatch();
  const [left, right] = await modelInput(await loadSongBuffer(songId));
  clock.lap('decoding');
  const pitchModelUrl = new URL(`${import.meta.env.BASE_URL}models/basic-pitch/nmp.onnx`, location.href).href;
  // The app runs the models itself: it is handed them once and keeps them (see analysis/native.ts).
  const native = device === 'native' ? { key: stemModel.source.id, entry: stemModel.source.entry } : undefined;
  if (native) {
    await storeModel(
      native.key,
      stemModel.source.files.map((f) => f.name),
      async () => (await stemModel.load()).files,
    );
    await storeBundledModel(PITCH_MODEL, pitchModelUrl);
  }
  const model = native ? null : await stemModel.load();
  if (signal.aborted) throw abortError();
  clock.lap('loading the model');

  // In WebKit the browser's graphics card path cannot keep going in the background (see work).
  const pausable = device === 'gpu' && onWebKit();
  const overlap = devOverlap();
  const length = left.length;
  const count = segmentOffsets(length, overlap).length;
  // What the stems are put together with afterwards: the song itself goes to the worker.
  const level = songLevel(left, right);
  const separated = await work(
    () => {
      // A piece that may be run again (see work) gets copies of the song and the model; otherwise
      // they are handed over, not copied: 90 MB of model and 86 MB of song for four minutes.
      const own = (a: Float32Array) => (pausable ? a.slice() : a);
      const song = { left: own(left), right: own(right) };
      const files = model?.files.map((f) => ({ name: f.name, data: pausable ? f.data.slice(0) : f.data }));
      const req: SeparationRequest = {
        type: 'separate',
        ...song,
        ...(files ? { model: { entry: model!.entry, files, prepared: model!.prepared } } : { native }),
        device,
        first: 0,
        count,
        overlap,
      };
      return { req, transfer: [song.left.buffer, song.right.buffer, ...(files ?? []).map((f) => f.data)] };
    },
    pausable,
    onProgress,
    signal,
  );
  if (separated.type !== 'part') throw new Error('The song could not be separated into stems (the analysis answered out of turn).');
  await heldFree(onProgress, signal);
  // A graphics card that failed to load the stem model is not asked to transcribe.
  const used: ModelDevice = separated.device;
  clock.lap(`separating on ${used}`);
  const full = joinPartsOf(length, level, [separated.part]);
  const stemsByName = {} as Record<StemName, Float32Array>;
  MODEL_STEMS.forEach((name, i) => (stemsByName[name] = full[i]));

  let rated: Record<StemName, Float32Array>;
  try {
    // Each resampler renders on a thread of its own, so the four run side by side.
    const resampled = await Promise.all(STEM_NAMES.map((name) => toAnalysisRate(stemsByName[name])));
    rated = Object.fromEntries(STEM_NAMES.map((name, i) => [name, resampled[i]])) as Record<StemName, Float32Array>;
  } catch (err) {
    throw new Error(`The stems could not be prepared (${(err as Error).message}).`);
  }
  clock.lap('resampling');
  const stems = {} as Record<StemName, ArrayBuffer>;
  for (const name of STEM_NAMES) stems[name] = wavBytes(rated[name], ANALYSIS_SAMPLE_RATE);
  clock.lap('wav');
  const done = await work(
    () => {
      const pitched = { bass: rated.bass.slice(), vocals: rated.vocals.slice(), other: rated.other.slice() };
      return {
        req: { type: 'transcribe', stems: pitched, device: used, pitchModelUrl },
        transfer: Object.values(pitched).map((s) => s.buffer),
      };
    },
    pausable,
    onProgress,
    signal,
  );
  if (done.type !== 'done') throw new Error('The stems could not be transcribed (the analysis answered out of turn).');
  clock.lap('transcribing');
  console.info('[analysis]', `stems took ${clock}`);
  return { stems, notes: done.notes };
};

const PAUSED = 'Paused while Soundwave is in the background';

/**
 * Runs one piece of the work in a worker of its own, which ends with it. `make` gives the request
 * (fresh copies of what it hands over, as the worker takes them), so the piece can be run again.
 *
 * When `pausable`, the piece waits while the page is in the background and starts over once it is
 * back. WebKit closes a page in the background above 4 GB, and the stem model on the graphics card
 * takes about 3.6 GB there, and WebKit's own bookkeeping for it more: a piece under way when the
 * page goes to the background is stopped at once, its worker ended, and run again when the player
 * comes back. (The desktop app runs the models itself there, see analysis/native.ts: this is for
 * Safari, and Macs the app has no runtime for.)
 */
async function work(
  make: () => { req: SeparationRequest; transfer: Transferable[] },
  pausable: boolean,
  onProgress: (p: number, label: string) => void,
  signal: AbortSignal,
): Promise<Extract<SeparationResponse, { type: 'part' | 'done' }>> {
  let last = 0;
  const progress = (p: number, label: string) => {
    last = p;
    onProgress(p, label);
  };
  for (;;) {
    if (pausable && document.hidden) {
      onProgress(last, PAUSED);
      await whenVisible(signal);
    }
    const background = new AbortController();
    const hidden = () => pausable && document.hidden && background.abort();
    document.addEventListener('visibilitychange', hidden);
    try {
      const { req, transfer } = make();
      return await inWorker(req, transfer, progress, signal, background.signal);
    } catch (err) {
      if (signal.aborted || !background.signal.aborted) throw err;
      // Sent to the background: the round starts over when the page is back.
    } finally {
      document.removeEventListener('visibilitychange', hidden);
    }
  }
}

/** Resolves once the page is in view again (or rejects when the analysis is cancelled). */
function whenVisible(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const check = () => {
      if (document.hidden) return;
      done();
      resolve();
    };
    const cancel = () => {
      done();
      reject(abortError());
    };
    const done = () => {
      document.removeEventListener('visibilitychange', check);
      signal.removeEventListener('abort', cancel);
    };
    document.addEventListener('visibilitychange', check);
    signal.addEventListener('abort', cancel, { once: true });
  });
}

/** Waits while analyzing is held, saying so (see analysis/hold.ts); a cancelled analysis stops waiting. */
async function heldFree(onProgress: (p: number, label: string) => void, signal: AbortSignal) {
  const reason = analysisHold.held;
  if (!reason) return;
  onProgress(SEPARATED, reason);
  await new Promise<void>((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true });
    void analysisHold.free().then(resolve);
  });
  if (signal.aborted) throw abortError();
}

/** How far along a song's bar is once it is separated, before it is transcribed (see the separation worker). */
const SEPARATED = 0.9;

/** Development only: `localStorage['soundwave.dev.stem-overlap'] = '0.1'` separates with another overlap, to compare. */
function devOverlap(): number | undefined {
  if (!import.meta.env.DEV) return undefined;
  try {
    const set = Number(localStorage.getItem('soundwave.dev.stem-overlap') ?? NaN);
    return set >= 0 && set < 1 ? set : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whether a separation on `device` gets helpers (see transform.ts). They keep about 0.5 GB more in
 * the page while a song separates. On a graphics card they make separating about twice as fast; on
 * a processor about 4%, which is not worth the memory on the phones that take that path, nor in
 * WebKit, which closes a page for its memory first. Development only:
 * `localStorage['soundwave.dev.stem-helpers'] = 'off'` (or `'on'`) to compare.
 */
function helpersWanted(device: ModelDevice): boolean {
  if (import.meta.env.DEV) {
    try {
      const set = localStorage.getItem('soundwave.dev.stem-helpers');
      if (set === 'off' || set === 'on') return set === 'on';
    } catch {
      /* storage unavailable */
    }
  }
  return device === 'gpu' && !onWebKit();
}

/** Starts the helpers of one separation and gives back a port to each; none where workers cannot be started. */
function startHelpers(): { ports: MessagePort[]; stop(): void } | null {
  const workers: Worker[] = [];
  try {
    const ports: MessagePort[] = [];
    for (let i = 0; i < HELPERS; i++) {
      const helper = new Worker(new URL('./transform.worker.ts', import.meta.url), { type: 'module' });
      workers.push(helper);
      const channel = new MessageChannel();
      helper.postMessage({ type: 'port', port: channel.port1 } satisfies HelperPort, [channel.port1]);
      ports.push(channel.port2);
    }
    return { ports, stop: () => workers.forEach((w) => w.terminate()) };
  } catch (err) {
    workers.forEach((w) => w.terminate());
    console.warn('the stem separation helpers could not be started; the separation does their work itself', err);
    return null;
  }
}

/** Runs one piece of the work in a worker of its own, which ends with it. */
function inWorker(
  req: SeparationRequest,
  transfer: Transferable[],
  onProgress: (p: number, label: string) => void,
  ...signals: AbortSignal[]
): Promise<Extract<SeparationResponse, { type: 'part' | 'done' }>> {
  if (signals.some((s) => s.aborted)) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    // Separating: the work around the model goes to helpers of its own (see transform.ts).
    const helpers = req.type === 'separate' && helpersWanted(req.device) ? startHelpers() : null;
    if (helpers && req.type === 'separate') {
      req = { ...req, helpers: helpers.ports };
      transfer = [...transfer, ...helpers.ports];
    }
    // A separation pauses between segments while analyzing is held (see analysis/hold.ts).
    let lastProgress = 0;
    let unwatch = () => {};
    if (req.type === 'separate') {
      req = { ...req, held: !!analysisHold.held };
      unwatch = analysisHold.watch((reason) => {
        worker.postMessage({ type: 'hold', on: !!reason } satisfies SeparationRequest);
        if (reason) onProgress(lastProgress, reason);
      });
    }
    const stop = () => {
      end();
      reject(abortError());
    };
    for (const s of signals) s.addEventListener('abort', stop, { once: true });
    const end = () => {
      for (const s of signals) s.removeEventListener('abort', stop);
      worker.terminate();
      helpers?.stop();
      unwatch();
    };
    worker.onmessage = (e: MessageEvent<SeparationResponse>) => {
      // The worker's fetches, where it cannot make them itself (see app/workerFetch).
      if (serveWorkerFetch(worker, e.data)) return;
      const m = e.data;
      if (m.type === 'progress') {
        lastProgress = m.progress;
        // The segment under way when the hold began still reports; the bar keeps saying why it waits.
        return onProgress(m.progress, (req.type === 'separate' && analysisHold.held) || m.step);
      }
      if (m.type === 'log') return console.info('[analysis]', m.message);
      end();
      if (m.type === 'error')
        reject(
          new Error(
            req.type === 'separate'
              ? `The song could not be separated into stems (${m.message}).`
              : `The stems could not be transcribed (${m.message}).`,
          ),
        );
      else resolve(m);
    };
    worker.onerror = (e) => {
      end();
      reject(new Error(`The song could not be separated into stems (${e.message || 'the analysis stopped unexpectedly'}).`));
    };
    worker.postMessage(req, transfer);
  });
}
