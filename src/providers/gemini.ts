import { GoogleGenAI } from "@google/genai";
import type { RunLog } from "../log.js";
import { greetingCue } from "../policy.js";
import type { ToolCall, VoiceConfig, VoiceProvider, VoiceProviderSink, VoiceSessionContext } from "../types.js";
import { BaseProvider } from "./base.js";
import { isExpectedGeminiRotationError, mergeTranscript } from "./util.js";
import { buildGeminiLiveConfig } from "./gemini-config.js";

export class GeminiLiveProvider extends BaseProvider implements VoiceProvider {
  readonly name = "gemini" as const;
  readonly inputSampleRate = 16_000;
  private session: any;
  private client?: GoogleGenAI;
  private context?: VoiceSessionContext;
  private resumeHandle = "";
  private epoch = 0;
  private reconnecting: Promise<void> | undefined;

  constructor(private readonly config: VoiceConfig, private readonly log: RunLog) { super(); }

  async connect(sink: VoiceProviderSink, context: VoiceSessionContext): Promise<void> {
    this.sink = sink;
    this.context = context;
    this.closed = false;
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey });
    sink.onStatus(`connecting · Gemini · ${this.config.model}`);
    await this.log.info("connecting provider", { provider: this.name, model: this.config.model, resumption: this.config.geminiSessionResumption, compression: this.config.geminiContextCompression });
    await this.openSession("");
    const environment = `PI_CODING_CONTEXT\nProject cwd: ${context.cwd}\nPi status: ${context.piStatus}\nRecent visible Pi activity:\n${context.recentPiActivity}`;
    const greeting = this.config.greetingEnabled ? `\n\n${greetingCue()}` : "";
    this.sendText(`${environment}${greeting}`, { requestResponse: this.config.greetingEnabled });
  }

  sendAudio(pcm: Buffer): void {
    if (!this.session || this.closed || pcm.length === 0) return;
    try { this.session.sendRealtimeInput({ audio: { data: pcm.toString("base64"), mimeType: "audio/pcm;rate=16000" } }); }
    catch (error) { if (!this.reconnecting) this.sink?.onError(asError(error)); }
  }

  sendText(text: string, _options?: { requestResponse?: boolean }): void {
    if (!this.session || this.closed || !text.trim()) return;
    try { this.session.sendRealtimeInput({ text }); }
    catch (error) { if (!this.reconnecting) this.sink?.onError(asError(error)); }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.epoch++;
    try { this.session?.close(); } catch { /* idempotent */ }
    this.session = undefined;
    await this.log.info("Gemini provider closed");
  }

  private async openSession(handle: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error("Gemini client is unavailable");
    const epoch = ++this.epoch;
    const session = await client.live.connect({
      model: this.config.model,
      callbacks: {
        onopen: () => { if (epoch === this.epoch && !this.closed) this.sink?.onStatus(handle ? "live · resumed" : "live · listening"); },
        onmessage: (message: any) => { if (epoch === this.epoch && !this.closed) void this.handleMessage(message); },
        onerror: (event: any) => {
          if (epoch !== this.epoch || this.closed) return;
          const error = new Error(event?.message ?? "Gemini Live connection error");
          if (this.reconnecting || isExpectedGeminiRotationError(error.message)) { void this.log.info("Gemini connection rotating", { message: error.message }); return; }
          this.sink?.onError(error);
          void this.log.error("Gemini error", error);
        },
        onclose: (event: any) => {
          if (epoch !== this.epoch || this.closed) return;
          const reason = String(event?.reason ?? "");
          if (this.reconnecting || isExpectedGeminiRotationError(reason)) { void this.reconnect("connection rotation"); return; }
          if (this.config.geminiSessionResumption && this.resumeHandle) { void this.reconnect("unexpected connection close"); return; }
          this.endFriendly(reason || "The realtime provider closed the session.");
        },
      },
      config: buildGeminiLiveConfig(this.config, handle, geminiTools()),
    });
    if (epoch !== this.epoch || this.closed) { try { session.close(); } catch {} return; }
    this.session = session;
  }

  private async reconnect(reason: string): Promise<void> {
    if (this.closed) return;
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = (async () => {
      const handle = this.resumeHandle;
      if (!this.config.geminiSessionResumption || !handle) {
        this.endFriendly("Gemini rotated the realtime connection before a resumable session handle was available.");
        return;
      }
      const old = this.session;
      this.session = undefined;
      this.sink?.onStatus("refreshing · Gemini session");
      await this.log.info("Gemini session reconnecting", { reason });
      // Close the expiring socket promptly after GoAway instead of waiting for
      // the replacement handshake. Gemini may abort clients that leave the
      // old connection open past the advertised timeLeft window.
      try { old?.close(); } catch {}
      try {
        await this.openSession(handle);
        this.sink?.onStatus("live · listening");
        await this.log.info("Gemini session resumed");
      } catch (error) {
        const normalized = asError(error);
        await this.log.error("Gemini session resumption failed", normalized);
        this.endFriendly("Gemini ended the long-running voice session. Run /voice when you're ready to continue.");
      }
    })().finally(() => { this.reconnecting = undefined; });
    return this.reconnecting;
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      const update = message?.sessionResumptionUpdate;
      if (update?.resumable && typeof update?.newHandle === "string" && update.newHandle) {
        this.resumeHandle = update.newHandle;
      }
      if (message?.goAway) {
        await this.log.info("Gemini GoAway received", { timeLeft: message.goAway?.timeLeft ?? null, resumable: Boolean(this.resumeHandle) });
        void this.reconnect("server GoAway");
      }

      const server = message?.serverContent;
      const interrupted = Boolean(server?.interrupted);
      const boundary = Boolean(server?.turnComplete || server?.generationComplete);
      if (interrupted) {
        // Commit the interrupted spoken turn before clearing playback. This
        // keeps the activity transcript as one chronological Orb turn instead
        // of creating a duplicate late-final row after the interruption.
        if (this.outputTranscript.trim()) {
          this.sink?.onOutputTranscript(this.outputTranscript, true);
          this.outputTranscript = "";
        }
        this.sink?.onInterruption("server barge-in");
      }

      const inputText = server?.inputTranscription?.text;
      if (typeof inputText === "string") {
        const merged = mergeTranscript(this.inputTranscript, inputText);
        this.sink?.onInputTranscript(merged, boundary);
        this.inputTranscript = boundary ? "" : merged;
      }
      const outputText = server?.outputTranscription?.text;
      if (typeof outputText === "string") {
        const merged = mergeTranscript(this.outputTranscript, outputText);
        this.sink?.onOutputTranscript(merged, boundary);
        this.outputTranscript = boundary ? "" : merged;
      }

      // An interrupted server turn is cancelled. Do not enqueue any PCM that
      // happens to share the interruption message; it belongs to the response
      // we just cleared from the hardware queue.
      if (!interrupted) {
        for (const part of server?.modelTurn?.parts ?? []) {
          const data = part?.inlineData?.data;
          if (typeof data === "string" && data.length > 0) this.sink?.onAudio(Buffer.from(data, "base64"));
        }
      }

      // Gemini can send turnComplete in a separate message from the final
      // transcription fragment. Flush both transcript accumulators here so a
      // later human/Orb turn can never be appended to the previous paragraph.
      if (boundary) {
        if (this.inputTranscript.trim()) this.sink?.onInputTranscript(this.inputTranscript, true);
        if (this.outputTranscript.trim()) this.sink?.onOutputTranscript(this.outputTranscript, true);
        this.inputTranscript = "";
        this.outputTranscript = "";
        this.sink?.onAudioEnd();
      }

      const calls = message?.toolCall?.functionCalls ?? [];
      for (const raw of Array.isArray(calls) ? calls : []) {
        const call: ToolCall = { id: String(raw.id ?? raw.callId ?? ""), name: String(raw.name ?? ""), arguments: raw.args && typeof raw.args === "object" ? raw.args : {} };
        const response = await this.sink!.onToolCall(call);
        this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response }] });
      }
    } catch (error) {
      const normalized = asError(error);
      if (!this.reconnecting) this.sink?.onError(normalized);
      await this.log.error("Gemini message handler failed", normalized);
    }
  }

  private endFriendly(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try { this.session?.close(); } catch {}
    this.sink?.onSessionEnded(reason);
  }
}

