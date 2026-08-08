import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { VoiceController } from "../src/controller.js";
import { controllerSeam, fakePi } from "./support/seams.js";

/** Minimal interactive-ish context capturing notifications. */
function ctx(notify?: (m: string) => void): ExtensionContext {
  return {
    cwd: "/tmp",
    hasUI: true,
    mode: "tui",
    ui: { notify: notify ?? (() => {}), setStatus() {}, setWidget() {}, confirm: () => Promise.resolve(true) },
  } as unknown as ExtensionContext;
}

/** A Pi that records any attempt to `appendEntry` (there should be none). */
function recordPi(records: Array<[string, unknown]>): ExtensionAPI {
  return { appendEntry: (type: string, data: unknown) => void records.push([type, data]) } as unknown as ExtensionAPI;
}

test("the reasoning display honors the single `ui.thinkingDisplay` config option", () => {
  const c = new VoiceController(fakePi());
  controllerSeam(c).config = { provider: "gemini", model: "m", voice: "Kore", thinkingDisplay: "hidden" };
  assert.equal(c.thinkingDisplayPref, "hidden");
});

test("defaults to minimized when the config option is absent", () => {
  const c = new VoiceController(fakePi());
  controllerSeam(c).config = {};
  assert.equal(c.thinkingDisplayPref, "minimized");
});

test("setThinkingDisplay rewrites the config option for the session only — never a session entry or config file", () => {
  const records: Array<[string, unknown]> = [];
  const c = new VoiceController(recordPi(records));
  controllerSeam(c).config = {};
  controllerSeam(c).state = { active: true, thinkingDisplay: "minimized" };
  const notify: string[] = [];
  c.setThinkingDisplay("full", ctx((m) => notify.push(m)));

  // Honored immediately as the same config field + view-model.
  assert.equal(c.thinkingDisplayPref, "full");
  assert.equal(controllerSeam(c).config.thinkingDisplay, "full");
  assert.equal(controllerSeam(c).state.thinkingDisplay, "full");
  assert.ok(notify.some((m) => m.includes("full thoughts")));
  // The whole point: no session-entry persistence, so nothing is written anywhere.
  assert.deepEqual(records, [], "toggling is internal to the session; no session entry is appended");
});

test("cycleThinkingDisplay rotates minimized → full → hidden by editing the same field", () => {
  const c = new VoiceController(fakePi());
  controllerSeam(c).config = { provider: "gemini", model: "k", voice: "Kore", thinkingDisplay: "minimized" };
  c.cycleThinkingDisplay(ctx());
  assert.equal(c.thinkingDisplayPref, "full");
  c.cycleThinkingDisplay(ctx());
  assert.equal(c.thinkingDisplayPref, "hidden");
  c.cycleThinkingDisplay(ctx());
  assert.equal(c.thinkingDisplayPref, "minimized");
});
