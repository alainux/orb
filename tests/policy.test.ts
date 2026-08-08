import assert from "node:assert/strict";
import test from "node:test";
import { BASE_ORB_PROMPT } from "../src/base-prompt.js";
import { composeSystemPrompt, DEFAULT_VOICE_SYSTEM_PROMPT } from "../src/policy.js";

test("the persona/style invariants are in the non-overridable base (survive user overrides)", () => {
  // Even when a user overrides the layer (or default.md goes missing), the
  // friendly + concise persona must still load because it lives in the base.
  assert.match(BASE_ORB_PROMPT, /warm, friendly/);
  assert.match(BASE_ORB_PROMPT, /be concise|Do not narrate mechanics/);
  assert.match(BASE_ORB_PROMPT, /Do not narrate|narrate mechanics/);
  assert.match(BASE_ORB_PROMPT, /Do not repeatedly ask|permission/);
  assert.match(BASE_ORB_PROMPT, /Silence is fine/);
  // And a bare user override still carries that persona via the base.
  const overridden = composeSystemPrompt("Be terse.");
  assert.match(overridden, /warm, friendly/);
  assert.match(overridden, /Silence is fine/);
  assert.match(overridden, /narrate mechanics/);
});

test("voice policy is a warm native coder that delegates big work and stays precise", () => {
  // Role: interpreter + working agent, not just a control layer.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /good-humored voice companion/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /owns the whole interface/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /same seven filesystem\/code tools/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /NATIVE CODING TOOLS/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /DO IT YOURSELF vs DELEGATE/);
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
