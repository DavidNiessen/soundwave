/**
 * Leaderboards and shared runs (docs/specs/online-play.md, 3.3 and 4.4).
 *
 * A score is taken only with its run: the inputs, which the server plays into the game's own
 * judging (src/game/replay.ts) against the chart. The result must match what the game reported
 * exactly; there is no tolerance for a cheat to use. Judging is by time, not by frames, so an
 * honest run gives the same result here as it did in the game.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Chart } from '../../src/chart/types.ts';
import { GameSession } from '../../src/game/GameSession.ts';
import { OP, replayResults } from '../../src/game/replay.ts';
import {
  chartKey,
  SONG_ID,
  type Board,
  type Difficulty,
  type Part,
  type RankLine,
  type Run,
  type ScoreSubmission,
  type SongScore,
  type WireChart,
} from '../../src/net/protocol.ts';
import { Refusal } from './accounts.ts';
import type { Store, UserRow } from './db.ts';
import { chart as checkChart } from './validate.ts';

/** The most operations one run may hold: hours of play at any rate. */
const OPS_MAX = 400_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

/*
 * A run comes with its own chart, which the server cannot check against the song (it does not
 * have it), so a chart is held to what a real one can be: anything past these is made up.
 */
/** The longest song, seconds. */
const SONG_MAX_S = 2 * 60 * 60;
/** One beat from 400 BPM to 20. */
const BEAT_MIN_S = 0.15;
const BEAT_MAX_S = 3;
/** The longest hold, seconds. */
const HOLD_MAX_S = 120;
/**
 * Notes and points per second of song, on average over the whole song. The game's own charts stay
 * under about 15 notes and 4,500 points a second; the track editor lets a player write far denser
 * ones (three-note chords in sixteenths at 180 BPM is 36 notes and 10,500 points a second), which
 * are still honest: the bounds leave room for those and stop only what no song can have.
 */
const NOTES_PER_S = 80;
const PAR_PER_S = 30_000;
/** How far past the song's end a note may stand: notes are snapped to the beat, and the last can land just after it. */
const NOTE_AFTER_S = 2;
/** How far before the song a run starts (the countdown, PlayController's LEAD_IN) and how long after it may go on. */
const LEAD_IN_S = 3;
const AFTER_S = 30;
/** How far back a resumed pause winds the song (PlayController.resume). */
const REWIND_S = 1.5;
/**
 * How far one input may be stamped before the one recorded ahead of it: inputs are stamped with
 * the moment they happened, and on a busy machine can be handled well after an overdrive stamped
 * now. An input judged a little in the past earns nothing it would not have earned on time.
 */
const BACK_SLACK_S = 3;
/** Float rounding between two song times the game took for the same moment. */
const EPS = 0.05;
/** The runs kept per player on each board: their best (and any they shared). */
const RUNS_KEPT = 5;

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

/** What a board's line needs of a run: not its inputs, which are most of its size. */
const LINE_COLUMNS = 's.id, s.user, s.score, s.stars, s.accuracy, s.full_combo, s.at, s.shared, u.name AS name';
type LineRow = Pick<ScoreRow, 'id' | 'user' | 'score' | 'stars' | 'accuracy' | 'full_combo' | 'at' | 'shared'> & { name: string };

/** Whether a chart is one a song can have (see the bounds above). */
function realistic(c: WireChart): boolean {
  if (c.duration > SONG_MAX_S || c.secondsPerBeat < BEAT_MIN_S || c.secondsPerBeat > BEAT_MAX_S) return false;
  if (c.notes.length > NOTES_PER_S * c.duration + 100) return false;
  for (const n of c.notes)
    if (n.t < 0 || n.t > c.duration + NOTE_AFTER_S || n.dur > HOLD_MAX_S || n.t + n.dur > c.duration + AFTER_S) return false;
  return new GameSession(c as Chart).par <= PAR_PER_S * c.duration;
}

/**
 * Whether a run's inputs are ones the game records: every time a real one, in order, but for a
 * resumed pause, which drops the holds and winds the song back up to REWIND_S; and no frames
 * (finite updates), which only runs from before judging by time held, and which wind back too.
 * The one update is the song's end, at +Infinity, last.
 */
