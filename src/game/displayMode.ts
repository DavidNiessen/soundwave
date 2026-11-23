/**
 * The desktop app's display mode: fullscreen, a borderless window covering the monitor, or a normal
 * window. A browser tab has no window to manage, so there this does nothing and the setting is
 * hidden.
 */
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize } from '@tauri-apps/api/dpi';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
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
 * The display mode Alt+Enter and F11 switch to: a window from either way of filling the screen, and
 * from a window back to the one used last (windowed fullscreen when there was none).
 */
export function toggledMode(current: DisplayMode, lastFullMode: Exclude<DisplayMode, 'windowed'> | null): DisplayMode {
  return current === 'windowed' ? (lastFullMode ?? 'borderless') : 'windowed';
}

/** Whether a key press is the fullscreen toggle: Alt+Enter, and F11 in the desktop app (a browser keeps F11 for itself). */
export function isFullscreenToggle(
  e: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>,
  desktop: boolean,
): boolean {
  if (e.ctrlKey || e.metaKey || e.shiftKey) return false;
  if (e.code === 'F11') return desktop && !e.altKey;
  return e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter');
}

/** The Mac: its display modes work its own way (see applyMac). */
export const onMac = () => typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || navigator.userAgent);

let queue: Promise<void> = Promise.resolve();
let applied: DisplayMode | null = null;
let shown = false;
/** How many display mode changes are under way (the window's own changes are told apart from them). */
let busy = 0;

/** Switches the window to a display mode. Calls run one after another, so quick changes end on the last one. */
export function applyDisplayMode(mode: DisplayMode): Promise<void> {
  if (!inDesktopApp()) return Promise.resolve();
  busy++;
  queue = queue
    .then(() => apply(mode))
    .catch((err) => console.warn('Could not change the display mode', err))
    .finally(() => busy--);
  return queue;
}

async function apply(mode: DisplayMode) {
  const win = getCurrentWindow();
  try {
    if (mode === applied) return;
    applied = null;
    if (onMac()) await applyMac(win, mode);
    else await applyElsewhere(win, mode);
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

type AppWindow = ReturnType<typeof getCurrentWindow>;

/** Window mode's size, centred on the monitor the window is on. */
async function centreWindow(win: AppWindow) {
  const monitor = await currentMonitor();
  const area = monitor?.size.toLogical(monitor.scaleFactor);
  const size = area ? windowedSize(area.width, area.height) : { width: 1280, height: 800 };
  await win.setSize(new LogicalSize(size.width, size.height));
  await win.center();
}

/** Windows and Linux: no title bar in any mode; windowed fullscreen is a borderless window over the monitor. */
async function applyElsewhere(win: AppWindow, mode: DisplayMode) {
  if (mode === 'fullscreen') return win.setFullscreen(true);
  if (await win.isFullscreen()) await win.setFullscreen(false);
  if (await win.isMaximized()) await win.unmaximize();
  if (mode === 'borderless') {
    // No frame, no shadow line and no resize edges: just the page over the whole monitor.
    await win.setDecorations(false);
    await win.setShadow(false);
    await win.setResizable(false);
    const monitor = await currentMonitor();
    if (monitor) {
      await win.setPosition(monitor.position);
      await win.setSize(monitor.size);
    }
    return;
  }
  // The window keeps its shadow and its resize edges, and is moved by the strip along its top
  // edge (see the drag strip in App).
  await win.setDecorations(false);
  await win.setShadow(true);
  await win.setResizable(true);
  await centreWindow(win);
}

/**
 * The Mac, done the way Mac apps that offer both kinds of full screen do it (iTerm2's and mpv's
 * "non-native" full screen beside the system's own):
 * - Window: a normal window with the traffic lights in its corner over the page and no title
 *   (tauri.macos.conf.json). The page leaves room for them (`data-titlebar` in App).
 * - Windowed fullscreen: the system's simple full screen. The window covers the screen and the
 *   menu bar and Dock hide until the pointer reaches them, but it stays in the desktop's Space,
 *   so switching apps is instant.
 * - Fullscreen: the system's own full screen, in a Space of its own (what the green button does).
 *
 * The window's frame is never taken away here: a Mac window without one cannot go into the
 * system's full screen properly. The system's full screen slides in and out, and while it does the
 * window takes no other change (the window library drops it), so each step waits for it to finish.
 * Simple full screen is ended whatever the page remembers: a page opened again (lib.rs) forgets
 * it, the window does not, and the window library ignores the request when it is not on.
 */
async function applyMac(win: AppWindow, mode: DisplayMode) {
  if (mode === 'fullscreen') {
    await win.setSimpleFullscreen(false);
    if (!(await win.isFullscreen())) {
      await win.setFullscreen(true);
      await transition(win, true);
    }
    return;
  }
  if (await win.isFullscreen()) {
    await win.setFullscreen(false);
    await transition(win, false);
  }
  if (mode === 'borderless') return win.setSimpleFullscreen(true);
  await win.setSimpleFullscreen(false);
  await win.setResizable(true);
  await centreWindow(win);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits for the system's full screen to finish sliding in or out. The window reports full screen
 * as soon as it starts going in, and as not full screen only once it is all the way out; going
 * in, the window then waits until its size stops changing.
 */
async function transition(win: AppWindow, to: boolean) {
  const until = performance.now() + 4000;
  while ((await win.isFullscreen()) !== to && performance.now() < until) await sleep(50);
  if (!to) return;
  let last = performance.now();
  const stop = await win.onResized(() => (last = performance.now()));
  try {
    while (performance.now() - last < 400 && performance.now() < until) await sleep(50);
  } finally {
    stop();
  }
}

/**
 * On the Mac the window can go into and out of the system's full screen without the game asking:
 * by its green button, or Window and View menu items the system adds. `onChange` is told the
 * mode the window is then in, so the Window mode setting follows it. Returns a function that stops
 * watching. Elsewhere only the game changes its window, and this does nothing.
 */
export function followWindowMode(onChange: (mode: DisplayMode) => void): () => void {
  if (!inDesktopApp() || !onMac()) return () => {};
  const win = getCurrentWindow();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let stop: (() => void) | undefined;
  void win
    .onResized(() => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (busy > 0 || applied === null) return;
        const full = await win.isFullscreen();
        if (busy > 0 || stopped) return;
        if (full && applied !== 'fullscreen') {
          applied = 'fullscreen';
          onChange('fullscreen');
        } else if (!full && applied === 'fullscreen') {
          applied = 'windowed';
          onChange('windowed');
        }
      }, 300);
    })
    .then((un) => (stopped ? un() : (stop = un)));
  return () => {
    stopped = true;
    clearTimeout(timer);
    stop?.();
  };
}
