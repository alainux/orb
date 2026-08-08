# Orb architecture

Orb is a Pi extension with four deliberately separate runtime layers:

```text
human voice
   ↕
realtime provider (Gemini Live / OpenAI Realtime)
   ↕
Orb orchestration
   ├─ run_pi_task  → Pi coding agent
   ├─ control_pi   → cancel only (no config)
   ├─ observe_pi   ← Pi lifecycle/session events
   ├─ read_pi_log  ← visible Pi session state
   └─ scratchpad   ↔ ephemeral collaborative document
   ↕
Go audio sidecar → adaptive playout buffer → operating-system audio callback
```

## Design rules

1. **Pi owns coding work.** Normal repository exploration, editing, debugging and verification are delegated to Pi as complete tasks.
2. **Orb can only orchestrate Pi.** A deliberately narrow control layer can abort an active run. It cannot change Pi's model, thinking level, tools, or run shell — the voice agent is configured solely by the config file, never at runtime. `!`-style shell control stays with the user typing in Pi, not the voice. These controls use Pi's extension APIs rather than screen scraping.
3. **The Pi editor belongs to the human.** Orb does not mirror, replace, verify, or submit the native editor contents. Human keyboard interaction remains independent and authoritative.
4. **Scratchpad is separate from Pi's editor.** Long-form material can be loaded, refined, saved, or selectively dispatched without competing with the normal Pi prompt.
5. **Audio timing stays out of Node.** Go/miniaudio owns capture and playback at the hardware callback clock. Its adaptive jitter buffer can stop on starvation, rebuild a lead, and resume without skipping or accelerating PCM.
6. **Visible Pi state only.** `read_pi_log` and `observe_pi` use visible Pi messages/tool results. Hidden model reasoning is never exposed.
7. **Orb UI avoids duplication.** The right pane shows the human/Orb script and Orb-side actions; Pi's own tool/output log remains on Pi's normal screen.
8. **Provider lifecycle is isolated.** Gemini and OpenAI live behind `VoiceProvider`; provider wire protocols do not leak into Pi or audio layers.

## Source map

- `extensions/voice.ts` — Pi entry point, `/voice`, shortcut, Pi lifecycle/user-bash events.
- `src/controller.ts` — session lifecycle and orchestration.
- `src/orchestration-tools.ts` — the voice agent's _entire_ tool catalog: zero filesystem/coding tools (no `read`/`bash`/`write`/`edit`/`grep`/`find`/`ls`), only delegation to the background agent (`run_pi_task`, `read_pi_log`, `observe_pi`), orchestration-cancel (`control_pi` → `cancel` — no config), and the scratchpad. Deliberately no runtime configuration tools: no `set_voice`, no `control_pi` model/thinking/tools/shell switches. Holds one canonical JSON-schema entry per tool and renders it per provider (OpenAI Realtime JSON-schema, Gemini Live via `convertToGemini`), so the descriptions/schemas can never drift between the two. The scratchpad is the companion's only project-adjacent surface.
- `src/pi-control.ts` — orchestration-only Pi cancel (`control_pi` → `cancel`), permission-gated.
- `src/pi-log.ts` — visible Pi state mirror used by the voice model.
- `src/scratchpad.ts` — ephemeral long-form working document.
- `src/scratchpad-view.ts` — focusable, scrollable Markdown viewer for the scratchpad (`/voice scratchpad view`). It renders the document inside a Pi `ScrollView` (scrollbar in the last column) and inherits the active theme's Markdown tokens (`mdHeading`, `mdCode`, …), following the live tail by default and pinning when you scroll up. PI's overlay compositor renders plain lines at a fixed box, so it windows the `ScrollView`'s content itself and answers to the standard scroll keys (`↑/↓`, `PgUp/PgDn`, Ctrl+U/D, Home/End), `r` to re-read, `Esc`/`q` to close.
- `src/providers/` — realtime provider adapters.
- `src/audio/` — TypeScript ↔ Go framing/bridge.
- `audio-helper/` — hardware-timed capture/playback and adaptive playout buffer.
- `src/orb.ts` — deterministic themed orb with one visual language ported from the new site labs (`site/orb-3d.html`'s fluid listening field, `site/presence.html`'s soul signature). It is a positive-space sphere of dots lit by a real two-light model (a slowly drifting key light so the diffuse terminator and a Phong highlight travel without rotating the point cloud, a fixed fill, fresnel rim, and an object-space material grain), whose interior coordinates are warped by a domain-warped noise field. A signed domain-warped fBm field gives each cell an `identity` — which of two energy anchors it sits on — and `src/widget.ts` maps that to the theme's primary accent ↔ secondary accent with a mode-dependent boundary feather (crisp while talking, broader when idle). The edge breathes and drifts via a seamless circular fBm (no rigid rotation); sharp audio onsets birth center-to-edge pressure pulses whose shell/core terms brighten the body and whose edge term blooms a sparse particle halo just beyond the rim; the thinking state runs a broad longitude sweep over the surface. With `ui.orbBraille` each 2×4 subpixel cell packs its dots through an 8×8 Bayer ordered-dither threshold into 8-bit U+2800 glyphs. The three states share the same lit sphere and differ only in motion parameters and color: `smoke` (idle) the calm flowing presence, `composing` (talking) the audio-driven two-tone sphere with a white pressure bloom, `searching` (working) the calm look with the cognition sweep — muted renders it gray. The noise clock never stops, so the sphere keeps flowing even while muted. Mode switches dissolve over ~0.55s. Audio reactivity scales with `ui.orbReactivity`, and every color comes from Pi's active theme via `src/theme.ts`.
- `src/widget.ts` — Pi-themed Orb/scratchpad UI.
- `src/config.ts` — layered JSON/env configuration.

## Extending Orb

### Add a realtime provider

Implement `VoiceProvider` in `src/providers/` and register it in `src/providers/index.ts`. Keep provider-specific events inside that adapter.

### Add Pi control

Add capabilities in a provider-agnostic place. Prefer Pi's typed extension API over emulating slash commands or scraping terminal output. To add an orchestration action, add a dedicated permission to `OrbPermissions`, implement the action in `PiControl`, expose only the minimum tool schema, and add both allowed/denied tests. Configuration stays in the config file, never a tool.

### Add a scratchpad operation

Keep the scratchpad deterministic and filesystem access explicit. Project-bound paths are the default; outside-project access requires its own permission.

### Change voice behavior

Use a prompt file instead of forking code. Configure `voice.promptFile` in `.orb/config.json` or set `ORB_PROMPT_FILE`.
