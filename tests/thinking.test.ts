import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { RunLog } from "../src/log.js";
import { GeminiLiveProvider } from "../src/providers/gemini.js";
import { OpenAIRealtimeProvider } from "../src/providers/openai.js";
import type { VoiceProviderSink, VoiceConfig } from "../src/types.js";
import { providerSeam } from "./support/seams.js";

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
    thinkingDisplay: "minimized",
    autoStartVoice: true,
    logDir: "/tmp/orb-think",
    configFiles: [],
    geminiSessionResumption: true,
    geminiContextCompression: false,
    geminiCompressionTriggerTokens: 18000,
    geminiCompressionTargetTokens: 9000,
    geminiThinkingBudget: -1,
    geminiThinkingHoldMs: 0,
    permissions: { cancelPi: true, scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false },
    audio: { bufferMs: 140, maxBufferMs: 380, recoveryStepMs: 40, interruptionStormCount: 3, interruptionStormWindowMs: 1800, interruptionRecoveryMuteMs: 320, choppinessWindowRecoveries: 3, choppinessWindowMs: 1500, choppinessRecoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000, stallGapMs: 150 },
    scratchpad: { panelHeight: 12, maxBytes: 524288 },
  } as VoiceConfig;
}

async function logger() {
  const logDir = mkdtempSync(join(tmpdir(), "orb-thinking-log-"));
  return RunLog.create(logDir);
}

interface Cursor {
  at: number; // performance.now() when the transition was observed
  on: boolean; // the new thinking state
}

/**
 * A sink that fences every supported callback so only `onThinking` is observed,
 * while timestamping each transition so the *duration* of every "Thinking… on"
 * window (the perceived flash) can be measured and reported.
 */
function captureSink(): { thinking: boolean[]; timeline: Cursor[]; sink: VoiceProviderSink } {
  const thinking: boolean[] = [];
  const timeline: Cursor[] = [];
  return {
    thinking,
    timeline,
    sink: {
      onAudio: () => {},
      onAudioEnd: () => {},
      onInterruption: () => {},
      onInputTranscript: () => {},
      onOutputTranscript: () => {},
      onStatus: () => {},
      onThinking: (t: boolean) => {
        thinking.push(t);
        timeline.push({ at: performance.now(), on: t });
      },
      onError: () => {},
      onSessionEnded: () => {},
      onToolCall: async () => ({}),
    } as VoiceProviderSink,
  };
}

/**
 * Reduce a timestamped `onThinking` timeline into the measured duration of each
 * contiguous "Thinking… on" window in ms. An open window (never cleared within
 * the test) is reported with a "+" suffix.
 */
function flashDurations(timeline: Cursor[]): string[] {
  const durations: string[] = [];
  let onAt: number | null = null;
  for (const e of timeline) {
    if (e.on && onAt === null) onAt = e.at;
    else if (!e.on && onAt !== null) {
      durations.push((e.at - onAt).toFixed(1));
      onAt = null;
    }
  }
  if (onAt !== null) durations.push(`${(performance.now() - onAt).toFixed(0)}+ (open)`);
  return durations;
}

/** Print the measured "Thinking… on" window(s) for the named run. */
function report(name: string, timeline: Cursor[]) {
  const flash = flashDurations(timeline);
  console.log(`  [timing] ${name}: Thinking was ON ${flash.length} run(s): ${flash.join("ms, ") || "none"} ms`);
}

// ---------------------------------------------------------------------------
// Cost guard: constructing a provider must NEVER open a live socket. All real
// I/O lives behind connect() (client.live.connect → this.session). Every test in
// this file drives the private handleMessage/processToolCalls path directly with
// apiKey "test-key", so the automated suite performs zero network calls. This
// regression pins that down so a future change can't quietly start billing.
// ---------------------------------------------------------------------------
test("provider construction is network-free (no session until connect)", async () => {
  for (const p of ["gemini", "openai"] as const) {
    const log = await logger();
    const provider = p === "gemini"
      ? new GeminiLiveProvider(config(p), log)
      : new OpenAIRealtimeProvider(config(p), log);
    // `session`/`socket` are only assigned inside connect(); a fresh instance
    // must not hold a live socket or have performed any I/O.
    assert.equal(providerSeam(provider).session, undefined, `${p}: no live session at construct time`);
    assert.equal(providerSeam(provider).socket, undefined, `${p}: no live socket at construct time`);
    // The only escape hatch to the wire is connect(), which the suite never calls.
    assert.equal(typeof providerSeam(provider).connect, "function", `${p}: connect() is the sole network entry point`);
  }
});

// ---------------------------------------------------------------------------
// OpenAI Realtime: `response.created` is a clean "generation started" signal.
// Thinking holds until the first content delta, `response.done`, or a server
// barge-in interruption.
// ---------------------------------------------------------------------------
test("openai lifts thinking on response.created and clears on first content", async () => {
  const log = await logger();
  const provider = new OpenAIRealtimeProvider(config("openai"), log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  assert.deepEqual(thinking, [], "idle before any response");
  await providerSeam(provider).handleMessage(JSON.stringify({ type: "response.created" }));
  assert.deepEqual(thinking, [true], "generation started → thinking");
  // First delivered content flips it off; the same state change is not re-emitted.
  await providerSeam(provider).handleMessage(JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "Hel" }));
  assert.deepEqual(thinking, [true, false], "first content clears thinking");
  await providerSeam(provider).handleMessage(JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "llo" }));
  assert.deepEqual(thinking, [true, false], "no duplicate on later deltas");
  report("openai: response.created → first content delta", timeline);
});

