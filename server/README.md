# Soundwave server

<picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Node-24.7%2B-green.svg?logo=nodedotjs&amp;mode=dark"><img alt="Node 24.7 or newer" src="https://shieldcn.dev/badge/Node-24.7%2B-green.svg?logo=nodedotjs&amp;mode=light"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Docker-ready-blue.svg?logo=docker&amp;mode=dark"><img alt="Docker ready" src="https://shieldcn.dev/badge/Docker-ready-blue.svg?logo=docker&amp;mode=light"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/database-SQLite-blue.svg?logo=sqlite&amp;mode=dark"><img alt="SQLite" src="https://shieldcn.dev/badge/database-SQLite-blue.svg?logo=sqlite&amp;mode=light"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/servers-self--hosted-violet.svg?mode=dark"><img alt="Servers: self-hosted" src="https://shieldcn.dev/badge/servers-self--hosted-violet.svg?mode=light"></picture>

A server for playing Soundwave together: accounts, parties that play a set at the same moment with a
live board, Showdowns, leaderboards checked from each run, and a shared song library if you want one.
Anyone can run one, on a home PC, a small VPS or a NAS. There is no central server, and none is run
by the project: every server is someone's own. The design is in
[docs/specs/online-play.md](../docs/specs/online-play.md).

**Setting one up?** Follow the step-by-step guide: **[docs/server-setup.md](../docs/server-setup.md)**
(Coolify, Docker Compose with HTTPS, or your own PC; becoming its owner; inviting friends; updates,
backups and troubleshooting). This file is the reference.

It is TypeScript run directly by Node (24.7 or newer), with one dependency (`ws`). Everything it
keeps is in one SQLite database in its data folder.

## Quick start

```bash
pnpm install
node server/src/main.ts          # data in ./data, port 7420
```

Or with Docker, from the repository's root:

```bash
docker build -f server/Dockerfile -t soundwave-server .
docker run -d --name soundwave -p 7420:7420 -v soundwave-data:/data \
  -e SOUNDWAVE_NAME="Our server" -e SOUNDWAVE_PUBLIC_URL=https://play.example.com soundwave-server
```

The repository's `docker-compose.yml` builds the same image for Docker Compose and **Coolify** (a
_Docker Compose_ resource from this repository): it keeps everything in the named volume
`soundwave-data`, checks the server's health at `GET /health`, and takes the domain Coolify gives the
service as the server's public address.

