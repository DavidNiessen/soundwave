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
  Crown,
  Download,
  Gavel,
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
  Megaphone,
  Music,
  PartyPopper,
  RefreshCw,
  Shirt,
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
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DIFFICULTIES, PARTS, type Difficulty, type Part } from '../chart/types';
import { isCalibrated, type Settings } from '../game/settings';
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
import { HoldButton } from './HoldButton';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Pips, Stars } from './icons';
import { AdminPanel, download, InvitePanel } from './ServerAdmin';
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
  /** Opens the server's leaderboards. */
  onBoards(): void;
  /** Opens the server's shared songs. */
  onSongs(): void;
  /** Opens the player's look on the stage. */
  onAvatar(): void;
  /** The host picks the party's songs in their library (their setlist is the party's set). */
  onPickSongs(): void;
  /** Changes settings (the audio offset, calibrated from the lobby). */
  onSettings(patch: Partial<Settings>): void;
}

const useOnline = () => useSyncExternalStore(online.subscribe, online.snapshot);
type Hints = ReturnType<typeof useHints>;

/** Each mode as the room offers it: what it is in a sentence, and who it is for. */
const MODES: Record<PartyMode, { label: string; icon: LucideIcon; cap: string; who: string; binding: string }> = {
  versus: {
    label: 'Versus',
    icon: Trophy,
    cap: 'Everyone plays the set on the part they like. The best score takes each song, and the set.',
    who: `2 to ${PARTY_MAX} players`,
    binding: 'party.versus',
  },
  showdown: {
    label: 'Showdown',
    icon: Swords,
    cap: 'The lowest go out after each song, and your overdrive strikes the player just above you.',
    who: 'Best with 3 or more',
    binding: 'party.showdown',
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
  } else if (!party) body = <NoParty {...props} s={s} />;
  else {
    title = party.mode ? MODES[party.mode].label : 'Your party';
    const n = party.members.length;
    sub = `Party ${party.code} · ${n} ${n === 1 ? 'player' : 'players'}${s.info ? ` · ${s.info.name}` : ''}`;
    body = <InParty {...props} s={s} party={party} />;
  }

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
                <span className="dim">{mode === 'invite' ? 'Your invite link or code' : 'An invite link or code (if you have one)'}</span>
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

function NoParty({ s, settings, setlist, onBack, onBoards, onSongs, onAvatar }: Props & { s: OnlineState }) {
  const hints = useHints(settings);
  const [admin, setAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mod = s.account!.role !== 'player';
  const [code, setCode] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);
  const saveData = async () => {
    try {
      const data = await online.exportData();
      download(`soundwave-${s.info?.name ?? 'server'}-my-data.zip`.replace(/[^\w.-]+/g, '-'), data);
    } catch (e) {
      online.report((e as Error).message);
    }
  };
  const join = () => code.trim() && online.joinParty(code);

  useActions([
    backAction(onBack),
    {
      id: 'party-create',
      label: 'Start a party',
      icon: PartyPopper,
      ...keysOf('party.create'),
      bar: false,
      primary: true,
      run: () => online.createParty(),
    },
    {
      id: 'party-join',
      label: 'Join a party',
      icon: UserPlus,
      ...keysOf('party.join'),
      bar: false,
      run: () => (code.trim() ? join() : codeInput.current?.focus()),
    },
    { id: 'party-sign-out', label: 'Sign out', icon: LogOut, ...keysOf('party.signOut'), bar: false, run: () => online.signOut() },
    { id: 'party-export', label: 'Save my data', icon: Download, ...keysOf('party.export'), bar: false, run: () => void saveData() },
    { id: 'party-boards', label: 'Leaderboards', icon: Trophy, ...keysOf('party.boards'), bar: false, run: onBoards },
    { id: 'party-songs', label: 'Shared songs', icon: Music, ...keysOf('party.songs'), bar: false, run: onSongs },
    { id: 'party-avatar', label: 'Your look', icon: Shirt, ...keysOf('party.avatar'), bar: false, run: onAvatar },
    ...(mod
      ? [{ id: 'party-admin', label: 'Run the server', icon: Gavel, ...keysOf('party.admin'), bar: false, run: () => setAdmin((a) => !a) }]
      : []),
  ]);

  const more: [string, string, LucideIcon, string, string, () => void][] = [
    [
      'party-boards',
      'party.boards',
      Trophy,
      'Leaderboards',
      'The best runs of every song on this server, and the week’s challenge.',
      onBoards,
    ],
    ['party-songs', 'party.songs', Music, 'Shared songs', 'Songs the players here share, to add to your library.', onSongs],
    ['party-avatar', 'party.avatar', Shirt, 'Your look', 'Your colours on the band member at your part, for everyone to see.', onAvatar],
  ];

  return (
    <div className="party-home">
      <div className="tiles party-tiles" data-nav-group="tiles">
        <button type="button" className="tile hero" data-action="party-create" data-autofocus onClick={() => online.createParty()}>
          <span className="mosaic blank" aria-hidden>
            <PartyPopper strokeWidth={ICON_STROKE} />
          </span>
          <span className="tile-text">
            <span className="tile-title">
              Start a party
              <Hint {...keysOf('party.create')} {...hints} />
            </span>
            <span className="tile-cap">Friends join with its code. Then you pick what to play together: Versus or Showdown.</span>
            <span className="tile-meta">Up to {PARTY_MAX} players</span>
            <span className="hero-songs">
              {PARTY_MODES.map((m, i) => (
                <span key={m} className="hero-song">
                  <span className="hero-num">{i + 1}</span>
                  <span className="hero-name">{MODES[m].label}</span>
                  <span className="hero-by">{MODES[m].who}</span>
                </span>
              ))}
            </span>
          </span>
        </button>
        <div className="tile-stack">
          <form
            className="tile party-join"
            style={{ ['--i' as string]: 1 }}
            onSubmit={(e) => {
              e.preventDefault();
              join();
            }}
          >
            <span className="tile-text">
              <span className="tile-title">
                Join a party
                <Hint {...keysOf('party.join')} {...hints} />
              </span>
              <span className="party-join-row">
                <input
                  ref={codeInput}
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="KITE-42"
                  aria-label="The party’s code, from its host"
                  maxLength={12}
                  spellCheck={false}
                  autoCapitalize="characters"
                />
                <button type="submit" className="btn primary" data-action="party-join" disabled={!code.trim()}>
                  <UserPlus strokeWidth={ICON_STROKE} aria-hidden />
                  Join
                </button>
              </span>
            </span>
          </form>
          {more.map(([id, binding, Icon, label, cap, run], i) => (
            <button key={id} type="button" className="tile small" data-action={id} style={{ ['--i' as string]: i + 2 }} onClick={run}>
              <span className="tile-icon" aria-hidden>
                <Icon strokeWidth={ICON_STROKE} />
              </span>
              <span className="tile-text">
                <span className="tile-title">
                  {label}
                  <Hint {...keysOf(binding)} {...hints} />
                </span>
                <span className="tile-cap">{cap}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      <section className="party-account" aria-label="Your account">
        <span className="online-dot on" aria-hidden />
        <span className="song-text">
          <span className="song-title">
            {s.account!.name}
            {mod && <span className="dim"> · {s.account!.role}</span>}
          </span>
          <span className="song-artist">Signed in to {s.info?.name ?? s.server}</span>
        </span>
        <span className="party-row">
          <button type="button" className="btn small" data-action="party-export" onClick={() => void saveData()}>
            <Hint kbd={keysOf('party.export').kbd} {...hints} />
            <Download strokeWidth={ICON_STROKE} aria-hidden />
            Save my data
          </button>
          {mod && (
            <button type="button" className="btn small" data-action="party-admin" onClick={() => setAdmin((a) => !a)}>
              <Hint kbd={keysOf('party.admin').kbd} {...hints} />
              <Gavel strokeWidth={ICON_STROKE} aria-hidden />
              {admin ? 'Hide the server tools' : 'Run the server'}
            </button>
          )}
          <button type="button" className="btn small" data-action="party-sign-out" data-sfx="back" onClick={() => online.signOut()}>
            <Hint kbd={keysOf('party.signOut').kbd} {...hints} />
            <LogOut strokeWidth={ICON_STROKE} aria-hidden />
            Sign out
          </button>
          <button type="button" className="btn small quiet" data-sfx="back" onClick={() => online.forget()}>
            Forget this server
          </button>
          {s.account!.role !== 'owner' &&
            (deleting ? (
              <button
                type="button"
                className="btn small danger"
                onClick={() => void online.deleteAccount().catch((e) => online.report((e as Error).message))}
              >
                Delete it, with all my scores
              </button>
            ) : (
              <button type="button" className="btn small quiet" onClick={() => setDeleting(true)}>
                Delete my account
              </button>
            ))}
        </span>
      </section>
      {(s.info?.mode === 'invite' || mod) && <InvitePanel mod={mod} />}
      {mod && admin && <AdminPanel owner={s.account!.role === 'owner'} setlist={setlist} />}
    </div>
  );
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

  if (!me) return null;
  if (party.phase === 'results') return <PartyResults {...props} me={me} />;
  if (!party.mode) return <PartyRoom {...props} me={me} />;
  return <ModeLobby {...props} me={me} have={have} />;
}

/** The party's code, to invite friends with, and the switch that keeps it off Discord. */
function PartyCode({ party, host, settings, hints }: { party: PartyState; host: boolean; settings: Settings; hints: Hints }) {
  const toggle = () => online.setPrivate(!party.private);
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
    </section>
  );
}

/** The players, each with their part, difficulty and ready tick; the host can remove one. */
function Players({ party, me, host, showReady }: { party: PartyState; me: Member; host: boolean; showReady: boolean }) {
  const ready = party.members.filter((m) => m.ready).length;
  return (
    <section className="party-players" aria-label="Players">
      <h2 className="label">
        <Users strokeWidth={ICON_STROKE} aria-hidden /> Players · {party.members.length}
        {showReady && <span className="label-note">{ready === party.members.length ? 'Everyone is ready' : `${ready} ready`}</span>}
      </h2>
      <ul className="party-members">
        {party.members.map((m, i) => (
          <MemberLine
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
      </ul>
    </section>
  );
}

function MemberLine({
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
  /** The host removes this player from the party (absent for the host's own line, and for everyone else). */
  onRemove?: () => void;
}) {
  const Icon = PART_ICON[m.part];
  const missing = setSize - m.have.length;
  const notes = [
    !m.connected ? 'Reconnecting…' : '',
    missing > 0 && setSize > 0 ? `Missing ${missing} ${missing === 1 ? 'song' : 'songs'}` : '',
    m.calibrated ? '' : 'Not calibrated',
  ].filter(Boolean);
  return (
    <li className={`party-member ${me ? 'me' : ''} ${m.connected ? '' : 'gone'}`} style={{ ['--i' as string]: i }}>
      {/* Their look's colour, where they made one: the band member at their part wears it on stage. */}
      <span className="party-swatch" style={m.avatar ? { background: m.avatar.top } : undefined} aria-hidden>
        {m.name.slice(0, 1).toUpperCase()}
      </span>
      <span className="song-text">
        <span className="song-title party-name">
          {m.name}
          {host && <Crown strokeWidth={ICON_STROKE} aria-label="Host" />}
          {me && <span className="dim"> · you</span>}
        </span>
        <span className="song-artist party-pick">
          <Icon strokeWidth={ICON_STROKE} aria-hidden />
          {PART_LABEL[m.part]} · {DIFFICULTY_LABEL[m.difficulty]}
          {notes.length > 0 && <span className="dim"> · {notes.join(' · ')}</span>}
        </span>
      </span>
      {showReady && (
        <span className={`party-tick ${m.ready ? 'on' : ''}`} aria-label={m.ready ? 'Ready' : 'Not ready'}>
          {m.ready && <Check strokeWidth={ICON_STROKE} aria-hidden />}
        </span>
      )}
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

function PartyRoom({ party, s, settings, onBack, me }: PartyProps & { me: Member }) {
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
        <PartyCode party={party} host={host} settings={settings} hints={hints} />
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
    <div className="lobby-body party-lobby">
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
          <ShowdownOptionsPanel
            party={party}
            host={host}
            me={me}
            settings={settings}
            hints={hints}
            on={{ toggleHits, toggleOnePart, toggleRotation }}
          />
        )}
        <Players party={party} me={me} host={host} showReady />
      </div>

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
            Scores are compared here, and your audio offset was never calibrated on this output.
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
                        ? 'Hold Enter to start'
                        : 'Hold to start'
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
        <div className="party-row party-foot">
          {host && (
            <button type="button" className="btn small" data-action="party-change-mode" disabled={watching} onClick={changeMode}>
              <Hint {...keysOf('party.changeMode')} {...hints} />
              <Undo2 strokeWidth={ICON_STROKE} aria-hidden />
              Other mode
            </button>
          )}
          <span className="party-code-chip" title="The party’s code">
            {party.code}
          </span>
        </div>
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
  settings,
  hints,
  on,
}: {
  party: PartyState;
  host: boolean;
  me: Member;
  settings: Settings;
  hints: Hints;
  on: { toggleHits(): void; toggleOnePart(): void; toggleRotation(): void };
}) {
  const sd = party.showdown!;
  const left = party.members.filter((m) => !m.eliminated).length;
  const onePart = sd.part ?? me.part;
  const rows: [string, string, string, [string, boolean][], () => void][] = [
    [
      'party-hits',
      'party.hits',
      'Hits',
      [
        ['On', sd.hits],
        ['Off', !sd.hits],
      ],
      on.toggleHits,
    ],
    [
      'party-one-part',
      'party.onePart',
      'Parts',
      [
        ['Any part', !sd.part],
        [`${PART_LABEL[onePart]} only`, !!sd.part],
      ],
      on.toggleOnePart,
    ],
    [
      'party-rotation',
      'party.rotation',
      'Songs',
      [
        ['The host’s', !sd.rotation],
        ['Server rotation', sd.rotation],
      ],
      on.toggleRotation,
    ],
  ];
  return (
    <section className="ready-panel showdown-panel" aria-label="Showdown options">
      <h2 className="label">
        <Swords strokeWidth={ICON_STROKE} aria-hidden /> Showdown
        {party.songIndex >= 0 && (
          <span className="label-note">
            {left} of {party.members.length} still in
          </span>
        )}
      </h2>
      <p className="hint">
        Scores count as a share of each chart’s best, and the lowest go out after each song.
        {sd.hits &&
          ` Your overdrive button strikes the player just above you; their hits reach you as ${settings.showdownHits === 'drain' ? 'Drain (calm)' : 'Fog'} (Settings → Online).`}
      </p>
      <div className="option-rows">
        {rows.map(([id, binding, label, choices, run]) => (
          <div key={id} className="option-row">
            <span className="option-label">
              {label}
              {host && <Hint {...keysOf(binding)} {...hints} />}
            </span>
            <div className="choice-pair" role="radiogroup" aria-label={label}>
              {choices.map(([text, chosen]) => (
                <button
                  key={text}
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  className={`choice ${chosen ? 'on' : ''}`}
                  data-action={chosen ? undefined : id}
                  disabled={!host}
                  onClick={() => !chosen && run()}
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
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
  const all = [...(board?.lines ?? [])]
    .filter((l) => !l.out || l.score > 0)
    .sort((a, b) => (showdown ? (b.share ?? 0) - (a.share ?? 0) : b.score - a.score));
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
          showdown={showdown}
          target={!!mine?.aim && mine.aim === l.id}
          threat={l.aim === me}
        />
      ))}
      {showdown && <li className="party-board-left dim">{all.filter((l) => !l.out).length} playing</li>}
    </ol>
  );
}

function BoardRow({
  l,
  rank,
  name,
  me,
  showdown,
  target,
  threat,
}: {
  l: BoardLine;
  rank: number;
  name: string;
  me: boolean;
  showdown: boolean;
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
      <span className="num">{showdown ? percent(l.share ?? 0) : l.score.toLocaleString()}</span>
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
                <span className="num">{l.share !== undefined ? percent(l.share) : l.result.score.toLocaleString()}</span>
              </>
            )}
            {!l.result && l.share !== undefined && <span className="num">{percent(l.share)}</span>}
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
