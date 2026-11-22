import type { Chart } from '../chart/types';
import type { GraphicsSettings } from '../game/graphics';
import type { StageLook } from '../render/stage/look';
import type { VenueId } from '../render/venues/catalog';
import type { ReplayInputs } from '../game/replay';
import type { VideoExportSettings } from '../game/videoExport';
import type { SongSamples, VideoPlan } from '../game/videoRender';

/** Everything a worker needs to make a replay's video, with nothing of the page. */
export interface VideoJob {
  id: string;
  title: string;
  artist: string;
  chart: Chart;
  inputs: ReplayInputs;
  /** The song's samples (copies, handed over to the worker). */
  song: SongSamples;
  /** Whether the video has the song in it. */
  music: boolean;
  trackSpeed: number;
  /** The stage's graphics, as the page resolved them. */
  graphics: GraphicsSettings;
  /**
   * What stands behind the highway: the player's stage (its venue, picked already when it is
   * Random, and its look), or the colours of a gradient of their own, or the plain night.
   */
  backdrop: { kind: 'venue'; venue: VenueId; look: StageLook } | { kind: 'gradient'; colors: [string, string] } | { kind: 'night' };
  video: VideoExportSettings;
  plan: Extract<VideoPlan, { kind: 'frames' }>;
}

/** From the page to the video worker. */
export type ToVideo =
  /** Asks whether the worker can make videos: draw with WebGL and encode with WebCodecs. */
  | { type: 'probe' }
  | { type: 'start'; job: VideoJob }
  /** Holds the job between two frames until `resume` (a song is being played). */
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel'; id: string };

/** From the video worker to the page. */
export type FromVideo =
  | { type: 'probe'; ok: boolean }
  /** `done`: the share of the video made, 0..1; `speed`: seconds of video made per second. */
  | { type: 'progress'; id: string; done: number; speed: number | null }
  | { type: 'done'; id: string; file: Blob }
  | { type: 'failed'; id: string; message: string }
  | { type: 'cancelled'; id: string };