The first start prints a **set-up code**. Make an account with it (in the game: the Online tab,
connect, **I'm new here**, and the code in the invite field) and that account becomes the owner. It
works once, and is printed on every start until the owner exists.

## Settings

`soundwave-server.json` in the data folder, or environment variables (which win). Restart the server
after a change.

| Setting          | Variable                     | Default             | What it is                                                                                       |
| ---------------- | ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------ |
| `name`           | `SOUNDWAVE_NAME`             | `Soundwave server`  | Shown in the game.                                                                               |
| `description`    | `SOUNDWAVE_DESCRIPTION`      |                     | One line about the server.                                                                       |
| `port`           | `PORT`                       | `7420`              |                                                                                                  |
| `host`           | `HOST`                       | `0.0.0.0`           |                                                                                                  |
| `mode`           | `SOUNDWAVE_MODE`             | `invite`            | Who can make an account: `public`, `password` or `invite`.                                       |
| `password`       | `SOUNDWAVE_PASSWORD`         |                     | The password making an account needs, in `password` mode.                                        |
| `publicUrl`      | `SOUNDWAVE_PUBLIC_URL`       | `http://localhost…` | The address players use, written into invite links and used by the sign-in page. Set it.         |
| `webGameUrl`     | `SOUNDWAVE_WEB_GAME`         | the game's website  | The web game an invite link offers, and the only website the sign-in page sends players back to. |
| `trustProxy`     | `SOUNDWAVE_TRUST_PROXY`      | `false`             | Behind a proxy: take players' addresses (for rate limits) from the proxy.                        |
| `songSharing`    | `SOUNDWAVE_SONG_SHARING`     | `off`               | `songs`, `charts` or `off`: see [Shared songs](#shared-songs).                                   |
| `songMaxMb`      | `SOUNDWAVE_SONG_MAX_MB`      | `100`               | The largest song file, MB.                                                                       |
| `quotaMb`        | `SOUNDWAVE_QUOTA_MB`         | `2000`              | What each player may share in all, MB.                                                           |
| `publicCovers`   | `SOUNDWAVE_PUBLIC_COVERS`    | `false`             | Serve song covers without signing in (for Discord statuses).                                     |
| `partySongs`     | `SOUNDWAVE_PARTY_SONGS`      | `true`              | Pass a party's songs on to its players: see [A party's songs](#a-partys-songs).                  |
| `partyCacheMb`   | `SOUNDWAVE_PARTY_CACHE_MB`   | `4000`              | The most the party song cache holds, MB.                                                         |
| `partyCacheDays` | `SOUNDWAVE_PARTY_CACHE_DAYS` | `7`                 | How long a party's song is kept after it was last used.                                          |
| (data folder)    | `SOUNDWAVE_DATA`             | `./data`            | Where the database (with the server's signing secret) and its files live. Back this up.          |

The modes:

- **public**: anyone with the address can make an account.
- **password**: making an account needs the server's password, or an invite.
- **invite**: making an account needs an invite.

## Signing in

Players sign in on the server's own page, in their browser (`GET /login`), so their password manager
fills it in and saves new passwords. The game opens the page with the hash of a secret it keeps
(PKCE, S256) and where to come back to: `soundwave://auth` for the desktop app, or the web game's
own page. Signed in, the page hands the game a one-time code (valid two minutes, used once), and the
game trades it with its secret for its tokens (`POST /auth/exchange`). The code is worth nothing
without that secret, and the page sends codes nowhere but the desktop app, the web game named by
`webGameUrl`, and the player's own machine. The page runs no script and cannot be framed.

The game's own sign-in form (`POST /auth/signin`, `/auth/signup`) stays for older games and as a
fallback.

## Invite links

An invite is a link to the server's own join page, `https://play.example.com/join?invite=…`, so it
works with nothing hosted anywhere else. The page offers to open the desktop app (it follows
`soundwave://join?…` links), to play in the browser (the web game, with the invite filled in), or to
paste the link into the game by hand. The game takes the whole link wherever it asks for a server's
address, and the sign-up page takes it in its invite field.

On an invite-only server every player can make invites (Online tab → **Invite**), each for one
account and a week. The owner and moderators make them in any mode (Admin → **Invites**), for one
person, a group of ten, or with no limit to post for a whole community. An invite lets its holder
past a server password too.

## Leaderboards

A finished song comes with its run, the inputs as they were played. The server plays them into the
game's own judging (it runs `src/game/` as it is, so a score is checked by exactly the rules it was
played by) and takes the score only if it comes out exactly the same: there is no tolerance for a
cheat to use. Boards are per song, chart (a hash of its notes), part and difficulty, all time and
this week. Any run on a board can be watched, and players can share runs to the server's replay
list. The owner and moderators remove cheated runs.

## Profiles

A player's look on the stage is three colours (`GET` and `PUT /me/profile`, body
`{ avatar: { top, bottom, finish } }`, `null` for none). Their party sees it at once.

## Showdown

A party's host can make it a Showdown: scores count as a share of each chart's par, the lowest
players go out after each song, and (with hits on) the overdrive button strikes the player above.
The server decides whom a Strike hits and for how long. The host can play the server's Showdown
rotation instead of their own set: the owner and moderators set it on the Admin page (**Showdown
rotation**; `GET` and `POST /showdown/rotation`, body `{ songs }`).

## Shared songs

Off by default. Sharing music with others can infringe copyright, and you answer for what your
server hands out, so turning it on is your decision: set `songSharing` to `songs` for whole songs,
audio included, or `charts` to keep everything but the audio (a player then adds their own copy of
the very same recording, which the game checks). `songMaxMb` limits one song, `quotaMb` what each
player shares in all. Every song records who shared it and when; players can report a song, and the
uploader, you or a moderator can remove it everywhere at once.

With `publicCovers` on, song covers are served without signing in, so a player's Discord status can
show the cover of the song they play. Only covers, never audio.

The owner and moderators keep the server's own library (Admin → **Server library**), whatever players
may share: songs they add keep their audio and count against no quota. Every song has its own id on
the server (`uid`) and the SHA-256 of the file the server keeps (`hash`). Renaming a song writes its
file anew, so its hash changes, and every game that downloaded it takes the new details over the
next time it signs in: the server is the single point of truth for its songs.

**Streaming quality.** A whole song can also be kept in two smaller copies for players on a slow
connection (Settings → Online → Streaming quality): `medium` (AAC at 128 kbit/s) and `low`
(64 kbit/s, or 96 where the encoder goes no lower). The server has no audio encoder, so it does not make them: the game of whoever shared
the song, or of the owner or a moderator, makes them in the background (lined up with the song to
the sample, so the notes stay in time) and sends them. Until a song has them, it streams as shared.
They are kept next to the song (`songs/<id>.medium.soundwave`, `<id>.low.soundwave`) and go with it.

## A party's songs

A player can only play a song they have. So, on by default, a party's songs are passed on through the
server: when a player in a party lacks one of the set's songs, the host's game sends it here (unless
the host turned that off in Settings → Online), and the game of every player without it downloads it
by itself. This is separate from shared songs: nothing lists these songs, and only the players of a
party with the song in its set can send or get it. The server checks that the file holds the song
its id names.

They are a cache, kept in `party-songs/` in the data folder: a song goes `partyCacheDays` after it
was last used, and the least recently used go first once the cache passes `partyCacheMb`. Turn it off
with `partySongs: false`; players without a song then sit it out. `songMaxMb` limits one song here
too.

## HTTPS

The server speaks plain HTTP. The game connects over plain HTTP only to a server on the player's own
machine or network; anywhere else it needs HTTPS, so passwords never travel in the clear. Put the
server behind a proxy that adds HTTPS and passes WebSockets on (`/ws`). With
[Caddy](https://caddyserver.com), which gets certificates by itself, the whole `Caddyfile` is:

```
play.example.com {
	reverse_proxy localhost:7420
}
```

and set `SOUNDWAVE_PUBLIC_URL=https://play.example.com` and `SOUNDWAVE_TRUST_PROXY=1`. Coolify does
both for you. nginx needs the WebSocket headers: see
[the setup guide](../docs/server-setup.md#b-docker-compose-on-a-vps).

## Moderation

The owner names more admins (role `owner`: each can do all the first one can) and moderators;
admins and moderators remove players from the server, ban them (for a time or for good)
and read the log of every moderation action, which records who did what to whom, when and why. In
the game this is all on the **Admin** page (`M` on the Online tab): the players list, invites, the
server library, the Showdown rotation, the moderation log and reported songs. The API takes a
signed-in owner's or moderator's access token:

| Request                            | Body                                                        |
| ---------------------------------- | ----------------------------------------------------------- |
| `GET /mod/users`                   | Every account, with its role, bans and whether it is online |
| `POST /mod/kick`                   | `{ name, reason? }`                                         |
| `POST /mod/ban`                    | `{ name, hours?, reason? }` (no hours: for good)            |
| `POST /mod/unban`                  | `{ name, reason? }`                                         |
| `POST /mod/role` (owner)           | `{ name, role: "owner" \| "moderator" \| "player" }`        |
| `POST /mod/reset-password` (owner) | `{ name }`: answers a new password to pass on               |
| `GET /mod/audit`                   | The moderation log                                          |
| `GET /mod/reports`                 | Reported songs                                              |

Moderators can only act on players, and admins on anyone but admins. An admin steps down only
themselves (`/mod/role` with their own name), and never as the server's last admin; the last admin's
account cannot be deleted either.

## What it keeps

Only what the features need: each account's name, role, when it was made, and its password as an
Argon2id hash; sign-ins as hashes of their tokens; invites; bans; the moderation log; scores with
their runs; shared songs. Parties live in memory and are gone when the server stops. There is no
telemetry. A player can save everything the server holds about them from the game (**Save my
data**, `GET /me/export`) and delete their account (`DELETE /me`).

## API

Every request but `/health`, `/info`, the join and sign-in pages, signing up and in, and public covers
needs a signed-in player's access token (`Authorization: Bearer …`). Bodies and answers are JSON
unless said otherwise.

| Request                                              | What it does                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /health`                                        | `{ ok, players, parties, users }` while the server and its database work           |
| `GET /info`                                          | The server's name, description, join mode, protocol version, players online        |
| `GET /join?invite=…`                                 | The join page an invite link opens (HTML)                                          |
| `GET /login`, `POST /login`                          | The sign-in and sign-up page the game opens in the browser (HTML, a plain form)    |
| `POST /auth/exchange`                                | Trade a sign-in page's code and the game's secret for tokens: `{ code, verifier }` |
| `POST /auth/signup`, `/auth/signin`, `/auth/refresh` | Make an account, sign in, trade a refresh token for new tokens                     |
| `GET /me`, `DELETE /me`                              | The signed-in account; delete it and everything with it                            |
| `GET /me/export`                                     | Everything held about the player: a zip with a README (`application/zip`)          |
| `GET /me/profile`, `PUT /me/profile`                 | The player's avatar: `{ avatar: { top, bottom, finish } \| null }`                 |
| `GET /presence`                                      | Who is online and what they are doing                                              |
| `POST /invites`                                      | Make an invite link: `{ uses?, hours? }`                                           |
| `POST /scores`                                       | A finished run, judged again before it is taken                                    |
| `GET /boards/top`                                    | The week's top players                                                             |
| `GET /boards/:songId`                                | The charts of a song that have boards                                              |
| `GET /boards/:songId/:chartId/:part/:difficulty`     | A board (`?week=1` for this week's)                                                |
| `GET /scores/:id/run`                                | A run on a board, to watch it                                                      |
| `POST /scores/:id/share`                             | Share your run to the replay list, or not: `{ shared }`                            |
| `DELETE /scores/:id?reason=…`                        | Remove a cheated run (owner and moderators)                                        |
| `GET /replays?song=…`                                | The replays players shared                                                         |
| `GET /showdown/rotation`, `POST /showdown/rotation`  | The Showdown rotation; set it (owner and moderators): `{ songs }`                  |
| `GET /songs?q=…`, `POST /songs`                      | Shared songs; share one (the `.soundwave` file as the body)                        |
| `POST /songs/:id/edit`                               | Rename a song (owner, moderators): its file and hash change, copies follow         |
| `GET /songs/:id/file`, `GET /songs/:id/charts`       | A shared song's file (`?quality=medium\|low` for a smaller copy), or its charts    |
| `PUT /songs/:id/copies/:quality`                     | Send a smaller copy for streaming (its sharer, the owner, moderators)              |
| `POST /songs/:id/report`, `DELETE /songs/:id`        | Report a song; remove it (its uploader, the owner, moderators)                     |
| `GET /covers/:songId.jpg`                            | A shared song's cover (public with `publicCovers`)                                 |
| `PUT /party/songs/:id`, `GET /party/songs/:id`       | Send one of your party's songs to the server; get it (party players only)          |
| `GET /mod/…`, `POST /mod/…`                          | Moderation, see above                                                              |
| `/ws`                                                | The WebSocket: parties and Showdown (see Protocol)                                 |

## Protocol

The messages are in [src/net/protocol.ts](../src/net/protocol.ts), shared with the game. A game and a
server with different `PROTOCOL_VERSION`s refuse each other with a sentence saying which one to update.

**Live updates.** Every game online hears, over its WebSocket, what changed on the server: a
`changed` message names the topics (`songs`, `rotation`, `replays`, `boards`, `presence`, and for the
owner and moderators `users`, `log` and `reports`), gathered over a quarter of a second, and the game
fetches just those again. A player whose role an admin changed gets `you` with their account. Only
the names of what changed are sent, never the data.
