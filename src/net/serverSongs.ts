/**
 * The songs players share on a server, as the library shows them: every whole song on the server
 * the player does not have yet. Played by streaming (the song is fetched and held in memory for
 * as long as the game runs, never stored) or by downloading it into the library, as the player
 * chose (settings.serverSongs).
 *
 * And the other way: with settings.shareLibrary on, the player's own songs go to the server, one
 * after another in the background, those added later too.
 */
import { analysisManager } from '../analysis/manager';
import { lendSongAudio } from '../audio/songAudio';
import type { SongMeta } from '../storage/db';
import { readSongPackage } from '../storage/songFile';
import { online } from './client';
import type { SharedSong } from './protocol';

export interface ServerSongsState {
  /** The server's whole songs (with their audio), newest first. */
  list: SharedSong[];
  /** Songs streamed and held now, by id. */
  held: Record<string, SongMeta>;
  /** Songs being fetched, by id. */
  busy: Record<string, true>;
  /** How many of the player's songs are still to be shared, while sharing runs. */
  sharing: number;
  /** The list has come from the server at least once (so sharing knows what it has). */
  ready: boolean;
}

class ServerSongs {
  private state: ServerSongsState = { list: [], held: {}, busy: {}, sharing: 0, ready: false };
  private readonly listeners = new Set<() => void>();
  private server: string | null = null;
  /** Songs already sent (or refused) on this server, so each is tried once. */
  private sent = new Set<string>();
  private sharingRun = false;

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  readonly snapshot = () => this.state;

  private set(change: Partial<ServerSongsState>) {
    this.state = { ...this.state, ...change };
    for (const l of this.listeners) l();
  }

  /** Signed in to `server` (null: not signed in): a new server starts afresh. */
  connect(server: string | null) {
    if (server === this.server) return;
    this.server = server;
    this.sent.clear();
    this.synced.clear();
    for (const id of Object.keys(this.state.held)) {
      lendSongAudio(id, null);
      analysisManager.forget(id);
    }
    this.set({ list: [], held: {}, busy: {}, sharing: 0, ready: false });
    if (server) void this.refresh();
  }

  /** Asks the server for its songs again. */
  async refresh() {
    if (!this.server) return this.set({ list: [] });
    try {
      const list = await online.songs('');
      this.set({ list: list.filter((x) => x.audio), ready: true });
    } catch {
      /* the list stays as it was */
    }
  }

  /** Streams a server song: fetched, held in memory and playable until the game closes. */
  async stream(song: SharedSong): Promise<SongMeta> {
    const had = this.state.held[song.id];
    if (had) return had;
    this.set({ busy: { ...this.state.busy, [song.id]: true } });
    try {
      const blob = await online.downloadSong(song.id);
      const pkg = await readSongPackage(blob, `${song.title}.soundwave`);
      if (pkg.meta.id !== song.id) throw new Error(`"${song.title}" came back as a different song.`);
      lendSongAudio(song.id, pkg.audio);
      analysisManager.lend(song.id, pkg.analysis, pkg.edits);
      this.set({ held: { ...this.state.held, [song.id]: pkg.meta } });
      return pkg.meta;
    } finally {
      const { [song.id]: _, ...busy } = this.state.busy;
      this.set({ busy });
    }
  }

  /** Downloads a server song as its .soundwave file, to add to the library. */
  async download(song: SharedSong): Promise<File> {
    this.set({ busy: { ...this.state.busy, [song.id]: true } });
    try {
      return new File([await online.downloadSong(song.id)], `${song.title}.soundwave`);
    } finally {
      const { [song.id]: _, ...busy } = this.state.busy;
      this.set({ busy });
    }
  }

  /** The server this list is from (its address), while signed in. */
  get url() {
    return this.server;
  }

  /** Copies already brought up to date (by uid and hash), so each change is fetched once. */
  private synced = new Set<string>();

  /**
   * The server is the single point of truth for the songs downloaded from it: a copy whose song
   * changed there since (a new hash for the same uid) is fetched again and handed to `apply`.
   */
  async syncCopies(mine: SongMeta[], apply: (song: SharedSong, file: File) => Promise<void>) {
    if (!this.server || !this.state.ready) return;
    const byUid = new Map(this.state.list.map((x) => [x.uid, x]));
    for (const local of mine) {
      const origin = local.server;
      if (!origin || origin.url !== this.server) continue;
      const there = byUid.get(origin.uid);
      if (!there || there.hash === origin.hash || this.synced.has(`${there.uid}:${there.hash}`)) continue;
      this.synced.add(`${there.uid}:${there.hash}`);
      try {
        await apply(there, await this.download(there));
      } catch {
        /* tried again after the next sign-in */
      }
    }
  }

  /**
   * Shares the player's songs the server does not have yet, one after another. Stops at the first
   * refusal the server gives for every song alike (sharing turned off, the quota used up).
   */
  async share(mine: SongMeta[], file: (id: string) => Promise<Blob>, onStop: (message: string) => void) {
    if (this.sharingRun || !this.server || !this.state.ready) return;
    const on = new Set(this.state.list.map((x) => x.id));
    const todo = mine.filter((s) => !on.has(s.id) && !this.sent.has(s.id));
    if (!todo.length) return;
    this.sharingRun = true;
    const server = this.server;
    try {
      for (let i = 0; i < todo.length; i++) {
        if (this.server !== server) return;
        this.set({ sharing: todo.length - i });
        const song = todo[i];
        this.sent.add(song.id);
        try {
          await online.shareSong(await file(song.id));
        } catch (e) {
          const message = (e as Error).message;
          // Too big is about this song; anything else (off, quota, rights) is about all of them.
          if (!/at most/.test(message)) {
            onStop(message);
            return;
          }
        }
      }
    } finally {
      this.sharingRun = false;
      this.set({ sharing: 0 });
      void this.refresh();
    }
  }
}

export const serverSongs = new ServerSongs();
