import * as THREE from 'three';
import type { Part } from '../../chart/types';
import type { Avatar } from '../../net/protocol';
import type { Shot, Vec3 } from '../stage/Director';
import type { Particles } from '../stage/Particles';
import { Spawn } from '../stage/pyro';
import type { Figures, Person } from './figures';
import { seatMaterial, type DeckInfo } from './materials';

/** A Showdown player on the ring: their part's band member in their look, on a podium of their own. */
export interface RingSeat {
  id: string;
  part: Part;
  avatar?: Avatar;
  /** The player at this machine: placed nearest the audience, with the camera behind them. */
  me?: boolean;
}

/** Where a ring player stands on the board now: 1 is first. `out`: not playing (any more); `hit`: under a hit. */
export interface RingPlace {
  id: string;
  place: number;
  out?: boolean;
  hit?: boolean;
}

export const MAX_SEATS = 16;
/** A podium's radius, its height at rest and how much higher first place stands than last, metres. */
export const SEAT_RADIUS = 1.25;
const REST = 0.7;
const RISE = 1.1;
/** Out of the song: the podium sinks to this. */
const SUNK = 0.25;
/** Rim colours for players without a look of their own. */
const RIMS = ['#ff4fa3', '#45d6ff', '#ffc94a', '#9d7bff', '#4dffb0', '#ff8a4a', '#ff5f6d', '#5f8bff'];
// Linear and nearly pure, so it stays red where the glow pushes it past white.
const HIT_RIM = new THREE.Color().setRGB(1, 0.02, 0.05);
const OUT_RIM = new THREE.Color('#2a2838');
/** The strike's bolt: the head, then this many glowing beads trailing behind it. */
const TRAIL = 14;
const BOLTS = 4;
const SHAKE_S = 0.7;
const FLASH_S = 0.18;

export interface RingLayout {
  center: Vec3;
  rx: number;
  rz: number;
  /** Each seat's spot on the deck (its foot), in seat order: the first is nearest the audience. */
  spots: Vec3[];
}

/**
 * Lays `n` podiums out evenly on an ellipse on the deck, the first nearest the audience. The ring
 * grows with the players so neighbours never touch, up to what the deck holds (16 players).
 */
export function ringLayout(n: number, deck: DeckInfo): RingLayout {
  const count = Math.max(1, Math.min(MAX_SEATS, n));
  const rx = Math.min(15, 8 + 0.45 * count);
  const rz = Math.min(8, 5.5 + 0.2 * count);
  const center: Vec3 = [deck.center[0], deck.height, deck.center[2] + 2.5];
  const spots = Array.from({ length: count }, (_, i): Vec3 => {
    const a = Math.PI / 2 + (2 * Math.PI * i) / count;
    return [center[0] + rx * Math.cos(a), deck.height, center[2] + rz * Math.sin(a)];
  });
  return { center, rx, rz, spots };
}

interface Seat {
  id: string;
  me: boolean;
  spot: Vec3;
  person?: Person;
  podium: THREE.Mesh;
  uSeat: THREE.Vector4;
  rim: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>;
  colour: THREE.Color;
  /** Podium height now and where it is going, metres above the deck. */
  height: number;
  want: number;
  out: boolean;
  hit: boolean;
  /** Seconds since the last strike landed on this seat (shake and flash), Infinity if none. */
  struck: number;
  look: Pick<Person, 'top' | 'bottom' | 'finish' | 'recolor'>;
}

interface Bolt {
  head: THREE.Mesh;
  trail: THREE.InstancedMesh;
  wave: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  from?: Seat;
  to?: Seat;
  /** Seconds since it left, and how long it flies. */
  age: number;
  flight: number;
  /** Seconds since it landed (the shock wave), Infinity before. */
  landed: number;
  colour: THREE.Color;
}

/**
 * A Showdown's stage: every player on a round podium of their own in a ring on the deck, each as
 * their part's band member in their look. Podiums rise with the board (first place highest), sink
 * when a player is out, and their rims glow in the player's colour, red while a hit is on them.
 * A Strike flies as a glowing bolt from the striker to the target, who shakes and flashes as it lands.
 */
export class Ring {
  readonly group = new THREE.Group();
  readonly layout: RingLayout;
  private readonly seats: Seat[] = [];
  private readonly byId = new Map<string, Seat>();
  private readonly bolts: Bolt[] = [];
  private readonly owned: { dispose(): void }[] = [];
  private time = 0;

