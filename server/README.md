# Soundwave server

A server for playing Soundwave together: accounts, and parties that play a set at the same moment
with a live board and shared results. Anyone can run one, on a home PC, a small VPS or a NAS. The
design is in [docs/specs/online-play.md](../docs/specs/online-play.md) (levels 2 and 3).

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
| `mode`        | `SOUNDWAVE_MODE`        | `invite`            | Who can make an account: `public`, `password`, `invite` or `key`.         |
| `password`    | `SOUNDWAVE_PASSWORD`    |                     | The password making an account needs, in `password` mode.                 |
| `publicUrl`   | `SOUNDWAVE_PUBLIC_URL`  | `http://localhost…` | The address players use, written into invite links and key files.         |
| `trustProxy`  | `SOUNDWAVE_TRUST_PROXY` | `false`             | Behind a proxy: take players' addresses (for rate limits) from the proxy. |
| (data folder) | `SOUNDWAVE_DATA`        | `./data`            | Where the database and the server's signing secret live. Back this up.    |

The modes:

- **public**: anyone with the address can make an account.
- **password**: making an account needs the server's password.
- **invite**: making an account needs an invite, which any player on the server can make
  (`POST /invites`), or a key file.
- **key**: making an account needs a key file, which the owner and moderators make (`POST /keys`).
  A key file holds the server's address and a signed token; opening it in the game connects and
  fills in the sign-up.

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
Argon2id hash; sign-ins as hashes of their tokens; invites and key files; bans; the moderation log.
Parties live in memory and are gone when the server stops. There is no telemetry. A player can save
everything the server holds about them from the game (**Save my data**, `GET /me/export`) and delete
their account (`DELETE /me`).

## Protocol

The messages are in [src/net/protocol.ts](../src/net/protocol.ts), shared with the game. A game and a
server with different `PROTOCOL_VERSION`s refuse each other with a sentence saying which one to update.
