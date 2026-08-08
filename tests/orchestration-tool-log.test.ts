import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { RunLog } from "../src/log.js";

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "orb-tool-log-cwd-"));
  const logDir = mkdtempSync(join(tmpdir(), "orb-tool-log-logs-"));
  const c = new VoiceController({} as any);
  (c as any).config = {};
  return { c, cwd, logDir };
}

function latestLogText(logDir: string): string {
  const session = readdirSync(logDir)
    .filter((n) => n.startsWith("session-") && n.endsWith(".log"))
    .sort()[0];
  return readFileSync(join(logDir, session!), "utf8");
}

test("every direct project tool (bash/read/write/edit/grep/find/ls) is rejected as unknown", async () => {
  const { c, logDir } = setup();
  (c as any).log = await RunLog.create(logDir);

  for (const name of ["bash", "read", "write", "edit", "grep", "find", "ls"]) {
    const result = await (c as any).handleToolCall({
      id: "c1",
      name,
      arguments: { path: "/tmp/x", command: "rm -rf /" },
    });
    assert.equal(result.ok, false, `${name} must not be offered to the voice model`);
    assert.match(result.error, /Unknown tool/, `expected Unknown tool for ${name}`);
  }

  // None of these can ever be executed, so the durable audit never records a
  // native tool run — the voice companion has no filesystem route at all.
  const text = latestLogText(logDir);
  assert.doesNotMatch(text, /voice native tool/, "no native tool may be logged as executed");
});

test("durable log captures spoken turns (conversation) and orchestration tool usage", async () => {
  const { c, logDir } = setup();
  (c as any).log = await RunLog.create(logDir);

  const sink = (c as any).createProviderSink();
  sink.onInputTranscript("debug the failing test", true);   // committed user turn
  sink.onOutputTranscript("Let me direct Pi to investigate it.", true); // committed orb turn
  await (c as any).handleToolCall({ id: "t1", name: "read_pi_log", arguments: { max_entries: 4 } });
  await (c as any).handleToolCall({ id: "t2", name: "observe_pi", arguments: { until: "activity", timeout_ms: 60 } });
  // Let the RunLog append-chain flush before reading the file back.
  await new Promise((r) => setTimeout(r, 80));

  const text = latestLogText(logDir);
  // Spoken exchange is now durable.
  assert.match(text, /conversation/);
  assert.match(text, /"speaker":"you"/);
  assert.match(text, /"speaker":"voice"/);
  assert.match(text, /debug the failing test/);
  // Orchestration tool input/observations are durable.
  assert.match(text, /voice tool read_pi_log/);
  assert.match(text, /voice tool observe_pi/);
});

test("voice-turn-actions logs pi_dispatches so a talk-without-delegation turn is visible", async () => {
  const { c, logDir } = setup();
  (c as any).log = await RunLog.create(logDir);
  const sink = (c as any).createProviderSink();

  // A voice turn that *claims* work but delegates nothing must log
  // pi_dispatches:0 — the false-confirmation gap becomes greppable.
  sink.onInputTranscript("remove the greeting cues from the policy", true);
  sink.onOutputTranscript("Got it. Running that now.", true);

  await new Promise((r) => setTimeout(r, 80));
  const text = latestLogText(logDir);

  const lines = text.split("\n").filter((l) => l.includes("voice-turn-actions"));
  assert.ok(lines.length >= 1, "expected a voice-turn-actions line per voice turn");
  assert.match(text, /"pi_dispatches":0/);
  // The companion has no native tools anymore, so there is no empirical `tools`.
  assert.doesNotMatch(text, /voice-turn-actions[^\n]*"tools"/, "native tool telemetry was removed");
});

test("cleanup tool-log temp dirs", () => {
  for (const pat of ["orb-tool-log-cwd-", "orb-tool-log-logs-"]) {
    for (const dir of readdirSync(tmpdir()).filter((n) => n.startsWith(pat))) {
      rmSync(join(tmpdir(), dir), { recursive: true, force: true });
    }
  }
});