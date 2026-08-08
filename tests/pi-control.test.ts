import assert from "node:assert/strict";
import test from "node:test";
import { PiControl } from "../src/pi-control.js";
import type { OrbPermissions } from "../src/types.js";

const allowed: OrbPermissions = { cancelPi: true, scratchpadRead: true, scratchpadWrite: true, scratchpadOutsideProject: false };

function fixture() {
  let aborted = 0; let shell: any;
  const pi: any = {};
  const ctx: any = { cwd: "/project", isIdle: () => false, abort: () => { aborted++; } };
  return { pi, ctx, get: () => ({ aborted, shell }) };
}

test("voice Control-orchestration can cancel a running Pi, and no configuration action exists", async () => {
  const f = fixture(); const control = new PiControl(f.pi as any, allowed);
  assert.equal((await control.execute("cancel", {}, f.ctx)).ok, true); assert.equal(f.get().aborted, 1);
  // Cancelling again while idle is a no-op but still ok.
  f.ctx.isIdle = () => true;
  assert.equal((await control.execute("cancel", {}, f.ctx)).ok, true);
  // Every configuration/control knob was removed: unknown-and-not-allowed.
  for (const action of ["set_model", "list_models", "set_thinking", "list_tools", "set_tools", "shell"]) {
    const r = await control.execute(action, { model: "x", level: "high", tools: [], command: "pwd" }, f.ctx);
    assert.equal(r.ok, false, `${action} must not be allowed`);
    assert.match(String(r.error), /Unknown-or-not-allowed/);
  }
});

test("Pi control permission is enforced independently", async () => {
  const f = fixture(); const control = new PiControl(f.pi as any, { ...allowed, cancelPi: false });
  assert.match(String((await control.execute("cancel", {}, f.ctx)).error), /cancelPi/);
  assert.equal(f.get().aborted, 0);
});