import { ArrowLeft, ArrowUpDown, Check, CheckSquare, Ellipsis, Info, Play, Plus, Search, Trash2, Upload, Volume2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isTextField } from '../input/inputMode';
import { canPlay, type AnalysisStatus } from '../analysis/manager';
import { PARTS } from '../chart/types';
import type { Settings } from '../game/settings';
import { formatTime, SET_MAX } from '../game/setlist';
import type { BestScore, SongMeta } from '../storage/db';
import { Hint, useActions, useHints } from './actions';
import { Cover } from './Cover';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Stars } from './icons';
import { SongMenu, type SongActions } from './SongMenu';
import { usePreviewRows } from './usePreviewRows';
import { keysOf } from '../input/bindings';

export type SongStatus = AnalysisStatus;

interface Props {
  songs: SongMeta[];
  status: Record<string, SongStatus>;
  /** Ids of the songs in the setlist, in order. */
  setlist: string[];
  scores: BestScore[];
  importing: number;
  settings: Settings;
  /** The song whose preview is sounding, if any. */
  previewing: string | null;
  /** Says which song is highlighted (its preview plays), or null when the screen goes. */
  onCurrent(id: string | null): void;
  onToggle(song: SongMeta): void;
  onDetails(song: SongMeta): void;
  onReady(): void;
  onBack(): void;
  onAdd(): void;
  /** What a song's menu can do (the same as its detail sheet). */
  actions: SongActions;
}

type Sort = 'title' | 'artist' | 'newest' | 'length' | 'stars';
const SORTS: [Sort, string][] = [
  ['title', 'Title'],
  ['artist', 'Artist'],
  ['newest', 'Newest'],
  ['length', 'Length'],
  ['stars', 'Stars'],
];
const SORT_KEY = 'soundwave.library-sort';

function loadSort(): Sort {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (SORTS.some(([id]) => id === v)) return v as Sort;
  } catch {
    /* storage unavailable */
  }
  return 'title';
}

/** What analysis is doing right now, for the label beside its progress bar. */
export const analysisLabel = (status: SongStatus) =>
  status.state === 'queued' ? 'Waiting to analyze' : `${status.step ?? 'Analyzing'} · ${Math.round((status.progress ?? 0) * 100)}%`;

/** Only problems get a pill: a playable song needs no label, and analysis shows as a lit bar. */
export function StatusPill({ status }: { status: SongStatus }) {
  if (status.state === 'ready' && status.noNotes)
    return (
      <span className="pill error" title="No notes were found on any part, so it cannot go in a set.">
        No notes
      </span>
    );
  if (status.state === 'ready' || status.state === 'analyzing' || status.state === 'queued') return null;
  return (
    <span className={`pill ${status.state}`} title={status.error}>
      {status.state === 'error' ? 'Analysis failed' : 'Not analyzed'}
    </span>
  );
}

