import { Film } from 'lucide-react';
import { useSyncExternalStore } from 'react';
import { isActive, videoExports, type ExportItem } from '../video/exports';
import { ICON_STROKE } from './icons';

/** The videos being made, as the replay list, the replay screen and the menu's chip show them. */
export function useExports(): readonly ExportItem[] {
  return useSyncExternalStore(videoExports.subscribe, videoExports.snapshot);
}

/** The video being made of a replay, if one is (the first of several asked for). */
export function exportOf(items: readonly ExportItem[], replayId: string): ExportItem | undefined {
  return items.find((i) => i.replayId === replayId && isActive(i.state));
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

/** A replay's row while its video is made: how far it is, short. */
export const exportShort = (i: ExportItem) =>
  i.state === 'waiting' ? 'Video next' : i.state === 'saving' ? 'Saving' : `Video ${pct(i.progress)}`;

/**
 * While watching a replay: the video being made, how far it is, over the replay's controls. The
 * one of this replay when there is one, else the one being made now. Nothing when none is.
 */
export function ExportBox({ replayId }: { replayId: string }) {
  const items = useExports().filter((i) => isActive(i.state));
  const item = exportOf(items, replayId) ?? items.find((i) => i.state === 'rendering' || i.state === 'saving') ?? items[0];
  if (!item) return null;
  return (
    <section className="replay-export-box" aria-label="Video being made">
      <div className="replay-export-head">
        <Film strokeWidth={ICON_STROKE} aria-hidden />
        <span className="replay-export-title">{item.title}</span>
        {items.length > 1 && <span className="replay-export-more">+{items.length - 1}</span>}
      </div>
      <span className="replay-export-what" role="status">
        {exportStatus(item)}
      </span>
      <span className="meter replay-export-bar" aria-hidden>
        <span style={{ width: pct(item.progress) }} />
      </span>
    </section>
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
