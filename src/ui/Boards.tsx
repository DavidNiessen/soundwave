/**
 * The server's leaderboards (docs/specs/online-play.md, 3.3, 4.4). A song stands on the left, its
 * cover, name and which board to show; the part and difficulty run across the top as tabs; the
 * ranked runs fill the rest, each one ready to Watch. The other view lists the replays players
 * shared.
 */
import { ArrowLeft, ChevronLeft, ChevronRight, Crown, Eye, Share2, Trash2, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analysisManager } from '../analysis/manager';
import { playSfx } from '../audio/sfx';
import { DIFFICULTIES, PARTS, type Difficulty, type Part } from '../chart/types';
import type { Settings } from '../game/settings';
import { partAmong, songParts, type Pick, type ThinParts } from '../game/setlist';
import { keysOf } from '../input/bindings';
import { TAB_EVENT } from '../input/menuNav';
import { menuPulse } from '../input/rumble';
import { online } from '../net/client';
import { serverSongs } from '../net/serverSongs';
import type { Board, RankLine } from '../net/protocol';
import { chartId } from '../net/runs';
import type { SongMeta } from '../storage/db';
import { Hint, useActions, useHints } from './actions';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Pips, Stars } from './icons';
import { useSlide } from './useSlide';

interface Props {
  library: SongMeta[];
  /** Songs the player can play (analysed, with notes). */
  playable: (id: string) => boolean;
  setlist: SongMeta[];
  pick: Pick;
  /** Per song, the parts it hardly has: a board opens on a part the song has. */
  thin: ThinParts;
  settings: Settings;
  onWatch(scoreId: string): void;
  onBack(): void;
}

type Shared = Awaited<ReturnType<typeof online.sharedRuns>>[number];
/** One letter for a difficulty, as the rows show it. */
const DIFF_LETTER: Record<Difficulty, string> = { easy: 'E', medium: 'M', hard: 'H', expert: 'X' };

