# Orb architecture

Orb is a Pi extension with a deliberately narrow boundary:

```text
human voice
   ↕
realtime provider (Gemini Live / OpenAI Realtime)
   ↕
Orb orchestration
   ├─ run_pi_task → Pi coding agent
   ├─ observe_pi  ← Pi lifecycle/session events
   └─ read_pi_log ← visible Pi session state
   ↕
Go audio sidecar → operating-system audio device
```

## Design rules

1. **Pi owns coding.** Orb never exposes shell, file-write, or arbitrary execution tools to the realtime voice model. It delegates complete tasks to Pi.
2. **The Pi editor belongs to the human.** Orb does not mirror, watch, replace, or submit the native prompt editor. Manual Pi interaction remains independent.
3. **Voice stays high-level.** The user can already see Pi's full TUI, so Orb focuses on intent, outcomes, blockers, and useful next moves.
4. **Audio timing stays out of Node.** A small Go/miniaudio helper owns capture and playback at the hardware callback clock. TypeScript only transports PCM and provider events.
5. **Visible state only.** `read_pi_log` and `observe_pi` consume visible Pi messages/tool results. Hidden model reasoning is not mirrored into Orb.
6. **Provider lifecycle is isolated.** Gemini and OpenAI adapters live behind `VoiceProvider`; a new realtime provider should not require changes to the Pi or audio layers.

## Source map

- `extensions/voice.ts` — Pi package entry point, `/voice`, shortcut, lifecycle events.
- `src/controller.ts` — session lifecycle and tool orchestration.
- `src/providers/` — realtime provider adapters.
- `src/pi-log.ts` — visible Pi state mirror used internally by the voice model.
- `src/audio/` — Node ↔ Go audio protocol/bridge.
- `audio-helper/` — hardware-timed Go audio process.
- `src/orb.ts` — deterministic particle-wave field.
- `src/widget.ts` — themed Pi TUI component.
- `src/config.ts` — layered JSON/env configuration.

## Extending Orb

### Add a realtime provider

Implement `VoiceProvider` in `src/providers/`, register it in `src/providers/index.ts`, and keep all provider-specific wire events inside that adapter.

### Add a voice-side capability

Prefer a narrow tool that delegates to Pi or reads observable Pi state. Do not add arbitrary process execution to the realtime voice model.

### Change the voice behavior

Use a prompt file instead of forking code. Set `voice.promptFile` in `.orb/config.json` or `ORB_PROMPT_FILE`.
