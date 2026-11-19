import { Clapperboard, Ellipsis, Film, Pin, PinOff, Play, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { Settings } from '../game/settings';
import { getInputMode, usesFocus } from '../input/inputMode';
import { focusEl, focusStart } from '../input/menuNav';
import type { SongMeta } from '../storage/db';
import type { ReplayMeta } from '../storage/replays';
import { Hint, useHints } from './actions';
import { Cover } from './Cover';
import { Dialog } from './Dialog';
import { DIFFICULTY_LABEL, ICON_STROKE, PART_ICON, PART_LABEL, Pips, Stars } from './icons';
import { clock, replayDate } from './ReplayScreen';
import { keysOf } from '../input/bindings';

/** What can be done with saved replays. */
export interface ReplayActions {
  watch(replay: ReplayMeta): void;
  /** Asks how to export the replay as a video. */
  exportVideo(replay: ReplayMeta): void;
  /** Keeps a replay (it is never removed to make room) or lets it go again. */
  keep(replay: ReplayMeta, kept: boolean): Promise<void>;
  remove(replays: ReplayMeta[]): Promise<void>;
}

/** What the main menu's action bar does to the highlighted replay (see HomeScreen). */
export interface ReplayCommands {
  options(): void;
  exportVideo(): void;
  keep(): void;
  remove(): void;
}

interface Props {
  replays: ReplayMeta[];
  /** The library, for the covers (a replay outlives its song). */
  songs: SongMeta[];
  settings: Settings;
  actions: ReplayActions;
  onSettings(): void;
  commands: Ref<ReplayCommands | null>;
}

/** The replay highlighted last, for as long as the game is open: back from one lands on it. */
let lastWatched: string | null = null;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The Replays tab: every saved run, newest first, and the highlighted one's result beside the list.
 * A press on a replay plays it; its options keep it (it is then never removed to make room) or
 * delete it.
 */
export function ReplaysPanel({ replays, songs, settings, actions, onSettings, commands }: Props) {
  const hints = useHints(settings);
  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ReplayMeta | null>(null);
  const [asking, setAsking] = useState<ReplayMeta | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = replays.find((r) => r.id === currentId) ?? replays[0] ?? null;
  const startId = (lastWatched && replays.some((r) => r.id === lastWatched) ? lastWatched : replays[0]?.id) ?? null;
  const kept = replays.filter((r) => r.kept).length;

  const watch = (r: ReplayMeta) => {
    lastWatched = r.id;
    actions.watch(r);
  };
  const toggleKeep = (r: ReplayMeta) => void actions.keep(r, !r.kept);
  /** Deletes a replay, and puts focus on the row that takes its place. */
  const remove = async (r: ReplayMeta) => {
    const i = replays.findIndex((x) => x.id === r.id);
    const next = replays[i + 1] ?? replays[i - 1] ?? null;
    await actions.remove([r]);
    setCurrentId(next?.id ?? null);
    requestAnimationFrame(() => {
      if (!usesFocus(getInputMode())) return;
      const row = next && list.current?.querySelector<HTMLElement>(`[data-replay="${next.id}"] .song-row`);
      if (row) focusEl(row, false);
      else focusStart(list.current?.closest('.home-body') ?? undefined);
    });
  };

  // The action bar's shortcuts act on whichever replay is highlighted when they are pressed.
  const latest = useRef<ReplayCommands>({ options() {}, exportVideo() {}, keep() {}, remove() {} });
  latest.current = {
    options: () => current && setMenu(current),
    exportVideo: () => current && actions.exportVideo(current),
    keep: () => current && toggleKeep(current),
    remove: () => current && setAsking(current),
  };
  useImperativeHandle(
    commands,
    () => ({
      options: () => latest.current.options(),
      exportVideo: () => latest.current.exportVideo(),
      keep: () => latest.current.keep(),
      remove: () => latest.current.remove(),
    }),
    [],
  );

  // A highlighted replay that was deleted elsewhere (the settings) hands the card to the first.
  useEffect(() => {
    if (currentId && !replays.some((r) => r.id === currentId)) setCurrentId(null);
  }, [replays, currentId]);

  const limit = settings.replayLimit;
  const caption = !settings.replays
    ? 'Recording is off: songs you finish are not saved as replays'
    : `The newest ${limit} are saved${kept ? `, and ${kept === 1 ? 'the one' : `the ${kept}`} you keep` : ''}`;

  return (
    <div className="track-picker replays-panel">
      <div className="edit-head">
        <h2 className="page-title">Watch a replay</h2>
        <p className="head-count">{replays.length ? `${plural(replays.length, 'replay')} · ${caption}` : caption}</p>
      </div>
      <div className="library-body">
        <div className="track-column">
          <ul className="song-list" data-nav-group="replays" aria-label="Replays" ref={list}>
            {replays.map((r, i) => {
              const song = byId.get(r.songId);
              const Icon = PART_ICON[r.part];
              return (
                <li
                  key={r.id}
                  data-replay={r.id}
                  className={`song-item replay-item ${current?.id === r.id ? 'current' : ''}`}
                  style={{ ['--i' as string]: Math.min(i, 12) }}
                >
                  <button
                    type="button"
                    className="song-row"
                    data-autofocus={r.id === startId ? '' : undefined}
                    aria-label={`${r.title} by ${r.artist}, ${PART_LABEL[r.part]} on ${DIFFICULTY_LABEL[r.difficulty]}, played ${replayDate(r.date)}. Score ${r.results.score}, ${Math.round(r.results.accuracy * 100)} percent.${r.kept ? ' Kept.' : ''} Plays the replay.`}
                    onFocus={() => setCurrentId(r.id)}
                    onPointerEnter={(e) => e.pointerType === 'mouse' && setCurrentId(r.id)}
                    onClick={() => (setCurrentId(r.id), watch(r))}
                  >
                    <Cover blob={song?.cover} title={r.title} />
                    <span className="song-text">
                      <span className="song-title">{r.title}</span>
                      <span className="song-artist replay-row-sub">
                        <Icon strokeWidth={ICON_STROKE} aria-hidden />
                        {PART_LABEL[r.part]} · {DIFFICULTY_LABEL[r.difficulty]} · {replayDate(r.date)}
                      </span>
                    </span>
                    <span className="song-side">
                      {r.kept && (
                        <span className="replay-kept" role="img" aria-label="Kept">
                          <Pin strokeWidth={ICON_STROKE} aria-hidden />
                        </span>
                      )}
                      {r.best && <span className="pill lit replay-best">Best</span>}
                      <Stars n={r.results.stars} />
                      <span className="replay-row-score">{r.results.score.toLocaleString()}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn row-info"
                    data-nav-skip
                    aria-label={`Options for the replay of ${r.title}`}
                    onClick={() => (setCurrentId(r.id), setMenu(r))}
                  >
                    <Ellipsis strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                </li>
              );
            })}
            {replays.length === 0 && (
              <li className="empty-note replays-none">
                <Clapperboard strokeWidth={ICON_STROKE} aria-hidden />
                <p>
                  {settings.replays
                    ? 'No replays yet. Finish a song and its replay is here.'
                    : 'No replays yet. Recording is switched off in the settings.'}
                </p>
                {!settings.replays && (
                  <button type="button" className="btn" data-autofocus onClick={onSettings}>
                    <SettingsIcon strokeWidth={ICON_STROKE} aria-hidden />
                    Open the settings
                  </button>
                )}
              </li>
            )}
          </ul>
        </div>
        <aside className="side" aria-label="Highlighted replay">
          {!current && (
            <section className="now hub-intro">
              <div className="now-text">
                <h2 className="now-title">Your runs, again</h2>
                <p className="now-artist">
                  {settings.replays
                    ? 'Every song you finish is saved here as a replay, with the notes as you played them. Watch your runs again, pause on any moment, slow down the hard parts, and turn the best ones into a video.'
                    : 'Recording replays is switched off. Turn it on under Gameplay in the settings, and every song you finish is saved here.'}
                </p>
              </div>
            </section>
          )}
          {current && (
            <ReplayCard
              replay={current}
              song={byId.get(current.songId)}
              hints={hints}
              onWatch={() => watch(current)}
              onExport={() => actions.exportVideo(current)}
              onKeep={() => toggleKeep(current)}
              onDelete={() => setAsking(current)}
            />
          )}
        </aside>
      </div>

      {menu && (
        <Dialog title={`Replay of ${menu.title}`} variant="card" closeLabel="Close" onClose={() => setMenu(null)}>
          {(close) => (
            <div className="pause-card">
              <div className="setup-song">
                <Cover blob={byId.get(menu.songId)?.cover} title={menu.title} />
                <div className="song-text">
                  <span className="song-title">{menu.title}</span>
                  <span className="song-artist">
                    {PART_LABEL[menu.part]} · {DIFFICULTY_LABEL[menu.difficulty]} · {replayDate(menu.date)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="btn primary wide"
                data-autofocus
                onClick={() => {
                  close();
                  watch(menu);
                }}
              >
                <Play strokeWidth={ICON_STROKE} aria-hidden />
                Watch
              </button>
              <button
                type="button"
                className="btn wide"
                onClick={() => {
                  close();
                  actions.exportVideo(menu);
                }}
              >
                <Film strokeWidth={ICON_STROKE} aria-hidden />
                Export video
              </button>
              <button
                type="button"
                className="btn wide"
                onClick={() => {
                  close();
                  toggleKeep(menu);
                }}
              >
                {menu.kept ? <PinOff strokeWidth={ICON_STROKE} aria-hidden /> : <Pin strokeWidth={ICON_STROKE} aria-hidden />}
                {menu.kept ? 'Stop keeping it' : 'Keep it'}
              </button>
              <button
                type="button"
                className="btn wide"
                onClick={() => {
                  close();
                  setAsking(menu);
                }}
              >
                <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                Delete
              </button>
              <button type="button" className="btn quiet wide" data-sfx="back" onClick={close}>
                Close
              </button>
            </div>
          )}
        </Dialog>
      )}
      {asking && (
        <Dialog title="Delete this replay" variant="card" closeLabel="Keep it" onClose={() => setAsking(null)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Delete this replay?</h2>
              <p className="hint">
                The replay of {asking.title} from {replayDate(asking.date)} is gone for good. The song and its best score stay.
              </p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Keep it
              </button>
              <button
                type="button"
                className="btn danger wide"
                onClick={() => {
                  const r = asking;
                  setAsking(null);
                  void remove(r);
                }}
              >
                <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                Delete replay
              </button>
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
}

interface CardProps {
  replay: ReplayMeta;
  song: SongMeta | undefined;
  hints: ReturnType<typeof useHints>;
  onWatch(): void;
  onExport(): void;
  onKeep(): void;
  onDelete(): void;
}

/** The highlighted replay: how the run went, note by note, and what can be done with it. */
function ReplayCard({ replay: r, song, hints, onWatch, onExport, onKeep, onDelete }: CardProps) {
  const res = r.results;
  const Icon = PART_ICON[r.part];
  return (
    <section className="now hub-card replay-card" aria-live="off">
      <Cover blob={song?.cover} title={r.title} />
      <div className="now-text">
        <h2 className="now-title">{r.title}</h2>
        <p className="now-artist">{r.artist}</p>
        <p className="now-status replay-card-what">
          <Icon strokeWidth={ICON_STROKE} aria-hidden />
          {PART_LABEL[r.part]}
          <Pips difficulty={r.difficulty} />
          {DIFFICULTY_LABEL[r.difficulty]}
        </p>
        <p className="replay-card-date">
          {replayDate(r.date)}
          {r.duration > 0 && ` · ${clock(r.duration)}`}
        </p>
      </div>
      <div className="replay-card-score">
        <Stars n={res.stars} />
        <span className="num">{res.score.toLocaleString()}</span>
        {r.best && <span className="pill lit">New best then</span>}
        {res.fullCombo && <span className="pill ready">Full combo</span>}
      </div>
      <dl className="replay-stats">
        <div>
          <dt>Accuracy</dt>
          <dd>{Math.round(res.accuracy * 100)}%</dd>
        </div>
        <div>
          <dt>Best streak</dt>
          <dd>{res.bestStreak}</dd>
        </div>
        <div>
          <dt>Perfect</dt>
          <dd>{res.counts.perfect}</dd>
        </div>
        <div>
          <dt>Great</dt>
          <dd>{res.counts.great}</dd>
        </div>
        <div>
          <dt>Good</dt>
          <dd>{res.counts.good}</dd>
        </div>
        <div>
          <dt>Missed</dt>
          <dd>{res.counts.miss}</dd>
        </div>
      </dl>
      {!song && <p className="replay-card-note">The song is no longer in your library: the replay plays without its music.</p>}
      <div className="replay-card-actions" data-nav-group="replay-card">
        <button type="button" className="btn primary" onClick={onWatch}>
          <Play strokeWidth={ICON_STROKE} aria-hidden />
          Watch
        </button>
        <button type="button" className="btn" data-action="replay-export" onClick={onExport}>
          <Hint kbd={keysOf('home.replayExport').kbd} {...hints} />
          <Film strokeWidth={ICON_STROKE} aria-hidden />
          Video
        </button>
        <button type="button" className="btn" data-action="replay-keep" aria-pressed={r.kept} onClick={onKeep}>
          <Hint kbd={keysOf('home.replayKeep').kbd} {...hints} />
          <Pin strokeWidth={ICON_STROKE} aria-hidden />
          {r.kept ? 'Kept' : 'Keep'}
        </button>
        <button type="button" className="btn" data-action="replay-delete" aria-label="Delete this replay" onClick={onDelete}>
          <Hint kbd={keysOf('home.replayDelete').kbd} {...hints} />
          <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
          Delete
        </button>
      </div>
    </section>
  );
}
