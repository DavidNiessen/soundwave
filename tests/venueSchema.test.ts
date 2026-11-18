import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURE_ROLE_NAMES, readVenue, VenueError } from '../src/render/stage/venueSchema';
import { VENUES } from '../src/render/stage/venues';

const json = (path: string) => JSON.parse(readFileSync(new URL(`../public/${path}`, import.meta.url), 'utf8')) as Record<string, unknown>;

/** The smallest venue that follows the schema. */
const minimal = () => ({
  version: 2,
  cameras: { front: { pos: [0, 5, 60], target: [0, 10, 0], hfov: 70 }, hero: { pos: [60, 20, 60], target: [0, 10, 0], hfov: 55 } },
  band: { lead: [-4, 3, -3], vox: [0, 3, -2], bass: [4, 3, -3], drums: [0, 3, -7] },
  fixtures: [{ role: 'main', pos: [0, 20, -5], dir: [0, -1, 0.2] }],
  moon: { center: [0, 8, -20], radius: 10 },
  deck: { center: [0, 0, -10], a: 20, b: 10, power: 2.5, height: 2, barrier: 1.4 },
  fireworks: [],
  co2: [],
});

describe('venue schema', () => {
  it('reads every venue the game ships', () => {
    for (const v of VENUES) {
      const data = readVenue(json(`${v.folder}venue.json`), v.name);
      expect(data.fixtures.length).toBeGreaterThan(0);
      for (const f of data.fixtures) expect(FIXTURE_ROLE_NAMES).toContain(f.role);
    }
  });

  it('reads Moonrise’s first-version fixture groups as roles, with the beams it was made with', () => {
    const raw = json('stage/aurora/venue.json') as { fixtures: { group: string }[] };
    const data = readVenue(raw, 'Moonrise');
    expect(data.fixtures).toHaveLength(raw.fixtures.length);
    const at = (group: string) => data.fixtures[raw.fixtures.findIndex((f) => f.group === group)];
    expect(at('Shell0')).toMatchObject({ role: 'main', length: 52, spread: 0.034 });
    expect(at('Sky')).toMatchObject({ role: 'sky', length: 90 });
    expect(at('Foh')).toMatchObject({ role: 'house', length: 60, spread: 0.012 });
  });

  it('takes a venue with only what is needed, giving each role its usual beam', () => {
    const data = readVenue(minimal());
    expect(data.fixtures[0]).toMatchObject({ role: 'main', length: 50, spread: 0.034 });
  });

  it('names everything a broken venue is missing', () => {
    const bad = {
      ...minimal(),
      cameras: {},
      band: { lead: [0, 0, 0] },
      fixtures: [{ role: 'laser', pos: [0, 0, 0], dir: [0, -1, 0] }],
      deck: undefined,
    };
    try {
      readVenue(bad, 'Broken');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(VenueError);
      const problems = (e as VenueError).problems.join('\n');
      expect(problems).toMatch(/cameras\.front is missing/);
      expect(problems).toMatch(/cameras\.hero is missing/);
      expect(problems).toMatch(/band\.vox/);
      expect(problems).toMatch(/fixtures\[0\]: role must be one of/);
      expect(problems).toMatch(/deck needs/);
      expect((e as VenueError).message).toMatch(/"Broken"/);
    }
  });
});
