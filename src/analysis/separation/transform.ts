import {
  PAIR_CHANNELS,
  PAIR_PLANES,
  PAIRS,
  PairSums,
  partSpan,
  prepareSegment,
  songLevel,
  type PairOutput,
  type SegmentInfo,
  type SongLevel,
  type StemPart,
} from './separate';
import { BINS, FRAMES, SEGMENT } from './stft';

/**
 * The work around the stem model, done by helper workers (transform.worker.ts) while the model
 * runs: one prepares the segments (their spectrograms), two turn the model's output back into
 * sound, a pair of stems each. On a graphics card the runtime needs its worker's thread to keep
 * the card fed: with that work on the same thread, a segment took 313 ms where the network alone
 * takes about 110 ms. The numbers are the same as separatePart's, done on other threads.
 *
 * The page starts the helpers (a worker started by a worker cannot load the game's files in the
 * macOS app) and hands the separation worker a message port to each.
 */

export type TransformRequest =
  | { type: 'song'; left: Float32Array; right: Float32Array; level: SongLevel; offsets: number[] }
  | { type: 'prepare'; k: number; x: Float32Array; xt: Float32Array }
  | { type: 'pair'; from: number; to: number; withWeights: boolean }
  | { type: 'finish'; info: SegmentInfo; x: Float32Array; xt: Float32Array }
  | { type: 'part' };

export type TransformResponse =
  | { type: 'prepared'; info: SegmentInfo; x: Float32Array; xt: Float32Array }
  | { type: 'finished'; x: Float32Array; xt: Float32Array }
  | { type: 'part'; sums: Float32Array[]; weights: Float32Array | null }
  | { type: 'error'; message: string };

/** How the page hands a helper its port. */
export interface HelperPort {
  type: 'port';
  port: MessagePort;
}

/** Helpers to start per song: one to prepare, then one per pair of stems. */
export const HELPERS = 1 + PAIRS;

/** One helper, as the separation worker sees it: its answers come in the order it was asked. */
class Helper {
  private waiting: { resolve: (m: TransformResponse) => void; reject: (e: Error) => void }[] = [];
  private failed: Error | null = null;

  constructor(private readonly port: MessagePort) {
    port.onmessage = (e: MessageEvent<TransformResponse>) => {
      const m = e.data;
      if (m.type === 'error') return this.fail(new Error(m.message));
      this.waiting.shift()?.resolve(m);
    };
  }

  private fail(err: Error) {
    this.failed = err;
    for (const w of this.waiting.splice(0)) w.reject(err);
  }

  tell(m: TransformRequest, transfer: Transferable[] = []) {
    this.port.postMessage(m, transfer);
  }

  ask<T extends TransformResponse>(m: TransformRequest, transfer: Transferable[] = []): Promise<T> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({ resolve: resolve as (m: TransformResponse) => void, reject });
      this.port.postMessage(m, transfer);
    });
  }

  close() {
    this.port.close();
  }
}

/** Buffers lent out and given back; `take` waits while all are out. */
class Pool<T> {
  private waiting: ((t: T) => void)[] = [];
  constructor(private readonly free: T[]) {}
  take(): Promise<T> {
    const t = this.free.pop();
    return t ? Promise.resolve(t) : new Promise((resolve) => this.waiting.push(resolve));
  }
  give(t: T) {
    const w = this.waiting.shift();
    if (w) w(t);
    else this.free.push(t);
  }
}

/**
 * The network for one segment: starts it on `x` and `xt`, and resolves once the inputs may be
 * reused, with a function that writes each pair's share of its output into `outs` (see pairOutput).
 * On a graphics card that function reads the output back while the next segment is already running.
 */
export type PairModel = (x: Float32Array, xt: Float32Array, outs: PairOutput[]) => Promise<() => Promise<void>>;

const inputs = () => ({ x: new Float32Array(4 * BINS * FRAMES), xt: new Float32Array(2 * SEGMENT) });
const outputs = (): PairOutput => ({ x: new Float32Array(PAIR_PLANES), xt: new Float32Array(PAIR_CHANNELS) });

/**
 * separatePart with the helpers on `ports` (HELPERS of them): the same segments, the same stems.
 * `left` and `right` are handed to the preparing helper and cannot be used here afterwards.
 */
