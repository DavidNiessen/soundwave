# Spec: playing together

Status: **draft, for discussion**. Nothing here is built yet. The open questions at the end need answers before
work starts.

Soundwave is single-player today. This spec adds playing together in three levels. Each level works without
the ones after it:

| Level                | What it is                                                                                                                                     | Needs                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **1. Local session** | One player's desktop app hosts a session; friends on the same network join, pick a set together and play it at the same time with live scores. | Nothing: no accounts, no server.                |
| **2. Server**        | A self-hosted Soundwave server: accounts, leaderboards, song sharing, parties across the internet, public or private.                          | Someone runs the server (one Docker container). |
| **3. On a server**   | The Showdown battle mode, avatars, the connected main menu, cover art in the Discord status.                                                   | A server (level 2).                             |

The game stays fully playable offline. Nothing is sent anywhere unless the player chooses a session or a server.

---

## 1. Choosing how to play

On the **first start**, after the loading screen, a one-time card asks how the player wants to play. It can be
changed at any time in **Settings → Online**.

| Choice                  | What happens                                                                           |
| ----------------------- | -------------------------------------------------------------------------------------- |
| **Just me** (default)   | Offline, exactly as today.                                                             |
| **With friends nearby** | Shows the **Play together** entry on the main menu (level 1).                          |
| **On a server**         | Asks for a server address or a key file, then to sign in or make an account (level 2). |

A server the player connected to once is remembered, and the game reconnects on start. If the server can't be
reached, the game starts offline and says so in a quiet toast, never a blocking dialog.

---

## 2. Level 1: local session (no server)

The smallest version: one desktop app hosts, the others join, and everyone plays the same set at the same moment.
There's no leaderboard, no accounts and no avatars.

### 2.1 Hosting and joining

