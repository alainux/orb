<p align="center">
  <img src="docs/assets/orb-logo.svg" width="88" alt="Orb logo">
</p>

<h1 align="center">Orb</h1>

<p align="center"><strong>Conversational realtime voice for the Pi coding harness.</strong></p>

<p align="center">
  <a href="https://github.com/alainux/orb/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/alainux/orb/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://www.npmjs.com/package/@alainux/orb"><img alt="npm" src="https://img.shields.io/npm/v/%40alainux%2Forb?label=npm"></a>
  <img alt="license" src="https://img.shields.io/badge/license-MIT-6b7280">
  <img alt="Pi package" src="https://img.shields.io/badge/Pi-package-8b5cf6">
  <img alt="realtime voice" src="https://img.shields.io/badge/voice-full--duplex-3b82f6">
</p>

<p align="center"><img src="docs/assets/orb-banner.png" alt="Orb for Pi" width="100%"></p>

Orb adds a calm full-duplex voice layer to [Pi](https://pi.dev). Speak naturally about the project; Orb turns that intent into useful engineering work, delegates it directly to Pi, waits while Pi works, and gives you concise high-level updates. You can keep typing into Pi normally at any time.

It is intentionally **not** a second coding agent. Pi remains the tool-using project agent. Orb is the conversational layer that drives it.

## What it feels like

> **You:** Can you explore the project?
>
> **Orb:** Sure — one sec.
>
> *Orb delegates a complete repository exploration to Pi, waits for it to inspect structure/docs/scripts and run relevant build/tests.*
>
> **Orb:** It's a small TypeScript Pi package with a Go audio sidecar. The test/build path is healthy; the provider and UI layers are already separated cleanly. The main thing I'd look at next is the release packaging.

No narrated `ls`. No "shall I open README?". The full Pi screen is already there when you want detail.

## Interface

Orb inherits Pi's active theme and renders a compact panel above the native editor:

- **Left:** a dense spherical particle-wave field that reacts to both you and Orb.
- **Right:** only the voice conversation and Orb's own tool activity (`YOU`, `ORB`, `ORB›`).
- **Below:** Pi remains Pi. Its messages, tools, editor, commands, and manual workflow stay untouched.

## Install

### Option A — install as a Pi extension

```bash
pi install https://github.com/alainux/orb
```

Then start Pi and enable voice:

```text
/voice
```

### Option B — convenience installer + `orb` launcher

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/alainux/orb/main/scripts/install.sh | sh
orb
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/alainux/orb/main/scripts/install.ps1 -UseBasicParsing | iex
orb
```

The launcher starts Pi with Orb voice enabled immediately. You can still use plain `pi` and `/voice` whenever you prefer. The Pi package points at the TypeScript extension source directly, so Git installs do not depend on a prebuilt `dist/` directory.

### Option C — npm package

```bash
npm install -g @alainux/orb
orb
```

The npm launcher loads Orb explicitly with Pi, so it also works without a separate `pi install`. Release automation targets Linux, macOS, and Windows on x64 and arm64 where GitHub-hosted builders are available; when a matching helper is unavailable, Orb falls back to building the small Go audio sidecar locally.

## Provider setup

Gemini Live:

```bash
export ORB_PROVIDER=gemini
export GEMINI_API_KEY="your-key"
```

OpenAI Realtime:

```bash
export ORB_PROVIDER=openai
export OPENAI_API_KEY="your-key"
```

Then:

```bash
orb
# or: pi → /voice
```

Commands are deliberately small:

```text
/voice
/voice start gemini
/voice start openai
/voice provider gemini
/voice status
/voice log
/voice stop
```

`Ctrl+Alt+V` toggles voice mode.

## Configuration

Most behavior is configurable without changing source. Orb merges:

1. `~/.config/orb/config.json` (or `%APPDATA%\\orb\\config.json` on Windows)
2. `<project>/.orb/config.json`
3. `ORB_CONFIG=/some/config.json`
4. environment overrides

Example:

```json
{
  "provider": "gemini",
  "voice": {
    "temperature": 0.72,
    "greeting": true,
    "promptFile": ".orb/voice-prompt.md"
  },
  "ui": {
    "panelHeight": 14,
    "activityLines": 10,
    "orbDensity": 1.10
  }
}
```

The complete default voice prompt ships at [`prompts/default.md`](prompts/default.md), so the interaction style is just as configurable as the model and UI.

See [Configuration](docs/CONFIGURATION.md) for every option.

## Long-running sessions

Orb is designed to stay open during coding sessions.

For Gemini Live, it enables **context-window compression** and **session resumption** by default. Gemini periodically rotates Live WebSocket connections; Orb stores the latest resumption handle and reconnects when the server sends `GoAway`. If a connection cannot be safely resumed, voice mode closes with a friendly notification and can be reopened with `/voice` instead of surfacing the normal provider rollover as a crash.

## Audio architecture

The versions that paced PCM on Node's event loop were unreliable under a busy coding TUI. Orb does not do that anymore.

```text
realtime provider  ⇄  TypeScript transport  ⇄  Go audio sidecar  ⇄  hardware callback
```

The Go helper owns microphone capture and speaker playback at the device clock. Pi rendering and tool activity cannot change playback cadence.

Release packages ship prebuilt helpers for common platforms. Source installs first try the latest GitHub release binary, then fall back to a local Go+C compiler build.

Run diagnostics:

```bash
npm run doctor
```

## Pi orchestration

The realtime voice model has only three project-facing tools:

- `run_pi_task` — submit a complete engineering task directly to Pi.
- `observe_pi` — wait for Pi activity/completion.
- `read_pi_log` — inspect recent **visible** Pi messages/tool results when needed for factual context.

It has no shell, filesystem, or arbitrary execution tool of its own. Hidden Pi reasoning is never mirrored into Orb.

The native Pi editor is not watched or modified. If you type and submit something manually, it is simply normal Pi usage.

## Development

```bash
git clone https://github.com/alainux/orb.git
cd orb
npm install --ignore-scripts
npm run check
npm run build:audio
pi -e ./extensions/voice.ts
```

Published installs do **not** require Go. Release packages ship platform audio helpers, and Git installs can provision the matching helper from GitHub Releases. `npm run build:audio` is only for contributors or unreleased source checkouts. On macOS Orb also finds Homebrew Go at `/opt/homebrew/bin/go` even when Pi was launched with a reduced `PATH`.


Useful targets:

```bash
npm run typecheck
npm test
npm run test:audio-helper
npm run build
npm run smoke
npm run pack:check
```

Read [Architecture](docs/ARCHITECTURE.md), [Configuration](docs/CONFIGURATION.md), [Releasing](docs/RELEASING.md), and [Contributing](CONTRIBUTING.md) before changing public behavior.

## Project layout

```text
extensions/        Pi package entry point
src/providers/     Gemini / OpenAI realtime adapters
src/audio/         Node ↔ Go audio transport
audio-helper/      hardware-timed Go audio engine
src/controller.ts  voice/Pi orchestration
src/pi-log.ts      internal visible Pi observation
src/orb.ts         particle-wave visualizer
src/widget.ts      Pi-themed UI
prompts/           configurable default voice prompt
config/            example configuration
site/              static project website
```

## License

MIT. See [LICENSE](LICENSE).


### `spawn go ENOENT` / missing audio helper

Orb 0.5.2+ does not require Go for normal released installs. It first uses a bundled helper or downloads the matching binary from the GitHub release. For an unreleased source checkout, run `make build` (complete build) or `npm run build:audio`; this source-build path requires Go 1.23+ and a C compiler. Use `npm run doctor` to see exactly which helper and Go executable Orb can resolve.
