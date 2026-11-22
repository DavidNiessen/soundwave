import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BandMeter } from '../audio/bands';
import { getEngine } from '../audio/engine';
import { gpuKnown, resolveGraphics, type GraphicsSettings } from '../game/graphics';
import { acquireMenuStage, menuStageBoosted, releaseMenuStage, watchMenuLoading } from '../render/aurora/menuStage';
import { shownStage, watchShownStage } from '../render/stage/showStage';
import type { StageView } from '../render/stage/StageView';
import { DEFAULT_VENUE, VENUES, type VenueId } from '../render/venues/catalog';

/**
 * The backdrop behind menus: the 3D stage idling with slow camera moves, reacting to whatever the
 * engine plays (e.g. previews). Until it is built, and where it cannot be, the menus stand before
 * the plain night. The stage is shared between mounts (see menuStage), so remounting this never
 * shows a black frame, and it draws in a worker of its own (see StageView), so it never slows the
 * menus down.
 *
 * It stands in the venue of the stage shown (the player's, or one tried out in the Stage tab); while
 * another venue loads, the one before stays and a small note says what is loading.
 *
 * `onReady` is told once the stage has drawn (or cannot be built): the loading screen waits for it.
 */
export function MenuBackground({ graphics, onReady }: { graphics: GraphicsSettings; onReady?(): void }) {
  const def = useSyncExternalStore(watchShownStage, shownStage);
  const venue = def?.venueId ?? DEFAULT_VENUE;
  const stageRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  useEffect(() => {
    let live = true;
    let acquired = false;
    let raf = 0;
    const ready = () => live && readyRef.current?.();
    const start = () => {
      if (!live) return;
      acquired = true;
      const g = resolveGraphics(graphics);
      // Menus never need the full show: cap the frame rate so the machine stays light. The effects
      // level stays as set: the stage's pyro fires only in a drop tried out in the stage browser.
      const stage = acquireMenuStage(stageRef.current!, { ...g, fpsCap: g.fpsCap && g.fpsCap < 60 ? g.fpsCap : 60 }, venue);
      stage.ready.then(ready, (err) => {
        console.warn('3D stage unavailable', err);
        ready();
      });
      if (import.meta.env.DEV) (window as unknown as { __stage?: StageView }).__stage = stage;
      // The stage moves with whatever plays (previews, the menu music): metered here, where the audio is.
      const meter = new BandMeter();
      meter.setAnalyser(getEngine().analyser);
      let last = performance.now();
      const loop = () => {
        raf = requestAnimationFrame(loop);
        const now = performance.now();
        const b = meter.update(Math.min(0.1, (now - last) / 1000));
        last = now;
        // A drop tried out in the stage browser runs the show at full tilt.
        const boost = menuStageBoosted(now);
        stage.input({ intensity: boost ? 1 : Math.min(1, (b.low + b.mid) * 0.7), overdrive: boost, barSeconds: 2, bands: b });
      };
      loop();
    };
    // Auto graphics go by the GPU, which the stage's worker names (on the very first start only is
    // there anything to wait for): asking on the page would hold up the loading screen.
    if (graphics.preset === 'auto') void gpuKnown().then(start);
    else start();
    return () => {
      live = false;
      cancelAnimationFrame(raf);
      if (acquired) releaseMenuStage();
    };
  }, [graphics, venue]);
  return (
    <>
      <div ref={stageRef} className="layer stage-host" />
      <StageLoading />
    </>
  );
}

/** How long a venue may take before the note shows: one already loaded never flashes it, ms. */
const NOTE_DELAY_MS = 250;

/** A note while a venue loads behind the menus (the one before stays on screen meanwhile). */
function StageLoading() {
  const [venue, setVenue] = useState<VenueId | null>(null);
  useEffect(() => {
    let timer = 0;
    const stop = watchMenuLoading((v) => {
      clearTimeout(timer);
      if (!v) return setVenue(null);
      timer = window.setTimeout(() => setVenue(v), NOTE_DELAY_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, []);
  const name = VENUES.find((v) => v.id === venue)?.name;
  return (
    <div className={`stage-loading ${name ? 'on' : ''}`} role="status" aria-live="polite">
      {name && (
        <>
          <span className="stage-loading-ring" aria-hidden />
          <span>Loading {name}…</span>
        </>
      )}
    </div>
  );
}
