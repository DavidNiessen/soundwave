/**
 * Which stage the game shows, behind the menus and the song: the player's stage, or the one the stage
 * browser is trying out. From it the 3D stage takes its look (setStageLook) and its screens' video;
 * a video, picture or gradient in its place covers the 3D stage, which then stops drawing, and is
 * drawn by StageBackdrop (src/ui/StageBackdrop.tsx).
 */
import { stageLook, type StageDef } from '../../game/stages';
import { mediaUrl } from '../../storage/stageMedia';
import { sendScreenFrame, setStageCovered, setStageLook } from './StageView';

let active: StageDef | null = null;
let preview: StageDef | null = null;
const listeners = new Set<() => void>();

/** The stage shown now. */
export const shownStage = (): StageDef | null => preview ?? active;

export function watchShownStage(fn: () => void): () => void {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

/** The player's stage. */
export function setActiveStage(def: StageDef) {
  active = def;
  apply();
}

/** A stage tried out in the stage browser, or null to show the player's own again. */
export function setPreviewStage(def: StageDef | null) {
  preview = def;
  apply();
}

let shown = '';
function apply() {
  const def = shownStage();
  if (!def) return;
  const key = JSON.stringify(def);
  if (key === shown) return;
  shown = key;
  setStageLook(stageLook(def));
  setStageCovered(def.backdrop.kind !== 'venue');
  void showScreenVideo(def.backdrop.kind === 'venue' ? def.screens : null);
  for (const l of listeners) l();
}

/* ------------------------------------------------------------------ the screens' video */

/** Frames sent to the stage's screens per second: plenty for a picture that size, and light. */
const SCREEN_FPS = 30;
let video: HTMLVideoElement | null = null;
let videoId: string | null = null;
let timer = 0;

async function showScreenVideo(id: string | null) {
  if (id === videoId) return;
  videoId = id;
  clearInterval(timer);
  timer = 0;
  if (video) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    video = null;
  }
  if (!id) return void sendScreenFrame(null);
  const url = await mediaUrl(id);
  if (videoId !== id || !url) return;
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.src = url;
  video = v;
  void v.play().catch(() => {});
  let busy = false;
  timer = window.setInterval(() => {
    if (busy || v.readyState < 2 || v.paused) return;
    busy = true;
    void sendScreenFrame(v).finally(() => (busy = false));
  }, 1000 / SCREEN_FPS);
}
