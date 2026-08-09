import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VoiceController } from "../src/controller.js";
import { buildVoiceSettings, budgetLabel, normalizePanelKey } from "../src/settings.js";
import { VOICE_OPTIONS } from "../src/voices.js";
import type { VoiceConfig } from "../src/types.js";
import { controllerSeam, fakePi, type ControllerSeam } from "./support/seams.js";

/** Minimal config-shaped object filling the durable reference rows. */
function config(over: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    provider: "gemini", apiKey: "", model: "gemini-model", voice: "Zephyr",
    temperature: 0.8, systemPrompt: "", orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7,
    orbBraille: true, panelHeight: 12, activityLines: 8, logDir: "/tmp", configFiles: [],
    autoStartVoice: false, thinkingDisplay: "minimized", geminiSessionResumption: true,
    geminiContextCompression: false, geminiCompressionTriggerTokens: 0, geminiCompressionTargetTokens: 0,
    geminiThinkingBudget: 0, geminiThinkingHoldMs: 0, permissions: {} as VoiceConfig["permissions"],
    audio: {} as VoiceConfig["audio"], scratchpad: {} as VoiceConfig["scratchpad"],
    ...over,
  } as VoiceConfig;
}

function setConfig(c: VoiceController, cfg: VoiceConfig): void {
  controllerSeam(c).config = cfg as unknown as ControllerSeam["config"];
}

function ctx(root: string, notify: string[] = []): ExtensionContext {
  return { cwd: root, ui: { notify: (m: string) => notify.push(m) } } as unknown as ExtensionContext;
}

/** Poll until the persisted user config has `provider.voice === expected`. */
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

