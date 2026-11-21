/**
 * Playing together on a Soundwave server (docs/specs/online-play.md): connecting and signing in,
 * starting or joining a party, and the party itself, which goes through three stages:
 * - the room: a party is just its players at first, and the host picks what to play (a mode);
 * - the mode's lobby: the set, the mode's options, each player's part, difficulty and ready tick,
 *   and the board while a song plays without you;
 * - the shared results after each song.
 *
 * The connection itself lives in src/net/client.ts; starting a song needs the host's charts, which
 * App makes (onStartSong). A song a player lacks comes to them by itself (src/net/partySongs.ts).
 */
import {
  ArrowLeft,
  Check,
  CloudDownload,
  CloudUpload,
  Crosshair,
  Disc3,
  Pause,
  Scissors,
  Crown,
  Download,
  ExternalLink,
  KeyRound,
  Link as LinkIcon,
  LoaderCircle,
  Pencil,
  Server as ServerIcon,
  ShieldCheck,
  UserRound,
  Gauge,
  ListMusic,
  Lock,
  LockOpen,
  LogIn,
  LogOut,
  MessageCircle,
  Megaphone,
  RefreshCw,
  SkipForward,
  Swords,
  Trophy,
  Undo2,
  UserMinus,
  UserPlus,
  Users,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DIFFICULTIES, PARTS, type Difficulty, type Part } from '../chart/types';
import type { Results } from '../game/GameSession';
import { isCalibrated, type Settings } from '../game/settings';
import { TAB_EVENT } from '../input/menuNav';
import { formatTime, type Pick } from '../game/setlist';
import { keysOf } from '../input/bindings';
import { PadGlyph } from '../input/glyphs';
import { confirmInput } from '../input/pads';
import { online, parseInvite, type OnlineState } from '../net/client';
import { partySongs, type Transfer } from '../net/partySongs';
import {
  PARTY_MAX,
  PARTY_MODES,
  type BoardLine,
  type Member,
  type PartyMode,
  type PartyState,
  type ResultLine,
  type SetSong,
  type ShowdownOptions,
  type SongResults,
} from '../net/protocol';
import type { SongMeta } from '../storage/db';
import { Hint, keyName, useActions, useHints, type Action } from './actions';
import { Calibration } from './Calibration';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { playShowdownSfx } from '../audio/showdownSfx';
import { HoldButton } from './HoldButton';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Pips, Stars } from './icons';
import { useSlide } from './useSlide';

interface Props {
  /** The player's library, by song id. */
  library: Map<string, SongMeta>;
  /** Songs the player can play (analysed, with notes): the host can only start these. */
  playable: (id: string) => boolean;
  /** The player's own setlist: the host's is the party's set. */
  setlist: SongMeta[];
  pick: Pick;
  onPick(p: Pick): void;
  /** The host starts song `index` of the set: App makes everyone's charts and sends them. */
  onStartSong(index: number): void;
  settings: Settings;
  onBack(): void;
  /** The host picks the party's songs in their library (their setlist is the party's set). */
  onPickSongs(): void;
  /** Changes settings (the audio offset, calibrated from the lobby). */
  onSettings(patch: Partial<Settings>): void;
  /** Signed in and in no party (just signed in, or left one): the main menu's Online tab takes over. */
  onLeft(): void;
  /** The player's own last song in this party, for the stats between a Showdown's songs. */
  lastRun?: LastRun;
  /** The parts a song has (in the player's library), for picking one for the next song. */
  partsOf(songId: string): Part[];
}

const useOnline = () => useSyncExternalStore(online.subscribe, online.snapshot);

/** Seconds a lobby counts down once everyone is ready before the next song starts by itself. */
const AUTO_START_S = 5;

