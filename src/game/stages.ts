/**
 * The player's stage: how the 3D stage behind the highway and the menus looks. A few stages come
 * with the game; the player can copy one and make it their own (the Stage tab, src/ui/StageBrowser.tsx). They are
 * kept in the settings, so they travel with a library backup (their videos and pictures too).
 */
import type { Sky, StageLook } from '../render/stage/look';
import { DEFAULT_VENUE, isVenueId, type VenueId } from '../render/venues/catalog';

/** A colour as `#rrggbb`. */
export type Hex = string;

export interface StageColors {
  /** Beams and bulbs. */
  key: Hex;
  /** The second beam colour. */
  accent: Hex;
  /** The light on the venue. */
  wash: Hex;
}

/**
 * What is behind the highway: the 3D venue, or instead of it the player's own video or picture
 * (kept in src/storage/stageMedia.ts by id), or a colour gradient.
 */
export type Backdrop =
  | { kind: 'venue' }
  | { kind: 'video'; media: string | null }
  | { kind: 'image'; media: string | null }
  | { kind: 'gradient'; from: Hex; to: Hex };
export type BackdropKind = Backdrop['kind'];

export interface StageDef {
  id: string;
  name: string;
  backdrop: Backdrop;
  /** The 3D venue it stands in (see src/render/venues/catalog.ts). */
  venueId: VenueId;
  /** The sky over the 3D stage. */
  sky: Sky;
  /** How much a video, picture or gradient is darkened behind the highway, 0..0.85. */
  dim: number;
  /** A video of the player's own on the 3D venue's screens (null: the show's own pictures). */
  screens: string | null;
  /** The screens' video turned by quarter turns clockwise (0..3), and mirrored left to right. */
  screensTurn: number;
  screensMirror: boolean;
  /** Own colours, or null for the show's own, changing as it goes. */
  colors: StageColors | null;
  brightness: number;
  venue: number;
  haze: number;
  beams: number;
  show: StageLook['show'];
  flashes: boolean;
  crowd: boolean;
  pyro: boolean;
}

export interface StageSettings {
  /** The stage in use: a built-in one's id or one of the player's. */
  active: string;
  /** The player's own stages, in their order. */
  mine: StageDef[];
}

/** The sliders' ranges. */
export const RANGES = {
  brightness: { min: 0.3, max: 1.5, step: 0.05 },
  venue: { min: 0, max: 1.2, step: 0.05 },
  haze: { min: 0, max: 1.5, step: 0.05 },
  beams: { min: 0, max: 1.5, step: 0.05 },
  dim: { min: 0, max: 0.85, step: 0.05 },
} as const;

const base: Omit<StageDef, 'id' | 'name'> = {
  backdrop: { kind: 'venue' },
  venueId: DEFAULT_VENUE,
  sky: 'aurora',
  dim: 0.35,
  screens: null,
  screensTurn: 0,
  screensMirror: false,
  colors: null,
  brightness: 1,
  venue: 1,
  haze: 1,
  beams: 1,
  show: 'normal',
  flashes: true,
  crowd: true,
  pyro: true,
};

export const SKIES: { value: Sky; label: string; help: string }[] = [
  { value: 'night', label: 'Night', help: 'A clouded night with stars and a moon.' },
  { value: 'aurora', label: 'Aurora', help: 'Clear skies full of northern lights.' },
  { value: 'black', label: 'Pitch black', help: 'No sky at all.' },
];

/** What each template is like, for the template list. */
export const TEMPLATE_INFO: Record<string, string> = {
  festival: 'The full show: the stage’s own colours, changing with the music.',
  blackout: 'A black stage. Only white beams cut through the dark.',
  dim: 'The full stage, turned down and calm. Easy on the eyes at night.',
  club: 'Close and hazy, in red and amber.',
  ice: 'Cold blue and white light, crisp beams.',
  sunset: 'Warm orange and pink washes.',
  neon: 'Green and magenta at full tilt.',
  minimal: 'No crowd, no fireworks: the highway in a quiet fog. The lightest to draw.',
};

/** The templates shown in the browser itself; the rest are in its list of all templates. */
export const FEATURED = ['festival', 'blackout', 'neon'];

