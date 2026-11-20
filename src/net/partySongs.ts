/**
 * A party's songs reach every player by themselves. A player can only play a song they have, so:
 * - the host's game sends a song of the set to the server as soon as a player in the party lacks it
 *   (unless the host turned that off, settings.shareSongs);
 * - once the server holds it (the set's `cached`), the game of every player without it downloads it
 *   and adds it to their library.
 *
 * App calls `update` whenever the party, the library or the settings change; the party screen shows
 * each song's transfer from `transfers`.
 */
import type { PartyState } from './protocol';
import { online } from './client';

/** A song of the set on its way: sent by the host's game, downloaded by a player's, or failed. */
export type Transfer = { state: 'sending' } | { state: 'getting'; done: number } | { state: 'failed'; message: string };

export interface SyncContext {
  party: PartyState | null;
  me: string | undefined;
  /** The server passes a party's songs on at all. */
  serverOn: boolean;
  /** This player lets their songs go to the party's players (as host). */
  share: boolean;
  has(songId: string): boolean;
  /** The song's .soundwave file, for sending. */
  file(songId: string): Promise<Blob>;
  /** Adds a downloaded song to the library. */
  add(file: File): Promise<void>;
}

class PartySongSync {
  private state: Record<string, Transfer> = {};
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

  private set(id: string, t: Transfer | null) {
    const next = { ...this.state };
    if (t) next[id] = t;
    else delete next[id];
    this.state = next;
    for (const l of this.listeners) l();
  }

  /** Tries a song that failed again. */
  retry(songId: string) {
    this.tried.delete(`send:${songId}`);
    this.tried.delete(`get:${songId}`);
    this.set(songId, null);
    if (this.last) this.update(this.last);
  }

  update(ctx: SyncContext) {
    this.last = ctx;
    const { party, me } = ctx;
    // A new party starts afresh: what was tried in the last one may work in this one.
    if ((party?.code ?? null) !== this.partyCode) {
      this.partyCode = party?.code ?? null;
      this.tried.clear();
      this.state = {};
      for (const l of this.listeners) l();
    }
    if (!party || !me || !ctx.serverOn) return;
    const host = party.host === me;
    for (const song of party.set) {
      if (ctx.has(song.id)) {
        // Downloaded meanwhile (or added by hand): nothing is on its way any more.
        if (this.state[song.id]?.state === 'getting') this.set(song.id, null);
        const lacking = party.members.some((m) => m.id !== me && m.connected && !m.have.includes(song.id));
        if (host && ctx.share && !song.cached && lacking) void this.send(ctx, song.id);
      } else if (song.cached) void this.get(ctx, song.id, song.title);
    }
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
    this.set(songId, { state: 'getting', done: 0 });
    try {
      // Told in whole percent: a redraw per piece of the download would be hundreds.
      const blob = await online.getPartySong(songId, (done) => {
        const now = Math.floor(done * 100) / 100;
        const was = this.state[songId];
        if (was?.state !== 'getting' || was.done !== now) this.set(songId, { state: 'getting', done: now });
      });
      await ctx.add(new File([blob], `${title}.soundwave`));
      this.set(songId, null);
    } catch (e) {
      this.set(songId, { state: 'failed', message: (e as Error).message });
    }
  }
}

export const partySongs = new PartySongSync();
