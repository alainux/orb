import assert from "node:assert/strict";
import test from "node:test";
import { parseVoiceCommand } from "../src/commands.js";

test("voice command parser stays intentionally small", () => {
  assert.deepEqual(parseVoiceCommand(""), { action: "start" });
  assert.deepEqual(parseVoiceCommand("start openai"), { action: "start", provider: "openai" });
  assert.deepEqual(parseVoiceCommand("provider gemini"), { action: "provider", provider: "gemini" });
  assert.deepEqual(parseVoiceCommand("log"), { action: "log" });
  assert.deepEqual(parseVoiceCommand("off"), { action: "stop" });
  assert.throws(() => parseVoiceCommand("send"), /Unknown/);
  assert.throws(() => parseVoiceCommand("start invalid"));
});
