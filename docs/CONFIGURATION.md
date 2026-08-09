# Configuration

Orb merges configuration in this order, with later values winning:

1. user config: `~/.config/orb/config.json` (`%APPDATA%\\orb\\config.json` on Windows)
2. project config: `<project>/.orb/config.json`
3. explicit config: `ORB_CONFIG=/path/to/config.json`
4. environment variable overrides
5. `/voice start gemini|openai` provider override

API keys intentionally stay in environment variables.

## Preferences: the config file is the source of truth

Orb has no preferences panel or hidden preference store. The durable options
(provider, model, voice, auto-start, reasoning budget, context compression,
session resumption, braille, audio tuning) are declared in this file and read
once at startup. The one exception: the **voice** is a live, user-facing choice,
so `/voice voice <name>` (or cycling with no name) writes the picked voice back
into the user config under the provider block (`{ provider: { voice } }`, same
file an API key is stored in) so it survives a restart. An explicit
`GEMINI_VOICE`/`OPENAI_VOICE` env var, or a `voice` key declared in a
project/explicit config, still wins on load.

The reasoning *display* is the single config option `ui` → `thinkingDisplay`
(`full` / `minimized` / `hidden`) — Orb honors it. You can still flip that
display inline for the current session with `/voice thinking` or `Ctrl+Alt+T`;
the toggle rewrites the running `thinkingDisplay` value in memory only (never a
file, never a session entry), so a fresh launch starts from this file's setting
again.

`/voice settings` opens a proper Pi `SettingsList` panel (`tui.md` Pattern 3) with three kinds of rows: the **Reveal reasoning** toggle (editable for the current session, in memory only), the durable preferences you most often want to change — **Provider**, **Voice**, **Auto-start voice** — which are editable and persisted to the user config when changed (a live voice switch also speaks a short audition), and the remaining durable config as read-only reference (**model**, **thinking budget**, **context compression**, **session resumption**) so you can see — and copy — what the file currently declares.

## Example

