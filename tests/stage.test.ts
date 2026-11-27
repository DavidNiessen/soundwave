import { describe, expect, it } from 'vitest';
import { applyPreset, DEFAULT_GRAPHICS, normalizeGraphics, PRESETS, tierForGpu } from '../src/game/graphics';
import { normalizeSettings } from '../src/game/settings';
import { barAt, barIntensity, LightShow, type ShowFrame } from '../src/render/stage/LightShow';
import { buildShots, Director } from '../src/render/stage/Director';
import { MAX_SEATS, ringLayout, SEAT_RADIUS } from '../src/render/aurora/ring';
import type { Chart } from '../src/chart/types';

describe('graphics settings', () => {
  it('maps GPUs to tiers', () => {
    expect(tierForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0)')).toBe('ultra');
    expect(tierForGpu('ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU)')).toBe('high');
    expect(tierForGpu('ANGLE (Intel, Intel(R) UHD Graphics 620)')).toBe('low');
    expect(tierForGpu('ANGLE (AMD, AMD Radeon(TM) Graphics)')).toBe('low');
    expect(tierForGpu('Google SwiftShader')).toBe('low');
    expect(tierForGpu(null)).toBe('medium');
  });

  it('applies presets', () => {
    const g = applyPreset(DEFAULT_GRAPHICS, 'low');
    expect(g).toMatchObject({ ...PRESETS.low, preset: 'low' });
    expect(applyPreset(g, 'custom')).toMatchObject({ ...PRESETS.low, preset: 'custom' });
  });

  it('drops the switch for the 2D backdrop and the camera choice from stored settings', () => {
    const g = normalizeGraphics({ preset: 'custom', stage3d: false, camera: 'fixed' });
    expect(g).not.toHaveProperty('stage3d');
    expect(g).not.toHaveProperty('camera');
    expect(g.preset).toBe('custom');
  });

  it('repairs stored graphics settings', () => {
    const g = normalizeGraphics({ preset: 'nope', crowd: 'lots', fpsCap: 45, resolution: 3, glow: 1 });
    expect(g.preset).toBe('auto');
    expect(g.crowd).toBe(DEFAULT_GRAPHICS.crowd);
    expect(g.fpsCap).toBe(DEFAULT_GRAPHICS.fpsCap);
    expect(g.resolution).toBe(1);
    expect(g.glow).toBe(true);
    expect(normalizeSettings({}).graphics).toEqual(DEFAULT_GRAPHICS);
  });
});

describe('light show', () => {
  const frame = (p: Partial<ShowFrame>): ShowFrame => ({
    dt: 1 / 60,
    beat: 'none',
    intensity: 0.2,
    bands: { low: 0, mid: 0, high: 0 },
    overdrive: false,
    ...p,
  });

  it('climbs to a peak with busy music and fires there', () => {
    const show = new LightShow();
    const events = [];
    for (let i = 0; i < 60 * 12; i++)
      events.push(...show.update(frame({ intensity: 1, beat: i % 30 === 0 ? (i % 120 === 0 ? 'downbeat' : 'beat') : 'none' })));
    expect(show.state.level).toBe('peak');
    expect(events.some((e) => e.type === 'co2')).toBe(true);
    expect(events.some((e) => e.type === 'fireworks')).toBe(true);
  });

  it('stays calm with quiet music and never fires pyro in the menus', () => {
    const show = new LightShow(true);
    const events = [];
    for (let i = 0; i < 60 * 12; i++)
      events.push(...show.update(frame({ intensity: i < 300 ? 0.1 : 1, beat: i % 120 === 0 ? 'downbeat' : 'none' })));
    show.overdriveStart();
    events.push(...show.update(frame({})));
    expect(events).toEqual([]);
  });

  it('overdrive brings everything up', () => {
    const show = new LightShow();
    show.update(frame({}));
    show.overdriveStart();
    const ev = show.update(frame({ overdrive: true }));
    expect(ev.map((e) => e.type).sort()).toEqual(['co2', 'fireworks']);
    for (let i = 0; i < 120; i++) show.update(frame({ overdrive: true }));
    expect(show.state.overdrive).toBeGreaterThan(0.9);
    expect(show.state.beamLevel).toBeGreaterThan(0.9);
  });

  it('measures how busy each bar is', () => {
    const beats = Array.from({ length: 16 }, (_, i) => i * 0.5);
    const chart = {
      beats,
      downbeats: [0, 4, 8, 12],
      notes: [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 2.1, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7].map((t) => ({ t, lane: 0, dur: 0, phrase: -1 })),
    } as unknown as Chart;
    const v = barIntensity(chart);
    expect(v).toHaveLength(4);
    expect(v[3]).toBeGreaterThan(v[1]);
    expect(barAt([0, 2, 4, 6], 4.5)).toBe(2);
    expect(barAt([0, 2, 4, 6], -1)).toBe(-1);
  });
});

