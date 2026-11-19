/**
 * The game's connection to a Soundwave server (docs/specs/online-play.md, level 2): signing in,
 * staying signed in, the WebSocket parties run over, and the clock every player starts songs by.
 *
 * Nothing is sent anywhere until the player connects to a server. The server's address and the
 * sign-in that keeps them signed in (a refresh token) are kept in this browser's storage, apart
 * from the settings, so a settings backup never carries them.
 *
 * React follows it through `online.subscribe` / `online.snapshot` (useSyncExternalStore).
 */
import {
  PROTOCOL_VERSION,
  type Account,
  type ApiError,
  type Board,
  type BoardLine,
  type RankLine,
  type Run,
  type ScoreSubmission,
  type SharedSong,
  type Online,
  type ClientMessage,
  type Difficulty,
  type Invite,
  type Part,
  type PartyState,
  type ServerInfo,
  type ServerMessage,
  type Session,
  type SetSong,
  type ShowdownOptions,
  type SignUp,
  type SongScore,
  type WireChart,
} from './protocol';
import type { SoundwaveAnalysis, SoundwaveEdits, SoundwaveMeta } from '../storage/soundwaveFile';

const STORE_KEY = 'soundwave.online';
/** Clock sync: rounds per measurement, and how often it is measured again (ms). */
const SYNC_ROUNDS = 6;
const SYNC_EVERY_MS = 30_000;

export type Status =
  /** No server chosen. */
  | 'off'
  /** A server is chosen, but nobody is signed in to it. */
  | 'signed-out'
  | 'connecting'
  | 'online'
  /** Signed in, but the connection is gone: it is tried again in the background. */
  | 'reconnecting';

export interface OnlineState {
  status: Status;
  /** The server's address (https://…), once one is chosen. */
  server: string | null;
  info: ServerInfo | null;
  account: Account | null;
  party: PartyState | null;
  /** The last thing that went wrong, in a sentence for the player. */
  error: string | null;
  /** An invite's code, from a link the player opened or pasted, waiting for the sign-up it lets in. */
  invite: string | null;
}

/** A party's song changing hands (see `onSong`). */
export type SongEvent = Extract<ServerMessage, { type: 'song-request' | 'song-ready' }>;
/** Showdown during a song: a Strike's answer, a hit coming (`at` on this machine's performance.now), a cheer. */
export type ShowdownEvent = Extract<ServerMessage, { type: 'struck' | 'hit' | 'cheer' }>;

/** A song the party starts: when (performance.now ms on this machine) and on which chart (null: sit it out). */
export interface PartyStart {
  songIndex: number;
  at: number;
  chart: WireChart | null;
}

interface Stored {
  server: string;
  refresh?: string;
}

const isLocal = (host: string) =>
  host === 'localhost' ||
  host === '[::1]' ||
  host.endsWith('.local') ||
  host.startsWith('127.') ||
  host.startsWith('10.') ||
  host.startsWith('192.168.') ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(host);

/**
 * A server's address as the player typed it, made whole: HTTPS unless it is on this machine or
 * this network (where a home server has no certificate). Throws a sentence for the player.
 */
