import { GoogleGenAI } from "@google/genai";
import { geminiCodingTools } from "../agent-tools.js";
import { geminiOrchestrationTools } from "../orchestration-tools.js";
import type { RunLog } from "../log.js";
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
  /** Deduplicate function calls re-delivered across a GoAway/reconnect/resume. */
  private readonly handledCalls = new Set<string>();
  private thinking = false;
  /** True once the current model turn has begun generating (used for the thinking indicator). */
  private orbInTurn = false;
  /** Earliest wall-clock ms the "Thinking" indicator may be cleared (min-visible hold). */
  private thinkHoldUntil = 0;
  /** Deferred clear timer used to guarantee the indicator is painted before it clears. */
  private thinkHoldTimer: ReturnType<typeof setTimeout> | undefined;
  /** Only log the first reasoning batch per session to confirm thoughts arrive. */
  private thoughtLogged = false;
  /** Concatenated reasoning text for the current turn (thought parts), capped. */
  private thoughtBuffer = "";
  constructor(private readonly config: VoiceConfig, private readonly log: RunLog) { super(); }

  async connect(sink: VoiceProviderSink, context: VoiceSessionContext): Promise<void> {
    this.sink = sink;
    this.context = context;
    this.closed = false;
    this.client = new GoogleGenAI({ apiKey: this.config.apiKey });
    sink.onStatus(`connecting · Gemini · ${this.config.model}`);
    await this.log.info("connecting provider", { provider: this.name, model: this.config.model, resumption: this.config.geminiSessionResumption, compression: this.config.geminiContextCompression, thinkingBudget: this.config.geminiThinkingBudget, thinkingHoldMs: this.config.geminiThinkingHoldMs });
    await this.openSession("");
    const environment = `PI_CODING_CONTEXT\nProject cwd: ${context.cwd}\nPi status: ${context.piStatus}\nRecent visible Pi activity:\n${context.recentPiActivity}`;
    this.sendText(environment);
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
    this.clearThinkHold();
    try { this.session?.close(); } catch { /* idempotent */ }
    this.session = undefined;
    await this.log.info("Gemini provider closed");
  }

  /** Switch voice by re-opening the live socket with a new speechConfig.
   * No agent-context reload needed: Gemini reconnects with chat history via
   * the resume handle when available, otherwise starts a fresh session. */
  async setVoice(voice: string): Promise<void> {
    if (voice === this.config.voice) return;
    this.config.voice = voice;
    const handle = this.resumeHandle;
    const old = this.session;
    this.session = undefined;
    this.sink?.onStatus(`switching voice · ${voice}`);
    await this.log.info("switching Gemini voice", { voice });
    try { old?.close(); } catch { /* idempotent */ }
    await this.openSession(handle);
    this.sink?.onStatus("live · listening");
  }

  private async openSession(handle: string): Promise<void> {
    const client = this.client;
    if (!client) throw new Error("Gemini client is unavailable");
    const epoch = ++this.epoch;
    this.thinking = false;
    this.orbInTurn = false;
    this.clearThinkHold();
    this.thoughtLogged = false;
    this.sink?.onThinking?.(false);
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
          if (this.reconnecting || isExpectedGeminiRotationError(reason)) { this.triggerReconnect("connection rotation"); return; }
          if (this.config.geminiSessionResumption && this.resumeHandle) { this.triggerReconnect("unexpected connection close"); return; }
          this.endFriendly(reason || "The realtime provider closed the session.");
        },
      },
      config: buildGeminiLiveConfig(this.config, handle, geminiTools(this.config)),
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
    // A spoken commitment ("dispatching now") and its own function call can
    // arrive in the same message (or adjacent messages). A failure while
    // translating transcripts/audio must NEVER swallow the already-emitted
    // tool calls — that is exactly how a verbal commitment is left with nothing
    // executed. Each zone below is fenced, and function calls always run last
    // no matter what earlier zones hit.
    try {
      const update = message?.sessionResumptionUpdate;
      if (update?.resumable && typeof update?.newHandle === "string" && update.newHandle) {
        this.resumeHandle = update.newHandle;
      }
      if (message?.goAway) {
        await this.log.info("gemini GoAway received", { timeLeft: message.goAway?.timeLeft ?? null, resumable: Boolean(this.resumeHandle) });
        this.triggerReconnect("server GoAway");
      }
    } catch (error) {
      await this.log.error("Gemini GoAway/update failed", asError(error));
    }

    try {
      const server = message?.serverContent;
      const interrupted = Boolean(server?.interrupted);
      const boundary = Boolean(server?.turnComplete || server?.generationComplete);

      // Gemini Live publishes no dedicated "generation started" event, so the
      // thinking indicator is driven by the model's actual reasoning output: when
      // thinking ((`thinkingConfig`/`includeThoughts`) is enabled the server surfaces
      // `thought` parts (part.thought === true) at the start of a reply, and we hold
      // "Thinking" until the first real output chunk. User-only transcription
      // messages never open a model turn, so they never flash "Thinking".
      const modelThought = Boolean(server?.modelTurn?.parts?.some((p: any) => p?.thought === true));
      if (modelThought && !this.thoughtLogged) {
        this.thoughtLogged = true;
        void this.log.info("Gemini thought parts received", { text: server?.modelTurn?.parts?.filter((p: any) => p?.thought === true).map((p: any) => p?.text).filter(Boolean).slice(0, 1) });
      }
      if (modelThought) {
        // Surface the model's reasoning text (Gemini thought parts) to the UI so
        // the controller can show a real snippet of what it's pondering, not just
        // the on/off toggle.
        const frag = (server?.modelTurn?.parts?.filter((p: any) => p?.thought) ?? []).map((p: any) => p?.text ?? "").join(" ").trim();
        if (frag) {
          // Accumulate the FULL reasoning text (no cap) so the controller can
          // render the complete thought when the user's display preference is
          // "full" — truncation happens at render time, not here.
          this.thoughtBuffer = this.thoughtBuffer ? `${this.thoughtBuffer} ${frag}` : frag;
          this.sink?.onThinkingContent?.(this.thoughtBuffer);
        }
      }
      const modelActivity = Boolean(server?.modelTurn) || typeof server?.outputTranscription?.text === "string" || modelThought;
      const deliversContent = Boolean(server?.modelTurn?.parts?.some((p: any) => typeof p?.inlineData?.data === "string" && p.inlineData.data.length > 0)) || typeof server?.outputTranscription?.text === "string";
      if (interrupted || boundary) {
        this.orbInTurn = false;
        this.emitThinking(false);
      } else if (modelActivity) {
        if (!this.orbInTurn) {
          // A model turn is opening. Always surface the thinking indicator
          // immediately, and hold it for at least a beat — even when this
          // first message already carries output (Gemini streams the opening
          // audio chunk in the turn-starting serverContent). Previously the
          // on→off pair fired in this same message, so the controller landed
          // on `thinking=false` before the widget ever painted, and an ordinary
          // immediate reply to a human never showed "Thinking…".
          this.orbInTurn = true;
          this.thoughtBuffer = "";
          this.emitThinking(true);
        } else if (modelThought) {
          // Reasoning is still in progress (thought parts, no audio yet): hold the
          // indicator until the first audio/transcript content in a later message.
          this.orbInTurn = true;
          this.emitThinking(true);
        } else if (deliversContent) {
          // Turn is already open and is now delivering output: the reasoning
          // window ends (spared the very message that opened the indicator).
          this.emitThinking(false);
        }
      }

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

      // turnComplete can arrive in a separate message from the final transcript
      // fragment. Flush accumulators here so a later human/Orb turn is never
      // appended to the previous paragraph.
      if (boundary) {
        if (this.inputTranscript.trim()) this.sink?.onInputTranscript(this.inputTranscript, true);
        if (this.outputTranscript.trim()) this.sink?.onOutputTranscript(this.outputTranscript, true);
        this.inputTranscript = "";
        this.outputTranscript = "";
        this.sink?.onAudioEnd();
      }
    } catch (error) {
      // A transcript/audio hiccup must not drop an already-emitted tool call:
      // log it and continue on to process function calls.
      const normalized = asError(error);
      await this.log.error("Gemini transcript/audio update failed", normalized);
      if (!this.reconnecting) this.sink?.onError(normalized);
    }

    // Tool calls always execute, per-message, even if a sibling call or the
    // transcript/audio fence above threw.
    await this.processToolCalls(message?.toolCall?.functionCalls);
  }

  private emitThinking(value: boolean): void {
    if (this.thinking === value) return;
    if (value) {
      // Opening the indicator: record the minimum-visible hold so a model that
      // delivers its first audio in the same event batch (flash-live) cannot
      // clear "Thinking" before the widget has a chance to paint it.
      this.clearThinkHold();
      this.thinking = true;
      this.thinkHoldUntil = Date.now() + this.config.geminiThinkingHoldMs;
      this.sink?.onThinking?.(true);
      return;
    }
    // Clearing the indicator.
    const remaining = this.thinkHoldUntil - Date.now();
    if (this.config.geminiThinkingHoldMs > 0 && remaining > 0 && !this.thinkHoldTimer) {
      // Sequence may have gone on→off within one paint cycle: defer the clear so
      // the widget renders at least one frame with the indicator visible.
      this.thinkHoldTimer = setTimeout(() => {
        this.thinkHoldTimer = undefined;
        this.thinkHoldUntil = 0;
        if (this.thinking) {
          this.thinking = false;
          this.sink?.onThinking?.(false);
        }
      }, remaining);
      return;
    }
    this.clearThinkHold();
    this.thinking = false;
    this.sink?.onThinking?.(false);
  }

  /** Cancel any pending minimum-visible hold (e.g. reconnect, close, re-open). */
  private clearThinkHold(): void {
    if (this.thinkHoldTimer !== undefined) { clearTimeout(this.thinkHoldTimer); this.thinkHoldTimer = undefined; }
    this.thinkHoldUntil = 0;
  }

  private async processToolCalls(calls: unknown): Promise<void> {
    if (Array.isArray(calls) && calls.length > 0) this.emitThinking(false);
    for (const raw of Array.isArray(calls) ? calls : []) {
      const call: ToolCall = {
        id: String((raw as any)?.id ?? (raw as any)?.callId ?? ""),
        name: String((raw as any)?.name ?? ""),
        arguments: (raw as any)?.args && typeof (raw as any).args === "object" ? (raw as any).args : {},
      };
      // Guard against re-delivery across a GoAway/reconnect/resume: executing
      // an idempotent dispatch twice is worse than skipping a repeat.
      if (call.id) {
        if (this.handledCalls.has(call.id)) continue;
        this.handledCalls.add(call.id);
        if (this.handledCalls.size > 256) { const v = this.handledCalls.values().next().value; if (typeof v === "string") this.handledCalls.delete(v); }
      }
      try {
        const result = await this.sink!.onToolCall(call);
        this.sendToolResponse(call, result);
      } catch (error) {
        const normalized = asError(error);
        await this.log.error("Gemini tool call execution failed", normalized);
        // Answer the model so it never stalls waiting for a tool result.
        this.sendToolResponse(call, { ok: false, error: normalized.message });
      }
    }
  }

  /** Best-effort send of the tool result; session may have rotated mid-call. */
  private sendToolResponse(call: ToolCall, response: Record<string, unknown>): void {
    try { this.session?.sendToolResponse({ functionResponses: [{ id: call.id, name: call.name, response }] }); }
    catch (error) { if (this.closed) return; const n = asError(error); this.sink?.onError(n); void this.log.error("Gemini tool response failed", n); }
  }

  /** Fire-and-forget reconnect that logs instead of surfacing an unhandled rejection. */
  private triggerReconnect(reason: string): void {
    Promise.resolve(this.reconnect(reason)).catch((error) => {
      const normalized = asError(error);
      if (!this.closed) this.sink?.onError(normalized);
      void this.log.error("Gemini reconnect failed", normalized);
    });
  }


  private endFriendly(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try { this.session?.close(); } catch {}
    this.sink?.onSessionEnded(reason);
  }
}

function geminiTools(config: VoiceConfig): Record<string, unknown>[] {
  return [
    ...geminiOrchestrationTools(),
    ...(config?.permissions?.nativeTools ? geminiCodingTools() : []),
  ];
}

function asError(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }
