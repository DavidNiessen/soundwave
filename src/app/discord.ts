/**
 * What the player is doing, for their Discord profile (desktop app only; the app talks to Discord,
 * see src-tauri/src/discord.rs). The screens say where the player is (`showScene`); the play screen
 * adds whether the song plays, is paused or is over, and how much of it is left (`showSong`). After a
 * while without any input outside a song the status says the player is idle. Only changes are sent.
 */
import { invoke } from '@tauri-apps/api/core';
import type { Part } from '../chart/types';
import { inDesktopApp } from '../game/displayMode';
import { onPadInput } from '../input/inputMode';

export interface Presence {
  /** The first line: the song, or where in the game the player is. */
  details: string;
  /** The second line. */
  state?: string;
  /** Discord counts up from `start` or down to `end` (ms since the epoch). */
  start?: number;
  end?: number;
  /** The part being played, shown as a small badge on the game's icon, with its hover text. */
  part?: Part;
  partText?: string;
  /** The song's cover, by a public https address (a server's), shown as the large picture. */
  cover?: string;
}

/** Where the song being played stands, and how many seconds of it are left. */
export interface SongState {
  phase: 'playing' | 'paused' | 'finished';
  left: number;
}

/** Time in the menus counts from when the game started. */
const OPENED = Date.now();
/** Outside a song, this long without a key, button or pointer and the player is idle. */
const IDLE_AFTER = 10 * 60_000;

let enabled = true;
let scene: Presence | null = null;
let song: SongState | null = null;
let sent: string | undefined;
let lastInput = Date.now();
let idle = false;
let watching = false;

/** Notices input from now on, and checks now and then whether the player has gone idle. */
function watchInput() {
  if (watching) return;
  watching = true;
  const active = () => {
    lastInput = Date.now();
    if (idle) update();
  };
  for (const type of ['keydown', 'pointerdown', 'pointermove', 'wheel']) {
    window.addEventListener(type, active, { capture: true, passive: true });
  }
  onPadInput(active);
  window.setInterval(update, 30_000);
}

function update() {
  if (!inDesktopApp()) return;
  watchInput();
  idle = !song && Date.now() - lastInput >= IDLE_AFTER;
  let p: Presence | null = null;
  if (enabled && scene) {
    p = { ...scene };
    if (idle) {
      p = { details: 'Idle', state: scene.details, start: lastInput };
    } else if (song?.phase === 'paused' || song?.phase === 'finished') {
      const word = song.phase === 'paused' ? 'Paused' : 'Finished';
      p.state = p.state ? `${word} · ${p.state}` : word;
    } else if (song) {
      // Whole seconds, so the same moment reported twice is the same status.
      p.end = Math.round((Date.now() + song.left * 1000) / 1000) * 1000;
    } else if (p.start === undefined) {
      p.start = OPENED;
    }
  }
  const json = JSON.stringify(p);
  if (json === sent) return;
  sent = json;
  void invoke('discord_presence', { presence: p }).catch(() => {});
}

/** Shows the status or not (the player's setting). */
export function setDiscordEnabled(on: boolean) {
  enabled = on;
  update();
}

/** Where the player is: a screen, or the song being played. */
export function showScene(p: Presence | null) {
  scene = p;
  update();
}

/** The song being played: playing (with the time left), paused or over. `null` once it is left. */
export function showSong(s: SongState | null) {
  song = s;
  update();
}
