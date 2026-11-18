import { detectGpu } from '../../game/graphics';
import { AuroraStage } from '../aurora/AuroraStage';
import { loadVenue, watchVenue } from '../aurora/assets';
import type { Beat, FromStage, StageInput, StageRate, ToStage } from './protocol';
import type { StageLook } from './look';

/** How often a frozen stage still draws, ms (so a resized window is not left blank). */
const FROZEN_MS = 500;

const nextFrame: (cb: () => void) => unknown =
  typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : (cb) => setTimeout(cb, 1000 / 60);

/** One stage and what the page last told it. */
interface Slot {
  stage: AuroraStage | null;
  input: StageInput;
  /** A beat heard since the last frame (a downbeat outranks a beat). */
  beat: Beat | 'none';
  rate: StageRate;
  lastFrozen: number;
  size: { width: number; height: number; dpr: number };
  /** A look that came while the stage was still being built. */
  look: StageLook | null;
  disposed: boolean;
}

/**
 * Runs the 3D stages: builds them, draws them on a frame loop of their own, and takes what the page
 * says about the music. In the stage's worker it runs beside the page, so a slow stage frame never
 * holds up the menus, the highway or the input; where a worker cannot draw (no OffscreenCanvas with
 * WebGL), StageView runs the very same host on the page instead. `post` sends messages back.
 */
export function createStageHost(post: (m: FromStage) => void) {
  const slots = new Map<number, Slot>();
  let visible = true;
  let looping = false;
  /** Frames the loop has run, for diagnostics (how often the stage really gets to draw). */
  let frames = 0;

  // One loop for every stage held (only while one changes over to another are there two).
  const loop = () => {
    looping = false;
    if (!visible || !slots.size) return;
    looping = true;
    nextFrame(loop);
    frames++;
    const now = performance.now();
    for (const slot of slots.values()) {
      if (!slot.stage) continue;
      if (slot.rate === 'frozen') {
        if (now - slot.lastFrozen < FROZEN_MS) continue;
        slot.lastFrozen = now;
      }
      draw(slot);
    }
  };
  const wake = () => {
    if (looping || !visible || !slots.size) return;
    looping = true;
    nextFrame(loop);
  };
  const draw = (slot: Slot) => {
    const { intensity, overdrive, barSeconds, bands } = slot.input;
    const beat = slot.beat;
    slot.beat = 'none';
    slot.stage!.setBands(bands);
    slot.stage!.render({ beat, intensity, overdrive, barSeconds });
  };

  // Loading progress for the page's loading screen.
  watchVenue((share) => post({ type: 'venue', share }));

  async function create(m: Extract<ToStage, { type: 'create' }>) {
    const slot: Slot = {
      stage: null,
      input: { intensity: 0.3, overdrive: false, barSeconds: 2, bands: { low: 0.25, mid: 0.25, high: 0.2 } },
      beat: 'none',
      rate: 'full',
      lastFrozen: 0,
      size: { width: m.width, height: m.height, dpr: m.dpr },
      look: null,
      disposed: false,
    };
    slots.set(m.id, slot);
    let stage: AuroraStage;
    try {
      stage = await AuroraStage.create(m.canvas, m.graphics, m.options);
    } catch (err) {
      slots.delete(m.id);
      const message = err instanceof Error ? err.message : String(err);
      post({ type: 'failed', id: m.id, message, webgl: /webgl/i.test(message) });
      return;
    }
    if (slot.disposed) return stage.dispose();
    if (slot.look) stage.setLookOptions(slot.look);
    stage.setSize(slot.size.width, slot.size.height, slot.size.dpr);
    await stage.prepare();
    if (slot.disposed) return stage.dispose();
    slot.stage = stage;
    // The first frame right away, even in a hidden window: it compiles the shaders, and the loading
    // screen waits for it.
    draw(slot);
    post({ type: 'shown', id: m.id });
    wake();
  }

  function handle(m: ToStage) {
    switch (m.type) {
      case 'preload':
        // The page picks the Auto graphics tier by the GPU's name: found here, off the page.
        post({ type: 'gpu', name: detectGpu() });
        loadVenue().catch(() => undefined);
        return;
      case 'visible':
        visible = m.visible;
        wake();
        return;
      case 'create':
        void create(m);
        return;
    }
    const slot = slots.get(m.id);
    if (!slot) return;
    switch (m.type) {
      case 'size':
        slot.size = { width: m.width, height: m.height, dpr: m.dpr };
        slot.stage?.setSize(m.width, m.height, m.dpr);
        // Drawn at the new size straight away, not half a second later.
        if (slot.rate === 'frozen' && slot.stage) draw(slot);
        break;
      case 'input':
        slot.input = m.input;
        break;
      case 'beat':
        if (slot.beat !== 'downbeat') slot.beat = m.beat;
        break;
      case 'rate':
        slot.rate = m.rate;
        break;
      case 'look':
        slot.look = m.look;
        slot.stage?.setLookOptions(m.look);
        // Seen at once on a stage that only draws now and then (under a screen).
        if (slot.rate === 'frozen' && slot.stage) draw(slot);
        break;
      case 'screen':
        if (slot.stage) slot.stage.setScreenFrame(m.frame);
        else m.frame?.close();
        break;
      case 'overdrive':
        slot.stage?.overdriveStart();
        break;
      case 'finale':
        slot.stage?.finale(m.seconds);
        break;
      case 'debug':
        if (slot.stage) post({ type: 'debug', id: m.id, info: { ...slot.stage.debugInfo(), frames, at: performance.now() } });
        break;
      case 'dispose':
        slot.disposed = true;
        slot.stage?.dispose();
        slots.delete(m.id);
        break;
    }
  }

  return { handle };
}