function geminiTools(): Record<string, unknown>[] {
  return [
    {
      name: "run_pi_task",
      description: "Delegate a complete coding task directly to Pi. Use proactively for project exploration, implementation, debugging, tests, refactoring, documentation, specs, and other engineering work.",
      parameters: { type: "OBJECT", properties: { instruction: { type: "STRING", description: "Complete, autonomous engineering instruction for Pi." }, summary: { type: "STRING", description: "Optional short human-readable label for the delegated task." } }, required: ["instruction"] },
    },
    { name: "read_pi_log", description: "Read recent visible Pi conversation and tool results when factual project state is needed. Hidden reasoning is excluded.", parameters: { type: "OBJECT", properties: { max_entries: { type: "NUMBER" } } } },
    { name: "observe_pi", description: "Wait for Pi activity or until Pi settles. Use after delegating work instead of asking the human to tell you when it is done.", parameters: { type: "OBJECT", properties: { after_revision: { type: "NUMBER" }, until: { type: "STRING" }, timeout_ms: { type: "NUMBER" }, max_entries: { type: "NUMBER" } } } },
    {
      name: "control_pi",
      description: "Control the Pi harness directly. Actions: cancel an active run, list/set the Pi model, change thinking level, or run a shell command when permissions allow it. Use cancel immediately when the human changes direction.",
      parameters: { type: "OBJECT", properties: { action: { type: "STRING", description: "cancel | list_models | set_model | set_thinking | list_tools | set_tools | shell" }, model: { type: "STRING" }, level: { type: "STRING" }, tools: { type: "ARRAY", items: { type: "STRING" } }, command: { type: "STRING" }, timeout_ms: { type: "NUMBER" } }, required: ["action"] },
    },
    {
      name: "scratchpad",
      description: "Manage Orb's ephemeral collaborative scratchpad. Actions: open, read, replace, append, load, save, dispatch, close. Dispatch sends either provided content or the whole scratchpad to Pi as a task.",
      parameters: { type: "OBJECT", properties: { action: { type: "STRING" }, title: { type: "STRING" }, content: { type: "STRING" }, path: { type: "STRING" }, summary: { type: "STRING" } }, required: ["action"] },
    },
  ];
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
