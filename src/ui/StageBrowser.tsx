import {
  Box,
  Check,
  ChevronDown,
  Dices,
  Film,
  Image as ImageIcon,
  LayoutGrid,
  Paintbrush,
  Palette,
  Plus,
  Sparkles,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { keysOf } from '../input/bindings';
import { PadGlyph } from '../input/glyphs';
import { confirmInput } from '../input/pads';
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
  SWATCHES,
  TEMPLATE_INFO,
  type BackdropKind,
  type StageColors,
  type StageDef,
  type StageSettings,
} from '../game/stages';
import type { Settings } from '../game/settings';
import { boostMenuStage } from '../render/aurora/menuStage';
import { setPreviewStage } from '../render/stage/showStage';
import { deleteMedia, getMedia, mediaIds, mediaUrl, putMedia } from '../storage/stageMedia';
import { useHints, type Action } from './actions';
import { Dialog } from './Dialog';
import { HoldButton } from './HoldButton';
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
  { kind: 'venue', label: '3D stage', help: 'The lit stage with its band and crowd, in colours and light of your own.', icon: Box },
  { kind: 'video', label: 'My video', help: 'A video file of yours, playing silently behind the highway.', icon: Film },
  { kind: 'image', label: 'My picture', help: 'A picture of yours behind the highway.', icon: ImageIcon },
  { kind: 'gradient', label: 'Colour', help: 'A calm colour gradient, the lightest of all to draw.', icon: Palette },
];
const pct = (v: number) => `${Math.round(v * 100)}%`;
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
export function useStageBrowser({ stages, settings, on, onChange }: Options): { view: ReactNode; actions: Action[]; editing: boolean } {
  const hints = useHints(settings);
  const touch = hints.mode === 'touch';
  /** The card in focus (its stage shows behind the menu), and the stage open in the editor. */
  const [focusId, setFocusId] = useState(stages.active);
  const [editId, setEditId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'new' | 'templates' | null>(null);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const history = useRef<History>([]);
  const cardsRef = useRef<HTMLDivElement>(null);
  const editing = on && editId ? (stages.mine.find((d) => d.id === editId) ?? null) : null;
  const shown = editing ?? findStage(stages, focusId);

  // The real stage shows the stage in focus or being edited; leaving the tab puts the one in use back.
  const preview = on ? JSON.stringify(shown) : '';
  useEffect(() => setPreviewStage(preview ? (JSON.parse(preview) as StageDef) : null), [preview]);
  useEffect(() => () => setPreviewStage(null), []);
  const latest = useRef(stages);
  latest.current = stages;
  // Leaving the tab closes the editor.
  useEffect(() => {
    if (on) return;
    setEditId(null);
    setDialog(null);
    setFocusId(latest.current.active);
  }, [on]);
  // The mouse wheel runs the cards sideways.
  useEffect(() => {
    const row = cardsRef.current;
    if (!on || !row) return;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      row.scrollBy({ left: e.deltaY * (e.deltaMode === 1 ? 40 : 1), behavior: 'smooth' });
    };
    row.addEventListener('wheel', wheel, { passive: false });
    return () => row.removeEventListener('wheel', wheel);
  }, [on, editing]);

  const equip = (id: string) => onChange({ ...stages, active: id });
  const save = (def: StageDef) => {
    const before = latest.current.mine.find((d) => d.id === def.id);
    if (before) remember(history.current, before);
    onChange({ ...latest.current, mine: latest.current.mine.map((d) => (d.id === def.id ? def : d)) });
  };
  const undo = () => {
    const last = history.current.pop();
    if (last) onChange({ ...stages, mine: stages.mine.map((d) => (d.id === last.def.id ? last.def : d)) });
  };
  /** A copy of `from` (changed by `patch`) as a new stage of the player's, in use and open in the editor. */
  const create = (from: StageDef, patch: Partial<StageDef> = {}) => {
    const s = latest.current;
    const def = { ...copyStage(s, from), ...patch };
    onChange({ active: def.id, mine: [...s.mine, def] });
    setFocusId(def.id);
    setEditId(def.id);
    history.current = [];
  };
  /** A new stage, from what is to be behind the highway. */
  const start = async (kind: BackdropKind) => {
    setDialog(null);
    const venue = shown.backdrop.kind === 'venue' ? shown : BUILT_IN[0];
    if (kind === 'venue') return create(venue);
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
    setEditId(null);
    history.current = [];
    void tidyMedia(latest.current);
  };
  const remove = (def: StageDef) => {
    const next = { active: stages.active === def.id ? 'festival' : stages.active, mine: stages.mine.filter((d) => d.id !== def.id) };
    onChange(next);
    setEditId(null);
    setFocusId(next.active);
    history.current = [];
    void tidyMedia(next);
  };
  const drop = () => boostMenuStage(5);

  const actions: Action[] =
    !on || dialog
      ? []
      : editing
        ? [
            { id: 'done', label: 'Done', icon: Check, kbd: 'Escape', sfx: 'back', run: close },
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
            { id: 'drop', label: 'Test the drop', icon: Sparkles, ...keysOf('stages.drop'), run: drop },
            { id: 'undo', label: 'Undo', icon: Undo2, ...keysOf('stages.undo'), bar: false, run: undo },
          ]
        : [
            { id: 'new', label: 'New stage', icon: Plus, ...keysOf('stages.new'), primary: true, run: () => setDialog('new') },
            {
              id: 'edit',
              label: isBuiltIn(shown.id) ? 'Copy and customize' : 'Customize',
              icon: Paintbrush,
              ...keysOf('stages.edit'),
              run: () => customize(shown),
            },
            { id: 'drop', label: 'Test the drop', icon: Sparkles, ...keysOf('stages.drop'), run: drop },
          ];

  // The templates in view: the featured ones, and the one in use when it is another.
  const templates = BUILT_IN.filter((d) => FEATURED.includes(d.id) || d.id === stages.active);
  const card = (d: StageDef) => (
    <StageCard
      key={d.id}
      def={d}
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
        <h2 className="page-title">{editing ? 'Customize' : 'Pick a stage'}</h2>
        <p className="head-count">{editing ? editing.name : `${inUse.name} in use · press a stage to use it`}</p>
      </div>
      <div className="stages-body">
        {editing && (
          <Editor
            def={editing}
            hints={hints}
            touch={touch}
            activeRow={activeRow}
            setActiveRow={setActiveRow}
            onSave={save}
            onUndo={undo}
            canUndo={history.current.length > 0}
            onDelete={() => remove(editing)}
          />
        )}
        <div className="stage-cards" ref={cardsRef} data-nav-group="stage-cards" inert={editing ? true : undefined}>
          <div className="card-group" role="listbox" aria-label="Your stages">
            <span className="card-group-label">Your stages</span>
            <div className="card-row">
              {stages.mine.map(card)}
              <button type="button" className="stage-card new" onClick={() => setDialog('new')} onFocus={() => setFocusId(stages.active)}>
                <span className="stage-swatch blank" aria-hidden>
                  <Plus strokeWidth={ICON_STROKE} />
                </span>
                <span className="stage-name">New stage</span>
                <span className="stage-tags">{stages.mine.length ? 'A 3D stage, video, picture or colour' : 'Make your first stage'}</span>
              </button>
            </div>
          </div>
          <div className="card-group" role="listbox" aria-label="Templates">
            <span className="card-group-label">Templates</span>
            <div className="card-row">
              {templates.map(card)}
              <button
                type="button"
                className="stage-card new"
                onClick={() => setDialog('templates')}
                onFocus={() => setFocusId(stages.active)}
              >
                <span className="stage-swatch blank" aria-hidden>
                  <LayoutGrid strokeWidth={ICON_STROKE} />
                </span>
                <span className="stage-name">All templates</span>
                <span className="stage-tags">{BUILT_IN.length} to choose from</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      {dialog === 'new' && (
        <Dialog title="New stage" variant="card" onClose={() => setDialog(null)} closeLabel="Cancel">
          <div className="pause-card new-stage">
            <h2 className="display">What’s behind the highway?</h2>
            <div className="start-grid">
              {STARTS.map(({ kind, label, help, icon: Icon }, i) => (
                <button
                  key={kind}
                  type="button"
                  className="start-option"
                  data-autofocus={i === 0 ? '' : undefined}
                  onClick={() => void start(kind)}
                >
                  <Icon strokeWidth={ICON_STROKE} aria-hidden />
                  <span className="start-label">{label}</span>
                  <span className="start-help">{help}</span>
                </button>
              ))}
            </div>
          </div>
        </Dialog>
      )}
      {dialog === 'templates' && (
        <Dialog
          title="Templates"
          className="see-through"
          onClose={() => {
            setDialog(null);
            setFocusId(latest.current.active);
          }}
        >
          {(closeList) => (
            <div className="template-list" data-nav-group="templates">
              <p className="hint">Point at a template to see it behind the menu. Use it as it is, or copy it to make it your own.</p>
              {BUILT_IN.map((d) => (
                <div
                  key={d.id}
                  className={`template-row ${d.id === stages.active ? 'active' : ''}`}
                  onPointerEnter={() => setFocusId(d.id)}
                >
                  <Swatch def={d} />
                  <span className="template-text">
                    <span className="stage-name">
                      {d.name}
                      {d.id === stages.active && <Check className="in-use" strokeWidth={3} aria-label="In use" />}
                    </span>
                    <span className="stage-tags">{TEMPLATE_INFO[d.id]}</span>
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    data-autofocus={d.id === stages.active ? '' : undefined}
                    onFocus={() => setFocusId(d.id)}
                    onClick={() => {
                      equip(d.id);
                      closeList();
                    }}
                  >
                    Use
                  </button>
                  <button
                    type="button"
                    className="btn small"
                    onFocus={() => setFocusId(d.id)}
                    onClick={() => {
                      setDialog(null);
                      create(d);
                    }}
                  >
                    Copy
                  </button>
                </div>
              ))}
            </div>
          )}
        </Dialog>
      )}
    </div>
  );
  return { view, actions, editing: !!editing };
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
        className="stage-swatch"
        aria-hidden
        style={{
          ['--key' as string]: c.key,
          ['--accent' as string]: c.accent,
          ['--wash' as string]: c.wash,
          ['--dark' as string]: 1 - Math.min(1, def.venue) * 0.75,
          ['--beams' as string]: Math.min(1, def.beams),
        }}
      />
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
  active,
  focused,
  onFocus,
  onPick,
}: {
  def: StageDef;
  active: boolean;
  focused: boolean;
  onFocus(): void;
  onPick(): void;
}) {
  const b = def.backdrop;
  const tags = [
    b.kind !== 'venue' ? BACKDROP_LABEL[b.kind] : def.screens ? 'Video on the screens' : !def.colors ? 'Changes with the show' : null,
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
      <Swatch def={def} />
      <span className="stage-name">
        {def.name}
        {active && <Check className="in-use" strokeWidth={3} aria-label="In use" />}
      </span>
      <span className="stage-tags">{tags.join(' · ')}</span>
    </button>
  );
}

