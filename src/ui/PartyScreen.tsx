/**
 * Playing together on a Soundwave server (docs/specs/online-play.md): connecting and signing in,
 * starting or joining a party, its lobby (the shared set, each player's part, difficulty and
 * ready tick), the board while a song plays without you, and the shared results after each song.
 *
 * The connection itself lives in src/net/client.ts; starting a song needs the host's charts,
 * which App makes (onStartSong).
 */
import {
  ArrowLeft,
  Check,
  Crosshair,
  Crown,
  Download,
  Gavel,
  Trophy,
  Music,
  Gauge,
  ListMusic,
  LogIn,
  LogOut,
  Megaphone,
  PartyPopper,
  Shirt,
  SkipForward,
  Swords,
  Undo2,
  UserPlus,
  Users,
  WifiOff,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DIFFICULTIES, PARTS, type Difficulty, type Part } from '../chart/types';
import { isCalibrated, type Settings } from '../game/settings';
import { Calibration } from './Calibration';
import { formatTime, type Pick } from '../game/setlist';
import { keysOf } from '../input/bindings';
import { PadGlyph } from '../input/glyphs';
import { confirmInput } from '../input/pads';
import { online, parseInvite, type OnlineState } from '../net/client';
import type { BoardLine, Member, PartyState, ResultLine, SetSong, ShowdownOptions, SongResults } from '../net/protocol';
import type { SongMeta } from '../storage/db';
import { Hint, useActions, useHints, type Action } from './actions';
import { Cover } from './Cover';
import { AdminPanel, download, InvitePanel } from './ServerAdmin';
import { HoldButton } from './HoldButton';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Pips, Stars } from './icons';

interface Props {
  /** The player's library, by song id. */
  library: Map<string, SongMeta>;
  /** Songs the player can play (analysed, with notes): the host can only start these. */
  playable: (id: string) => boolean;
  /** The player's own setlist, which the host can make the party's set. */
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
  /** Gets one of the party's songs this player lacks (from the server, or asked of the host). */
  onGetSong(id: string): void;
  /** Changes settings (the audio offset, calibrated from the lobby). */
  onSettings(patch: Partial<Settings>): void;
}

