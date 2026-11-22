/**
 * What the owner and moderators of a server do from the game (docs/specs/online-play.md, 3.2), on
 * the admin page: keep the server's library, remove and ban players, name moderators, reset a
 * forgotten password, make invites, set the Showdown rotation, read the log of every moderation
 * action and deal with reported songs. And, for everyone, invite links.
 */
import {
  ArrowLeft,
  Check,
  CopyCheck,
  ChevronRight,
  Copy,
  Flag,
  Gavel,
  KeyRound,
  LayoutDashboard,
  Library,
  ListMusic,
  LogOut,
  ScrollText,
  Search as SearchIcon,
  Shield,
  Swords,
  Trash2,
  TriangleAlert,
  UserPlus,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Settings } from '../game/settings';
import { keysOf } from '../input/bindings';
import { online } from '../net/client';
import type { DuplicatePair, Invite, Role, SetSong, SharedSong, Topic, UserEntry } from '../net/protocol';
import type { SongMeta } from '../storage/db';
import { Hint, useActions, useHints, type Action } from './actions';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { ServerCover, ServerLibrary } from './ServerLibrary';
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

/** The admin's sections: each a page of its own, listed down the side of the admin page. */
type Section = 'overview' | 'library' | 'players' | 'invites' | 'rotation' | 'log' | 'reports' | 'duplicates';

const SECTIONS: { id: Section; binding: string; label: string; icon: LucideIcon; about: string }[] = [
  { id: 'overview', binding: 'admin.overview', label: 'Overview', icon: LayoutDashboard, about: 'Your server at a glance.' },
  {
    id: 'library',
    binding: 'admin.library',
    label: 'Server library',
    icon: Library,
    about: 'Songs everyone here can stream or download. Renaming one updates every copy players downloaded.',
  },
  {
    id: 'players',
    binding: 'admin.players',
    label: 'Players',
    icon: Users,
    about: 'Everyone with an account here. Pick one to moderate them.',
  },
  {
    id: 'invites',
    binding: 'admin.invites',
    label: 'Invites',
    icon: UserPlus,
    about: 'Links that let people make an account on this server.',
  },
  {
    id: 'rotation',
    binding: 'admin.rotation',
    label: 'Showdown rotation',
    icon: Swords,
    about: 'The songs a Showdown plays when its host picks the server’s set, everyone on the same part.',
  },
  {
    id: 'log',
    binding: 'admin.log',
    label: 'Moderation log',
    icon: ScrollText,
    about: 'Everything the admin and moderators did, newest first.',
  },
  { id: 'reports', binding: 'admin.reports', label: 'Reported songs', icon: Flag, about: 'Songs players asked to have taken down.' },
  {
    id: 'duplicates',
    binding: 'admin.duplicates',
    label: 'Possible duplicates',
    icon: CopyCheck,
    about:
      'Songs that look like the same song twice, found by how they sound, how long they are and their names. Keep one, or say they differ.',
  },
];

type LogEntry = Awaited<ReturnType<typeof online.auditLog>>[number];
type Report = Awaited<ReturnType<typeof online.songReports>>[number];
/** Something the page fetched: loading (null), there, or a reason it is not. */
type Loaded<T> = T | null | { failed: string };
const failed = <T,>(x: Loaded<T>): x is { failed: string } => !!x && typeof x === 'object' && 'failed' in x;
const ready = <T,>(x: Loaded<T>): T | null => (failed(x) ? null : x);

