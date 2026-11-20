/**
 * The server's settings: a JSON file in its data folder (soundwave-server.json), with environment
 * variables over it, so a Docker container can be set up without a file.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { JoinMode, SongSharing } from '../../src/net/protocol.ts';

export interface Config {
  /** Shown in the game and the server list. */
  name: string;
  description: string;
  host: string;
  port: number;
  /** Where the database and the signing secret live. */
  dataDir: string;
  /** Who may make an account (docs/specs/online-play.md, 3.2). */
  mode: JoinMode;
  /** The password making an account needs, in mode `password`. */
  password: string;
  /**
   * The address players reach the server at (https://…), written into invite links.
   * Behind a proxy it is not the address the server listens on.
   */
  publicUrl: string;
  /** Behind a reverse proxy (Caddy): take the player's address from X-Forwarded-For. */
  trustProxy: boolean;
  /** The web game an invite link offers to play in (an owner may host their own copy). */
  webGameUrl: string;
  /** Where an invite link sends someone who has neither the app nor a browser that can play. */
  downloadUrl: string;
  /**
   * Song sharing: off (the default), charts (everything but the audio, for public servers) or songs
   * (whole songs). Sharing music can infringe copyright, and the owner answers for what the server
   * hands out: turning it on is the owner's decision (server/README.md).
   */
  songSharing: SongSharing;
  /** The biggest song file a player can share, MB. */
  songMaxMb: number;
  /** How much each player can share in all, MB. */
  quotaMb: number;
  /** Covers of shared songs are served to anyone, so the Discord status can show them. */
  publicCovers: boolean;
  /**
   * A party's songs are passed on through the server (on by default): the host's game sends a song
   * a player in the party lacks, and only the party's players can download it. No one else can list
   * or fetch it, and it is kept only as a cache (server/src/partySongs.ts).
   */
  partySongs: boolean;
  /** The most the party song cache holds, MB: the least recently used songs go first. */
  partyCacheMb: number;
  /** How long a party's song is kept after it was last used, days. */
  partyCacheDays: number;
}

const MODES: JoinMode[] = ['public', 'password', 'invite'];

export const DEFAULTS: Config = {
  name: 'Soundwave server',
  description: '',
  host: '0.0.0.0',
  port: 7420,
  dataDir: './data',
  mode: 'invite',
  password: '',
  publicUrl: '',
  trustProxy: false,
  webGameUrl: 'https://soundwave.niessen.dev',
  downloadUrl: 'https://github.com/DavidNiessen/soundwave/releases/latest',
  songSharing: 'off',
  songMaxMb: 100,
  quotaMb: 2000,
  publicCovers: false,
  partySongs: true,
  partyCacheMb: 4000,
  partyCacheDays: 7,
};

/** Reads the settings: defaults, then the file, then the environment. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(overrides.dataDir ?? env.SOUNDWAVE_DATA ?? DEFAULTS.dataDir);
  mkdirSync(dataDir, { recursive: true });
  const file = join(dataDir, 'soundwave-server.json');
  let fromFile: Partial<Config> = {};
  if (existsSync(file)) {
    try {
      fromFile = JSON.parse(readFileSync(file, 'utf8')) as Partial<Config>;
    } catch (e) {
      throw new Error(`${file} is not valid JSON: ${(e as Error).message}`, { cause: e });
    }
  }
  const fromEnv: Partial<Config> = {
    ...(env.SOUNDWAVE_NAME ? { name: env.SOUNDWAVE_NAME } : {}),
    ...(env.SOUNDWAVE_DESCRIPTION ? { description: env.SOUNDWAVE_DESCRIPTION } : {}),
    ...(env.HOST ? { host: env.HOST } : {}),
    ...(env.PORT ? { port: Number(env.PORT) } : {}),
    ...(env.SOUNDWAVE_MODE ? { mode: env.SOUNDWAVE_MODE as JoinMode } : {}),
    ...(env.SOUNDWAVE_PASSWORD ? { password: env.SOUNDWAVE_PASSWORD } : {}),
    ...(env.SOUNDWAVE_PUBLIC_URL ? { publicUrl: env.SOUNDWAVE_PUBLIC_URL } : {}),
    ...(env.SOUNDWAVE_WEB_GAME ? { webGameUrl: env.SOUNDWAVE_WEB_GAME } : {}),
    ...(env.SOUNDWAVE_SONG_SHARING ? { songSharing: env.SOUNDWAVE_SONG_SHARING as SongSharing } : {}),
    ...(env.SOUNDWAVE_SONG_MAX_MB ? { songMaxMb: Number(env.SOUNDWAVE_SONG_MAX_MB) } : {}),
    ...(env.SOUNDWAVE_QUOTA_MB ? { quotaMb: Number(env.SOUNDWAVE_QUOTA_MB) } : {}),
    ...(env.SOUNDWAVE_PUBLIC_COVERS ? { publicCovers: env.SOUNDWAVE_PUBLIC_COVERS === '1' || env.SOUNDWAVE_PUBLIC_COVERS === 'true' } : {}),
    ...(env.SOUNDWAVE_PARTY_SONGS ? { partySongs: env.SOUNDWAVE_PARTY_SONGS === '1' || env.SOUNDWAVE_PARTY_SONGS === 'true' } : {}),
    ...(env.SOUNDWAVE_PARTY_CACHE_MB ? { partyCacheMb: Number(env.SOUNDWAVE_PARTY_CACHE_MB) } : {}),
    ...(env.SOUNDWAVE_PARTY_CACHE_DAYS ? { partyCacheDays: Number(env.SOUNDWAVE_PARTY_CACHE_DAYS) } : {}),
    ...(env.SOUNDWAVE_TRUST_PROXY ? { trustProxy: env.SOUNDWAVE_TRUST_PROXY === '1' || env.SOUNDWAVE_TRUST_PROXY === 'true' } : {}),
  };
  const c: Config = { ...DEFAULTS, ...fromFile, ...fromEnv, ...overrides, dataDir };
  if (!MODES.includes(c.mode)) throw new Error(`mode must be one of ${MODES.join(', ')}, not "${c.mode}".`);
  if (!['off', 'charts', 'songs'].includes(c.songSharing)) throw new Error('songSharing must be off, charts or songs.');
  if (!(c.songMaxMb > 0) || !(c.quotaMb > 0)) throw new Error('songMaxMb and quotaMb must be more than 0.');
  if (!(c.partyCacheMb > 0) || !(c.partyCacheDays > 0)) throw new Error('partyCacheMb and partyCacheDays must be more than 0.');
  if (c.mode === 'password' && !c.password) throw new Error('mode "password" needs a password (SOUNDWAVE_PASSWORD).');
  if (!Number.isInteger(c.port) || c.port < 0 || c.port > 65535) throw new Error(`port must be a number from 0 to 65535.`);
  if (!c.publicUrl) c.publicUrl = `http://localhost:${c.port}`;
  c.publicUrl = c.publicUrl.replace(/\/+$/, '');
  c.webGameUrl = c.webGameUrl.replace(/\/+$/, '');
  return c;
}
