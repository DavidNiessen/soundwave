/**
 * A party's songs, passed on through the server. A player who lacks one of the set's songs cannot
 * play it, so the host's game sends it here and every player without it downloads it by itself.
 *
 * Unlike the shared library (songs.ts) this is no catalogue: a song can only be sent or fetched by a
 * player whose party has it in its set (app.ts checks that), nothing lists it, and it is a cache.
 * Each file is kept for `partyCacheDays` after it was last sent or fetched, and the least recently
 * used go first once the cache passes `partyCacheMb`.
 *
 * Files live in the data folder as party-songs/<id>.soundwave, where <id> is the hash of the audio
 * inside: checked here, so nobody can put a song under another song's id.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Refusal } from './accounts.ts';
import type { Config } from './config.ts';
import { songIdOf } from './soundwave.ts';

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

export class PartySongs {
  private readonly dir: string;
  private readonly config: Config;
  private readonly now: () => number;

  constructor(config: Config, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
    // A server whose database is in memory (the tests) keeps its files in a temporary folder.
    const base = config.dataDir === ':memory:' ? mkdtempSync(join(tmpdir(), 'soundwave-')) : config.dataDir;
    this.dir = join(base, 'party-songs');
    mkdirSync(this.dir, { recursive: true });
    this.prune();
  }

  get on() {
    return this.config.partySongs;
  }

  private path(id: string) {
    return join(this.dir, `${id}.soundwave`);
  }

  has(id: string): boolean {
    return this.on && existsSync(this.path(id));
  }

  /** Takes a song file for a party, after checking that its audio is the song `id`. */
  async put(id: string, body: Buffer): Promise<void> {
    if (!this.on) throw new Refusal(403, 'This server does not pass songs on to parties. Its owner can turn that on.');
    if (body.length > this.config.songMaxMb * MB) throw new Refusal(413, `A song can be at most ${this.config.songMaxMb} MB here.`);
    if (this.has(id)) return this.touch(id);
    // Only the audio's hash is checked: the analysis inside is not inflated here, and the games
    // that download the file read it with the format's own limits.
    if ((await songIdOf(body)) !== id) throw new Refusal(400, 'That file holds a different song.');
    writeFileSync(this.path(id), body);
    this.prune();
  }

  /** A song's file, for a player in a party with it in the set. */
  get(id: string): Buffer {
    if (!this.has(id)) throw new Refusal(404, 'The server does not have that song (any more). The host’s game sends it again.');
    this.touch(id);
    return readFileSync(this.path(id));
  }

  /** Marks a song as used now, so it is kept longer than the ones nobody played lately. */
  private touch(id: string) {
    const t = new Date(this.now());
    try {
      utimesSync(this.path(id), t, t);
    } catch {
      /* gone meanwhile: the next request sends it again */
    }
  }

  /** Drops songs nobody used for a while, then the least recently used while the cache is too big. */
  prune() {
    const now = this.now();
    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith('.soundwave'))
      .map((f) => {
        const st = statSync(join(this.dir, f));
        return { path: join(this.dir, f), used: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => b.used - a.used);
    let total = 0;
    for (const f of files) {
      total += f.size;
      if (now - f.used > this.config.partyCacheDays * DAY || total > this.config.partyCacheMb * MB) rmSync(f.path, { force: true });
    }
  }
}
