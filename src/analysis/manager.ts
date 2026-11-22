import { loadSongBuffer } from '../audio/songAudio';
import { generateAll } from '../chart/generator';
import { thinParts } from '../chart/presence';
import { DIFFICULTIES, PARTS, type Chart, type Difficulty, type Part } from '../chart/types';
import { chartFromNotes, chartKey, editedCount, resolveGrid, songDuration, standsAlone, type SongEdits } from '../editor/edits';
import { analysisKey, deleteAnalyses, deleteEdits, getAnalysis, getEdits, putAnalysis, putEdits, putStems } from '../storage/db';
import { writeAnalysisToFile } from '../storage/songFile';
import { serveWorkerFetch } from '../app/workerFetch';
import { stemAnalyzer, type StemAnalyzer } from './separation/analyzer';
import { analysisDevice } from './separation/support';
import {
  ANALYSIS_SAMPLE_RATE,
  ANALYSIS_VERSION,
  isAnalysisResult,
  type AnalysisResult,
  type AnalysisStep,
  type PartLines,
  type StemName,
  type StemNotes,
} from './types';
import type { WorkerRequest, WorkerResponse } from './worker';

export interface AnalysisStatus {
  state: 'idle' | 'queued' | 'analyzing' | 'ready' | 'error';
  progress?: number;
  step?: string;
  error?: string;
  /** How many of the song's charts were made or changed by hand in the track editor. */
  edited?: number;
  /** The song has a beat grid of its own (it was started from scratch), so it plays without an analysis. */
  manual?: boolean;
  /**
   * Parts the song hardly has compared with the rest of it (almost no vocals, say): they are not
   * offered for playing. A part the player wrote a chart for is never among them.
   */
  thin?: Part[];
  /** Analysed, and not a note on any part: it cannot be played or put in a set. */
  noNotes?: boolean;
}

/** Whether a song can be played and put in a set: analysed, with notes on at least one part. */
export const canPlay = (s: AnalysisStatus | undefined): boolean => s?.state === 'ready' && !s.noNotes;

const STEP_LABEL: Record<AnalysisStep, string> = {
  decoding: 'Decoding',
  spectrum: 'Listening',
  separating: 'Separating',
  rhythm: 'Finding the beat',
  harmony: 'Reading chords',
  melody: 'Transcribing',
  finishing: 'Charting',
};

/** What the separated stems give the rest of the analysis. */
export interface Assist {
  lines: PartLines;
  drumStem?: ArrayBuffer;
  /** All separated stems, kept for previewing and for timing lines by their attacks. */
  stems?: Partial<Record<StemName, ArrayBuffer>>;
  /** Raw transcription of each stem. */
  stemNotes?: StemNotes;
}

/** The rest of the analysis: decode, then run the pipeline (rhythm, harmony, lines, structure) in a worker. */
export type LocalAnalyzer = (
  songId: string,
  onProgress: (p: { step: AnalysisStep; progress: number }) => void,
  signal: AbortSignal,
  assist?: Assist,
) => Promise<AnalysisResult>;

const abortError = () => new DOMException('analysis cancelled', 'AbortError');
/** How much of the progress bar separating and transcribing the stems takes. */
const SEPARATION_SHARE = 0.85;
/** When a song has to wait for the model to download first, the download fills this much of its bar. */
const DOWNLOAD_SHARE = 0.4;

type Listener = () => void;

export class AnalysisManager {
  private status: Record<string, AnalysisStatus> = {};
  /** Bumped whenever a song is forgotten; results from an older generation are dropped. */
  private generation = new Map<string, number>();
  private current: { id: string; abort: AbortController } | null = null;
  private results = new Map<string, AnalysisResult>();
  private charts = new Map<string, Chart>();
  /** Each song's hand-edited charts, once asked for (`null`: it has none). */
  private edits = new Map<string, SongEdits | null>();
  /** Each analyzed song's thin parts, as its analysis has them (before the player's own charts count). */
  private thin = new Map<string, Part[]>();
  private queue: string[] = [];
  private running = false;
  private listeners = new Set<Listener>();

  /**
   * `separator` splits the song into stems first; every analysis in the game goes through it, and a
   * song it cannot separate is not charted. Without one (tests), the pipeline runs on the mix alone.
   */
  constructor(
    private readonly local: LocalAnalyzer = localAnalyzer,
    private readonly separator: StemAnalyzer | null = null,
  ) {}

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  snapshot = () => this.status;

