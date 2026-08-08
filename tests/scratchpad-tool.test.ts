import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { Scratchpad } from "../src/scratchpad.js";
import { controllerSeam, fakePi } from "./support/seams.js";

type OpaqueUiCustomOptions = {
  overlay?: boolean;
  overlayOptions?: { anchor?: string };
  onHandle?: (h: { hide(): void; focus(): void }) => void;
};

/** Plain structural fake of the TUI extension command context. */
interface RecordCtx {
  hasUI: boolean;
  mode: string;
  cwd: string;
  ui: {
    custom: (_factory: unknown, options?: OpaqueUiCustomOptions) => Promise<unknown>;
    notify: () => void;
  };
}

/**
 * Build a fake TUI extension context. `ui.custom` records overlay requests and,
 * like the real TUI, invokes `onHandle` with a fake handle whose `hide()` is
 * recorded so tests can assert the overlay is programmatically dismissed.
 */
function makeRecordCtx(mode = "tui") {
  const customCalls: OpaqueUiCustomOptions[] = [];
  const hides: number[] = [];
  const handle = {
    hide: () => hides.push(1),
    focus: () => {},
  };
  const ctx: RecordCtx = {
    hasUI: true,
    mode,
    cwd: "/tmp",
    ui: {
      custom: async (_factory: unknown, options: OpaqueUiCustomOptions = {}) => {
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
  const c = new VoiceController(fakePi());
  controllerSeam(c).scratchpad = new Scratchpad(dir, { panelHeight: 12, maxBytes: 1_000_000 }, false);
  controllerSeam(c).config = {};
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
    controllerSeam(c).ctx = ctx;
    const result = await controllerSeam(c).toolScratchpad(args("open", { title: "plan" }));
    assert.equal(result.ok, true);
    assert.equal(controllerSeam(c).scratchpad.snapshot().open, true);
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
    controllerSeam(c).ctx = ctx;
    const result = await controllerSeam(c).toolScratchpad(args("view"));
    assert.equal(result.ok, true);
    assert.equal(controllerSeam(c).scratchpad.snapshot().open, true);
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
    controllerSeam(c).ctx = ctx;
    const result = await controllerSeam(c).toolScratchpad(args("open"));
    assert.equal(result.ok, true);
    assert.equal(controllerSeam(c).scratchpad.snapshot().open, true);
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
    controllerSeam(c).ctx = ctx;
    await controllerSeam(c).toolScratchpad(args("open"));
    assert.equal(customCalls.length, 1);
    assert.equal(hides.length, 0, "overlay should still be up after open");
    const result = await controllerSeam(c).toolScratchpad(args("close"));
    assert.equal(result.ok, true);
    assert.equal(controllerSeam(c).scratchpad.snapshot().open, false, "pad should be closed");
    assert.equal(hides.length, 1, "expected the overlay to be hidden by close");
    // The guard flag must reset so a later open can show it again.
    await controllerSeam(c).toolScratchpad(args("open"));
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
    controllerSeam(c).ctx = ctx;
    const result = await controllerSeam(c).toolScratchpad(args("close"));
    assert.equal(result.ok, true);
    assert.equal(hides.length, 0, "nothing to hide when no viewer is open");
    assert.equal(controllerSeam(c).scratchpad.snapshot().open, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("/voice scratchpad close command dismisses the viewer opened by /voice scratchpad", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orb-cmd-close-"));
  try {
    const { ctx, customCalls, hides } = makeRecordCtx();
    const c = makeController(dir);
    controllerSeam(c).ctx = ctx;
    await controllerSeam(c).scratchpadCommand("open", "plan", ctx);
    assert.equal(customCalls.length, 1);
    await controllerSeam(c).scratchpadCommand("close", "", ctx);
    assert.equal(hides.length, 1, "expected the command close to dismiss the overlay");
    assert.equal(controllerSeam(c).scratchpad.snapshot().open, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});