  constructor(
    players: RingSeat[],
    deck: DeckInfo,
    band: Record<string, { character: string; clip: string }>,
    private readonly figures: Figures,
  ) {
    // This machine's player first: the first seat is the one nearest the audience.
    const ordered = [...players.filter((p) => p.me), ...players.filter((p) => !p.me)].slice(0, MAX_SEATS);
    this.layout = ringLayout(ordered.length, deck);
    const { center } = this.layout;

    const body = new THREE.CylinderGeometry(SEAT_RADIUS, SEAT_RADIUS, 1, 48, 1);
    body.translate(0, 0.5, 0);
    // The podium shader tells the lid from the wall by v (it flips v: the lid's must come out below -0.5).
    const uv = body.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 49 * 2; i < uv.count; i++) uv.setY(i, 2);
    const ring = new THREE.TorusGeometry(SEAT_RADIUS + 0.03, 0.055, 8, 72);
    ring.rotateX(Math.PI / 2);
    this.owned.push(body, ring);

    const people: Person[] = [];
    ordered.forEach((p, i) => {
      const spot = this.layout.spots[i];
      const key = p.part === 'vocals' ? 'vox' : p.part;
      const who = band[key] ?? Object.values(band)[0];
      const material = seatMaterial(SEAT_RADIUS, deck.height);
      const podium = new THREE.Mesh(body, material);
      podium.position.set(spot[0], deck.height, spot[2]);
      podium.frustumCulled = false;
      const colour = new THREE.Color(p.avatar?.top ?? RIMS[i % RIMS.length]);
      const rim = new THREE.Mesh(ring, new THREE.MeshBasicMaterial({ color: colour.clone() }));
      rim.position.set(spot[0], deck.height + REST, spot[2]);
      this.group.add(podium, rim);
      this.owned.push(material, rim.material);
      const look = { top: p.avatar?.top, bottom: p.avatar?.bottom, finish: p.avatar?.finish, recolor: p.avatar ? 1 : 0 };
      const person: Person | undefined = who && {
        pos: [spot[0], deck.height + REST, spot[2]],
        // Turned to the middle of the ring.
        yaw: Math.atan2(center[0] - spot[0], center[2] - spot[2]),
        scale: 1,
        character: who.character,
        calm: who.clip,
        hype: who.clip,
        threshold: 2,
        // Players on the same part do not move in step.
        phase: (i * 0.137) % 1,
        spot: p.me ? 1.3 : 1,
        part: key,
        ...look,
      };
      if (person) people.push(person);
      const seat: Seat = {
        id: p.id,
        me: !!p.me,
        spot,
        person,
        podium,
        uSeat: material.uniforms.uSeat.value as THREE.Vector4,
        rim,
        colour,
        height: REST,
        want: REST,
        out: false,
        hit: false,
        struck: Infinity,
        look,
      };
      this.seats.push(seat);
      this.byId.set(p.id, seat);
    });
    figures.add(people, true);

