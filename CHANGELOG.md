# Changelog

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
