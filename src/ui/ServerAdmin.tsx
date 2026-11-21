/**
 * What the owner and moderators of a server do from the game (docs/specs/online-play.md, 3.2), on
 * the admin page: keep the server's library, remove and ban players, name moderators, reset a
 * forgotten password, make invites, set the Showdown rotation, read the log of every moderation
 * action and deal with reported songs. And, for everyone, invite links.
 */
import {
  ArrowLeft,
  Check,
  Copy,
  Flag,
  Gavel,
  KeyRound,
  Library,
  ListMusic,
  LogOut,
  Pencil,
  Plus,
  ScrollText,
  Search as SearchIcon,
  Shield,
  Swords,
  Trash2,
  UserPlus,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { Settings } from '../game/settings';
import { keysOf } from '../input/bindings';
import { online } from '../net/client';
import type { Invite, Role, SetSong, SharedSong, UserEntry } from '../net/protocol';
import { serverSongs } from '../net/serverSongs';
import type { SongMeta } from '../storage/db';
import { songFile } from '../storage/songFile';
import { Hint, useActions, useHints } from './actions';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';

/** Saves text as a file the player keeps (their data from the server). */
export function download(name: string, data: string | Blob, type = 'application/json') {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * An invite to this server: a link that opens the game (the server's own join page). A player on an
 * invite-only server makes single-use invites for a week; the owner and moderators choose how many
 * uses and how long, or no limit (a link to post for a whole community).
 */
export function InvitePanel({ mod }: { mod: boolean }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [uses, setUses] = useState('1');
  const [days, setDays] = useState('7');
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const make = () => {
    const n = uses.trim() ? Number(uses) : null;
    const d = days.trim() ? Number(days) : null;
    void online.makeInvite(mod ? n : 1, mod ? (d === null ? null : d * 24) : 24 * 7).then(
      (i) => (setInvite(i), setCopied(false)),
      (e) => setProblem((e as Error).message),
    );
  };
  const copy = () => void navigator.clipboard?.writeText(invite!.link).then(() => setCopied(true));
  return (
    <section className="ready-panel">
      <h2 className="label">
        <UserPlus strokeWidth={ICON_STROKE} aria-hidden /> Invite friends
      </h2>
      {mod && (
        <div className="party-row">
          <label className="meta-field">
            <span className="dim">Uses (empty: no limit)</span>
            <input value={uses} onChange={(e) => setUses(e.target.value.replace(/\D/g, ''))} inputMode="numeric" />
          </label>
          <label className="meta-field">
            <span className="dim">Days it works (empty: always)</span>
            <input value={days} onChange={(e) => setDays(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
          </label>
        </div>
      )}
      {invite && (
        <>
          <p className="hint">
            Send this link. It opens Soundwave on this server, ready to make an account
            {invite.uses === null ? '' : invite.uses === 1 ? ', once' : `, ${invite.uses} times`}
            {invite.expires === null ? '' : `, until ${new Date(invite.expires).toLocaleDateString()}`}.
          </p>
          <code className="party-invite">{invite.link}</code>
          <button type="button" className="btn small" onClick={copy}>
            <Copy strokeWidth={ICON_STROKE} aria-hidden />
            {copied ? 'Copied' : 'Copy the link'}
          </button>
        </>
      )}
      <button type="button" className="btn wide" data-action="party-invite" onClick={make}>
        <UserPlus strokeWidth={ICON_STROKE} aria-hidden />
        {invite ? 'Make another invite' : 'Make an invite link'}
      </button>
      {problem && <p className="party-error">{problem}</p>}
    </section>
  );
}

/** The admin's sections: each a tile on the admin page's bento, and a page of its own. */
type Section = 'library' | 'players' | 'invites' | 'rotation' | 'log' | 'reports';

const SECTIONS: { id: Section; binding: string; label: string; icon: LucideIcon }[] = [
  { id: 'library', binding: 'admin.library', label: 'Server library', icon: Library },
  { id: 'players', binding: 'admin.players', label: 'Players', icon: Users },
  { id: 'invites', binding: 'admin.invites', label: 'Invites', icon: UserPlus },
  { id: 'rotation', binding: 'admin.rotation', label: 'Showdown rotation', icon: Swords },
  { id: 'log', binding: 'admin.log', label: 'Moderation log', icon: ScrollText },
  { id: 'reports', binding: 'admin.reports', label: 'Reported songs', icon: Flag },
];

type LogEntry = Awaited<ReturnType<typeof online.auditLog>>[number];
type Report = Awaited<ReturnType<typeof online.songReports>>[number];

/**
 * The admin page, for the server's owner and moderators: a bento of what they look after (the
 * server's library, its players, invites, the Showdown rotation, the moderation log and the
 * reported songs), each opening a page of its own.
 */
export function AdminScreen({
  setlist,
  library,
  settings,
  onBack,
}: {
  setlist: SongMeta[];
  library: SongMeta[];
  settings: Settings;
  onBack(): void;
}) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const hints = useHints(settings);
  const [section, setSection] = useState<Section | null>(null);
  const owner = s.account?.role === 'owner';
  const mod = owner || s.account?.role === 'moderator';

  // What the bento shows on each tile, fetched as the page opens and again on coming back to it.
  const [songs, setSongs] = useState<SharedSong[] | null>(null);
  const [users, setUsers] = useState<UserEntry[] | null>(null);
  const [rotation, setRotation] = useState<SetSong[] | null>(null);
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [reports, setReports] = useState<Report[] | null>(null);
  const load = useCallback(() => {
    if (!mod) return;
    void online.songs('').then(setSongs, () => {});
    void online.users().then(setUsers, () => {});
    void online.showdownRotation().then(setRotation, () => {});
    void online.auditLog().then(setLog, () => {});
    void online.songReports().then(setReports, () => {});
  }, [mod]);
  useEffect(load, [load, section]);

  const back = () => (section ? setSection(null) : onBack());
  useActions([
    { id: 'back', label: section ? 'Admin' : 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: back },
    ...(section
      ? []
      : SECTIONS.map(({ id, binding, label, icon }) => ({
          id: `admin-${id}`,
          label,
          icon,
          ...keysOf(binding),
          bar: false,
          run: () => setSection(id),
        }))),
  ]);

  if (!mod)
    return (
      <div className="page admin-page">
        <header className="page-head">
          <h1 className="page-title">Admin</h1>
        </header>
        <p className="hint">Only the server’s admin and its moderators run the server.</p>
      </div>
    );

  const online_ = users?.filter((u) => u.online).length ?? 0;
  const banned = users?.filter((u) => u.bannedUntil !== null).length ?? 0;
  const cap: Record<Section, string> = {
    library: songs ? `${songs.length} ${songs.length === 1 ? 'song' : 'songs'} everyone here can play` : 'Loading…',
    players: users ? `${users.length} in all · ${online_} online${banned ? ` · ${banned} banned` : ''}` : 'Loading…',
    invites: 'Links that let people make an account here.',
    rotation: rotation ? (rotation.length ? `${rotation.length} songs a Showdown can play` : 'None yet') : 'Loading…',
    log: log ? (log[0] ? `Last: ${log[0].actor} · ${log[0].action} ${log[0].target}` : 'Nothing yet') : 'Loading…',
    reports: reports ? (reports.length ? `${reports.length} to look at` : 'None to look at') : 'Loading…',
  };
  const current = SECTIONS.find((x) => x.id === section);

  return (
    <div className="page admin-page">
      <header className="page-head">
        <h1 className="page-title">{current ? current.label : 'Admin'}</h1>
        <p className="head-count">
          {s.info?.name ?? 'Soundwave server'} · {owner ? 'Admin' : 'Moderator'}
        </p>
      </header>
      {!section && (
        <div className="admin-bento" data-nav-group="admin">
          {SECTIONS.map(({ id, binding, label, icon: Icon }, i) => (
            <button
              key={id}
              type="button"
              className={`tile admin-tile ${id} ${id === 'reports' && reports?.length ? 'alert' : ''}`}
              data-action={`admin-${id}`}
              data-autofocus={i === 0 ? '' : undefined}
              style={{ ['--i' as string]: i }}
              onClick={() => setSection(id)}
            >
              <span className="tile-icon" aria-hidden>
                <Icon strokeWidth={ICON_STROKE} />
              </span>
              <span className="tile-text">
                <span className="tile-title">
                  {label}
                  <Hint {...keysOf(binding)} {...hints} />
                </span>
                <span className="tile-cap">{cap[id]}</span>
                {id === 'library' && songs && songs.length > 0 && (
                  <span className="admin-tile-list">
                    {songs.slice(0, 4).map((x) => (
                      <span key={x.id} className="admin-tile-line">
                        {x.title}
                        <span className="dim"> · {x.artist}</span>
                      </span>
                    ))}
                  </span>
                )}
                {id === 'players' && users && (
                  <span className="admin-tile-list">
                    {users
                      .filter((u) => u.online)
                      .slice(0, 3)
                      .map((u) => (
                        <span key={u.name} className="admin-tile-line">
                          <span className="online-dot on" aria-hidden /> {u.name}
                        </span>
                      ))}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
      {section && (
        <section className="admin-section" data-nav-group="admin-section">
          {section === 'library' && <ServerLibrary library={library} list={songs ?? []} onChange={load} />}
          {section === 'players' && <Players users={users} owner={owner} me={s.account!.name} onChange={load} />}
          {section === 'invites' && <InvitePanel mod />}
          {section === 'rotation' && <Rotation rotation={rotation} setlist={setlist} onChange={setRotation} />}
          {section === 'log' && <ModLog log={log} />}
          {section === 'reports' && <ReportedSongs reports={reports} onChange={load} />}
        </section>
      )}
    </div>
  );
}

/** A search over a list, by name: the first thing on a long list's page. */
function Search({ value, onChange, label }: { value: string; onChange(v: string): void; label: string }) {
  return (
    <label className="admin-search">
      <SearchIcon strokeWidth={ICON_STROKE} aria-hidden />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        aria-label={label}
        spellCheck={false}
        data-autofocus
      />
    </label>
  );
}

const ROLE: Record<Role, string> = { owner: 'Admin', moderator: 'Moderator', player: 'Player' };
/** How long a ban lasts, in hours (null: for good). */
const BAN_LENGTHS: [number | null, string][] = [
  [1, 'An hour'],
  [24, 'A day'],
  [24 * 7, 'A week'],
  [null, 'For good'],
];

/**
 * The server's players: a list to search, and for the one picked, what the owner or a moderator
 * may do to them (remove, ban, lift a ban; the owner also names moderators and resets passwords).
 * What cannot be undone is asked first.
 */
function Players({ users, owner, me, onChange }: { users: UserEntry[] | null; owner: boolean; me: string; onChange(): void }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<number | null>(24);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState<null | { title: string; hint: string; yes: string; run(): void }>(null);
  const q = query.trim().toLowerCase();
  const shown = (users ?? []).filter((u) => !q || u.name.toLowerCase().includes(q));
  const user = users?.find((u) => u.name === picked);

  const act = (what: Parameters<typeof online.moderate>[0], extra: Record<string, unknown>, done: string) =>
    void online.moderate(what, { name: picked, reason, ...extra }).then(
      (r) => {
        setNote(r.password ? `${picked}’s new password: ${r.password}. Pass it on to them.` : done);
        setReason('');
        onChange();
      },
      (e) => setNote((e as Error).message),
    );
  // The owner is moderated by nobody, moderators only by the owner, and nobody by themselves.
  const reachable = (u: UserEntry) => u.name !== me && u.role !== 'owner' && (owner || u.role === 'player');

  return (
    <div className="admin-players">
      <div className="admin-list-side">
        <Search value={query} onChange={setQuery} label="Find a player" />
        <ol className="boards-lines admin-list">
          {users === null && <li className="dim">Loading…</li>}
          {users && !shown.length && <li className="dim">Nobody by that name.</li>}
          {shown.map((u) => (
            <li key={u.name}>
              <button
                type="button"
                className={`boards-line admin-user ${picked === u.name ? 'on' : ''}`}
                aria-pressed={picked === u.name}
                onClick={() => (setPicked(u.name), setNote(null))}
              >
                <span className={`online-dot ${u.online ? 'on' : ''}`} aria-label={u.online ? 'Online' : 'Offline'} />
                <span className="party-name">{u.name}</span>
                {u.role !== 'player' && <span className={`admin-role ${u.role}`}>{ROLE[u.role]}</span>}
                {u.bannedUntil !== null && <span className="admin-role banned">Banned</span>}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="admin-detail">
        {!user ? (
          <p className="hint">Pick a player to see what you can do.</p>
        ) : (
          <>
            <h2 className="display">{user.name}</h2>
            <p className="hint">
              {ROLE[user.role]} · {user.online ? 'online now' : 'offline'} · here since {new Date(user.created).toLocaleDateString()}
              {user.bannedUntil !== null &&
                ` · banned ${user.bannedUntil > 1e15 ? 'for good' : `until ${new Date(user.bannedUntil).toLocaleString()}`}${user.banReason ? `: ${user.banReason}` : ''}`}
            </p>
            {!reachable(user) ? (
              <p className="hint">
                {user.name === me
                  ? 'That is you.'
                  : user.role === 'owner'
                    ? 'Nobody moderates the server’s admin.'
                    : 'Only the server’s admin moderates moderators.'}
              </p>
            ) : (
              <>
                <label className="meta-field">
                  <span className="dim">Why (shown to them, and kept in the log)</span>
                  <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                </label>
                <div className="admin-actions">
                  <button
                    type="button"
                    className="btn"
                    onClick={() =>
                      setAsking({
                        title: `Remove ${user.name}?`,
                        hint: 'They are signed out now. They can sign in again; a ban keeps them out.',
                        yes: 'Remove',
                        run: () => act('kick', {}, `${user.name} was removed.`),
                      })
                    }
                  >
                    <LogOut strokeWidth={ICON_STROKE} aria-hidden />
                    Remove from the server
                  </button>
                  {user.bannedUntil === null ? (
                    <div className="admin-ban">
                      <div className="choice-pair" role="radiogroup" aria-label="How long">
                        {BAN_LENGTHS.map(([h, label]) => (
                          <button
                            key={label}
                            type="button"
                            role="radio"
                            aria-checked={hours === h}
                            className={`choice ${hours === h ? 'on' : ''}`}
                            onClick={() => setHours(h)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="btn danger"
                        onClick={() =>
                          setAsking({
                            title: `Ban ${user.name}?`,
                            hint: `${hours === null ? 'For good' : BAN_LENGTHS.find(([h]) => h === hours)![1].toLowerCase()}: they are signed out and cannot sign in until it is lifted.`,
                            yes: 'Ban',
                            run: () => act('ban', hours ? { hours } : {}, `${user.name} is banned.`),
                          })
                        }
                      >
                        <Gavel strokeWidth={ICON_STROKE} aria-hidden />
                        Ban
                      </button>
                    </div>
                  ) : (
                    <button type="button" className="btn" onClick={() => act('unban', {}, `${user.name} may come back.`)}>
                      <Check strokeWidth={ICON_STROKE} aria-hidden />
                      Lift the ban
                    </button>
                  )}
                  {owner && (
                    <>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          user.role === 'moderator'
                            ? act('role', { role: 'player' }, `${user.name} is a player again.`)
                            : act('role', { role: 'moderator' }, `${user.name} is a moderator.`)
                        }
                      >
                        <Shield strokeWidth={ICON_STROKE} aria-hidden />
                        {user.role === 'moderator' ? 'Make a player again' : 'Make a moderator'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          setAsking({
                            title: `Reset ${user.name}’s password?`,
                            hint: 'Their old password stops working and they are signed out. You get a new one to pass on.',
                            yes: 'Reset it',
                            run: () => act('reset-password', {}, ''),
                          })
                        }
                      >
                        <KeyRound strokeWidth={ICON_STROKE} aria-hidden />
                        Reset password
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            {note && <p className="hint admin-note">{note}</p>}
          </>
        )}
      </div>
      {asking && (
        <Dialog title={asking.title} variant="card" closeLabel="Go back" onClose={() => setAsking(null)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">{asking.title}</h2>
              <p className="hint">{asking.hint}</p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Go back
              </button>
              <button
                type="button"
                className="btn primary wide danger"
                onClick={() => {
                  asking.run();
                  close();
                }}
              >
                {asking.yes}
              </button>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

/** The Showdown rotation: the songs a Showdown plays when its host picks the server's set. */
function Rotation({ rotation, setlist, onChange }: { rotation: SetSong[] | null; setlist: SongMeta[]; onChange(r: SetSong[]): void }) {
  const [note, setNote] = useState<string | null>(null);
  const use = () =>
    void online.setShowdownRotation(setlist.map((x) => ({ id: x.id, title: x.title, artist: x.artist, duration: x.duration }))).then(
      (r) => (onChange(r), setNote(r.length ? 'The Showdown rotation is your setlist now.' : 'The Showdown rotation is empty now.')),
      (e) => setNote((e as Error).message),
    );
  return (
    <div className="admin-narrow">
      <p className="hint">A Showdown whose host picks the server’s set plays these songs, everyone on the same part.</p>
      <ol className="boards-lines admin-list">
        {rotation === null && <li className="dim">Loading…</li>}
        {rotation?.length === 0 && <li className="dim">None yet.</li>}
        {rotation?.map((x, i) => (
          <li key={x.id} className="boards-line">
            <span className="boards-rank">{i + 1}</span>
            <span className="party-name">
              {x.title}
              <span className="dim"> · {x.artist}</span>
            </span>
          </li>
        ))}
      </ol>
      <button type="button" className="btn" data-autofocus onClick={use}>
        <ListMusic strokeWidth={ICON_STROKE} aria-hidden />
        {setlist.length ? `Make my setlist the rotation (${setlist.length} songs)` : 'Clear the rotation'}
      </button>
      {note && <p className="hint">{note}</p>}
    </div>
  );
}

/** What the owner and moderators did, newest first, with a search. */
function ModLog({ log }: { log: LogEntry[] | null }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (log ?? []).filter((a) => !q || `${a.actor} ${a.action} ${a.target} ${a.reason}`.toLowerCase().includes(q));
  return (
    <div className="admin-narrow">
      <Search value={query} onChange={setQuery} label="Find a player or an action" />
      <ol className="boards-lines admin-list admin-log">
        {log === null && <li className="dim">Loading…</li>}
        {log && !shown.length && <li className="dim">Nothing{q ? ' like that' : ' yet'}.</li>}
        {shown.map((a, i) => (
          <li key={i} className="boards-line">
            <span className="dim">{new Date(a.at).toLocaleString()}</span>
            <span className="party-name">
              {a.actor}: {a.action} {a.target}
            </span>
            <span className="dim">{a.reason}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Songs players reported (a takedown, say), with removal from the server everywhere at once. */
function ReportedSongs({ reports, onChange }: { reports: Report[] | null; onChange(): void }) {
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className="admin-narrow">
      <ol className="boards-lines admin-list">
        {reports === null && <li className="dim">Loading…</li>}
        {reports?.length === 0 && <li className="dim">No song is reported.</li>}
        {reports?.map((r) => (
          <li key={r.id} className="boards-line">
            <span className="party-name">
              {r.title} · {r.artist}
              <span className="dim"> · shared by {r.uploader ?? 'a removed account'}</span>
            </span>
            <span className="dim">
              {r.by ?? 'Someone'}: {r.reason}
            </span>
            <button
              type="button"
              className="btn small danger"
              onClick={() =>
                void online.removeSong(r.songId, r.reason).then(
                  () => (setNote(`"${r.title}" was removed from the server.`), onChange()),
                  (e) => setNote((e as Error).message),
                )
              }
            >
              <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
              Remove
            </button>
          </li>
        ))}
      </ol>
      {note && <p className="hint">{note}</p>}
    </div>
  );
}

/**
 * The server's own library, which the owner and moderators keep: songs added from their library
 * (whatever players may share), renamed (every downloaded copy follows: the game checks each
 * song's hash), or removed everywhere at once.
 */
function ServerLibrary({ library, list, onChange }: { library: SongMeta[]; list: SharedSong[]; onChange(): void }) {
  const [query, setQuery] = useState('');
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string; artist: string } | null>(null);
  const [removing, setRemoving] = useState<SharedSong | null>(null);
  const onServer = new Set(list.map((x) => x.id));
  const addable = library.filter((x) => !onServer.has(x.id));
  const q = query.trim().toLowerCase();
  const shown = list.filter((x) => !q || `${x.title} ${x.artist} ${x.by ?? ''}`.toLowerCase().includes(q));
  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await what();
      setNote(done);
      onChange();
      void serverSongs.refresh();
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const add = (id: string) => {
    const song = library.find((x) => x.id === id);
    if (!song) return;
    void run(async () => online.shareSong(await songFile(song.id)), `"${song.title}" is in the server's library.`);
    setPick('');
  };
  return (
    <div className="admin-narrow">
      <p className="hint">Songs here show in the library of everyone on the server, to stream or download.</p>
      <div className="party-row">
        <select className="boards-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="A song from your library">
          <option value="">{addable.length ? 'Add a song from your library…' : 'Every song of yours is on the server'}</option>
          {addable.map((x) => (
            <option key={x.id} value={x.id}>
              {x.title}
              {x.artist ? ` · ${x.artist}` : ''}
            </option>
          ))}
        </select>
        <button type="button" className="btn small primary" disabled={!pick || busy} onClick={() => add(pick)}>
          <Plus strokeWidth={ICON_STROKE} aria-hidden />
          Add
        </button>
      </div>
      <Search value={query} onChange={setQuery} label="Find a song" />
      {note && <p className="hint">{note}</p>}
      <ol className="boards-lines admin-list">
        {list.length > 0 && !shown.length && <li className="dim">No song like that.</li>}
        {shown.map((x) =>
          editing?.id === x.id ? (
            <li key={x.id} className="boards-line admin-edit">
              <input
                value={editing.title}
                onChange={(e) => setEditing({ ...editing, title: e.target.value })}
                aria-label="Title"
                placeholder="Title"
              />
              <input
                value={editing.artist}
                onChange={(e) => setEditing({ ...editing, artist: e.target.value })}
                aria-label="Artist"
                placeholder="Artist"
              />
              <button
                type="button"
                className="btn small primary"
                aria-label="Save"
                disabled={busy || !editing.title.trim()}
                onClick={() =>
                  void run(
                    () => online.editSong(x.id, editing.title, editing.artist),
                    `Renamed. Every copy players downloaded follows.`,
                  ).then(() => setEditing(null))
                }
              >
                <Check strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <button type="button" className="btn small" aria-label="Cancel" onClick={() => setEditing(null)}>
                <X strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </li>
          ) : (
            <li key={x.id} className="boards-line">
              <span className="party-name">
                {x.title}
                <span className="dim">
                  {' '}
                  · {x.artist}
                  {x.by ? ` · added by ${x.by}` : ''}
                  {x.audio ? '' : ' · charts only'}
                </span>
              </span>
              <button
                type="button"
                className="btn small"
                aria-label={`Rename ${x.title}`}
                onClick={() => setEditing({ id: x.id, title: x.title, artist: x.artist })}
              >
                <Pencil strokeWidth={ICON_STROKE} aria-hidden />
              </button>
              <button
                type="button"
                className="btn small danger"
                aria-label={`Remove ${x.title} from the server`}
                disabled={busy}
                onClick={() => setRemoving(x)}
              >
                <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </li>
          ),
        )}
      </ol>
      {removing && (
        <Dialog title="Remove the song" variant="card" closeLabel="Keep it" onClose={() => setRemoving(null)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Remove “{removing.title}”?</h2>
              <p className="hint">It leaves the server’s library, for everyone on the server.</p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Keep it
              </button>
              <button
                type="button"
                className="btn primary wide danger"
                onClick={() => {
                  void run(() => online.removeSong(removing.id, 'Removed by an admin'), `"${removing.title}" was removed from the server.`);
                  close();
                }}
              >
                Remove
              </button>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}
