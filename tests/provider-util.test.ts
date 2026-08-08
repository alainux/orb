import assert from "node:assert/strict";
import test from "node:test";
import { buildEnvironmentContext, markSeenCall, mergeTranscript, safeJsonParse, toError } from "../src/providers/util.js";
import type { VoiceSessionContext } from "../src/types.js";

const ctx: VoiceSessionContext = {
  cwd: "/proj",
  piStatus: "working",
  recentPiActivity: "line1\nline2",
};

test("transcript fragments merge without repeated prefixes", () => {
  assert.equal(mergeTranscript("hello", "hello world"), "hello world");
  assert.equal(mergeTranscript("hello", "world"), "hello world");
  assert.equal(mergeTranscript("hello world", "world"), "hello world");
});

test("tool argument JSON is defensive", () => {
  assert.deepEqual(safeJsonParse('{"content":"x"}'), { content: "x" });
  assert.deepEqual(safeJsonParse("not-json"), {});
  assert.deepEqual(safeJsonParse("[]"), {});
});

test("toError normalizes non-Error throws and passes Errors through", () => {
  const err = new Error("boom");
  assert.equal(toError(err), err);
  assert.equal(toError("oops").message, "oops");
  assert.equal(toError(undefined).message, "undefined");
  assert.ok(toError({ code: 5 }) instanceof Error);
});

test("buildEnvironmentContext renders the shared PI preamble", () => {
  const out = buildEnvironmentContext(ctx);
  assert.ok(out.startsWith("PI_CODING_CONTEXT"));
  assert.ok(out.includes("Project cwd: /proj"));
  assert.ok(out.includes("Pi status: working"));
  assert.ok(out.includes("line1\nline2"));
});

test("markSeenCall dedups ids and caps the set, never tracks empty ids", () => {
  const set = new Set<string>();
  assert.equal(markSeenCall(set, "a"), false);
  assert.equal(markSeenCall(set, "a"), true, "duplicate is reported");
  assert.equal(markSeenCall(set, ""), false, "empty id is never a duplicate");
  assert.equal(markSeenCall(set, ""), false);
  assert.equal(set.has(""), false);
  // Fill past the cap on a clean set: oldest entry is evicted, newest stays.
  const capped = new Set<string>();
  for (let i = 0; i <= 256; i++) markSeenCall(capped, String(i));
  assert.equal(capped.size, 256);
  assert.equal(markSeenCall(capped, "1"), true, "latest still present");
  assert.equal(markSeenCall(capped, "0"), false, "oldest evicted, reusable");
});