export async function separateWithHelpers(
  left: Float32Array,
  right: Float32Array,
  model: PairModel,
  first: number,
  count: number,
  ports: MessagePort[],
  onProgress: (p: number) => void = () => {},
  overlap?: number,
  /** Awaited before each segment: the separation pauses while it waits. */
  between: () => Promise<void> = () => Promise.resolve(),
): Promise<StemPart> {
  const length = left.length;
  const level = songLevel(left, right);
  const { offsets, from, to } = partSpan(length, first, count, overlap);
  const [preparer, ...finishers] = ports.map((p) => new Helper(p));
  try {
    preparer.tell({ type: 'song', left, right, level, offsets }, [left.buffer, right.buffer]);
    finishers.forEach((f, i) => f.tell({ type: 'pair', from, to, withWeights: i === 0 }));

    // Two segments' inputs: one is with the network while the helper fills the other. Three outputs
    // per pair: one is written by the network, one read back, one turned into sound by a helper.
    const freeInputs: { x: Float32Array; xt: Float32Array }[] = [inputs(), inputs()];
    const outPools = finishers.map(() => new Pool([outputs(), outputs(), outputs()]));
    const prepared: Promise<Extract<TransformResponse, { type: 'prepared' }>>[] = [];
    const prepare = (k: number) => {
      const b = freeInputs.pop()!;
      prepared[k] = preparer.ask({ type: 'prepare', k, x: b.x, xt: b.xt }, [b.x.buffer, b.xt.buffer]);
    };
    for (let k = 0; k < Math.min(2, offsets.length); k++) prepare(k);

    const finished: Promise<void>[] = [];
    // The last segment the network ran, still to be read back and handed to the finishers.
    let last: { collect: () => Promise<void>; outs: PairOutput[]; info: SegmentInfo } | null = null;
    const handOver = async ({ collect, outs, info }: NonNullable<typeof last>) => {
      await collect();
      finished.push(
        Promise.all(
          finishers.map((f, p) =>
            f
              .ask<Extract<TransformResponse, { type: 'finished' }>>({ type: 'finish', info, ...outs[p] }, [
                outs[p].x.buffer,
                outs[p].xt.buffer,
              ])
              .then((back) => outPools[p].give({ x: back.x, xt: back.xt })),
          ),
        ).then(() => onProgress(Math.min(1, (info.offset + info.span) / length))),
      );
    };
    for (let k = 0; k < offsets.length; k++) {
      await between();
      const input = await prepared[k];
      const outs = await Promise.all(outPools.map((p) => p.take()));
      const collect = await model(input.x, input.xt, outs);
      freeInputs.push({ x: input.x, xt: input.xt });
      if (k + 2 < offsets.length) prepare(k + 2);
      if (last) await handOver(last);
      last = { collect, outs, info: input.info };
    }
    if (last) await handOver(last);
    await Promise.all(finished);
    const parts = await Promise.all(finishers.map((f) => f.ask<Extract<TransformResponse, { type: 'part' }>>({ type: 'part' })));
    return { from, sums: parts.flatMap((p) => p.sums), weights: parts[0].weights! };
  } finally {
    for (const h of [preparer, ...finishers]) h.close();
  }
}

/**
 * A helper's side (transform.worker.ts runs it on the port the page handed it): it prepares
 * segments, or adds one pair of stems up, as the separation worker asks.
 */
export function serveHelper(port: MessagePort) {
  let song: { left: Float32Array; right: Float32Array; level: SongLevel; offsets: number[] } | null = null;
  let pair: PairSums | null = null;
  const send = (r: TransformResponse, transfer: Transferable[] = []) => port.postMessage(r, transfer);
  const answer = (m: TransformRequest) => {
    switch (m.type) {
      case 'song':
        song = m;
        return;
      case 'prepare': {
        if (!song) throw new Error('no song to prepare');
        const info = prepareSegment(song.left, song.right, song.level, song.offsets[m.k], m.x, m.xt);
        return send({ type: 'prepared', info, x: m.x, xt: m.xt }, [m.x.buffer, m.xt.buffer]);
      }
      case 'pair':
        pair = new PairSums(m.from, m.to, m.withWeights);
        return;
      case 'finish':
        if (!pair) throw new Error('no stems to add to');
        pair.add(m.info, m);
        return send({ type: 'finished', x: m.x, xt: m.xt }, [m.x.buffer, m.xt.buffer]);
      case 'part': {
        if (!pair) throw new Error('no stems to hand back');
        const { sums, weights } = pair;
        return send({ type: 'part', sums, weights }, [...sums.map((s) => s.buffer), ...(weights ? [weights.buffer] : [])]);
      }
    }
  };
  port.onmessage = (e: MessageEvent<TransformRequest>) => {
    try {
      answer(e.data);
    } catch (err) {
      send({ type: 'error', message: (err as Error).message || String(err) });
    }
  };
}
