/**
 * The desktop app's display mode: fullscreen, a borderless window covering the monitor, or a normal
 * window. A browser tab has no window to manage, so there this does nothing and the setting is
 * hidden.
 *
 * On macOS each mode is what Mac apps do: Fullscreen is the system's own full screen (a space of
 * its own, the green button and Control+Command+F), Windowed fullscreen is the system's simple
 * fullscreen (the window covers the screen with the menu bar and Dock hidden, and switching apps
 * stays instant), and Window is a window with the usual close, minimize and full-screen buttons
 * over the top of the game (tauri.macos.conf.json). Elsewhere the window never has a title bar.
 */
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize, PhysicalPosition, PhysicalSize } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { availableMonitors, currentMonitor, getCurrentWindow, type Window } from '@tauri-apps/api/window';
import type { DisplayMode } from './settings';

export const inDesktopApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/** The smallest window the app allows (tauri.conf.json), in logical pixels. */
const MIN_SIZE = { width: 960, height: 600 };
/** The largest window that Window mode opens. */
const MAX_SIZE = { width: 1600, height: 1000 };

/** Window mode's size for a monitor (logical pixels): 16:10, within four fifths of the monitor. */
export function windowedSize(monitorWidth: number, monitorHeight: number): { width: number; height: number } {
  const scale = Math.min((monitorWidth * 0.8) / MAX_SIZE.width, (monitorHeight * 0.8) / MAX_SIZE.height, 1);
  return {
    width: Math.max(MIN_SIZE.width, Math.round(MAX_SIZE.width * scale)),
    height: Math.max(MIN_SIZE.height, Math.round(MAX_SIZE.height * scale)),
  };
}

/** Whether the game runs somewhere it can close itself: the desktop app, or a window installed from the browser. */
export const canExit = () =>
  inDesktopApp() || (typeof matchMedia !== 'undefined' && matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches);

/**
 * Closes the game. In the desktop app the app itself quits (its own exit_app command); should an
 * older build not know that command, the window is closed or, failing that, destroyed. The page's
 * own window.close() is only for a window installed from the browser: inside the desktop app it
 * would blank the page and leave the app running unseen.
 */
export async function exitApp() {
  if (!inDesktopApp()) return window.close();
  try {
    await invoke('exit_app');
  } catch (err) {
    console.warn('Could not quit through the app, closing the window instead', err);
    const win = getCurrentWindow();
    await win
      .close()
      .catch(() => win.destroy())
      .catch((e) => console.warn('Could not close the window', e));
  }
}

/**
 * The display mode the fullscreen shortcuts switch to: a window from either way of filling the
 * screen, and from a window back to the one used last (windowed fullscreen when there was none).
 */
export function toggledMode(current: DisplayMode, lastFullMode: Exclude<DisplayMode, 'windowed'> | null): DisplayMode {
  return current === 'windowed' ? (lastFullMode ?? 'borderless') : 'windowed';
}

/**
 * Whether a key press is the fullscreen toggle: Alt+Enter, and F11 in the desktop app (a browser
 * keeps F11 for itself). Control+Command+F on a Mac is the app menu's (View › Toggle Full Screen),
 * which reaches the page as `onFullscreenShortcut`.
 */
export function isFullscreenToggle(
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  desktop: boolean,
): boolean {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (e.code === 'F11') return desktop && !e.altKey;
  return e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter');
}

/** Whether the game runs on a Mac. */
export const onMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

/** How the fullscreen shortcut is written on this system. */
export const fullscreenShortcut = () => (onMac() ? 'Control+Command+F or Alt+Enter' : 'Alt+Enter or F11');

let queue: Promise<void> = Promise.resolve();
/** The mode the window is in (null while it is being changed, or before the first change). */
let applied: DisplayMode | null = null;
/** The window is in the Mac's simple fullscreen. */
let simple = false;
let shown = false;
/** Called when the system changed the mode (the green button, Mission Control, the menu). */
const followers = new Set<(mode: DisplayMode) => void>();

