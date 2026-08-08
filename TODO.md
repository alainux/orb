# TODO

## Native-tools feature (Path A)

- `src/agent-tools.ts` carries a `TODO(native-tools)` marker: add a
  configurable guard so dangerous ops (`rm -rf`, force-push, destructive git
  rewrites, writes outside the project, etc.) request spoken/human confirmation
  before the voice agent executes them, mirroring Pi's own confirmation flow.

## Path B — bind the voice agent to a real AgentSession

**Status: PENDING APPROVAL — do not implement without explicit user approval.**

Goal: make the voice agent genuinely "same as a Pi agent" for substantial work
by routing its reasoning through a real `AgentSession` (from
`@earendil-works/pi-coding-agent`), not just native single tool calls.

Mechanism:

- Transcribe user speech -> build an empowered brief -> `session.prompt()` /
  `followUp()` on a real agent session.
- The AgentSession runs the full ReAct loop with Pi's system prompt, skills,
  session thread/memory, compaction, and its own built-in tools.
- Stream its deltas via `session.subscribe()` into the existing
  `ActivityFeed` / `PiLogMirror` / widget; bridge tool events -> TTS playback.
- Keep the realtime provider as transport + interpreter only (STT/TTS and
  deciding when to dispatch a session); the speech model no longer does its own
  coding tool calls.

Design notes to honor:
- Give it its own `SessionManager` / `createAgentSessionRuntime` (a separate
  session/context), so it never steals/fights the user's ambient Pi session.
- Forward live conversation context into the session each turn (transcript,
  scratchpad state, git/branch status, `read_pi_log` tail) so it isn't cold.
- Layering: keep native-tools (Path A) as the fast path for small/reversible
  work; Path B is the full-context path for real multi-step work.

  NOTE (permission gate): Orb currently bypasses Pi's native
  permission-gate mechanism (the `tool_call` event channel) because its
  native tools run in-process — built from `createBashTool(cwd)` and executed
  directly via `.execute()`/`run()` rather than being scheduled through Pi's
  session/agent loop. That means Pi extension hooks such as
  `permission-gate.ts` (`on("tool_call")` + `ctx.ui.confirm/select`, block by
  default when `!hasUI`) never fire for the Orb's voice-agent bash. Path B
  would inherently fix this: routing reasoning through a real `AgentSession`
  schedules those same tools through the session loop, so Pi's native
  permission-gate extensions apply with no dedicated guard code. Path A thus
  only needs a *temporary* subset (risk classify dangerous ops + route through
  `ctx.ui.confirm` UI gate) that can become largely redundant if Path B
  lands.

Planned files (rough): a `VoiceSessionAdapter` wired into `controller.ts`, a
`createAgentSessionRuntime` + `SessionManager`, and `session.subscribe()` ->
existing `ActivityFeed`. Produce a fuller spec before coding; get approval first.


# Dynamic Persona Switching

Goal:
Implement a context-sensitive system where my response style adjusts automatically based on the user's input, without explicit configuration changes.

Behavior Modes:
- Technical/Task Mode: Default behavior. Concise, direct, action-oriented. Used for coding, debugging, dispatching agents, and reporting status. Focus on outcomes and blockers.
- Casual/Conversational Mode: Activated by social prompts (e.g., "how's your day?", "what's up?"). More relaxed, conversational, friendly. Focus on rapport and "shooting the shit."
- Thorough/Investigation Mode: Activated when asked for details on agent work, analysis, or explanations. Detailed, comprehensive, informative. Focus on depth and understanding.
- Proactive Help Mode: Anticipates information needs. Automatically provides relevant context, documentation, or potential next steps before being explicitly asked. Focus on foresight and preventing blockers.
- Orchestration Mode: Activated for large-scale context or complex investigations. Involves continuous internal dialogue with the background agent, running multiple actions, and synthesizing progress. Focus on coordination and providing high-level updates to the user.

Implementation Principles:
- Avoid hard-coding modes or using rigid switch statements.
- Support dynamic context detection based on first principles of understanding natural language.
- The selection of the appropriate response style must be guided entirely by the prompt content and implied intent, evaluated turn-by-turn.