- **Hosting:** on the Play tab, **Play together → Host** starts a small server inside the desktop app, on a free
  port. The host chooses **This network** or **Friends anywhere** (see [2.6](#26-reaching-friends-over-the-internet)).
- **Session code:** the host sees a short code, like `KITE-42`, plus an invite link to send to friends.
- **Finding the host:** on the same network, hosts show up automatically (mDNS, `_soundwave._tcp`). Elsewhere,
  friends open the invite link or type the code.
- **Names:** each player is shown by a display name, set the first time and stored locally. There are no accounts.
- **Size (decided):** up to **16 players** per session.
- **Browser version:** it can **join** a local session, but can't host one, because a browser tab can't run a server.
  Signed in to a server, a browser player **can** host a party there (see [3.1](#31-what-a-server-offers)).

### 2.2 The session lobby

The lobby is the existing set lobby, with everyone in it:

- **Shared set:** the host picks the set; everyone sees it.
- **Own choices:** each player picks their own part and difficulty, shown next to their name with a ready tick.
- **Starting:** the host starts once everyone is ready, or anytime with a hold-to-start.

### 2.3 Having the songs

Everyone needs the same audio, so songs are matched by their **song id**, the SHA-256 hash of the audio that
the game already uses.

- **Missing songs:** a player who doesn't have a song in the set sees **Missing** next to it.
- **Getting it from the host:** the host's app can send it to them as a `.soundwave` file, which already carries the
  audio, cover, analysis and hand-made charts. This only happens if the host allows it (a **Share my songs with
  the session** switch, on by default, to match whole-song sharing on servers) and the player accepts each song.
- **Without the song:** a player who doesn't get it sits that song out and watches the others' scores.

### 2.4 Playing in sync

Everyone should hear the first note at the same moment, give or take a few milliseconds:

1. **Clock sync:** on joining, each client measures its clock against the host's with a few ping/pong rounds,
   NTP-style. It keeps the offset with the lowest round trip and re-measures every 30 s.
2. **Shared start:** the host announces a start at host time `T`, about 3 s ahead. Each client converts that to its
   own clock and starts the song at that moment, using the audio engine's existing scheduled `play(from, delay)`.
3. **Local judging:** each player's own hits are judged on their own machine as today, and network delay never
   affects timing. Only **scores** travel: each client sends `{ score, streak, stars, overdrive }` 10 times a
   second.
4. **Live scoreboard:** a compact board at the side of the highway lists every player, their score and their
   streak.
5. **Results:** a shared results screen comes after each song, and the set summary at the end has a winner.

### 2.5 Leaving and dropping

- **A player leaves:** they leave the scoreboard; their last score stays on the results as **left**.
- **The host leaves:** the session ends for everyone, with a "The host ended the session" card. There's no host
  migration in level 1.
- **Pausing:** a player can pause their own run, but the song doesn't pause for anyone else.

### 2.6 Reaching friends over the internet

With **Friends anywhere**, the host's app tries these in order and uses the first that works:

1. **Open a port on the router:** it asks the router to forward the session's port, using UPnP or NAT-PMP, which
   most home routers offer. The invite code then carries the host's public address. The forward is removed when
   the session ends.
2. **Direct connection (WebRTC):** it connects peer to peer through the routers using WebRTC data channels, with
   public STUN servers to find each side's address. Decided: **the invite link carries the connection offer.**
   The host's offer is packed into the link (compressed, about 300–500 characters). The friend's game answers
   over the same path back: their answer goes into a short reply code that the host's app reads. Nothing central
   is needed and the project runs no service.
3. **Manual forward:** if neither works (strict carrier networks, some company or school networks), the game says
   so and explains how to forward the port by hand. Otherwise it suggests a server.

Notes:

- **Privacy:** friends who join learn the host's public IP address, as in any peer-to-peer game. The host sees this
  in one line before starting.
- **Session password:** a session reachable from the internet always has the code as its password, so strangers
  scanning ports can't walk in.
- **Distance:** sync (2.4) works the same; only scores travel, so a 100 ms connection is fine for play.

### 2.7 How it's built

- **Session server:** it lives in the desktop app's Rust side (`src-tauri/src/session/`), using `tokio`, a
  WebSocket library, a UPnP/NAT-PMP crate and a WebRTC crate. JSON messages are spelled out in
  [section 6](#6-protocol-sketch).
- **Browser clients:** joiners use the same protocol from the page, with a plain `WebSocket` or a WebRTC data
  channel.

---

## 3. Level 2: a Soundwave server

A separate program, **`soundwave-server`**, that anyone can run: on a home PC, a small VPS, or a NAS. It's
shipped as a Docker image and as a single binary.

### 3.1 What a server offers

| Feature          | Description                                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Accounts**     | A username and password. Sign in once per device; the game keeps a token.                                                                                |
| **Parties**      | Level 1's sessions over the internet: invite friends on the server, play sets together. Any signed-in player can host one, the browser version included. |
| **Leaderboards** | Per song, chart, part and difficulty; per server; all time and this week.                                                                                |
| **Song sharing** | A server library of songs that players add (see [3.4](#34-song-sharing-and-copyright)).                                                                  |
| **Cover art**    | Covers served over HTTPS, so the Discord status can show the song's cover ([5.3](#53-discord-status-with-cover-art)).                                    |
| **Presence**     | Who's online, in the menus or playing what.                                                                                                              |

### 3.2 Public or private

The server owner sets one of these in the server's config file:

| Mode            | Who can join                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Public**      | Anyone with the address can make an account.                                                                                                                     |
| **Password**    | Making an account needs the server's password.                                                                                                                   |
| **Invite only** | Making an account needs an invite link that a member or the owner made. Links can be single-use or time-limited.                                                 |
| **Key file**    | The owner hands out `.soundwave-key` files. A key file holds the server's address and a signed token. Opening one in the game connects and signs up in one step. |

Private servers can combine invites and key files.

**Moderation (decided, day one):**

- **Roles:** the owner names **moderators**, who can do everything below except naming moderators.
- **Kick and ban:** remove a player from a party or from the server, with an optional reason. A ban can be
  permanent or time-limited.
- **Delete:** remove a cheated score, or a reported song, everywhere on the server at once.
- **Audit log:** every moderation action is recorded with who did it, to whom or what, when and why. Owners and
  moderators can read it in the game.

### 3.2b Finding servers

Players join a server by its **address**, an **invite link** or a **key file**. Public servers can also be listed in
an **in-game server list**:

- **Where the list lives:** a JSON file in a GitHub repository (proposed: `servers/servers.json` in this repository,
  or a repository of its own). Each entry is `{ name, address, description, region, mode, owner, added }`.
- **Getting listed:** a server owner opens a pull request that adds their entry. CI checks the entry against a
  schema and checks that the server answers `GET /info` with the same name. A maintainer merges it, and removes
  servers that disappear or break the rules.
- **In the game:** the list is fetched from GitHub's raw file URL when the player opens it (nothing in the
  background). Each server's `/info` is then asked for its live player count and protocol version, so dead or
  incompatible servers are shown greyed out.
- **Nothing to run:** the project hosts no directory service; GitHub holds the list and its history.
- **Privacy:** opening the list makes requests to GitHub and to each listed server. The list says so once.

### 3.3 Leaderboards

- **Identity:** a score belongs to `(song id, chart id, part, difficulty)`.
  - The **song id** is the hash of the audio.
  - The **chart id** is a hash of the chart itself (its notes), so an analysis update or a hand-edited chart gets
    a board of its own instead of mixing incomparable scores.
- **Submission:** at the end of a song the game sends the score plus a compact **input log** (hit times per lane,
  about 10–40 KB per song).
- **Checking:** the server re-judges the log against the chart, using the same judging code as the game (shared
  TypeScript), and rejects scores that don't match. That stops casual cheating, though not a determined bot.
- **Modifiers:** runs with modifiers (if the modifiers idea is built) get their own boards.

### 3.4 Song sharing (decided: whole songs)

Players share **whole songs**: the `.soundwave` file with its audio, cover, analysis and hand-made charts. A player
who downloads one can play it at once, with no analysis needed.

Sharing music files with others can infringe copyright, and the person running the server is responsible for
what it hands out. So the server gives its owner the tools to run it responsibly:

- **Setup notice:** the first start of a server shows the owner a short notice about this, which they confirm
  once. The config file has the same note.
- **Charts-only mode:** a config switch makes the server keep everything but the audio. Players with the same audio
  (the same song id) still get the charts instantly. This is meant for public servers.
- **Uploader on record:** every shared song records who shared it and when.
- **Takedown:** a report button on every song, and an owner/moderator view of the reports. One action removes a song
  everywhere on the server.
- **Limits:** a size limit per song and a storage quota per account, both set by the owner.
- **Not on the cover service:** covers of shared songs are served for the Discord status (5.3), the audio never.

### 3.5 How it's built

- **Language (decided): TypeScript on Node**, in this repository under `server/`, as a pnpm workspace package. It
  shares the protocol types, the chart code and the judging code with the game, so a leaderboard score is checked
  by exactly the rules the game played it by. It's small to host (tens of MB of memory, quick to start) and needs
  no toolchain beyond the one the game already uses. Rust and Kotlin were considered: Rust would share code with
  the desktop app's session server, and Kotlin (Spring Boot or Ktor) is strong for accounts and data. But both
  would need a second copy of the judging code and a heavier setup.
- **Storage:** SQLite by default (one file, easy to back up) and Postgres optionally. Shared songs and covers live
  in a folder or S3-compatible storage.
- **Sign-in (decided):** username and password only. Nothing external, no third-party accounts. The owner can reset
  a forgotten password from the admin view, since there are no emails.
- **Security:**
  - **Passwords:** hashed with Argon2id.
  - **Tokens:** short-lived access tokens plus a refresh token.
  - **Limits:** rate limits on sign-in and uploads.
  - **TLS:** HTTPS/WSS is required for anything but `localhost`. The docs show it behind Caddy, which gets certificates
    automatically.
- **Privacy:** no telemetry. The server stores only what the features above need. Players can delete their account
  and everything with it.
- **Versioning:** the client and the server announce a protocol version. A client too old or too new for the
  server is told so and plays offline.

---

## 4. Level 3: on a server

### 4.1 Showdown (battle mode)

An original competitive mode for 2–16 players on a server, played over a set. Decided: **elimination, with hits**.

- **Same song, own chart:** everyone plays the same song, each on their own part and difficulty. Scores are
  normalised to the chart's par, the same par the stars use, so a hard part doesn't win just by having more notes.
- **Rounds:** each song is a round. After each round the **lowest** player is out, and the set continues until
  one is left. With fewer songs than players, enough players go out each round to leave one winner after the
  last song (with 16 players and 4 songs: 16 → 8 → 4 → 2 → 1).
- **Scoreboard with 16:** the board beside the highway shows the top 5, the players just above and below you, and
  how many are left.
- **Charge and hits:** streaks build **charge**. A full charge can be spent on a **hit** against the player just
  above you on the board. A hit is a short disturbance lasting about 4 s. Decided so far:
  - **Fog:** the far half of their highway is hazed.

  The rest of the set is to be designed in the spirit of the attacks in battle modes of other rhythm games, with
  names, visuals and numbers of our own (see the open questions). Candidates to try in play: a colour shuffle
  (notes in other colours, lanes unchanged), a rush (the highway runs faster), a **shield** (spend a charge to
  block the next hit on you), and a **swap** of the targeted player's next two lanes.

- **No hits option:** a lobby setting turns hits off for a pure score race.
- **Accessibility:** a player can opt out of receiving visual effects, for example because of photosensitivity.
  Hits on them turn into a small score penalty instead.
- **Spectating:** players who are out watch the rest with the scoreboard.

The names and balancing numbers are placeholders to tune in play.

### 4.2 Accounts and avatars (decided: the band's 3D characters)

- **Profile:** a display name, an avatar, and a short line of text.
- **Avatar:** built from the game's own band characters (`public/stage/aurora/band.glb`). You pick a character,
  outfit colours and an instrument finish, and see a preview turning on the stage.
- **On stage:** when you play a part, **your** avatar stands at that part's place on the stage. In a party, every
  player's avatar stands at their part, sharing the stage as one band.
- **Storage:** avatars are a small JSON description stored on the server, not images, so they cost almost nothing.

### 4.3 The connected main menu

While connected to a server, the main menu gets a clean sidebar on the right. The Play/Edit/Stage tabs stay as
they are:

- **You:** your avatar, name, and the server's name with a status dot.
- **Party:** who's in it, their ready state, and an invite button. **Play together** starts a party set.
- **Leaderboard:** the top 5 on the server this week, and your rank. Pressing it opens the full boards.
- **Friends online:** a short list with what each is doing.

Offline, the sidebar is gone and the menu looks exactly as today.

---

## 5. Smaller pieces

### 5.1 Settings → Online

- **How to play:** Just me / With friends nearby / On a server.
- **Display name:** the name used in local sessions.
- **Server:** its address, signed-in account, and **Sign out** / **Forget this server**.
- **Sharing:** **Share my songs with the session** (level 1, on by default; friends still accept each song).

### 5.2 Key files

- **Format:** a `.soundwave-key` file is a small JSON file: `{ server, name, token, expires? }`, with the token
  signed by the server.
- **Opening one:** double-clicking it opens the game the same way `.soundwave` files do today (`song_files.rs`
  gains the extension).

### 5.3 Discord status with cover art

When connected to a server, the Discord status's large picture becomes the song's cover, from
`https://<server>/covers/<song id>.jpg`, with the game icon as the small badge. This is the "later, with a
backend" note in `src-tauri/src/discord.rs`. The server only serves covers of songs shared with it, and only on
public servers or if the owner allows it, because the cover link becomes visible to Discord friends.

---

## 6. Protocol sketch

**WebSocket messages:** JSON `{ type, ... }`, the same for a local session (level 1) and a server party (level 2).

```
client → host/server
  hello        { protocol, name, token? }
  ping         { t }                         // clock sync
  ready        { part, difficulty, ready }
  progress     { songIndex, score, streak, stars, overdrive }
  hit          { target }                    // Showdown: spend a full charge
  finish       { songIndex, results, inputLog? }
  request-song { songId }

host/server → client
  welcome      { session, you, players, protocol }
  pong         { t, hostT }
  lobby        { set, players: [{ id, name, part, difficulty, ready, avatar? }] }
  start        { songIndex, at }             // host time to start
  board        { players: [{ id, score, streak, stars, out? }] }   // 10/s
  hit          { from, effect, ms }           // Showdown
  results      { songIndex, players: [...] }
  song         { songId, chunk, of }          // a .soundwave file, in pieces
  bye          { reason }
```

**Server HTTP (level 2):**

- **Accounts:** `POST /auth/signup | signin | refresh`, `DELETE /me`.
- **Leaderboards:** `GET /boards/:songId/:chartId/:part/:difficulty`, `POST /scores`.
- **Shared songs:** `GET /songs?query=`, `POST /songs`, `GET /songs/:id`.
- **Covers:** `GET /covers/:songId.jpg`.
- **Profiles:** `GET /profiles/:id`, `PUT /me/profile`.
- **Invites:** `POST /invites`, `POST /keys` (owner/moderators).

---

## 7. Milestones

| #   | Milestone                 | Done when                                                                                |
| --- | ------------------------- | ---------------------------------------------------------------------------------------- |
| 1   | **Local session MVP**     | Two desktop apps on one network play a set together with live scores and shared results. |
| 2   | Song transfer in sessions | A missing song can be fetched from the host with consent.                                |
| 3   | **Server MVP**            | Accounts, public/password/invite/key-file joining, parties over the internet.            |
| 4   | Leaderboards              | Scores submitted, checked from input logs, and shown in the game.                        |
| 5   | Shared charts and covers  | Charts-only sharing, covers over HTTPS, cover art in the Discord status.                 |
| 6   | Connected main menu       | Sidebar with you, party, leaderboard and friends.                                        |
| 7   | Avatars                   | Avatar editor, and avatars on stage at their parts.                                      |
| 8   | **Showdown**              | The battle mode, playable and tuned.                                                     |

Each milestone is its own PR, and the game ships after every one.

---

## 8. Open questions

1. **Showdown hits:** besides Fog, which effects should there be? Name the ones you liked in other games'
   battle modes, and we design our own versions of them (own names and look), then tune lengths and strength in play.
