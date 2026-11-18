import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import type { Vec3 } from '../stage/Director';
import { DEFAULT_VENUE, findVenue } from '../stage/venues';
import { readVenue, type VenueData } from '../stage/venueSchema';
import type { TerrainParams } from './terrain';

/** A venue's data, fixtures and fireworks: see the venue schema (src/render/stage/venueSchema.ts). */
export type { Fixture, FireworkSpec, VenueData } from '../stage/venueSchema';

export interface Clip {
  name: string;
  /** First row of the loop in the animation texture, and its length in rows. */
  start: number;
  frames: number;
  /** Length in beats: the loop plays once per this many beats of the song. */
  beats: number;
}

export interface Character {
  /** Mesh name in the set's GLB, and the lighter mesh for people far from every camera. */
  mesh: string;
  far?: string;
  joints: number;
  height: number;
  clips: Clip[];
}

/** What tools/stage/aurora/build_cast.py and build_people.py write next to each set's GLB. */
export interface FigureData {
  version: number;
  /** The loops are made to the beat: everyone plays them in time instead of at their own point. */
  sync?: boolean;
  /** Widest skeleton in the set: the animation texture is three texels per joint wide. */
  joints: number;
  frames: number;
  characters: Record<string, Character>;
  /** Band set: who plays which part, and with which loop. */
  band?: Record<string, { character: string; clip: string }>;
}

/** One set of people: the band or the crowd. */
export interface FigureSet {
  scene: THREE.Group;
  data: FigureData;
  /** Per frame and joint a 3x4 matrix, row-major, half floats. */
  anim: Uint16Array;
}

/** What tools/stage/aurora/build_scenery.py writes next to scenery.glb. */
export interface SceneryData {
  version: number;
  terrain: TerrainParams;
  /** The big wheel's axle, for turning it. */
  wheel: { center: Vec3; radius: number };
  /** Lights on the far shore that the lake mirrors. */
  shore: { pos: Vec3; color: string }[];
  /** Direction to the moon. */
  moon: Vec3;
}

export interface VenueAssets {
  /** The land, lake and festival grounds; missing if they have not been built. */
  scenery: { scene: THREE.Group; data: SceneryData } | null;
  scene: THREE.Group;
  data: VenueData;
  band: FigureSet;
  crowd: FigureSet;
}

/** Each venue's files, loaded once (by venue id). */
const cache = new Map<string, Promise<VenueAssets>>();

/** How much of the venue has arrived (0..1), for the loading screen. */
const PARTS = 5;
let arrived = 0;
const watchers = new Set<(share: number) => void>();
const tell = () => watchers.forEach((w) => w(arrived / PARTS));
/** Calls back with the share of the venue that has loaded, now and whenever more of it arrives. */
export function watchVenue(cb: (share: number) => void): () => void {
  watchers.add(cb);
  cb(arrived / PARTS);
  return () => void watchers.delete(cb);
}

/** Loads a venue's files (see venues.ts) once; later callers share the same promise. */
export function loadVenue(id: string = DEFAULT_VENUE): Promise<VenueAssets> {
  const venueId = findVenue(id).id;
  const cached = cache.get(venueId);
  if (cached) return cached;
  const base = `${import.meta.env.BASE_URL}${findVenue(venueId).folder}`;
  const draco = new DRACOLoader().setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const get = async (name: string) => {
    const r = await fetch(base + name);
    if (!r.ok) throw new Error(`${name}: ${r.status}`);
    return r;
  };
  const loadSet = async (path: string): Promise<FigureSet> => {
    // The description first: a missing set fails here, before anything large is fetched.
    const data = (await get(`${path}.json`).then((r) => r.json())) as FigureData;
    const [gltf, anim] = await Promise.all([loader.loadAsync(`${base}${path}.glb`), get(`${path}.bin`).then((r) => r.arrayBuffer())]);
    return { scene: gltf.scene, data, anim: new Uint16Array(anim) };
  };
  // Characters built on this machine from downloaded files (build_people.py, kept out of the
  // repository) take the place of the project's own cast when they are there.
  const people = (name: string): Promise<FigureSet> => loadSet(`local/${name}`).catch(() => loadSet(name));
  const scenery = get('scenery.json')
    .then((r) => r.json() as Promise<SceneryData>)
    .then(async (data) => ({ scene: (await loader.loadAsync(`${base}scenery.glb`)).scene, data }))
    .catch(() => null);
  arrived = 0;
  const part = <T>(p: Promise<T>): Promise<T> =>
    p.then((v) => {
      arrived++;
      tell();
      return v;
    });
  const loading = Promise.all([
    part(loader.loadAsync(`${base}venue.glb`)),
    part(get('venue.json').then(async (r) => readVenue(await r.json(), findVenue(venueId).name))),
    part(people('band')),
    part(people('crowd')),
    part(scenery),
  ]).then(([venue, data, band, crowd, land]) => {
    draco.dispose();
    return { scene: venue.scene, data, band, crowd, scenery: land };
  });
  cache.set(venueId, loading);
  loading.catch(() => cache.delete(venueId));
  return loading;
}
