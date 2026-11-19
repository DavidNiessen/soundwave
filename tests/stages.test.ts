import { describe, expect, it } from 'vitest';
import {
  BUILT_IN,
  copyStage,
  FEATURED,
  findStage,
  normalizeStages,
  randomColors,
  stageLook,
  stageMedia,
  stageVenue,
  TEMPLATE_INFO,
} from '../src/game/stages';
import { VENUES } from '../src/render/venues/catalog';
import { normalizeSettings } from '../src/game/settings';

describe('stages', () => {
  it('starts on the Festival stage with no stages of the player’s own', () => {
    const s = normalizeSettings({});
    expect(s.stage).toEqual({ active: 'festival', mine: [] });
    expect(findStage(s.stage, s.stage.active).name).toBe('Festival');
  });

  it('keeps the player’s stages, repairs bad values and drops what cannot be read', () => {
    const s = normalizeStages({
      active: 'mine-1',
      mine: [
        { id: 'mine-1', name: '  Dark  ', colors: { key: '#fff', accent: '#00ff00', wash: 'red' }, venue: 9, beams: 'x', show: 'wild' },
        { id: 'festival', name: 'Clash with a built-in one' },
        { name: 'No id' },
        null,
      ],
    });
    expect(s.active).toBe('mine-1');
    expect(s.mine).toHaveLength(1);
    const d = s.mine[0];
    expect(d.name).toBe('Dark');
    expect(d.colors).toBeNull();
    expect(d.venue).toBe(1.2);
    expect(d.beams).toBe(1);
    expect(d.show).toBe('normal');
    expect(d.crowd).toBe(true);
  });

  it('reads a stage’s background, darkening and screen video, and repairs them', () => {
    const [d] = normalizeStages({
      mine: [
        { id: 'mine-2', backdrop: { kind: 'video', media: 'media-1' }, dim: 3, screens: 'media-2', screensTurn: 5, screensMirror: 'yes' },
      ],
    }).mine;
    expect(d.backdrop).toEqual({ kind: 'video', media: 'media-1' });
    expect(d.dim).toBe(0.85);
    expect(d.screens).toBe('media-2');
    expect(d.screensTurn).toBe(0);
    expect(d.screensMirror).toBe(false);
    expect(stageMedia(d)).toEqual(['media-1', 'media-2']);
    const [g] = normalizeStages({ mine: [{ id: 'mine-3', backdrop: { kind: 'gradient', from: 'nope', to: '#00ff00' } }] }).mine;
    expect(g.backdrop).toEqual({ kind: 'gradient', from: '#1a0f4c', to: '#00ff00' });
    expect(normalizeStages({ mine: [{ id: 'mine-4', backdrop: { kind: 'hologram' } }] }).mine[0].backdrop).toEqual({ kind: 'venue' });
  });

  it('features a few templates, each of them described', () => {
    for (const id of FEATURED) expect(BUILT_IN.some((d) => d.id === id)).toBe(true);
    for (const d of BUILT_IN) expect(TEMPLATE_INFO[d.id]).toBeTruthy();
  });

  it('keeps a stage’s venue, and falls back to Moonrise for a venue that is gone', () => {
    const [d, gone, old] = normalizeStages({
      mine: [{ id: 'mine-5', venueId: 'warehouse' }, { id: 'mine-6', venueId: 'nowhere' }, { id: 'mine-7' }],
    }).mine;
    expect(d.venueId).toBe('warehouse');
    expect(gone.venueId).toBe('moonrise');
    expect(old.venueId).toBe('moonrise');
  });

  it('has a stage of its own for every venue, and changing one stage’s venue leaves the others', () => {
    for (const v of VENUES) expect(BUILT_IN.some((d) => d.venueId === v.id)).toBe(true);
    const s = normalizeStages({ active: 'mine-1', mine: [{ id: 'mine-1', venueId: 'arena' }, { id: 'mine-2' }] });
    expect(stageVenue(s)).toBe('arena');
    expect(findStage(s, 'mine-2').venueId).toBe('moonrise');
    expect(stageVenue({ ...s, active: 'warehouse' })).toBe('warehouse');
  });

  it('falls back to Festival when the stage in use is gone', () => {
    expect(normalizeStages({ active: 'mine-gone', mine: [] }).active).toBe('festival');
  });

  it('copies a stage under a name not taken yet', () => {
    const blackout = BUILT_IN.find((d) => d.id === 'blackout')!;
    const first = copyStage({ active: 'festival', mine: [] }, blackout);
    expect(first.name).toBe('My Blackout');
    expect(first.id).not.toBe(blackout.id);
    expect(first.colors).toEqual(blackout.colors);
    expect(first.colors).not.toBe(blackout.colors);
    const second = copyStage({ active: 'festival', mine: [first] }, blackout);
    expect(second.name).toBe('My Blackout 2');
  });

  it('gives the renderer linear colours, and none for the show’s own', () => {
    expect(stageLook(BUILT_IN[0]).colors).toBeNull();
    const look = stageLook({ ...BUILT_IN[0], colors: { key: '#ffffff', accent: '#000000', wash: '#808080' } });
    expect(look.colors!.key).toEqual([1, 1, 1]);
    expect(look.colors!.accent).toEqual([0, 0, 0]);
    expect(look.colors!.wash[0]).toBeCloseTo(0.216, 2);
  });

  it('rolls random colours as hex', () => {
    for (let i = 0; i < 20; i++) {
      const c = randomColors();
      for (const hex of [c.key, c.accent, c.wash]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