  private set(id: string, s: AnalysisStatus) {
    // Progress within a step is told in whole per cent: every change redraws the menus, and the
    // separation reports far more often than a bar can show.
    const was = this.status[id];
    if (
      was &&
      s.state === 'analyzing' &&
      was.state === 'analyzing' &&
      s.step === was.step &&
      s.error === was.error &&
      Math.abs((s.progress ?? 0) - (was.progress ?? 0)) < 0.01
    )
      return;
    // What the editor made for the song rides along with whatever the analysis is doing.
    const e = this.edits.get(id) ?? undefined;
    const edited = editedCount(e);
    const thin = s.state === 'ready' ? this.thinOf(id, e) : [];
    this.status = {
      ...this.status,
      [id]: {
        state: s.state,
        progress: s.progress,
        step: s.step,
        error: s.error,
        ...(edited ? { edited } : {}),
        ...(standsAlone(e) ? { manual: true } : {}),
        ...(thin.length ? { thin } : {}),
        ...(thin.length >= PARTS.length ? { noNotes: true } : {}),
      },
    };
    for (const l of this.listeners) l();
  }

  /** The parts the song hardly has, less those the player wrote a chart for. */
  private thinOf(id: string, edits: SongEdits | undefined): Part[] {
    const a = this.results.get(id);
    if (!a) return [];
    let thin = this.thinFor.get(id) === a ? this.thin.get(id) : undefined;
    if (!thin) {
      thin = thinParts(a);
      this.thin.set(id, thin);
      this.thinFor.set(id, a);
    }
    return thin.filter((p) => !DIFFICULTIES.some((d) => (edits?.charts[chartKey(p, d)]?.length ?? 0) > 0));
  }
  /** The analysis each entry of `thin` was worked out from: a new analysis is measured again. */
  private thinFor = new Map<string, AnalysisResult>();

  /** Loads a cached analysis if there is one; otherwise queues the song when `autoQueue` is set. */
  async check(id: string, autoQueue: boolean) {
    if (this.status[id]?.state === 'analyzing' || this.status[id]?.state === 'queued') return;
    const [cached, edits] = await Promise.all([this.loadCached(id), this.editsOf(id)]);
    // It may have been queued while the storage was read.
    const now = this.status[id]?.state as AnalysisStatus['state'] | undefined;
    if (now === 'analyzing' || now === 'queued') return;
    // A song with a grid of its own (started from scratch in the editor) is playable as it is.
    if (cached || standsAlone(edits)) this.set(id, { state: 'ready' });
    else if (autoQueue) this.enqueue(id);
    else this.set(id, { state: 'idle' });
  }

  private async loadCached(id: string): Promise<AnalysisResult | undefined> {
    const mem = this.results.get(id);
    if (mem) return mem;
    for (const source of ['ml']) {
      try {
        const r = await getAnalysis<AnalysisResult>(analysisKey(id, ANALYSIS_VERSION, source));
        if (r && isAnalysisResult(r)) {
          this.results.set(id, r);
          return r;
        }
      } catch {
        /* storage unavailable */
      }
    }
    return undefined;
  }

  enqueue(id: string, force = false) {
    if (force) {
      this.results.delete(id);
      for (const k of Array.from(this.charts.keys())) if (k.startsWith(`${id}:`)) this.charts.delete(k);
    }
    if (this.queue.includes(id) || this.status[id]?.state === 'analyzing') return;
    this.queue.push(id);
    this.set(id, { state: 'queued' });
    void this.pump();
  }

  /**
   * Drops everything known about a song (removed, or re-imported). A running analysis of it is
   * cancelled, and anything it still produces is ignored, so no stale error or cache survives.
   */
  forget(id: string) {
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    this.queue = this.queue.filter((q) => q !== id);
    this.results.delete(id);
    this.edits.delete(id);
    this.thin.delete(id);
    this.thinFor.delete(id);
    for (const k of Array.from(this.charts.keys())) if (k.startsWith(`${id}:`)) this.charts.delete(k);
    if (this.current?.id === id) this.current.abort.abort();
    const { [id]: _, ...rest } = this.status;
    this.status = rest;
    for (const l of this.listeners) l();
  }

