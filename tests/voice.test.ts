import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadVoiceConfig } from "../src/config.js";
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

test("controller.setVoice persists the selection and restores it across sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-voice-persist-"));
  const configFile = join(root, "config.json");
  await withEnv({ GEMINI_API_KEY: "test", ORB_CONFIG: configFile, OPENAI_API_KEY: undefined }, async () => {
    const c = new VoiceController(fakePi());
    controllerSeam(c).config = { provider: "gemini", voice: "Kore" };
    controllerSeam(c).state = { active: true };
    controllerSeam(c).provider = { setVoice: async () => {}, sendText: async () => {} };
    const notify: string[] = [];
    const ctx = { cwd: root, ui: { notify: (m: string) => notify.push(m) } };
    controllerSeam(c).setVoice("zephyr", ctx);
    await new Promise((r) => setImmediate(r));
    assert.ok(notify.some((m) => m.includes("→ Zephyr")), "notified the new voice");

    // The selection was written to disk under the provider block (best-effort
    // async write, so poll for it to land).
    await waitForVoice(configFile, "gemini", "Zephyr");
    const written = JSON.parse(await readFile(configFile, "utf8")) as { gemini?: { voice?: string } };
    assert.equal(written.gemini?.voice, "Zephyr", "persisted voice in the user config");

    // A fresh instance reloading the same config restores that voice.
    const restored = await loadVoiceConfig("gemini", root);
    assert.equal(restored.voice, "Zephyr", "persisted choice is the effective voice on restart");
  });
});

test("setVoice does not clobber the persisted API key when writing the voice", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-voice-key-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify({ gemini: { apiKey: "persisted-key" } }), "utf8");
  await withEnv({ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, OPENAI_API_KEY: undefined, ORB_CONFIG: configFile }, async () => {
    const c = new VoiceController(fakePi());
    controllerSeam(c).config = { provider: "gemini", voice: "Kore" };
    controllerSeam(c).state = { active: true };
    controllerSeam(c).provider = { setVoice: async () => {}, sendText: async () => {} };
    controllerSeam(c).setVoice("Puck", { cwd: root, ui: { notify: () => {} } });
    await waitForVoice(configFile, "gemini", "Puck");
    const written = JSON.parse(await readFile(configFile, "utf8")) as { gemini?: { apiKey?: string; voice?: string } };
    assert.equal(written.gemini?.apiKey, "persisted-key", "existing API key preserved when writing voice");
    assert.equal(written.gemini?.voice, "Puck", "voice written alongside preserved key");
  });
});

/** Poll until the persisted user config has `provider.voice === expected` (the
 * voice write is fire-and-forget behind the live switch). Throws after a timeout. */
async function waitForVoice(path: string, provider: string, expected: string): Promise<void> {
  const deadline = Date.now() + 3000;
  let last: string | undefined;
  for (;;) {
    try {
      const parsed = JSON.parse(await readFile(path, "utf8")) as Record<string, { voice?: string }>;
      last = parsed[provider]?.voice;
      if (last === expected) return;
    } catch { /* not written yet */ }
    if (Date.now() > deadline) throw new Error(`voice not persisted (expected ${expected}, got ${String(last)})`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

// The `set_voice` agent tool was removed: the voice can only be configured via
// the config file (or the human-driven /voice command), never by the agent.
// controller.setVoice above remains the human-facing path.
async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(values)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await run(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("ensureApiKey reuses an environment-configured key without prompting", async () => {
  await withEnv({ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: "env-key", OPENAI_API_KEY: undefined, ORB_PROVIDER: "gemini", ORB_CONFIG: undefined }, async () => {
    const c = new VoiceController(fakePi());
    const notify: string[] = [];
    let prompted = false;
    const ctx = { hasUI: true, mode: "tui", cwd: process.cwd(), ui: { notify: (m: string) => notify.push(m), input: async () => { prompted = true; return "never"; } } };
    const key = await controllerSeam(c).ensureApiKey(ctx, process.cwd());
    assert.equal(key, "env-key", "env key is used as-is");
    assert.equal(prompted, false, "no prompt when the env var is set");
    assert.equal(notify.length, 0, "no notification needed when configured");
  });
});

test("ensureApiKey prompts and persists the entered key for reuse", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-key-"));
  const configFile = join(root, "config.json");
  await withEnv({ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, OPENAI_API_KEY: undefined, ORB_PROVIDER: "gemini", ORB_CONFIG: configFile, XDG_CONFIG_HOME: root }, async () => {
    const c = new VoiceController(fakePi());
    const notify: string[] = [];
    const ctx = { hasUI: true, mode: "tui", cwd: root, ui: { notify: (m: string) => notify.push(m), input: async () => "   user-entered-key  " } };
    const key = await controllerSeam(c).ensureApiKey(ctx, root);
    assert.equal(key, "user-entered-key", "entered key is trimmed and returned");
    assert.ok(notify.some((m) => m.includes("Saved your")), "confirms the key was persisted");

    // A fresh instance on the same config reuses the persisted key without prompting.
    const again = new VoiceController(fakePi());
    let prompted = false;
    const ctx2 = { hasUI: true, mode: "tui", cwd: root, ui: { notify: () => {}, input: async () => { prompted = true; return undefined; } } };
    assert.equal(await controllerSeam(again).ensureApiKey(ctx2, root), "user-entered-key", "reuses persisted key");
    assert.equal(prompted, false, "no prompt when the key is already persisted");
    const written = JSON.parse(await readFile(configFile, "utf8")) as { gemini?: { apiKey?: string } };
    assert.equal(written.gemini?.apiKey, "user-entered-key", "key persisted under the provider block");
  });
});

test("ensureApiKey degrades to a non-blocking warning when cancelled or unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-keycancel-"));
  const configFile = join(root, "config.json"); // intentionally absent: no persisted key
  await withEnv({ GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, OPENAI_API_KEY: undefined, ORB_PROVIDER: "gemini", ORB_CONFIG: configFile, XDG_CONFIG_HOME: root }, async () => {
    // Human dismisses the dialog (undefined) in interactive TUI.
    const interactive = new VoiceController(fakePi());
    const cancelNotify: string[] = [];
    const cancelCtx = { hasUI: true, mode: "tui", cwd: process.cwd(), ui: { notify: (m: string) => cancelNotify.push(m), input: async () => undefined } };
    assert.equal(await controllerSeam(interactive).ensureApiKey(cancelCtx, process.cwd()), undefined, "no key when cancelled");
    assert.ok(cancelNotify.some((m) => m.includes("not started")), "tells the user Orb did not start");

    // Non-interactive session: notify how to configure, no prompt, no crash.
    const headless = new VoiceController(fakePi());
    const headNotify: string[] = [];
    const headlessCtx = { hasUI: false, mode: "print", cwd: process.cwd(), ui: { notify: (m: string) => headNotify.push(m), input: async () => "unused" } };
    assert.equal(await controllerSeam(headless).ensureApiKey(headlessCtx, process.cwd()), undefined, "no key in non-interactive mode");
    assert.ok(headNotify.some((m) => m.includes("Set GEMINI_API_KEY")), "headless user is told to set the env var");
  });
});