export function BoardsScreen({ library, playable, setlist, pick, thin, settings, onWatch, onBack }: Props) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const hints = useHints(settings);
  const mod = s.account?.role === 'owner' || s.account?.role === 'moderator';
  const [problem, setProblem] = useState<string | null>(null);
  const songs = useMemo(() => library.filter((x) => playable(x.id)), [library, playable]);
  const [songId, setSongId] = useState<string>(() => setlist[0]?.id ?? songs[0]?.id ?? '');
  const at = Math.max(
    0,
    songs.findIndex((x) => x.id === songId),
  );
  const song = songs[at];
  // The board of the part and difficulty the player plays, or of whichever they choose to look at.
  const [part, setPart] = useState(pick.part);
  const [difficulty, setDifficulty] = useState(pick.difficulty);
  const [week, setWeek] = useState(false);
  const [view, setView] = useState<'songs' | 'shared'>('songs');
  const [find, setFind] = useState('');
  // The list narrowed by what is typed, in title or artist.
  const listed = useMemo(() => {
    const q = find.trim().toLowerCase();
    return q ? songs.filter((x) => `${x.title} ${x.artist}`.toLowerCase().includes(q)) : songs;
  }, [songs, find]);
  const own = song ? songParts(song.id, thin) : PARTS;
  const shown: Pick = { part: partAmong(part, own) ?? part, difficulty };

  const stepSong = (d: number) => {
    if (songs.length < 2) return;
    playSfx('tab');
    setSongId(songs[(at + d + songs.length) % songs.length].id);
  };
  const nextDifficulty = () => {
    playSfx('tab');
    setDifficulty(DIFFICULTIES[(DIFFICULTIES.indexOf(difficulty) + 1) % DIFFICULTIES.length]);
  };

  // The tab buttons (Q and E, the shoulder buttons) step through the parts the song has.
  const tabRef = useRef({ own, shown });
  tabRef.current = { own, shown };
  useEffect(() => {
    const onTab = (e: Event) => {
      const d = (e as CustomEvent<number>).detail;
      const { own, shown } = tabRef.current;
      const i = own.indexOf(shown.part) + d;
      if (i < 0 || i >= own.length) return;
      playSfx('tab');
      menuPulse(d < 0 ? 'tab-left' : 'tab-right');
      setPart(own[i]);
    };
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, []);

  useActions([
    { id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack },
    { id: 'boards-prev', label: 'Previous song', icon: ChevronLeft, ...keysOf('boards.prevSong'), bar: false, run: () => stepSong(-1) },
    { id: 'boards-next', label: 'Next song', icon: ChevronRight, ...keysOf('boards.nextSong'), bar: false, run: () => stepSong(1) },
    { id: 'boards-difficulty', label: 'Next difficulty', icon: Trophy, ...keysOf('boards.difficulty'), bar: false, run: nextDifficulty },
    {
      id: 'boards-week',
      label: week ? 'All time' : 'This week',
      icon: Trophy,
      ...keysOf('boards.week'),
      bar: false,
      run: () => setWeek((w) => !w),
    },
    {
      id: 'boards-replays',
      label: view === 'songs' ? 'Shared replays' : 'Song boards',
      icon: Share2,
      ...keysOf('boards.replays'),
      bar: false,
      run: () => setView((v) => (v === 'songs' ? 'shared' : 'songs')),
    },
  ]);

  const partRow = useSlide<HTMLDivElement>(shown.part);
  const diffRow = useSlide<HTMLDivElement>(difficulty);

  if (!s.account)
    return (
      <div className="page boards">
        <header className="page-head">
          <h1 className="page-title">Leaderboards</h1>
        </header>
        <p className="hint">Sign in to a server on the main menu’s Online tab to see its leaderboards.</p>
      </div>
    );

  const pair = <T extends string>(label: string, binding: string, value: T, options: [T, string][], set: (v: T) => void) => (
    <div className="boards-option">
      <span className="option-label">
        {label}
        <Hint {...keysOf(binding)} {...hints} />
      </span>
      <div className="choice-pair" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            className={`choice ${value === v ? 'on' : ''}`}
            onClick={() => set(v)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="page boards">
      <header className="page-head">
        <h1 className="page-title">Leaderboards</h1>
        <p className="head-count">{s.info?.name}</p>
      </header>
      {problem && (
        <p className="party-error" role="alert">
          {problem}
          <button type="button" className="btn small" onClick={() => setProblem(null)}>
            OK
          </button>
        </p>
      )}
      <div className="boards-layout">
        <aside className="boards-side" data-nav-group="boards-side">
          {pair(
            'Show',
            'boards.replays',
            view,
            [
              ['songs', 'Song boards'],
              ['shared', 'Shared replays'],
            ],
            setView,
          )}
          {view === 'songs' ? (
            songs.length ? (
              <>
                <input
                  className="boards-find"
                  type="search"
                  value={find}
                  onChange={(e) => setFind(e.target.value)}
                  placeholder="Find a song"
                  aria-label="Find a song"
                  spellCheck={false}
                />
                {/* First the song, then its board: every song with charts, in the library's order. */}
                <ol className="boards-songs" aria-label="Songs">
                  {listed.map((x) => (
                    <li key={x.id}>
                      <button
                        type="button"
                        className={`boards-song-item ${x.id === song?.id ? 'on' : ''}`}
                        aria-current={x.id === song?.id}
                        onClick={() => setSongId(x.id)}
                      >
                        <Cover blob={x.cover} title={x.title} />
                        <span className="song-text">
                          <span className="song-title">{x.title}</span>
                          <span className="song-artist">{x.artist}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {listed.length === 0 && <li className="hint">No song matches “{find}”.</li>}
                </ol>
              </>
            ) : (
              <p className="hint">Songs with charts in your library show their boards here.</p>
            )
          ) : (
            <p className="hint">Runs players chose to share, newest first. Watch any of them for a song you have.</p>
          )}
        </aside>

        <main className="boards-main">
          {view === 'songs' ? (
            <>
              {song && (
                <header className="boards-song-head">
                  <Cover blob={song.cover} title={song.title} />
                  <span className="song-text">
                    <span className="boards-title">{song.title}</span>
                    <span className="song-artist">{song.artist || 'Unknown artist'}</span>
                  </span>
                  {pair(
                    'Scores',
                    'boards.week',
                    week ? 'week' : 'all',
                    [
                      ['all', 'All time'],
                      ['week', 'This week'],
                    ],
                    (v) => setWeek(v === 'week'),
                  )}
                </header>
              )}
              {song && (
                <div className="boards-tabs">
                  <span className="boards-tabs-label">
                    {PART_LABEL[shown.part]} · {DIFFICULTY_LABEL[difficulty]}
                  </span>
                  <div className="boards-tab-strip">
                    <Hint {...keysOf('menus.tabPrev')} {...hints} />
                    <div className="part-row slide boards-parts" ref={partRow} role="radiogroup" aria-label="Part">
                      <span className="sel" aria-hidden />
                      {PARTS.map((p) => {
                        const Icon = PART_ICON[p];
                        const on = shown.part === p;
                        return (
                          <button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={PART_LABEL[p]}
                            title={PART_LABEL[p]}
                            data-on={on}
                            className={`choice ${on ? 'on' : ''}`}
                            disabled={!own.includes(p)}
                            onClick={() => setPart(p)}
                          >
                            <Icon strokeWidth={ICON_STROKE} aria-hidden />
                          </button>
                        );
                      })}
                    </div>
                    <Hint {...keysOf('menus.tabNext')} {...hints} />
                    <div className="diff-row slide boards-diffs" ref={diffRow} role="radiogroup" aria-label="Difficulty">
                      <span className="sel" aria-hidden />
                      {DIFFICULTIES.map((d) => {
                        const on = difficulty === d;
                        return (
                          <button
                            key={d}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            aria-label={DIFFICULTY_LABEL[d]}
                            title={DIFFICULTY_LABEL[d]}
                            data-on={on}
                            className={`choice ${on ? 'on' : ''}`}
                            onClick={() => setDifficulty(d)}
                          >
                            <Pips difficulty={d} />
                          </button>
                        );
                      })}
                    </div>
                    <Hint {...keysOf('boards.difficulty')} {...hints} />
                  </div>
                </div>
              )}
              {song ? (
                <SongBoard song={song} pick={shown} week={week} mod={mod} onWatch={onWatch} onProblem={setProblem} />
              ) : (
                <p className="hint boards-empty">Add a song and play it to see its board.</p>
              )}
            </>
          ) : (
            <SharedRuns library={library} onWatch={onWatch} onProblem={setProblem} />
          )}
        </main>
      </div>
    </div>
  );
}

/** A run's line: rank, name, stars, accuracy, difficulty and score, and Watch. */
function Row({
  l,
  me,
  difficulty,
  onWatch,
  onRemove,
}: {
  l: RankLine;
  me: boolean;
  difficulty: Difficulty;
  onWatch(): void;
  onRemove?: () => void;
}) {
  const accuracy = Math.round(l.accuracy * 100);
  return (
    <li
      className={`board-row ${me ? 'me' : ''} ${l.rank <= 3 ? `top top-${l.rank}` : ''}`}
      style={{ ['--i' as string]: Math.min(l.rank, 20) }}
    >
      <span className="board-rank num">{l.rank === 1 ? <Crown strokeWidth={ICON_STROKE} aria-label="First" /> : l.rank}</span>
      <span className="board-name">
        {l.name}
        {me && <span className="dim"> · you</span>}
        {l.shared && <Share2 className="board-shared" strokeWidth={ICON_STROKE} aria-label="Shared replay" />}
      </span>
      <Stars n={l.stars} />
      <span
        className={`board-pill ${l.fullCombo ? 'fc' : ''} ${accuracy === 100 ? 'perfect' : ''}`}
        title={l.fullCombo ? 'Full combo' : 'Accuracy'}
      >
        {l.fullCombo && accuracy < 100 ? 'FC' : `${accuracy}%`}
      </span>
      <span className="board-diff" title={DIFFICULTY_LABEL[difficulty]}>
        {DIFF_LETTER[difficulty]}
      </span>
      <span className="board-score num">{l.score.toLocaleString()}</span>
      <span className="board-acts">
        <button type="button" className="btn small" onClick={onWatch}>
          <Eye strokeWidth={ICON_STROKE} aria-hidden />
          Watch
        </button>
        {onRemove && (
          <button type="button" className="icon-btn" aria-label={`Remove ${l.name}’s run`} onClick={onRemove}>
            <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
          </button>
        )}
      </span>
    </li>
  );
}

/** One song's board on a part and difficulty, for the chart the player's library makes. */
function SongBoard({
  song,
  pick,
  week,
  mod,
  onWatch,
  onProblem,
}: {
  song: SongMeta;
  pick: Pick;
  week: boolean;
  mod: boolean;
  onWatch(id: string): void;
  onProblem(m: string): void;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [none, setNone] = useState(false);
  const [version, setVersion] = useState(0);
  /** The run a moderator asked to remove, waiting for them to say yes. */
  const [removing, setRemoving] = useState<RankLine | null>(null);
  const problemRef = useRef(onProblem);
  problemRef.current = onProblem;
  // A run posted, shared or taken off this song's boards elsewhere: the board is fetched again, quietly.
  useEffect(() => online.onChanged(['boards'], (songs) => (!songs || songs.has(song.id)) && setVersion((v) => v + 1)), [song.id]);
  /** What the board on screen is of: a new one starts from Loading, a live refresh keeps the old one up meanwhile. */
  const shownKey = useRef('');
  useEffect(() => {
    let live = true;
    const key = `${song.id}/${pick.part}/${pick.difficulty}/${week}`;
    if (key !== shownKey.current) {
      shownKey.current = key;
      setBoard(null);
      setNone(false);
    }
    void (async () => {
      const chart = await analysisManager.chart(song.id, pick.part, pick.difficulty).catch(() => undefined);
      if (!live) return;
      if (!chart || !chart.notes.length) return setNone(true);
      try {
        const b = await online.rankings(song.id, await chartId(chart), pick.part, pick.difficulty, week);
        if (live) setBoard(b);
      } catch (e) {
        problemRef.current((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [song.id, pick.part, pick.difficulty, week, version]);

  if (none) return <p className="hint boards-empty">This song has no {PART_LABEL[pick.part].toLowerCase()} notes at this difficulty.</p>;
  if (!board) return <p className="hint boards-empty">Loading the board…</p>;
  const mine = board.me;
  const remove = (l: RankLine) =>
    void online.removeScore(l.scoreId, 'Removed from the leaderboard by a moderator').then(
      () => setVersion((v) => v + 1),
      (e) => onProblem((e as Error).message),
    );
  const row = (l: RankLine) => (
    <Row
      key={l.scoreId}
      l={l}
      me={l.scoreId === mine?.scoreId}
      difficulty={pick.difficulty}
      onWatch={() => onWatch(l.scoreId)}
      onRemove={mod && l.scoreId !== mine?.scoreId ? () => setRemoving(l) : undefined}
    />
  );
  return (
    <div className="boards-list">
      {board.lines.length === 0 ? (
        <p className="hint boards-empty">
          {week ? 'Nobody has played this chart here this week.' : 'Nobody has played this chart on this server yet.'} Finish it to be
          first.
        </p>
      ) : (
        <ol className="board-rows" aria-label="Rankings">
          {board.lines.map(row)}
        </ol>
      )}
      {mine && mine.rank > board.lines.length && <ol className="board-rows pinned">{row(mine)}</ol>}
      {mine && (
        <div className="boards-foot">
          <span className="dim">
            Your best: rank {mine.rank}, {mine.score.toLocaleString()}
          </span>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void online.share(mine.scoreId, !mine.shared).then(
                () => setVersion((v) => v + 1),
                (e) => onProblem((e as Error).message),
              )
            }
          >
            <Share2 strokeWidth={ICON_STROKE} aria-hidden />
            {mine.shared ? 'Stop sharing my run' : 'Share my run'}
          </button>
        </div>
      )}
      {removing && (
        <Dialog title="Remove the run" variant="card" closeLabel="Keep it" onClose={() => setRemoving(null)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Remove {removing.name}’s run?</h2>
              <p className="hint">
                It leaves the server’s boards for good: rank {removing.rank} here, {removing.score.toLocaleString()}.
              </p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Keep it
              </button>
              <button
                type="button"
                className="btn primary wide danger"
                onClick={() => {
                  remove(removing);
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

/** The replays players shared, newest first. */
function SharedRuns({ library, onWatch, onProblem }: { library: SongMeta[]; onWatch(id: string): void; onProblem(m: string): void }) {
  const [shared, setShared] = useState<Shared[] | null>(null);
  const problemRef = useRef(onProblem);
  problemRef.current = onProblem;
  useEffect(() => {
    const load = () => void online.sharedRuns().then(setShared, (e) => (setShared([]), problemRef.current((e as Error).message)));
    load();
    return online.onChanged(['replays'], load);
  }, []);
  const have = (id: string) => library.some((x) => x.id === id);
  const server = useSyncExternalStore(serverSongs.subscribe, serverSongs.snapshot);
  /** Where the music of a run comes from: the library, streamed from the server, or none. */
  const music = (id: string) => (have(id) || server.held[id] ? 'own' : server.list.some((x) => x.id === id && x.audio) ? 'stream' : 'none');
  if (!shared) return <p className="hint boards-empty">Loading the shared replays…</p>;
  if (!shared.length) return <p className="hint boards-empty">Nobody has shared a replay yet. Share yours from a song’s board.</p>;
  return (
    <div className="boards-list">
      <ol className="board-rows" aria-label="Shared replays">
        {shared.map((r, i) => {
          const Icon = PART_ICON[r.part as Part];
          return (
            <li key={r.scoreId} className="board-row shared" style={{ ['--i' as string]: Math.min(i, 20) }}>
              <span className="board-rank">
                <Icon strokeWidth={ICON_STROKE} aria-label={PART_LABEL[r.part]} />
              </span>
              <span className="board-name">
                {r.name}
                <span className="dim">
                  {' '}
                  · {r.title}
                  {music(r.songId) === 'stream' ? ' · streams the song' : music(r.songId) === 'none' ? ' · no music' : ''}
                </span>
              </span>
              <Stars n={r.stars} />
              <span className="board-pill">{Math.round(r.accuracy * 100)}%</span>
              <span className="board-diff" title={DIFFICULTY_LABEL[r.difficulty]}>
                {DIFF_LETTER[r.difficulty]}
              </span>
              <span className="board-score num">{r.score.toLocaleString()}</span>
              <span className="board-acts">
                <button
                  type="button"
                  className="btn small"
                  title={
                    {
                      own: undefined,
                      stream: 'Streams the song from the server',
                      none: 'Plays without music: neither you nor the server has this song',
                    }[music(r.songId)]
                  }
                  onClick={() => onWatch(r.scoreId)}
                >
                  <Eye strokeWidth={ICON_STROKE} aria-hidden />
                  Watch
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
