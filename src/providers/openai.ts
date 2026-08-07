import WebSocket from "ws";
import type { RunLog } from "../log.js";
import { greetingCue } from "../policy.js";
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
        tools: [
          {
            type: "function",
            name: "run_pi_task",
            description: "Delegate a complete coding task directly to Pi. Use this proactively for exploration, implementation, debugging, tests, refactoring, documentation, specs, and other engineering work.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                instruction: { type: "string", description: "Complete autonomous engineering instruction for Pi." },
                summary: { type: "string", description: "Optional short label for the task." },
              },
              required: ["instruction"],
            },
          },
          {
            type: "function",
            name: "read_pi_log",
            description: "Read recent visible Pi conversation and tool results. Hidden thinking is excluded.",
            parameters: { type: "object", additionalProperties: false, properties: { max_entries: { type: "number", minimum: 1, maximum: 40 } } },
          },
          {
            type: "function",
            name: "observe_pi",
            description: "Wait for meaningful visible activity from Pi or until Pi settles after delegated work.",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                after_revision: { type: "number", minimum: 0 },
                until: { type: "string", enum: ["activity", "settled"] },
                timeout_ms: { type: "number", minimum: 100, maximum: 60000 },
                max_entries: { type: "number", minimum: 1, maximum: 40 },
              },
            },
          },
          {
            type: "function",
            name: "control_pi",
            description: "Control the Pi harness directly: cancel an active run, list/set the model, change thinking level, or run a shell command when permissions allow it. Cancel immediately when the human changes direction.",
            parameters: {
              type: "object", additionalProperties: false,
              properties: {
                action: { type: "string", enum: ["cancel", "list_models", "set_model", "set_thinking", "list_tools", "set_tools", "shell"] },
                model: { type: "string" }, level: { type: "string" }, tools: { type: "array", items: { type: "string" } }, command: { type: "string" }, timeout_ms: { type: "number" },
              }, required: ["action"],
            },
          },
          {
            type: "function",
            name: "scratchpad",
            description: "Manage Orb's ephemeral collaborative scratchpad. Open/read/edit/load/save it, or dispatch selected/all scratchpad content to Pi.",
            parameters: {
              type: "object", additionalProperties: false,
              properties: { action: { type: "string", enum: ["open", "read", "replace", "append", "load", "save", "dispatch", "close"] }, title: { type: "string" }, content: { type: "string" }, path: { type: "string" }, summary: { type: "string" } },
              required: ["action"],
            },
          },
        ],
        tool_choice: "auto",
      },
    });
    this.ready = true;
    sink.onStatus("live · listening");

    const environment = `PI_CODING_CONTEXT\nProject cwd: ${context.cwd}\nPi status: ${context.piStatus}\nRecent visible Pi activity:\n${context.recentPiActivity}`;
    const greeting = this.config.greetingEnabled ? `\n\n${greetingCue()}` : "";
    this.sendText(`${environment}${greeting}`, { requestResponse: this.config.greetingEnabled });
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

  private async handleMessage(raw: string): Promise<void> {
    try {
      const event: any = JSON.parse(raw);
      switch (event.type) {
        case "session.created":
        case "session.updated":
          this.sink?.onStatus("live · listening");
          break;
        case "input_audio_buffer.speech_started":
          this.discardInterruptedAudio = true;
          if (this.outputTranscript.trim()) { this.sink?.onOutputTranscript(this.outputTranscript, true); this.outputTranscript = ""; }
          this.sink?.onInterruption("server barge-in");
          break;
        case "response.created":
          this.discardInterruptedAudio = false;
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
          if (!this.discardInterruptedAudio && typeof event.delta === "string") this.sink?.onAudio(Buffer.from(event.delta, "base64"));
          break;
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
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
          if (this.outputTranscript.trim()) { this.sink?.onOutputTranscript(this.outputTranscript, true); this.outputTranscript = ""; }
          this.sink?.onAudioEnd();
          for (const item of event.response?.output ?? []) {
            if (item?.type !== "function_call") continue;
            await this.handleToolCallOnce({
              id: String(item.call_id ?? ""),
              name: String(item.name ?? ""),
              arguments: safeJsonParse(String(item.arguments ?? "{}")),
            });
          }
          this.sink?.onStatus("live · listening");
          break;
        case "error":
          throw new Error(event.error?.message ?? "OpenAI Realtime error");
      }
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.sink?.onError(normalized);
      await this.log.error("OpenAI event handler failed", { error: normalized, raw: raw.slice(0, 2000) });
    }
  }

  private async handleToolCallOnce(call: ToolCall): Promise<void> {
    if (!call.id || this.handledCalls.has(call.id)) return;
    this.handledCalls.add(call.id);
    const output = await this.sink!.onToolCall(call);
    this.sendEvent({
      type: "conversation.item.create",
      item: { type: "function_call_output", call_id: call.id, output: JSON.stringify(output) },
    });
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
