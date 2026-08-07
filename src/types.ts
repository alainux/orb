import type { ActivityEntry } from "./activity.js";

export type VoiceProviderName = "gemini" | "openai";
export type VoiceSource = "idle" | "user" | "agent";
export type PiAgentStatus = "idle" | "working";

export interface VoiceConfig {
  provider: VoiceProviderName;
  apiKey: string;
  model: string;
  voice: string;
  temperature: number;
  systemPrompt: string;
  greetingEnabled: boolean;
  orbAspect: number;
  orbDensity: number;
  panelHeight: number;
  activityLines: number;
  logDir: string;
  configFiles: string[];
  geminiSessionResumption: boolean;
  geminiContextCompression: boolean;
  geminiCompressionTriggerTokens: number;
  geminiCompressionTargetTokens: number;
}

export interface VoiceSessionContext {
  cwd: string;
  piStatus: PiAgentStatus;
  recentPiActivity: string;
}

export interface ToolCall {
  id: string;
  name: "run_pi_task" | "read_pi_log" | "observe_pi" | string;
  arguments: Record<string, unknown>;
}

export interface VoiceProviderSink {
  onAudio(pcm24k: Buffer): void;
  onAudioEnd(): void;
  onInterruption(reason: string): void;
  onInputTranscript(text: string, final: boolean): void;
  onOutputTranscript(text: string, final: boolean): void;
  onStatus(status: string): void;
  onError(error: Error): void;
  onSessionEnded(reason: string): void;
  onToolCall(call: ToolCall): Promise<Record<string, unknown>>;
}

export interface VoiceProvider {
  readonly name: VoiceProviderName;
  readonly inputSampleRate: number;
  connect(sink: VoiceProviderSink, context: VoiceSessionContext): Promise<void>;
  sendAudio(pcm: Buffer): void;
  sendText(text: string, options?: { requestResponse?: boolean }): void;
  close(): Promise<void>;
}

export interface VoiceViewState {
  active: boolean;
  status: string;
  source: VoiceSource;
  inputTranscript: string;
  outputTranscript: string;
  inputRms: number;
  outputRms: number;
  audioCaptureDrops: number;
  audioQueuedMs: number;
  piAgentStatus: PiAgentStatus;
  activity: ActivityEntry[];
  error: string | undefined;
}
