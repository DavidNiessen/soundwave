import type { BandLevels } from '../../audio/bands';
import type { Chart } from '../../chart/types';

/**
 * The light show: turns the music (beats, bars, how busy the chart is, live band levels) and the
 * player's game (overdrive, misses) into cues for the stage. Pure logic, so it can be tested and
 * reused by the menus.
 */
export type ShowLevel = 'calm' | 'groove' | 'peak';
export type BeamMode = 'still' | 'sweep' | 'fan' | 'chase';
export type Rgb = readonly [number, number, number];

export interface Palette {
  /** Beams and bulbs. */
  key: Rgb;
  /** Second beam colour, alternating with the key. */
  accent: Rgb;
  /** The washes that paint the architecture. */
  wash: Rgb;
}

export const PALETTES: Palette[] = [
  { key: [1, 0.78, 0.5], accent: [1, 0.96, 0.9], wash: [1, 0.55, 0.22] },
  { key: [0.45, 0.7, 1], accent: [0.95, 0.97, 1], wash: [0.12, 0.3, 1] },
  { key: [1, 0.4, 0.62], accent: [1, 0.8, 0.45], wash: [0.8, 0.2, 0.55] },
  { key: [0.25, 0.95, 0.85], accent: [1, 0.85, 0.5], wash: [0.1, 0.55, 0.7] },
];

export interface ShowFrame {
  dt: number;
  beat: 'none' | 'beat' | 'downbeat';
  /** How busy the music is right now, 0..1. */
  intensity: number;
  bands: Readonly<BandLevels>;
  overdrive: boolean;
}

export interface ShowState {
  level: ShowLevel;
  palette: Palette;
  /** 0..1 strength of the beams overall, and how they move. */
  beamLevel: number;
  beamMode: BeamMode;
  /** Decays from 1 on every beat. */
  pulse: number;
  /** Decays from 1 on every downbeat. */
  barPulse: number;
  /** Bars since the show started. */
  bar: number;
  /** Seconds of show time (for continuous motion). */
  time: number;
  washLevel: number;
  bulbLevel: number;
  /** Bulb chase speed (cycles per second along the strings). */
  chase: number;
  /** Stage-front blinder flash, 0..1. */
  blinder: number;
  /** Overdrive: colours cycle, everything brighter. */
  overdrive: number;
}

export type ShowEvent = { type: 'fireworks'; which: 'all' | 'center' | 'sides' } | { type: 'co2'; strength: number };

const CALM_BELOW = 0.33;
const PEAK_ABOVE = 0.66;
/** Bars between palette changes while the level stays the same. */
const PALETTE_BARS = 16;
/** Bars between beam looks at a peak. */
const MODE_BARS = 8;
/** Seconds between optional firework bursts. */
const FIREWORK_COOLDOWN = 20;

export class LightShow {
  readonly state: ShowState = {
    level: 'calm',
    palette: PALETTES[0],
    beamLevel: 0.3,
    beamMode: 'still',
    pulse: 0,
    barPulse: 0,
    bar: 0,
    time: 0,
    washLevel: 0.6,
    bulbLevel: 0.7,
    chase: 0.2,
    blinder: 0,
    overdrive: 0,
  };
  private smooth = 0;
  private paletteIndex = 0;
  private barsInLevel = 0;
  private sinceFireworks = FIREWORK_COOLDOWN;
  private sinceCo2 = 99;
  private pending: ShowEvent[] = [];

  /** `menu`: no pyro (but for a drop tried out, see overdriveStart), gentler motion, levels from the live audio only. */
  constructor(private readonly menu = false) {}

