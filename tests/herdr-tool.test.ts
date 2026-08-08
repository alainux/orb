/**
 * Hermetic tests for the `read_herdr_pane` voice tool and its backing module.
 *
 * We never shell out to a real herdr here — instead a tiny shim is written to
 * a temp dir and pointed at via `HERDR_BIN`. That lets us assert exactly which
 * flags the wrapper passes to `herdr pane read` (notably the default
 * `--source recent-unwrapped --lines 120`) and the "herdr not installed" path,
 * all without depending on herdr being present or a live server running.
 */

import assert from "node:assert/strict";
import { chmodSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { controllerSeam, fakePi } from "./support/seams.js";
import {
  listHerdrPanes,
  readHerdrPane,
  resolveHerdrBinary,
  HERDR_DEFAULT_LINES,
} from "../src/herdr.js";
import { geminiOrchestrationTools, openAIOrchestrationTools } from "../src/orchestration-tools.js";

const FAKE_BIN = `#!/bin/sh
set -e
if [ "$1" = "pane" ] && [ "$2" = "list" ]; then
  echo '{"id":"cli:pane:list","result":{"panes":[{"pane_id":"w1:p1","tab_id":"w1:t1","workspace_id":"w1","agent":"codex","cwd":"/tmp/proj","terminal_title":"codex · proj","terminal_title_stripped":"codex proj"},{"pane_id":"w1:p2","agent":"pi","terminal_title_stripped":"pi worker"}]}}'
  exit 0
fi
if [ "$1" = "pane" ] && [ "$2" = "read" ]; then
  id="$3"; lines="$7"
  echo "mapped ($id) source=$5 lines=$lines"
  echo "LOG     line one of the pane log"
  echo "LOG     line two of the pane log"
  exit 0
fi
echo '{"error":"unknown subcommand"}' >&2
exit 1
`;

let fakeDir: string | undefined;

test.before(() => {
  fakeDir = mkdtempSync(join(tmpdir(), "orb-fake-herdr-"));
  const bin = join(fakeDir, "herdr-fake");
  writeFileSync(bin, FAKE_BIN);
  chmodSync(bin, 0o755);
  process.env.HERDR_BIN = bin;
});

test.after(() => {
  delete process.env.HERDR_BIN;
  if (fakeDir) rmSync(fakeDir, { recursive: true, force: true });
});

test("resolveHerdrBinary honors the HERDR_BIN override", async () => {
  assert.equal(process.env.HERDR_BIN, join(fakeDir!, "herdr-fake"));
  assert.equal(await resolveHerdrBinary(), join(fakeDir!, "herdr-fake"));
});

test("listBases herdr panes into a structured catalog", async () => {
  const res = await listHerdrPanes();
  assert.equal(res.ok, true);
  assert.equal(res.installed, true);
  assert.equal(res.panes.length, 2);
  assert.equal(res.panes[0]!.pane_id, "w1:p1");
  assert.equal(res.panes[0]!.agent, "codex");
  assert.equal(res.panes[0]!.cwd, "/tmp/proj");
  assert.equal(res.panes[1]!.pane_id, "w1:p2");
  // Fields that are absent must simply be omitted (no false strings).
  assert.equal(res.panes[1]!.tab_id, undefined);
  // Human-readable titles: plain title on p1; p2 falls back to the stripped name.
  assert.equal(res.panes[0]!.terminal_title, "codex · proj");
  assert.equal(res.panes[1]!.terminal_title, "pi worker");
});

test("readHerdrPane defaults to recent-unwrapped source and 120 lines", async () => {
  const res = await readHerdrPane("w1:p1");
  assert.equal(res.ok, true);
  assert.equal(res.installed, true);
  assert.equal(res.source, "recent-unwrapped");
  assert.equal(res.lines, HERDR_DEFAULT_LINES);
  // The wrapper passed the exact flags the shim echoed back.
  assert.match(res.log, /source=recent-unwrapped/);
  assert.match(res.log, /lines=120/);
  // And the pane log content flows through.
  assert.match(res.log, /line one of the pane log/);
  assert.match(res.log, /line two of the pane log/);
  assert.equal(res.truncated, false);
});

test("readHerdrPane honors explicit source and lines", async () => {
  const res = await readHerdrPane("w1:p9", { source: "visible", lines: 40 });
  assert.equal(res.ok, true);
  assert.equal(res.source, "visible");
  assert.equal(res.lines, 40);
  assert.match(res.log, /source=visible/);
  assert.match(res.log, /lines=40/);
});

test("readHerdrPane clips lines to a safe 1..max range", async () => {
  const res = await readHerdrPane("w1:p1", { lines: 99999 });
  assert.equal(res.lines, 2000, "capped at the documented max");
  const min = await readHerdrPane("w1:p1", { lines: 0 });
  assert.equal(min.lines, 1, "bottomed at one line");
});

test("herdr-not-installed is surfaced distinctly (not a generic failure)", async () => {
  const original = process.env.HERDR_BIN;
  process.env.HERDR_BIN = join(fakeDir!, "does-not-exist");
  try {
    const listed = await listHerdrPanes();
    assert.equal(listed.ok, false);
    assert.equal(listed.installed, false);
    assert.match(String(listed.error), /not installed/);

    const read = await readHerdrPane("w1:p1");
    assert.equal(read.ok, false);
    assert.equal(read.installed, false);
    assert.match(String(read.error), /not installed/);
  } finally {
    process.env.HERDR_BIN = original;
  }
});

test("read_herdr_pane is registered for BOTH providers", async () => {
  const inCatalog = (defs: Array<Record<string, unknown>>) =>
    defs.some((d) => d.name === "read_herdr_pane");
  assert.ok(inCatalog(await openAIOrchestrationTools()), "OpenAI Realtime exposes read_herdr_pane");
  assert.ok(inCatalog(await geminiOrchestrationTools()), "Gemini Live exposes read_herdr_pane");
});

test("read_herdr_pane registration degrades silently when herdr is absent", async () => {
  const original = process.env.HERDR_BIN;
  process.env.HERDR_BIN = join(fakeDir!, "missing-herdr");
  const has = (defs: Array<Record<string, unknown>>) =>
    defs.some((d) => d.name === "read_herdr_pane");
  try {
    // Neither provider registration throws, and the tool is simply omitted.
    const openai = await openAIOrchestrationTools();
    const gemini = await geminiOrchestrationTools();
    assert.equal(has(openai), false, "OpenAI Realtime omits read_herdr_pane without throwing");
    assert.equal(has(gemini), false, "Gemini Live omits read_herdr_pane without throwing");
  } finally {
    process.env.HERDR_BIN = original;
  }
});

test("controller dispatch: no pane_id lists panes; pane_id returns the read log", async () => {
  const msc = new VoiceController(fakePi());
  const ctrl = controllerSeam(msc);

  // No pane_id -> hands back the pane catalog for the agent to choose from.
  const listed = await ctrl.handleToolCall({ id: "h1", name: "read_herdr_pane", arguments: {} });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.action, "list");
  assert.ok(Array.isArray(listed.panes));
  assert.equal((listed.panes as Array<{ pane_id: string }>)[0]!.pane_id, "w1:p1");
  // Every pane exposes a human-readable name so the model can pick by title.
  const first = (listed.panes as Array<{ pane_id: string; terminal_title: string | undefined }>)[0]!;
  assert.equal(first.terminal_title, "codex · proj");

  // With a pane_id -> returns the recent-unwrapped log text.
  const read = await ctrl.handleToolCall({
    id: "h2",
    name: "read_herdr_pane",
    arguments: { pane_id: "w1:p1" },
  });
  assert.equal(read.ok, true);
  assert.equal(read.pane_id, "w1:p1");
  assert.equal(read.source, "recent-unwrapped");
  assert.match(String(read.log), /line one of the pane log/);

  // Unknown tools remain rejected (no accidental native surface).
  const unknown = await ctrl.handleToolCall({ id: "h3", name: "bash", arguments: { command: "x" } });
  assert.equal(unknown.ok, false);
  assert.match(String(unknown.error), /Unknown tool/);
});

test("clean up fake-herdr temp dirs", () => {
  if (fakeDir) {
    rmSync(fakeDir, { recursive: true, force: true });
    fakeDir = undefined;
    delete process.env.HERDR_BIN;
  }
});