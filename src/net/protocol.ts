/**
 * What the game and a Soundwave server say to each other (docs/specs/online-play.md, section 6).
 * Shared by both: the server (server/) imports this file as it is, so it holds only types and
 * plain constants, nothing that needs the game's code or a bundler.
 *
 * Over HTTP, the server answers JSON (accounts, invites, moderation). Over one WebSocket per
 * player, the messages below, each a JSON object with a `type`.
 */

/** Raised whenever a message changes in a way an older game or server would misread. */
export const PROTOCOL_VERSION = 1;
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
  | { type: 'song-sent'; songId: string; to: string; ok: boolean };

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
  | { type: 'song-ready'; songId: string; ok: boolean };

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
  /** The challenge this run answers, if it is one. */
  challenge?: string;
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

/** `GET /scores/:id/run`: everything needed to watch a run, or play against it as a ghost. */
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

export interface Challenge {
  id: string;
  from: string;
  to: string;
  scoreId: string;
  songId: string;
  title: string;
  artist: string;
  part: Part;
  difficulty: Difficulty;
  score: number;
  created: number;
  /** The answer's score, once played. */
  answer: number | null;
}

/** The server's weekly challenge: a few songs, and the best total over them. */
export interface Weekly {
  songs: SetSong[];
  start: number;
  end: number;
  standings: { name: string; score: number; songs: number }[];
}
