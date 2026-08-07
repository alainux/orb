import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_VOICE_SYSTEM_PROMPT, greetingCue } from "../src/policy.js";

test("voice policy drives Pi autonomously, can redirect it, and avoids narration",()=>{
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/live conversational control layer inside the Pi coding harness/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/DRIVE PI AUTONOMOUSLY/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/run_pi_task is the normal way/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/Broad requests should become broad, autonomous tasks/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/control_pi\(action="cancel"\)/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/change Pi's model, thinking level, or active tools/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/control_pi shell/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/SCRATCHPAD/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/If Pi is working, silence is fine/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/Do not narrate mechanics/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT,/human can type and run Pi commands at any time/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT,/shall I go ahead/i);
});
test("greeting cue varies deterministically",()=>assert.notEqual(greetingCue(()=>0),greetingCue(()=>0.99)));
