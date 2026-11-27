# Development

Setup and checks are in the [README](../README.md#development) and [CONTRIBUTING.md](../CONTRIBUTING.md).

## Desktop app

The desktop app needs the [Tauri prerequisites](https://tauri.app/start/prerequisites/): Rust (rustup), the MSVC C++ build tools and WebView2 (on Windows).

```bash
pnpm tauri dev      # run the desktop app
pnpm tauri build    # build an installer (NSIS/MSI on Windows)
```

The installers are not signed with a Windows or Apple developer certificate yet: Windows asks to confirm the first start (More info, Run anyway), and macOS wants the app opened once with a right-click and Open.

## Production web build

```bash
pnpm build          # outputs static files to dist/
pnpm preview
```

The analysis runs its model on several threads, which needs the page to be served with `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. A host that cannot send them (GitHub Pages) gets them from a small service worker, `public/coi-sw.js`, which the page registers by itself. Set `BASE_PATH` when the site is not served from the root (`BASE_PATH=/soundwave/ pnpm build`).

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