export function LibraryScreen({
  songs,
  status,
  setlist,
  scores,
  importing,
  settings,
  previewing,
  onCurrent,
  onToggle,
  onDetails,
  onReady,
  onBack,
  onAdd,
  actions,
}: Props) {
  const [query, setQuery] = useState('');
  /** Songs picked for a menu that acts on several at once, and where a Shift-click range starts. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  /** The open song menu: the songs it is for and where it opens. */
  const [menu, setMenu] = useState<{ ids: string[]; at: { x: number; y: number }; remove?: boolean } | null>(null);
  const [sort, setSort] = useState<Sort>(loadSort);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const hints = useHints(settings);

  /** Best stars per song, over every part and difficulty. */
  const bestStars = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of scores) m.set(s.songId, Math.max(m.get(s.songId) ?? 0, s.stars));
    return m;
  }, [scores]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? songs.filter((s) => `${s.title} ${s.artist} ${s.album ?? ''}`.toLowerCase().includes(q)) : [...songs];
    const text = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    list.sort((a, b) =>
      sort === 'artist'
        ? text(a.artist, b.artist) || text(a.title, b.title)
        : sort === 'newest'
          ? b.addedAt - a.addedAt
          : sort === 'length'
            ? a.duration - b.duration
            : sort === 'stars'
              ? (bestStars.get(b.id) ?? -1) - (bestStars.get(a.id) ?? -1) || text(a.title, b.title)
              : text(a.title, b.title),
    );
    return list;
  }, [songs, query, sort, bestStars]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const current = (currentId && byId.get(currentId)) || shown[0] || null;
  const picked = setlist.map((id) => byId.get(id)).filter((s): s is SongMeta => !!s);
  const setTime = formatTime(picked.reduce((t, s) => t + s.duration, 0));

  // The song the player is on plays its preview, and only while they are on it.
  usePreviewRows(onCurrent);

  const cycleSort = () => {
    const next = SORTS[(SORTS.findIndex(([id]) => id === sort) + 1) % SORTS.length][0];
    setSort(next);
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      /* ignore */
    }
  };

  // Songs that leave the library leave the selection too.
  useEffect(() => {
    setSelected((was) => {
      const kept = [...was].filter((id) => byId.has(id));
      return kept.length === was.size ? was : new Set(kept);
    });
  }, [byId]);

  /** Selects or deselects one song (Ctrl-click, or Select). */
  const pick = (id: string) => {
    setSelected((was) => {
      const next = new Set(was);
      if (!next.delete(id)) next.add(id);
      return next;
    });
    setAnchor(id);
  };
  /** Selects every shown song from the last one picked to this one (Shift-click). */
  const pickRange = (id: string) => {
    const from = shown.findIndex((s) => s.id === (anchor ?? id));
    const to = shown.findIndex((s) => s.id === id);
    if (from < 0 || to < 0) return pick(id);
    const [a, b] = from < to ? [from, to] : [to, from];
    setSelected((was) => new Set([...was, ...shown.slice(a, b + 1).map((s) => s.id)]));
  };

  /**
   * Opens the song menu: for the selection when there is one (and the song pressed is in it), else
   * for that song alone. Without a pointer it opens beside the song.
   */
  const openMenu = (song: SongMeta | null = current, at?: { x: number; y: number }, remove = false) => {
    let ids: string[];
    if (selected.size && (!song || selected.has(song.id))) ids = shown.filter((s) => selected.has(s.id)).map((s) => s.id);
    else if (song) {
      ids = [song.id];
      if (selected.size) setSelected(new Set());
    } else return;
    if (!at) {
      const row = document.querySelector(`.song-item[data-preview="${CSS.escape(song?.id ?? ids[0])}"] .song-row`);
      const r = row?.getBoundingClientRect();
      at = r ? { x: r.left + r.width * 0.45, y: r.bottom + 4 } : { x: innerWidth / 2, y: innerHeight / 3 };
    }
    setMenu({ ids, at, remove });
  };

  // The keyboard's menu key and Shift+F10 open the menu too; Ctrl+A selects every song shown.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTextField(e.target)) return;
      if (e.code === 'ContextMenu' || (e.code === 'F10' && e.shiftKey)) {
        e.preventDefault();
        openMenu();
      } else if (e.code === 'KeyA' && (e.ctrlKey || e.metaKey) && !e.altKey) {
        e.preventDefault();
        setSelected(new Set(shown.map((s) => s.id)));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // Esc in the search field clears it first, then leaves the field.
  useEffect(() => {
    const el = search.current!;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      if (el.value) setQuery('');
      else document.querySelector<HTMLElement>('.song-row')?.focus();
    };
    el.addEventListener('keydown', key);
    return () => el.removeEventListener('keydown', key);
  }, []);

  const selecting = selected.size > 0;
  const isSelected = !!current && selected.has(current.id);
  useActions([
    selecting
      ? { id: 'back', label: 'Clear selection', icon: X, kbd: 'Escape', sfx: 'back', run: () => setSelected(new Set()) }
      : { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    {
      id: 'details',
      label: 'Song details',
      icon: Info,
      ...keysOf('library.details'),
      bar: false,
      disabled: !current,
      run: () => current && onDetails(current),
    },
    {
      id: 'options',
      label: selecting ? `Options for ${selected.size}` : 'Options',
      icon: Ellipsis,
      ...keysOf('lists.options'),
      disabled: !current && !selecting,
      run: () => openMenu(),
    },
    {
      id: 'select',
      label: isSelected ? 'Deselect' : 'Select',
      icon: CheckSquare,
      ...keysOf('lists.select'),
      disabled: !current,
      run: () => current && pick(current.id),
    },
    {
      id: 'delete',
      label: selecting ? `Remove ${selected.size}` : 'Remove',
      icon: Trash2,
      ...keysOf('lists.delete'),
      bar: false,
      disabled: !current && !selecting,
      // Asks first, as Remove in the song menu does.
      run: () => openMenu(selecting ? null : current, undefined, true),
    },
    { id: 'search', label: 'Search', icon: Search, ...keysOf('library.search'), bar: false, run: () => search.current?.focus() },
    { id: 'sort', label: 'Sort', icon: ArrowUpDown, ...keysOf('library.sort'), bar: false, run: cycleSort },
    { id: 'add', label: 'Add songs', icon: Upload, ...keysOf('library.add'), bar: false, run: onAdd },
    { id: 'ready', label: 'Ready up', icon: Play, ...keysOf('library.ready'), primary: true, disabled: picked.length === 0, run: onReady },
  ]);

  const sortLabel = SORTS.find(([id]) => id === sort)![1];

  return (
    <div className="page library">
      <header className="page-head">
        <h1 className="page-title">Music library</h1>
        <p className="head-count">
          {songs.length} {songs.length === 1 ? 'song' : 'songs'}
        </p>
      </header>
      <div className="toolbar" data-nav-group="toolbar">
        <label className="search" data-ring-box>
          <Search strokeWidth={ICON_STROKE} aria-hidden />
          <input
            ref={search}
            type="search"
            placeholder="Search songs"
            aria-label="Search your library by title, artist or album"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
            enterKeyHint="search"
          />
          {query ? (
            <button
              type="button"
              className="icon-btn small"
              aria-label="Clear search"
              data-nav-skip
              onClick={() => (setQuery(''), search.current?.focus())}
            >
              <X strokeWidth={ICON_STROKE} aria-hidden />
            </button>
          ) : (
            <Hint
              kbd={keysOf('library.search').kbd}
              mode={hints.mode === 'keyboard' || hints.mode === 'mouse' ? hints.mode : 'touch'}
              style={hints.style}
            />
          )}
        </label>
        <button type="button" className="btn" data-action="sort" onClick={cycleSort} aria-label={`Sort by ${sortLabel}. Press to change.`}>
          <Hint {...keysOf('library.sort')} {...hints} />
          <ArrowUpDown strokeWidth={ICON_STROKE} aria-hidden />
          <span className="btn-label">{sortLabel}</span>
        </button>
        <button
          type="button"
          className="btn"
          data-action="add"
          aria-label={importing ? `Importing ${importing} songs` : 'Add songs'}
          onClick={onAdd}
        >
          <Hint {...keysOf('library.add')} {...hints} />
          <Upload strokeWidth={ICON_STROKE} aria-hidden />
          <span className="btn-label">{importing ? `Importing ${importing}…` : 'Add songs'}</span>
        </button>
      </div>

      <div className="library-body">
        <ul className="song-list" data-nav-group="songs" aria-label="Songs">
          {shown.map((s, i) => {
            const st = status[s.id] ?? { state: 'idle' };
            const slot = setlist.indexOf(s.id);
            // Playable: analysed, with notes on some part. Only such a song goes in the setlist.
            const ready = canPlay(st);
            const busy = st.state === 'analyzing' || st.state === 'queued';
            const full = setlist.length >= SET_MAX && slot < 0;
            const chosen = selected.has(s.id);
            return (
              <li
                key={s.id}
                data-preview={s.id}
                className={`song-item ${slot >= 0 ? 'picked' : ''} ${current?.id === s.id ? 'current' : ''} ${chosen ? 'selected' : ''}`}
                style={{ ['--i' as string]: Math.min(i, 12) }}
              >
                <button
                  type="button"
                  className="song-row"
                  data-autofocus={i === 0 ? '' : undefined}
                  aria-pressed={ready ? slot >= 0 : undefined}
                  aria-label={`${chosen ? 'Selected. ' : ''}${s.title} by ${s.artist}. ${!ready ? (busy ? 'Being analyzed.' : st.noNotes ? 'No notes found.' : 'Not ready to play.') + ' Opens song details.' : slot >= 0 ? `In the setlist at ${slot + 1}. Press to remove.` : full ? 'The setlist is full.' : 'Press to add to the setlist.'}`}
                  onFocus={() => setCurrentId(s.id)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setCurrentId(s.id)}
                  onClick={(e) => {
                    setCurrentId(s.id);
                    // Ctrl (Cmd on a Mac) picks one song more or less, Shift a run of them.
                    if (e.ctrlKey || e.metaKey) return pick(s.id);
                    if (e.shiftKey) return pickRange(s.id);
                    if (selecting) setSelected(new Set());
                    setAnchor(s.id);
                    if (ready) onToggle(s);
                    else onDetails(s);
                  }}
                  onContextMenu={(e) => {
                    // A right-click, or a long press on a touchscreen.
                    e.preventDefault();
                    setCurrentId(s.id);
                    openMenu(s, { x: e.clientX, y: e.clientY });
                  }}
                >
                  {chosen && (
                    <span className="select-mark" aria-hidden>
                      <Check strokeWidth={3} />
                    </span>
                  )}
                  <Cover blob={s.cover} title={s.title} />
                  <span className="song-text">
                    <span className="song-title">{s.title}</span>
                    <span className="song-artist">{s.artist}</span>
                  </span>
                  <span className="song-side">
                    {busy ? (
                      <span className="song-busy">{st.state === 'queued' ? 'Waiting' : `${Math.round((st.progress ?? 0) * 100)}%`}</span>
                    ) : ready ? (
                      bestStars.has(s.id) && <Stars n={bestStars.get(s.id)!} />
                    ) : (
                      <StatusPill status={st} />
                    )}
                    {previewing === s.id && (
                      <span className="song-playing" role="img" aria-label="Playing a preview">
                        <Volume2 strokeWidth={ICON_STROKE} aria-hidden />
                      </span>
                    )}
                    <span className="song-length">{formatTime(s.duration)}</span>
                  </span>
                  <span className={`slot-badge ${slot >= 0 ? 'on' : ''}`} aria-hidden>
                    {slot >= 0 ? slot + 1 : ready && !full ? <Plus strokeWidth={ICON_STROKE} /> : null}
                  </span>
                  {busy && (
                    <span className="meter row-meter" aria-hidden>
                      <span style={{ width: `${Math.round((st.progress ?? 0) * 100)}%` }} />
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  className="icon-btn row-info"
                  data-nav-skip
                  aria-label={`Details for ${s.title}`}
                  onClick={() => (setCurrentId(s.id), onDetails(s))}
                >
                  <Info strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              </li>
            );
          })}
          {shown.length === 0 && query && (
            <li className="empty-note">
              <p>No song matches “{query.trim()}”.</p>
              <button type="button" className="btn" onClick={() => setQuery('')}>
                Clear search
              </button>
            </li>
          )}
          {!query && (
            <li className="song-item add">
              <button type="button" className="song-row" data-autofocus={shown.length ? undefined : ''} onClick={onAdd}>
                <span className="cover add-cover" aria-hidden>
                  <Plus strokeWidth={ICON_STROKE} />
                </span>
                <span className="song-text">
                  <span className="song-title">Add your music</span>
                  <span className="song-artist">
                    {hints.mode === 'touch' ? 'Pick files from this device.' : 'Drop files anywhere or browse.'} MP3, WAV, FLAC, OGG, M4A.
                  </span>
                </span>
              </button>
            </li>
          )}
        </ul>

        <aside className="side" aria-label="Setlist">
          {current && <NowCard song={current} status={status[current.id] ?? { state: 'idle' }} scores={scores} />}
          <section className="setlist" data-nav-group="setlist">
            <header className="setlist-head">
              <h2 className="panel-title">Setlist</h2>
              <p className="setlist-count" role="status">
                {picked.length} of {SET_MAX}
                {setTime && ` · ${setTime}`}
              </p>
            </header>
            <ol className="slots">
              {Array.from({ length: SET_MAX }, (_, i) => {
                const s = picked[i];
                return (
                  <li key={s ? s.id : `empty-${i}`}>
                    {s ? (
                      <button
                        type="button"
                        className="slot filled"
                        data-sfx="back"
                        aria-label={`Remove ${s.title} from the setlist`}
                        onClick={() => onToggle(s)}
                      >
                        <span className="slot-num" aria-hidden>
                          {i + 1}
                        </span>
                        <Cover blob={s.cover} title={s.title} />
                        <span className="song-text">
                          <span className="song-title">{s.title}</span>
                          <span className="song-artist">{s.artist}</span>
                        </span>
                        <X className="slot-x" strokeWidth={ICON_STROKE} aria-hidden />
                      </button>
                    ) : (
                      <div className="slot empty">
                        <span className="slot-num" aria-hidden>
                          {i + 1}
                        </span>
                        <span className="slot-blank">{i === picked.length ? 'Pick a song' : 'Empty'}</span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>
      {menu && (
        <SongMenu
          songs={menu.ids.map((id) => byId.get(id)).filter((x): x is SongMeta => !!x)}
          status={status}
          setlist={setlist}
          at={menu.at}
          confirming={menu.remove}
          actions={actions}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** The highlighted song at a glance: cover, length and the best result on each part. */
function NowCard({ song, status, scores }: { song: SongMeta; status: SongStatus; scores: BestScore[] }) {
  const mine = scores.filter((s) => s.songId === song.id);
  const busy = status.state === 'analyzing' || status.state === 'queued';
  return (
    <section className="now" aria-label="Highlighted song" aria-live="off">
      <Cover blob={song.cover} title={song.title} />
      <div className="now-text">
        <h2 className="now-title">{song.title}</h2>
        <p className="now-artist">
          {song.artist}
          {song.duration > 0 && ` · ${formatTime(song.duration)}`}
        </p>
        {busy ? (
          <p className="now-status">{analysisLabel(status)}</p>
        ) : status.state !== 'ready' ? (
          <p className="now-status">
            <StatusPill status={status} />
          </p>
        ) : (
          <ul className="now-bests">
            {PARTS.map((p) => {
              const Icon = PART_ICON[p];
              const best = mine.filter((s) => s.part === p).sort((a, b) => b.stars - a.stars || b.score - a.score)[0];
              return (
                <li
                  key={p}
                  className={best ? '' : 'none'}
                  title={
                    best
                      ? `${PART_LABEL[p]}: ${best.score.toLocaleString()} on ${DIFFICULTY_LABEL[best.difficulty]}`
                      : `${PART_LABEL[p]}: not played`
                  }
                >
                  <Icon strokeWidth={ICON_STROKE} aria-hidden />
                  <span className="sr-only">{PART_LABEL[p]}</span>
                  {best ? (
                    <>
                      <Stars n={best.stars} />
                      {best.fullCombo && <Check className="fc" strokeWidth={3} aria-label="Full combo" />}
                    </>
                  ) : (
                    <span className="dim">Not played</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
