# Changelog

## Unreleased

- **Two notions of preference, matching Pi.** Durable preferences (provider, model, voice, auto-start, reasoning budget, context compression, session resumption, braille, audio tuning) live in an optional config file read at startup and are never rewritten by Orb. Temporary session toggles — how the model's reasoning is *revealed* — change at `/voice settings`, `/voice thinking`, or `Ctrl+Alt+T`: they persist only for the current Pi session (`pi.appendEntry` branch-restore, the canonical `examples/tools.ts` pattern) and a fresh launch starts from the config defaults. Panels never write to the config file on a toggle.
- The session/panel surface was narrowed to these temporary toggles (`src/settings.ts` now models only `SessionPrefs`); removed the `.orb/config.json` override so the package ships on pure defaults.

- Removed every bare `as any` cast from `src/` and the test suite; typed test seams now live in `tests/support/seams.ts`. Added an ESLint gate (no-explicit-any, no-unused-vars) wired into `npm run check` and the `lint` script, and documented the type-safety standard in `CONTRIBUTING.md`. The only remaining `any` is at genuine wire/SDK boundaries (`gemini.ts`, `pi-log.ts`) with a documented per-file exception.

## 0.6.0 — Pi control, scratchpad, turn logs and adaptive audio recovery

- Added permission-gated Pi management for cancelling active work, switching models, changing thinking level, and direct shell/`!`-style commands.
- Voice direction changes can now cancel the current Pi run and immediately delegate a replacement task.
- Added a collaborative ephemeral scratchpad with load/edit/save/dispatch support, including selective dispatch and project-scoped file permissions.
- Reworked voice transcripts into chronological human/Orb turns with tool calls as hard boundaries, preventing long merged transcript paragraphs.
- Added hardware-side adaptive jitter buffering to the Go audio helper: mid-response starvation now pauses, rebuilds a lead, and resumes without skipping or time-compressing PCM.
- Added explicit natural-response end framing so clean response tails are not mistaken for underruns.
- Added interruption-storm detection/resynchronization for recurring barge-in/echo loops and surfaced recovery counters in the UI.
- Recorded direct Pi `!`/`!!` commands and model selections in Orb's internal visible context without duplicating Pi's log in the Orb panel.
- Automated Go module resolution with `go build -mod=mod`; contributors no longer need a separate manual `go get`.
- Increased default orb density slightly and added a dedicated scratchpad layout.
- Updated website layout and application artwork to match the current interface.
- Expanded tests for Pi control permissions, scratchpad filesystem boundaries, chronological transcript turns, audio response boundaries, config, and build provisioning.

## 0.5.3 — Gemini Developer API session resumption fix

- Removed the Enterprise-only `SessionResumptionConfig.transparent` flag from Gemini Developer API Live sessions.
- Session resumption now follows the documented Developer API shape: `{}` for a new resumable session and `{ handle }` when reconnecting.
- Added a regression test that rejects `transparent` in the Gemini Live setup payload and verifies resumption handles are forwarded correctly.

## 0.5.2 — source-extension root discovery

- Fixed a source-loaded Pi extension bug where the runtime calculated Orb's package root one directory too high.
- The bad working directory caused Node to report `spawn <go-path> ENOENT` even when Go itself was installed and executable.
- Audio-helper provisioning now discovers the project root by walking upward for Orb's `package.json` and `audio-helper/go.mod`, so source, compiled, npm, and Git layouts resolve identically.
- Added regression coverage for both `src/audio/...` and `dist/src/audio/...` runtime layouts.
- Expanded macOS/Linux Go discovery through the user's login shell for version-manager installations.

## 0.5.1 — audio helper provisioning

- Fixed `spawn go ENOENT` when Pi was launched without the shell PATH that contains Homebrew/system Go.
- Runtime now tries bundled binaries, the platform cache, the matching GitHub release asset, and the latest release before source compilation.
- Source compilation locates Go in common macOS/Linux/Windows install paths instead of assuming `go` is on Pi's PATH.
- Normal published installs no longer attempt to compile Go during `postinstall`; Go is only a source-checkout fallback.
- `make build` is now a complete local build and provisions the native audio helper, so missing native prerequisites fail at build time instead of first `/voice`.
- Release packaging verifies required Linux/macOS/Windows audio binaries before publishing.

## 0.5.0 — autonomous coding partner

- Reframed the voice model as a concise, high-level coding partner that autonomously drives Pi rather than narrating routine steps.
- Removed all native Pi editor mirroring, revision tracking, verification, and voice-side prompt submission flows.
- Added direct `run_pi_task` delegation; human-typed Pi commands remain completely independent.
- Removed Pi's own message/tool stream from the Orb panel. The panel now shows only the human transcript, Orb transcript, Orb tool activity, system notices, and errors.
- Reduced the default voice panel height and increased the particle-wave field density.
- Added layered JSON configuration and complete voice-prompt override support.
- Added Gemini Live context compression, session resumption, prompt `GoAway` socket closure/reconnect, and friendly fallback closure.
- Added the `orb` convenience launcher plus POSIX and Windows installers.
- Reworked project identity and distribution metadata for `https://github.com/alainux/orb` and public package publication.
- Reworked the website and documentation for a calmer conversational-coding presentation.

## 0.4.0

- Moved realtime audio device timing to the Go/miniaudio sidecar.
- Added the left-orb/right-activity Pi extension layout.