function playable(c: WireChart, ops: Uint8Array, times: Float32Array): boolean {
  let clock = -Infinity;
  for (let i = 0; i < ops.length; i++) {
    const kind = ops[i] & 7;
    const t = times[i];
    if (kind === OP.update) {
      if (t !== Infinity || i !== ops.length - 1) return false;
      continue;
    }
    if (!Number.isFinite(t) || t < -LEAD_IN_S - BACK_SLACK_S || t > c.duration + AFTER_S) return false;
    if ((kind === OP.press || kind === OP.release) && ops[i] >> 3 >= c.lanes) return false;
    if (kind === OP.rewind) {
      const from = i > 0 && (ops[i - 1] & 7) === OP.dropHolds ? times[i - 1] : NaN;
      // A pause in the countdown's first moments winds back to its start, which can be a little
      // later than the moment heard then (the output's latency and the player's offset come off).
      if (!(t <= Math.max(from, -LEAD_IN_S) + EPS && t >= from - REWIND_S - EPS)) return false;
      clock = t;
      continue;
    }
    if (t < clock - BACK_SLACK_S) return false;
    clock = Math.max(clock, t);
  }
  return true;
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
    `);
  }

  /** Takes a run, if judging it again gives exactly the result the game reported. */
  submit(user: UserRow, body: Partial<ScoreSubmission>): { id: string; rank: number; best: boolean } {
    const chart = checkChart(body.chart);
    if (!chart) throw new Refusal(400, 'That run’s chart is damaged.');
    if (!realistic(chart)) throw new Refusal(422, 'That run’s chart is not one a song can have, so it was not taken.');
    if (typeof body.songId !== 'string' || !SONG_ID.test(body.songId)) throw new Refusal(400, 'That run’s song is not named.');
    if (typeof body.ops !== 'string' || typeof body.times !== 'string') throw new Refusal(400, 'That run has no inputs.');
    const ops = new Uint8Array(Buffer.from(body.ops, 'base64'));
    const timeBytes = Buffer.from(body.times, 'base64');
    if (ops.length > OPS_MAX || timeBytes.length !== ops.length * 4) throw new Refusal(400, 'That run’s inputs are damaged.');
    const times = new Float32Array(ops.length);
    for (let i = 0; i < ops.length; i++) times[i] = timeBytes.readFloatLE(i * 4);
    if (!playable(chart, ops, times)) throw new Refusal(422, 'That run’s inputs are not ones a game records, so it was not taken.');
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
    // Only a player's best few runs on a board are kept (those they shared too, this one, which
    // they may share next, and their best of the week, for the week's board and top): the others
    // can never show, and would only fill the database.
    const ofBoard = 'user = ? AND song_id = ? AND chart_id = ? AND part = ? AND difficulty = ?';
    const key = [user.id, body.songId, chartId, chart.part, chart.difficulty];
    this.store.db
      .prepare(
        `DELETE FROM scores WHERE ${ofBoard} AND shared = 0 AND id != ?
         AND id NOT IN (SELECT id FROM scores WHERE ${ofBoard} ORDER BY score DESC, at ASC LIMIT ?)
         AND id NOT IN (SELECT id FROM scores WHERE ${ofBoard} AND at >= ? ORDER BY score DESC, at ASC LIMIT 1)`,
      )
      .run(...key, id, ...key, RUNS_KEPT, ...key, this.now() - WEEK_MS);
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
    // Each player's best run (the earliest of equal ones), worked out by the database: a board
    // can hold many runs, and the inputs they carry are never read here.
    const best = `SELECT * FROM (
        SELECT ${LINE_COLUMNS}, ROW_NUMBER() OVER (PARTITION BY s.user ORDER BY s.score DESC, s.at ASC) AS n
        FROM scores s JOIN users u ON u.id = s.user
        WHERE s.song_id = ? AND s.chart_id = ? AND s.part = ? AND s.difficulty = ? AND s.at >= ?
      ) WHERE n = 1`;
    const args = [song, chart, part, difficulty, since];
    const rows = this.store.db.prepare(`${best} ORDER BY score DESC, at ASC LIMIT 50`).all(...args) as unknown as LineRow[];
    const lines = rows.map((r, i) => this.line(r, i + 1));
    const mine = this.store.db.prepare(`${best} AND user = ?`).get(...args, me.id) as LineRow | undefined;
    let mineLine: RankLine | null = null;
    if (mine) {
      const above = this.store.db
        .prepare(`SELECT COUNT(*) AS n FROM (${best}) WHERE score > ? OR (score = ? AND at < ?)`)
        .get(...args, mine.score, mine.score, mine.at) as { n: number };
      mineLine = this.line(mine, above.n + 1);
    }
    return { lines, me: mineLine };
  }

  private line(r: LineRow, rank: number): RankLine {
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

  /**
   * The players with the most points this week, over every board: for the main menu. A chart comes
   * from the player's own game, and one made up and played by a program would top any list, so a
   * board counts only once two players or more have runs on that very chart: a chart one player
   * made up alone counts for nothing here (it still has its own board).
   */
  topThisWeek(limit = 5) {
    return this.store.db
      .prepare(
        `SELECT u.name AS name, SUM(best) AS score FROM (
           SELECT user, MAX(score) AS best FROM scores
           WHERE at >= ? AND chart_id IN (SELECT chart_id FROM scores GROUP BY chart_id HAVING COUNT(DISTINCT user) >= 2)
           GROUP BY user, song_id, chart_id, part, difficulty
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
        `SELECT ${LINE_COLUMNS}, s.song_id, s.title, s.artist, s.part, s.difficulty FROM scores s JOIN users u ON u.id = s.user
         WHERE s.shared = 1 ${song ? 'AND s.song_id = ?' : ''} ORDER BY s.at DESC LIMIT 100`,
      )
      .all(...(song ? [song] : [])) as unknown as (LineRow & Pick<ScoreRow, 'song_id' | 'title' | 'artist' | 'part' | 'difficulty'>)[];
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
