export class DelegatedWorkTracker {
  private pending = 0;
  private active = false;
  get pendingCount(): number { return this.pending; }
  get inProgress(): boolean { return this.active; }
  delegated(): void { this.pending++; }
  agentStarted(): "delegated-start" | "unrelated" {
    if (this.active || this.pending === 0) return "unrelated";
    this.active = true;
    return "delegated-start";
  }
  agentEnded(): "delegated-finish" | "unrelated" {
    if (!this.active) return "unrelated";
    this.active = false;
    this.pending = Math.max(0, this.pending - 1);
    return "delegated-finish";
  }
  reset(): void { this.pending = 0; this.active = false; }
}

export async function sendPiTask(
  pi: { sendUserMessage(content:string, options?:{deliverAs?:"steer"|"followUp"}): void | Promise<void> },
  ctx: { isIdle(): boolean },
  instruction: string,
): Promise<{ queued:boolean }> {
  const queued = !ctx.isIdle();
  await pi.sendUserMessage(instruction, queued ? { deliverAs: "followUp" } : undefined);
  return { queued };
}
