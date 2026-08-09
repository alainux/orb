import assert from "node:assert/strict";
import test from "node:test";
import { VoiceController } from "../src/controller.js";
import { controllerSeam, fakePi } from "./support/seams.js";

/** Build a controller with a cancelPi permission and a controllable fake Pi context. */
function setup(cancelPi: boolean) {
  const c = new VoiceController(fakePi());
  const seam = controllerSeam(c);
  let aborted = 0;
  const ctx = {
    isIdle: () => aborted > 0, // running until aborted; idle once cancelled
    abort: () => { aborted += 1; },
  };
  seam.config = { permissions: { scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false, cancelPi } } as never;
  seam.ctx = ctx;
  seam.state = {};
  return { seam, ctx, cancelled: () => aborted };
}

test("cancel_pi_task aborts an active delegated task and reports cancelled", async () => {
  const { seam, ctx, cancelled } = setup(true);
  void ctx; // the fake starts "running" (not idle)
  const result = await seam.handleToolCall({ id: "c1", name: "cancel_pi_task", arguments: { reason: "user changed direction" } });
  assert.equal(result.ok, true);
  assert.equal(result.status, "cancelled");
  assert.equal(cancelled(), 1, "the running context must be aborted once");
});

test("cancel_pi_task on an idle Pi is a safe no-op", async () => {
  const { seam, ctx, cancelled } = setup(true);
  // Force idle: isIdle() must return true so nothing is aborted.
  (ctx as { isIdle: () => boolean }).isIdle = () => true;
  const result = await seam.handleToolCall({ id: "c2", name: "cancel_pi_task", arguments: {} });
  assert.equal(result.ok, true);
  assert.equal(result.status, "already_idle");
  assert.equal(cancelled(), 0, "must not abort when already idle");
});

test("cancel_pi_task is permission-gated and never offers control knobs", async () => {
  const dis = setup(false);
  const denied = await dis.seam.handleToolCall({ id: "c3", name: "cancel_pi_task", arguments: {} });
  assert.equal(denied.ok, false);
  assert.match(String(denied.error), /permissions\.cancelPi/);
  assert.equal(dis.cancelled(), 0);

  // Even with the cancel permission granted, config/self/agent controls stay
  // rejected as unknown: cancellation is the only control surface.
  const s = setup(true);
  (s.ctx as { isIdle: () => boolean }).isIdle = () => false;
  for (const name of ["control_pi", "set_voice", "shell", "set_thinking", "list_tools", "set_tools", "list_models"]) {
    const r = await s.seam.handleToolCall({ id: "x", name, arguments: {} });
    assert.equal(Boolean(r.ok), false, `${name} must not be offered`);
    assert.match(String(r.error), /Unknown tool/);
  }
});

test("cancel_pi_task promptly halts a long-running command", async () => {
  const { seam, ctx, cancelled } = setup(true);

  // Simulates an in-flight long command (e.g. a heavy pipeline) that only ends
  // when its executor aborts it — it would otherwise keep running.
  const commandOutcome = new Promise<string>((resolve) => {
    const started = Date.now();
    const watch = setInterval(() => {
      if (cancelled() > 0) { clearInterval(watch); resolve("interrupted-after-cancel"); }
      else if (Date.now() - started > 3000) { clearInterval(watch); resolve("ran-too-long"); }
    }, 10);
  });

  const t0 = performance.now();
  const result = await seam.handleToolCall({ id: "c4", name: "cancel_pi_task", arguments: { reason: "stop the summary" } });
  const outcome = await commandOutcome;
  const elapsed = performance.now() - t0;

  assert.equal(result.ok, true);
  assert.equal(result.status, "cancelled");
  assert.equal(outcome, "interrupted-after-cancel", "the long command must be halted, not left to run to completion");
  assert.ok(elapsed < 500, `cancel should return promptly, took ${elapsed.toFixed(0)}ms`);
  assert.ok(ctx && true, "ctx used");
});