/**
 * A first look at what a server sends over the socket, before the game believes it: the screens
 * read these messages straight into React, so a server with a bug (or one made to do harm) that
 * sends a party with no players list would otherwise take the whole game down, and again on every
 * start, as the game connects by itself. Only the shape is checked here: the fields the game reads
 * are there and of their kind. Charts get their own, closer look (cleanChart, chart/clean.ts).
 */
import type { ServerMessage } from './protocol';

type Obj = Record<string, unknown>;
const obj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max = 10_000): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const list = (v: unknown, each: (x: unknown) => boolean, max = 10_000) => Array.isArray(v) && v.length <= max && v.every(each);
const opt = (v: unknown, test: (x: unknown) => boolean) => v === undefined || test(v);

const account = (v: unknown) => obj(v) && str(v.id) && str(v.name) && str(v.role);
const setSong = (v: unknown) => obj(v) && str(v.id) && str(v.title) && str(v.artist) && num(v.duration);
const member = (v: unknown) =>
  obj(v) &&
  str(v.id) &&
  str(v.name) &&
  str(v.part) &&
  str(v.difficulty) &&
  typeof v.ready === 'boolean' &&
  list(v.have, (x) => str(x)) &&
  typeof v.connected === 'boolean' &&
  opt(v.avatar, obj) &&
  opt(v.picks, (p) => list(p, setSong));
const resultLine = (v: unknown) => obj(v) && str(v.id) && str(v.name);
const songResults = (v: unknown) => obj(v) && num(v.songIndex) && list(v.lines, resultLine);
const party = (v: unknown) =>
  obj(v) &&
  str(v.code) &&
  str(v.host) &&
  list(v.members, member, 64) &&
  list(v.set, setSong, 1000) &&
  (v.phase === 'lobby' || v.phase === 'playing' || v.phase === 'results') &&
  num(v.songIndex) &&
  list(v.results, songResults, 1000) &&
  (v.mode === null || str(v.mode)) &&
  (v.showdown === null || v.showdown === undefined || obj(v.showdown));
const boardLine = (v: unknown) => obj(v) && str(v.id) && num(v.score);

/** Whether `m` has the shape of a message the game understands; one that does not is left unread. */
export function wellFormed(m: unknown): m is ServerMessage {
  if (!obj(m)) return false;
  switch (m.type) {
    case 'welcome':
      return account(m.you);
    case 'you':
      return account(m.you);
    case 'changed':
      return list(m.topics, (x) => str(x)) && opt(m.songs, (s) => list(s, (x) => str(x)));
    case 'pong':
      return num(m.t) && num(m.serverT);
    case 'party':
      return m.party === null || party(m.party);
    case 'start':
      return num(m.songIndex) && num(m.at) && (m.chart === null || obj(m.chart));
    case 'board':
      return num(m.songIndex) && list(m.lines, boardLine, 64);
    case 'error':
      return str(m.message);
    case 'bye':
      return str(m.reason);
    case 'struck':
      return num(m.songIndex) && (m.target === null || str(m.target)) && opt(m.ms, num);
    case 'hit':
      return num(m.songIndex) && str(m.from) && num(m.at) && num(m.ms);
    case 'strikeFired':
      return num(m.songIndex) && str(m.from) && str(m.to) && num(m.at);
    case 'cheer':
      return str(m.from);
    default:
      return false;
  }
}
