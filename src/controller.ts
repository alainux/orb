import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ActivityFeed } from "./activity.js";
import { GoAudioBridge, type AudioLevels } from "./audio/bridge.js";
import { PcmInputAdapter } from "./audio/input-adapter.js";
import { loadVoiceConfig } from "./config.js";
import { DelegatedWorkTracker, sendPiTask } from "./delegation.js";
import { RunLog } from "./log.js";
import { PiControl } from "./pi-control.js";
import { PiLogMirror } from "./pi-log.js";
import { createProvider } from "./providers/index.js";
import { Scratchpad } from "./scratchpad.js";
import type { ToolCall, VoiceConfig, VoiceProvider, VoiceProviderName, VoiceViewState } from "./types.js";
import { VoiceWidget } from "./widget.js";

export class VoiceController {
  private readonly feed = new ActivityFeed();
  private readonly piLog = new PiLogMirror();
  private state: VoiceViewState = {
    active: false, status: "off", source: "idle", muted: false, inputTranscript: "", outputTranscript: "",
    inputRms: 0, outputRms: 0, audioCaptureDrops: 0, audioQueuedMs: 0, audioRecoveries: 0,
    piAgentStatus: "idle", activity: [], scratchpad: { open: false, title: "Scratchpad", content: "", dirty: false }, error: undefined,
  };
  private ctx: ExtensionContext | undefined;
  private config: VoiceConfig | undefined;
  private provider: VoiceProvider | undefined;
  private audio: GoAudioBridge | undefined;
  private inputAdapter: PcmInputAdapter | undefined;
  private log: RunLog | undefined;
  private widget: VoiceWidget | undefined;
  private animationTimer: NodeJS.Timeout | undefined;
  private stopping: Promise<void> | undefined;
  private providerOverride: VoiceProviderName | undefined;
  private observingPi = 0;
  private readonly delegated = new DelegatedWorkTracker();
  private scratchpad: Scratchpad | undefined;
  private piControl: PiControl | undefined;
  private interruptionTimes: number[] = [];
  private inputSuppressedUntil = 0;
  private lastAudioRecoveries = 0;

  constructor(private readonly pi: ExtensionAPI) {}
  get active(): boolean { return this.state.active; }
  get viewState(): VoiceViewState { return { ...this.state, activity: this.feed.snapshot(48), scratchpad: { ...this.state.scratchpad } }; }

  async start(ctx: ExtensionContext, providerOverride?: VoiceProviderName): Promise<void> {
    if (!ctx.hasUI || ctx.mode !== "tui") { ctx.ui.notify("Orb voice requires Pi's interactive TUI mode.", "warning"); return; }
    if (this.state.active) { ctx.ui.notify("Orb voice is already active.", "info"); return; }
    this.ctx = ctx;
    if (providerOverride) this.providerOverride = providerOverride;
    try {
      this.config = await loadVoiceConfig(this.providerOverride, ctx.cwd);
      this.log = await RunLog.create(this.config.logDir);
      this.feed.clear();
      this.feed.add("system", `Orb voice · ${this.config.provider}`);
      this.scratchpad = new Scratchpad(ctx.cwd, this.config.scratchpad, this.config.permissions.scratchpadOutsideProject);
      this.piControl = new PiControl(this.pi, this.config.permissions);
      this.interruptionTimes = [];
      this.inputSuppressedUntil = 0;
      this.lastAudioRecoveries = 0;
      this.state = {
        ...this.state, active: true, status: `starting · ${this.config.provider}`, source: "idle", muted: false, inputTranscript: "", outputTranscript: "",
        inputRms: 0, outputRms: 0, audioCaptureDrops: 0, audioQueuedMs: 0, audioRecoveries: 0,
        piAgentStatus: this.piLog.agentStatus, scratchpad: this.scratchpad.snapshot(), error: undefined, activity: [],
      };
      this.mountWidget(ctx);
      ctx.ui.setStatus("orb-voice", `orb · ${this.config.provider}`);
      await this.log.info("Orb voice starting", { provider: this.config.provider, cwd: ctx.cwd, audio: "go-sidecar-buffered", configFiles: this.config.configFiles });

      this.provider = createProvider(this.config, this.log);
      this.inputAdapter = new PcmInputAdapter(this.provider.inputSampleRate);
      this.audio = new GoAudioBridge(this.log, this.config.audio);
      this.audio.on("input", (pcm24k: Buffer) => {
        try {
          if (Date.now() < this.inputSuppressedUntil) return;
          for (const chunk of this.inputAdapter?.push(pcm24k) ?? []) this.provider?.sendAudio(chunk);
        } catch (error) { this.reportError(asError(error), "microphone stream"); }
      });
      this.audio.on("levels", (levels: AudioLevels) => this.updateLevels(levels));
      this.audio.on("error", (error: Error) => this.reportError(error, "audio"));
      await this.audio.start();

      const recentPi = this.piLog.snapshot(ctx, 10);
      await this.provider.connect(this.createProviderSink(), { cwd: ctx.cwd, piStatus: this.piLog.agentStatus, recentPiActivity: recentPi.text });
      this.state.status = "live · listening";
      this.startAnimation();
      ctx.ui.notify(`Orb voice active · ${this.config.provider}`, "info");
    } catch (error) {
      const normalized = asError(error);
      await this.log?.error("startup failed", normalized);
      ctx.ui.notify(`Orb voice could not start: ${normalized.message}`, "error");
      await this.stop(ctx, { quiet: true, keepError: normalized.message });
    }
  }

