/**
 * Interface sound effects: short orchestral recordings in public/audio/sfx, rendered by
 * tools/audio/sfx.py in the key of the menu theme. They share the game's AudioContext but have
 * their own volume and go straight to the master output, so they neither follow the music volume
 * nor drive the visualizer.
 */
import { getEngine } from './engine';

export type Sfx =
  | 'move'
  | 'select'
  | 'back'
  | 'tab'
  | 'toggle-on'
  | 'toggle-off'
  | 'launch'
  | 'star'
  | 'count'
  | 'best'
  | 'pause'
  | 'resume'
  | 'error'
  | 'add'
  | 'hold'
  | 'finale';

/**
 * How many takes each effect has on disk (`name-1.ogg` …; a single take is just `name.ogg`).
 * "move" rotates through its takes; "star" picks one by index, each a step higher.
 */
const TAKES: Record<Sfx, number> = {
  move: 3,
  select: 1,
  back: 1,
  tab: 1,
  'toggle-on': 1,
  'toggle-off': 1,
  launch: 1,
  star: 5,
  count: 1,
  best: 1,
  pause: 1,
  resume: 1,
  error: 1,
  add: 1,
  hold: 1,
  finale: 1,
};

/** The files are levelled against each other when rendered; this sits them against the music. */
const TRIM = 0.9;

let out: GainNode | null = null;
let volume = 0.7;
let loading: Promise<void> | null = null;
const buffers = new Map<string, AudioBuffer>();
const lastPlayed = new Map<Sfx, number>();
const rotation = new Map<Sfx, number>();

const files = (name: Sfx) => (TAKES[name] > 1 ? Array.from({ length: TAKES[name] }, (_, i) => `${name}-${i + 1}`) : [name]);

/** Effects volume, 0..1. */
export function setSfxVolume(v: number) {
  volume = Math.max(0, Math.min(1, v));
  if (out) out.gain.value = volume * TRIM;
}

/** Fetches and decodes every effect. Safe to call more than once; effects are silent until it finishes. */
export function loadSfx(): Promise<void> {
  loading ??= (async () => {
    const ctx = getEngine().ctx;
    const names = (Object.keys(TAKES) as Sfx[]).flatMap(files);
    await Promise.all(
      names.map(async (file) => {
        try {
          const res = await fetch(`${import.meta.env.BASE_URL}audio/sfx/${file}.ogg`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          buffers.set(file, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (err) {
          console.warn(`Sound effect "${file}" is unavailable`, err);
        }
      }),
    );
  })();
  return loading;
}

/** The effects' output, for sounds made live rather than played from a file (audio/showdownSfx.ts). */
export const sfxOutput = () => graph();

function graph(): { ctx: AudioContext; out: GainNode } | null {
  if (volume <= 0) return null;
  const ctx = getEngine().ctx;
  if (ctx.state !== 'running') {
    // Browsers start audio only after a gesture; try, and skip this sound if it isn't allowed yet.
    void ctx.resume().catch(() => {});
    if ((ctx.state as AudioContextState) !== 'running') return null;
  }
  if (!out) {
    out = ctx.createGain();
    out.gain.value = volume * TRIM;
    out.connect(getEngine().master);
  }
  return { ctx, out };
}

/** Minimum spacing (s) per effect, so rapid repeats (holding a direction) don't pile up. */
const SPACING: Partial<Record<Sfx, number>> = { move: 0.045, count: 0.035, tab: 0.06 };

export function playSfx(name: Sfx, opts: { index?: number } = {}) {
  const g = graph();
  if (!g) return;
  const { ctx, out } = g;
  const t = ctx.currentTime + 0.005;
  const gap = SPACING[name];
  if (gap && t - (lastPlayed.get(name) ?? -1) < gap) return;
  const takes = files(name);
  let take: number;
  if (opts.index !== undefined) take = Math.max(0, Math.min(takes.length - 1, opts.index));
  else {
    take = rotation.get(name) ?? 0;
    rotation.set(name, (take + 1) % takes.length);
  }
  const buffer = buffers.get(takes[take]);
  if (!buffer) return;
  lastPlayed.set(name, t);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(out);
  src.onended = () => src.disconnect();
  src.start(t);
}

/**
 * Starts an effect that may be cut short (the swell under a held button), from offset seconds
 * into it. Returns the function that fades it out; calling that after it has ended does nothing.
 */
export function startSfx(name: Sfx, offset = 0): () => void {
  const g = graph();
  const buffer = buffers.get(files(name)[0]);
  if (!g || !buffer || offset >= buffer.duration - 0.02) return () => {};
  const { ctx, out } = g;
  const level = ctx.createGain();
  level.connect(out);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(level);
  let over = false;
  src.onended = () => {
    over = true;
    src.disconnect();
    level.disconnect();
  };
  src.start(ctx.currentTime + 0.005, Math.max(0, offset));
  return () => {
    if (over) return;
    const t = ctx.currentTime;
    level.gain.setValueAtTime(1, t);
    level.gain.linearRampToValueAtTime(0, t + 0.07);
    src.stop(t + 0.08);
  };
}

/** For checking the bank from the console in development. */
export const sfxStatus = () => ({ loaded: buffers.size, expected: (Object.keys(TAKES) as Sfx[]).flatMap(files).length, volume });
