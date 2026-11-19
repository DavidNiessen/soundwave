import {
  Clapperboard,
  Ellipsis,
  FilePlus2,
  Film,
  Pin,
  Trash2,
  ListMusic,
  PencilRuler,
  Play,
  Plus,
  Power,
  Search,
  Settings as SettingsIcon,
  Upload,
  Download,
  MonitorDown,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { canPlay, type AnalysisStatus } from '../analysis/manager';
import { playSfx } from '../audio/sfx';
import { formatTime, SET_MAX, suggestSets, type SuggestedSet } from '../game/setlist';
import type { SongMeta } from '../storage/db';
import { getInputMode, useInputMode, usesFocus } from '../input/inputMode';
import type { Settings } from '../game/settings';
import { focusStart, TAB_EVENT } from '../input/menuNav';
import { backInput } from '../input/pads';
import { menuPulse } from '../input/rumble';
import { useGlyphStyle } from '../input/usePads';
import { Hint, useActions } from './actions';
import { Mosaic } from './Cover';
import { ICON_STROKE } from './icons';
import { TrackPicker, type TrackPickerProps } from './TrackPicker';
import { ReplaysPanel, type ReplayActions, type ReplayCommands } from './ReplaysPanel';
import type { ReplayMeta } from '../storage/replays';
import { useSlide } from './useSlide';
import { keysOf } from '../input/bindings';

interface Props {
  songs: SongMeta[];
  status: Record<string, AnalysisStatus>;
  /** The player's own setlist, as songs. */
  setlist: SongMeta[];
  /** Songs with at least one score. */
  played: ReadonlySet<string>;
  /** Changes when the shuffle should deal again. */
  seed: number;
  importing: number;
  /** Whether the library has no songs yet. */
  empty: boolean;
  onLibrary(): void;
  onSet(ids: string[]): void;
  onAdd(): void;
  /** What the Edit tab's list of tracks needs to bring songs in and open them in the editor. */
  tracks: Omit<TrackPickerProps, 'songs' | 'status' | 'settings'>;
  /** The saved replays, newest first, and what can be done with them (the Replays tab). */
  replays: ReplayMeta[];
  replayActions: ReplayActions;
  onSettings(): void;
  /** Asks whether to close the game (absent where the game cannot close itself, as in a browser tab). */
  onExit?(): void;
  /** The version of an update that is ready to install, when the desktop app found one. */
  update?: string;
  onUpdate(): void;
  /** Offers the desktop app (absent in the desktop app itself). */
  onInstallApp?(): void;
  settings: Settings;
}

/** The parts of the main menu: playing sets, making charts, and watching runs again. */
type Tab = 'play' | 'edit' | 'replays';
const TABS: [Tab, string, LucideIcon][] = [
  ['play', 'Play', Play],
  ['edit', 'Edit', PencilRuler],
  ['replays', 'Replays', Clapperboard],
];
const tabIndex = (t: Tab) => TABS.findIndex(([id]) => id === t);
/**
 * The tab the menu was on last, for as long as the game is open: coming back from the editor lands
 * on Edit again, back from a replay on Replays, and a fresh start is always Play.
 */
let lastTab: Tab = 'play';

const total = (songs: SongMeta[]) => formatTime(songs.reduce((t, s) => t + s.duration, 0));
/** "3 songs · 9:12", or just "3 songs" while the length is not known yet. */
const summary = (songs: SongMeta[]) => [count(songs.length), total(songs)].filter(Boolean).join(' · ');
const count = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;

export function HomeScreen({
  songs,
  status,
  setlist,
  played,
  seed,
  importing,
  empty,
  onLibrary,
  onSet,
  onAdd,
  tracks,
  replays,
  replayActions,
  onSettings,
  onExit,
  update,
  onUpdate,
  onInstallApp,
  settings,
}: Props) {
  const style = useGlyphStyle(settings.glyphs);
  const mode = useInputMode();
  const [tab, setTabState] = useState<Tab>(lastTab);
  const [turn, setTurn] = useState<'fwd' | 'back'>('fwd');
  const tabRef = useRef(tab);
  tabRef.current = tab;
  /** Set when the tab was switched from the shoulder buttons (Q and E): focus then follows into it. */
  const follow = useRef(false);
  /** Presses of New track in the action bar, passed on to the list that owns the file chooser. */
  const [picks, setPicks] = useState(0);
  /** The Replays tab's shortcuts, which act on its highlighted replay. */
  const replayCommands = useRef<ReplayCommands | null>(null);
  const setTab = (t: Tab) => {
    if (t === tabRef.current) return;
    lastTab = t;
    setTurn(tabIndex(t) > tabIndex(tabRef.current) ? 'fwd' : 'back');
    setTabState(t);
  };

  useEffect(() => {
    const onTab = (e: Event) => {
      if (document.querySelector('[data-modal]')) return;
      const step = (e as CustomEvent<number>).detail;
      const next = TABS[tabIndex(tabRef.current) + step]?.[0];
      if (!next) return;
      playSfx('tab');
      menuPulse(step > 0 ? 'tab-right' : 'tab-left');
      follow.current = true;
      setTab(next);
    };
    window.addEventListener(TAB_EVENT, onTab);
    return () => window.removeEventListener(TAB_EVENT, onTab);
  }, []);
  useEffect(() => {
    if (!follow.current) return;
    follow.current = false;
    const body = document.querySelector('.home-body');
    if (body && usesFocus(getInputMode())) focusStart(body);
  }, [tab]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  // Suggested sets are made of songs that can be played: analysed, with notes on some part.
  const ready = useMemo(() => songs.filter((s) => canPlay(status[s.id])), [songs, status]);
  const sets: SuggestedSet[] = useMemo(() => suggestSets(ready, played, seed), [ready, played, seed]);
  const own = songs.length;

  const touch = mode === 'touch';
  // Tiles that were here when the screen opened arrive together; one that turns up later (a set
  // that became possible after an import) opens its own space instead of shoving the others aside.
  const opening = useRef<Set<string> | null>(null);
  opening.current ??= new Set([...sets.map((s) => s.id), ...(empty ? ['add'] : [])]);
  const late = (id: string) => (opening.current!.has(id) ? '' : 'late');

  useActions([
    ...(tab === 'play'
      ? [{ id: 'add', label: importing ? `Importing ${importing}…` : 'Add songs', icon: Upload, ...keysOf('home.add'), run: onAdd }]
      : tab === 'replays'
        ? replays.length
          ? [
              {
                id: 'replay-options',
                label: 'Options',
                icon: Ellipsis,
                ...keysOf('home.replayOptions'),
                run: () => replayCommands.current?.options(),
              },
              {
                id: 'replay-export',
                label: 'Export video',
                icon: Film,
                ...keysOf('home.replayExport'),
                bar: false,
                run: () => replayCommands.current?.exportVideo(),
              },
              {
                id: 'replay-keep',
                label: 'Keep',
                icon: Pin,
                ...keysOf('home.replayKeep'),
                bar: false,
                run: () => replayCommands.current?.keep(),
              },
              {
                id: 'replay-delete',
                label: 'Delete',
                icon: Trash2,
                ...keysOf('home.replayDelete'),
                bar: false,
                run: () => replayCommands.current?.remove(),
              },
            ]
          : []
        : [
            {
              id: 'search',
              label: 'Search',
              icon: Search,
              ...keysOf('home.search'),
              bar: false,
              run: () => document.querySelector<HTMLInputElement>('.track-picker input[type=search]')?.focus(),
            },
            { id: 'new', label: 'New track', icon: FilePlus2, ...keysOf('home.new'), primary: true, run: () => setPicks((n) => n + 1) },
          ]),
    { id: 'settings', label: 'Settings', icon: SettingsIcon, ...keysOf('home.settings'), run: onSettings },
    ...(update
      ? [{ id: 'update', label: `Update to ${update}`, icon: Download, ...keysOf('home.update'), bar: false, run: onUpdate }]
      : []),
    ...(onInstallApp
      ? [{ id: 'install-app', label: 'Get the app', icon: MonitorDown, ...keysOf('home.install'), bar: false, run: onInstallApp }]
      : []),
    // Esc and the controller's back button: there is nowhere further back than out.
    ...(onExit ? [{ id: 'exit', label: 'Exit', icon: Power, kbd: 'Escape', bar: false, run: onExit }] : []),
  ]);

  const tabRow = useSlide<HTMLDivElement>(tab);

  return (
    <div className="page home" data-nav-bar>
      <header className="page-head home-head">
        <h1 className="wordmark">Soundwave</h1>
        <div className="tabs home-tabs">
          <Hint {...keysOf('menus.tabPrev')} mode={mode} style={style} />
          <div className="tab-row slide" role="tablist" aria-label="Main menu" ref={tabRow} data-nav-group="home-tabs">
            <span className="sel" aria-hidden />
            {TABS.map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                id={`home-tab-${id}`}
                aria-selected={tab === id}
                aria-controls="home-panel"
                data-on={tab === id}
                className={`tab ${tab === id ? 'on' : ''}`}
                onClick={() => setTab(id)}
              >
                <Icon strokeWidth={ICON_STROKE} aria-hidden />
                <span className="tab-label">{label}</span>
              </button>
            ))}
          </div>
          <Hint {...keysOf('menus.tabNext')} mode={mode} style={style} />
        </div>
        {update && (
          <button type="button" className="btn head-btn update-btn" data-action="update" onClick={onUpdate}>
            <Hint kbd={keysOf('home.update').kbd} mode={mode} style={style} />
            <Download strokeWidth={ICON_STROKE} aria-hidden />
            Update to {update}
          </button>
        )}
        {onInstallApp && (
          <button type="button" className="btn head-btn install-btn" data-action="install-app" onClick={onInstallApp}>
            <Hint kbd={keysOf('home.install').kbd} mode={mode} style={style} />
            <MonitorDown strokeWidth={ICON_STROKE} aria-hidden />
            Get the app
          </button>
        )}
        {onExit && (
          <button type="button" className="btn exit-btn" data-action="exit" data-sfx="back" onClick={onExit}>
            <Hint kbd="Escape" pad={backInput(style)} mode={mode} style={style} />
            <Power strokeWidth={ICON_STROKE} aria-hidden />
            Exit
          </button>
        )}
      </header>
      <main
        className={`page-body home-body ${turn}`}
        data-tab={tab}
        key={tab}
        id="home-panel"
        role="tabpanel"
        aria-labelledby={`home-tab-${tab}`}
      >
        {tab === 'replays' ? (
          <ReplaysPanel
            replays={replays}
            songs={songs}
            settings={settings}
            actions={replayActions}
            onSettings={onSettings}
            commands={replayCommands}
          />
        ) : tab === 'play' ? (
          <>
            <h2 className="page-title">Pick a set</h2>
            <div className="tiles" data-nav-group="tiles">
              {/* The feature: the player's own set, with its covers, and its songs in order. */}
              <button
                type="button"
                className="tile hero"
                data-autofocus
                aria-label={
                  setlist.length
                    ? `Your setlist: ${summary(setlist).replace(' · ', ', ')}`
                    : 'Your setlist: empty. Pick up to four songs from your library.'
                }
                onClick={onLibrary}
              >
                {setlist.length ? (
                  <Mosaic songs={setlist} />
                ) : (
                  <span className="mosaic blank" aria-hidden>
                    <ListMusic strokeWidth={ICON_STROKE} />
                  </span>
                )}
                <span className="tile-text">
                  <span className="tile-title">Your setlist</span>
                  <span className="tile-cap">{setlist.length ? summary(setlist) : 'Pick up to four songs from your library'}</span>
                  <span className="hero-songs">
                    {Array.from({ length: SET_MAX }, (_, i) => {
                      const s = setlist[i];
                      return (
                        <span key={i} className={`hero-song ${s ? '' : 'open'}`}>
                          <span className="hero-num">{i + 1}</span>
                          <span className="hero-name">{s ? s.title : 'Open slot'}</span>
                          {s && <span className="hero-by">{s.artist}</span>}
                        </span>
                      );
                    })}
                  </span>
                </span>
              </button>
              {(sets.length > 0 || empty) && (
                <div className="tile-stack">
                  {sets.map((set, i) => {
                    const list = set.songs.map((id) => byId.get(id)!).filter(Boolean);
                    return (
                      <button
                        type="button"
                        key={set.id}
                        className={`tile ${late(set.id)}`}
                        style={{ ['--i' as string]: i + 1 }}
                        onClick={() => onSet(set.songs)}
                      >
                        <Mosaic songs={list} />
                        <span className="tile-text">
                          <span className="tile-title">{set.title}</span>
                          <span className="tile-cap">{set.caption}</span>
                          <span className="tile-meta">{summary(list)}</span>
                        </span>
                      </button>
                    );
                  })}
                  {empty && (
                    <button
                      type="button"
                      className={`tile add ${late('add')}`}
                      style={{ ['--i' as string]: sets.length + 1 }}
                      onClick={onAdd}
                    >
                      <span className="mosaic blank dashed" aria-hidden>
                        <Plus strokeWidth={ICON_STROKE} />
                      </span>
                      <span className="tile-text">
                        <span className="tile-title">Add your music</span>
                        <span className="tile-cap">
                          {touch ? 'Pick files from this device.' : 'Drop files anywhere or browse.'} MP3, WAV, FLAC, OGG and M4A. Each song
                          takes about a minute to turn into charts.
                        </span>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Edit is a workbench, not a shelf: the tracks themselves, and a press on one opens it in the editor. */}
            <div className="edit-head">
              <h2 className="page-title">Edit a track</h2>
              <p className="head-count">
                {own
                  ? `${own} ${own === 1 ? 'track' : 'tracks'} · pick one to open it in the editor`
                  : 'Bring in a song to write its charts'}
              </p>
            </div>
            <TrackPicker songs={songs} status={status} settings={settings} pickSignal={picks} {...tracks} />
          </>
        )}
      </main>
    </div>
  );
}
