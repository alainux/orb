import assert from "node:assert/strict";
import test from "node:test";
import { composeSystemPrompt, DEFAULT_VOICE_SYSTEM_PROMPT } from "../src/policy.js";

test("the style/invariant persona lives in the authoritative default prompt", () => {
  // The single default (prompts/default.md) carries the identity + invariants.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /be concise|Do not narrate mechanics/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Do not narrate|narrate mechanics/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Do not repeatedly ask|permission/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Silence is fine/);
});

test("the default prompt imposes a one-line, no-recap greeting (no long run-on openers)", () => {
  // Greeting is constrained to a single short warm line; the previous verbose
  // formula that let the model stack status + a trailing question is gone.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /one short, warm line|exactly one opening/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Hey, what's up/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /Greet naturally and casually/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /recap who you are or list what you can/);
});

test("an override replaces the default wholesale (two-layer model)", () => {
  // An override is the whole system prompt; the default is not appended.
  const overridden = composeSystemPrompt("Be terse.");
  assert.equal(overridden, "Be terse.");
  assert.doesNotMatch(overridden, /narrate mechanics/);
  assert.doesNotMatch(overridden, /Silence is fine/);
  // With no override, composeSystemPrompt() returns the shipped default.
  assert.equal(composeSystemPrompt(), DEFAULT_VOICE_SYSTEM_PROMPT);
});

test("voice policy is a warm native coder that delegates big work and stays precise", () => {
  // Role: interpreter + working agent, not just a control layer.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /good-humored voice companion/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /owns the whole interface/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /same seven filesystem\/code tools/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /NATIVE CODING TOOLS/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /DISPATCH THE AGENT BY DEFAULT/);
  // Delegation by tool name, but the agent is never called "Pi".
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /run_pi_task\(instruction, summary\?\)/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Never call the delegation target "Pi"/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /the current agent/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /model name/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /control_pi\(action="cancel"\)/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /change the current agent's model, thinking level, active tools/);
  // Expand, don't compress; ask clarifying questions.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /EXPAND, DON'T COMPRESS/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /CLARIFY BEFORE YOU GUESS/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /STRENGTHEN, DON'T SHRINK/);
  // Recommend among options instead of listing them flatly.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /pros and cons/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /clear recommendation/);
  // Voice style + scratchpad + human authority.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /SCRATCHPAD/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Silence is fine/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Do not narrate mechanics/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /direct actions are authoritative/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /shall I go ahead/i);
});
