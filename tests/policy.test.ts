import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VOICE_SYSTEM_PROMPT, greetingCue } from "../src/policy.js";

test("voice policy drives Pi autonomously and avoids narration",()=>{
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/live conversational control layer inside the Pi coding harness/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/Drive the work autonomously/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/run_pi_task is your primary action/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/Can you explore the project/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/Do not narrate basic mechanics/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/Do not edit, mirror, verify, or monitor the native Pi prompt editor/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/observe_pi/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT,/shall I go ahead/i);
});
test("greeting cue varies deterministically",()=>assert.notEqual(greetingCue(()=>0),greetingCue(()=>0.99)));
