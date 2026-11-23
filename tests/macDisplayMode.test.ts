import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A Mac window as the window library (tao) runs it: the system's full screen slides in and out,
 * reporting full screen as soon as it starts going in and not full screen only once it is all the
 * way out, and a request for simple full screen is dropped while the system's full screen is on.
 */
function macWindow() {
  const calls: string[] = [];
  const resized = new Set<() => void>();
  const state = { full: false, simple: false, sliding: false };
  const resize = () => resized.forEach((f) => f());
  const win = {
    isFullscreen: async () => state.full,
    isMaximized: async () => false,
    setFullscreen: async (on: boolean) => {
      calls.push(`fullscreen ${on}`);
      if (state.simple || state.sliding || state.full === on) return;
      state.sliding = true;
      if (on) state.full = true;
      setTimeout(resize, 60);
      setTimeout(() => {
        state.full = on;
        state.sliding = false;
        resize();
      }, 150);
    },
    setSimpleFullscreen: async (on: boolean) => {
      calls.push(`simple ${on}`);
      if (state.full || state.sliding) return;
      state.simple = on;
    },
    setResizable: async (on: boolean) => void calls.push(`resizable ${on}`),
    setSize: async () => void calls.push('size'),
    center: async () => void calls.push('center'),
    show: async () => {},
    setFocus: async () => {},
    setDecorations: async (on: boolean) => void calls.push(`decorations ${on}`),
    setShadow: async () => {},
    unmaximize: async () => {},
    setPosition: async () => {},
    onResized: async (f: () => void) => {
      resized.add(f);
      return () => resized.delete(f);
    },
  };
  return { win, calls, state, resize };
}

let mac: ReturnType<typeof macWindow>;

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => mac.win,
  currentMonitor: async () => null,
}));

/** A fresh copy of the module, as a page opened again has. */
const load = async () => {
  vi.resetModules();
  return import('../src/game/displayMode');
};

describe('display modes on the Mac', () => {
  beforeEach(() => {
    mac = macWindow();
    vi.stubGlobal('window', { __TAURI_INTERNALS__: {} });
    vi.stubGlobal('navigator', { platform: 'MacIntel', userAgent: 'Macintosh' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('never takes the window frame away, so the system full screen keeps working', async () => {
    const { applyDisplayMode } = await load();
    for (const mode of ['windowed', 'borderless', 'fullscreen', 'windowed'] as const) await applyDisplayMode(mode);
    expect(mac.calls.filter((c) => c.startsWith('decorations'))).toEqual([]);
  });

  it('waits for the system full screen to slide out before covering the screen', async () => {
    const { applyDisplayMode } = await load();
    await applyDisplayMode('fullscreen');
    expect(mac.state.full).toBe(true);
    await applyDisplayMode('borderless');
    expect(mac.state).toMatchObject({ full: false, simple: true });
  });

  it('ends simple full screen before going into the system full screen', async () => {
    const { applyDisplayMode } = await load();
    await applyDisplayMode('borderless');
    await applyDisplayMode('fullscreen');
    expect(mac.state).toMatchObject({ full: true, simple: false });
    expect(mac.calls.indexOf('simple false')).toBeLessThan(mac.calls.indexOf('fullscreen true'));
  });

  it('ends simple full screen even when a page opened again does not remember starting it', async () => {
    const first = await load();
    await first.applyDisplayMode('borderless');
    const again = await load();
    await again.applyDisplayMode('windowed');
    expect(mac.state.simple).toBe(false);
  });

  it('follows the window into and out of the system full screen when the game did not ask', async () => {
    const { applyDisplayMode, followWindowMode } = await load();
    await applyDisplayMode('windowed');
    const seen: string[] = [];
    const stop = followWindowMode((mode) => seen.push(mode));
    await new Promise((r) => setTimeout(r, 0));
    // The green button.
    await mac.win.setFullscreen(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual(['fullscreen']);
    // The setting now matches, so applying it changes nothing.
    const before = mac.calls.length;
    await applyDisplayMode('fullscreen');
    expect(mac.calls.length).toBe(before);
    await mac.win.setFullscreen(false);
    await new Promise((r) => setTimeout(r, 600));
    expect(seen).toEqual(['fullscreen', 'windowed']);
    stop();
  });

  it('does not take its own changes for the window changing by itself', async () => {
    const { applyDisplayMode, followWindowMode } = await load();
    await applyDisplayMode('windowed');
    const seen: string[] = [];
    const stop = followWindowMode((mode) => seen.push(mode));
    await applyDisplayMode('fullscreen');
    await new Promise((r) => setTimeout(r, 500));
    expect(seen).toEqual([]);
    stop();
  });
});
