import assert from "node:assert/strict";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { buildVoiceSettings, budgetLabel } from "../src/settings.js";
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

test("budgetLabel renders the durable thinking-budget value readably", () => {
  assert.equal(budgetLabel(0), "off");
  assert.equal(budgetLabel(-1), "auto (dynamic)");
  assert.equal(budgetLabel(1024), "1024 tokens");
  assert.equal(budgetLabel(undefined), "model default");
});

test("the settings panel is an editable session toggle plus read-only config rows", () => {
  const rows = buildVoiceSettings({ thinking: "full", config: config() });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

  // Editable session toggle, containing the live value and cycling values.
  assert.ok(byId.thinking!.values, "the reasoning row is editable");
  assert.deepEqual(byId.thinking!.values, ["full", "minimized", "hidden"]);
  assert.equal(byId.thinking!.currentValue, "full");

  // Durable config rows are present and read-only (no values to cycle).
  assert.equal(byId["ref.provider"]!.currentValue, "gemini");
  assert.equal(byId["ref.voice"]!.currentValue, "Zephyr");
  assert.equal(byId["ref.budget"]!.currentValue, "off");
  assert.equal(byId["ref.autostart"]!.currentValue, "off");
  assert.equal(byId["ref.budget"]!.values, undefined, "config rows are read-only");
});

test("applyVoiceSetting rewrites the reasoning display in memory only (no file, no session entry)", () => {
  const c = new VoiceController(fakePi());
  setConfig(c, config());
  controllerSeam(c).state = { active: true, thinkingDisplay: "minimized" };

  c.applyVoiceSetting("thinking", "full");
  assert.equal(c.thinkingDisplayPref, "full");
  assert.equal(controllerSeam(c).config.thinkingDisplay, "full");
});