import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { controllerSeam, fakePi } from "./support/seams.js";
import { RunLog } from "../src/log.js";

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "orb-tool-log-cwd-"));
  const logDir = mkdtempSync(join(tmpdir(), "orb-tool-log-logs-"));
  const c = new VoiceController(fakePi());
  controllerSeam(c).config = {};
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
  controllerSeam(c).log = await RunLog.create(logDir);

  for (const name of ["bash", "read", "write", "edit", "grep", "find", "ls"]) {
    const result = await controllerSeam(c).handleToolCall({
      id: "c1",
      name,
      arguments: { path: "/tmp/x", command: "rm -rf /" },
    });
    assert.equal(Boolean(result.ok), false, `${name} must not be offered to the voice model`);
    assert.match(String(result.error), /Unknown tool/, `expected Unknown tool for ${name}`);
  }

  // None of these can ever be executed, so the durable audit never records a
  // native tool run — the voice companion has no filesystem route at all.
  const text = latestLogText(logDir);
  assert.doesNotMatch(text, /voice native tool/, "no native tool may be logged as executed");
});

test("no configuration or control tools survive: control_pi and set_voice are gone", async () => {
  const { c, logDir } = setup();
  controllerSeam(c).log = await RunLog.create(logDir);

  // The companion can only delegate, observe, and use the scratchpad. Both the
  // config/self-config knobs and the Pi-control (cancel) tool are gone.
  for (const name of ["control_pi", "set_voice", "shell", "set_thinking", "list_tools", "set_tools", "list_models", "set_model"]) {
    const result = await controllerSeam(c).handleToolCall({ id: "a1", name, arguments: {} });
    assert.equal(Boolean(result.ok), false, `${name} must be rejected`);
    assert.match(String(result.error), /Unknown tool/, `expected Unknown tool for ${name}`);
  }
});

test("read_pi_log returns the visible Pi conversation/tool results for investigation", async () => {
  const { c } = setup();
  // Feed visible Pi activity into the mirror, exactly as the real harness would.
  controllerSeam(c).recordPiEvent("agent_start", {});
  controllerSeam(c).recordPiEvent("message_end", { message: { role: "assistant", content: "The full test suite passes across the board." } });

  const result = await controllerSeam(c).handleToolCall({ id: "r1", name: "read_pi_log", arguments: { max_entries: 8 } });
  assert.equal(result.ok, true, "read_pi_log must be a recognized investigation tool, not Unknown");
  assert.equal(result.status, "working");
  assert.match(String(result.log), /The full test suite passes/);
  assert.match(String(result.log), /Pi agent started working/);
  assert.equal(typeof result.revision, "number");
});

test("durable log captures spoken turns (conversation) and orchestration tool usage", async () => {
  const { c, logDir } = setup();
  const log = await RunLog.create(logDir);
  controllerSeam(c).log = log;

  const sink = controllerSeam(c).createProviderSink();
  sink.onInputTranscript("debug the failing test", true);   // committed user turn
  sink.onOutputTranscript("Let me direct Pi to investigate it.", true); // committed orb turn
  await controllerSeam(c).handleToolCall({ id: "t1", name: "read_pi_log", arguments: { max_entries: 4 } });
  await controllerSeam(c).handleToolCall({ id: "t2", name: "observe_pi", arguments: { until: "activity", timeout_ms: 60 } });
  // Drain the append-chain deterministically (no timer guess) so this test
  // never races the event loop under CI load.
  await log.flush();

  const text = latestLogText(logDir);
  // Spoken exchange is now durable.
  assert.match(text, /conversation/);
  assert.match(text, /"speaker":"you"/);
  assert.match(text, /"speaker":"voice"/);
  assert.match(text, /debug the failing test/);
  // Orchestration tool observations are durable.
  assert.match(text, /voice tool read_pi_log/);
  assert.match(text, /voice tool observe_pi/);
});

test("voice-turn-actions logs pi_dispatches so a talk-without-delegation turn is visible", async () => {
  const { c, logDir } = setup();
  const log = await RunLog.create(logDir);
  controllerSeam(c).log = log;
  const sink = controllerSeam(c).createProviderSink();

  // A voice turn that *claims* work but delegates nothing must log
  // pi_dispatches:0 — the false-confirmation gap becomes greppable.
  sink.onInputTranscript("remove the greeting cues from the policy", true);
  sink.onOutputTranscript("Got it. Running that now.", true);

  // Drain the append-chain deterministically (no timer guess) so this test
  // never races the event loop under CI load.
  await log.flush();
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