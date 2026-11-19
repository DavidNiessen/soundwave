# Soundwave server

A server for playing Soundwave together: accounts, and parties that play a set at the same moment
with a live board and shared results. Anyone can run one, on a home PC, a small VPS or a NAS; there
is no central server, and none run by the project: every server is someone's own. The design is in
[docs/specs/online-play.md](../docs/specs/online-play.md) (levels 2 and 3).

It is TypeScript run directly by Node (24.7 or newer), with one dependency (`ws`). Everything it
keeps is in one SQLite file in its data folder.

## Running it

From the repository:

```bash
pnpm install
node server/src/main.ts          # data in ./data, port 7420
```

With Docker, from the repository's root:

```bash
docker build -f server/Dockerfile -t soundwave-server .
docker run -d --name soundwave -p 7420:7420 -v soundwave-data:/data \
  -e SOUNDWAVE_NAME="Our server" -e SOUNDWAVE_PUBLIC_URL=https://play.example.com soundwave-server
```

The first start prints a **set-up code**. In the game, open **Play together**, connect to the
server, choose **Make an account** and enter the code: that account becomes the owner. It works
once. (`docker logs soundwave` shows it.)

## Settings

`soundwave-server.json` in the data folder, or environment variables (which win):

| Setting       | Variable                | Default             | What it is                                                                |
| ------------- | ----------------------- | ------------------- | ------------------------------------------------------------------------- |
| `name`        | `SOUNDWAVE_NAME`        | `Soundwave server`  | Shown in the game.                                                        |
| `description` | `SOUNDWAVE_DESCRIPTION` |                     | One line about the server.                                                |
| `port`        | `PORT`                  | `7420`              |                                                                           |
| `host`        | `HOST`                  | `0.0.0.0`           |                                                                           |
| `mode`        | `SOUNDWAVE_MODE`        | `invite`            | Who can make an account: `public`, `password` or `invite`.                |
| `password`    | `SOUNDWAVE_PASSWORD`    |                     | The password making an account needs, in `password` mode.                 |
| `publicUrl`   | `SOUNDWAVE_PUBLIC_URL`  | `http://localhost…` | The address players use, written into invite links. Set it.               |
| `webGameUrl`  | `SOUNDWAVE_WEB_GAME`    | the game's website  | The web game an invite link offers, for your own copy of it.              |
| `trustProxy`  | `SOUNDWAVE_TRUST_PROXY` | `false`             | Behind a proxy: take players' addresses (for rate limits) from the proxy. |
| (data folder) | `SOUNDWAVE_DATA`        | `./data`            | Where the database and the server's signing secret live. Back this up.    |

The modes:

- **public**: anyone with the address can make an account.
- **password**: making an account needs the server's password, or an invite.
- **invite**: making an account needs an invite.

## Invite links

An invite is a link to the server's own join page, `https://play.example.com/join?invite=…`, so it
works with nothing hosted anywhere else. The page offers to open the desktop app (it follows
`soundwave://join?…` links), to play in the browser (the web game, with the invite filled in), or to
paste the link into **Play together** by hand. The game takes the whole link wherever it asks for a
server's address.

In the game, under **Play together → Invite friends**: on an invite-only server every player can
make invites, each for one account and a week. The owner and moderators can make them in any mode,
for as many accounts and as long as they choose, or with no limit, to post for a whole community.
An invite lets its holder past a server password too.

## Leaderboards

A finished song comes with its run, the inputs as they were played. The server plays them into the
game's own judging (it runs `src/game/` as it is, so a score is checked by exactly the rules it was
played by) and takes the score only if it comes out exactly the same: there is no tolerance for a
cheat to use. Boards are per song, chart (a hash of its notes), part and difficulty, all time and
this week. Any run on a board can be watched, and players can share runs to the server's replay
list. The owner and moderators remove cheated runs.

## Profiles

A player's look on the stage is three colours (`GET` and `PUT /me/profile`, body `{ avatar: { top, bottom, finish } }`,
`null` for none). Their party sees it at once.

## Showdown

A party's host can make it a Showdown: scores count as a share of each chart's par, the lowest
players go out after each song, and (with hits on) the overdrive button strikes the player above.
The server decides whom a Strike hits and for how long. The host can play the server's Showdown
rotation instead of their own set: the owner and moderators set it under **Play together → Run
the server** (`GET` and `POST /showdown/rotation`, body `{ songs }`).

## Shared songs

Off by default. Sharing music with others can infringe copyright, and you answer for what your
server hands out, so turning it on is your decision: set `songSharing` (`SOUNDWAVE_SONG_SHARING`) to
`songs` for whole songs, audio included, or `charts` to keep everything but the audio (a player then
adds their own copy of the very same recording, which the game checks). `songMaxMb` limits one song,
`quotaMb` what each player shares in all. Every song records who shared it and when; players can
report a song, and the uploader, you or a moderator can remove it everywhere at once.

With `publicCovers` (`SOUNDWAVE_PUBLIC_COVERS`) on, song covers are served without signing in, so a
player's Discord status can show the cover of the song they play. Only covers, never audio.

In a party, a player without one of the set's songs can get it: from the library when it is there,
otherwise the host's game shares it for them (if the host lets it, in Settings → Online, and the
server takes whole songs).

## HTTPS

The server speaks plain HTTP. The game connects over plain HTTP only to a server on the player's
own machine or network; anywhere else it needs HTTPS, so passwords never travel in the clear. Put
the server behind a proxy that adds HTTPS. With [Caddy](https://caddyserver.com), which gets
certificates by itself, the whole `Caddyfile` is:

```
play.example.com {
	reverse_proxy localhost:7420
}
```

and set `SOUNDWAVE_PUBLIC_URL=https://play.example.com` and `SOUNDWAVE_TRUST_PROXY=1`.

## Moderation

The owner names moderators; both can remove players from the server, ban them (for a time or for
good) and read the log of every moderation action, which records who did what to whom, when and
why. The game has no screens for this yet; the API takes a signed-in owner's or moderator's access
token:

| Request                            | Body                                             |
| ---------------------------------- | ------------------------------------------------ |
| `POST /mod/kick`                   | `{ name, reason? }`                              |
| `POST /mod/ban`                    | `{ name, hours?, reason? }` (no hours: for good) |
| `POST /mod/unban`                  | `{ name, reason? }`                              |
| `POST /mod/role` (owner)           | `{ name, role: "moderator" \| "player" }`        |
| `POST /mod/reset-password` (owner) | `{ name }`: answers a new password to pass on    |
| `GET /mod/audit`                   |                                                  |

## What it keeps

Only what the features need: each account's name, role, when it was made, and its password as an
Argon2id hash; sign-ins as hashes of their tokens; invites; bans; the moderation log.
Parties live in memory and are gone when the server stops. There is no telemetry. A player can save
everything the server holds about them from the game (**Save my data**, `GET /me/export`) and delete
their account (`DELETE /me`).

## Protocol

The messages are in [src/net/protocol.ts](../src/net/protocol.ts), shared with the game. A game and a
server with different `PROTOCOL_VERSION`s refuse each other with a sentence saying which one to update.
