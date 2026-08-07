import assert from "node:assert/strict";
import test from "node:test";
import { mergeTranscript, safeJsonParse } from "../src/providers/util.js";

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
