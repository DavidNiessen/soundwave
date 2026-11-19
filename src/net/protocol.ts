/**
 * What the game and a Soundwave server say to each other (docs/specs/online-play.md, section 6).
 * Shared by both: the server (server/) imports this file as it is, so it holds only types and
 * plain constants, nothing that needs the game's code or a bundler.
 *
 * Over HTTP, the server answers JSON (accounts, invites, moderation). Over one WebSocket per
 * player, the messages below, each a JSON object with a `type`.
 */

/** Raised whenever a message changes in a way an older game or server would misread. */
export const PROTOCOL_VERSION = 2;
/** The most players in one party. */
export const PARTY_MAX = 16;
/** How long a dropped player keeps their place in a party, ms. */
export const RECONNECT_GRACE_MS = 30_000;
/** How far ahead of now a song is started, so every player has it loaded and scheduled, ms. */
export const START_LEAD_MS = 5_000;
/** How often a player sends their score during a song, and the server the board, ms. */
export const BOARD_INTERVAL_MS = 100;
/** The longest a message may be, in bytes (a set's charts are the biggest). */
export const MESSAGE_MAX = 4 * 1024 * 1024;
/** Song ids are SHA-256 hashes of the audio, as hex. */
export const SONG_ID = /^[0-9a-f]{64}$/;

/* Showdown (docs/specs/online-play.md, 4.1). Starting values, to tune in play. */
/** The least charge a Strike takes (a quarter meter), and the hit it gives, ms; a full meter gives the longest. */
export const STRIKE_MIN_CHARGE = 0.25;
export const HIT_MIN_MS = 3_000;
export const HIT_MAX_MS = 8_000;
/** How long before a hit lands its target is warned, with the attacker's name, ms. */
export const HIT_WARNING_MS = 500;
/** After a hit ends, its target cannot be hit for this long, ms. */
export const HIT_PROTECTION_MS = 6_000;
/** A second hit on the same player within this long of the first lasts half as long, ms. */
export const HIT_REPEAT_MS = 30_000;
/** The most players who can have one player as their next target. */
export const MAX_ATTACKERS = 2;
/** Drain: the multiplier a hit caps the score's multiplier at. */
export const DRAIN_CAP = 2;
/** The fewest players in the last song of a Showdown: a final of four. */
export const SHOWDOWN_FINAL = 4;

export type Part = 'vocals' | 'lead' | 'bass' | 'drums';
export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
export type Role = 'owner' | 'moderator' | 'player';
/** Who may make an account on a server. */
export type JoinMode = 'public' | 'password' | 'invite';

/* HTTP ------------------------------------------------------------------------------------- */

/** `GET /info`: what a server is, for the server list and before signing in. */
export interface ServerInfo {
  name: string;
  description: string;
  protocol: number;
  mode: JoinMode;
  online: number;
  /** Whether players can share songs: not at all, everything but the audio, or whole songs. */
  sharing: SongSharing;
  /** Song covers are served to anyone (for the Discord status), not only to players signed in. */
  publicCovers: boolean;
}

export type SongSharing = 'off' | 'charts' | 'songs';

/** `GET /presence`: who is online, and what they are doing. */
export interface Online {
  name: string;
  activity: string;
}

/** A song in a server's library. */
export interface SharedSong {
  id: string;
  title: string;
  artist: string;
  duration: number;
  /** Bytes the server keeps of it (0 without the audio). */
  size: number;
  /** The whole song can be downloaded; without it, only its charts, for a player with the same audio. */
  audio: boolean;
  cover: boolean;
  /** Who shared it (null once their account is gone). */
  by: string | null;
  created: number;
}

export interface Account {
  id: string;
  name: string;
  role: Role;
}

/** What signing up or in, or refreshing, gives back. */
export interface Session {
  user: Account;
  /** Short-lived: sent with every request and in `hello`. */
  access: string;
  /** Long-lived and single-use: trades for a new pair when `access` runs out. */
  refresh: string;
}

/** `POST /auth/signup`. Which of the extra fields are needed depends on the server's mode. */
export interface SignUp {
  name: string;
  password: string;
  /** The server's password (mode `password`). */
  serverPassword?: string;
  /** An invite's code (it lets its holder in, whatever the mode), or the owner's set-up code. */
  invite?: string;
}

