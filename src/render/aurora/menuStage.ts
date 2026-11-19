import type { GraphicsSettings } from '../../game/graphics';
import type { VenueId } from '../venues/catalog';
import { StageView } from '../stage/StageView';

/**
 * The menus' stage, kept alive across remounts.
 *
 * The menu background can be unmounted and mounted again in quick succession: moving between
 * screens that each carry it, a settings change that leaves the graphics as they were, React
 * re-running effects, a hot update during development. Building a stage takes a moment and its
 * canvas fades in from nothing, so tearing it down every time shows as the menu going black. Here
 * one stage is held for as long as something uses it and a little longer; a new user with the same
 * graphics settings and venue simply takes its canvas over.
 *
 * Another venue (or other graphics) needs a new stage. The one on screen stays, drawing, until the
 * new one has drawn its first frame and faded in over it; only then is it let go. So switching
 * venues never shows the menu black while the next one loads.
 */
interface Held {
  key: string;
  stage: StageView;
  users: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** It has drawn its first frame. */
  shown: boolean;
}

/** How long an unused stage is kept before its GPU memory is freed, ms. */
const LINGER = 1500;
/** How long a new stage takes to fade in over the one before (the .stage3d transition), ms. */
const FADE_MS = 900;
let held: Held | null = null;
/** Stages on their way out: still on screen until the held one has drawn. */
const leaving = new Set<Held>();
/** Until when (performance.now ms) the menu stage plays a drop: overdrive, at full tilt. */
let boostUntil = 0;

/** Plays a drop on the menu stage for `seconds`: the stage browser's Test the drop. */
export function boostMenuStage(seconds = 5) {
  boostUntil = performance.now() + seconds * 1000;
}

export const menuStageBoosted = (now = performance.now()) => now < boostUntil;

/** The venue being loaded for the menus (null once it is on screen), for the loading indicator. */
let loading: VenueId | null = null;
const loadingWatchers = new Set<(venue: VenueId | null) => void>();
function setLoading(venue: VenueId | null) {
  if (venue === loading) return;
  loading = venue;
  loadingWatchers.forEach((w) => w(venue));
}
export function watchMenuLoading(cb: (venue: VenueId | null) => void): () => void {
  loadingWatchers.add(cb);
  cb(loading);
  return () => void loadingWatchers.delete(cb);
}

function drop(h: Held) {
  if (h.timer) clearTimeout(h.timer);
  h.timer = null;
  leaving.delete(h);
  h.stage.dispose();
}

/** Lets go of every stage on its way out but the one held. */
function dropLeaving() {
  // Deleting the entry being visited is safe while iterating a Set.
  for (const h of leaving) if (h !== held) drop(h);
}

/** The menu stage for these settings, shown in `host`. Pair every call with `releaseMenuStage`. */
export function acquireMenuStage(host: HTMLElement, g: GraphicsSettings, venue: VenueId): StageView {
  const key = JSON.stringify([g, venue]);
  if (held && held.key !== key) {
    // The stage on screen stays until the next one has drawn (see above).
    const old = held;
    if (old.timer) clearTimeout(old.timer);
    old.timer = null;
    leaving.add(old);
    held = null;
    // Back to a stage still on its way out (pointing back and forth over the stages): it is taken again.
    const back = [...leaving].find((l) => l.key === key);
    if (back) {
      leaving.delete(back);
      held = back;
      setLoading(back.shown ? null : venue);
      if (back.shown) dropLeaving();
    }
  }
  if (!held) {
    const mine: Held = { key, users: 0, timer: null, shown: false, stage: new StageView(host, g, { mode: 'menu', venue }) };
    setLoading(venue);
    mine.stage.ready.then(
      () => {
        mine.shown = true;
        if (held !== mine) return;
        setLoading(null);
        // Once it has faded in over them, the stages before it go.
        setTimeout(() => held === mine && dropLeaving(), FADE_MS);
      },
      () => {
        if (held !== mine) return;
        held = null;
        setLoading(null);
        dropLeaving();
      },
    );
    held = mine;
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
    setLoading(null);
    drop(h);
    dropLeaving();
  }, LINGER);
}