/** The stages that come with the game (the templates). They cannot be changed, only copied. */
export const BUILT_IN: readonly StageDef[] = [
  { ...base, id: 'festival', name: 'Festival' },
  {
    ...base,
    id: 'blackout',
    name: 'Blackout',
    colors: { key: '#ffffff', accent: '#cfe3ff', wash: '#2a2f4a' },
    venue: 0,
    haze: 0.7,
    beams: 1.2,
    brightness: 0.95,
  },
  { ...base, id: 'dim', name: 'Dim', brightness: 0.6, venue: 0.45, beams: 0.6, haze: 0.8, show: 'chill', flashes: false },
  {
    ...base,
    id: 'club',
    name: 'Club',
    colors: { key: '#ff3b3b', accent: '#ffb347', wash: '#7a1020' },
    venue: 0.5,
    haze: 1.5,
    beams: 1.1,
    show: 'chill',
  },
  { ...base, id: 'ice', name: 'Ice', colors: { key: '#7fd8ff', accent: '#ffffff', wash: '#1f4fd1' }, haze: 1.2 },
  { ...base, id: 'sunset', name: 'Sunset', colors: { key: '#ff8a3d', accent: '#ff5fa8', wash: '#c0392b' }, brightness: 1.1 },
  { ...base, id: 'neon', name: 'Neon', colors: { key: '#39ff88', accent: '#ff2bd6', wash: '#3a1cff' }, show: 'festival', beams: 1.3 },
  {
    ...base,
    id: 'minimal',
    name: 'Minimal',
    venue: 0.3,
    beams: 0.5,
    haze: 0.4,
    show: 'chill',
    flashes: false,
    crowd: false,
    pyro: false,
  },
];

export const DEFAULT_STAGES: StageSettings = { active: 'festival', mine: [] };

/** Swatches to pick colours from quickly. */
export const SWATCHES: Hex[] = [
  '#ffffff',
  '#ff4d9d',
  '#ff3b3b',
  '#ff8a3d',
  '#ffd23d',
  '#39ff88',
  '#5df2d6',
  '#7fd8ff',
  '#3a6bff',
  '#5b3ee0',
  '#b04dff',
  '#2a2f4a',
];

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: unknown, r: { min: number; max: number }, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(r.max, Math.max(r.min, n)) : d;
};

function normalizeDef(raw: unknown): StageDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<StageDef>;
  if (typeof d.id !== 'string' || !d.id) return null;
  const c = d.colors as Partial<StageColors> | null | undefined;
  const colors = c && HEX.test(c.key ?? '') && HEX.test(c.accent ?? '') && HEX.test(c.wash ?? '') ? (c as StageColors) : null;
  return {
    id: d.id,
    name: typeof d.name === 'string' && d.name.trim() ? d.name.trim().slice(0, 32) : 'My stage',
    backdrop: normalizeBackdrop(d.backdrop),
    venueId: isVenueId(d.venueId) ? d.venueId : DEFAULT_VENUE,
    sky: d.sky === 'night' || d.sky === 'black' ? d.sky : 'aurora',
    dim: clamp(d.dim, RANGES.dim, 0.35),
    screens: typeof d.screens === 'string' && d.screens ? d.screens : null,
    screensTurn: [0, 1, 2, 3].includes(Number(d.screensTurn)) ? Number(d.screensTurn) : 0,
    screensMirror: d.screensMirror === true,
    colors,
    brightness: clamp(d.brightness, RANGES.brightness, 1),
    venue: clamp(d.venue, RANGES.venue, 1),
    haze: clamp(d.haze, RANGES.haze, 1),
    beams: clamp(d.beams, RANGES.beams, 1),
    show: d.show === 'chill' || d.show === 'festival' ? d.show : 'normal',
    flashes: d.flashes !== false,
    crowd: d.crowd !== false,
    pyro: d.pyro !== false,
  };
}

