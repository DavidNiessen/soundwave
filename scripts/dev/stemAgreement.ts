/**
 * Compares the game's analysis of a song under two ways of separating it (a model variant, another
 * overlap, another device), in the dev page: how alike the stems are, and how alike the charts made
 * from them are. Used to judge a faster separation against the one in use.
 *
 * In the dev page's console, with the song in the library (its id from __analysis.snapshot()):
 *
 *   const h = await import('/scripts/dev/stemAgreement.ts');
 *   await h.record(id, 'base');            // analyzes it as the switches now say, and keeps the result
 *   // change localStorage['soundwave.dev.stem-model' | 'soundwave.dev.stem-overlap' |
 *   // 'soundwave.dev.analysis-device'], reload, import again, then:
 *   await h.record(id, 'fp16');
 *   h.report(await h.compare(id, 'base', 'fp16'));
 *
 * Results are kept in the page's IndexedDB (soundwave-dev-variants), so they outlive reloads.
 */
import { openDB } from 'idb';
import type { AnalysisResult, StemName } from '../../src/analysis/types';
import { generateAll } from '../../src/chart/generator';
import { PARTS, type Difficulty, type Note, type Part } from '../../src/chart/types';
import { getStem } from '../../src/storage/db';

const STEMS: StemName[] = ['drums', 'bass', 'vocals', 'other'];
const LEVELS: Difficulty[] = ['expert', 'hard'];

interface Run {
  analysis: AnalysisResult;
  stems: Partial<Record<StemName, Float32Array>>;
  /** The [analysis] lines the run printed. */
  log: string[];
}

const runs = () => openDB('soundwave-dev-variants', 1, { upgrade: (d) => void d.createObjectStore('runs') });

/** Mono 16-bit PCM WAV, as the game stores its stems (audio/wav.ts). */
function readWav(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  let at = 12;
  while (at < bytes.byteLength - 8) {
    const id = String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));
    const size = view.getUint32(at + 4, true);
    if (id === 'data') {
      const out = new Float32Array(Math.floor(size / 2));
      for (let i = 0; i < out.length; i++) out[i] = view.getInt16(at + 8 + i * 2, true) / 32768;
      return out;
    }
    at += 8 + size;
  }
  throw new Error('no data in the stem');
}

interface Manager {
  enqueue(id: string, force?: boolean): void;
  snapshot(): Record<string, { state: string; error?: string }>;
  analysis(id: string): Promise<AnalysisResult | undefined>;
}

/** Analyzes the song again as the dev switches now say, and keeps its analysis and stems as `name`. */
export async function record(id: string, name: string): Promise<string[]> {
  const manager = (window as unknown as { __analysis: Manager }).__analysis;
  const log: string[] = [];
  const info = console.info;
  console.info = (...a: unknown[]) => {
    if (a[0] === '[analysis]') log.push(a.slice(1).join(' '));
    info(...a);
  };
  try {
    manager.enqueue(id, true);
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const s = manager.snapshot()[id];
      if (s?.state === 'error') throw new Error(s.error);
      if (s?.state === 'ready' && log.some((l) => l.startsWith('song analyzed'))) break;
    }
  } finally {
    console.info = info;
  }
  const analysis = (await manager.analysis(id))!;
  const stems: Run['stems'] = {};
  for (const stem of STEMS) {
    const blob = await getStem(id, stem);
    if (blob) stems[stem] = readWav(await blob.arrayBuffer());
  }
  await (await runs()).put('runs', { analysis, stems, log } satisfies Run, `${id}:${name}`);
  return log.filter((l) => /separated|song analyzed/.test(l));
}

/** How alike `b` is to `a`, in decibels: the level of `a` over the level of their difference. */
function snr(a: Float32Array, b: Float32Array): number {
  let signal = 0;
  let noise = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    signal += a[i] * a[i];
    noise += (a[i] - b[i]) ** 2;
  }
  return noise ? 10 * Math.log10(signal / noise) : Infinity;
}

/** How alike two charts are: their notes' start times matched within 50 ms (F1), and of those matched, how many are in the same lane. */
function agreement(a: Note[], b: Note[]): { f1: number; lanes: number; notes: [number, number] } {
  const used = new Uint8Array(b.length);
  let matched = 0;
  let sameLane = 0;
  let j = 0;
  for (const n of a) {
    while (j < b.length && b[j].t < n.t - 0.05) j++;
    let best = -1;
    for (let k = j; k < b.length && b[k].t <= n.t + 0.05; k++) {
      if (used[k]) continue;
      if (best < 0 || (b[k].lane === n.lane && b[best].lane !== n.lane) || Math.abs(b[k].t - n.t) < Math.abs(b[best].t - n.t)) best = k;
    }
    if (best < 0) continue;
    used[best] = 1;
    matched++;
    if (b[best].lane === n.lane) sameLane++;
  }
  const f1 = a.length + b.length ? (2 * matched) / (a.length + b.length) : 1;
  return { f1, lanes: matched ? sameLane / matched : 1, notes: [a.length, b.length] };
}

export interface Comparison {
  song: string;
  stems: Partial<Record<StemName, number>>;
  charts: { part: Part; level: Difficulty; f1: number; lanes: number; notes: [number, number] }[];
  separation: [string | undefined, string | undefined];
}

/** How the run kept as `b` differs from the one kept as `a`. */
export async function compare(id: string, a: string, b: string): Promise<Comparison> {
  const d = await runs();
  const ra = (await d.get('runs', `${id}:${a}`)) as Run | undefined;
  const rb = (await d.get('runs', `${id}:${b}`)) as Run | undefined;
  if (!ra || !rb) throw new Error(`no run kept as ${ra ? b : a}`);
  const stems: Comparison['stems'] = {};
  for (const s of STEMS) if (ra.stems[s] && rb.stems[s]) stems[s] = snr(ra.stems[s]!, rb.stems[s]!);
  const charts: Comparison['charts'] = [];
  for (const part of PARTS) {
    const ca = generateAll(ra.analysis, part, id);
    const cb = generateAll(rb.analysis, part, id);
    for (const level of LEVELS) charts.push({ part, level, ...agreement(ca[level].notes, cb[level].notes) });
  }
  const sep = (r: Run) => r.log.find((l) => l.startsWith('separated'));
  return { song: id.slice(0, 8), stems, charts, separation: [sep(ra), sep(rb)] };
}

/** One line per comparison: the stems' SNR, then each part's F1 and same-lane share at expert and hard. */
export function report(...cs: Comparison[]): string {
  const pct = (x: number) => `${Math.round(x * 100)}`;
  return cs
    .map(
      (c) =>
        `${c.song} stems ${STEMS.map((s) => `${s} ${c.stems[s]?.toFixed(1) ?? '-'} dB`).join(', ')} | ` +
        c.charts.map((r) => `${r.part}/${r.level[0]} F1 ${pct(r.f1)} lane ${pct(r.lanes)} (${r.notes.join('/')})`).join(', '),
    )
    .join('\n');
}
