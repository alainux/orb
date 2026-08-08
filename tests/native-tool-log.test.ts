import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AgentToolbox } from "../src/agent-tools.js";
import { VoiceController, nativeToolLabel } from "../src/controller.js";
import { RunLog } from "../src/log.js";
import type { OrbPermissions } from "../src/types.js";

function setup() {
  const cwd = mkdtempSync(join(tmpdir(), "orb-native-log-cwd-"));
  const logDir = mkdtempSync(join(tmpdir(), "orb-native-log-logs-"));
  const permissions: OrbPermissions = { nativeTools: true } as any;
  const c = new VoiceController({} as any);
  (c as any).config = {};
  (c as any).agentTools = new AgentToolbox(cwd, permissions);
  return { c, cwd, logDir };
}

function latestLogText(logDir: string): string {
  const session = readdirSync(logDir)
    .filter((n) => n.startsWith("session-") && n.endsWith(".log"))
    .sort()[0];
  return readFileSync(join(logDir, session!), "utf8");
}

test("native write tool is durably logged with tool, sanitized args, and ok outcome", async () => {
  const { c, logDir } = setup();
  (c as any).log = await RunLog.create(logDir);

  const target = join(join(tmpdir(), "orb-native-log-cwd-blank"), "out.txt");
  const largeContent = "A".repeat(10_000);

  const result = await (c as any).handleToolCall({
    id: "c1",
    name: "write",
    arguments: { path: target, content: largeContent },
  });
  assert.equal(result.ok, true);

  const text = latestLogText(logDir);
  assert.match(text, /voice native tool/);
  assert.match(text, /"tool":"write"/);
  assert.match(text, /"file"/);
  assert.match(text, /out\.txt/);
  assert.match(text, /"ok":true/);
  // Sanitization: the full 10k-char content must never be written verbatim.
  assert.ok(!text.includes(largeContent), "full file content must not be logged");
  assert.match(text, /\(10000 chars\)/);
});

test("file-reading tools log the accessed path prominently as `file`", async () => {
  const { c, cwd, logDir } = setup();
  (c as any).log = await RunLog.create(logDir);

  const target = join(cwd, "notes.txt");
  writeFileSync(target, "hello world\n");

  const result = await (c as any).handleToolCall({
    id: "c2",
    name: "read",
    arguments: { path: target, offset: 0, limit: 5 },
  });
  assert.equal(result.ok, true);

  const text = latestLogText(logDir);
  assert.match(text, /voice native tool/);
  assert.match(text, /"tool":"read"/);
  // The path appears as a top-level `file` field, before the nested arguments.
  const line = text.split("\n").find((l) => l.includes("voice native tool"))!;
  const fileIdx = line.indexOf('"file"');
  const argsIdx = line.indexOf('"arguments"');
  assert.ok(fileIdx !== -1, "expected a top-level file field");
  assert.ok(fileIdx < argsIdx, "file should precede nested arguments");
  assert.ok(line.includes(target), "full file path present in log");
});

test("native read of a missing file is logged as ok:false with the error", async () => {
  const { c, logDir } = setup();
  (c as any).log = await RunLog.create(logDir);

  const result = await (c as any).handleToolCall({
    id: "c2",
    name: "read",
    arguments: { path: join(tmpdir(), "definitely-missing-orb-file-xyz.txt") },
  });
  assert.equal(result.ok, false);

  const text = latestLogText(logDir);
  assert.match(text, /"tool":"read"/);
  assert.match(text, /"ok":false/);
});
test("panel label uses a small file name for file tools", () => {
  assert.equal(
    nativeToolLabel({ id: "p1", name: "read", arguments: { path: "/home/user/src/a/b/notes.txt", limit: 5 } }),
    "notes.txt",
  );
  // Fallback when no path is supplied.
  assert.equal(nativeToolLabel({ id: "p2", name: "read", arguments: {} }), "read file");
  assert.equal(
    nativeToolLabel({ id: "p3", name: "edit", arguments: { path: "docs/CONFIGURATION.md" } }),
    "CONFIGURATION.md",
  );
  // bash still summarizes the command, not a file.
  assert.equal(nativeToolLabel({ id: "p4", name: "bash", arguments: { command: "npm test" } }), "npm test");
});

test("cleanup native-tool-log temp dirs", () => {
  for (const pat of ["orb-native-log-cwd-", "orb-native-log-logs-", "orb-native-log-write-"]) {
    for (const dir of readdirSync(tmpdir()).filter((n) => n.startsWith(pat))) {
      rmSync(join(tmpdir(), dir), { recursive: true, force: true });
    }
  }
});
test("durable log captures spoken turns (conversation) and Pi activity/tool usage", async () => {
  const { c, cwd, logDir } = setup();
  (c as any).log = await RunLog.create(logDir);
  (c as any).agentTools = new AgentToolbox(cwd, { nativeTools: true } as any);

  const sink = (c as any).createProviderSink();
  sink.onInputTranscript("debug the failing test", true);   // committed user turn
  sink.onOutputTranscript("On it.", true);                  // committed orb turn
  await (c as any).handleToolCall({ id: "t1", name: "read_pi_log", arguments: { max_entries: 4 } });
  await (c as any).handleToolCall({ id: "t2", name: "observe_pi", arguments: { until: "activity", timeout_ms: 60 } });
  // Let the RunLog append-chain flush before we read back the file.
  await new Promise((r) => setTimeout(r, 80));

  const text = latestLogText(logDir);
  // Spoken exchange is now durable.
  assert.match(text, /conversation/);
  assert.match(text, /"speaker":"you"/);
  assert.match(text, /"speaker":"voice"/);
  assert.match(text, /debug the failing test/);
  assert.match(text, /On it/);
  // Tool input/observations are durable.
  assert.match(text, /voice tool read_pi_log/);
  assert.match(text, /voice tool observe_pi/);
});
