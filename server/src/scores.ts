/**
 * Leaderboards, shared runs, challenges and the weekly challenge (docs/specs/online-play.md, 3.3,
 * 3.3b and 4.4).
 *
 * A score is taken only with its run: the inputs, which the server plays into the game's own
 * judging (src/game/replay.ts) against the chart. The result must match what the game reported
 * exactly; there is no tolerance for a cheat to use. Judging is by time, not by frames, so an
 * honest run gives the same result here as it did in the game.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Chart } from '../../src/chart/types.ts';
import { replayResults } from '../../src/game/replay.ts';
import {
  chartKey,
  SONG_ID,
  type Board,
  type Challenge,
  type Difficulty,
  type Part,
  type RankLine,
  type Run,
  type ScoreSubmission,
  type SetSong,
  type SongScore,
  type Weekly,
  type WireChart,
} from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Store, UserRow } from './db.ts';
import { chart as checkChart } from './validate.ts';

/** The most operations one run may hold: hours of play at any rate. */
const OPS_MAX = 400_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

interface ScoreRow {
  id: string;
  user: string;
  song_id: string;
  chart_id: string;
  part: Part;
  difficulty: Difficulty;
  score: number;
  stars: number;
  accuracy: number;
  best_streak: number;
  full_combo: number;
  at: number;
  shared: number;
  title: string;
  artist: string;
  ops: Uint8Array;
  times: Uint8Array;
}

export const chartIdOf = (c: WireChart) => createHash('sha256').update(chartKey(c)).digest('hex');

const canModerate = (u: UserRow) => u.role === 'owner' || u.role === 'moderator';

export class Scores {
  private readonly store: Store;
  private readonly now: () => number;

  constructor(store: Store, now: () => number = Date.now) {
    this.store = store;
    this.now = now;
    store.db.exec(`
      CREATE TABLE IF NOT EXISTS charts (id TEXT PRIMARY KEY, json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scores (
        id TEXT PRIMARY KEY,
        user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        song_id TEXT NOT NULL,
        chart_id TEXT NOT NULL REFERENCES charts(id),
        part TEXT NOT NULL,
        difficulty TEXT NOT NULL,
        score INTEGER NOT NULL,
        stars INTEGER NOT NULL,
        accuracy REAL NOT NULL,
        best_streak INTEGER NOT NULL,
        full_combo INTEGER NOT NULL,
        at INTEGER NOT NULL,
        shared INTEGER NOT NULL DEFAULT 0,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        ops BLOB NOT NULL,
        times BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS scores_board ON scores (song_id, chart_id, part, difficulty, score DESC);
      CREATE INDEX IF NOT EXISTS scores_at ON scores (at);
      CREATE TABLE IF NOT EXISTS challenges (
        id TEXT PRIMARY KEY,
        from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        score_id TEXT NOT NULL REFERENCES scores(id) ON DELETE CASCADE,
        created INTEGER NOT NULL,
        answer_id TEXT REFERENCES scores(id) ON DELETE SET NULL
      );
      CREATE TABLE IF NOT EXISTS weekly (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        songs TEXT NOT NULL,
        start INTEGER NOT NULL,
        end INTEGER NOT NULL,
        by TEXT
      );
    `);
  }

