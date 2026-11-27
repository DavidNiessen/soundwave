# Contributing to Soundwave

Thanks for wanting to help. Bug reports, ideas and pull requests are all welcome.

## Before you start

- **Bugs and ideas:** open an issue first, so we can agree on the problem before anyone writes code. Use the templates; a bug report with steps to reproduce gets fixed far sooner.
- **Larger changes** (a new screen, a new file format, a change to how songs are analyzed or charted): describe the plan in an issue and wait for a go-ahead.
- **Security problems:** do not open an issue; see [SECURITY.md](SECURITY.md).
- **Music:** never add songs, charts or recordings you do not own to the repository, issues or pull requests, not even as test data. Tests use generated audio.

## Setting up

You need [Node.js](https://nodejs.org/) 22 or newer and [pnpm](https://pnpm.io/) (`corepack enable` gives you the version the project pins). For the desktop app you also need the [Tauri prerequisites](https://tauri.app/start/prerequisites/) (Rust, and on Windows the MSVC build tools and WebView2).

```bash
pnpm install
pnpm dev            # the game in the browser, at http://localhost:5173
pnpm tauri dev      # the desktop app
```

## Checks

Pull requests run the same checks as [CI](.github/workflows/ci.yml). Run them before you push:

```bash
pnpm check          # types, lint, formatting and tests
pnpm format         # fixes formatting (Prettier)
pnpm lint:fix       # fixes what the linter can fix (oxlint)
```

For the Rust code in `src-tauri/`:

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
cargo test --lib
```

New behaviour comes with tests (`tests/`, run with Vitest). The existing ones show how: audio is synthesized in the test, never loaded from a file.

## Style

- **Code:** TypeScript and React, formatted by Prettier, linted by oxlint. Prefer plain functions and small modules; follow the patterns already in the folder you work in.
- **Comments** say why, in plain sentences.
- **Interface text** is plain and specific: say what a control does, not how clever it is. Every control must be reachable with a keyboard, a controller and a touchscreen, and show the key or button that reaches it. [DESIGN.md](DESIGN.md) describes the visual language and [PRODUCT.md](PRODUCT.md) what the game is for.
- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/): `feat(editor): …`, `fix(ui): …`, `docs: …`, `ci: …`. The summary says what changes for the player in plain words.

## Pull requests

1. Fork the repository and branch from `main`.
2. Keep a pull request to one change; small ones are reviewed quickly.
3. Fill in the template: what changes, why, and how you checked it (with a screenshot for anything visible).
4. Make sure the checks pass.

Every push to `main` builds a pre-release for Windows, macOS and Linux; full releases are made by hand (see [Releases](README.md#releases)).

## Licence

Soundwave is licensed under the [Apache License 2.0](LICENSE). By submitting a contribution you agree that it is licensed under the same terms (section 5 of the licence), and that you have the right to submit it.
