import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { Scratchpad } from "../src/scratchpad.js";

/**
 * Build a fake TUI extension context. `ui.custom` records overlay requests and,
 * like the real TUI, invokes `onHandle` with a fake handle whose `hide()` is
 * recorded so tests can assert the overlay is programmatically dismissed.
 */
function makeRecordCtx(mode = "tui") {
  const customCalls: Array<{ overlay?: boolean; overlayOptions?: { anchor?: string } }> = [];
  const hides: number[] = [];
  const handle = {
    hide: () => hides.push(1),
    focus: () => {},
  };
  const ctx: any = {
    hasUI: true,
    mode,
    cwd: "/tmp",
    ui: {
      custom: async (_factory: unknown, options: any = {}) => {
        customCalls.push(options);
        if (typeof options.onHandle === "function") options.onHandle(handle);
        return "dismissed";
      },
      notify: () => {},
    },
  };
  return { ctx, customCalls, hides };
}

function makeController(dir: string) {
  const c = new VoiceController({} as any);
  (c as any).scratchpad = new Scratchpad(dir, { maxBytes: 1_000_000 } as any, false);
  (c as any).config = {} as any;
  return c;
}

function args(action: string, extra: Record<string, unknown> = {}) {
  return { name: "scratchpad", id: "c1", arguments: { action, ...extra } };
}

test("scratchpad tool 'open' surfaces the scratchpad as a focusable overlay in TUI mode", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-tool-open-"));
  try {
    const { ctx, customCalls } = makeRecordCtx();
    const c = makeController(dir);
    (c as any).ctx = ctx;
    const result = await (c as any).toolScratchpad(args("open", { title: "plan" }));
    assert.equal(result.ok, true);
    assert.equal((c as any).scratchpad.snapshot().open, true);
    assert.equal(customCalls.length, 1, "expected the viewer overlay to be opened");
    assert.equal(customCalls[0]?.overlay, true);
    assert.equal(customCalls[0]?.overlayOptions?.anchor, "right-center");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scratchpad tool 'view' also opens the overlay and marks the pad open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-tool-view-"));
  try {
    const { ctx, customCalls } = makeRecordCtx();
    const c = makeController(dir);
    (c as any).ctx = ctx;
    const result = await (c as any).toolScratchpad(args("view"));
    assert.equal(result.ok, true);
    assert.equal((c as any).scratchpad.snapshot().open, true);
    assert.equal(customCalls.length, 1, "expected the viewer overlay to be opened");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scratchpad tool 'open' does NOT open an overlay when TUI mode is unavailable", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-tool-rpc-"));
  try {
    const { ctx, customCalls } = makeRecordCtx("rpc");
    const c = makeController(dir);
    (c as any).ctx = ctx;
    const result = await (c as any).toolScratchpad(args("open"));
    assert.equal(result.ok, true);
    assert.equal((c as any).scratchpad.snapshot().open, true);
    assert.equal(customCalls.length, 0, "expected no overlay attempt outside TUI");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scratchpad tool 'close' dismisses the open viewer overlay and clears the pad", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-tool-close-"));
  try {
    const { ctx, customCalls, hides } = makeRecordCtx();
    const c = makeController(dir);
    (c as any).ctx = ctx;
    await (c as any).toolScratchpad(args("open"));
    assert.equal(customCalls.length, 1);
    assert.equal(hides.length, 0, "overlay should still be up after open");
    const result = await (c as any).toolScratchpad(args("close"));
    assert.equal(result.ok, true);
    assert.equal((c as any).scratchpad.snapshot().open, false, "pad should be closed");
    assert.equal(hides.length, 1, "expected the overlay to be hidden by close");
    // The guard flag must reset so a later open can show it again.
    await (c as any).toolScratchpad(args("open"));
    assert.equal(customCalls.length, 2, "expected a re-open to be allowed after close");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scratchpad tool 'close' is safe when no viewer is open", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-tool-close-none-"));
  try {
    const { ctx, hides } = makeRecordCtx();
    const c = makeController(dir);
    (c as any).ctx = ctx;
    const result = await (c as any).toolScratchpad(args("close"));
    assert.equal(result.ok, true);
    assert.equal(hides.length, 0, "nothing to hide when no viewer is open");
    assert.equal((c as any).scratchpad.snapshot().open, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/voice scratchpad close command dismisses the viewer opened by /voice scratchpad", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-cmd-close-"));
  try {
    const { ctx, customCalls, hides } = makeRecordCtx();
    const c = makeController(dir);
    (c as any).ctx = ctx;
    await (c as any).scratchpadCommand("open", "plan", ctx);
    assert.equal(customCalls.length, 1);
    await (c as any).scratchpadCommand("close", "", ctx);
    assert.equal(hides.length, 1, "expected the command close to dismiss the overlay");
    assert.equal((c as any).scratchpad.snapshot().open, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});