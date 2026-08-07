import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceCommand } from "../src/commands.js";

test("voice command parser supports session and scratchpad controls", () => {
  assert.deepEqual(parseVoiceCommand(""), { action: "start" });
  assert.deepEqual(parseVoiceCommand("start openai"), { action: "start", provider: "openai" });
  assert.deepEqual(parseVoiceCommand("provider gemini"), { action: "provider", provider: "gemini" });
  assert.deepEqual(parseVoiceCommand("log"), { action: "log" });
  assert.deepEqual(parseVoiceCommand("off"), { action: "stop" });
  assert.deepEqual(parseVoiceCommand("scratchpad"),{action:"scratchpad",scratchpadAction:"open",argument:""});
  assert.deepEqual(parseVoiceCommand("pad load TODO.md"),{action:"scratchpad",scratchpadAction:"load",argument:"TODO.md"});
  assert.deepEqual(parseVoiceCommand("scratchpad save notes/plan.md"),{action:"scratchpad",scratchpadAction:"save",argument:"notes/plan.md"});
  assert.throws(() => parseVoiceCommand("send"), /Unknown/);
  assert.throws(() => parseVoiceCommand("start invalid"));
});
