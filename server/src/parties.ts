/**
 * Parties: players on a server who play a set together (docs/specs/online-play.md, 2.2–2.5 and 3.1).
 *
 * The host picks the set, everyone picks their own part and difficulty, and the host starts each
 * song. The server sends every player the chart they play (the host's, so everyone plays the
 * same notes), names the moment it starts on the server's clock, and passes the scores around ten
 * times a second. Each player's hits are judged on their own machine; only scores travel.
 *
 * This holds no sockets: it is given a way to send a message to a player and a clock, so it can be
 * tested on its own (server/tests).
 */
import {
  BOARD_INTERVAL_MS,
  PARTY_MAX,
  RECONNECT_GRACE_MS,
  START_LEAD_MS,
  type BoardLine,
  type ClientMessage,
  type Member,
  type PartyState,
  type ResultLine,
  type ServerMessage,
  type SongScore,
} from '../../src/net/protocol.ts';

/** How long after a song should have ended its results wait for a player's final score, ms. */
const FINISH_GRACE_MS = 30_000;

const WORDS = [
  'KITE',
  'BASS',
  'DRUM',
  'TAPE',
  'NEON',
  'ECHO',
  'RIFF',
  'BEAT',
  'HYMN',
  'JAZZ',
  'LOOP',
  'MOOD',
  'PEAK',
  'SOLO',
  'TONE',
  'WAVE',
  'VIBE',
  'GLOW',
  'STAR',
  'FUZZ',
  'HUSH',
  'LUTE',
  'REED',
  'SYNC',
];

export interface Player {
  id: string;
  name: string;
}

type Send = (to: string, msg: ServerMessage) => void;

interface Song {
  index: number;
  /** Players with a chart: their final scores once in, null when they quit or were gone. */
  playing: Map<string, SongScore | null | undefined>;
  board: Map<string, BoardLine>;
  /** When the results are made even without every final score (server clock, ms). */
  deadline: number;
}

class Party {
  state: PartyState;
  song: Song | null = null;
  /** When each disconnected member went (server clock, ms). */
  gone = new Map<string, number>();
  lastBoard = 0;

  constructor(code: string, host: Player) {
    this.state = { code, host: host.id, members: [], set: [], phase: 'lobby', songIndex: -1, results: [] };
  }

  member(id: string): Member | undefined {
    return this.state.members.find((m) => m.id === id);
  }
}

export class Parties {
  private readonly parties = new Map<string, Party>();
  private readonly partyOf = new Map<string, Party>();

  private readonly send: Send;
  private readonly now: () => number;

  constructor(send: Send, now: () => number) {
    this.send = send;
    this.now = now;
  }

  /** The party a player is in (for tests and the moderation tools). */
  stateOf(player: string): PartyState | undefined {
    return this.partyOf.get(player)?.state;
  }

  get count() {
    return this.parties.size;
  }