  async stop(ctx = this.ctx, options: { quiet?: boolean; keepError?: string } = {}): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopping = this.stopInternal(ctx, options).finally(() => { this.stopping = undefined; });
    return this.stopping;
  }

  status(ctx: ExtensionContext): void {
    const provider = this.config?.provider ?? this.providerOverride ?? process.env.ORB_PROVIDER ?? process.env.PI_VOICE_PROVIDER ?? "gemini";
    const configs = this.config?.configFiles.length ? `\nConfig: ${this.config.configFiles.join(", ")}` : "";
    ctx.ui.notify(this.state.active
      ? `Orb voice active · ${provider} · Go audio · Pi ${this.state.piAgentStatus} · audio recoveries ${this.state.audioRecoveries} · capture drops ${this.state.audioCaptureDrops}${configs}${this.log?.path ? `\nLog: ${this.log.path}` : ""}`
      : `Orb voice off · configured provider ${provider}${configs}`, "info");
  }

  showDiagnostics(ctx: ExtensionContext): void {
    ctx.ui.notify(this.log?.path ? `Orb diagnostics:\n${this.log.path}` : "No Orb run log exists yet.", "info");
  }

  setProvider(provider: VoiceProviderName, ctx: ExtensionContext): void {
    this.providerOverride = provider;
    ctx.ui.notify(`Orb provider set to ${provider} for the next voice session.`, "info");
  }

  /**
   * Mute or unmute the microphone at the Go audio sidecar. The sidecar stops
   * forwarding capture frames while muted but keeps measuring input RMS, so
   * the orb keeps breathing with the user's voice even when it cannot hear
   * them. With no explicit target, the current state toggles.
   */
  setMuted(ctx: ExtensionContext, muted?: boolean): void {
    if (!this.state.active || !this.audio) {
      ctx.ui.notify("Start Orb voice before muting the microphone.", "warning");
      return;
    }
    const target = muted ?? !this.state.muted;
    this.audio.setMuted(target);
    this.state.muted = target;
    this.feed.add("system", target ? "Microphone muted" : "Microphone unmuted");
    ctx.ui.notify(target ? "Orb microphone muted." : "Orb microphone unmuted.", "info");
    void this.log?.info("microphone mute changed", { muted: target });
    this.widget?.tick();
  }

  recordPiEvent(eventName: string, event: unknown, ctx?: ExtensionContext): void {
    this.piLog.record(eventName, event);
    this.state.piAgentStatus = this.piLog.agentStatus;
    if (ctx) this.ctx = this.ctx ?? ctx;

    if (eventName === "agent_start" && this.delegated.agentStarted() === "delegated-start") {
      this.state.status = "Pi working · listening";
    }
    if (eventName === "agent_end" && this.delegated.agentEnded() === "delegated-finish") {
      this.state.status = "live · listening";
      if (this.state.active && this.provider && this.observingPi === 0) {
        const snap = this.piLog.snapshot(this.ctx, 12);
        this.provider.sendText(`PI_DELEGATED_TASK_FINISHED\nVisible Pi result:\n${snap.text}\n\nGive the human a concise high-level outcome. Mention blockers or an important next decision if there is one. They can already see Pi's full screen, so do not narrate tools or repeat details.`, { requestResponse: true });
      }
    }
    this.widget?.tick();
  }

  recordUserBash(event: unknown, ctx?: ExtensionContext): void {
    this.piLog.record("user_bash", event);
    if (ctx) this.ctx = this.ctx ?? ctx;
  }

  async scratchpadCommand(action: "open" | "close" | "edit" | "load" | "save" | "dispatch", argument: string, ctx: ExtensionCommandContext): Promise<void> {
    if (!this.config || !this.scratchpad) { ctx.ui.notify("Start Orb voice before using its scratchpad.", "warning"); return; }
    switch (action) {
      case "open": this.scratchpad.open(argument || undefined); break;
      case "close": this.scratchpad.close(); break;
      case "edit": {
        const editor = ctx.ui.editor;
        if (!editor) { ctx.ui.notify("This Pi UI does not expose the extension editor dialog.", "warning"); return; }
        const next = await editor("Orb scratchpad", this.scratchpad.snapshot().content);
        if (next !== undefined) this.scratchpad.replace(next);
        break;
      }
      case "load":
        if (!this.config.permissions.scratchpadRead) throw new Error("Permission disabled: permissions.scratchpadRead");
        if (!argument.trim()) throw new Error("Usage: /voice scratchpad load <path>");
        await this.scratchpad.load(argument); break;
      case "save":
        if (!this.config.permissions.scratchpadWrite) throw new Error("Permission disabled: permissions.scratchpadWrite");
        await this.scratchpad.save(argument || undefined); break;
      case "dispatch": {
        const content = this.scratchpad.snapshot().content.trim();
        if (!content) throw new Error("Scratchpad is empty.");
        await this.runPiInstruction(content, "scratchpad");
        break;
      }
    }
    this.syncScratchpad();
  }

  private createProviderSink() {
    return {
      onAudio: (pcm: Buffer) => this.audio?.enqueueOutput(pcm),
      onAudioEnd: () => this.audio?.endOutput(),
      onInterruption: (reason: string) => this.handleInterruption(reason),
      onInputTranscript: (text: string, final: boolean) => {
        this.state.inputTranscript = final ? "" : text;
        this.feed.transcript("you", text, final);
        this.widget?.tick();
      },
      onOutputTranscript: (text: string, final: boolean) => {
        this.state.outputTranscript = final ? "" : text;
        this.feed.transcript("voice", text, final);
        this.widget?.tick();
      },
      onStatus: (status: string) => { this.state.status = status; this.widget?.tick(); },
      onError: (error: Error) => this.reportError(error, "provider"),
      onSessionEnded: (reason: string) => { void this.handleFriendlySessionEnd(reason); },
      onToolCall: (call: ToolCall) => this.handleToolCall(call),
    };
  }

  private handleInterruption(reason: string): void {
    this.audio?.clearOutput();
    this.state.outputRms = 0;
    this.feed.finalize("voice");
    const now = Date.now();
    const config = this.config?.audio;
    if (config) {
      this.interruptionTimes = this.interruptionTimes.filter((time) => now - time <= config.interruptionStormWindowMs);
      this.interruptionTimes.push(now);
      if (this.interruptionTimes.length >= config.interruptionStormCount) {
        // Repeated server interruptions in a very small window usually mean
        // speaker->microphone feedback. Break the loop briefly, reset the
        // resampler, and let the next turn start from clean audio boundaries.
        this.inputSuppressedUntil = now + config.interruptionRecoveryMuteMs;
        this.inputAdapter?.reset();
        this.interruptionTimes = [];
        this.feed.add("system", "Audio overlap detected · resynchronizing");
        void this.log?.info("interruption storm recovery", { reason, mutedInputMs: config.interruptionRecoveryMuteMs });
      }
    }
    void this.log?.info("playback interrupted", { reason });
    this.widget?.tick();
  }

  private async handleToolCall(call: ToolCall): Promise<Record<string, unknown>> {
    this.feed.add("voice-tool", `→ ${toolLabel(call)}`);
    this.widget?.tick();
    let result: Record<string, unknown>;
    try {
      if (call.name === "run_pi_task") result = await this.toolRunPiTask(call);
      else if (call.name === "read_pi_log") {
        const count = bounded(call.arguments.max_entries, 14, 1, 40);
        const snapshot = this.piLog.snapshot(this.ctx, count);
        result = { ok: true, status: snapshot.status, revision: snapshot.revision, log: snapshot.text };
      } else if (call.name === "observe_pi") result = await this.toolObservePi(call);
      else if (call.name === "control_pi") result = await this.toolControlPi(call);
      else if (call.name === "scratchpad") result = await this.toolScratchpad(call);
      else result = { ok: false, error: `Unknown tool ${call.name}` };
    } catch (error) {
      result = { ok: false, error: asError(error).message };
    }
    this.feed.add("voice-tool", `${result.ok === false ? "✗" : "✓"} ${toolResultLabel(call.name, result)}`);
    this.widget?.tick();
    return result;
  }

  private async toolRunPiTask(call: ToolCall): Promise<Record<string, unknown>> {
    const instruction = typeof call.arguments.instruction === "string" ? call.arguments.instruction.trim() : "";
    if (!instruction) return { ok: false, error: "instruction must be non-empty" };
    if (instruction.length > 200_000) return { ok: false, error: "instruction exceeds safety limit" };
    const summary = typeof call.arguments.summary === "string" ? call.arguments.summary.trim().slice(0, 160) : "";
    const response = await this.runPiInstruction(instruction, summary);
    return { ok: true, ...response, observation_revision: this.piLog.revision, ...(summary ? { summary } : {}) };
  }

  private async runPiInstruction(instruction: string, summary = ""): Promise<{ queued: boolean; status: string }> {
    const ctx = this.ctx;
    if (!ctx) throw new Error("Pi context unavailable");
    this.delegated.delegated();
    const { queued } = await sendPiTask(this.pi, ctx, instruction);
    this.state.status = queued ? "Pi task queued · listening" : "Pi starting · listening";
    await this.log?.info("voice delegated Pi task", { queued, summary, characters: instruction.length });
    return { queued, status: queued ? "queued" : "submitted" };
  }

  private async toolObservePi(call: ToolCall): Promise<Record<string, unknown>> {
    const after = Number.isFinite(Number(call.arguments.after_revision)) ? Number(call.arguments.after_revision) : this.piLog.revision;
    const until = call.arguments.until === "activity" ? "activity" : "settled";
    const timeout = bounded(call.arguments.timeout_ms, 30_000, 100, 60_000);
    const max = bounded(call.arguments.max_entries, 16, 1, 40);
    this.observingPi++;
    this.state.status = until === "settled" ? "waiting for Pi · listening" : "watching Pi · listening";
    try {
      await this.piLog.observe(after, until, timeout);
      const snapshot = this.piLog.snapshot(this.ctx, max);
      return { ok: true, status: snapshot.status, revision: snapshot.revision, log: snapshot.text, timed_out: snapshot.revision <= after };
    } finally {
      this.observingPi--;
      this.state.status = "live · listening";
    }
  }

  private async toolControlPi(call: ToolCall): Promise<Record<string, unknown>> {
    const ctx = this.ctx;
    if (!ctx || !this.piControl) return { ok: false, error: "Pi control is unavailable" };
    const action = String(call.arguments.action ?? "").trim();
    const result = await this.piControl.execute(action, call.arguments, ctx);
    if (action === "cancel" && result.ok) {
      this.delegated.reset();
      this.state.status = "Pi cancelled · listening";
    }
    await this.log?.info("voice controlled Pi", { action, ok: result.ok });
    return result;
  }

  private async toolScratchpad(call: ToolCall): Promise<Record<string, unknown>> {
    const pad = this.scratchpad;
    const config = this.config;
    if (!pad || !config) return { ok: false, error: "Scratchpad is unavailable" };
    const action = String(call.arguments.action ?? "read");
    let result: Record<string, unknown> = { ok: true };
    switch (action) {
      case "open": pad.open(stringArg(call, "title") || undefined); break;
      case "close": pad.close(); break;
      case "read": break;
      case "replace": pad.replace(stringArg(call, "content"), stringArg(call, "title") || undefined); break;
      case "append": pad.append(stringArg(call, "content")); break;
      case "load":
        if (!config.permissions.scratchpadRead) return { ok: false, error: "Permission disabled: permissions.scratchpadRead" };
        await pad.load(stringArg(call, "path")); break;
      case "save": {
        if (!config.permissions.scratchpadWrite) return { ok: false, error: "Permission disabled: permissions.scratchpadWrite" };
        const saved = await pad.save(stringArg(call, "path") || undefined);
        result.path = saved.path; break;
      }
      case "dispatch": {
        const content = stringArg(call, "content") || pad.snapshot().content;
        if (!content.trim()) return { ok: false, error: "Scratchpad selection is empty" };
        const delegated = await this.runPiInstruction(content.trim(), stringArg(call, "summary") || "scratchpad");
        result = { ok: true, ...delegated, dispatched_characters: content.trim().length };
        break;
      }
      default: return { ok: false, error: `Unknown scratchpad action: ${action}` };
    }
    this.syncScratchpad();
    const snapshot = pad.snapshot();
    return { ...result, scratchpad: { ...snapshot, content: snapshot.content.slice(0, 120_000) } };
  }

  private syncScratchpad(): void {
    if (this.scratchpad) this.state.scratchpad = this.scratchpad.snapshot();
    this.widget?.tick();
  }

  private mountWidget(ctx: ExtensionContext): void {
    const config = this.config!;
    ctx.ui.setWidget("orb-voice", (tui, theme) => {
      const widget = new VoiceWidget(tui, theme, () => this.viewState, {
        orbAspect: config.orbAspect,
        orbDensity: config.orbDensity,
        orbReactivity: config.orbReactivity,
        orbBraille: config.orbBraille,
        panelHeight: config.panelHeight,
        activityLines: config.activityLines,
        scratchpadPanelHeight: config.scratchpad.panelHeight,
      });
      this.widget = widget;
      return widget;
    }, { placement: "aboveEditor" });
  }

  private startAnimation(): void {
    this.animationTimer = setInterval(() => {
      try { this.widget?.tickAnimation(); }
      catch (error) { this.reportError(asError(error), "widget animation"); }
    }, 50);
    this.animationTimer.unref?.();
  }

  private updateLevels(levels: AudioLevels): void {
    // While muted the sidecar keeps measuring the mic for level telemetry, but
    // the viewer must not see live input: clamp RMS to zero so the meters and
    // the orb cannot be mistaken for a live microphone.
    const inputRms = this.state.muted ? 0 : levels.inputRms;
    this.state.inputRms = inputRms;
    this.state.outputRms = levels.outputRms;
    this.state.audioCaptureDrops = levels.captureDrops;
    this.state.audioQueuedMs = Math.round(levels.queuedBytes / (24_000 * 2) * 1000);
    this.state.audioRecoveries = levels.recoveries;
    if (levels.recoveries > this.lastAudioRecoveries) {
      void this.log?.info("audio playout recovered from underrun", { recoveries: levels.recoveries, queuedMs: this.state.audioQueuedMs });
      this.lastAudioRecoveries = levels.recoveries;
    }
    this.state.source = levels.outputRms > inputRms && levels.outputRms > 0.01 ? "agent" : inputRms > 0.01 ? "user" : "idle";
  }

  private reportError(error: Error, area: string): void {
    this.state.error = `${area}: ${error.message}`;
    this.state.status = "error · see diagnostics";
    this.feed.add("error", `${area}: ${error.message}`);
    this.ctx?.ui.notify(`Orb ${area} error: ${error.message}${this.log?.path ? `\nLog: ${this.log.path}` : ""}`, "error");
    void this.log?.error(`${area} error`, error);
    this.widget?.tick();
  }

  private async handleFriendlySessionEnd(reason: string): Promise<void> {
    const ctx = this.ctx;
    this.feed.add("system", "Voice provider session ended; reopen with /voice when ready.");
    await this.log?.info("provider session ended gracefully", { reason });
    if (ctx) ctx.ui.notify("Orb voice paused because the realtime provider ended the session. Pi is still running; use /voice whenever you're ready to reconnect.", "info");
    await this.stop(ctx, { quiet: true });
  }

  private async stopInternal(ctx: ExtensionContext | undefined, options: { quiet?: boolean; keepError?: string }): Promise<void> {
    if (this.animationTimer) clearInterval(this.animationTimer);
    this.animationTimer = undefined;
    const provider = this.provider;
    const audio = this.audio;
    this.provider = undefined;
    this.audio = undefined;
    await Promise.allSettled([provider?.close(), audio?.close()]);
    this.state = { ...this.state, active: false, status: options.keepError ? "stopped after error" : "off", source: "idle", muted: false, inputTranscript: "", outputTranscript: "", inputRms: 0, outputRms: 0, error: options.keepError };
    ctx?.ui.setStatus("orb-voice", undefined);
    ctx?.ui.setWidget("orb-voice", undefined);
    this.widget = undefined;
    this.delegated.reset();
    if (!options.quiet) ctx?.ui.notify("Orb voice stopped.", "info");
    await this.log?.info("Orb voice stopped");
  }
}

