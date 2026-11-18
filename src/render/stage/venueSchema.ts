/**
 * The venue schema: what every 3D venue's `venue.json` holds, so that the light show, the camera
 * director, the band and the pyro work the same in all of them. A venue only says where things are;
 * what they do is the game's, the same everywhere:
 *
 * - **Fixtures** come in a fixed set of roles (FIXTURE_ROLES). The light show drives each role its
 *   own way: the main heads sweep, fan and chase, the halo stays on the band, and so on. A venue
 *   places as many of each as it likes, and may size their beams.
 * - **Camera spots** have fixed names (CAMERA_SPOTS); the director builds its shots from them.
 * - **Band places** are the four parts (BAND_PLACES); the band stands there and its close-ups aim there.
 * - The **main screen**, **deck**, **fireworks** and **CO2** are where the show's pictures and pyro go.
 *
 * readVenue checks a venue against this when it loads and says exactly what is missing or wrong.
 * docs/venues.md describes the whole folder a venue is made of.
 */
import type { DeckInfo } from '../aurora/materials';
import type { StageCameras, Vec3 } from './Director';

export const VENUE_SCHEMA_VERSION = 2;

/** What a fixture is for: the light show drives every fixture of a role alike. */
export type FixtureRole = 'main' | 'sky' | 'halo' | 'truss' | 'floor' | 'ribbon' | 'house';

/** Each role: what it does in the show, and its beam's usual length (m) and width (share of the length). */
export const FIXTURE_ROLES: Record<FixtureRole, { does: string; length: number; spread: number }> = {
  main: { does: 'Moving heads over the stage: the main show. They sweep, fan out and chase with the music.', length: 50, spread: 0.034 },
  sky: { does: 'Searchlights into the sky: slow drifts high above, every other one lit.', length: 90, spread: 0.02 },
  halo: { does: 'A ring over the band: each head stays on its player and breathes with the bar.', length: 17, spread: 0.075 },
  truss: { does: 'Washes on the truss: a steady glow that swells with the bar and the bass.', length: 34, spread: 0.045 },
  floor: { does: 'Lights on the stage floor: they swing slowly and pulse on the beat.', length: 26, spread: 0.04 },
  ribbon: { does: 'Lenses along decoration: glints rather than beams.', length: 40, spread: 0.03 },
  house: { does: 'Front of house and delay towers: a low, steady light over the crowd.', length: 50, spread: 0.02 },
};
export const FIXTURE_ROLE_NAMES = Object.keys(FIXTURE_ROLES) as FixtureRole[];

/** The camera spots the director knows. `front` and `hero` are needed; the rest add shots. */
export const CAMERA_SPOTS: Record<string, { required: boolean; shot: string }> = {
  front: { required: true, shot: 'From the crowd straight at the stage, pushing in.' },
  hero: { required: true, shot: 'The whole stage from the side, orbiting slowly.' },
  crowd: { required: false, shot: 'Down among the audience, trucking along.' },
  close: { required: false, shot: 'Close to the band, pulling back.' },
  aerial: { required: false, shot: 'High above, orbiting.' },
};

/** Where each part of the band stands (the singer is `vox`). */
export const BAND_PLACES = ['lead', 'vox', 'bass', 'drums'] as const;

/** A light fixture as a venue gives it. */
export interface FixtureSpec {
  role: FixtureRole;
  pos: Vec3;
  /** Where it points at rest. */
  dir: Vec3;
  /** The beam's length (m) and width (share of its length), when not the role's own. */
  length?: number;
  spread?: number;
}

/** A light fixture as the game uses it: its role, and the size of its beam. */
export interface Fixture {
  role: FixtureRole;
  pos: Vec3;
  dir: Vec3;
  length: number;
  spread: number;
}

/** A fan of sparks: rays spread (degrees) around a lean from vertical, each `length` metres long. */
export interface FireworkSpec {
  origin: Vec3;
  n: number;
  spread: number;
  length: [number, number];
  lean: number;
}

/** A venue's `venue.json` (three.js coordinates, metres, y up), as the game uses it. */
export interface VenueData {
  version: number;
  cameras: StageCameras;
  band: Record<string, Vec3>;
  /** The low platform the band plays on: centre (at its top) and half axes. */
  island?: { center: Vec3; a: number; b: number };
  /** The podium each player stands on: half axes, and how far it can rise from where it rests. */
  podiums?: Record<string, { rx: number; ry: number; travel: number }>;
  fixtures: Fixture[];
  /** The main screen: centre and radius of the round picture on it, and the arch outline it fills. */
  moon: { center: Vec3; radius: number; arch?: { halfWidth: number; height: number; power: number } };
  fireworks: FireworkSpec[];
  co2: Vec3[];
  /** Spots in the audience that stay free: the mix position, delay towers. */
  clear?: { pos: Vec3; radius: number }[];
  deck: DeckInfo;
}

