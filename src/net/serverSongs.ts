/**
 * The songs players share on a server, as the library shows them: every whole song on the server
 * the player does not have yet. Played by streaming or by downloading it into the library, as the
 * player chose (settings.serverSongs).
 *
 * Streaming is meant not to be noticed: a song pressed goes into the setlist at once and comes in
 * the background (its progress shown on it), a song the player rests on starts coming before it is
 * pressed, and a streamed song is kept on the device for a while (streamCache.ts), so it plays at
 * once the next time and a setlist keeps it through a restart. It is never added to the library.
 * It comes in the quality the player chose, where the server has that copy (streamQuality.ts).
 *
 * And the other way: with settings.shareLibrary on, the player's own songs go to the server, one
 * after another in the background, those added later too.
 */
import { analysisManager } from '../analysis/manager';
import { lendSongAudio } from '../audio/songAudio';
import type { SongMeta } from '../storage/db';
import { readSongPackage } from '../storage/songFile';
import { readSoundwave } from '../storage/soundwaveFile';
import { online } from './client';
import type { SharedSong, StreamQuality } from './protocol';
import { cachedIds, cachedSong, dropSong, keepSong } from './streamCache';
import { makeCopies } from './streamQuality';

export interface ServerSongsState {
  /** The server's whole songs (with their audio), newest first. */
  list: SharedSong[];
  /** Songs streamed and held now, ready to play, by id. */
  held: Record<string, SongMeta>;
  /**
   * Songs on their way (streamed or downloaded), by id: how much of each has come, 0..1 (0 until
   * the size is known), with what the list says of it, to show in a setlist meanwhile.
   */
  coming: Record<string, { progress: number; meta: SongMeta }>;
  /** Songs kept on this device from this server (streamCache.ts), ready to play without the network. */
  kept: Record<string, true>;
  /** Songs that could not be streamed, with why. */
  failed: Record<string, string>;
  /** How many of the player's songs are still to be shared, while sharing runs. */
  sharing: number;
  /** The list has come from the server at least once (so sharing knows what it has). */
  ready: boolean;
}

class ServerSongs {
  private state: ServerSongsState = { list: [], held: {}, coming: {}, kept: {}, failed: {}, sharing: 0, ready: false };
  /** Streams under way, so a song pressed twice (or rested on, then pressed) is fetched once. */
  private flights = new Map<string, Promise<SongMeta>>();
  /** The quality the player chose (settings.streamQuality). */
  private quality: StreamQuality = 'high';
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

  constructor() {
    // Live: a song shared, renamed or removed anywhere on the server shows here at once.
    online.onChanged(['songs'], () => void this.refresh());
  }

  /** Signed in to `server` (null: not signed in): a new server starts afresh. */
  connect(server: string | null) {
    if (server === this.server) return;
    this.server = server;
    this.sent.clear();
    this.synced.clear();
    this.copied.clear();
    for (const id of Object.keys(this.state.held)) {
      lendSongAudio(id, null);
      analysisManager.forget(id);
    }
    this.flights.clear();
    this.set({ list: [], held: {}, coming: {}, kept: {}, failed: {}, sharing: 0, ready: false });
    if (!server) return;
    void this.refresh();
    void cachedIds(server).then(
      (ids) =>
        this.server === server &&
        this.set({ kept: { ...this.state.kept, ...Object.fromEntries([...ids].map((id) => [id, true as const])) } }),
    );
  }

  /** The quality songs are streamed in from now (a song already held stays as it came). */
  setQuality(q: StreamQuality) {
    this.quality = q;
  }

  /** Asks the server for its songs again. */
  async refresh() {
    if (!this.server) return this.set({ list: [] });
    try {
      const list = (await online.songs('')).filter((x) => x.audio);
      // A song gone from the server goes from this device too (taken down: it is not to be played).
      const on = new Set(list.map((x) => x.id));
      const server = this.server;
      if (server) for (const id of Object.keys(this.state.kept)) if (!on.has(id)) void dropSong(server, id);
      const kept = Object.fromEntries(
        Object.keys(this.state.kept)
          .filter((id) => on.has(id))
          .map((id) => [id, true as const]),
      );
      this.set({ list, ready: true, kept });
    } catch {
      /* the list stays as it was */
    }
  }

