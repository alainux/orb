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

## Type-safety & `any` policy

Orb keeps the type system honest. `eslint` (`npm run lint`) enforces this:

- **No `as any` casts anywhere.** Unbound in `src/`, `tests/`, and `extensions/`.
  For untyped input, use `unknown` and narrow with guards; for fakes use
  `as unknown as SomeType` (never bare `as any`). In tests, reach private
  provider/controller internals only through the typed seams in
  `tests/support/seams.ts` (`providerSeam` / `controllerSeam`, `fakePi`), not by
  `(x as any).member`.
- **No explicit `any` annotations** except at true wire/SDK boundaries
  (`src/providers/gemini.ts`, `src/pi-log.ts`), each covered by a
  `/* eslint-disable @typescript-eslint/no-explicit-any */` file directive
  with an adjacent one-line reason. If you add an `any` elsewhere, convert it
  to `unknown` + a guard.

Run before opening a PR:

```bash
npm run check
npm run pack:check
```

See `docs/ARCHITECTURE.md`, `docs/CONFIGURATION.md`, and `SECURITY.md` before changing public interfaces.