    // A few bolts made up front, so the first Strike does not wait for its shaders.
    const bead = new THREE.SphereGeometry(0.2, 12, 8);
    const wave = new THREE.RingGeometry(0.85, 1, 48);
    wave.rotateX(-Math.PI / 2);
    this.owned.push(bead, wave);
    for (let i = 0; i < BOLTS; i++) {
      const glow = () => new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      const head = new THREE.Mesh(bead, glow());
      const trail = new THREE.InstancedMesh(bead, glow(), TRAIL);
      const shock = new THREE.Mesh(wave, glow());
      shock.material.side = THREE.DoubleSide;
      for (const o of [head, trail, shock]) {
        o.visible = false;
        o.frustumCulled = false;
        this.group.add(o);
        this.owned.push(o.material as THREE.Material);
      }
      this.owned.push(trail);
      this.bolts.push({ head, trail, wave: shock, age: 0, flight: 0, landed: Infinity, colour: new THREE.Color() });
    }
  }

  /** Camera shots around the ring: over this player's shoulder, the whole ring, from the side, and each seat up close. */
  shots(): Shot[] {
    const { center: c, rx, rz } = this.layout;
    const all: Shot[] = [
      {
        name: 'ring',
        pos: [c[0], c[1] + 12, c[2] + rz + 15],
        target: [c[0], c[1] + 1, c[2] - 1],
        hfov: 62,
        move: 'orbit',
        amount: 0.3,
        levels: ['calm', 'groove', 'peak'],
        weight: 2.5,
        calm: true,
      },
      {
        name: 'ring-side',
        // Low over the deck's corner: under the truss that hangs over the middle.
        pos: [c[0] + rx + 5, c[1] + 5.5, c[2] + rz + 5],
        target: [c[0] - 2, c[1] + 1.2, c[2] - 2],
        hfov: 60,
        move: 'truck',
        amount: 3,
        levels: ['groove', 'peak'],
        weight: 1.2,
      },
    ];
    const me = this.seats.find((s) => s.me);
    if (me) {
      const [x, y, z] = me.spot;
      all.push({
        name: 'ring-me',
        // Behind this player and to their right: they stand at the left, the ring opens up beyond them.
        pos: [x + 2.4, y + REST + 3.9, z + 4.6],
        target: [c[0] - 0.5, c[1] + 0.6, c[2] - rz * 0.5],
        hfov: 64,
        move: 'truck',
        amount: 1.4,
        levels: ['calm', 'groove', 'peak'],
        weight: 4,
        calm: true,
      });
    }
    for (const s of this.seats) {
      if (s.me) continue;
      const out = norm2(s.spot[0] - c[0], s.spot[2] - c[2]);
      all.push({
        name: `seat-${s.id}`,
        // From inside the ring, looking out at the player facing it.
        pos: [s.spot[0] - out[0] * 4.5 + out[1] * 1.2, s.spot[1] + REST + 1.9, s.spot[2] - out[1] * 4.5 - out[0] * 1.2],
        target: [s.spot[0], s.spot[1] + REST + 1.2, s.spot[2]],
        hfov: 46,
        move: 'truck',
        amount: 1.2,
        levels: ['groove', 'peak'],
        weight: Math.min(0.8, 3 / this.seats.length),
      });
    }
    return all;
  }

  /** How far a shot that rides with a podium is raised now (its seat's rise above rest), metres. */
  raised(shot: string): number {
    const seat = shot === 'ring-me' ? this.seats.find((s) => s.me) : shot.startsWith('seat-') ? this.byId.get(shot.slice(5)) : undefined;
    return seat ? seat.height - REST : 0;
  }

  /** The board as it stands: podiums rise by place, sink when out, and glow red under a hit. */
  setPlaces(places: RingPlace[]) {
    const playing = places.filter((p) => !p.out && this.byId.has(p.id)).length;
    for (const p of places) {
      const seat = this.byId.get(p.id);
      if (!seat) continue;
      seat.out = !!p.out;
      seat.hit = !!p.hit;
      seat.want = p.out ? SUNK : REST + (playing > 1 ? RISE * (1 - (p.place - 1) / (playing - 1)) : RISE);
    }
  }

  /** A Strike from one player to another, landing in `ms` milliseconds. */
  strike(from: string, to: string, ms: number) {
    const a = this.byId.get(from);
    const b = this.byId.get(to);
    if (!a || !b || a === b) return;
    const bolt = this.bolts.find((x) => !x.from && x.landed > 1) ?? this.bolts[0];
    bolt.from = a;
    bolt.to = b;
    bolt.age = 0;
    bolt.flight = Math.max(0.35, ms / 1000);
    bolt.landed = Infinity;
    bolt.colour.copy(a.colour).lerp(WHITE, 0.35).multiplyScalar(3);
  }

  update(dt: number, pulse: number, sparks: Particles) {
    this.time += dt;
    for (const s of this.seats) {
      s.height += (s.want - s.height) * Math.min(1, dt * 1.2);
      s.struck += dt;
      const top = s.spot[1] + s.height;
      s.podium.scale.y = s.height;
      s.rim.position.y = top;
      s.uSeat.set(s.spot[0], top, s.spot[2], s.out ? 0 : s.me ? 1 : 0.45);
      // The rim: the player's colour, brighter on the beat (and for this player); red and pulsing under a hit.
      const rim = s.rim.material.color;
      if (s.out) rim.copy(OUT_RIM);
      else if (s.hit) rim.copy(HIT_RIM).multiplyScalar(2 + 1.5 * Math.abs(Math.sin(this.time * 9)));
      else rim.copy(s.colour).multiplyScalar((s.me ? 2.6 : 1.5) + pulse * 0.8);
      if (s.struck < FLASH_S) rim.copy(WHITE).multiplyScalar(4);
      if (!s.person) continue;
      // Struck: a shake that dies away, and the figure's clothes flash white.
      const k = s.struck < SHAKE_S ? (1 - s.struck / SHAKE_S) ** 2 : 0;
      const jx = k * 0.16 * Math.sin(this.time * 61);
      const jz = k * 0.16 * Math.sin(this.time * 47 + 1.3);
      this.figures.moveTo(s.person, s.spot[0] + jx, top - k * 0.08, s.spot[2] + jz);
      const flashing = s.struck < FLASH_S;
      if (flashing !== (s.person.recolor === FLASH)) {
        Object.assign(s.person, flashing ? { top: '#ffffff', bottom: '#ffffff', finish: '#ffffff', recolor: FLASH } : s.look);
        this.figures.restyle(s.person);
      }
    }
    for (const b of this.bolts) this.fly(b, dt, sparks);
  }

  private fly(b: Bolt, dt: number, sparks: Particles) {
    b.landed += dt;
    // The shock wave where it landed: a ring spreading over the target's podium and fading.
    const w = b.landed / 0.6;
    b.wave.visible = w < 1;
    if (b.wave.visible) {
      b.wave.scale.setScalar(SEAT_RADIUS * (0.6 + 2.2 * w));
      b.wave.material.color.copy(b.colour).multiplyScalar((1 - w) ** 2);
    }
    if (!b.from || !b.to) {
      b.head.visible = b.trail.visible = false;
      return;
    }
    b.age += dt;
    const t = Math.min(1, b.age / b.flight);
    b.head.visible = b.trail.visible = true;
    arc(b.from, b.to, t, TMP);
    b.head.position.copy(TMP);
    (b.head.material as THREE.MeshBasicMaterial).color.copy(b.colour);
    b.head.scale.setScalar(1.2 + 0.3 * Math.sin(b.age * 40));
    (b.trail.material as THREE.MeshBasicMaterial).color.copy(b.colour).multiplyScalar(0.6);
    for (let i = 0; i < TRAIL; i++) {
      arc(b.from, b.to, Math.max(0, t - (i + 1) * 0.022), TMP);
      M.compose(TMP, Q, S.setScalar(1 - i / TRAIL));
      b.trail.setMatrixAt(i, M);
    }
    b.trail.instanceMatrix.needsUpdate = true;
    spark(
      sparks,
      TMP.copy(b.head.position),
      V.set((Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2),
      [b.colour.r / 3, b.colour.g / 3, b.colour.b / 3],
      0.35,
      0.5,
      2,
    );
    if (t < 1) return;
    // Landed.
    const target = b.to;
    target.struck = 0;
    b.landed = 0;
    b.wave.position.set(target.spot[0], target.spot[1] + target.height + 0.05, target.spot[2]);
    for (let i = 0; i < 40; i++) {
      V.set(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(4 + Math.random() * 6);
      spark(sparks, b.head.position, V, [b.colour.r / 2.5, b.colour.g / 2.5, b.colour.b / 2.5], 0.5, 0.5 + Math.random() * 0.5, 1.5);
    }
    b.from = b.to = undefined;
  }

  dispose() {
    for (const o of this.owned) o.dispose();
  }
}

/** Marks a figure's clothes as flashing (any recolour other than 0 or 1 would do). */
const FLASH = 0.999;
const WHITE = new THREE.Color(1, 1, 1);
const TMP = new THREE.Vector3();
const V = new THREE.Vector3();
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();

/** A point `t` (0..1) along a Strike's arc: from the striker's chest, up over the ring, to the target's. */
function arc(from: Seat, to: Seat, t: number, out: THREE.Vector3) {
  const ax = from.spot[0];
  const ay = from.spot[1] + from.height + 1.4;
  const az = from.spot[2];
  const bx = to.spot[0];
  const by = to.spot[1] + to.height + 1.2;
  const bz = to.spot[2];
  const lift = 1.5 + 0.12 * Math.hypot(bx - ax, bz - az);
  const e = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
  return out.set(ax + (bx - ax) * e, ay + (by - ay) * e + lift * 4 * e * (1 - e), az + (bz - az) * e);
}

function norm2(x: number, z: number): [number, number] {
  const l = Math.hypot(x, z) || 1;
  return [x / l, z / l];
}

const SPARK = new Spawn();
/** One spark of a Strike's bolt: at `p`, moving at `v`, in a colour, with a size, a life and a drag. */
function spark(
  sparks: Particles,
  p: THREE.Vector3,
  v: THREE.Vector3,
  c: [number, number, number],
  size: number,
  life: number,
  drag: number,
) {
  const s = SPARK.reset();
  s.x = p.x;
  s.y = p.y;
  s.z = p.z;
  s.vx = v.x;
  s.vy = v.y;
  s.vz = v.z;
  [s.r, s.g, s.b] = c;
  s.size = size;
  s.life = life;
  s.drag = drag;
  sparks.sim.spawn(s);
}
