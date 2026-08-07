import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { OrbPermissions, ThinkingLevel } from "./types.js";

export interface PiControlResult extends Record<string, unknown> { ok: boolean }

type ModelLike = { provider?: string; id?: string; name?: string };

export class PiControl {
  constructor(private readonly pi: ExtensionAPI, private readonly permissions: OrbPermissions) {}

  async execute(action: string, args: Record<string, unknown>, ctx: ExtensionContext): Promise<PiControlResult> {
    switch (action) {
      case "cancel": return this.cancel(ctx);
      case "set_model": return this.setModel(String(args.model ?? ""), ctx);
      case "list_models": return this.listModels(ctx);
      case "set_thinking": return this.setThinking(String(args.level ?? ""));
      case "list_tools": return this.listTools();
      case "set_tools": return this.setTools(args.tools);
      case "shell": return this.shell(String(args.command ?? ""), Number(args.timeout_ms ?? 120_000), ctx);
      default: return { ok: false, error: `Unknown Pi control action: ${action}` };
    }
  }

  private async cancel(ctx: ExtensionContext): Promise<PiControlResult> {
    if (!this.permissions.cancelPi) return denied("cancelPi");
    if (ctx.isIdle()) return { ok: true, status: "already_idle" };
    await Promise.resolve(ctx.abort());
    return { ok: true, status: "cancelled" };
  }

  private async listModels(ctx: ExtensionContext): Promise<PiControlResult> {
    if (!this.permissions.setModel) return denied("setModel");
    const registry = ctx.modelRegistry as any;
    const models: ModelLike[] = typeof registry?.getAvailable === "function" ? await registry.getAvailable() : [];
    return {
      ok: true,
      current: ctx.model ? modelKey(ctx.model as ModelLike) : undefined,
      models: models.slice(0, 120).map((model) => ({ id: model.id, provider: model.provider, name: model.name, key: modelKey(model) })),
    };
  }

  private async setModel(requested: string, ctx: ExtensionContext): Promise<PiControlResult> {
    if (!this.permissions.setModel) return denied("setModel");
    const query = requested.trim();
    if (!query) return { ok: false, error: "model must be non-empty" };
    const registry = ctx.modelRegistry as any;
    let model: ModelLike | undefined;
    if (query.includes("/")) {
      const [provider, ...rest] = query.split("/");
      model = registry?.find?.(provider, rest.join("/"));
    } else {
      const available: ModelLike[] = typeof registry?.getAvailable === "function" ? await registry.getAvailable() : [];
      const lower = query.toLowerCase();
      const exact = available.filter((candidate) => [candidate.id, candidate.name, modelKey(candidate)].some((value) => String(value ?? "").toLowerCase() === lower));
      const partial = exact.length ? exact : available.filter((candidate) => [candidate.id, candidate.name, modelKey(candidate)].some((value) => String(value ?? "").toLowerCase().includes(lower)));
      if (partial.length === 1) model = partial[0];
      else if (partial.length > 1) return { ok: false, error: `Model query is ambiguous: ${query}`, matches: partial.slice(0, 12).map(modelKey) };
    }
    if (!model) return { ok: false, error: `Model not found: ${query}` };
    const success = await this.pi.setModel(model as any);
    return success ? { ok: true, model: modelKey(model) } : { ok: false, error: `No credentials are available for ${modelKey(model)}` };
  }

  private async setThinking(levelRaw: string): Promise<PiControlResult> {
    if (!this.permissions.setThinking) return denied("setThinking");
    const level = levelRaw.trim().toLowerCase() as ThinkingLevel;
    if (!["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(level)) return { ok: false, error: `Invalid thinking level: ${levelRaw}` };
    this.pi.setThinkingLevel(level as any);
    return { ok: true, level: this.pi.getThinkingLevel() };
  }


  private async listTools(): Promise<PiControlResult> {
    if (!this.permissions.setTools) return denied("setTools");
    return { ok: true, tools: this.pi.getActiveTools() };
  }

  private async setTools(value: unknown): Promise<PiControlResult> {
    if (!this.permissions.setTools) return denied("setTools");
    const tools = Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    if (!tools.length) return { ok: false, error: "tools must contain at least one tool name" };
    if (tools.length > 128) return { ok: false, error: "too many tool names" };
    this.pi.setActiveTools([...new Set(tools)]);
    return { ok: true, tools: this.pi.getActiveTools() };
  }

  private async shell(commandRaw: string, timeoutRaw: number, ctx: ExtensionContext): Promise<PiControlResult> {
    if (!this.permissions.shell) return denied("shell");
    const command = commandRaw.trim();
    if (!command) return { ok: false, error: "command must be non-empty" };
    if (command.length > 32_000) return { ok: false, error: "command exceeds safety limit" };
    const timeout = Number.isFinite(timeoutRaw) ? Math.max(500, Math.min(600_000, Math.floor(timeoutRaw))) : 120_000;
    const shell = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
    const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", command] : ["-lc", command];
    const result = await this.pi.exec(shell, shellArgs, { cwd: ctx.cwd, timeout });
    return {
      ok: result.code === 0,
      code: result.code,
      killed: result.killed,
      stdout: truncate(result.stdout, 16_000),
      stderr: truncate(result.stderr, 8_000),
    };
  }
}

function denied(name: keyof OrbPermissions): PiControlResult { return { ok: false, error: `Permission disabled: permissions.${name}` }; }
function modelKey(model: ModelLike): string { return model.provider && model.id ? `${model.provider}/${model.id}` : String(model.id ?? model.name ?? "unknown"); }
function truncate(value: unknown, max: number): string { const text = String(value ?? ""); return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`; }