export function serverAddress(typed: string): string {
  let s = typed.trim();
  if (!s) throw new Error('Enter the server’s address.');
  if (!/^[a-z]+:\/\//i.test(s)) s = (isLocal(s.split(/[:/]/)[0]) ? 'http://' : 'https://') + s;
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new Error('That is not a server address. It looks like play.example.com.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('A server address starts with https://.');
  if (url.protocol === 'http:' && !isLocal(url.hostname))
    throw new Error('Servers outside your own network need HTTPS (https://), so your password is never sent in the clear.');
  return url.origin;
}

/**
 * An invite in any of the shapes it reaches the game: a server's join page
 * (https://play.example.com/join?invite=…), a soundwave://join?server=…&invite=… link, or the
 * web game's own address with ?server=…&invite=…. Null when the text is none of them.
 */
export function parseInvite(text: string): { server: string; invite: string } | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const invite = url.searchParams.get('invite');
  if (!invite) return null;
  const named = url.searchParams.get('server');
  try {
    if (named) return { server: serverAddress(named), invite };
    if (url.pathname.replace(/\/+$/, '') === '/join' && (url.protocol === 'https:' || url.protocol === 'http:'))
      return { server: serverAddress(url.origin), invite };
  } catch {
    return null;
  }
  return null;
}

class OnlineClient {
  private state: OnlineState = { status: 'off', server: null, info: null, account: null, party: null, error: null, invite: null };
  private readonly listeners = new Set<() => void>();
  /**
   * The live board of the song the party plays. Apart from the rest, as it changes ten times a
   * second: only the board itself redraws, never the screens around it.
   */
  private boardState: { songIndex: number; lines: BoardLine[] } | null = null;
  private readonly boardListeners = new Set<() => void>();
  private readonly startListeners = new Set<(s: PartyStart) => void>();
  private readonly songListeners = new Set<(e: SongEvent) => void>();
  private readonly showdownListeners = new Set<(e: ShowdownEvent) => void>();
  private ws: WebSocket | null = null;
  private access: string | null = null;
  private refreshToken: string | null = null;
  private retry = 0;
  private retryTimer = 0;
  private syncTimer = 0;
  /** Server clock minus this machine's (performance.now), ms, from the round with the shortest trip. */
  private offset = 0;
  private bestTrip = Infinity;
  private pings = new Map<number, number>();
  /** Signed out on purpose: the connection is not tried again. */
  private closing = false;
  /** A song's final score, or leaving it, sent while the connection was gone: sent once it is back. */
  private pending: ClientMessage[] = [];

  constructor() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      const s = raw ? (JSON.parse(raw) as Stored) : null;
      if (s?.server) {
        this.state = { ...this.state, server: s.server, status: s.refresh ? 'reconnecting' : 'signed-out' };
        this.refreshToken = s.refresh ?? null;
      }
    } catch {
      /* no storage: the player connects each time */
    }
  }

  readonly subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  readonly snapshot = () => this.state;
  readonly subscribeBoard = (fn: () => void) => {
    this.boardListeners.add(fn);
    return () => this.boardListeners.delete(fn);
  };
  readonly board = () => this.boardState;
  private setBoard(b: typeof this.boardState) {
    this.boardState = b;
    for (const l of this.boardListeners) l();
  }

  /** Called when the party starts a song. */
  onStart(fn: (s: PartyStart) => void) {
    this.startListeners.add(fn);
    return () => void this.startListeners.delete(fn);
  }

  /** Called when a party's song changes hands: the host is asked for one, or a song asked for is ready. */
  onSong(fn: (e: SongEvent) => void) {
    this.songListeners.add(fn);
    return () => void this.songListeners.delete(fn);
  }

  /** Called for Showdown's Strikes, hits and cheers during a song. */
  onShowdown(fn: (e: ShowdownEvent) => void) {
    this.showdownListeners.add(fn);
    return () => void this.showdownListeners.delete(fn);
  }

  private set(change: Partial<OnlineState>) {
    this.state = { ...this.state, ...change };
    for (const l of this.listeners) l();
  }

  private save() {
    try {
      if (!this.state.server) localStorage.removeItem(STORE_KEY);
      else
        localStorage.setItem(
          STORE_KEY,
          JSON.stringify({ server: this.state.server, ...(this.refreshToken ? { refresh: this.refreshToken } : {}) }),
        );
    } catch {
      /* storage full or blocked: signed in for this session only */
    }
  }

  /* HTTP --------------------------------------------------------------------------------------- */

  /** `raw`: a file sent as it is (a shared song); `file`: the answer is a file, not JSON. */
  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; auth?: boolean; raw?: Blob; file?: boolean } = {},
  ): Promise<T> {
    const server = this.state.server;
    if (!server) throw new Error('No server is chosen.');
    const send = () =>
      fetch(server + path, {
        method: init.method ?? (init.body === undefined && !init.raw ? 'GET' : 'POST'),
        headers: {
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(init.raw ? { 'Content-Type': 'application/octet-stream' } : {}),
          ...(init.auth && this.access ? { Authorization: `Bearer ${this.access}` } : {}),
        },
        body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      });
    let res: Response;
    try {
      res = await send();
      // An access token runs out after a while: trade the refresh token for a new one, once.
      if (res.status === 401 && init.auth && this.refreshToken) {
        await this.renew();
        res = await send();
      }
    } catch (e) {
      if (e instanceof Error && e.name !== 'TypeError') throw e;
      throw new Error('The server could not be reached. Check the address and your connection.');
    }
    if (init.file && res.ok) return (await res.blob()) as T;
    const body = (await res.json().catch(() => ({}))) as T | ApiError;
    if (!res.ok) throw new Error((body as ApiError).error ?? `The server answered with an error (${res.status}).`);
    return body as T;
  }

  private async renew() {
    const token = this.refreshToken;
    if (!token) throw new Error('You were signed out. Sign in again.');
    this.refreshToken = null;
    try {
      this.signedIn(await this.request<Session>('/auth/refresh', { body: { refresh: token } }));
    } catch (e) {
      // A refused refresh token is spent; one that never reached the server is still good.
      if (/could not be reached/.test((e as Error).message)) this.refreshToken = token;
      else this.save();
      throw e;
    }
  }

  private signedIn(s: Session) {
    this.access = s.access;
    this.refreshToken = s.refresh;
    this.save();
    this.set({ account: s.user, error: null });
  }

  /** Picks a server and asks it what it is. Throws a sentence for the player. */
  async choose(typed: string): Promise<ServerInfo> {
    const server = serverAddress(typed);
    if (server !== this.state.server) this.forget();
    this.set({ server, status: 'signed-out', error: null });
    const info = await this.request<ServerInfo>('/info');
    if (info.protocol !== PROTOCOL_VERSION)
      throw new Error(
        info.protocol > PROTOCOL_VERSION
          ? 'This server needs a newer version of Soundwave. Update the game to play here.'
          : 'This server runs an older version than your game. Its owner needs to update it.',
      );
    this.set({ info });
    this.save();
    return info;
  }

  /** An invite link opened or pasted: its server is chosen, and its code waits for the sign-up. */
  async useInvite(invite: { server: string; invite: string }) {
    await this.choose(invite.server);
    this.set({ invite: invite.invite });
  }

  async signUp(req: SignUp) {
    this.signedIn(await this.request<Session>('/auth/signup', { body: req }));
    this.set({ invite: null });
    this.connect();
  }

  async signIn(name: string, password: string) {
    this.signedIn(await this.request<Session>('/auth/signin', { body: { name, password } }));
    this.connect();
  }

  /** Signs out of the server, which stays chosen. */
  signOut() {
    this.closing = true;
    this.access = null;
    this.refreshToken = null;
    this.save();
    this.ws?.close();
    this.ws = null;
    this.pending = [];
    clearTimeout(this.retryTimer);
    clearInterval(this.syncTimer);
    this.set({ status: this.state.server ? 'signed-out' : 'off', account: null, party: null });
    this.setBoard(null);
  }

  /** Signs out and forgets the server. */
  forget() {
    this.signOut();
    this.set({ server: null, info: null, status: 'off', error: null });
    this.save();
  }

  /** Everything the server holds about the player (a JSON file to save). */
  exportData() {
    return this.request<unknown>('/me/export', { auth: true });
  }

  /* Leaderboards and runs -------------------------------------------------------- */

  /** Sends a finished run to the leaderboards; the server judges it again before it takes it. */
  postScore(sub: ScoreSubmission) {
    return this.request<{ id: string; rank: number; best: boolean }>('/scores', { body: sub, auth: true });
  }
  rankings(song: string, chart: string, part: Part, difficulty: Difficulty, week = false) {
    return this.request<Board>(`/boards/${song}/${chart}/${part}/${difficulty}${week ? '?week=1' : ''}`, { auth: true });
  }
  run(scoreId: string) {
    return this.request<Run>(`/scores/${scoreId}/run`, { auth: true });
  }
  share(scoreId: string, shared = true) {
    return this.request<unknown>(`/scores/${scoreId}/share`, { body: { shared }, auth: true });
  }
  sharedRuns(song?: string) {
    return this.request<(RankLine & { songId: string; title: string; artist: string; part: Part; difficulty: Difficulty })[]>(
      `/replays${song ? `?song=${song}` : ''}`,
      { auth: true },
    );
  }
  removeScore(scoreId: string, reason: string) {
    return this.request<unknown>(`/scores/${scoreId}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE', auth: true });
  }
  topThisWeek() {
    return this.request<{ name: string; score: number }[]>('/boards/top', { auth: true });
  }

  /* Shared songs ------------------------------------------------------------------------------- */

  /** Shares a song (its .soundwave file) to the server's library. */
  shareSong(file: Blob) {
    return this.request<SharedSong>('/songs', { raw: file, auth: true });
  }
  songs(query = '') {
    return this.request<SharedSong[]>(`/songs${query ? `?q=${encodeURIComponent(query)}` : ''}`, { auth: true });
  }
  /** A whole shared song, as its .soundwave file. */
  downloadSong(id: string) {
    return this.request<Blob>(`/songs/${id}/file`, { auth: true, file: true });
  }
  /** A shared song's details, analysis and hand-made charts (a charts-only server's whole share). */
  songCharts(id: string) {
    return this.request<{ meta: SoundwaveMeta; analysis: SoundwaveAnalysis | null; edits: SoundwaveEdits | null }>(`/songs/${id}/charts`, {
      auth: true,
    });
  }
  removeSong(id: string, reason = '') {
    return this.request<unknown>(`/songs/${id}?reason=${encodeURIComponent(reason)}`, { method: 'DELETE', auth: true });
  }
  reportSong(id: string, reason: string) {
    return this.request<unknown>(`/songs/${id}/report`, { body: { reason }, auth: true });
  }
  songReports() {
    return this.request<
      {
        id: number;
        songId: string;
        title: string;
        artist: string;
        by: string | null;
        reason: string;
        at: number;
        uploader: string | null;
      }[]
    >('/mod/reports', { auth: true });
  }
  /**
   * The address of a shared song's cover anyone can open (for the Discord status), where the server
   * serves covers publicly over HTTPS; undefined otherwise.
   */
  coverUrl(songId: string): string | undefined {
    const { server, info } = this.state;
    if (!server?.startsWith('https://') || !info?.publicCovers || info.sharing === 'off') return undefined;
    return `${server}/covers/${songId}`;
  }

  /** Tells the server what the player is doing, for the others' menus (sent again after a reconnect). */
  setStatus(activity: string) {
    this.activity = activity;
    this.send({ type: 'status', activity });
  }
  private activity = '';
  presence() {
    return this.request<Online[]>('/presence', { auth: true });
  }

  /** Asks the party's host for one of the set's songs this player lacks. */
  requestSong(songId: string) {
    this.send({ type: 'request-song', songId });
  }
  /** The host answers a request: the song is in the server's library now (or not). */
  songSent(songId: string, to: string, ok: boolean) {
    this.send({ type: 'song-sent', songId, to, ok });
  }

  /* Moderation (owner and moderators) --------------------------------------------------------- */

  moderate(action: 'kick' | 'ban' | 'unban' | 'role' | 'reset-password', body: Record<string, unknown>) {
    return this.request<{ ok?: boolean; password?: string }>(`/mod/${action}`, { body, auth: true });
  }
  auditLog() {
    return this.request<{ at: number; actor: string; action: string; target: string; reason: string }[]>('/mod/audit', { auth: true });
  }
  deleteAccount() {
    return this.request<unknown>('/me', { method: 'DELETE', auth: true }).then(() => this.forget());
  }

  /** `uses` and `hours`: null for no limit (the owner's and moderators' choice; a player's invite is one use, a week). */
  makeInvite(uses: number | null = 1, hours: number | null = 24 * 7) {
    return this.request<Invite>('/invites', { body: { uses, hours }, auth: true });
  }

  /* The connection ------------------------------------------------------------------------------ */

  /** Connects with the stored sign-in, when there is one (the game starting). */
  resume() {
    if (this.refreshToken && this.state.server && !this.ws) this.connect();
  }

  private connect() {
    this.closing = false;
    clearTimeout(this.retryTimer);
    if (this.ws) return;
    this.set({ status: this.state.account ? 'reconnecting' : 'connecting' });
    void this.open();
  }

  private async open() {
    try {
      if (!this.access) await this.renew();
      if (!this.state.info) this.set({ info: await this.request<ServerInfo>('/info') });
    } catch (e) {
      if (this.refreshToken) return this.again();
      this.set({ status: 'signed-out', error: (e as Error).message });
      return;
    }
    const url = this.state.server!.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => this.send({ type: 'hello', protocol: PROTOCOL_VERSION, token: this.access! });
    ws.onmessage = (e) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(e.data)) as ServerMessage;
      } catch {
        return;
      }
      this.receive(msg);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      clearInterval(this.syncTimer);
      if (this.closing) return;
      // The server said why it closed (banned, signed in elsewhere, too old): no point trying again.
      if (e.code >= 4000 && e.code !== 4003) return this.set({ status: 'signed-out', party: null });
      // The access token was refused: a fresh one, then again.
      if (e.code === 4003) this.access = null;
      this.again();
    };
  }

  /** Tries again after a pause that grows with each failure (1 s up to 30 s). */
  private again() {
    this.set({ status: 'reconnecting' });
    const wait = Math.min(30_000, 1000 * 2 ** this.retry++);
    this.retryTimer = window.setTimeout(() => {
      this.ws = null;
      void this.open();
    }, wait);
  }

  private send(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private receive(msg: ServerMessage) {
    switch (msg.type) {
      case 'welcome':
        this.retry = 0;
        this.set({ status: 'online', account: msg.you, error: null });
        for (const m of this.pending.splice(0)) this.send(m);
        if (this.activity) this.send({ type: 'status', activity: this.activity });
        this.sync();
        clearInterval(this.syncTimer);
        this.syncTimer = window.setInterval(() => this.sync(), SYNC_EVERY_MS);
        return;
      case 'pong': {
        const sent = this.pings.get(msg.t);
        if (sent === undefined) return;
        this.pings.delete(msg.t);
        const back = performance.now();
        const trip = back - sent;
        // The round with the shortest trip says the most about the clocks: its answer was the least delayed.
        if (trip <= this.bestTrip) {
          this.bestTrip = trip;
          this.offset = msg.serverT - (sent + trip / 2);
        }
        return;
      }
      case 'party':
        this.set({ party: msg.party });
        if (msg.party?.phase !== 'playing') this.setBoard(null);
        return;
      case 'start': {
        const start: PartyStart = { songIndex: msg.songIndex, at: msg.at - this.offset, chart: msg.chart };
        for (const l of this.startListeners) l(start);
        return;
      }
      case 'board':
        this.setBoard({ songIndex: msg.songIndex, lines: msg.lines });
        return;
      case 'error':
        this.set({ error: msg.message });
        return;
      case 'song-request':
      case 'song-ready':
        for (const l of this.songListeners) l(msg);
        return;
      case 'hit':
      case 'struck':
      case 'cheer': {
        const e: ShowdownEvent = msg.type === 'hit' ? { ...msg, at: msg.at - this.offset } : msg;
        for (const l of this.showdownListeners) l(e);
        return;
      }
      case 'bye':
        this.closing = true;
        this.set({ error: msg.reason, party: null, status: 'signed-out' });
        return;
    }
  }

  /** Measures the clocks against each other: a few pings a little apart, the best one kept. */
  private sync() {
    this.bestTrip = Infinity;
    for (let i = 0; i < SYNC_ROUNDS; i++)
      window.setTimeout(() => {
        const t = performance.now();
        this.pings.set(t, t);
        this.send({ type: 'ping', t });
      }, i * 150);
  }

  /* Party ------------------------------------------------------------------------------------ */

  clearError() {
    this.set({ error: null });
  }
  /** Shows something that went wrong on the party screen. */
  report(message: string) {
    this.set({ error: message });
  }
  createParty() {
    this.send({ type: 'party-create' });
  }
  joinParty(code: string) {
    this.send({ type: 'party-join', code });
  }
  leaveParty() {
    this.send({ type: 'party-leave' });
    this.set({ party: null });
    this.setBoard(null);
  }
  setSet(songs: SetSong[]) {
    this.send({ type: 'set', songs });
  }
  ready(part: Part, difficulty: Difficulty, ready: boolean, have: string[], calibrated = false) {
    this.send({ type: 'ready', part, difficulty, ready, have, calibrated });
  }
  start(songIndex: number, charts: WireChart[], assign: Record<string, number>) {
    this.send({ type: 'start', songIndex, charts, assign });
  }
  progress(songIndex: number, score: number, streak: number, stars: number) {
    this.send({ type: 'progress', songIndex, score, streak, stars });
  }
  finish(songIndex: number, result: SongScore) {
    this.sendOrKeep({ type: 'finish', songIndex, result });
  }
  quit(songIndex: number) {
    this.sendOrKeep({ type: 'quit', songIndex });
  }
  private sendOrKeep(msg: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.send(msg);
    else this.pending.push(msg);
  }
  backToLobby() {
    this.send({ type: 'lobby' });
  }
  /** The host makes the party a Showdown with these options, or a plain party (null). */
  setShowdown(options: ShowdownOptions | null) {
    this.send({ type: 'showdown', options });
  }
  /** Showdown: spends the charge on a hit against the player above (the server picks whom). */
  strike(songIndex: number, charge: number) {
    this.send({ type: 'strike', songIndex, charge });
  }
  /** A player watching cheers the others on. */
  cheer() {
    this.send({ type: 'cheer' });
  }
  showdownRotation() {
    return this.request<SetSong[]>('/showdown/rotation', { auth: true });
  }
  setShowdownRotation(songs: SetSong[]) {
    return this.request<SetSong[]>('/showdown/rotation', { body: { songs }, auth: true });
  }
  kick(id: string) {
    this.send({ type: 'kick', id });
  }
}

export const online = new OnlineClient();