```json
{
  "provider": "gemini",
  "autoStartVoice": true,
  "gemini": {
    "model": "gemini-3.1-flash-live-preview",
    "voice": "Zephyr"
  },
  "openai": {
    "model": "gpt-realtime-2.1",
    "voice": "marin"
  },
  "voice": {
    "temperature": 0.83,
    "promptFile": ".orb/voice-prompt.md"
  },
  "ui": {
    "panelHeight": 12,
    "activityLines": 8,
    "orbAspect": 2.0,
    "orbDensity": 1.30,
    "orbReactivity": 0.7,
    "orbBraille": true
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

The voice prompt is a simple two-layer model: a single authoritative **default** plus an optional **override**.

- **Default** — the shipped [`prompts/default.md`](../prompts/default.md) is the canonical system prompt. It carries the identity and invariants (never expose hidden chain-of-thought, base reports on observable output, the human's direct actions are authoritative, an action isn't real until its tool runs), the conversational norms (neutral and factual, concise; grounded and evidence-based; never falsely positive or cheerleading; never gloss over errors with reassuring status like "running smoothly"; act as a broker/investigator that gathers factual context before reporting; don't narrate visible mechanics; don't pepper the human with permission prompts; silence is fine while work runs; bare acknowledgments like "Got it" are forbidden without a matching action), and all tool/delegation/scratchpad guidance.
- **Optional override** — a prompt file or an inline string. When provided, your override **replaces the entire default prompt** (nothing else is appended). With no override, the shipped `prompts/default.md` is used as-is.

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

An inline `voice.systemPrompt` is also supported; a prompt file takes precedence (both are read via `ORB_SYSTEM_PROMPT` / `ORB_PROMPT_FILE` too). Either way, your override replaces the default prompt wholesale.

### Brevity & no auto-greeting

Orb no longer injects an opening cue when a session starts (the randomized `GREETING_CUES` / `greetingCue` were removed from `src/policy.ts`). Conversations default to a terse, conversational style — one short clause or fragment (a result, then at most a single next question). The default prompt explains the greeting-at-most-once rule, so a running session never says "hello again" unless a new `/voice` conversation starts.

## Permissions

All Pi-management and scratchpad filesystem capabilities can be disabled independently:

- `permissions.scratchpadRead` — allow loading project files into the scratchpad.
- `permissions.scratchpadWrite` — allow saving the scratchpad.
- `permissions.scratchpadOutsideProject` — allow scratchpad file access outside Pi's current project. Defaults to `false`.
- `permissions.cancelPi` — Allow the voice agent to abort an active delegated Pi task when the human says to cancel/stop/drop it (`cancel_pi_task` → `ctx.abort()`). It never changes model/thinking/tools/shell or configuration and is a safe no-op when Pi is already idle. Defaults to `true`.

There are deliberately no runtime configuration permissions: the voice agent cannot change Pi's model, thinking level, toolset, or run shell, and it cannot change its own voice. Those are set by the config file only (`voice.model`/`voice.voice` and Pi's own settings), not available as tools. The human *can* pick a voice at any time with `/voice voice <name>` — which persists the choice to the user config, as described above. Cancellation is the only control surface.

Environment equivalents are `ORB_ALLOW_SCRATCHPAD_READ`, `ORB_ALLOW_SCRATCHPAD_WRITE`, `ORB_ALLOW_SCRATCHPAD_OUTSIDE_PROJECT`, and `ORB_ALLOW_CANCEL_PI`.

## Audio recovery

The Go sidecar starts with `audio.bufferMs` of queued PCM. If the hardware callback outruns incoming provider audio mid-response, playback stops, increases the target by `audio.recoveryStepMs`, waits for that lead to rebuild, then resumes. It never speeds up to catch up and never drops middle audio.

- `audio.bufferMs` / `ORB_AUDIO_BUFFER_MS`
- `audio.maxBufferMs` / `ORB_AUDIO_MAX_BUFFER_MS`
- `audio.recoveryStepMs` / `ORB_AUDIO_RECOVERY_STEP_MS`
- `audio.interruptionStormCount` / `ORB_INTERRUPTION_STORM_COUNT`
- `audio.interruptionStormWindowMs` / `ORB_INTERRUPTION_STORM_WINDOW_MS`
- `audio.interruptionRecoveryMuteMs` / `ORB_INTERRUPTION_RECOVERY_MUTE_MS`
- `audio.choppinessWindowRecoveries` / `ORB_CHOPPINESS_WINDOW_RECOVERIES`
- `audio.choppinessWindowMs` / `ORB_CHOPPINESS_WINDOW_MS`
- `audio.choppinessRecoverSilenceMs` / `ORB_CHOPPINESS_RECOVER_SILENCE_MS`
- `audio.inputResyncDrops` / `ORB_INPUT_RESYNC_DROPS`
- `audio.inputResyncWindowMs` / `ORB_INPUT_RESYNC_WINDOW_MS`
- `audio.inputResyncCooldownMs` / `ORB_INPUT_RESYNC_COOLDOWN_MS`

The footer shows the current queued milliseconds, the recovery count, and (during an episode) a live `CHOPPY` health marker.

## Choppiness auto-detection & recovery

Choppy playback (a silent stutter) is the audible side of the Go buffer repeatedly under-running. Orb detects the *onset* of sustained choppiness from the sidecar's underrun-recovery counter: `windowRecoveries` recoveries within `windowMs` mark choppiness (a single recovery is a normal transient stall). A further under-run that arrives while a rebuild is still pending escalates the adaptive lead faster, so the re-prime finishes in fewer, shorter interruptions; once delivery has been healthy for a sustained streak (or the response ends cleanly), the lead relaxes back toward `bufferMs` so latency never permanently piles up. If the microphone dropped frames during the same episode (`inputResyncDrops` within `inputResyncWindowMs`), Orb auto-resyncs the input path too, throttled by `inputResyncCooldownMs`.

## Scratchpad

- `scratchpad.panelHeight` / `ORB_SCRATCHPAD_PANEL_HEIGHT`
- `scratchpad.maxBytes` / `ORB_SCRATCHPAD_MAX_BYTES`

When open, the right side of the Orb widget shows the scratchpad document plus a small recent-activity strip.

## Auto-start

Orb starts voice automatically when a Pi session begins. Set `autoStartVoice` to `false` to opt out, or `true` to keep it (the default):

```json
{
  "autoStartVoice": false
}
```

The environment variable `ORB_AUTO_START` (e.g. `ORB_AUTO_START=false`) overrides the config key. When auto-started, the voice session begins exactly as a manual `/voice start` would; the provider / API keys from the rest of the config still apply.

## Other environment overrides

- `ORB_PROVIDER=gemini|openai`
- `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `OPENAI_API_KEY`
- `GEMINI_LIVE_MODEL`, `GEMINI_VOICE`
- `OPENAI_REALTIME_MODEL`, `OPENAI_VOICE`
- `ORB_CONFIG`
- `ORB_PROMPT_FILE`, `ORB_SYSTEM_PROMPT`
- `ORB_TEMPERATURE`
- `ORB_PANEL_HEIGHT`, `ORB_ACTIVITY_LINES`
- `ORB_ASPECT`, `ORB_DENSITY`, `ORB_REACTIVITY`, `ORB_BRAILLE`
- `ORB_LOG_DIR`
- `ORB_GEMINI_SESSION_RESUMPTION`
- `ORB_GEMINI_CONTEXT_COMPRESSION`
- `ORB_GEMINI_COMPRESSION_TRIGGER_TOKENS`
- `ORB_GEMINI_COMPRESSION_TARGET_TOKENS`
- `ORB_AUDIO_HELPER`

