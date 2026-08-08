import WebSocket from "ws";
import { openAIOrchestrationTools } from "../orchestration-tools.js";
import type { RunLog } from "../log.js";
import type { ToolCall, VoiceConfig, VoiceProvider, VoiceProviderSink, VoiceSessionContext } from "../types.js";
import { BaseProvider } from "./base.js";
import { mergeTranscript, safeJsonParse } from "./util.js";

export class OpenAIRealtimeProvider extends BaseProvider implements VoiceProvider {
  readonly name = "openai" as const;
  readonly inputSampleRate = 24_000;
  private socket?: WebSocket;
  private ready = false;
  private readonly functionNames = new Map<string, string>();
  private readonly handledCalls = new Set<string>();
  private discardInterruptedAudio = false;
  private thinking = false;

  constructor(private readonly config: VoiceConfig, private readonly log: RunLog) {
    super();
  }

  async connect(sink: VoiceProviderSink, context: VoiceSessionContext): Promise<void> {
    this.sink = sink;
    sink.onStatus(`connecting · OpenAI · ${this.config.model}`);
    await this.log.info("connecting provider", { provider: this.name, model: this.config.model });

    const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.config.model)}`;
    const socket = new WebSocket(url, { headers: { Authorization: `Bearer ${this.config.apiKey}` } });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      socket.once("error", onError);
      socket.once("open", () => {
        socket.off("error", onError);
        resolve();
      });
    });

    socket.on("message", (data) => void this.handleMessage(data.toString()));
    socket.on("error", (error) => {
      sink.onError(error);
      void this.log.error("OpenAI socket error", error);
    });
    socket.on("close", (code, reason) => {
      if (this.closed) return;
      const error = new Error(`OpenAI Realtime disconnected (${code})${reason.length ? `: ${reason.toString()}` : ""}`);
      sink.onError(error);
      void this.log.error("OpenAI socket closed unexpectedly", { code, reason: reason.toString() });
    });

    this.sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: this.config.systemPrompt,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24_000 },
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 180,
              silence_duration_ms: 650,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { format: { type: "audio/pcm" }, voice: this.config.voice },
        },
        tools: [...openAIOrchestrationTools()],
        tool_choice: "auto",
      },
    });
    this.ready = true;
    sink.onStatus("live · listening");

    const environment = `PI_CODING_CONTEXT\nProject cwd: ${context.cwd}\nPi status: ${context.piStatus}\nRecent visible Pi activity:\n${context.recentPiActivity}`;
    this.sendText(environment);
  }

  sendAudio(pcm: Buffer): void {
    if (!this.ready || this.closed || pcm.length === 0) return;
    this.sendEvent({ type: "input_audio_buffer.append", audio: pcm.toString("base64") });
  }

  sendText(text: string, options?: { requestResponse?: boolean }): void {
    if (!this.ready || this.closed || !text.trim()) return;
    this.sendEvent({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text }] },
    });
    if (options?.requestResponse !== false) this.sendEvent({ type: "response.create" });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.ready = false;
    try { this.socket?.close(1000, "voice mode stopped"); } catch { this.socket?.terminate(); }
    await this.log.info("OpenAI provider closed");
  }

  /** Switch voice live via session.update; no reconnect or context reload. */
  async setVoice(voice: string): Promise<void> {
    const previous = this.config.voice;
    if (voice === previous) return;
    this.config.voice = voice;
    try {
      await this.log.info("switching OpenAI voice", { voice });
      this.sendEvent({
        type: "session.update",
        session: { audio: { output: { voice } } },
      });
    } catch (error) {
      this.config.voice = previous;
      throw error;
    }
  }

  private async handleMessage(raw: string): Promise<void> {
    try {
      // The OpenAI realtime wire payloads are untyped; read only the fields we
      // use, keeping the rest unknown so nothing unsafe slips through.
      const event = JSON.parse(raw) as {
        type?: string;
        delta?: unknown;
        transcript?: unknown;
        response?: { output?: Array<Record<string, unknown>> };
        error?: { message?: unknown };
        item?: { type?: string; call_id?: unknown; name?: unknown };
      } & Record<string, unknown>;
      switch (event.type) {
        case "session.created":
        case "session.updated":
          this.sink?.onStatus("live · listening");
          break;
        case "input_audio_buffer.speech_started":
          this.discardInterruptedAudio = true;
          this.emitThinking(false);
          if (this.outputTranscript.trim()) { this.sink?.onOutputTranscript(this.outputTranscript, true); this.outputTranscript = ""; }
          this.sink?.onInterruption("server barge-in");
          break;
        case "response.created":
          this.discardInterruptedAudio = false;
          this.emitThinking(true);
          break;
        case "conversation.item.input_audio_transcription.delta":
          this.inputTranscript = mergeTranscript(this.inputTranscript, String(event.delta ?? ""));
          this.sink?.onInputTranscript(this.inputTranscript, false);
          break;
        case "conversation.item.input_audio_transcription.completed":
          this.sink?.onInputTranscript(String(event.transcript ?? this.inputTranscript), true);
          this.inputTranscript = "";
          break;
        case "response.output_audio.delta":
        case "response.audio.delta":
          this.emitThinking(false);
          if (!this.discardInterruptedAudio && typeof event.delta === "string") this.sink?.onAudio(Buffer.from(event.delta, "base64"));
          break;
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
          this.emitThinking(false);
          this.outputTranscript = mergeTranscript(this.outputTranscript, String(event.delta ?? ""));
          this.sink?.onOutputTranscript(this.outputTranscript, false);
          break;
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          this.sink?.onOutputTranscript(String(event.transcript ?? this.outputTranscript), true);
          this.outputTranscript = "";
          break;
        case "response.output_item.added":
          if (event.item?.type === "function_call" && event.item?.call_id && event.item?.name) {
            this.functionNames.set(String(event.item.call_id), String(event.item.name));
          }
          break;
        case "response.function_call_arguments.done":
          await this.handleToolCallOnce({
            id: String(event.call_id ?? ""),
            name: String(event.name ?? this.functionNames.get(String(event.call_id)) ?? ""),
            arguments: safeJsonParse(String(event.arguments ?? "{}")),
          });
          break;
        case "response.done":
          this.emitThinking(false);
          if (this.outputTranscript.trim()) { this.sink?.onOutputTranscript(this.outputTranscript, true); this.outputTranscript = ""; }
          this.sink?.onAudioEnd();
          for (const item of event.response?.output ?? []) {
            if (item?.type !== "function_call") continue;
            try {
              await this.handleToolCallOnce({
                id: String(item.call_id ?? ""),
                name: String(item.name ?? ""),
                arguments: safeJsonParse(String(item.arguments ?? "{}")),
              });
            } catch (error) {
              await this.log.error("OpenAI response.done tool call failed", error instanceof Error ? error : new Error(String(error)));
            }
          }
          this.sink?.onStatus("live · listening");
          break;
        case "error":
          throw new Error(String(event.error?.message ?? "OpenAI Realtime error"));
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.sink?.onError(normalized);
      await this.log.error("OpenAI event handler failed", { error: normalized, raw: raw.slice(0, 2000) });
    }
  }

  private emitThinking(value: boolean): void {
    if (this.thinking === value) return;
    this.thinking = value;
    this.sink?.onThinking?.(value);
  }

  private async handleToolCallOnce(call: ToolCall): Promise<void> {
    if (!call.id || this.handledCalls.has(call.id)) return;
    this.handledCalls.add(call.id);
    let output: Record<string, unknown>;
    try {
      output = await this.sink!.onToolCall(call);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      output = { ok: false, error: normalized.message };
      await this.log.error("OpenAI tool call failed", normalized);
    }
    // Always send the result back so the model never stalls waiting on it.
    try { this.sendEvent({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.id, output: JSON.stringify(output) } }); }
    catch { /* session already closing; nothing to respond to */ }
    this.sendEvent({ type: "response.create" });
    this.functionNames.delete(call.id);
    if (this.handledCalls.size > 256) {
      const oldest = this.handledCalls.values().next().value;
      if (typeof oldest === "string") this.handledCalls.delete(oldest);
    }
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(event));
  }
}
