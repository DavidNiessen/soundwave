import { ArrowLeft, CircleDot, Clapperboard, Film, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import type { Chart } from '../chart/types';
import { PlayController, REPLAY_START } from '../game/PlayController';
import type { ReplayInputs } from '../game/replay';
import { multiplierFor, MAX_MULTIPLIER, STREAK_PER_MULTIPLIER } from '../game/scoring';
import type { Settings } from '../game/settings';
import { videoBitrate, VideoRecorder, videoSize, type VideoExportSettings } from '../game/videoExport';
import { drawVideoHud } from '../render/videoHud';
import { planVideo, songSamples, startFrameEncoder, type FrameEncoder, type VideoPlan } from '../game/videoRender';
import type { SaveTarget } from '../storage/share';
import type { ReplayMeta } from '../storage/replays';
import { backInput } from '../input/pads';
import { Hint, useActions, useHints } from './actions';
import { Dialog } from './Dialog';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_LABEL } from './icons';
import { hudRefs, PlayHud } from './PlayHud';
import { clock } from './ReplayScreen';

/** One choice of the export settings: its options, side by side. */
interface Choice<T> {
  id: keyof VideoExportSettings;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  set(v: T): void;
  disabled?: boolean;
}

function ChoiceRow<T extends string | number | boolean>({ choice }: { choice: Choice<T> }) {
  return (
    <div className="export-row" role="radiogroup" aria-label={choice.label}>
      <span className="export-label">{choice.label}</span>
      <div className="export-options">
        {choice.options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={choice.value === o.value}
            className={`export-option ${choice.value === o.value ? 'on' : ''}`}
            disabled={choice.disabled}
            onClick={() => choice.set(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

interface DialogProps {
  replay: ReplayMeta;
  /** The song is no longer in the library: the video can have no music. */
  silent: boolean;
  settings: VideoExportSettings;
  onChange(s: VideoExportSettings): void;
  /** Starts the export; called straight from the press, so the save dialog may open. */
  onStart(s: VideoExportSettings, plan: VideoPlan): void;
  onClose(): void;
}

/**
 * How the video of a replay should look, before it is recorded: with or without the HUD, the stage
 * and the music, wide or upright, its size and frame rate. The choices are remembered.
 */
export function ExportVideoDialog({ replay, silent, settings: s, onChange, onStart, onClose }: DialogProps) {
  const music = s.music && !silent;
  // How this browser can make it: frame by frame where it can encode, else recorded as it plays.
  const [plan, setPlan] = useState<VideoPlan | null | undefined>(undefined);
  const key = `${music}|${s.quality}|${s.fps}|${s.layout}`;
  useEffect(() => {
    let live = true;
    setPlan(undefined);
    void planVideo(s, music).then((p) => live && setPlan(p));
    return () => {
      live = false;
    };
    // oxlint-disable-next-line react/exhaustive-deps -- `key` holds what the plan depends on
  }, [key]);
  const format = plan ? (plan.kind === 'live' ? plan.format : null) : null;
  const size = videoSize(s);
  const set = (patch: Partial<VideoExportSettings>) => onChange({ ...s, ...patch });
  const onOff = (on: string, off: string) => [
    { value: true, label: on },
    { value: false, label: off },
  ];
  const choices: Choice<string | number | boolean>[] = [
    { id: 'hud', label: 'HUD', value: s.hud, options: onOff('Show', 'Hide'), set: (v) => set({ hud: v as boolean }) },
    { id: 'stage', label: 'Stage', value: s.stage, options: onOff('Show', 'Hide'), set: (v) => set({ stage: v as boolean }) },
    {
      id: 'music',
      label: 'Music',
      value: music,
      options: onOff('On', 'Off'),
      set: (v) => set({ music: v as boolean }),
      disabled: silent,
    },
    {
      id: 'layout',
      label: 'Shape',
      value: s.layout,
      options: [
        { value: 'landscape', label: 'Wide 16:9' },
        { value: 'portrait', label: 'Upright 9:16' },
      ],
      set: (v) => set({ layout: v as VideoExportSettings['layout'] }),
    },
    {
      id: 'quality',
      label: 'Quality',
      value: s.quality,
      options: [
        { value: '720p', label: '720p' },
        { value: '1080p', label: '1080p' },
        { value: '1440p', label: '1440p' },
      ],
      set: (v) => set({ quality: v as VideoExportSettings['quality'] }),
    },
    {
      id: 'fps',
      label: 'Frame rate',
      value: s.fps,
      options: [
        { value: 30, label: '30 fps' },
        { value: 60, label: '60 fps' },
      ],
      set: (v) => set({ fps: v as 30 | 60 }),
    },
  ];
  return (
    <Dialog title="Export video" variant="card" className="wide-card" closeLabel="Cancel" onClose={onClose}>
      {(close) => (
        <div className="pause-card export-card">
          <h2 className="display">Export video</h2>
          <p className="pause-song">
            {replay.title} · {PART_LABEL[replay.part]} · {DIFFICULTY_LABEL[replay.difficulty]}
          </p>
          <div className="export-rows" data-nav-group="export">
            {choices.map((c) => (
              <ChoiceRow key={c.id} choice={c} />
            ))}
          </div>
          {plan === undefined ? (
            <p className="hint export-summary">Checking what this device can encode…</p>
          ) : plan ? (
            <p className="hint export-summary">
              {plan.ext.toUpperCase()} · {size.width}×{size.height} · {s.fps} fps{music ? '' : ' · no sound'}.{' '}
              {plan.kind === 'frames'
                ? 'Made frame by frame, as fast as this device can draw them: usually well under the song’s length.'
                : `Recorded as the replay plays, so it takes ${clock(replay.duration + 4)}. Keep the game in front until it is done.`}
              {format?.ext === 'webm' &&
                ' This browser cannot write MP4: the video is saved as WebM. The desktop app and Chrome write MP4.'}
              {silent && ' The song is no longer in your library, so the video has no music.'}
            </p>
          ) : (
            <p className="error">This browser cannot make video. The desktop app, Chrome, Edge and Safari can.</p>
          )}
          <button
            type="button"
            className="btn primary wide"
            data-autofocus
            disabled={!plan}
            onClick={() => plan && onStart({ ...s, music }, plan)}
          >
            <Film strokeWidth={ICON_STROKE} aria-hidden />
            {plan?.kind === 'live' ? 'Record video' : 'Make video'}
          </button>
          <button type="button" className="btn quiet wide" data-sfx="back" onClick={close}>
            Cancel
          </button>
        </div>
      )}
    </Dialog>
  );
}

interface ScreenProps {
  replay: ReplayMeta;
  chart: Chart;
  inputs: ReplayInputs;
  buffer: AudioBuffer;
  settings: Settings;
  video: VideoExportSettings;
  /** How it is made: frame by frame where the browser can encode, else recorded as it plays. */
  plan: VideoPlan;
  /** Where the file goes (chosen before the recording started). */
  target: SaveTarget;
  fileName: string;
  onDone(): void;
}

type Stage = 'preparing' | 'recording' | 'paused' | 'saving' | 'saved' | 'failed';

/** Seconds recorded after the last note: the stage's finale. */
const TAIL = 3;

/**
 * Records a replay's video: the replay plays in a frame the size of the video, out of sight, and
 * every frame of it is laid onto the canvas shown here, which is what is recorded. The song plays
 * along as it is recorded. A hidden window pauses the recording and the replay together.
 */
export function VideoExportScreen({ replay, chart, inputs, buffer, settings, video, plan, target, fileName, onDone }: ScreenProps) {
  const { width, height } = videoSize(video);
  // The frame is laid out at the video's size in device pixels, so the highway draws at that size.
  const [dpr] = useState(() => Math.min(2, window.devicePixelRatio || 1));
  const outRef = useRef<HTMLCanvasElement>(null);
  const hwRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const [stage, setStage] = useState<Stage>('preparing');
  const [error, setError] = useState('');
  /** How many seconds of video are made per second, while frames are made one by one. */
  const [speed, setSpeed] = useState<number | null>(null);
  const cancelRef = useRef<() => void>(() => {});
  // The settings the recording starts with: later changes do not restart it.
  const settingsRef = useRef(settings);
  const hints = useHints(settings);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let live = true;
    const engine = getEngine();
    const frames = plan.kind === 'frames';
    const ctrl = new PlayController(
      engine,
      buffer,
      chart,
      // The video keeps the player's track speed; nothing of the song may rumble or wait on an offset.
      { ...settingsRef.current, offsetMs: 0 },
      hwRef.current!,
      hudRefs(hudRef.current!),
      video.stage ? stageRef.current! : undefined,
      inputs,
      { graphClock: true },
    );
    const out = outRef.current!;
    const g = out.getContext('2d', { alpha: false })!;
    const night = g.createLinearGradient(0, 0, 0, height);
    night.addColorStop(0, '#1a0f4c');
    night.addColorStop(1, '#05030f');
    const scoreLabel = `${PART_LABEL[chart.part]} score`;
    const length = Math.max(chart.duration, buffer.duration);
    let shownSecond = -1;

    /**
     * Lays one frame of the video: the stage, the highway (`highway`: its canvas, or a copy taken
     * as it was drawn), the HUD. `now`: the clock it was drawn on, ms.
     */
    const compose = (t: number, stageFrame: ImageBitmap | null, now: number, highway: CanvasImageSource = hwRef.current!) => {
      g.fillStyle = video.stage ? '#05030f' : night;
      g.fillRect(0, 0, width, height);
      if (stageFrame) g.drawImage(stageFrame, 0, 0, width, height);
      const hw = hwRef.current!;
      g.drawImage(highway, 0, 0, width, height);
      if (video.hud) {
        const s = ctrl.session;
        const layout = ctrl.hudLayout();
        const k = width / Math.max(1, hw.clientWidth);
        const top = multiplierFor(s.streak) >= MAX_MULTIPLIER;
        const fb = ctrl.lastFeedback;
        drawVideoHud(g, width, height, {
          t,
          duration: chart.duration,
          title: replay.title,
          artist: replay.artist,
          scoreLabel,
          score: s.score,
          multiplier: s.multiplier,
          level: multiplierFor(s.streak),
          streakP: top ? 1 : (s.streak % STREAK_PER_MULTIPLIER) / STREAK_PER_MULTIPLIER,
          streak: s.streak,
          overdrive: s.overdrive,
          overdriveActive: s.overdriveActive,
          stars: s.progressStars,
          starP: s.nextStarProgress,
          feedback: fb ? { ...fb, age: (now - fb.at) / 1000 } : null,
          deck: layout ? { x: layout.x * k, y: layout.y * k, foot: layout.foot * k, width: layout.width * k } : null,
        });
      }
      const p = Math.max(0, Math.min(1, (t - REPLAY_START) / (length + TAIL - REPLAY_START)));
      barRef.current?.style.setProperty('width', `${(p * 100).toFixed(2)}%`);
      const sec = Math.floor(Math.max(0, Math.min(t, chart.duration)));
      if (sec !== shownSecond && timeRef.current) {
        shownSecond = sec;
        timeRef.current.textContent = `${clock(Math.min(t, chart.duration))} / ${clock(chart.duration)}`;
      }
    };

    let finished = false;
    /** Writes the finished file where the player chose. */
    const save = async (file: () => Promise<Blob>) => {
      setStage('saving');
      try {
        const blob = await file();
        await target.write(blob);
        await target.close();
        if (live) setStage('saved');
      } catch (e) {
        await target.abort().catch(() => {});
        if (!live) return;
        setError((e as Error).message);
        setStage('failed');
      }
    };
    const failed = (e: unknown) => {
      if (!live || finished) return;
      finished = true;
      void target.abort().catch(() => {});
      setError((e as Error).message);
      setStage('failed');
    };

    let stopLive = () => {};
    let cancelWork: () => void = () => {};
    cancelRef.current = () => {
      if (finished) return doneRef.current();
      finished = true;
      cancelWork();
      void target.abort().catch(() => {});
      doneRef.current();
    };

    if (frames) {
      // Frame by frame: nothing plays; every frame is drawn on the video's clock and encoded as
      // soon as it is drawn, as fast as this device can.
      let encoder: FrameEncoder | null = null;
      cancelWork = () => void encoder?.cancel().catch(() => {});
      void (async () => {
        await document.fonts?.load(`italic 900 32px "Archivo Variable"`).catch(() => undefined);
        await ctrl.ready;
        if (!live || finished) return;
        encoder = await startFrameEncoder(out, plan, video, video.music ? { ...songSamples(buffer), leadIn: -REPLAY_START } : null);
        if (!live || finished) return void encoder.cancel();
        const clock0 = performance.now();
        const step = 1000 / video.fps;
        ctrl.beginFrames(clock0);
        setStage('recording');
        const began = performance.now();
        let over = false;
        let endAt = Number.POSITIVE_INFINITY;
        ctrl.onPhase = (p) => {
          if (p === 'finished') over = true;
        };
        const total = Math.ceil((length + 0.5 + TAIL - REPLAY_START) * video.fps);
        const timeOf = (i: number) => REPLAY_START + i / video.fps;
        // The highway is copied as soon as it is drawn, so the stage's picture can be waited for.
        const layer = document.createElement('canvas');
        layer.width = width;
        layer.height = height;
        const lg = layer.getContext('2d')!;
        // A frame ahead: while the stage's worker draws the next frame, the page draws the
        // highway and encodes this one.
        let job = ctrl.beginFrame(timeOf(0), clock0);
        for (let i = 0; i < total && !finished; i++) {
          const t = job.t;
          const now = job.now;
          const picture = await ctrl.drawFrame(job, () => {
            lg.clearRect(0, 0, width, height);
            lg.drawImage(hwRef.current!, 0, 0, width, height);
          });
          if (finished || !live) return void picture?.close();
          compose(t, picture, now, layer);
          picture?.close();
          if (i + 1 < total) job = ctrl.beginFrame(timeOf(i + 1), clock0 + (i + 1) * step);
          await encoder.frame(i);
          if (i % 15 === 0) {
            const made = (i + 1) / video.fps;
            const spent = (performance.now() - began) / 1000;
            setSpeed(spent > 0.5 ? made / spent : null);
          }
          // Once the finale has had its seconds, the video ends.
          if (over && endAt === Number.POSITIVE_INFINITY) endAt = t;
          if (t - endAt >= TAIL) break;
        }
        // The frame begun ahead of the last one is not needed.
        void job.picture.then((p) => p?.close());
        if (finished || !live) return;
        finished = true;
        await save(() => encoder!.finish());
      })().catch(failed);
    } else {
      // Live: the replay plays at its own speed with the song, and the canvas is recorded as it is drawn.
      const format = plan.format;
      let stageFrame: ImageBitmap | null = null;
      if (video.stage)
        ctrl.captureStage((f) => {
          stageFrame?.close();
          stageFrame = f;
        });
      // The song, at full level, for the recording (the player still hears it at their own volume).
      const sound = video.music ? engine.ctx.createMediaStreamDestination() : null;
      if (sound) engine.tap.connect(sound);
      const recorder = new VideoRecorder(out, format, video.fps, videoBitrate(video), sound?.stream);
      let endAt = 0;
      ctrl.onFrame = (t) => {
        compose(t, stageFrame, performance.now());
        if (endAt && performance.now() >= endAt && !finished) {
          finished = true;
          ctrl.onFrame = null;
          void save(() => recorder.stop());
        }
      };
      ctrl.onPhase = (p) => {
        if (p === 'finished' && !endAt) endAt = performance.now() + TAIL * 1000;
      };
      cancelWork = () => recorder.cancel();
      // A hidden window draws nothing: the replay and the recording wait for it together.
      const hidden = () => {
        if (finished) return;
        if (document.hidden) {
          ctrl.pause();
          recorder.pause();
          setStage((s) => (s === 'recording' ? 'paused' : s));
        } else if (ctrl.currentPhase === 'paused') {
          recorder.resume();
          void ctrl.resume();
          setStage((s) => (s === 'paused' ? 'recording' : s));
        }
      };
      document.addEventListener('visibilitychange', hidden);
      stopLive = () => {
        document.removeEventListener('visibilitychange', hidden);
        if (sound) engine.tap.disconnect(sound);
        ctrl.captureStage(null);
        stageFrame?.close();
      };
      void (async () => {
        // The HUD's face must be loaded before the first frame is drawn with it.
        await document.fonts?.load(`italic 900 32px "Archivo Variable"`).catch(() => undefined);
        await ctrl.ready;
        if (!live || finished) return;
        recorder.start();
        setStage('recording');
        await ctrl.start();
      })().catch(failed);
    }

    return () => {
      live = false;
      if (!finished) {
        finished = true;
        cancelWork();
        void target.abort().catch(() => {});
      }
      stopLive();
      ctrl.dispose();
    };
  }, [buffer, chart, inputs, video, plan, target, replay, width, height]);

  const working = stage === 'preparing' || stage === 'recording' || stage === 'paused' || stage === 'saving';
  useActions(
    working
      ? [{ id: 'cancel', label: 'Cancel', icon: X, kbd: 'Escape', sfx: 'back', bar: false, run: () => cancelRef.current() }]
      : [{ id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', bar: false, run: onDone }],
  );

  const status = {
    preparing: 'Getting the stage ready…',
    recording: plan.kind === 'frames' ? (speed ? `Rendering · ${speed.toFixed(1)}× the song’s speed` : 'Rendering') : 'Recording',
    paused: 'Paused while the game is in the background',
    saving: 'Saving the video…',
    saved: 'Saved',
    failed: 'Not saved',
  }[stage];

  return (
    <div className="export-screen">
      {/* The replay itself, at the video's size, out of sight: what is shown is the recording. */}
      <div className="export-frame" style={{ width: width / dpr, height: height / dpr }} aria-hidden>
        <div className="play replay export" data-lanes={chart.lanes}>
          <div ref={stageRef} className="layer stage-host" />
          <canvas ref={hwRef} className="layer highway" />
          <div ref={hudRef} className="hud">
            <PlayHud title={replay.title} artist={replay.artist} position={1} total={1} chart={chart} settings={settings} replay />
          </div>
        </div>
      </div>
      <div className="export-view">
        <canvas
          ref={outRef}
          className={`export-preview ${video.layout}`}
          width={width}
          height={height}
          aria-label="The video being recorded"
        />
        <section className="export-panel" aria-live="polite">
          <div className="export-status">
            <span className={`export-rec ${stage}`}>
              {stage === 'recording' || stage === 'paused' ? (
                <CircleDot strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <Clapperboard strokeWidth={ICON_STROKE} aria-hidden />
              )}
              {status}
            </span>
            <span className="export-time" ref={timeRef}>
              0:00 / {clock(chart.duration)}
            </span>
          </div>
          <span className="meter export-meter" aria-hidden>
            <span ref={barRef} style={{ width: stage === 'saved' ? '100%' : '0%' }} />
          </span>
          {stage === 'saved' && <p className="hint">{fileName} is saved.</p>}
          {stage === 'failed' && <p className="error">The video could not be made: {error}</p>}
          {working && stage !== 'saving' && (
            <p className="hint">
              {plan.kind === 'frames'
                ? 'Each frame is drawn and encoded as fast as this device can; the song does not play meanwhile.'
                : 'The video is recorded as the replay plays. Keep the game in front until it is done; the song plays along.'}
            </p>
          )}
          {working ? (
            <button
              type="button"
              className="btn wide"
              data-action="cancel"
              data-sfx="back"
              data-autofocus
              onClick={() => cancelRef.current()}
            >
              <Hint kbd="Escape" pad={backInput(hints.style)} {...hints} />
              <X strokeWidth={ICON_STROKE} aria-hidden />
              Cancel
            </button>
          ) : (
            <button type="button" className="btn primary wide" data-action="back" data-autofocus onClick={onDone}>
              <Hint kbd="Escape" pad={backInput(hints.style)} {...hints} />
              <ArrowLeft strokeWidth={ICON_STROKE} aria-hidden />
              Back
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
