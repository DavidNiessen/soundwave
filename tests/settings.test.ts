import { describe, expect, it } from 'vitest';
import { frameOnScreen, isFullscreenToggle, toggledMode, windowedSize } from '../src/game/displayMode';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/game/settings';

describe('display mode setting', () => {
  it('defaults to windowed fullscreen', () => {
    expect(DEFAULT_SETTINGS.displayMode).toBe('borderless');
  });

  it('gives settings stored before the option existed the default', () => {
    const { displayMode: _, ...stored } = DEFAULT_SETTINGS;
    expect(normalizeSettings(stored).displayMode).toBe('borderless');
  });

  it('keeps a stored choice and replaces an unknown one', () => {
    expect(normalizeSettings({ displayMode: 'windowed' }).displayMode).toBe('windowed');
    expect(normalizeSettings({ displayMode: 'fullscreen' }).displayMode).toBe('fullscreen');
    expect(normalizeSettings({ displayMode: 'exclusive' } as unknown as Partial<Settings>).displayMode).toBe('borderless');
  });
});

describe('song previews setting', () => {
  it('is on by default, also for settings stored before the option existed', () => {
    expect(DEFAULT_SETTINGS.songPreviews).toBe(true);
    const { songPreviews: _, ...stored } = DEFAULT_SETTINGS;
    expect(normalizeSettings(stored).songPreviews).toBe(true);
  });

  it('keeps a stored choice', () => {
    expect(normalizeSettings({ songPreviews: false }).songPreviews).toBe(false);
  });
});

describe('volume defaults', () => {
  it('moves volumes still at the first defaults to the current ones', () => {
    const s = normalizeSettings({ volume: 0.5, musicVolume: 0.6, sfxVolume: 0.7 });
    expect(s).toMatchObject({ volume: 0.5, musicVolume: 0.3, sfxVolume: 0.9, volumeDefaults: 2 });
  });

  it('keeps volumes the player changed', () => {
    expect(normalizeSettings({ musicVolume: 0.6, sfxVolume: 0.5 })).toMatchObject({ musicVolume: 0.6, sfxVolume: 0.5 });
    expect(normalizeSettings({ musicVolume: 0.45, sfxVolume: 0.7 })).toMatchObject({ musicVolume: 0.45, sfxVolume: 0.7 });
  });

  it('moves them only once: 60% and 70% chosen afterwards stay', () => {
    const migrated = normalizeSettings({ musicVolume: 0.6, sfxVolume: 0.7 });
    expect(normalizeSettings({ ...migrated, musicVolume: 0.6, sfxVolume: 0.7 })).toMatchObject({ musicVolume: 0.6, sfxVolume: 0.7 });
  });

  it('starts new players at the current defaults', () => {
    expect(normalizeSettings({})).toMatchObject({ musicVolume: 0.3, sfxVolume: 0.9, volumeDefaults: 2 });
  });
});

describe('windowedSize', () => {
  it.each([
    [1920, 1080, 1382, 864],
    [2560, 1440, 1600, 1000],
    [3840, 2160, 1600, 1000],
    [1366, 768, 983, 614],
  ])('fits a %i×%i monitor', (w, h, width, height) => {
    expect(windowedSize(w, h)).toEqual({ width, height });
  });

  it('never goes below the smallest window the app allows', () => {
    expect(windowedSize(1024, 600)).toEqual({ width: 960, height: 600 });
  });
});

describe('the fullscreen toggle', () => {
  const key = (code: string, mods: Partial<Record<'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey', boolean>> = {}) => ({
    code,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  it('goes to a window from either fullscreen mode and back to the one used last', () => {
    expect(toggledMode('borderless', 'borderless')).toBe('windowed');
    expect(toggledMode('fullscreen', 'fullscreen')).toBe('windowed');
    expect(toggledMode('windowed', 'fullscreen')).toBe('fullscreen');
    expect(toggledMode('windowed', 'borderless')).toBe('borderless');
    expect(toggledMode('windowed', null)).toBe('borderless');
  });

  it('answers Alt+Enter everywhere and F11 only in the desktop app', () => {
    expect(isFullscreenToggle(key('Enter', { altKey: true }), true)).toBe(true);
    expect(isFullscreenToggle(key('NumpadEnter', { altKey: true }), false)).toBe(true);
    expect(isFullscreenToggle(key('F11'), true)).toBe(true);
    expect(isFullscreenToggle(key('F11'), false)).toBe(false);
    expect(isFullscreenToggle(key('Enter'), true)).toBe(false);
    expect(isFullscreenToggle(key('Enter', { altKey: true, ctrlKey: true }), true)).toBe(false);
  });
});

describe('replay settings', () => {
  it('record replays and keep thirty by default, also for settings stored before the options existed', () => {
    expect(DEFAULT_SETTINGS.replays).toBe(true);
    expect(DEFAULT_SETTINGS.replayLimit).toBe(30);
    const { replays: _, replayLimit: __, ...stored } = DEFAULT_SETTINGS;
    expect(normalizeSettings(stored)).toMatchObject({ replays: true, replayLimit: 30 });
  });

  it('keep a stored choice and bring the number kept onto the slider', () => {
    expect(normalizeSettings({ replays: false }).replays).toBe(false);
    expect(normalizeSettings({ replayLimit: 52 }).replayLimit).toBe(50);
    expect(normalizeSettings({ replayLimit: 1 }).replayLimit).toBe(5);
    expect(normalizeSettings({ replayLimit: 1000 }).replayLimit).toBe(100);
    expect(normalizeSettings({ replayLimit: 'many' } as unknown as Partial<Settings>).replayLimit).toBe(30);
  });
});

describe('a remembered window place', () => {
  const monitors = [
    { position: { x: 0, y: 0 }, size: { width: 2560, height: 1440 } },
    { position: { x: 2560, y: 0 }, size: { width: 1920, height: 1080 } },
  ];

  it('is used while its title bar is on a connected monitor', () => {
    expect(frameOnScreen({ x: 100, y: 80, width: 1600, height: 1000 }, monitors)).toBe(true);
    expect(frameOnScreen({ x: 3000, y: 200, width: 1280, height: 800 }, monitors)).toBe(true);
  });

  it('is not used when that monitor is gone, or the title bar is off every screen', () => {
    expect(frameOnScreen({ x: 5000, y: 100, width: 1280, height: 800 }, monitors)).toBe(false);
    expect(frameOnScreen({ x: 100, y: -400, width: 1280, height: 800 }, monitors)).toBe(false);
  });
});

describe('calibration from before the game kept where it was made', () => {
  it('counts an offset already set as calibrated on the output used then', () => {
    expect(normalizeSettings({ offsetMs: 40, outputDevice: 'usb' }).calibratedOn).toBe('usb');
    expect(normalizeSettings({ offsetMs: 40 }).calibratedOn).toBe('');
    expect(normalizeSettings({ offsetMs: 0 }).calibratedOn).toBeNull();
    expect(normalizeSettings({ offsetMs: 40, calibratedOn: null }).calibratedOn).toBeNull();
  });
});