  update(f: ShowFrame): ShowEvent[] {
    const s = this.state;
    s.time += f.dt;
    this.sinceFireworks += f.dt;
    this.sinceCo2 += f.dt;
    // A slow follower of the music's intensity, with hysteresis between levels.
    const k = Math.min(1, f.dt * 0.6);
    this.smooth += (f.intensity - this.smooth) * k;
    const prev = s.level;
    if (s.level !== 'peak' && this.smooth > PEAK_ABOVE) s.level = 'peak';
    else if (s.level === 'peak' && this.smooth < PEAK_ABOVE - 0.08) s.level = 'groove';
    if (s.level !== 'calm' && this.smooth < CALM_BELOW) s.level = 'calm';
    else if (s.level === 'calm' && this.smooth > CALM_BELOW + 0.08) s.level = 'groove';
    const events = this.pending;
    this.pending = [];
    if (s.level !== prev) {
      this.barsInLevel = 0;
      this.nextPalette();
      if (s.level === 'peak' && !this.menu) {
        events.push({ type: 'co2', strength: 1 });
        if (this.sinceFireworks > FIREWORK_COOLDOWN / 2) {
          events.push({ type: 'fireworks', which: 'center' });
          this.sinceFireworks = 0;
        }
        this.sinceCo2 = 0;
      }
    }

    if (f.beat !== 'none') s.pulse = 1;
    if (f.beat === 'downbeat') {
      s.barPulse = 1;
      s.bar++;
      this.barsInLevel++;
      if (this.barsInLevel % PALETTE_BARS === 0) this.nextPalette();
      if (s.level === 'peak' && !this.menu) {
        s.blinder = 1;
        if (this.barsInLevel % 8 === 4 && this.sinceCo2 > 6) {
          events.push({ type: 'co2', strength: 0.6 });
          this.sinceCo2 = 0;
        }
        if (this.barsInLevel % 16 === 0 && this.sinceFireworks > FIREWORK_COOLDOWN) {
          events.push({ type: 'fireworks', which: 'sides' });
          this.sinceFireworks = 0;
        }
      }
    }
    s.pulse = Math.max(0, s.pulse - f.dt * 4);
    s.barPulse = Math.max(0, s.barPulse - f.dt * 1.5);
    s.blinder = Math.max(0, s.blinder - f.dt * 3.5);
    s.overdrive += ((f.overdrive ? 1 : 0) - s.overdrive) * Math.min(1, f.dt * 4);

    // Looks per level: calm hangs still and dim, groove sweeps, a peak fans and chases on the beat.
    const modes: BeamMode[] = s.level === 'calm' ? ['still', 'sweep'] : s.level === 'groove' ? ['sweep', 'fan'] : ['fan', 'chase', 'sweep'];
    s.beamMode = modes[Math.floor(this.barsInLevel / MODE_BARS) % modes.length];
    const target = { calm: 0.35, groove: 0.65, peak: 1 }[s.level];
    s.beamLevel += (Math.max(target, s.overdrive) - s.beamLevel) * Math.min(1, f.dt * 2);
    s.washLevel = 0.55 + 0.25 * f.bands.low + 0.2 * s.barPulse + 0.2 * s.overdrive;
    s.bulbLevel = 0.6 + 0.3 * s.pulse * (s.level === 'calm' ? 0.3 : 1) + 0.3 * s.overdrive;
    s.chase = { calm: 0.15, groove: 0.5, peak: 1.2 }[s.level] * (1 + s.overdrive);
    if (s.overdrive > 0.05) s.palette = overdrivePalette(s.time, s.palette, s.overdrive);
    return events;
  }

  /** Overdrive kicks in: everything fires. On the menus' stage only when `drop` (Test the drop). */
  overdriveStart(drop = false) {
    if (this.menu && !drop) return;
    this.pending.push({ type: 'fireworks', which: 'all' }, { type: 'co2', strength: 1 });
    this.state.blinder = 1;
    this.sinceFireworks = 0;
    this.sinceCo2 = 0;
  }

  /** The song ended: a finale. */
  finale() {
    this.pending.push({ type: 'fireworks', which: 'all' }, { type: 'co2', strength: 1 });
  }

  private nextPalette() {
    this.paletteIndex = (this.paletteIndex + 1) % PALETTES.length;
    this.state.palette = PALETTES[this.paletteIndex];
  }
}

/** During overdrive the key colour cycles through the spectrum. */
function overdrivePalette(t: number, base: Palette, amount: number): Palette {
  const h = (t * 0.25) % 1;
  const rainbow = hsl(h, 1, 0.6);
  const mix = (a: Rgb, b: Rgb): Rgb => [a[0] + (b[0] - a[0]) * amount, a[1] + (b[1] - a[1]) * amount, a[2] + (b[2] - a[2]) * amount];
  return { key: mix(PALETTES[0].key, rainbow), accent: base.accent, wash: mix(base.wash, hsl((h + 0.5) % 1, 1, 0.5)) };
}

function hsl(h: number, s: number, l: number): Rgb {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/**
 * How busy each bar of a chart is, 0..1: notes per bar against the song's busy bars, lightly
 * smoothed so a single empty bar doesn't drop the show.
 */
export function barIntensity(chart: Chart): number[] {
  const bars = chart.downbeats.map((i) => chart.beats[i]).filter((t) => t !== undefined);
  if (bars.length < 2) return [];
  const counts = new Array<number>(bars.length).fill(0);
  let b = 0;
  for (const n of chart.notes) {
    while (b + 1 < bars.length && bars[b + 1] <= n.t) b++;
    if (n.t >= bars[0]) counts[b]++;
  }
  const sorted = [...counts].sort((x, y) => x - y);
  const busy = Math.max(1, sorted[Math.floor(sorted.length * 0.85)]);
  const raw = counts.map((c) => Math.min(1, c / busy));
  return raw.map((v, i) => (raw[i - 1] ?? v) * 0.25 + v * 0.5 + (raw[i + 1] ?? v) * 0.25);
}

/** Index of the bar containing time t (bars = bar start times). */
export function barAt(bars: number[], t: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  if (hi < 0 || t < bars[0]) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