function normalizeBackdrop(raw: unknown): Backdrop {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const media = typeof b.media === 'string' && b.media ? b.media : null;
  if (b.kind === 'video' || b.kind === 'image') return { kind: b.kind, media };
  if (b.kind === 'gradient') {
    const from = typeof b.from === 'string' && HEX.test(b.from) ? b.from : '#1a0f4c';
    const to = typeof b.to === 'string' && HEX.test(b.to) ? b.to : '#ff4d9d';
    return { kind: 'gradient', from, to };
  }
  return { kind: 'venue' };
}

/** The kept files a stage uses (its background and its screens' video). */
export function stageMedia(d: StageDef): string[] {
  const ids: string[] = [];
  if ((d.backdrop.kind === 'video' || d.backdrop.kind === 'image') && d.backdrop.media) ids.push(d.backdrop.media);
  if (d.screens) ids.push(d.screens);
  return ids;
}

export function normalizeStages(raw: unknown): StageSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StageSettings>;
  const seen = new Set(BUILT_IN.map((s) => s.id));
  const mine: StageDef[] = [];
  for (const d of Array.isArray(r.mine) ? r.mine : []) {
    const def = normalizeDef(d);
    if (def && !seen.has(def.id)) {
      seen.add(def.id);
      mine.push(def);
    }
  }
  const active = typeof r.active === 'string' && seen.has(r.active) ? r.active : DEFAULT_STAGES.active;
  return { active, mine };
}

export const isBuiltIn = (id: string) => BUILT_IN.some((s) => s.id === id);

/** Every stage, the built-in ones first. */
export const allStages = (s: StageSettings): StageDef[] => [...BUILT_IN, ...s.mine];

export const findStage = (s: StageSettings, id: string): StageDef => allStages(s).find((d) => d.id === id) ?? BUILT_IN[0];

/** A new stage of the player's, copied from `from`, with a name not taken yet. */
export function copyStage(s: StageSettings, from: StageDef): StageDef {
  const names = new Set(allStages(s).map((d) => d.name));
  const stem = isBuiltIn(from.id) ? `My ${from.name}` : `${from.name} copy`;
  let name = stem;
  for (let n = 2; names.has(name); n++) name = `${stem} ${n}`;
  const id = `mine-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return { ...from, backdrop: { ...from.backdrop }, colors: from.colors && { ...from.colors }, id, name };
}

const hexToRgb = (hex: Hex): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  // The renderer works in linear light: sRGB colours are converted so they look as picked.
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255)];
};

/** The venue the stage in use stands in. */
export const stageVenue = (s: StageSettings): VenueId => findStage(s, s.active).venueId;

/** The stage as the renderer takes it. */
export function stageLook(d: StageDef): StageLook {
  return {
    sky: d.sky,
    colors: d.colors && { key: hexToRgb(d.colors.key), accent: hexToRgb(d.colors.accent), wash: hexToRgb(d.colors.wash) },
    brightness: d.brightness,
    venue: d.venue,
    haze: d.haze,
    beams: d.beams,
    show: d.show,
    flashes: d.flashes,
    crowd: d.crowd,
    pyro: d.pyro,
    screenTurn: d.screensTurn,
    screenMirror: d.screensMirror,
  };
}

/** A random stage of colours that go together: a hue, one beside it, and a darker wash. */
export function randomColors(): StageColors {
  const h = Math.random() * 360;
  const turn = (Math.random() < 0.5 ? 1 : -1) * (30 + Math.random() * 120);
  return { key: hsl(h, 100, 60), accent: hsl(h + turn, 95, 70), wash: hsl(h + turn / 2, 80, 30) };
}

function hsl(h: number, s: number, l: number): Hex {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => {
    const k = (n + (((h % 360) + 360) % 360) / 30) % 12;
    const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** A rough feel of how heavy a stage is to draw, for its card. */
export function stageWeight(d: StageDef): 'light' | 'medium' | 'heavy' {
  if (d.backdrop.kind === 'image' || d.backdrop.kind === 'gradient') return 'light';
  if (d.backdrop.kind === 'video') return 'medium';
  const score = (d.crowd ? 2 : 0) + (d.pyro ? 1 : 0) + d.beams + d.haze * 0.5;
  return score < 1.5 ? 'light' : score < 3.5 ? 'medium' : 'heavy';
}
