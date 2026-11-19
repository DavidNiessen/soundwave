import type { CameraMode } from '../../game/graphics';
import type { Part } from '../../chart/types';
import type { ShowLevel } from './LightShow';

/**
 * The camera director: a library of shots around the stage and a cutting rhythm that follows the
 * music. Cuts land on downbeats after a hold of a few bars (shorter at a peak), each shot moves
 * slowly while it is on, and the player's band member gets more close-ups. A shot does not come
 * round again until a few others have been on, and when it does it runs its move the other way,
 * so the camera picks up where it left that spot instead of starting over. Only the stage camera
 * moves; the highway never does.
 */
export type Vec3 = [number, number, number];
export type Move = 'push' | 'pull' | 'orbit' | 'truck' | 'crane' | 'still';

export interface Shot {
  name: string;
  pos: Vec3;
  target: Vec3;
  /** Horizontal field of view, degrees. */
  hfov: number;
  move: Move;
  /** Size of the move over the whole shot (metres or radians for an orbit). */
  amount: number;
  /** Levels the shot suits, and how much it is favoured. */
  levels: ShowLevel[];
  weight: number;
  /** Calm mode only uses calm shots. */
  calm?: boolean;
}

export interface CameraPose {
  pos: Vec3;
  target: Vec3;
  hfov: number;
}

export interface StageCameras {
  [name: string]: { pos: Vec3; target: Vec3; hfov: number };
}

/** Builds the shot list from the exported cameras plus shots around the band. */
export function buildShots(cams: StageCameras, band: Partial<Record<string, Vec3>>, focus?: Part): Shot[] {
  const shots: Shot[] = [];
  const add = (s: Shot) => shots.push(s);
  if (cams.front) add({ name: 'front', ...cams.front, move: 'push', amount: 6, levels: ['calm', 'groove', 'peak'], weight: 3, calm: true });
  if (cams.hero)
    add({ name: 'hero', ...cams.hero, move: 'orbit', amount: 0.12, levels: ['calm', 'groove', 'peak'], weight: 2, calm: true });
  if (cams.crowd) add({ name: 'crowd', ...cams.crowd, move: 'truck', amount: 3, levels: ['groove', 'peak'], weight: 2 });
  if (cams.close) add({ name: 'close', ...cams.close, move: 'pull', amount: 5, levels: ['groove', 'peak'], weight: 1.5 });
  if (cams.aerial) add({ name: 'aerial', ...cams.aerial, move: 'orbit', amount: 0.18, levels: ['calm', 'groove'], weight: 1, calm: true });
  add({
    name: 'wide-left',
    pos: [-62, 7, 48],
    target: [0, 22, -12],
    hfov: 62,
    move: 'truck',
    amount: 8,
    levels: ['calm', 'groove', 'peak'],
    weight: 1.2,
    calm: true,
  });
  add({
    name: 'wide-right',
    pos: [62, 7, 48],
    target: [0, 22, -12],
    hfov: 62,
    move: 'truck',
    amount: 8,
    levels: ['calm', 'groove', 'peak'],
    weight: 1.2,
    calm: true,
  });
  add({ name: 'low-gate', pos: [0, 1.6, 26], target: [0, 30, -16], hfov: 84, move: 'crane', amount: 3, levels: ['peak'], weight: 1.2 });
  // The whole band on its island.
  const all = Object.values(band).filter((p): p is Vec3 => !!p);
  if (all.length) {
    const c: Vec3 = [0, 0, 0];
    for (const p of all) for (let i = 0; i < 3; i++) c[i] += p[i] / all.length;
    add({
      name: 'band',
      pos: [c[0] - 2, c[1] + 3.4, c[2] + 15],
      target: [c[0], c[1] + 1.6, c[2]],
      hfov: 56,
      move: 'truck',
      amount: 4,
      levels: ['groove', 'peak'],
      weight: 1.4,
    });
  }
  // Close-ups on the band; the player's member gets the most.
  const members: [string, Vec3][] = [
    ['lead', [-7, 2.4, -4.5]],
    ['vocals', [0, 2.4, -3]],
    ['bass', [7, 2.4, -4.5]],
    ['drums', [0, 3.8, -13.2]],
  ];
  for (const [part, fallback] of members) {
    const key = part === 'vocals' ? 'vox' : part;
    const p = band[key] ?? fallback;
    const side = p[0] < -1 ? -1 : p[0] > 1 ? 1 : 0;
    const mine = part === focus;
    add({
      name: `band-${part}`,
      // From just beyond the deck's edge, a little to the player's outer side.
      pos: [p[0] + (side || 0.6) * 2.6, p[1] + 1.9, p[2] + 7.5],
      target: [p[0], p[1] + 1.25, p[2]],
      hfov: 44,
      move: 'truck',
      amount: 1.6,
      levels: ['groove', 'peak'],
      weight: mine ? 3 : 0.6,
    });
  }
  return shots;
}

/** Bars a shot is held at each level, and in each mode. */
const HOLD: Record<ShowLevel, number> = { calm: 8, groove: 8, peak: 4 };
const CALM_HOLD = 16;
/** Without bars (menus) shots last this long, in seconds. */
const MENU_SHOT = 20;
/** How many of the latest shots are kept off the list, as long as that leaves a choice. */
const MEMORY = 4;

