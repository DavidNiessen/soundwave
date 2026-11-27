/**
 * How much each player, and each address, may ask of the server: rate limits, and a line for
 * uploads, so a burst of big requests cannot fill its memory.
 */
import type { ServerResponse } from 'node:http';
import { Refusal } from './accounts.ts';

/** A bucket of attempts per key (an address, a player): `burst` at once, refilled at `perMinute`. */
export class RateLimit {
  private readonly buckets = new Map<string, { tokens: number; at: number }>();
  private readonly burst: number;
  private readonly perMinute: number;
  constructor(burst: number, perMinute: number) {
    this.burst = burst;
    this.perMinute = perMinute;
  }
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.burst, at: now };
    b.tokens = Math.min(this.burst, b.tokens + ((now - b.at) / 60_000) * this.perMinute);
    b.at = now;
    this.buckets.set(key, b);
    if (this.buckets.size > 10_000) this.buckets.clear();
    if (b.tokens < 1) return false;
    b.tokens--;
    return true;
  }
}

/**
 * Uploads (shared songs, their copies, a party's songs) are read into memory whole, so only a few
 * are read at once: `all` on the server and `each` per player. The others wait in line with their
 * bodies unread, which holds nothing but their connection; a player may have `waiting` in line (a
 * host's game sends every song of a set the others lack at once).
 */
export class Uploads {
  private active = 0;
  private readonly mine = new Map<string, number>();
  private readonly waits = new Map<string, number>();
  private readonly line: { user: string; go: () => void }[] = [];
  private readonly all: number;
  private readonly each: number;
  private readonly waiting: number;

  constructor(all: number, each: number, waiting: number) {
    this.all = all;
    this.each = each;
    this.waiting = waiting;
  }

  private free(user: string) {
    return this.active < this.all && (this.mine.get(user) ?? 0) < this.each;
  }

  private take(user: string) {
    this.active++;
    this.mine.set(user, (this.mine.get(user) ?? 0) + 1);
  }

  /**
   * Waits for a turn; gives what ends it. `res` closing first (the player gave up) leaves the line.
   */
  async enter(user: string, res: ServerResponse): Promise<() => void> {
    if (this.free(user)) this.take(user);
    else {
      const waits = this.waits.get(user) ?? 0;
      if (waits >= this.waiting) throw new Refusal(429, 'Too many songs at once. Wait a minute.');
      this.waits.set(user, waits + 1);
      try {
        await new Promise<void>((go, gaveUp) => {
          const entry = { user, go };
          this.line.push(entry);
          res.once('close', () => {
            const i = this.line.indexOf(entry);
            if (i < 0) return;
            this.line.splice(i, 1);
            gaveUp(new Refusal(499, 'The upload was cancelled.'));
          });
        });
      } finally {
        const left = (this.waits.get(user) ?? 1) - 1;
        if (left) this.waits.set(user, left);
        else this.waits.delete(user);
      }
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.active--;
      const left = (this.mine.get(user) ?? 1) - 1;
      if (left) this.mine.set(user, left);
      else this.mine.delete(user);
      this.next();
    };
  }

  /** Lets in whoever in line can go now, in the order they came. */
  private next() {
    for (let i = 0; i < this.line.length; i++) {
      const entry = this.line[i];
      if (!this.free(entry.user)) continue;
      this.line.splice(i--, 1);
      this.take(entry.user);
      entry.go();
    }
  }
}
