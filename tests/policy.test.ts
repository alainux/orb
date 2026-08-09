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

test("the default pose imposes a one-line, context-aware, varied greeting", () => {
  // Greeting is constrained to a single short warm line; the previous verbose
  // formula that let the model stack status + a trailing question is gone.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /one short, warm line|exactly one opening/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /do not copy an exact template verbatim/);
  // Opener varies by time of day and project status rather than one rote line.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Time of day guides tone/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Project status sets the hook/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Clean tree|uncommitted work/);
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

test("voice policy is a pure interpreter/director that delegates and stays precise", () => {
  // Voice policy is a neutral, evidence-based investigator/broker who delegates.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /neutral, factual voice assistant/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /owns the whole interface/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /good-humored voice companion/);
  // The companion holds NO project tools anymore; it only talks to the human,
  // translates requirements, and directs the agent.
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /seven filesystem\/code tools/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /NATIVE CODING TOOLS/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /DISPATCH THE AGENT BY DEFAULT/);
  // Delegation by tool name, but the agent is never called "Pi".
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /run_pi_task\(instruction, summary\?\)/);
  // Investigation is grounded in the visible Pi log via read_pi_log.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /read_pi_log/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Never call the delegation target "Pi"/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /the current agent/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /model name/);
  // No control tool (control_pi is gone) and no configuration capability at runtime:
  // no model/thinking/tools/shell switches, no set_voice.
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /control_pi/);
  // No configuration capability at runtime: no model/thinking/tools/shell switches,
  // no set_voice. The companion is configured solely by the config file.
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /change the current agent's model, thinking level, active tools/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /set_voice\(/);
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

test("the persona adapts per turn by intent, not by switching fixed modes", () => {
  // The five natural registers are phrased as what the intent *is asking for*,
  // re-derived each turn from natural language, never as modes a dispatcher toggles.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /SENSE, DON'T SWITCH/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /points on one continuous dial/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /derive from each utterance|derive it each turn/i);
  // All five registers described, from the resting task default up to orchestration.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Task register \(default\)/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Human register/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Investigation register/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Anticipatory register/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Orchestration register/);
  // It must never dress the style up as a fixed off/on selector or announce it.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Never announce the register/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /Conversational Mode|Explanation Mode/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /switch \(|case "mode"/i);
});

test("the default prompt is grounded, neutral, and evidence-based, never falsely positive", () => {
  // Core issue: never be confidently wrong / hallucinate; state only evidence-backed claims.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Never be confidently wrong and never hallucinate/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /A claim without supporting evidence is a false claim/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Never make a decision or a working assumption without evidence/);
  // Neutral/factual tone: explicit ban on cheerleading and customer-service reassurance,
  // and on glossing over real errors with "running smoothly" / "all good".
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /never a friendly customer-service persona/i);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /do not perform warmth, positivity, or reassurance/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /"running smoothly"/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /omits real errors is a false report/);
  // Old cheerleader personas are gone; plain warm greetings are still fine.
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /confident, upbeat/);
  assert.doesNotMatch(DEFAULT_VOICE_SYSTEM_PROMPT, /good-humored conversational partner/);
  // Investigator/broker: gather factual context before reporting; distinguish verified from unknown.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /Be a broker and an investigator/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /gather the factual context first/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /"verified" from "reported" from "unknown"/);
  // Action over words: bare acknowledgments like "Got it" are forbidden without a matching tool call.
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /"Got it,"/);
  assert.match(DEFAULT_VOICE_SYSTEM_PROMPT, /without a matching action in the same turn is stalling and is forbidden/);
});
