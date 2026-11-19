/**
 * The server's leaderboards (docs/specs/online-play.md, 3.3, 3.3b, 4.4): the weekly challenge,
 * challenges sent and received, every song's boards with Watch and Challenge, and the replays
 * players shared. Plus the ghost a challenge is played against.
 */
import { ArrowLeft, Eye, Play, Share2, Swords, Trash2, Trophy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { analysisManager } from '../analysis/manager';
import type { Chart } from '../chart/types';
import { ReplayPlayback, type ReplayInputs } from '../game/replay';
import type { Settings } from '../game/settings';
import type { Pick } from '../game/setlist';
import { online } from '../net/client';
import type { Board, Challenge, RankLine, Weekly } from '../net/protocol';
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
  settings: Settings;
  onWatch(scoreId: string): void;
  onPlayChallenge(c: Challenge): void;
  /** Opens a set of these songs (the weekly challenge) in the lobby. */
  onPlaySet(ids: string[]): void;
  onBack(): void;
}

type Shared = Awaited<ReturnType<typeof online.sharedRuns>>[number];

export function BoardsScreen({ library, playable, setlist, pick, settings, onWatch, onPlayChallenge, onPlaySet, onBack }: Props) {
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  useHints(settings);
  const mod = s.account?.role === 'owner' || s.account?.role === 'moderator';
  const [weekly, setWeekly] = useState<Weekly | null>(null);
  const [weeklyAt, setWeeklyAt] = useState(0);
  const [challenges, setChallenges] = useState<{ received: Challenge[]; sent: Challenge[] }>({ received: [], sent: [] });
  const [shared, setShared] = useState<Shared[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = () => setTick((t) => t + 1);
  const songs = useMemo(() => library.filter((x) => playable(x.id)), [library, playable]);
  const [songId, setSongId] = useState<string>(() => setlist[0]?.id ?? songs[0]?.id ?? '');
  const song = songs.find((x) => x.id === songId);

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
    void guard(online.weekly()).then((w) => w !== undefined && (setWeekly(w), setWeeklyAt(Date.now())));
    void guard(online.challenges()).then((c) => c && setChallenges(c));
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

  // Whether the challenge still runs, worked out when it arrives (not while drawing).
  const live = !!weekly && weekly.end > weeklyAt;
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
              <label className="meta-field">
                <span className="dim">
                  Song · {PART_LABEL[pick.part]} · {DIFFICULTY_LABEL[pick.difficulty]} (your part and difficulty)
                </span>
                <select className="boards-select" value={songId} onChange={(e) => setSongId(e.target.value)}>
                  {songs.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                      {x.artist ? ` · ${x.artist}` : ''}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p className="hint">Songs with charts in your library show their boards here.</p>
            )}
            {song && <SongBoard song={song} pick={pick} mod={mod} onWatch={onWatch} onProblem={setProblem} onChange={refresh} />}
          </section>

          {shared.length > 0 && (
            <section className="ready-panel" aria-label="Shared replays">
              <h2 className="label">
                <Share2 strokeWidth={ICON_STROKE} aria-hidden /> Replays players shared
              </h2>
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
          )}
        </div>

        <div className="party-main">
          <section className="ready-panel" aria-label="Weekly challenge">
            <h2 className="label">This week’s challenge</h2>
            {weekly ? (
              <>
                <p className="hint">
                  {weekly.songs.map((x) => x.title).join(' · ')} ·{' '}
                  {live ? `until ${new Date(weekly.end).toLocaleDateString()}` : `ended ${new Date(weekly.end).toLocaleDateString()}`}
                </p>
                <ol className="boards-lines">
                  {weekly.standings.slice(0, 10).map((l, i) => (
                    <li key={l.name} className={`boards-line ${l.name === s.account!.name ? 'me' : ''}`}>
                      <span className="num rank">{i + 1}</span>
                      <span className="party-name">{l.name}</span>
                      <span className="dim">
                        {l.songs} of {weekly.songs.length}
                      </span>
                      <span className="num">{l.score.toLocaleString()}</span>
                    </li>
                  ))}
                </ol>
                {live && (
                  <button
                    type="button"
                    className="btn primary wide"
                    disabled={!weekly.songs.some((x) => have(x.id))}
                    onClick={() => onPlaySet(weekly.songs.filter((x) => have(x.id)).map((x) => x.id))}
                  >
                    <Play strokeWidth={ICON_STROKE} aria-hidden />
                    {weekly.songs.every((x) => have(x.id)) ? 'Play the challenge' : 'Play the songs you have'}
                  </button>
                )}
              </>
            ) : (
              <p className="hint">No challenge yet.</p>
            )}
            {mod && (
              <button
                type="button"
                className="btn wide"
                disabled={!setlist.length}
                onClick={() =>
                  void guard(
                    online.setWeekly(
                      setlist.map((x) => ({ id: x.id, title: x.title, artist: x.artist, duration: x.duration })),
                      7,
                    ),
                  ).then((w) => w && (setWeekly(w), setWeeklyAt(Date.now())))
                }
              >
                Make my setlist this week’s challenge
              </button>
            )}
          </section>

          <section className="ready-panel" aria-label="Challenges">
            <h2 className="label">
              <Swords strokeWidth={ICON_STROKE} aria-hidden /> Challenges
            </h2>
            {challenges.received.length === 0 && challenges.sent.length === 0 && (
              <p className="hint">Beat my run: send one of your runs from a board to a friend, and they play against it as a ghost.</p>
            )}
            <ol className="boards-lines">
              {challenges.received.map((c) => (
                <li key={c.id} className="boards-line">
                  <span className="party-name">
                    {c.from} · {c.title}
                  </span>
                  <span className="dim">
                    {PART_LABEL[c.part]} · {DIFFICULTY_LABEL[c.difficulty]}
                  </span>
                  <span className="num">{c.score.toLocaleString()}</span>
                  {c.answer === null ? (
                    <button
                      type="button"
                      className="btn small primary"
                      disabled={!have(c.songId)}
                      title={have(c.songId) ? undefined : 'You don’t have this song'}
                      onClick={() => onPlayChallenge(c)}
                    >
                      <Swords strokeWidth={ICON_STROKE} aria-hidden />
                      Play
                    </button>
                  ) : (
                    <span className={c.answer > c.score ? 'won' : 'dim'}>{c.answer > c.score ? 'You won' : 'You lost'}</span>
                  )}
                </li>
              ))}
              {challenges.sent.map((c) => (
                <li key={c.id} className="boards-line">
                  <span className="party-name">
                    To {c.to} · {c.title}
                  </span>
                  <span className="num">{c.score.toLocaleString()}</span>
                  <span className={c.answer !== null && c.answer < c.score ? 'won' : 'dim'}>
                    {c.answer === null
                      ? 'Not played yet'
                      : c.answer < c.score
                        ? `You won · ${c.answer.toLocaleString()}`
                        : `They won · ${c.answer.toLocaleString()}`}
                  </span>
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
  const [to, setTo] = useState('');
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
          <form
            className="party-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (!to.trim()) return;
              void online.challenge(to, mine.scoreId).then(
                () => (setTo(''), onChange()),
                (err) => onProblem((err as Error).message),
              );
            }}
          >
            <label className="meta-field boards-to">
              <span className="dim">Challenge a player with your run</span>
              <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Their name" maxLength={24} spellCheck={false} />
            </label>
            <button type="submit" className="btn small" disabled={!to.trim()}>
              <Swords strokeWidth={ICON_STROKE} aria-hidden />
              Send
            </button>
          </form>
        </div>
      )}
    </>
  );
}

