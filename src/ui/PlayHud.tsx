import { Lock, Pause, Zap } from 'lucide-react';
import { useId } from 'react';
import type { Chart } from '../chart/types';
import type { HudRefs } from '../game/PlayController';
import { keyLabel, type Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
import { useInputMode } from '../input/inputMode';
import { useGlyphStyle } from '../input/usePads';
import { ICON_STROKE, PART_ICON, PART_LABEL } from './icons';

/** A five-pointed star in a 48 by 48 box, and two of its facets: the lit upper left and the shaded lower right. */
const STAR_PATH = 'M24 11 L27.64 19.48 L36.84 20.33 L29.9 26.42 L31.94 35.42 L24 30.7 L16.06 35.42 L18.1 26.42 L11.16 20.33 L20.36 19.48 Z';
const STAR_FACET_HI = 'M24 11 L20.36 19.48 L11.16 20.33 L18.1 26.42 L24 24.5 Z';
const STAR_FACET_LO = 'M24 24.5 L29.9 26.42 L31.94 35.42 L24 30.7 Z';
/** The overdrive meter: an arc over the top of the dial, from its lower left round to its lower right. */
const OD_ARC = 'M7.81 69.2 A53 53 0 1 1 112.19 69.2';

interface Props {
  title: string;
  artist: string;
  /** Position in the set, from 1, and how many songs the set has. */
  position: number;
  total: number;
  chart: Chart;
  settings: Settings;
  /** The pause button for the mouse and touch (absent: none). */
  onPause?(): void;
  /** Watched, not played: no lane keys and no prompt to press overdrive. */
  replay?: boolean;
}

/**
 * What stands over the highway while a song plays: the song and its timeline, the stars, the score,
 * the multiplier dial with the overdrive meter, the tag for each note and the break countdown. The
 * controller fills it in (see `hudRefs`); React only lays it out.
 */
export function PlayHud({ title, artist, position, total, chart, settings, onPause, replay = false }: Props) {
  const mode = useInputMode();
  const charge = `charge-${useId().replace(/:/g, '')}`;
  const style = useGlyphStyle(settings.glyphs);
  const PartIcon = PART_ICON[chart.part];
  const keys = chart.lanes === 5 ? settings.keys5 : settings.keys4;
  const padKeys = chart.lanes === 5 ? settings.pad5 : settings.pad4;
  const usingPad = mode === 'pad';
  return (
    <>
      <div className="touch-layer" data-hud="touch" />

      {/* Paint shared by the five stars: the discs' gradients and the star's outline as a clip. */}
      <svg className="hud-defs" aria-hidden>
        <defs>
          {/* An earned star's disc: polished graphite, the HUD's dark glass made solid. */}
          <radialGradient id="hud-star-disc" cx="0.35" cy="0.28" r="0.85">
            <stop offset="0" stopColor="#4a4560" />
            <stop offset="0.55" stopColor="#221f30" />
            <stop offset="1" stopColor="#0d0b14" />
          </radialGradient>
          <radialGradient id="hud-star-gold" cx="0.36" cy="0.28" r="0.9">
            <stop offset="0" stopColor="#fff5b8" />
            <stop offset="0.4" stopColor="#ffc640" />
            <stop offset="0.8" stopColor="#f28a14" />
            <stop offset="1" stopColor="#c85c00" />
          </radialGradient>
          <clipPath id="hud-star-clip">
            <path d={STAR_PATH} />
          </clipPath>
        </defs>
      </svg>
      {onPause && (
        <button type="button" className="hud-pause" data-sfx="none" tabIndex={-1} aria-label="Pause" onClick={onPause}>
          <Pause strokeWidth={ICON_STROKE} aria-hidden />
        </button>
      )}

      <div className="hud-scorebox">
        <div className="hud-songbox">
          <span className="hud-artist">{artist}</span>
          <span className="hud-song">
            {total > 1 && (
              <span className="hud-pos">
                {position}/{total}
              </span>
            )}
            {title}
          </span>
          <div className="hud-timeline" data-hud="timeline" aria-hidden>
            <div className="hud-timeline-bar">
              <div className="hud-timeline-fill" />
            </div>
            <span className="hud-timeline-head" />
          </div>
          <span className="hud-remaining" data-hud="remaining" aria-hidden />
        </div>
        <div className="hud-stars" data-hud="stars" data-count="0" role="img" aria-label="Stars earned">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="hud-star" data-state="off" style={{ ['--i' as string]: i }}>
              <svg viewBox="0 0 48 48" aria-hidden>
                <circle className="disc" cx="24" cy="24" r="22" />
                <circle className="rim" cx="24" cy="24" r="21" />
                <circle className="ring-track" cx="24" cy="24" r="20.4" />
                <circle className="ring" cx="24" cy="24" r="20.4" pathLength={1} />
                <path className="star" d={STAR_PATH} />
                <path className="facet-hi" d={STAR_FACET_HI} />
                <path className="facet-lo" d={STAR_FACET_LO} />
                <g clipPath="url(#hud-star-clip)">
                  <rect className="gold-rise" x="10" y="10.5" width="28" height="25.5" />
                </g>
              </svg>
            </span>
          ))}
        </div>
        <div className="hud-scorepanel">
          <PartIcon className="hud-part-icon" strokeWidth={ICON_STROKE} aria-hidden />
          <span className="hud-part">{PART_LABEL[chart.part]} score</span>
          <span className="hud-score" data-hud="score">
            0
          </span>
        </div>
      </div>

      <div className="hud-cluster">
        <div className="hud-dial">
          <svg viewBox="0 0 120 120" className="hud-dial-ring" aria-hidden style={{ ['--charge' as string]: `url(#${charge})` }}>
            <defs>
              {/* A Strike charged: the meter in the Strike's own colours (see .sd-ready.ready). */}
              <linearGradient id={charge} x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="var(--violet)" />
                <stop offset="1" stopColor="var(--pink)" />
              </linearGradient>
            </defs>
            <path className="od-track" d={OD_ARC} pathLength={1} />
            <path className="od-fill" d={OD_ARC} pathLength={1} />
            <circle cx="60" cy="60" r="41" className="plate" />
            <circle cx="60" cy="60" r="37" className="track" pathLength={1} />
            <circle cx="60" cy="60" r="37" className="fill" pathLength={1} />
          </svg>
          <span className="hud-mult" data-hud="mult" data-level="1">
            ×1
          </span>
          {/* A Showdown hit's Drain halves the multiplier while it lasts. */}
          <span className="hud-hold" aria-hidden>
            <Lock strokeWidth={ICON_STROKE} />
          </span>
        </div>
        <button type="button" className="hud-od" data-hud="od" data-sfx="none" tabIndex={-1} aria-label="Start overdrive">
          <Zap strokeWidth={ICON_STROKE} aria-hidden />
          {mode !== 'touch' && !replay && <span className="hud-od-word hud-od-press">Press</span>}
          <span className="hud-od-word">Overdrive</span>
          {mode !== 'touch' && !replay && (
            <span className="hud-od-key">
              {usingPad ? <PadGlyph input={settings.padOverdrive} style={style} /> : <kbd>{keyLabel(settings.overdriveKey)}</kbd>}
            </span>
          )}
        </button>
      </div>
      <div className="hud-feedback">
        <span className="fb-streak" data-hud="fb-streak" />
        <div className="fb-tag" data-hud="feedback">
          <span data-hud="fb-word" />
          <svg className="fb-pip" viewBox="0 0 30 18" aria-hidden>
            <rect className="fb-pip-slot" x="1.5" y="1.5" width="27" height="15" rx="7.5" />
            <rect className="fb-pip-bar" x="6" y="6.5" width="18" height="5" rx="2.5" />
          </svg>
        </div>
      </div>
      <div className="hud-break" data-hud="break" aria-live="off">
        <svg viewBox="0 0 120 120" className="hud-break-ring">
          <circle cx="60" cy="60" r="52" className="track" />
          <circle cx="60" cy="60" r="52" className="fill" pathLength={1} data-hud="break-ring" />
        </svg>
        <div className="hud-break-window">
          <div className="hud-break-num" data-hud="break-num" />
        </div>
      </div>
      {!replay &&
        keys.map((k, i) => (
          <span key={i} className={`lane-key lane-${i} ${usingPad ? 'pad' : ''}`}>
            {usingPad ? <PadGlyph input={padKeys[i]} style={style} /> : keyLabel(k)}
          </span>
        ))}
    </>
  );
}

/** The parts of a HUD (see PlayHud) the controller writes to. */
export function hudRefs(root: HTMLElement): HudRefs {
  const q = (s: string) => root.querySelector<HTMLElement>(s)!;
  return {
    root,
    score: q('[data-hud=score]'),
    multiplier: q('[data-hud=mult]'),
    stars: q('[data-hud=stars]'),
    timeline: q('[data-hud=timeline]'),
    remaining: q('[data-hud=remaining]'),
    feedback: q('[data-hud=feedback]'),
    feedbackWord: q('[data-hud=fb-word]'),
    feedbackStreak: q('[data-hud=fb-streak]'),
    keys: Array.from(root.querySelectorAll<HTMLElement>('.lane-key')),
    touchLayer: q('[data-hud=touch]'),
    overdriveButton: q('[data-hud=od]'),
    breakTimer: q('[data-hud=break]'),
    breakNumber: q('[data-hud=break-num]'),
    breakRing: root.querySelector<SVGCircleElement>('[data-hud=break-ring]')!,
  };
}