  /** Takes a run, if judging it again gives exactly the result the game reported. */
  submit(user: UserRow, body: Partial<ScoreSubmission>): { id: string; rank: number; best: boolean } {
    const chart = checkChart(body.chart);
    if (!chart) throw new Refusal(400, 'That run’s chart is damaged.');
    if (typeof body.songId !== 'string' || !SONG_ID.test(body.songId)) throw new Refusal(400, 'That run’s song is not named.');
    if (typeof body.ops !== 'string' || typeof body.times !== 'string') throw new Refusal(400, 'That run has no inputs.');
    const ops = new Uint8Array(Buffer.from(body.ops, 'base64'));
    const timeBytes = Buffer.from(body.times, 'base64');
    if (ops.length > OPS_MAX || timeBytes.length !== ops.length * 4) throw new Refusal(400, 'That run’s inputs are damaged.');
    const times = new Float32Array(ops.length);
    for (let i = 0; i < ops.length; i++) times[i] = timeBytes.readFloatLE(i * 4);
    const claimed = body.result;
    const judged = replayResults(chart as Chart, { ops, times });
    const same =
      !!claimed &&
      judged.score === claimed.score &&
      judged.stars === claimed.stars &&
      judged.bestStreak === claimed.bestStreak &&
      judged.fullCombo === claimed.fullCombo &&
      Math.abs(judged.accuracy - claimed.accuracy) < 1e-9;
    if (!same) throw new Refusal(422, 'That score does not match its run, so it was not taken.');

    const chartId = chartIdOf(chart);
    this.store.db.prepare('INSERT OR IGNORE INTO charts (id, json) VALUES (?, ?)').run(chartId, JSON.stringify(chart));
    const before = this.bestOf(user.id, body.songId, chartId, chart.part, chart.difficulty);
    const id = randomUUID();
    this.store.db
      .prepare(
        `INSERT INTO scores (id, user, song_id, chart_id, part, difficulty, score, stars, accuracy, best_streak, full_combo, at, title, artist, ops, times)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.id,
        body.songId,
        chartId,
        chart.part,
        chart.difficulty,
        judged.score,
        judged.stars,
        judged.accuracy,
        judged.bestStreak,
        judged.fullCombo ? 1 : 0,
        this.now(),
        String(body.title ?? '').slice(0, 200),
        String(body.artist ?? '').slice(0, 200),
        ops,
        new Uint8Array(timeBytes),
      );
    if (typeof body.challenge === 'string') this.answer(user, body.challenge, id);
    const board = this.board(user, body.songId, chartId, chart.part, chart.difficulty, false);
    return { id, rank: board.me?.rank ?? 0, best: before === undefined || judged.score > before };
  }

  private bestOf(user: string, song: string, chart: string, part: string, difficulty: string): number | undefined {
    const row = this.store.db
      .prepare('SELECT MAX(score) AS s FROM scores WHERE user = ? AND song_id = ? AND chart_id = ? AND part = ? AND difficulty = ?')
      .get(user, song, chart, part, difficulty) as { s: number | null };
    return row.s ?? undefined;
  }

  /** Each player's best run on one chart, best first; this week's only, or of all time. */
  board(me: UserRow, song: string, chart: string, part: string, difficulty: string, week: boolean): Board {
    const since = week ? this.now() - WEEK_MS : 0;
    const rows = this.store.db
      .prepare(
        `SELECT s.*, u.name AS name FROM scores s JOIN users u ON u.id = s.user
         WHERE s.song_id = ? AND s.chart_id = ? AND s.part = ? AND s.difficulty = ? AND s.at >= ?
         ORDER BY s.score DESC, s.at ASC`,
      )
      .all(song, chart, part, difficulty, since) as unknown as (ScoreRow & { name: string })[];
    const seen = new Set<string>();
    const lines: (RankLine & { user: string })[] = [];
    for (const r of rows) {
      if (seen.has(r.user)) continue;
      seen.add(r.user);
      lines.push({ ...this.line(r, lines.length + 1), user: r.user });
    }
    const mine = lines.find((l) => l.user === me.id);
    const strip = ({ user: _user, ...l }: RankLine & { user: string }): RankLine => l;
    return { lines: lines.slice(0, 50).map(strip), me: mine ? strip(mine) : null };
  }

  private line(r: ScoreRow & { name: string }, rank: number): RankLine {
    return {
      rank,
      scoreId: r.id,
      name: r.name,
      score: r.score,
      stars: r.stars,
      accuracy: r.accuracy,
      fullCombo: !!r.full_combo,
      at: r.at,
      shared: !!r.shared,
    };
  }

  /** The boards a song has on this server (one per chart, part and difficulty). */
  boardsOf(song: string) {
    return this.store.db
      .prepare(
        `SELECT chart_id AS chartId, part, difficulty, COUNT(DISTINCT user) AS players, MAX(score) AS top
         FROM scores WHERE song_id = ? GROUP BY chart_id, part, difficulty ORDER BY players DESC`,
      )
      .all(song);
  }

  /** The players with the most points this week, over every board: for the main menu. */
  topThisWeek(limit = 5) {
    return this.store.db
      .prepare(
        `SELECT u.name AS name, SUM(best) AS score FROM (
           SELECT user, MAX(score) AS best FROM scores WHERE at >= ? GROUP BY user, song_id, chart_id, part, difficulty
         ) b JOIN users u ON u.id = b.user GROUP BY b.user ORDER BY score DESC LIMIT ?`,
      )
      .all(this.now() - WEEK_MS, limit) as { name: string; score: number }[];
  }

  /** A run to watch, or to play against: anyone's on a board can be watched. */
  run(id: string): Run {
    const r = this.store.db.prepare('SELECT s.*, u.name AS name FROM scores s JOIN users u ON u.id = s.user WHERE s.id = ?').get(id) as
      (ScoreRow & { name: string }) | undefined;
    if (!r) throw new Refusal(404, 'That run is no longer on the server.');
    const chart = JSON.parse((this.store.db.prepare('SELECT json FROM charts WHERE id = ?').get(r.chart_id) as { json: string }).json);
    return {
      scoreId: r.id,
      name: r.name,
      songId: r.song_id,
      title: r.title,
      artist: r.artist,
      chart,
      ops: Buffer.from(r.ops).toString('base64'),
      times: Buffer.from(r.times).toString('base64'),
      result: this.result(r),
      at: r.at,
    };
  }

  private result(r: ScoreRow): SongScore {
    return { score: r.score, stars: r.stars, accuracy: r.accuracy, bestStreak: r.best_streak, fullCombo: !!r.full_combo };
  }

  /** A player shares one of their runs to the server's list of replays (or takes it back). */
  share(user: UserRow, id: string, shared: boolean) {
    const r = this.store.db.prepare('SELECT user FROM scores WHERE id = ?').get(id) as { user: string } | undefined;
    if (!r || r.user !== user.id) throw new Refusal(404, 'That run is not one of yours.');
    this.store.db.prepare('UPDATE scores SET shared = ? WHERE id = ?').run(shared ? 1 : 0, id);
  }

  /** The runs players shared, newest first; of one song, or of every song. */
  shared(song?: string) {
    const rows = this.store.db
      .prepare(
        `SELECT s.*, u.name AS name FROM scores s JOIN users u ON u.id = s.user
         WHERE s.shared = 1 ${song ? 'AND s.song_id = ?' : ''} ORDER BY s.at DESC LIMIT 100`,
      )
      .all(...(song ? [song] : [])) as unknown as (ScoreRow & { name: string })[];
    return rows.map((r, i) => ({
      ...this.line(r, i + 1),
      songId: r.song_id,
      title: r.title,
      artist: r.artist,
      part: r.part,
      difficulty: r.difficulty,
    }));
  }

  /** A moderator removes a cheated run everywhere at once. */
  remove(actor: UserRow, id: string, reason: unknown) {
    if (!canModerate(actor)) throw new Refusal(403, 'Only the owner and moderators can remove scores.');
    const r = this.store.db.prepare('SELECT user FROM scores WHERE id = ?').get(id) as { user: string } | undefined;
    if (!r) throw new Refusal(404, 'That run is no longer on the server.');
    this.store.db.prepare('DELETE FROM scores WHERE id = ?').run(id);
    this.store.log({
      at: this.now(),
      actor: actor.id,
      action: 'remove score',
      target: r.user,
      reason: typeof reason === 'string' ? reason.slice(0, 500) : '',
    });
  }

  /* Challenges --------------------------------------------------------------------------------- */

  /** Beat my run: one of the player's runs, sent to another player to play against. */
  challenge(from: UserRow, to: unknown, scoreId: unknown): { id: string } {
    const target = typeof to === 'string' ? this.store.userByName(to.trim()) : undefined;
    if (!target) throw new Refusal(404, 'There is no player with that name on this server.');
    if (target.id === from.id) throw new Refusal(409, 'Challenge someone else: that is you.');
    const r =
      typeof scoreId === 'string'
        ? (this.store.db.prepare('SELECT user FROM scores WHERE id = ?').get(scoreId) as { user: string } | undefined)
        : undefined;
    if (!r || r.user !== from.id) throw new Refusal(404, 'Only your own runs can be sent as a challenge.');
    const id = randomUUID();
    this.store.db
      .prepare('INSERT INTO challenges (id, from_user, to_user, score_id, created) VALUES (?, ?, ?, ?, ?)')
      .run(id, from.id, target.id, scoreId as string, this.now());
    return { id };
  }

  private answer(user: UserRow, challenge: string, scoreId: string) {
    this.store.db
      .prepare('UPDATE challenges SET answer_id = ? WHERE id = ? AND to_user = ? AND answer_id IS NULL')
      .run(scoreId, challenge, user.id);
  }

  /** The challenges a player was sent, and the ones they sent, with how they went. */
  challenges(user: UserRow): { received: Challenge[]; sent: Challenge[] } {
    const q = (where: string) =>
      (
        this.store.db
          .prepare(
            `SELECT c.id, f.name AS "from", t.name AS "to", c.score_id AS scoreId, s.song_id AS songId, s.title, s.artist, s.part,
                    s.difficulty, s.score, c.created, a.score AS answer
             FROM challenges c JOIN users f ON f.id = c.from_user JOIN users t ON t.id = c.to_user
             JOIN scores s ON s.id = c.score_id LEFT JOIN scores a ON a.id = c.answer_id
             WHERE ${where} = ? ORDER BY c.created DESC LIMIT 50`,
          )
          .all(user.id) as unknown as Challenge[]
      ).map((c) => ({ ...c, answer: c.answer ?? null }));
    return { received: q('c.to_user'), sent: q('c.from_user') };
  }

  /* The weekly challenge ------------------------------------------------------------------------ */

  /** The owner or a moderator sets the challenge: songs, and how many days it runs from now. */
  setWeekly(actor: UserRow, songs: unknown, days: unknown) {
    if (!canModerate(actor)) throw new Refusal(403, 'Only the owner and moderators set the weekly challenge.');
    if (!Array.isArray(songs) || !songs.length || songs.length > 10) throw new Refusal(400, 'A weekly challenge has 1 to 10 songs.');
    const list: SetSong[] = songs.map((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      if (typeof o.id !== 'string' || !SONG_ID.test(o.id)) throw new Refusal(400, 'A song of the challenge is not named.');
      return {
        id: o.id,
        title: String(o.title ?? '').slice(0, 200),
        artist: String(o.artist ?? '').slice(0, 200),
        duration: Number(o.duration) || 0,
      };
    });
    const d = typeof days === 'number' && days > 0 ? Math.min(days, 60) : 7;
    const start = this.now();
    this.store.db
      .prepare('INSERT INTO weekly (songs, start, end, by) VALUES (?, ?, ?, ?)')
      .run(JSON.stringify(list), start, start + d * 86_400_000, actor.id);
    this.store.log({
      at: start,
      actor: actor.id,
      action: 'weekly challenge',
      target: actor.id,
      reason: list.map((s) => s.title).join(', '),
    });
  }

  /** The challenge running now (or the last one), with its standings: each player's best per song, added up. */
  weekly(): Weekly | null {
    const w = this.store.db.prepare('SELECT * FROM weekly ORDER BY id DESC LIMIT 1').get() as
      { songs: string; start: number; end: number } | undefined;
    if (!w) return null;
    const songs = JSON.parse(w.songs) as SetSong[];
    const marks = songs.map(() => '?').join(',');
    const standings = this.store.db
      .prepare(
        `SELECT u.name AS name, SUM(best) AS score, COUNT(*) AS songs FROM (
           SELECT user, song_id, MAX(score) AS best FROM scores WHERE at >= ? AND at < ? AND song_id IN (${marks}) GROUP BY user, song_id
         ) b JOIN users u ON u.id = b.user GROUP BY b.user ORDER BY score DESC LIMIT 50`,
      )
      .all(w.start, w.end, ...songs.map((s) => s.id)) as Weekly['standings'];
    return { songs, start: w.start, end: w.end, standings };
  }

  /** What a player's data export carries of their runs. */
  exportOf(user: UserRow) {
    const rows = this.store.db.prepare('SELECT * FROM scores WHERE user = ? ORDER BY at').all(user.id) as unknown as ScoreRow[];
    return rows.map((r) => ({
      id: r.id,
      song: { id: r.song_id, title: r.title, artist: r.artist },
      chartId: r.chart_id,
      part: r.part,
      difficulty: r.difficulty,
      ...this.result(r),
      at: new Date(r.at).toISOString(),
      shared: !!r.shared,
      inputs: { ops: Buffer.from(r.ops).toString('base64'), times: Buffer.from(r.times).toString('base64') },
    }));
  }
}
