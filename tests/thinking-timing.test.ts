import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import test from "node:test";
import { RunLog } from "../src/log.js";
import { GeminiLiveProvider } from "../src/providers/gemini.js";
import { OpenAIRealtimeProvider } from "../src/providers/openai.js";
import { createFileLog, ThinkingTracker, thinkingLabel } from "../src/thinking-timing.js";
import type { VoiceProviderSink, VoiceConfig } from "../src/types.js";
import { providerSeam } from "./support/seams.js";

/** Build a tracker wired to a fake clock and a captured log array. */
function makeTracker(label = "gemini·gemini-3.1-flash-live-preview") {
  let t = 0;
  const lines: string[] = [];
  const advance = (ms: number) => { t += ms; };
  const tracker = new ThinkingTracker(label, { now: () => t, log: (l) => lines.push(l) });
  return { tracker, lines, advance };
}

function cfg(provider: "gemini" | "openai"): VoiceConfig {
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
    logDir: "/tmp/orb-timing",
    configFiles: [],
    geminiSessionResumption: true,
    geminiContextCompression: false,
    geminiCompressionTriggerTokens: 18000,
    geminiCompressionTargetTokens: 9000,
    geminiThinkingBudget: -1,
    geminiThinkingHoldMs: 0,
    permissions: { scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false },
    audio: { bufferMs: 140, maxBufferMs: 380, recoveryStepMs: 40, interruptionStormCount: 3, interruptionStormWindowMs: 1800, interruptionRecoveryMuteMs: 320, choppinessWindowRecoveries: 3, choppinessWindowMs: 1500, choppinessRecoverSilenceMs: 1500, inputResyncDrops: 3, inputResyncWindowMs: 1500, inputResyncCooldownMs: 4000, stallGapMs: 150 },
    scratchpad: { panelHeight: 12, maxBytes: 524288 },
  } as VoiceConfig;
}

// ---------------------------------------------------------------------------
// ThinkingTracker unit behaviour (dedupe, reentrant boundaries, held timing).
// ---------------------------------------------------------------------------
test("ThinkingTracker logs a start then a stop with the held duration", () => {
  const { tracker, lines, advance } = makeTracker();
  tracker.observe(true);
  assert.equal(tracker.active, true);
  advance(30);
  tracker.observe(false);
  assert.equal(tracker.active, false);

  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /^\[orb-thinking\] start seq=1 at=.* model=gemini·gemini-3\.1-flash-live-preview$/);
  assert.match(lines[1]!, /^\[orb-thinking\] stop seq=2 at=.* held=30ms model=gemini·gemini-3\.1-flash-live-preview$/);
});

test("ThinkingTracker dedupes duplicate transitions (edge-triggered)", () => {
  const { tracker, lines } = makeTracker();
  tracker.observe(true);
  tracker.observe(true); // redundant start → ignored
  tracker.observe(false);
  tracker.observe(false); // redundant stop → ignored
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /start seq=1/);
  assert.match(lines[1]!, /stop seq=2 .* held=0ms/);
});

test("ThinkingTracker.reset() emits a stop only when a window is open", () => {
  const { tracker, lines } = makeTracker();
  tracker.reset(); // no window → no-op
  assert.equal(lines.length, 0);

  tracker.observe(true);
  tracker.reset(); // open → stop
  assert.equal(tracker.active, false);
  assert.equal(lines.length, 2);
  assert.match(lines[1]!, /stop/);
});

test("ThinkingTracker spans repeated windows with incrementing seq", () => {
  const { tracker, lines, advance } = makeTracker();
  tracker.observe(true); advance(5); tracker.observe(false);
  tracker.observe(true); advance(9); tracker.observe(false);

  assert.equal(lines.length, 4);
  const [l1, l2, l3, l4] = lines as [string, string, string, string];
  assert.match(l1, /start seq=1/);
  assert.match(l2, /stop seq=2 .* held=5ms/);
  assert.match(l3, /start seq=3/);
  assert.match(l4, /stop seq=4 .* held=9ms/);
});

