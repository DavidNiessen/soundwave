import { Info, ListMinus, ListPlus, PencilRuler, RotateCcw, Share, Trash2, Tag } from 'lucide-react';
import { canPlay } from '../analysis/manager';
import { useState } from 'react';
import { SET_MAX } from '../game/setlist';
import type { SongMeta } from '../storage/db';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Dialog } from './Dialog';
import { ICON_STROKE } from './icons';
import type { SongStatus } from './LibraryScreen';

/** What can be done with songs, from their detail sheet or their menu. */
export interface SongActions {
  details(song: SongMeta): void;
  addToSet(songs: SongMeta[]): void;
  removeFromSet(songs: SongMeta[]): void;
  analyze(songs: SongMeta[]): void;
  edit(song: SongMeta): void;
  /** Title, artist, album and artwork, kept in the game's copy of the song. */
  editMeta(song: SongMeta): void;
  exportSong(song: SongMeta): void;
  remove(songs: SongMeta[]): Promise<void>;
}

interface Props {
  /** The songs it is for: one, or every song selected. */
  songs: SongMeta[];
  status: Record<string, SongStatus>;
  setlist: string[];
  /** Where it opens: the pointer, or beside the song for keys and controllers. */
  at: { x: number; y: number };
  actions: SongActions;
  /** Opens straight on the question whether to remove them (the Delete key). */
  confirming?: boolean;
  onClose(): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * A song's menu (right-click, a long press, or the Options button): what its detail sheet offers,
 * at hand. For several selected songs it offers what makes sense for all of them at once.
 */
export function SongMenu({ songs, status, setlist, at, actions, confirming = false, onClose }: Props) {
  const [confirm, setConfirm] = useState(confirming);

  const one = songs.length === 1 ? songs[0] : null;
  const st = (s: SongMeta) => status[s.id] ?? { state: 'idle' as const };
  // Only songs with notes on some part go in the setlist.
  const ready = songs.filter((s) => canPlay(st(s)));
  const inSet = songs.filter((s) => setlist.includes(s.id));
  const busy = (s: SongMeta) => st(s).state === 'analyzing' || st(s).state === 'queued';
  const room = SET_MAX - setlist.length;
  const addable = ready.filter((s) => !setlist.includes(s.id));
  const analyzable = songs.filter((s) => !busy(s));

  // Every item closes the menu as it runs, except Remove, which asks first.
  const items: MenuItem[] = one
    ? [
        { id: 'details', label: 'Song details', icon: Info, run: () => actions.details(one) },
        inSet.length
          ? { id: 'set', label: 'Remove from setlist', icon: ListMinus, run: () => actions.removeFromSet(songs) }
          : {
              id: 'set',
              label: room <= 0 ? 'Setlist is full' : 'Add to setlist',
              icon: ListPlus,
              disabled: !ready.length || room <= 0,
              run: () => actions.addToSet(songs),
            },
        ...(busy(one)
          ? []
          : [
              {
                id: 'analyze',
                label: st(one).state === 'ready' && !st(one).manual ? 'Analyze again' : 'Analyze',
                icon: RotateCcw,
                run: () => actions.analyze(songs),
              },
            ]),
        { id: 'edit', label: 'Edit charts', icon: PencilRuler, disabled: st(one).state !== 'ready', run: () => actions.edit(one) },
        { id: 'meta', label: 'Edit metadata', icon: Tag, run: () => actions.editMeta(one) },
        { id: 'export', label: 'Export', icon: Share, run: () => actions.exportSong(one) },
        { id: 'remove', label: 'Remove…', icon: Trash2, danger: true, stays: true, run: () => setConfirm(true) },
      ]
    : [
        ...(addable.length || !inSet.length
          ? [
              {
                id: 'add',
                label:
                  room <= 0 ? 'Setlist is full' : addable.length ? `Add ${Math.min(room, addable.length)} to setlist` : 'Add to setlist',
                icon: ListPlus,
                disabled: !addable.length || room <= 0,
                run: () => actions.addToSet(addable.slice(0, Math.max(0, room))),
              },
            ]
          : []),
        ...(inSet.length
          ? [{ id: 'unset', label: `Remove ${inSet.length} from setlist`, icon: ListMinus, run: () => actions.removeFromSet(inSet) }]
          : []),
        ...(analyzable.length
          ? [
              {
                id: 'analyze',
                label: `Analyze ${plural(analyzable.length, 'song')}${analyzable.every((x) => st(x).state === 'ready' && !st(x).manual) ? ' again' : ''}`,
                icon: RotateCcw,
                run: () => actions.analyze(analyzable),
              },
            ]
          : []),
        {
          id: 'remove',
          label: `Remove ${plural(songs.length, 'song')}…`,
          icon: Trash2,
          danger: true,
          stays: true,
          run: () => setConfirm(true),
        },
      ];

  if (confirm)
    return (
      <Dialog
        title={one ? `Remove ${one.title}` : `Remove ${plural(songs.length, 'song')}`}
        variant="card"
        closeLabel="Keep"
        onClose={onClose}
      >
        {(keep) => (
          <div className="pause-card">
            <h2 className="display">{one ? 'Remove this song?' : `Remove ${plural(songs.length, 'song')}?`}</h2>
            <p className="hint">
              {one ? <b>{one.title}</b> : `These ${songs.length} songs`} {one ? 'leaves' : 'leave'} your library together with{' '}
              {one ? 'its' : 'their'} charts and best scores. This cannot be undone.
            </p>
            <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={keep}>
              Keep
            </button>
            <button type="button" className="btn danger wide" onClick={() => void actions.remove(songs).finally(onClose)}>
              <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
              {one ? 'Delete song and scores' : `Delete ${plural(songs.length, 'song')} and scores`}
            </button>
          </div>
        )}
      </Dialog>
    );

  return (
    <ContextMenu
      title={one ? one.title : `${plural(songs.length, 'song')} selected`}
      label={one ? `${one.title} options` : `${plural(songs.length, 'song')} options`}
      at={at}
      items={items}
      onClose={onClose}
    />
  );
}
