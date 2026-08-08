import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ActivityFeed } from "./activity.js";
import { GoAudioBridge, type AudioLevels } from "./audio/bridge.js";
import { PcmInputAdapter } from "./audio/input-adapter.js";
import { PlayoutMonitor } from "./audio/playout.js";
import { loadVoiceConfig } from "./config.js";
import { DelegatedWorkTracker, sendPiTask } from "./delegation.js";
import { RunLog } from "./log.js";
import { PiControl } from "./pi-control.js";
import { PiLogMirror } from "./pi-log.js";
import { HERDR_READ_SOURCES, HERDR_DEFAULT_LINES, HERDR_MAX_LINES, listHerdrPanes, readHerdrPane, type HerdrReadSource } from "./herdr.js";
import { createProvider } from "./providers/index.js";
import { Scratchpad } from "./scratchpad.js";
import { ScratchpadViewer } from "./scratchpad-view.js";
import { buildVoiceSettings, type EditableSetting, type VoiceSettingsRow } from "./settings.js";
import { ThinkingTracker, thinkingLabel, createFileLog } from "./thinking-timing.js";
import type { ThinkingDisplay, ToolCall, VoiceConfig, VoiceProvider, VoiceProviderName, VoiceViewState } from "./types.js";
import { auditionLine, nextVoice, resolveVoice, voiceOptions } from "./voices.js";
import { VoiceWidget } from "./widget.js";