function toolLabel(call: ToolCall): string {
  if (call.name === "run_pi_task") return `delegate to Pi${typeof call.arguments.summary === "string" && call.arguments.summary.trim() ? ` · ${call.arguments.summary.trim().slice(0, 80)}` : ""}`;
  if (call.name === "read_pi_log") return "check Pi result";
  if (call.name === "observe_pi") return `wait for Pi · ${call.arguments.until ?? "settled"}`;
  if (call.name === "control_pi") {
    const action = String(call.arguments.action ?? "control");
    if (action === "shell") return `shell · ${String(call.arguments.command ?? "").slice(0, 90)}`;
    if (action === "set_model") return `model · ${String(call.arguments.model ?? "")}`;
    return `Pi ${action.replaceAll("_", " ")}`;
  }
  if (call.name === "scratchpad") return `scratchpad · ${String(call.arguments.action ?? "read")}`;
  return call.name;
}
function toolResultLabel(name: string, result: Record<string, unknown>): string {
  if (result.ok === false) return `${name}: ${String(result.error ?? "failed")}`;
  if (name === "run_pi_task") return result.queued ? "Pi task queued" : "Pi task started";
  if (name === "observe_pi") return `Pi ${String(result.status ?? "observed")}`;
  if (name === "read_pi_log") return "Pi result checked";
  if (name === "control_pi") return "Pi control applied";
  if (name === "scratchpad") return "scratchpad updated";
  return name;
}
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}
function stringArg(call: ToolCall, key: string): string { return typeof call.arguments[key] === "string" ? String(call.arguments[key]) : ""; }
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
