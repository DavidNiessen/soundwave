/**
 * What the player is doing, for their Discord profile (desktop app only; the app talks to Discord,
 * see src-tauri/src/discord.rs). The screens say where the player is (`showScene`); the play screen
 * adds whether the song plays, is paused or is over, and how much of it is left (`showSong`). After a
 * while without any input outside a song the status says the player is idle. Only changes are sent.
 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
  /** The party friends can join from Discord: its secret, an id, how many are in it and how many fit. */
  join?: { secret: string; id: string; size: number; max: number };
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
let join: Presence['join'];
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
    p = { ...scene, ...(join ? { join } : {}) };
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

/** The party friends can join from Discord, on every status from now on; undefined for none. */
export function setDiscordJoin(j: Presence['join']) {
  join = j;
  update();
}

/**
 * Calls `fn` with the secret when this player pressed Join on a friend's Discord status or invite
 * (desktop app only). A Join that came before the page was listening (Discord started the game for
 * it) is kept by the app and handed over now.
 */
export function onDiscordJoin(fn: (secret: string) => void): () => void {
  if (!inDesktopApp()) return () => {};
  let stop = () => {};
  let gone = false;
  const take = () =>
    void invoke<string | null>('discord_take_join').then(
      (secret) => secret && !gone && fn(secret),
      () => {},
    );
  void listen('discord-join', take).then((un) => (gone ? un() : (stop = un)));
  take();
  return () => {
    gone = true;
    stop();
  };
}

/** A friend asking on Discord to join this player's party. */
export interface JoinRequest {
  /** Their Discord user id, for the answer. */
  id: string;
  name: string;
}

/** Calls `fn` when a friend asks on Discord to join this player's party (desktop app only). */
export function onDiscordJoinRequest(fn: (r: JoinRequest) => void): () => void {
  if (!inDesktopApp()) return () => {};
  let stop = () => {};
  let gone = false;
  void listen<JoinRequest>('discord-join-request', (e) => fn(e.payload)).then((un) => (gone ? un() : (stop = un)));
  return () => {
    gone = true;
    stop();
  };
}

/** Answers a friend's ask to join: let in (Discord sends them the Join) or not. */
export function answerDiscordJoin(user: string, accept: boolean): Promise<void> {
  // The app refuses with a sentence (a string), not an Error: it is turned into one to show.
  return invoke<void>('discord_answer', { user, accept }).catch((e: unknown) => {
    throw new Error(typeof e === 'string' ? e : e instanceof Error ? e.message : 'Discord did not take the answer.');
  });
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