/** `POST /invites`: an invite, and the link it travels as (the server's join page). */
export interface Invite {
  code: string;
  link: string;
  /** Uses left; null for no limit. */
  uses: number | null;
  /** When it runs out (ms), or null: never. */
  expires: number | null;
}

/** A failed request's body. */
export interface ApiError {
  error: string;
}

/* The party's state ------------------------------------------------------------------------ */

/** A song in a party's set. Players match it to their own library by its id. */
export interface SetSong {
  id: string;
  title: string;
  artist: string;
  duration: number;
}

/** A party's Showdown, chosen by the host in the lobby; a party without one plays for scores alone. */
export interface ShowdownOptions {
  /** Strikes and hits; off for a pure race of shares. */
  hits: boolean;
  /** Everyone plays this part, or any part when null. */
  part: Part | null;
  /** The set is the server's Showdown rotation instead of the host's own. */
  rotation: boolean;
}

export interface Member {
  id: string;
  name: string;
  part: Part;
  difficulty: Difficulty;
  ready: boolean;
  /** The set's songs this player has (by id): the others they sit out. */
  have: string[];
  /** False while the player's connection is gone (they have RECONNECT_GRACE_MS to come back). */
  connected: boolean;
  /** Their audio offset was calibrated on the output they play through (a hint: scores are compared). */
  calibrated: boolean;
  /** Showdown: knocked out of this set; they watch the rest. */
  eliminated?: boolean;
}

/** How one player's song went: the score of record, judged again from their inputs. */
export interface SongScore {
  score: number;
  stars: number;
  accuracy: number;
  bestStreak: number;
  fullCombo: boolean;
}

/** One player's line in a song's results. */
export interface ResultLine {
  id: string;
  name: string;
  /** Null: they sat the song out, left it, or never finished. */
  result: SongScore | null;
  /** Why there is no result. */
  missing?: 'sat-out' | 'left';
  /** Showdown: the share of their chart's par they scored (0..1, past 1 with overdrive). */
  share?: number;
  /** Showdown: knocked out by this song. */
  eliminated?: boolean;
}

export interface SongResults {
  songIndex: number;
  lines: ResultLine[];
}

export type PartyPhase = 'lobby' | 'playing' | 'results';

export interface PartyState {
  code: string;
  host: string;
  members: Member[];
  set: SetSong[];
  phase: PartyPhase;
  /** The song being played, or whose results are showing; -1 before the first. */
  songIndex: number;
  /** Every finished song's results, by song index. */
  results: SongResults[];
  /** The party plays a Showdown, with these options; null for a plain party. */
  showdown: ShowdownOptions | null;
}

/** A chart as it is sent: the same shape as the game's own (src/chart/types.ts). */
export interface WireChart {
  part: Part;
  difficulty: Difficulty;
  lanes: number;
  notes: { t: number; lane: number; dur: number; phrase: number; release?: boolean }[];
  beats: number[];
  downbeats: number[];
  secondsPerBeat: number;
  duration: number;
}

/** A player's line on the board during a song. */
export interface BoardLine {
  id: string;
  score: number;
  streak: number;
  stars: number;
  /** Finished the song (their final score is in). */
  done?: boolean;
  /** Not playing this song (no song, or left it). */
  out?: boolean;
  /** Showdown: the share of their chart's par so far, which ranks the board. */
  share?: number;
  /** Showdown: the player their Strike would hit now (who is above them and can be hit). */
  aim?: string;
  /** Showdown: under a hit now, or about to be. */
  hit?: boolean;
}

/* WebSocket messages ------------------------------------------------------------------------ */