const useOnline = () => useSyncExternalStore(online.subscribe, online.snapshot);

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

  let body: React.ReactNode;
  if (s.status === 'off' || s.status === 'signed-out' || !s.account) {
    body =
      s.status === 'connecting' || (s.status === 'reconnecting' && !s.account) ? (
        <Waiting s={s} onBack={onBack} />
      ) : (
        <Connect s={s} settings={settings} onBack={onBack} />
      );
  } else if (!s.party)
    body = (
      <NoParty
        s={s}
        settings={settings}
        setlist={props.setlist}
        onBack={onBack}
        onBoards={props.onBoards}
        onSongs={props.onSongs}
        onAvatar={props.onAvatar}
      />
    );
  else if (s.party.phase === 'results')
    body = <PartyResults party={s.party} s={s} settings={settings} onBack={onBack} onStartSong={props.onStartSong} />;
  else body = <Lobby {...props} s={s} party={s.party} />;

  return (
    <div className="page party">
      <header className="page-head">
        <h1 className="page-title">Play together</h1>
        <p className="head-count">
          {s.info ? s.info.name : 'On a Soundwave server'}
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
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const info = s.info;

  const run = async (what: () => Promise<unknown>) => {
    setBusy(true);
    setProblem(null);
    try {
      await what();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // The server is asked what it is once it is known (a stored address, or an invite link opened).
  useEffect(() => {
    if (s.server && !info) void run(() => online.choose(s.server!));
  }, [s.server, info]);
  // An invite link opened elsewhere (a click, the web game's address) lands here ready to sign up.
  useEffect(() => {
    if (!s.invite) return;
    setHow('up');
    if (s.server) setAddress(s.server.replace(/^https?:\/\//, ''));
  }, [s.invite, s.server]);

  /** The server field takes an address or a whole invite link. */
  const connect = () =>
    run(async () => {
      const invite = parseInvite(address);
      if (!invite) return void (await online.choose(address));
      await online.useInvite(invite);
      setAddress(invite.server.replace(/^https?:\/\//, ''));
      setHow('up');
    });

  const mode = info?.mode;
  /** A code typed or pasted (a whole link works too), else the invite a link brought. */
  const invite = (code.trim() && (parseInvite(code)?.invite ?? code.trim())) || s.invite || undefined;
  const submit = () =>
    run(() =>
      how === 'in'
        ? online.signIn(name, password)
        : online.signUp({ name, password, ...(invite ? { invite } : mode === 'password' ? { serverPassword } : {}) }),
    );

  return (
    <div className="party-connect">
      <form
        className="ready-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void connect();
        }}
      >
        <h2 className="label">Server</h2>
        <label className="meta-field">
          <span className="dim">Its address, or the invite link you were sent</span>
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="play.example.com"
            spellCheck={false}
            autoComplete="url"
            inputMode="url"
            data-autofocus
          />
        </label>
        <button type="submit" className="btn primary" disabled={busy || !address.trim()}>
          Connect
        </button>
        {info && (
          <p className="hint">
            <strong>{info.name}</strong>
            {info.description && ` · ${info.description}`} · {info.online} online ·{' '}
            {
              {
                public: 'anyone can make an account',
                password: 'making an account needs the server’s password or an invite',
                invite: 'making an account needs an invite',
              }[info.mode]
            }
          </p>
        )}
      </form>

      {info && (
        <form
          className="ready-panel"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="choice-pair" role="radiogroup" aria-label="Sign in or make an account">
            <button
              type="button"
              role="radio"
              aria-checked={how === 'in'}
              className={`choice ${how === 'in' ? 'on' : ''}`}
              onClick={() => setHow('in')}
            >
              Sign in
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={how === 'up'}
              className={`choice ${how === 'up' ? 'on' : ''}`}
              onClick={() => setHow('up')}
            >
              Make an account
            </button>
          </div>
          <label className="meta-field">
            <span className="dim">Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} autoComplete="username" spellCheck={false} />
          </label>
          <label className="meta-field">
            <span className="dim">Password{how === 'up' && ', at least 8 characters'}</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={200}
              autoComplete={how === 'up' ? 'new-password' : 'current-password'}
            />
          </label>
          {how === 'up' && s.invite && !code && <p className="hint">Your invite lets you in.</p>}
          {how === 'up' && mode === 'password' && !invite && (
            <label className="meta-field">
              <span className="dim">The server’s password</span>
              <input type="password" value={serverPassword} onChange={(e) => setServerPassword(e.target.value)} />
            </label>
          )}
          {how === 'up' && !s.invite && (
            <label className="meta-field">
              <span className="dim">
                {mode === 'invite' ? 'Your invite link or code' : 'An invite link or code, if you have one'} (the server’s owner uses their
                set-up code here)
              </span>
              <input value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
            </label>
          )}
          <button type="submit" className="btn primary wide" disabled={busy || !name.trim() || !password}>
            <LogIn strokeWidth={ICON_STROKE} aria-hidden />
            {how === 'in' ? 'Sign in' : 'Make the account'}
          </button>
        </form>
      )}
      {problem && (
        <p className="party-error" role="alert">
          {problem}
        </p>
      )}
      <p className="hint party-note">
        Nothing is sent anywhere until you connect. A server stores your name, a hash of your password, and what its features need; you can
        save all of it, or delete your account, at any time.
      </p>
    </div>
  );
}

/* Signed in, in no party ------------------------------------------------------------------- */

function NoParty({
  s,
  settings,
  setlist,
  onBack,
  onBoards,
  onSongs,
  onAvatar,
}: {
  s: OnlineState;
  settings: Settings;
  setlist: SongMeta[];
  onBack(): void;
  onBoards(): void;
  onSongs(): void;
  onAvatar(): void;
}) {
  const hints = useHints(settings);
  const [admin, setAdmin] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const mod = s.account!.role !== 'player';
  const [code, setCode] = useState('');
  const codeInput = useRef<HTMLInputElement>(null);
  const saveData = async () => {
    try {
      const data = await online.exportData();
      download(`soundwave-${s.info?.name ?? 'server'}-my-data.json`.replace(/[^\w.-]+/g, '-'), JSON.stringify(data, null, 2));
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
    { id: 'party-boards', label: 'Leaderboards', icon: Trophy, ...keysOf('party.boards'), run: onBoards },
    { id: 'party-songs', label: 'Shared songs', icon: Music, ...keysOf('party.songs'), bar: false, run: onSongs },
    { id: 'party-avatar', label: 'Your look', icon: Shirt, ...keysOf('party.avatar'), bar: false, run: onAvatar },
    ...(mod
      ? [{ id: 'party-admin', label: 'Run the server', icon: Gavel, ...keysOf('party.admin'), bar: false, run: () => setAdmin((a) => !a) }]
      : []),
  ]);

  return (
    <div className="party-connect">
      <section className="ready-panel">
        <h2 className="label">Start a party</h2>
        <p className="hint">You pick the set and start each song. Up to 16 players.</p>
        <button type="button" className="btn primary wide" data-action="party-create" data-autofocus onClick={() => online.createParty()}>
          <Hint {...keysOf('party.create')} {...hints} />
          <PartyPopper strokeWidth={ICON_STROKE} aria-hidden />
          Start a party
        </button>
      </section>
      <form
        className="ready-panel"
        onSubmit={(e) => {
          e.preventDefault();
          join();
        }}
      >
        <h2 className="label">Join a party</h2>
        <label className="meta-field">
          <span className="dim">The party’s code, from its host</span>
          <input
            ref={codeInput}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="KITE-42"
            maxLength={12}
            spellCheck={false}
            autoCapitalize="characters"
          />
        </label>
        <button type="submit" className="btn wide" data-action="party-join" disabled={!code.trim()}>
          <Hint {...keysOf('party.join')} {...hints} />
          <UserPlus strokeWidth={ICON_STROKE} aria-hidden />
          Join
        </button>
      </form>
      <section className="ready-panel">
        <h2 className="label">Signed in</h2>
        <p className="hint">
          <strong>{s.account!.name}</strong> on {s.info?.name ?? s.server}
          {s.account!.role !== 'player' && ` · ${s.account!.role}`}
        </p>
        <div className="party-row">
          <button type="button" className="btn" data-action="party-export" onClick={() => void saveData()}>
            <Hint kbd={keysOf('party.export').kbd} {...hints} />
            <Download strokeWidth={ICON_STROKE} aria-hidden />
            Save my data
          </button>
          <button type="button" className="btn" data-action="party-sign-out" data-sfx="back" onClick={() => online.signOut()}>
            <Hint kbd={keysOf('party.signOut').kbd} {...hints} />
            <LogOut strokeWidth={ICON_STROKE} aria-hidden />
            Sign out
          </button>
          <button type="button" className="btn" data-sfx="back" onClick={() => online.forget()}>
            Forget this server
          </button>
          {s.account!.role !== 'owner' &&
            (deleting ? (
              <button
                type="button"
                className="btn danger"
                onClick={() => void online.deleteAccount().catch((e) => online.report((e as Error).message))}
              >
                Delete it, with all my scores
              </button>
            ) : (
              <button type="button" className="btn" onClick={() => setDeleting(true)}>
                Delete my account
              </button>
            ))}
        </div>
        <div className="party-row">
          <button type="button" className="btn" data-action="party-boards" onClick={onBoards}>
            <Hint {...keysOf('party.boards')} {...hints} />
            <Trophy strokeWidth={ICON_STROKE} aria-hidden />
            Leaderboards
          </button>
          <button type="button" className="btn" data-action="party-avatar" onClick={onAvatar}>
            <Hint {...keysOf('party.avatar')} {...hints} />
            <Shirt strokeWidth={ICON_STROKE} aria-hidden />
            Your look
          </button>
          <button type="button" className="btn" data-action="party-songs" onClick={onSongs}>
            <Hint {...keysOf('party.songs')} {...hints} />
            <Music strokeWidth={ICON_STROKE} aria-hidden />
            Shared songs
          </button>
          {mod && (
            <button type="button" className="btn" data-action="party-admin" onClick={() => setAdmin((a) => !a)}>
              <Hint kbd={keysOf('party.admin').kbd} {...hints} />
              <Gavel strokeWidth={ICON_STROKE} aria-hidden />
              {admin ? 'Hide the server tools' : 'Run the server'}
            </button>
          )}
        </div>
      </section>
      {(s.info?.mode === 'invite' || mod) && <InvitePanel mod={mod} />}
      {mod && admin && <AdminPanel owner={s.account!.role === 'owner'} setlist={setlist} />}
    </div>
  );
}

/* The party's lobby ---------------------------------------------------------------------- */

type LobbyProps = Props & { s: OnlineState; party: PartyState };

function Lobby(props: LobbyProps) {
  const me = props.party.members.find((m) => m.id === props.s.account!.id);
  return me ? <PartyLobby {...props} me={me} /> : null;
}

function PartyLobby({
  library,
  playable,
  setlist,
  pick,
  onPick,
  onStartSong,
  onGetSong,
  settings,
  onBack,
  onSettings,
  s,
  party,
  me,
}: LobbyProps & { me: Member }) {
  const hints = useHints(settings);
  const calibrated = isCalibrated(settings);
  const [calibrating, setCalibrating] = useState(false);
  const pad = hints.mode === 'pad';
  const host = party.host === s.account!.id;
  const has = (id: string) => library.has(id);
  const have = useMemo(() => party.set.filter((song) => library.has(song.id)).map((song) => song.id), [party.set, library]);
  const haveKey = have.join(',');
  const nextIndex = party.songIndex + 1 < party.set.length ? party.songIndex + 1 : 0;

  // On joining, the player's own part and difficulty go to the party; the songs they have follow the set.
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    const key = `${party.code}|${haveKey}|${calibrated}`;
    if (sentFor.current === key) return;
    const first = !sentFor.current?.startsWith(`${party.code}|`);
    sentFor.current = key;
    online.ready(first ? pick.part : me.part, first ? pick.difficulty : me.difficulty, first ? false : me.ready, have, calibrated);
  }, [party.code, haveKey, me, pick, have, calibrated]);

  const choose = (part: Part, difficulty: Difficulty) => {
    onPick({ part, difficulty });
    online.ready(part, difficulty, me.ready, have, calibrated);
  };
  const toggleReady = () => online.ready(me.part, me.difficulty, !me.ready, have, calibrated);
  const useSetlist = () => {
    if (!setlist.length) return;
    online.setSet(setlist.map((x): SetSong => ({ id: x.id, title: x.title, artist: x.artist, duration: x.duration })));
  };
  const locked = party.showdown?.part ?? null;
  const nextPart = () => !locked && choose(PARTS[(PARTS.indexOf(me.part) + 1) % PARTS.length], me.difficulty);
  // The host's Showdown switches: each changes one option and keeps the rest.
  const sd = party.showdown;
  const setShowdown = (o: Partial<ShowdownOptions> | null) =>
    online.setShowdown(o === null ? null : { hits: true, part: null, rotation: false, ...sd, ...o });
  const toggleShowdown = () => setShowdown(sd ? null : {});
  const toggleHits = () => sd && setShowdown({ hits: !sd.hits });
  const toggleOnePart = () => sd && setShowdown({ part: sd.part ? null : me.part });
  const toggleRotation = () => sd && setShowdown({ rotation: !sd.rotation });
  const watching = party.phase === 'playing';
  const nextDifficulty = () => choose(me.part, DIFFICULTIES[(DIFFICULTIES.indexOf(me.difficulty) + 1) % DIFFICULTIES.length]);
  const everyoneReady = party.members.every((m) => m.ready || !m.connected);
  const nextSong = party.set[nextIndex];
  const canStart = host && party.phase !== 'playing' && !!nextSong && playable(nextSong.id);

  useActions([
    backAction(onBack),
    { id: 'party-ready', label: me.ready ? 'Not ready' : 'Ready', icon: Check, ...keysOf('party.ready'), primary: !host, run: toggleReady },
    { id: 'party-part', label: 'Next part', icon: PART_ICON[me.part], ...keysOf('party.part'), bar: false, run: nextPart },
    { id: 'party-difficulty', label: 'Next difficulty', icon: Gauge, ...keysOf('party.difficulty'), bar: false, run: nextDifficulty },
    ...(host
      ? [
          { id: 'party-setlist', label: 'Play my setlist', icon: ListMusic, ...keysOf('party.setlist'), bar: false, run: useSetlist },
          { id: 'party-showdown', label: 'Showdown', icon: Swords, ...keysOf('party.showdown'), bar: false, run: toggleShowdown },
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
    { id: 'party-leave', label: 'Leave the party', icon: LogOut, ...keysOf('party.leave'), sfx: 'back', run: () => online.leaveParty() },
  ]);

  return (
    <div className="lobby-body party-lobby">
      <div className="party-main">
        <section className="party-code" aria-label="Party code">
          <span className="label">Party code</span>
          <span className="display party-code-text">{party.code}</span>
          <span className="dim">Friends on this server join with it.</span>
        </section>

        <h2 className="label party-set-head">
          The set
          {host && !sd?.rotation && (
            <button type="button" className="btn small" data-action="party-setlist" disabled={!setlist.length} onClick={useSetlist}>
              <Hint {...keysOf('party.setlist')} {...hints} />
              <ListMusic strokeWidth={ICON_STROKE} aria-hidden />
              {setlist.length ? 'Play my setlist' : 'Your setlist is empty'}
            </button>
          )}
        </h2>
        {party.set.length === 0 ? (
          <p className="hint">
            {host ? 'Pick songs into your setlist in the library, then play it here.' : 'The host is picking the set.'}
          </p>
        ) : (
          <ol className="set-cards" aria-label="The party’s set">
            {party.set.map((song, i) => {
              const mine = library.get(song.id);
              const done = party.results.some((r) => r.songIndex === i);
              return (
                <li key={song.id} className={`set-card ${has(song.id) ? '' : 'skipped'}`} style={{ ['--i' as string]: i }}>
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
                    <span className="set-notes">
                      {!has(song.id) ? (
                        <span className="warn">
                          Missing: you sit this song out unless you get it.{' '}
                          <button type="button" className="btn small" onClick={() => onGetSong(song.id)}>
                            Get it
                          </button>
                        </span>
                      ) : (
                        `${party.members.filter((m) => m.have.includes(song.id)).length} of ${party.members.length} have it`
                      )}
                    </span>
                  </span>
                  <span className="set-best">
                    {done ? <span className="dim">Played</span> : i === nextIndex ? <span>Next</span> : null}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        <ShowdownPanel
          party={party}
          host={host}
          me={me}
          settings={settings}
          on={{ toggleShowdown, toggleHits, toggleOnePart, toggleRotation }}
        />
      </div>

      <section className="ready-panel" data-nav-group="ready" aria-label="Players and your choices">
        <h2 className="label">
          <Users strokeWidth={ICON_STROKE} aria-hidden /> Players · {party.members.length}
        </h2>
        <ul className="party-members">
          {party.members.map((m) => (
            <MemberLine key={m.id} m={m} host={m.id === party.host} me={m.id === me.id} setSize={party.set.length} />
          ))}
        </ul>
        {!calibrated && (
          <p className="hint party-calibrate">
            Scores are compared here, so your audio offset matters: it was never calibrated on this output.
            <button type="button" className="btn small" onClick={() => setCalibrating(true)}>
              <Gauge strokeWidth={ICON_STROKE} aria-hidden />
              Calibrate now
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

        <h2 className="label">Your part</h2>
        <div className="pick-line">
          {pad && (
            <span className="pick-hint" aria-hidden>
              <PadGlyph input={keysOf('party.part').pad ?? 'b3'} style={hints.style} />
            </span>
          )}
          <div className="part-row" role="radiogroup" aria-label="Part">
            {PARTS.map((p) => {
              const Icon = PART_ICON[p];
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={me.part === p}
                  className={`choice part ${me.part === p ? 'on' : ''}`}
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
        <h2 className="label">Difficulty</h2>
        <div className="pick-line">
          {pad && (
            <span className="pick-hint" aria-hidden>
              <PadGlyph input={keysOf('party.difficulty').pad ?? 'b2'} style={hints.style} />
            </span>
          )}
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
                <span>{DIFFICULTY_LABEL[d]}</span>
              </button>
            ))}
          </div>
        </div>
        <p className="hint">
          {locked
            ? `This Showdown is played on ${PART_LABEL[locked].toLowerCase()} only.`
            : 'A song without your part is played on one it has.'}
        </p>

        <button type="button" className={`btn wide ${me.ready ? '' : 'primary'}`} data-action="party-ready" onClick={toggleReady}>
          <Hint {...keysOf('party.ready')} {...hints} />
          <Check strokeWidth={ICON_STROKE} aria-hidden />
          {me.ready ? 'Ready · press again if you are not' : 'I’m ready'}
        </button>

        {host ? (
          <HoldButton
            label={nextSong ? `Start song ${nextIndex + 1}: ${nextSong.title}` : 'Start'}
            hint={
              !nextSong
                ? 'Pick a set first.'
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
          <p className="hint">
            <Crown strokeWidth={ICON_STROKE} aria-hidden /> {party.members.find((m) => m.id === party.host)?.name ?? 'The host'} starts each
            song.
          </p>
        )}
        {watching && <PartyBoardPanel s={s} party={party} hints={hints} />}
        <button type="button" className="btn wide" data-action="party-leave" data-sfx="back" onClick={() => online.leaveParty()}>
          <Hint kbd={keysOf('party.leave').kbd} {...hints} />
          <LogOut strokeWidth={ICON_STROKE} aria-hidden />
          {host ? 'End the party' : 'Leave the party'}
        </button>
      </section>
    </div>
  );
}

/** The Showdown's switches for the host, or what they chose for everyone else. */
function ShowdownPanel({
  party,
  host,
  me,
  settings,
  on,
}: {
  party: PartyState;
  host: boolean;
  me: Member;
  settings: Settings;
  on: { toggleShowdown(): void; toggleHits(): void; toggleOnePart(): void; toggleRotation(): void };
}) {
  const hints = useHints(settings);
  const sd = party.showdown;
  const left = party.members.filter((m) => !m.eliminated).length;
  const part = sd?.part ? `${PART_LABEL[sd.part]} only` : 'Any part';
  const switchButton = (id: string, binding: string, label: string, run: () => void) => (
    <button type="button" className="btn small" data-action={id} onClick={run}>
      <Hint {...keysOf(binding)} {...hints} />
      {label}
    </button>
  );
  return (
    <section className="ready-panel showdown-panel" aria-label="Showdown">
      <h2 className="label">
        <Swords strokeWidth={ICON_STROKE} aria-hidden /> Showdown{sd ? ` · ${left} of ${party.members.length} in` : ''}
      </h2>
      <p className="hint">
        {sd
          ? 'Scores count as a share of each chart’s best, and the lowest players go out after each song.' +
            (sd.hits ? ' Your overdrive button strikes the player just above you.' : '')
          : 'A battle over the set: the lowest players go out after each song, and overdrive can strike the player above.'}
      </p>
      {host ? (
        <div className="party-row">
          {switchButton('party-showdown', 'party.showdown', sd ? 'Make it a plain party' : 'Make it a Showdown', on.toggleShowdown)}
          {sd && switchButton('party-hits', 'party.hits', sd.hits ? 'Hits: on' : 'Hits: off', on.toggleHits)}
          {sd &&
            switchButton(
              'party-one-part',
              'party.onePart',
              sd.part ? `Parts: ${PART_LABEL[sd.part].toLowerCase()} only` : 'Parts: any',
              on.toggleOnePart,
            )}
          {sd &&
            switchButton(
              'party-rotation',
              'party.rotation',
              sd.rotation ? 'Set: the server’s rotation' : 'Set: the host’s',
              on.toggleRotation,
            )}
        </div>
      ) : (
        sd && (
          <p className="dim">
            Hits {sd.hits ? 'on' : 'off'} · {part} · {sd.rotation ? 'the server’s rotation' : 'the host’s set'}
          </p>
        )
      )}
      {host && sd && !sd.part && <p className="dim">One part only plays everyone on your part, {PART_LABEL[me.part].toLowerCase()}.</p>}
      {sd?.hits && (
        <p className="dim">
          Hits reach you as {settings.showdownHits === 'drain' ? 'Drain (calm hits)' : 'Fog'}. Settings → Online changes it.
        </p>
      )}
    </section>
  );
}

function MemberLine({ m, host, me, setSize }: { m: Member; host: boolean; me: boolean; setSize: number }) {
  const Icon = PART_ICON[m.part];
  const missing = setSize - m.have.length;
  return (
    <li className={`party-member ${me ? 'me' : ''} ${m.connected ? '' : 'gone'}`}>
      <span className={`party-tick ${m.ready ? 'on' : ''}`} aria-label={m.ready ? 'Ready' : 'Not ready'}>
        {m.ready && <Check strokeWidth={ICON_STROKE} aria-hidden />}
      </span>
      <span className="party-name">
        {m.name}
        {host && <Crown strokeWidth={ICON_STROKE} aria-label="Host" />}
        {me && <span className="dim"> · you</span>}
      </span>
      <span className="party-pick">
        <Icon strokeWidth={ICON_STROKE} aria-hidden />
        {PART_LABEL[m.part]} · {DIFFICULTY_LABEL[m.difficulty]}
      </span>
      <span className="dim party-state">
        {[
          !m.connected ? 'Reconnecting…' : '',
          missing > 0 && setSize > 0 ? `Missing ${missing} ${missing === 1 ? 'song' : 'songs'}` : '',
          m.calibrated ? 'Calibrated' : 'Not calibrated',
        ]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </li>
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

function PartyResults({
  party,
  s,
  settings,
  onBack,
  onStartSong,
}: {
  party: PartyState;
  s: OnlineState;
  settings: Settings;
  onBack(): void;
  onStartSong(i: number): void;
}) {
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
    { id: 'party-leave', label: 'Leave the party', icon: LogOut, ...keysOf('party.leave'), sfx: 'back', run: () => online.leaveParty() },
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
        <button type="button" className="btn wide" data-action="party-leave" data-sfx="back" onClick={() => online.leaveParty()}>
          <Hint kbd={keysOf('party.leave').kbd} {...hints} />
          <LogOut strokeWidth={ICON_STROKE} aria-hidden />
          Leave the party
        </button>
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
