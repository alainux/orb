import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OrbPermissions } from "./types.js";

export interface PiControlResult extends Record<string, unknown> { ok: boolean }

/**
 * Orchestration-only control of the background Pi agent. The voice companion
 * deliberately has NO configuration capabilities here: it cannot change the
 * model, thinking level, toolset, or run shell commands on Pi (those are set
 * by the config file). The only action is `cancel`, used to stop a running
 * delegation when the human changes direction.
 */
export class PiControl {
  constructor(private readonly pi: ExtensionAPI, private readonly permissions: OrbPermissions) {}

  async execute(action: string, args: Record<string, unknown>, ctx: ExtensionContext): Promise<PiControlResult> {
    switch (action) {
      case "cancel": return this.cancel(ctx);
      default: return { ok: false, error: `Unknown-or-not-allowed Pi control action: ${action}` };
    }
  }

  private async cancel(ctx: ExtensionContext): Promise<PiControlResult> {
    if (!this.permissions.cancelPi) return denied("cancelPi");
    if (ctx.isIdle()) return { ok: true, status: "already_idle" };
    await Promise.resolve(ctx.abort());
    return { ok: true, status: "cancelled" };
  }
}

function denied(name: keyof OrbPermissions): PiControlResult { return { ok: false, error: `Permission disabled: permissions.${name}` }; }