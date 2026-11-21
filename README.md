# Soundwave

**A rhythm game for your own music.** Drop in any song, and Soundwave separates it into stems,
charts Lead, Bass, Drums and Vocals at four difficulties, and puts you on a 3D note highway in
front of a live festival stage. Play alone, or with friends on a server of your own.

<a href="https://github.com/DavidNiessen/soundwave/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/DavidNiessen/soundwave/release.svg?mode=dark"><img alt="Latest release" src="https://shieldcn.dev/github/DavidNiessen/soundwave/release.svg?mode=light"></picture></a>
<a href="https://github.com/DavidNiessen/soundwave/actions/workflows/ci.yml"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/DavidNiessen/soundwave/ci.svg?mode=dark"><img alt="CI" src="https://shieldcn.dev/github/DavidNiessen/soundwave/ci.svg?mode=light"></picture></a>
<a href="LICENSE"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/DavidNiessen/soundwave/license.svg?mode=dark"><img alt="Licence: Apache-2.0" src="https://shieldcn.dev/github/DavidNiessen/soundwave/license.svg?mode=light"></picture></a>
<a href="https://github.com/DavidNiessen/soundwave/releases/latest"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/runs_on-Windows_%7C_macOS_%7C_Linux_%7C_Web-blue.svg?logo=tauri&amp;mode=dark"><img alt="Windows, macOS, Linux and the web" src="https://shieldcn.dev/badge/runs_on-Windows_%7C_macOS_%7C_Linux_%7C_Web-blue.svg?logo=tauri&amp;mode=light"></picture></a>
<a href="docs/server-setup.md"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/badge/servers-self--hosted-violet.svg?logo=docker&amp;mode=dark"><img alt="Servers: self-hosted" src="https://shieldcn.dev/badge/servers-self--hosted-violet.svg?logo=docker&amp;mode=light"></picture></a>
<a href="https://github.com/DavidNiessen/soundwave"><picture><source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/DavidNiessen/soundwave/stars.svg?mode=dark"><img alt="Stars" src="https://shieldcn.dev/github/DavidNiessen/soundwave/stars.svg?mode=light"></picture></a>

**[Play in your browser](https://soundwave.niessen.dev)** · **[Download the app](https://github.com/DavidNiessen/soundwave/releases/latest)** for Windows, macOS and Linux · **[Run a server](docs/server-setup.md)** for you and your friends

![Soundwave in play: the note highway in front of the night-time stage, with the crowd, the lights and the score](docs/screenshot.webp)

|                       |                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------- |
| **Your music**        | MP3, WAV, FLAC, OGG or M4A, analysed on your own device.                                                   |
| **Four parts**        | Lead, Bass, Drums and Vocals, each charted from its own separated stem, at four difficulties.              |
| **Any input**         | Keyboard, controller (with DualSense haptics in the app) or touchscreen, every control rebindable.         |
| **Track editor**      | Change any chart, or write one from nothing, with a keyboard, a mouse, a controller or touch.              |
| **Replays and video** | Every song you finish is saved; watch it back or export it as an MP4.                                      |
| **Play together**     | Parties, Showdowns and leaderboards on servers players run themselves. [Set one up](docs/server-setup.md). |

## Get started

- **Play:** [in your browser](https://soundwave.niessen.dev), or [download the app](https://github.com/DavidNiessen/soundwave/releases/latest) for Windows, macOS and Linux. Add a song, pick a part, play.
- **Play together:** open the **Online** tab and connect to a friend's server, or [run your own](docs/server-setup.md).
- **Build it:** you need Node.js 22+ and pnpm.

  ```bash
  pnpm install
  pnpm dev          # the game at http://localhost:5173
  pnpm tauri dev    # the desktop app
  pnpm check        # types, lint, formatting and tests
  ```

## Learn more

- [Guide](docs/guide.md): playing, replays, playing together, the track editor, the desktop app, releases, how analysis works
- [Server setup](docs/server-setup.md) and the [server reference](server/README.md)
- [Contributing](CONTRIBUTING.md) · [Code of conduct](CODE_OF_CONDUCT.md) · [Security](SECURITY.md)

## Licence

[Apache License 2.0](LICENSE), copyright 2026 DavidNiessen. Third-party parts keep their own licences; see [NOTICE](NOTICE) and the [guide](docs/guide.md#licence). The Demucs stem model's weights are not covered by this licence.
