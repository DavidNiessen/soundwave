import { ArrowLeft, CircleDot, Eye, EyeOff, FastForward, Film, Minus, Pause, Play, Plus, Rewind, RotateCcw, SkipBack } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEngine } from '../audio/engine';
import { playSfx } from '../audio/sfx';
import type { Chart } from '../chart/types';
import { PlayController, REPLAY_START, timelineShape, type PlayPhase } from '../game/PlayController';
import { replayMisses, type ReplayInputs } from '../game/replay';
import type { Settings } from '../game/settings';
import { keysOf } from '../input/bindings';
import { useInputMode } from '../input/inputMode';
import { NAV_EVENT, TAB_EVENT, type Dir } from '../input/menuNav';
import { backInput, confirmInput, pads, PAUSE_INPUT } from '../input/pads';
import { menuPulse } from '../input/rumble';
import { MODE_LABEL, type ReplayMeta } from '../storage/replays';
import { playShowdownSfx } from '../audio/showdownSfx';
import { Hint, useActions, useHints } from './actions';
import { Dialog } from './Dialog';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_LABEL, Stars } from './icons';
import { ExportBox } from './ExportProgress';
import { hudRefs, PlayHud } from './PlayHud';

interface Props {
  replay: ReplayMeta;
  /** The chart as it was played. */
  chart: Chart;
  inputs: ReplayInputs;
  buffer: AudioBuffer;
  /** The song is no longer in the library: the replay plays without its music. */
  silent: boolean;
  settings: Settings;
  onBack(): void;
  /** Asks how to export the replay as a video (it pauses first). */
  onExport(): void;
}

