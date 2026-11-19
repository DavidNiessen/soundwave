/**
 * Turning a replay into a video file: what the video looks like (the export settings), which file
 * format this browser can write, and the recorder itself.
 *
 * The video is recorded as the replay plays, at its own speed: every frame, the stage, the highway
 * and (unless it is hidden) a HUD drawn for the video are laid onto one canvas, and that canvas and
 * the song are recorded together by the browser's MediaRecorder. MP4 where the browser writes it
 * (Chromium, Safari, the desktop app), WebM otherwise (Firefox).
 */

export type VideoQuality = '720p' | '1080p' | '1440p';
export type VideoLayout = 'landscape' | 'portrait';

export interface VideoExportSettings {
  /** The score, stars, multiplier and how each note went, over the picture. */
  hud: boolean;
  /** The 3D stage behind the highway (off: the plain night). */
  stage: boolean;
  /** The song itself in the video (off: no sound). */
  music: boolean;
  quality: VideoQuality;
  fps: 30 | 60;
  /** Wide (16:9), or upright (9:16) for phones and short videos. */
  layout: VideoLayout;
}

export const DEFAULT_VIDEO_EXPORT: VideoExportSettings = {
  hud: true,
  stage: true,
  music: true,
  quality: '1080p',
  fps: 60,
  layout: 'landscape',
};

const QUALITIES: VideoQuality[] = ['720p', '1080p', '1440p'];
const SHORT_SIDE: Record<VideoQuality, number> = { '720p': 720, '1080p': 1080, '1440p': 1440 };

/** Export settings stored by any version: missing or unknown values take the defaults. */
export function normalizeVideoExport(raw: unknown): VideoExportSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof VideoExportSettings, unknown>>;
  const d = DEFAULT_VIDEO_EXPORT;
  return {
    hud: typeof r.hud === 'boolean' ? r.hud : d.hud,
    stage: typeof r.stage === 'boolean' ? r.stage : d.stage,
    music: typeof r.music === 'boolean' ? r.music : d.music,
    quality: QUALITIES.includes(r.quality as VideoQuality) ? (r.quality as VideoQuality) : d.quality,
    fps: r.fps === 30 || r.fps === 60 ? r.fps : d.fps,
    layout: r.layout === 'portrait' ? 'portrait' : 'landscape',
  };
}

/** The video's size in pixels. */
export function videoSize(s: Pick<VideoExportSettings, 'quality' | 'layout'>): { width: number; height: number } {
  const short = SHORT_SIDE[s.quality];
  const long = Math.round((short * 16) / 9);
  return s.layout === 'portrait' ? { width: short, height: long } : { width: long, height: short };
}

/** Bits per second for the picture: enough for a busy stage at each size and frame rate. */
export function videoBitrate(s: Pick<VideoExportSettings, 'quality' | 'fps'>): number {
  const base = { '720p': 6_000_000, '1080p': 12_000_000, '1440p': 20_000_000 }[s.quality];
  return s.fps === 60 ? Math.round(base * 1.5) : base;
}

export interface VideoFormat {
  mime: string;
  ext: 'mp4' | 'webm';
}

/** MP4 first: H.264 at the profiles players take most widely, then the browser's own choice. */
const MP4 = ['avc1.640028', 'avc1.4d0028', 'avc1.42e01f', 'avc1', 'avc3.640028'];

/**
 * The file format this browser can record, with or without sound: MP4 where it can, WebM where it
 * cannot. `supports` is MediaRecorder.isTypeSupported (passed in for tests). Null: no recording at all.
 */
export function pickVideoFormat(audio: boolean, supports: (mime: string) => boolean): VideoFormat | null {
  const tries: VideoFormat[] = [
    ...MP4.map((v) => ({ mime: `video/mp4;codecs=${audio ? `${v},mp4a.40.2` : v}`, ext: 'mp4' as const })),
    ...(audio ? [{ mime: `video/mp4;codecs=avc1,opus`, ext: 'mp4' as const }] : []),
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: `video/webm;codecs=${audio ? 'vp9,opus' : 'vp9'}`, ext: 'webm' },
    { mime: `video/webm;codecs=${audio ? 'vp8,opus' : 'vp8'}`, ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const f of tries) {
    try {
      if (supports(f.mime)) return f;
    } catch {
      /* a browser that throws on a type does not take it */
    }
  }
  return null;
}

/** The format this browser records in, or null where it cannot record video at all. */
export function browserVideoFormat(audio: boolean): VideoFormat | null {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return pickVideoFormat(audio, (m) => MediaRecorder.isTypeSupported(m));
}

/** "Song - Artist (Lead Hard) 2026-11-18.mp4", without characters file systems refuse. */
export function videoFileName(title: string, artist: string, what: string, date: number, ext: string): string {
  const d = new Date(date);
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const name = [title, artist].filter(Boolean).join(' - ');
  const safe = [...`${name} (${what}) ${day}`]
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? ' ' : ch))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150);
  return `${safe || 'Soundwave replay'}.${ext}`;
}

/**
 * Records a canvas, and the song when it is given, into one file. The picture is taken at `fps`
 * as the canvas changes; pausing holds both until resumed, so a replay paused while the window was
 * hidden carries on seamlessly in the file.
 */
export class VideoRecorder {
  private readonly recorder: MediaRecorder;
  private readonly chunks: Blob[] = [];
  private readonly done: Promise<Blob>;
  private readonly stream: MediaStream;

  constructor(canvas: HTMLCanvasElement, format: VideoFormat, fps: number, bitrate: number, audio?: MediaStream) {
    const video = canvas.captureStream(fps);
    this.stream = new MediaStream([...video.getVideoTracks(), ...(audio?.getAudioTracks() ?? [])]);
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: format.mime,
      videoBitsPerSecond: bitrate,
      ...(audio ? { audioBitsPerSecond: 192_000 } : {}),
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    const type = format.mime.split(';')[0];
    this.done = new Promise((resolve, reject) => {
      this.recorder.onstop = () => resolve(new Blob(this.chunks, { type }));
      this.recorder.onerror = (e) => reject((e as unknown as { error?: Error }).error ?? new Error('The recording failed.'));
    });
    this.done.catch(() => undefined);
  }

  start() {
    // Handed over in pieces, so a long video never waits in one piece in the recorder.
    this.recorder.start(1000);
  }

  pause() {
    if (this.recorder.state === 'recording') this.recorder.pause();
  }

  resume() {
    if (this.recorder.state === 'paused') this.recorder.resume();
  }

  /** Ends the recording: the whole file. */
  stop(): Promise<Blob> {
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.stream.getTracks().forEach((t) => t.stop());
    return this.done;
  }

  /** Throws the recording away. */
  cancel() {
    this.recorder.ondataavailable = null;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    this.stream.getTracks().forEach((t) => t.stop());
    this.chunks.length = 0;
  }
}
