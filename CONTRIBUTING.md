# Contributing to Orb

Thanks for helping make voice-driven coding calmer and more useful.

## Development setup

Requirements: Node.js 22.19+, Go, a C compiler, and Pi.

```bash
git clone https://github.com/alainux/orb.git
cd orb
npm install --ignore-scripts
npm run check
npm run build:audio
pi -e ./extensions/voice.ts
```

Use provider credentials only in your local environment. Never commit API keys or run logs containing private project content.

## Pull requests

- Keep provider wire protocols isolated under `src/providers/`.
- Keep audio device timing inside the Go helper.
- Do not give the realtime voice model arbitrary shell/file execution; delegate coding work through Pi.
- Add deterministic tests for behavior changes.
- Keep spoken-agent defaults concise. New verbosity should be opt-in/configurable.
- Update `CHANGELOG.md` for user-visible changes.

Run before opening a PR:

```bash
npm run check
npm run pack:check
```

See `docs/ARCHITECTURE.md` and `docs/CONFIGURATION.md` before changing public interfaces.
