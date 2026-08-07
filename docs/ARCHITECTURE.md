# Orb architecture

Orb is a Pi extension with four deliberately separate runtime layers:

```text
human voice
   ↕
realtime provider (Gemini Live / OpenAI Realtime)
   ↕
Orb orchestration
   ├─ run_pi_task  → Pi coding agent
   ├─ control_pi   → cancel / model / thinking / shell
   ├─ observe_pi   ← Pi lifecycle/session events
   ├─ read_pi_log  ← visible Pi session state
   └─ scratchpad   ↔ ephemeral collaborative document
   ↕
Go audio sidecar → adaptive playout buffer → operating-system audio callback
```

## Design rules

1. **Pi owns coding work.** Normal repository exploration, editing, debugging and verification are delegated to Pi as complete tasks.
2. **Orb can manage Pi.** A narrow permission-gated control layer can abort an active run, switch model/thinking, and execute direct shell commands when the user wants `!`-style control. These controls use Pi's extension APIs rather than screen scraping.
3. **The Pi editor belongs to the human.** Orb does not mirror, replace, verify, or submit the native editor contents. Human keyboard interaction remains independent and authoritative.
4. **Scratchpad is separate from Pi's editor.** Long-form material can be loaded, refined, saved, or selectively dispatched without competing with the normal Pi prompt.
5. **Audio timing stays out of Node.** Go/miniaudio owns capture and playback at the hardware callback clock. Its adaptive jitter buffer can stop on starvation, rebuild a lead, and resume without skipping or accelerating PCM.
6. **Visible Pi state only.** `read_pi_log` and `observe_pi` use visible Pi messages/tool results. Hidden model reasoning is never exposed.
7. **Orb UI avoids duplication.** The right pane shows the human/Orb script and Orb-side actions; Pi's own tool/output log remains on Pi's normal screen.
8. **Provider lifecycle is isolated.** Gemini and OpenAI live behind `VoiceProvider`; provider wire protocols do not leak into Pi or audio layers.

## Source map

- `extensions/voice.ts` — Pi entry point, `/voice`, shortcut, Pi lifecycle/user-bash events.
- `src/controller.ts` — session lifecycle and orchestration.
- `src/pi-control.ts` — permission-gated Pi controls.
- `src/pi-log.ts` — visible Pi state mirror used by the voice model.
- `src/scratchpad.ts` — ephemeral long-form working document.
- `src/providers/` — realtime provider adapters.
- `src/audio/` — TypeScript ↔ Go framing/bridge.
- `audio-helper/` — hardware-timed capture/playback and adaptive playout buffer.
- `src/orb.ts` — deterministic themed orb with one visual language: a full sphere of dots rendered with the lab's negative-space technique (`site/orb-braille-source-math-variations.html`), with each state carving coherent traveling features out of that sphere — `smoke` (listening) carves latitude wave-grooves that spiral over the surface, `composing` (talking) carves a voice ribbon (a great-circle sash that opens wider with audio), and `searching` (working) carves ring waves that slide pole to pole. The sphere is deliberately never rotated as a rigid body (rotating point clouds alias into shimmer at terminal resolution) — features travel by the animation clock phase instead. Every mode stays alive when not muted (a silent room still renders a living sphere — only muting goes dormant as a plain un-carved frozen sphere), and mode switches dissolve between renderings over ~0.55s instead of popping. Audio reactivity scales with `ui.orbReactivity`. With `ui.orbBraille` enabled, every mode is rasterized into a 2×4 subpixel grid and packed into 8-dot Braille glyphs (U+2800+mask) for a much denser, finer-grained orb — the same theme/audio color pipeline applies per cell.
- `src/widget.ts` — Pi-themed Orb/scratchpad UI.
- `src/config.ts` — layered JSON/env configuration.

## Extending Orb

### Add a realtime provider

Implement `VoiceProvider` in `src/providers/` and register it in `src/providers/index.ts`. Keep provider-specific events inside that adapter.

### Add Pi control

Prefer Pi's typed extension API over emulating slash commands or scraping terminal output. Add a dedicated permission to `OrbPermissions`, implement the action in `PiControl`, expose only the minimum tool schema, and add both allowed/denied tests.

### Add a scratchpad operation

Keep the scratchpad deterministic and filesystem access explicit. Project-bound paths are the default; outside-project access requires its own permission.

### Change voice behavior

Use a prompt file instead of forking code. Configure `voice.promptFile` in `.orb/config.json` or set `ORB_PROMPT_FILE`.
