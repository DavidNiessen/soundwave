/**
 * Parties: players on a server who play a set together (docs/specs/online-play.md, 2.2–2.5 and 3.1).
 *
 * The host picks the set, everyone picks their own part and difficulty, and the host starts each
 * song. The server sends every player the chart they play (the host's, so everyone plays the
 * same notes), names the moment it starts on the server's clock, and passes the scores around ten
 * times a second. Each player's hits are judged on their own machine; only scores travel.
 *
 * A party can be a Showdown (4.1): scores become shares of each chart's par, the overdrive button
 * strikes the player above, and the lowest players go out after each song. The server decides whom
 * a Strike hits and how long the hit lasts, by the fairness rules below; the players' games apply
 * the hits.
 *
 * This holds no sockets: it is given a way to send a message to a player and a clock, so it can be
 * tested on its own (server/tests).
 */
import type { Chart } from '../../src/chart/types.ts';
import { GameSession } from '../../src/game/GameSession.ts';
import {
  BOARD_INTERVAL_MS,
  HIT_MAX_MS,
  HIT_MIN_MS,
  HIT_PROTECTION_MS,
  HIT_REPEAT_MS,
  HIT_WARNING_MS,
  MAX_ATTACKERS,
  PARTY_MAX,
  RECONNECT_GRACE_MS,
  SHOWDOWN_FINAL,
  START_LEAD_MS,
  STRIKE_MIN_CHARGE,
  type Avatar,
  type BoardLine,
  type ClientMessage,
  type Member,
  type PartyState,
  type ResultLine,
  type ServerMessage,
  type SetSong,
  type ShowdownOptions,
  type SongScore,
} from '../../src/net/protocol.ts';

/** How long after a song should have ended its results wait for a player's final score, ms. */
const FINISH_GRACE_MS = 30_000;
/** The least time between one watching player's cheers, ms. */
const CHEER_EVERY_MS = 1_500;

/**
 * How many players are left after song `songIndex` of a Showdown that `start` players began with:
 * the field is cut evenly down to a final of four (or fewer, for a small party), and the last song
 * leaves one. 16 players over 4 songs: 12, 8, 4, 1.
 */
export function survivors(start: number, songIndex: number, songs: number): number {
  if (songIndex >= songs - 1) return 1;
  const final = Math.min(SHOWDOWN_FINAL, start);
  return start - Math.round(((songIndex + 1) * (start - final)) / (songs - 1));
}

/** How long a Strike's hit lasts: 3 s for a quarter meter, 8 s for a full one, half for a repeat. */
export function hitLength(charge: number, repeat: boolean): number {
  const k = Math.max(0, Math.min(1, (charge - STRIKE_MIN_CHARGE) / (1 - STRIKE_MIN_CHARGE)));
  const ms = Math.round(HIT_MIN_MS + k * (HIT_MAX_MS - HIT_MIN_MS));
  return repeat ? Math.round(ms / 2) : ms;
}

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
  /** Their look on the stage, which the party shows at their part. */
  avatar?: Avatar;
}

type Send = (to: string, msg: ServerMessage) => void;

interface Song {
  index: number;
  /** Players with a chart: their final scores once in, null when they quit or were gone. */
  playing: Map<string, SongScore | null | undefined>;
  board: Map<string, BoardLine>;
  /** When the results are made even without every final score (server clock, ms). */
  deadline: number;
  /** Showdown: each player's chart's par, which their score is a share of. */
  par: Map<string, number>;
  /** Showdown: the hit each player is under or about to be (server clock, ms). */
  hits: Map<string, { at: number; until: number }>;
  /** Showdown: when each player's last hit started. */
  lastHit: Map<string, number>;
}

class Party {
  state: PartyState;
  song: Song | null = null;
  /** When each disconnected member went (server clock, ms). */
  gone = new Map<string, number>();
  lastBoard = 0;
  /** Showdown: how many players began the set, which the cut after each song is reckoned from. */
  started = 0;
  /** When each watching player last cheered. */
  cheered = new Map<string, number>();

