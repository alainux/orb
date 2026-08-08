import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunLog } from "../src/log.js";
import { GeminiLiveProvider } from "../src/providers/gemini.js";
import type { VoiceConfig } from "../src/types.js";
import { providerSeam } from "./support/seams.js";

function config(): VoiceConfig {
  return {
    provider: "gemini",
    apiKey: "test-key",
    model: "gemini-3.1-flash-live-preview",
    voice: "Aoede",
    temperature: 0.5,
    systemPrompt: "p",
    orbAspect: 2,
    orbDensity: 1.1,
    orbReactivity: 0.7,
    orbBraille: false,
    panelHeight: 12,
    activityLines: 8,
    thinkingDisplay: "minimized",
    autoStartVoice: true,
    logDir: "/tmp/orb-pinned",
    configFiles: [],
    geminiSessionResumption: true,
    geminiContextCompression: true,
    geminiCompressionTriggerTokens: 18000,
    geminiCompressionTargetTokens: 9000,
    geminiThinkingBudget: -1,
    geminiThinkingHoldMs: 0,
    permissions: { cancelPi: true, scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false },
    audio: { bufferMs: 140, maxBufferMs: 380, recoveryStepMs: 40, interruptionStormCount: 3, interruptionStormWindowMs: 1800, interruptionRecoveryMuteMs: 320, choppinessWindowRecoveries: 3, choppinessWindowMs: 1500, choppinessRecoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000 },
    scratchpad: { panelHeight: 12, maxBytes: 524288 },
  } as VoiceConfig;
}

type SupportedToolResponse = { functionResponses?: Array<{ id: string; name?: string }> };

/** First tool response pushed to the fake session sink (a MessageProtocol). */
function firstResponse(sent: Array<unknown>): { id: string; name?: string } | undefined {
  return (sent[0] as SupportedToolResponse | undefined)?.functionResponses?.[0];
}

async function makeProvider() {
  const logDir = mkdtempSync(join(tmpdir(), "orb-resilience-log-"));
  const log = await RunLog.create(logDir);
  const provider = new GeminiLiveProvider(config(), log);
  providerSeam(provider).sink = undefined;
  providerSeam(provider).handledCalls.clear();
  return { provider: provider as unknown as GeminiLiveProvider, logDir };
}

/**
 * Core regression: a spoken commitment and its own function call can be in the
 * same realtime message. If the audio/transcript zone of the handler throws,
 * the already-emitted function call MUST still execute — otherwise a verbal
 * ("dispatching now") is left with nothing done, which the handler previously
 * swallowed via a single enclosing try/catch.
 */
test("transcript/audio throw does not drop the same message's tool call", async () => {
  const { provider } = await makeProvider();
  let audioError: Error | undefined;
  const processed: string[] = [];
  const sent: Array<unknown> = [];
  providerSeam(provider).sink = {
    onAudio: () => { throw new Error("audio buffer overflow"); },
    onError: (e: Error) => { audioError = e; },
    onToolCall: (call: { id: string }) => { processed.push(call.id); return { ok: true }; },
  };
  providerSeam(provider).session = {
    sendToolResponse: (payload: unknown) => sent.push(payload),
  };

  await providerSeam(provider).handleMessage({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } },
    toolCall: { functionCalls: [{ id: "x1", name: "run_pi_task", args: {} }] },
  });

  assert.ok(audioError, "the transcript/audio failure should be surfaced");
  assert.ok(audioError!.message.includes("audio buffer overflow"));
  assert.deepEqual(processed, ["x1"], "the tool call must still be delivered to the sink");
  // The tool call was dispatched and answered back to the model.
  assert.equal(sent.length, 1, "the tool response must still be sent");
  assert.equal(firstResponse(sent)?.id, "x1");
  assert.equal(firstResponse(sent)?.name, "run_pi_task");
});

test("a failing tool execution still answers the model instead of stalling", async () => {
  const { provider } = await makeProvider();
  const sent: Array<unknown> = [];
  providerSeam(provider).sink = {
    onToolCall: () => { throw new Error("boom"); },
  };
  providerSeam(provider).session = { sendToolResponse: (payload: unknown) => sent.push(payload) };

  await providerSeam(provider).processToolCalls([{ id: "y1", name: "run_pi_task", args: { instruction: "do x" } }]);

  assert.equal(sent.length, 1, "a failing tool must still produce a response");
  assert.equal(firstResponse(sent)?.id, "y1");
  assert.match(JSON.stringify(sent[0]), /"ok":false/);
  assert.match(JSON.stringify(sent[0]), /boom/);
});

test("the same function call re-delivered after a reconnect is executed only once", async () => {
  const { provider } = await makeProvider();
  const processed: string[] = [];
  const sent: Array<unknown> = [];
  providerSeam(provider).sink = { onToolCall: (call: { id: string }) => { processed.push(call.id); return { ok: true }; } };
  providerSeam(provider).session = { sendToolResponse: (payload: unknown) => sent.push(payload) };

  await providerSeam(provider).processToolCalls([{ id: "z1", name: "read_pi_log", args: {} }]);
  await providerSeam(provider).processToolCalls([{ id: "z1", name: "read_pi_log", args: {} }]);

  assert.deepEqual(processed, ["z1"], "duplicate delivery must not double-execute");
  assert.equal(sent.length, 1);
});