describe('camera director', () => {
  const cams = {
    front: { pos: [0, 4, 58] as [number, number, number], target: [0, 26, -12] as [number, number, number], hfov: 90 },
    hero: { pos: [96, 44, 122] as [number, number, number], target: [-4, 24, -14] as [number, number, number], hfov: 69 },
  };
  const shots = buildShots(cams, { lead: [-7, 2.4, -4.5] }, 'lead');

  it('cuts only on downbeats after the hold', () => {
    const d = new Director(shots, 'auto');
    let cuts = 0;
    for (let bar = 1; bar <= 32; bar++) {
      for (let f = 0; f < 59; f++) if (d.update(1 / 30, false, 'groove', 2)) cuts++;
      if (d.update(1 / 30, true, 'groove', 2)) cuts++;
    }
    expect(cuts).toBe(4);
  });

  it('cuts faster at a peak, slower in calm mode, never when fixed', () => {
    const count = (mode: 'auto' | 'calm' | 'fixed', level: 'peak' | 'groove') => {
      const d = new Director(shots, mode);
      let n = 0;
      for (let bar = 0; bar < 32; bar++) if (d.update(2, true, level, 2)) n++;
      return n;
    };
    expect(count('auto', 'peak')).toBe(8);
    expect(count('calm', 'peak')).toBe(2);
    expect(count('fixed', 'peak')).toBe(0);
  });

  it("favours the player's band member and never repeats a shot straight away", () => {
    const d = new Director(shots, 'auto', 3);
    const seen: string[] = [];
    for (let bar = 0; bar < 400; bar++) if (d.update(2, true, 'peak', 2)) seen.push(d.shot.name);
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
    const mine = seen.filter((s) => s === 'band-lead').length;
    const other = seen.filter((s) => s === 'band-bass').length;
    expect(mine).toBeGreaterThan(other * 2);
  });

  it('does not come back to a shot until others have been on, starting with the opening shot', () => {
    const all = buildShots(
      {
        ...cams,
        crowd: { pos: [9, 3.5, 44], target: [0, 15, -10], hfov: 72 },
        close: { pos: [-9, 5.2, 19], target: [0, 9, -8], hfov: 76 },
        aerial: { pos: [44, 62, 118], target: [0, 8, -6], hfov: 56 },
      },
      { lead: [-4.5, 3, -3.4], vox: [0, 3, -1.7], bass: [4.5, 3, -3.4], drums: [0, 3.25, -7.5] },
      'lead',
    );
    for (const [mode, level] of [
      ['auto', 'calm'],
      ['auto', 'groove'],
      ['auto', 'peak'],
      ['calm', 'groove'],
    ] as const) {
      const d = new Director(all, mode, 7);
      const seen: string[] = [d.shot.name];
      for (let bar = 0; bar < 1600; bar++) if (d.update(2, true, level, 2)) seen.push(d.shot.name);
      expect(seen.length).toBeGreaterThan(50);
      // Never the same shot twice running (the first cut included), nor with only one other between.
      for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
      for (let i = 2; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 2]);
    }
  });

  it('runs a shot the other way when it comes round again', () => {
    const d = new Director(shots, 'auto', 5);
    const starts = new Map<string, string[]>();
    const note = () =>
      starts.set(d.shot.name, [
        ...(starts.get(d.shot.name) ?? []),
        d
          .pose()
          .pos.map((v) => v.toFixed(2))
          .join(','),
      ]);
    note();
    for (let bar = 0; bar < 400; bar++) if (d.update(2, true, 'groove', 2)) note();
    for (const [, poses] of starts) {
      if (poses.length < 2) continue;
      // The second visit starts somewhere else than the first did.
      expect(poses[1]).not.toBe(poses[0]);
    }
    expect([...starts.values()].some((p) => p.length >= 2)).toBe(true);
  });

  it('moves the camera within a shot', () => {
    const d = new Director(shots, 'auto');
    const a = d.pose().pos;
    d.update(5, false, 'groove', 2);
    expect(d.pose().pos).not.toEqual(a);
  });
});

describe('Showdown ring', () => {
  const deck = { center: [0, 0, -10] as [number, number, number], a: 24, b: 12, power: 2.6, height: 2.4, barrier: 1.44 };

  it('stands every player on the deck, apart from their neighbours, the first nearest the audience', () => {
    for (const n of [1, 2, 5, 8, 16]) {
      const { spots } = ringLayout(n, deck);
      expect(spots).toHaveLength(n);
      expect(Math.max(...spots.map((s) => s[2]))).toBe(spots[0][2]);
      for (const [x, , z] of spots) {
        // Inside the deck's outline with the podium's radius to spare.
        const edge = (Math.abs(x) + SEAT_RADIUS) / deck.a;
        const depth = (Math.abs(z - deck.center[2]) + SEAT_RADIUS) / deck.b;
        expect(edge ** deck.power + depth ** deck.power).toBeLessThan(1);
      }
      for (let i = 1; i < n; i++)
        expect(Math.hypot(spots[i][0] - spots[i - 1][0], spots[i][2] - spots[i - 1][2])).toBeGreaterThan(2 * SEAT_RADIUS + 0.5);
    }
    expect(ringLayout(30, deck).spots).toHaveLength(MAX_SEATS);
  });
});
