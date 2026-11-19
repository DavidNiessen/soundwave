/**
 * Band boards (docs/specs/online-play.md, 4.5): a band's score on a song, one board per line-up (the
 * set of charts its players played). A band's run is taken only when every player's run, judged
 * again here, gives exactly the score their game reported, as for any leaderboard.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Chart } from '../../src/chart/types.ts';
import { replayResults } from '../../src/game/replay.ts';
import type { BandBoard, BandLine, Difficulty, Part, SongScore, WireChart } from '../../src/net/protocol.ts';
import type { Store } from './db.ts';
import { chartIdOf } from './scores.ts';

/** What a party hands over when a band finishes a song. */
export interface BandRun {
  songId: string;
  players: { id: string; chart: WireChart; result: SongScore; run: { ops: string; times: string } | undefined }[];
  score: number;
  stars: number;
}

/** How many runs each line-up's board shows. */
const BOARD_LINES = 10;
/** The most operations one run may hold (as for leaderboards). */
const OPS_MAX = 400_000;

/** A run's score judged again from its inputs, or undefined when the inputs are damaged. */
function judged(chart: WireChart, run: { ops: string; times: string }): number | undefined {
  const ops = new Uint8Array(Buffer.from(run.ops, 'base64'));
  const bytes = Buffer.from(run.times, 'base64');
  if (ops.length > OPS_MAX || bytes.length !== ops.length * 4) return undefined;
  const times = new Float32Array(ops.length);
  for (let i = 0; i < ops.length; i++) times[i] = bytes.readFloatLE(i * 4);
  return replayResults(chart as Chart, { ops, times }).score;
}

export class Bands {
  private readonly store: Store;
  private readonly now: () => number;

  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS bands (
        id TEXT PRIMARY KEY,
        song_id TEXT NOT NULL,
        lineup TEXT NOT NULL,
        score INTEGER NOT NULL,
        stars INTEGER NOT NULL,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS bands_song ON bands (song_id, lineup, score DESC);
      CREATE TABLE IF NOT EXISTS band_players (
        band TEXT NOT NULL REFERENCES bands(id) ON DELETE CASCADE,
        user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        part TEXT NOT NULL,
        difficulty TEXT NOT NULL
      );
    `);
  }

  /** Takes a band's run if every player's run checks out; says whether it did. */
  record(run: BandRun): boolean {
    if (run.players.length < 2) return false;
    for (const p of run.players) if (!p.run || judged(p.chart, p.run) !== p.result.score) return false;
    // The line-up: the set of charts played, whoever played them.
    const lineup = createHash('sha256')
      .update(
        run.players
          .map((p) => chartIdOf(p.chart))
          .sort()
          .join(','),
      )
      .digest('hex');
    const id = randomUUID();
    this.store.db
      .prepare('INSERT INTO bands (id, song_id, lineup, score, stars, at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, run.songId, lineup, run.score, run.stars, this.now());
    const add = this.store.db.prepare('INSERT INTO band_players (band, user, part, difficulty) VALUES (?, ?, ?, ?)');
    for (const p of run.players) add.run(id, p.id, p.chart.part, p.chart.difficulty);
    return true;
  }

  /** A song's band boards: each line-up's best runs. */
  board(songId: string): BandBoard {
    const rows = this.store.db
      .prepare(
        `SELECT b.id, b.lineup, b.score, b.stars, b.at, u.name, p.part, p.difficulty
         FROM bands b JOIN band_players p ON p.band = b.id JOIN users u ON u.id = p.user
         WHERE b.song_id = ? ORDER BY b.lineup, b.score DESC, b.at`,
      )
      .all(songId) as unknown as {
      id: string;
      lineup: string;
      score: number;
      stars: number;
      at: number;
      name: string;
      part: Part;
      difficulty: Difficulty;
    }[];
    const lineups = new Map<string, Map<string, BandLine>>();
    for (const r of rows) {
      const runs = lineups.get(r.lineup) ?? new Map<string, BandLine>();
      lineups.set(r.lineup, runs);
      const line = runs.get(r.id) ?? { players: [], score: r.score, stars: r.stars, at: r.at };
      runs.set(r.id, line);
      line.players.push({ name: r.name, part: r.part, difficulty: r.difficulty });
    }
    return {
      lineups: [...lineups.entries()].map(([key, runs]) => {
        const lines = [...runs.values()].sort((a, b) => b.score - a.score).slice(0, BOARD_LINES);
        return { key, parts: lines[0].players.map(({ part, difficulty }) => ({ part, difficulty })), lines };
      }),
    };
  }

  /** What a player's data export carries of their bands. */
  exportOf(user: string) {
    return this.store.db
      .prepare(
        `SELECT b.song_id AS song, b.score, b.stars, b.at, p.part, p.difficulty
         FROM bands b JOIN band_players p ON p.band = b.id WHERE p.user = ? ORDER BY b.at`,
      )
      .all(user);
  }
}
