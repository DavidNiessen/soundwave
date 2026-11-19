import {
  Box,
  Check,
  ChevronDown,
  Copy,
  Dices,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Paintbrush,
  Palette,
  Plus,
  Sparkles,
  Trash2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { keysOf } from '../input/bindings';
import {
  BUILT_IN,
  copyStage,
  FEATURED,
  findStage,
  isBuiltIn,
  randomColors,
  RANGES,
  stageMedia,
  stageWeight,
  SKIES,
  SWATCHES,
  TEMPLATE_INFO,
  type BackdropKind,
  type StageColors,
  type StageDef,
  type StageSettings,
} from '../game/stages';
import type { Settings } from '../game/settings';
import { playSfx } from '../audio/sfx';
import { menuPulse } from '../input/rumble';
import { boostMenuStage } from '../render/aurora/menuStage';
import { setPreviewStage } from '../render/stage/showStage';
import { DEFAULT_VENUE, menuVenue, VENUE_CHOICES, type VenueChoice } from '../render/venues/catalog';
import { preloadStage } from '../render/stage/StageView';
import { VenuePicture } from './VenuePicture';
import { useSlide } from './useSlide';
import { deleteMedia, getMedia, mediaIds, mediaUrl, putMedia } from '../storage/stageMedia';
import { useHints, type Action } from './actions';
import { Dialog } from './Dialog';
import { ColorPicker } from './ColorPicker';
import { ICON_STROKE } from './icons';
import { ON_OFF, RowView, type Row } from './SettingsScreen';

interface Options {
  stages: StageSettings;
  /** The player's settings, for the button glyphs. */
  settings: Settings;
  /** Whether the browser is on screen (the main menu's Stage tab): only then does it show its stages. */
  on: boolean;
  onChange(next: StageSettings): void;
}

/** The show's own colours, for the cards of stages without colours of their own. */
const SHOW_COLORS: StageColors = { key: '#ff66c2', accent: '#6be6ff', wash: '#4d33ff' };
const WEIGHT_LABEL = { light: 'Light to draw', medium: 'Medium to draw', heavy: 'Heavy to draw' } as const;
const BACKDROP_LABEL: Record<BackdropKind, string> = { venue: '3D stage', video: 'Video', image: 'Picture', gradient: 'Colour' };
const SHOW_OPTIONS = [
  { value: 'chill', label: 'Chill', help: 'Slow, soft light changes. Easy on the eyes.' },
  { value: 'normal', label: 'Normal', help: 'The show follows the music as it was made to.' },
  { value: 'festival', label: 'Festival', help: 'Everything goes, even in quiet parts.' },
];
const TURNS = [
  { value: '0', label: 'Upright' },
  { value: '1', label: '90° right' },
  { value: '2', label: 'Upside down' },
  { value: '3', label: '90° left' },
];
/** The ways to start a new stage: what is behind the highway. */
const STARTS: { kind: BackdropKind; label: string; help: string; icon: LucideIcon }[] = [
  { kind: 'venue', label: '3D stage', help: 'The live stage with lights, band and crowd.', icon: Box },
  { kind: 'video', label: 'My video', help: 'A video of yours, on a loop.', icon: Film },
  { kind: 'image', label: 'My picture', help: 'A picture of yours.', icon: ImageIcon },
  { kind: 'gradient', label: 'Colour', help: 'A calm gradient. The lightest to draw.', icon: Palette },
];
/** How long Test the drop runs the show at full tilt, seconds. */
const DROP_SECONDS = 5;
const pct = (v: number) => `${Math.round(v * 100)}%`;
/** The stage behind follows the card in focus once it has stayed there this long, ms. */
const PREVIEW_SETTLE_MS = 70;
/** An edit reaches the settings (and the disk) once changes have paused this long, ms. */
const COMMIT_MS = 350;
/** Edits closer together than this are undone as one (a slider dragged along). */
const UNDO_JOIN_MS = 700;

type History = { def: StageDef; at: number }[];

/** Keeps a stage as it was before a change, for Undo; changes in quick succession are one. */
function remember(history: History, before: StageDef) {
  const now = performance.now();
  const last = history[history.length - 1];
  if (!last || last.def.id !== before.id || now - last.at > UNDO_JOIN_MS) history.push({ def: before, at: now });
  else last.at = now;
}

/** Lets go of kept videos and pictures that no stage uses any more. */
async function tidyMedia(stages: StageSettings) {
  const used = new Set(stages.mine.flatMap(stageMedia));
  for (const id of await mediaIds().catch(() => [] as string[])) if (!used.has(id)) await deleteMedia(id).catch(() => {});
}

/** Asks for a video or picture file and keeps it; resolves to its id and name, or null when none was picked. */
function pickMedia(kind: 'video' | 'image'): Promise<{ id: string; name: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind === 'video' ? 'video/*' : 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      putMedia(file).then(
        (id) => resolve({ id, name: file.name.replace(/\.[^.]+$/, '') }),
        () => resolve(null),
      );
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Makes the mouse wheel run a row sideways (a ref callback: it holds for as long as the row is on
 * the page). Each notch moves the row at once, so nothing in the row's own scrolling pulls it back.
 */
function wheelSideways(row: HTMLDivElement | null) {
  if (!row) return;
  const wheel = (e: WheelEvent) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || row.scrollWidth <= row.clientWidth) return;
    e.preventDefault();
    row.scrollLeft += e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? row.clientWidth : 1);
  };
  row.addEventListener('wheel', wheel, { passive: false });
  return () => row.removeEventListener('wheel', wheel);
}

