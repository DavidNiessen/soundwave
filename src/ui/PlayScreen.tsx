import { LogOut, Pause, Play, RotateCcw, Settings as SettingsIcon, SkipForward, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { showSong } from '../app/discord';
import { StageBackdrop } from './StageBackdrop';
import { getEngine } from '../audio/engine';
import { playSfx } from '../audio/sfx';
import type { Chart } from '../chart/types';
import type { Results } from '../game/GameSession';
import { FINALE_SECONDS, PlayController, type PlayPhase } from '../game/PlayController';
import { keyLabel, type Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
import { useInputMode } from '../input/inputMode';
import { focusStart } from '../input/menuNav';
import { menuPulse } from '../input/rumble';
import { useGlyphStyle } from '../input/usePads';
import { useActions } from './actions';
import { Dialog } from './Dialog';
import { ICON_STROKE, PART_ICON, PART_LABEL } from './icons';

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
  onFinish(r: Results): void;
  /** Leaves the song for the next one in the set (absent on the last song). */
  onSkip?(): void;
  /** Opens the settings over the pause menu; `settingsOpen` says they are showing. */
  onSettings(): void;
  settingsOpen: boolean;
  onQuit(): void;
}

/** What the pause menu asks about before it throws the run away. */
type Ask = 'restart' | 'skip' | 'leave';

/** A five-pointed star in a 48 by 48 box, and two of its facets: the lit upper left and the shaded lower right. */
const STAR_PATH = 'M24 11 L27.64 19.48 L36.84 20.33 L29.9 26.42 L31.94 35.42 L24 30.7 L16.06 35.42 L18.1 26.42 L11.16 20.33 L20.36 19.48 Z';
const STAR_FACET_HI = 'M24 11 L20.36 19.48 L11.16 20.33 L18.1 26.42 L24 24.5 Z';
const STAR_FACET_LO = 'M24 24.5 L29.9 26.42 L31.94 35.42 L24 30.7 Z';
/** The overdrive meter: an arc over the top of the dial, from its lower left round to its lower right. */
const OD_ARC = 'M7.81 69.2 A53 53 0 1 1 112.19 69.2';

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
  const style = useGlyphStyle(settings.glyphs);

  useEffect(() => {
    const root = hudRef.current!;
    const q = (s: string) => root.querySelector<HTMLElement>(s)!;
    const ctrl = new PlayController(
      getEngine(),
      buffer,
      chart,
      settingsRef.current,
      hwRef.current!,
      {
        root,
        score: q('[data-hud=score]'),
        multiplier: q('[data-hud=mult]'),
        stars: q('[data-hud=stars]'),
        timeline: q('[data-hud=timeline]'),
        remaining: q('[data-hud=remaining]'),
        feedback: q('[data-hud=feedback]'),
        feedbackWord: q('[data-hud=fb-word]'),
        feedbackStreak: q('[data-hud=fb-streak]'),
        keys: Array.from(root.querySelectorAll<HTMLElement>('.lane-key')),
        touchLayer: q('[data-hud=touch]'),
        overdriveButton: q('[data-hud=od]'),
        breakTimer: q('[data-hud=break]'),
        breakNumber: q('[data-hud=break-num]'),
        breakRing: root.querySelector<SVGCircleElement>('[data-hud=break-ring]')!,
      },
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
    ctrl.onFinish = (r) => {
      playSfx('finale');
      finishTimer = window.setTimeout(() => finishRef.current(r), FINALE_SECONDS * 1000);
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

  const PartIcon = PART_ICON[chart.part];
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

  const keys = chart.lanes === 5 ? settings.keys5 : settings.keys4;
  const padKeys = chart.lanes === 5 ? settings.pad5 : settings.pad4;
  const usingPad = mode === 'pad';

  return (
    <div
      className={`play ${paused ? 'is-paused' : ''} ${settingsOpen ? 'under-settings' : ''}`}
      data-lanes={chart.lanes}
      data-od-side={settings.touchOverdriveSide}
      data-nav-off={paused ? undefined : ''}
      inert={settingsOpen}
    >
      <div ref={stageRef} className="layer stage-host" />
      <StageBackdrop />
      <canvas ref={hwRef} className="layer highway" />
      <div ref={hudRef} className="hud">
        <div className="touch-layer" data-hud="touch" />

        {/* Paint shared by the five stars: the discs' gradients and the star's outline as a clip. */}
        <svg className="hud-defs" aria-hidden>
          <defs>
            {/* An earned star's disc: polished graphite, the HUD's dark glass made solid. */}
            <radialGradient id="hud-star-disc" cx="0.35" cy="0.28" r="0.85">
              <stop offset="0" stopColor="#4a4560" />
              <stop offset="0.55" stopColor="#221f30" />
              <stop offset="1" stopColor="#0d0b14" />
            </radialGradient>
            <radialGradient id="hud-star-gold" cx="0.36" cy="0.28" r="0.9">
              <stop offset="0" stopColor="#fff5b8" />
              <stop offset="0.4" stopColor="#ffc640" />
              <stop offset="0.8" stopColor="#f28a14" />
              <stop offset="1" stopColor="#c85c00" />
            </radialGradient>
            <clipPath id="hud-star-clip">
              <path d={STAR_PATH} />
            </clipPath>
          </defs>
        </svg>
        <button
          type="button"
          className="hud-pause"
          data-sfx="none"
          tabIndex={-1}
          aria-label="Pause"
          onClick={() => ctrlRef.current?.pause()}
        >
          <Pause strokeWidth={ICON_STROKE} aria-hidden />
        </button>

        <div className="hud-scorebox">
          <div className="hud-songbox">
            <span className="hud-artist">{artist}</span>
            <span className="hud-song">
              {total > 1 && (
                <span className="hud-pos">
                  {position}/{total}
                </span>
              )}
              {title}
            </span>
            <div className="hud-timeline" data-hud="timeline" aria-hidden>
              <div className="hud-timeline-bar">
                <div className="hud-timeline-fill" />
              </div>
              <span className="hud-timeline-head" />
            </div>
            <span className="hud-remaining" data-hud="remaining" aria-hidden />
          </div>
          <div className="hud-stars" data-hud="stars" data-count="0" role="img" aria-label="Stars earned">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="hud-star" data-state="off" style={{ ['--i' as string]: i }}>
                <svg viewBox="0 0 48 48" aria-hidden>
                  <circle className="disc" cx="24" cy="24" r="22" />
                  <circle className="rim" cx="24" cy="24" r="21" />
                  <circle className="ring-track" cx="24" cy="24" r="20.4" />
                  <circle className="ring" cx="24" cy="24" r="20.4" pathLength={1} />
                  <path className="star" d={STAR_PATH} />
                  <path className="facet-hi" d={STAR_FACET_HI} />
                  <path className="facet-lo" d={STAR_FACET_LO} />
                  <g clipPath="url(#hud-star-clip)">
                    <rect className="gold-rise" x="10" y="10.5" width="28" height="25.5" />
                  </g>
                </svg>
              </span>
            ))}
          </div>
          <div className="hud-scorepanel">
            <PartIcon className="hud-part-icon" strokeWidth={ICON_STROKE} aria-hidden />
            <span className="hud-part">{PART_LABEL[chart.part]} score</span>
            <span className="hud-score" data-hud="score">
              0
            </span>
          </div>
        </div>

        <div className="hud-cluster">
          <div className="hud-dial">
            <svg viewBox="0 0 120 120" className="hud-dial-ring" aria-hidden>
              <path className="od-track" d={OD_ARC} pathLength={1} />
              <path className="od-fill" d={OD_ARC} pathLength={1} />
              <circle cx="60" cy="60" r="41" className="plate" />
              <circle cx="60" cy="60" r="37" className="track" pathLength={1} />
              <circle cx="60" cy="60" r="37" className="fill" pathLength={1} />
            </svg>
            <span className="hud-mult" data-hud="mult" data-level="1">
              ×1
            </span>
          </div>
          <button type="button" className="hud-od" data-hud="od" data-sfx="none" tabIndex={-1} aria-label="Start overdrive">
            <Zap strokeWidth={ICON_STROKE} aria-hidden />
            {mode !== 'touch' && <span className="hud-od-word hud-od-press">Press</span>}
            <span className="hud-od-word">Overdrive</span>
            {mode !== 'touch' && (
              <span className="hud-od-key">
                {usingPad ? <PadGlyph input={settings.padOverdrive} style={style} /> : <kbd>{keyLabel(settings.overdriveKey)}</kbd>}
              </span>
            )}
          </button>
        </div>
        <div className="hud-feedback">
          <span className="fb-streak" data-hud="fb-streak" />
          <div className="fb-tag" data-hud="feedback">
            <span data-hud="fb-word" />
            <svg className="fb-pip" viewBox="0 0 30 18" aria-hidden>
              <rect className="fb-pip-slot" x="1.5" y="1.5" width="27" height="15" rx="7.5" />
              <rect className="fb-pip-bar" x="6" y="6.5" width="18" height="5" rx="2.5" />
            </svg>
          </div>
        </div>
        <div className="hud-break" data-hud="break" aria-live="off">
          <svg viewBox="0 0 120 120" className="hud-break-ring">
            <circle cx="60" cy="60" r="52" className="track" />
            <circle cx="60" cy="60" r="52" className="fill" pathLength={1} data-hud="break-ring" />
          </svg>
          <div className="hud-break-window">
            <div className="hud-break-num" data-hud="break-num" />
          </div>
        </div>
        {keys.map((k, i) => (
          <span key={i} className={`lane-key lane-${i} ${usingPad ? 'pad' : ''}`}>
            {usingPad ? <PadGlyph input={padKeys[i]} style={style} /> : keyLabel(k)}
          </span>
        ))}
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
