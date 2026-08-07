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
    "panelHeight": 12,
    "activityLines": 8,
    "orbAspect": 2.0,
    "orbDensity": 1.30
  },
  "audio": {
    "bufferMs": 140,
    "maxBufferMs": 380,
    "recoveryStepMs": 40,
    "interruptionStormCount": 3,
    "interruptionStormWindowMs": 1800,
    "interruptionRecoveryMuteMs": 320
  },
  "permissions": {
    "cancelPi": true,
    "setModel": true,
    "setThinking": true,
    "setTools": true,
    "shell": true,
    "scratchpadRead": true,
    "scratchpadWrite": true,
    "scratchpadOutsideProject": false
  },
  "scratchpad": {
    "panelHeight": 18,
    "maxBytes": 524288
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

The complete default prompt is [`prompts/default.md`](../prompts/default.md).

```json
{
  "voice": {
    "promptFile": ".orb/voice-prompt.md"
  }
}
```

or:

```bash
export ORB_PROMPT_FILE="$HOME/prompts/my-orb.md"
```

An inline `voice.systemPrompt` is also supported; a prompt file takes precedence.

## Permissions

All Pi-management and scratchpad filesystem capabilities can be disabled independently:

- `permissions.cancelPi` — allow `ctx.abort()` of active Pi work.
- `permissions.setModel` — allow listing/switching Pi models.
- `permissions.setThinking` — allow changing Pi's thinking level.
- `permissions.setTools` — allow changing Pi's active tool set.
- `permissions.shell` — allow direct shell commands through `pi.exec()`.
- `permissions.scratchpadRead` — allow loading project files into the scratchpad.
- `permissions.scratchpadWrite` — allow saving the scratchpad.
- `permissions.scratchpadOutsideProject` — allow scratchpad file access outside Pi's current project. Defaults to `false`.

Environment equivalents are `ORB_ALLOW_CANCEL_PI`, `ORB_ALLOW_SET_MODEL`, `ORB_ALLOW_SET_THINKING`, `ORB_ALLOW_SET_TOOLS`, `ORB_ALLOW_SHELL`, `ORB_ALLOW_SCRATCHPAD_READ`, `ORB_ALLOW_SCRATCHPAD_WRITE`, and `ORB_ALLOW_SCRATCHPAD_OUTSIDE_PROJECT`.

## Audio recovery

The Go sidecar starts with `audio.bufferMs` of queued PCM. If the hardware callback outruns incoming provider audio mid-response, playback stops, increases the target by `audio.recoveryStepMs`, waits for that lead to rebuild, then resumes. It never speeds up to catch up and never drops middle audio.

- `audio.bufferMs` / `ORB_AUDIO_BUFFER_MS`
- `audio.maxBufferMs` / `ORB_AUDIO_MAX_BUFFER_MS`
- `audio.recoveryStepMs` / `ORB_AUDIO_RECOVERY_STEP_MS`
- `audio.interruptionStormCount` / `ORB_INTERRUPTION_STORM_COUNT`
- `audio.interruptionStormWindowMs` / `ORB_INTERRUPTION_STORM_WINDOW_MS`
- `audio.interruptionRecoveryMuteMs` / `ORB_INTERRUPTION_RECOVERY_MUTE_MS`

The footer shows the current queued milliseconds and recovery count.

## Scratchpad

- `scratchpad.panelHeight` / `ORB_SCRATCHPAD_PANEL_HEIGHT`
- `scratchpad.maxBytes` / `ORB_SCRATCHPAD_MAX_BYTES`

When open, the right side of the Orb widget shows the scratchpad document plus a small recent-activity strip.

## Other environment overrides

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

Legacy `PI_VOICE_*` names remain accepted where practical for migration.

## Long-running Gemini sessions

Orb enables Gemini Live context-window compression and Developer-API session resumption by default. Gemini periodically rotates Live WebSocket connections; Orb keeps the latest resumption handle and reconnects when the server sends `GoAway`. If a session cannot be resumed safely, Orb closes voice mode with an informational message instead of presenting the rollover as an application crash.
