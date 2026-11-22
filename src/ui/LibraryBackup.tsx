import { useRef, useState, type ReactNode } from 'react';
import { analysisManager } from '../analysis/manager';
import { getEngine } from '../audio/engine';
import type { Settings } from '../game/settings';
import { PadGlyph } from '../input/glyphs';
import { confirmInput } from '../input/pads';
import {
  backupFileName,
  BACKUP_EXT,
  clearPreferences,
  readBackup,
  restoreBackup,
  writeBackup,
  type BackupContents,
  type RestoreResult,
} from '../storage/backup';
import { deleteLibrary, listSongs } from '../storage/db';
import { chooseSaveTarget } from '../storage/share';
import { useHints } from './actions';
import { Dialog } from './Dialog';
import { HoldButton } from './HoldButton';

type State =
  | { kind: 'idle' }
  | { kind: 'exporting'; done: number; total: number }
  | { kind: 'saving' }
  | { kind: 'reading' }
  | { kind: 'confirm'; backup: BackupContents }
  | { kind: 'importing'; done: number; total: number }
  | { kind: 'imported'; result: RestoreResult }
  /** Asking to delete everything; `songs` is how many there are (null while counting). */
  | { kind: 'askDelete'; songs: number | null }
  | { kind: 'deleting' }
  | { kind: 'error'; message: string };

export interface LibraryBackup {
  exportLibrary(): void;
  importLibrary(): void;
  /** Asks, with a hold to confirm, before deleting every song, score and setting. */
  deleteEverything(): void;
  busy: boolean;
  /** How the last export or import went, for beside its button. */
  exportNote?: ReactNode;
  importNote?: ReactNode;
  /** The file picker and dialogs, rendered by the screen. */
  ui: ReactNode;
}

const count = (n: number, one: string, many = `${one}s`) => (n === 0 ? `no ${many}` : `${n} ${n === 1 ? one : many}`);
const songs = (n: number) => count(n, 'song');
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dateLabel(t: number | undefined) {
  return t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : undefined;
}

/**
 * The whole library at once, for the Advanced settings: exporting it to one backup file, importing
 * one, and deleting everything.
 */
