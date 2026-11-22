import { describe, expect, it } from 'vitest';
import { DEFAULT_VENUE, isVenueId, VENUE_IDS } from '../src/render/venues/catalog';
import { liftHeight, type LiftFrame } from '../src/render/venues/kit/podiums';

describe('venues', () => {
  it('knows Moonrise, and nothing else', () => {
    expect(VENUE_IDS).toEqual(['moonrise']);
    expect(DEFAULT_VENUE).toBe('moonrise');
    expect(isVenueId('moonrise')).toBe(true);
    expect(isVenueId('random')).toBe(false);
    expect(isVenueId('warehouse')).toBe(false);
  });
});

describe('podiums', () => {
  const frame = (energy: number, overdrive = 0): LiftFrame => ({ dt: 1 / 60, clock: 0, energy, overdrive });
  /** Where a podium settles after a minute of the same music. */
  const settle = (index: number, featured: number, f: LiftFrame) => {
    let h = 0;
    for (let i = 0; i < 3600; i++) h = liftHeight(h, 1.2, index, featured, f);
    return h;
  };

  it('rise with busier music, the featured player highest, all the way in overdrive, never past their travel', () => {
    expect(settle(1, 0.6, frame(0.9))).toBeGreaterThan(settle(1, 0.6, frame(0.2)));
    expect(settle(1, 1, frame(0.6))).toBeGreaterThan(settle(1, 0.4, frame(0.6)));
    expect(settle(1, 0.4, frame(0.3, 1))).toBeCloseTo(1.2, 3);
    for (const e of [0, 0.5, 1]) expect(settle(2, 1, frame(e, 1))).toBeLessThanOrEqual(1.2);
  });

  it('glide rather than jump', () => {
    expect(liftHeight(0, 1.2, 0, 1, frame(1, 1))).toBeLessThan(0.02);
  });
});
