import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentToolbox, CODING_TOOL_NAMES, geminiCodingTools, openAICodingTools } from "../src/agent-tools.js";
import type { OrbPermissions } from "../src/types.js";

const perms = (nativeTools: boolean): OrbPermissions => ({
  cancelPi: true, setModel: true, setThinking: true, setTools: true, shell: true, nativeTools,
  scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false,
});

test("exposes only the read-only native coding tool", () => {
  assert.deepEqual([...CODING_TOOL_NAMES], ["read"]);
  for (const name of CODING_TOOL_NAMES) assert.equal(AgentToolbox.isCodingTool(name), true);
  // The direct project-mutation / search tools are no longer offered.
  for (const removed of ["bash", "write", "edit", "grep", "find", "ls"]) {
    assert.equal(AgentToolbox.isCodingTool(removed), false, `${removed} must not be a coding tool`);
  }
  assert.equal(AgentToolbox.isCodingTool("run_pi_task"), false);
  assert.equal(AgentToolbox.isCodingTool("observe_pi"), false);
  assert.equal(AgentToolbox.isCodingTool("scratchpad"), false);
});

test("enabled() reflects the nativeTools permission", () => {
  assert.equal(new AgentToolbox("/tmp", perms(true)).enabled(), true);
  assert.equal(new AgentToolbox("/tmp", perms(false)).enabled(), false);
});

test("refuses to run when nativeTools is disabled", async () => {
  const toolbox = new AgentToolbox("/tmp", perms(false));
  const result = await toolbox.run("read", "c1", {});
  assert.equal(result.ok, false);
  assert.ok("error" in result && /nativeTools/.test(result.error as string));
});

test("removed direct tools are not executable through the toolbox", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-native-none-"));
  try {
    const toolbox = new AgentToolbox(dir, perms(true));
    for (const removed of ["bash", "write", "edit", "grep", "find", "ls"]) {
      const result = await toolbox.run(removed, "c1", {});
      assert.equal(result.ok, false, `${removed} should not be executable`);
      assert.match(result.error as string, /not available/, `${removed} must be unreachable`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runs pi's real read tool against a temp project", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-native-"));
  try {
    writeFileSync(join(dir, "hello.txt"), "line one\nline two\n");
    const toolbox = new AgentToolbox(dir, perms(true));

    const read = await toolbox.run("read", "c2", { path: "hello.txt" });
    assert.equal(read.ok, true);
    if (read.ok) assert.ok(read.output.includes("line one"));

    const missing = await toolbox.run("read", "c4", { path: "nope.txt" });
    assert.equal(missing.ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scaffolds openai and gemini schemas for the read-only native tool", () => {
  const oa = openAICodingTools();
  assert.deepEqual(oa.map((t) => t.name).sort(), [...CODING_TOOL_NAMES].sort());
  for (const t of oa) {
    assert.equal(t.type, "function");
    assert.equal(typeof t.description, "string");
    assert.ok((t.parameters as { properties?: unknown }).properties);
  }
  // Derived from pi's authoritative definitions: exact name + param shape.
  const read = oa.find((t) => t.name === "read") as { parameters: { required?: string[]; properties: Record<string, { type?: string }> } };
  assert.deepEqual(read.parameters.required, ["path"]);
  assert.deepEqual(Object.keys(read.parameters.properties).sort(), ["limit", "offset", "path"]);

  const gem = geminiCodingTools();
  assert.deepEqual(gem.map((t) => t.name).sort(), [...CODING_TOOL_NAMES].sort());
  for (const t of gem) {
    assert.equal((t.parameters as any).type, "OBJECT");
  }
  const gemRead = gem.find((t) => t.name === "read") as any;
  assert.equal(gemRead.parameters.properties.path.type, "STRING");
  assert.equal(gemRead.parameters.properties.offset.type, "NUMBER");
});