import { LogOut, Play, RotateCcw, Settings as SettingsIcon, SkipForward } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { showSong } from '../app/discord';
import { getEngine } from '../audio/engine';
import { playSfx } from '../audio/sfx';
import type { Chart } from '../chart/types';
import type { Results } from '../game/GameSession';
import type { ReplayInputs } from '../game/replay';
import { FINALE_SECONDS, PlayController, type PlayPhase } from '../game/PlayController';
import type { Settings } from '../game/settings';
import { useInputMode } from '../input/inputMode';
import { focusStart } from '../input/menuNav';
import { menuPulse } from '../input/rumble';
import { useActions } from './actions';
import { Dialog } from './Dialog';
import { hudRefs, PlayHud } from './PlayHud';
import { ICON_STROKE } from './icons';

interface Props {
  title: string;
  artist: string;
  /** Position in the set, from 1, and how many songs the set has. */
  position: number;
  total: number;
  buffer: AudioBuffer;
  chart: Chart;
  /** Song time to start at, in seconds (a chart test-played from the middle of the song). */
  startAt?: number;
  settings: Settings;
  /** The song is over: how it went, and the run as recorded (for its replay). */
  onFinish(r: Results, inputs?: ReplayInputs): void;
  /** Leaves the song for the next one in the set (absent on the last song). */
  onSkip?(): void;
  /** Opens the settings over the pause menu; `settingsOpen` says they are showing. */
  onSettings(): void;
  settingsOpen: boolean;
  onQuit(): void;
}

/** What the pause menu asks about before it throws the run away. */
type Ask = 'restart' | 'skip' | 'leave';