/** Whole seconds left of a countdown of `seconds` that runs while `on` (from when it turned on), or null when off. */
function useCountdown(on: boolean, seconds: number): number | null {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!on) return setLeft(null);
    const end = performance.now() + seconds * 1000;
    const tick = () => setLeft(Math.max(0, Math.ceil((end - performance.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [on, seconds]);
  return left;
}
type Hints = ReturnType<typeof useHints>;

/** Each mode as the room offers it: what it is in a sentence, and who it is for. */
export const MODES: Record<
  PartyMode,
  { label: string; icon: LucideIcon; cap: string; who: string; binding: string; steps: [string, string][] }
> = {
  versus: {
    label: 'Versus',
    icon: Trophy,
    cap: 'Everyone plays the set on the part they like. The best score takes each song, and the set.',
    who: `2 to ${PARTY_MAX} players`,
    binding: 'party.versus',
    steps: [
      ['Pick your part', 'Any part, any difficulty: everyone plays at the same moment.'],
      ['Play the set', 'Scores show live beside the highway.'],
      ['Top the board', 'The best score takes each song, and the set.'],
    ],
  },
  showdown: {
    label: 'Showdown',
    icon: Swords,
    cap: 'The lowest go out after each song, and your overdrive strikes the player just above you.',
    who: 'Best with 3 or more',
    binding: 'party.showdown',
    steps: [
      ['Stay above the cut', 'After each song the lowest scores go out.'],
      ['Strike the player above', 'Your overdrive hazes their highway and holds them at ×2.'],
      ['Be the last one in', 'The final leaves one winner.'],
    ],
  },
};

/**
 * Back leaves the screen; the party (and the sign-in) stay until left on purpose. Each part of the
 * screen declares its own actions, Back included: a second declaration from the screen around it
 * would cover the part's, or be covered by it, depending on which mounted last.
 */
const backAction = (run: () => void): Action => ({ id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run });

export function PartyScreen(props: Props) {
  const s = useOnline();
  const { settings, onBack } = props;
  // A stored sign-in connects by itself; until it has, the screen says so.
  useEffect(() => online.resume(), []);

  const party = s.account ? s.party : null;
  let title = 'Play together';
  let sub: string = s.info?.name ?? 'On a Soundwave server';
  let body: React.ReactNode;
  if (s.status === 'off' || s.status === 'signed-out' || !s.account) {
    body =
      s.status === 'connecting' || (s.status === 'reconnecting' && !s.account) ? (
        <Waiting s={s} onBack={onBack} />
      ) : (
        <Connect s={s} settings={settings} onBack={onBack} />
      );
  } else if (!party) body = <NoParty onLeft={props.onLeft} />;
  else {
    title = party.mode ? MODES[party.mode].label : 'Your party';
    const n = party.members.length;
    sub = `Party ${party.code} · ${n} ${n === 1 ? 'player' : 'players'}${s.info ? ` · ${s.info.name}` : ''}`;
    body = <InParty {...props} s={s} party={party} />;
  }

  if (party?.showdown && party.phase === 'results')
    return (
      <div className="page party sd-between">
        {s.error && (
          <p className="party-error" role="alert">
            {s.error}
            <button type="button" className="btn small" onClick={() => online.clearError()}>
              OK
            </button>
          </p>
        )}
        {body}
      </div>
    );

  return (
    <div className={`page party ${party ? '' : 'centered'}`}>
      <header className="page-head">
        <h1 className="page-title">{title}</h1>
        <p className="head-count">
          {sub}
          {s.status === 'reconnecting' && s.account && (
            <span className="warn">
              {' · '}
              <WifiOff strokeWidth={ICON_STROKE} aria-hidden />
              Connection lost, trying again…
            </span>
          )}
        </p>
      </header>
      {s.error && (
        <p className="party-error" role="alert">
          {s.error}
          <button type="button" className="btn small" onClick={() => online.clearError()}>
            OK
          </button>
        </p>
      )}
      {body}
    </div>
  );
}

function Waiting({ s, onBack }: { s: OnlineState; onBack(): void }) {
  useActions([backAction(onBack)]);
  return (
    <div className="party-center">
      <p className="hint">Connecting to {s.server?.replace(/^https?:\/\//, '')}…</p>
      <button type="button" className="btn" onClick={() => online.forget()}>
        Use another server
      </button>
    </div>
  );
}

/* Connecting and signing in --------------------------------------------------------------- */

function Connect({ s, onBack }: { s: OnlineState; settings: Settings; onBack(): void }) {
  useActions([backAction(onBack)]);
  const [address, setAddress] = useState(s.server?.replace(/^https?:\/\//, '') ?? '');
  const [how, setHow] = useState<'in' | 'up'>(s.invite ? 'up' : 'in');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [serverPassword, setServerPassword] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'connect' | 'account' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** The player chose to type another address while one is known. */
  const [changing, setChanging] = useState(false);
  /** Signing in here, in the game, rather than on the server's page in the browser. */
  const [inGame, setInGame] = useState(false);
  /** The browser was opened for signing in (desktop): the game waits for it to come back. */
  const [waiting, setWaiting] = useState<'signin' | 'signup' | null>(null);
  const browser = (how: 'signin' | 'signup') =>
    run('account', async () => {
      await online.signInWithBrowser(how);
      setWaiting(how);
    });
  const info = changing ? null : s.info;

  const run = async (what: 'connect' | 'account', task: () => Promise<unknown>) => {
    setBusy(what);
    setProblem(null);
    try {
      await task();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // The server is asked what it is once it is known (a stored address, or an invite link opened).
  useEffect(() => {
    if (s.server && !s.info) void run('connect', () => online.choose(s.server!));
  }, [s.server, s.info]);
  // An invite link opened elsewhere (a click, the web game's address) lands here ready to sign up.
  useEffect(() => {
    if (!s.invite) return;
    setHow('up');
    setChanging(false);
    if (s.server) setAddress(s.server.replace(/^https?:\/\//, ''));
  }, [s.invite, s.server]);

  /** The server field takes an address or a whole invite link. */
  const connect = () =>
    run('connect', async () => {
      const invite = parseInvite(address);
      if (!invite) await online.choose(address);
      else {
        await online.useInvite(invite);
        setAddress(invite.server.replace(/^https?:\/\//, ''));
        setHow('up');
      }
      setChanging(false);
    });

  const mode = info?.mode;
  /** A code typed or pasted (a whole link works too), else the invite a link brought. */
  const invite = (code.trim() && (parseInvite(code)?.invite ?? code.trim())) || s.invite || undefined;
  const submit = () =>
    run('account', () =>
      how === 'in'
        ? online.signIn(name, password)
        : online.signUp({ name, password, ...(invite ? { invite } : mode === 'password' ? { serverPassword } : {}) }),
    );
  const needsCode = how === 'up' && mode === 'invite' && !invite;
  const short = how === 'up' && password.length > 0 && password.length < 8;

  return (
    <div className="party-connect">
      <div className="connect-card">
        <ol className="connect-steps" aria-label="Steps">
          <li className={info ? 'done' : 'on'}>
            <span className="num">{info ? <Check strokeWidth={ICON_STROKE} aria-hidden /> : 1}</span>
            Server
          </li>
          <li className={info ? 'on' : ''}>
            <span className="num">2</span>
            You
          </li>
        </ol>

        {!info ? (
          <form
            className="connect-form"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <h2 className="connect-title">Connect to a server</h2>
            <p className="hint">
              Soundwave servers are run by players, for their friends. Type the address of one, or paste the invite link someone sent you.
            </p>
            <label className="meta-field">
              <span className="dim">Address or invite link</span>
              <span className="connect-input" data-ring-box>
                <ServerIcon strokeWidth={ICON_STROKE} aria-hidden />
                <input
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="play.example.com"
                  spellCheck={false}
                  autoComplete="url"
                  inputMode="url"
                  data-autofocus
                />
              </span>
            </label>
            <button type="submit" className="btn primary wide connect-go" disabled={!!busy || !address.trim()}>
              {busy === 'connect' ? (
                <LoaderCircle className="spin" strokeWidth={ICON_STROKE} aria-hidden />
              ) : (
                <LinkIcon strokeWidth={ICON_STROKE} aria-hidden />
              )}
              {busy === 'connect' ? 'Connecting…' : 'Connect'}
            </button>
            {changing && (
              <button type="button" className="btn quiet wide" onClick={() => setChanging(false)}>
                Keep {s.info?.name ?? 'the server I had'}
              </button>
            )}
          </form>
        ) : (
          <form
            className="connect-form"
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <div className="party-server">
              <span className="online-dot on" aria-hidden />
              <span className="song-text">
                <span className="song-title">{info.name}</span>
                <span className="song-artist">
                  {info.description && `${info.description} · `}
                  {info.online} online
                </span>
              </span>
              <button type="button" className="btn small quiet" onClick={() => setChanging(true)}>
                <Pencil strokeWidth={ICON_STROKE} aria-hidden />
                Change
              </button>
            </div>
            {info.browserLogin && !inGame ? (
              <div className="connect-browser">
                {waiting ? (
                  <>
                    <p className="connect-wait">
                      <LoaderCircle className="spin" strokeWidth={ICON_STROKE} aria-hidden />
                      {waiting === 'signin' ? 'Sign in' : 'Make your account'} in your browser. The game picks it up by itself.
                    </p>
                    <button type="button" className="btn wide" onClick={() => void browser(waiting)}>
                      <ExternalLink strokeWidth={ICON_STROKE} aria-hidden />
                      Open the page again
                    </button>
                    <button type="button" className="btn quiet wide" onClick={() => setWaiting(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <p className="hint">
                      You sign in on {info.name}’s own page, in your browser, where your password manager can fill it in. Then you come
                      straight back here.
                    </p>
                    <button
                      type="button"
                      className="btn primary wide connect-go"
                      data-autofocus
                      disabled={!!busy}
                      onClick={() => void browser(s.invite ? 'signup' : 'signin')}
                    >
                      {busy === 'account' ? (
                        <LoaderCircle className="spin" strokeWidth={ICON_STROKE} aria-hidden />
                      ) : (
                        <ExternalLink strokeWidth={ICON_STROKE} aria-hidden />
                      )}
                      {s.invite ? 'Make my account in the browser' : 'Sign in with your browser'}
                    </button>
                    <button
                      type="button"
                      className="btn wide"
                      disabled={!!busy}
                      onClick={() => void browser(s.invite ? 'signin' : 'signup')}
                    >
                      <UserPlus strokeWidth={ICON_STROKE} aria-hidden />
                      {s.invite ? 'I already have an account' : 'I’m new here: make an account'}
                    </button>
                  </>
                )}
                <button type="button" className="btn quiet wide" onClick={() => (setInGame(true), setWaiting(null))}>
                  Sign in here in the game instead
                </button>
              </div>
            ) : (
              <>
                <div className="choice-pair" role="radiogroup" aria-label="Sign in or make an account">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={how === 'in'}
                    className={`choice ${how === 'in' ? 'on' : ''}`}
                    onClick={() => setHow('in')}
                  >
                    I have an account
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={how === 'up'}
                    className={`choice ${how === 'up' ? 'on' : ''}`}
                    onClick={() => setHow('up')}
                  >
                    I’m new here
                  </button>
                </div>
                {how === 'up' && (
                  <p className="hint connect-note">
                    {s.invite
                      ? 'Your invite lets you in.'
                      : {
                          public: 'Anyone can make an account here.',
                          password: 'Making an account here needs the server’s password, or an invite.',
                          invite: 'Making an account here needs an invite from someone on it.',
                        }[info.mode]}
                  </p>
                )}
                <label className="meta-field">
                  <span className="dim">Name</span>
                  <span className="connect-input" data-ring-box>
                    <UserRound strokeWidth={ICON_STROKE} aria-hidden />
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={24}
                      autoComplete="username"
                      spellCheck={false}
                      data-autofocus
                    />
                  </span>
                </label>
                <label className="meta-field">
                  <span className="dim">Password</span>
                  <span className="connect-input" data-ring-box>
                    <KeyRound strokeWidth={ICON_STROKE} aria-hidden />
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      maxLength={200}
                      autoComplete={how === 'up' ? 'new-password' : 'current-password'}
                      aria-invalid={short}
                    />
                  </span>
                  {how === 'up' && <span className={short ? 'warn' : 'dim'}>At least 8 characters</span>}
                </label>
                {how === 'up' && mode === 'password' && !invite && (
                  <label className="meta-field">
                    <span className="dim">The server’s password</span>
                    <span className="connect-input" data-ring-box>
                      <ShieldCheck strokeWidth={ICON_STROKE} aria-hidden />
                      <input type="password" value={serverPassword} onChange={(e) => setServerPassword(e.target.value)} />
                    </span>
                  </label>
                )}
                {how === 'up' && !s.invite && (
                  <label className="meta-field">
                    <span className="dim">
                      {mode === 'invite' ? 'Your invite link or code' : 'An invite link or code (if you have one)'}
                    </span>
                    <span className="connect-input" data-ring-box>
                      <LinkIcon strokeWidth={ICON_STROKE} aria-hidden />
                      <input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
                    </span>
                    <span className="dim">Owner: use the set-up code your server printed.</span>
                  </label>
                )}
                <button
                  type="submit"
                  className="btn primary wide connect-go"
                  disabled={!!busy || !name.trim() || !password || short || needsCode}
                >
                  {busy === 'account' ? (
                    <LoaderCircle className="spin" strokeWidth={ICON_STROKE} aria-hidden />
                  ) : (
                    <LogIn strokeWidth={ICON_STROKE} aria-hidden />
                  )}
                  {busy === 'account' ? 'One moment…' : how === 'in' ? 'Sign in' : 'Make my account'}
                </button>
                {info.browserLogin && (
                  <button type="button" className="btn quiet wide" onClick={() => setInGame(false)}>
                    <ExternalLink strokeWidth={ICON_STROKE} aria-hidden />
                    Use my browser instead
                  </button>
                )}
              </>
            )}
          </form>
        )}
        {problem && (
          <p className="party-error" role="alert">
            {problem}
          </p>
        )}
      </div>
      <p className="hint party-note">
        Nothing is sent anywhere until you connect. A server keeps your name, a hash of your password and what its features need. You can
        save all of it, or delete your account, at any time.
      </p>
    </div>
  );
}

/* Signed in, in no party ------------------------------------------------------------------- */

/** Signed in, in no party: the Online tab is where parties start, so the screen hands over to it. */
function NoParty({ onLeft }: { onLeft(): void }) {
  useEffect(() => onLeft(), [onLeft]);
  return null;
}

/* In a party ------------------------------------------------------------------------------ */

type PartyProps = Props & { s: OnlineState; party: PartyState };

/** Whichever stage the party is at, and the player's choices and songs, reported as they change. */
function InParty(props: PartyProps) {
  const { party, s, library, pick, settings } = props;
  const me = party.members.find((m) => m.id === s.account!.id);
  const calibrated = isCalibrated(settings);
  const have = useMemo(() => party.set.filter((song) => library.has(song.id)).map((song) => song.id), [party.set, library]);
  const haveKey = have.join(',');

  // On joining, the player's own part and difficulty go to the party; the songs they have follow the set.
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    if (!me) return;
    const key = `${party.code}|${haveKey}|${calibrated}`;
    if (sentFor.current === key) return;
    const first = !sentFor.current?.startsWith(`${party.code}|`);
    sentFor.current = key;
    online.ready(first ? pick.part : me.part, first ? pick.difficulty : me.difficulty, first ? false : me.ready, have, calibrated);
  }, [party.code, haveKey, me, pick, have, calibrated]);

  usePartySounds(party, s.account!.id);

  if (!me) return null;
  if (party.phase === 'results')
    return party.showdown ? <ShowdownBetween key={party.songIndex} {...props} me={me} have={have} /> : <PartyResults {...props} me={me} />;
  if (!party.mode) return <PartyRoom {...props} me={me} />;
  return <ModeLobby {...props} me={me} have={have} />;
}

/**
 * The party's comings and goings, heard: a chime when someone joins or leaves, a pop when someone
 * gets ready (in a mode's lobby). Nothing on the first look at a party, and nothing for this player's
 * own joining: they know.
 */
function usePartySounds(party: PartyState, me: string) {
  const seen = useRef<{ code: string; ids: Set<string>; ready: Set<string> } | null>(null);
  useEffect(() => {
    const ids = new Set(party.members.map((m) => m.id));
    const ready = new Set(party.members.filter((m) => m.ready).map((m) => m.id));
    const before = seen.current;
    seen.current = { code: party.code, ids, ready };
    if (!before || before.code !== party.code || party.phase !== 'lobby') return;
    if ([...ids].some((id) => !before.ids.has(id) && id !== me)) playShowdownSfx('join');
    else if ([...before.ids].some((id) => !ids.has(id))) playShowdownSfx('leave');
    else if (party.mode && [...ready].some((id) => !before.ready.has(id))) playShowdownSfx('ready');
    else if (party.mode && [...before.ready].some((id) => ids.has(id) && !ready.has(id))) playShowdownSfx('unready');
  }, [party, me]);
}

/**
 * The party's code, to invite friends with; the host's switch that keeps it off Discord; and, in the
 * desktop app, each player's own switch for showing it on their Discord status (which Discord's
 * Join, Ask to Join and chat invites need).
 */
function PartyCode({
  party,
  host,
  settings,
  hints,
  onDiscord,
}: {
  party: PartyState;
  host: boolean;
  settings: Settings;
  hints: Hints;
  onDiscord(): void;
}) {
  const toggle = () => online.setPrivate(!party.private);
  const desktop = '__TAURI_INTERNALS__' in window;
  return (
    <section className="party-code" aria-label="Party code">
      <span className="label">Party code</span>
      <span className="display party-code-text">{party.code}</span>
      <span className="dim">
        Friends on this server join with it.
        {party.private ? ' Private: never offered on Discord.' : settings.discordJoin ? ' Discord friends can join from your status.' : ''}
      </span>
      {host && (
        <button type="button" className="btn small party-private" data-action="party-private" onClick={toggle}>
          <Hint {...keysOf('party.private')} {...hints} />
          {party.private ? <Lock strokeWidth={ICON_STROKE} aria-hidden /> : <LockOpen strokeWidth={ICON_STROKE} aria-hidden />}
          {party.private ? 'Private' : 'Open to friends'}
        </button>
      )}
      {desktop && !party.private && (
        <button
          type="button"
          className={`btn small party-discord ${settings.discordJoin ? 'is-on' : ''}`}
          aria-pressed={settings.discordJoin}
          onClick={onDiscord}
        >
          <MessageCircle strokeWidth={ICON_STROKE} aria-hidden />
          {settings.discordJoin ? 'On Discord: friends can join' : 'Let Discord friends join'}
        </button>
      )}
    </section>
  );
}

/**
 * The players as cards, each in their look's colours with their part, difficulty and ready state;
 * the host can remove one. While there is room, a last card says how friends join.
 */
function Players({ party, me, host, showReady }: { party: PartyState; me: Member; host: boolean; showReady: boolean }) {
  const ready = party.members.filter((m) => m.ready).length;
  const n = party.members.length;
  return (
    <section className="party-players" aria-label="Players">
      <h2 className="label">
        <Users strokeWidth={ICON_STROKE} aria-hidden /> Players · {n}
        {showReady && (
          <span className={`label-note ${ready === n ? 'all-ready' : ''}`} aria-live="polite">
            {ready === n ? 'Everyone is ready' : `${ready} of ${n} ready`}
          </span>
        )}
      </h2>
      <ul className="player-cards">
        {party.members.map((m, i) => (
          <PlayerCard
            key={m.id}
            m={m}
            i={i}
            host={m.id === party.host}
            me={m.id === me.id}
            setSize={party.set.length}
            showReady={showReady}
            onRemove={host && m.id !== me.id ? () => online.kick(m.id) : undefined}
          />
        ))}
        {n < PARTY_MAX && (
          <li className="player-card invite" style={{ ['--i' as string]: n }}>
            <span className="player-art" aria-hidden>
              <UserPlus strokeWidth={ICON_STROKE} />
            </span>
            <span className="player-text">
              <span className="player-name">Room for {PARTY_MAX - n} more</span>
              <span className="player-pick">
                Friends join with <span className="party-code-chip">{party.code}</span>
              </span>
            </span>
          </li>
        )}
      </ul>
    </section>
  );
}

function PlayerCard({
  m,
  i,
  host,
  me,
  setSize,
  showReady,
  onRemove,
}: {
  m: Member;
  i: number;
  host: boolean;
  me: boolean;
  setSize: number;
  showReady: boolean;
  /** The host removes this player from the party (absent for the host's own card, and for everyone else). */
  onRemove?: () => void;
}) {
  const Icon = PART_ICON[m.part];
  const missing = setSize - m.have.length;
  const notes = [
    !m.connected ? 'Reconnecting…' : '',
    missing > 0 && setSize > 0 ? `Missing ${missing} ${missing === 1 ? 'song' : 'songs'}` : '',
    m.calibrated ? '' : 'Not calibrated',
  ].filter(Boolean);
  // Their look's colours, where they made one: the band member they play wears them on stage.
  const look = m.avatar ? { ['--top' as string]: m.avatar.top, ['--bottom' as string]: m.avatar.bottom } : {};
  return (
    <li
      className={`player-card ${me ? 'me' : ''} ${m.connected ? '' : 'gone'} ${showReady && m.ready ? 'ready' : ''}`}
      style={{ ['--i' as string]: i, ...look }}
    >
      <span className={`player-art ${m.avatar ? 'dressed' : ''}`} aria-hidden>
        <span className="player-initial">{m.name.slice(0, 1).toUpperCase()}</span>
        <span className="player-part">
          <Icon strokeWidth={ICON_STROKE} />
        </span>
        {showReady && m.ready && (
          <span className="player-ready">
            <Check strokeWidth={ICON_STROKE} />
          </span>
        )}
      </span>
      <span className="player-text">
        <span className="player-name">
          <span className="player-name-text">{m.name}</span>
          {host && <Crown strokeWidth={ICON_STROKE} aria-label="Host" />}
          {me && <span className="player-you">You</span>}
        </span>
        <span className="player-pick">
          {PART_LABEL[m.part]} · <Pips difficulty={m.difficulty} /> {DIFFICULTY_LABEL[m.difficulty]}
        </span>
        {notes.length > 0 && <span className="player-notes">{notes.join(' · ')}</span>}
        {showReady && <span className="sr-only">{m.ready ? 'Ready' : 'Not ready'}</span>}
      </span>
      {onRemove && (
        <button type="button" className="icon-btn party-remove" aria-label={`Remove ${m.name} from the party`} onClick={onRemove}>
          <UserMinus strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      )}
    </li>
  );
}

/**
 * Leaving the party. The host's leaving ends it for everyone, so they hold it (its key too); everyone
 * else leaves with a press.
 */
function LeaveButton({ host, hints }: { host: boolean; hints: Hints }) {
  const key = keysOf('party.leave').kbd;
  // Quiet, at the bottom: it is the way out, not what the screen is for.
  if (host)
    return (
      <div className="party-end">
        <HoldButton
          label="End the party"
          hint={hints.mode === 'keyboard' && key ? `Hold ${keyName(key)} · for everyone` : 'Hold · for everyone'}
          tone="danger"
          holdKey={key}
          autoFocus={false}
          glyphStyle={hints.style}
          onComplete={() => online.leaveParty()}
        />
      </div>
    );
  return (
    <button type="button" className="btn wide" data-action="party-leave" data-sfx="back" onClick={() => online.leaveParty()}>
      <Hint kbd={key} {...hints} />
      <LogOut strokeWidth={ICON_STROKE} aria-hidden />
      Leave the party
    </button>
  );
}

const leaveAction = (host: boolean): Action[] =>
  // The host ends the party for everyone, so they hold it (LeaveButton); the others leave with a press.
  host
    ? []
    : [
        {
          id: 'party-leave',
          label: 'Leave the party',
          icon: LogOut,
          ...keysOf('party.leave'),
          bar: false,
          sfx: 'back',
          run: () => online.leaveParty(),
        },
      ];

/* The room: just the players, and the host picks a mode ------------------------------------ */

function PartyRoom({ party, s, settings, onBack, onSettings, me }: PartyProps & { me: Member }) {
  const hints = useHints(settings);
  const host = party.host === s.account!.id;
  const hostName = party.members.find((m) => m.id === party.host)?.name ?? 'The host';
  const n = party.members.length;

  useActions([
    backAction(onBack),
    ...(host
      ? PARTY_MODES.map((m) => ({
          id: `party-mode-${m}`,
          label: MODES[m].label,
          icon: MODES[m].icon,
          ...keysOf(MODES[m].binding),
          bar: false,
          run: () => online.setMode(m),
        }))
      : []),
    ...(host
      ? [
          {
            id: 'party-private',
            label: 'Private',
            icon: Lock,
            ...keysOf('party.private'),
            bar: false,
            run: () => online.setPrivate(!party.private),
          },
        ]
      : []),
    ...leaveAction(host),
  ]);

  /** A word under a mode for this party as it is: who would sit out, or what it needs. */
  const fit = (m: PartyMode) => (m === 'showdown' && n < 3 ? 'Works with 2, better with more' : n < 2 ? 'Waiting for friends to join' : '');

  return (
    <div className="lobby-body party-room">
      <div className="party-main">
        <h2 className="label">{host ? 'Pick what to play' : `${hostName} picks what to play`}</h2>
        <div className="mode-tiles" role="list" data-nav-group="modes">
          {PARTY_MODES.map((m, i) => {
            const { label, icon: Icon, cap, who, binding } = MODES[m];
            const note = fit(m);
            return (
              <button
                key={m}
                type="button"
                role="listitem"
                className="tile mode-tile"
                data-mode={m}
                data-action={`party-mode-${m}`}
                data-autofocus={i === 0 && host ? true : undefined}
                style={{ ['--i' as string]: i }}
                disabled={!host}
                onClick={() => online.setMode(m)}
              >
                <span className="mode-art" aria-hidden>
                  <Icon strokeWidth={ICON_STROKE} />
                </span>
                <span className="tile-text">
                  <span className="tile-title">
                    {label}
                    {host && <Hint {...keysOf(binding)} {...hints} />}
                  </span>
                  <span className="tile-cap">{cap}</span>
                  {/* How it plays, in three steps. */}
                  <span className="mode-steps">
                    {MODES[m].steps.map(([head, text], k) => (
                      <span key={head} className="mode-step">
                        <span className="hero-num">{k + 1}</span>
                        <span>
                          <span className="mode-step-head">{head}</span>
                          <span className="mode-step-text">{text}</span>
                        </span>
                      </span>
                    ))}
                  </span>
                  <span className="tile-meta">{who}</span>
                  {note && <span className="tile-meta warn">{note}</span>}
                </span>
              </button>
            );
          })}
        </div>
        {!host && <p className="hint">You choose your own part and difficulty once the mode is picked.</p>}
      </div>

      <section className="ready-panel" data-nav-group="ready" aria-label="The party">
        <PartyCode
          party={party}
          host={host}
          settings={settings}
          hints={hints}
          onDiscord={() => onSettings({ discordJoin: !settings.discordJoin })}
        />
        <Players party={party} me={me} host={host} showReady={false} />
        <LeaveButton host={host} hints={hints} />
      </section>
    </div>
  );
}

/* A mode's lobby: the set, its options, and ready up --------------------------------------- */

function ModeLobby({
  library,
  playable,
  setlist,
  onPick,
  onStartSong,
  onPickSongs,
  settings,
  onBack,
  onSettings,
  s,
  party,
  me,
  have,
}: PartyProps & { me: Member; have: string[] }) {
  const hints = useHints(settings);
  const calibrated = isCalibrated(settings);
  const [calibrating, setCalibrating] = useState(false);
  const transfers = useSyncExternalStore(partySongs.subscribe, partySongs.transfers);
  const held = useSyncExternalStore(partySongs.subscribe, partySongs.songs);
  const pad = hints.mode === 'pad';
  const host = party.host === s.account!.id;
  const sd = party.showdown;
  const mode = party.mode!;
  const nextIndex = party.songIndex + 1 < party.set.length ? party.songIndex + 1 : 0;
  const watching = party.phase === 'playing';
  const serverOn = !!s.info?.partySongs;

  // The host's setlist is the party's set: picked in the library, sent here as it changes. A
  // Showdown on the server's rotation plays that instead.
  const setKey = setlist.map((x) => x.id).join(',');
  const partyKey = party.set.map((x) => x.id).join(',');
  useEffect(() => {
    if (!host || sd?.rotation || party.phase !== 'lobby' || setKey === partyKey) return;
    online.setSet(setlist.map((x): SetSong => ({ id: x.id, title: x.title, artist: x.artist, duration: x.duration })));
  }, [host, sd?.rotation, party.phase, setKey, partyKey, setlist]);

  const choose = (part: Part, difficulty: Difficulty) => {
    onPick({ part, difficulty });
    online.ready(part, difficulty, me.ready, have, calibrated);
  };
  const toggleReady = () => online.ready(me.part, me.difficulty, !me.ready, have, calibrated);
  const locked = sd?.part ?? null;
  const nextPart = () => !locked && choose(PARTS[(PARTS.indexOf(me.part) + 1) % PARTS.length], me.difficulty);
  const nextDifficulty = () => choose(me.part, DIFFICULTIES[(DIFFICULTIES.indexOf(me.difficulty) + 1) % DIFFICULTIES.length]);
  // The host's Showdown switches: each changes one option and keeps the rest.
  const setShowdown = (o: Partial<ShowdownOptions>) => sd && online.setShowdown({ ...sd, ...o });
  const toggleHits = () => setShowdown({ hits: !sd?.hits });
  const toggleOnePart = () => setShowdown({ part: sd?.part ? null : me.part });
  const toggleRotation = () => setShowdown({ rotation: !sd?.rotation });
  const changeMode = () => online.setMode(null);

  const everyoneReady = party.members.every((m) => m.ready || !m.connected);
  const nextSong = party.set[nextIndex];
  const canStart = host && !watching && !!nextSong && playable(nextSong.id);
  const total = formatTime(party.set.reduce((t, x) => t + x.duration, 0));
  // Everyone ready (two or more): the next song counts down and starts by itself; the host can still start it now.
  const counting = !watching && !!nextSong && party.members.filter((m) => m.connected).length >= 2 && everyoneReady;
  const left = useCountdown(counting, AUTO_START_S);
  const started = useRef(false);
  // The count is heard: a tick a second, and a go as it runs out.
  useEffect(() => {
    if (left === null) return;
    playShowdownSfx(left === 0 ? 'go' : 'tick');
  }, [left]);
  useEffect(() => {
    if (!counting) started.current = false;
    else if (left === 0 && canStart && !started.current) {
      started.current = true;
      onStartSong(nextIndex);
    }
  }, [counting, left, canStart, nextIndex, onStartSong]);

  useActions([
    backAction(onBack),
    {
      id: 'party-ready',
      label: me.ready ? 'Not ready' : 'Ready',
      icon: Check,
      ...keysOf('party.ready'),
      bar: false,
      primary: !host,
      run: toggleReady,
    },
    { id: 'party-part', label: 'Next part', icon: PART_ICON[me.part], ...keysOf('party.part'), bar: false, run: nextPart },
    { id: 'party-difficulty', label: 'Next difficulty', icon: Gauge, ...keysOf('party.difficulty'), bar: false, run: nextDifficulty },
    ...(host
      ? [
          ...(sd?.rotation
            ? []
            : [
                {
                  id: 'party-pick-songs',
                  label: 'Pick songs',
                  icon: ListMusic,
                  ...keysOf('party.pickSongs'),
                  bar: false,
                  run: onPickSongs,
                },
              ]),
          { id: 'party-change-mode', label: 'Other mode', icon: Undo2, ...keysOf('party.changeMode'), bar: false, run: changeMode },
          ...(sd
            ? [
                { id: 'party-hits', label: 'Hits', icon: Crosshair, ...keysOf('party.hits'), bar: false, run: toggleHits },
                {
                  id: 'party-one-part',
                  label: 'One part',
                  icon: PART_ICON[me.part],
                  ...keysOf('party.onePart'),
                  bar: false,
                  run: toggleOnePart,
                },
                { id: 'party-rotation', label: 'Rotation', icon: ListMusic, ...keysOf('party.rotation'), bar: false, run: toggleRotation },
              ]
            : []),
        ]
      : []),
    ...(watching
      ? [{ id: 'party-cheer', label: 'Cheer', icon: Megaphone, ...keysOf('party.cheer'), bar: false, run: () => online.cheer() }]
      : []),
    ...leaveAction(host),
  ]);

  const partRow = useSlide<HTMLDivElement>(me.part);
  const diffRow = useSlide<HTMLDivElement>(me.difficulty);

  return (
    <div className={`lobby-body party-lobby ${sd ? 'ringside' : ''}`}>
      <div className="party-main">
        <div className="party-set-head">
          <h2 className="label">
            {sd?.rotation ? 'The server’s rotation' : 'The set'}
            {party.set.length > 0 && (
              <span className="label-note">
                {party.set.length} {party.set.length === 1 ? 'song' : 'songs'}
                {total && ` · ${total}`}
              </span>
            )}
          </h2>
          {host && !sd?.rotation && (
            <button type="button" className="btn small" data-action="party-pick-songs" onClick={onPickSongs}>
              <Hint {...keysOf('party.pickSongs')} {...hints} />
              <ListMusic strokeWidth={ICON_STROKE} aria-hidden />
              Pick songs
            </button>
          )}
          {host && (
            <button type="button" className="btn small" data-action="party-change-mode" disabled={watching} onClick={changeMode}>
              <Hint {...keysOf('party.changeMode')} {...hints} />
              <Undo2 strokeWidth={ICON_STROKE} aria-hidden />
              Other mode
            </button>
          )}
        </div>
        {party.set.length === 0 ? (
          <div className="set-card party-empty">
            <span className="slot-num" aria-hidden>
              <ListMusic strokeWidth={ICON_STROKE} />
            </span>
            <span className="song-text">
              <span className="song-title">{host ? 'No songs yet' : 'The host is picking the songs'}</span>
              <span className="song-artist">
                {host
                  ? 'Pick up to four from your library. Players who lack one get it from you through the server.'
                  : 'Songs you lack come to you by themselves.'}
              </span>
            </span>
          </div>
        ) : (
          <ol className="set-cards" aria-label="The party’s set">
            {party.set.map((song, i) => (
              <SetCard
                key={song.id}
                song={song}
                i={i}
                party={party}
                mine={library.get(song.id)}
                next={!watching && i === nextIndex}
                serverOn={serverOn}
                transfer={transfers[song.id]}
                held={!!held[song.id]}
              />
            ))}
          </ol>
        )}

        {mode === 'showdown' && sd && (
          <ShowdownOptionsPanel party={party} host={host} me={me} hints={hints} on={{ toggleHits, toggleOnePart, toggleRotation }} />
        )}
        <Players party={party} me={me} host={host} showReady />
      </div>
      {sd && <div className="ring-window" aria-hidden />}

      <section className="ready-panel" data-nav-group="ready" aria-label="Your part and difficulty">
        {watching && <PartyBoardPanel s={s} party={party} hints={hints} />}
        <h2 className="label" id="party-part-label">
          Your part
        </h2>
        <div className="pick-line">
          {pad && (
            <span className="pick-hint" aria-hidden>
              <PadGlyph input={keysOf('party.part').pad ?? 'b3'} style={hints.style} />
            </span>
          )}
          <div className="part-row slide" ref={partRow} role="radiogroup" aria-labelledby="party-part-label">
            <span className="sel" aria-hidden />
            {PARTS.map((p) => {
              const Icon = PART_ICON[p];
              const on = me.part === p;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-on={on}
                  className={`choice part ${on ? 'on' : ''}`}
                  disabled={!!locked && p !== locked}
                  onClick={() => choose(p, me.difficulty)}
                >
                  <Icon strokeWidth={ICON_STROKE} aria-hidden />
                  <span>{PART_LABEL[p]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <h2 className="label" id="party-diff-label">
          Difficulty
        </h2>
        <div className="pick-line">
          {pad && (
            <span className="pick-hint" aria-hidden>
              <PadGlyph input={keysOf('party.difficulty').pad ?? 'b2'} style={hints.style} />
            </span>
          )}
          <div className="diff-row slide" ref={diffRow} role="radiogroup" aria-labelledby="party-diff-label">
            <span className="sel" aria-hidden />
            {DIFFICULTIES.map((d) => {
              const on = me.difficulty === d;
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-on={on}
                  className={`choice diff ${on ? 'on' : ''}`}
                  onClick={() => choose(me.part, d)}
                >
                  <Pips difficulty={d} />
                  <span>{DIFFICULTY_LABEL[d]}</span>
                </button>
              );
            })}
          </div>
        </div>
        <p className="lane-info">
          <span className="dim">
            {locked
              ? `Everyone plays ${PART_LABEL[locked].toLowerCase()} in this Showdown.`
              : 'A song without your part is played on one it has.'}
          </span>
        </p>
        {!calibrated && (
          <p className="hint party-calibrate">
            <span>Your audio offset was never calibrated on this output, and scores are compared here.</span>
            <button type="button" className="btn small" onClick={() => setCalibrating(true)}>
              <Gauge strokeWidth={ICON_STROKE} aria-hidden />
              Calibrate
            </button>
          </p>
        )}
        {calibrating && (
          <Calibration
            onDone={(ms) => {
              setCalibrating(false);
              if (ms !== null) onSettings({ offsetMs: ms, calibratedOn: settings.outputDevice });
            }}
          />
        )}

        <button
          type="button"
          className={`btn wide ${me.ready ? 'is-ready' : host ? '' : 'primary'}`}
          data-action="party-ready"
          onClick={toggleReady}
        >
          <Hint {...keysOf('party.ready')} {...hints} />
          <Check strokeWidth={ICON_STROKE} aria-hidden />
          {me.ready ? 'Ready' : 'I’m ready'}
          {me.ready && <span className="btn-note">Press again if you are not</span>}
        </button>

        {counting && left !== null && (
          <p className="party-countdown" role="status" style={{ ['--left' as string]: left / AUTO_START_S }}>
            <span className="party-countdown-num" key={left}>
              {left}
            </span>
            <span className="party-countdown-text">
              Everyone is ready
              <span className="dim">{nextSong ? `${nextSong.title} starts by itself` : 'Starting'}</span>
            </span>
          </p>
        )}
        {host ? (
          <HoldButton
            label={nextSong ? `Start ${nextSong.title}` : 'Start'}
            hint={
              watching
                ? 'A song is playing.'
                : !nextSong
                  ? 'Pick the songs first.'
                  : !playable(nextSong.id)
                    ? 'You need this song, with notes, to start it: everyone plays your charts.'
                    : everyoneReady
                      ? hints.mode === 'keyboard'
                        ? 'Hold Enter to start now'
                        : 'Hold to start now'
                      : 'Not everyone is ready. Hold to start anyway.'
            }
            disabled={!canStart}
            glyph={pad ? <PadGlyph input={confirmInput(hints.style)} style={hints.style} /> : undefined}
            glyphStyle={hints.style}
            onComplete={() => onStartSong(nextIndex)}
          />
        ) : (
          <p className="hint party-wait">
            <Crown strokeWidth={ICON_STROKE} aria-hidden /> {party.members.find((m) => m.id === party.host)?.name ?? 'The host'} starts each
            song{everyoneReady ? '.' : ' once everyone is ready.'}
          </p>
        )}
        <LeaveButton host={host} hints={hints} />
      </section>
    </div>
  );
}

/** One song of the set: who has it, and the song on its way to this player (or from the host). */
function SetCard({
  song,
  i,
  party,
  mine,
  next,
  serverOn,
  transfer,
  held,
}: {
  song: SetSong;
  i: number;
  party: PartyState;
  mine: SongMeta | undefined;
  next: boolean;
  serverOn: boolean;
  transfer: Transfer | undefined;
  /** Downloaded for this party only: it goes when the player leaves, unless they keep it. */
  held: boolean;
}) {
  const done = party.results.some((r) => r.songIndex === i);
  const count = party.members.filter((m) => m.have.includes(song.id)).length;
  let note: React.ReactNode;
  if (transfer?.state === 'getting')
    note = (
      <span className="transfer">
        <CloudDownload strokeWidth={ICON_STROKE} aria-hidden />
        Getting it · {Math.round(transfer.done * 100)}%
        <span className="transfer-bar" style={{ ['--done' as string]: transfer.done }} aria-hidden />
      </span>
    );
  else if (transfer?.state === 'sending')
    note = (
      <span className="transfer">
        <CloudUpload strokeWidth={ICON_STROKE} aria-hidden />
        Sending it to the players who lack it…
      </span>
    );
  else if (transfer?.state === 'failed')
    note = (
      <span className="warn">
        {transfer.message}
        <button type="button" className="btn small" onClick={() => partySongs.retry(song.id)}>
          <RefreshCw strokeWidth={ICON_STROKE} aria-hidden />
          Try again
        </button>
      </span>
    );
  else if (!mine)
    note = (
      <span className="warn">
        {serverOn
          ? 'Not in your library yet: it comes from the host’s game, unless they keep their songs to themselves.'
          : 'Not in your library, and this server does not pass songs on: add it yourself, or you sit it out.'}
      </span>
    );
  else if (held)
    note = (
      <span className="transfer held">
        <CloudDownload strokeWidth={ICON_STROKE} aria-hidden />
        Here for this party
        <button type="button" className="btn small" onClick={() => void partySongs.keep(song.id)}>
          <Download strokeWidth={ICON_STROKE} aria-hidden />
          Keep it
        </button>
      </span>
    );
  else note = count === party.members.length ? 'Everyone has it' : `${count} of ${party.members.length} have it`;
  return (
    <li className={`set-card ${mine ? '' : 'skipped'} ${next ? 'next' : ''}`} style={{ ['--i' as string]: i }}>
      <span className="slot-num" aria-hidden>
        {i + 1}
      </span>
      <Cover blob={mine?.cover} title={song.title} />
      <span className="song-text">
        <span className="song-title">{song.title}</span>
        <span className="song-artist">
          {song.artist}
          {song.duration > 0 && ` · ${formatTime(song.duration)}`}
        </span>
        <span className="set-notes">{note}</span>
      </span>
      <span className="set-best">{done ? <span className="dim">Played</span> : next ? <span className="next-tag">Next</span> : null}</span>
    </li>
  );
}

/** The Showdown's options: the host switches them, everyone else sees them. */
function ShowdownOptionsPanel({
  party,
  host,
  me,
  hints,
  on,
}: {
  party: PartyState;
  host: boolean;
  me: Member;
  hints: Hints;
  on: { toggleHits(): void; toggleOnePart(): void; toggleRotation(): void };
}) {
  const sd = party.showdown!;
  const left = party.members.filter((m) => !m.eliminated).length;
  const onePart = sd.part ?? me.part;
  const chips: { id: string; binding: string; icon: LucideIcon; label: string; value: string; run(): void }[] = [
    { id: 'party-hits', binding: 'party.hits', icon: Crosshair, label: 'Hits', value: sd.hits ? 'On' : 'Off', run: on.toggleHits },
    {
      id: 'party-one-part',
      binding: 'party.onePart',
      icon: PART_ICON[onePart],
      label: sd.part ? 'Only part' : 'Parts',
      value: sd.part ? PART_LABEL[onePart] : 'Any',
      run: on.toggleOnePart,
    },
    {
      id: 'party-rotation',
      binding: 'party.rotation',
      icon: ListMusic,
      label: 'Songs',
      value: sd.rotation ? 'Rotation' : 'Host’s',
      run: on.toggleRotation,
    },
  ];
  return (
    <section className="showdown-rules" aria-label="Showdown options">
      <h2 className="label">
        <Swords strokeWidth={ICON_STROKE} aria-hidden /> Showdown
        {party.songIndex >= 0 && (
          <span className="label-note">
            {left} of {party.members.length} still in
          </span>
        )}
      </h2>
      <ol className="mode-steps compact">
        {MODES.showdown.steps
          .filter((_, k) => k !== 1 || sd.hits)
          .map(([head, text], k) => (
            <li key={head} className="mode-step">
              <span className="hero-num">{k + 1}</span>
              <span>
                <span className="mode-step-head">{head}</span>
                <span className="mode-step-text">{text}</span>
              </span>
            </li>
          ))}
      </ol>
      <div className="option-chips">
        {chips.map(({ id, binding, icon: Icon, label, value, run }) => (
          <button
            key={id}
            type="button"
            className="option-chip"
            data-action={id}
            disabled={!host}
            aria-label={`${label}: ${value}${host ? ', change' : ''}`}
            onClick={run}
          >
            {host && <Hint {...keysOf(binding)} {...hints} />}
            <Icon strokeWidth={ICON_STROKE} aria-hidden />
            <span className="option-chip-label">{label}</span>
            <span className="option-chip-value">{value}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* While a song plays ---------------------------------------------------------------------- */

const nameOf = (party: PartyState | null, id: string) => party?.members.find((m) => m.id === id)?.name ?? 'Left';

/** The party's board beside the highway: every player's score and streak, live. */
/** A share of par as a percentage, one decimal. */
const percent = (share: number) => `${(share * 100).toFixed(1)}%`;

export function PartyBoard({ me }: { me: string }) {
  const s = useOnline();
  const board = useSyncExternalStore(online.subscribeBoard, online.board);
  const showdown = !!s.party?.showdown;
  if (showdown) return <ShowdownBoard me={me} />;
  const all = [...(board?.lines ?? [])].filter((l) => !l.out || l.score > 0).sort((a, b) => b.score - a.score);
  if (!all.length) return null;
  const mine = all.find((l) => l.id === me);
  // A Showdown's board keeps to the top five and the players around you, and says how many play.
  const at = all.findIndex((l) => l.id === me);
  const lines = showdown ? all.filter((_, i) => i < 5 || (at >= 0 && Math.abs(i - at) <= 1)) : all;
  return (
    <ol className="party-board" aria-label="Scores">
      {lines.map((l) => (
        <BoardRow
          key={l.id}
          l={l}
          rank={all.indexOf(l) + 1}
          name={nameOf(s.party, l.id)}
          me={l.id === me}
          target={!!mine?.aim && mine.aim === l.id}
          threat={l.aim === me}
        />
      ))}
      {showdown && <li className="party-board-left dim">{all.filter((l) => !l.out).length} playing</li>}
    </ol>
  );
}

/** "1st", "2nd", "13th". */
export const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${suffix}`;
};

/** A player's badge: a disc in their look's colours with their initial (violet without a look). */
export function PlayerFace({ id, className = '' }: { id: string; className?: string }) {
  const m = online.snapshot().party?.members.find((x) => x.id === id);
  const top = m?.avatar?.top ?? '#5b3ee0';
  const bottom = m?.avatar?.bottom ?? '#ff4d9d';
  return (
    <span className={`sd-face ${className}`} style={{ background: `linear-gradient(140deg, ${top}, ${bottom})` }} aria-hidden>
      {(m?.name ?? '?').slice(0, 1).toUpperCase()}
    </span>
  );
}

/**
 * A Showdown's board beside the highway: big pills, the leader under a crown, then the players
 * around you, yours in gold; the cut line with how far above (+) or below (−) it you are; and your
 * place, large, in the corner. The pills glide to their new places as the order changes.
 */
function ShowdownBoard({ me }: { me: string }) {
  const s = useOnline();
  const board = useSyncExternalStore(online.subscribeBoard, online.board);
  const listRef = useRef<HTMLOListElement>(null);
  const ranked = [...(board?.lines ?? [])].filter((l) => !l.out).sort((a, b) => b.score - a.score);
  const at = ranked.findIndex((l) => l.id === me);
  const order = ranked.map((l) => l.id).join(',');
  // The pills glide from where they were to where they are now (FLIP).
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    for (const el of list.querySelectorAll<HTMLElement>('[data-id]')) {
      const id = el.dataset.id!;
      const top = el.offsetTop;
      const was = tops.current.get(id);
      tops.current.set(id, top);
      if (was === undefined || was === top) continue;
      el.animate([{ transform: `translateY(${was - top}px)` }, { transform: 'translateY(0)' }], {
        duration: 420,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      });
    }
  }, [order]);
  if (!ranked.length) return null;
  const mine = ranked[at];
  const cut = Math.min(s.party?.cut ?? ranked.length, ranked.length);
  // The leader, then the two above you and the one below (more when you lead).
  const shown = new Set<number>([0]);
  if (at >= 0) for (let i = Math.max(0, at - 2); i <= Math.min(ranked.length - 1, at + 1); i++) shown.add(i);
  else for (let i = 1; i < Math.min(4, ranked.length); i++) shown.add(i);
  const rows = [...shown].sort((a, b) => a - b);
  // How far you are from the cut, in points: above it, ahead of the first who would go out;
  // below it, behind the last who would stay.
  const safe = at >= 0 && at < cut;
  const margin =
    at < 0 || cut >= ranked.length ? null : safe ? mine.score - (ranked[cut]?.score ?? 0) : mine.score - (ranked[cut - 1]?.score ?? 0);
  const cutRow = (
    <li key="cut" className={`sd-cut ${safe ? 'safe' : 'danger'}`} aria-label={`The cut: ${cut} go through`}>
      <Scissors strokeWidth={ICON_STROKE} aria-hidden />
      <span className="sd-cut-line" aria-hidden />
      {margin !== null && (
        <span className="sd-cut-margin num">
          <span className="sd-cut-arrow" aria-hidden>
            {safe ? '▲' : '▼'}
          </span>
          {margin >= 0 ? '+' : '−'}
          {Math.abs(margin).toLocaleString()}
        </span>
      )}
      <span className="sd-cut-line" aria-hidden />
    </li>
  );
  const items: React.ReactNode[] = [];
  rows.forEach((i, k) => {
    if (k > 0 && i - rows[k - 1] > 1) items.push(<li key={`gap-${i}`} className="sd-gap" aria-hidden />);
    if (i === cut && cut < ranked.length && (k === 0 || rows[k - 1] < cut)) items.push(cutRow);
    const l = ranked[i];
    items.push(
      <li key={l.id} data-id={l.id} className={`sd-row ${l.id === me ? 'me' : ''} ${i === 0 ? 'lead' : ''} ${l.hit ? 'hit' : ''}`}>
        <span className="sd-rank num">{i + 1}</span>
        <span className="sd-pill">
          <span className="sd-who">
            <span className="sd-name">
              {!!mine?.aim && mine.aim === l.id && (
                <Crosshair className="aim" strokeWidth={ICON_STROKE} aria-label="Your Strike would hit them" />
              )}
              {l.aim === me && <Swords className="aim" strokeWidth={ICON_STROKE} aria-label="Their Strike would hit you" />}
              {nameOf(s.party, l.id)}
            </span>
            <span className="sd-share num">{l.score.toLocaleString()}</span>
          </span>
          <span className="sd-face-wrap">
            {i === 0 && <Crown className="sd-crown" strokeWidth={ICON_STROKE} aria-label="First" />}
            <PlayerFace id={l.id} />
          </span>
        </span>
      </li>,
    );
  });
  // The cut below everyone shown: drawn at the bottom.
  if (cut < ranked.length && rows[rows.length - 1] < cut) items.push(cutRow);
  return (
    <>
      <ol className="sd-board" aria-label="Showdown standings" ref={listRef}>
        {items}
        <li className="sd-left">
          {ranked.length} playing · {cut === 1 ? 'the best one wins' : `top ${cut} go through`}
        </li>
      </ol>
      {at >= 0 && (
        <p className={`sd-place ${safe ? '' : 'danger'}`} key={at} aria-label={`You are ${ordinal(at + 1)}`}>
          {ordinal(at + 1)}
        </p>
      )}
    </>
  );
}

function BoardRow({
  l,
  rank,
  name,
  me,
  target,
  threat,
}: {
  l: BoardLine;
  rank: number;
  name: string;
  me: boolean;
  /** Showdown: your Strike would hit this player. */
  target: boolean;
  /** Showdown: this player's Strike would hit you. */
  threat: boolean;
}) {
  return (
    <li className={`party-board-row ${me ? 'me' : ''} ${l.out ? 'out' : ''} ${l.hit ? 'hit' : ''}`}>
      <span className="num rank">{rank}</span>
      <span className="party-name">
        {target && <Crosshair className="aim" strokeWidth={ICON_STROKE} aria-label="Your Strike would hit them" />}
        {threat && <Swords className="aim" strokeWidth={ICON_STROKE} aria-label="Their Strike would hit you" />} {name}
      </span>
      <span className="num">{l.score.toLocaleString()}</span>
      <span className="dim num">{l.done ? 'done' : l.out ? 'left' : l.hit ? 'hit' : `×${l.streak}`}</span>
    </li>
  );
}

/** The board in the lobby, for a player sitting the song out or out of the Showdown: they watch, and can cheer. */
function PartyBoardPanel({ s, party, hints }: { s: OnlineState; party: PartyState; hints: ReturnType<typeof useHints> }) {
  const song = party.set[party.songIndex];
  return (
    <div className="party-watch">
      <h2 className="label">Playing now: {song?.title ?? `song ${party.songIndex + 1}`}</h2>
      <PartyBoard me={s.account!.id} />
      <button type="button" className="btn small" data-action="party-cheer" onClick={() => online.cheer()}>
        <Hint {...keysOf('party.cheer')} {...hints} />
        <Megaphone strokeWidth={ICON_STROKE} aria-hidden />
        Cheer them on
      </button>
    </div>
  );
}

/* After a song ----------------------------------------------------------------------------- */

/** How long a Showdown waits between songs before the host's game starts the next one, s. */
const AUTO_NEXT_S = 20;
/** Of that, how long the results show before Next up takes over, s. */
const RESULTS_S = 8;

/** The player's own last song in this party, as their game judged it (for the stats card). */
export interface LastRun {
  songIndex: number;
  results: Results;
  part: Part;
  difficulty: Difficulty;
}

/**
 * Between the songs of a Showdown, over the stage: two tabs that turn by themselves. Results first
 * (the round, everyone in order, the cut line), then Next up (the next song and your part and
 * difficulty for it on the left, your card and stats on the right, the stage between). A countdown
 * in the corner starts the next song; Esc asks to leave the party.
 */
function ShowdownBetween({
  party,
  s,
  settings,
  onStartSong,
  onPick,
  me,
  have,
  lastRun,
  partsOf,
}: PartyProps & { me: Member; have: string[] }) {
  const hints = useHints(settings);
  const host = party.host === s.account!.id;
  const calibrated = isCalibrated(settings);
  const results = party.results.find((r) => r.songIndex === party.songIndex);
  const member = (id: string) => party.members.find((m) => m.id === id);
  const lines = results?.lines ?? [];
  const stays = lines.filter((l) => !member(l.id)?.eliminated);
  const outNow = lines.filter((l) => l.eliminated);
  const outBefore = lines.filter((l) => member(l.id)?.eliminated && !l.eliminated);
  const decided = stays.length <= 1;
  const last = party.songIndex + 1 >= party.set.length || decided;
  const nextSong = party.set[party.songIndex + 1];
  const [left, setLeft] = useState(AUTO_NEXT_S);
  const [held, setHeld] = useState(false);
  const [tab, setTab] = useState<'results' | 'next'>('results');
  const [asking, setAsking] = useState(false);
  const next = () => onStartSong(party.songIndex + 1);
  // The countdown; the results turn into Next up (or, after the final, The end) on their own after a
  // while. After the final it stops there: no song comes next.
  const turnAt = AUTO_NEXT_S - RESULTS_S;
  useEffect(() => {
    if (held) return;
    const t = window.setInterval(() => setLeft((n) => Math.max(last ? turnAt : 0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [held, last, turnAt]);
  useEffect(() => {
    if (left === turnAt) setTab('next');
  }, [left, turnAt]);
  const startRef = useRef(next);
  startRef.current = next;
  useEffect(() => {
    if (host && !last && !held && left === 0) startRef.current();
  }, [host, last, held, left]);
  // The tab buttons (Q and E) turn the tabs.
  useEffect(() => {
    const onTab = () => setTab((t) => (t === 'results' ? 'next' : 'results'));
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, []);

  // Your part and difficulty for the next song, as in a lobby.
  const locked = party.showdown?.part ?? null;
  const choose = (part: Part, difficulty: Difficulty) => {
    onPick({ part, difficulty });
    online.ready(part, difficulty, true, have, calibrated);
  };
  const nextParts = nextSong ? partsOf(nextSong.id) : PARTS;

  useActions([
    // Esc leaves the party, after asking: there is no going back to the menus mid-Showdown.
    { id: 'back', label: host ? 'End the party' : 'Leave the party', icon: LogOut, kbd: 'Escape', sfx: 'back', run: () => setAsking(true) },
    ...(host && !last
      ? [
          { id: 'party-next', label: 'Start now', icon: SkipForward, ...keysOf('party.next'), run: next },
          { id: 'party-hold', label: held ? 'Count down' : 'Hold', icon: Pause, ...keysOf('party.hold'), run: () => setHeld((h) => !h) },
        ]
      : []),
    ...(host && last
      ? [
          {
            id: 'party-lobby',
            label: 'Back to the lobby',
            icon: Undo2,
            ...keysOf('party.lobby'),
            primary: true,
            run: () => online.backToLobby(),
          },
        ]
      : []),
    {
      id: 'party-part',
      label: 'Next part',
      icon: PART_ICON[me.part],
      ...keysOf('party.part'),
      bar: false,
      run: () => !locked && choose(nextParts[(nextParts.indexOf(me.part) + 1) % nextParts.length] ?? me.part, me.difficulty),
    },
    {
      id: 'party-difficulty',
      label: 'Next difficulty',
      icon: Gauge,
      ...keysOf('party.difficulty'),
      bar: false,
      run: () => choose(me.part, DIFFICULTIES[(DIFFICULTIES.indexOf(me.difficulty) + 1) % DIFFICULTIES.length]),
    },
  ]);

  const mineAt = stays.findIndex((l) => l.id === me.id);
  const mineLine = lines.find((l) => l.id === me.id);
  const place = mineAt >= 0 ? mineAt + 1 : lines.findIndex((l) => l.id === me.id) + 1;
  // Out in this round shows as out, even without a result (the player left the song); out
  // before it, they only watch.
  const outHere = !!mineLine?.eliminated;
  const played = !!mineLine?.result || outHere;
  const status = !played
    ? { text: me.eliminated ? 'Watching' : 'Sat it out', tone: '' }
    : outHere
      ? { text: `Out · ${ordinal(place)}`, tone: 'out' }
      : decided && mineAt === 0
        ? { text: 'Winner', tone: 'win' }
        : mineAt >= 0
          ? { text: `Through · ${ordinal(place)}`, tone: 'through' }
          : { text: `Out · ${ordinal(place)}`, tone: 'out' };
  const mine = lastRun && lastRun.songIndex === party.songIndex ? lastRun : null;
  // The result in sound as the results open; the tabs turning; the last seconds ticking.
  useEffect(() => {
    if (status.tone === 'win') playShowdownSfx('win');
    else if (status.tone === 'through') playShowdownSfx('through');
    else if (status.tone === 'out') playShowdownSfx('out');
    // Once, as the results open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const firstTab = useRef(true);
  useEffect(() => {
    if (firstTab.current) return void (firstTab.current = false);
    playShowdownSfx('turn');
  }, [tab]);
  useEffect(() => {
    if (!held && left > 0 && left <= 5) playShowdownSfx('tick');
  }, [left, held]);

  const row = (l: ResultLine, rank: number, i: number) => {
    const m = member(l.id);
    const Icon = m ? PART_ICON[m.part] : null;
    return (
      <li key={l.id} className={`sdr-row ${l.id === me.id ? 'me' : ''} ${l.eliminated ? 'out' : ''}`} style={{ ['--i' as string]: i }}>
        <span className="sdr-rank num">{rank === 1 && !l.eliminated ? <Crown strokeWidth={ICON_STROKE} aria-label="First" /> : rank}</span>
        <span className="sdr-name">{l.name}</span>
        <span className={`sdr-acc ${l.result && l.result.accuracy >= 1 ? 'perfect' : ''}`}>
          {l.result ? `${Math.round(l.result.accuracy * 100)}%` : '–'}
        </span>
        <span className="sdr-share num">{l.result ? l.result.score.toLocaleString() : '–'}</span>
        <span className="sdr-part">{Icon && <Icon strokeWidth={ICON_STROKE} aria-label={PART_LABEL[m!.part]} />}</span>
      </li>
    );
  };
  const pct = (n: number, of: number) => (of > 0 ? ` (${Math.round((n / of) * 100)}%)` : '');
  // A few players fit in one column, in the middle; a full party takes two.
  const few = lines.length <= 8;

  return (
    <div className="sdb">
      <nav className="sdb-tabs" aria-label="Between songs">
        <Hint {...keysOf('menus.tabPrev')} {...hints} />
        <div className="tab-row" role="tablist">
          {(
            [
              ['results', 'Results'],
              ['next', last ? 'The end' : 'Next up'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tab ${tab === id ? 'on' : ''}`}
              onClick={() => setTab(id)}
            >
              <span className="tab-label">{label}</span>
            </button>
          ))}
        </div>
        <Hint {...keysOf('menus.tabNext')} {...hints} />
        {!held && (!last || left > turnAt) && (
          <span className="sdb-progress" aria-hidden>
            <span
              style={{ ['--p' as string]: tab === 'results' ? (AUTO_NEXT_S - left) / RESULTS_S : 1 - left / (AUTO_NEXT_S - RESULTS_S) }}
            />
          </span>
        )}
      </nav>

      {tab === 'results' ? (
        <section className="sdb-results" key="results" aria-label="Results">
          <header className="sdr-head">
            <span className="sdr-kicker">{decided ? 'The Showdown is decided' : last ? 'The final' : `Top ${stays.length} continue`}</span>
            <h2 className="sdr-title">{last && party.songIndex > 0 ? 'Final' : `Round ${party.songIndex + 1}`}</h2>
          </header>
          <ol className={`sdr-grid ${few ? 'few' : ''}`} aria-label="Standings after this song">
            {stays.map((l, i) => row(l, i + 1, i))}
          </ol>
          {outNow.length > 0 && (
            <>
              <div className={`sdr-cut ${few ? 'few' : ''}`} aria-label="The cut">
                <Scissors strokeWidth={ICON_STROKE} aria-hidden />
                <span />
              </div>
              <ol className={`sdr-grid ${few ? 'few' : ''}`} aria-label="Out after this song">
                {outNow.map((l, i) => row(l, stays.length + i + 1, stays.length + i))}
              </ol>
            </>
          )}
          {outBefore.length > 0 && <p className="sdr-earlier">Out earlier: {outBefore.map((l) => l.name).join(', ')}</p>}
        </section>
      ) : (
        <section className="sdb-next" key="next" aria-label="Next up">
          <div className="sdb-col">
            {nextSong && !last ? (
              <>
                <h2 className="sdb-heading">Next song</h2>
                <div className="sdb-card sdb-song">
                  <Cover title={nextSong.title} />
                  <span className="song-text">
                    <span className="song-title">{nextSong.title}</span>
                    <span className="song-artist">{nextSong.artist}</span>
                    <span className="sdb-parts">
                      {PARTS.map((p) => {
                        const Icon = PART_ICON[p];
                        return (
                          <span key={p} className={nextParts.includes(p) ? '' : 'off'} title={PART_LABEL[p]}>
                            <Icon strokeWidth={ICON_STROKE} aria-label={PART_LABEL[p]} />
                          </span>
                        );
                      })}
                    </span>
                  </span>
                </div>
                {me.eliminated ? (
                  <p className="sdb-card sdb-note">You are out: you watch the rest, and can cheer the others on.</p>
                ) : (
                  <>
                    <div className="sdb-card">
                      <span className="sdb-label">
                        {DIFFICULTY_LABEL[me.difficulty]}
                        <Hint {...keysOf('party.difficulty')} {...hints} />
                      </span>
                      <div className="diff-row" role="radiogroup" aria-label="Difficulty">
                        {DIFFICULTIES.map((d) => (
                          <button
                            key={d}
                            type="button"
                            role="radio"
                            aria-checked={me.difficulty === d}
                            className={`choice diff ${me.difficulty === d ? 'on' : ''}`}
                            onClick={() => choose(me.part, d)}
                          >
                            <Pips difficulty={d} />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="sdb-card">
                      <span className="sdb-label">
                        {PART_LABEL[me.part]}
                        {!locked && <Hint {...keysOf('party.part')} {...hints} />}
                      </span>
                      <div className="part-row" role="radiogroup" aria-label="Part">
                        {PARTS.map((p) => {
                          const Icon = PART_ICON[p];
                          return (
                            <button
                              key={p}
                              type="button"
                              role="radio"
                              aria-checked={me.part === p}
                              aria-label={PART_LABEL[p]}
                              className={`choice ${me.part === p ? 'on' : ''}`}
                              disabled={(!!locked && p !== locked) || !nextParts.includes(p)}
                              onClick={() => choose(p, me.difficulty)}
                            >
                              <Icon strokeWidth={ICON_STROKE} aria-hidden />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <h2 className="sdb-heading">{decided ? 'The winner' : 'The end'}</h2>
                <div className="sdb-card sdb-note">
                  <span className="song-title">
                    <Crown strokeWidth={ICON_STROKE} aria-hidden /> {stays[0]?.name ?? '–'}
                  </span>
                  <span className="song-artist">{host ? 'Back to the lobby to play another.' : 'The host picks what comes next.'}</span>
                </div>
              </>
            )}
          </div>

          <div className="sdb-col sdb-right">
            <div className={`sdb-card sdb-me ${status.tone}`}>
              <span className="sdb-me-name">{me.name}</span>
              <span className="sdr-me-status">{status.text}</span>
              {mineLine?.result && (
                <span className="sdb-me-score">
                  <Stars n={mineLine.result.stars} />
                  <span className={`sdr-acc ${mineLine.result.accuracy >= 1 ? 'perfect' : ''}`}>
                    {Math.round(mineLine.result.accuracy * 100)}%
                  </span>
                </span>
              )}
              {mineLine?.result && (
                <span className="sdb-me-line">
                  <span className="num">{mineLine.result.score.toLocaleString()}</span>
                  {mine && (
                    <span className="sdb-me-pick">
                      {(() => {
                        const Icon = PART_ICON[mine.part];
                        return <Icon strokeWidth={ICON_STROKE} aria-label={PART_LABEL[mine.part]} />;
                      })()}
                      <span className="board-diff">{DIFFICULTY_LABEL[mine.difficulty].slice(0, 1)}</span>
                    </span>
                  )}
                </span>
              )}
            </div>
            {mineLine?.result?.fullCombo && <span className="sdb-badge">Full combo!</span>}
            {mineLine?.result && (
              <div className="sdb-card">
                <h3 className="sdb-heading small">Stats</h3>
                <dl className="sdr-stats">
                  {mine && (
                    <>
                      <dt>Total notes</dt>
                      <dd className="num">{mine.results.totalNotes}</dd>
                      <dt>Perfect</dt>
                      <dd className="num">
                        {mine.results.counts.perfect}
                        {pct(mine.results.counts.perfect, mine.results.totalNotes)}
                      </dd>
                      <dt>Great</dt>
                      <dd className="num">
                        {mine.results.counts.great}
                        {pct(mine.results.counts.great, mine.results.totalNotes)}
                      </dd>
                      <dt>Good</dt>
                      <dd className="num">
                        {mine.results.counts.good}
                        {pct(mine.results.counts.good, mine.results.totalNotes)}
                      </dd>
                      <dt>Missed</dt>
                      <dd className="num">
                        {mine.results.counts.miss}
                        {pct(mine.results.counts.miss, mine.results.totalNotes)}
                      </dd>
                      <dt>Overdrives</dt>
                      <dd className="num">{mine.results.overdriveActivations}</dd>
                    </>
                  )}
                  <dt>Longest streak</dt>
                  <dd className="num">{mineLine.result.bestStreak}</dd>
                </dl>
              </div>
            )}
          </div>
        </section>
      )}

      {(!last || left > turnAt) && (
        <p className={`sdb-count ${held ? 'held' : ''}`} aria-live="polite">
          <Disc3 strokeWidth={ICON_STROKE} aria-hidden />
          <span>
            <span className="sdb-count-label">
              {held ? 'On hold' : last ? 'The end in' : tab === 'results' ? 'Next up in' : 'Next song in'}
            </span>
            {!held && <span className="sdb-count-num num">{last || tab === 'results' ? left - turnAt : left}</span>}
          </span>
        </p>
      )}

      {asking && (
        <Dialog title={host ? 'End the party' : 'Leave the party'} variant="card" closeLabel="Stay" onClose={() => setAsking(false)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">{host ? 'End the party?' : 'Leave the party?'}</h2>
              <p className="hint">{host ? 'It ends for everyone in it.' : 'You leave the Showdown. The others play on.'}</p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Stay
              </button>
              <button type="button" className="btn primary wide" onClick={() => online.leaveParty()}>
                {host ? 'End the party' : 'Leave'}
              </button>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

function PartyResults({ party, s, settings, onBack, onStartSong }: PartyProps & { me: Member }) {
  const hints = useHints(settings);
  const host = party.host === s.account!.id;
  const results = party.results.find((r) => r.songIndex === party.songIndex);
  // A Showdown is over at the end of the set, or once one player is left.
  const decided = !!party.showdown && party.members.filter((m) => !m.eliminated).length <= 1;
  const last = party.songIndex + 1 >= party.set.length || decided;
  const song = party.set[party.songIndex];
  const next = () => onStartSong(party.songIndex + 1);
  const lobby = () => online.backToLobby();

  useActions([
    backAction(onBack),
    ...(host && !last
      ? [{ id: 'party-next', label: 'Next song', icon: SkipForward, ...keysOf('party.next'), primary: true, run: next }]
      : []),
    ...(host ? [{ id: 'party-lobby', label: 'Back to the lobby', icon: Undo2, ...keysOf('party.lobby'), run: lobby }] : []),
    ...leaveAction(host),
  ]);

  return (
    <div className="lobby-body party-lobby">
      <div className="party-main">
        <h2 className="label">
          Song {party.songIndex + 1} of {party.set.length}: {song?.title}
        </h2>
        {results && <ResultTable lines={results.lines} me={s.account!.id} />}
        {party.showdown && (
          <>
            <h2 className="label">The Showdown</h2>
            <ShowdownStandings party={party} me={s.account!.id} />
          </>
        )}
        {!party.showdown && last && party.results.length > 1 && (
          <>
            <h2 className="label">The set</h2>
            <Standings party={party} me={s.account!.id} />
          </>
        )}
      </div>
      <section className="ready-panel">
        {host ? (
          <>
            {!last && (
              <button type="button" className="btn primary wide" data-action="party-next" data-autofocus onClick={next}>
                <Hint {...keysOf('party.next')} {...hints} />
                <SkipForward strokeWidth={ICON_STROKE} aria-hidden />
                Next song: {party.set[party.songIndex + 1]?.title}
              </button>
            )}
            <button type="button" className={`btn wide ${last ? 'primary' : ''}`} data-action="party-lobby" onClick={lobby}>
              <Hint {...keysOf('party.lobby')} {...hints} />
              <Undo2 strokeWidth={ICON_STROKE} aria-hidden />
              Back to the lobby
            </button>
          </>
        ) : (
          <p className="hint">{last ? 'That was the set. The host picks what comes next.' : 'The host starts the next song.'}</p>
        )}
        <LeaveButton host={host} hints={hints} />
      </section>
    </div>
  );
}

function ResultTable({ lines, me }: { lines: ResultLine[]; me: string }) {
  return (
    <ol className="set-cards party-results">
      {lines.map((l, i) => (
        <li
          key={l.id}
          className={`set-card party-result ${l.id === me ? 'me' : ''} ${l.result ? '' : 'skipped'}`}
          style={{ ['--i' as string]: i }}
        >
          <span className="slot-num">{l.result ? i + 1 : '–'}</span>
          <span className="song-text">
            <span className="song-title">
              {l.name}
              {l.eliminated && <span className="dim"> · out</span>}
            </span>
            <span className="song-artist">
              {l.result
                ? `${Math.round(l.result.accuracy * 100)}% · best streak ${l.result.bestStreak}${l.result.fullCombo ? ' · full combo' : ''}`
                : l.missing === 'sat-out'
                  ? 'Sat this one out'
                  : 'Left the song'}
            </span>
          </span>
          <span className="set-best">
            {l.result && (
              <>
                <Stars n={l.result.stars} />
                <span className="num">{l.result.score.toLocaleString()}</span>
              </>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** The whole set: every player's songs added up, the winner first. */
function Standings({ party, me }: { party: PartyState; me: string }) {
  const totals = new Map<string, { name: string; score: number; songs: number }>();
  for (const r of party.results as SongResults[])
    for (const l of r.lines) {
      const t = totals.get(l.id) ?? { name: l.name, score: 0, songs: 0 };
      if (l.result) {
        t.score += l.result.score;
        t.songs++;
      }
      totals.set(l.id, t);
    }
  const rows = [...totals.entries()].sort((a, b) => b[1].score - a[1].score);
  return (
    <ol className="set-cards party-results">
      {rows.map(([id, t], i) => (
        <li key={id} className={`set-card party-result ${id === me ? 'me' : ''}`} style={{ ['--i' as string]: i }}>
          <span className="slot-num">{i === 0 ? <Crown strokeWidth={ICON_STROKE} aria-label="Winner" /> : i + 1}</span>
          <span className="song-text">
            <span className="song-title">{t.name}</span>
            <span className="song-artist">
              {t.songs} of {party.results.length} songs
            </span>
          </span>
          <span className="set-best">
            <span className="num">{t.score.toLocaleString()}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A Showdown so far: the players still in first (the winner, once one is left), then those out,
 * the latest out first. Each with the share of their last song.
 */
function ShowdownStandings({ party, me }: { party: PartyState; me: string }) {
  const outAt = new Map<string, number>();
  const lastShare = new Map<string, number>();
  for (const r of [...party.results].sort((a, b) => a.songIndex - b.songIndex))
    for (const l of r.lines) {
      if (l.eliminated) outAt.set(l.id, r.songIndex);
      if (l.share !== undefined) lastShare.set(l.id, l.share);
    }
  const rows = [...party.members].sort(
    (a, b) => (outAt.get(b.id) ?? Infinity) - (outAt.get(a.id) ?? Infinity) || (lastShare.get(b.id) ?? 0) - (lastShare.get(a.id) ?? 0),
  );
  const left = party.members.filter((m) => !m.eliminated).length;
  return (
    <ol className="set-cards party-results">
      {rows.map((m, i) => {
        const out = outAt.get(m.id);
        return (
          <li key={m.id} className={`set-card party-result ${m.id === me ? 'me' : ''}`} style={{ ['--i' as string]: i }}>
            <span className="slot-num">{i === 0 && left === 1 ? <Crown strokeWidth={ICON_STROKE} aria-label="Winner" /> : i + 1}</span>
            <span className="song-text">
              <span className="song-title">{m.name}</span>
              <span className="song-artist">
                {out === undefined ? (left === 1 ? 'Won the Showdown' : 'Still in') : `Out after song ${out + 1}`}
              </span>
            </span>
            <span className="set-best">{lastShare.has(m.id) && <span className="num">{percent(lastShare.get(m.id)!)}</span>}</span>
          </li>
        );
      })}
    </ol>
  );
}