/** Where the stage's drawers open: over the whole game, as every other sheet does. */
const drawerHost = (): Element => document.querySelector('.app') ?? document.body;

/** A kept file's name, once it is read. */
function useMediaName(id: string | null): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setName(null);
    if (id) void getMedia(id).then((m) => live && setName(m ? m.name : 'File not found'));
    return () => {
      live = false;
    };
  }, [id]);
  return name;
}

/**
 * The stage browser, the main menu's Stage tab. The player's own stages come first, then a few
 * templates (the rest are a press away in the list of all templates), picked from cards while the
 * real stage behind the menu shows the one in focus. A new stage starts from what is behind the
 * highway (the 3D stage, a video, a picture or a colour) and opens in the editor beside the stage,
 * which shows every change at once. Changes are kept as they are made; Undo takes them back.
 *
 * Returns the tab's content and its actions, which the main menu puts in its action bar.
 */
export function useStageBrowser({ stages, settings, on, onChange }: Options): {
  view: ReactNode;
  actions: Action[];
  editing: boolean;
} {
  const hints = useHints(settings);
  const touch = hints.mode === 'touch';
  /** The card in focus (its stage shows behind the menu), and the stage open in the editor. */
  const [focusId, setFocusId] = useState(stages.active);
  const [editId, setEditId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | null>(null);
  /**
   * A panel beside the stage in place of the cards: every template to use or copy, or (for a new
   * 3D stage) the 3D stages to start from.
   */
  const [panel, setPanel] = useState<'templates' | 'start' | null>(null);
  /** The venue a new 3D stage is made in (picked beside the looks it can start from). */
  const [startVenue, setStartVenue] = useState<VenueChoice>(DEFAULT_VENUE);
  const all = panel !== null;
  const setAll = (on: boolean) => setPanel(on ? 'templates' : null);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const history = useRef<History>([]);
  /**
   * The stage being edited as it is right now. A change shows at once (on the stage and in the
   * editor); it reaches the settings, and with them the disk, once the changes pause, so dragging a
   * colour or a slider does not save every setting there is on every frame.
   */
  const [draft, setDraft] = useState<StageDef | null>(null);
  const draftRef = useRef<StageDef | null>(null);
  const commitTimer = useRef(0);
  const editing = on && editId ? ((draft?.id === editId ? draft : null) ?? stages.mine.find((d) => d.id === editId) ?? null) : null;
  const focused = findStage(stages, focusId);
  const shown = editing ?? (panel === 'start' ? { ...focused, venueId: startVenue } : focused);

  // The real stage shows the stage in focus or being edited; leaving the tab puts the one in use back.
  const preview = on ? JSON.stringify(shown) : '';
  // Sweeping across the cards does not switch the stage for every card passed (each switch can start
  // a video): it follows once the pointer or focus settles. Edits show at once.
  const instant = !!editing;
  useEffect(() => {
    const show = () => setPreviewStage(preview ? (JSON.parse(preview) as StageDef) : null);
    if (instant || !preview) return show();
    const t = setTimeout(show, PREVIEW_SETTLE_MS);
    return () => clearTimeout(t);
  }, [preview, instant]);
  useEffect(() => () => setPreviewStage(null), []);
  const latest = useRef(stages);
  latest.current = stages;
  // Leaving the tab closes the editor.
  useEffect(() => {
    if (on) return;
    flushRef.current();
    setEditId(null);
    setDialog(null);
    setAll(false);
    setFocusId(latest.current.active);
  }, [on]);

  const equip = (id: string) => onChange({ ...flush(), active: id });
  /** Hands the edited stage to the settings now; gives the settings as they then are. */
  const flush = (): StageSettings => {
    clearTimeout(commitTimer.current);
    const d = draftRef.current;
    if (!d) return latest.current;
    draftRef.current = null;
    const next = { ...latest.current, mine: latest.current.mine.map((x) => (x.id === d.id ? d : x)) };
    latest.current = next;
    onChange(next);
    setDraft(null);
    return next;
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);
  const save = (def: StageDef) => {
    const before = draftRef.current?.id === def.id ? draftRef.current : latest.current.mine.find((d) => d.id === def.id);
    if (before) remember(history.current, before);
    draftRef.current = def;
    setDraft(def);
    clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => flushRef.current(), COMMIT_MS);
  };
  const undo = () => {
    const s = flush();
    const last = history.current.pop();
    if (last) onChange({ ...s, mine: s.mine.map((d) => (d.id === last.def.id ? last.def : d)) });
  };
  /** A copy of `from` (changed by `patch`) as a new stage of the player's, in use and open in the editor. */
  const create = (from: StageDef, patch: Partial<StageDef> = {}) => {
    const s = flush();
    const def = { ...copyStage(s, from), ...patch };
    onChange({ active: def.id, mine: [...s.mine, def] });
    setFocusId(def.id);
    setEditId(def.id);
    setAll(false);
    history.current = [];
  };
  /** A new stage, from what is to be behind the highway. */
  const start = async (kind: BackdropKind) => {
    setDialog(null);
    // A new 3D stage starts from one of the 3D stages, picked in the panel beside the stage.
    if (kind === 'venue') {
      setFocusId(BUILT_IN[0].id);
      setStartVenue(DEFAULT_VENUE);
      return setPanel('start');
    }
    if (kind === 'gradient') {
      const c = randomColors();
      return create(BUILT_IN[0], { name: 'My colour', backdrop: { kind, from: c.wash, to: c.key } });
    }
    const file = await pickMedia(kind);
    if (file) create(BUILT_IN[0], { name: file.name.slice(0, 32) || 'My stage', backdrop: { kind, media: file.id } });
  };
  const customize = (def: StageDef) => {
    if (isBuiltIn(def.id)) return create(def);
    equip(def.id);
    setEditId(def.id);
    history.current = [];
  };
  const close = () => {
    const s = flush();
    setEditId(null);
    history.current = [];
    void tidyMedia(s);
  };
  const remove = (def: StageDef) => {
    clearTimeout(commitTimer.current);
    draftRef.current = null;
    setDraft(null);
    const next = { active: stages.active === def.id ? 'festival' : stages.active, mine: stages.mine.filter((d) => d.id !== def.id) };
    onChange(next);
    setEditId(null);
    setFocusId(next.active);
    history.current = [];
    void tidyMedia(next);
  };
  // Test the drop: the stage plays one for a few seconds, and the button says so meanwhile. Only a
  // 3D stage has a show to drop.
  const [dropping, setDropping] = useState(false);
  useEffect(() => {
    if (!dropping) return;
    const t = setTimeout(() => setDropping(false), DROP_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [dropping]);
  const drop = () => {
    if (dropping) return;
    boostMenuStage(DROP_SECONDS);
    playSfx('launch');
    menuPulse('launch');
    setDropping(true);
  };
  const dropAction = (def: StageDef): Action[] =>
    def.backdrop.kind === 'venue'
      ? [
          {
            id: 'drop',
            label: dropping ? 'Dropping…' : 'Test the drop',
            icon: Sparkles,
            ...keysOf('stages.drop'),
            disabled: dropping,
            sfx: 'none',
            run: drop,
          },
        ]
      : [];

  const leaveAll = () => {
    setAll(false);
    setFocusId(latest.current.active);
  };
  /** The stage editor drawer's own actions (its Done is the drawer's close). */
  const editorActions: Action[] = !editing
    ? []
    : [
        ...(editing.backdrop.kind === 'venue'
          ? [
              {
                id: 'random',
                label: 'Random colours',
                icon: Dices,
                ...keysOf('stages.random'),
                run: () => save({ ...editing, colors: randomColors() }),
              },
            ]
          : []),
        ...dropAction(editing),
        { id: 'undo', label: 'Undo', icon: Undo2, ...keysOf('stages.undo'), bar: false, run: undo },
      ];
  const actions: Action[] =
    !on || dialog || editing || all
      ? []
      : [
          { id: 'new', label: 'New stage', icon: Plus, ...keysOf('stages.new'), primary: true, run: () => setDialog('new') },
          {
            id: 'edit',
            label: isBuiltIn(shown.id) ? 'Copy and customize' : 'Customize',
            icon: Paintbrush,
            ...keysOf('stages.edit'),
            run: () => customize(shown),
          },
          ...dropAction(shown),
        ];

  // The templates in view: the featured ones, and the one in use when it is another.
  const templates = BUILT_IN.filter((d) => FEATURED.includes(d.id) || d.id === stages.active);
  const card = (d: StageDef, info?: string) => (
    <StageCard
      key={d.id}
      def={d}
      info={info}
      active={d.id === stages.active}
      focused={d.id === shown.id}
      onFocus={() => setFocusId(d.id)}
      onPick={() => (d.id === stages.active && !isBuiltIn(d.id) ? customize(d) : equip(d.id))}
    />
  );
  const inUse = findStage(stages, stages.active);
  const view = (
    <div className={`stages ${editing ? 'is-editing' : ''}`}>
      <div className="edit-head">
        <h2 className="page-title">Pick a stage</h2>
        <p className="head-count">{`${inUse.name} in use · press a stage to use it`}</p>
      </div>
      <div className="stages-body">
        {editing ? (
          <Editor
            def={editing}
            actions={editorActions}
            onClose={close}
            touch={touch}
            activeRow={activeRow}
            setActiveRow={setActiveRow}
            onSave={save}
            onUndo={undo}
            canUndo={history.current.length > 0}
            onDelete={() => remove(editing)}
          />
        ) : all ? (
          <TemplatePanel
            mode={panel === 'start' ? 'start' : 'browse'}
            active={stages.active}
            shown={shown.id}
            onFocus={setFocusId}
            onUse={(id) => {
              if (panel === 'start') return create(findStage(stages, id), { venueId: startVenue });
              equip(id);
              setAll(false);
              setFocusId(id);
            }}
            onCopy={(d) => create(d)}
            onClose={leaveAll}
            venue={startVenue}
            onVenue={setStartVenue}
          />
        ) : (
          <div className="stage-cards" ref={wheelSideways} data-nav-group="stage-cards">
            <div className="card-group" role="listbox" aria-label="Your stages">
              <span className="card-group-label">Your stages</span>
              <div className="card-row">
                {stages.mine.map((d) => card(d))}
                <button type="button" className="stage-card new" onClick={() => setDialog('new')} onFocus={() => setFocusId(stages.active)}>
                  <span className="stage-art" aria-hidden>
                    <span className="mosaic blank dashed">
                      <Plus strokeWidth={ICON_STROKE} />
                    </span>
                  </span>
                  <span className="tile-text">
                    <span className="tile-title stage-title">New stage</span>
                    <span className="tile-meta stage-meta">
                      {stages.mine.length ? 'A 3D stage, video, picture or colour' : 'Make your first stage'}
                    </span>
                  </span>
                </button>
              </div>
            </div>
            <div className="card-group" role="listbox" aria-label="Templates">
              <span className="card-group-label">Templates</span>
              <div className="card-row">
                {templates.map((d) => card(d))}
                <button type="button" className="stage-card new" onClick={() => setAll(true)} onFocus={() => setFocusId(stages.active)}>
                  <span className="stage-art" aria-hidden>
                    <span className="mosaic blank dashed">
                      <LayoutGrid strokeWidth={ICON_STROKE} />
                    </span>
                  </span>
                  <span className="tile-text">
                    <span className="tile-title stage-title">All templates</span>
                    <span className="tile-meta stage-meta">{BUILT_IN.length} to choose from</span>
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      {dialog === 'new' && (
        <Dialog title="New stage" variant="card" className="new-stage-card" onClose={() => setDialog(null)} closeLabel="Cancel">
          <div className="pause-card new-stage">
            <h2 className="display new-stage-title">New stage</h2>
            <p className="hint">What goes behind the highway? You can change anything later.</p>
            <div className="start-grid">
              {STARTS.map(({ kind, label, help, icon: Icon }, i) => (
                <button
                  key={kind}
                  type="button"
                  className={`start-option start-${kind}`}
                  data-autofocus={i === 0 ? '' : undefined}
                  onClick={() => void start(kind)}
                >
                  <span className="start-art" aria-hidden>
                    <Icon strokeWidth={1.8} />
                  </span>
                  <span className="tile-text">
                    <span className="tile-title start-label">{label}</span>
                    <span className="tile-meta start-help">{help}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
  // While a stage is edited or every template is shown, Esc steps back here, not out of the game.
  return { view, actions, editing: !!editing || (on && all) };
}

/** A stage at a glance: its colours and darkness for a 3D stage, else its picture, video or colour. */
function Swatch({ def }: { def: StageDef }) {
  const c = def.colors ?? SHOW_COLORS;
  const b = def.backdrop;
  const media = (b.kind === 'video' || b.kind === 'image') && b.media ? b.media : null;
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setThumb(null);
    if (media) void mediaUrl(media).then((u) => live && setThumb(u));
    return () => {
      live = false;
    };
  }, [media]);
  if (b.kind === 'venue')
    return (
      <span
        className="stage-swatch venue"
        aria-hidden
        style={{
          ['--key' as string]: c.key,
          ['--accent' as string]: c.accent,
          ['--wash' as string]: c.wash,
          ['--dark' as string]: 1 - Math.min(1, def.venue) * 0.75,
          ['--beams' as string]: Math.min(1, def.beams),
        }}
      >
        <VenuePicture venue={def.venueId} />
      </span>
    );
  return (
    <span
      className="stage-swatch media"
      aria-hidden
      style={b.kind === 'gradient' ? { background: `linear-gradient(160deg, ${b.from}, ${b.to})` } : undefined}
    >
      {b.kind === 'image' && thumb && <img src={thumb} alt="" />}
      {b.kind === 'video' && thumb && <video src={thumb} muted playsInline preload="metadata" />}
      {b.kind === 'video' && <Film className="media-icon" strokeWidth={ICON_STROKE} />}
      {(b.kind === 'video' || b.kind === 'image') && !b.media && <span className="stage-cycle">No file yet</span>}
    </span>
  );
}

function StageCard({
  def,
  info,
  active,
  focused,
  onFocus,
  onPick,
}: {
  def: StageDef;
  /** What the stage is like, in place of its tags (the list of all templates). */
  info?: string;
  active: boolean;
  focused: boolean;
  onFocus(): void;
  onPick(): void;
}) {
  const b = def.backdrop;
  const tags = [
    b.kind !== 'venue' ? BACKDROP_LABEL[b.kind] : !def.colors ? 'Changes with the show' : null,
    b.kind === 'venue' && def.screens ? 'Video on the screens' : null,
    WEIGHT_LABEL[stageWeight(def)],
  ].filter(Boolean);
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      className={`stage-card ${active ? 'active' : ''} ${focused ? 'focused' : ''}`}
      data-autofocus={active ? '' : undefined}
      onFocus={onFocus}
      onPointerEnter={(e) => e.pointerType === 'mouse' && onFocus()}
      onClick={onPick}
    >
      <span className="stage-art">
        <Swatch def={def} />
        {active && (
          <span className="stage-badge">
            <Check strokeWidth={3} aria-hidden /> In use
          </span>
        )}
      </span>
      <span className="tile-text">
        <span className="tile-title stage-title">{def.name}</span>
        <span className="tile-meta stage-meta">{info ?? tags.join(' · ')}</span>
      </span>
    </button>
  );
}

interface EditorProps {
  def: StageDef;
  /** The drawer's actions for the bar, and what closing it does. */
  actions: Action[];
  onClose(): void;
  touch: boolean;
  activeRow: string | null;
  setActiveRow(id: string): void;
  onSave(def: StageDef): void;
  onUndo(): void;
  canUndo: boolean;
  onDelete(): void;
}

function Editor({ def, actions, onClose, touch, activeRow, setActiveRow, onSave, onUndo, canUndo, onDelete }: EditorProps) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const picker = (label: string) => ({
    label,
    open: pickerFor === label,
    onToggle: () => setPickerFor((p) => (p === label ? null : label)),
    // Picking one of the ready colours (in any row) puts the open picker away.
    onPreset: () => setPickerFor(null),
  });
  const [more, setMore] = useState(false);
  const set = (patch: Partial<StageDef>) => onSave({ ...def, ...patch });
  const b = def.backdrop;
  const venue = b.kind === 'venue';
  const fileId = b.kind === 'video' || b.kind === 'image' ? b.media : null;
  const fileName = useMediaName(fileId);
  const screensName = useMediaName(def.screens);
  const onOff = (id: keyof StageDef, label: string, help: string, value: boolean): Row => ({
    kind: 'choice',
    id,
    label,
    help,
    value: value ? 'on' : 'off',
    options: ON_OFF,
    set: (v) => set({ [id]: v === 'on' }),
  });
  const slider = (id: 'brightness' | 'venue' | 'haze' | 'beams' | 'dim', label: string, help: string, format = pct): Row => ({
    kind: 'slider',
    id,
    label,
    help,
    value: def[id],
    ...RANGES[id],
    format,
    set: (v) => set({ [id]: v }),
  });
  const chooseFile = (kind: 'video' | 'image') => void pickMedia(kind).then((f) => f && set({ backdrop: { kind, media: f.id } }));
  const chooseScreens = () => void pickMedia('video').then((f) => f && set({ screens: f.id }));

  const backdropRows: Row[] = [
    {
      kind: 'choice',
      id: 'backdrop',
      label: 'Background',
      help: 'What is behind the highway: the 3D stage with its lights, or instead your own video, picture or colour.',
      value: b.kind,
      options: (Object.keys(BACKDROP_LABEL) as BackdropKind[]).map((k) => ({ value: k, label: BACKDROP_LABEL[k] })),
      set: (v) =>
        set({
          backdrop:
            v === 'gradient'
              ? { kind: 'gradient', from: '#1a0f4c', to: def.colors?.key ?? '#ff4d9d' }
              : v === 'video' || v === 'image'
                ? { kind: v, media: b.kind === v ? b.media : null }
                : { kind: 'venue' },
        }),
    },
  ];
  if (b.kind === 'video' || b.kind === 'image') {
    backdropRows.push({
      kind: 'action',
      id: 'file',
      label: b.kind === 'video' ? 'Video' : 'Picture',
      help:
        b.kind === 'video'
          ? 'Plays silently on a loop. It stays on this device: a library backup keeps the stage but not the video.'
          : 'Fills the screen behind the highway. It stays on this device: a library backup keeps the stage but not the picture.',
      button: fileId ? 'Change' : 'Choose',
      run: () => chooseFile(b.kind as 'video' | 'image'),
      note: <span className="pill">{fileId ? (fileName ?? '…') : 'None yet'}</span>,
    });
  }
  if (!venue) backdropRows.push(slider('dim', 'Darken', 'Darkens the background so the notes in front of it stay easy to read.'));

  const sections: { title: string; rows: Row[]; colors?: boolean; gradient?: boolean }[] = [
    {
      title: 'Name',
      rows: [
        {
          kind: 'text',
          id: 'name',
          label: 'Name',
          help: 'What the stage is called on its card.',
          value: def.name,
          set: (v) => set({ name: v.slice(0, 32) }),
        },
      ],
    },
    { title: 'Background', rows: backdropRows, gradient: b.kind === 'gradient' },
  ];
  if (venue) {
    sections.push(
      {
        title: 'Venue and sky',
        rows: [
          {
            kind: 'choice',
            id: 'venueId',
            label: 'Venue',
            help: `${VENUE_CHOICES.find((v) => v.id === def.venueId)?.blurb ?? ''}.`,
            value: def.venueId,
            options: VENUE_CHOICES.map((v) => ({ value: v.id, label: v.name, help: `${v.blurb}.` })),
            set: (v) => set({ venueId: v as VenueChoice }),
          },
          {
            kind: 'choice',
            id: 'sky',
            label: 'Sky',
            help: `${SKIES.map((x) => `${x.label}: ${x.help}`).join(' ')} Moonrise only: the other venues bring their own sky.`,
            value: def.sky,
            options: SKIES,
            set: (v) => set({ sky: v as StageDef['sky'] }),
          },
        ],
      },
      {
        title: 'Colours and light',
        colors: true,
        rows: [
          {
            kind: 'choice',
            id: 'colorMode',
            label: 'Colours',
            help: 'The show’s own colours change as the music moves on. Your own colour the lights and the arches.',
            value: def.colors ? 'own' : 'show',
            options: [
              { value: 'show', label: 'The show’s' },
              { value: 'own', label: 'My own' },
            ],
            set: (v) => set({ colors: v === 'own' ? (def.colors ?? randomColors()) : null }),
          },
          slider(
            'venue',
            'Stage light',
            'How lit the stage, its screens and the sky are. All the way down is a black stage, with only the beams in the dark.',
            (v) => (v === 0 ? 'Black' : pct(v)),
          ),
        ],
      },
      {
        title: 'Screens',
        rows: [
          {
            kind: 'choice',
            id: 'screensMode',
            label: 'Screens show',
            help: 'Moonrise’s big round screen and the screens beside it: the show’s own pictures, or a video of yours. The other venues keep their own pictures.',
            value: def.screens ? 'video' : 'show',
            options: [
              { value: 'show', label: 'The show' },
              { value: 'video', label: 'My video' },
            ],
            set: (v) => (v === 'show' ? set({ screens: null }) : chooseScreens()),
          },
          ...(def.screens
            ? ([
                {
                  kind: 'action',
                  id: 'screensFile',
                  label: 'Video',
                  help: 'Plays silently on a loop on the stage’s screens. It stays on this device.',
                  button: 'Change',
                  run: chooseScreens,
                  note: <span className="pill">{screensName ?? '…'}</span>,
                },
                {
                  kind: 'choice',
                  id: 'screensTurn',
                  label: 'Turn',
                  help: 'Turns the video on the screens, for one that shows on its side or upside down.',
                  value: String(def.screensTurn),
                  options: TURNS,
                  set: (v) => set({ screensTurn: Number(v) }),
                },
                onOff('screensMirror', 'Mirror', 'Flips the video on the screens left to right.', def.screensMirror),
              ] satisfies Row[])
            : []),
        ],
      },
    );
    if (more)
      sections.push(
        {
          title: 'Light',
          rows: [
            slider('brightness', 'Brightness', 'How bright the whole picture is.'),
            slider('haze', 'Haze', 'Fog in the air: more makes the beams stand out as rays.'),
            slider('beams', 'Beams', 'How strong the moving beams are.'),
          ],
        },
        {
          title: 'Show',
          rows: [
            {
              kind: 'choice',
              id: 'show',
              label: 'Show',
              help: 'How much the lights move with the music.',
              value: def.show,
              options: SHOW_OPTIONS,
              set: (v) => set({ show: v as StageDef['show'] }),
            },
            onOff(
              'flashes',
              'Flashes',
              'Hard flashes of light on the beat. Off, the lights still move with the music, only softly.',
              def.flashes,
            ),
            onOff('crowd', 'Crowd', 'The audience in front of the stage. Without it the stage is quicker to draw.', def.crowd),
            onOff('pyro', 'Fireworks and flames', 'Fireworks, flame jets and CO2 in songs (the menus never set them off).', def.pyro),
          ],
        },
      );
  }
  const first = sections[0].rows[0];
  const help =
    sections.flatMap((sec) => sec.rows).find((r) => r.id === activeRow)?.help ??
    'Every change shows on the stage behind and is kept as you make it. Point at a setting to see what it does.';
  return createPortal(
    <Dialog title={`Customize ${def.name}`} className="see-through stage-drawer" closeLabel="Done" onClose={onClose} actions={actions}>
      {(closeDrawer) => (
        <div className="sheet-body stage-sheet" data-nav-group="stage-editor">
          <div className="stage-head">
            <h2 className="display meta-heading">Customize</h2>
            <p className="stage-help" aria-live="polite">
              {help}
            </p>
          </div>
          {sections.map((sec) => (
            <section key={sec.title} className="set-section">
              <h2 className="set-heading">{sec.title}</h2>
              {sec.rows.map((row) => (
                <RowView
                  key={row.id}
                  row={row}
                  active={activeRow === row.id}
                  first={row === first}
                  touch={touch}
                  onActive={() => setActiveRow(row.id)}
                />
              ))}
              {sec.gradient && b.kind === 'gradient' && (
                <>
                  <ColorRow {...picker('Top')} value={b.from} onPick={(hex) => set({ backdrop: { ...b, from: hex } })} />
                  <ColorRow {...picker('Bottom')} value={b.to} onPick={(hex) => set({ backdrop: { ...b, to: hex } })} />
                </>
              )}
              {sec.colors && def.colors && (
                <>
                  {(['key', 'accent', 'wash'] as const).map((k) => (
                    <ColorRow
                      key={k}
                      {...picker({ key: 'Beams', accent: 'Second beams', wash: 'Stage' }[k])}
                      value={def.colors![k]}
                      onPick={(hex) => set({ colors: { ...def.colors!, [k]: hex } })}
                    />
                  ))}
                  <div className="stage-tools">
                    <button type="button" className="btn small" onClick={() => set({ colors: randomColors() })}>
                      <Dices strokeWidth={ICON_STROKE} aria-hidden /> Random colours
                    </button>
                  </div>
                </>
              )}
            </section>
          ))}
          {venue && (
            <button
              type="button"
              className={`btn small more-toggle ${more ? 'open' : ''}`}
              aria-expanded={more}
              onClick={() => setMore((m) => !m)}
            >
              <ChevronDown strokeWidth={ICON_STROKE} aria-hidden /> {more ? 'Fewer options' : 'More options'}
            </button>
          )}
          {!venue && b.kind !== 'gradient' && !fileId && (
            <p className="stage-note">
              <ImageIcon strokeWidth={ICON_STROKE} aria-hidden /> Choose a file above: until then the background stays dark.
            </p>
          )}
          <div className="stage-foot">
            <div className="sheet-actions">
              <DeleteButton onDelete={onDelete} />
              <button type="button" className="btn" disabled={!canUndo} onClick={onUndo}>
                <Undo2 strokeWidth={ICON_STROKE} aria-hidden /> Undo
              </button>
              <button type="button" className="btn primary" data-sfx="back" onClick={closeDrawer}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </Dialog>,
    drawerHost(),
  );
}

/**
 * A colour of the stage: a press on one of the ready colours, or the picker (the rainbow dot) for
 * any colour at all, opening beneath the row.
 */
function ColorRow({
  label,
  value,
  open,
  onToggle,
  onPreset,
  onPick,
}: {
  label: string;
  value: string;
  open: boolean;
  onToggle(): void;
  /** A ready colour was picked: the picker closes. */
  onPreset(): void;
  onPick(hex: string): void;
}) {
  const own = !SWATCHES.some((hex) => hex.toLowerCase() === value.toLowerCase());
  return (
    <div className={`color-block ${open ? 'open' : ''}`}>
      <div className="color-row" role="group" aria-label={label}>
        <span className="set-label">{label}</span>
        <span className="color-swatches">
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              className={`color-dot ${hex.toLowerCase() === value.toLowerCase() ? 'on' : ''}`}
              style={{ background: hex }}
              aria-label={hex}
              aria-pressed={hex.toLowerCase() === value.toLowerCase()}
              onClick={() => {
                onPick(hex);
                onPreset();
              }}
            />
          ))}
          <button
            type="button"
            className={`color-own ${own ? 'on' : ''} ${open ? 'open' : ''}`}
            style={own ? { ['--own' as string]: value } : undefined}
            aria-label={open ? `${label}: close the colour picker` : `${label}: pick any colour`}
            aria-expanded={open}
            title="Any colour"
            onClick={onToggle}
          >
            <span className="own-wheel" aria-hidden />
            {own && <span className="own-fill" aria-hidden />}
          </button>
        </span>
      </div>
      {open && <ColorPicker label={label} value={value} onChange={onPick} />}
    </div>
  );
}

/** Deleting a stage takes two presses: the first asks, the second (within a few seconds) deletes. */
function DeleteButton({ onDelete }: { onDelete(): void }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = setTimeout(() => setAsking(false), 4000);
    return () => clearTimeout(t);
  }, [asking]);
  return (
    <button
      type="button"
      className={`btn ${asking ? 'danger' : 'quiet-danger'}`}
      onClick={() => (asking ? onDelete() : setAsking(true))}
      onBlur={() => setAsking(false)}
    >
      <Trash2 strokeWidth={ICON_STROKE} aria-hidden /> {asking ? 'Press again to delete' : 'Delete'}
    </button>
  );
}

/**
 * Every template beside the stage: a row each with its picture, name and what it is like. Pointing at
 * one (or moving to it) shows it on the stage; pressing it puts it in use; its copy button makes a
 * stage of the player's own from it.
 */
function TemplatePanel({
  mode,
  active,
  shown,
  onFocus,
  onUse,
  onCopy,
  onClose,
  venue,
  onVenue,
}: {
  /** `browse`: use a template or copy it; `start`: pick the 3D stage a new one starts from. */
  mode: 'browse' | 'start';
  active: string;
  shown: string;
  onFocus(id: string): void;
  onUse(id: string): void;
  onCopy(d: StageDef): void;
  onClose(): void;
  /** The venue a new stage is made in (start mode): the looks are seen in it. */
  venue: VenueChoice;
  onVenue(venue: VenueChoice): void;
}) {
  const start = mode === 'start';
  const venueRow = useSlide<HTMLDivElement>(venue);
  const picked = VENUE_CHOICES.find((v) => v.id === venue) ?? VENUE_CHOICES[0];
  return createPortal(
    <Dialog title={start ? 'Pick a 3D stage' : 'Templates'} className="see-through stage-drawer" onClose={onClose}>
      <div className="sheet-body template-panel" data-nav-group="templates">
        <div>
          <h2 className="display meta-heading">{start ? 'Pick a 3D stage' : 'Templates'}</h2>
          <p className="hint">
            {start
              ? 'Pick a venue, then a look: point at one to see it, press it to make it yours.'
              : 'Use one as it is, or copy it to make it your own.'}
          </p>
        </div>
        {start && (
          <div className="start-venue">
            <h3 className="label" id="start-venue-label">
              Venue
            </h3>
            <div
              className="venue-row slide"
              ref={venueRow}
              role="radiogroup"
              aria-labelledby="start-venue-label"
              aria-describedby="start-venue-blurb"
            >
              <span className="sel" aria-hidden />
              {VENUE_CHOICES.map((v) => {
                const on = venue === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`choice venue ${on ? 'on' : ''}`}
                    data-on={on}
                    role="radio"
                    aria-checked={on}
                    onClick={() => onVenue(v.id)}
                    onFocus={() => preloadStage(menuVenue(v.id))}
                    onPointerEnter={() => preloadStage(menuVenue(v.id))}
                  >
                    <VenuePicture venue={v.id} />
                    <span>{v.name}</span>
                  </button>
                );
              })}
            </div>
            <p className="venue-blurb dim" id="start-venue-blurb">
              {picked.blurb}
              {venue === 'random' ? '. The menus show Moonrise.' : '.'}
            </p>
          </div>
        )}
        <ul className="template-list">
          {(start ? BUILT_IN.filter((d) => d.venueId === DEFAULT_VENUE) : BUILT_IN).map((d) => (
            <li key={d.id} className={`template-row ${d.id === active ? 'active' : ''} ${d.id === shown ? 'shown' : ''}`}>
              <button
                type="button"
                className="template-use"
                data-autofocus={(start ? d.id === BUILT_IN[0].id : d.id === active) ? '' : undefined}
                onFocus={() => onFocus(d.id)}
                onPointerEnter={(e) => e.pointerType === 'mouse' && onFocus(d.id)}
                onClick={() => onUse(d.id)}
              >
                {/* Starting a new stage, each look is seen in the venue picked above. */}
                <Swatch def={start ? { ...d, venueId: venue } : d} />
                <span className="template-text">
                  <span className="stage-name">
                    {d.name}
                    {!start && d.id === active && <span className="pill ready">In use</span>}
                  </span>
                  <span className="stage-tags">{TEMPLATE_INFO[d.id]}</span>
                </span>
              </button>
              {!start && (
                <button
                  type="button"
                  className="template-copy"
                  aria-label={`Copy ${d.name} and customize it`}
                  title="Copy and customize"
                  onFocus={() => onFocus(d.id)}
                  onClick={() => onCopy(d)}
                >
                  <Copy strokeWidth={ICON_STROKE} aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>,
    drawerHost(),
  );
}
