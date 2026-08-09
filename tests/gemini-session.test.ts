import assert from "node:assert/strict";
import test from "node:test";
import { buildGeminiLiveConfig } from "../src/providers/gemini-config.js";
import { isExpectedGeminiRotationError } from "../src/providers/util.js";
import type { VoiceConfig } from "../src/types.js";

/** A typed view of the wire config for the assertions the tests inspect. */
type GeminiLiveView = {
  sessionResumption?: { handle?: string };
  thinkingConfig?: { thinkingBudget?: number; includeThoughts?: boolean };
};
function live(config: VoiceConfig, handle = ""): GeminiLiveView {
  return buildGeminiLiveConfig(config, handle) as unknown as GeminiLiveView;
}

test("Gemini GoAway/session-duration closures are classified as expected rotations",()=>{
  assert.equal(isExpectedGeminiRotationError("Connection aborted after receiving a GoAway signal once the session duration elapsed"),true);
  assert.equal(isExpectedGeminiRotationError("ordinary authentication error"),false);
});

test("Gemini resumption config never sends Enterprise-only transparent",()=>{
  const config = geminiConfig();
  const initial = live(config);
  assert.deepEqual(initial.sessionResumption, {});
  assert.equal(JSON.stringify(initial).includes("transparent"), false);

  const resumed = live(config, "resume-token");
  assert.deepEqual(resumed.sessionResumption, { handle: "resume-token" });
  assert.equal(JSON.stringify(resumed).includes("transparent"), false);
});

test("Gemini resumption can be disabled without emitting sessionResumption",()=>{
  const config = geminiConfig();
  config.geminiSessionResumption = false;
  const seen = live(config, "ignored");
  assert.equal("sessionResumption" in seen, false);
});

test("Gemini voice thinking config is emitted top-level and honours the budget",()=>{
  // Default budget (-1 automatic) enables thinking with includeThoughts on the
  // Live connection's top-level thinkingConfig (NOT generationConfig).
  const enabled = live(geminiConfig());
  assert.equal(enabled.thinkingConfig?.includeThoughts, true, "includeThoughts surfaces the model's reasoning");
  assert.equal(enabled.thinkingConfig?.thinkingBudget, -1, "-1 requests the model's automatic budget");

  // An explicit positive budget passes straight through.
  const capped = geminiConfig();
  capped.geminiThinkingBudget = 2048;
  assert.equal(live(capped).thinkingConfig?.thinkingBudget, 2048);

  // A zero budget fully disables thinking (no thinkingConfig sent).
  const off = geminiConfig();
  off.geminiThinkingBudget = 0;
  assert.equal("thinkingConfig" in buildGeminiLiveConfig(off), false, "0 budget suppresses thinkingConfig");
});

function geminiConfig(): VoiceConfig {
  return {
    provider: "gemini",
    apiKey: "test-key",
    model: "gemini-3.1-flash-live-preview",
    voice: "Aoede",
    temperature: 0.7,
    systemPrompt: "test",
    orbAspect: 2,
    orbDensity: 1.1,
    orbReactivity: 0.7,
    orbBraille: false,
    panelHeight: 14,
    activityLines: 10,
    thinkingDisplay: "minimized",
    autoStartVoice: true,
    logDir: "/tmp/orb-test",
    configFiles: [],
    geminiSessionResumption: true,
    geminiContextCompression: true,
    geminiCompressionTriggerTokens: 18000,
    geminiCompressionTargetTokens: 9000,
    geminiThinkingBudget: -1,
    geminiThinkingHoldMs: 0,
    permissions: { scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false },
    audio: { bufferMs: 140, maxBufferMs: 380, recoveryStepMs: 40, interruptionStormCount: 3, interruptionStormWindowMs: 1800, interruptionRecoveryMuteMs: 320, choppinessWindowRecoveries: 3, choppinessWindowMs: 1500, choppinessRecoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000, stallGapMs: 150 },
    scratchpad: { panelHeight: 18, maxBytes: 524288 },
  };
}
