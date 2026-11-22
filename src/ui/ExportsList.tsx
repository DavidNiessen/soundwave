import { Film, X } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { isActive, videoExports, type ExportItem } from '../video/exports';
import { ICON_STROKE } from './icons';

/** The exports, as the list and the menu's chip show them. */
export function useExports(): readonly ExportItem[] {
  return useSyncExternalStore(videoExports.subscribe, videoExports.snapshot);
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** What an export is doing, in a few words. */
export function exportStatus(i: ExportItem): string {
  switch (i.state) {
    case 'waiting':
      return 'Waits for the video before it';
    case 'rendering':
      return `Making the video · ${pct(i.progress)}${i.speed ? ` · ${i.speed.toFixed(1)}× the song’s speed` : ''}`;
    case 'held':
      return `Waits while a song plays · ${pct(i.progress)}`;
    case 'saving':
      return 'Saving…';
    case 'saved':
      return `Saved as ${i.fileName}`;
    case 'failed':
      return `Not made: ${i.error ?? 'something went wrong'}`;
    case 'cancelled':
      return 'Cancelled';
  }
}

/**
 * The videos being made in the background, and those just finished: how far each one is, and a
 * button to cancel it (or to take a finished one off the list).
 */
export function ExportsList() {
  const items = useExports();
  if (!items.length) return null;
  return (
    <ul className="exports" aria-label="Videos" data-nav-group="exports">
      {items.map((i) => {
        const active = isActive(i.state);
        return (
          <li key={i.id} className={`export-item ${i.state}`}>
            <Film className="export-icon" strokeWidth={ICON_STROKE} aria-hidden />
            <span className="export-text">
              <span className="export-name">{i.title}</span>
              <span className="export-what" role="status">
                {exportStatus(i)}
              </span>
            </span>
            {active && (
              <span className="meter export-bar" aria-hidden>
                <span style={{ width: pct(i.progress) }} />
              </span>
            )}
            <button
              type="button"
              className="btn small quiet"
              aria-label={active ? `Cancel the video of ${i.title}` : `Take the video of ${i.title} off the list`}
              data-sfx={active ? 'back' : undefined}
              onClick={() => (active ? videoExports.cancel(i.id) : videoExports.dismiss(i.id))}
            >
              <X strokeWidth={ICON_STROKE} aria-hidden />
              {active ? 'Cancel' : 'Dismiss'}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A quiet note on the main menu while videos are being made: how far the current one is. */
export function ExportsChip() {
  const items = useExports();
  const active = items.filter((i) => isActive(i.state));
  if (!active.length) return null;
  const now = active.find((i) => i.state === 'rendering' || i.state === 'saving') ?? active[0];
  return (
    <span
      className="export-chip"
      role="status"
      aria-label={`Making ${active.length === 1 ? 'a video' : `${active.length} videos`}: ${exportStatus(now)}`}
    >
      <Film strokeWidth={ICON_STROKE} aria-hidden />
      {now.state === 'saving' ? 'Saving video' : `Video ${pct(now.progress)}`}
      {active.length > 1 && <span className="export-more">+{active.length - 1}</span>}
    </span>
  );
}
