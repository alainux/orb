// Wire-boundary exception: this mirror consumes untyped Pi lifecycle events and
// session-branch payloads straight off the harness. Fields are read with nullable
// access and coerced to string/bool at the leaf; none are passed onward unsafely.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { PiAgentStatus } from "./types.js";

export interface PiLogContextLike { sessionManager?: { getBranch(): unknown[] } }
export interface PiVisibleEvent { kind: "pi" | "pi-tool" | "system"; text: string; final?: boolean }
interface LiveRecord { revision: number; time: number; kind: string; text: string }
interface Waiter { after: number; until: "activity" | "settled"; resolve: () => void; timer?: NodeJS.Timeout }

export class PiLogMirror {
  private records: LiveRecord[] = [];
  private liveAssistant = "";
  private status: PiAgentStatus = "idle";
  private revisionValue = 0;
  private waiters = new Set<Waiter>();

  constructor(private readonly onVisible?: (event: { kind: string; text: string }) => void) {}

  get agentStatus(): PiAgentStatus { return this.status; }
  get revision(): number { return this.revisionValue; }

  /**
   * Forward a committed, visible Pi activity fact to a durable-log consumer.
   * Never call this for hidden chain-of-thought: only final text/tool/status
   * entries (already filtered by visibleMessageText) are forwarded.
   */
  private note(kind: string, text: string): void {
    this.onVisible?.({ kind, text });
  }

  record(eventName: string, event: any): PiVisibleEvent[] {
    const visible: PiVisibleEvent[] = [];
    switch (eventName) {
      case "agent_start":
        this.status = "working"; this.liveAssistant = "";
        visible.push({ kind: "system", text: "Pi started working." }); this.push("status", "Pi agent started working."); this.note("system", "Pi started working."); break;
      case "agent_end":
        this.status = "idle";
        visible.push({ kind: "system", text: "Pi finished its turn." }); this.push("status", "Pi agent finished."); this.note("system", "Pi finished its turn."); break;
      case "message_update":
        if (event?.assistantMessageEvent?.type === "text_delta") { this.liveAssistant += String(event?.assistantMessageEvent?.delta ?? ""); if (this.liveAssistant.trim()) visible.push({ kind: "pi", text: this.liveAssistant, final: false }); }
        break;
      case "message_end": {
        const message = event?.message; const role = String(message?.role ?? "");
        if (role === "assistant") {
          const text = visibleMessageText(message); if (text) { this.push("assistant", text); visible.push({ kind: "pi", text, final: true }); this.note("pi", text); }
          this.liveAssistant = "";
        } else if (role === "toolResult") {
          const text = visibleMessageText(message); const name = String(message?.toolName ?? "tool");
          const body = `${name}: ${text || (message?.isError ? "failed" : "completed")}`;
          this.push(message?.isError ? "tool error" : `tool ${name}`, body); visible.push({ kind: "pi-tool", text: body }); this.note("pi-tool", body);
        }
        break;
      }
      case "tool_execution_start": {
        const text = `→ ${String(event?.toolName ?? "tool")}`; this.push("tool", text); visible.push({ kind: "pi-tool", text }); this.note("pi-tool", text); break;
      }
      case "tool_execution_end": {
        const text = `${event?.isError ? "✗" : "✓"} ${String(event?.toolName ?? "tool")}`; this.push(event?.isError ? "tool error" : "tool", text); visible.push({ kind: "pi-tool", text }); this.note("pi-tool", text); break;
      }
      case "user_bash": {
        const command = String(event?.command ?? "").trim();
        if (command) { this.push(event?.excludeFromContext ? "user bash !!" : "user bash !", command); if (!event?.excludeFromContext) this.note("pi-tool", `bash: ${command}`); }
        break;
      }
      case "model_select": {
        const model = event?.model;
        const key = model?.provider && model?.id ? `${model.provider}/${model.id}` : String(model?.id ?? "unknown");
        this.push("model", `Pi model changed to ${key}`); this.note("pi-tool", `model - ${key}`);
        break;
      }
    }
    this.resolveWaiters();
    return visible;
  }

