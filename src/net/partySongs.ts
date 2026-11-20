/**
 * A party's songs reach every player by themselves. A player can only play a song they have, so:
 * - the host's game sends a song of the set to the server as soon as a player in the party lacks it
 *   (unless the host turned that off, settings.shareSongs);
 * - once the server holds it (the set's `cached`), the game of every player without it downloads it.
 *
 * A downloaded song is kept for the party only, in memory, and goes when the player leaves it: their
 * library stays theirs. The player can keep one (`keep`), or every one (settings.serverSongs === 'download'),
 * and then it is added to the library like any song.
 *
 * Not streamed: a song is decoded whole before it starts, so every player starts it on time and a
 * slow connection never stalls it halfway through.
 *
 * App calls `update` whenever the party, the library or the settings change; the party screen shows
 * each song's transfer from `transfers`, and the songs held for the party from `songs`.
 */
import { analysisManager } from '../analysis/manager';
import { lendSongAudio } from '../audio/songAudio';
import type { SongMeta } from '../storage/db';
import { readSongPackage } from '../storage/songFile';
import type { PartyState } from './protocol';
import { online } from './client';

/** A song of the set on its way: sent by the host's game, downloaded by a player's, or failed. */
export type Transfer = { state: 'sending' } | { state: 'getting'; done: number } | { state: 'failed'; message: string };

/** A song held for the party: its details, and its file (to keep it in the library later). */
export interface PartySong {
  meta: SongMeta;
  file: File;
}

export interface SyncContext {
  party: PartyState | null;
  me: string | undefined;
  /** The server passes a party's songs on at all. */
  serverOn: boolean;
  /** This player lets their songs go to the party's players (as host). */
  share: boolean;
  /** Songs that come are added to the library, not only held for the party. */
  keep: boolean;
  /** The song is in the library. */
  has(songId: string): boolean;
  /** The song's .soundwave file, for sending. */
  file(songId: string): Promise<Blob>;
  /** Adds a song file to the library. */
  add(file: File): Promise<void>;
}

class PartySongSync {
  private state: Record<string, Transfer> = {};
  private held: Record<string, PartySong> = {};
  private readonly listeners = new Set<() => void>();
  /** Songs this game has already sent or got (or tried to) in this party: each once, unless retried. */
  private tried = new Set<string>();
  private partyCode: string | null = null;
  private last: SyncContext | null = null;

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => void this.listeners.delete(fn);
  };
  readonly transfers = () => this.state;
  readonly songs = () => this.held;

  private changed() {
    for (const l of this.listeners) l();
  }

  private set(id: string, t: Transfer | null) {
    const next = { ...this.state };
    if (t) next[id] = t;
    else delete next[id];
    this.state = next;
    this.changed();
  }

  /** Tries a song that failed again. */
  retry(songId: string) {
    this.tried.delete(`send:${songId}`);
    this.tried.delete(`get:${songId}`);
    this.set(songId, null);
    if (this.last) this.update(this.last);
  }

  /** Adds a song held for the party to the library, to keep it after the party. */
  async keep(songId: string) {
    const song = this.held[songId];
    if (!song || !this.last || this.tried.has(`keep:${songId}`)) return;
    this.tried.add(`keep:${songId}`);
    try {
      await this.last.add(song.file);
    } catch (e) {
      this.tried.delete(`keep:${songId}`);
      this.set(songId, { state: 'failed', message: (e as Error).message });
    }
  }

  update(ctx: SyncContext) {
    this.last = ctx;
    const { party, me } = ctx;
    // A new party (or none) starts afresh: the songs held for the last one go.
    if ((party?.code ?? null) !== this.partyCode) {
      this.partyCode = party?.code ?? null;
      this.tried.clear();
      this.state = {};
      for (const id of Object.keys(this.held)) lendSongAudio(id, null);
      this.held = {};
      this.changed();
    }
    if (!party || !me) return;
    const host = party.host === me;
    for (const song of party.set) {
      if (ctx.has(song.id)) {
        // In the library now (kept, or added by hand): nothing is held or on its way for it any more.
        if (this.held[song.id]) this.release(song.id);
        if (this.state[song.id]?.state === 'getting') this.set(song.id, null);
        const lacking = party.members.some((m) => m.id !== me && m.connected && !m.have.includes(song.id));
        if (ctx.serverOn && host && ctx.share && !song.cached && lacking) void this.send(ctx, song.id);
      } else if (this.held[song.id]) {
        if (ctx.keep) void this.keep(song.id);
      } else if (ctx.serverOn && song.cached) void this.get(ctx, song.id, song.title);
    }
  }

  /** Lets go of a song held for the party (its audio too). */
  private release(id: string) {
    const next = { ...this.held };
    delete next[id];
    this.held = next;
    lendSongAudio(id, null);
    this.changed();
  }

  private async send(ctx: SyncContext, songId: string) {
    const key = `send:${songId}`;
    if (this.tried.has(key)) return;
    this.tried.add(key);
    this.set(songId, { state: 'sending' });
    try {
      await online.sendPartySong(songId, await ctx.file(songId));
      this.set(songId, null);
    } catch (e) {
      this.set(songId, { state: 'failed', message: (e as Error).message });
    }
  }

  private async get(ctx: SyncContext, songId: string, title: string) {
    const key = `get:${songId}`;
    if (this.tried.has(key)) return;
    this.tried.add(key);
    const code = this.partyCode;
    this.set(songId, { state: 'getting', done: 0 });
    try {
      // Told in whole percent: a redraw per piece of the download would be hundreds.
      const blob = await online.getPartySong(songId, (done) => {
        const now = Math.floor(done * 100) / 100;
        const was = this.state[songId];
        if (was?.state !== 'getting' || was.done !== now) this.set(songId, { state: 'getting', done: now });
      });
      const file = new File([blob], `${title}.soundwave`);
      if (this.partyCode !== code) return;
      if (ctx.keep) await ctx.add(file);
      else {
        const pkg = await readSongPackage(file, file.name);
        if (pkg.meta.id !== songId) throw new Error(`"${title}" came back as a different song.`);
        lendSongAudio(songId, pkg.audio);
        analysisManager.lend(songId, pkg.analysis, pkg.edits);
        this.held = { ...this.held, [songId]: { meta: pkg.meta, file } };
      }
      this.set(songId, null);
    } catch (e) {
      this.set(songId, { state: 'failed', message: (e as Error).message });
    }
  }
}

export const partySongs = new PartySongSync();