/* Playing against a ghost ------------------------------------------------------------------ */

/**
 * The challenger's run beside the highway, played back note for note as the song goes: it is
 * judged by time, so its score moves exactly as it did when it was played.
 */
export function GhostBoard({
  chart,
  inputs,
  name,
  time,
  score,
}: {
  chart: Chart;
  inputs: ReplayInputs;
  name: string;
  time(): number;
  score(): number;
}) {
  const playback = useRef<ReplayPlayback | null>(null);
  playback.current ??= new ReplayPlayback(chart, inputs);
  const [lines, setLines] = useState({ me: 0, ghost: 0 });
  const read = useRef({ time, score });
  read.current = { time, score };
  useEffect(() => {
    const timer = window.setInterval(() => {
      const p = playback.current!;
      p.advance(read.current.time());
      setLines({ me: Math.round(read.current.score()), ghost: Math.round(p.session.score) });
    }, 100);
    return () => clearInterval(timer);
  }, []);
  const rows = [
    { id: 'me', name: 'You', score: lines.me },
    { id: 'ghost', name, score: lines.ghost },
  ].sort((a, b) => b.score - a.score);
  return (
    <ol className="party-board" aria-label="You against the challenger">
      {rows.map((r, i) => (
        <li key={r.id} className={`party-board-row ${r.id === 'me' ? 'me' : ''}`}>
          <span className="num rank">{i + 1}</span>
          <span className="party-name">{r.name}</span>
          <span className="num">{r.score.toLocaleString()}</span>
          <span className="dim">{r.id === 'ghost' ? 'ghost' : ''}</span>
        </li>
      ))}
    </ol>
  );
}
