# Playing together

Playing with friends on a self-hosted Soundwave server: joining, your identity, parties, Showdown, leaderboards, and Join from Discord in the desktop app. Running a server of your own is in [docs/server-setup.md](server-setup.md).

## On a server

The **Online** tab of the main menu plays with friends on a Soundwave server. Anyone can run one ([docs/server-setup.md](server-setup.md)); every server is self-hosted by someone, and none is run by the project. Type the server's address or paste the invite link you were sent (an invite link also opens the game by itself, in the app or the browser), then join with the name you want there: no password. Your game has an **identity**, a key it keeps on your device (Windows Credential Manager or the macOS keychain in the app, the browser's storage in the web game), and signs you in with it, on every server, from then on. Each server sees a key of its own, so servers cannot tell they see the same player. Signing out holds it back until you sign in again.

Back your identity up when the game asks (or any time in Settings → Online → Your identity): a small file locked with a passphrase you pick. Keep both apart from this device. **Bring back** on another device or a new installation, and every server signs you in again. Lost it with no backup? An admin of the server can send you a **recovery link**: open it in your game (or paste it into the Online tab's address field) and the account takes that game's identity. Rename yourself on a server under your account on the Online tab.

Signed in, the Online tab is your place on the server: start a party (`C`) or join one with its code (like `B7KQX`, `J`), the leaderboards (`G`), your look on stage (`V`, edited right there on your band member), invites, and for the server's owner and moderators the **Admin** page (`M`). Your character stands beside it under your nametag.

A party picks a mode:

- **Versus**: everyone plays the same set at the same moment, each on their own part and difficulty, with a live board beside the highway and the set's standings at the end.
- **Showdown**: scores count as a share of each chart's par, the lowest players go out after each song, and the overdrive button **strikes** the player above you as it starts your own overdrive (their highway fogs and their multiplier is halved for a while). The last one standing wins. It plays on a ring of podiums, one per player in their look.

Songs are matched by their audio. A song a player lacks reaches them by itself through the server, and the server's own library shows in everyone's music library, to stream or download. A streamed song goes into your setlist the moment you press it and comes in the background (a ring shows how far), starts coming as soon as you rest on it, and is kept on your device for a while, so it plays at once next time; it is never added to your library. On a slow connection, Settings → Online → Streaming quality streams smaller copies. Everything online stays live: a song shared, a score posted, a player online or a role given shows on every screen at once. When the host starts a song, every player gets the host's chart for their part, and the song starts at the same moment for all: each game measures its clock against the server's. Your hits are judged on your own machine, so the connection's delay never touches your timing; only scores travel.

A party's song is played live with everyone, so it never pauses: the pause menu opens over it while it plays on. A dropped connection is tried again in the background: your place in the party is kept for 30 seconds, and a score you finish meanwhile is sent once you are back.

While you are signed in, every song you finish goes to the server's leaderboards with its run, and the server judges the run again before it takes the score (Settings → Online can switch this off). **Leaderboards** shows each song's board for any part and difficulty, with **Watch** on every run; your own run can be shared to the server's list of replays.

In the desktop app, Discord friends can join your party from your status, from an invite you post in a chat, or by asking to join (see [Discord status and Join from Discord](#discord-status-and-join-from-discord)).

## Running a server

A server is one small Node program with everything in one folder: on Coolify, with Docker Compose behind HTTPS, or on your own PC for your own network. **[docs/server-setup.md](server-setup.md)** walks through it step by step: installing it, becoming its admin with the set-up code it prints, getting back in if you lose your identity, inviting friends, its settings, updates, backups and troubleshooting. [server/README.md](../server/README.md) is the reference for every setting and the API.

## Discord status and Join from Discord

The desktop app shows what the player is doing on their Discord profile, and lets Discord friends join their party, for a
Discord application the build names. Without one both are off.

1. Make an application at [discord.com/developers/applications](https://discord.com/developers/applications) and copy
   its Application ID. Nothing else needs setting up there: the pictures come by address.
2. Give the build the id as `SOUNDWAVE_DISCORD_CLIENT_ID`: for the release workflows a repository variable (Settings →
   Secrets and variables → Actions → Variables), for a development build an environment variable where it starts
   (`$env:SOUNDWAVE_DISCORD_CLIENT_ID = "…"; pnpm tauri dev`).
3. In the game: the Discord status on (Settings → Advanced) and **Let Discord friends join** on (in the party's lobby, or
   **Friends can join from Discord** under Settings → Online). While the party is not **Private** (`T` in its lobby), your
   profile then carries it:
   - a **Join** button on your status, greyed out once the party is full;
   - **Invite to play Soundwave** in the chat box's **+**, which posts an invite card with Join;
   - **Ask to Join**, which shows a card in your game to let the friend in or not.

A friend who joins needs the desktop app, started once (it registers the `discord-<id>` link Discord opens to start it; on
macOS the game has to be running already), a build with the same application id, and an account on the party's server, or a
way to make one there. A game that is already running takes the join itself rather than opening a second window. To run two
development builds side by side on one computer, start the second with `SOUNDWAVE_SECOND_INSTANCE=1`.