export type ClientMessage =
  | { type: 'hello'; protocol: number; token: string }
  /** Clock sync: `t` is the client's own clock, sent back as it was. */
  | { type: 'ping'; t: number }
  | { type: 'party-create' }
  | { type: 'party-join'; code: string }
  | { type: 'party-leave' }
  /** The host picks the set. */
  | { type: 'set'; songs: SetSong[] }
  /** A player's own choices, and which of the set's songs they have. */
  | { type: 'ready'; part: Part; difficulty: Difficulty; ready: boolean; have: string[]; calibrated?: boolean }
  /**
   * The host starts a song: the charts in play, and which one each player gets (by index into
   * `charts`; a player missing from `assign` sits the song out). Everyone plays the host's charts.
   */
  | { type: 'start'; songIndex: number; charts: WireChart[]; assign: Record<string, number> }
  | { type: 'progress'; songIndex: number; score: number; streak: number; stars: number }
  | { type: 'finish'; songIndex: number; result: SongScore }
  /** The player left the song early. */
  | { type: 'quit'; songIndex: number }
  /** The host takes everyone back to the lobby (to pick another set). */
  | { type: 'lobby' }
  /** The host removes a player from the party. */
  | { type: 'kick'; id: string }
  /** A player without one of the set's songs asks the host for it (they chose to get it). */
  | { type: 'request-song'; songId: string }
  /** What the player is doing, in a line for others ("In the menus", "Playing Song · Lead"). */
  | { type: 'status'; activity: string }
  /** The host shared the song to the server's library for that player (or `ok: false`: they won't). */
  | { type: 'song-sent'; songId: string; to: string; ok: boolean }
  /** The host makes the party a Showdown, changes its options, or makes it a plain party again (null). */
  | { type: 'showdown'; options: ShowdownOptions | null }
  /** Showdown: the player spends their charge (0..1) on a hit against the player above them. */
  | { type: 'strike'; songIndex: number; charge: number }
  /** A player who is not playing this song cheers the others on. */
  | { type: 'cheer' };

export type ServerMessage =
  | { type: 'welcome'; you: Account; server: string; protocol: number }
  | { type: 'pong'; t: number; serverT: number }
  | { type: 'party'; party: PartyState | null }
  /** `at`: the server's clock (see `pong`) when the song's first moment plays. */
  | { type: 'start'; songIndex: number; at: number; chart: WireChart | null }
  | { type: 'board'; songIndex: number; lines: BoardLine[] }
  | { type: 'error'; message: string }
  /** The server closes the connection, and says why. */
  | { type: 'bye'; reason: string }
  /** To the host: a player asks for one of the set's songs. */
  | { type: 'song-request'; songId: string; from: string; name: string }
  /** To that player: the song is in the server's library to download (or the host could not send it). */
  | { type: 'song-ready'; songId: string; ok: boolean }
  /**
   * Showdown, to the striker: whom their Strike hits, or null when nobody above can be hit (then
   * their press is an overdrive, and the charge stays theirs).
   */
  | { type: 'struck'; songIndex: number; target: string | null }
  /** Showdown, to the target: a hit from `from` (a name) lands at `at` (the server's clock) and lasts `ms`. */
  | { type: 'hit'; songIndex: number; from: string; at: number; ms: number }
  /** A player watching cheers the players on. */
  | { type: 'cheer'; from: string };

/* Leaderboards ------------------------------------------------------------------------------ */

/**
 * What a chart id is the hash of (SHA-256, hex): its lanes and notes, written the same way on
 * every machine. A new analysis or a hand edit makes a new id, and so a board of its own.
 */
export const chartKey = (c: Pick<WireChart, 'lanes' | 'notes'>) =>
  JSON.stringify([c.lanes, c.notes.map((n) => [n.t, n.lane, n.dur, n.phrase, n.release ? 1 : 0])]);

/** `POST /scores`: a finished run, which the server judges again from its inputs before taking it. */
export interface ScoreSubmission {
  songId: string;
  title: string;
  artist: string;
  chart: WireChart;
  /** The run's operations (src/game/replay.ts): one byte each, base64. */
  ops: string;
  /** Their song times, float32 little-endian, base64. */
  times: string;
  result: SongScore;
}

export interface RankLine {
  rank: number;
  scoreId: string;
  name: string;
  score: number;
  stars: number;
  accuracy: number;
  fullCombo: boolean;
  at: number;
  shared: boolean;
}

/** `GET /boards/:songId/:chartId/:part/:difficulty`: the best run of each player, best first. */
export interface Board {
  lines: RankLine[];
  /** The player's own line, wherever it ranks. */
  me: RankLine | null;
}

/** `GET /scores/:id/run`: everything needed to watch a run. */
export interface Run {
  scoreId: string;
  name: string;
  songId: string;
  title: string;
  artist: string;
  chart: WireChart;
  ops: string;
  times: string;
  result: SongScore;
  at: number;
}
