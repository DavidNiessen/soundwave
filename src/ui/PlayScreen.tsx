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
import { BOARD_INTERVAL_MS } from '../net/protocol';
import { online } from '../net/client';
import type { Avatars } from '../render/aurora/AuroraStage';

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
  /** The band on stage dressed as the players on its parts. */
  avatars?: Avatars;
  /**
   * Played with a party: the song starts at the party's moment `at` (performance.now ms), the
   * score goes out ten times a second, and the party's board stands beside the highway. Nobody
   * can restart or skip a song the others are playing.
   */
  together?: {
    at: number;
    board: React.ReactNode;
    onProgress(score: number, streak: number, stars: number): void;
    /** A Showdown: the overdrive button strikes the player above (with hits on), and hits land here. */
    showdown?: { songIndex: number; hits: boolean; me: string };
    /** A band: overdrive and phrases go to the band, and a long run of misses drops this player out. */
    band?: { songIndex: number; me: string };
  };
}

/** A Showdown hit on this player: who struck, when it lands (performance.now ms) and for how long. */
interface HitNote {
  from: string;
  at: number;
  ms: number;
  drain: boolean;
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
  avatars,
  together,
}: Props) {
  const togetherRef = useRef(together);
  // The band is dressed once, as the song is set up.
  const avatarsRef = useRef(avatars);
  avatarsRef.current = avatars;
  togetherRef.current = together;
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
  const [hit, setHit] = useState<HitNote | null>(null);
  const [note, setNote] = useState<{ text: string; key: number } | null>(null);
  // Band mode: this player dropped out, until a bandmate brings them back.
  const [out, setOut] = useState(false);
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
      undefined,
      { avatars: avatarsRef.current },
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
    const party = togetherRef.current;
    void (party ? ctrl.startTogether(party.at) : ctrl.start(startAt));
    // The party sees this player's score as it goes, ten times a second.
    const progress = party
      ? window.setInterval(() => {
          const s = ctrl.session;
          togetherRef.current?.onProgress(Math.round(s.score), s.streak, s.progressStars);
        }, BOARD_INTERVAL_MS)
      : 0;
    const unShowdown = party?.showdown ? showdown(ctrl, party.showdown) : party?.band ? playBand(ctrl, party.band) : () => {};
    // A song that loses the window (a call, another app) pauses instead of running on unseen.
    const hidden = () => document.hidden && ctrl.pause();
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      clearTimeout(finishTimer);
      clearInterval(progress);
      unShowdown();
      ctrl.dispose();
      ctrlRef.current = null;
      showSong(null);
    };
  }, [buffer, chart, startAt, run]);

  /**
   * Showdown: the overdrive button asks the server whom to strike when this player has someone to
   * aim at (the board says so); the answer spends the charge, or makes the press an overdrive after
   * all. Hits land on the controller as Fog or Drain, as the player chose, with a warning first.
   */
  function showdown(ctrl: PlayController, sd: { songIndex: number; hits: boolean; me: string }) {
    let asking = false;
    const name = (id: string) => online.snapshot().party?.members.find((m) => m.id === id)?.name ?? 'the player above';
    if (sd.hits)
      ctrl.strike = (charge) => {
        if (asking) return true;
        if (!online.board()?.lines.find((l) => l.id === sd.me)?.aim) return false;
        asking = true;
        online.strike(sd.songIndex, charge);
        return true;
      };
    return online.onPlayEvent((e) => {
      if (e.type === 'cheer') return setNote({ text: `${e.from} cheers you on`, key: performance.now() });
      if (e.type === 'band-overdrive' || e.type === 'revive' || e.songIndex !== sd.songIndex) return;
      if (e.type === 'struck') {
        asking = false;
        if (!e.target) return ctrl.overdriveNow();
        ctrl.spendCharge();
        setNote({ text: `Strike on ${name(e.target)}`, key: performance.now() });
        return;
      }
      const drain = settingsRef.current.showdownHits === 'drain';
      ctrl.hit(e.at, e.ms, drain);
      setHit({ from: e.from, at: e.at, ms: e.ms, drain });
    });
  }

  /**
   * Band mode: overdrive and completed phrases are told to the band (two overdrives in one bar make
   * band overdrive; a phrase brings dropped-out bandmates back), and so is dropping out.
   */
  function playBand(ctrl: PlayController, band: { songIndex: number; me: string }) {
    ctrl.band = true;
    ctrl.onOverdriveStart = (bar, seconds) => online.overdriveStarted(band.songIndex, bar, seconds);
    ctrl.onPhrase = () => {
      if (online.board()?.lines.some((l) => l.dropped && l.id !== band.me)) online.revive(band.songIndex);
    };
    ctrl.onOut = (out) => {
      online.dropped(band.songIndex, out);
      setOut(out);
    };
    return online.onPlayEvent((e) => {
      if (e.type === 'cheer') return setNote({ text: `${e.from} cheers you on`, key: performance.now() });
      if (e.type === 'struck' || e.type === 'hit' || e.songIndex !== band.songIndex) return;
      if (e.type === 'band-overdrive') {
        ctrl.bandOverdrive(e.at, e.ms);
        return setNote({ text: 'Band overdrive: everyone’s multiplier doubles', key: performance.now() });
      }
      ctrl.revive();
      setNote({ text: `${e.by} brought you back`, key: performance.now() });
    });
  }

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(timer);
  }, [note]);

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
    leave: together
      ? {
          title: 'Leave this song?',
          hint: 'You get no score for it and go back to the party, which plays on. You can join the next song.',
          yes: 'Leave the song',
        }
      : set
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
      {together?.board}
      {hit && <HitBanner hit={hit} onOver={() => setHit(null)} />}
      {out && (
        <p className="showdown-hit coming" role="alert">
          You dropped out: your notes score nothing until a bandmate’s overdrive phrase brings you back.
        </p>
      )}
      {note && (
        <p className="showdown-note" key={note.key} role="status">
          {note.text}
        </p>
      )}
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
            {together && <p className="hint">The song plays on for the rest of the party.</p>}
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
            {/* The party plays on: a song is not restarted for one player. */}
            {!together && (
              <button type="button" className="btn wide" onClick={() => setAsk('restart')}>
                <RotateCcw strokeWidth={ICON_STROKE} aria-hidden />
                Restart song
              </button>
            )}
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
              {total > 1 && !together ? 'Leave the set' : 'Leave the song'}
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

/**
 * A Showdown hit, said in words: a warning with the striker's name before it lands, then what it
 * does and how long it has left. A Drain hit also draws a still, coloured edge around the screen.
 */
function HitBanner({ hit, onOver }: { hit: HitNote; onOver(): void }) {
  const [now, setNow] = useState(() => performance.now());
  const over = useRef(onOver);
  over.current = onOver;
  useEffect(() => {
    const timer = window.setInterval(() => {
      const t = performance.now();
      setNow(t);
      if (t >= hit.at + hit.ms) over.current();
    }, 100);
    return () => clearInterval(timer);
  }, [hit]);
  const coming = now < hit.at;
  const left = Math.max(0, Math.ceil((hit.at + hit.ms - now) / 1000));
  const what = hit.drain ? 'Drain: your multiplier is held at ×2' : 'Fog over the far highway';
  return (
    <>
      {hit.drain && !coming && <div className="showdown-edge" aria-hidden />}
      <p className={`showdown-hit ${coming ? 'coming' : ''}`} role="alert">
        {coming ? `${hit.from} strikes you!` : `${what} · ${hit.from} · ${left} s`}
      </p>
    </>
  );
}
