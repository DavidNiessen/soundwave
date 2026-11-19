import type { Rgb } from './LightShow';

/**
 * How the stage looks, as the renderer takes it: the player's stage (src/game/stages.ts) turned into
 * numbers. It can change while the stage runs, without building it again.
 */
/** The sky over it: the clouded night, a sky full of aurora, or none at all. */
export type Sky = 'night' | 'aurora' | 'black';

export interface StageLook {
  sky: Sky;
  /** The show's colours: key (beams, bulbs), accent (second beam colour) and wash (the venue). Null: the show's own, changing as it goes. */
  colors: { key: Rgb; accent: Rgb; wash: Rgb } | null;
  /** Overall brightness, 0.3..1.5 (1 = as the stage was made). */
  brightness: number;
  /** How lit the venue is (washes, screens, sky, moonlight), 0..1.2. 0 is a black stage with beams in the dark. */
  venue: number;
  /** Haze in the air, 0..1.5. */
  haze: number;
  /** Strength of the moving beams, 0..1.5. */
  beams: number;
  /** How much the show moves with the music. */
  show: 'chill' | 'normal' | 'festival';
  /** Hard flashes on the beat (off: the lights still move, but softly). */
  flashes: boolean;
  crowd: boolean;
  /** Fireworks, flame jets and CO2. */
  pyro: boolean;
  /** A video on the screens: turned by quarter turns clockwise, and mirrored. */
  screenTurn: number;
  screenMirror: boolean;
}

export const DEFAULT_LOOK: StageLook = {
  sky: 'night',
  colors: null,
  brightness: 1,
  venue: 1,
  haze: 1,
  beams: 1,
  show: 'normal',
  flashes: true,
  crowd: true,
  pyro: true,
  screenTurn: 0,
  screenMirror: false,
};

/** The music's intensity as the show takes it, for a calmer or wilder show. */
export function showIntensity(look: StageLook, intensity: number): number {
  if (look.show === 'chill') return intensity * 0.45;
  if (look.show === 'festival') return Math.min(1, intensity * 1.25 + 0.15);
  return intensity;
}