test("openai clears thinking on response.done even with no delivered content", async () => {
  const log = await logger();
  const provider = new OpenAIRealtimeProvider(config("openai"), log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  await providerSeam(provider).handleMessage(JSON.stringify({ type: "response.created" }));
  await providerSeam(provider).handleMessage(JSON.stringify({ type: "response.done" }));
  assert.deepEqual(thinking, [true, false]);
  report("openai: response.created → response.done", timeline);
});

test("openai interruption (server barge-in) clears thinking", async () => {
  const log = await logger();
  const provider = new OpenAIRealtimeProvider(config("openai"), log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  await providerSeam(provider).handleMessage(JSON.stringify({ type: "response.created" }));
  await providerSeam(provider).handleMessage(JSON.stringify({ type: "input_audio_buffer.speech_started" }));
  assert.deepEqual(thinking, [true, false]);
  report("openai: response.created → barge-in", timeline);
});

// ---------------------------------------------------------------------------
// Gemini Live: there is no "response.created", so thinking is approximated as
// the window between a model turn starting and the first delivered content.
// ---------------------------------------------------------------------------
test("gemini suppress thinking indicator entirely when budget is 0", async () => {
  const cfg = config("gemini");
  cfg.geminiThinkingBudget = 0; // disabled: Gemini sends no thought parts
  const log = await logger();
  const provider = new GeminiLiveProvider(cfg, log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  // A contentless model turn (tool call) normally asserts thinking; with a
  // zero budget it must never surface the indicator.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ functionCall: {} }] } } });
  assert.deepEqual(thinking, [], "budget 0 suppresses the Thinking indicator on turn open");

  // Even a turn-opening audio chunk stays silent — no flash at all.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } } });
  assert.deepEqual(thinking, [], "no Thinking on→off pair fires while thinking is disabled");

  // Boundary/clear signals are harmless no-ops (nothing to clear).
  await providerSeam(provider).handleMessage({ serverContent: { turnComplete: true } });
  assert.deepEqual(thinking, [], "budget 0 leaves the indicator untouched through boundaries");
  report("gemini: budget 0 (disabled) keeps Thinking off", timeline);
});

test("gemini shows thinking for a turn that delivers no content, then clears on content", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  // A model turn that has started but carries no audio/transcript yet (e.g. a
  // tool call only, or the model opening its turn before speaking): thinking on.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ functionCall: {} }] } } });
  assert.match(thinking.join(","), /true/, "a contentless model turn shows thinking");

  // The next delivered audio content clears it.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } } });
  assert.equal(thinking.at(-1), false, "delivered audio clears thinking");
  report("gemini: contentless turn → audio", timeline);
});

test("gemini opening content surfaces thinking, then clears next message (same-batch on→off)", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  // Gemini streams the opening audio chunk in the turn-starting serverContent.
  // Without a hold this on→off collapses in one batch and never paints.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } } });
  assert.deepEqual(thinking, [true], "turn-opening content surfaces Thinking and holds");

  // The following message (continued output) ends the reasoning window.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "REVG" } }] } } });
  assert.deepEqual(thinking, [true, false], "later content clears the held Thinking");
  report("gemini: turn-opening content → next content chunk", timeline);
});

test("gemini holds Thinking through real thought parts stream, clears on first audio", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  // With thinkingConfig/includeThoughts enabled, the model narrates its reasoning
  // as parts marked thought:true before any audio. Those must stay Thinking.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ thought: true, text: "reasoning…" }] } } });
  assert.deepEqual(thinking, [true], "a thought part opens the Thinking indicator");

  // Another thought part while still no audio: indicator is held, not re-emitted.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ thought: true, text: "more…" }] } } });
  assert.deepEqual(thinking, [true], "sustained thoughts hold Thinking");

  // The first spoken audio ends the reasoning window and clears the indicator.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } } });
  assert.deepEqual(thinking, [true, false], "first spoken content clears Thinking");
  report("gemini: thought-parts stream → first audio", timeline);
});

test("gemini min-visible hold keeps the indicator visible when content arrives in the same batch", async () => {
  const cfg = config("gemini");
  cfg.geminiThinkingHoldMs = 120;
  const log = await logger();
  const provider = new GeminiLiveProvider(cfg, log);
  const { sink, thinking, timeline } = captureSink();
  providerSeam(provider).sink = sink;

  // Turn-opening content and a follow-up content message arrive in the same
  // event-loop batch. Without the hold the on→off coalesces and "Thinking…"
  // never paints; with the hold the off is deferred and stays visible.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "AAAA" } }] } } });
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "BBBB" } }] } } });
  assert.deepEqual(thinking, [true], "indicator is painted true; the clear is held");

  await new Promise((r) => setTimeout(r, 180));
  assert.deepEqual(thinking, [true, false], "indicator clears once the hold elapses");
  report("gemini: min-visible hold = 120ms", timeline);
});

test("gemini user-only transcription never flashes thinking", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking } = captureSink();
  providerSeam(provider).sink = sink;

  await providerSeam(provider).handleMessage({ serverContent: { inputTranscription: { text: "hi" } } });
  assert.deepEqual(thinking, [], "user speech does not assert the model is thinking");
});

test("gemini interruption/boundary clears an in-flight thinking state", async () => {
  const log = await logger();
  const provider = new GeminiLiveProvider(config("gemini"), log);
  const { sink, thinking } = captureSink();
  providerSeam(provider).sink = sink;

  // Model turn opens (contentless) → thinking on.
  await providerSeam(provider).handleMessage({ serverContent: { modelTurn: { parts: [{ functionCall: {} }] } } });
  assert.equal(thinking.at(-1), true, "thinking asserted while the model reasons");

  // A completed turn (turnComplete) is a hard boundary → thinking clears.
  await providerSeam(provider).handleMessage({ serverContent: { turnComplete: true } });
  assert.equal(thinking.at(-1), false, "boundary clears thinking");
});