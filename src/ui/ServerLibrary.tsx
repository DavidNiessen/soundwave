/**
 * The server's own library, on the admin page: the songs everyone on the server can stream or
 * download, which the owner and moderators keep. A list with covers to search and sort, the song
 * picked shown beside it (rename it: every downloaded copy follows, the game checks each song's
 * hash; or remove it from the server), and songs added from the player's library, several at once.
 */
import { ArrowLeft, Check, Clock3, HardDrive, Pencil, Plus, Search, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Settings } from '../game/settings';
import { keysOf } from '../input/bindings';
import { online } from '../net/client';
import type { SharedSong } from '../net/protocol';
import { serverSongs } from '../net/serverSongs';
import type { SongMeta } from '../storage/db';
import { songFile } from '../storage/songFile';
import { Hint, useActions, useHints, type Action } from './actions';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';

type Sort = 'new' | 'title' | 'artist';
const SORTS: [Sort, string][] = [
  ['new', 'Newest'],
  ['title', 'Title'],
  ['artist', 'Artist'],
];

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const hours = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : `${Math.round(s / 60)} min`);
const bytes = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(1)} MB`);

/** Covers fetched from the server, by song id (kept while the game runs). */
const covers = new Map<string, Promise<Blob | null>>();
function useServerCover(song: SharedSong) {
  const [blob, setBlob] = useState<Blob | undefined>();
  useEffect(() => {
    if (!song.cover) return setBlob(undefined);
    let live = true;
    if (!covers.has(song.id))
      covers.set(
        song.id,
        online.songCover(song.id).catch(() => null),
      );
    void covers.get(song.id)!.then((b) => live && setBlob(b ?? undefined));
    return () => {
      live = false;
    };
  }, [song.id, song.cover]);
  return blob;
}

export function ServerCover({ song, className }: { song: SharedSong; className?: string }) {
  return <Cover blob={useServerCover(song)} title={song.title} className={className} />;
}

export function ServerLibrary({
  library,
  list,
  settings,
  onChange,
  onBack,
  extra = [],
}: {
  library: SongMeta[];
  list: SharedSong[];
  settings: Settings;
  onChange(): void;
  onBack(): void;
  /** The page's other actions (going to another section), kept while this one declares its own. */
  extra?: Action[];
}) {
  const hints = useHints(settings);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('new');
  const [picked, setPicked] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const found = list.filter((x) => !q || `${x.title} ${x.artist} ${x.by ?? ''}`.toLowerCase().includes(q));
    const by = (k: 'title' | 'artist') => (a: SharedSong, b: SharedSong) => a[k].localeCompare(b[k], undefined, { sensitivity: 'base' });
    return found.sort(sort === 'new' ? (a, b) => b.created - a.created : by(sort));
  }, [list, q, sort]);
  const song = list.find((x) => x.id === picked) ?? null;
  const onServer = new Set(list.map((x) => x.id));
  const addable = library.filter((x) => !onServer.has(x.id));
  const total = list.reduce((n, x) => n + x.duration, 0);
  const size = list.reduce((n, x) => n + x.size, 0);

  useActions([
    { id: 'back', label: 'Overview', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    ...extra.filter((a) => a.id !== 'admin-library'),
    { id: 'admin-add', label: 'Add songs', icon: Plus, ...keysOf('admin.add'), bar: false, run: () => setAdding(true) },
    {
      id: 'admin-sort',
      label: 'Sort',
      icon: Clock3,
      ...keysOf('admin.sort'),
      bar: false,
      run: () => setSort(SORTS[(SORTS.findIndex(([s]) => s === sort) + 1) % SORTS.length][0]),
    },
  ]);

  return (
    <div className="srvlib">
      <div className="srvlib-bar">
        <p className="srvlib-stats">
          <strong>{list.length}</strong> {list.length === 1 ? 'song' : 'songs'}
          {list.length > 0 && (
            <span className="dim">
              {' '}
              · {hours(total)} · {bytes(size)}
            </span>
          )}
        </p>
        <label className="admin-search srvlib-search">
          <Search strokeWidth={ICON_STROKE} aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a song, an artist or who added it"
            aria-label="Find a song"
            spellCheck={false}
          />
          {query && (
            <button type="button" className="srvlib-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
              <X strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          )}
        </label>
        <div className="choice-pair srvlib-sort" role="radiogroup" aria-label="Sort by">
          {SORTS.map(([s, label]) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={sort === s}
              className={`choice ${sort === s ? 'on' : ''}`}
              onClick={() => setSort(s)}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn primary" data-action="admin-add" data-autofocus onClick={() => setAdding(true)}>
          <Plus strokeWidth={ICON_STROKE} aria-hidden />
          Add songs
          <Hint {...keysOf('admin.add')} {...hints} />
        </button>
      </div>
      {note && (
        <p className="hint srvlib-note" role="status">
          {note}
        </p>
      )}

      <div className="srvlib-body">
        <ol className="srvlib-list" aria-label="The server's songs">
          {!list.length && (
            <li className="srvlib-empty">
              <p className="hint">No songs on the server yet. Add some from your library: everyone here can play them then.</p>
            </li>
          )}
          {list.length > 0 && !shown.length && (
            <li className="srvlib-empty">
              <p className="hint">No song like “{query.trim()}”.</p>
            </li>
          )}
          {shown.map((x) => (
            <li key={x.id}>
              <button
                type="button"
                className={`srvlib-row ${picked === x.id ? 'on' : ''}`}
                aria-pressed={picked === x.id}
                onClick={() => setPicked(picked === x.id ? null : x.id)}
              >
                <ServerCover song={x} className="srvlib-cover" />
                <span className="srvlib-text">
                  <span className="srvlib-title">{x.title}</span>
                  <span className="srvlib-artist">{x.artist || 'Unknown artist'}</span>
                </span>
                {!x.audio && <span className="admin-role">Charts only</span>}
                <span className="srvlib-by">{x.by ?? 'a removed account'}</span>
                <span className="srvlib-len">{clock(x.duration)}</span>
              </button>
            </li>
          ))}
        </ol>
        <SongDetail
          key={song?.id ?? 'none'}
          song={song}
          onDone={(text, gone) => (setNote(text), gone && setPicked(null), onChange(), void serverSongs.refresh())}
        />
      </div>

      {adding && (
        <AddSongs
          songs={addable}
          onClose={() => setAdding(false)}
          onAdded={(n, failed) => {
            setNote(
              `${n} ${n === 1 ? 'song is' : 'songs are'} on the server now.${failed.length ? ` Not added: ${failed.join('; ')}` : ''}`,
            );
            onChange();
            void serverSongs.refresh();
          }}
        />
      )}
    </div>
  );
}

/** The song picked: its cover large, what the server knows of it, renaming it and removing it. */
function SongDetail({ song, onDone }: { song: SharedSong | null; onDone(note: string, gone?: boolean): void }) {
  const [title, setTitle] = useState(song?.title ?? '');
  const [artist, setArtist] = useState(song?.artist ?? '');
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!song)
    return (
      <aside className="srvlib-detail empty">
        <p className="hint">Pick a song to rename it or take it off the server.</p>
      </aside>
    );
  const changed = title.trim() !== song.title || artist.trim() !== song.artist;
  const run = async (what: () => Promise<unknown>, done: string, gone = false) => {
    setBusy(true);
    setProblem(null);
    try {
      await what();
      onDone(done, gone);
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="srvlib-detail" aria-label={song.title}>
      <ServerCover song={song} className="srvlib-detail-cover" />
      <div className="srvlib-facts">
        <span>
          <Clock3 strokeWidth={ICON_STROKE} aria-hidden /> {clock(song.duration)}
        </span>
        <span>
          <HardDrive strokeWidth={ICON_STROKE} aria-hidden /> {song.audio ? bytes(song.size) : 'Charts only'}
        </span>
        <span>
          <UserRound strokeWidth={ICON_STROKE} aria-hidden /> {song.by ?? 'A removed account'} ·{' '}
          {new Date(song.created).toLocaleDateString()}
        </span>
      </div>
      <form
        className="srvlib-edit"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed && title.trim())
            void run(() => online.editSong(song.id, title.trim(), artist.trim()), 'Renamed. Every copy players downloaded follows.');
        }}
      >
        <label className="meta-field">
          <span className="dim">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </label>
        <label className="meta-field">
          <span className="dim">Artist</span>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={200} />
        </label>
        <div className="srvlib-edit-row">
          <button type="submit" className="btn primary" disabled={!changed || !title.trim() || busy}>
            <Pencil strokeWidth={ICON_STROKE} aria-hidden />
            Rename
          </button>
          {changed && (
            <button type="button" className="btn quiet" onClick={() => (setTitle(song.title), setArtist(song.artist))}>
              Undo
            </button>
          )}
        </div>
      </form>
      <button type="button" className="btn danger srvlib-remove" disabled={busy} onClick={() => setAsking(true)}>
        <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
        Remove from the server
      </button>
      {problem && <p className="party-error">{problem}</p>}
      {asking && (
        <Dialog title="Remove the song" variant="card" closeLabel="Keep it" onClose={() => setAsking(false)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Remove “{song.title}”?</h2>
              <p className="hint">It leaves the server’s library, for everyone on the server.</p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Keep it
              </button>
              <button
                type="button"
                className="btn primary wide danger"
                onClick={() => {
                  close();
                  void run(() => online.removeSong(song.id, 'Removed by an admin'), `“${song.title}” was removed from the server.`, true);
                }}
              >
                Remove
              </button>
            </div>
          )}
        </Dialog>
      )}
    </aside>
  );
}

/** Songs of the player's library to add to the server: ticked, then added one after another. */
function AddSongs({ songs, onClose, onAdded }: { songs: SongMeta[]; onClose(): void; onAdded(n: number, failed: string[]): void }) {
  const [query, setQuery] = useState('');
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ at: number; of: number } | null>(null);
  const q = query.trim().toLowerCase();
  const shown = songs.filter((x) => !q || `${x.title} ${x.artist}`.toLowerCase().includes(q));
  const all = shown.length > 0 && shown.every((x) => ticked.has(x.id));
  const toggle = (id: string) =>
    setTicked((t) => {
      const next = new Set(t);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const tickAll = () =>
    setTicked((t) => {
      const next = new Set(t);
      for (const x of shown) {
        if (all) next.delete(x.id);
        else next.add(x.id);
      }
      return next;
    });
  const add = async (close: () => void) => {
    const todo = songs.filter((x) => ticked.has(x.id));
    const failed: string[] = [];
    let n = 0;
    for (let i = 0; i < todo.length; i++) {
      setProgress({ at: i + 1, of: todo.length });
      try {
        await online.shareSong(await songFile(todo[i].id));
        n++;
      } catch (e) {
        failed.push(`${todo[i].title} (${(e as Error).message})`);
      }
    }
    onAdded(n, failed);
    close();
  };
  return (
    <Dialog title="Add songs" variant="card" className="wide-card" closeLabel="Cancel" onClose={onClose}>
      {(close) => (
        <div className="window-body srvlib-add">
          <h2 className="display">Add songs</h2>
          <p className="hint">From your library. Once added, everyone on the server can stream or download them.</p>
          {songs.length === 0 ? (
            <p className="hint">Every song of yours is on the server already.</p>
          ) : (
            <>
              <div className="srvlib-add-bar">
                <label className="admin-search">
                  <Search strokeWidth={ICON_STROKE} aria-hidden />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a song"
                    aria-label="Find a song"
                    spellCheck={false}
                    data-autofocus
                  />
                </label>
                <button type="button" className="btn small" onClick={tickAll} disabled={!shown.length || !!progress}>
                  {all ? 'None' : 'All'}
                </button>
              </div>
              <ol className="srvlib-add-list">
                {shown.map((x) => (
                  <li key={x.id}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={ticked.has(x.id)}
                      className={`srvlib-add-row ${ticked.has(x.id) ? 'on' : ''}`}
                      disabled={!!progress}
                      onClick={() => toggle(x.id)}
                    >
                      <span className="srvlib-tick" aria-hidden>
                        {ticked.has(x.id) && <Check strokeWidth={3} />}
                      </span>
                      <Cover blob={x.cover} title={x.title} className="srvlib-cover" />
                      <span className="srvlib-text">
                        <span className="srvlib-title">{x.title}</span>
                        <span className="srvlib-artist">{x.artist || 'Unknown artist'}</span>
                      </span>
                      <span className="srvlib-len">{clock(x.duration)}</span>
                    </button>
                  </li>
                ))}
                {!shown.length && <li className="hint">No song like that.</li>}
              </ol>
            </>
          )}
          {progress && (
            <div className="srvlib-progress" role="status">
              <span>
                Adding {progress.at} of {progress.of}…
              </span>
              <span className="srvlib-progress-bar" style={{ ['--p' as string]: (progress.at - 1) / progress.of }} />
            </div>
          )}
          <div className="srvlib-add-actions">
            <button type="button" className="btn" data-sfx="back" onClick={close} disabled={!!progress}>
              Cancel
            </button>
            <button type="button" className="btn primary" disabled={!ticked.size || !!progress} onClick={() => void add(close)}>
              <Plus strokeWidth={ICON_STROKE} aria-hidden />
              {ticked.size ? `Add ${ticked.size} ${ticked.size === 1 ? 'song' : 'songs'}` : 'Add songs'}
            </button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