/** The playback speeds, slowest first. */
export const REPLAY_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2] as const;
/** Seconds a jump back or forward covers, and a step along the timeline with the arrows or the D-pad. */
const JUMP = 10;
const NUDGE = 5;
/** Directions on a controller (see input/menuNav). */
const PAD_DIRS = new Set(['b12', 'b13', 'b14', 'b15', 'a0-', 'a0+', 'a1-', 'a1+']);
const ARROW_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** A song time as m:ss (negative times, before the song, count as 0:00). */
export const clock = (t: number) => {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** When a replay was played: "18 Nov, 21:04", with the year when it was another year. */
export function replayDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

const speedLabel = (r: number) => `${r}×`;

/**
 * A saved run played back on the highway and the stage, as it was played: every hit, miss, hold
 * and overdrive. It can be paused, jumped through, played from the start and slowed down or sped
 * up. The controls step aside while it plays, and come back with any input.
 */
export function ReplayScreen({ replay, chart, inputs, buffer, silent, settings, onBack, onExport }: Props) {
  const hints = useHints(settings);
  const styleRef = useRef(hints.style);
  styleRef.current = hints.style;
  const mode = useInputMode();
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hwRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const ctrlRef = useRef<PlayController | null>(null);
  const [phase, setPhase] = useState<PlayPhase>('playing');
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const [rate, setRateState] = useState(1);
  /** The end of the replay was reached: its card is up. */
  const [ended, setEnded] = useState(false);
  /** The controls are in view. They step aside only when the player hides them (the hide key or button). */
  const [awake, setAwake] = useState(true);
  const away = !awake && !ended;
  const awayRef = useRef(away);
  awayRef.current = away;
  const duration = Math.max(chart.duration, buffer.duration);

  /** The last Showdown Strike or hit the replay passed, said over the highway for a moment. */
  const [mark, setMark] = useState<{ kind: 'strike' | 'hit'; key: number } | null>(null);
  useEffect(() => {
    if (!mark) return;
    const t = window.setTimeout(() => setMark(null), 2200);
    return () => clearTimeout(t);
  }, [mark]);
  const wake = useCallback(() => setAwake(true), []);
  const sleep = () => setAwake(false);

  useEffect(() => {
    const ctrl = new PlayController(
      getEngine(),
      buffer,
      chart,
      settingsRef.current,
      hwRef.current!,
      hudRefs(hudRef.current!),
      stageRef.current!,
      inputs,
    );
    ctrl.onPhase = (p) => {
      setPhase(p);
      if (p === 'finished') setEnded(true);
    };
    ctrl.onFinish = () => playSfx('finale');
    // A Showdown replay says each Strike the player made and each hit on them, as it happened.
    ctrl.onReplayMark = (kind) => {
      playShowdownSfx(kind === 'strike' ? 'strike' : 'impact');
      setMark({ kind, key: performance.now() });
    };
    ctrlRef.current = ctrl;
    void ctrl.start();
    // A replay that loses the window pauses, as a song does.
    const hidden = () => document.hidden && ctrl.pause();
    document.addEventListener('visibilitychange', hidden);
    // The time and the timeline's head follow the song every frame, outside React.
    let raf = 0;
    let shown = '';
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const t = ctrl.time;
      const p = Math.max(0, Math.min(1, t / ctrl.duration));
      scrubRef.current?.style.setProperty('--p', p.toFixed(4));
      const now = clock(t);
      if (now === shown) return;
      shown = now;
      if (timeRef.current) timeRef.current.textContent = now;
      scrubRef.current?.setAttribute('aria-valuenow', String(Math.max(0, Math.floor(t))));
      scrubRef.current?.setAttribute('aria-valuetext', `${now} of ${clock(ctrl.duration)}`);
    };
    draw();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', hidden);
      ctrl.dispose();
      ctrlRef.current = null;
    };
  }, [buffer, chart, inputs]);

  useEffect(() => ctrlRef.current?.applySettings(settings), [settings]);
  // The highway is laid out afresh when another input takes over (touch moves the HUD aside).
  useEffect(() => ctrlRef.current?.relayout(), [mode]);

  const playing = phase === 'playing';
  const toggle = useCallback(() => {
    const c = ctrlRef.current;
    if (!c) return;
    if (c.currentPhase === 'playing') {
      c.pause();
      playSfx('pause');
    } else {
      setEnded(false);
      void c.resume();
      playSfx('resume');
    }
    menuPulse('select');
  }, []);
  const seekTo = useCallback((t: number) => {
    setEnded(false);
    void ctrlRef.current?.seek(t);
  }, []);
  const seekBy = useCallback(
    (d: number) => {
      const c = ctrlRef.current;
      if (c) seekTo(c.time + d);
    },
    [seekTo],
  );
  const restart = useCallback(() => {
    const c = ctrlRef.current;
    if (!c) return;
    setEnded(false);
    void c.seek(REPLAY_START).then(() => c.resume());
  }, []);
  const stepRate = useCallback((d: -1 | 1) => {
    const c = ctrlRef.current;
    if (!c) return;
    const i = REPLAY_SPEEDS.indexOf(c.playbackRate as (typeof REPLAY_SPEEDS)[number]);
    const next = REPLAY_SPEEDS[Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, (i < 0 ? 3 : i) + d))];
    if (next === c.playbackRate) return;
    playSfx('tab');
    menuPulse(d > 0 ? 'tab-right' : 'tab-left');
    setRateState(next);
    void c.setRate(next);
  }, []);
  const exportVideo = () => {
    ctrlRef.current?.pause();
    setEnded(false);
    onExport();
  };
  const toggleControls = () => {
    if (away) wake();
    else sleep();
  };

  // The tab buttons (Q and E, the shoulder buttons) change the speed.
  useEffect(() => {
    const onTab = (e: Event) => {
      if (document.querySelector('[data-modal]')) return;
      stepRate((e as CustomEvent<number>).detail < 0 ? -1 : 1);
    };
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, [stepRate]);

  // Hidden controls stay hidden while the replay's shortcuts are used (play, jumps, speed). They come
  // back with the hide key, a click or tap, or a move or press of the menus: that move or press
  // only brings them back, it does not also act on a control the player could not see.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!awayRef.current || (!ARROW_KEYS.has(e.key) && e.key !== 'Enter')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      wake();
    };
    const pointer = () => awayRef.current && wake();
    const release = pads.capture((e) => {
      if (!e.down || !awayRef.current || (!PAD_DIRS.has(e.input) && e.input !== confirmInput(styleRef.current))) return false;
      wake();
      return true;
    });
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', pointer);
    return () => {
      release();
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', pointer);
    };
  }, [wake]);

  // The timeline takes left and right for itself: a step back or forward through the song.
  useEffect(() => {
    const el = scrubRef.current!;
    const move = (e: Event) => {
      const dir = (e as CustomEvent<{ dir: Dir }>).detail.dir;
      if (dir !== 'left' && dir !== 'right') return;
      e.preventDefault();
      seekBy(dir === 'left' ? -NUDGE : NUDGE);
    };
    el.addEventListener(NAV_EVENT, move);
    return () => el.removeEventListener(NAV_EVENT, move);
  }, [seekBy]);

  // Dragging along the timeline: the song holds still under the finger and plays on when let go.
  const drag = useRef<{ id: number; resume: boolean } | null>(null);
  const timeAt = (x: number) => {
    const r = scrubRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (x - r.left) / Math.max(1, r.width))) * (ctrlRef.current?.duration ?? duration);
  };
  const onScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const c = ctrlRef.current;
    if (!c || e.button > 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, resume: c.currentPhase === 'playing' };
    c.pause();
    seekTo(timeAt(e.clientX));
  };
  const scrubFrame = useRef(0);
  const onScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.id !== e.pointerId) return;
    const x = e.clientX;
    cancelAnimationFrame(scrubFrame.current);
    scrubFrame.current = requestAnimationFrame(() => seekTo(timeAt(x)));
  };
  const onScrubUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d?.id !== e.pointerId) return;
    drag.current = null;
    cancelAnimationFrame(scrubFrame.current);
    const c = ctrlRef.current;
    if (!c) return;
    void c.seek(timeAt(e.clientX)).then(() => (d.resume ? c.resume() : undefined));
  };

  useActions([
    { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', bar: false, run: onBack },
    {
      id: 'play',
      label: playing ? 'Pause' : 'Play',
      icon: playing ? Pause : Play,
      ...keysOf('replay.play'),
      sfx: 'none',
      bar: false,
      run: toggle,
    },
    // The menu button pauses a replay as it pauses a song.
    { id: 'play-menu', label: 'Play or pause', icon: Play, pad: PAUSE_INPUT, bar: false, run: toggle },
    { id: 'rewind', label: `Back ${JUMP} seconds`, icon: Rewind, ...keysOf('replay.back'), bar: false, run: () => seekBy(-JUMP) },
    {
      id: 'forward',
      label: `Forward ${JUMP} seconds`,
      icon: FastForward,
      ...keysOf('replay.forward'),
      bar: false,
      run: () => seekBy(JUMP),
    },
    { id: 'export', label: 'Export video', icon: Film, ...keysOf('replay.export'), bar: false, run: exportVideo },
    { id: 'restart', label: 'From the start', icon: SkipBack, ...keysOf('replay.restart'), bar: false, run: restart },
    {
      id: 'controls',
      label: away ? 'Show the controls' : 'Hide the controls',
      icon: away ? Eye : EyeOff,
      ...keysOf('replay.controls'),
      bar: false,
      run: toggleControls,
    },
  ]);

  const misses = useMemo(() => {
    // One mark per sliver of the timeline is enough to see where it went wrong.
    const at = new Set(replayMisses(chart, inputs).map((t) => Math.round((t / duration) * 400) / 400));
    return [...at].filter((p) => p >= 0 && p <= 1);
  }, [chart, inputs, duration]);
  const shape = useMemo(() => timelineShape(chart, duration), [chart, duration]);
  const r = replay.results;
  const what = `${PART_LABEL[replay.part]} · ${DIFFICULTY_LABEL[replay.difficulty]}`;
  const prev = keysOf('menus.tabPrev');
  const next = keysOf('menus.tabNext');
  const slowest = rate <= REPLAY_SPEEDS[0];
  const fastest = rate >= REPLAY_SPEEDS[REPLAY_SPEEDS.length - 1];

  return (
    <div className={`play replay ${away ? 'away' : ''}`} data-lanes={chart.lanes} data-ring-off={away ? '' : undefined}>
      <div ref={stageRef} className="layer stage-host" />
      <canvas ref={hwRef} className="layer highway" />
      <div ref={hudRef} className="hud">
        <PlayHud title={replay.title} artist={replay.artist} position={1} total={1} chart={chart} settings={settings} replay />
      </div>
      <div className="replay-badge" aria-hidden>
        <CircleDot strokeWidth={ICON_STROKE} />
        Replay
        {replay.mode && <span className={`mode-tag ${replay.mode}`}>{MODE_LABEL[replay.mode]}</span>}
      </div>
      {mark && (
        <p className={`showdown-note replay-mark ${mark.kind}`} key={mark.key} role="status">
          {mark.kind === 'strike' ? 'Strike!' : 'Struck: fog, and the multiplier halved'}
        </p>
      )}

      <div className="replay-stack">
        <ExportBox replayId={replay.id} />
        <section className="replay-dock" aria-label="Replay controls" data-nav-group="replay">
          <header className="replay-head">
            <div className="replay-what">
              <span className="replay-title" title={replay.title}>
                {replay.title}
              </span>
              <span className="replay-sub">
                {what} · {replayDate(replay.date)}
              </span>
            </div>
            <span className="replay-time" aria-hidden>
              <span ref={timeRef}>0:00</span>
              <span className="replay-total"> / {clock(duration)}</span>
            </span>
          </header>
          {silent && <p className="replay-note">Plays without music: the song is no longer in your library.</p>}
          <div
            ref={scrubRef}
            className="replay-scrub"
            role="slider"
            tabIndex={0}
            aria-label="Where in the replay"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={0}
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubUp}
            onPointerCancel={onScrubUp}
          >
            <div className="replay-track" style={shape ? { ['--segments' as string]: shape } : undefined}>
              <div className="replay-fill" />
            </div>
            {misses.map((p) => (
              <span key={p} className="replay-miss" style={{ ['--at' as string]: p }} aria-hidden />
            ))}
            <span className="replay-head-dot" aria-hidden />
          </div>
          <div className="replay-transport">
            <button type="button" className="btn replay-btn" data-action="restart" aria-label="From the start" onClick={restart}>
              <Hint {...keysOf('replay.restart')} {...hints} />
              <SkipBack strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button
              type="button"
              className="btn replay-btn"
              data-action="rewind"
              aria-label={`Back ${JUMP} seconds`}
              onClick={() => seekBy(-JUMP)}
            >
              <Hint {...keysOf('replay.back')} {...hints} />
              <Rewind strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <button
              type="button"
              className="btn primary replay-btn replay-play"
              data-action="play"
              data-sfx="none"
              data-autofocus
              aria-label={playing ? 'Pause' : ended || phase === 'finished' ? 'Watch again' : 'Play'}
              onClick={toggle}
            >
              <Hint {...keysOf('replay.play')} {...hints} />
              {playing ? <Pause strokeWidth={ICON_STROKE} aria-hidden /> : <Play strokeWidth={ICON_STROKE} aria-hidden />}
            </button>
            <button
              type="button"
              className="btn replay-btn"
              data-action="forward"
              aria-label={`Forward ${JUMP} seconds`}
              onClick={() => seekBy(JUMP)}
            >
              <Hint {...keysOf('replay.forward')} {...hints} />
              <FastForward strokeWidth={ICON_STROKE} aria-hidden />
            </button>
            <div className="replay-speed" role="group" aria-label={`Speed ${speedLabel(rate)}`}>
              <button
                type="button"
                className="icon-btn small"
                aria-label="Slower"
                disabled={slowest}
                data-sfx="none"
                onClick={() => stepRate(-1)}
              >
                <Hint kbd={prev.kbd} pad={prev.pad} {...hints} />
                <Minus strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <span className="replay-rate" aria-live="polite">
                {speedLabel(rate)}
              </span>
              <button
                type="button"
                className="icon-btn small"
                aria-label="Faster"
                disabled={fastest}
                data-sfx="none"
                onClick={() => stepRate(1)}
              >
                <Plus strokeWidth={ICON_STROKE} aria-hidden />
                <Hint kbd={next.kbd} pad={next.pad} {...hints} />
              </button>
            </div>
          </div>
          <footer className="replay-foot">
            <button type="button" className="btn small quiet" data-action="back" data-sfx="back" onClick={onBack}>
              <Hint kbd="Escape" pad={backInput(hints.style)} {...hints} />
              <ArrowLeft strokeWidth={ICON_STROKE} aria-hidden />
              Back
            </button>
            <span className="replay-foot-end">
              <button type="button" className="btn small quiet" data-action="export" onClick={exportVideo}>
                <Hint {...keysOf('replay.export')} {...hints} />
                <Film strokeWidth={ICON_STROKE} aria-hidden />
                Video
              </button>
              <button type="button" className="btn small quiet" data-action="controls" onClick={toggleControls}>
                <Hint {...keysOf('replay.controls')} {...hints} />
                <EyeOff strokeWidth={ICON_STROKE} aria-hidden />
                Hide
              </button>
            </span>
          </footer>
        </section>
      </div>

      {ended && (
        <Dialog title="Replay over" variant="card" closeLabel="Stay here" onClose={() => setEnded(false)}>
          {(close) => (
            <div className="pause-card replay-end">
              <h2 className="display">Replay over</h2>
              <p className="pause-song">
                {replay.title} · {what}
              </p>
              <div className="replay-end-score">
                <Stars n={r.stars} />
                <span className="num">{r.score.toLocaleString()}</span>
                <span className="replay-end-acc">
                  {Math.round(r.accuracy * 100)}% · {r.fullCombo ? 'Full combo' : `Best streak ${r.bestStreak}`}
                </span>
              </div>
              <button
                type="button"
                className="btn primary wide"
                data-autofocus
                onClick={() => {
                  close();
                  restart();
                }}
              >
                <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
                Watch again
              </button>
              <button
                type="button"
                className="btn wide"
                onClick={() => {
                  close();
                  exportVideo();
                }}
              >
                <Film strokeWidth={ICON_STROKE} aria-hidden />
                Export video
              </button>
              <button type="button" className="btn wide" onClick={close}>
                <Eye strokeWidth={ICON_STROKE} aria-hidden />
                Stay here
              </button>
              <button type="button" className="btn wide" data-sfx="back" onClick={onBack}>
                <ArrowLeft strokeWidth={ICON_STROKE} aria-hidden />
                Back to replays
              </button>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
