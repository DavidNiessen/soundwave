import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  answerDiscordJoin,
  onDiscordJoin,
  onDiscordJoinRequest,
  setDiscordEnabled,
  setDiscordJoin,
  showScene,
  type JoinRequest,
} from '../app/discord';
import { findStage } from '../game/stages';
import { setActiveStage } from '../render/stage/showStage';
import { analysisHold } from '../analysis/hold';
import { analysisManager, canPlay } from '../analysis/manager';
import { stemModel } from '../analysis/separation/model';
import { analysisDevice, isHandheld, type AnalysisDevice } from '../analysis/separation/support';
import { getEngine } from '../audio/engine';
import { ACCEPTED, isAudioFile, readSongFile } from '../audio/importSong';
import { menuMusicStatus, setMenuMusic, setMusicVolume } from '../audio/menuMusic';
import { isPreviewing, previewSong, previewStatus, setPreviewVolume, watchPreview } from '../audio/preview';
import { loadSfx, playSfx, setSfxVolume, sfxStatus } from '../audio/sfx';
import { forgetSongBuffer, loadSongBuffer } from '../audio/songAudio';
import type { Chart, Part } from '../chart/types';
import { detectGrid } from '../editor/detect';
import { emptyEdits } from '../editor/edits';
import type { Results } from '../game/GameSession';
import type { ReplayInputs } from '../game/replay';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  applyDisplayMode,
  canExit,
  exitApp,
  followDisplayMode,
  inDesktopApp,
  isFullscreenToggle,
  onFullscreenShortcut,
  onMac,
  toggledMode,
} from '../game/displayMode';
import {
  loadPick,
  loadSetlist,
  partAmong,
  pruneSetlist,
  savePick,
  saveSetlist,
  SET_MAX,
  songParts,
  toggleSong,
  type Pick,
  type ThinParts,
} from '../game/setlist';
import { loadSettings, saveSettings, type DisplayMode, type Settings } from '../game/settings';
import { getInputMode, installInputMode, setInputMode, usesFocus } from '../input/inputMode';
import { EDIT_EVENT, focusStart, focusStartSettled, installMenuNav } from '../input/menuNav';
import { followOutputDevice, muteWhileUnfocused } from '../audio/output';
import { pads, resolveStyle } from '../input/pads';
import { setBindings } from '../input/bindings';
import { menuPulse, setMenuRumble } from '../input/rumble';
import {
  deleteReplays,
  deleteSong,
  getReplayData,
  getSong,
  listAllScores,
  listReplays,
  listSongs,
  pruneReplays,
  putReplay,
  StorageBlockedError,
  submitScore,
  updateReplay,
  type BestScore,
  type SongMeta,
} from '../storage/db';
import { getMedia } from '../storage/stageMedia';
import { cleanChart, newReplayId, type ReplayData, type ReplayMeta, type ReplayMode } from '../storage/replays';
import { soundwaveFileName, isSoundwaveFile } from '../storage/soundwaveFile';
import { chooseSaveTarget, saveSongFile, watchOpenedFiles, type SaveTarget } from '../storage/share';
import { videoFileName, type VideoExportSettings } from '../game/videoExport';
import { songSamples, type VideoPlan } from '../game/videoRender';
import { resolveGraphics } from '../game/graphics';
import { videoExports } from '../video/exports';
import type { VideoJob } from '../video/protocol';
import { stageLook, type StageDef } from '../game/stages';
import { ExportVideoDialog, VideoExportScreen } from './VideoExport';
import { readSongPackage, songFile, storeNewSong, storeSongPackage, updateSongMeta } from '../storage/songFile';
import { ActionBar, useActions } from './actions';
import { Dialog } from './Dialog';
import type { PickedSong } from './TrackPicker';
import { EditorScreen } from './EditorScreen';
import { FocusRing } from './FocusRing';
import { HomeScreen, showOnlineTab } from './HomeScreen';
import { DIFFICULTY_LABEL, PART_LABEL } from './icons';
import { LibraryScreen, type SongStatus } from './LibraryScreen';
import { LobbyScreen } from './LobbyScreen';
import { watchStageLoading } from '../render/stage/StageView';
import { bootDone, bootStep } from './boot';
import { MenuBackground } from './MenuBackground';
import { onBackdrop } from './windowDrag';
import { InstallAppCard, UpdateCard } from './AppUpdates';
import { checkForUpdates, updates } from '../app/updates';
import { PlayScreen } from './PlayScreen';
import { ReplayScreen } from './ReplayScreen';
import { ResultsScreen, SummaryScreen, type SetResult } from './ResultsScreen';
import { SettingsScreen } from './SettingsScreen';
import { StageBackdrop } from './StageBackdrop';
import type { SongActions } from './SongMenu';
import { SongSheet } from './SongSheet';
import { MetadataSheet } from './MetadataSheet';
import { PartyBoard, PartyScreen, type LastRun } from './PartyScreen';
import { setMenuAvatars, setMenuRing } from '../render/aurora/menuStage';
import type { Avatars } from '../render/stage/Stage';
import type { RingSeat } from '../render/aurora/ring';
import { BoardsScreen } from './Boards';
import { AdminScreen } from './ServerAdmin';
import { decodeRun, encodeRun } from '../net/runs';
import { replayResults } from '../game/replay';
import { joinSecret, online, partyId, parseInvite, parseJoinSecret, parseRecovery, type PartyStart } from '../net/client';
import { partySongs } from '../net/partySongs';
import { serverSongs, sharedMeta } from '../net/serverSongs';
import { identity } from '../net/identity';
import { IdentityDialog } from './IdentityDialog';
import { PARTY_MAX, type SharedSong, type WireChart } from '../net/protocol';
import { notify } from './notify';
import { Notifications } from './Notifications';
import { VirtualKeyboard } from './VirtualKeyboard';
import { installUiSounds } from './uiSounds';

/** The identity (its creation time) the player was last asked to back up. */
const BACKUP_ASKED = 'soundwave.identity-backup-asked';
type LobbyView = { name: 'lobby'; ids: string[]; from: 'home' | 'library' };
/** A song open in the track editor; `tested` is how the last test play of its chart went. */
type EditorView = { name: 'editor'; song: SongMeta; back: View; tested?: Results };

/** A set being played: its songs with their charts, where it is, and what has been scored so far. */
interface Run {
  songs: SongMeta[];
  charts: Chart[];
  index: number;
  results: SetResult[];
  pick: Pick;
  /** Per song, the parts with notes at the set's difficulty: the next song's part is chosen among them. */
  parts?: Part[][];
  lobby: LobbyView;
  /** A chart played from the track editor: where to go back to, and where in the song it starts. */
  test?: { back: EditorView; startAt: number };
  /** A song played with a party: which of its set, and when it starts (performance.now ms). */
  /** A party's song: its place in the party's run, when it starts, and the mode it is played in (taken at the start, as the party may change mode before the song is saved). */
  party?: { songIndex: number; at: number; mode: 'versus' | 'showdown' };
}

type View =
  | { name: 'home' }
  /** `from`: the party, when its host picks the party's songs here (Back and Ready return there). */
  | { name: 'library'; from?: 'party' }
  | LobbyView
  /** Playing together on a server: signing in, the party's lobby and its results. */
  | { name: 'party' }
  /** The server's leaderboards and shared replays. */
  /** `from`: where Back returns to (Play together, unless opened from the main menu). */
  | { name: 'boards'; from?: 'home' }
  | { name: 'admin' }
  /** The player's look on the stage. */
  | { name: 'settings'; back: View }
  | EditorView
  | { name: 'play'; run: Run; buffer: AudioBuffer; key: number }
  /** A saved replay being watched; `silent`: its song is gone, so it plays without music. */
  | { name: 'replay'; meta: ReplayMeta; data: ReplayData; buffer: AudioBuffer; silent: boolean; back: View; key: number }
  /** A replay's video being recorded into `target`. */
  | {
      name: 'export';
      meta: ReplayMeta;
      data: ReplayData;
      buffer: AudioBuffer;
      video: VideoExportSettings;
      plan: VideoPlan;
      target: SaveTarget;
      fileName: string;
      back: View;
      key: number;
    }
  | { name: 'results'; run: Run }
  | { name: 'summary'; run: Run };

/** While it is mounted (the launch wipe), no screen's actions answer keys or buttons. */
function Busy() {
  useActions([]);
  return null;
}

const DEPTH: Record<View['name'], number> = {
  home: 0,
  library: 1,
  settings: 1,
  lobby: 2,
  party: 2,
  boards: 3,
  admin: 3,
  editor: 2,
  play: 3,
  replay: 3,
  export: 3,
  results: 4,
  summary: 5,
};

/** What stands behind the highway in a replay's video: the player's stage, as far as a worker can draw it. */
async function videoBackdrop(def: StageDef): Promise<VideoJob['backdrop']> {
  const b = def.backdrop;
  if (b.kind === 'venue') return { kind: 'venue', venue: def.venueId, look: stageLook(def) };
  if (b.kind === 'gradient') return { kind: 'gradient', colors: [b.from, b.to], dim: def.dim };
  // The player's file, read here: the worker has no way into the page's stage files.
  const file = b.media ? await getMedia(b.media) : null;
  return file ? { kind: b.kind, file: file.blob, dim: def.dim } : { kind: 'night' };
}

/** Silence the length of a song, for a replay whose song has left the library (a low rate keeps it small). */
function silence(seconds: number): AudioBuffer {
  const rate = 8000;
  return getEngine().ctx.createBuffer(1, Math.max(1, Math.ceil((seconds + 1) * rate)), rate);
}