/**
 * Version 1 (Moonrise as first built) named fixture groups after where they hang. Each is a role,
 * with the beam size it was made with, so the venue looks as it always did.
 */
const V1_GROUPS: Record<string, { role: FixtureRole; length: number; spread: number }> = {
  Shell0: { role: 'main', length: 52, spread: 0.034 },
  Shell2: { role: 'main', length: 44, spread: 0.034 },
  Sky: { role: 'sky', length: 90, spread: 0.02 },
  Halo: { role: 'halo', length: 17, spread: 0.075 },
  Truss: { role: 'truss', length: 34, spread: 0.045 },
  Floor: { role: 'floor', length: 26, spread: 0.04 },
  Ribbon: { role: 'ribbon', length: 40, spread: 0.03 },
  Delay: { role: 'house', length: 40, spread: 0.03 },
  Foh: { role: 'house', length: 60, spread: 0.012 },
};

/** A venue that does not follow the schema: every problem found, one per line. */
export class VenueError extends Error {
  constructor(
    readonly venue: string,
    readonly problems: string[],
  ) {
    super(`The venue "${venue}" does not follow the venue schema:\n- ${problems.join('\n- ')}`);
    this.name = 'VenueError';
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

/**
 * Checks a venue's `venue.json` against the schema and gives it as the game uses it: every fixture
 * with its role and beam size (version 1 group names are read as their roles). Throws a VenueError
 * naming every problem when it does not follow the schema.
 */
export function readVenue(raw: unknown, name = 'venue'): VenueData {
  const problems: string[] = [];
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const version = Number(d.version);
  if (version !== 1 && version !== VENUE_SCHEMA_VERSION)
    problems.push(`version is ${String(d.version)}; expected 1 or ${VENUE_SCHEMA_VERSION}`);

  const cameras = (d.cameras && typeof d.cameras === 'object' ? d.cameras : {}) as Record<string, unknown>;
  for (const [spot, info] of Object.entries(CAMERA_SPOTS)) {
    const c = cameras[spot] as { pos?: unknown; target?: unknown; hfov?: unknown } | undefined;
    if (!c) {
      if (info.required) problems.push(`cameras.${spot} is missing (${info.shot})`);
      continue;
    }
    if (!isVec3(c.pos) || !isVec3(c.target) || !isNum(c.hfov))
      problems.push(`cameras.${spot} needs pos [x, y, z], target [x, y, z] and hfov (degrees)`);
  }

  const band = (d.band && typeof d.band === 'object' ? d.band : {}) as Record<string, unknown>;
  for (const place of BAND_PLACES) if (!isVec3(band[place])) problems.push(`band.${place} needs a position [x, y, z]`);

  const fixtures: Fixture[] = [];
  const list = Array.isArray(d.fixtures) ? d.fixtures : [];
  if (!list.length) problems.push('fixtures: a venue needs light fixtures');
  list.forEach((f: Record<string, unknown>, i) => {
    const legacy = typeof f.group === 'string' ? V1_GROUPS[f.group] : undefined;
    const role = (typeof f.role === 'string' ? f.role : legacy?.role) as FixtureRole | undefined;
    if (!role || !(role in FIXTURE_ROLES)) {
      problems.push(
        `fixtures[${i}]: role must be one of ${FIXTURE_ROLE_NAMES.join(', ')}${f.group ? ` (group "${String(f.group)}" is not a known one)` : ''}`,
      );
      return;
    }
    if (!isVec3(f.pos) || !isVec3(f.dir)) {
      problems.push(`fixtures[${i}] needs pos and dir as [x, y, z]`);
      return;
    }
    fixtures.push({
      role,
      pos: f.pos,
      dir: f.dir,
      length: isNum(f.length) ? f.length : (legacy?.length ?? FIXTURE_ROLES[role].length),
      spread: isNum(f.spread) ? f.spread : (legacy?.spread ?? FIXTURE_ROLES[role].spread),
    });
  });
  if (fixtures.length && !fixtures.some((f) => f.role === 'main'))
    problems.push('fixtures: at least one needs the role "main" (the show’s moving heads)');

  const moon = d.moon as { center?: unknown; radius?: unknown } | undefined;
  if (!moon || !isVec3(moon.center) || !isNum(moon.radius)) problems.push('moon (the main screen) needs center [x, y, z] and radius');

  const deck = d.deck as Record<string, unknown> | undefined;
  if (!deck || !isVec3(deck.center) || !['a', 'b', 'power', 'height', 'barrier'].every((k) => isNum(deck[k])))
    problems.push('deck needs center [x, y, z], a, b, power, height and barrier');

  if (!Array.isArray(d.fireworks)) problems.push('fireworks must be a list (it may be empty)');
  if (!Array.isArray(d.co2) || !d.co2.every(isVec3)) problems.push('co2 must be a list of positions (it may be empty)');

  if (problems.length) throw new VenueError(name, problems);
  return { ...(d as unknown as VenueData), fixtures };
}
