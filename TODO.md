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

Planned files (rough): a `VoiceSessionAdapter` wired into `controller.ts`, a
`createAgentSessionRuntime` + `SessionManager`, and `session.subscribe()` ->
existing `ActivityFeed`. Produce a fuller spec before coding; get approval first.


## De-duplication (pre-existing)

- The five **orchestration** tools (`run_pi_task`, `read_pi_log`, `observe_pi`,
  `control_pi`, `scratchpad`) are defined inline **twice**:
    - `src/providers/openai.ts` (~lines 75–131)
    - `src/providers/gemini.ts` (~line 199+)
  Their descriptions already diverge between providers (e.g. `run_pi_task`
  wording differs). Apply the same single-catalog treatment used for the native
  coding tools in `src/agent-tools.ts` (one catalog feeding both providers'
  registrations) to remove the per-provider copy.