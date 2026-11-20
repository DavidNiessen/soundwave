# Spec: playing together

Status: **being built** (#16). Built: judging by time (milestone 0), the server, parties, leaderboards, Showdown, avatars, join from Discord,
shared songs and the connected main menu. Band mode was built and then taken out for now.

Decisions made while building, which override what follows:

- **Servers are only self-hosted.** The project runs none; whatever a feature needs, the server itself serves.
- **Invite links replace key files** (`.soundwave-key` was too technical). An invite is a link to the server's own
  `/join` page, which opens the app (`soundwave://join?…`) or the web game; the join modes are public, password and
  invite. Read "key file" below as "invite link".
- **No challenges.** Beat my run (a run played against as a ghost) and the weekly server challenge are dropped:
  3.3b, the challenge endpoints in section 6 and milestone 10 no longer apply. Leaderboards, Watch and shared
  replays stay.
- **Showdown, as built:** Strike has no button of its own. With hits on, the overdrive button strikes when the board
  shows someone above the player to aim at; first place, or a player with nobody to aim at, gets overdrive. Rests need
  no rule of their own: charge only comes from completing phrases, which a rest has none of. "The server's rotation" is
  a song list the owner and moderators set (`GET`/`POST /showdown/rotation`). Showdown runs are not posted to the
  leaderboards, since hits shape them. Players level at a cut all stay.
- **Avatars, as built:** every band member comes with their own instrument and its animation (`band.glb`), so a
  player does not pick a character: at the part they play stands that part's band member, in the player's colours
  (top, trousers and skirt, instrument finish). The look editor (Play together → Your look) shows it on the menu stage,
  at any part. Stored as `{ top, bottom, finish }` (`GET`/`PUT /me/profile`). The profile has no line of text: dropped,
  the avatar is enough and free text from players would need moderating.
- **Ending a party:** the host holds it (the button, or `L`), since it ends the party for everyone; players leave with a
  press.
- **Band mode is taken out for now** (4.5): it was built, then removed with all its parts (the mode, band overdrive,
  dropping out, band boards). A party plays Versus or Showdown. 4.5 below stays as the plan for when it comes back.
- **Join from Discord, as built:** for parties on a server (level 1 sessions are not built). The join secret is the
  party's code and server; Discord greys the button when the party is full. A set under way keeps the button: a
  friend who joins mid-set sits the current song out and plays from the next. Discord starts the game through the
  `discord-<application id>` scheme, registered at start on Windows and Linux (on macOS the game must be running).
- **A party is its players first, then a mode:** a new party has no mode. Its room shows the players and three mode
  tiles (Versus, Showdown); the host picks one, and the mode's lobby has the set, its options and ready up.
  The host can go back to the room for another mode. The host's setlist is the party's set (picked in the library).
- **A party's songs travel by themselves:** replacing "Get it" and asking the host. When a player in the party
  lacks a song of the set, the host's game sends it to the server (unless the host turned that off), which keeps
  it as a cache for that party's players only; every game without it downloads it. A downloaded song is held for the party only (in memory) and goes when the player leaves; **Keep it** on the set, or the setting _Keep the songs I get in a party_, adds it to the library. Not streamed: a song is decoded whole before it starts, so a slow connection never stalls it mid-song. On
  by default; the owner can turn it off (`partySongs`). Not the shared library: nothing lists these songs.
- **The lobby counts itself in:** once everyone in a mode's lobby is ready (two players or more), the next song counts
  down five seconds and starts by itself; anyone turning not ready stops it, and the host can still start at once.
  Players show as cards in their look's colours. A Showdown's lobby shows its players on the ring behind it.
- **A Showdown plays on a ring:** every player of the song stands on a round podium of their own in a ring on the deck
  (up to 16), as their part's band member in their look; the band's island makes way. Podiums rise by place on the
  board, sink for a player who is out, and glow red under a hit. Every Strike is seen by everyone: it flies as a
  bolt from the striker's podium to the target, who shakes and flashes as it lands.
- **Showdown hits are Fog and Drain together**, with no choice: every hit lays wavy, shimmering bands over the highway
  from just past the strike line to the horizon (far notes are hard to read, the strike line stays clear) and holds the
  multiplier at ×2 for as long as it lasts. The setting _Showdown hits reach me as_ (4.1, 5.x) is not built.
- **Shared songs live in the library**, not on a screen of their own: where the server takes songs, its songs the
  player lacks are listed under the player's own, to stream (fetched and held for the session, never stored) or
  download, as Settings → Online → _Songs from the server_ says (the same choice for a party's songs). A player's
  own songs go to the server when they turn on _Share my songs_ (off by default; asked once per server; a button in
  the library), once each is analysed. Moderators find reported songs in the Admin window.
- **Later, not now:** the in-game server list (3.2b), local sessions hosted by the desktop app (level 1), and its
  STUN fallback.

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
- **Calibration check:** scores are compared, so each player's audio/video offset matters. Next to every name the
  lobby shows **Calibrated** or **Not calibrated** (never calibrated, or the output device changed since). A player
  can run the game's existing calibration from the lobby without leaving it. It's a hint, not a requirement.

### 2.3 Having the songs

Everyone needs the same audio, so songs are matched by their **song id**, the SHA-256 hash of the audio that
the game already uses.

- **Missing songs:** a player who doesn't have a song in the set sees **Missing** next to it.
- **Getting it from the host:** the host's app can send it to them as a `.soundwave` file, which already carries the
  audio, cover, analysis and hand-made charts. This only happens if the host allows it (a **Share my songs with
  the session** switch, on by default, to match whole-song sharing on servers) and the player accepts each song.
- **Without the song:** a player who doesn't get it sits that song out and watches the others' scores.
- **Everyone plays the same notes:** charts are made from each player's own analysis of the song. Two game
  versions, or a chart edited by hand, could give different notes for the same audio. So at the start of every
  song the host (or the server, in a party) sends **the chart itself** for each part and difficulty in play: a few KB
  of notes, with its **chart id** (a hash of the notes). Every player plays exactly that chart, whatever their own
  analysis says, so scores compare fairly and leaderboards stay clean.

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
- **Connection drops:** the song keeps playing on the player's own machine, because the music and the judging are
  local. The game reconnects in the background, and the scoreboard shows the player as **reconnecting** in the
  meantime.
  - **Back in time:** within 30 s, the player rejoins where they are and sends their score as it is now. Nothing is
    lost, and in Showdown they aren't knocked out for it.
  - **Gone longer:** the song finishes locally and the result is sent as soon as the connection is back, up to the
    end of the next song. In Showdown, a result that's still missing when a round is decided counts as that
    player's last known score.
  - **Rejoining a session:** a player who closed the game can rejoin with the same code. Their place and their
    results so far are kept for the rest of the set.

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
- **Submission:** at the end of a song the game sends the score plus its **input log** (see
  [3.3c](#33c-a-run-is-its-inputs)), about 10–40 KB per song.
- **Checking:** the server re-judges the log against the chart, using the same judging code as the game (shared
  TypeScript), and accepts the score only if it matches **exactly**. There is no tolerance, so a cheater has no
  margin to use. That stops casual cheating, though not a determined bot. This needs the game's judging to give
  one result per log, which it doesn't yet: see 3.3c.
- **Modifiers:** runs with modifiers (if the modifiers idea is built) get their own boards.

### 3.3c A run is its inputs

Leaderboard checks (3.3), ghosts (3.3b) and replays (4.4) all play a run back from its input log and expect the
score that was played. **This is a requirement on the game, and it doesn't hold today.**

**The problem**, found and measured by AlxcBTW in [the review of this spec](https://github.com/DavidNiessen/soundwave/pull/11):
the game's judging (`GameSession`) advances frame by frame, so the same inputs give a slightly different result at
different frame rates. Over 40 test charts, played at 30–1000 updates a second with identical inputs:

- the score differed in **all 40** (by up to 0.56%, usually a few points);
- hit counts or the best streak differed in 2.

Three things depend on frames:

1. **Sustain points** are added per frame, at the multiplier of that frame, so a hit or miss inside the frame
   changes the multiplier for the frame's whole share.
2. **Overdrive** drains per frame and runs out on a frame, so notes hit just after it ended still count double until
   the next frame. Starting overdrive was also taken at the last frame, not at the press.
3. **Misses** are noticed on the frame after a note's window closes. A hit on a later note in between adds to the
   streak first, and is reset after. The other order would start a new streak, which can change the best streak and
   the multiplier.

A server re-judging at its own pace would reject honest scores, or need a tolerance a cheater can use too.

**The requirement:** the judging advances **by time**, not by frames. Every update walks through what falls due up
to that moment, in order of time: a note's window closing, a sustain ending, a release window closing, overdrive
running out. Sustain points and overdrive drain are added between those moments at the multiplier that held then.
Presses, releases and overdrive activations first advance the session to their own time. A run is then a function
of its chart and its inputs alone: the same log gives the same score, counts, best streak and events at any frame
rate, in the game, on a server, and in a replay.

- **Proven possible:** AlxcBTW built this on a branch
  ([`feat/session-by-time`](https://github.com/AlxcBTW/soundwave/compare/main...AlxcBTW:soundwave:feat/session-by-time):
  `GameSession` plus two lines in `PlayController`). With it, the same 40 runs give identical results at every rate
  (0 of 40 differ, before 40 of 40), landing within a point of what 1000 steps a second gave before. The existing
  session tests pass unchanged, and a new test plays one list of inputs at four frame rates and compares everything.
- **What changes in play:** nothing a player should notice. A miss breaks the streak at the moment the note's window
  closes instead of at the next frame, and overdrive ends at the moment it runs out. It still needs to be played
  before it lands.
- **A test that keeps it true:** the same-result-at-every-frame-rate test stays in the suite, so the judging can't
  drift back.

**What the input log holds**, so that it is the whole run:

| Entry     | With                                                                                              |
| --------- | ------------------------------------------------------------------------------------------------- |
| Press     | time, lane                                                                                        |
| Release   | time, lane (sustains and hold-and-release notes)                                                  |
| Overdrive | time it was activated                                                                             |
| Pause     | time paused, and the song time play resumed from (a resume rewinds the song and drops held notes) |

Plus the header: song id, chart id, part, difficulty, the game version, and settings that change judging (the
player's audio/video offset is applied to the times before they're logged, so it isn't needed again).

**The score of record is the re-judged one.** An input's time is the event's own, but a frame may already have moved
the session past it. Such an input is judged a few milliseconds differently live than in a re-judge. So at the end
of a song the game re-judges its own log, and that score is the one it shows on the results, stores, and sends. Live
scores during the song (and on a session's scoreboard) are allowed to differ by those few points. Only the final
score has to be exact.

**Still open:** how far "late" may go. An input that arrives after the session has already passed its time (a
long frame, a stall) is judged by its own time in the re-judge, which is the fair answer. But the live HUD may
briefly have shown something else. To settle while building it.

### 3.3b Challenges (dropped, see the decisions at the top)

**Beat my run (async):** every checked score already comes with its input log (3.3), so a friend can play against
it whenever they like, without being online at the same time.

- **Sending a challenge:** from a leaderboard or a friend's profile, **Challenge** sends a run to a friend on the
  server. The friend sees it in the connected main menu.
- **Playing it:** they play the same chart, and the run is a **ghost** on the scoreboard beside the highway: its
  score moves as it did when it was played, note for note. That holds because a run is its inputs (3.3c).
- **Afterwards:** a result card shows both runs, and the challenger is told how it went.

**Server challenges (weekly):** the owner or a moderator sets a weekly challenge: a set of songs, optionally a
modifier, and a start and end. It has a leaderboard of its own, shown at the top of the connected main menu. Past
challenges and their winners stay viewable.

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
- **Data export:** a player can download everything the server holds about them, at any time, from Settings →
  Online. That's one zip file with their profile and avatar, scores and input logs, replays, challenges, invites
  they made, and the songs they shared, plus a readable `README` of what each file is.
- **Versioning:** the client and the server announce a protocol version. A client too old or too new for the
  server is told so and plays offline.

---

## 4. Level 3: on a server

### 4.1 Showdown (battle mode)

An original competitive mode for 2–16 players on a server, played over a set. Decided: **elimination, with hits**.

The design draws on how battle modes in other rhythm games worked, especially what players found unfair about
them. It keeps what made them exciting and avoids what didn't:

- **Kept:** charge earned by playing well, saving it up for a bigger hit, aiming at the player just ahead of you,
  and an elimination after every song.
- **Avoided:**
  - hits piling up on one player
  - hits that hide the notes **and** cut the score at the same time
  - unclear targeting
  - instruments with sparse charts winning too easily
  - no way out for players sensitive to visual effects

#### Rounds

- **Same song, own chart:** everyone plays the same song, each on their own part and difficulty.
- **Scoring:** a player's score in Showdown is their share of what their chart can earn at most. That's the
  chart's par, the same par the stars use, so a dense part doesn't win just by having more notes, and a sparse
  part doesn't win by having less to miss.
- **Rests:** stretches where a part has no notes count as "resting". Charge can't be built while resting, so a part
  that sits out half the song doesn't save up hits.
- **Elimination:** after each song, the lowest players go out. A set of 4 songs with 16 players runs
  16 → 12 → 8 → 4 → 1, so the last song is a final of four. Other sizes cut evenly so that one player is left
  after the last song.
- **Scoreboard:** beside the highway it shows the top 5, the players just above and below you, and how many are
  left. Arrows show who you would hit, and who can hit you.
- **Spectating:** players who are out watch the rest with the scoreboard, and can cheer (a small, harmless
  reaction shown to the players).

#### Charge and Strike

Showdown uses the game's existing **overdrive meter**. When it has charge, the player chooses how to spend it:

| Button     | What it does                                                                     |
| ---------- | -------------------------------------------------------------------------------- |
| Overdrive  | As in a normal song: their own multiplier goes up while it lasts.                |
| **Strike** | Spends the charge on a hit against the player just above them on the scoreboard. |

- **Bigger charge, longer hit:** a quarter meter (the minimum) gives a 6 s hit, and a full meter 14 s, scaling in
  between. Saving up is a real choice: a big hit later, or overdrive points now.
- **Who's hit:** the player directly above. If that player is protected (see below), the Strike goes to the next
  one up. First place has no one above, so for them the meter is only overdrive.
- **Before it lands:** the target sees a warning half a second before the hit starts, with the attacker's name.

#### What a hit does

A hit has **one** effect, never two. Each player chooses in Settings → Online how hits reach them:

| Mode                  | What a hit does to you                                                                                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Fog** (default)     | A haze over the far part of your highway: notes come out of it later, so you have less time to read them. The haze never covers the strike line or the last third of the highway, so nothing you have to hit right now is hidden. Your score isn't touched. |
| **Drain** (calm hits) | Your multiplier is capped at 2× while it lasts. The highway stays fully readable, with only a coloured edge and a timer showing the hit. Nothing moves or flashes.                                                                                          |

Fog is the fun one to see coming. Drain is the same disadvantage in points, for players who can't or don't want
to play through visual effects (for example photosensitivity or visual snow). Both are tuned to cost about the
same, so choosing Drain is never a handicap.

#### Keeping it fair

- **One hit at a time:** a player under a hit can't be hit again until it ends.
- **Protection:** after a hit ends, the player can't be targeted for 6 s.
- **Diminishing hits:** a second hit on the same player within 30 s lasts half as long.
- **No pile-ons:** at most two players can have a given player as their next target. A third Strike goes to the
  next player up instead.
- **Clear targeting:** the scoreboard arrows, the warning, and the attacker's name on every hit.

#### Lobby options

- **Hits:** on (default), or off for a pure score race.
- **Parts:** any part, or one part only (all drums, all vocals, …).
- **Set:** the server's rotation, or a set the host picks.

All numbers (durations, protection, the 2× cap) are starting values to tune in play.

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

### 4.4 Replays (in the game, and shared on a server)

Replays are part of the game itself, offline too, and a server can share them.

- **In the game:** every finished song keeps its input log with the best score (a few tens of KB). On the results
  screen and in the song's best scores, **Watch** plays the run back on the real highway and stage, note for
  note, with the song.
  - **Controls:** pause, ±10 s, and 0.5×/1× speed.
  - **Storage:** kept with the song's scores, so a library backup takes them along. A setting chooses how many are
    kept per song (best only, by default).
- **Same chart:** a replay holds its chart id, and plays only against the chart it was played on. If the chart has
  changed since (a new analysis, or a hand edit), the replay says so and plays the chart that was recorded with it.
- **On a server:** checked scores already carry their input logs (3.3), so every leaderboard entry has **Watch**.
  A player can also **share** a replay of their own to the server's replay list, and **Beat my run** (3.3b) is a
  replay played as a ghost.
- **Exact:** a replay re-judges its log as it plays, so it shows the same score as the run did (3.3c), at whatever
  frame rate it's watched.
- **Files:** a replay can be saved as a small `.soundwave-replay` file (chart id, song id, inputs, settings that
  affect play) and opened in the game, if the player has the song.

### 4.5 Band mode (co-op)

The calm counterpart to Showdown: up to four players, one per part (lead, vocals, bass, drums), playing a song
**together**.

- **Band score:** everyone's notes add to one band score. The band's stars come from it.
- **Band overdrive:** when two or more players activate overdrive within the same bar, it becomes **band
  overdrive**. The multiplier goes up for the whole band, and the stage goes all out.
- **Saving a player:** a player who fails a stretch (a long miss streak) dims out. Bandmates bring them back by
  playing their next overdrive phrase, instead of the song ending.
- **On stage:** every player's avatar (4.2) stands at their part, so the band on stage is the actual band.
- **Where:** works in local sessions (level 1) and in parties on a server. Band scores get their own leaderboard
  on a server, keyed by the set of charts played.

## 5. Smaller pieces

### 5.1 Settings → Online

- **How to play:** Just me / With friends nearby / On a server.
- **Display name:** the name used in local sessions.
- **Server:** its address, signed-in account, and **Sign out** / **Forget this server**.
- **Friends can join from Discord:** off by default (5.4).
- **Showdown hits reach me as:** **Fog** (default) or **Drain** (calm hits, nothing on the highway moves or flashes).
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

### 5.4 Join from Discord

Discord's status can carry a **Join** button (Rich Presence "join secrets"). A friend presses it on your Discord
profile and lands straight in your session or party, with the game starting if it isn't running.

- **Only when both hold:**
  1. the player turned it on: **Settings → Online → Friends can join from Discord**, off by default;
  2. the session or party isn't **private**. Sessions and parties get a **Private** switch in their lobby, and private
     ones never show the button.
- **What it carries:** the join secret holds the session's invite (code and connection offer, see 2.6) or the party's
  invite on the server. It's only shown to the player's Discord friends.
- **Full or started:** a full session, or a set already under way, shows the button greyed out ("Party full",
  "Playing"). Joining mid-set waits in the lobby until the next song.

---

## 6. Protocol sketch

**WebSocket messages:** JSON `{ type, ... }`, the same for a local session (level 1) and a server party (level 2).

```
client → host/server
  hello        { protocol, name, token? }
  ping         { t }                         // clock sync
  ready        { part, difficulty, ready }
  progress     { songIndex, score, streak, stars, overdrive }
  strike       { charge }                    // Showdown: spend charge on the player above
  finish       { songIndex, results, inputLog? }   // results re-judged from the log (3.3c)
  request-song { songId }
  resume       { session, player, songIndex, score }   // back after a dropped connection

host/server → client
  welcome      { session, you, players, protocol }
  pong         { t, hostT }
  lobby        { set, players: [{ id, name, part, difficulty, ready, avatar? }] }
  chart        { songIndex, part, difficulty, chartId, notes }   // the chart everyone plays
  start        { songIndex, at }             // host time to start
  board        { players: [{ id, score, streak, stars, out? }] }   // 10/s
  hit          { from, ms, at }               // Showdown: a hit starting at `at`, for `ms`
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
- **Replays:** `GET /replays/:scoreId`, `POST /replays` (share), `GET /replays?song=`.
- **Challenges:** `POST /challenges` (to a friend), `GET /me/challenges`, `GET /weekly`, `PUT /weekly` (owner/moderators).
- **Data export:** `GET /me/export` (a zip of everything held about the player).

---

## 7. Milestones

| #   | Milestone                 | Done when                                                                                          |
| --- | ------------------------- | -------------------------------------------------------------------------------------------------- |
| 0   | **Judging by time**       | The same input log gives the same result at every frame rate (3.3c), with a test that keeps it so. |
| 1   | **Local session MVP**     | Two desktop apps on one network play a set together with live scores and shared results.           |
| 2   | Song transfer in sessions | A missing song can be fetched from the host with consent.                                          |
| 3   | **Server MVP**            | Accounts, public/password/invite/key-file joining, parties over the internet.                      |
| 4   | Leaderboards              | Scores submitted, checked from input logs, and shown in the game.                                  |
| 5   | Shared charts and covers  | Charts-only sharing, covers over HTTPS, cover art in the Discord status.                           |
| 6   | Connected main menu       | Sidebar with you, party, leaderboard and friends.                                                  |
| 7   | Avatars                   | Avatar editor, and avatars on stage at their parts.                                                |
| 8   | **Showdown**              | The battle mode, playable and tuned.                                                               |
| 9   | Replays                   | Watch your own runs in the game, offline; then **Watch** on leaderboards and shared replays.       |
| 10  | Challenges                | Beat my run with ghosts, and weekly server challenges.                                             |
| 11  | Band mode                 | Co-op for up to four, with band overdrive and saves.                                               |
| 12  | Join from Discord         | The opt-in Join button, never on private sessions.                                                 |

Calibration checks, the host's chart, reconnecting and data export aren't milestones of their own: they belong to
milestones 1, 1, 1 and 3.

Each milestone is its own PR, and the game ships after every one. Milestone 0 comes first: leaderboards, ghosts and replays depend on it, and it's useful on its own (a run scores
the same on every machine).

---

## 8. Open questions

1. **Late inputs (3.3c):** an input that arrives after the session has passed its time is judged by its own time in
   the re-judge. Is a short difference between the live HUD and the final score acceptable, or should the live
   session also re-judge what it has already passed?

Numbers in Showdown (durations, protection, the 2× cap) are tuned in play.