  /** A message from a signed-in player. Answers with an error for anything not allowed. */
  handle(player: Player, msg: ClientMessage) {
    const fail = (message: string) => this.send(player.id, { type: 'error', message });
    const party = this.partyOf.get(player.id);
    switch (msg.type) {
      case 'status':
        return;
      case 'party-create': {
        if (party) this.leave(player.id);
        const p = new Party(this.newCode(), player);
        this.parties.set(p.state.code, p);
        this.addMember(p, player);
        return;
      }
      case 'party-join': {
        const p = this.parties.get(msg.code.trim().toUpperCase());
        if (!p) return fail('There is no party with that code. Check it with the host.');
        if (p === party) return this.share(p);
        if (p.state.members.length >= PARTY_MAX) return fail(`That party is full: it has ${PARTY_MAX} players.`);
        if (party) this.leave(player.id);
        this.addMember(p, player);
        return;
      }
      case 'party-leave':
        return party ? this.leave(player.id) : undefined;
    }
    if (!party) return fail('You are not in a party.');
    const me = party.member(player.id)!;
    const host = party.state.host === player.id;
    const s = party.state;
    switch (msg.type) {
      case 'set':
        if (!host) return fail('Only the host picks the set.');
        if (s.phase === 'playing') return fail('The set can be changed once this song is over.');
        s.set = msg.songs;
        s.results = [];
        s.songIndex = -1;
        s.phase = 'lobby';
        for (const m of s.members) {
          m.ready = false;
          m.have = m.have.filter((id) => s.set.some((song) => song.id === id));
        }
        return this.share(party);
      case 'ready':
        me.part = msg.part;
        me.difficulty = msg.difficulty;
        me.ready = msg.ready;
        me.calibrated = msg.calibrated === true;
        me.have = msg.have.filter((id) => s.set.some((song) => song.id === id));
        return this.share(party);
      case 'start':
        return this.start(party, player, msg);
      case 'progress': {
        const line = party.song?.index === msg.songIndex ? party.song.board.get(player.id) : undefined;
        if (!line || line.done || line.out) return;
        line.score = msg.score;
        line.streak = msg.streak;
        line.stars = msg.stars;
        return;
      }
      case 'finish':
      case 'quit': {
        const song = party.song;
        if (!song || song.index !== msg.songIndex || !song.playing.has(player.id) || song.playing.get(player.id) !== undefined) return;
        const result = msg.type === 'finish' ? msg.result : null;
        song.playing.set(player.id, result);
        const line = song.board.get(player.id)!;
        if (result) Object.assign(line, { score: result.score, stars: result.stars, done: true });
        else line.out = true;
        return this.maybeEndSong(party);
      }
      case 'lobby':
        if (!host) return fail('Only the host can take the party back to the lobby.');
        if (s.phase === 'playing') return fail('Wait for this song to end.');
        s.phase = 'lobby';
        for (const m of s.members) m.ready = false;
        return this.share(party);
      case 'kick': {
        if (!host) return fail('Only the host can remove players.');
        if (msg.id === player.id || !party.member(msg.id)) return;
        this.removeMember(party, msg.id);
        this.send(msg.id, { type: 'error', message: 'The host removed you from the party.' });
        return;
      }
      case 'request-song': {
        // Asked of the host, who has the song: they share it to the server's library for this player.
        if (!s.set.some((x) => x.id === msg.songId)) return fail('That song is not in the set.');
        if (host) return;
        this.send(s.host, { type: 'song-request', songId: msg.songId, from: player.id, name: player.name });
        return;
      }
      case 'song-sent':
        if (!host || !party.member(msg.to)) return;
        this.send(msg.to, { type: 'song-ready', songId: msg.songId, ok: msg.ok });
        return;
    }
  }

  private start(party: Party, player: Player, msg: Extract<ClientMessage, { type: 'start' }>) {
    const s = party.state;
    const fail = (message: string) => this.send(player.id, { type: 'error', message });
    if (s.host !== player.id) return fail('Only the host starts a song.');
    if (s.phase === 'playing') return fail('A song is already playing.');
    if (msg.songIndex < 0 || msg.songIndex >= s.set.length) return fail('That song is not in the set.');
    const songId = s.set[msg.songIndex].id;
    const playing = new Map<string, SongScore | null | undefined>();
    const board = new Map<string, BoardLine>();
    for (const m of s.members) {
      const chart = msg.assign[m.id];
      const plays = chart !== undefined && m.connected && m.have.includes(songId);
      if (plays) playing.set(m.id, undefined);
      board.set(m.id, { id: m.id, score: 0, streak: 0, stars: 0, ...(plays ? {} : { out: true }) });
    }
    if (!playing.size) return fail('Nobody has this song, so it cannot be played.');
    const at = this.now() + START_LEAD_MS;
    const longest = Math.max(...[...playing.keys()].map((id) => msg.charts[msg.assign[id]].duration));
    party.song = { index: msg.songIndex, playing, board, deadline: at + longest * 1000 + FINISH_GRACE_MS };
    s.phase = 'playing';
    s.songIndex = msg.songIndex;
    for (const m of s.members) {
      m.ready = false;
      const i = playing.has(m.id) ? msg.assign[m.id] : undefined;
      this.send(m.id, { type: 'start', songIndex: msg.songIndex, at, chart: i === undefined ? null : msg.charts[i] });
    }
    this.share(party);
  }

