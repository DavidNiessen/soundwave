import { applyPreset, DEFAULT_GRAPHICS, type GraphicsPreset } from '../game/graphics';
import { AuroraStage } from '../render/aurora/AuroraStage';

/**
 * Dev-only: the 3D stage full screen with a simulated song, for checking looks and performance
 * without playing. Open /#stage?preset=high&bpm=126&shot=hero&level=0.9&mode=play (shot pins one
 * camera, level pins how busy the music is, od = seconds until overdrive, ring = a Showdown ring of that many
 * players, with a Strike every few seconds).
 */
export async function runStagePreview(root: HTMLElement) {
  const q = new URLSearchParams(location.hash.split('?')[1] ?? '');
  const preset = (q.get('preset') ?? 'high') as GraphicsPreset;
  const g = applyPreset(DEFAULT_GRAPHICS, preset);
  // Drawn on the page, not in the worker the game uses, so the console can reach into the stage.
  const canvas = document.createElement('canvas');
  // No fade-in here: a capture right after loading should show the stage, not the fade.
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;background:#000';
  root.replaceChildren(canvas);
  const seats = Number(q.get('ring') ?? 0);
  const parts = ['lead', 'bass', 'drums', 'vocals'] as const;
  const looks = [
    undefined,
    { top: '#ff4fa3', bottom: '#1b1a2e', finish: '#45d6ff' },
    { top: '#ffc94a', bottom: '#3a2a6e', finish: '#ffffff' },
  ];
  const ring = Array.from({ length: seats }, (_, i) => ({ id: `p${i}`, part: parts[i % 4], avatar: looks[i % 3], me: i === 0 }));
  const stage = await AuroraStage.create(canvas, g, { mode: q.get('mode') === 'menu' ? 'menu' : 'play', part: 'lead', ring });
  if (seats) {
    stage.setPlaces(ring.map((p, i) => ({ id: p.id, place: i + 1, hit: i === 2 })));
    let n = 0;
    setInterval(() => {
      n++;
      stage.strike(`p${n % seats}`, `p${(n * 3 + 1) % seats}`, 500);
    }, 2500);
  }
  const fit = () => stage.setSize(innerWidth, innerHeight, devicePixelRatio);
  fit();
  (window as unknown as { __stage: AuroraStage }).__stage = stage;
  const shot = q.get('shot');
  if (shot) {
    const d = stage.director as unknown as { shots: { name: string }[]; current: unknown; update: () => boolean };
    const found = d.shots.find((s) => s.name === shot);
    if (found) {
      d.current = found;
      d.update = () => false;
    }
  }
  const bpm = Number(q.get('bpm') ?? 126);
  const od = Number(q.get('od') ?? -1);
  const level = q.get('level');
  const spb = 60 / bpm;
  const t0 = performance.now();
  let beat = -1;
  let odOn = false;
  const loop = () => {
    requestAnimationFrame(loop);
    const t = (performance.now() - t0) / 1000;
    const b = Math.floor(t / spb);
    let ev: 'none' | 'beat' | 'downbeat' = 'none';
    if (b !== beat) {
      beat = b;
      ev = b % 4 === 0 ? 'downbeat' : 'beat';
    }
    if (od >= 0 && t > od && !odOn) {
      odOn = true;
      stage.overdriveStart();
    }
    // A simulated song: builds for 8 bars, peaks, drops back.
    const bar = b / 4;
    const intensity = level !== null ? Number(level) : bar < 8 ? 0.2 + bar * 0.08 : bar < 24 ? 0.95 : 0.4;
    stage.render({ beat: ev, intensity, overdrive: odOn && t < od + 12, barSeconds: spb * 4 });
  };
  loop();
  addEventListener('resize', fit);
  document.title = 'stage ready';
}
