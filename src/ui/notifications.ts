/**
 * Notifications: short messages that come and go on their own, for news that does not need a
 * screen of its own (a file saved, an import refused, a video finished). Anything in the game can
 * raise one with `notify`; `Notifications` (Notifications.tsx) shows them and gives each its sound.
 *
 * A notification has a tone that says what kind of news it is, and the tone sets its colour, icon,
 * sound and how long it stays:
 * - `error`: something the player asked for failed (an import, a save, a video).
 * - `warning`: the game did not do something, for a reason the player can act on (the setlist is full).
 * - `success`: something the player asked for, that finishes out of sight, is done (a file is saved).
 * - `info`: worth knowing, nothing went wrong (a song is already in the library).
 *
 * The same message again does not stack a copy: the one on screen counts it and starts its time over.
 */

export type Tone = 'error' | 'warning' | 'success' | 'info';

export interface Notification {
  id: number;
  tone: Tone;
  text: string;
  /** How many times the same message was raised while it was on screen. */
  count: number;
  /** How long it stays, in ms, counted from `shown` (and only while the stack is not held). */
  life: number;
  /** Changes whenever it is raised again, so its entrance and time line can start over. */
  shown: number;
  /** Fading out: it is removed a moment later. */
  leaving: boolean;
}

/** At most this many at once: a fourth pushes out the oldest. */
export const MAX_SHOWN = 3;
/** How long a notification takes to fade out before it is removed. */
export const LEAVE_MS = 200;

/** The least time each tone stays; a longer message stays longer, so it can be read to the end. */
const BASE_LIFE: Record<Tone, number> = { error: 8000, warning: 6000, success: 5000, info: 5000 };
const MAX_LIFE = 14000;

/** How long a message stays: long enough to read (about 55 ms a character after a glance), never for ever. */
export function lifeOf(tone: Tone, text: string): number {
  return Math.min(MAX_LIFE, Math.max(BASE_LIFE[tone], 1500 + text.length * 55));
}

type Listener = () => void;

let items: Notification[] = [];
let nextId = 1;
let held = false;
const listeners = new Set<Listener>();
const raisedListeners = new Set<(n: Notification) => void>();
/** Per notification: its timer, and when the time left was last counted. */
const timers = new Map<number, { timer: ReturnType<typeof setTimeout> | null; left: number; since: number }>();

/** What is on screen, and whether the clocks are held: a new object on every change. */
export interface NotificationState {
  items: Notification[];
  held: boolean;
}
let state: NotificationState = { items, held };

const emit = () => {
  state = { items, held };
  for (const l of listeners) l();
};

const set = (next: Notification[]) => {
  items = next;
  emit();
};

function startTimer(id: number, left: number) {
  stopTimer(id);
  const t = { timer: null as ReturnType<typeof setTimeout> | null, left, since: Date.now() };
  if (!held) t.timer = setTimeout(() => dismiss(id), left);
  timers.set(id, t);
}

function stopTimer(id: number) {
  const t = timers.get(id);
  if (t?.timer) clearTimeout(t.timer);
  timers.delete(id);
}

/** Shows a message (or counts it again, if the same one is on screen). Returns its id. */
export function notify(text: string, tone: Tone = 'info'): number {
  const life = lifeOf(tone, text);
  const same = items.find((n) => !n.leaving && n.tone === tone && n.text === text);
  let shown: Notification;
  if (same) {
    shown = { ...same, count: same.count + 1, life, shown: same.shown + 1 };
    // Raised again, it moves to the newest place.
    set([...items.filter((n) => n.id !== same.id), shown]);
  } else {
    shown = { id: nextId++, tone, text, count: 1, life, shown: 1, leaving: false };
    const live = items.filter((n) => !n.leaving);
    const over = live.length + 1 - MAX_SHOWN;
    const out = new Set(live.slice(0, Math.max(0, over)).map((n) => n.id));
    for (const id of out) stopTimer(id);
    set([...items.filter((n) => !out.has(n.id)), shown]);
  }
  startTimer(shown.id, life);
  for (const l of raisedListeners) l(shown);
  return shown.id;
}

/** One function per tone, for call sites that read better that way: `notify.error('…')`. */
notify.error = (text: string) => notify(text, 'error');
notify.warning = (text: string) => notify(text, 'warning');
notify.success = (text: string) => notify(text, 'success');
notify.info = (text: string) => notify(text, 'info');

/** Fades a notification out and then removes it. */
export function dismiss(id: number) {
  const n = items.find((x) => x.id === id);
  if (!n || n.leaving) return;
  stopTimer(id);
  set(items.map((x) => (x.id === id ? { ...x, leaving: true } : x)));
  setTimeout(() => set(items.filter((x) => x.id !== id)), LEAVE_MS);
}

/** Dismisses every notification on screen. Returns whether there was one. */
export function dismissAll(): boolean {
  const live = items.filter((n) => !n.leaving);
  for (const n of live) dismiss(n.id);
  return live.length > 0;
}

/** Dismisses the newest notification, bringing the one behind it forward. Returns whether there was one. */
export function dismissNewest(): boolean {
  const n = items.filter((x) => !x.leaving).at(-1);
  if (n) dismiss(n.id);
  return !!n;
}

/**
 * Stops (true) or restarts (false) the clocks of every notification: while the pointer rests on
 * them, or the window is out of sight, nothing goes before it has been read.
 */
export function hold(on: boolean) {
  if (held === on) return;
  held = on;
  const now = Date.now();
  for (const [id, t] of timers) {
    if (on && t.timer) {
      clearTimeout(t.timer);
      t.timer = null;
      t.left = Math.max(0, t.left - (now - t.since));
    } else if (!on && !t.timer) {
      t.since = now;
      t.timer = setTimeout(() => dismiss(id), t.left);
    }
  }
  emit();
}

export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const snapshot = (): NotificationState => state;

/** Calls `fn` for every notification raised (or raised again): for its sound and pulse. */
export function onRaised(fn: (n: Notification) => void): () => void {
  raisedListeners.add(fn);
  return () => raisedListeners.delete(fn);
}

/** Clears everything at once, with no fading out (for tests). */
export function resetNotifications() {
  for (const id of timers.keys()) stopTimer(id);
  items = [];
  held = false;
  emit();
}
