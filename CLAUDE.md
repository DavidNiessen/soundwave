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
```

Rust (`src-tauri/`): `cargo fmt`, `cargo clippy --all-targets -- -D warnings`, `cargo test --lib`.

Tests synthesize their audio; never add real songs or recordings to the repository, tests, issues or PRs. `local-audio/` (gitignored) holds local test material for the dev harnesses.

## Architecture

**Analysis** (`src/analysis/`) runs in Web Workers. `separation/` runs Demucs (stems) and Basic Pitch (transcription) on ONNX Runtime Web: WebGPU where available, otherwise WebAssembly with threads (which needs COOP/COEP headers: dev server, `public/_headers`, the `public/coi-sw.js` service worker on GitHub Pages, and the Tauri config all provide them). The stem model is downloaded once from the repo (`separation/model.ts` has the URL and hash), not bundled. `pipeline.ts` (`analyzeSignal`) then builds the beat grid, drum hits, harmony and each part's line from its stem (`pitch/stemLines.ts`); the grid's beats and bar starts come from Beat This (`beat/`, its model served from `public/models/beat-this/` and opened in the analysis worker), with the tracker in `dsp/beats.ts` as the fallback; `manager.ts` queues songs, caches results and derives charts. Every device may analyze, phones and tablets too (`separation/support.ts`), though separating needs about 2.5 GB and a phone's browser may close the page partway; phones fetch the stem model only when their first song is analyzed. The desktop app on Apple silicon runs the models itself (`src-tauri/src/models.rs`, ONNX Runtime with Core ML on a Mac, reached on the `swmodel` scheme by `analysis/native.ts`; the `native` analysis device): WebKit's WebGPU piles up gigabytes per song and WebKit closes the page.

**Charts are generated, not stored.** `src/chart/generator.ts` turns an `AnalysisResult` into a chart per part and difficulty (profiles in `chart/profiles.ts`); `chart/presence.ts` decides which parts a song really has. Only hand-edited charts are stored (`src/editor/edits.ts`, notes in seconds). Any change to what the analysis produces must raise `ANALYSIS_VERSION` in `src/analysis/types.ts`, or cached analyses and `.soundwave` files keep the old result.

**Songs are `.soundwave` files** (`src/storage/soundwaveFile.ts`: a chunked binary format with META, COVR, ANLS, EDIT and AUDI last). Each song's file is the stored copy in IndexedDB (`storage/db.ts`), kept current by `storage/songFile.ts`; the database's song list and analysis cache are indexes of it. Song ids are the hash of the audio bytes. Metadata edits go into the `.soundwave` copy, never the original audio file.

**Playing** (`src/game/`): `PlayController` drives a song: the `GameSession` (judging, scoring, overdrive), the highway (`src/render/Highway.ts`, three.js shaders on the page), input, rumble and the stage. `applySettings` takes settings that may change mid-song (volume, offset, speed, rumble, graphics). Every call into the session goes through a `ReplayRecorder` (`game/replay.ts`), and a finished song is saved as a replay (`storage/replays.ts`: the chart as played and the run); given a recorded run, the same controller plays it back instead of taking input (`ui/ReplayScreen.tsx`). A replay's video is made in the background, in a worker of its own (`video/video.worker.ts`, `video/replayVideo.ts`; queued by `video/exports.ts`, held while a song is played or the editor is open): the replay frame by frame on the video's clock, the highway on an OffscreenCanvas (`Highway`'s `layout`), the stage (`AuroraStage`) and a canvas-drawn HUD (`render/videoHud.ts`) laid onto one canvas, the music's levels read from the song (`audio/bufferAnalyser.ts`, `game/showPulse.ts`, shared with the game), and encoded with WebCodecs into an MP4 (`game/videoRender.ts`, mediabunny). Where a worker cannot do that, `ui/VideoExport.tsx` makes it on screen (frame by frame, or recorded live with MediaRecorder, `game/videoExport.ts`).

**The 3D stage** (`src/render/aurora/`, built from Blender assets in `public/stage/aurora/`) draws in a worker of its own through OffscreenCanvas (`render/stage/StageView.ts` on the page, `stage.worker.ts` + `stageHost.ts` in the worker), so a slow stage frame never holds up the menus or the highway. Where a worker cannot draw (and in the macOS app, which serves the game from `tauri://`), the same host runs on the page. Workers there fetch through the page (`src/app/workerFetch.ts`).

**Audio** (`src/audio/`): `AudioEngine` (Web Audio) plays songs; the desktop app can play through its own native output (`audio/native/`, `src-tauri/src/audio_out.rs`). PS5 DualSense haptics are driven natively too (`src-tauri/src/haptics.rs`, cpal; `src/input/rumble.ts`), and so is a PlayStation controller's light bar (`src-tauri/src/lightbar.rs`, hidapi, USB only: by Bluetooth it would switch the controller to reports the web view cannot read; `src/input/lightbar.ts`, `LightShow` in `PlayController`).

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
