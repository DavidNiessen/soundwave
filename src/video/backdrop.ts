/**
 * The player's own picture, video or gradient behind the highway, as a replay's video shows it: filling the
 * frame as on screen (cover), the video looping from its start, both darkened by the stage's dim
 * and swelling with the bass as StageBackdrop (src/ui/StageBackdrop.tsx) does in the game.
 */
import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny';

type Ctx2D = OffscreenCanvasRenderingContext2D;

export interface VideoBackdrop {
  /** The picture to lay down at `t` seconds into the video (null: none yet). */
  at(t: number): Promise<CanvasImageSource | null>;
  dispose(): void;
}

/** A gradient of the player's colours, as CSS draws `linear-gradient(160deg, from, to)`. */
export function gradientBackdrop([from, to]: [string, string], width: number, height: number): VideoBackdrop {
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d')!;
  const angle = (160 * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2;
  const fill = g.createLinearGradient(width / 2 - dx * half, height / 2 - dy * half, width / 2 + dx * half, height / 2 + dy * half);
  fill.addColorStop(0, from);
  fill.addColorStop(1, to);
  g.fillStyle = fill;
  g.fillRect(0, 0, width, height);
  return { at: async () => canvas, dispose: () => {} };
}

/** A picture, laid out once at the video's size. */
export async function pictureBackdrop(file: Blob, width: number, height: number): Promise<VideoBackdrop> {
  const bitmap = await createImageBitmap(file);
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d')!;
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  g.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h);
  bitmap.close();
  return { at: async () => canvas, dispose: () => {} };
}

/** A video, decoded as the replay's video goes and looped; null where it cannot be decoded here. */
export async function movingBackdrop(file: Blob, width: number, height: number): Promise<VideoBackdrop | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack().catch(() => null);
  if (!track || !(await track.canDecode().catch(() => false))) {
    input.dispose();
    return null;
  }
  const start = await track.getFirstTimestamp();
  const length = (await track.computeDuration()) - start;
  if (!(length > 0)) {
    input.dispose();
    return null;
  }
  const sink = new CanvasSink(track, { width, height, fit: 'cover' });
  let frames: AsyncGenerator<WrappedCanvas> | null = null;
  let current: WrappedCanvas | null = null;
  let ahead: WrappedCanvas | null = null;
  let last = -1;
  return {
    async at(t) {
      const local = start + (Math.max(0, t) % length);
      // Looped round to its start again: decoding starts over.
      if (!frames || local < last) {
        void frames?.return(undefined);
        frames = sink.canvases(start);
        current = ahead = null;
      }
      last = local;
      for (;;) {
        if (!ahead) {
          const next = await frames.next();
          if (next.done) break;
          ahead = next.value;
        }
        if (ahead.timestamp > local) break;
        current = ahead;
        ahead = null;
      }
      return current?.canvas ?? null;
    },
    dispose() {
      void frames?.return(undefined);
      input.dispose();
    },
  };
}

/**
 * Lays the backdrop down, darkened as the game darkens it: brightness (1 - dim) × (0.92 + 0.22 ×
 * bass), as `.backdrop-fill` in styles.css (above 1 it is left at 1).
 */
export function drawBackdrop(g: Ctx2D, width: number, height: number, picture: CanvasImageSource | null, dim: number, bass: number) {
  g.fillStyle = '#000';
  if (!picture) return g.fillRect(0, 0, width, height);
  g.drawImage(picture, 0, 0, width, height);
  const brightness = Math.min(1, (1 - dim) * (0.92 + 0.22 * bass));
  if (brightness >= 1) return;
  g.globalAlpha = 1 - brightness;
  g.fillRect(0, 0, width, height);
  g.globalAlpha = 1;
}