export class Director {
  private current: Shot;
  private shotBars = 0;
  private shotTime = 0;
  /** The latest shots, newest first, the one that is on included. */
  private recent: string[] = [];
  /** How often each shot has been on, and whether this visit runs its move backwards. */
  private readonly visits = new Map<string, number>();
  private reverse = false;
  private seed: number;

  constructor(
    private readonly shots: Shot[],
    private mode: CameraMode,
    seed = 7,
    private readonly menu = false,
  ) {
    this.seed = seed;
    this.current = shots.find((s) => s.name === (menu ? 'hero' : 'front')) ?? shots[0];
    // The opening shot counts as on: the first cut must go somewhere else.
    this.recent = [this.current.name];
    this.visits.set(this.current.name, 1);
  }

  get shot(): Shot {
    return this.current;
  }

  setMode(mode: CameraMode) {
    this.mode = mode;
    if (mode === 'fixed') this.cut(this.shots.find((s) => s.name === 'front') ?? this.shots[0]);
  }

  /** A shot the camera stays on (a band member being dressed), or null to cut freely again. */
  private held: string | null = null;

  /** Stays on the named shot, moving to and fro, until called with null. */
  hold(name: string | null) {
    this.held = name;
    const s = name ? this.shots.find((x) => x.name === name) : undefined;
    if (s) this.cut(s);
  }

  /** Advance; returns true when this frame cut to a new shot. */
  update(dt: number, downbeat: boolean, level: ShowLevel, barSeconds: number): boolean {
    this.shotTime += dt;
    if (this.mode === 'fixed') return false;
    if (this.held) {
      // Held: the move runs back and forth instead of cutting away.
      if (this.shotTime >= MENU_SHOT) {
        this.shotTime = 0;
        this.reverse = !this.reverse;
      }
      return false;
    }
    let due: boolean;
    if (this.menu) due = this.shotTime >= MENU_SHOT;
    else {
      if (downbeat) this.shotBars++;
      const hold = this.mode === 'calm' ? CALM_HOLD : HOLD[level];
      due = downbeat && this.shotBars >= hold;
    }
    if (!due) return false;
    this.cut(this.pick(level));
    this.barSeconds = barSeconds;
    return true;
  }

  private barSeconds = 2;

  /** The camera right now: the shot's base pose moved by its progress. */
  pose(): CameraPose {
    const s = this.current;
    const len = this.menu ? MENU_SHOT : Math.max(4, (this.mode === 'calm' ? CALM_HOLD : 6) * this.barSeconds);
    const p = Math.min(1, this.shotTime / len);
    const eased = p * p * (3 - 2 * p);
    const e = this.reverse ? 1 - eased : eased;
    const pos: Vec3 = [...s.pos];
    const target: Vec3 = [...s.target];
    const dir = norm(sub(s.target, s.pos));
    const amt = this.mode === 'fixed' ? 0 : s.amount * (this.mode === 'calm' ? 0.6 : 1);
    switch (s.move) {
      case 'push':
      case 'pull': {
        const d = (s.move === 'push' ? e : 1 - e) * amt;
        for (let i = 0; i < 3; i++) pos[i] += dir[i] * d;
        break;
      }
      case 'truck': {
        const side = norm([dir[2], 0, -dir[0]]);
        const d = (e - 0.5) * amt;
        for (let i = 0; i < 3; i++) pos[i] += side[i] * d;
        break;
      }
      case 'crane':
        pos[1] += e * amt;
        break;
      case 'orbit': {
        const a = (e - 0.5) * amt;
        const dx = pos[0] - target[0];
        const dz = pos[2] - target[2];
        pos[0] = target[0] + dx * Math.cos(a) - dz * Math.sin(a);
        pos[2] = target[2] + dx * Math.sin(a) + dz * Math.cos(a);
        break;
      }
    }
    if (this.mode === 'fixed') pos[1] += Math.sin(this.shotTime * 0.4) * 0.15;
    return { pos, target, hfov: s.hfov };
  }

  private cut(next: Shot) {
    this.current = next;
    this.shotBars = 0;
    this.shotTime = 0;
    this.recent = [next.name, ...this.recent].slice(0, MEMORY);
    const seen = this.visits.get(next.name) ?? 0;
    this.visits.set(next.name, seen + 1);
    this.reverse = seen % 2 === 1;
  }

  private pick(level: ShowLevel): Shot {
    const suits = this.shots.filter((s) => (this.mode === 'calm' || this.menu ? s.calm : s.levels.includes(level)));
    // Keep as many of the latest shots off the list as still leaves two to choose between.
    let list: Shot[] = [];
    for (let keep = MEMORY; keep >= 1 && list.length < 2; keep--) {
      const off = this.recent.slice(0, keep);
      const pool = suits.filter((s) => !off.includes(s.name));
      if (pool.length > list.length) list = pool;
    }
    if (!list.length) list = this.shots.filter((s) => s.name !== this.current.name);
    const total = list.reduce((a, s) => a + s.weight, 0);
    let r = this.random() * total;
    for (const s of list) {
      r -= s.weight;
      if (r <= 0) return s;
    }
    return list[list.length - 1];
  }

  private random() {
    // Small deterministic generator so a replay cuts the same way.
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
