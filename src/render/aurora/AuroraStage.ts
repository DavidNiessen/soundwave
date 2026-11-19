import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { BandLevels } from '../../audio/bands';
import type { Part } from '../../chart/types';
import { LEVEL_SHARE, type GraphicsSettings, type Level } from '../../game/graphics';
import { Director, buildShots } from '../stage/Director';
import { LightShow, PALETTES, type Rgb, type ShowState } from '../stage/LightShow';
import { DEFAULT_LOOK, showIntensity, type StageLook } from '../stage/look';
import { Particles } from '../stage/Particles';
import { loadVenue, type VenueAssets, type VenueData } from './assets';
import { Beams } from './beams';
import { CROWD_RECT, buildCrowdMap } from './crowdMap';
import { Figures, makeBand, makeCrowd, type Person } from './figures';
import { Flames } from './flames';
import { applyVenueMaterials } from './materials';
import { shared } from './shared';
import { buildSky } from './sky';
import { terrainHeight } from './terrain';

export interface StageOptions {
  mode: 'play' | 'menu';
  /** The part being played: that band member gets the close-ups. */
  part?: Part;
  /** How the player's stage looks (colours, brightness, show): see setLookOptions. */
  look?: StageLook;
}

export interface StageFrame {
  beat: 'none' | 'beat' | 'downbeat';
  /** How busy the music is, 0..1. */
  intensity: number;
  overdrive: boolean;
  /** Seconds per bar, for pacing camera moves. */
  barSeconds: number;
}

/** Share of the moving heads lit, and particle budgets, per level. */
const BEAM_SHARE: Record<Level, number> = { off: 0, low: 0.34, medium: 0.67, high: 1 };
const SPARKS: Record<Level, number> = { off: 0, low: 1500, medium: 4000, high: 9000 };
const SPARKS_PER_RAY: Record<Level, number> = { off: 0, low: 6, medium: 12, high: 22 };
const SMOKE: Record<Level, number> = { off: 0, low: 250, medium: 700, high: 1400 };
const CO2_PER_JET: Record<Level, number> = { off: 0, low: 6, medium: 14, high: 24 };
/** Camera spots the director adds itself (see buildShots), for placing detailed crowd figures. */
const EXTRA_CAMERAS: [number, number, number][] = [
  [-62, 7, 48],
  [62, 7, 48],
  [0, 1.6, 26],
  [-7, 5, 5],
  [7, 5, 5],
  [0, 6, 13],
];
/** The order the shaders know the players in. */
const PLAYERS = ['lead', 'vox', 'bass', 'drums'];

/** The looks the show moves through; they stand in for the light show's own palettes one to one. */
const LOOKS: { key: Rgb; accent: Rgb; wash: Rgb }[] = [
  { key: [1, 0.4, 0.76], accent: [0.42, 0.9, 1], wash: [0.3, 0.2, 1] },
  { key: [0.4, 0.84, 1], accent: [0.92, 0.95, 1], wash: [0.08, 0.3, 1] },
  { key: [1, 0.3, 0.6], accent: [0.76, 0.52, 1], wash: [0.72, 0.15, 0.72] },
  { key: [0.62, 0.56, 1], accent: [1, 0.6, 0.86], wash: [0.08, 0.5, 0.78] },
];
const EXPOSURE = 0.86;

/** A pulse `age` seconds old: it swells to full strength over `attack` seconds, then rings out. */
function swell(age: number, attack: number, decay: number): number {
  const x = Math.min(1, age / attack);
  return x * x * (3 - 2 * x) * Math.exp(-Math.max(0, age - attack) * decay);
}

/**
 * The Moonrise venue in real time: painted forms, a polished deck, screens, haze, a clouded night
 * sky, moving beams with star flares, a band and a crowd that move with the beat. Same contract as
 * the first 3D stage, so the game and the menus can drive either.
 */
export class AuroraStage {
  /**
   * Builds the stage on `canvas`: a page's own canvas, or one handed to a worker (see stageHost),
   * where it runs beside the page instead of in it. Nothing here touches the page.
   */
  static async create(canvas: HTMLCanvasElement | OffscreenCanvas, g: GraphicsSettings, opts: StageOptions): Promise<AuroraStage> {
    return new AuroraStage(canvas, await loadVenue(opts.look?.venueId), g, opts);
  }