test("thinkingLabel joins provider and model with a separating dot", () => {
  assert.equal(thinkingLabel("openai", "gpt-realtime-2.1"), "openai·gpt-realtime-2.1");
});

test("createFileLog persists trace lines to a dedicated file, not the console", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-think-log-"));
  const log = createFileLog(dir);
  log("[orb-thinking] start seq=1 at=… model=gemini·m");
  log("[orb-thinking] stop seq=2 at=… held=30ms model=gemini·m");
  // Wait deterministically on the chained flush (no timer guess) so this test
  // isn't racy under load.
  await log.flush();
  const content = await readFile(join(dir, "orb-thinking.log"), "utf8");
  assert.equal(content, "[orb-thinking] start seq=1 at=… model=gemini·m\n[orb-thinking] stop seq=2 at=… held=30ms model=gemini·m\n");
});

test("createFileLog flush() retains order under a heavy burst of writes", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-think-burst-"));
  const log = createFileLog(dir);
  const expected: string[] = [];
  for (let i = 0; i < 500; i++) { const line = `[orb-thinking] line ${i}`; expected.push(line); log(line); }
  await log.flush();
  const content = await readFile(join(dir, "orb-thinking.log"), "utf8");
  assert.equal(content, `${expected.join("\n")}\n`);
});

// ---------------------------------------------------------------------------
// Provider→tracker integration: the tracker sits at the controller boundary and
// sees every provider's `sink.onThinking` transition, so it must produce a
// start/stop pair for BOTH the Gemini and OpenAI realtime providers.
// ---------------------------------------------------------------------------
async function driveProvider(provider: "gemini" | "openai", send: (h: (m: unknown) => void) => Promise<void>) {
  const c = cfg(provider);
  const lines: string[] = [];
  const tracker = new ThinkingTracker(thinkingLabel(c.provider, c.model), { log: (l) => lines.push(l) });
  const Inst = provider === "gemini" ? GeminiLiveProvider : OpenAIRealtimeProvider;
  const inst = new Inst(c, await RunLog.create(`/tmp/orb-timing-${provider}`));
  const sink: Partial<VoiceProviderSink> = {
    onAudio: () => {}, onAudioEnd: () => {}, onInterruption: () => {},
    onInputTranscript: () => {}, onOutputTranscript: () => {},
    onStatus: () => {}, onError: () => {}, onSessionEnded: () => {}, onToolCall: async () => ({}),
    onThinking: (v: boolean) => tracker.observe(v),
  };
  providerSeam(inst).sink = sink;
  await send((m) => providerSeam(inst).handleMessage(m));
  return { lines, tracker };
}

test("openai provider surfaces Thinking start/stop through the tracker", async () => {
  const { lines, tracker } = await driveProvider("openai", async (handle) => {
    await handle(JSON.stringify({ type: "response.created" })); // start
    await handle(JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "Hel" })); // stop
  });
  assert.equal(tracker.active, false);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /start seq=1 .* model=openai·gpt-realtime-2\.1$/);
  assert.match(lines[1]!, /stop seq=2 .* model=openai·gpt-realtime-2\.1$/);
});

test("gemini provider surfaces Thinking start/stop through the tracker", async () => {
  const { lines, tracker } = await driveProvider("gemini", async (handle) => {
    await handle({ serverContent: { modelTurn: { parts: [{ thought: true, text: "r" }] } } }); // start
    await handle({ serverContent: { modelTurn: { parts: [{ inlineData: { data: "QUJD" } }] } } }); // stop
  });
  assert.equal(tracker.active, false);
  assert.equal(lines.length, 2);
  assert.match(lines[0]!, /start seq=1 .* model=gemini·gemini-3\.1-flash-live-preview$/);
  assert.match(lines[1]!, /stop seq=2 .* model=gemini·gemini-3\.1-flash-live-preview$/);
});