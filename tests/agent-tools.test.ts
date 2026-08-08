import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentToolbox, CODING_TOOL_NAMES, geminiCodingTools, openAICodingTools } from "../src/agent-tools.js";
import type { OrbPermissions } from "../src/types.js";

const perms = (nativeTools: boolean): OrbPermissions => ({
  cancelPi: true, setModel: true, setThinking: true, setTools: true, shell: true, nativeTools,
  scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false,
});

test("exposes the seven native coding tool names", () => {
  assert.deepEqual([...CODING_TOOL_NAMES], ["bash", "read", "write", "edit", "grep", "find", "ls"]);
  for (const name of CODING_TOOL_NAMES) assert.equal(AgentToolbox.isCodingTool(name), true);
  assert.equal(AgentToolbox.isCodingTool("run_pi_task"), false);
  assert.equal(AgentToolbox.isCodingTool("scratchpad"), false);
});

test("enabled() reflects the nativeTools permission", () => {
  assert.equal(new AgentToolbox("/tmp", perms(true)).enabled(), true);
  assert.equal(new AgentToolbox("/tmp", perms(false)).enabled(), false);
});

test("refuses to run when nativeTools is disabled", async () => {
  const toolbox = new AgentToolbox("/tmp", perms(false));
  const result = await toolbox.run("ls", "c1", {});
  assert.equal(result.ok, false);
  assert.ok("error" in result && /nativeTools/.test(result.error));
});

test("runs pi's real read/ls/bash tools against a temp project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-native-"));
  try {
    writeFileSync(join(dir, "hello.txt"), "line one\nline two\n");
    const toolbox = new AgentToolbox(dir, perms(true));

    const ls = await toolbox.run("ls", "c1", {});
    assert.equal(ls.ok, true);
    if (ls.ok) assert.ok(ls.output.includes("hello.txt"));

    const read = await toolbox.run("read", "c2", { path: "hello.txt" });
    assert.equal(read.ok, true);
    if (read.ok) assert.ok(read.output.includes("line one"));

    const bash = await toolbox.run("bash", "c3", { command: "echo orb-native-test" });
    assert.equal(bash.ok, true);
    if (bash.ok) assert.ok(bash.output.includes("orb-native-test"));

    const missing = await toolbox.run("read", "c4", { path: "nope.txt" });
    assert.equal(missing.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("write then edit performs a mutation on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-native-edit-"));
  try {
    const toolbox = new AgentToolbox(dir, perms(true));
    const absPath = join(dir, "note.md");
    const w2 = await toolbox.run("write", "c2", { path: absPath, content: "alpha beta\ngamma\n" });
    assert.equal(w2.ok, true);
    assert.ok(existsSync(absPath));

    const edited = await toolbox.run("edit", "c3", { path: absPath, edits: [{ oldText: "gamma", newText: "delta" }] });
    assert.equal(edited.ok, true);

    const reread = await toolbox.run("read", "c4", { path: absPath });
    assert.equal(reread.ok, true);
    if (reread.ok) {
      assert.ok(reread.output.includes("delta"));
      assert.ok(!reread.output.includes("gamma"));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffolds openai and gemini tool schemas for all native tools", () => {
  const oa = openAICodingTools();
  assert.deepEqual(oa.map((t) => t.name).sort(), [...CODING_TOOL_NAMES].sort());
  for (const t of oa) {
    assert.equal(t.type, "function");
    assert.equal(typeof t.description, "string");
    assert.ok((t.parameters as { properties?: unknown[] }).properties);
  }
  // Derived from pi's authoritative definitions: exact names + param shapes.
  const read = oa.find((t) => t.name === "read") as { parameters: { required?: string[]; properties: Record<string, { type?: string }> } };
  assert.deepEqual(read.parameters.required, ["path"]);
  assert.deepEqual(Object.keys(read.parameters.properties).sort(), ["limit", "offset", "path"]);
  const bash = oa.find((t) => t.name === "bash") as { parameters: { required: string[] } };
  assert.deepEqual(bash.parameters.required, ["command"]);

  const gem = geminiCodingTools();
  assert.deepEqual(gem.map((t) => t.name).sort(), [...CODING_TOOL_NAMES].sort());
  for (const t of gem) {
    assert.equal((t.parameters as any).type, "OBJECT");
  }
  const gemRead = gem.find((t) => t.name === "read") as any;
  assert.equal(gemRead.parameters.properties.path.type, "STRING");
  assert.equal(gemRead.parameters.properties.offset.type, "NUMBER");
  const gemEdit = gem.find((t) => t.name === "edit") as any;
  assert.equal(gemEdit.parameters.properties.edits.type, "ARRAY");
  assert.equal(gemEdit.parameters.properties.edits.items.properties.oldText.type, "STRING");
});