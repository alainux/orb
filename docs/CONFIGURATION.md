# Configuration

Orb merges configuration in this order, with later values winning:

1. user config: `~/.config/orb/config.json` (`%APPDATA%\\orb\\config.json` on Windows)
2. project config: `<project>/.orb/config.json`
3. explicit config: `ORB_CONFIG=/path/to/config.json`
4. environment variable overrides
5. `/voice start gemini|openai` provider override

API keys intentionally stay in environment variables.

## Example

```json
{
  "provider": "gemini",
  "gemini": {
    "model": "gemini-3.1-flash-live-preview",
    "voice": "Aoede"
  },
  "openai": {
    "model": "gpt-realtime-2.1",
    "voice": "marin"
  },
  "voice": {
    "temperature": 0.72,
    "greeting": true,
    "promptFile": ".orb/voice-prompt.md"
  },
  "ui": {
    "panelHeight": 14,
    "activityLines": 10,
    "orbAspect": 2.0,
    "orbDensity": 1.10
  },
  "session": {
    "geminiSessionResumption": true,
    "geminiContextCompression": true,
    "geminiCompressionTriggerTokens": 18000,
    "geminiCompressionTargetTokens": 9000
  }
}
```

A copy ships at `config/orb.example.json`.

## Prompt customization

The complete default voice prompt is shipped at `prompts/default.md`.

```json
{
  "voice": {
    "promptFile": ".orb/voice-prompt.md"
  }
}
```

Or:

```bash
export ORB_PROMPT_FILE="$HOME/prompts/my-orb.md"
```

An inline `voice.systemPrompt` is also supported. A prompt file takes precedence over the inline value.

## Environment overrides

- `ORB_PROVIDER=gemini|openai`
- `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`
- `GEMINI_LIVE_MODEL`, `GEMINI_VOICE`
- `OPENAI_REALTIME_MODEL`, `OPENAI_VOICE`
- `ORB_CONFIG`
- `ORB_PROMPT_FILE`, `ORB_SYSTEM_PROMPT`
- `ORB_TEMPERATURE`
- `ORB_PANEL_HEIGHT`, `ORB_ACTIVITY_LINES`
- `ORB_ASPECT`, `ORB_DENSITY`
- `ORB_LOG_DIR`
- `ORB_GEMINI_SESSION_RESUMPTION`
- `ORB_GEMINI_CONTEXT_COMPRESSION`
- `ORB_GEMINI_COMPRESSION_TRIGGER_TOKENS`
- `ORB_GEMINI_COMPRESSION_TARGET_TOKENS`
- `ORB_AUDIO_HELPER`
- `ORB_AUDIO_RELEASE_VERSION`, `ORB_AUDIO_RELEASE_BASE_URL`
- `ORB_GO` (developer/source-build fallback only)

Legacy `PI_VOICE_*` names remain accepted where practical for migration.

## Long-running Gemini sessions

Orb enables Gemini Live context-window compression and session resumption by default. Gemini periodically rotates Live WebSocket connections; Orb keeps the latest resumption handle and reconnects when the server sends `GoAway`. If a session cannot be resumed safely, Orb closes voice mode with an informational message instead of presenting the normal provider rollover as an application error.


## Audio helper provisioning

Normal released installs do not need Go. Orb resolves audio in this order: an explicit `ORB_AUDIO_HELPER`, a bundled platform helper, the per-user cache, the matching GitHub release asset, the latest compatible release asset, then (only as a source-checkout fallback) a local Go build. On macOS the fallback also checks Homebrew/system Go locations and the user's login shell because Pi may start with a smaller `PATH` than the terminal.

For unreleased development builds, `make build` performs both the TypeScript build and native audio-helper build. `ORB_GO=/absolute/path/to/go` can select a specific Go toolchain.
