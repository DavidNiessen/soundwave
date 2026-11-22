/**
 * The light bar around a PlayStation controller's touchpad (DualSense, DualSense Edge, DualShock 4)
 * during a song: off, so that a flash stands out, a flash in a lane's colour every time that lane
 * is pressed (a note there or not), gold for as long as the streak holds the top multiplier, and
 * light blue while overdrive lasts. Each of those wins over the ones before it.
 *
 * The light is set natively by the desktop app (src-tauri/src/lightbar.rs), on a USB cable only: by
 * Bluetooth setting it would stop the game reading the controller's buttons.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Settings } from '../game/settings';
import { pads } from './pads';

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * The colours as the light bar shows them, not as the screen does: its green and red LEDs
 * outshine the blue, so the screen's warm yellow and the ice blue of overdrive would come out
 * as a greenish white. These are pushed apart until the light reads as the colour on screen.
 */
export const LANE_LIGHT: readonly Rgb[] = [
  { r: 0, g: 255, b: 40 },
  { r: 255, g: 0, b: 12 },
  { r: 255, g: 170, b: 0 },
  { r: 0, g: 70, b: 255 },
  { r: 255, g: 55, b: 0 },
];
/** Between flashes the light is off. */
export const IDLE_LIGHT: Rgb = { r: 0, g: 0, b: 0 };
export const GOLD_LIGHT: Rgb = { r: 255, g: 125, b: 0 };
export const OVERDRIVE_LIGHT: Rgb = { r: 40, g: 165, b: 255 };

/** How long a lane's flash takes to fade back, ms. */
export const FLASH_MS = 180;
/** How bright gold and blue rest between hits (and beats), as a share of full. */
const STEADY = 0.62;

export interface LightState {
  now: number;
  /** The last lane pressed and when (ms, on `now`'s clock). */
  hit: { lane: number; at: number } | null;
  /** When the last beat fell, while overdrive lasts. */
  beatAt: number;
  fullStreak: boolean;
  overdrive: boolean;
}

/** 1 right at `at`, falling to 0 over FLASH_MS. */
const fade = (now: number, at: number) => {
  const k = Math.max(0, 1 - (now - at) / FLASH_MS);
  return k * k;
};
const mix = (a: Rgb, b: Rgb, k: number): Rgb => ({
  r: Math.round(a.r + (b.r - a.r) * k),
  g: Math.round(a.g + (b.g - a.g) * k),
  b: Math.round(a.b + (b.b - a.b) * k),
});
const scale = (c: Rgb, k: number): Rgb => mix({ r: 0, g: 0, b: 0 }, c, k);

/** The light bar's colour for one moment of a song. */
export function lightColor(s: LightState): Rgb {
  const flash = s.hit ? fade(s.now, s.hit.at) : 0;
  if (s.overdrive || s.fullStreak) {
    // Gold and blue hold the colour: a press, and in overdrive the beat, only brighten it.
    const kick = Math.max(flash, s.overdrive ? fade(s.now, s.beatAt) : 0);
    return scale(s.overdrive ? OVERDRIVE_LIGHT : GOLD_LIGHT, STEADY + (1 - STEADY) * kick);
  }
  if (!s.hit || flash <= 0) return IDLE_LIGHT;
  return mix(IDLE_LIGHT, LANE_LIGHT[s.hit.lane % LANE_LIGHT.length], flash);
}

const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The colour wanted on the controllers, or null to give them back their own. */
const send = (color: Rgb | null) => void invoke('lightbar_set', { color }).catch(() => {});

/** A controller with a light bar as the desktop app finds it; `usb` says whether it can be lit. */
export interface LightPad {
  model: 'dualSense' | 'dualShock4';
  usb: boolean;
}

/** The controllers with a light bar that are connected (desktop app only; none elsewhere). */
export async function lightPads(): Promise<LightPad[]> {
  if (!inDesktopApp()) return [];
  try {
    return await invoke<LightPad[]>('lightbar_pads');
  } catch {
    return [];
  }
}

/** How often the colour is sent at most while it changes, ms: smooth enough for a 180ms flash. */
const SEND_EVERY = 30;

/** The light bar for one play-through. */
export class LightShow {
  private hit: LightState['hit'] = null;
  private beatAt = -Infinity;
  private sent: Rgb | null = null;
  private sentAt = -Infinity;
  private lit = false;

  constructor(private s: Settings) {}

  /** Only with a PlayStation controller connected and the setting on, in the desktop app. */
  private get on() {
    return this.s.lightbar && inDesktopApp() && pads.snapshot().pads.some((p) => p.family === 'ps5' || p.family === 'ps4');
  }

  /** The settings changed in the middle of a song: turned off, the controller gets its own light back at once. */
  update(s: Settings) {
    this.s = s;
    if (!s.lightbar) this.release();
  }

  /** `lane` was pressed, whether or not a note was there (`now` on the clock `frame` runs on). */
  press(lane: number, now: number) {
    this.hit = { lane, at: now };
  }

  /** Every frame: the beat (while overdrive lasts) and where the streak and overdrive stand. */
  frame(now: number, fullStreak: boolean, overdrive: boolean, beat: boolean) {
    if (beat) this.beatAt = now;
    if (!this.on) return;
    const c = lightColor({ now, hit: this.hit, beatAt: this.beatAt, fullStreak, overdrive });
    const same = this.sent && c.r === this.sent.r && c.g === this.sent.g && c.b === this.sent.b;
    if (same || now - this.sentAt < SEND_EVERY) return;
    this.sent = c;
    this.sentAt = now;
    this.lit = true;
    send(c);
  }

  private release() {
    if (!this.lit) return;
    this.lit = false;
    this.sent = null;
    send(null);
  }

  dispose() {
    this.release();
  }
}