  readonly director: Director;
  /** Bass, middle and treble as the page meters them (see BandMeter). */
  private readonly bandsIn: BandLevels = { low: 0.25, mid: 0.25, high: 0.2 };
  /** The canvas's size on the page, in CSS pixels, and the screen's pixel ratio. */
  private size = { width: 1280, height: 720, dpr: 1 };
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.3, 4000);
  private composer: EffectComposer | null = null;
  private readonly show: LightShow;
  private readonly beams: Beams;
  private readonly crowd: Figures;
  private readonly band: Figures;
  /**
   * The lake, and the picture it mirrors: the scene above it, drawn once more each frame from the
   * camera's reflection below the surface.
   */
  private water: THREE.Object3D | null = null;
  private mirror: THREE.WebGLRenderTarget | null = null;
  private readonly mirrorCamera = new THREE.PerspectiveCamera();
  /** The big wheel on the festival grounds, turning slowly. */
  private wheel: THREE.Object3D | null = null;
  /** Flame jets along the front of the deck; they fire with the fireworks and through overdrive. */
  private flames: Flames | null = null;
  /** Seconds of finale left, the time to its next salvo, and how many it has fired. */
  private finaleLeft = 0;
  private finaleNext = 0;
  private finaleShot = 0;
  private readonly sparks: Particles;
  private readonly smoke: Particles;
  private readonly data: VenueData;
  private readonly owned: { dispose(): void }[] = [];
  private readonly crowdMap: THREE.Texture;
  /** The players' podiums: what rides on each, how far it may rise and how high it is now. */
  private readonly lifts: {
    part: string;
    index: number;
    group: THREE.Group;
    person?: Person;
    rest: number;
    travel: number;
    height: number;
  }[] = [];
  private readonly key = new THREE.Color();
  private readonly accent = new THREE.Color();
  private readonly wash = new THREE.Color();
  private lastFrame = performance.now();
  private lastRender = 0;
  private frameAvg = 16;
  private dynScale = 1;
  private sinceResize = 0;
  private beatPeriod = 0.5;
  private lastBeatAt = 0;
  private beats = 0;
  private energy = 0.3;
  /** Beat and bar pulses, bass and beats as the scene sees them: eased, never stepping. */
  private pulse = 0;
  private barPulse = 0;
  private low = 0;
  private mid = 0;
  private high = 0;
  /** Seconds since the last beat and bar, and what was left of the pulse before them. */
  private beatAge = 9;
  private barAge = 9;
  private pulseTail = 0;
  private barTail = 0;
  private beatClock = 0;
  /** How far the clock is from the beat last heard, still to be made up. */
  private beatDrift = 0;
  private pendingBeat: StageFrame['beat'] = 'none';
  private disposed = false;
  /** The player's stage: colours, brightness, haze, beams, show, crowd and pyro. */
  private look: StageLook = DEFAULT_LOOK;
  /** The newest frame of the player's video on the screens. */
  private screenTex: THREE.Texture | null = null;
  /** The lights along the shore as the venue has them, before the look dims them. */
  private readonly shoreColors = shared.uShoreCol.value.map(() => new THREE.Color(0, 0, 0));

  private constructor(
    private readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    assets: VenueAssets,
    private g: GraphicsSettings,
    opts: StageOptions,
  ) {
    this.data = assets.data;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: g.antialias, powerPreference: 'high-performance', alpha: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = EXPOSURE;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // A graphics context can be taken away (driver reset, GPU under pressure). Asking to keep it
    // lets the browser hand it back, and the renderer rebuilds what it needs.
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored as EventListener);
    const menu = opts.mode === 'menu';
    this.show = new LightShow(menu);
    this.director = new Director(buildShots(this.data.cameras, this.data.band, opts.part), menu ? 'calm' : 'auto', 7, menu);

    const moon = this.data.moon;
    shared.uGlowPos.value.set(...moon.center);
    shared.uMoon.value.set(moon.center[0], moon.center[1], moon.center[2], moon.radius);
    if (moon.arch) shared.uArch.value.set(moon.arch.halfWidth, moon.arch.height, moon.arch.power);

    const sky = buildSky();
    this.scene.add(sky);
    this.owned.push(sky.geometry, sky.material);

    const venue = assets.scene.clone(true);
    this.owned.push(...applyVenueMaterials(venue, this.data.deck, g.lights === 'medium' || g.lights === 'high'));
    this.scene.add(venue);
    // Each podium and what stands on it moves as one.
    for (const [part, p] of Object.entries(this.data.podiums ?? {})) {
      const group = new THREE.Group();
      venue.add(group);
      for (const piece of venue.children.filter((o) => o.name.startsWith(`Podium_${part}_`))) group.add(piece);
      this.lifts.push({ part, index: PLAYERS.indexOf(part), group, rest: this.data.band[part]?.[1] ?? 0, travel: p.travel, height: 0 });
    }

    // The land, the lake and the festival grounds around the stage.
    const land = assets.scenery;
    if (land) {
      const scenery = land.scene.clone(true);
      this.owned.push(...applyVenueMaterials(scenery, this.data.deck, false));
      const wheel = new THREE.Group();
      wheel.position.set(...land.data.wheel.center);
      scenery.add(wheel);
      wheel.updateMatrixWorld();
      for (const part of scenery.children.filter((o) => o.name.startsWith('Wheel_'))) wheel.attach(part);
      this.wheel = wheel;
      this.scene.add(scenery);
      shared.uMoonDir.value.set(...land.data.moon).normalize();
      shared.uWaterLevel.value = land.data.terrain.water;
      this.water = scenery.getObjectByName('Water') ?? null;
      if (this.water && (g.lights === 'medium' || g.lights === 'high')) {
        this.mirror = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
        this.owned.push(this.mirror);
      }
      land.data.shore.slice(0, 8).forEach((s, i) => {
        shared.uShore.value[i].set(...s.pos);
        shared.uShoreCol.value[i].set(s.color);
        this.shoreColors[i].set(s.color);
      });
    }
    const ground = (x: number, z: number) => terrainHeight(land?.data.terrain, x, z);

    this.crowd = new Figures(assets.crowd);
    const low = [
      ...Object.values(this.data.cameras)
        .map((c) => c.pos)
        .filter((p) => p[1] < 10),
      ...EXTRA_CAMERAS,
    ];
    const audience = makeCrowd(this.data, this.crowd.characters, LEVEL_SHARE[g.crowd], low, assets.crowd.data.sync, ground);
    this.crowd.add(audience);
    // The ground needs to know where they stand, to shade it under them.
    this.crowdMap = buildCrowdMap(audience, LEVEL_SHARE[g.crowd]);
    this.owned.push(this.crowdMap);
    shared.uCrowdRect.value.set(CROWD_RECT.x, CROWD_RECT.z, 1 / CROWD_RECT.w, 1 / CROWD_RECT.d);
    this.band = new Figures(assets.band);
    // The part being played is picked out: more light on that player and under their feet.
    const focus = opts.part === 'vocals' ? 'vox' : opts.part;
    const players = makeBand(this.data, assets.band.data.band ?? {}, focus);
    this.band.add(players, true);
    for (const lift of this.lifts) lift.person = players.find((p) => p.part === lift.part);
    PLAYERS.forEach((key, i) => {
      const p = this.data.band[key];
      if (p) shared.uBand.value[i].set(...p);
      shared.uFeature.value[i] = !focus ? 0.6 : key === focus ? 1 : 0.4;
    });
    const island = this.data.island;
    if (island) shared.uIsland.value.set(island.center[0], island.center[2], island.a, island.b);
    this.scene.add(this.crowd.group, this.band.group);
    this.owned.push(this.crowd, this.band);

    // Lighter settings keep an even share of the moving heads.
    const share = BEAM_SHARE[g.beams];
    this.beams = new Beams(this.data.fixtures.filter((_, i) => Math.floor((i + 1) * share) > Math.floor(i * share)));
    this.scene.add(this.beams.group);
    this.owned.push(this.beams);

    if (SPARKS[g.effects] && !menu) {
      // Seven jets along the front edge of the deck, between the CO2 nozzles.
      const deck = this.data.deck;
      const bases: [number, number, number][] = [];
      for (let j = 0; j < 7; j++) {
        const a = Math.PI * (1.2 + (0.6 * j) / 6);
        const sx = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** (2 / deck.power);
        const sy = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** (2 / deck.power);
        bases.push([deck.center[0] + sx * deck.a * 1.02, deck.height, deck.center[2] - sy * deck.b * 1.02]);
      }
      // And two more to each side of it, where the note lane does not stand in front of them.
      for (const side of [-1, 1])
        bases.push(
          [deck.center[0] + side * (deck.a + 2.5), 1.9, deck.center[2] + 5],
          [deck.center[0] + side * (deck.a + 8.5), 0.3, deck.center[2] + 6.5],
        );
      this.flames = new Flames(bases);
      this.scene.add(this.flames.mesh);
      this.owned.push(this.flames);
    }
    this.sparks = new Particles(SPARKS[g.effects] || 1, THREE.AdditiveBlending);
    this.smoke = new Particles(SMOKE[g.effects] || 1, THREE.NormalBlending);
    this.scene.add(this.sparks.points, this.smoke.points);
    this.owned.push(this.sparks, this.smoke);

    this.setLook(LOOKS[0], 1);
    this.setLookOptions(opts.look ?? DEFAULT_LOOK);
    if (g.glow) this.buildComposer();
    this.applySize();
  }

  /**
   * Compiles every shader the stage uses, in parallel where the browser can, so the first frame does
   * not stop for them. A shader the first frame had to compile itself would hold up the whole GPU
   * process for the time it takes, and with it every other picture on the page (the menus, the
   * loading screen), not only this worker.
   *
   * Shaders are compiled for where they draw: with glow on, the scene is drawn into the glow's
   * buffer rather than the screen (no tone mapping there, linear colour: different shaders), and the
   * lake's mirror into a buffer of its own. The glow's passes are compiled too.
   */
  async prepare(): Promise<void> {
    const r = this.renderer;
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
    });
    const jobs: Promise<unknown>[] = [];
    const compile = (scene: THREE.Object3D, camera: THREE.Camera, target: THREE.WebGLRenderTarget | null) => {
      r.setRenderTarget(target);
      jobs.push(r.compileAsync(scene, camera));
    };
    compile(this.scene, this.camera, this.composer ? this.composer.renderTarget1 : null);
    if (this.mirror) compile(this.scene, this.camera, this.mirror);
    for (const o of hidden) o.visible = false;
    if (this.composer) {
      // Each pass draws a full-screen quad: into the glow's buffers, and the last one onto the screen.
      const quad = new THREE.PlaneGeometry(2, 2);
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const intoBuffers = new THREE.Scene();
      const ontoScreen = new THREE.Scene();
      for (const pass of this.composer.passes)
        for (const material of passMaterials(pass))
          (pass instanceof OutputPass ? ontoScreen : intoBuffers).add(new THREE.Mesh(quad, material));
      compile(intoBuffers, camera, this.composer.renderTarget1);
      compile(ontoScreen, camera, null);
      jobs.push(Promise.all(jobs).finally(() => quad.dispose()));
    }
    r.setRenderTarget(null);
    await Promise.all(jobs).catch(() => undefined);
  }

  /** The latest levels of whatever is playing (see BandMeter). */
  setBands(b: Readonly<BandLevels>) {
    this.bandsIn.low = b.low;
    this.bandsIn.mid = b.mid;
    this.bandsIn.high = b.high;
  }

  /** The player's stage: takes effect at once, the colours easing over. */
  setLookOptions(look: StageLook) {
    this.look = look;
    this.crowd.group.visible = look.crowd;
    this.renderer.toneMappingExposure = EXPOSURE * look.brightness;
    this.applyVenueLight();
    if (!look.pyro) this.flames?.hold(this.show.state.time, false);
  }

  /**
   * The venue's own light (the sky, its haze, the moon and the lights along the shore), dimmed by the
   * look. The uniforms are shared by every stage in this thread, so each sets them before it draws.
   */
  private applyVenueLight() {
    const v = this.look.venue;
    const sky = this.look.sky;
    shared.uSkyLevel.value = sky === 'black' ? 0.02 : 0.12 + 0.88 * Math.min(1, v);
    shared.uAuroraLevel.value = sky === 'aurora' ? 9 : 1;
    shared.uCloudLevel.value = sky === 'aurora' ? 0.25 : 1;
    shared.uHazeFar.value.copy(BASE_HAZE_FAR).multiplyScalar(0.15 + 0.85 * Math.min(1, v));
    shared.uMoonCol.value.copy(BASE_MOON).multiplyScalar(0.1 + 0.9 * v);
    this.shoreColors.forEach((c, i) => shared.uShoreCol.value[i].copy(c).multiplyScalar(0.1 + 0.9 * v));
    shared.uHazeDensity.value = BASE_HAZE_DENSITY * this.look.haze;
    shared.uVenueLevel.value = v;
    shared.uScreenVideoTurn.value = this.look.screenTurn;
    shared.uScreenVideoMirror.value = this.look.screenMirror ? 1 : 0;
    // The arches take the player's own colours (they keep their own with the show's).
    const own = this.look.colors;
    shared.uPaintMix.value = own ? 0.85 : 0;
    if (own) {
      shared.uPaintA.value.setRGB(...own.wash);
      shared.uPaintB.value.setRGB(...own.accent);
      shared.uPaintC.value.setRGB(...own.key);
    }
  }

  /** A video on the screens: its newest frame, or null to show the show's own pictures again. */
  setScreenFrame(frame: ImageBitmap | null) {
    if (!frame) {
      shared.uScreenVideoOn.value = 0;
      shared.uScreenVideo.value = null;
      this.screenTex?.dispose();
      (this.screenTex?.image as ImageBitmap | undefined)?.close();
      this.screenTex = null;
      return;
    }
    if (!this.screenTex) {
      this.screenTex = new THREE.Texture(frame);
      this.screenTex.colorSpace = THREE.SRGBColorSpace;
      this.screenTex.generateMipmaps = false;
      this.screenTex.minFilter = THREE.LinearFilter;
    } else {
      (this.screenTex.image as ImageBitmap).close();
      this.screenTex.image = frame;
    }
    this.screenTex.needsUpdate = true;
    shared.uScreenVideo.value = this.screenTex;
    shared.uScreenVideoAspect.value = frame.width / Math.max(1, frame.height);
    shared.uScreenVideoOn.value = 1;
  }

  overdriveStart() {
    this.show.overdriveStart();
  }

  /**
   * The song is over: for `seconds` the flame jets burn in one long burst, the fireworks go off
   * one salvo after another, and the crowd applauds.
   */
  finale(seconds = 4) {
    this.show.finale();
    this.finaleLeft = seconds;
    this.finaleNext = 0.35;
    this.finaleShot = 0;
  }

  private readonly onContextLost = (e: Event) => e.preventDefault();
  private readonly onContextRestored = () => this.applySize();

  /** The canvas's size on the page (CSS pixels) and the screen's pixel ratio. */
  setSize(width: number, height: number, dpr: number) {
    if (width === this.size.width && height === this.size.height && dpr === this.size.dpr) return;
    this.size = { width: Math.max(1, width), height: Math.max(1, height), dpr: dpr || 1 };
    this.applySize();
  }

  private applySize() {
    const { width: w, height: h, dpr } = this.size;
    const ratio = Math.min(2, dpr) * this.g.resolution * this.dynScale;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(ratio);
    this.composer?.setSize(w, h);
    this.mirror?.setSize(Math.max(1, Math.round((w * ratio) / 2)), Math.max(1, Math.round((h * ratio) / 2)));
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  /**
   * One frame. Respects the frame-rate cap and adapts the resolution when frames run long; a frame
   * of a video (`f.now` given) is drawn on that clock, always, and at the resolution set.
   */
  render(f: StageFrame & { now?: number }) {
    if (this.disposed) return;
    const exact = f.now !== undefined;
    const now = f.now ?? performance.now();
    if (!exact) this.frameAvg += (Math.min(100, now - this.lastFrame) - this.frameAvg) * 0.05;
    this.lastFrame = now;
    if (f.beat !== 'none') {
      const t = now / 1000;
      if (this.lastBeatAt && t - this.lastBeatAt < 1.5) this.beatPeriod += (t - this.lastBeatAt - this.beatPeriod) * 0.3;
      this.lastBeatAt = t;
    }
    // Beats and bars must reach the show even on frames the cap skips.
    this.pendingBeat =
      f.beat === 'downbeat' || this.pendingBeat === 'downbeat'
        ? 'downbeat'
        : f.beat === 'beat' || this.pendingBeat === 'beat'
          ? 'beat'
          : 'none';
    if (!exact && this.g.fpsCap && now - this.lastRender < 1000 / this.g.fpsCap - 2) return;
    const dt = Math.min(0.1, (now - (this.lastRender || now)) / 1000) || 1 / 60;
    this.lastRender = now;
    if (!exact) this.adaptResolution(dt);
    const beat = this.pendingBeat;
    this.pendingBeat = 'none';
    // The clock everything moves to runs by itself at the music's tempo and is drawn toward each
    // beat as it is heard, so it keeps going through silence, menus and passages where the beats
    // come unevenly or not at all, and never jumps or stands still.
    const step = dt / Math.max(0.2, this.beatPeriod);
    if (beat !== 'none') this.beatDrift = Math.round(this.beatClock) - this.beatClock;
    const advance = Math.max(step * 0.4, step + this.beatDrift * Math.min(1, dt * 8));
    this.beatDrift -= advance - step;
    this.beatClock += advance;
    this.beats = Math.floor(this.beatClock);
    const bands = this.bandsIn;
    const look = this.look;
    const intensity = showIntensity(look, f.intensity);
    for (const e of this.show.update({ dt, beat, intensity, bands, overdrive: f.overdrive })) {
      if (!look.pyro) continue;
      if (e.type === 'fireworks') this.fireworks(e.which);
      else this.co2(e.strength);
    }
    // In overdrive the jets keep time: all of them on the bar, every other one on the beats between.
    if (this.flames && look.pyro && this.finaleLeft <= 0 && this.show.state.overdrive > 0.5 && beat !== 'none') {
      const turn = this.beats;
      if (beat === 'downbeat') this.flames.fire(this.show.state.time, undefined, 0.9);
      else this.flames.fire(this.show.state.time, (i) => (i + turn) % 2 === 0, 0.55);
    }
    // The finale: salvos in turn (the middle, the sides, the lot), with smoke on every third.
    if (this.finaleLeft > 0) {
      this.finaleLeft -= dt;
      this.finaleNext -= dt;
      if (this.finaleNext <= 0 && look.pyro) {
        this.finaleNext = 0.42;
        this.fireworks((['center', 'sides', 'all'] as const)[this.finaleShot % 3]);
        if (this.finaleShot % 3 === 2) this.co2(0.8);
        this.finaleShot++;
      }
    }
    this.crowd.clap.value = this.finaleLeft > 0 ? 1 : 0;
    // Through the finale the jets burn without a break, and are let go as it ends.
    this.flames?.hold(this.show.state.time, this.finaleLeft > 0 && look.pyro);
    shared.uFire.value = this.flames?.glow(this.show.state.time) ?? 0;
    this.sparks.update(dt, -9);
    this.smoke.update(dt, 0.4);
    if (this.wheel) this.wheel.rotation.z += dt * 0.045;
    shared.uBurst.value.w *= Math.exp(-dt * 1.6);
    this.director.update(dt, beat === 'downbeat', this.show.state.level, f.barSeconds);
    this.energy += (intensity - this.energy) * Math.min(1, dt * 1.2);
    this.beatAge += dt;
    this.barAge += dt;
    if (beat !== 'none') {
      this.beatAge = 0;
      this.pulseTail = this.pulse;
    }
    if (beat === 'downbeat') {
      this.barAge = 0;
      this.barTail = this.barPulse;
    }
    this.applyShow(this.show.state, bands, dt);
    this.moveLifts(this.show.state, dt);

    const pose = this.director.pose();
    // A close-up of a player follows their podium up and down.
    const shot = this.director.shot.name;
    const riding = shot === 'band' ? this.lifts : this.lifts.filter((l) => shot === `band-${l.part === 'vox' ? 'vocals' : l.part}`);
    const raised = riding.reduce((sum, l) => sum + l.height, 0) / Math.max(1, riding.length);
    pose.pos[1] += raised;
    pose.target[1] += raised;
    this.camera.position.set(...pose.pos);
    this.camera.lookAt(...pose.target);
    const vfov = (2 * Math.atan(Math.tan((pose.hfov * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    if (Math.abs(vfov - this.camera.fov) > 0.01) {
      this.camera.fov = vfov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    this.crowd.focus(this.camera.position);
    const scale = this.renderer.domElement.height / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.beams.update(this.camera, scale);
    this.sparks.setScale(scale);
    this.smoke.setScale(scale);
    this.renderMirror(pose.pos, pose.target);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /**
   * Draws what the lake mirrors: the sky, the stage and the grounds as seen from the camera's own
   * reflection under the water (the audience, the band and the beams are left out: they are costly
   * and hardly show). The water then looks each of its points up in that picture.
   */
  private renderMirror(pos: readonly number[], target: readonly number[]) {
    const mirror = this.mirror;
    shared.uMirrorOn.value = mirror && this.water?.visible ? 1 : 0;
    if (!mirror || !this.water?.visible) return;
    const level = shared.uWaterLevel.value;
    const cam = this.mirrorCamera;
    cam.fov = this.camera.fov;
    cam.aspect = this.camera.aspect;
    cam.near = this.camera.near;
    cam.far = this.camera.far;
    cam.updateProjectionMatrix();
    cam.position.set(pos[0], 2 * level - pos[1], pos[2]);
    cam.up.set(0, -1, 0);
    cam.lookAt(target[0], 2 * level - target[1], target[2]);
    cam.updateMatrixWorld();
    shared.uMirrorMatrix.value
      .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(cam.projectionMatrix)
      .multiply(cam.matrixWorldInverse);
    const left = [this.water, this.crowd.group, this.band.group, this.beams.group].filter((o) => o.visible);
    for (const o of left) o.visible = false;
    this.renderer.setRenderTarget(mirror);
    this.renderer.render(this.scene, cam);
    this.renderer.setRenderTarget(null);
    for (const o of left) o.visible = true;
    shared.uMirrorMap.value = mirror.texture;
  }

  /** Dev diagnostics. */
  debugInfo() {
    return {
      frameMs: +this.frameAvg.toFixed(1),
      people: this.crowd.count,
      detailed: this.crowd.detailed,
      peopleTriangles: Math.round(this.crowd.triangles + this.band.triangles),
      shot: this.director.shot.name,
      level: this.show.state.level,
      scale: this.dynScale,
      size: [this.renderer.domElement.width, this.renderer.domElement.height],
    };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored as EventListener);
    for (const o of this.owned) o.dispose();
    this.setScreenFrame(null);
    this.composer?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ------------------------------------------------------------------ show → scene
  private setLook(look: { key: Rgb; accent: Rgb; wash: Rgb }, k: number) {
    this.key.lerp(TMP_C.setRGB(...look.key), k);
    this.accent.lerp(TMP_C.setRGB(...look.accent), k);
    this.wash.lerp(TMP_C.setRGB(...look.wash), k);
  }

  private applyShow(s: ShowState, bands: Readonly<BandLevels>, dt: number) {
    const t = s.time;
    const index = PALETTES.indexOf(s.palette);
    const ease = (rate: number) => Math.min(1, dt * rate);
    const look = this.look;
    const own = look.colors;
    // The player's own colours stay, the key and accent trading places as the show moves on; else
    // the show's looks. Overdrive hands over a rainbow palette of its own: take its colours as they are.
    const next =
      index < 0
        ? { key: s.palette.key, accent: own?.accent ?? LOOKS[0].accent, wash: own?.wash ?? s.palette.wash }
        : own
          ? index % 2
            ? { key: own.accent, accent: own.key, wash: own.wash }
            : own
          : LOOKS[index];
    this.setLook(next, ease(1.1));
    // Everything reaches the scene at full strength but never as a step: a beat swells to its peak
    // over a few frames and rings out, picking up from whatever was left of the one before; the
    // bass, middle and treble are followed closely on the way up and let go more slowly; and
    // (below) every beam eases to its level, colour and angle.
    // Without flashes the beat still moves the lights, at a third of the strength.
    const flash = look.flashes ? 1 : 0.35;
    this.pulse = Math.max(this.pulseTail * Math.exp(-this.beatAge * 9), swell(this.beatAge, 0.07, 4.5) * flash);
    this.barPulse = Math.max(this.barTail * Math.exp(-this.barAge * 5), swell(this.barAge, 0.09, 1.7) * flash);
    this.low += (bands.low - this.low) * ease(bands.low > this.low ? 20 : 5);
    this.mid += (bands.mid - this.mid) * ease(bands.mid > this.mid ? 20 : 5);
    this.high += (bands.high - this.high) * ease(bands.high > this.high ? 20 : 6);
    const washLevel = 0.55 + 0.25 * this.low + 0.2 * this.barPulse + 0.2 * s.overdrive;
    this.applyVenueLight();
    shared.uTime.value = t;
    shared.uCrowdMap.value = this.crowdMap;
    shared.uBeat.value = this.beatClock;
    shared.uPulse.value = this.pulse;
    shared.uBarPulse.value = this.barPulse;
    shared.uEnergy.value = Math.min(1, this.energy + 0.4 * s.overdrive);
    shared.uLow.value = this.low;
    shared.uMid.value = this.mid;
    shared.uHigh.value = this.high;
    shared.uKey.value.copy(this.key);
    shared.uAccent.value.copy(this.accent);
    // The venue's washes and screens dim with the look's venue light; the beams do not.
    shared.uWash.value.copy(this.wash).multiplyScalar(look.venue);
    shared.uScreenLevel.value = (0.62 + 0.16 * washLevel + 0.18 * this.barPulse) * (0.08 + 0.92 * Math.min(1.2, look.venue));
    shared.uHazeNear.value
      .setRGB(0.03, 0.035, 0.15)
      .multiplyScalar(0.2 + 0.8 * Math.min(1, look.venue))
      .lerp(this.wash, 0.14)
      .multiplyScalar((0.6 + 0.35 * s.beamLevel) * Math.min(1.3, 0.3 + 0.7 * look.haze));

    for (let i = 0; i < this.beams.states.length; i++) {
      const b = this.beams.states[i];
      const role = this.beams.fixtures[i].role;
      let level = s.beamLevel;
      let pan = 0;
      let tilt = 0;
      switch (role) {
        case 'sky':
          pan = Math.sin(t * 0.22 + i) * 0.16;
          tilt = Math.sin(t * 0.17 + i * 1.7) * 0.1;
          level *= i % 2 ? 0.7 : 0;
          break;
        case 'ribbon':
          // Glints along the ribbon: lenses without a beam worth the name.
          level *= 0.12;
          break;
        case 'truss':
          level = 0.25 + 0.2 * this.barPulse + 0.12 * this.low;
          break;
        case 'halo':
          // The ring over the band: every head stays on its player and breathes with the bar.
          tilt = Math.sin(t * 0.4 + i) * 0.012;
          level = 0.25 + 0.16 * this.barPulse + 0.15 * s.beamLevel;
          break;
        case 'house':
          level = 0.14;
          break;
        case 'floor':
          pan = Math.sin(t * 0.5 + i * 0.6) * 0.25;
          level *= 0.35 + 0.4 * this.pulse;
          break;
        default:
          if (s.beamMode === 'sweep') {
            pan = Math.sin(t * 0.6 + i * 0.45) * 0.36;
            tilt = Math.sin(t * 0.45 + i) * 0.14;
          } else if (s.beamMode === 'fan') {
            pan = (i % 2 ? 1 : -1) * (0.1 + 0.22 * Math.sin(t * 1.0)) * (1 + this.pulse * 0.4);
            tilt = Math.cos(t * 0.8) * 0.08;
          } else if (s.beamMode === 'chase') {
            // A swell that travels along the row with the beat, not lamps switching on and off.
            level *= (this.beats + i) % 4 === 0 ? 1 : 0.12;
            pan = Math.sin(t * 0.4 + i) * 0.1;
          } else {
            tilt = Math.sin(t * 0.3 + i) * 0.04;
          }
          level *= 0.7 + 0.3 * this.pulse;
      }
      level *= (i % 2 ? 1 : 0.55) * look.beams;
      b.pan += (pan - b.pan) * ease(4);
      b.tilt += (tilt - b.tilt) * ease(4);
      b.level += (level - b.level) * ease(level > b.level ? 16 : 5);
      b.color.lerp(role === 'sky' || i % 3 === 0 ? this.accent : this.key, ease(3));
    }
  }

  /**
   * Raises and lowers the podiums: higher as the music gets busier, the player whose part is being
   * played above the rest, all the way up in overdrive, and each drifting a little on a cycle of
   * its own so that none ever stands still. Lifts are slow: they glide.
   */
  private moveLifts(s: ShowState, dt: number) {
    const busy = Math.min(1, Math.max(0, (this.energy - 0.2) / 0.55));
    for (const l of this.lifts) {
      const drift = 0.5 + 0.5 * Math.sin((this.beatClock / 16) * Math.PI * 2 + l.index * 1.9);
      const featured = shared.uFeature.value[l.index] ?? 0.6;
      const want = Math.max(s.overdrive, (0.1 + 0.6 * busy) * (0.5 + 0.5 * featured) + 0.3 * drift * (0.4 + 0.6 * busy));
      l.height += (l.travel * Math.min(1, want) - l.height) * Math.min(1, dt * 0.9);
      l.group.position.y = l.height;
      if (l.person) this.band.setHeight(l.person, l.rest + l.height);
      if (l.index >= 0) shared.uBand.value[l.index].y = l.rest + l.height;
    }
  }

  // ------------------------------------------------------------------ effects
  private fireworks(which: 'all' | 'center' | 'sides') {
    // The flame jets go off with them: the middle ones, the outer ones, or the lot. (Not while they
    // are held burning through the finale: a new shot would start each flame again from its foot.)
    if (!this.flames?.holding)
      this.flames?.fire(this.show.state.time, (i) => which === 'all' || (which === 'center') === (i >= 2 && i <= 4));
    const perRay = SPARKS_PER_RAY[this.g.effects];
    if (!perRay) return;
    const origin = new THREE.Vector3();
    const dir = new THREE.Vector3();
    this.data.fireworks.forEach((f, index) => {
      if (index === 0 || which === 'sides') shared.uBurst.value.set(f.origin[0], f.origin[1] + 14, f.origin[2], 1);
      const x = Math.abs(f.origin[0]);
      if (which === 'center' && x > 35) return;
      if (which === 'sides' && x < 40) return;
      origin.set(...f.origin);
      const c = (index % 2 ? this.accent : this.key).clone().lerp(WHITE, 0.45);
      this.sparks.spawn(origin, ZERO, [1, 0.95, 1], 4.5, 0.4, 0, 0, 0.6);
      for (let k = 0; k < f.n; k++) {
        const ang = ((-f.spread + (2 * f.spread * k) / Math.max(1, f.n - 1) + (Math.random() - 0.5) * 8 + f.lean) * Math.PI) / 180;
        dir.set(Math.sin(ang), Math.cos(ang), 0.25).normalize();
        const len = f.length[0] + Math.random() * (f.length[1] - f.length[0]);
        for (let j = 0; j < perRay; j++) {
          const speed = (len / 1.3) * (0.25 + 0.85 * (j / perRay)) * (0.95 + Math.random() * 0.1);
          this.sparks.spawn(
            origin,
            TMP_V.copy(dir).multiplyScalar(speed),
            [c.r, c.g, c.b],
            0.55 + Math.random() * 0.35,
            1.6 + Math.random() * 0.9,
            0.9,
            0,
          );
        }
      }
    });
  }

  private co2(strength: number) {
    const per = Math.round(strength * CO2_PER_JET[this.g.effects]);
    const origin = new THREE.Vector3();
    const tint = this.wash.clone().lerp(WHITE, 0.75);
    for (const c of this.data.co2) {
      origin.set(...c);
      for (let k = 0; k < per; k++) {
        TMP_V.set((Math.random() - 0.5) * 2.2, 9 + Math.random() * 7, (Math.random() - 0.5) * 2.2 + 0.8);
        this.smoke.spawn(
          origin,
          TMP_V,
          [tint.r * 0.8, tint.g * 0.8, tint.b * 0.85],
          1.5 + Math.random() * 1.5,
          2.2 + Math.random() * 1.3,
          1.6,
          4.0,
          0.16,
        );
      }
    }
  }

  private adaptResolution(dt: number) {
    this.sinceResize += dt;
    if (!this.g.dynamicResolution || this.sinceResize < 1.5) return;
    const budget = this.g.fpsCap ? 1000 / this.g.fpsCap : 1000 / 60;
    let next = this.dynScale;
    if (this.frameAvg > budget * 1.15) next = Math.max(0.5, this.dynScale - 0.1);
    else if (this.frameAvg < budget * 1.02 && this.dynScale < 1) next = Math.min(1, this.dynScale + 0.05);
    if (next !== this.dynScale) {
      this.dynScale = next;
      this.sinceResize = 0;
      this.applySize();
    }
  }

  private buildComposer() {
    // The composer renders into its own buffer; give it MSAA so edges stay smooth with glow on.
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: this.g.antialias ? 4 : 0 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(512, 512), 0.2, 0.45, 1.0));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }
}

/** The materials a post-processing pass draws with (its own fields, and arrays of them). */
function passMaterials(pass: object): THREE.Material[] {
  return Object.values(pass).flatMap((v: unknown) =>
    v instanceof THREE.Material ? [v] : Array.isArray(v) ? v.filter((m): m is THREE.Material => m instanceof THREE.Material) : [],
  );
}

/** The venue's own light as it was made (the look dims it from these). */
const BASE_HAZE_FAR = shared.uHazeFar.value.clone();
const BASE_MOON = shared.uMoonCol.value.clone();
const BASE_HAZE_DENSITY = shared.uHazeDensity.value;
const TMP_C = new THREE.Color();
const TMP_V = new THREE.Vector3();
const ZERO = new THREE.Vector3();
const WHITE = new THREE.Color(1, 1, 1);
