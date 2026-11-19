import { ArrowLeft, CircleDot, Clapperboard, Film, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import type { Chart } from '../chart/types';
import { PlayController, REPLAY_START } from '../game/PlayController';
import type { ReplayInputs } from '../game/replay';
import { multiplierFor, MAX_MULTIPLIER, STREAK_PER_MULTIPLIER } from '../game/scoring';
import type { Settings } from '../game/settings';
import {
  browserVideoFormat,
  videoBitrate,
  VideoRecorder,
  videoSize,
  type VideoExportSettings,
  type VideoFormat,
} from '../game/videoExport';
import { drawVideoHud } from '../render/videoHud';
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
  onStart(s: VideoExportSettings, format: VideoFormat): void;
  onClose(): void;
}

/**
 * How the video of a replay should look, before it is recorded: with or without the HUD, the stage
 * and the music, wide or upright, its size and frame rate. The choices are remembered.
 */
export function ExportVideoDialog({ replay, silent, settings: s, onChange, onStart, onClose }: DialogProps) {
  const music = s.music && !silent;
  const format = browserVideoFormat(music);
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
          {format ? (
            <p className="hint export-summary">
              {format.ext.toUpperCase()} · {size.width}×{size.height} · {s.fps} fps{music ? '' : ' · no sound'}. Recorded as the replay
              plays, so it takes {clock(replay.duration + 4)}. Keep the game in front until it is done.
              {format.ext === 'webm' && ' This browser cannot write MP4: the video is saved as WebM. The desktop app and Chrome write MP4.'}
              {silent && ' The song is no longer in your library, so the video has no music.'}
            </p>
          ) : (
            <p className="error">This browser cannot record video. The desktop app, Chrome, Edge and Safari can.</p>
          )}
          <button
            type="button"
            className="btn primary wide"
            data-autofocus
            disabled={!format}
            onClick={() => format && onStart({ ...s, music }, format)}
          >
            <Film strokeWidth={ICON_STROKE} aria-hidden />
            Record video
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
  format: VideoFormat;
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
export function VideoExportScreen({ replay, chart, inputs, buffer, settings, video, format, target, fileName, onDone }: ScreenProps) {
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
  const cancelRef = useRef<() => void>(() => {});
  // The settings the recording starts with: later changes do not restart it.
  const settingsRef = useRef(settings);
  const hints = useHints(settings);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    let live = true;
    const engine = getEngine();
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
    const night = g.createLinearGradient(0, 0, 0, height);
    night.addColorStop(0, '#1a0f4c');
    night.addColorStop(1, '#05030f');
    const scoreLabel = `${PART_LABEL[chart.part]} score`;
    let endAt = 0;
    let shownSecond = -1;

    ctrl.onFrame = (t) => {
      g.fillStyle = video.stage ? '#05030f' : night;
      g.fillRect(0, 0, width, height);
      if (stageFrame) g.drawImage(stageFrame, 0, 0, width, height);
      const hw = hwRef.current!;
      g.drawImage(hw, 0, 0, width, height);
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
          feedback: fb ? { ...fb, age: (performance.now() - fb.at) / 1000 } : null,
          deck: layout ? { x: layout.x * k, y: layout.y * k, foot: layout.foot * k, width: layout.width * k } : null,
        });
      }
      const p = Math.max(0, Math.min(1, (t - REPLAY_START) / (chart.duration - REPLAY_START)));
      barRef.current?.style.setProperty('width', `${(p * 100).toFixed(2)}%`);
      const sec = Math.floor(Math.max(0, Math.min(t, chart.duration)));
      if (sec !== shownSecond && timeRef.current) {
        shownSecond = sec;
        timeRef.current.textContent = `${clock(Math.min(t, chart.duration))} / ${clock(chart.duration)}`;
      }
      if (endAt && performance.now() >= endAt) void finish();
    };
    ctrl.onPhase = (p) => {
      if (p === 'finished' && !endAt) endAt = performance.now() + TAIL * 1000;
    };

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      ctrl.onFrame = null;
      setStage('saving');
      try {
        const file = await recorder.stop();
        await target.write(file);
        await target.close();
        if (live) setStage('saved');
      } catch (e) {
        await target.abort().catch(() => {});
        if (!live) return;
        setError((e as Error).message);
        setStage('failed');
      }
    };
    cancelRef.current = () => {
      if (finished) return doneRef.current();
      finished = true;
      recorder.cancel();
      void target.abort().catch(() => {});
      doneRef.current();
    };

    // A hidden window draws nothing: the replay and the recording wait for it together.
    const hidden = () => {
      if (finished || !recorder) return;
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

    void (async () => {
      // The HUD's face must be loaded before the first frame is drawn with it.
      await document.fonts?.load(`italic 900 32px "Archivo Variable"`).catch(() => undefined);
      await ctrl.ready;
      if (!live) return;
      recorder.start();
      setStage('recording');
      await ctrl.start();
    })().catch((e) => {
      if (!live) return;
      setError((e as Error).message);
      setStage('failed');
    });

    return () => {
      live = false;
      document.removeEventListener('visibilitychange', hidden);
      if (!finished) {
        recorder.cancel();
        void target.abort().catch(() => {});
      }
      if (sound) engine.tap.disconnect(sound);
      ctrl.captureStage(null);
      stageFrame?.close();
      ctrl.dispose();
    };
  }, [buffer, chart, inputs, video, format, target, replay, width, height]);

  const working = stage === 'preparing' || stage === 'recording' || stage === 'paused' || stage === 'saving';
  useActions(
    working
      ? [{ id: 'cancel', label: 'Cancel', icon: X, kbd: 'Escape', sfx: 'back', bar: false, run: () => cancelRef.current() }]
      : [{ id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', bar: false, run: onDone }],
  );

  const status = {
    preparing: 'Getting the stage ready…',
    recording: 'Recording',
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
              The video is recorded as the replay plays. Keep the game in front until it is done; the song plays along.
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
