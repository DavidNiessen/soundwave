/**
 * A replay's video, made from start to end without a page: in a worker of its own, so the game
 * stays free while it is made. The replay is played back frame by frame on the video's clock; each
 * frame the stage and the highway are drawn on canvases of their own, laid onto the video's canvas
 * with the HUD (see composeVideoFrame), and encoded with the song beside them (see videoRender).
 */
import { BufferAnalyser } from '../audio/bufferAnalyser';
import { FINALE_SECONDS, REPLAY_START } from '../game/timing';
import { ReplayPlayback } from '../game/replay';
import { highwaySpeed } from '../game/settings';
import { feedbackFor, ShowPulse } from '../game/showPulse';
import { videoSize } from '../game/videoExport';
import { startFrameEncoder } from '../game/videoRender';
import { AuroraStage } from '../render/aurora/AuroraStage';
import { Highway, type HighwayLayout } from '../render/Highway';
import { composeVideoFrame, videoHudFrame } from '../render/videoHud';
import type { VideoJob } from './protocol';

/** Seconds of the finale after the last note. */
export const VIDEO_TAIL = 3;

export class VideoCancelled extends Error {}

export interface VideoHooks {
  /** Called now and then: the share made (0..1), and seconds of video per second of work. */
  progress(done: number, speed: number | null): void;
  /** Resolves once the job may go on (it waits while a song is played). */
  mayGoOn(): Promise<void>;
  cancelled(): boolean;
}

const PART_NAME = { lead: 'Lead', bass: 'Bass', drums: 'Drums', vocals: 'Vocals' } as const;

export async function makeReplayVideo(job: VideoJob, hooks: VideoHooks): Promise<Blob> {
  const { chart, video } = job;
  const { width, height } = videoSize(video);
  const out = new OffscreenCanvas(width, height);
  const g = out.getContext('2d', { alpha: false })!;

  // The highway, laid out as on a screen the size of the video.
  const layout: HighwayLayout = { width, height, dpr: 1, deckShare: 0, strike: 0.8, pads: 'pill' };
  const hwCanvas = new OffscreenCanvas(width, height);
  const highway = new Highway(hwCanvas, chart, () => layout);
  highway.speed = highwaySpeed(job.trackSpeed);
  highway.resize();

  let stage: AuroraStage | null = null;
  const stageCanvas = video.stage ? new OffscreenCanvas(width, height) : null;
  const cleanUp = () => {
    highway.dispose();
    stage?.dispose();
  };

  try {
    await highway.ready;
    if (stageCanvas) {
      try {
        stage = await AuroraStage.create(stageCanvas, job.graphics, { mode: 'play', part: chart.part });
        stage.setSize(width, height, 1);
        await stage.prepare();
      } catch (e) {
        // Without the stage the video is made over the plain night.
        console.warn('The stage could not be built for the video', e);
        stage?.dispose();
        stage = null;
      }
    }
    if (hooks.cancelled()) throw new VideoCancelled();

    const playback = new ReplayPlayback(chart, job.inputs);
    const session = playback.session;
    highway.attach(session);
    let now = 0;
    let feedback: { text: string; kind: string; at: number } | null = null;
    session.on((e) => {
      const fb = feedbackFor(e);
      if (fb) feedback = { text: fb.text, kind: fb.kind, at: now };
      if (e.type === 'overdrive-start') stage?.overdriveStart();
    });

    const clock0 = 0;
    const step = 1000 / video.fps;
    const show = new ShowPulse(chart, clock0);
    const bands = new BufferAnalyser(job.song);
    show.meter.setAnalyser(bands as unknown as AnalyserNode);
    show.from(REPLAY_START);

    const encoder = await startFrameEncoder(out, job.plan, video, job.music ? { ...job.song, leadIn: -REPLAY_START } : null);
    const songLength = (job.song.channels[0]?.length ?? 0) / job.song.sampleRate;
    const length = Math.max(chart.duration, songLength);
    const total = Math.ceil((length + 0.5 + VIDEO_TAIL - REPLAY_START) * video.fps);
    const margin = Math.max(24, Math.min(46, height * 0.034));
    const scoreLabel = `${PART_NAME[chart.part]} score`;
    let over = Number.POSITIVE_INFINITY;
    const began = performance.now();
    let worked = 0;

    try {
      for (let i = 0; i < total; i++) {
        // Waiting (while a song is played) is not counted as work.
        const waitFrom = performance.now();
        await hooks.mayGoOn();
        worked -= performance.now() - waitFrom;
        if (hooks.cancelled()) throw new VideoCancelled();

        const t = REPLAY_START + i / video.fps;
        now = clock0 + i * step;
        bands.at(t);
        if (over === Number.POSITIVE_INFINITY) {
          playback.advance(t);
          if (t > chart.duration + 0.5 && t > songLength) {
            playback.finish();
            stage?.finale(FINALE_SECONDS);
            over = t;
          }
        }
        const f = show.frame(t, now, session.overdriveActive, !!stage);
        // The stage and the highway are drawn, and read, in this one task: their pictures are
        // still in their canvases.
        if (stage && f.stage) {
          stage.setBands(f.bands);
          stage.render({ beat: f.beat, intensity: f.stage.intensity, overdrive: f.stage.overdrive, barSeconds: f.stage.barSeconds, now });
        }
        highway.render(t, session, f.pulse, now);
        let deck = null;
        if (video.hud) {
          const pos = highway.padScreenPositions();
          const foot = highway.footRow(margin);
          if (pos.length) {
            const first = pos[0];
            const last = pos[pos.length - 1];
            const laneW = pos.length > 1 ? (last.x - first.x) / (pos.length - 1) : 90;
            deck = { x: (first.x + last.x) / 2, y: first.y, foot: foot[0]?.y ?? first.y + 120, width: laneW * pos.length };
          }
        }
        const hud = video.hud
          ? videoHudFrame({
              t,
              now,
              duration: chart.duration,
              title: job.title,
              artist: job.artist,
              scoreLabel,
              session,
              feedback,
              deck,
            })
          : null;
        composeVideoFrame(g, width, height, stage ? stageCanvas : null, hwCanvas, hud);
        await encoder.frame(i);
        // The encoder's promises can keep this loop going without ever giving the worker's messages
        // a turn: it lets them in now and then, so a pause or a cancel is heard at once.
        if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));

        if (i % 10 === 0) {
          const spent = (performance.now() - began + worked) / 1000;
          hooks.progress(i / total, spent > 0.5 ? (i + 1) / video.fps / spent : null);
        }
        if (t - over >= VIDEO_TAIL) break;
      }
    } catch (e) {
      await encoder.cancel().catch(() => {});
      throw e;
    }
    const file = await encoder.finish();
    hooks.progress(1, null);
    return file;
  } finally {
    cleanUp();
  }
}