  /** What the list says of a song, as song details, to show it before it has come. */
  static meta(song: SharedSong): SongMeta {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      fileName: `${song.title}.soundwave`,
      mime: '',
      size: song.size,
      duration: song.duration,
      addedAt: song.created,
    };
  }

  /** What is known of a song now: held, on its way, or in the list (null: none of them). */
  known(id: string): SongMeta | null {
    const s = this.state;
    const listed = s.list.find((x) => x.id === id);
    return s.held[id] ?? s.coming[id]?.meta ?? (listed ? ServerSongs.meta(listed) : null);
  }

  private setComing(id: string, value: { progress: number; meta: SongMeta } | null) {
    const { [id]: _, ...rest } = this.state.coming;
    this.set({ coming: value ? { ...rest, [id]: value } : rest });
  }

  /**
   * Streams a server song: from this device where it is kept, else from the server (and kept),
   * held in memory and playable from then on. A song already on its way is waited for, not fetched
   * again.
   */
  stream(song: SharedSong): Promise<SongMeta> {
    const had = this.state.held[song.id];
    if (had) return Promise.resolve(had);
    const flying = this.flights.get(song.id);
    if (flying) return flying;
    const server = this.server;
    const flight = (async () => {
      const shown = ServerSongs.meta(song);
      this.setComing(song.id, { progress: 0, meta: shown });
      const { [song.id]: _, ...failed } = this.state.failed;
      this.set({ failed });
      try {
        let blob = server ? (await cachedSong(server, song.id, this.quality))?.blob : undefined;
        if (!blob) {
          const got = await online.downloadSong(song.id, this.quality, (p) => this.setComing(song.id, { progress: p, meta: shown }));
          blob = got.blob;
          if (server)
            void keepSong(server, song.id, got.quality, got.blob).then(() => this.set({ kept: { ...this.state.kept, [song.id]: true } }));
        }
        const pkg = await readSongPackage(blob, `${song.title}.soundwave`);
        // A smaller copy's audio is not the shared audio, so its hash is not the song's id: the
        // copy names the song it was made of (streamQuality.ts), and that must be this one.
        if (pkg.meta.id !== song.id && (await copyOf(blob)) !== song.id) throw new Error(`"${song.title}" came back as a different song.`);
        if (this.server !== server) throw new Error('You left the server.');
        const meta = { ...pkg.meta, id: song.id };
        lendSongAudio(song.id, pkg.audio);
        analysisManager.lend(song.id, pkg.analysis, pkg.edits);
        this.set({ held: { ...this.state.held, [song.id]: meta } });
        return meta;
      } catch (e) {
        this.set({ failed: { ...this.state.failed, [song.id]: (e as Error).message } });
        throw e;
      } finally {
        this.setComing(song.id, null);
        this.flights.delete(song.id);
      }
    })();
    this.flights.set(song.id, flight);
    return flight;
  }

  /** Starts streaming a song the player rests on, so it is there when they press it. Failures are quiet. */
  prefetch(song: SharedSong) {
    if (this.state.held[song.id] || this.flights.has(song.id)) return;
    this.stream(song).catch(() => {});
  }

  /**
   * Makes sure these songs are held, streaming those on the server (or kept here) that are not:
   * songs in a setlist after a restart, say. Resolves once all that could come have.
   */
  async ensure(ids: string[]): Promise<void> {
    const todo = ids
      .filter((id) => !this.state.held[id])
      .map((id) => this.state.list.find((x) => x.id === id))
      .filter((x): x is SharedSong => !!x);
    await Promise.all(todo.map((song) => this.stream(song).catch(() => {})));
  }

  /** Downloads a server song as its .soundwave file (as shared), to add to the library. */
  async download(song: SharedSong): Promise<File> {
    const shown = ServerSongs.meta(song);
    this.setComing(song.id, { progress: 0, meta: shown });
    try {
      const got = await online.downloadSong(song.id, 'high', (p) => this.setComing(song.id, { progress: p, meta: shown }));
      return new File([got.blob], `${song.title}.soundwave`);
    } finally {
      this.setComing(song.id, null);
    }
  }

  /** The server this list is from (its address), while signed in. */
  get url() {
    return this.server;
  }

  /** Songs whose smaller copies were tried on this server, so each is made once. */
  private copied = new Set<string>();
  private copyingRun = false;

  /**
   * Makes the smaller copies for streaming (streamQuality.ts) that the server lacks, one song after
   * another in the background: of the songs this player shared (from their library), and as an
   * admin or moderator of every song (fetched as shared where the library lacks it). `idle` says
   * whether now is a good time (not while a song is played); the work waits until it is.
   */
  async makeCopies(me: { name: string; curator: boolean }, local: (id: string) => Promise<Blob> | null, idle: () => boolean) {
    if (this.copyingRun || !this.server || !this.state.ready) return;
    const server = this.server;
    const todo = this.state.list.filter(
      (x) =>
        x.qualities !== undefined &&
        (x.by === me.name || me.curator) &&
        (!x.qualities.includes('medium') || !x.qualities.includes('low')) &&
        !this.copied.has(x.id),
    );
    if (!todo.length) return;
    this.copyingRun = true;
    try {
      for (const song of todo) {
        while (!idle()) await new Promise((r) => setTimeout(r, 5000));
        if (this.server !== server) return;
        this.copied.add(song.id);
        try {
          const file = (await local(song.id)) ?? (me.curator ? (await online.downloadSong(song.id, 'high')).blob : null);
          if (!file) continue;
          const missing = (['medium', 'low'] as const).filter((q) => !song.qualities!.includes(q));
          const copies = await makeCopies(file, song.id, [...missing]);
          for (const [q, blob] of Object.entries(copies)) await online.sendSongCopy(song.id, q as 'medium' | 'low', blob);
        } catch {
          /* tried again after the next sign-in */
        }
      }
    } finally {
      this.copyingRun = false;
    }
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
          // Too big, or there already in another file, is about this song; anything else (off,
          // quota, rights) is about all of them.
          if (!/at most|already on the server/.test(message)) {
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

/** The song a smaller copy was made of (streamQuality.ts writes it into the copy's details), or null. */
async function copyOf(blob: Blob): Promise<string | null> {
  try {
    return (await readSoundwave(blob)).meta.copyOf ?? null;
  } catch {
    return null;
  }
}

export const serverSongs = new ServerSongs();
/** What the server's list says of a song, as song details (see ServerSongs.meta). */
export const sharedMeta = (song: SharedSong) => ServerSongs.meta(song);