  private async pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift()!;
      const gen = this.generation.get(id) ?? 0;
      const abort = new AbortController();
      this.current = { id, abort };
      const stale = () => (this.generation.get(id) ?? 0) !== gen;
      try {
        const { result, stems } = await this.analyze(id, abort.signal);
        if (stale()) continue;
        this.results.set(id, result);
        if (stems && Object.keys(stems).length) {
          try {
            const blobs = Object.fromEntries(Object.entries(stems).map(([k, v]) => [k, new Blob([v], { type: 'audio/wav' })]));
            await putStems(id, blobs);
          } catch {
            /* stems are only for previewing */
          }
        }
        try {
          // One cached result per song: a re-analysis replaces whatever was there.
          await deleteAnalyses(id);
          await putAnalysis(analysisKey(id, ANALYSIS_VERSION, result.source), id, result);
        } catch {
          /* cache is best-effort */
        }
        try {
          // The song's .soundwave file carries its analysis, so an exported song brings its charts.
          if (!stale()) await writeAnalysisToFile(id, result);
        } catch (e) {
          console.warn('could not write the analysis into the song file', e);
        }
        if (stale()) continue;
        this.set(id, { state: 'ready' });
      } catch (e) {
        if (!stale()) this.set(id, { state: 'error', error: (e as Error).message });
      } finally {
        this.current = null;
      }
    }
    this.running = false;
  }

  private async analyze(id: string, signal: AbortSignal): Promise<{ result: AnalysisResult; stems?: Assist['stems'] }> {
    const progress = (s: AnalysisStatus) => {
      if (!signal.aborted) this.set(id, s);
    };
    // The song is separated into stems and each pitched stem transcribed; the pipeline then builds
    // the lines from those and adds the rhythm (beat grid, drums from the drum stem) and structure.
    let assist: Assist | undefined;
    // Where the song's own work starts on its bar: further in when the bar first shows the download.
    let start = 0;
    if (this.separator) {
      const r = await this.separator(
        id,
        (p, step, download) => {
          if (download) start = DOWNLOAD_SHARE;
          progress({ state: 'analyzing', progress: download ? p * DOWNLOAD_SHARE : start + p * SEPARATION_SHARE * (1 - start), step });
        },
        signal,
      );
      assist = {
        // Each line is rebuilt from its stem; a stem with no notes leaves its line empty.
        lines: { bass: [], lead: [], vocals: [] },
        // Copy: the worker transfer and IndexedDB both need their own buffers.
        drumStem: r.stems.drums.slice(0),
        stems: r.stems,
        stemNotes: r.notes,
      };
    }
    if (signal.aborted) throw abortError();
    const base = assist ? start + SEPARATION_SHARE * (1 - start) : 0;
    progress({ state: 'analyzing', progress: base, step: STEP_LABEL.decoding });
    const result = await this.local(
      id,
      (p) => progress({ state: 'analyzing', progress: base + p.progress * (1 - base), step: STEP_LABEL[p.step] }),
      signal,
      assist,
    );
    return { result, stems: assist?.stems };
  }

  async analysis(id: string): Promise<AnalysisResult | undefined> {
    return this.loadCached(id);
  }

  /** The song's hand-edited charts and grid, if it has any. */
  async editsOf(id: string): Promise<SongEdits | undefined> {
    const mem = this.edits.get(id);
    if (mem !== undefined) return mem ?? undefined;
    let stored: SongEdits | undefined;
    try {
      stored = await getEdits(id);
    } catch {
      /* storage unavailable */
    }
    // Something may have been saved while this was reading.
    if (this.edits.get(id) === undefined) this.edits.set(id, stored ?? null);
    return this.edits.get(id) ?? undefined;
  }

  /**
   * Stores what the editor made for a song (or, with `null`, removes it all). The song's charts are
   * rebuilt from it the next time they are asked for.
   */
  async saveEdits(id: string, edits: SongEdits | null): Promise<void> {
    this.edits.set(id, edits);
    for (const k of Array.from(this.charts.keys())) if (k.startsWith(`${id}:`)) this.charts.delete(k);
    const now = this.status[id];
    // A song that stands on its own grid is ready; otherwise the status keeps what the analysis says.
    if (standsAlone(edits ?? undefined) && (!now || now.state === 'idle' || now.state === 'error')) this.set(id, { state: 'ready' });
    else if (now) this.set(id, now);
    try {
      if (edits) await putEdits(id, edits);
      else await deleteEdits(id);
    } catch {
      /* storage unavailable: the edits last as long as the game is open */
    }
  }

  /**
   * Takes a song out of the queue and stops its analysis, without forgetting what else is known
   * about it (it is about to be charted by hand instead).
   */
  cancel(id: string) {
    const s = this.status[id]?.state;
    if (s !== 'queued' && s !== 'analyzing') return;
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    this.queue = this.queue.filter((q) => q !== id);
    if (this.current?.id === id) this.current.abort.abort();
    this.set(id, { state: 'idle' });
  }

  /** The chart the game writes from the analysis, whatever was edited by hand. */
  async generated(id: string, part: Part, difficulty: Difficulty): Promise<Chart | undefined> {
    const key = `${id}:${part}:${difficulty}:generated`;
    const hit = this.charts.get(key);
    if (hit) return hit;
    const a = await this.loadCached(id);
    if (!a) return undefined;
    // All difficulties are derived from expert in one pass, so build and cache them together.
    const all = generateAll(a, part, id);
    for (const [d, c] of Object.entries(all)) this.charts.set(`${id}:${part}:${d}:generated`, c);
    return all[difficulty];
  }

  /** The chart to play: the one edited by hand when there is one, else the one written from the analysis. */
  async chart(id: string, part: Part, difficulty: Difficulty): Promise<Chart | undefined> {
    const key = `${id}:${part}:${difficulty}`;
    const hit = this.charts.get(key);
    if (hit) return hit;
    const edits = await this.editsOf(id);
    const custom = edits?.charts[chartKey(part, difficulty)];
    const a = await this.loadCached(id);
    let chart: Chart | undefined;
    if (custom || (!a && standsAlone(edits))) {
      const duration = songDuration(edits, a);
      const grid = resolveGrid(edits, a, duration);
      // A part of a hand-made song that has no chart yet is an empty one.
      if (grid) chart = chartFromNotes(custom ?? [], part, difficulty, grid, duration);
    }
    chart ??= await this.generated(id, part, difficulty);
    if (chart) this.charts.set(key, chart);
    return chart;
  }
}

