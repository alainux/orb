import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunLog } from "../src/log.js";
import { GeminiLiveProvider } from "../src/providers/gemini.js";
import type { VoiceConfig } from "../src/types.js";

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
    permissions: { cancelPi: true, setModel: true, setThinking: true, setTools: true, shell: true, scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false },
    audio: { bufferMs: 140, maxBufferMs: 380, recoveryStepMs: 40, interruptionStormCount: 3, interruptionStormWindowMs: 1800, interruptionRecoveryMuteMs: 320, choppinessWindowRecoveries: 3, choppinessWindowMs: 1500, choppinessRecoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000 },
    scratchpad: { panelHeight: 12, maxBytes: 524288 },
  } as VoiceConfig;
}

async function makeProvider() {
  const logDir = mkdtempSync(join(tmpdir(), "orb-resilience-log-"));
  const log = await RunLog.create(logDir);
  const provider = new GeminiLiveProvider(config(), log);
  (provider as any).sink = undefined;
  (provider as any).handledCalls.clear();
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
  let processed: string[] = [];
  const sent: any[] = [];
  (provider as any).sink = {
    onAudio: () => { throw new Error("audio buffer overflow"); },
    onError: (e: Error) => { audioError = e; },
    onToolCall: (c: any) => { processed.push(c.id); return { ok: true }; },
  };
  (provider as any).session = {
    sendToolResponse: (payload: unknown) => sent.push(payload),
  };

  await (provider as any).handleMessage({
    serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } },
    toolCall: { functionCalls: [{ id: "x1", name: "run_pi_task", args: {} }] },
  });

  assert.ok(audioError, "the transcript/audio failure should be surfaced");
  assert.ok(audioError!.message.includes("audio buffer overflow"));
  assert.deepEqual(processed, ["x1"], "the tool call must still be delivered to the sink");
  // The tool call was dispatched and answered back to the model.
  assert.equal(sent.length, 1, "the tool response must still be sent");
  assert.equal(sent[0].functionResponses[0].id, "x1");
  assert.equal(sent[0].functionResponses[0].name, "run_pi_task");
});

test("a failing tool execution still answers the model instead of stalling", async () => {
  const { provider } = await makeProvider();
  const sent: any[] = [];
  (provider as any).sink = {
    onToolCall: () => { throw new Error("boom"); },
  };
  (provider as any).session = { sendToolResponse: (payload: unknown) => sent.push(payload) };

  await (provider as any).processToolCalls([{ id: "y1", name: "run_pi_task", args: { instruction: "do x" } }]);

  assert.equal(sent.length, 1, "a failing tool must still produce a response");
  assert.equal(sent[0].functionResponses[0].id, "y1");
  assert.match(JSON.stringify(sent[0]), /"ok":false/);
  assert.match(JSON.stringify(sent[0]), /boom/);
});

test("the same function call re-delivered after a reconnect is executed only once", async () => {
  const { provider } = await makeProvider();
  let processed: string[] = [];
  const sent: any[] = [];
  (provider as any).sink = { onToolCall: (c: any) => { processed.push(c.id); return { ok: true }; } };
  (provider as any).session = { sendToolResponse: (payload: any) => sent.push(payload) };

  await (provider as any).processToolCalls([{ id: "z1", name: "read_pi_log", args: {} }]);
  await (provider as any).processToolCalls([{ id: "z1", name: "read_pi_log", args: {} }]);

  assert.deepEqual(processed, ["z1"], "duplicate delivery must not double-execute");
  assert.equal(sent.length, 1);
});