export function PlayScreen({
  title,
  artist,
  position,
  total,
  buffer,
  chart,
  startAt = 0,
  settings,
  onFinish,
  onSkip,
  onSettings,
  settingsOpen,
  onQuit,
}: Props) {
  // The song is set up with the settings it starts with; the ones that can change mid-song are
  // handed over as they change (see applySettings), so opening the settings never restarts it.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const [ask, setAsk] = useState<Ask | null>(null);
  // Something is open over the pause menu (the settings, or a question): Esc, Tab and the pause
  // button belong to it, not to the menu underneath.
  const covered = settingsOpen || ask !== null;
  const coveredRef = useRef(covered);
  coveredRef.current = covered;
  const hwRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const pauseRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<PlayController | null>(null);
  const [phase, setPhase] = useState<PlayPhase>('countdown');
  const [count, setCount] = useState(3);
  const [run, setRun] = useState(0);
  const finishRef = useRef(onFinish);
  finishRef.current = onFinish;
  const mode = useInputMode();

  useEffect(() => {
    const ctrl = new PlayController(
      getEngine(),
      buffer,
      chart,
      settingsRef.current,
      hwRef.current!,
      hudRefs(hudRef.current!),
      stageRef.current!,
    );
    let prev: PlayPhase = 'countdown';
    // Discord shows the time left, or that the song is paused or over (src/app/discord.ts). The
    // countdown and the song count down alike; the time left is taken once the song plays again.
    let shown: PlayPhase | null = null;
    ctrl.onPhase = (p, n) => {
      if (p !== shown) {
        shown = p;
        showSong({ phase: p === 'countdown' ? 'playing' : p, left: ctrl.songLeft });
      }
      if (p === 'paused' && prev !== 'paused') {
        playSfx('pause');
        menuPulse('back');
      } else if (prev === 'paused' && p !== 'paused') {
        playSfx('resume');
        menuPulse('select');
      }
      prev = p;
      setPhase(p);
      if (n !== undefined) setCount(n);
    };
    // The song is over: the crowd claps and the stage fires off its finale for a few seconds
    // before the result comes up. Leaving in that time cancels it.
    let finishTimer = 0;
    ctrl.onFinish = (r, inputs) => {
      playSfx('finale');
      finishTimer = window.setTimeout(() => finishRef.current(r, inputs), FINALE_SECONDS * 1000);
    };
    ctrlRef.current = ctrl;
    void ctrl.start(startAt);
    // A song that loses the window (a call, another app) pauses instead of running on unseen.
    const hidden = () => document.hidden && ctrl.pause();
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      clearTimeout(finishTimer);
      ctrl.dispose();
      ctrlRef.current = null;
      showSong(null);
    };
  }, [buffer, chart, startAt, run]);

  useEffect(() => ctrlRef.current?.applySettings(settings), [settings]);
  useEffect(() => {
    if (covered) {
      if (ctrlRef.current) ctrlRef.current.holdPause = true;
      return;
    }
    // Let go a moment later: the press that closed what was on top must not resume the song too.
    const timer = window.setTimeout(() => {
      if (ctrlRef.current) ctrlRef.current.holdPause = false;
    }, 150);
    return () => clearTimeout(timer);
  }, [covered, run]);
  useEffect(() => {
    if (ctrlRef.current) ctrlRef.current.frozen = settingsOpen;
    // Back from the settings, focus returns to the button that opened them.
    if (!settingsOpen && ctrlRef.current && pauseRef.current) {
      const from = pauseRef.current.querySelector<HTMLElement>('[data-opens="settings"]');
      if (from) from.focus({ preventScroll: true });
      else focusStart(pauseRef.current);
    }
  }, [settingsOpen]);

  // The highway is laid out differently for touch (square targets at the foot of the screen).
  useEffect(() => {
    ctrlRef.current?.relayout();
  }, [mode]);

  const paused = phase === 'paused';
  // The pause menu stays a moment after resuming, to fade out rather than vanish in one frame.
  const [pauseLeaving, setPauseLeaving] = useState(false);
  const wasPaused = useRef(paused);
  useEffect(() => {
    const was = wasPaused.current;
    wasPaused.current = paused;
    if (paused || !was) return setPauseLeaving(false);
    setPauseLeaving(true);
    const timer = window.setTimeout(() => setPauseLeaving(false), 200);
    return () => clearTimeout(timer);
  }, [paused]);
  // The pause menu takes focus as it opens, so the keyboard and a controller land on Resume, and
  // Tab stays inside it.
  useEffect(() => {
    if (!paused) return;
    focusStart();
    const box = pauseRef.current!;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || coveredRef.current) return;
      const all = Array.from(box.querySelectorAll<HTMLElement>('button:not([disabled])'));
      const i = all.indexOf(document.activeElement as HTMLElement);
      e.preventDefault();
      all[e.shiftKey ? (i <= 0 ? all.length - 1 : i - 1) : i === all.length - 1 ? 0 : i + 1]?.focus();
    };
    window.addEventListener('keydown', trap, true);
    return () => window.removeEventListener('keydown', trap, true);
  }, [paused]);
  // No bar during a song: this keeps the menu actions of the screen underneath switched off.
  useActions([]);

  const set = total > 1;
  const question = {
    restart: {
      title: 'Restart the song?',
      hint: 'This run and its score are thrown away, and the song starts from the top.',
      yes: 'Restart song',
    },
    skip: { title: 'Skip this song?', hint: 'It gets no score, and the next song in the set starts.', yes: 'Skip to next song' },
    leave: set
      ? {
          title: 'Leave the set?',
          hint: 'The set ends here and this song gets no score. The songs you finished keep theirs.',
          yes: 'Leave the set',
        }
      : { title: 'Leave the song?', hint: 'This run and its score are thrown away.', yes: 'Leave the song' },
  }[ask ?? 'restart'];
  const confirm = () => {
    const what = ask;
    setAsk(null);
    if (what === 'restart') setRun((r) => r + 1);
    else if (what === 'skip') onSkip?.();
    else onQuit();
  };

  return (
    <div
      className={`play ${paused ? 'is-paused' : ''} ${settingsOpen ? 'under-settings' : ''}`}
      data-lanes={chart.lanes}
      data-od-side={settings.touchOverdriveSide}
      data-nav-off={paused ? undefined : ''}
      inert={settingsOpen}
    >
      <div ref={stageRef} className="layer stage-host" />
      <canvas ref={hwRef} className="layer highway" />
      <div ref={hudRef} className="hud">
        <PlayHud
          title={title}
          artist={artist}
          position={position}
          total={total}
          chart={chart}
          settings={settings}
          onPause={() => ctrlRef.current?.pause()}
        />
      </div>
      {phase === 'countdown' && count > 0 && (
        <div className="countdown" key={count}>
          {count}
        </div>
      )}
      {/* wasPaused: the render that resumes keeps it too, before the effect above has run. */}
      {(paused || pauseLeaving || wasPaused.current) && (
        <div className={`overlay card ${paused ? '' : 'leaving'}`} data-modal={paused ? '' : undefined} inert={!paused} ref={pauseRef}>
          <div className="dialog pause-card" role="dialog" aria-modal="true" aria-label="Paused">
            <h2 className="display pause-title">Paused</h2>
            <p className="pause-song">
              {title}
              {total > 1 && ` · song ${position} of ${total}`}
            </p>
            <button
              type="button"
              className="btn primary wide"
              data-sfx="none"
              data-autofocus
              onClick={() => void ctrlRef.current?.resume()}
            >
              <Play strokeWidth={ICON_STROKE} aria-hidden />
              Resume
            </button>
            <button type="button" className="btn wide" onClick={() => setAsk('restart')}>
              <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
              Restart song
            </button>
            <button type="button" className="btn wide" data-opens="settings" onClick={onSettings}>
              <SettingsIcon strokeWidth={ICON_STROKE} aria-hidden />
              Settings
            </button>
            {onSkip && (
              <button type="button" className="btn wide" onClick={() => setAsk('skip')}>
                <SkipForward strokeWidth={ICON_STROKE} aria-hidden />
                Skip to next song
              </button>
            )}
            <button type="button" className="btn wide" data-sfx="back" onClick={() => setAsk('leave')}>
              <LogOut strokeWidth={ICON_STROKE} aria-hidden />
              {total > 1 ? 'Leave the set' : 'Leave the song'}
            </button>
          </div>
        </div>
      )}
      {paused && ask && (
        <Dialog title={question.title} variant="card" closeLabel="Go back" onClose={() => setAsk(null)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">{question.title}</h2>
              <p className="hint">{question.hint}</p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Go back
              </button>
              <button type="button" className="btn primary wide" data-sfx={ask === 'leave' ? 'back' : undefined} onClick={confirm}>
                {question.yes}
              </button>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
