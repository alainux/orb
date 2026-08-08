import type { ActivityEntry } from "./activity.js";

export type VoiceProviderName = "gemini" | "openai";
export type VoiceSource = "idle" | "user" | "agent";
export type PiAgentStatus = "idle" | "working";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface OrbPermissions {
  cancelPi: boolean;
  setModel: boolean;
  setThinking: boolean;
  setTools: boolean;
  shell: boolean;
  nativeTools: boolean;
  scratchpadRead: boolean;
  scratchpadWrite: boolean;
  scratchpadOutsideProject: boolean;
}

export interface AudioConfig {
  bufferMs: number;
  maxBufferMs: number;
  recoveryStepMs: number;
  interruptionStormCount: number;
  interruptionStormWindowMs: number;
  interruptionRecoveryMuteMs: number;
}

export interface ScratchpadConfig {
  panelHeight: number;
  maxBytes: number;
}

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
  orbReactivity: number;
  orbBraille: boolean;
  panelHeight: number;
  activityLines: number;
  logDir: string;
  configFiles: string[];
  geminiSessionResumption: boolean;
  geminiContextCompression: boolean;
  geminiCompressionTriggerTokens: number;
  geminiCompressionTargetTokens: number;
  permissions: OrbPermissions;
  audio: AudioConfig;
  scratchpad: ScratchpadConfig;
}

export interface VoiceSessionContext {
  cwd: string;
  piStatus: PiAgentStatus;
  recentPiActivity: string;
}

export interface ToolCall {
  id: string;
  name: "run_pi_task" | "read_pi_log" | "observe_pi" | "control_pi" | "scratchpad" | string;
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
  /** Switch the spoken voice, reconfiguring the live session without a full reload. */
  setVoice(voice: string): Promise<void>;
  close(): Promise<void>;
}

export interface ScratchpadViewState {
  open: boolean;
  title: string;
  content: string;
  dirty: boolean;
}

export interface VoiceViewState {
  active: boolean;
  status: string;
  source: VoiceSource;
  muted: boolean;
  inputTranscript: string;
  outputTranscript: string;
  inputRms: number;
  outputRms: number;
  audioCaptureDrops: number;
  audioQueuedMs: number;
  audioRecoveries: number;
  piAgentStatus: PiAgentStatus;
  activity: ActivityEntry[];
  scratchpad: ScratchpadViewState;
  error: string | undefined;
}