/** Switches the window to a display mode. Calls run one after another, so quick changes end on the last one. */
export function applyDisplayMode(mode: DisplayMode): Promise<void> {
  if (!inDesktopApp()) return Promise.resolve();
  queue = queue.then(() => apply(mode)).catch((err) => console.warn('Could not change the display mode', err));
  return queue;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits for the Mac's full-screen animation to finish (it takes about half a second), at most `ms`. */
async function untilFullscreen(win: Window, on: boolean, ms = 2500) {
  const end = performance.now() + ms;
  while ((await win.isFullscreen()) !== on && performance.now() < end) await sleep(50);
  // The window's frame settles just after the system reports the change.
  await sleep(150);
}

async function apply(mode: DisplayMode) {
  const win = getCurrentWindow();
  try {
    if (mode === applied) return;
    const from = applied;
    applied = null;
    if (onMac()) await applyMac(win, mode, from);
    else await applyOther(win, mode);
    applied = mode;
  } finally {
    // The window starts hidden so it never appears in the wrong mode first.
    if (!shown) {
      shown = true;
      await win.show();
      await win.setFocus();
    }
  }
}

async function applyMac(win: Window, mode: DisplayMode, from: DisplayMode | null) {
  // Leave the way of filling the screen that is on first: the two cannot be combined.
  if (simple && mode !== 'borderless') {
    await win.setSimpleFullscreen(false);
    simple = false;
  }
  if (mode !== 'fullscreen' && (await win.isFullscreen())) {
    await win.setFullscreen(false);
    await untilFullscreen(win, false);
  }
  if (mode === 'fullscreen') {
    if (!(await win.isFullscreen())) {
      await win.setFullscreen(true);
      await untilFullscreen(win, true);
    }
  } else if (mode === 'borderless') {
    if (!simple) {
      await win.setSimpleFullscreen(true);
      simple = true;
    }
  } else {
    await win.setResizable(true);
    // Only a window that was something else (or nothing yet) is put where it was last.
    if (from !== 'windowed') await placeWindow(win);
  }
}

async function applyOther(win: Window, mode: DisplayMode) {
  if (mode === 'fullscreen') {
    await win.setFullscreen(true);
    return;
  }
  if (await win.isFullscreen()) await win.setFullscreen(false);
  if (await win.isMaximized()) await win.unmaximize();
  const monitor = await currentMonitor();
  if (mode === 'borderless') {
    // No frame, no shadow line and no resize edges: just the page over the whole monitor.
    await win.setDecorations(false);
    await win.setShadow(false);
    await win.setResizable(false);
    if (monitor) {
      await win.setPosition(monitor.position);
      await win.setSize(monitor.size);
    }
  } else {
    // No native title bar in any mode: the window keeps its shadow and its resize edges, and is
    // moved by the strip along its top edge (see the drag strip in App).
    await win.setDecorations(false);
    await win.setShadow(true);
    await win.setResizable(true);
    await placeWindow(win);
  }
}

/** Where the window was last in Window mode (physical pixels), kept between launches. */
const FRAME_KEY = 'soundwave.window-frame';
interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

function savedFrame(): Frame | null {
  try {
    const f = JSON.parse(localStorage.getItem(FRAME_KEY) ?? 'null') as Frame | null;
    return f && [f.x, f.y, f.width, f.height].every(Number.isFinite) && f.width > 0 && f.height > 0 ? f : null;
  } catch {
    return null;
  }
}

/** Whether a frame's top edge lies on a monitor that is connected now (so its title bar can be reached). */
export function frameOnScreen(
  frame: Frame,
  monitors: { position: { x: number; y: number }; size: { width: number; height: number } }[],
): boolean {
  const x = frame.x + Math.min(frame.width, 200) / 2;
  const y = frame.y + 10;
  return monitors.some(
    (m) => x >= m.position.x && x < m.position.x + m.size.width && y >= m.position.y && y < m.position.y + m.size.height,
  );
}

/** Puts the window where the player last had it, or at Window mode's size in the middle of the monitor. */
async function placeWindow(win: Window) {
  const frame = savedFrame();
  if (frame && frameOnScreen(frame, await availableMonitors().catch(() => []))) {
    await win.setSize(new PhysicalSize(frame.width, frame.height));
    await win.setPosition(new PhysicalPosition(frame.x, frame.y));
    return;
  }
  const monitor = await currentMonitor();
  const area = monitor?.size.toLogical(monitor.scaleFactor);
  const size = area ? windowedSize(area.width, area.height) : { width: 1280, height: 800 };
  await win.setSize(new LogicalSize(size.width, size.height));
  await win.center();
}

let watching = false;

/** Keeps the window's place in Window mode, and notices the system changing the mode. */
function watchWindow() {
  if (watching || !inDesktopApp()) return;
  watching = true;
  const win = getCurrentWindow();
  let saving: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    // Settled changes only: nothing is read while the game changes the mode itself.
    if (applied === null) return;
    clearTimeout(saving);
    saving = setTimeout(() => void settle(), 400);
  };
  const settle = async () => {
    if (applied === null) return;
    const full = await win.isFullscreen();
    // The Mac's own full screen, entered or left with the green button, Mission Control or the
    // menu: the setting follows, so it always says what the window is.
    if (onMac() && full && applied !== 'fullscreen' && !simple) return follow('fullscreen');
    if (onMac() && !full && applied === 'fullscreen') return follow('windowed');
    if (applied !== 'windowed' || full) return;
    const [pos, size] = await Promise.all([win.outerPosition(), win.outerSize()]);
    try {
      localStorage.setItem(FRAME_KEY, JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height } satisfies Frame));
    } catch {
      /* storage unavailable: the window opens at its usual size next time */
    }
  };
  void win.onResized(changed);
  void win.onMoved(changed);
}

function follow(mode: DisplayMode) {
  applied = mode;
  followers.forEach((f) => f(mode));
}

/**
 * Calls back with the display mode the system put the window in by itself (on a Mac: the green
 * button and the menu's full-screen item), so the setting can say so. Returns the function that stops.
 */
export function followDisplayMode(cb: (mode: DisplayMode) => void): () => void {
  if (!inDesktopApp()) return () => {};
  watchWindow();
  followers.add(cb);
  return () => void followers.delete(cb);
}

/** Calls back when the app menu's full-screen item (Control+Command+F on a Mac) is chosen. */
export function onFullscreenShortcut(cb: () => void): () => void {
  if (!inDesktopApp()) return () => {};
  let stop: (() => void) | null = null;
  let live = true;
  void listen('toggle-fullscreen', cb)
    .then((un) => (live ? (stop = un) : un()))
    .catch(() => {});
  return () => {
    live = false;
    stop?.();
  };
}
