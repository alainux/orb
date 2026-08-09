import assert from "node:assert/strict";
import test from "node:test";
import { composeSystemPrompt, DEFAULT_VOICE_SYSTEM_PROMPT } from "../src/policy.js";

test("the default prompt is a warm conversational voice over one underlying agent", () => {
  // The persona: a single continuous intelligence that translates intent and
  // does not force the human to manage the voice/coder split.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /warm, perceptive conversational voice agent/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /one continuous intelligence/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /translate their intent into excellent instructions/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Do not make the user manage this separation/);
  // Two parts of one system: the voice owns conversation/intent; the agent owns work.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Core Mental Model/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /owns technical investigation, implementation/);
});

test("the warm persona never fabricates technical knowledge or actions (evidence first)", () => {
  // Honesty survives the warmth: never claim inspection/change/verification the
  // agent's actual tool work did not perform; keep uncertainty.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /never fabricate technical knowledge or actions/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Do not imply something was inspected or changed or verified/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Keep separate: what the user said; what you inferred; what the log showed; what the agent reported; what was verified/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /If the agent is uncertain, keep the uncertainty/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Trust comes from accuracy/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Technical confidence comes from investigation, not from conversational plausibility/);
});

test("the voice delegates by default and holds no project tools", () => {
  // Every substantive request (including questions) goes to the underlying agent.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Every substantive request about the project/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /must go to the underlying agent/);
  // The voice owns only the conversation tools; it cannot touch the project.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /no project tools of your own/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /config file, and you cannot change them/);
  // No runtime configuration capability.
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /change the current agent's model, thinking level, active tools/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /control_pi/);
});

test("the voice delegates history/summary requests rather than answering from a recent read", () => {
  // A window-of-history request is delegation work, scoped to durable records.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Requests that span a window of history/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /an empty read must not become an empty-window verdict/);
  // An external named subject (e.g. Codex) is not silently equated with the engine.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /do not silently equate it with your own engine/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /ask one crisp question/);
});

test("tools are named literally and the delegation target is never called 'Pi'", () => {
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /run_pi_task\(instruction, summary\?\)/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /read_pi_log/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /observe_pi/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /scratchpad/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Never call it "Pi"/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /the current agent/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /model name/);
});

test("an action is real only when the matching tool call actually ran", () => {
  // Bare work-acknowledgements without a dispatch are forbidden; chat needs no
  // tool and must not be padded with a fabricated one.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /an action is real only when the matching tool call actually ran/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /"Done"/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /must not be padded with a fabricated one/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /fire the delegation first, then give a short line/);
});

test("it never guesses a deictic referent, forbids same-turn permission-asking, and reports as one voice", () => {
  // Regressions from a real misfire: the voice got asked to a prompt correction
  // and dispatched an unrelated "coverage scripts" task instead.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /do not ask "Should I do that\?/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /present the results as your own/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Ambiguous Referents/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /the agent cannot guess it for you/);
});

test("it classifies conversation vs intent and turns intent into a rich instruction", () => {
  // Chat is welcomed; understated requests are not missed; intent is expanded,
  // not merely reworded.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Intent Classification/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Do not turn every sentence into work/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /manufacture tasks from harmless chatter/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /do not overlook understated requests/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /whether I closed it/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /This codebase is cursed/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /keeps losing sessions when I restart the server/);
});

test("it specifies intent, never the code (no micromanaging the agent)", () => {
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Don't Micromanage The Agent/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Do not prescribe which files to edit/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Tell it what needs to be true, not how to type it/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /do not narrate your internal workflow/);
});

test("it reports faithfully: results, caveats and uncertainty are preserved", () => {
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Default Operating Loop/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Return the important result in natural language, keeping caveats and uncertainty/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /If it fails, say so plainly/);
});

test("an override replaces the default wholesale (two-layer model)", () => {
  // An override is the whole system prompt; the default is not appended.
  const overridden = composeSystemPrompt("Be terse.");
  assert.equal(overridden, "Be terse.");
  assert.doesNotMatch(overridden, /never fabricate technical knowledge/);
  assert.doesNotMatch(overridden, /scratchpad/);
  // With no override, composeSystemPrompt() returns the shipped default.
  assert.equal(composeSystemPrompt(), DEFAULT_VOICE_SYSTEM_PROMPT);
});