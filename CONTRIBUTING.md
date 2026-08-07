# Contributing to Orb

Thanks for helping make voice-driven coding calmer, faster, and more useful.

## Development setup

Requirements: Node.js 22.19+, Go, a C compiler, and Pi. The audio build resolves the Go modules declared by `audio-helper/go.mod`; contributors should not need to run a separate `go get`.

```bash
git clone https://github.com/alainux/orb.git
cd orb
npm install --ignore-scripts
npm run check
npm run build:audio
pi -e ./extensions/voice.ts
```

Use provider credentials only in your local environment. Never commit API keys or run logs containing private project content.

## Architecture boundaries

- Keep realtime-provider wire protocols under `src/providers/`.
- Keep hardware-clocked audio capture/playback inside the Go helper. Node should transport PCM, not pace the speaker.
- Route Pi operations through `src/pi-control.ts` so every privileged capability remains independently permission-gated.
- Route scratchpad filesystem access through `src/scratchpad.ts`; project-boundary checks and atomic writes belong there.
- Keep Pi observation separate from Orb's compact UI log. The human already has Pi's native screen.
- Preserve normal keyboard/Pi command use while Orb is active.

## Adding a privileged voice capability

If a new feature can cancel work, execute a command, change Pi state, or access files:

1. Add an explicit permission in `OrbPermissions`.
2. Choose a conservative project-scoped/default behavior where possible.
3. Enforce the permission in the implementation, not only in the prompt.
4. Document the config/environment switch.
5. Add tests for both the allowed and denied paths.

## Pull requests

- Add deterministic tests for behavior changes and regressions.
- Keep spoken-agent defaults concise; verbosity should be opt-in/configurable.
- Avoid duplicating visible Pi output in Orb's panel.
- Update `CHANGELOG.md` for user-visible changes.
- Update website screenshots when the actual interface changes.

Run before opening a PR:

```bash
npm run check
npm run pack:check
```

See `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, and `SECURITY.md` before changing public interfaces.
