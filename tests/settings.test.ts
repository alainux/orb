import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionToggles, parseSessionToggle, type SessionPrefs } from "../src/settings.js";
import type { VoiceConfig } from "../src/types.js";

/** Minimal config-shaped object (only the catalog-consumed field is used here). */
function fakeConfig(thinkingDisplay: VoiceConfig["thinkingDisplay"]): VoiceConfig {
  return { provider: "gemini", model: "m", voice: "Kore", thinkingDisplay } as VoiceConfig;
}

test("session toggles surface ONLY the temporary reasoning-toggle row", () => {
  const rows = buildSessionToggles({ prefs: {}, config: fakeConfig("minimized") });
  assert.equal(rows.length, 1, "the panel holds only temporary toggles, not durable prefs");
  assert.deepEqual(rows[0]!.id, "thinking");
  assert.deepEqual(rows[0]!.values, ["full", "minimized", "hidden"]);
  assert.deepEqual(rows[0]!.currentValue, "minimized");
});

test("a stored session toggle overrides the config default; the default fills otherwise", () => {
  assert.deepEqual(
    buildSessionToggles({ prefs: {} as SessionPrefs, config: fakeConfig("hidden") })[0]!.currentValue,
    "hidden",
  );
  assert.deepEqual(
    buildSessionToggles({ prefs: { thinking: "full" }, config: fakeConfig("hidden") })[0]!.currentValue,
    "full",
  );
});

test("parseSessionToggle maps a selected label to the session delta", () => {
  assert.deepEqual(parseSessionToggle("thinking", "full"), { thinking: "full" });
  assert.deepEqual(parseSessionToggle("thinking", "hidden"), { thinking: "hidden" });
  assert.deepEqual(parseSessionToggle("thinking", "minimized"), { thinking: "minimized" });
  // Unknown label falls back to minimized.
  assert.deepEqual(parseSessionToggle("thinking", "wat"), { thinking: "minimized" });
});