interface EditorProps {
  def: StageDef;
  hints: ReturnType<typeof useHints>;
  touch: boolean;
  activeRow: string | null;
  setActiveRow(id: string): void;
  onSave(def: StageDef): void;
  onUndo(): void;
  canUndo: boolean;
  onDelete(): void;
}

function Editor({ def, hints, touch, activeRow, setActiveRow, onSave, onUndo, canUndo, onDelete }: EditorProps) {
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
            help: 'The big round screen and the screens beside it: the show’s own pictures, or a video of yours.',
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
  return (
    <aside className="stage-editor set-list" data-nav-group="stage-editor" aria-label={`Customize ${def.name}`}>
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
              <ColorRow label="Top" value={b.from} onPick={(hex) => set({ backdrop: { ...b, from: hex } })} />
              <ColorRow label="Bottom" value={b.to} onPick={(hex) => set({ backdrop: { ...b, to: hex } })} />
            </>
          )}
          {sec.colors && def.colors && (
            <>
              {(['key', 'accent', 'wash'] as const).map((k) => (
                <ColorRow
                  key={k}
                  label={{ key: 'Beams', accent: 'Second beams', wash: 'Stage' }[k]}
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
      <section className="set-section stage-tools">
        <button type="button" className="btn small" disabled={!canUndo} onClick={onUndo}>
          <Undo2 strokeWidth={ICON_STROKE} aria-hidden /> Undo
        </button>
        <HoldButton
          tone="danger"
          label="Delete stage"
          hint={hints.mode === 'keyboard' ? 'Hold Enter to delete' : 'Hold to delete'}
          glyph={hints.mode === 'pad' ? <PadGlyph input={confirmInput(hints.style)} style={hints.style} /> : undefined}
          glyphStyle={hints.style}
          onComplete={onDelete}
        />
      </section>
    </aside>
  );
}

function ColorRow({ label, value, onPick }: { label: string; value: string; onPick(hex: string): void }) {
  return (
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
            onClick={() => onPick(hex)}
          />
        ))}
        <label className="color-own" title="Any colour">
          <input type="color" value={value} onChange={(e) => onPick(e.target.value)} aria-label={`${label}: any colour`} />
        </label>
      </span>
    </div>
  );
}
