/**
 * The 3D venues the game can show, and where each one's files are. A stage of the player's (see
 * src/game/stages.ts) names the venue it stands in; the renderer loads that venue's files.
 *
 * Adding a venue: put its files in a folder of their own under public/ and add it here. What the
 * folder holds, and how the files are made, is in docs/venues.md.
 */
export interface VenueInfo {
  id: string;
  name: string;
  /** What the venue is like, for the stage editor and the 3D stage picker. */
  description: string;
  /** The folder its files are in, under the game's own files (public/), ending in a slash. */
  folder: string;
}

export const VENUES: readonly VenueInfo[] = [
  {
    id: 'moonrise',
    name: 'Moonrise',
    description: 'A moon rising out of a breaking wave, on festival grounds by a lake.',
    folder: 'stage/aurora/',
  },
];

export const DEFAULT_VENUE = VENUES[0].id;

/** The venue with this id, or the first one when there is no such venue (any more). */
export const findVenue = (id: string | undefined): VenueInfo => VENUES.find((v) => v.id === id) ?? VENUES[0];