  constructor(code: string, host: Player) {
    this.state = {
      code,
      host: host.id,
      members: [],
      set: [],
      phase: 'lobby',
      songIndex: -1,
      results: [],
      mode: null,
      showdown: null,
      private: false,
    };
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
  /** The server's Showdown rotation: the set a Showdown plays when the host does not pick one. */
  private readonly rotation: () => SetSong[];
  /** Whether the server holds a song for parties (server/src/partySongs.ts). */
  private readonly cached: (songId: string) => boolean;

  constructor(send: Send, now: () => number, rotation: () => SetSong[] = () => [], cached: (songId: string) => boolean = () => false) {
    this.send = send;
    this.now = now;
    this.rotation = rotation;
    this.cached = cached;
  }

  /** Whether a song is in the set of the party a player is in: only then may they send it or get it. */
  inSet(player: string, songId: string): boolean {
    return !!this.partyOf.get(player)?.state.set.some((s) => s.id === songId);
  }

  /** The server now holds a song: every party with it in its set hears so, and its players without it download it. */
  songCached(songId: string) {
    for (const party of this.parties.values()) {
      const song = party.state.set.find((s) => s.id === songId && !s.cached);
      if (!song) continue;
      song.cached = true;
      this.share(party);
    }
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
        if (s.showdown?.rotation) return fail('This Showdown plays the server’s rotation. Turn that off to pick your own set.');
        this.newSet(party, msg.songs);
        return this.share(party);
      case 'mode': {
        if (!host) return fail('Only the host picks what the party plays.');
        if (s.phase === 'playing') return fail('Wait for this song to end.');
        const wasRotation = !!s.showdown?.rotation;
        s.mode = msg.mode;
        s.showdown = msg.mode === 'showdown' ? (s.showdown ?? { hits: true, part: null, rotation: false }) : null;
        this.newSet(party, wasRotation && !s.showdown?.rotation ? [] : s.set);
        return this.share(party);
      }
      case 'showdown':
        if (!host) return fail('Only the host sets up a Showdown.');
        if (s.phase === 'playing') return fail('A Showdown can be set up once this song is over.');
        if (s.mode !== 'showdown') return fail('Pick Showdown first.');
        return this.setShowdown(party, msg.options, fail);
      case 'ready':
        me.part = s.showdown?.part ?? msg.part;
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
        if (s.showdown) line.share = this.shareOf(party.song!, player.id, msg.score);
        return;
      }
      case 'strike':
        return this.strike(party, player, msg.songIndex, msg.charge);
      case 'cheer': {
        // Only a player watching cheers (out of the Showdown, or sitting the song out), and not too often.
        const song = party.song;
        if (!song || song.playing.has(player.id)) return;
        const now = this.now();
        if (now - (party.cheered.get(player.id) ?? -Infinity) < CHEER_EVERY_MS) return;
        party.cheered.set(player.id, now);
        for (const id of song.playing.keys()) this.send(id, { type: 'cheer', from: player.name });
        return;
      }
      case 'finish':
      case 'quit': {
        const song = party.song;
        if (!song || song.index !== msg.songIndex || !song.playing.has(player.id) || song.playing.get(player.id) !== undefined) return;
        const result = msg.type === 'finish' ? msg.result : null;
        song.playing.set(player.id, result);
        const line = song.board.get(player.id)!;
        if (result) {
          Object.assign(line, { score: result.score, stars: result.stars, done: true });
          if (s.showdown) line.share = this.shareOf(song, player.id, result.score);
        } else line.out = true;
        return this.maybeEndSong(party);
      }
      case 'private':
        if (!host) return fail('Only the host makes the party private.');
        s.private = msg.on;
        return this.share(party);
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
    }
  }

  /** The Showdown's options: one part for everyone, and the server's rotation as the set, or the host's own. */
  private setShowdown(party: Party, o: ShowdownOptions, fail: (message: string) => void) {
    const s = party.state;
    if (o.rotation && !this.rotation().length) return fail('This server has no Showdown rotation yet. Its owner or a moderator sets one.');
    const wasRotation = !!s.showdown?.rotation;
    s.showdown = o;
    if (o.part) for (const m of s.members) m.part = o.part;
    // The rotation is the set while it is chosen; turned off, the set is the host's to pick again.
    this.newSet(party, o.rotation ? this.rotation() : wasRotation ? [] : s.set);
    this.share(party);
  }

  private start(party: Party, player: Player, msg: Extract<ClientMessage, { type: 'start' }>) {
    const s = party.state;
    const fail = (message: string) => this.send(player.id, { type: 'error', message });
    if (s.host !== player.id) return fail('Only the host starts a song.');
    if (s.phase === 'playing') return fail('A song is already playing.');
    if (!s.mode) return fail('Pick what to play first.');
    if (msg.songIndex < 0 || msg.songIndex >= s.set.length) return fail('That song is not in the set.');
    if (s.showdown) {
      // A set begins with everyone in it; later songs only with the players still in.
      if (msg.songIndex === 0) for (const m of s.members) m.eliminated = false;
      const left = s.members.filter((m) => !m.eliminated).length;
      if (msg.songIndex > 0 && left <= 1) return fail('This Showdown is decided. Go back to the lobby to play another.');
      if (msg.songIndex === 0) party.started = left;
    }
    const songId = s.set[msg.songIndex].id;
    const playing = new Map<string, SongScore | null | undefined>();
    const board = new Map<string, BoardLine>();
    const par = new Map<string, number>();
    for (const m of s.members) {
      const chart = msg.assign[m.id];
      const plays = chart !== undefined && m.connected && m.have.includes(songId) && !m.eliminated;
      if (plays && s.showdown) par.set(m.id, new GameSession(msg.charts[chart] as Chart).par);
      if (plays) playing.set(m.id, undefined);
      board.set(m.id, { id: m.id, score: 0, streak: 0, stars: 0, ...(plays ? {} : { out: true }) });
    }
    if (!playing.size) return fail('Nobody has this song, so it cannot be played.');
    const at = this.now() + START_LEAD_MS;
    const longest = Math.max(...[...playing.keys()].map((id) => msg.charts[msg.assign[id]].duration));
    party.song = {
      index: msg.songIndex,
      playing,
      board,
      deadline: at + longest * 1000 + FINISH_GRACE_MS,
      par,
      hits: new Map(),
      lastHit: new Map(),
    };
    s.phase = 'playing';
    s.songIndex = msg.songIndex;
    if (s.showdown) s.cut = Math.min(playing.size, survivors(party.started || playing.size, msg.songIndex, s.set.length));
    else delete s.cut;
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
    if (s.showdown) this.eliminate(party, song, lines);
    else lines.sort((a, b) => (b.result?.score ?? -1) - (a.result?.score ?? -1));
    this.sendBoard(party);
    party.song = null;
    s.results = [...s.results.filter((r) => r.songIndex !== song.index), { songIndex: song.index, lines }];
    s.phase = 'results';
    this.share(party);
  }

  /**
   * Showdown, after a song: every player still in gets their share (a result still missing counts
   * as their last score on the board), and the lowest go out, down to the number the set's cut
   * leaves. Players level at the cut all stay.
   */
  private eliminate(party: Party, song: Song, lines: ResultLine[]) {
    const s = party.state;
    const member = (id: string) => s.members.find((m) => m.id === id);
    for (const l of lines)
      if (song.playing.has(l.id)) l.share = this.shareOf(song, l.id, l.result?.score ?? song.board.get(l.id)?.score ?? 0);
    const alive = lines.filter((l) => !member(l.id)?.eliminated);
    alive.sort((a, b) => (b.share ?? 0) - (a.share ?? 0));
    const keep = Math.min(alive.length, survivors(party.started || alive.length, song.index, s.set.length));
    const bar = alive[keep - 1]?.share ?? 0;
    for (const l of alive)
      if ((l.share ?? 0) < bar) {
        l.eliminated = true;
        member(l.id)!.eliminated = true;
      }
    // Still in first, by share; then those out.
    lines.sort((a, b) => Number(!!member(a.id)?.eliminated) - Number(!!member(b.id)?.eliminated) || (b.share ?? -1) - (a.share ?? -1));
  }

  /** Showdown: a score as a share of the player's chart's par. */
  private shareOf(song: Song, id: string, score: number) {
    const par = song.par.get(id) ?? 0;
    return par > 0 ? score / par : 0;
  }

  /** Showdown: whether a player can be hit now (not under a hit, nor protected after one). */
  private open(song: Song, id: string, now: number) {
    const h = song.hits.get(id);
    return !h || now >= h.until + HIT_PROTECTION_MS;
  }

  /**
   * Showdown: whom each player's Strike would hit now. Ranked by share, each player aims at the
   * nearest player above who can be hit and is not already the target of two others; first place
   * aims at nobody. Players who finished, or are not playing, neither strike nor are struck.
   */
  private aims(party: Party): Map<string, string> {
    const song = party.song;
    const out = new Map<string, string>();
    if (!song || !party.state.showdown?.hits) return out;
    const now = this.now();
    const ranked = [...song.board.values()]
      .filter((l) => !l.out && !l.done && song.playing.has(l.id))
      .sort((a, b) => (b.share ?? 0) - (a.share ?? 0) || (a.id < b.id ? -1 : 1));
    const count = new Map<string, number>();
    for (let i = 1; i < ranked.length; i++)
      for (let j = i - 1; j >= 0; j--) {
        const t = ranked[j].id;
        if (!this.open(song, t, now) || (count.get(t) ?? 0) >= MAX_ATTACKERS) continue;
        out.set(ranked[i].id, t);
        count.set(t, (count.get(t) ?? 0) + 1);
        break;
      }
    return out;
  }

  /** Showdown: a player spends their charge. The server picks the target and the hit's length. */
  private strike(party: Party, player: Player, songIndex: number, charge: number) {
    const song = party.song;
    const line =
      party.state.showdown?.hits && song?.index === songIndex && charge >= STRIKE_MIN_CHARGE ? song.board.get(player.id) : undefined;
    const target = line && !line.done && !line.out ? this.aims(party).get(player.id) : undefined;
    this.send(player.id, { type: 'struck', songIndex, target: target ?? null });
    if (!target || !song) return;
    const now = this.now();
    const repeat = now - (song.lastHit.get(target) ?? -Infinity) < HIT_REPEAT_MS;
    const ms = hitLength(Math.min(1, charge), repeat);
    const at = now + HIT_WARNING_MS;
    song.hits.set(target, { at, until: at + ms });
    song.lastHit.set(target, now);
    this.send(target, { type: 'hit', songIndex, from: player.name, at, ms });
    this.sendBoard(party);
  }

  /** A new set: no results yet, nobody ready, and in a Showdown everyone in again. */
  private newSet(party: Party, songs: SetSong[]) {
    const s = party.state;
    s.set = songs.map((song) => ({ ...song, cached: this.cached(song.id) }));
    s.results = [];
    s.songIndex = -1;
    s.phase = 'lobby';
    for (const m of s.members) {
      m.ready = false;
      m.eliminated = false;
      m.have = m.have.filter((id) => s.set.some((song) => song.id === id));
    }
  }

  private sendBoard(party: Party) {
    const song = party.song;
    if (!song) return;
    let lines = [...song.board.values()];
    if (party.state.showdown?.hits) {
      const aims = this.aims(party);
      const now = this.now();
      lines = lines.map((l) => {
        const h = song.hits.get(l.id);
        return { ...l, aim: aims.get(l.id), hit: !!h && now < h.until };
      });
    }
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

  /** A player changed their avatar: the party sees it at once. */
  setAvatar(player: string, avatar: Avatar | undefined) {
    const party = this.partyOf.get(player);
    const m = party?.member(player);
    if (!party || !m) return;
    if (avatar) m.avatar = avatar;
    else delete m.avatar;
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
      part: party.state.showdown?.part ?? 'lead',
      ...(player.avatar ? { avatar: player.avatar } : {}),
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
