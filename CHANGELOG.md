# Changelog

## 0.6.2 — interactive voice settings, persisted voices, CSI-u space fix

- **Fix: Space now cycles/applies in `/voice settings` on every terminal.** Pi asks terminals for the Kitty keyboard protocol at startup (flags 1|2|4), and on kitty-capable terminals (kitty, wezterm, Ghostty, foot, iTerm2 with key reporting, Konsole, …) a Space press arrives as a CSI-u sequence like `\x1b[32;1:1u` instead of the literal space byte — while Enter arrives as `\x1b[13;1:1u` and still worked. `SettingsList` only activates on the literal `" "` character, so Space silently did nothing on those terminals. The panel now normalizes the no-modifier CSI-u encodings of Space back to `" "` (`normalizePanelKey` in `src/settings.ts`) before handing input to the list, so Space and Enter both cycle/apply reliably. Modified keys (Ctrl/Alt+Space) and everything else pass through untouched. Covered by `tests/settings.test.ts`.

- **Fix: `/voice settings` is now an interactive, functional settings panel.** The panel previously opened with a silent search box that swallowed every printable keystroke and 7 of 8 rows read-only — pressing Enter/Space on Provider, Model, Voice, or Auto-start did nothing, so it read as "displayed but not interactive." The search mode is gone (with only 8 rows, every key now visibly moves the cursor, cycles a value, or closes the panel), and the rows users most often want to change are editable and persisted: **Voice** cycles the provider's real voices (switches live and auditions when a session is running, otherwise records the preference for the next session), **Provider** picks gemini/openai for the next session, and **Auto-start voice** toggles `autoStartVoice`. The voice row's cycle list tracks the selected provider. Provider/auto-start persist via a new top-level `persistTopLevel` in `src/config.ts`. Model, thinking budget, context compression, and session resumption stay as clearly-labeled read-only reference (edit those in the config file). Covered by `tests/settings.test.ts`.

- **Fix: the chosen voice now persists across sessions.** Previously `/voice voice Zephyr` (or cycling) switched the live session but only updated an in-memory value, so the next launch reverted to the configured/default voice. The selection is now written back to the user config under the provider block (`{ provider: { voice } }` — the same file an API key is stored in) via a new `persistVoice` in `src/config.ts`, and `setVoice` calls it after a successful switch. On load, `GEMINI_VOICE`/`OPENAI_VOICE` or an explicitly declared `voice` key still wins. Covered by `tests/voice.test.ts`, including a round-trip restore and a key-preservation check.

- **Restored permission-gated cancellation** as the single control surface. The prior removal of Pi control (`control_pi` / `PiControl`) had left the voice layer with no way to halt a running delegated task, so "cancel / stop / drop that" was silently ignored and the task ran to completion. A minimal `cancel_pi_task` tool (no config/self/shell/`set_*` knobs) is wired to `ctx.abort()`, gated by the new `permissions.cancelPi` (default `true`, `ORB_ALLOW_CANCEL_PI`). It aborts the active delegated Pi run, is a safe no-op when Pi is already idle, and never reconfigures or runs a shell. Cancellation is covered by `tests/pi-control.test.ts`, including a long-running-command interruption demonstration.

- **Preferences are config-driven with a panel for the ones you change most.** The config file remains the single source of truth: the reasoning *display* honors `ui.thinkingDisplay` (`full` / `minimized` / `hidden`) and is only ever flipped in memory for the current session (`/voice thinking` or `Ctrl+Alt+T`), and the deeper durable options (model, thinking budget, context compression, session resumption, braille, audio) are read at startup and never rewritten. Provider, voice, and auto-start are the exception: they are editable from `/voice settings` and persisted back to the user config, so the panel no longer reads as a dead end.

- Removed every bare `as any` cast from `src/` and the test suite; typed test seams now live in `tests/support/seams.ts`. Added an ESLint gate (no-explicit-any, no-unused-vars) wired into `npm run check` and the `lint` script, and documented the type-safety standard in `CONTRIBUTING.md`. The only remaining `any` is at genuine wire/SDK boundaries (`gemini.ts`, `pi-log.ts`) with a documented per-file exception.

- The website (`site/`) GitHub links now open in a new tab with `rel=noopener`.

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
