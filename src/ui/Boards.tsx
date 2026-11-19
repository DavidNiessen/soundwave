/**
 * The server's leaderboards (docs/specs/online-play.md, 3.3, 4.4): every song's boards with Watch,
 * and the replays players shared.
 */
import { ArrowLeft, Eye, Share2, Trash2, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analysisManager } from '../analysis/manager';
import type { Settings } from '../game/settings';
import { partAmong, songParts, type Pick, type ThinParts } from '../game/setlist';
import { DIFFICULTIES, PARTS } from '../chart/types';
import { online } from '../net/client';
import type { Board, RankLine } from '../net/protocol';
import { chartId } from '../net/runs';
import type { SongMeta } from '../storage/db';
import { useActions, useHints } from './actions';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_LABEL, Stars } from './icons';

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

export function BoardsScreen({ library, playable, setlist, pick, thin, settings, onWatch, onBack }: Props) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  useHints(settings);
  const mod = s.account?.role === 'owner' || s.account?.role === 'moderator';
  const [shared, setShared] = useState<Shared[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const songs = useMemo(() => library.filter((x) => playable(x.id)), [library, playable]);
  const [songId, setSongId] = useState<string>(() => setlist[0]?.id ?? songs[0]?.id ?? '');
  const song = songs.find((x) => x.id === songId);
  // The board of the part and difficulty the player plays, or of whichever they choose to look at.
  const [part, setPart] = useState(pick.part);
  const [difficulty, setDifficulty] = useState(pick.difficulty);
  const own = song ? songParts(song.id, thin) : PARTS;
  const shown: Pick = { part: partAmong(part, own) ?? part, difficulty };

  const guard = async <T,>(p: Promise<T>): Promise<T | undefined> => {
    try {
      return await p;
    } catch (e) {
      setProblem((e as Error).message);
      return undefined;
    }
  };

  useEffect(() => {
    if (!s.account) return;
    void guard(online.sharedRuns()).then((r) => r && setShared(r));
  }, [s.account, tick]);

  useActions([{ id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack }]);

  if (!s.account)
    return (
      <div className="page boards">
        <header className="page-head">
          <h1 className="page-title">Leaderboards</h1>
        </header>
        <p className="hint">Sign in to a server under Play together to see its leaderboards.</p>
      </div>
    );

  const have = (id: string) => library.some((x) => x.id === id);

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
      <div className="lobby-body boards-body">
        <div className="party-main">
          <section className="ready-panel" aria-label="Song boards">
            <h2 className="label">
              <Trophy strokeWidth={ICON_STROKE} aria-hidden /> A song’s board
            </h2>
            {songs.length ? (
              <>
                <label className="meta-field">
                  <span className="dim">Song</span>
                  <select className="boards-select" value={songId} onChange={(e) => setSongId(e.target.value)}>
                    {songs.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title}
                        {x.artist ? ` · ${x.artist}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="boards-pick">
                  <label className="meta-field">
                    <span className="dim">Part</span>
                    <select className="boards-select" value={shown.part} onChange={(e) => setPart(e.target.value as Pick['part'])}>
                      {own.map((p) => (
                        <option key={p} value={p}>
                          {PART_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="meta-field">
                    <span className="dim">Difficulty</span>
                    <select
                      className="boards-select"
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as Pick['difficulty'])}
                    >
                      {DIFFICULTIES.map((d) => (
                        <option key={d} value={d}>
                          {DIFFICULTY_LABEL[d]}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <p className="hint">Songs with charts in your library show their boards here.</p>
            )}
            {song && <SongBoard song={song} pick={shown} mod={mod} onWatch={onWatch} onProblem={setProblem} onChange={refresh} />}
          </section>
        </div>

        <div className="party-main">
          <section className="ready-panel" aria-label="Shared replays">
            <h2 className="label">
              <Share2 strokeWidth={ICON_STROKE} aria-hidden /> Replays players shared
            </h2>
            {shared.length === 0 && <p className="hint">Nobody has shared a replay yet. Share yours from a song’s board.</p>}
            <ol className="boards-lines">
              {shared.map((r) => (
                <li key={r.scoreId} className="boards-line">
                  <span className="party-name">
                    {r.name} · {r.title}
                  </span>
                  <span className="dim">
                    {PART_LABEL[r.part]} · {DIFFICULTY_LABEL[r.difficulty]}
                  </span>
                  <span className="num">{r.score.toLocaleString()}</span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={!have(r.songId)}
                    title={have(r.songId) ? undefined : 'You don’t have this song'}
                    onClick={() => onWatch(r.scoreId)}
                  >
                    <Eye strokeWidth={ICON_STROKE} aria-hidden />
                    Watch
                  </button>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One song's board on the player's part and difficulty, for the chart their library makes. */
function SongBoard({
  song,
  pick,
  mod,
  onWatch,
  onProblem,
  onChange,
}: {
  song: SongMeta;
  pick: Pick;
  mod: boolean;
  onWatch(id: string): void;
  onProblem(m: string): void;
  onChange(): void;
}) {
  const [week, setWeek] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [none, setNone] = useState(false);
  const [version, setVersion] = useState(0);
  const problemRef = useRef(onProblem);
  problemRef.current = onProblem;
  useEffect(() => {
    let live = true;
    setBoard(null);
    setNone(false);
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

  if (none) return <p className="hint">This song has no {PART_LABEL[pick.part].toLowerCase()} notes at this difficulty.</p>;
  if (!board) return <p className="hint">Loading the board…</p>;
  const mine = board.me;
  const row = (l: RankLine, me: boolean) => (
    <li key={l.scoreId} className={`boards-line ${me ? 'me' : ''}`}>
      <span className="num rank">{l.rank}</span>
      <span className="party-name">{l.name}</span>
      <Stars n={l.stars} />
      <span className="num">{l.score.toLocaleString()}</span>
      <button type="button" className="btn small" onClick={() => onWatch(l.scoreId)}>
        <Eye strokeWidth={ICON_STROKE} aria-hidden />
        Watch
      </button>
      {mod && !me && (
        <button
          type="button"
          className="btn small"
          aria-label={`Remove ${l.name}’s run`}
          onClick={() =>
            void online.removeScore(l.scoreId, 'Removed from the leaderboard by a moderator').then(
              () => setVersion((v) => v + 1),
              (e) => onProblem((e as Error).message),
            )
          }
        >
          <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      )}
    </li>
  );
  return (
    <>
      <div className="choice-pair" role="radiogroup" aria-label="Which scores">
        <button type="button" role="radio" aria-checked={!week} className={`choice ${!week ? 'on' : ''}`} onClick={() => setWeek(false)}>
          All time
        </button>
        <button type="button" role="radio" aria-checked={week} className={`choice ${week ? 'on' : ''}`} onClick={() => setWeek(true)}>
          This week
        </button>
      </div>
      {board.lines.length === 0 ? (
        <p className="hint">Nobody has played this chart on this server yet. Finish it to be first.</p>
      ) : (
        <ol className="boards-lines">{board.lines.map((l) => row(l, l.scoreId === mine?.scoreId))}</ol>
      )}
      {mine && mine.rank > board.lines.length && <ol className="boards-lines">{row(mine, true)}</ol>}
      {mine && (
        <div className="party-row">
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void online.share(mine.scoreId, !mine.shared).then(
                () => (setVersion((v) => v + 1), onChange()),
                (e) => onProblem((e as Error).message),
              )
            }
          >
            <Share2 strokeWidth={ICON_STROKE} aria-hidden />
            {mine.shared ? 'Stop sharing my run' : 'Share my run'}
          </button>
        </div>
      )}
    </>
  );
}