export function App() {
  const [view, setView] = useState<View>({ name: 'home' });
  const [songs, setSongs] = useState<SongMeta[]>([]);
  const [scores, setScores] = useState<BestScore[]>([]);
  /** The saved replays, newest first. */
  const [replays, setReplays] = useState<ReplayMeta[]>([]);
  /** What has come back from storage since the game opened. */
  const [loaded, setLoaded] = useState({ songs: false, scores: false });
  /** The first screen waits for the library, so it arrives whole instead of filling in piece by piece. */
  const [booted, setBooted] = useState(false);
  /** The stage behind the menus has been built and has drawn (or cannot be built). */
  const [stageReady, setStageReady] = useState(false);
  const onStage = useCallback(() => setStageReady(true), []);
  const [importing, setImporting] = useState(0);
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // The player's shortcuts, for every screen drawn from here (they read them as they draw).
  setBindings(settings.bindings);
  const [setlist, setSetlistState] = useState<string[]>(loadSetlist);
  const [pick, setPickState] = useState<Pick>(loadPick);
  const [seed, setSeed] = useState(() => Date.now());
  const [sheet, setSheet] = useState<SongMeta | null>(null);
  /** The song whose details are being edited (see MetadataSheet). */
  const [metaSong, setMetaSong] = useState<SongMeta | null>(null);
  /** The song highlighted in the library or the track list: its preview plays. */
  const [highlight, setHighlight] = useState<string | null>(null);
  const [exitAsk, setExitAsk] = useState(false);
  /** The card that offers an update (desktop app), or the desktop app itself (website). */
  const [appCard, setAppCard] = useState<'update' | 'install' | null>(null);
  const update = useSyncExternalStore(updates.subscribe, updates.snapshot);
  // The desktop app looks for a new release a few seconds after it opens (not in development).
  useEffect(() => {
    if (!booted || import.meta.env.DEV || !settings.checkUpdates) return;
    const soon = window.setTimeout(() => void checkForUpdates(true), 4000);
    return () => clearTimeout(soon);
  }, [booted, settings.checkUpdates]);
  /** The settings, open over a paused song. */
  const [songSettings, setSongSettings] = useState(false);
  /** The text field the on-screen keyboard is open for (a controller pressed it). */
  const [typing, setTyping] = useState<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const edit = (e: Event) => {
      const field = (e as CustomEvent<HTMLElement>).detail;
      if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && !field.disabled && !field.readOnly)
        setTyping(field);
    };
    // The game has no use for the browser's right-click menu, anywhere.
    const noMenu = (e: Event) => e.preventDefault();
    window.addEventListener(EDIT_EVENT, edit);
    window.addEventListener('contextmenu', noMenu);
    return () => {
      window.removeEventListener(EDIT_EVENT, edit);
      window.removeEventListener('contextmenu', noMenu);
    };
  }, []);
  const fileInput = useRef<HTMLInputElement>(null);
  const updateSettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
  }, []);

  const setSetlist = useCallback((next: string[]) => {
    setSetlistState(next);
    saveSetlist(next);
  }, []);
  const setPick = useCallback((next: Pick) => {
    setPickState(next);
    savePick(next);
  }, []);

  // Input: controllers are polled from the start; the keyboard and controllers both move focus.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  useEffect(() => {
    pads.start();
    const stopMode = installInputMode();
    const stopNav = installMenuNav(() => resolveStyle(settingsRef.current.glyphs, pads.snapshot().family));
    const stopSounds = installUiSounds();
    void loadSfx();
    if (import.meta.env.DEV)
      Object.assign(window, {
        __audio: { sfx: sfxStatus, music: menuMusicStatus },
        __input: setInputMode,
        __analysis: analysisManager,
        __stemModel: stemModel,
        __pads: pads,
        __preview: previewStatus,
      });
    return () => {
      stopMode();
      stopNav();
      stopSounds();
    };
  }, []);
  useEffect(() => setSfxVolume(settings.sfxVolume), [settings.sfxVolume]);
  useEffect(() => setMusicVolume(settings.musicVolume), [settings.musicVolume]);
  useEffect(() => (settings.muteUnfocused ? muteWhileUnfocused() : undefined), [settings.muteUnfocused]);
  useEffect(() => followOutputDevice(settings.outputDevice), [settings.outputDevice]);
  useEffect(() => setMenuRumble(settings.rumble, settings.ps5Haptics), [settings.rumble, settings.ps5Haptics]);
  useEffect(() => void applyDisplayMode(settings.displayMode), [settings.displayMode]);
  // Alt+Enter, and F11 in the desktop app, switch between a window and the way of filling the screen
  // used last (fullscreen or windowed fullscreen), as the Window mode setting (so the settings show it). In a browser tab Alt+Enter asks the browser
  // for fullscreen instead (F11 is the browser's own). Taken before anything else hears the keys, so
  // the Enter does not also press the focused button or play a lane.
  const settingsNow = useRef(settings);
  settingsNow.current = settings;
  const lastFullMode = useRef<Exclude<DisplayMode, 'windowed'> | null>(null);
  if (settings.displayMode !== 'windowed') lastFullMode.current = settings.displayMode;
  useEffect(() => {
    const desktop = inDesktopApp();
    const toggle = () => {
      const s = settingsNow.current;
      updateSettings({ ...s, displayMode: toggledMode(s.displayMode, lastFullMode.current) });
    };
    const key = (e: KeyboardEvent) => {
      if (!isFullscreenToggle(e, desktop)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.repeat) return;
      if (desktop) toggle();
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      else void document.documentElement.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener('keydown', key, true);
    // On a Mac, the menu bar's Toggle Full Screen (Control+Command+F) does the same.
    const stopMenu = onFullscreenShortcut(toggle);
    // The system can change the mode by itself too (the green button): the setting follows.
    const stopFollow = followDisplayMode((mode) => {
      const s = settingsNow.current;
      if (s.displayMode !== mode) updateSettings({ ...s, displayMode: mode });
    });
    return () => {
      window.removeEventListener('keydown', key, true);
      stopMenu();
      stopFollow();
    };
  }, [updateSettings]);
  // In Window mode the menus' background moves the window (see windowDrag). Not in a song or the
  // editor, where the mouse plays and edits.
  const windowed = inDesktopApp() && settings.displayMode === 'windowed';
  // A Mac window shows its title bar buttons over the game (see .mac-titlebar).
  useEffect(() => {
    document.documentElement.classList.toggle('mac-titlebar', windowed && onMac());
  }, [windowed]);
  useEffect(() => {
    if (!windowed) return;
    const press = (e: MouseEvent) => {
      if (e.button !== 0 || e.detail !== 1 || e.defaultPrevented || !(e.target instanceof Element)) return;
      const menu = e.target.closest('.menu');
      if (!menu || !onBackdrop(e.target, menu)) return;
      e.preventDefault();
      void getCurrentWindow()
        .startDragging()
        .catch(() => {});
    };
    window.addEventListener('mousedown', press);
    return () => window.removeEventListener('mousedown', press);
  }, [windowed]);
  useEffect(() => document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale)), [settings.uiScale]);
  // Motion: the player's choice, or the system's when they left it alone.
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => {
      const reduced = settings.motion === 'reduced' || (settings.motion === 'system' && media.matches);
      document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.motion]);

  const refresh = useCallback(async () => {
    try {
      setSongs(await listSongs());
    } catch (e) {
      setSongs([]);
      notify.error(
        e instanceof StorageBlockedError
          ? e.message
          : 'Song storage is unavailable in this browser window. Imported songs will not be saved.',
      );
    }
    setLoaded((l) => (l.songs ? l : { ...l, songs: true }));
  }, []);
  const refreshScores = useCallback(async () => {
    try {
      setScores(await listAllScores());
    } catch {
      /* scores are best-effort */
    }
    setLoaded((l) => (l.scores ? l : { ...l, scores: true }));
  }, []);

  const refreshReplays = useCallback(async () => {
    try {
      setReplays(await listReplays());
    } catch {
      /* replays are best-effort */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshScores();
    void refreshReplays();
  }, [refresh, refreshScores, refreshReplays]);

  // Every song is separated into stems before it is charted. The model for that is fetched once,
  // the first time the game opens on a device that can run it.
  const model = useSyncExternalStore(stemModel.subscribe, stemModel.snapshot);
  const [device, setDevice] = useState<AnalysisDevice | null>(null);
  useEffect(() => {
    let live = true;
    void analysisDevice().then(async (d) => {
      if (!live) return;
      setDevice(d);
      if (d !== 'none' && !isHandheld() && (await stemModel.check()) === 'absent') void stemModel.ensure().catch(() => {});
    });
    return () => {
      live = false;
    };
  }, []);
  const modelWas = useRef(model.state);
  useEffect(() => {
    const was = modelWas.current;
    modelWas.current = model.state;
    // The download itself shows in the progress bar of the song waiting for it; only a failure is news.
    if (was !== model.state && model.state === 'error' && model.error) notify.error(model.error);
  }, [model]);

  const analysisStatus = useSyncExternalStore(analysisManager.subscribe, analysisManager.snapshot);
  const status: Record<string, SongStatus> = analysisStatus;

  // Analyze new songs automatically; previously analyzed ones load from the cache.
  useEffect(() => {
    // Not before it is known what this device can do: that decides which stored analyses count.
    if (!device) return;
    for (const s of songs) if (!analysisStatus[s.id]) void analysisManager.check(s.id, true);
  }, [songs, analysisStatus, device]);

  // The loading screen stays until everything is there: the library, the scores, which songs have
  // charts, and the stage behind the menus, built and drawn. Then the game opens in a quiet moment,
  // so the entrance plays smoothly. Nothing holds it for ever: what has not come after a long wait
  // is opened without.
  const [patience, setPatience] = useState(0);
  useEffect(() => {
    const a = window.setTimeout(() => setPatience(1), 8000);
    const b = window.setTimeout(() => setPatience(2), 30000);
    return () => (clearTimeout(a), clearTimeout(b));
  }, []);
  const libraryKnown = loaded.songs && loaded.scores && !!device && songs.every((s) => analysisStatus[s.id]);
  const libraryReady = libraryKnown || patience >= 1;
  const known = libraryReady && (stageReady || patience >= 2);
  useEffect(() => {
    if (booted) return bootDone();
    if (!libraryReady) return bootStep(0.2, 'Opening your library');
    if (!known) return watchStageLoading((share) => bootStep(0.35 + share * 0.5, share < 1 ? 'Loading the stage' : 'Building the stage'));
    bootStep(1, 'Ready');
  }, [booted, libraryReady, known]);
  useEffect(() => {
    if (booted) return;
    if (!known) return;
    if (typeof requestIdleCallback !== 'function') {
      const soon = window.setTimeout(() => setBooted(true), 60);
      return () => clearTimeout(soon);
    }
    const idle = requestIdleCallback(() => setBooted(true), { timeout: 400 });
    return () => cancelIdleCallback(idle);
  }, [known, booted]);

  const byId = useMemo(() => new Map(songs.map((s) => [s.id, s])), [songs]);
  /** The player's own last song in a party, for the stats between a Showdown's songs. */
  const [lastRun, setLastRun] = useState<LastRun | undefined>();
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  // The party sees the songs held for it as songs the player has, beside their library.
  const held = useSyncExternalStore(partySongs.subscribe, partySongs.songs);
  const server = useSyncExternalStore(serverSongs.subscribe, serverSongs.snapshot);
  const onlineState = useSyncExternalStore(online.subscribe, online.snapshot);
  const partyLibrary = useMemo(() => {
    const ids = Object.keys(held);
    const streamed = Object.values(server.held);
    if (!ids.length && !streamed.length) return byId;
    const all = new Map(byId);
    for (const id of ids) if (!all.has(id)) all.set(id, held[id].meta);
    for (const song of streamed) if (!all.has(song.id)) all.set(song.id, song);
    return all;
  }, [byId, held, server.held]);
  /** Per song, the parts it hardly has: they are not offered for playing. */
  const thin: ThinParts = useMemo(() => Object.fromEntries(Object.entries(status).map(([id, s]) => [id, s.thin])), [status]);
  // Songs that were removed leave the setlist with them. A server's song stays while the server has
  // it (streamed, on its way, or kept on this device to stream again); while the server's list has
  // not come yet, its songs are left alone.
  const serverWaiting = !!onlineState.server && onlineState.status !== 'off' && onlineState.status !== 'signed-out' && !server.ready;
  useEffect(() => {
    if (!songs.length || serverWaiting) return;
    const onServer = server.list.map((x) => x.id);
    const kept = pruneSetlist(
      setlist,
      new Set([...songs.map((s) => s.id), ...Object.keys(server.held), ...Object.keys(server.coming), ...onServer]),
    );
    if (kept.length !== setlist.length) setSetlist(kept);
  }, [songs, setlist, setSetlist, server.held, server.coming, server.list, serverWaiting]);
  const setSongs_ = useMemo(
    () =>
      setlist
        .map((id) => {
          const listed = server.list.find((x) => x.id === id);
          return byId.get(id) ?? server.held[id] ?? server.coming[id]?.meta ?? (listed ? sharedMeta(listed) : undefined);
        })
        .filter((s): s is SongMeta => !!s),
    [setlist, byId, server.held, server.coming, server.list],
  );
  // The setlist's songs from a server come in the background (from this device where they are kept),
  // so they are ready by the time they are played.
  useEffect(() => {
    if (!server.ready) return;
    void serverSongs.ensure(setlist.filter((id) => !byId.has(id)));
  }, [server.ready, setlist, byId]);
  useEffect(() => serverSongs.setQuality(settings.streamQuality), [settings.streamQuality]);
  /** A song the player can play: from the library (analysed, with notes), or streamed from the server. */
  const playable = (id: string) => (byId.has(id) && canPlay(analysisStatus[id])) || !!server.held[id];
  const setlistRef = useRef(setlist);
  setlistRef.current = setlist;
  const played = useMemo(() => new Set(scores.map((s) => s.songId)), [scores]);

  /** Adds audio files and .soundwave song files to the library. Resolves to the songs they hold. */
  const importFiles = useCallback(
    async (files: File[]): Promise<SongMeta[]> => {
      const usable = files.filter((f) => isSoundwaveFile(f) || isAudioFile(f));
      const skipped = files.length - usable.length;
      if (skipped === 1)
        notify.warning(`Skipped ${files.find((f) => !usable.includes(f))!.name}: it is not an audio file or a Soundwave song.`);
      else if (skipped > 1) notify.warning(`Skipped ${skipped} files that are not audio files or Soundwave songs.`);
      setImporting((n) => n + usable.length);
      const got: SongMeta[] = [];
      for (const f of usable) {
        try {
          const song = isSoundwaveFile(f) ? await readSongPackage(f, f.name) : await readSongFile(f);
          const { meta } = song;
          const had = await getSong(meta.id);
          if (had) {
            notify.info(`"${had.title}" is already in your library.`);
            got.push(had);
            continue;
          }
          // A re-import of a removed song starts clean: no stale status or failed analysis.
          forgetSongBuffer(meta.id);
          analysisManager.forget(meta.id);
          if ('audio' in song) await storeSongPackage(song);
          else await storeNewSong(meta, new Blob([song.bytes], { type: meta.mime }));
          playSfx('add');
          got.push(meta);
        } catch (e) {
          notify.error(`Could not import ${f.name}: ${(e as Error).message}`);
        } finally {
          setImporting((n) => n - 1);
        }
      }
      await refresh();
      return got;
    },
    [refresh],
  );
  // Song files the desktop app is opened with (double-clicked in Explorer) are added, and a single
  // one opens on its page.
  const openedRef = useRef<(files: File[]) => void>(() => {});
  openedRef.current = (files) =>
    void importFiles(files).then((got) => {
      if (got.length === 1 && view.name !== 'play' && view.name !== 'replay' && view.name !== 'export' && view.name !== 'editor')
        setSheet(got[0]);
    });
  useEffect(() => watchOpenedFiles((files) => openedRef.current(files)), []);
  // Invite links: the desktop app opens soundwave://join links, and the web game is opened with
  // ?server=…&invite=… by a server's join page. Either lands on Play together, ready to join.
  const inviteRef = useRef<(text: string) => void>(() => {});
  inviteRef.current = (text) => {
    // A recovery link: the account it is for takes this game's identity.
    const recovery = parseRecovery(text);
    if (recovery)
      return void online.recover(recovery.server, recovery.code).then(
        () => {
          notify.success(`Your account on ${online.snapshot().info?.name ?? 'the server'} is back, with this game’s identity.`);
          if (!['play', 'replay', 'export', 'editor'].includes(viewRef.current.name)) goOnline();
        },
        (e: Error) => notify.error(e.message),
      );
    const invite = parseInvite(text);
    if (!invite) return;
    void online.useInvite(invite).then(
      () => {
        if (!['play', 'replay', 'export', 'editor'].includes(viewRef.current.name)) setView({ name: 'party' });
      },
      (e: Error) => notify.error(e.message),
    );
  };
  const invitesWatched = useRef(false);
  useEffect(() => {
    if (!booted || invitesWatched.current) return;
    invitesWatched.current = true;
    if (!inDesktopApp()) {
      const here = new URL(location.href);
      if (!here.searchParams.has('invite') && !here.searchParams.has('recover')) return;
      inviteRef.current(here.href);
      // The invite is not left in the address, where a reload or a shared tab would carry it on.
      here.searchParams.delete('invite');
      here.searchParams.delete('recover');
      here.searchParams.delete('server');
      history.replaceState(history.state, '', here.pathname + here.search + here.hash);
      return;
    }
    let stop = () => {};
    void import('@tauri-apps/plugin-deep-link')
      .then(async ({ getCurrent, onOpenUrl }) => {
        for (const url of (await getCurrent()) ?? []) inviteRef.current(url);
        stop = await onOpenUrl((urls) => urls.forEach((url) => inviteRef.current(url)));
      })
      .catch(() => {});
    return () => stop();
  }, [booted]);
  const exportSong = useCallback(async (song: SongMeta) => {
    try {
      if (await saveSongFile(await songFile(song.id), soundwaveFileName(song)))
        notify.success(`Saved "${song.title}" as a Soundwave song file.`);
    } catch (e) {
      notify.error(`Could not export "${song.title}": ${(e as Error).message}`);
    }
  }, []);
  const addSongs = useCallback(() => fileInput.current?.click(), []);

  /* The track editor ---------------------------------------------------------------------- */

  /**
   * Adds a song picked in the track editor. Analyzed, it is added like any other and charted by the
   * game. From scratch, the game only listens for its tempo and the song gets empty charts on that
   * grid, stored with it before it joins the library, so it is never queued for analysis.
   */
  const addTrack = useCallback(
    async ({ meta, bytes }: PickedSong, how: 'analyze' | 'scratch'): Promise<SongMeta> => {
      forgetSongBuffer(meta.id);
      analysisManager.forget(meta.id);
      const audio = new Blob([bytes], { type: meta.mime });
      let song = meta;
      if (how === 'scratch') {
        let buffer: AudioBuffer;
        try {
          buffer = await getEngine().decode(bytes);
        } catch {
          throw new Error('This audio format could not be decoded here. Try MP3, WAV, FLAC or OGG.');
        }
        const found = await detectGrid(buffer);
        song = { ...meta, duration: meta.duration || buffer.duration };
        await storeNewSong(song, audio, {
          ...emptyEdits(),
          grid: found.grid,
          ...(found.tracked ? { tracked: found.tracked } : {}),
          duration: buffer.duration,
        });
      } else await storeNewSong(song, audio);
      playSfx('add');
      await refresh();
      return song;
    },
    [refresh],
  );
  /** Gives a song already in the library empty charts on its own tempo, instead of an analysis. */
  const startFromScratch = useCallback(async (song: SongMeta) => {
    analysisManager.cancel(song.id);
    const buffer = await loadSongBuffer(song.id);
    const found = await detectGrid(buffer);
    const had = await analysisManager.editsOf(song.id);
    await analysisManager.saveEdits(song.id, {
      ...(had ?? emptyEdits()),
      grid: found.grid,
      ...(found.tracked ? { tracked: found.tracked } : {}),
      duration: buffer.duration,
      updatedAt: Date.now(),
    });
  }, []);

  // Files dropped anywhere on a menu are imported.
  const [dragging, setDragging] = useState(false);
  const inMenus = view.name !== 'play' && view.name !== 'replay' && view.name !== 'export';
  const takesDrops = inMenus && view.name !== 'editor';
  useEffect(() => {
    if (!takesDrops) return;
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => e.preventDefault();
    const leave = () => {
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) void importFiles(files);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      setDragging(false);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [takesDrops, importFiles]);

  const toggle = (song: SongMeta) => {
    if (!setlist.includes(song.id) && !playable(song.id))
      return notify.warning('No notes were found in this song, so it cannot go in a set.');
    if (!setlist.includes(song.id) && setlist.length >= SET_MAX)
      return notify.warning(`The setlist holds ${SET_MAX} songs. Take one out to add another.`);
    setSetlist(toggleSong(setlist, song.id));
  };

  /** What can be done with songs: from a song's detail sheet, or its menu for one or several songs. */
  const songActions: SongActions = {
    details: (song) => setSheet(song),
    addToSet: (list) => {
      const next = [...setlist];
      for (const song of list) if (next.length < SET_MAX && !next.includes(song.id) && playable(song.id)) next.push(song.id);
      if (next.length !== setlist.length) setSetlist(next);
      if (list.some((song) => !next.includes(song.id))) notify.warning(`The setlist holds ${SET_MAX} songs. Take one out to add another.`);
    },
    removeFromSet: (list) => setSetlist(setlist.filter((id) => !list.some((song) => song.id === id))),
    analyze: (list) => list.forEach((song) => analysisManager.enqueue(song.id, true)),
    exportSong: (song) => void exportSong(byId.get(song.id) ?? song),
    editMeta: (song) => setMetaSong(song),
    edit: (song) => {
      setSheet(null);
      getEngine().stop();
      setView({ name: 'editor', song: byId.get(song.id) ?? song, back: view });
    },
    remove: async (list) => {
      if (sheet && list.some((song) => song.id === sheet.id)) setSheet(null);
      getEngine().stop();
      for (const song of list) {
        forgetSongBuffer(song.id);
        analysisManager.forget(song.id);
        await deleteSong(song.id);
      }
      await Promise.all([refresh(), refreshScores()]);
    },
  };

  /* Playing a set ------------------------------------------------------------------------- */

  // A stage-light wipe covers the moment a song loads: it closes over the menu, the play screen
  // mounts behind it, and it opens again.
  const [launch, setLaunch] = useState<'in' | 'out' | null>(null);
  const launchRef = useRef(launch);
  launchRef.current = launch;
  /** Closes the wipe over the screen, loads what comes next behind it, and opens it again. */
  const wipeTo = async (load: () => Promise<View>, started = false) => {
    // One launch at a time: a second press while the wipe is up does nothing.
    if (launchRef.current && !started) return;
    setLaunch('in');
    const minWipe = new Promise((r) => setTimeout(r, 620));
    try {
      getEngine().stop();
      const next = await load();
      await minWipe;
      setView(next);
      // The sheets part once the play screen has had a moment to build its highway behind them,
      // so the way out is as smooth as the way in.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await new Promise((r) => setTimeout(r, 140));
      setLaunch('out');
      setTimeout(() => setLaunch(null), 860);
    } catch (e) {
      setLaunch(null);
      notify.error((e as Error).message);
    }
  };
  const playAt = (run: Run, index: number, started = false) =>
    wipeTo(
      async () => ({ name: 'play', run: { ...run, index }, buffer: await loadSongBuffer(run.songs[index].id), key: Date.now() }),
      started,
    );

  /* Replays -------------------------------------------------------------------------------- */

  /** Opens a saved replay: its song when the library still has it, silence when it does not. */
  const watchReplay = (meta: ReplayMeta) => {
    menuPulse('launch');
    void wipeTo(async () => ({
      name: 'replay',
      ...(await loadReplay(meta)),
      meta,
      back: view.name === 'replay' ? view.back : view,
      key: Date.now(),
    }));
  };
  // Videos are made in the menus and while a replay is watched, never beside a song or the editor.
  const holdVideos = view.name === 'play' || view.name === 'editor' || view.name === 'export';
  // While a song or a replay is on screen, notifications stand along the top edge, clear of the
  // highway and the score, and come without a sound or a pulse.
  const songOnScreen = view.name === 'play' || view.name === 'replay' || view.name === 'export';
  useEffect(() => videoExports.hold(holdVideos), [holdVideos]);
  // Analyzing waits the same way, so the stem model never shares the card with a song being played.
  const holdAnalysis =
    view.name === 'play'
      ? 'Paused while you play'
      : view.name === 'editor'
        ? 'Paused while the editor is open'
        : view.name === 'export'
          ? 'Paused while the video is made'
          : null;
  useEffect(() => analysisHold.set(holdAnalysis), [holdAnalysis]);
  useEffect(
    () =>
      videoExports.onFinished((item) => {
        if (item.state === 'saved') notify.success(`The video of ${item.title} is saved as ${item.fileName}.`);
        else if (item.state === 'failed') notify.error(`The video of ${item.title} could not be exported: ${item.error}`);
      }),
    [],
  );
  /** The replay whose video is being set up (the export dialog is open). */
  const [exportAsk, setExportAsk] = useState<ReplayMeta | null>(null);
  /** Loads a replay with its song, or silence where the song has left the library. */
  const loadReplay = async (meta: ReplayMeta) => {
    const data = await getReplayData(meta.id);
    if (!data) throw new Error('This replay is no longer saved.');
    let buffer: AudioBuffer | null = null;
    if (byId.has(meta.songId)) buffer = await loadSongBuffer(meta.songId).catch(() => null);
    return { data, buffer: buffer ?? silence(Math.max(meta.duration, data.chart.duration)), silent: !buffer };
  };
  /**
   * Makes a replay's video. The save dialog comes first (a browser shows it only straight after a
   * press). Where videos can be made in the background, it joins the queue and the player carries on
   * where they were; elsewhere the replay is loaded behind the wipe and recorded in the foreground.
   */
  const recordVideo = (meta: ReplayMeta, video: VideoExportSettings, plan: VideoPlan) => {
    const fileName = videoFileName(
      meta.title,
      meta.artist,
      `${PART_LABEL[meta.part]} ${DIFFICULTY_LABEL[meta.difficulty]}`,
      meta.date,
      plan.ext,
    );
    // Back to where the export was asked for: a replay starts over, the list stays as it was.
    const from = view;
    void chooseSaveTarget(fileName, plan.ext === 'mp4' ? 'video-mp4' : 'video-webm')
      .then(async (target) => {
        if (!target) return;
        setExportAsk(null);
        if (plan.kind === 'frames' && (await videoExports.available())) {
          try {
            const { data, buffer, silent } = await loadReplay(meta);
            const id = `${meta.id}:${Date.now().toString(36)}`;
            videoExports.add(
              { id, replayId: meta.id, title: meta.title, fileName },
              {
                id,
                title: meta.title,
                artist: meta.artist,
                chart: data.chart,
                inputs: data.inputs,
                // Copies, handed over to the worker: the song's own stay cached for playing.
                song: { channels: songSamples(buffer).channels.map((c) => c.slice()), sampleRate: buffer.sampleRate },
                music: video.music && !silent,
                trackSpeed: settings.trackSpeed,
                graphics: resolveGraphics(settings.graphics),
                backdrop: await videoBackdrop(findStage(settings.stage, settings.stage.active)),
                video,
                plan,
              },
              target,
            );
            playSfx('add');
          } catch (e) {
            await target.abort().catch(() => {});
            notify.error(`The video could not be exported: ${(e as Error).message}`);
          }
          return;
        }
        menuPulse('launch');
        void wipeTo(async () => {
          const { data, buffer } = await loadReplay(meta);
          const back: View = from.name === 'replay' ? { ...from, key: Date.now() } : from;
          return { name: 'export', meta, data, buffer, video, plan, target, fileName, back, key: Date.now() };
        });
      })
      .catch((e) => notify.error(`The video could not be saved: ${(e as Error).message}`));
  };
  const replayActions = {
    watch: watchReplay,
    exportVideo: (meta: ReplayMeta) => setExportAsk(meta),
    keep: async (meta: ReplayMeta, kept: boolean) => {
      try {
        await updateReplay(meta.id, { kept });
      } catch {
        notify.error('The replay could not be changed: the library is unavailable.');
      }
      await refreshReplays();
    },
    remove: async (list: ReplayMeta[]) => {
      try {
        await deleteReplays(list.map((r) => r.id));
      } catch {
        notify.error('The replay could not be deleted: the library is unavailable.');
      }
      await refreshReplays();
    },
  };
  // A lower number of replays to keep takes effect once the settings are left, so trying the
  // slider out removes nothing.
  const inSettings = view.name === 'settings' || songSettings;
  useEffect(() => {
    if (inSettings || !loaded.songs) return;
    void pruneReplays(settings.replayLimit)
      .then((n) => (n ? refreshReplays() : undefined))
      .catch(() => {});
  }, [settings.replayLimit, inSettings, loaded.songs, refreshReplays]);

  const start = async (lobby: LobbyView) => {
    if (launchRef.current) return;
    // The held button makes no sound of its own: the set starting is the sound.
    playSfx('launch');
    menuPulse('launch');
    setLaunch('in');
    try {
      // The chosen part is the first song's (the lobby offers only the parts it has notes on). Each
      // song after it is played on that part, or on the first one it has notes on when it has none
      // on that one (the next song's part can be changed between songs). A song without a note on
      // any part sits the set out.
      const ids = lobby.ids.filter(playable);
      const found: { song: SongMeta; charts: Map<Part, Chart> }[] = [];
      for (const id of ids) {
        const charts = new Map<Part, Chart>();
        for (const p of songParts(id, thin)) {
          const chart = await analysisManager.chart(id, p, pick.difficulty);
          if (chart && chart.notes.length > 0) charts.set(p, chart);
        }
        if (charts.size) found.push({ song: byId.get(id) ?? server.held[id], charts });
      }
      const use: Pick = { ...pick, part: partAmong(pick.part, [...(found[0]?.charts.keys() ?? [])]) ?? pick.part };
      const entries = found.map(({ song, charts }) => {
        const parts = [...charts.keys()];
        return { song, chart: charts.get(partAmong(use.part, parts)!)!, parts };
      });
      if (!entries.length) {
        setLaunch(null);
        return notify.warning('No notes were found in these songs at this difficulty.');
      }
      await playAt(
        {
          songs: entries.map((e) => e.song),
          charts: entries.map((e) => e.chart),
          parts: entries.map((e) => e.parts),
          index: 0,
          results: [],
          pick: use,
          lobby,
        },
        0,
        true,
      );
    } catch (e) {
      setLaunch(null);
      notify.error((e as Error).message);
    }
  };

  /** Plays a chart from the track editor in the game itself; the editor comes back when it ends. */
  const testPlay = (editor: EditorView, chart: Chart, startAt: number) => {
    menuPulse('launch');
    void playAt(
      {
        songs: [editor.song],
        charts: [chart],
        index: 0,
        results: [],
        pick: { part: chart.part, difficulty: chart.difficulty },
        lobby: { name: 'lobby', ids: [], from: 'home' },
        test: { back: editor, startAt },
      },
      0,
    );
  };

  const withResult = (run: Run, result: SetResult): Run => {
    const results = [...run.results];
    results[run.index] = result;
    return { ...run, results };
  };

  /** Saves a finished song's run as a replay, with every note of the chart it was played on. */
  const saveReplay = async (
    song: SongMeta,
    chart: Chart,
    results: Results,
    inputs: ReplayInputs,
    best: number | undefined,
    mode: ReplayMode,
  ) => {
    const date = Date.now();
    const id = newReplayId(date);
    try {
      await putReplay(
        {
          meta: {
            id,
            date,
            songId: song.id,
            title: song.title,
            artist: song.artist,
            part: chart.part,
            difficulty: chart.difficulty,
            results,
            best: results.score > 0 && (best === undefined || results.score > best),
            kept: false,
            duration: song.duration || chart.duration,
            ...(mode === 'solo' ? {} : { mode }),
          },
          data: { id, chart, inputs },
        },
        settingsRef.current.replayLimit,
      );
      await refreshReplays();
    } catch {
      notify.error('This replay could not be saved: the library is out of room or unavailable.');
    }
  };

  /** Keeps a finished song's score, and its replay when replays are kept. Resolves to the best score before it. */
  const keepScore = async (run: Run, results: Results, inputs?: ReplayInputs) => {
    const song = run.songs[run.index];
    let best: number | undefined;
    try {
      best = await submitScore({
        songId: song.id,
        part: run.charts[run.index].part,
        difficulty: run.charts[run.index].difficulty,
        score: results.score,
        stars: results.stars,
        accuracy: results.accuracy,
        fullCombo: results.fullCombo,
      });
      void refreshScores();
    } catch {
      /* scores are best-effort */
    }
    // A song held only for a party leaves with it, so its replay could never be watched.
    if (inputs && settingsRef.current.replays && byIdRef.current.has(song.id))
      void saveReplay(song, run.charts[run.index], results, inputs, best, run.party?.mode ?? 'solo');
    if (inputs) void postRun(run, results, inputs);
    return best;
  };

  /**
   * Sends a finished run to the server's leaderboards while signed in (and the player lets it):
   * the server judges it again from its inputs before it takes the score.
   */
  const postRun = async (run: Run, results: Results, inputs: ReplayInputs) => {
    if (!online.snapshot().account || !settingsRef.current.postScores) return;
    // A Showdown's runs are shaped by the others' hits: they count in the party, not on the song's boards.
    if (run.party?.mode === 'showdown') return;
    const song = run.songs[run.index];
    try {
      const r = await online.postScore({
        songId: song.id,
        title: song.title,
        artist: song.artist,
        chart: run.charts[run.index],
        ...encodeRun(inputs),
        result: {
          score: results.score,
          stars: results.stars,
          accuracy: results.accuracy,
          bestStreak: results.bestStreak,
          fullCombo: results.fullCombo,
        },
      });
      if (r.best && r.rank) notify.success(`Number ${r.rank} on ${online.snapshot().info?.name ?? 'the server'}’s board for this chart.`);
    } catch (e) {
      notify.error(`Your score did not reach the server: ${(e as Error).message}`);
    }
  };

  /**
   * Watches a run from a server's board: with the song's music from the library, else streamed from
   * the server's library where it keeps the song, else without music.
   */
  const watchRun = (scoreId: string) => {
    menuPulse('launch');
    const back = view;
    void wipeTo(async () => {
      const r = await online.run(scoreId);
      const chart = cleanChart(r.chart);
      if (!chart) throw new Error('This run’s chart is damaged.');
      const inputs = decodeRun(r.ops, r.times);
      const meta: ReplayMeta = {
        id: `server-${r.scoreId}`,
        date: r.at,
        songId: r.songId,
        title: r.title,
        artist: `${r.name}’s run${r.artist ? ` · ${r.artist}` : ''}`,
        part: chart.part,
        difficulty: chart.difficulty,
        results: replayResults(chart, inputs),
        best: false,
        kept: false,
        duration: chart.duration,
      };
      let buffer = byId.has(r.songId) || serverSongs.snapshot().held[r.songId] ? await loadSongBuffer(r.songId).catch(() => null) : null;
      const shared = buffer ? undefined : serverSongs.snapshot().list.find((x) => x.id === r.songId && x.audio);
      if (shared)
        buffer = await serverSongs
          .stream(shared)
          .then(() => loadSongBuffer(r.songId))
          .catch(() => null);
      return {
        name: 'replay',
        meta,
        data: { id: meta.id, chart, inputs },
        buffer: buffer ?? silence(chart.duration),
        silent: !buffer,
        back,
        key: Date.now(),
      };
    });
  };

  const finish = async (run: Run, results: Results, inputs?: ReplayInputs) => {
    const best = await keepScore(run, results, inputs);
    setView({ name: 'results', run: withResult(run, { song: run.songs[run.index], results, best }) });
  };

  /* Playing together ------------------------------------------------------------------------ */

  // A server played on before is connected to again when the game starts. If it cannot be
  // reached, the game plays offline and the party screen says so.
  useEffect(() => {
    if (booted) online.resume();
  }, [booted]);

  /**
   * The host starts song `index` of the party's set. Everyone plays the host's charts (so the notes
   * are the same for all): each player gets their part at their difficulty, or the first part the
   * song has notes on there.
   */
  const startPartySong = async (index: number) => {
    const party = online.snapshot().party;
    const song = party?.set[index];
    if (!party || !song) return;
    if (!byId.has(song.id)) await serverSongs.ensure([song.id]);
    if (!(byId.has(song.id) && canPlay(analysisStatus[song.id])) && !serverSongs.snapshot().held[song.id] && !partySongs.songs()[song.id])
      return notify.warning(`You need "${song.title}" in your library, with notes, to start it: everyone plays your charts.`);
    try {
      const made = new Map<string, Chart | null>();
      const chartFor = async (p: Part, d: Pick['difficulty']) => {
        const key = `${p}/${d}`;
        if (!made.has(key)) {
          const c = await analysisManager.chart(song.id, p, d).catch(() => undefined);
          made.set(key, c && c.notes.length > 0 ? c : null);
        }
        return made.get(key)!;
      };
      const charts: WireChart[] = [];
      const slot = new Map<Chart, number>();
      const assign: Record<string, number> = {};
      const own = songParts(song.id, thin);
      for (const m of party.members) {
        if (!m.connected || !m.have.includes(song.id)) continue;
        for (const p of [m.part, ...own.filter((x) => x !== m.part)]) {
          const c = await chartFor(p, m.difficulty);
          if (!c) continue;
          if (!slot.has(c)) slot.set(c, charts.push(c) - 1);
          assign[m.id] = slot.get(c)!;
          break;
        }
      }
      if (!Object.keys(assign).length) return notify.warning(`No notes were found in "${song.title}" at the difficulties picked.`);
      playSfx('launch');
      menuPulse('launch');
      online.start(index, charts, assign);
    } catch (e) {
      notify.error((e as Error).message);
    }
  };

  // The party starts a song: every player with a chart goes into it, timed to start together.
  const viewRef = useRef(view);
  viewRef.current = view;
  const partyStartRef = useRef<(s: PartyStart) => void>(() => {});
  partyStartRef.current = (start) => {
    const song = online.snapshot().party?.set[start.songIndex];
    if (!start.chart || !song) return;
    const meta = byId.get(song.id) ?? partySongs.songs()[song.id]?.meta ?? serverSongs.snapshot().held[song.id];
    const chart = cleanChart(start.chart);
    // A party song still open from before (the party moved on without this player) gives way to the new one.
    const v = viewRef.current;
    const stale = v.name === 'play' && !!v.run.party && v.run.party.songIndex !== start.songIndex;
    const busy = !stale && ['play', 'replay', 'export', 'editor'].includes(v.name);
    if (!meta || !chart || busy) {
      online.quit(start.songIndex);
      return notify.warning(
        busy
          ? `The party started "${song.title}" while you were busy here, so you sit it out. You can join the next song.`
          : `"${song.title}" could not be played here, so you sit it out.`,
      );
    }
    setSheet(null);
    const run: Run = {
      songs: [meta],
      charts: [chart],
      index: 0,
      results: [],
      pick: { part: chart.part, difficulty: chart.difficulty },
      lobby: { name: 'lobby', ids: [], from: 'home' },
      party: { songIndex: start.songIndex, at: start.at, mode: online.snapshot().party?.showdown ? 'showdown' : 'versus' },
    };
    void wipeTo(async () => {
      try {
        return { name: 'play', run, buffer: await loadSongBuffer(meta.id), key: Date.now() };
      } catch (e) {
        online.quit(start.songIndex);
        throw e;
      }
    }, true);
  };
  useEffect(() => online.onStart((s) => partyStartRef.current(s)), []);
  // The server decides where the party is. A party song still playing here once the party is
  // elsewhere (the song was ended without this player, after a dropped connection, or the party
  // is gone) is left for the party's own screen, which follows its phase.
  const partyAt = onlineState.party ? `${onlineState.party.code}:${onlineState.party.phase}:${onlineState.party.songIndex}` : null;
  const playingParty = view.name === 'play' ? view.run.party : undefined;
  const leaveStale = useRef(() => {});
  leaveStale.current = () => {
    const party = online.snapshot().party;
    if (party) setView({ name: 'party' });
    else goOnline();
    notify.info(party ? 'The party moved on without you, so you are back with it.' : 'The party is over.');
  };
  useEffect(() => {
    if (!playingParty || onlineState.status !== 'online') return;
    const party = online.snapshot().party;
    if (party && party.phase === 'playing' && party.songIndex === playingParty.songIndex) return;
    leaveStale.current();
  }, [partyAt, playingParty, onlineState.status]);
  // The party's next song is loaded ahead, so it starts on time.
  const partyNext = onlineState.party ? onlineState.party.set[onlineState.party.songIndex + 1]?.id : undefined;
  useEffect(() => {
    if (partyNext && (byId.has(partyNext) || partySongs.songs()[partyNext])) void loadSongBuffer(partyNext).catch(() => {});
  }, [partyNext, byId, held]);

  /**
   * The band on stage dressed as the players: in a party each member at their part, else the
   * signed-in player at `part` (the part they play, or would).
   */
  const avatarsFor = (part: Part): Avatars => {
    const out: Avatars = {};
    const party = onlineState.party;
    if (party)
      for (const m of party.members) {
        const at = m.id === onlineState.account?.id ? part : m.part;
        if (m.avatar && !out[at]) out[at] = m.avatar;
      }
    else if (onlineState.account && onlineState.avatar) out[part] = onlineState.avatar;
    return out;
  };
  /** A Showdown song's players for the stage's ring: everyone still in who has the song, this player on `part`. */
  const ringFor = (songIndex: number, part: Part): RingSeat[] => {
    const party = onlineState.party;
    const me = onlineState.account?.id;
    const song = party?.set[songIndex]?.id ?? '';
    return (party?.members ?? [])
      .filter((m) => !m.eliminated && (m.id === me || m.have.includes(song)))
      .map((m) =>
        m.id === me ? { id: m.id, part, avatar: onlineState.avatar ?? m.avatar, me: true } : { id: m.id, part: m.part, avatar: m.avatar },
      );
  };
  const menuLook = JSON.stringify(avatarsFor(pick.part));
  // The menu's band is dressed the same way.
  useEffect(() => setMenuAvatars(JSON.parse(menuLook) as Avatars), [menuLook]);
  // A Showdown's lobby, and the time between its songs, stand the players still in on the ring behind the screen.
  const lobbyParty = view.name === 'party' && onlineState.party?.mode === 'showdown' ? onlineState.party : null;
  const lobbyRing = JSON.stringify(
    lobbyParty && lobbyParty.phase !== 'playing'
      ? lobbyParty.members
          .filter((m) => !m.eliminated)
          .map((m): RingSeat => {
            const me = m.id === onlineState.account?.id;
            const avatar = me ? (onlineState.avatar ?? m.avatar) : m.avatar;
            return { id: m.id, part: m.part, ...(avatar ? { avatar } : {}), ...(me ? { me } : {}) };
          })
      : null,
  );
  useEffect(() => setMenuRing(JSON.parse(lobbyRing) as RingSeat[] | null), [lobbyRing]);

  /* Shared songs ---------------------------------------------------------------------------- */

  // The server's songs: in the library to stream or download, and the player's own shared to it
  // when they chose to (src/net/serverSongs.ts).
  useEffect(() => serverSongs.connect(onlineState.account ? onlineState.server : null), [onlineState.account, onlineState.server]);
  const serverSharing = onlineState.account && onlineState.info && onlineState.info.sharing !== 'off';
  useEffect(() => {
    if (!serverSharing || !settings.shareLibrary || !server.ready) return;
    // Only songs with their charts: one shared before its analysis would have no notes for anyone.
    void serverSongs.share(
      songs.filter((x) => canPlay(analysisStatus[x.id])),
      (id) => songFile(id),
      (message) => notify.error(`Your songs could not all be shared: ${message}`),
    );
  }, [serverSharing, settings.shareLibrary, server.ready, songs, analysisStatus]);
  const origin = (song: SharedSong) => ({ url: serverSongs.url ?? '', uid: song.uid, hash: song.hash });
  // The server is the single point of truth for songs downloaded from it: one whose copy there
  // changed (its hash) takes the server's details over.
  useEffect(() => {
    if (!server.ready) return;
    void serverSongs.syncCopies(songs, async (song, file) => {
      const pkg = await readSongPackage(file, file.name);
      if (pkg.meta.id !== song.id) return;
      await updateSongMeta(song.id, {
        title: pkg.meta.title,
        artist: pkg.meta.artist,
        album: pkg.meta.album,
        cover: pkg.meta.cover ?? null,
        server: origin(song),
      });
      await refresh();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.ready, server.list, songs]);
  /**
   * A server song pressed in the library: streamed and put in the setlist (pressed again, taken out),
   * or downloaded into the library, as the player chose. Either way the player stays where they are,
   * picking songs, whether for themselves or for a party.
   */
  const playServerSong = async (song: SharedSong) => {
    try {
      if (setlistRef.current.includes(song.id)) return setSetlist(setlistRef.current.filter((id) => id !== song.id));
      if (settingsRef.current.serverSongs === 'download') {
        const got = await importFiles([await serverSongs.download(song)]);
        if (!got.length) return;
        // It remembers where it came from, so it follows the server's copy from now on.
        await updateSongMeta(got[0].id, { title: got[0].title, artist: got[0].artist, album: got[0].album, server: origin(song) });
        await refresh();
        notify.info(`"${got[0].title}" is in your library.`);
        return;
      }
      if (setlistRef.current.length >= SET_MAX) return notify.warning(`The setlist holds ${SET_MAX} songs. Take one out to add another.`);
      // In the setlist at once; it comes in the background, its progress on it.
      setSetlist([...setlistRef.current, song.id]);
      await serverSongs.stream(song).catch((e: Error) => {
        setSetlist(setlistRef.current.filter((id) => id !== song.id));
        throw new Error(`"${song.title}" could not be streamed: ${e.message}`);
      });
    } catch (e) {
      notify.error((e as Error).message);
    }
  };
  /**
   * Ready from the library: on to the party, or to the set's lobby. Setlist songs still coming from
   * the server are waited for first (the Ready button shows how far they are), then it goes on by itself.
   */
  const [waitingFor, setWaitingFor] = useState<string[] | null>(null);
  const gathering = useMemo(() => {
    if (!waitingFor) return null;
    const parts = waitingFor.map((id) => (server.held[id] ? 1 : (server.coming[id]?.progress ?? 0)));
    return parts.reduce((a, b) => a + b, 0) / Math.max(1, parts.length);
  }, [waitingFor, server.held, server.coming]);
  const readyFromLibrary = () => {
    if (view.name === 'library' && view.from === 'party') return setView({ name: 'party' });
    const missing = setlistRef.current.filter((id) => !byId.has(id) && !serverSongs.snapshot().held[id]);
    if (!missing.length) return setView({ name: 'lobby', ids: setlistRef.current, from: 'library' });
    setWaitingFor(missing);
    void serverSongs.ensure(missing).finally(() => {
      setWaitingFor(null);
      if (viewRef.current.name === 'library') setView({ name: 'lobby', ids: setlistRef.current, from: 'library' });
    });
  };

  // The smaller copies a slow connection streams (src/net/streamQuality.ts) are made by the game of
  // whoever shared a song, or of an admin or moderator, in the background, never while a song plays.
  useEffect(() => {
    const me = onlineState.account;
    if (!server.ready || !me) return;
    void serverSongs.makeCopies(
      { name: me.name, curator: me.role === 'owner' || me.role === 'moderator' },
      (id) => (byIdRef.current.has(id) ? songFile(id) : null),
      () => !['play', 'replay', 'export', 'editor'].includes(viewRef.current.name),
    );
  }, [server.ready, server.list, onlineState.account]);
  // A party's songs reach every player by themselves: the host's game sends a song someone lacks,
  // and the games without it download it from the server, held for the party or kept in the
  // library (src/net/partySongs.ts).
  const partyAdd = useRef(async (_: File) => {});
  partyAdd.current = async (file) => {
    const got = await importFiles([file]);
    if (!got.length) throw new Error(`"${file.name.replace(/\.soundwave$/, '')}" could not be added.`);
    notify.success(`"${got[0].title}" is in your library.`);
  };
  useEffect(() => {
    partySongs.update({
      party: onlineState.party,
      me: onlineState.account?.id,
      serverOn: !!onlineState.info?.partySongs,
      share: settings.shareSongs,
      keep: settings.serverSongs === 'download',
      has: (id) => byId.has(id) || !!serverSongs.snapshot().held[id],
      file: (id) => songFile(id),
      add: (file) => partyAdd.current(file),
    });
  }, [onlineState.party, onlineState.account, onlineState.info, settings.shareSongs, settings.serverSongs, byId, server.held]);

  /** A party's song is over: the score is kept here as any other, and the party gets it. */
  const finishPartySong = (run: Run, results: Results, inputs?: ReplayInputs) => {
    void keepScore(run, results, inputs);
    const chart = run.charts[run.index];
    setLastRun({ songIndex: run.party!.songIndex, results, part: chart.part, difficulty: chart.difficulty });
    online.finish(run.party!.songIndex, {
      score: results.score,
      stars: results.stars,
      accuracy: results.accuracy,
      bestStreak: results.bestStreak,
      fullCombo: results.fullCombo,
    });
    setView({ name: 'party' });
  };

  /** Every song of the run with its result so far; songs not reached count as skipped. */
  const filled = (run: Run): Run => ({ ...run, results: run.songs.map((song, i) => run.results[i] ?? { song, results: null }) });
  const goHome = () => {
    setSeed(Date.now());
    setView({ name: 'home' });
  };
  /** Back to the main menu's Online tab (from a screen it opened, or a party that ended). */
  // The identity is loaded as the game starts, so a server played on signs in with it by itself.
  const me = useSyncExternalStore(identity.subscribe, identity.snapshot);
  useEffect(() => void identity.load().then((had) => had && online.resume()), []);
  /**
   * Signed in with an identity that has no backup: asked once (per identity) to back it up, since a
   * lost device or cleared browser data would otherwise lose every account.
   */
  const [askBackup, setAskBackup] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  useEffect(() => {
    if (!onlineState.account || !me || me.backedUp) return;
    try {
      if (localStorage.getItem(BACKUP_ASKED) === String(me.created)) return;
      localStorage.setItem(BACKUP_ASKED, String(me.created));
    } catch {
      return;
    }
    setAskBackup(true);
  }, [onlineState.account, me]);

  const goOnline = useCallback(() => {
    showOnlineTab();
    setView({ name: 'home' });
  }, []);
  const advance = (run: Run) => {
    if (run.index + 1 < run.songs.length) void playAt(run, run.index + 1);
    else if (run.songs.length > 1) setView({ name: 'summary', run: filled(run) });
    else setView(run.lobby.from === 'library' ? { name: 'library' } : { name: 'home' });
  };

  // A song previews by itself (unless that is switched off): the one whose page is open, else the one
  // highlighted in a list.
  const sheetOpen = !!sheet && inMenus && view.name !== 'editor';
  const previewId =
    launch !== null || !settings.songPreviews
      ? null
      : sheetOpen
        ? sheet.id
        : view.name === 'library' || view.name === 'home'
          ? highlight
          : null;
  useEffect(() => previewSong(previewId), [previewId]);
  useEffect(() => () => previewSong(null), []);
  useEffect(() => setPreviewVolume(settings.volume), [settings.volume]);
  const previewing = useSyncExternalStore(watchPreview, isPreviewing);
  /** The song that is heard right now, for the lists to mark. */
  const heard = previewing ? previewId : null;

  // The theme plays behind the menus and makes way for a preview, the launch and the song.
  // The editor plays the song itself.
  const menuMusic = booted && inMenus && view.name !== 'editor' && !previewing && launch === null;
  useEffect(() => setMenuMusic(menuMusic, 0.45), [menuMusic]);

  // Going deeper enters from the right; going back, from the left.
  const prevDepth = useRef(DEPTH[view.name]);
  const sceneDirRef = useRef<'fwd' | 'back'>('fwd');
  if (DEPTH[view.name] !== prevDepth.current) {
    sceneDirRef.current = DEPTH[view.name] > prevDepth.current ? 'fwd' : 'back';
    prevDepth.current = DEPTH[view.name];
  }
  const sceneKey = view.name === 'results' ? `results:${view.run.index}` : view.name;
  // The first screen after the loading screen comes in from it (see bootDone), once: until its
  // entrance has played, or another screen is opened. (Its tabs' contents mount anew, and must not
  // wait like that again.)
  const bootScene = useRef<{ key: string; done: boolean } | null>(null);
  if (booted) {
    if (!bootScene.current) bootScene.current = { key: sceneKey, done: false };
    else if (sceneKey !== bootScene.current.key) bootScene.current.done = true;
  }
  const [bootEntrance, setBootEntrance] = useState(true);
  useEffect(() => {
    if (!booted) return;
    const over = window.setTimeout(() => setBootEntrance(false), 1600);
    return () => clearTimeout(over);
  }, [booted]);
  const fromBoot = bootEntrance && bootScene.current?.done === false;
  const fromBootRef = useRef(fromBoot);
  fromBootRef.current = fromBoot;

  // A new screen starts with focus on its first control for keyboard and controller players. The
  // first screen after the loading screen waits until that control has come in (see
  // focusStartSettled): its entrance is long, and a tile focused while rising would snap at the end.
  useEffect(() => {
    if (view.name === 'play') return;
    let cancelFocus = () => {};
    const raf = requestAnimationFrame(() => {
      if (document.querySelector('[data-modal]')) return;
      if (usesFocus(getInputMode())) {
        if (fromBootRef.current) cancelFocus = focusStartSettled();
        else focusStart();
        return;
      }
      // Mouse and touch players get no ring, but a screen reader still hears where it is now.
      const heading = document.querySelector<HTMLElement>('.scene h1');
      if (!heading) return (document.activeElement as HTMLElement | null)?.blur?.();
      heading.tabIndex = -1;
      heading.dataset.ring = 'none';
      heading.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(raf);
      cancelFocus();
    };
  }, [sceneKey, view.name, booted]);

  // The settings over a paused song take focus as they open (the pause menu takes it back, see PlayScreen).
  useEffect(() => {
    if (!songSettings) return;
    const raf = requestAnimationFrame(() => {
      const over = document.querySelector<HTMLElement>('.settings-over');
      if (!over) return;
      if (usesFocus(getInputMode())) return focusStart(over);
      const heading = over.querySelector<HTMLElement>('h1');
      if (!heading) return;
      heading.tabIndex = -1;
      heading.dataset.ring = 'none';
      heading.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [songSettings]);

  const subtitle = (run: Run, index = run.index) =>
    `${PART_LABEL[run.charts[index]?.part ?? run.pick.part]} · ${DIFFICULTY_LABEL[run.pick.difficulty]}`;

  /** Between songs: the next song is to be played on another part. Its chart for that part is fetched first. */
  const setNextPart = async (run: Run, part: Part) => {
    const index = run.index + 1;
    const song = run.songs[index];
    if (!song || run.charts[index]?.part === part) return;
    try {
      const chart = await analysisManager.chart(song.id, part, run.pick.difficulty);
      if (!chart || chart.notes.length === 0)
        return notify.warning(`No ${PART_LABEL[part].toLowerCase()} notes were found in ${song.title}.`);
      const charts = [...run.charts];
      charts[index] = chart;
      // Still on this screen (the player may have moved on while the chart was fetched).
      setView((v) =>
        v.name === 'results' && v.run.songs === run.songs && v.run.index === run.index ? { ...v, run: { ...v.run, charts } } : v,
      );
    } catch (e) {
      notify.error((e as Error).message);
    }
  };

  // Every stage (the menus' and the song's) is the player's stage; the stage browser shows the ones
  // it tries out over it (see showStage).
  useEffect(() => setActiveStage(findStage(settings.stage, settings.stage.active)), [settings.stage]);

  // The player's Discord profile shows where they are and what they play (desktop app; src/app/discord.ts).
  useEffect(() => setDiscordEnabled(settings.discordStatus), [settings.discordStatus]);
  // Friends can join the party from Discord: only when the player lets them and it is not private.
  const joinable = settings.discordJoin && !!onlineState.party && !onlineState.party.private && !!onlineState.server;
  const partyCode = onlineState.party?.code;
  const partySize = onlineState.party?.members.length ?? 0;
  useEffect(() => {
    if (!joinable || !partyCode || !onlineState.server) return setDiscordJoin(undefined);
    const secret = joinSecret(onlineState.server, partyCode);
    // Discord refuses a status whose party id is its join secret: the id only names the party.
    setDiscordJoin({ secret, id: partyId(onlineState.server, partyCode), size: partySize, max: PARTY_MAX });
  }, [joinable, partyCode, partySize, onlineState.server]);
  // A friend's party, joined from their Discord status: Play together opens, signed in or to sign in.
  useEffect(
    () =>
      onDiscordJoin((secret) => {
        const party = parseJoinSecret(secret);
        if (!party) return notify.error('Discord sent a party this game cannot read. Update Soundwave, or join with the party’s code.');
        // The party screen opens once the party is there (signing in to its server may come first).
        joiningRef.current = party.code;
        online.joinFrom(party.server, party.code);
        if (!online.snapshot().account && !['play', 'replay', 'export', 'editor'].includes(viewRef.current.name))
          setView({ name: 'party' });
      }),
    [],
  );
  // A party joined from Discord: its lobby opens as soon as the server has let this player in.
  const joiningRef = useRef<string | null>(null);
  useEffect(() => {
    const code = onlineState.party?.code;
    if (!code || code !== joiningRef.current) return;
    joiningRef.current = null;
    if (!['play', 'replay', 'export', 'editor'].includes(viewRef.current.name)) setView({ name: 'party' });
  }, [onlineState.party?.code]);
  // A friend asks on Discord to join: the player lets them in or not, outside a song. While the
  // party cannot be joined from Discord (none, or private), the ask is turned down by itself.
  const [joinAsks, setJoinAsks] = useState<JoinRequest[]>([]);
  const joinableRef = useRef(joinable);
  joinableRef.current = joinable;
  useEffect(
    () =>
      onDiscordJoinRequest((r) => {
        if (!joinableRef.current) return void answerDiscordJoin(r.id, false).catch(() => {});
        setJoinAsks((asks) => [...asks.filter((a) => a.id !== r.id), r]);
      }),
    [],
  );
  const answerAsk = (ask: JoinRequest, accept: boolean) => {
    setJoinAsks((asks) => asks.filter((a) => a.id !== ask.id));
    void answerDiscordJoin(ask.id, accept && joinableRef.current).then(
      () => accept && notify.success(`${ask.name} is on their way. Their game opens and joins your party.`),
      (e: Error) => {
        notify.error(`${ask.name} could not be let in: ${e.message}`);
        // Letting them in failed: the ask stays, to try again.
        if (accept) setJoinAsks((asks) => (asks.some((a) => a.id === ask.id) ? asks : [ask, ...asks]));
      },
    );
  };
  const joinAsk = !['play', 'replay', 'export', 'editor'].includes(view.name) ? joinAsks[0] : undefined;

  // The server's other players see the same line in their menus (only while signed in).
  useEffect(() => {
    const what =
      view.name === 'play'
        ? `Playing ${view.run.songs[view.run.index].title} · ${PART_LABEL[view.run.charts[view.run.index].part]}`
        : view.name === 'party'
          ? 'In a party lobby'
          : view.name === 'editor'
            ? 'Editing a chart'
            : view.name === 'replay'
              ? 'Watching a replay'
              : 'In the menus';
    if (onlineState.status === 'online') online.setStatus(what);
  }, [view, onlineState.status]);
  useEffect(() => {
    const named = (s: SongMeta) => (s.artist ? `${s.title} — ${s.artist}` : s.title);
    const count = (n: number) => `${n} ${n === 1 ? 'song' : 'songs'}`;
    switch (view.name) {
      case 'home':
        return showScene({ details: 'In the main menu' });
      case 'library':
        return showScene({ details: 'Browsing the library', state: count(songs.length) });
      case 'settings':
        return showScene({ details: 'In the settings' });
      case 'lobby':
        return showScene({ details: 'Getting a set ready', state: count(view.ids.length) });
      case 'party':
        return showScene({ details: 'Playing together' });
      case 'boards':
        return showScene({ details: 'Looking at the leaderboards' });
      case 'admin':
        return showScene({ details: 'Running a server' });
      case 'editor':
        return showScene({ details: named(view.song), state: 'Editing the chart' });
      case 'play': {
        const { run } = view;
        const part = run.charts[run.index].part;
        const what = `${PART_LABEL[part]} · ${DIFFICULTY_LABEL[run.pick.difficulty]}`;
        const where = run.test ? 'Test play' : run.songs.length > 1 ? `Song ${run.index + 1} of ${run.songs.length}` : '';
        return showScene({
          details: named(run.songs[run.index]),
          state: where ? `${what} · ${where}` : what,
          part,
          partText: what,
          // The song's cover, where a server shares it publicly; the game's icon otherwise.
          cover: online.coverUrl(run.songs[run.index].id),
        });
      }
      case 'results': {
        const { song, results } = view.run.results[view.run.index] ?? { song: view.run.songs[view.run.index], results: null };
        if (!results) return showScene({ details: named(song), state: 'Results' });
        const stars = '★'.repeat(Math.max(0, Math.min(6, Math.floor(results.stars))));
        const parts = [stars, `${Math.round(results.accuracy * 100)}%`, results.fullCombo ? 'Full combo' : ''].filter(Boolean);
        return showScene({ details: named(song), state: parts.join(' · ') });
      }
      case 'summary':
        return showScene({ details: 'Finished a set', state: count(view.run.songs.length) });
      case 'export':
        return showScene({
          details: view.meta.artist ? `${view.meta.title} — ${view.meta.artist}` : view.meta.title,
          state: 'Recording a video',
        });
      case 'replay':
        return showScene({
          details: view.meta.artist ? `${view.meta.title} — ${view.meta.artist}` : view.meta.title,
          state: 'Watching a replay',
        });
    }
  }, [view, songs.length]);

  let content: React.ReactNode;
  if (view.name === 'export') {
    content = (
      <VideoExportScreen
        key={view.key}
        replay={view.meta}
        chart={view.data.chart}
        inputs={view.data.inputs}
        buffer={view.buffer}
        settings={settings}
        video={view.video}
        plan={view.plan}
        target={view.target}
        fileName={view.fileName}
        onDone={() => setView(view.back)}
      />
    );
  } else if (view.name === 'replay') {
    content = (
      <ReplayScreen
        key={view.key}
        replay={view.meta}
        chart={view.data.chart}
        inputs={view.data.inputs}
        buffer={view.buffer}
        silent={view.silent}
        settings={settings}
        onBack={() => setView(view.back)}
        onExport={() => setExportAsk(view.meta)}
      />
    );
  } else if (view.name === 'play') {
    const { run } = view;
    const song = run.songs[run.index];
    const more = !run.party && run.index + 1 < run.songs.length;
    const partyRun = run.party;
    content = (
      <PlayScreen
        key={view.key}
        title={song.title}
        artist={song.artist}
        position={partyRun ? partyRun.songIndex + 1 : run.index + 1}
        total={partyRun ? (onlineState.party?.set.length ?? 1) : run.songs.length}
        buffer={view.buffer}
        chart={run.charts[run.index]}
        startAt={run.test?.startAt}
        settings={settings}
        onSettings={() => setSongSettings(true)}
        settingsOpen={songSettings}
        onQuit={() => {
          setSongSettings(false);
          if (partyRun) online.quit(partyRun.songIndex);
          setView(partyRun ? { name: 'party' } : run.test ? run.test.back : run.lobby);
        }}
        onSkip={more ? () => void playAt(withResult(run, { song, results: null }), run.index + 1) : undefined}
        // A test play keeps no score: it goes back to the editor with how it went.
        onFinish={(r, inputs) =>
          partyRun ? finishPartySong(run, r, inputs) : run.test ? setView({ ...run.test.back, tested: r }) : void finish(run, r, inputs)
        }
        avatars={avatarsFor(run.charts[run.index].part)}
        together={
          partyRun
            ? {
                at: partyRun.at,
                board: <PartyBoard me={onlineState.account?.id ?? ''} />,
                onProgress: (score, streak, stars) => online.progress(partyRun.songIndex, score, streak, stars),
                showdown: onlineState.party?.showdown
                  ? {
                      songIndex: partyRun.songIndex,
                      hits: onlineState.party.showdown.hits,
                      me: onlineState.account?.id ?? '',
                      cut: onlineState.party.cut ?? onlineState.party.members.length,
                      final: partyRun.songIndex + 1 >= onlineState.party.set.length,
                      ring: ringFor(partyRun.songIndex, run.charts[run.index].part),
                    }
                  : undefined,
              }
            : undefined
        }
      />
    );
  } else {
    let screen: React.ReactNode;
    if (view.name === 'editor') {
      screen = (
        <EditorScreen
          key={view.song.id}
          song={view.song}
          settings={settings}
          tested={view.tested}
          onTest={(chart, startAt) => testPlay(view, chart, startAt)}
          onBack={() => setView(view.back)}
        />
      );
    } else if (view.name === 'settings') {
      screen = (
        <SettingsScreen
          settings={settings}
          model={model}
          device={device}
          onChange={updateSettings}
          onBack={() => setView(view.back)}
          onReplaysDeleted={() => void refreshReplays()}
        />
      );
    } else if (view.name === 'library') {
      screen = (
        <LibraryScreen
          songs={songs}
          status={status}
          setlist={setlist}
          scores={scores}
          importing={importing}
          settings={settings}
          previewing={heard}
          onCurrent={setHighlight}
          onToggle={toggle}
          onDetails={setSheet}
          onReady={readyFromLibrary}
          gathering={gathering}
          onBack={view.from === 'party' ? () => setView({ name: 'party' }) : goHome}
          onAdd={addSongs}
          actions={songActions}
          server={
            onlineState.account && (serverSharing || server.list.length > 0)
              ? {
                  songs: server.list.filter((x) => !byId.has(x.id)),
                  coming: server.coming,
                  held: server.held,
                  failed: server.failed,
                  known: (id) => serverSongs.known(id),
                  onRest: (x) => settings.serverSongs === 'stream' && serverSongs.prefetch(x),
                  stream: settings.serverSongs === 'stream',
                  sharing: settings.shareLibrary,
                  canShare: !!serverSharing,
                  left: server.sharing,
                  name: onlineState.info?.name ?? 'the server',
                  onPlay: (x) => void playServerSong(x),
                  onShare: () => updateSettings({ ...settingsRef.current, shareLibrary: !settingsRef.current.shareLibrary }),
                }
              : undefined
          }
        />
      );
    } else if (view.name === 'lobby') {
      // A song without a note on any part cannot be played, so it is not in the set.
      const list = view.ids.map((id) => byId.get(id) ?? server.held[id]).filter((s): s is SongMeta => !!s && playable(s.id));
      screen = (
        <LobbyScreen
          songs={list}
          pick={pick}
          thin={thin}
          scores={scores}
          settings={settings}
          onPick={setPick}
          onStart={() => void start(view)}
          onBack={() => (view.from === 'library' ? setView({ name: 'library' }) : goHome())}
        />
      );
    } else if (view.name === 'party') {
      screen = (
        <PartyScreen
          library={partyLibrary}
          playable={(id) => canPlay(analysisStatus[id])}
          setlist={setSongs_}
          pick={pick}
          onPick={setPick}
          onStartSong={(i) => void startPartySong(i)}
          settings={settings}
          onBack={goHome}
          onLeft={goOnline}
          lastRun={lastRun}
          partsOf={(id) => songParts(id, thin)}
          onPickSongs={() => setView({ name: 'library', from: 'party' })}
          onSettings={(patch) => updateSettings({ ...settings, ...patch })}
        />
      );
    } else if (view.name === 'admin') {
      screen = <AdminScreen setlist={setSongs_} library={songs} settings={settings} onBack={goOnline} />;
    } else if (view.name === 'boards') {
      screen = (
        <BoardsScreen
          library={songs}
          playable={(id) => canPlay(analysisStatus[id])}
          setlist={setSongs_}
          pick={pick}
          thin={thin}
          settings={settings}
          onWatch={watchRun}
          onBack={goOnline}
        />
      );
    } else if (view.name === 'results') {
      const { run } = view;
      const r = run.results[run.index];
      screen = (
        <ResultsScreen
          song={r.song}
          subtitle={subtitle(run)}
          results={r.results!}
          best={r.best}
          position={run.index + 1}
          total={run.songs.length}
          next={run.songs[run.index + 1]}
          nextPart={run.charts[run.index + 1]?.part}
          nextParts={run.parts?.[run.index + 1]}
          onNextPart={(p: Part) => void setNextPart(run, p)}
          settings={settings}
          onRetry={() => void playAt(run, run.index)}
          onNext={() => advance(run)}
          onEnd={() => setView({ name: 'summary', run: filled(run) })}
        />
      );
    } else if (view.name === 'summary') {
      const { run } = view;
      screen = (
        <SummaryScreen set={run.results} subtitle={subtitle(run)} onAgain={() => void playAt({ ...run, results: [] }, 0)} onDone={goHome} />
      );
    } else {
      screen = (
        <HomeScreen
          songs={songs}
          status={status}
          setlist={setSongs_}
          played={played}
          seed={seed}
          importing={importing}
          empty={songs.length === 0}
          onLibrary={() => setView({ name: 'library' })}
          onSet={(ids) => setView({ name: 'lobby', ids, from: 'home' })}
          online={{
            onParty: () => setView({ name: 'party' }),
            onBoards: () => setView({ name: 'boards' }),
            onAdmin: () => setView({ name: 'admin' }),
            part: pick.part,
          }}
          inParty={!!onlineState.party}
          onAdd={addSongs}
          tracks={{
            device,
            previewing: heard,
            onCurrent: setHighlight,
            onNew: addTrack,
            onPackage: async (file) => (await importFiles([file]))[0],
            onAnalyze: (song) => analysisManager.enqueue(song.id, true),
            onScratch: startFromScratch,
            onOpen: (song) => setView({ name: 'editor', song, back: view }),
          }}
          replays={replays}
          replayActions={replayActions}
          onSettings={() => setView({ name: 'settings', back: view })}
          onStages={(stage) => updateSettings({ ...settings, stage })}
          onExit={canExit() ? () => setExitAsk(true) : undefined}
          update={update.state === 'available' ? update.version : undefined}
          onUpdate={() => setAppCard('update')}
          onInstallApp={update.state === 'unsupported' ? () => setAppCard('install') : undefined}
          settings={settings}
        />
      );
    }
    content = (
      <div className={`menu on-${view.name}`}>
        <MenuBackground graphics={settings.graphics} onReady={onStage} />
        <StageBackdrop />
        <div className="veil" aria-hidden />
        {/* One entrance per screen change; the stage behind it stays. */}
        {booted && (
          <div className={`scene ${sceneDirRef.current} ${fromBoot ? 'from-boot' : ''}`} key={sceneKey}>
            {screen}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app">
      {content}
      {sheet && sheetOpen && (
        <SongSheet
          song={byId.get(sheet.id) ?? sheet}
          status={status[sheet.id] ?? { state: 'idle' }}
          scores={scores}
          slot={setlist.indexOf(sheet.id)}
          setFull={setlist.length >= SET_MAX}
          previewing={heard === sheet.id}
          onToggle={() => toggle(sheet)}
          onAnalyze={() => songActions.analyze([sheet])}
          onExport={() => songActions.exportSong(sheet)}
          onEdit={() => songActions.edit(sheet)}
          onDelete={() => void songActions.remove([sheet])}
          onClose={() => setSheet(null)}
        />
      )}
      {askBackup && (
        <Dialog title="Back up your identity" variant="card" closeLabel="Later" onClose={() => setAskBackup(false)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Back up your identity?</h2>
              <p className="hint">
                It signs you in to {onlineState.info?.name ?? 'this server'} and every server you join, with no password. If this device is
                lost or the game’s data cleared, a backup is the way back to your accounts. You can do it any time under Settings → Online.
              </p>
              <button type="button" className="btn wide" data-sfx="back" onClick={close}>
                Later
              </button>
              <button type="button" className="btn primary wide" data-autofocus onClick={() => (close(), setBackingUp(true))}>
                Back it up now
              </button>
            </div>
          )}
        </Dialog>
      )}
      {backingUp && <IdentityDialog kind="export" onClose={() => setBackingUp(false)} onDone={(m) => notify.success(m)} />}
      {metaSong && (
        <MetadataSheet
          song={byId.get(metaSong.id) ?? metaSong}
          onSave={async (change) => {
            await updateSongMeta(metaSong.id, change);
            await refresh();
          }}
          onClose={() => setMetaSong(null)}
        />
      )}
      {songSettings && view.name === 'play' && (
        <div className="menu settings-over" data-modal>
          <div className="veil" aria-hidden />
          <div className="scene fwd">
            <SettingsScreen
              settings={settings}
              model={model}
              device={device}
              onChange={updateSettings}
              onBack={() => setSongSettings(false)}
              onReplaysDeleted={() => void refreshReplays()}
              inSong
            />
          </div>
        </div>
      )}
      {exportAsk && (
        <ExportVideoDialog
          replay={exportAsk}
          silent={!byId.has(exportAsk.songId)}
          settings={settings.videoExport}
          onChange={(v) => updateSettings({ ...settings, videoExport: v })}
          onStart={(v, plan) => recordVideo(exportAsk, v, plan)}
          onClose={() => setExportAsk(null)}
        />
      )}
      {/* Once per server that takes songs: whether to share the player's own (Settings → Online changes it).
          It waits for the identity's backup question, so one question is asked at a time. */}
      {serverSharing &&
        !askBackup &&
        !backingUp &&
        !settings.shareLibrary &&
        onlineState.server &&
        !settings.shareAsked.includes(onlineState.server) &&
        ['home', 'library', 'party'].includes(view.name) &&
        launch === null && (
          <Dialog
            title="Share your songs?"
            variant="card"
            closeLabel="Not now"
            onClose={() => updateSettings({ ...settingsRef.current, shareAsked: [...settingsRef.current.shareAsked, onlineState.server!] })}
          >
            {(close) => (
              <div className="pause-card">
                <h2 className="display">Share your songs?</h2>
                <p className="hint">
                  {onlineState.info?.name ?? 'This server'} takes songs. Shared, yours show up in the library of everyone on it, to stream
                  or download, and theirs in yours either way. You can change it any time in the library or in Settings → Online.
                </p>
                <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                  Not now
                </button>
                <button
                  type="button"
                  className="btn primary wide"
                  onClick={() =>
                    updateSettings({
                      ...settingsRef.current,
                      shareLibrary: true,
                      shareAsked: [...settingsRef.current.shareAsked, onlineState.server!],
                    })
                  }
                >
                  Share my songs
                </button>
              </div>
            )}
          </Dialog>
        )}
      {exitAsk && (
        <Dialog title="Close the game" variant="card" closeLabel="Stay" onClose={() => setExitAsk(false)}>
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Close the game?</h2>
              <p className="hint">Your library, scores and settings are saved.</p>
              <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                Stay
              </button>
              <button type="button" className="btn primary wide" onClick={() => void exitApp()}>
                Close the game
              </button>
            </div>
          )}
        </Dialog>
      )}
      {joinAsk && !exitAsk && (
        <Dialog
          key={joinAsk.id}
          title="Asks to join"
          variant="card"
          closeLabel="Not now"
          outsideCloses={false}
          onClose={() => answerAsk(joinAsk, false)}
        >
          {() => (
            <div className="pause-card">
              <h2 className="display">{joinAsk.name} asks to join</h2>
              <p className="hint">They asked on Discord to join your party. Let them in, and their game joins it.</p>
              <button type="button" className="btn wide" data-sfx="back" onClick={() => answerAsk(joinAsk, false)}>
                Not now
              </button>
              <button type="button" className="btn primary wide" data-autofocus onClick={() => answerAsk(joinAsk, true)}>
                Let them in
              </button>
            </div>
          )}
        </Dialog>
      )}
      {appCard === 'update' && <UpdateCard settings={settings} onClose={() => setAppCard(null)} />}
      {appCard === 'install' && <InstallAppCard settings={settings} onClose={() => setAppCard(null)} />}
      {typing && <VirtualKeyboard target={typing} settings={settings} onClose={() => setTyping(null)} />}
      {/* The desktop window has no title bar: in Window mode this strip along the top moves it. */}
      {inDesktopApp() && settings.displayMode === 'windowed' && <div className="drag-strip" data-tauri-drag-region aria-hidden />}
      <ActionBar settings={settings} />
      <FocusRing />
      {dragging && (
        <div className="drop-overlay" aria-hidden>
          <span>Drop songs or Soundwave song files to add them</span>
        </div>
      )}
      {launch && (
        <div className={`launch-wipe ${launch}`} aria-hidden data-nav-off>
          <Busy />
          <span />
          <span />
          <span />
        </div>
      )}
      <Notifications
        settings={settings}
        place={songOnScreen ? 'top' : 'bar'}
        quiet={songOnScreen}
        shortcut={!songOnScreen && view.name !== 'editor'}
      />
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPTED}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) void importFiles(files);
        }}
      />
    </div>
  );
}
