import type { SyntheticEvent } from 'react';
import type { VenueId } from '../render/venues/catalog';

/** A still of a venue (public/stage/previews, captured from the stage itself at the High preset). */
export const venuePictureUrl = (id: VenueId) => `${import.meta.env.BASE_URL}stage/previews/${id}.webp`;

/** A picture that would not load goes: the card's own drawing shows instead of a broken image. */
const hide = (e: SyntheticEvent<HTMLImageElement>) => (e.currentTarget.style.display = 'none');

/** A venue's picture. Decorative: the stage's name is beside it. */
export function VenuePicture({ venue }: { venue: VenueId }) {
  return (
    <img
      className="venue-picture"
      src={venuePictureUrl(venue)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={hide}
      aria-hidden
    />
  );
}