export class VoiceController {
  /** Provider-agnostic "Thinking…" duration tracer (shared by every voice model). */
  private thinkingTracker: ThinkingTracker | undefined;
  /** Epoch ms the current thinking window opened (for the feed's held duration). */
  private thinkingStartedAt = 0;
  /** True while a "Thinking…" feed row is open, so it can be closed with its paired thought row. */
  private thinkingRowOpen = false;
  /** Full reasoning text surfaced by the model this window (Gemini thought parts). */
  private thinkingContent = "";
  private readonly feed = new ActivityFeed((turn) => {
    // Durably record each committed spoken turn. Only the finalized visible
    // text is emitted here (partials and replays are suppressed), so hidden
    // chain-of-thought never leaks into the run log.
    void this.log?.info("conversation", { speaker: turn.kind, text: turn.text });
    // Observability: record how many Pi dispatches were made since the last
    // turn boundary. The companion has NO native tools — its only job is to
    // talk to the human and delegate to the background agent. A voice turn
    // that *claims* action ("Removing X", "Dispatched") but logged
    // pi_dispatches:0 here is a false confirmation (talked without actually
    // doing anything) — exactly the failure mode reported. This makes the
    // talk-vs-dispatch gap greppable instead of invisible.
    void this.log?.info("voice-turn-actions", { pi_dispatches: this.turnDispatches });
    this.turnDispatches = 0;
  });
  private readonly piLog = new PiLogMirror((event) => {
    // Durably record Pi's observable activity (final text / tool execs / status)
    // into the run log for debugging; reasoning stays hidden upstream.
    void this.log?.info("pi-activity", event);
  });
  private state: VoiceViewState = {
    active: false, status: "off", source: "idle", muted: false, inputTranscript: "", outputTranscript: "", thinking: false, thinkingDisplay: "minimized",
    inputRms: 0, outputRms: 0, audioCaptureDrops: 0, audioQueuedMs: 0, audioRecoveries: 0, audioPhase: "healthy",
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
  private scratchpadViewerOpen = false;
  /** Live dismiss handle for the open viewer so close actions can tear it down programmatically. */
  private dismissScratchpadViewer: (() => void) | undefined;
  private piControl: PiControl | undefined;
  /** Number of run_pi_task delegations since the last turn boundary (turn-action audit). */
  private turnDispatches = 0;
  private interruptionTimes: number[] = [];
  private inputSuppressedUntil = 0;
  private lastAudioRecoveries = 0;
  private playoutMonitor: PlayoutMonitor | undefined;
  /** Live, user-togglable preferences for the current Pi session. */

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
      // A preference persisted in the session branch (canonical restore) wins
      // over the configured default for this voice session.
      this.log = await RunLog.create(this.config.logDir);
      this.thinkingTracker = new ThinkingTracker(thinkingLabel(this.config.provider, this.config.model), { log: createFileLog(this.config.logDir) });
      this.feed.clear();
      this.feed.add("system", `Orb voice · ${this.config.provider}`);
      this.scratchpad = new Scratchpad(ctx.cwd, this.config.scratchpad, this.config.permissions.scratchpadOutsideProject);
      this.piControl = new PiControl(this.pi, this.config.permissions);
      this.interruptionTimes = [];
      this.inputSuppressedUntil = 0;
      this.lastAudioRecoveries = 0;
      this.playoutMonitor = this.createPlayoutMonitor();
      this.playoutMonitor.reset();
      this.state = {
        ...this.state, active: true, status: `starting · ${this.config.provider}`, source: "idle", muted: false, inputTranscript: "", outputTranscript: "",
        thinkingDisplay: this.config.thinkingDisplay,
        inputRms: 0, outputRms: 0, audioCaptureDrops: 0, audioQueuedMs: 0, audioRecoveries: 0, audioPhase: "healthy",
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
   * forwarding capture frames while muted, and the viewer treats the mic as
   * dead: input RMS is clamped to zero and the orb becomes audio-invariant —
   * identical rendering regardless of input level — with the base wave still
   * traveling at its minimum and a gray, compact sphere so muted reads as
   * off. With no explicit target, the current state toggles.
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

  /** The current reasoning-display mode — the single config option `ui.thinkingDisplay`. */
  private currentDisplay(): ThinkingDisplay {
    return this.config?.thinkingDisplay ?? "minimized";
  }

  /** Accessor for consumers: the active reasoning display. */
  get thinkingDisplayPref(): ThinkingDisplay {
    return this.currentDisplay();
  }

  /**
   * Set the reasoning-display mode. Display is driven purely by the `thinkingDisplay`
   * config option (from `ui.thinkingDisplay`); /voice thinking and the toggle just
   * rewrite that one field for the current session — never the config file, never a
   * session entry, never any internal preference store.
   */
  setThinkingDisplay(mode: ThinkingDisplay, ctx?: ExtensionContext): void {
    if (this.config) this.config.thinkingDisplay = mode;
    this.state.thinkingDisplay = mode;
    const label = mode === "full" ? "full thoughts" : mode === "hidden" ? "thinking hidden" : "thinking minimized";
    this.feed.add("system", `Thinking display: ${label}`);
    ctx?.ui.notify?.(`Orb thinking display: ${label}.`, "info");
    void this.log?.info("thinking-display", { mode });
    this.widget?.tick();
  }

  /** Cycle the reasoning display: minimized → full → hidden → … */
  cycleThinkingDisplay(ctx: ExtensionContext): void {
    const order: ThinkingDisplay[] = ["minimized", "full", "hidden"];
    const next = order[(order.indexOf(this.currentDisplay()) + 1) % order.length] ?? "minimized";
    this.setThinkingDisplay(next, ctx);
  }

  /**
   * Rows for the `/voice settings` panel: one editable session toggle plus the
   * durable config values (read-only) currently in effect.
   */
  getVoiceSettings(): VoiceSettingsRow[] {
    return buildVoiceSettings({ thinking: this.currentDisplay(), config: this.config });
  }

  /** Apply an editable row chosen in `/voice settings` (only session toggles). */
  applyVoiceSetting(id: EditableSetting, value: string, ctx?: ExtensionContext): void {
    if (id === "thinking") {
      const mode: ThinkingDisplay = value === "full" ? "full" : value === "hidden" ? "hidden" : "minimized";
      this.setThinkingDisplay(mode, ctx);
    }
  }

  /** Switch the voice live: /voice voice one|list (no name cycles to the next). */  setVoice(voice: string | undefined, ctx: ExtensionContext): void {
    if (!this.state.active || !this.provider || !this.config) {
      ctx.ui.notify("Start Orb voice before switching its voice.", "warning");
      return;
    }
    const config = this.config;
    void (async () => {
      try {
        const providerName = config.provider;
        const options = voiceOptions(providerName);
        if (voice?.trim().toLowerCase() === "list") {
          ctx.ui.notify(`Voices (${providerName}): ${options.join(", ")} — current: ${config.voice}`, "info");
          return;
        }
        const given = voice && voice.trim() ? voice.trim() : undefined;
        const target = given ? resolveVoice(providerName, given) : nextVoice(providerName, config.voice);
        if (!target || !options.includes(target)) {
          ctx.ui.notify(`Unknown voice: "${given}". Available: ${options.join(", ")}`, "warning");
          return;
        }
        await this.provider!.setVoice(target);
        config.voice = target;
        // Speak an introduction so the user can hear (and audition) the new voice.
        void this.provider!.sendText(auditionLine(target), { requestResponse: true });
        ctx.ui.notify(`Orb voice → ${target}`, "info");
        void this.log?.info("voice switched", { voice: target });
      } catch (error) {
        ctx.ui.notify(`Voice switch failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    })();
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

  async scratchpadCommand(action: "open" | "close" | "view" | "edit" | "load" | "save" | "dispatch", argument: string, ctx: ExtensionCommandContext): Promise<void> {
    if (!this.config || !this.scratchpad) { ctx.ui.notify("Start Orb voice before using its scratchpad.", "warning"); return; }
    switch (action) {
      case "open": this.scratchpad.open(argument || undefined); this.showScratchpadViewer(ctx); break;
      case "close": this.scratchpad.close(); this.closeScratchpadViewer(); break;
      case "view": this.showScratchpadViewer(ctx, { notifyIfUnavailable: true }); return;
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

  /** Open the scrollable, markdown-styled scratchpad viewer as a focusable overlay. */
  private showScratchpadViewer(ctx: ExtensionContext, opts: { notifyIfUnavailable?: boolean } = {}): void {
    if (!ctx.hasUI || ctx.mode !== "tui") {
      if (opts.notifyIfUnavailable) ctx.ui.notify("Orb's scratchpad viewer requires Pi's interactive TUI mode.", "warning");
      return;
    }
    const pad = this.scratchpad;
    if (!pad) {
      if (opts.notifyIfUnavailable) ctx.ui.notify("Start Orb voice before using its scratchpad.", "warning");
      return;
    }
    if (this.scratchpadViewerOpen) return;
    this.scratchpadViewerOpen = true;
    let dismiss: (() => void) | undefined;
    void ctx.ui.custom(
      (tui, theme) => {
        const viewer = new ScratchpadViewer(tui, theme, {
          content: () => pad.snapshot().content,
          title: () => pad.snapshot().title,
          onDismiss: () => dismiss?.(),
        });
        const ui = viewer.ui();
        return {
          render: ui.render,
          handleInput: (data: string) => {
            ui.handleInput(data);
            tui.requestRender();
          },
          invalidate: ui.invalidate,
          dispose: () => viewer.dispose(),
        };
      },
      {
        overlay: true,
        overlayOptions: {
          anchor: "right-center",
          width: "44%",
          minWidth: 42,
          maxWidth: 88,
          maxHeight: "94%",
          visible: (termWidth, termHeight) => termWidth >= 60 && termHeight >= 14,
        },
        onHandle: (handle) => {
          handle.focus();
          dismiss = () => { this.scratchpadViewerOpen = false; this.dismissScratchpadViewer = undefined; handle.hide(); };
          this.dismissScratchpadViewer = dismiss;
        },
      },
    );
  }

  /** Best-effort viewer open from a voice tool call; silently no-ops when TUI is unavailable. */
  private tryShowScratchpadViewer(): boolean {
    const ctx = this.ctx;
    if (!ctx || !ctx.hasUI || ctx.mode !== "tui") return false;
    if (!this.scratchpad || this.scratchpadViewerOpen) return false;
    this.showScratchpadViewer(ctx);
    return true;
  }

  /** Programmatically dismiss the viewer overlay (used by the `close` action). Safe to call always. */
  private closeScratchpadViewer(): void {
    this.scratchpadViewerOpen = false;
    const dismiss = this.dismissScratchpadViewer;
    this.dismissScratchpadViewer = undefined;
    dismiss?.();
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
      onThinking: (thinking: boolean) => {
        this.thinkingTracker?.observe(thinking);
        this.state.thinking = thinking;
        if (thinking) {
          this.thinkingStartedAt = Date.now();
          // Surface the pending indicator as a real row only when the display
          // preference is not "hidden" and no conversational turn is streaming.
          // Otherwise this add() would finalize the live partial and split one
          // spoken sentence into several rows (the reported “Morning! Clean” …
          // “Thought for…” … “Morning! Clean, what's next?” torn-turn). While a
          // turn is already being spoken the indicator stays ephemeral (title).
          this.thinkingRowOpen = this.currentDisplay() !== "hidden" && !this.feed.isLive();
          if (this.thinkingRowOpen) this.feed.addNonBoundary("thinking", "Thinking…");
        } else {
          const held = this.thinkingStartedAt ? Date.now() - this.thinkingStartedAt : 0;
          this.thinkingStartedAt = 0;
          const content = this.thinkingContent.trim();
          this.thinkingContent = "";
          // Close the pair with the non-boundary push so it never finalizes a
          // turn that has started streaming (start guard). We always want to
          // close an open “Thinking…” row rather than leave it dangling. The
          // row carries the FULL thought; minimal/hidden are applied when the
          // widget renders, so toggling the preference updates every row at once.
          if (this.thinkingRowOpen) {
            this.feed.addNonBoundary("thinking", `Thought for ${held}ms${content ? ` · ${content}` : ""}`);
          }
          this.thinkingRowOpen = false;
        }
        this.widget?.tick();
      },
      onThinkingContent: (text: string) => { this.thinkingContent = text; },
      onError: (error: Error) => this.reportError(error, "provider"),
      onSessionEnded: (reason: string) => { void this.handleFriendlySessionEnd(reason).catch((error) => this.reportError(asError(error), "session end")); },
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
        void this.log?.info("voice tool read_pi_log", { entries: snapshot.status, revision: snapshot.revision, visible_chars: snapshot.text.length });
        result = { ok: true, status: snapshot.status, revision: snapshot.revision, log: snapshot.text };
      } else if (call.name === "observe_pi") result = await this.toolObservePi(call);
      else if (call.name === "control_pi") result = await this.toolControlPi(call);
      else if (call.name === "read_herdr_pane") result = await this.toolHerdrPane(call);
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
    this.turnDispatches++;
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
      void this.log?.info("voice tool observe_pi", { until, after, timeout_ms: timeout, timed_out: snapshot.revision <= after, status: snapshot.status });
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
      case "open": pad.open(stringArg(call, "title") || undefined); this.tryShowScratchpadViewer(); break;
      case "view": pad.open(); this.tryShowScratchpadViewer(); break;
      case "close": pad.close(); this.closeScratchpadViewer(); break;
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
    void this.log?.info("voice tool scratchpad", {
      action,
      ok: result.ok !== false,
      ...(typeof result.path === "string" ? { path: result.path } : {}),
      ...(result.ok && "dispatched_characters" in result ? { dispatched_characters: result.dispatched_characters } : {}),
      characters: snapshot.content.length,
    });
    return { ...result, scratchpad: { ...snapshot, content: snapshot.content.slice(0, 120_000) } };
  }

  /**
   * Read recent output of an open herdr pane (convenient log retrieval). When
   * no pane_id is given, first lists the open panes so the voice agent can
   * confirm which pane the human means. Availability is contingent on herdr
   * being installed — a missing/unreachable binary is reported as such rather
   * than a generic failure, so the companion can tell the human exactly why.
   */
  private async toolHerdrPane(call: ToolCall): Promise<Record<string, unknown>> {
    const paneId = stringArg(call, "pane_id").trim();
    const rawSource = stringArg(call, "source");
    const source: HerdrReadSource = (HERDR_READ_SOURCES as readonly string[]).includes(rawSource)
      ? (rawSource as HerdrReadSource)
      : "recent-unwrapped";
    const lines = bounded(call.arguments.lines, HERDR_DEFAULT_LINES, 1, HERDR_MAX_LINES);

    // With no pane selected, hand the agent the pane catalog so it can choose.
    if (!paneId) {
      const listed = await listHerdrPanes();
      if (!listed.ok) {
        return { ok: false, ...(listed.installed ? {} : { installed: false }), error: listed.error ?? "could not list herdr panes", ...(listed.installed ? {} : { hint: "Install or start herdr, then ask again." }) };
      }
      void this.log?.info("voice tool read_herdr_pane", { action: "list", panes: listed.panes.length });
      return {
        ok: true,
        action: "list",
        panes: listed.panes.map((p) => ({ pane_id: p.pane_id, tab_id: p.tab_id, workspace_id: p.workspace_id, agent: p.agent, cwd: p.cwd, terminal_title: p.terminal_title ?? p.terminal_title_stripped })),
      };
    }

    const read = await readHerdrPane(paneId, { lines, source });
    void this.log?.info("voice tool read_herdr_pane", {
      pane_id: read.pane_id, source: read.source, lines: read.lines, ok: read.ok,
      chars: read.log.length, truncated: read.truncated, installed: read.installed,
    });
    if (!read.ok) {
      return {
        ok: false,
        pane_id: read.pane_id,
        ...(read.installed ? {} : { installed: false, hint: "Install herdr, then re-run." }),
        error: read.error ?? "could not read herdr pane",
      };
    }
    return { ok: true, pane_id: read.pane_id, source: read.source, lines: read.lines, truncated: read.truncated, log: read.log };
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
    if (levels.recoveries > this.lastAudioRecoveries) this.lastAudioRecoveries = levels.recoveries;
    this.state.source = levels.outputRms > inputRms && levels.outputRms > 0.01 ? "agent" : inputRms > 0.01 ? "user" : "idle";
    // Auto-detection of sustained choppiness and (when the mic starves with the
    // speaker) automatic input resync. Pure observability + scheduled recovery;
    // the graphic playout fix lives in the Go sidecar's adaptive buffer.
    this.playoutMonitor?.publish(levels);
    this.state.audioPhase = this.playoutMonitor?.snapshot().phase ?? "healthy";
  }

  /**
   * Build the sustained-choppiness monitor. The detector watches the sidecar's
   * underrun-recovery counter: one recovery is a normal transient stall, a
   * cluster inside the window is choppiness. Recovery functions via three
   * levers: (1) the Go buffer itself accelerates re-prime and relaxes inflated
   * latency; (2) on ChoppyStart we surface the state + durable log; (3) if the
   * microphone dropped frames during the same trade, we resync the input path
   * so the next human turn starts clean.
   */
  private createPlayoutMonitor(): PlayoutMonitor {
    const audio = this.config?.audio;
    return new PlayoutMonitor(
      {
        onChoppyStart: (episode, queuedMs) => {
          this.feed.add("system", `Audio choppy · auto-recovering`);
          this.state.status = "audio choppy · adjusting";
          void this.log?.info("audio choppiness detected", { episode, queuedMs, peakQueuedMs: this.playoutMonitor?.snapshot().peakQueuedMs, recoveries: this.lastAudioRecoveries, captureDrops: this.state.audioCaptureDrops });
          this.widget?.tick();
        },
        onRecovered: (episode, lagMs) => {
          void this.log?.info("audio playout recovered", { episode, lagMs, peakQueuedMs: this.playoutMonitor?.snapshot().peakQueuedMs, recoveries: this.lastAudioRecoveries, queuedMs: this.state.audioQueuedMs });
          this.state.status = "live · listening";
          this.widget?.tick();
        },
        onAudioStall: (gapMs, queuedMs) => {
          // A gap between level heartbeats means the audio stream (or the main
          // loop) stopped feeding output for a visible interval — factual
          // evidence of a stall even when no explicit underrun was counted.
          void this.log?.info("audio stream stall detected", { gapMs, queuedMs });
        },
        onAutoResyncInput: (reason) => this.autoResyncInput(reason),
      },
      {
        windowRecoveries: audio?.choppinessWindowRecoveries ?? 3,
        windowMs: audio?.choppinessWindowMs ?? 1500,
        recoverSilenceMs: audio?.choppinessRecoverSilenceMs ?? 1500,
        stallGapMs: audio?.stallGapMs ?? 150,
        inputResyncDrops: audio?.inputResyncDrops ?? 3,
        inputResyncWindowMs: audio?.inputResyncWindowMs ?? 1500,
        inputResyncCooldownMs: audio?.inputResyncCooldownMs ?? 4000,
      },
    );
  }

  /**
   * Automatic input-path recovery: the mic dropped frames while output was
   * choppy (the same main-thread stall starved both). Reset the resampler to a
   * fresh partial-frame boundary and flush stale pending input so the next
   * human turn starts from clean audio instead of a garbled half-sentence.
   */
  private autoResyncInput(reason: string): void {
    this.inputAdapter?.reset();
    this.feed.add("system", "Microphone resynced · audio continuity restored");
    void this.log?.info("audio input resynced", { reason, captureDrops: this.state.audioCaptureDrops });
    this.widget?.tick();
  }

  private reportError(error: Error, area: string): void {
    this.state.error = `${area}: ${error.message}`;
    this.state.status = "error · see diagnostics";
    this.state.thinking = false;
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
    this.state = { ...this.state, active: false, status: options.keepError ? "stopped after error" : "off", source: "idle", muted: false, thinking: false, inputTranscript: "", outputTranscript: "", inputRms: 0, outputRms: 0, error: options.keepError };
    ctx?.ui.setStatus("orb-voice", undefined);
    ctx?.ui.setWidget("orb-voice", undefined);
    this.widget = undefined;
    this.delegated.reset();
    if (!options.quiet) ctx?.ui.notify("Orb voice stopped.", "info");
    await this.log?.info("Orb voice stopped");
  }
}

/** Collapse, trim leading dangles, then cap a reasoning snippet for the feed. */
function toolLabel(call: ToolCall): string {
  if (call.name === "run_pi_task") return `delegate to Pi${typeof call.arguments.summary === "string" && call.arguments.summary.trim() ? ` · ${call.arguments.summary.trim().slice(0, 80)}` : ""}`;
  if (call.name === "read_pi_log") return "check Pi result";
  if (call.name === "observe_pi") return `wait for Pi · ${call.arguments.until ?? "settled"}`;
  if (call.name === "control_pi") return "cancel Pi";
  if (call.name === "read_herdr_pane") return typeof call.arguments.pane_id === "string" && String(call.arguments.pane_id).trim() ? `read herdr ${String(call.arguments.pane_id)}` : "list herdr panes";
  if (call.name === "scratchpad") return `scratchpad · ${String(call.arguments.action ?? "read")}`;
  return call.name;
}
function toolResultLabel(name: string, result: Record<string, unknown>): string {
  if (result.ok === false) return `${name}: ${String(result.error ?? "failed")}`;
  if (name === "run_pi_task") return result.queued ? "Pi task queued" : "Pi task started";
  if (name === "observe_pi") return `Pi ${String(result.status ?? "observed")}`;
  if (name === "read_pi_log") return "Pi result checked";
  if (name === "control_pi") return "Pi cancelled";
  if (name === "read_herdr_pane") return result.ok === false ? `herdr ${String(result.error ?? "failed")}` : "herdr pane read";
  if (name === "scratchpad") return "scratchpad updated";
  return name;
}
function bounded(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.floor(parsed))) : fallback;
}
function stringArg(call: ToolCall, key: string): string { return typeof call.arguments[key] === "string" ? String(call.arguments[key]) : ""; }
function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
