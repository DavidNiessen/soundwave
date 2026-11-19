/**
 * A server's song library (docs/specs/online-play.md, 3.4): the songs players shared, to download
 * whole or, on a charts-only server, to use with the player's own copy of the audio; sharing songs
 * from the library; reports; and, for the owner and moderators, the reports and removal.
 */
import { ArrowLeft, Download, Flag, Search, Trash2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { Settings } from '../game/settings';
import { formatTime } from '../game/setlist';
import { online } from '../net/client';
import type { SharedSong } from '../net/protocol';
import type { SongMeta } from '../storage/db';
import { useActions, useHints } from './actions';
import { ICON_STROKE } from './icons';

interface Props {
  library: SongMeta[];
  settings: Settings;
  /** Downloads a whole song into the library. */
  onGet(song: SharedSong): Promise<void>;
  /** Builds a charts-only song from the player's own audio file. */
  onUseOwnCopy(song: SharedSong, audio: File): Promise<void>;
  onShare(song: SongMeta): Promise<void>;
  onBack(): void;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export function SongsScreen({ library, settings, onGet, onUseOwnCopy, onShare, onBack }: Props) {
  useHints(settings);
  const s = useSyncExternalStore(online.subscribe, online.snapshot);
  const mod = s.account?.role === 'owner' || s.account?.role === 'moderator';
  const sharing = s.info?.sharing ?? 'off';
  const [query, setQuery] = useState('');
  const [list, setList] = useState<SharedSong[]>([]);
  const [reports, setReports] = useState<Awaited<ReturnType<typeof online.songReports>>>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [version, setVersion] = useState(0);
  const audioInput = useRef<HTMLInputElement>(null);
  const pendingCopy = useRef<SharedSong | null>(null);
  const mine = useMemo(() => new Set(library.map((x) => x.id)), [library]);
  const onServer = useMemo(() => new Set(list.map((x) => x.id)), [list]);
  const [shareId, setShareId] = useState('');

  useEffect(() => {
    if (!s.account) return;
    const t = window.setTimeout(() => void online.songs(query).then(setList, (e) => setNote((e as Error).message)), 200);
    if (mod) void online.songReports().then(setReports, () => {});
    return () => clearTimeout(t);
  }, [s.account, query, version, mod]);

  useActions([{ id: 'back', label: 'Back', icon: ArrowLeft, kbd: 'Escape', sfx: 'back', run: onBack }]);

  const run = async (id: string, what: () => Promise<unknown>, done: string) => {
    setBusy(id);
    setNote(null);
    try {
      await what();
      setNote(done);
      setVersion((v) => v + 1);
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const shareable = library.filter((x) => !onServer.has(x.id));

  return (
    <div className="page songs-online">
      <header className="page-head">
        <h1 className="page-title">Shared songs</h1>
        <p className="head-count">{s.info?.name}</p>
      </header>
      {note && (
        <p className="party-error" role="status">
          {note}
          <button type="button" className="btn small" onClick={() => setNote(null)}>
            OK
          </button>
        </p>
      )}
      <div className="lobby-body boards-body">
        <section className="ready-panel" aria-label="The server's songs">
          <label className="meta-field">
            <span className="dim">
              <Search strokeWidth={ICON_STROKE} aria-hidden /> Search by title or artist
            </span>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
          </label>
          {sharing === 'off' && <p className="hint">This server does not take shared songs. Its owner can turn sharing on.</p>}
          {sharing === 'charts' && (
            <p className="hint">
              This server keeps only charts: a song is used with your own copy of its audio, which must be the very same file.
            </p>
          )}
          <ol className="boards-lines">
            {list.length === 0 && <li className="dim">No songs{query ? ' match that' : ' yet'}.</li>}
            {list.map((x) => (
              <li key={x.id} className="boards-line songs-line">
                <span className="party-name">
                  {x.title}
                  <span className="dim"> · {x.artist}</span>
                </span>
                <span className="dim">
                  {formatTime(x.duration)}
                  {x.size > 0 && ` · ${mb(x.size)}`}
                  {x.by && ` · shared by ${x.by}`}
                </span>
                {mine.has(x.id) ? (
                  <span className="dim">In your library</span>
                ) : x.audio ? (
                  <button
                    type="button"
                    className="btn small primary"
                    disabled={busy !== null}
                    onClick={() => void run(x.id, () => onGet(x), `"${x.title}" is in your library.`)}
                  >
                    <Download strokeWidth={ICON_STROKE} aria-hidden />
                    Get it
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy !== null}
                    onClick={() => {
                      pendingCopy.current = x;
                      audioInput.current?.click();
                    }}
                  >
                    <Upload strokeWidth={ICON_STROKE} aria-hidden />
                    Use my copy
                  </button>
                )}
                {(mod || x.by === s.account?.name) && (
                  <button
                    type="button"
                    className="btn small"
                    aria-label={`Remove ${x.title} from the server`}
                    onClick={() =>
                      void run(x.id, () => online.removeSong(x.id, 'Removed by a moderator'), `"${x.title}" was removed from the server.`)
                    }
                  >
                    <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                  </button>
                )}
                <button
                  type="button"
                  className="btn small"
                  aria-label={`Report ${x.title}`}
                  onClick={() => (setReporting(x.id), setReason(''))}
                >
                  <Flag strokeWidth={ICON_STROKE} aria-hidden />
                </button>
                {reporting === x.id && (
                  <form
                    className="party-row songs-report"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(
                        x.id,
                        () => online.reportSong(x.id, reason),
                        'Reported. The server’s owner and moderators will look at it.',
                      ).then(() => setReporting(null));
                    }}
                  >
                    <label className="meta-field">
                      <span className="dim">Why (a takedown request, say)</span>
                      <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
                    </label>
                    <button type="submit" className="btn small" disabled={!reason.trim()}>
                      Send the report
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ol>
          <input
            ref={audioInput}
            type="file"
            accept="audio/*"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              const song = pendingCopy.current;
              e.target.value = '';
              if (f && song)
                void run(song.id, () => onUseOwnCopy(song, f), `"${song.title}" is in your library, with the server’s charts.`);
            }}
          />
        </section>

        <div className="party-main">
          {sharing !== 'off' && (
            <section className="ready-panel" aria-label="Share a song">
              <h2 className="label">
                <Upload strokeWidth={ICON_STROKE} aria-hidden /> Share a song
              </h2>
              <p className="hint">
                {sharing === 'songs'
                  ? 'Everyone on this server can download the songs you share, audio and all. Share only music you may pass on.'
                  : 'The server keeps the song’s details and charts, not its audio.'}
              </p>
              {shareable.length ? (
                <>
                  <select className="boards-select" value={shareId} onChange={(e) => setShareId(e.target.value)} aria-label="Song to share">
                    <option value="">Pick a song</option>
                    {shareable.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.title} · {x.artist}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn wide"
                    disabled={!shareId || busy !== null}
                    onClick={() => {
                      const song = library.find((x) => x.id === shareId)!;
                      void run(song.id, () => onShare(song), `"${song.title}" is shared.`).then(() => setShareId(''));
                    }}
                  >
                    <Upload strokeWidth={ICON_STROKE} aria-hidden />
                    Share it
                  </button>
                </>
              ) : (
                <p className="hint">Every song in your library is on the server already.</p>
              )}
            </section>
          )}
          {mod && (
            <section className="ready-panel" aria-label="Reports">
              <h2 className="label">
                <Flag strokeWidth={ICON_STROKE} aria-hidden /> Reports
              </h2>
              {s.account?.role === 'owner' && sharing !== 'off' && (
                <p className="hint">
                  You answer for what this server hands out. Remove a song that is reported with reason; removing it takes it off the server
                  for everyone at once.
                </p>
              )}
              <ol className="boards-lines">
                {reports.length === 0 && <li className="dim">No reports.</li>}
                {reports.map((r) => (
                  <li key={r.id} className="boards-line">
                    <span className="party-name">
                      {r.title} <span className="dim">· shared by {r.uploader ?? 'a deleted account'}</span>
                    </span>
                    <span className="dim">
                      {r.by ?? 'Someone'}: {r.reason}
                    </span>
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        void run(r.songId, () => online.removeSong(r.songId, r.reason), `"${r.title}" was removed from the server.`)
                      }
                    >
                      <Trash2 strokeWidth={ICON_STROKE} aria-hidden />
                      Remove
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
