# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Soundwave is a rhythm game for the player's own music: a song is separated into stems, analyzed and charted (Lead, Bass, Drums, Vocals at four difficulties), then played on a 3D note highway in front of a 3D festival stage. It runs in the browser (React + Vite) and as a desktop app (Tauri 2, `src-tauri/`). README.md, DESIGN.md (the design reference: visual language, sounds, motion) and PRODUCT.md (what the game is for) are the longer references.

## Commands

```bash
pnpm install          # also copies the analysis models into public/ (scripts/copy-models.mjs)
pnpm dev              # http://localhost:5173 (pnpm dev:alt: port 5180)
pnpm check            # typecheck + oxlint + prettier --check + vitest: what CI runs
pnpm test             # vitest run
pnpm exec vitest run tests/chart.test.ts          # one file
pnpm exec vitest run tests/chart.test.ts -t "drum chords"   # one test by name
pnpm build            # tsc + vite build + scripts/check-dist.mjs (fails on any file over 25 MiB)
pnpm tauri dev        # desktop app
pnpm dev:analyze      # offline analysis harness (scripts/dev/analyze.dev.ts; needs local-audio/)
node server/src/main.ts   # a Soundwave server on port 7420 (server/README.md; Node 24.7+)
```

Rust (`src-tauri/`): `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib`.

Tests synthesize their audio; never add real songs or recordings to the repository, tests, issues or PRs. `local-audio/` (gitignored) holds local test material for the dev harnesses.

## Architecture

**Analysis** (`src/analysis/`) runs in Web Workers. `separation/` runs Demucs (stems) and Basic Pitch (transcription) on ONNX Runtime Web: WebGPU where available, otherwise WebAssembly with threads (which needs COOP/COEP headers: dev server, `public/_headers`, the `public/coi-sw.js` service worker on GitHub Pages, and the Tauri config all provide them). The stem model is downloaded once from the repo (`separation/model.ts` has the URL and hash), not bundled. `pipeline.ts` (`analyzeSignal`) then builds the beat grid, drum hits, harmony and each part's line from its stem (`pitch/stemLines.ts`); `manager.ts` queues songs, caches results and derives charts. Devices without enough memory (phones) cannot analyze, only play songs analyzed elsewhere.

**Charts are generated, not stored.** `src/chart/generator.ts` turns an `AnalysisResult` into a chart per part and difficulty (profiles in `chart/profiles.ts`); `chart/presence.ts` decides which parts a song really has. Only hand-edited charts are stored (`src/editor/edits.ts`, notes in seconds). Any change to what the analysis produces must raise `ANALYSIS_VERSION` in `src/analysis/types.ts`, or cached analyses and `.soundwave` files keep the old result.

**Songs are `.soundwave` files** (`src/storage/soundwaveFile.ts`: a chunked binary format with META, COVR, ANLS, EDIT and AUDI last). Each song's file is the stored copy in IndexedDB (`storage/db.ts`), kept current by `storage/songFile.ts`; the database's song list and analysis cache are indexes of it. Song ids are the hash of the audio bytes. Metadata edits go into the `.soundwave` copy, never the original audio file.

**Playing** (`src/game/`): `PlayController` drives a song: the `GameSession` (judging, scoring, overdrive), the highway (`src/render/Highway.ts`, three.js shaders on the page), input, rumble and the stage. `applySettings` takes settings that may change mid-song (volume, offset, speed, rumble, graphics). Every call into the session goes through a `ReplayRecorder` (`game/replay.ts`), and a finished song is saved as a replay (`storage/replays.ts`: the chart as played and the run); given a recorded run, the same controller plays it back instead of taking input (`ui/ReplayScreen.tsx`). A replay's video (`ui/VideoExport.tsx`) is made frame by frame on its own clock (`PlayController.renderFrame`, `StageView.step`, `audio/bufferAnalyser.ts` for the music's levels) and encoded with WebCodecs into an MP4 (`game/videoRender.ts`, mediabunny); each frame lays the stage, the highway and a canvas-drawn HUD (`render/videoHud.ts`) onto one canvas. Where WebCodecs cannot encode, it is recorded in real time instead (`game/videoExport.ts`, MediaRecorder).

**The 3D stage** (`src/render/aurora/`, built from Blender assets in `public/stage/aurora/`) draws in a worker of its own through OffscreenCanvas (`render/stage/StageView.ts` on the page, `stage.worker.ts` + `stageHost.ts` in the worker), so a slow stage frame never holds up the menus or the highway. Where a worker cannot draw (and in the macOS app, which serves the game from `tauri://`), the same host runs on the page. Workers there fetch through the page (`src/app/workerFetch.ts`).

