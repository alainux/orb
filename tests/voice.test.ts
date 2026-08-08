import assert from "node:assert/strict";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { controllerSeam, fakePi } from "./support/seams.js";
import { nextVoice, resolveVoice, voiceOptions } from "../src/voices.js";

test("voice options are curated per provider, with distinct names", () => {
  const gem = voiceOptions("gemini");
  const oai = voiceOptions("openai");
  assert.ok(gem.length >= 5, "gemini has a usable set");
  assert.ok(oai.length >= 5, "openai has a usable set");
  assert.ok(gem.includes("Kore"), "default voice Kore is cyclable");
  // Case-insensitive resolution returns the canonical spelling.
  assert.equal(resolveVoice("gemini", "kore"), "Kore");
  assert.equal(resolveVoice("gemini", "PUCK"), "Puck");
  assert.equal(resolveVoice("openai", "shimmer"), "shimmer");
  assert.equal(resolveVoice("gemini", "nope"), undefined);
});

test("nextVoice wraps around the current voice in cycle order", () => {
  const gem = voiceOptions("gemini");
  for (let i = 0; i < gem.length; i++) {
    assert.equal(nextVoice("gemini", gem[i]!), gem[(i + 1) % gem.length]);
  }
  // Unknown current -> acts as if not in the list (starts at first).
  assert.equal(nextVoice("gemini", "Whatever"), gem[0]!);
});

test("controller.setVoice cycles to the next provider voice and updates config", async () => {
  const c = new VoiceController(fakePi());
  const calls: string[] = [];
  const spoken: string[] = [];
  controllerSeam(c).provider = {
    setVoice: async (v: string) => { calls.push(v); },
    sendText: async (t: string) => { spoken.push(t); },
  };
  controllerSeam(c).config = { provider: "gemini", voice: "Kore" };
  controllerSeam(c).state = { active: true };
  const notify: string[] = [];
  const ctx = { ui: { notify: (m: string) => notify.push(m) } };
  controllerSeam(c).setVoice(undefined, ctx);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ["Puck"]);
  assert.equal(controllerSeam(c).config.voice, "Puck");
  assert.ok(notify.some((m) => m.includes("→ Puck")), "notified the new voice");
  // Audition: the new voice introduces itself by name in a spoken line.
  assert.ok(spoken.some((t) => t.includes("Puck")), "spoken the new voice name during audition");
});

test("controller.setVoice sets a specific known voice by name", async () => {
  const c = new VoiceController(fakePi());
  const calls: string[] = [];
  controllerSeam(c).provider = {
    setVoice: async (v: string) => { calls.push(v); },
    sendText: async () => {},
  };
  controllerSeam(c).config = { provider: "gemini", voice: "Aoede" };
  controllerSeam(c).state = { active: true };
  const notify: string[] = [];
  const ctx = { ui: { notify: (m: string) => notify.push(m) } };
  controllerSeam(c).setVoice("zephyr", ctx);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(calls, ["Zephyr"]);
  assert.equal(controllerSeam(c).config.voice, "Zephyr");
});

test("controller.setVoice lists options and rejects unknown names", async () => {
  const c = new VoiceController(fakePi());
  controllerSeam(c).state = { active: true };
  controllerSeam(c).provider = { setVoice: async () => {}, sendText: async () => {} };
  controllerSeam(c).config = { provider: "gemini", voice: "Kore" };
  const notify: string[] = [];
  const ctx = { ui: { notify: (m: string) => notify.push(m) } };
  controllerSeam(c).setVoice("list", ctx);
  await new Promise((r) => setImmediate(r));
  assert.ok(notify.some((m) => m.includes("Voices (gemini)")), "listed voices");
  controllerSeam(c).setVoice("bogus", ctx);
  await new Promise((r) => setImmediate(r));
  assert.ok(notify.some((m) => m.toLowerCase().includes("unknown voice")), "rejected bogus voice");
});

// The `set_voice` agent tool was removed: the voice can only be configured via
// the config file (or the human-driven /voice command), never by the agent.
// controller.setVoice above remains the human-facing path.