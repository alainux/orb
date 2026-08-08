import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VOICE_PREFS_ENTRY, VoiceController } from "../src/controller.js";
import { controllerSeam } from "./support/seams.js";

/** A Pi stub whose `appendEntry` records every write it is asked to persist. */
function prefPi(records: Array<[string, unknown]>): ExtensionAPI {
  return { appendEntry: (type: string, data: unknown) => void records.push([type, data]) } as unknown as ExtensionAPI;
}

/** Minimal interactive-ish context with a controllable session branch. */
function branchCtx(entries: unknown[], notify: (m: string) => void = () => {}): ExtensionContext {
  return {
    cwd: "/tmp",
    hasUI: true,
    mode: "tui",
    ui: { notify, setStatus() {}, setWidget() {}, confirm: () => Promise.resolve(true) },
    sessionManager: { getBranch: () => entries },
  } as unknown as ExtensionContext;
}

test("setThinkingDisplay applies immediately and persists via a session entry, never a config file", () => {
  const records: Array<[string, unknown]> = [];
  const c = new VoiceController(prefPi(records));
  controllerSeam(c).state = { active: true, thinkingDisplay: "minimized" };
  const notify: string[] = [];
  const ctx = branchCtx([], (m) => notify.push(m));

  c.setThinkingDisplay("full", ctx);

  // Applied to the live view-model for instant re-derive.
  assert.equal(c.thinkingDisplayPref, "full");
  // Persisted to the Pi session tree (canonical appendEntry pattern)…
  assert.deepEqual(records, [[VOICE_PREFS_ENTRY, { thinkingDisplay: "full" }]]);
  // …with the canonical payload shape, exactly one entry.
  assert.equal(records.length, 1);
  // A system row + notify was surfaced for the user.
  assert.ok(notify.some((m) => m.includes("full thoughts")));
});

test("cycleThinkingDisplay rotates minimized → full → hidden and persists each step", () => {
  const records: Array<[string, unknown]> = [];
  const c = new VoiceController(prefPi(records));
  controllerSeam(c).state = { active: true, thinkingDisplay: "minimized" };
  const reset = () => { records.length = 0; };

  c.cycleThinkingDisplay(branchCtx([]));
  assert.equal(c.thinkingDisplayPref, "full");
  assert.deepEqual(records.at(-1), [VOICE_PREFS_ENTRY, { thinkingDisplay: "full" }]);
  reset();

  c.cycleThinkingDisplay(branchCtx([]));
  assert.equal(c.thinkingDisplayPref, "hidden");
  reset();

  c.cycleThinkingDisplay(branchCtx([]));
  assert.equal(c.thinkingDisplayPref, "minimized");
});

test("restoreThinkingPref restores the newest matching entry from the branch, silently", () => {
  const records: Array<[string, unknown]> = [];
  const c = new VoiceController(prefPi(records));
  controllerSeam(c).state = { active: false, thinkingDisplay: "minimized" };

  const branch = [
    { type: "message", message: { role: "assistant" } },
    { type: "custom", customType: VOICE_PREFS_ENTRY, data: { thinkingDisplay: "full" } },
    { type: "tool_call", toolName: "run" },
    { type: "custom", customType: VOICE_PREFS_ENTRY, data: { thinkingDisplay: "hidden" } },
    { type: "custom", customType: "some-other-ext", data: {} },
  ];
  c.restoreThinkingPref(branchCtx(branch));

  // Newest orb-prefs entry wins; the restore is applied but not re-persisted.
  assert.equal(c.thinkingDisplayPref, "hidden");
  assert.equal(records.length, 0, "restore must not write a new entry");
});