# Soundwave guide

Everything about playing, building and the game's inner workings, in detail. The short version is the [README](../README.md).

## Development

You need [Node.js](https://nodejs.org/) 22 or newer and [pnpm](https://pnpm.io/) (`corepack enable` gives you the pinned version).

```bash
pnpm install
pnpm dev            # the game in the browser
pnpm check          # types, lint (oxlint), formatting (Prettier) and tests
```

Open http://localhost:5173 and add your own songs. [CONTRIBUTING.md](../CONTRIBUTING.md) explains the checks, the code style and how to send a change.

## Playing

Default keys are `D F J K` (plus `L` on Expert), `Space` for overdrive and `Esc` (or `P`) to pause. All of them can be changed in Settings → Shortcuts. The pause menu also opens Settings (volume, audio offset and note speed take effect in the paused song; the rest from the next one) and asks before a song is restarted, skipped or left.

The menus work with whatever you last touched, and change with it. With a keyboard, the arrow keys move a focus ring between controls, `Enter` selects, `Esc` goes back, `Q` and `E` switch tabs, and every action along the bottom of the screen shows its key. With a mouse the same actions are buttons. On a touchscreen the targets grow and the hints go away, and in a song the lanes themselves are the controls: tap anywhere along a lane to play it, hold for long notes, use several fingers for chords.

Text fields (the library search) open an on-screen keyboard when they are pressed with a controller. Its keys are moved between and pressed like any other control, and the usual console shortcuts work from anywhere on it: right trigger for Done, left trigger for Shift, the left face button deletes, the top one is a space, the shoulder buttons move the text cursor, a click of the left stick turns to the symbols, and Back cancels and puts the text back. On a controller with a touchpad, a finger sliding over the pad moves a cursor across the keys and a click of the pad presses the key under it; in the desktop app this works with a PS5 controller (DualSense or DualSense Edge, by USB or Bluetooth), whose touchpad the app reads itself; in a browser it works only where the browser reports the touchpad (the Gamepad API's `touches`), and otherwise the click alone presses the key in focus. The browser's right-click menu is switched off throughout the game.

Every shortcut of the menus, the song and the track editor can be changed under Settings → Shortcuts: each has a key (with Ctrl, Alt or Shift if you like), a controller button and a mouse button (middle, back or forward). The lanes and overdrive are there too, a key and a controller button for each lane in its colour. Moving, confirm, `Esc` and a controller's back button stay as they are. The mouse's back button goes back by default, and its middle button opens a song's options in the library.

Under Settings → Audio the game can play through a chosen output device instead of the system's default, and it is muted while its window is in the background unless that is switched off. Browsers list output devices by name only after microphone access has been allowed; the game asks when you press Show devices, closes the microphone again at once and records nothing. Browsers that cannot choose an output (Safari, Firefox) always use the system default.

Controllers (Xbox, PlayStation 4 and 5, Nintendo Switch and most others) work in the menus and in songs: the D-pad or left stick moves the focus ring, the shoulder buttons switch tabs, on the ready-up screen the top face button steps through the parts and the left face button through the difficulties, and the action bar shows the controller's own button symbols. By default the lanes are D-pad left, D-pad right and the left, top and right face buttons (four-lane difficulties skip the top one), the right trigger triggers overdrive and Start/Options/+ pauses. Every lane and overdrive can be rebound to any button, trigger or stick direction in Settings → Shortcuts; under Settings → Controller the button glyphs follow the connected controller or can be fixed to one style. Rumble is off, weak or strong. In the desktop app, a PS5 DualSense connected by USB plays each hit on its left or right haptic motor, following the lane (Settings → Controller can switch that off for plain rumble).

## Replays

Every song you finish is saved as a replay, the newest 30 by default. The Replays tab of the main menu, beside Play and Edit, lists them with their score; a press on one plays it back on the highway and the stage, hit for hit, as it was played. A replay keeps every note of the chart it was played on, so it plays the same after the song is charted again or edited, and even after the song has left the library (then without its music). Test plays from the track editor, and songs skipped or left, are not saved.

While a replay plays: `Space` (the top face button, or Start) pauses and plays, `J` and `L` (the triggers) jump 10 seconds back and forward, `Home` (Back/View) starts it over, `Q` and `E` (the shoulder buttons) change the speed from 0.25x to 2x, and `H` (the left face button) hides the controls. On the timeline, which marks every missed note, left and right step 5 seconds; it can also be dragged. The controls stay in view until you hide them (`H`, the left face button, or Hide); the replay's own keys keep working while they are hidden, and a click, a tap, the hide key or a move of the menus brings them back.

**Export video** (`V` or the right stick click, the Video button on a replay, its end card or its options) exports a replay as an MP4 to share. Before it starts, it asks how the video should look, and remembers the answer: the HUD shown or hidden, the stage shown or hidden, the music on or off, wide 16:9 or upright 9:16, 720p, 1080p or 1440p, and 30 or 60 frames a second, and then where to save the file. The video is then exported in the background, in a worker of its own, while you go on using the game: the replay is drawn there frame by frame on the video's own clock, the stage, the highway and a HUD drawn for the video are laid onto one picture, and each frame goes straight to the browser's video encoder (WebCodecs) while the song's samples go to its audio encoder, both written into an MP4 by [mediabunny](https://mediabunny.dev). Videos are exported one after another, in the menus and while a replay is watched; they wait while a song is played or the editor is open, so nothing takes the machine away from the song. A replay being exported shows its progress on its row in the Replays tab (its options cancel the export), a box over the replay controls shows it while you watch, the main menu shows a small note, and a message says when the file is saved. Where a browser cannot export in the background, the video is exported on a screen of its own instead (frame by frame where it can encode, else recorded as the replay plays, in WebM in Firefox).

A replay can be kept (`K`, or from its options with `O` or the left face button): kept replays are never removed to make room and do not count towards the number kept. Settings → Gameplay switches recording off, sets how many replays are kept and deletes them all. A library backup carries every saved replay.

## Playing together

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

Nothing is sent anywhere until you connect to a server. It keeps your name, your identity's public key for it (never anything secret) and what its features need, and **Save my data** downloads all of it.

## Running a server

A server is one small Node program with everything in one folder: on Coolify, with Docker Compose behind HTTPS, or on your own PC for your own network. **[docs/server-setup.md](server-setup.md)** walks through it step by step: installing it, becoming its admin with the set-up code it prints, getting back in if you lose your identity, inviting friends, its settings, updates, backups and troubleshooting. [server/README.md](../server/README.md) is the reference for every setting and the API.

## Track editor

The **Edit** tab of the main menu is the list of your tracks, with the highlighted track's sixteen charts beside it (which are yours, which are the game's). Pick a track to open it in the editor, or bring in a new one with **New track** and choose how it gets its first charts:

- **Analyze** – the game charts the song as usual and you change what you like.
- **Start from scratch** – no analysis. The game only listens for the tempo (a few seconds, on any device, phones included) and you get empty lanes with the bar lines in place.

A song has sixteen charts: four parts (vocals, lead, bass, drums) at four difficulties. Each is edited on its own; a chart you never touch stays the one the game wrote. The game plays your chart in place of its own, charts save as you change them, and **Put back the game's chart** in the menu drops your version again.

The editor shows the lanes from above, as they run in a song: later is higher, and one line across them is the edit position and the playhead. The chart moves past the line. Beside the lanes stand the song's waveform and, for an analyzed song, a guide to what the game heard in that part.

|                         | Keyboard                                      | Controller                                                             | Mouse or touch                                    |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| Move                    | arrow keys; `PgUp` `PgDn` a bar; `Home` `End` | D-pad or left stick; triggers a bar; right stick runs through the song | wheel or drag; pinch or `Ctrl`+wheel to zoom      |
| Note                    | `Enter`, or `1` to `5` for a lane             | confirm                                                                | click or tap a lane; again to take it away        |
| Long note               | hold `Enter`, move up                         | hold confirm, move up                                                  | drag up from the note (on touch: hold, then drag) |
| Mark a stretch          | `Shift` + arrows, then `Enter`                | left face button, move, then confirm                                   | Select tool, or `Shift`+drag                      |
| Grid                    | `Q` `E`                                       | shoulder buttons                                                       | the arrows beside Grid                            |
| What notes snap to      | `S`                                           | left stick click                                                       | the Snap button                                   |
| Loop the marked stretch | `L`                                           | right stick click                                                      | the loop button                                   |
| Next note, next sound   | `Ctrl` or `Alt` + arrows                      | Snap to sounds, then move                                              | Snap to sounds                                    |
| Play                    | `Space`                                       | top face button                                                        | the play button                                   |
| Undo, redo              | `Ctrl`+`Z`, `Ctrl`+`Shift`+`Z`                | View / Create; redo in the menu                                        | the arrows in the toolbar                         |
| Everything else         | `M`                                           | Options / Menu                                                         | Menu                                              |

A marked stretch can be copied, cut, repeated after itself (the quick way to write a bar four times), mirrored, deleted, or made an overdrive phrase; long notes in it can be made hold-and-release notes.

**Hold-and-release notes** are made the way the game draws them, as a hold with a tile at its end: set a tile down on a long note and the note ends there and must be let go there; or stretch a long note until it reaches a tile in its lane and that tile becomes its end. A tile set on the end of such a note takes the release away again. (`H`, or **Let go on time** in the menu, switches it for the long note under the cursor without changing its length.) Notes played in while recording are always notes of their own. What is copied can be pasted into another part or difficulty (a fifth lane folds onto the fourth).

**Snapping.** Notes snap to the grid (quarters down to thirty-seconds, with triplets), to the sounds heard in the song, or to nothing:

- _The grid_ is the default: every note lands on a grid line, and a cursor step is one line.
- _Sounds_ puts a note on the nearest sound when one is within 90 ms, and the cursor steps from sound to sound. The sounds are what the analysis heard in that part or, for a song without one, every attack in the waveform; they show as ticks beside the lanes.
- _Nothing_ places notes exactly where they are put, and a recording keeps the timing it was played with.

**Tools** (in the menu, and under More tools on a selection): snap notes to the grid or to sounds, fill a marked stretch with a note on every grid line, move a lane left or right, play a stretch backwards, thin it out, make it twice or half as fast. **Quantize all notes** and **Clear all notes** are in the menu under This chart.

**Difficulties.** _Write the easier charts from this one_ writes every easier difficulty of the part as a simpler version of the chart above it (the rhythm that difficulty plays, fewer notes in a bar, smaller chords, four lanes); _Simplify from …_ does it for one chart. **Check the chart** lists what stands out on its difficulty (notes very close together, chords larger than usual, two notes under one thumb on a controller) and goes to each.

**On a controller** every control on screen carries the button that reaches it, the Controls panel lists them all, and everything else is in the menu (Options or Menu), where each row and button says in a line what it does.

- **Record** (`R`) plays the song from a bar before the cursor and turns every lane press into a note on the grid, with the keys, buttons and lanes you play the game with. A press that is held becomes a long note. It works at every speed down to a quarter, and can add to the notes that are there or replace the ones it passes.
- **Test play** (`T`) runs the chart in the game itself from the bar the cursor is in, and returns to the editor, undo history and all. It keeps no score.
- **Tempo and bars** sets the grid notes snap to: following the beats heard in the song, or one tempo with a first beat and a number of beats in a bar. Tap the beat, put a bar line at the cursor, or let the game listen again. Notes stay on their beats when the grid changes.
- **Listening**: a click on every note and a metronome, three slower speeds, looping the marked stretch, and any of the song's separated stems on its own.
- **Step entry**: with _After a note: Move on a step_, the cursor moves on after each note, so a run is written by pressing lanes one after another.

The code is in `src/editor` (the grid, the chart being edited, the canvas, the controller behind the screen) and `src/ui/Editor*.tsx`.

## Desktop app

The desktop app needs the [Tauri prerequisites](https://tauri.app/start/prerequisites/): Rust (rustup), the MSVC C++ build tools and WebView2 (on Windows).

```bash
pnpm tauri dev      # run the desktop app
pnpm tauri build    # build an installer (NSIS/MSI on Windows)
```

The installers are not signed with a Windows or Apple developer certificate yet: Windows asks to confirm the first start (More info, Run anyway), and macOS wants the app opened once with a right-click and Open.

### Discord status and Join from Discord

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

## Production web build

```bash
pnpm build          # outputs static files to dist/
pnpm preview
```

The analysis runs its model on several threads, which needs the page to be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. A host that cannot send them (GitHub Pages) gets them from a small service worker, `public/coi-sw.js`, which the page registers by itself. Set `BASE_PATH` when the site is not served from the root (`BASE_PATH=/soundwave/ pnpm build`).

## Releases

Every push to `main` is checked, and the desktop app is built for Windows, macOS and Linux and published as a **pre-release** (version: the next patch with the run number, such as `0.1.1-42`) for trying the newest work. Only the newest three are kept. Installed apps never update to a pre-release.

A **full release** is started by hand: Actions › **Release** › Run workflow, choosing which part of the version to raise (or an exact version). It checks `main`, commits the version and tags it, builds and signs the app for all three systems, publishes the release with the updater's `latest.json`, and deploys the website to GitHub Pages. The website is only ever deployed from a full release.

The desktop app looks for a new full release when it starts (Settings › Advanced › Updates; it can be switched off) and shows an **Update** button on the main menu when there is one. Installing downloads the release, checks its signature against the public key in `src-tauri/tauri.conf.json`, installs it and starts again. The matching private key is the repository secret `TAURI_SIGNING_PRIVATE_KEY`; without it a release cannot be built, and if it is lost, installed apps can no longer update themselves, so keep a copy somewhere safe.

The workflows are in `.github/workflows`: `ci.yml` (checks, also on pull requests), `prerelease.yml` and `release.yml`.

## How analysis works

Analysis runs in Web Workers in both the browser and the desktop app. Every song is first separated into stems, and each part is charted from its own stem:

- **Stem separation** – [Demucs](https://github.com/adefossez/demucs) (`htdemucs`) splits the song into drums, bass, vocals and the other instruments. It runs on [ONNX Runtime Web](https://onnxruntime.ai/): on the graphics card through WebGPU where the browser has it (about 10 seconds for a four-minute song on a fast card; the game prepares each segment and rebuilds the previous one while the card works on the current one), otherwise on the processor through WebAssembly (several minutes). The game does the model's short-time Fourier transform itself (`src/analysis/separation/`). The same song always gives the same stems.
- **Transcription** – [Basic Pitch](https://github.com/spotify/basic-pitch) transcribes the bass, vocal and instrument stems, on the same runtime and device as the separation (its ONNX file, `public/models/basic-pitch/nmp.onnx`). Its notes are decoded by a port of Basic Pitch's own post-processing (`src/analysis/pitch/noteEvents.ts`) that gives the same notes far faster; a test checks the two agree. All three stems of a four-minute song take under two seconds on a graphics card.
- **Beats and bars** – [Beat This](https://github.com/CPJKU/beat_this) finds the beats and where the bars start, from the mix, on the same runtime (its small model, `public/models/beat-this/small0.onnx`, 10 MB, served with the game and loaded when an analysis starts). The game computes the model's spectrogram itself and picks the beats the way Beat This does (`src/analysis/beat/`); a test checks the spectrogram against Beat This's own. If the model cannot be loaded, the game's own beat tracker finds the grid.

A four-minute song takes about 20 seconds in all on a fast graphics card, most of it the separation.

- The stems are kept: in the track editor, **Play** in the menu plays any one of them on its own (instruments, bass, drums, vocals), to hear a part clearly while charting it.

The stem model is not part of the game's files. It is downloaded once (90 MB), the first time the game opens, from this repository (`models/htdemucs/htdemucs-v1.onnx`, an export of the model with its weights as float16, made by `tools/analysis/export_stem_model.py`), checked against a known hash and kept in the browser's storage; Settings → Analysis shows its state. `src/analysis/separation/model.ts` has the address and the hash.

Separating a song needs about 2.5 GB of memory while it runs. Phones and tablets are let try like any other device, but their browsers often give a page less than that, and may then close the game partway through an analysis; such a song is best analyzed on a computer and brought over as a Soundwave song file or in a library backup. On a phone or tablet the stem model is downloaded when the first song is analyzed, not as soon as the game opens. The runtime's WebAssembly file (27 MiB) is shipped gzip-compressed (`public/ort/…wasm.gz`, about 7 MiB) and unpacked by the worker, so no file in the build is over the 25 MiB some hosts allow per file; `pnpm build` fails if one is (`scripts/check-dist.mjs`). On the processor the model wants threads, which a browser only allows on pages served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`; the dev and preview servers and the desktop app send both, and a host for the built game should too.

The pipeline then works on the mix and the stems:

1. **Spectrum** – STFT (2048/512 at 22.05 kHz).
2. **Harmonic/percussive separation** – median-filter HPSS.
3. **Rhythm** – beats and bar starts from the beat model (without it: a band-balanced onset envelope, tempo by an autocorrelation comb, dynamic-programming beat tracking, and bars from the accents). The grid is then calibrated against the detected drum attacks.
4. **Drums** – kick/snare/hat onsets from band-limited flux of the drum stem, refined to the attack in the time domain.
5. **Harmony** – chroma, chord changes, key.
6. **Melody** – each part's line is built from its stem's audible attacks and the notes transcribed in it (`src/analysis/pitch/stemLines.ts`):
   - **Bass**: the bass stem, with octave doublings folded onto one octave.
   - **Lead**: the instrument stem. Chords (three or more steady pitches struck together) stay chords; single-note riffs are followed as one melodic path.
   - **Vocals**: the vocal stem, one sung line, with wavering pitches settled onto the note that was meant.
7. **Structure** – sections and energy drive overdrive placement.

### Charting

Charts follow common five-lane authoring practice (`src/chart/generator.ts`, `src/chart/profiles.ts`):

- **Expert** is a literal transcription: sixteenths, plus triplets where the timing clearly is triplet.
- **Lanes follow the pitch** within each phrase (two bars, or up to a rest). The lowest note goes left and the highest right, the same pitch keeps its lane, and leaps move further than steps. Long runs wrap, and a repeated phrase is charted identically.
- **Chord shapes** come from the interval: adjacent lanes for close voicings, one lane apart for fifths, wider for octaves.
- **Each lower difficulty reduces the one above it:**
  - Hard drops three-note chords and thins very fast notes.
  - Medium keeps eighths and close chords.
  - Easy keeps quarter notes, playing the root of each chord.
- **Drums** use a fixed kit layout (kick left, snare middle, hi-hats right). Hi-hats thin out first on lower difficulties.
- **Overdrive phrases** cover the same musical passages on every difficulty.

To tune analysis or charts on your own files without the UI, see `scripts/dev/analyze.dev.ts` (`pnpm dev:analyze`).

### The Python reference (`ml-service/`)

`ml-service/` is the Python service the stem analysis started in (Demucs and Basic Pitch behind a small HTTP API). The game no longer talks to it. It stays as the reference the in-app separation is checked against and as the environment `tools/analysis/export_stem_model.py` and the offline tooling in `scripts/dev/` run in. See [ml-service/README.md](../ml-service/README.md).

## Tests

```bash
pnpm test
```

Unit tests cover:

- tempo, beat and drum timing on synthetic audio;
- the beat model's spectrogram, its windows and its peak picking;
- HPSS;
- bass and lead pitch extraction;
- chart invariants: lanes, gaps, chords, sustains, determinism, density by difficulty;
- judging, scoring and overdrive;
- the track editor: beat grids and snapping, finding a tempo and the sounds of a song by listening, every edit and its undo, the tools, easier charts written from harder ones, edited charts in storage, in song files and in play.

## The 3D stage

The stage is built in Blender and drawn by the game's own renderer (`src/render/aurora`). Three scripts regenerate everything the repository ships in `public/stage/aurora`:

```
blender -b --factory-startup -P tools/stage/aurora/build_venue.py -- --out public/stage/aurora
blender -b --factory-startup -P tools/stage/aurora/build_scenery.py -- --out public/stage/aurora
blender -b --factory-startup -P tools/stage/aurora/build_cast.py -- --out public/stage/aurora
```

`build_venue.py` makes the stage geometry, its baked contact shading and the positions the game needs (cameras, fixtures, band marks, pyro); add `--save some.blend` to open the result in Blender. `build_scenery.py` makes the land, the lake and the festival grounds around it.

`build_cast.py` makes the band and the crowd. The people are public-domain (CC0) characters by [Quaternius](https://quaternius.com/), brought onto one small skeleton, reduced for the crowd and baked together with their animation loops. One crowd loop, the dance, comes from Quaternius's animation library; the other crowd loops and the band's playing are written as motion in the script, timed to the beat, and the instruments (a drum kit with its hardware, a guitar, a bass and a microphone) are modelled in `instruments.py` next to it and fitted to each player. The script reads the packs from `local-audio/open-characters/`, which is not part of the repository; to rebuild the cast, download these three from quaternius.com and unpack each into a folder of its own there:

- Ultimate Modular Men, as `modular-men`
- Ultimate Modular Women, as `modular-women`
- Universal Animation Library (the free standard version), as `ual1`

The game draws the stage in a worker of its own (`src/render/stage/StageView.ts`): the page hands the canvas over (`OffscreenCanvas`) and only tells the stage what the music is doing, so however long a stage frame takes, the menus, the highway and the input never wait for it. Where a worker cannot draw with WebGL, the same code runs on the page instead. Its shaders are compiled in parallel before its first frame, and only the few people close to the camera are drawn with the detailed figure.

During development, `/#stage?preset=high&shot=hero&level=0.9` shows the stage alone with a simulated song (drawn on the page, so `window.__stage` can be reached from the console).

### Optional: downloaded characters

The game can use other rigged characters with motion-captured animation in place of its own cast. They are not part of this repository, because their licence allows shipping them inside a game but not passing them on. To use them on your machine:

1. Download the files named at the top of `tools/stage/aurora/build_people.py` from [Mixamo](https://www.mixamo.com/) as FBX into `local-audio/mixamo/`: the band members with their animation and skin, the crowd characters in T-pose, the crowd animations without skin.
2. Run `blender -b --factory-startup -P tools/stage/aurora/build_people.py`.

The script reduces the crowd characters to a few hundred triangles, bakes their textures into vertex colours, retargets the crowd animations onto each of them and writes the result to `public/stage/aurora/local/`, which git ignores. When that folder exists the game loads it instead of the default cast, in development and in builds made from that checkout. Check the characters' current terms before you distribute such a build.

Both scripts write the same format: plain meshes whose vertices carry up to four joints and weights, and a small texture of joint matrices per animation frame, which the game uses to animate thousands of instances in a vertex shader.

## Song files (`.soundwave`)

Every song in the library is stored as a `.soundwave` file: one file holding the song's details, its cover, the analysis its charts are made from, the charts edited by hand in the track editor, and the original audio byte for byte. **Export** on a song's page saves that file, to keep or to send to a friend; dropping it on the game, or picking it with **Add songs**, adds the song with its charts ready, without analyzing it again. The song's id is the hash of its audio, so the same song arrives as the same song, with the same charts. Scores and separated stems stay on the device that made them.

The installers register the extension: double-clicking a song file opens it in the game, or hands it to the game already running. The layout of the file is described at the top of `src/storage/soundwaveFile.ts`; songs stored before the format existed are converted the first time the game starts.

**Settings › Advanced** exports the whole library as one `.soundwave-backup` file: every song file, the best scores and the settings, to move the game to another computer or keep a copy. Importing one adds the songs that are not there yet, keeps the better of each score, takes over the backup's settings and restarts the game. Separated stems are left out; they are made again when a song is analyzed. The layout is described at the top of `src/storage/backup.ts`.

Song files have their own icon, a page with the note highway on it. A script draws it and writes every size into `src-tauri/icons/soundwave-file.ico`, which the installers set on the file type (`src-tauri/windows/`):

```
node tools/icon/build_file_icon.mjs
```

## The app icon

The icon is a render of the note highway, built from the same measurements the game draws it with. One script makes the picture, and Tauri's tool cuts every size from it:

```
blender -b --factory-startup -P tools/icon/build_icon.py -- --out src-tauri/icons/icon.png
pnpm tauri icon src-tauri/icons/icon.png
```

The second command also writes `android` and `ios` folders into `src-tauri/icons`; the desktop app does not use them.

The website uses the same icon, from `public/`: `favicon.ico` and `favicon-32.png` (copies of `icon.ico` and `32x32.png`), `icon-192.png` for Android home screens, and `apple-touch-icon.png` (180 px, on the game's night colour, because iOS fills transparent corners with black). After a new icon, make them again:

```
cp src-tauri/icons/icon.ico public/favicon.ico
cp src-tauri/icons/32x32.png public/favicon-32.png
ffmpeg -i src-tauri/icons/icon.png -vf scale=192:192:flags=lanczos public/icon-192.png
ffmpeg -f lavfi -i color=c=0x0e0828:s=180x180 -i src-tauri/icons/icon.png -filter_complex "[1]scale=180:180:flags=lanczos[i];[0][i]overlay=0:0:format=auto,format=rgb24" -frames:v 1 public/apple-touch-icon.png
```

## Music and sound

The menu theme and every interface sound are the project's own. `tools/audio` holds a small offline orchestra (a sampler, a concert hall and a mastering chain in `orchestra.py`), the score of the theme (`theme.py`), a few synthesized instruments that sit under the orchestra (`synth.py`), the recipes for the interface sounds (`sfx.py`) and a synthesized festival crowd (`crowd.py`). Two commands regenerate everything in `public/audio`:

```
python tools/audio/theme.py
python tools/audio/sfx.py
```

They need Python 3 with `numpy`, `scipy` and `soundfile`, and the instrument samples, which are not part of this repository:

1. Check out the strings, brass and percussion folders of the [Versilian Studios Chamber Orchestra 2 Community Edition](https://github.com/sgossner/VSCO-2-CE) (CC0) into `local-audio/samples/vsco2ce/`. The folders used are listed at the top of `tools/audio/orchestra.py`; about 1.3 GB.
2. Optional: save the public-domain recording [Festival concert people crowd](https://commons.wikimedia.org/wiki/File:Festival_concert_people_crowd.ogg) as `local-audio/samples/crowd/crowd.wav`. It is layered under the synthesized crowd for texture; without it the crowd is synthesized alone.
3. Optional, for the finale's crowd: save the recording "Crowd cheering" by voicebosch from [Pixabay](https://pixabay.com/sound-effects/) (file `voicebosch-crowd-cheering-198411.mp3`) as a 48 kHz WAV at `local-audio/samples/crowd/crowd-cheering.wav`. The finale is a 4.9-second cut of it (from 28.55 s, where its third cheer erupts) over a quiet bed of the applause recordings below. Without it, the finale is mixed from the recordings in step 4 alone.
4. Optional, for the finale's applause (and its crowd when the recording above is missing): save these four recordings from Wikimedia Commons as 48 kHz WAV files in `local-audio/samples/crowd/commons/`. For the applause: [Applause i](https://commons.wikimedia.org/wiki/File:Applause_i.ogg) by thore (public domain) as `Applause-i.wav` and [applause-2](https://commons.wikimedia.org/wiki/File:277021_sandermotions_applause-2.wav) by Sandermotions (CC0) as `277021-sandermotions-applause-2.wav`. For the cheering: [Hurray](https://commons.wikimedia.org/wiki/File:Hurray.ogg) by starlite (public domain) as `Hurray.wav` and [Clapping hurray](https://commons.wikimedia.org/wiki/File:Clapping_hurray.ogg) by starlite (public domain) as `Clapping-hurray.wav`. The finale's crowd is mixed from them: the applause as the bed and, well above it, the cheering takes laid over each other several times at different pitches to make a crowd of voices (a synthesized crowd of that size has no distinct hands or voices in it and comes out as wind). Without the recordings it is synthesized.

The first run measures the pitch of every sample (file names disagree about octaves) and caches the result next to the library. `theme.py --stems` prints how loud each instrument group is in each section. The theme is one seamless loop plus a short intro that is played once before it; each sound is levelled to its place in `LEVELS` in `sfx.py`, so the game plays them all at the same gain.

## Licence

Copyright 2026 DavidNiessen. The source code and the project's own art and audio (stage model, scenery, instruments, animation loops, app icon, menu theme, interface sounds) are licensed under the [Apache License 2.0](../LICENSE); see [NOTICE](../NOTICE).

Third-party parts keep their own licences:

| Part                                                                                                                                              | Licence                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| three.js, React, fft.js, music-metadata, ONNX Runtime Web                                                                                         | MIT                                                                              |
| idb, lucide-react                                                                                                                                 | ISC                                                                              |
| mediabunny (the replay videos' MP4 writer)                                                                                                        | MPL 2.0                                                                          |
| Basic Pitch (code and model), Tauri                                                                                                               | Apache-2.0 (Tauri also MIT)                                                      |
| Archivo typeface (`src/ui/fonts/archivo`)                                                                                                         | SIL Open Font License 1.1                                                        |
| Band and crowd characters, and the crowd's dance loop: Ultimate Modular Men, Ultimate Modular Women and Universal Animation Library by Quaternius | CC0 1.0 (public domain)                                                          |
| The crowd in the finale sound: "Crowd cheering" by voicebosch, from Pixabay                                                                       | Pixabay Content License (free to use, not to be passed on as a standalone sound) |
| The applause under it: recordings by thore (public domain) and by Sandermotions (CC0), from Wikimedia Commons                                     | Public domain / CC0 1.0                                                          |
| Demucs (the code the stem model was exported from)                                                                                                | MIT                                                                              |
| Beat This (code and model)                                                                                                                        | MIT                                                                              |
| The Python reference in `ml-service/`: FastAPI, librosa, Demucs and others                                                                        | their own licences; see `ml-service/requirements*.txt`                           |

The Demucs stem model (`models/htdemucs/`, and the copy the game downloads) is the published `htdemucs` weights in another file format. Its authors released the code under the MIT licence but state that the licence of the weights is not clear, because part of the music they were trained on was only cleared for research; the Apache licence of this repository does not cover them. Songs you import stay on your machine.

The beat model (`public/models/beat-this/`) is Beat This's published `small0` weights in another file format. Its authors released code and weights under the MIT licence, and note that some of the recordings it was trained on are copyrighted or under limited Creative Commons licences.