async function withEnv(values: Record<string, string | undefined>, run: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(values)) { prev[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { await run(); } finally { for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

test("budgetLabel renders the durable thinking-budget value readably", () => {
  assert.equal(budgetLabel(0), "off");
  assert.equal(budgetLabel(-1), "auto (dynamic)");
  assert.equal(budgetLabel(1024), "1024 tokens");
  assert.equal(budgetLabel(undefined), "model default");
});

test("the settings panel mixes editable preferences with read-only config rows", () => {
  const rows = buildVoiceSettings({ thinking: "full", config: config() });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  // Session toggle: editable, contains the live value and cycling values.
  assert.ok(byId.thinking!.values, "the reasoning row is editable");
  assert.deepEqual(byId.thinking!.values, ["full", "minimized", "hidden"]);
  assert.equal(byId.thinking!.currentValue, "full");

  // Durable preferences a user expects to change from the panel are editable.
  assert.deepEqual(byId.provider!.values, ["gemini", "openai"]);
  assert.equal(byId.provider!.currentValue, "gemini");
  assert.deepEqual(byId.voice!.values, VOICE_OPTIONS.gemini, "voice cycles the provider's voices");
  assert.equal(byId.voice!.currentValue, "Zephyr");
  assert.deepEqual(byId.autostart!.values, ["on", "off"]);
  assert.equal(byId.autostart!.currentValue, "off");

  // Deeper durable config rows remain read-only (no values to cycle).
  assert.equal(byId["ref.model"]!.currentValue, "gemini-model");
  assert.equal(byId["ref.budget"]!.currentValue, "off");
  assert.equal(byId["ref.model"]!.values, undefined, "config rows are read-only");
  assert.equal(byId["ref.budget"]!.values, undefined, "config rows are read-only");
});

test("normalizePanelKey maps every Kitty-protocol plain Space to the literal space", () => {
  // pi asks terminals for the Kitty keyboard protocol (flags 1|2|4) at startup,
  // so on kitty-capable terminals Space arrives as CSI-u, not " ". SettingsList
  // only activates on the literal character — normalize the no-modifier forms.
  for (const kittySpace of [
    "\x1b[32u",             // flag 1 only
    "\x1b[32;1u",           // flag 1, explicit no-modifier
    "\x1b[32;1:1u",         // flags 1|2, press
    "\x1b[32;1:2u",         // flags 1|2, repeat
    "\x1b[32:32:32;1:1u",   // flags 1|2|4, alternate keys
    "\x1b[32:32;1u",        // flags 1|4, shifted key only
    "\x1b[32:0:32;1:1u",    // shifted omitted (reported as 0)
  ]) {
    assert.equal(normalizePanelKey(kittySpace), " ", JSON.stringify(kittySpace));
  }
  assert.equal(normalizePanelKey(" "), " ", "the legacy space byte is left alone");
});

test("normalizePanelKey passes every other key through untouched", () => {
  for (const data of [
    "\r",               // enter
    "\x1b",             // escape
    "\x1b[B",           // legacy down arrow
    "\x1b[1;1:1B",      // kitty down arrow
    "\x1b[13;1:1u",     // kitty enter
    "\x1b[27;1:1u",     // kitty escape
    "\x1b[32;5u",       // kitty ctrl+space: modified, must NOT activate
    "\x00",             // ctrl+space on legacy terminals
    "a", "Z", "\x1b[320u", // ordinary input / unrelated CSI-u codepoint
  ]) {
    assert.equal(normalizePanelKey(data), data, JSON.stringify(data));
  }
});

test("getVoiceSettings loads the durable rows without requiring an API key", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-settings-nokey-"));
  const configFile = join(root, "config.json");
  await writeFile(configFile, JSON.stringify({ provider: "gemini", autoStartVoice: true, gemini: { model: "m", voice: "Zephyr" } }), "utf8");
  await withEnv({ ORB_CONFIG: configFile, XDG_CONFIG_HOME: root, GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined, OPENAI_API_KEY: undefined }, async () => {
    const c = new VoiceController(fakePi());
    const rows = await c.getVoiceSettings(root);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.ok(byId.voice, "voice row renders before any voice session or API key");
    assert.equal(byId.voice!.currentValue, "Zephyr", "config voice shown");
    assert.equal(byId.provider!.currentValue, "gemini", "config provider shown");
    assert.equal(byId.autostart!.currentValue, "on", "config auto-start shown");
    assert.equal(byId["ref.model"]!.currentValue, "m", "config model shown");
  });
});

test("applyVoiceSetting rewrites the reasoning display in memory only (no file, no session entry)", async () => {
  const c = new VoiceController(fakePi());
  setConfig(c, config());
  controllerSeam(c).state = { active: true, thinkingDisplay: "minimized" };

  await c.applyVoiceSetting("thinking", "full");
  assert.equal(c.thinkingDisplayPref, "full");
  assert.equal(controllerSeam(c).config.thinkingDisplay, "full");
});

test("applyVoiceSetting persists the voice preference when no session is running", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-settings-voice-"));
  const configFile = join(root, "config.json");
  await withEnv({ ORB_CONFIG: configFile, GEMINI_API_KEY: undefined, OPENAI_API_KEY: undefined, XDG_CONFIG_HOME: root }, async () => {
    const c = new VoiceController(fakePi());
    setConfig(c, config());
    controllerSeam(c).state = { active: false };
    const notify: string[] = [];

    await c.applyVoiceSetting("voice", "Puck", ctx(root, notify));
    assert.equal(controllerSeam(c).config.voice, "Puck", "in-memory value updated for the next session");
    assert.ok(notify.some((m) => m.includes("next session")), "notified that the change applies next session");

    const written = JSON.parse(await readFile(configFile, "utf8")) as { gemini?: { voice?: string } };
    assert.equal(written.gemini?.voice, "Puck", "voice persisted under the provider block");
  });
});

test("applyVoiceSetting switches the voice live when a session is running", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-settings-voice-live-"));
  const configFile = join(root, "config.json");
  await withEnv({ ORB_CONFIG: configFile, GEMINI_API_KEY: undefined, OPENAI_API_KEY: undefined, XDG_CONFIG_HOME: root }, async () => {
    const c = new VoiceController(fakePi());
    setConfig(c, config());
    controllerSeam(c).state = { active: true };
    controllerSeam(c).provider = { setVoice: async () => {}, sendText: async () => {} };
    const notify: string[] = [];

    await c.applyVoiceSetting("voice", "Kore", ctx(root, notify));
    // setVoice runs its live switch + persistence asynchronously; poll briefly.
    const deadline = Date.now() + 3000;
    for (;;) {
      if (controllerSeam(c).config.voice === "Kore") break;
      if (Date.now() > deadline) throw new Error("live voice switch did not apply");
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(notify.some((m) => m.includes("→ Kore")), "notified the live switch");
    await waitForVoice(configFile, "gemini", "Kore");
    const written = JSON.parse(await readFile(configFile, "utf8")) as { gemini?: { voice?: string } };
    assert.equal(written.gemini?.voice, "Kore", "live switch also persisted");
  });
});

test("applyVoiceSetting persists the provider for the next session", async () => {  const root = await mkdtemp(join(tmpdir(), "orb-settings-provider-"));
  const configFile = join(root, "config.json");
  await withEnv({ ORB_CONFIG: configFile }, async () => {
    const c = new VoiceController(fakePi());
    setConfig(c, config());
    controllerSeam(c).state = { active: false };
    const notify: string[] = [];

    await c.applyVoiceSetting("provider", "openai", ctx(root, notify));
    assert.equal(controllerSeam(c).config.provider, "openai", "in-memory provider updated");
    assert.ok(notify.some((m) => m.includes("→ openai")), "notified the provider change");

    const written = JSON.parse(await readFile(configFile, "utf8")) as { provider?: string };
    assert.equal(written.provider, "openai", "provider persisted at the top level");
  });
});

test("applyVoiceSetting toggles and persists auto-start", async () => {
  const root = await mkdtemp(join(tmpdir(), "orb-settings-autostart-"));
  const configFile = join(root, "config.json");
  await withEnv({ ORB_CONFIG: configFile, XDG_CONFIG_HOME: root }, async () => {
    const c = new VoiceController(fakePi());
    setConfig(c, config({ autoStartVoice: false }));
    controllerSeam(c).state = { active: false };
    const notify: string[] = [];

    await c.applyVoiceSetting("autostart", "on", ctx(root, notify));
    assert.equal(controllerSeam(c).config.autoStartVoice, true, "in-memory auto-start updated");
    assert.ok(notify.some((m) => m.includes("enabled")), "notified the change");

    const written = JSON.parse(await readFile(configFile, "utf8")) as { autoStartVoice?: boolean };
    assert.equal(written.autoStartVoice, true, "auto-start persisted at the top level");
  });
});
