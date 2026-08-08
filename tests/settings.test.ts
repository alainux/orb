import assert from "node:assert/strict";
import test from "node:test";
import {
  BUDGET_PRESETS,
  buildPreferences,
  labelForBudget,
  tokensForBudget,
  toggleFor,
  parseSettingValue,
  type VoicePrefs,
} from "../src/settings.js";
import type { VoiceConfig } from "../src/types.js";

/** Minimal config-shaped object for catalog assertions (only consumed fields). */
function fakeConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    provider: "gemini",
    apiKey: "test",
    model: "gemini-3.1-flash-live-preview",
    voice: "Kore",
    temperature: 0.83,
    systemPrompt: "orb",
    thinkingDisplay: "minimized",
    geminiThinkingBudget: 1024,
    geminiContextCompression: true,
    geminiSessionResumption: true,
    orbBraille: true,
    autoStartVoice: true,
    ...overrides,
  } as VoiceConfig;
}

test("budget presets round-trip between label and tokens", () => {
  for (const [label, tokens] of BUDGET_PRESETS) {
    assert.equal(tokensForBudget(label), tokens);
    assert.equal(labelForBudget(tokens), label);
  }
  // Unknown label falls back to the standard preset.
  assert.equal(tokensForBudget("nope"), 1024);
  // A hand-tuned budget snaps to the nearest preset label.
  assert.equal(labelForBudget(800), "standard");
  assert.equal(labelForBudget(9000), "max");
});

test("buildPreferences defaults every row to its documented default", () => {
  const rows = buildPreferences({ prefs: {}, active: false, config: fakeConfig() });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(byId).sort(), [
    "autoStart", "braille", "budget", "compression", "provider", "resumption", "thinking", "voice",
  ]);
  assert.equal(byId.autoStart!.currentValue, "on");
  assert.equal(byId.provider!.currentValue, "gemini");
  assert.equal(byId.thinking!.currentValue, "minimized");
  assert.equal(byId.budget!.currentValue, "standard");
  assert.equal(byId.compression!.currentValue, "on");
  assert.equal(byId.resumption!.currentValue, "on");
  assert.equal(byId.braille!.currentValue, "on");
  // voice options come from the per-provider catalog
  assert.ok(byId.voice!.values.length >= 5, "voice exposes the provider's choices");
});

test("stored preferences override config defaults in the panel", () => {
  const prefs: VoicePrefs = {
    thinking: "full",
    budget: 4096,
    autoStart: false,
    provider: "openai",
    compression: false,
    resumption: false,
    braille: false,
  };
  const rows = buildPreferences({ prefs, config: fakeConfig(), active: false });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(byId.thinking!.currentValue, "full");
  assert.equal(byId.budget!.currentValue, "deep");
  assert.equal(byId.autoStart!.currentValue, "off");
  assert.equal(byId.provider!.currentValue, "openai");
  assert.equal(byId.compression!.currentValue, "off");
  assert.equal(byId.resumption!.currentValue, "off");
  assert.equal(byId.braille!.currentValue, "off");
  // provider preference drives the voice list
  assert.equal(byId.voice!.values[0], "alloy");
});

test("parseSettingValue converts a panel label into the expected pref delta", () => {
  assert.deepEqual(parseSettingValue("thinking", "full"), { thinking: "full" });
  assert.deepEqual(parseSettingValue("thinking", "hidden"), { thinking: "hidden" });
  assert.deepEqual(parseSettingValue("budget", "deep"), { budget: 4096 });
  assert.deepEqual(parseSettingValue("autoStart", "off"), { autoStart: false });
  assert.deepEqual(parseSettingValue("provider", "openai"), { provider: "openai" });
  assert.deepEqual(parseSettingValue("compression", "on"), { compression: true });
  assert.deepEqual(parseSettingValue("braille", "off"), { braille: false });
});

test("toggleFor maps on/off to booleans", () => {
  assert.equal(toggleFor("on"), true);
  assert.equal(toggleFor("off"), false);
});