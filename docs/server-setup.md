# Setting up a Soundwave server

<picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Node-24.7%2B-green.svg?logo=nodedotjs&amp;mode=dark"><img alt="Node 24.7 or newer" src="https://shieldcn.dev/badge/Node-24.7%2B-green.svg?logo=nodedotjs&amp;mode=light"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Docker-ready-blue.svg?logo=docker&amp;mode=dark"><img alt="Docker ready" src="https://shieldcn.dev/badge/Docker-ready-blue.svg?logo=docker&amp;mode=light"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/Coolify-one_click-violet.svg?logo=docker&amp;mode=dark"><img alt="Coolify in one resource" src="https://shieldcn.dev/badge/Coolify-one_click-violet.svg?logo=docker&amp;mode=light"></picture>

A Soundwave server is what you and your friends play together on: accounts, parties, Showdowns,
leaderboards and, if you want, a shared song library. Nobody runs one for you. There is no central
server, so every server is someone's own, and this guide gets yours running.

It takes about ten minutes on a server you already have. The server is one small program (Node, with
one dependency) that keeps everything in a single folder. It needs very little: a few hundred MB of
memory, and disk space for the songs it holds if you turn song sharing on.

**Contents**

1. [Pick where it runs](#1-pick-where-it-runs)
2. [Install it](#2-install-it): [Coolify](#a-coolify), [Docker Compose on a VPS](#b-docker-compose-on-a-vps), [your own PC](#c-your-own-pc)
3. [Become its owner](#3-become-its-owner)
4. [Invite your friends](#4-invite-your-friends)
5. [Choose your settings](#5-choose-your-settings)
6. [Run it day to day](#6-run-it-day-to-day): updates, backups, moderation
7. [Troubleshooting](#7-troubleshooting)

The full list of settings and the API are in [server/README.md](../server/README.md).

## 1. Pick where it runs

| Where                         | Good for                                                | What you need                                                                   |
| ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Coolify** (on your own VPS) | The easiest way to a server on the internet             | A Coolify instance and a domain it can give the server                          |
| **A VPS with Docker Compose** | Any Linux server you control                            | Docker, a domain pointing at the server, and Caddy (or another proxy) for HTTPS |
| **Your own PC**               | Playing with people in the same house, or trying it out | Node 24.7 or newer, or Docker                                                   |

**The game needs HTTPS for any server outside your own network**, so passwords never travel in the
clear. On your own network (addresses like `192.168.x.x`, `10.x.x.x`, `something.local` or
`localhost`) plain HTTP is fine. Coolify and Caddy get the certificate for you.

## 2. Install it

### A. Coolify

1. In Coolify, add a **new resource** of the type **Docker Compose**, from this repository
   (`https://github.com/DavidNiessen/soundwave`). Coolify reads the `docker-compose.yml` in its root.
2. Give the service a domain, for example `https://play.example.com`. Coolify routes it to the
   server's port, gets the HTTPS certificate, and passes the address on to the server as its public
   address (it goes into invite links and the sign-in page).
3. Set the environment variables you want (see [step 5](#5-choose-your-settings)). At least:
   - `SOUNDWAVE_NAME`: what players see, for example `Friday Night Band`.
   - `SOUNDWAVE_MODE`: `invite` (the default), `password` or `public`.
4. **Deploy.** Coolify builds the image, starts the server and waits until it answers its health
   check (`GET /health`).
5. Open the service's **logs** and find the **set-up code** (see [step 3](#3-become-its-owner)).

Everything the server keeps is in the named volume `soundwave-data`, so accounts, scores and songs
survive redeploys and updates.

### B. Docker Compose on a VPS

You need a Linux server with Docker, and a domain (or subdomain) whose DNS points at it.

1. Get the repository onto the server:

   ```bash
   git clone https://github.com/DavidNiessen/soundwave.git
   cd soundwave
   ```

2. Make a file named `.env` next to `docker-compose.yml`:

   ```bash
   SOUNDWAVE_PUBLIC_URL=https://play.example.com
   SOUNDWAVE_NAME=Friday Night Band
   SOUNDWAVE_MODE=invite
   ```

3. In `docker-compose.yml`, replace `expose: ['7420']` with a port only the proxy on this machine
   can reach:

   ```yaml
   ports:
     - '127.0.0.1:7420:7420'
   ```

4. Start it:

   ```bash
   docker compose up -d
   docker compose logs soundwave    # the set-up code is in here
   ```

5. Put HTTPS in front of it. With [Caddy](https://caddyserver.com), which gets the certificate by
   itself, the whole `Caddyfile` is:

   ```
   play.example.com {
   	reverse_proxy localhost:7420
   }
   ```

   Open ports 80 and 443 in the firewall, not 7420. Using nginx instead? Pass WebSockets through, or
   parties will not connect:

   ```nginx
   location / {
       proxy_pass http://127.0.0.1:7420;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
   }
   ```

The compose file already sets `SOUNDWAVE_TRUST_PROXY=true`, so the server counts its rate limits
per player rather than per proxy.

### C. Your own PC

For your own network, or to try it out. You need [Node.js](https://nodejs.org/) 24.7 or newer
and [pnpm](https://pnpm.io/).

```bash
git clone https://github.com/DavidNiessen/soundwave.git
cd soundwave
pnpm install
node server/src/main.ts
```

It listens on port 7420 and keeps its data in `./data`. Friends on the same network connect to
your PC's address, for example `192.168.1.20:7420` (`ipconfig` on Windows or `ip addr` on Linux
shows it). To change anything, set environment variables before the command, for example
`SOUNDWAVE_NAME="Living room" node server/src/main.ts`, or write them into
`data/soundwave-server.json` (see [server/README.md](../server/README.md#settings)).

With Docker instead of Node:

```bash
docker build -f server/Dockerfile -t soundwave-server .
docker run -d --name soundwave -p 7420:7420 -v soundwave-data:/data soundwave-server
docker logs soundwave    # the set-up code
```

To let friends in from outside your network, you need what a VPS has: a domain, a forwarded port
and HTTPS. A small VPS or Coolify is usually simpler.

## 3. Become its owner

The first time it starts, the server prints a **set-up code**:

```
Friday Night Band is running on port 7420 (invite mode).
Players connect to https://play.example.com

This server has no owner yet. Make the owner account in the game: connect to the server,
choose "Make an account", and enter this set-up code as the invite. It works once.
  Set-up code: 7c1fQ2-…
```

1. In Soundwave, open the **Online** tab and type your server's address (`play.example.com`), then
   press **Connect**.
2. Choose **I'm new here: make an account**. The game opens your server's own sign-up page in your
   browser, where your password manager can save the new password.
3. Pick a name and a password (at least 8 characters), and enter the **set-up code** in the invite
   field.
4. You come back to the game signed in, as the server's **owner** (shown as Admin). The code is
   spent: nobody else can use it.

The owner can do everything on the **Admin** page (`M` on the Online tab), and names moderators.

## 4. Invite your friends

How people get an account depends on the server's mode (`SOUNDWAVE_MODE`):

| Mode       | Who can make an account                                                |
| ---------- | ---------------------------------------------------------------------- |
| `invite`   | Only people with an invite link (the default)                          |
| `password` | Anyone with the server's password (`SOUNDWAVE_PASSWORD`), or an invite |
| `public`   | Anyone with the address                                                |

**Making an invite link:** Admin → **Invites**. Pick who it is for:

- **One person**: works once, for a week.
- **A group**: 10 accounts, for a week.
- **A community**: no limit. Post it in your Discord server.

Copy the link and send it. It opens your server's own join page, which offers to open the desktop
app, to play in the browser, or to paste the link in by hand. Any player can also make one-time
invites on an invite-only server (Online tab → **Invite**).

Once your friends are in, start a party on the Online tab and share its code, or let Discord
friends join from your status (the **Let Discord friends join** switch in the party lobby, desktop
app only).

## 5. Choose your settings

Set these as environment variables (in Coolify, in `.env`, or before the command), or in
`soundwave-server.json` in the data folder. Environment variables win. The ones you are most likely
to want:

| Variable                 | Default                         | What it does                                                                                             |
| ------------------------ | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `SOUNDWAVE_NAME`         | `Soundwave server`              | The name players see.                                                                                    |
| `SOUNDWAVE_DESCRIPTION`  |                                 | One line about the server.                                                                               |
| `SOUNDWAVE_MODE`         | `invite`                        | Who can make an account: `invite`, `password` or `public`.                                               |
| `SOUNDWAVE_PASSWORD`     |                                 | The server's password, in `password` mode.                                                               |
| `SOUNDWAVE_PUBLIC_URL`   | Coolify's domain                | The address players use (`https://…`). Invite links and the sign-in page use it. Set it outside Coolify. |
| `SOUNDWAVE_SONG_SHARING` | `off`                           | `songs` lets players share whole songs, `charts` everything but the audio. See below.                    |
| `SOUNDWAVE_PARTY_SONGS`  | `true`                          | Pass a party's songs on to players who don't have them.                                                  |
| `SOUNDWAVE_WEB_GAME`     | `https://soundwave.niessen.dev` | The web game invite links offer, and the only website sign-in sends players back to.                     |

The rest (song size limits, the party song cache, public covers for Discord) is in
[server/README.md](../server/README.md#settings). Restart the server after changing a setting;
in Coolify, redeploy.

**About song sharing.** It is off by default, because sharing music can infringe copyright, and you
answer for what your server hands out. With it on, players can share songs from their library and
everyone on the server can stream or download them; the owner and moderators keep the server's own
library on the Admin page. A party's songs reaching the players who lack them
(`SOUNDWAVE_PARTY_SONGS`) is a separate, temporary cache only that party can use.

## 6. Run it day to day

**Updating.** Update the server when the game tells players "This server runs an older version than
your game", or when you want new features.

- Coolify: **Redeploy**. The data volume stays.
- Docker Compose: `git pull`, then `docker compose up -d --build`.
- Node: `git pull`, `pnpm install`, and start it again.

A game and a server of different versions refuse each other with a sentence saying which one to
update, so nobody plays on a mismatch by accident.

**Backups.** Everything is in the data folder: the database (`soundwave.db`, which also holds the
secret sign-ins are signed with), shared songs and their covers, and the party song cache, which can
be lost without harm. Back up the `soundwave-data` volume (or `./data`). Stop the server first, or
copy `soundwave.db` together with its `-wal` and `-shm` files.

**Moderation.** On the **Admin** page:

- **Players**: find anyone, remove them, ban them (an hour, a day, a week or for good), lift a ban.
  The owner can also name moderators and reset a forgotten password (there are no emails: you pass
  the new one on).
- **Moderation log**: everything the owner and moderators did, with the reasons.
- **Reported songs**: songs players asked to have taken down, to remove everywhere at once.
- **Server library** and **Showdown rotation**: the songs everyone can play, and the set a
  Showdown plays when its host picks the server's.

**Health.** `GET /health` answers `{ "ok": true, … }` with the number of players and parties while
the server and its database work. Docker and Coolify use it to know when the server is up, and
show it as unhealthy when it stops answering.

## 7. Troubleshooting

| What you see                                                                | What it means, and what to do                                                                                                                                                      |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Servers outside your own network need HTTPS"                               | You typed `http://` for an internet address. Put HTTPS in front of the server (Coolify or Caddy), and connect with `https://` or just the domain.                                  |
| The game cannot reach the server                                            | Open `https://<your-server>/info` in a browser. Nothing: check DNS, the proxy, and the firewall (80 and 443 open). JSON: the server works, so check the address typed in the game. |
| "This server needs a newer version of Soundwave" or "runs an older version" | The game and the server differ. Update whichever the sentence names.                                                                                                               |
| No **Sign in with your browser** button, only the in-game form              | The server is older than the browser sign-in. Update it. `https://<your-server>/login` answers "There is nothing here." on an old server.                                          |
| Signing in in the browser works, but the game never picks it up             | Desktop: the browser has to be allowed to open Soundwave (it asks the first time). Web game: `SOUNDWAVE_WEB_GAME` must be the address you play on.                                 |
| Invite links point at `localhost`                                           | `SOUNDWAVE_PUBLIC_URL` is not set. Set it to the address players use, and restart.                                                                                                 |
| Parties never connect, but signing in works                                 | The proxy does not pass WebSockets on (`/ws`). Caddy does by default; for nginx see [step 2B](#b-docker-compose-on-a-vps).                                                         |
| "Too many tries. Wait a minute"                                             | The sign-in rate limit. Behind a proxy, make sure `SOUNDWAVE_TRUST_PROXY=true`, or every player counts as the proxy.                                                               |
| The set-up code is gone, and nobody is the owner                            | It is printed again on every start until the owner account exists: restart and read the logs.                                                                                      |
| A Players section on the Admin page says the server is too old              | Update the server.                                                                                                                                                                 |

Still stuck? [Open an issue](https://github.com/DavidNiessen/soundwave/issues) with what the server
printed and what the game said.
