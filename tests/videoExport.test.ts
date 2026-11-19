import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from '../src/game/settings';
import {
  DEFAULT_VIDEO_EXPORT,
  normalizeVideoExport,
  pickVideoFormat,
  videoBitrate,
  videoFileName,
  videoSize,
} from '../src/game/videoExport';

describe('video export settings', () => {
  it('show the HUD, the stage and the music at 1080p60 wide by default, also for settings stored before them', () => {
    expect(DEFAULT_VIDEO_EXPORT).toEqual({ hud: true, stage: true, music: true, quality: '1080p', fps: 60, layout: 'landscape' });
    const { videoExport: _, ...stored } = DEFAULT_SETTINGS;
    expect(normalizeSettings(stored).videoExport).toEqual(DEFAULT_VIDEO_EXPORT);
  });

  it('keep stored choices and replace unknown ones', () => {
    expect(normalizeVideoExport({ hud: false, quality: '720p', fps: 30, layout: 'portrait' })).toEqual({
      ...DEFAULT_VIDEO_EXPORT,
      hud: false,
      quality: '720p',
      fps: 30,
      layout: 'portrait',
    });
    expect(normalizeVideoExport({ hud: 'no', quality: '8k', fps: 24, layout: 'square' })).toEqual(DEFAULT_VIDEO_EXPORT);
    expect(normalizeSettings({ videoExport: null } as unknown as Partial<Settings>).videoExport).toEqual(DEFAULT_VIDEO_EXPORT);
  });

  it('size the video by its quality and shape', () => {
    expect(videoSize({ quality: '1080p', layout: 'landscape' })).toEqual({ width: 1920, height: 1080 });
    expect(videoSize({ quality: '720p', layout: 'portrait' })).toEqual({ width: 720, height: 1280 });
    expect(videoSize({ quality: '1440p', layout: 'landscape' })).toEqual({ width: 2560, height: 1440 });
    expect(videoBitrate({ quality: '1080p', fps: 60 })).toBeGreaterThan(videoBitrate({ quality: '1080p', fps: 30 }));
  });
});

describe('video file format', () => {
  it('is MP4 with H.264 and AAC where the browser writes it', () => {
    const chrome = (m: string) => m.startsWith('video/mp4;codecs=avc1.640028') || m.startsWith('video/webm');
    expect(pickVideoFormat(true, chrome)).toEqual({ mime: 'video/mp4;codecs=avc1.640028,mp4a.40.2', ext: 'mp4' });
    expect(pickVideoFormat(false, chrome)).toEqual({ mime: 'video/mp4;codecs=avc1.640028', ext: 'mp4' });
  });

  it('falls back to WebM, and to nothing where nothing can be recorded', () => {
    const firefox = (m: string) => m.startsWith('video/webm');
    expect(pickVideoFormat(true, firefox)).toEqual({ mime: 'video/webm;codecs=vp9,opus', ext: 'webm' });
    expect(pickVideoFormat(true, () => false)).toBeNull();
    expect(
      pickVideoFormat(true, () => {
        throw new Error('no');
      }),
    ).toBeNull();
  });

  it('names the file after the song, the part and the day, without characters file systems refuse', () => {
    const date = new Date(2026, 10, 18, 21, 4).getTime();
    expect(videoFileName('Song', 'Band', 'Lead Hard', date, 'mp4')).toBe('Song - Band (Lead Hard) 2026-11-18.mp4');
    expect(videoFileName('AC/DC: "Live"?', '', 'Drums Expert', date, 'webm')).toBe('AC DC Live (Drums Expert) 2026-11-18.webm');
  });
});