  snapshot(ctx: PiLogContextLike | undefined, maxEntries = 14): { status: PiAgentStatus; revision: number; text: string } {
    const limit = Math.max(1, Math.min(40, Math.floor(maxEntries)));
    const durable = serializeBranch(ctx?.sessionManager?.getBranch?.() ?? [], limit);
    const live = this.records.slice(-limit).map((r) => `[${r.kind}] ${r.text}`);
    if (this.liveAssistant.trim()) live.push(`[assistant live] ${this.liveAssistant.trim()}`);
    const lines = dedupeConsecutive([...durable, ...live]).slice(-limit);
    return { status: this.status, revision: this.revisionValue, text: lines.length ? lines.join("\n\n") : "No visible Pi conversation or tool activity is available yet." };
  }

  async observe(afterRevision: number, until: "activity" | "settled", timeoutMs: number): Promise<void> {
    if (this.condition(afterRevision, until)) return;
    await new Promise<void>((resolve) => {
      const waiter: Waiter = { after: afterRevision, until, resolve: () => { if (waiter.timer) clearTimeout(waiter.timer); this.waiters.delete(waiter); resolve(); } };
      waiter.timer = setTimeout(waiter.resolve, timeoutMs); waiter.timer.unref?.(); this.waiters.add(waiter);
    });
  }

  private push(kind: string, text: string): void {
    const clean = text.replace(/\s+/g, " ").trim(); if (!clean) return;
    this.revisionValue++;
    this.records.push({ revision: this.revisionValue, time: Date.now(), kind, text: clean.slice(0, 4000) });
    if (this.records.length > 180) this.records.splice(0, this.records.length - 180);
  }
  private condition(after: number, until: "activity" | "settled"): boolean {
    if (until === "activity") return this.revisionValue > after;
    return this.status === "idle" && this.revisionValue > after;
  }
  private resolveWaiters(): void { for (const waiter of [...this.waiters]) if (this.condition(waiter.after, waiter.until)) waiter.resolve(); }
}

function serializeBranch(entries: unknown[], maxEntries: number): string[] {
  const lines: string[] = [];
  for (const entry of entries) {
    const raw: any = entry; if (raw?.type !== "message") continue; const message = raw.message; const role = String(message?.role ?? "");
    if (role === "user") { const text=visibleMessageText(message); if(text) lines.push(`[user] ${text}`); }
    else if (role === "assistant") {
      const text=visibleMessageText(message); if(text) lines.push(`[assistant] ${text}`);
      const tools=Array.isArray(message?.content)?message.content.filter((b:any)=>b?.type==="toolCall").map((b:any)=>String(b?.name??"tool")):[];
      if(tools.length) lines.push(`[assistant tools] ${tools.join(", ")}`);
    } else if(role==="toolResult") { const text=visibleMessageText(message); const name=String(message?.toolName??"tool"); lines.push(`[${message?.isError?"tool error":"tool"} ${name}] ${text || (message?.isError?"failed":"completed")}`); }
    else if(role==="bashExecution" && !message?.excludeFromContext) {
      const command=String(message?.command??"").trim(); const output=String(message?.output??"").trim();
      const status=message?.cancelled?"cancelled":message?.exitCode===0?"ok":`exit ${String(message?.exitCode??"?")}`;
      if(command) lines.push(`[user bash] ${command}
${output?`${output.slice(0,8000)}
`:""}[${status}]`);
    }
  }
  return lines.slice(-maxEntries);
}
function visibleMessageText(message:any):string { const c=message?.content; if(typeof c==="string") return c.trim().slice(0,8000); if(!Array.isArray(c)) return ""; return c.filter((b:any)=>b?.type==="text"&&typeof b?.text==="string").map((b:any)=>b.text).join("\n").trim().slice(0,8000); }
function dedupeConsecutive(lines:string[]):string[]{const out:string[]=[]; for(const line of lines) if(line&&out[out.length-1]!==line) out.push(line); return out;}
