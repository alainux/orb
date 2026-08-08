import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RunLog } from "../src/log.js";
import { GeminiLiveProvider } from "../src/providers/gemini.js";
import { OpenAIRealtimeProvider } from "../src/providers/openai.js";
import type { VoiceProviderSink, VoiceConfig } from "../src/types.js";

function config(provider: "gemini" | "openai"): VoiceConfig {
  return {
    provider,
    apiKey: "test-key",
    model: provider === "gemini" ? "gemini-3.1-flash-live-preview" : "gpt-realtime-2.1",
    voice: "Aoede",
    temperature: 0.5,
    systemPrompt: "p",
    orbAspect: 2,
    orbDensity: 1.1,
    orbReactivity: 0.7,
    orbBraille: false,
    panelHeight: 12,
    activityLines: 8,
    autoStartVoice: true,
    logDir: "/tmp/orb-think",
    configFiles: [],
    geminiSessionResumption: true,
    geminiContextCompression: false,
    geminiCompressionTriggerTokens: 18000,
    geminiCompressionTargetTokens: 9000,
    permissions: { cancelPi: true, setModel: true, setThinking: true, setTools: true, shell: true, nativeTools: true, scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false },
    audio: { bufferMs: 140, maxBufferMs: 380, recoveryStepMs: 40, interruptionStormCount: 3, interruptionStormWindowMs: 1800, interruptionRecoveryMuteMs: 320, choppinessWindowRecoveries: 3, choppinessWindowMs: 1500, choppinessRecoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000 },
    scratchpad: { panelHeight: 12, maxBytes: 524288 },
  } as VoiceConfig;
}

async function logger() {
  const logDir = mkdtempSync(join(tmpdir(), "orb-thinking-log-"));
  return RunLog.create(logDir);
}

/** A sink that fences every supported callback so only `onThinking` is observed. */
function captureSink(): { thinking: boolean[]; sink: VoiceProviderSink } {
  const thinking: boolean[] = [];
  return {
    thinking,
    sink: {
      onAudio: () => {},
      onAudioEnd: () => {},
      onInterruption: () => {},
      onInputTranscript: () => {},
      onOutputTranscript: () => {},
      onStatus: () => {},
      onThinking: (t: boolean) => thinking.push(t),
      onError: () => {},
      onSessionEnded: () => {},
      onToolCall: async () => ({}),
    } as VoiceProviderSink,
  };
}

// ---------------------------------------------------------------------------
// OpenAI Realtime: `response.created` is a clean "generation started" signal.
// Thinking holds until the first content delta, `response.done`, or a server
// barge-in interruption.
// ---------------------------------------------------------------------------
test("openai lifts thinking on response.created and clears on first content", async () => {
  const log = await logger();
  const provider = new OpenAIRealtimeProvider(config("openai"), log);
  const { sink, thinking } = captureSink();
  (provider as any).sink = sink;

  assert.deepEqual(thinking, [], "idle before any response");
  await (provider as any).handleMessage(JSON.stringify({ type: "response.created" }));
  assert.deepEqual(thinking, [true], "generation started → thinking");
  // First delivered content flips it off; the same state change is not re-emitted.
  await (provider as any).handleMessage(JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "Hel" }));
  assert.deepEqual(thinking, [true, false], "first content clears thinking");
  await (provider as any).handleMessage(JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "llo" }));
  assert.deepEqual(thinking, [true, false], "no duplicate on later deltas");
});

test("openai clears thinking on response.done even with no delivered content", async () => {
  const log = await logger();
  const provider = new OpenAIRealtimeProvider(config("openai"), log);
  const { sink, thinking } = captureSink();
  (provider as any).sink = sink;

  await (provider as any).handleMessage(JSON.stringify({ type: "response.created" }));
  await (provider as any).handleMessage(JSON.stringify({ type: "response.done" }));
  assert.deepEqual(thinking, [true, false]);
});

test("openai interruption (server barge-in) clears thinking", async () => {
  const log = await logger();
  const provider = new OpenAIRealtimeProvider(config("openai"), log);
  const { sink, thinking } = captureSink();
  (provider as any).sink = sink;

  await (provider as any).handleMessage(JSON.stringify({ type: "response.created" }));
  await (provider as any).handleMessage(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
  assert.deepEqual(thinking, [true, false]);
});

// ---------------------------------------------------------------------------
// Gemini Live: there is no "response.created", so thinking is approximated as
// the window between a model turn starting and the first delivered content.
// ---------------------------------------------------------------------------
test("gemini shows thinking for a turn that delivers no content, then clears on content", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking } = captureSink();
  (provider as any).sink = sink;

  // A model turn that has started but carries no audio/transcript yet (e.g. a
  // tool call only, or the model opening its turn before speaking): thinking on.
  await (provider as any).handleMessage({ serverContent: { modelTurn: { parts: [{ functionCall: {} }] } } });
  assert.match(thinking.join(","), /true/, "a contentless model turn shows thinking");

  // The next delivered audio content clears it.
  await (provider as any).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } } });
  assert.equal(thinking.at(-1), false, "delivered audio clears thinking");
});

test("gemini user-only transcription never flashes thinking", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking } = captureSink();
  (provider as any).sink = sink;

  await (provider as any).handleMessage({ serverContent: { inputTranscription: { text: "hi" } } });
  assert.deepEqual(thinking, [], "user speech does not assert the model is thinking");
});

test("gemini interruption/boundary clears an in-flight thinking state", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking } = captureSink();
  (provider as any).sink = sink;

  // Model turn opens (contentless) → thinking on.
  await (provider as any).handleMessage({ serverContent: { modelTurn: { parts: [{ functionCall: {} }] } } });
  assert.equal(thinking.at(-1), true, "thinking asserted while the model reasons");

  // A completed turn (turnComplete) is a hard boundary → thinking clears.
  await (provider as any).handleMessage({ serverContent: { turnComplete: true } });
  assert.equal(thinking.at(-1), false, "boundary clears thinking");
});