**Audio** (`src/audio/`): `AudioEngine` (Web Audio) plays songs; the desktop app can play through its own native output (`audio/native/`, `src-tauri/src/audio_out.rs`). PS5 DualSense haptics are driven natively too (`src-tauri/src/haptics.rs`, cpal; `src/input/rumble.ts`).

**Playing together** (docs/specs/online-play.md): `server/` is the Soundwave server, a pnpm workspace package of TypeScript that Node runs as it is (type stripping: no enums, no parameter properties, imports with `.ts`). It has accounts (`accounts.ts`, SQLite through `node:sqlite`, Argon2id from `node:crypto`), the HTTP API and one WebSocket per player (`app.ts`), and parties (`parties.ts`, pure: it is handed a send function and a clock). `src/net/protocol.ts` holds the messages and is imported by both sides, so it stays types and constants only. In the game, `src/net/client.ts` (`online`) signs in, keeps the socket and syncs the clock; The main menu's Online tab (`ui/OnlinePanel.tsx`) is the way in: connecting, starting or joining a party, the leaderboards and the player's look, with their band member on stage under a nametag. A server's shared songs show in the library (`net/serverSongs.ts`): streamed (held in memory, `audio/songAudio.ts` `lendSongAudio`, `analysisManager.lend`) or downloaded, as `settings.serverSongs` says; with `settings.shareLibrary` the player's analysed songs are shared to it. `ui/PartyScreen.tsx` is signing in and the party: a room of players where the host picks a mode (`PartyState.mode`: versus or showdown; band mode was taken out for now), that mode's lobby, and the results. A song a player lacks travels by itself: the host's game sends it to the server's cache (`server/src/partySongs.ts`) and the others download it (`src/net/partySongs.ts`). App makes the host's charts and follows a party's `start` into `PlayController.startTogether`. A party's song is judged locally and its score of record is the re-judged one, as for any song. A Showdown (`parties.ts` decides targets and hits, tested in `server/tests/showdown.test.ts`) reaches the song through `PlayController.strike`, `spendCharge` and `hit`: a Strike and a Drain cap are replay operations, so the re-judged score includes them; Fog is only drawn (`Highway.fog`). On stage a Showdown is a ring of podiums (`render/aurora/ring.ts`, `StageOptions.ring`), one per player in their look, in place of the band: they rise by place (`StageView.setPlaces`, from the board) and a Strike flies from striker to target (`StageView.strike`, from the server's `strikeFired`, which every player gets); the menu stage shows the ring behind a Showdown's lobby too (`menuStage.setMenuRing`, `AuroraStage.setRing`). Avatars dress the band on stage: `Avatars` go to the stage at creation (`StageOptions.avatars`) or live (`StageView.setAvatars`, `menuStage.setMenuAvatars`), and `Figures.restyle` recolours a band member; the instrument's paint carries the finish in its own draw's `aTop` (the crowd's shader is at the attribute limit). Join from Discord: `app/discord.ts` (`setDiscordJoin`, `onDiscordJoin`) and `src-tauri/src/discord.rs` (join secrets, a listener connection for `ACTIVITY_JOIN`, the `discord-<id>` launch scheme).

**UI** (`src/ui/`, React): `App.tsx` holds the views and the set flow. `actions.tsx` provides the action bar and per-screen actions (`useActions`), `input/menuNav.ts` the directional/controller navigation, `input/bindings.ts` every rebindable command (keyboard, controller, mouse). Styles are one stylesheet, `ui/styles.css`, with design tokens at the top.

## Conventions that are easy to miss

- **Every function must be reachable by keyboard, controller and touch, and every control shows the key or button that reaches it.** New commands go into `input/bindings.ts` so they show up under Settings → Shortcuts; elements that should not take controller focus get `data-nav-skip`.
- **Interface text and comments** are plain, specific sentences; comments say why.
- **Commits** follow Conventional Commits (`feat(editor): …`, `fix(ui): …`); the summary says what changes for the player.
- Do not name the commercial rhythm games this genre comes from, in code, docs, commits or UI.
- Models, fonts and other downloaded assets are committed to the repository (`models/`, `public/`); only code libraries come from npm.
- In `index.html`'s inline CSS (the loading screen), write `animation-*` longhands: the production minifier turns an `animation` shorthand without a name into `animation: none`.
- Dependabot is told not to raise `@tensorflow/tfjs` (Basic Pitch needs v3) or `cpal` minor versions (0.x API breaks); check its grouped PRs' CI before merging.
- Every push to `main` builds a pre-release for all three systems; full releases are started by hand (`.github/workflows/release.yml`), which also deploys the website.
