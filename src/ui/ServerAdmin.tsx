/**
 * What the owner and moderators of a server do from the game (docs/specs/online-play.md, 3.2):
 * remove and ban players, name moderators, reset a forgotten password, and read
 * the log of every moderation action. And, for everyone, invite links.
 */
import { Check, Copy, Gavel, ListMusic, Pencil, Plus, ScrollText, Swords, Trash2, UserPlus, X } from 'lucide-react';
import { serverSongs } from '../net/serverSongs';
import { songFile } from '../storage/songFile';
import { useEffect, useState } from 'react';
import { online } from '../net/client';
import type { Invite, SetSong, SharedSong } from '../net/protocol';
import type { SongMeta } from '../storage/db';
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

export function AdminPanel({ owner, setlist, library }: { owner: boolean; setlist: SongMeta[]; library: SongMeta[] }) {
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [log, setLog] = useState<Awaited<ReturnType<typeof online.auditLog>>>([]);
  const refresh = () => void online.auditLog().then(setLog, () => {});
  useEffect(refresh, []);

  const act = (what: Parameters<typeof online.moderate>[0], extra: Record<string, unknown> = {}, done = 'Done.') =>
    void online.moderate(what, { name, reason, ...extra }).then(
      (r) => {
        setNote(r.password ? `${name}’s new password: ${r.password} (pass it on; it works once they sign in).` : done);
        refresh();
      },
      (e) => setNote((e as Error).message),
    );

  const h = Number(hours);
  // The Showdown rotation: the songs a Showdown plays when its host picks the server's set.
  const [rotation, setRotation] = useState<SetSong[] | null>(null);
  useEffect(() => void online.showdownRotation().then(setRotation, () => {}), []);
  const useSetlistAsRotation = () =>
    void online.setShowdownRotation(setlist.map((x) => ({ id: x.id, title: x.title, artist: x.artist, duration: x.duration }))).then(
      (r) => (setRotation(r), setNote(r.length ? 'The Showdown rotation is your setlist now.' : 'The Showdown rotation is empty now.')),
      (e) => setNote((e as Error).message),
    );
  return (
    <section className="ready-panel admin">
      <ServerLibrary library={library} />
      <h2 className="label">
        <Gavel strokeWidth={ICON_STROKE} aria-hidden /> Run the server
      </h2>
      <label className="meta-field">
        <span className="dim">Player</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} spellCheck={false} />
      </label>
      <label className="meta-field">
        <span className="dim">Why (shown to them, and kept in the log)</span>
        <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
      </label>
      <label className="meta-field">
        <span className="dim">Hours of a ban (empty: for good)</span>
        <input value={hours} onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" />
      </label>
      <div className="party-row">
        <button type="button" className="btn small" disabled={!name.trim()} onClick={() => act('kick', {}, `${name} was removed.`)}>
          Remove from the server
        </button>
        <button
          type="button"
          className="btn small"
          disabled={!name.trim()}
          onClick={() => act('ban', h > 0 ? { hours: h } : {}, `${name} is banned.`)}
        >
          Ban
        </button>
        <button type="button" className="btn small" disabled={!name.trim()} onClick={() => act('unban', {}, `${name} may come back.`)}>
          Lift a ban
        </button>
        {owner && (
          <>
            <button
              type="button"
              className="btn small"
              disabled={!name.trim()}
              onClick={() => act('role', { role: 'moderator' }, `${name} is a moderator.`)}
            >
              Make moderator
            </button>
            <button
              type="button"
              className="btn small"
              disabled={!name.trim()}
              onClick={() => act('role', { role: 'player' }, `${name} is a player again.`)}
            >
              Make player
            </button>
            <button type="button" className="btn small" disabled={!name.trim()} onClick={() => act('reset-password')}>
              Reset password
            </button>
          </>
        )}
      </div>
      {note && <p className="hint">{note}</p>}
      <h2 className="label">
        <Swords strokeWidth={ICON_STROKE} aria-hidden /> Showdown rotation
      </h2>
      <p className="hint">
        {rotation?.length
          ? rotation.map((x) => x.title).join(' · ')
          : 'None yet. A Showdown whose host picks the server’s set plays these songs.'}
      </p>
      <button type="button" className="btn small" onClick={useSetlistAsRotation}>
        <ListMusic strokeWidth={ICON_STROKE} aria-hidden />
        {setlist.length ? 'Make my setlist the rotation' : 'Clear the rotation'}
      </button>
      <h2 className="label">
        <ScrollText strokeWidth={ICON_STROKE} aria-hidden /> What moderators did
      </h2>
      <ol className="boards-lines admin-log">
        {log.length === 0 && <li className="dim">Nothing yet.</li>}
        {log.map((a, i) => (
          <li key={i} className="boards-line">
            <span className="dim">{new Date(a.at).toLocaleString()}</span>
            <span className="party-name">
              {a.actor}: {a.action} {a.target}
            </span>
            <span className="dim">{a.reason}</span>
          </li>
        ))}
      </ol>
      <ReportedSongs />
    </section>
  );
}

/** Songs players reported (a takedown, say), with removal from the server everywhere at once. */
function ReportedSongs() {
  const [reports, setReports] = useState<Awaited<ReturnType<typeof online.songReports>>>([]);
  const refresh = () => void online.songReports().then(setReports, () => {});
  useEffect(refresh, []);
  if (!reports.length) return null;
  return (
    <>
      <h2 className="label">Reported songs</h2>
      <ol className="boards-lines">
        {reports.map((r) => (
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
              onClick={() => void online.removeSong(r.songId, r.reason).then(refresh, () => {})}
            >
              Remove
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/**
 * The server's own library, which the owner and moderators keep: songs added from their library
 * (whatever players may share), renamed (every downloaded copy follows: the game checks each
 * song's hash), or removed everywhere at once.
 */
function ServerLibrary({ library }: { library: SongMeta[] }) {
  const [list, setList] = useState<SharedSong[]>([]);
  const [pick, setPick] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; title: string; artist: string } | null>(null);
  const load = () => void online.songs('').then(setList, (e) => setNote((e as Error).message));
  useEffect(load, []);
  const onServer = new Set(list.map((x) => x.id));
  const addable = library.filter((x) => !onServer.has(x.id));
  const run = async (what: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setNote(null);
    try {
      await what();
      setNote(done);
      load();
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
    <>
      <h2 className="label">
        <ListMusic strokeWidth={ICON_STROKE} aria-hidden /> Server library · {list.length}
      </h2>
      <p className="hint">Songs here show in the library of everyone on the server, to stream or download.</p>
      <div className="party-row">
        <select className="boards-select" value={pick} onChange={(e) => setPick(e.target.value)} aria-label="A song from your library">
          <option value="">
            {addable.length
              ? 'Add a song from your library…'
              : library.length
                ? 'Every song of yours is on the server'
                : 'Your library has no songs yet'}
          </option>
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
      {note && <p className="hint">{note}</p>}
      <ol className="boards-lines">
        {list.map((x) =>
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
                onClick={() => void run(() => online.removeSong(x.id, 'Removed by an admin'), `"${x.title}" was removed from the server.`)}
              >
                <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
              </button>
            </li>
          ),
        )}
      </ol>
    </>
  );
}
