# orb

A full-duplex terminal workspace for **guided voice writing and editing** with a
realtime voice agent. You talk; a particle orb animates to your voice on the left
while the agent drafts one document you can copy or save on the right.

`orb` is built on the OpenAI Realtime API (raw 16-bit 24 kHz PCM over WebSocket),
with client-side VAD for natural barge-in interruption and a bounded jitter buffer
for smooth, low-latency speech.

![orb in the terminal](screenshots/orb-default.png)

## Features

- **Live voice agent** — streaming mic capture, VAD, barge-in interrupt, one
  conversational flow that drafts/edits a single artifact.
- **Animated particle orb** — Maps your voice energy and spectral centroid to a
  Braille/half-block particle field; states: idle, listening, processing,
  drafting, celebrating.
- **Two-pane TUI** — animated orb (left) + artifact stream (right) with a 30 ms
  character reveal; `Ctrl+S`/auto-save, and a status bar (word count, turns,
  save indicator).
- **Context files** — load UTF-8 files at startup to ground the agent.
- **Scripting hook** — pipe the produced artifact / a direction to an external
  process (`--pipe`) with a JSON payload on save.

## Install

### Homebrew (macOS & Linux)

```sh
brew tap alainux/orb
brew install alainux/orb/orb
```

### GitHub release binaries

Download the matching binary for your platform from the
[latest release](https://github.com/alainux/orb/releases):

| Asset            | Platform                          |
| ---------------- | --------------------------------- |
| `orb-darwin-arm64` | macOS 11+ Apple Silicon (arm64) |
| `orb-darwin-amd64` | macOS 11+ Intel (amd64)         |
| `orb-linux-amd64`  | Linux x86-64 (glibc)            |
| `orb-linux-arm64`  | Linux arm64 (glibc)             |

All four binaries are **statically linked** — PortAudio is compiled from source
into the binary, so there is no `libportaudio` runtime dependency.

```sh
chmod +x orb-darwin-arm64
./orb-darwin-arm64
```

## Build from source

Requires Go 1.24+ and a C compiler plus PortAudio:

```sh
make build        # builds a single static binary -> ./orb
make test         # unit tests
make dist         # build the 4-platform static matrix -> dist/
```

## Usage

```sh
orb                          # open the terminal workspace
orb drafts.md              # load a UTF-8 context file
orb --no-visual             # text-only mode (no orb animation)
orb --pipe 'cmd' --output out.md   # scripting hook + auto-save path
```

Speak to start. The agent drafts a single document you can copy or save. See
`orb --help` for all options.

## License

MIT © 2026 alainux