  /** Makes a song's results once every player's final score is in, or the wait for them is over. */
  private maybeEndSong(party: Party, force = false) {
    const song = party.song;
    if (!song) return;
    if (!force && [...song.playing.values()].some((r) => r === undefined)) return;
    const s = party.state;
    const lines: ResultLine[] = s.members.map((m) => {
      if (!song.playing.has(m.id)) return { id: m.id, name: m.name, result: null, missing: 'sat-out' };
      const r = song.playing.get(m.id);
      return r ? { id: m.id, name: m.name, result: r } : { id: m.id, name: m.name, result: null, missing: 'left' };
    });
    lines.sort((a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1));
    this.sendBoard(party);
    party.song = null;
    s.results = [...s.results.filter((r) => r.songIndex !== song.index), { songIndex: song.index, lines }];
    s.phase = 'results';
    this.share(party);
  }

  private sendBoard(party: Party) {
    const song = party.song;
    if (!song) return;
    const lines = [...song.board.values()];
    for (const m of party.state.members) if (m.connected) this.send(m.id, { type: 'board', songIndex: song.index, lines });
  }

  /** Runs every few tens of ms: the board, results that waited long enough, and players who did not come back. */
  tick() {
    const now = this.now();
    for (const party of this.parties.values()) {
      if (party.song) {
        if (now - party.lastBoard >= BOARD_INTERVAL_MS) {
          party.lastBoard = now;
          this.sendBoard(party);
        }
        if (now >= party.song.deadline) this.maybeEndSong(party, true);
      }
      for (const [id, at] of party.gone) {
        if (now - at < RECONNECT_GRACE_MS) continue;
        party.gone.delete(id);
        if (id === party.state.host) this.end(party, 'The host lost their connection, so the party ended.');
        else this.removeMember(party, id);
      }
    }
  }

  /** A player's connection went: they keep their place for RECONNECT_GRACE_MS. */
  disconnected(player: string) {
    const party = this.partyOf.get(player);
    const m = party?.member(player);
    if (!party || !m) return;
    m.connected = false;
    party.gone.set(player, this.now());
    // A song they were playing goes on without them; their result counts once they are back.
    this.share(party);
  }

  /** A player signed in again: back into their party, if they still have one. */
  reconnected(player: string) {
    const party = this.partyOf.get(player);
    const m = party?.member(player);
    if (!party || !m) return this.send(player, { type: 'party', party: null });
    m.connected = true;
    party.gone.delete(player);
    this.share(party);
  }

  /** A player leaves their party (or is removed from the server). The host leaving ends it. */
  leave(player: string) {
    const party = this.partyOf.get(player);
    if (!party) return;
    if (party.state.host === player) this.end(party, 'The host ended the party.');
    else this.removeMember(party, player);
  }

  private end(party: Party, reason: string) {
    this.parties.delete(party.state.code);
    for (const m of party.state.members) {
      this.partyOf.delete(m.id);
      this.send(m.id, { type: 'party', party: null });
      if (m.id !== party.state.host) this.send(m.id, { type: 'error', message: reason });
    }
  }

  private addMember(party: Party, player: Player) {
    party.state.members.push({
      id: player.id,
      name: player.name,
      part: 'lead',
      difficulty: 'medium',
      ready: false,
      calibrated: false,
      have: [],
      connected: true,
    });
    this.partyOf.set(player.id, party);
    this.share(party);
  }

  private removeMember(party: Party, id: string) {
    party.state.members = party.state.members.filter((m) => m.id !== id);
    party.gone.delete(id);
    this.partyOf.delete(id);
    this.send(id, { type: 'party', party: null });
    // Gone from the song too: the others' results no longer wait for them.
    party.song?.board.delete(id);
    party.song?.playing.delete(id);
    this.share(party);
    this.maybeEndSong(party);
  }

  /** Sends everyone in a party its state as it is now. */
  private share(party: Party) {
    for (const m of party.state.members) if (m.connected) this.send(m.id, { type: 'party', party: party.state });
  }

  private newCode(): string {
    for (;;) {
      const code = `${WORDS[Math.floor(Math.random() * WORDS.length)]}-${10 + Math.floor(Math.random() * 90)}`;
      if (!this.parties.has(code)) return code;
    }
  }
}