export function useLibraryBackup(settings: Settings): LibraryBackup {
  const hints = useHints(settings);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [last, setLast] = useState<'export' | 'import' | 'delete' | null>(null);
  const [hideProgress, setHideProgress] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const busy =
    state.kind === 'exporting' ||
    state.kind === 'saving' ||
    state.kind === 'reading' ||
    state.kind === 'importing' ||
    state.kind === 'deleting';

  const askDelete = () => {
    if (busy) return;
    setLast('delete');
    setState({ kind: 'askDelete', songs: null });
    void listSongs()
      .then((list) => setState((s) => (s.kind === 'askDelete' ? { kind: 'askDelete', songs: list.length } : s)))
      .catch(() => {});
  };

  const wipe = async () => {
    setState({ kind: 'deleting' });
    try {
      getEngine().stop();
      // Nothing may write to the library while it goes: every analysis is stopped first.
      for (const id of Object.keys(analysisManager.snapshot())) analysisManager.forget(id);
      await deleteLibrary();
      clearPreferences();
      // The game starts again as it came: no songs, default settings.
      location.reload();
    } catch (e) {
      setState({ kind: 'error', message: `Not everything could be deleted: ${(e as Error).message}` });
    }
  };

  const exportLibrary = async () => {
    if (busy) return;
    setLast('export');
    let target;
    try {
      target = await chooseSaveTarget(backupFileName(), 'backup');
    } catch (e) {
      return setState({ kind: 'error', message: (e as Error).message });
    }
    if (!target) return;
    try {
      setState({ kind: 'exporting', done: 0, total: 0 });
      const { file } = await writeBackup((p) => setState({ kind: 'exporting', ...p }));
      setState({ kind: 'saving' });
      await target.write(file);
      await target.close();
      // Done: the file is where the player put it, nothing more to say.
      setState({ kind: 'idle' });
    } catch (e) {
      await target.abort().catch(() => {});
      setState({ kind: 'error', message: `The library could not be exported: ${(e as Error).message}` });
    }
  };

  const chosen = async (file: File) => {
    setLast('import');
    setState({ kind: 'reading' });
    try {
      setState({ kind: 'confirm', backup: await readBackup(file) });
    } catch (e) {
      setState({ kind: 'error', message: (e as Error).message });
    }
  };

  const restore = async (backup: BackupContents) => {
    setHideProgress(false);
    setState({ kind: 'importing', done: 0, total: backup.songs.length });
    try {
      const result = await restoreBackup(backup, (p) => setState({ kind: 'importing', ...p }));
      setState({ kind: 'imported', result });
    } catch (e) {
      setState({ kind: 'error', message: `The library could not be imported: ${(e as Error).message}` });
    }
  };

  const pill = (text: string, tone = '') => <span className={`pill ${tone}`}>{text}</span>;
  const progress = (done: number, total: number) => (total ? `${done} of ${total}` : 'Starting…');
  const exportNote =
    state.kind === 'exporting'
      ? pill(`Packing ${progress(state.done, state.total)}`)
      : state.kind === 'saving'
        ? pill('Saving…')
        : state.kind === 'error' && last === 'export'
          ? pill('Failed', 'error')
          : undefined;
  const importNote =
    state.kind === 'reading'
      ? pill('Reading…')
      : state.kind === 'importing'
        ? pill(`Adding ${progress(state.done, state.total)}`)
        : state.kind === 'error' && last === 'import'
          ? pill('Failed', 'error')
          : undefined;

  const done = state.kind === 'imported' ? state.result : null;
  const ui = (
    <>
      <input
        ref={input}
        type="file"
        accept={BACKUP_EXT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void chosen(f);
        }}
      />
      {state.kind === 'confirm' && (
        <Dialog title="Import library" variant="card" closeLabel="Cancel" onClose={() => setState({ kind: 'idle' })}>
          {(close) => {
            const b = state.backup;
            const made = dateLabel(b.createdAt);
            return (
              <div className="pause-card">
                <h2 className="display">Import this library?</h2>
                <p className="hint">
                  {made ? `Backed up ${made}: ` : 'This backup holds '}
                  {songs(b.songs.length)}, {count(b.scores.length, 'best score')}
                  {b.replays.length ? `, ${count(b.replays.length, 'replay')}` : ''}
                  {b.media.length ? `, ${count(b.media.length, 'stage video or picture', 'stage videos and pictures')}` : ''}
                  {Object.keys(b.preferences).length ? ' and settings' : ''}.
                </p>
                <p className="hint">
                  Songs you already have stay as they are; the others are added with their charts. Better scores are kept, replays are
                  added, and your settings are replaced by the backup’s. The game restarts afterwards.
                </p>
                <button type="button" className="btn wide" data-autofocus data-sfx="back" onClick={close}>
                  Cancel
                </button>
                <button type="button" className="btn primary wide" onClick={() => void restore(b)}>
                  Import
                </button>
              </div>
            );
          }}
        </Dialog>
      )}
      {state.kind === 'importing' && !hideProgress && (
        // Closing this only hides it: the songs go on being added, and the row shows how far it is.
        <Dialog title="Import library" variant="card" closeLabel="Hide" onClose={() => setHideProgress(true)}>
          <div className="pause-card">
            <h2 className="display">Importing…</h2>
            <p className="hint" role="status">
              Adding songs: {progress(state.done, state.total)}
            </p>
          </div>
        </Dialog>
      )}
      {done && (
        // Closing it restarts too: the game has to load the new songs and settings.
        <Dialog title="Import library" variant="card" closeLabel="Restart" onClose={() => location.reload()}>
          <div className="pause-card">
            <h2 className="display">Library imported</h2>
            <p className="hint" role="status">
              {done.added ? `${capital(songs(done.added))} added` : 'No new songs'}
              {done.kept ? `, ${songs(done.kept)} already here` : ''}
              {done.failed ? `, ${songs(done.failed)} could not be read` : ''}
              {done.replays ? `, ${count(done.replays, 'replay')} added` : ''}
              {done.media ? `, ${count(done.media, 'stage video or picture', 'stage videos and pictures')} added` : ''}. The game restarts
              to load them and the backup’s settings.
            </p>
            <button type="button" className="btn primary wide" data-autofocus onClick={() => location.reload()}>
              Restart
            </button>
          </div>
        </Dialog>
      )}
      {(state.kind === 'askDelete' || state.kind === 'deleting') && (
        <Dialog
          title="Delete everything"
          variant="card"
          closeLabel="Keep everything"
          onClose={() => state.kind === 'askDelete' && setState({ kind: 'idle' })}
        >
          {(close) => (
            <div className="pause-card">
              <h2 className="display">Delete everything?</h2>
              <p className="hint">
                {state.kind === 'askDelete' && state.songs !== null ? `${capital(songs(state.songs))} ` : 'Every song '}
                in your library will be deleted, with their charts, the charts you edited by hand, all best scores and every replay. Every
                setting goes back to how the game came, key and controller bindings included.
              </p>
              <p className="hint">This cannot be undone. To keep a copy, export your library first.</p>
              {/* First, so it has the focus: keeping everything is the safe answer. */}
              <button
                type="button"
                className="btn wide"
                data-autofocus
                data-sfx="back"
                disabled={state.kind === 'deleting'}
                onClick={close}
              >
                Keep everything
              </button>
              <HoldButton
                tone="danger"
                label={state.kind === 'deleting' ? 'Deleting…' : 'Delete everything'}
                hint={hints.mode === 'keyboard' ? 'Hold Enter to delete' : 'Hold to delete'}
                disabled={state.kind === 'deleting'}
                glyph={hints.mode === 'pad' ? <PadGlyph input={confirmInput(hints.style)} style={hints.style} /> : undefined}
                glyphStyle={hints.style}
                onComplete={() => void wipe()}
              />
            </div>
          )}
        </Dialog>
      )}
      {state.kind === 'error' && (
        <Dialog
          title={last === 'import' ? 'Import library' : last === 'delete' ? 'Delete everything' : 'Export library'}
          variant="card"
          closeLabel="OK"
          onClose={() => setState({ kind: 'idle' })}
        >
          {(close) => (
            <div className="pause-card">
              <h2 className="display">
                {last === 'import' ? 'Could not import' : last === 'delete' ? 'Could not delete everything' : 'Could not export'}
              </h2>
              <p className="hint">{state.message}</p>
              <button type="button" className="btn primary wide" data-autofocus onClick={close}>
                OK
              </button>
            </div>
          )}
        </Dialog>
      )}
    </>
  );

  return {
    exportLibrary: () => void exportLibrary(),
    importLibrary: () => !busy && input.current?.click(),
    deleteEverything: askDelete,
    busy,
    exportNote,
    importNote,
    ui,
  };
}