const localAnalyzer: LocalAnalyzer = async (id, onProgress, signal, assist) => {
  const buffer = await loadSongBuffer(id);
  if (signal.aborted) throw abortError();
  const audio = await toAnalysisSignal(buffer);
  if (signal.aborted) throw abortError();
  // Decoding into a 22.05 kHz context resamples each stem to the analysis rate.
  const decodeStem = async (data: ArrayBuffer | undefined) => {
    if (!data) return undefined;
    try {
      const decoded = await new OfflineAudioContext(1, 1, ANALYSIS_SAMPLE_RATE).decodeAudioData(data.slice(0));
      const out = new Float32Array(audio.length);
      out.set(decoded.getChannelData(0).subarray(0, audio.length));
      return out;
    } catch (e) {
      console.warn('could not decode a stem; falling back to the full mix for it', e);
      return undefined;
    }
  };
  const drumSignal = await decodeStem(assist?.drumStem);
  const stems: Partial<Record<StemName, Float32Array>> = {};
  if (assist?.stemNotes) {
    for (const name of ['bass', 'vocals', 'other'] as const) {
      const s = await decodeStem(assist.stems?.[name]);
      if (s) stems[name] = s;
    }
  }
  // The beat model is small enough for any device: without a graphics card it runs on the processor.
  const beatModel = {
    url: new URL(`${import.meta.env.BASE_URL}models/beat-this/small0.onnx`, location.href).href,
    device: (await analysisDevice()) === 'gpu' ? ('gpu' as const) : ('cpu' as const),
  };
  return runWorker(audio, onProgress, signal, assist?.lines, drumSignal, stems, assist?.stemNotes, beatModel);
};

/** Mono, 22.05 kHz copy of the song for analysis. */
export async function toAnalysisSignal(buffer: AudioBuffer): Promise<Float32Array> {
  const length = Math.ceil(buffer.duration * ANALYSIS_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(1, length, ANALYSIS_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return rendered.getChannelData(0).slice();
}

function runWorker(
  signal: Float32Array,
  onProgress: (p: { step: AnalysisStep; progress: number }) => void,
  abort: AbortSignal,
  lines?: PartLines,
  drumSignal?: Float32Array,
  stems?: Partial<Record<StemName, Float32Array>>,
  stemNotes?: StemNotes,
  beatModel?: WorkerRequest['beatModel'],
): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    abort.addEventListener(
      'abort',
      () => {
        worker.terminate();
        reject(abortError());
      },
      { once: true },
    );
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      // The worker's fetches, where it cannot make them itself (see app/workerFetch).
      if (serveWorkerFetch(worker, e.data)) return;
      const m = e.data;
      if (m.type === 'progress') onProgress(m.progress);
      else if (m.type === 'log') console.info('[analysis]', m.message);
      else {
        worker.terminate();
        if (m.type === 'done') resolve(m.result);
        else reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Analysis worker crashed'));
    };
    const req: WorkerRequest = {
      type: 'analyze',
      signal,
      lines,
      drumSignal,
      stems,
      stemNotes,
      beatModel,
    };
    const transfer = [signal.buffer, ...(drumSignal ? [drumSignal.buffer] : []), ...Object.values(stems ?? {}).map((s) => s.buffer)];
    worker.postMessage(req, transfer);
  });
}

export const analysisManager = new AnalysisManager(localAnalyzer, stemAnalyzer);
