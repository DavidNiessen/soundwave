import type { GraphicsSettings } from '../../game/graphics';
import { StageView } from '../stage/StageView';
import type { Part } from '../../chart/types';
import type { Avatars } from './AuroraStage';
import type { RingSeat } from './ring';

/**
 * The menus' stage, kept alive across remounts.
 *
 * The menu background can be unmounted and mounted again in quick succession: moving between
 * screens that each carry it, a settings change that leaves the graphics as they were, React
 * re-running effects, a hot update during development. Building a stage takes a moment and its
 * canvas fades in from nothing, so tearing it down every time shows as the menu going black. Here
 * one stage is held for as long as something uses it and a little longer; a new user with the same
 * graphics settings simply takes its canvas over.
 */
interface Held {
  key: string;
  stage: StageView;
  users: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** How long an unused stage is kept before its GPU memory is freed, ms. */
const LINGER = 1500;
let held: Held | null = null;
/** How the menu's band is dressed: as the signed-in player (and their party), or as themselves. */
let dressed: Avatars = {};
/** A Showdown lobby's players on the ring, or null for the band. */
let ringed: RingSeat[] | null = null;
/** Where the menu stage's camera holds, for any menu stage built later. */
let looking: { part: Part | null; shift: number } = { part: null, shift: 0 };

/** Keeps the menu stage's camera on one part's band member, or lets it roam again (null). */
export function setMenuLook(part: Part | null, shift = 0) {
  looking = { part, shift };
  held?.stage.lookAt(part, shift);
}

/** Dresses the menu stage's band, now and for any menu stage built later. */
export function setMenuAvatars(avatars: Avatars) {
  dressed = avatars;
  held?.stage.setAvatars(avatars);
}

/** Stands a Showdown lobby's players on the menu stage's ring (null: the band again), now and for any menu stage built later. */
export function setMenuRing(seats: RingSeat[] | null) {
  if (JSON.stringify(seats) === JSON.stringify(ringed)) return;
  ringed = seats;
  held?.stage.setRing(seats);
}

function drop(h: Held) {
  if (h.timer) clearTimeout(h.timer);
  h.stage.dispose();
}

/** The menu stage for these settings, shown in `host`. Pair every call with `releaseMenuStage`. */
export function acquireMenuStage(host: HTMLElement, g: GraphicsSettings): StageView {
  const key = JSON.stringify(g);
  if (held && held.key !== key) {
    drop(held);
    held = null;
  }
  if (!held) {
    const mine: Held = {
      key,
      users: 0,
      timer: null,
      stage: new StageView(host, g, { mode: 'menu', avatars: dressed, ring: ringed ?? undefined }),
    };
    mine.stage.ready.catch(() => {
      if (held === mine) held = null;
    });
    held = mine;
    if (looking.part) mine.stage.lookAt(looking.part, looking.shift);
  }
  const h = held;
  if (h.timer) {
    clearTimeout(h.timer);
    h.timer = null;
  }
  h.users++;
  h.stage.attach(host);
  return h.stage;
}

export function releaseMenuStage() {
  const h = held;
  if (!h) return;
  h.users = Math.max(0, h.users - 1);
  if (h.users > 0 || h.timer) return;
  h.timer = setTimeout(() => {
    h.timer = null;
    if (held !== h || h.users > 0) return;
    held = null;
    drop(h);
  }, LINGER);
}