/** "3 min ago", "yesterday", or the date. */
export function timeAgo(at: number, now = Date.now()) {
  const s = Math.max(0, (now - at) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(at).toLocaleDateString();
}
const minutes = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`);

/**
 * The admin page, for the server's owner and moderators: its sections down the side (an overview
 * of the server, its library, players, invites, the Showdown rotation, the moderation log and the
 * reported songs), the one open beside them under a header that says what it is for.
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
  const [section, setSection] = useState<Section>('overview');
  const owner = s.account?.role === 'owner';
  const mod = owner || s.account?.role === 'moderator';

  // What the sections show, fetched as the page opens and again on going to another section.
  const [songs, setSongs] = useState<Loaded<SharedSong[]>>(null);
  const [users, setUsers] = useState<Loaded<UserEntry[]>>(null);
  const [rotation, setRotation] = useState<Loaded<SetSong[]>>(null);
  const [log, setLog] = useState<Loaded<LogEntry[]>>(null);
  const [reports, setReports] = useState<Loaded<Report[]>>(null);
  const [duplicates, setDuplicates] = useState<Loaded<DuplicatePair[]>>(null);
  /** Each section's fetch, by the topic that says it changed. */
  const fetchers = useMemo((): Partial<Record<Topic, () => void>> => {
    if (!mod) return {};
    // A server older than the game may not answer some of these: the section says so.
    const fail = (e: unknown) => ({
      failed: /not found|404/i.test((e as Error).message)
        ? 'This server is older than your game and cannot show this. Its owner needs to update it.'
        : (e as Error).message,
    });
    return {
      songs: () => {
        void online.songs('').then(setSongs, (e) => setSongs(fail(e)));
        void online.duplicates().then(setDuplicates, (e) => setDuplicates(fail(e)));
      },
      users: () => void online.users().then(setUsers, (e) => setUsers(fail(e))),
      rotation: () => void online.showdownRotation().then(setRotation, (e) => setRotation(fail(e))),
      log: () => void online.auditLog().then(setLog, (e) => setLog(fail(e))),
      reports: () => void online.songReports().then(setReports, (e) => setReports(fail(e))),
    };
  }, [mod]);
  const load = useCallback(() => Object.values(fetchers).forEach((f) => f()), [fetchers]);
  useEffect(load, [load, section]);
  // Live: each section is fetched again as soon as the server says it changed (another admin's
  // edit, a report, a player coming online).
  useEffect(() => {
    const stops = Object.entries(fetchers).map(([t, f]) => online.onChanged([t as Topic], f));
    return () => stops.forEach((stop) => stop());
  }, [fetchers]);

  // A section opened by its key takes the focus to its place in the list, as a click does.
  const go = (id: Section) => {
    setSection(id);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`.admin-nav [data-action="admin-${id}"]`)?.focus({ preventScroll: true }),
    );
  };
  const nav: Action[] = SECTIONS.map(({ id, binding, label, icon }) => ({
    id: `admin-${id}`,
    label,
    icon,
    ...keysOf(binding),
    bar: false,
    run: () => go(id),
  }));
  const back = () => (section === 'overview' ? onBack() : go('overview'));
  useActions(
    [{ id: 'back', label: section === 'overview' ? 'Back' : 'Overview', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: back }, ...nav],
    {
      passive: section === 'library',
    },
  );

  if (!mod)
    return (
      <div className="page admin-page">
        <header className="page-head">
          <h1 className="page-title">Admin</h1>
        </header>
        <p className="hint">Only the server’s admin and its moderators run the server.</p>
      </div>
    );

  const songList = ready(songs);
  const userList = ready(users);
  const reportList = ready(reports);
  const count: Partial<Record<Section, number>> = {
    library: songList?.length,
    players: userList?.length,
    rotation: ready(rotation)?.length,
    reports: reportList?.length,
    duplicates: ready(duplicates)?.length,
  };
  const current = SECTIONS.find((x) => x.id === section)!;

  return (
    <div className="page admin-page">
      <header className="page-head">
        <h1 className="page-title">Admin</h1>
        <p className="head-count">
          {s.info?.name ?? 'Soundwave server'} · {owner ? 'Admin' : 'Moderator'}
        </p>
      </header>
      <div className="admin-shell">
        <nav className="admin-nav" aria-label="Admin" data-nav-group="admin-nav">
          {SECTIONS.map(({ id, binding, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={`admin-nav-item ${section === id ? 'on' : ''} ${id === 'reports' && reportList?.length ? 'alert' : ''}`}
              aria-current={section === id ? 'page' : undefined}
              data-action={`admin-${id}`}
              data-autofocus={section === id ? '' : undefined}
              onClick={() => go(id)}
            >
              <Icon strokeWidth={ICON_STROKE} aria-hidden />
              <span className="admin-nav-label">{label}</span>
              {!!count[id] && <span className="admin-count">{count[id]}</span>}
              <Hint {...keysOf(binding)} {...hints} />
            </button>
          ))}
        </nav>

        <main className="admin-main" key={section}>
          <header className="admin-main-head">
            <h2 className="admin-main-title">{current.label}</h2>
            <p className="hint">{current.about}</p>
          </header>
          {section === 'overview' && (
            <Overview songs={songs} users={users} rotation={rotation} log={log} reports={reports} duplicates={duplicates} onGo={go} />
          )}
          {section === 'library' &&
            (failed(songs) ? (
              <Failed reason={songs.failed} />
            ) : (
              <ServerLibrary
                library={library}
                list={songList ?? []}
                settings={settings}
                onChange={load}
                onBack={() => go('overview')}
                extra={nav}
              />
            ))}
          {section === 'players' &&
            (failed(users) ? (
              <Failed reason={users.failed} />
            ) : (
              <Players users={userList} owner={owner} me={s.account!.name} onChange={load} />
            ))}
          {section === 'invites' && <AdminInvites />}
          {section === 'rotation' &&
            (failed(rotation) ? (
              <Failed reason={rotation.failed} />
            ) : (
              <Rotation rotation={ready(rotation)} setlist={setlist} onChange={setRotation} />
            ))}
          {section === 'log' && (failed(log) ? <Failed reason={log.failed} /> : <ModLog log={ready(log)} />)}
          {section === 'reports' &&
            (failed(reports) ? <Failed reason={reports.failed} /> : <ReportedSongs reports={reportList} onChange={load} />)}
          {section === 'duplicates' &&
            (failed(duplicates) ? <Failed reason={duplicates.failed} /> : <Duplicates pairs={ready(duplicates)} onChange={load} />)}
        </main>
      </div>
    </div>
  );
}

/** A section the server could not give. */
function Failed({ reason }: { reason: string }) {
  return (
    <div className="admin-empty">
      <TriangleAlert strokeWidth={ICON_STROKE} aria-hidden />
      <p>{reason}</p>
    </div>
  );
}

/** The server at a glance: its numbers, the newest songs, who is online and what was done lately. */
function Overview({
  songs,
  users,
  rotation,
  log,
  reports,
  duplicates,
  onGo,
}: {
  songs: Loaded<SharedSong[]>;
  users: Loaded<UserEntry[]>;
  rotation: Loaded<SetSong[]>;
  log: Loaded<LogEntry[]>;
  reports: Loaded<Report[]>;
  duplicates: Loaded<DuplicatePair[]>;
  onGo(s: Section): void;
}) {
  const twins = ready(duplicates)?.length ?? 0;
  const songList = ready(songs);
  const userList = ready(users);
  const reportList = ready(reports);
  const rot = ready(rotation);
  const onlineNow = userList?.filter((u) => u.online) ?? [];
  const banned = userList?.filter((u) => u.bannedUntil !== null).length ?? 0;
  const value = <T,>(x: Loaded<T>, v: (t: T) => string) => (failed(x) ? '–' : x === null ? '…' : v(x));
  const stats: { id: Section; icon: LucideIcon; label: string; value: string; sub: string; alert?: boolean }[] = [
    {
      // With songs that may be there twice, the tile leads to them.
      id: twins ? 'duplicates' : 'library',
      icon: Library,
      label: 'Songs',
      value: value(songs, (l) => String(l.length)),
      sub: twins
        ? `${twins} possible duplicate${twins === 1 ? '' : 's'}`
        : songList
          ? minutes(songList.reduce((n, x) => n + x.duration, 0)) + ' of music'
          : '',
      alert: twins > 0,
    },
    {
      id: 'players',
      icon: Users,
      label: 'Players',
      value: value(users, (l) => String(l.length)),
      sub: userList ? `${onlineNow.length} online${banned ? ` · ${banned} banned` : ''}` : failed(users) ? 'Update the server' : '',
    },
    {
      id: 'reports',
      icon: Flag,
      label: 'Reports',
      value: value(reports, (l) => String(l.length)),
      sub: reportList ? (reportList.length ? 'To look at' : 'All clear') : '',
      alert: !!reportList?.length,
    },
    {
      id: 'rotation',
      icon: Swords,
      label: 'Rotation',
      value: value(rotation, (l) => String(l.length)),
      sub: rot ? (rot.length ? 'Showdown songs' : 'Not set yet') : '',
    },
  ];
  return (
    <div className="admin-overview">
      <div className="admin-stats" data-nav-group="admin-stats">
        {stats.map(({ id, icon: Icon, label, value: v, sub, alert }) => (
          <button key={id} type="button" className={`admin-stat ${alert ? 'alert' : ''}`} onClick={() => onGo(id)}>
            <span className="admin-stat-top">
              <Icon strokeWidth={ICON_STROKE} aria-hidden />
              {label}
            </span>
            <span className="admin-stat-value">{v}</span>
            <span className="admin-stat-sub">{sub}</span>
          </button>
        ))}
      </div>

      <div className="admin-panels">
        <section className="admin-panel">
          <header className="admin-panel-head">
            <h3>Newest songs</h3>
            <button type="button" className="admin-link" onClick={() => onGo('library')}>
              All songs <ChevronRight strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          </header>
          {failed(songs) ? (
            <p className="hint">{songs.failed}</p>
          ) : !songList ? (
            <p className="hint">Loading…</p>
          ) : !songList.length ? (
            <p className="hint">No songs yet. Add some under Server library.</p>
          ) : (
            <ol className="admin-rows">
              {[...songList]
                .sort((a, b) => b.created - a.created)
                .slice(0, 5)
                .map((x) => (
                  <li key={x.id} className="admin-row">
                    <ServerCover song={x} className="admin-row-cover" />
                    <span className="admin-row-text">
                      <span className="admin-row-title">{x.title}</span>
                      <span className="admin-row-sub">
                        {x.artist || 'Unknown artist'} · added by {x.by ?? 'a removed account'}
                      </span>
                    </span>
                    <span className="admin-row-meta">{timeAgo(x.created)}</span>
                  </li>
                ))}
            </ol>
          )}
        </section>

        <div className="admin-panel-stack">
          <section className="admin-panel">
            <header className="admin-panel-head">
              <h3>Online now</h3>
              <button type="button" className="admin-link" onClick={() => onGo('players')}>
                Players <ChevronRight strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </header>
            {failed(users) ? (
              <p className="hint">{users.failed}</p>
            ) : !userList ? (
              <p className="hint">Loading…</p>
            ) : !onlineNow.length ? (
              <p className="hint">Nobody right now.</p>
            ) : (
              <div className="admin-chips">
                {onlineNow.map((u) => (
                  <span key={u.name} className="admin-chip">
                    <span className="online-dot on" aria-hidden />
                    {u.name}
                  </span>
                ))}
              </div>
            )}
          </section>
          <section className="admin-panel">
            <header className="admin-panel-head">
              <h3>Recent moderation</h3>
              <button type="button" className="admin-link" onClick={() => onGo('log')}>
                The log <ChevronRight strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </header>
            {failed(log) ? (
              <p className="hint">{log.failed}</p>
            ) : !ready(log) ? (
              <p className="hint">Loading…</p>
            ) : !ready(log)!.length ? (
              <p className="hint">Nothing yet.</p>
            ) : (
              <ol className="admin-rows compact">
                {ready(log)!
                  .slice(0, 4)
                  .map((a, i) => (
                    <li key={i} className="admin-row">
                      <span className="admin-pill">{a.action}</span>
                      <span className="admin-row-text">
                        <span className="admin-row-title">{a.target}</span>
                        <span className="admin-row-sub">by {a.actor}</span>
                      </span>
                      <span className="admin-row-meta">{timeAgo(a.at)}</span>
                    </li>
                  ))}
              </ol>
            )}
          </section>
        </div>
      </div>
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
 * The server's players: a list to search, and for the one picked, what an admin or a moderator
 * may do to them (remove, ban, lift a ban; an admin also names admins and moderators and resets
 * passwords). An admin is changed only by themselves: they can step down, unless they are the last.
 * What cannot be undone is asked first.
 */
function Players({ users, owner, me, onChange }: { users: UserEntry[] | null; owner: boolean; me: string; onChange(): void }) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState<number | null>(24);
  const [note, setNote] = useState<string | null>(null);
  const [asking, setAsking] = useState<null | { title: string; hint: string; yes: string; run(): void }>(null);
  /** A recovery link just made, to copy and send. */
  const [recovery, setRecovery] = useState<{ name: string; link: string } | null>(null);
  const q = query.trim().toLowerCase();
  const shown = (users ?? []).filter((u) => !q || u.name.toLowerCase().includes(q));
  const user = users?.find((u) => u.name === picked);

  const act = (what: Parameters<typeof online.moderate>[0], extra: Record<string, unknown>, done: string) =>
    void online.moderate(what, { name: picked, reason, ...extra }).then(
      () => {
        setNote(done);
        setReason('');
        onChange();
      },
      (e) => setNote((e as Error).message),
    );
  // Admins are moderated by nobody, moderators only by an admin, and nobody by themselves.
  const reachable = (u: UserEntry) => u.name !== me && u.role !== 'owner' && (owner || u.role === 'player');

  return (
    <div className="admin-players">
      <div className="admin-list-side">
        <Search value={query} onChange={setQuery} label="Find a player" />
        <ol className="admin-rows scroll">
          {users === null && <li className="hint">Loading…</li>}
          {users && !shown.length && <li className="hint">Nobody by that name.</li>}
          {shown.map((u) => (
            <li key={u.name}>
              <button
                type="button"
                className={`admin-row admin-user ${picked === u.name ? 'on' : ''}`}
                aria-pressed={picked === u.name}
                onClick={() => (setPicked(u.name), setNote(null))}
              >
                <span className="admin-initial" aria-hidden>
                  {u.name.slice(0, 1).toUpperCase()}
                  <span className={`online-dot ${u.online ? 'on' : ''}`} />
                </span>
                <span className="admin-row-text">
                  <span className="admin-row-title">{u.name}</span>
                  <span className="admin-row-sub">
                    {u.online ? 'Online now' : `Here since ${new Date(u.created).toLocaleDateString()}`}
                  </span>
                </span>
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
            {user.name === me && owner ? (
              <>
                <p className="hint">That is you. You can step down; the server keeps at least one admin, so make someone else one first.</p>
                <div className="admin-actions">
                  {(['moderator', 'player'] as const).map((role) => (
                    <button
                      key={role}
                      type="button"
                      className="btn"
                      onClick={() =>
                        setAsking({
                          title: `Step down to ${role}?`,
                          hint: 'You stop being an admin now, and only another admin can make you one again.',
                          yes: 'Step down',
                          run: () =>
                            void online.stepDown(role).then(
                              () => (setNote(`You are a ${role} now.`), onChange()),
                              (e) => setNote((e as Error).message),
                            ),
                        })
                      }
                    >
                      <Shield strokeWidth={ICON_STROKE} aria-hidden />
                      Step down to {role}
                    </button>
                  ))}
                </div>
              </>
            ) : !reachable(user) ? (
              <p className="hint">
                {user.name === me
                  ? 'That is you.'
                  : user.role === 'owner'
                    ? 'Admins are not moderated, and only step down themselves.'
                    : 'Only an admin moderates moderators.'}
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
                      <div className="admin-role-pick">
                        <span className="dim">Role</span>
                        <div className="choice-pair" role="radiogroup" aria-label={`${user.name}’s role`}>
                          {(['player', 'moderator', 'owner'] as const).map((role) => (
                            <button
                              key={role}
                              type="button"
                              role="radio"
                              aria-checked={user.role === role}
                              className={`choice ${user.role === role ? 'on' : ''}`}
                              onClick={() => {
                                if (user.role === role) return;
                                const set = () =>
                                  act('role', { role }, `${user.name} is ${role === 'owner' ? 'an admin' : `a ${role}`} now.`);
                                if (role !== 'owner') return set();
                                setAsking({
                                  title: `Make ${user.name} an admin?`,
                                  hint: 'They can do everything you can: run the server, its library and its players, and name admins. Only they can step down again.',
                                  yes: 'Make an admin',
                                  run: set,
                                });
                              }}
                            >
                              {ROLE[role]}
                            </button>
                          ))}
                        </div>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          setAsking({
                            title: `A recovery link for ${user.name}?`,
                            hint: 'For a player who lost their identity. Whoever opens the link in their game gets this account, with that game’s identity: send it only to them. It works once, for a week.',
                            yes: 'Make the link',
                            run: () =>
                              void online.recoveryLink(user.name).then(
                                (r) => setRecovery({ name: user.name, link: r.link }),
                                (e) => setNote((e as Error).message),
                              ),
                          })
                        }
                      >
                        <KeyRound strokeWidth={ICON_STROKE} aria-hidden />
                        Recovery link
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
            {note && <p className="hint admin-note">{note}</p>}
            {recovery && recovery.name === user.name && (
              <div className="admin-recovery">
                <p className="hint">Send this to {recovery.name} only. It works once, for a week:</p>
                <code className="party-invite">{recovery.link}</code>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => void navigator.clipboard?.writeText(recovery.link).then(() => setNote('Copied.'))}
                >
                  <Copy strokeWidth={ICON_STROKE} aria-hidden />
                  Copy the link
                </button>
              </div>
            )}
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

/** The Showdown rotation: its songs in order, and the player's setlist made the rotation. */
function Rotation({ rotation, setlist, onChange }: { rotation: SetSong[] | null; setlist: SongMeta[]; onChange(r: SetSong[]): void }) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const use = () => {
    setBusy(true);
    void online
      .setShowdownRotation(setlist.map((x) => ({ id: x.id, title: x.title, artist: x.artist, duration: x.duration })))
      .then(
        (r) => (onChange(r), setNote(r.length ? 'The Showdown rotation is your setlist now.' : 'The Showdown rotation is empty now.')),
        (e) => setNote((e as Error).message),
      )
      .finally(() => setBusy(false));
  };
  const total = rotation?.reduce((n, x) => n + x.duration, 0) ?? 0;
  return (
    <div className="admin-page-body">
      <div className="admin-toolbar">
        <p className="admin-toolbar-stats">
          <strong>{rotation?.length ?? '…'}</strong> {rotation?.length === 1 ? 'song' : 'songs'}
          {!!rotation?.length && <span className="dim"> · {minutes(total)}</span>}
        </p>
        <button type="button" className="btn primary" data-autofocus disabled={busy} onClick={use}>
          <ListMusic strokeWidth={ICON_STROKE} aria-hidden />
          {setlist.length ? `Use my setlist (${setlist.length})` : 'Clear the rotation'}
        </button>
      </div>
      {note && (
        <p className="hint admin-note" role="status">
          {note}
        </p>
      )}
      {rotation === null ? (
        <p className="hint">Loading…</p>
      ) : !rotation.length ? (
        <div className="admin-empty">
          <Swords strokeWidth={ICON_STROKE} aria-hidden />
          <p>No rotation yet. Put songs in your setlist (in the library), then use it here.</p>
        </div>
      ) : (
        <ol className="admin-rows scroll">
          {rotation.map((x, i) => (
            <li key={x.id} className="admin-row">
              <span className="admin-rank">{i + 1}</span>
              <Cover title={x.title} className="admin-row-cover" />
              <span className="admin-row-text">
                <span className="admin-row-title">{x.title}</span>
                <span className="admin-row-sub">{x.artist || 'Unknown artist'}</span>
              </span>
              <span className="admin-row-meta">{clock(x.duration)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** What the owner and moderators did, newest first: a search, and each action as a line. */
function ModLog({ log }: { log: LogEntry[] | null }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = (log ?? []).filter((a) => !q || `${a.actor} ${a.action} ${a.target} ${a.reason}`.toLowerCase().includes(q));
  return (
    <div className="admin-page-body">
      <Search value={query} onChange={setQuery} label="Find a player, a moderator or an action" />
      {log === null ? (
        <p className="hint">Loading…</p>
      ) : !shown.length ? (
        <div className="admin-empty">
          <ScrollText strokeWidth={ICON_STROKE} aria-hidden />
          <p>{q ? 'Nothing like that in the log.' : 'Nothing yet. Bans, removals and role changes show here.'}</p>
        </div>
      ) : (
        <ol className="admin-rows scroll">
          {shown.map((a, i) => (
            <li key={i} className="admin-row">
              <span className={`admin-pill ${a.action.startsWith('ban') ? 'bad' : a.action === 'unban' ? 'good' : ''}`}>{a.action}</span>
              <span className="admin-row-text">
                <span className="admin-row-title">
                  {a.target} <span className="dim">by {a.actor}</span>
                </span>
                {a.reason && <span className="admin-row-sub">“{a.reason}”</span>}
              </span>
              <span className="admin-row-meta" title={new Date(a.at).toLocaleString()}>
                {timeAgo(a.at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Songs players reported (a takedown, say): each with why, kept or removed from the server. */
function ReportedSongs({ reports, onChange }: { reports: Report[] | null; onChange(): void }) {
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Report | null>(null);
  return (
    <div className="admin-page-body">
      {note && (
        <p className="hint admin-note" role="status">
          {note}
        </p>
      )}
      {reports === null ? (
        <p className="hint">Loading…</p>
      ) : !reports.length ? (
        <div className="admin-empty good">
          <Check strokeWidth={ICON_STROKE} aria-hidden />
          <p>No song is reported. All clear.</p>
        </div>
      ) : (
        <ol className="admin-rows scroll">
          {reports.map((r) => (
            <li key={r.id} className="admin-row report">
              <Cover title={r.title} className="admin-row-cover" />
              <span className="admin-row-text">
                <span className="admin-row-title">
                  {r.title} <span className="dim">· {r.artist}</span>
                </span>
                <span className="admin-row-sub">
                  {r.by ?? 'Someone'}: “{r.reason}” · shared by {r.uploader ?? 'a removed account'}
                </span>
              </span>
              <button type="button" className="btn small danger" onClick={() => setRemoving(r)}>
                <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                Remove
              </button>
            </li>
          ))}
        </ol>
      )}
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
                  const r = removing;
                  close();
                  void online.removeSong(r.songId, r.reason).then(
                    () => (setNote(`“${r.title}” was removed from the server.`), onChange()),
                    (e) => setNote((e as Error).message),
                  );
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

/**
 * Songs that may be the same song twice: each pair side by side, with who shared each, to keep one
 * (the other is removed for everyone) or to say they are different songs (the pair is not listed again).
 */
function Duplicates({ pairs, onChange }: { pairs: DuplicatePair[] | null; onChange(): void }) {
  const [note, setNote] = useState<string | null>(null);
  const [removing, setRemoving] = useState<{ song: SharedSong; keep: SharedSong } | null>(null);
  const side = (song: SharedSong) => (
    <span className="dup-side">
      <ServerCover song={song} className="admin-row-cover" />
      <span className="admin-row-text">
        <span className="admin-row-title">{song.title}</span>
        <span className="admin-row-sub">
          {song.artist} · {formatDuration(song.duration)} · {(song.size / 1048576).toFixed(1)} MB ·{' '}
          {song.by ? `shared by ${song.by}` : 'shared by a removed account'}
        </span>
      </span>
    </span>
  );
  return (
    <div className="admin-page-body">
      {note && (
        <p className="hint admin-note" role="status">
          {note}
        </p>
      )}
      {pairs === null ? (
        <p className="hint">Loading…</p>
      ) : !pairs.length ? (
        <div className="admin-empty good">
          <Check strokeWidth={ICON_STROKE} aria-hidden />
          <p>No song looks like it is here twice.</p>
        </div>
      ) : (
        <ol className="admin-rows scroll dup-list">
          {pairs.map((p) => (
            <li key={`${p.a.id}/${p.b.id}`} className={`dup-pair ${p.kind}`}>
              <span className={`admin-role ${p.kind === 'same' ? 'banned' : 'moderator'}`}>
                {p.kind === 'same' ? 'Same recording' : 'Probably the same song'}
                {p.score > 0 ? ` · ${Math.round(p.score * 100)}% alike` : ''}
              </span>
              {side(p.a)}
              {side(p.b)}
              <span className="admin-actions">
                <button type="button" className="btn small" onClick={() => setRemoving({ song: p.b, keep: p.a })}>
                  Keep the first
                </button>
                <button type="button" className="btn small" onClick={() => setRemoving({ song: p.a, keep: p.b })}>
                  Keep the second
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    void online.notDuplicates(p.a.id, p.b.id).then(
                      () => (setNote('Marked as different songs.'), onChange()),
                      (e) => setNote((e as Error).message),
                    )
                  }
                >
                  They differ
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      {removing && (
        <Dialog title="Remove the duplicate" variant="card" closeLabel="Go back" onClose={() => setRemoving(null)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Keep “{removing.keep.title}”?</h2>
              <p className="hint">
                The other copy, “{removing.song.title}” ({(removing.song.size / 1048576).toFixed(1)} MB
                {removing.song.by ? `, shared by ${removing.song.by}` : ''}), leaves the server for everyone.
              </p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Go back
              </button>
              <button
                type="button"
                className="btn primary wide danger"
                onClick={() => {
                  const r = removing;
                  close();
                  void online.removeSong(r.song.id, `A duplicate of “${r.keep.title}”`).then(
                    () => (setNote(`The duplicate of “${r.keep.title}” was removed.`), onChange()),
                    (e) => setNote((e as Error).message),
                  );
                }}
              >
                Remove the other
              </button>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

const formatDuration = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** Kinds of invite link, as the owner and moderators make them. */
const INVITE_KINDS: { id: string; label: string; about: string; uses: number | null; days: number | null }[] = [
  { id: 'one', label: 'One person', about: 'Works once, for a week.', uses: 1, days: 7 },
  { id: 'group', label: 'A group', about: '10 accounts, for a week.', uses: 10, days: 7 },
  { id: 'open', label: 'A community', about: 'No limit, and it never runs out.', uses: null, days: null },
];

/** Invite links: a kind to choose, the link to copy, and the links made this time. */
function AdminInvites() {
  const [kind, setKind] = useState(INVITE_KINDS[0].id);
  const [made, setMade] = useState<Invite[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const k = INVITE_KINDS.find((x) => x.id === kind)!;
  const make = () =>
    void online.makeInvite(k.uses, k.days === null ? null : k.days * 24).then(
      (i) => (setMade((m) => [i, ...m]), setProblem(null)),
      (e) => setProblem((e as Error).message),
    );
  const copy = (link: string) => void navigator.clipboard?.writeText(link).then(() => setCopied(link));
  return (
    <div className="admin-page-body">
      <div className="admin-kinds" role="radiogroup" aria-label="What kind of invite">
        {INVITE_KINDS.map((x) => (
          <button
            key={x.id}
            type="button"
            role="radio"
            aria-checked={kind === x.id}
            className={`admin-kind ${kind === x.id ? 'on' : ''}`}
            data-autofocus={x.id === kind ? '' : undefined}
            onClick={() => setKind(x.id)}
          >
            <span className="admin-kind-label">{x.label}</span>
            <span className="admin-kind-about">{x.about}</span>
          </button>
        ))}
      </div>
      <div className="admin-toolbar">
        <button type="button" className="btn primary" onClick={make}>
          <UserPlus strokeWidth={ICON_STROKE} aria-hidden />
          Make an invite link
        </button>
      </div>
      {problem && <p className="party-error">{problem}</p>}
      {made.length > 0 && (
        <ol className="admin-rows">
          {made.map((i) => (
            <li key={i.link} className="admin-row invite">
              <span className="admin-row-text">
                <code className="admin-link-text">{i.link}</code>
                <span className="admin-row-sub">
                  {i.uses === null ? 'No limit' : i.uses === 1 ? 'Works once' : `${i.uses} accounts`}
                  {i.expires === null ? ', always' : `, until ${new Date(i.expires).toLocaleDateString()}`}
                </span>
              </span>
              <button type="button" className={`btn small ${copied === i.link ? 'is-on' : ''}`} onClick={() => copy(i.link)}>
                {copied === i.link ? <Check strokeWidth={ICON_STROKE} aria-hidden /> : <Copy strokeWidth={ICON_STROKE} aria-hidden />}
                {copied === i.link ? 'Copied' : 'Copy'}
              </button>
            </li>
          ))}
        </ol>
      )}
      {!made.length && (
        <div className="admin-empty">
          <UserPlus strokeWidth={ICON_STROKE} aria-hidden />
          <p>Pick who it is for, then make the link and send it. It opens Soundwave on this server, ready to make an account.</p>
        </div>
      )}
    </div>
  );
}
