import assert from "node:assert/strict";
import test from "node:test";
import { buildGeminiLiveConfig } from "../src/providers/gemini-config.js";
import { isExpectedGeminiRotationError } from "../src/providers/util.js";
import type { VoiceConfig } from "../src/types.js";

test("Gemini GoAway/session-duration closures are classified as expected rotations",()=>{
  assert.equal(isExpectedGeminiRotationError("Connection aborted after receiving a GoAway signal once the session duration elapsed"),true);
  assert.equal(isExpectedGeminiRotationError("ordinary authentication error"),false);
});

test("Gemini Developer API resumption config never sends Enterprise-only transparent",()=>{
  const config = geminiConfig();
  const initial = buildGeminiLiveConfig(config) as any;
  assert.deepEqual(initial.sessionResumption, {});
  assert.equal("transparent" in initial.sessionResumption, false);

  const resumed = buildGeminiLiveConfig(config, "resume-token") as any;
  assert.deepEqual(resumed.sessionResumption, { handle: "resume-token" });
  assert.equal("transparent" in resumed.sessionResumption, false);
  assert.equal(JSON.stringify(resumed).includes("transparent"), false);
});

test("Gemini resumption can be disabled without emitting sessionResumption",()=>{
  const config = geminiConfig();
  config.geminiSessionResumption = false;
  const live = buildGeminiLiveConfig(config, "ignored") as any;
  assert.equal("sessionResumption" in live, false);
});

function geminiConfig(): VoiceConfig {
  return {
    provider: "gemini",
    apiKey: "test-key",
    model: "gemini-3.1-flash-live-preview",
    voice: "Aoede",
    temperature: 0.7,
    systemPrompt: "test",
    greetingEnabled: false,
    orbAspect: 2,
    orbDensity: 1.1,
    orbReactivity: 0.7,
    orbBraille: false,
    panelHeight: 14,
    activityLines: 10,
    logDir: "/tmp/orb-test",
    configFiles: [],
    geminiSessionResumption: true,
    geminiContextCompression: true,
    geminiCompressionTriggerTokens: 18000,
    geminiCompressionTargetTokens: 9000,
    permissions: { cancelPi: true, setModel: true, setThinking: true, setTools: true, shell: true, nativeTools: true, scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false },
    audio: { bufferMs: 140, maxBufferMs: 380, recoveryStepMs: 40, interruptionStormCount: 3, interruptionStormWindowMs: 1800, interruptionRecoveryMuteMs: 320 },
    scratchpad: { panelHeight: 18, maxBytes: 524288 },
  };
}
