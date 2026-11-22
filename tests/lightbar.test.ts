import { describe, expect, it } from 'vitest';
import { FLASH_MS, GOLD_LIGHT, IDLE_LIGHT, LANE_LIGHT, lightColor, OVERDRIVE_LIGHT, type LightState } from '../src/input/lightbar';

const at = (now: number, over: Partial<LightState> = {}): LightState => ({
  now,
  hit: null,
  beatAt: -Infinity,
  fullStreak: false,
  overdrive: false,
  ...over,
});

describe('light bar', () => {
  it('is off between flashes', () => {
    expect(lightColor(at(1000))).toEqual({ r: 0, g: 0, b: 0 });
    expect(IDLE_LIGHT).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('flashes the colour of the lane pressed, then fades out', () => {
    const hit = { lane: 1, at: 1000 };
    expect(lightColor(at(1000, { hit }))).toEqual(LANE_LIGHT[1]);
    const mid = lightColor(at(1000 + FLASH_MS / 2, { hit }));
    expect(mid.r).toBeLessThan(LANE_LIGHT[1].r);
    expect(mid.r).toBeGreaterThan(0);
    expect(lightColor(at(1000 + FLASH_MS, { hit }))).toEqual(IDLE_LIGHT);
  });

  it('glows gold on a full streak, and a press only brightens it', () => {
    const steady = lightColor(at(5000, { fullStreak: true }));
    const kicked = lightColor(at(1000, { fullStreak: true, hit: { lane: 3, at: 1000 } }));
    expect(kicked).toEqual(GOLD_LIGHT);
    // Same hue, dimmer: never the lane's blue.
    expect(steady.b).toBe(0);
    expect(steady.r).toBeLessThan(GOLD_LIGHT.r);
    expect(steady.g / steady.r).toBeCloseTo(GOLD_LIGHT.g / GOLD_LIGHT.r, 1);
  });

  it('turns light blue in overdrive, over the full streak, and pulses on the beat', () => {
    const steady = lightColor(at(5000, { fullStreak: true, overdrive: true }));
    expect(steady.b).toBeGreaterThan(steady.r);
    expect(lightColor(at(2000, { fullStreak: true, overdrive: true, beatAt: 2000 }))).toEqual(OVERDRIVE_LIGHT);
    expect(lightColor(at(2000, { overdrive: true, hit: { lane: 0, at: 2000 } }))).toEqual(OVERDRIVE_LIGHT);
  });

  it('pulses on the beat only in overdrive', () => {
    expect(lightColor(at(2000, { fullStreak: true, beatAt: 2000 }))).toEqual(lightColor(at(2000, { fullStreak: true })));
  });
});
