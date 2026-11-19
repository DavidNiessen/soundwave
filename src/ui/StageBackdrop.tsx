import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BandMeter } from '../audio/bands';
import { getEngine } from '../audio/engine';
import { shownStage, watchShownStage } from '../render/stage/showStage';
import { mediaUrl } from '../storage/stageMedia';

/**
 * A stage's own background in place of the 3D venue: the player's video (looping, silent), picture
 * or colour gradient, darkened so what is in front of it stays easy to read, and swelling a little
 * with the bass of whatever plays. Nothing while the stage is the 3D venue.
 */
export function StageBackdrop() {
  const def = useSyncExternalStore(watchShownStage, shownStage);
  const backdrop = def?.backdrop;
  const media = backdrop && (backdrop.kind === 'video' || backdrop.kind === 'image') ? backdrop.media : null;
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    setUrl(null);
    if (media) void mediaUrl(media).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [media]);

  const shows = !!backdrop && backdrop.kind !== 'venue';
  useEffect(() => {
    if (!shows) return;
    const meter = new BandMeter();
    meter.setAnalyser(getEngine().analyser);
    let raf = 0;
    let last = performance.now();
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const b = meter.update(Math.min(0.1, (now - last) / 1000));
      last = now;
      ref.current?.style.setProperty('--pulse', b.low.toFixed(3));
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [shows]);

  if (!def || !backdrop || backdrop.kind === 'venue') return null;
  return (
    <div ref={ref} className="layer stage-backdrop" style={{ ['--dim' as string]: def.dim }} aria-hidden>
      {backdrop.kind === 'gradient' && (
        <div className="backdrop-fill" style={{ background: `linear-gradient(160deg, ${backdrop.from}, ${backdrop.to})` }} />
      )}
      {backdrop.kind === 'image' && url && <img className="backdrop-fill" src={url} alt="" />}
      {backdrop.kind === 'video' && url && <video className="backdrop-fill" src={url} autoPlay loop muted playsInline />}
    </div>
  );
}
