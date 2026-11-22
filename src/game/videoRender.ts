/**
 * Making a replay's video frame by frame, faster than the song plays: each frame is drawn on the
 * video's own clock and handed to the browser's video encoder (WebCodecs), the song's samples go to
 * its audio encoder, and both are written into an MP4 (with mediabunny). Where the browser cannot
 * encode that way, the video is recorded as the replay plays instead (see videoExport).
 */
import type { AudioCodec, VideoCodec } from 'mediabunny';
import { browserVideoFormat, videoBitrate, videoSize, type VideoExportSettings, type VideoFormat } from './videoExport';

/** How a video is made: frame by frame (fast), or recorded as the replay plays. */
export type VideoPlan =
  | { kind: 'frames'; ext: 'mp4'; video: VideoCodec; audio: AudioCodec | null }
  | { kind: 'live'; ext: VideoFormat['ext']; format: VideoFormat };

const loadMediabunny = () => import('mediabunny');

/**
 * Finds how this browser can make the video with these settings: frame by frame where it encodes
 * video (and the song, when there is music), recorded live otherwise; null when it can do neither.
 */
export async function planVideo(s: VideoExportSettings, music: boolean): Promise<VideoPlan | null> {
  try {
    if (typeof VideoEncoder === 'function' && (!music || typeof AudioEncoder === 'function')) {
      const mb = await loadMediabunny();
      const { width, height } = videoSize(s);
      const video = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {
        width,
        height,
        bitrate: videoBitrate(s),
        frameRate: s.fps,
      });
      const audio = music
        ? await mb.getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: 48000, bitrate: 192_000 })
        : null;
      if (video && (!music || audio)) return { kind: 'frames', ext: 'mp4', video, audio };
    }
  } catch {
    /* no encoder after all: recorded live below */
  }
  const format = browserVideoFormat(music);
  return format ? { kind: 'live', ext: format.ext, format } : null;
}

/**
 * A file written at positions, as an MP4 writer does (it goes back to fill in sizes once it knows
 * them), kept as pieces of a Blob so a long video never has to sit in one piece of memory.
 */
export class PatchedFile {
  private parts: { at: number; data: Blob }[] = [];
  private end = 0;

  get size() {
    return this.end;
  }

  write(at: number, bytes: Uint8Array) {
    const data = new Blob([bytes.slice()]);
    const len = data.size;
    if (at > this.end) {
      this.parts.push({ at: this.end, data: new Blob([new Uint8Array(at - this.end)]) });
      this.end = at;
    }
    if (at === this.end) {
      this.parts.push({ at, data });
      this.end += len;
      return;
    }
    // Over what is already there: the pieces it covers are cut around it.
    const out: { at: number; data: Blob }[] = [];
    let placed = false;
    for (const p of this.parts) {
      const pEnd = p.at + p.data.size;
      if (pEnd <= at || p.at >= at + len) {
        if (!placed && p.at >= at + len) {
          out.push({ at, data });
          placed = true;
        }
        out.push(p);
        continue;
      }
      if (p.at < at) out.push({ at: p.at, data: p.data.slice(0, at - p.at) });
      if (!placed) {
        out.push({ at, data });
        placed = true;
      }
      if (pEnd > at + len) out.push({ at: at + len, data: p.data.slice(at + len - p.at) });
    }
    if (!placed) out.push({ at, data });
    this.parts = out;
    this.end = Math.max(this.end, at + len);
  }

  blob(type: string): Blob {
    return new Blob(
      this.parts.map((p) => p.data),
      { type },
    );
  }
}

export interface FrameEncoder {
  /** Takes the canvas as it is now as the frame at `index`. Resolves when more can be taken. */
  frame(index: number): Promise<void>;
  /** Ends the file: the whole video. */
  finish(): Promise<Blob>;
  cancel(): Promise<void>;
}

/** A song's samples as they are given to the encoder: one array per channel. */
export interface SongSamples {
  channels: Float32Array[];
  sampleRate: number;
}

/** A decoded song's samples (its own arrays, not copies). */
export const songSamples = (buffer: AudioBuffer): SongSamples => ({
  channels: Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)),
  sampleRate: buffer.sampleRate,
});

/**
 * Starts an MP4 of `canvas`'s frames at `fps`, with the song when `audio` is given: its samples
 * start `leadIn` seconds into the video (the replay starts a moment before the song does). Works on
 * the page and in a worker alike.
 */
export async function startFrameEncoder(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  plan: Extract<VideoPlan, { kind: 'frames' }>,
  s: VideoExportSettings,
  audio: (SongSamples & { leadIn: number }) | null,
): Promise<FrameEncoder> {
  const mb = await loadMediabunny();
  const file = new PatchedFile();
  const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write: (chunk) => file.write(chunk.position, chunk.data),
  });
  const output = new mb.Output({
    format: new mb.Mp4OutputFormat({ fastStart: false }),
    target: new mb.StreamTarget(writable, { chunked: true }),
  });
  const video = new mb.CanvasSource(canvas, { codec: plan.video, bitrate: videoBitrate(s), keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: s.fps });
  const sound = audio && plan.audio ? new mb.AudioSampleSource({ codec: plan.audio, bitrate: 192_000 }) : null;
  if (sound) output.addAudioTrack(sound);
  await output.start();

  // The song goes in a second at a time, a little ahead of the frames, so the file is written with
  // sound and picture side by side: silence until `leadIn`, then the song.
  let audioUntil = 0;
  const songLength = audio ? (audio.channels[0]?.length ?? 0) / audio.sampleRate : 0;
  const audioEnd = audio ? audio.leadIn + songLength : 0;
  const feed = async (until: number) => {
    if (!sound || !audio) return;
    const { channels, sampleRate: rate, leadIn } = audio;
    const n = channels.length;
    while (audioUntil < Math.min(until, audioEnd)) {
      const from = audioUntil;
      const to = Math.min(audioEnd, from + 1);
      const length = Math.max(1, Math.round((to - from) * rate));
      // Planar: each channel's samples after the one before.
      const data = new Float32Array(length * n);
      const start = Math.round((from - leadIn) * rate);
      for (let c = 0; c < n; c++) {
        const src = channels[c];
        const a = Math.max(0, -start);
        const b = Math.min(length, src.length - start);
        if (b > a) data.set(src.subarray(start + a, start + b), c * length + a);
      }
      audioUntil = to;
      await sound.add(new mb.AudioSample({ data, format: 'f32-planar', numberOfChannels: n, sampleRate: rate, timestamp: from }));
    }
    if (audioUntil >= audioEnd && audioEnd > 0) sound.close();
  };

  const step = 1 / s.fps;
  return {
    async frame(index) {
      await feed(index * step + 1);
      await video.add(index * step, step);
    },
    async finish() {
      await feed(Number.POSITIVE_INFINITY);
      video.close();
      await output.finalize();
      return file.blob('video/mp4');
    },
    cancel: () => output.cancel(),
  };
}
