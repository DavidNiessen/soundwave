/**
 * The venues a stage can stand in: their names and a line on each, for the menus. Nothing here
 * needs the renderer, so the interface can list them without loading any of it.
 */
export const VENUES = [{ id: 'moonrise', name: 'Moonrise', blurb: 'Open-air festival by the lake under a night sky' }] as const;

export type VenueId = (typeof VENUES)[number]['id'];

export const VENUE_IDS: readonly VenueId[] = VENUES.map((v) => v.id);
export const DEFAULT_VENUE: VenueId = 'moonrise';

export function isVenueId(v: unknown): v is VenueId {
  return VENUE_IDS.includes(v as VenueId);
}