Legacy `PI_VOICE_*` names remain accepted where practical for migration.

## Run log contents

Each `/voice` session writes a durable log to `ORB_LOG_DIR` (default `~/.cache/orb/logs`). It captures factual, observable execution state — never hidden chain-of-thought:

- `Orb voice starting / stopped` — session lifecycle.
- `conversation` — each committed spoken turn, `{speaker: "you"|"voice", text}`. Only finalized turns are logged once; partial transcripts and replays are suppressed.
- `voice-turn-actions` — for every committed Orb speech turn, `{tools, pi_dispatches}` counts how many native tool calls and `run_pi_task` delegations actually ran since the last turn boundary. A voice turn that *claims* an action ("Removing X", "Dispatched") but logs `tools:0` / `pi_dispatches:0` here is a false confirmation — the model talked without invoking any tool. This makes a "confirmed but nothing was invoked" failure greppable and easy to correlate to the matching `conversation` line.
- `pi-activity` — Pi's observable progress: `{kind system|pi|pi-tool}` (started/finished, final assistant text, `✓/✗ tool`, bash `!` commands, model changes). Reasoning/thinking blocks are never included.
- `voice native tool` — Orb's own `read/write/edit/bash/grep/find/ls` calls, with the target `file`, sanitized `arguments`, `ok`, and a bounded `preview`.
- Tool calls: `voice delegated Pi task`, `voice switched via tool`, `voice tool read_pi_log / observe_pi / scratchpad`, `microphone mute changed`, `voice switched`, audio/`interruption` recovery.
- `ERROR` lines for failures with `stack`; `Orb voice stopped` on exit.

Hidden reasoning is never written: the Pi mirror only forwards visibly-emitting text/tool events, and the conversation feed only emits finalized speaking turns.

## Long-running Gemini sessions

Orb enables Gemini Live context-window compression and Developer-API session resumption by default. Gemini periodically rotates Live WebSocket connections; Orb keeps the latest resumption handle and reconnects when the server sends `GoAway`. If a session cannot be resumed safely, Orb closes voice mode with an informational message instead of presenting the rollover as an application crash.
