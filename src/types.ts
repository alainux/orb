import type { ActivityEntry } from "./activity.js";

export type VoiceProviderName = "gemini" | "openai";
export type VoiceSource = "idle" | "user" | "agent";
export type PiAgentStatus = "idle" | "working";
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
/**
 * How much of the voice model's reasoning to render in the conversation feed.
 * `full` shows the whole thought, `minimized` a short clipped summary,
 * `hidden` only the ephemeral status indicator (never a feed row).
 */
export type ThinkingDisplay = "full" | "minimized" | "hidden";

export interface OrbPermissions {
  cancelPi: boolean;
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
  /** Underrun recoveries (within `choppinessWindowMs`) that mark a choppy episode. */
  choppinessWindowRecoveries: number;
  /** Sliding window (ms) over which a choppy episode is detected. */
  choppinessWindowMs: number;
  /** Quiet (ms) with no underruns before output is declared recovered. */
  choppinessRecoverSilenceMs: number;
  /** Gap (ms) between consecutive audio level heartbeats beyond which a stalled/starved stream is flagged. */
  stallGapMs: number;
  /** Capture-drop counts (within `inputResyncWindowMs`) that auto-resync the microphone path. */
  inputResyncDrops: number;
  /** Capture-drop sampling window (ms). */
  inputResyncWindowMs: number;
  /** Min gap between automatic input resyncs (ms). */
  inputResyncCooldownMs: number;
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
  orbAspect: number;
  orbDensity: number;
  orbReactivity: number;
  orbBraille: boolean;
  panelHeight: number;
  activityLines: number;
  logDir: string;
  configFiles: string[];
  autoStartVoice: boolean;
  /** Reasoning visibility preference (full / minimized / hidden) for the feed. */
  thinkingDisplay: ThinkingDisplay;
  geminiSessionResumption: boolean;
  geminiContextCompression: boolean;
  geminiCompressionTriggerTokens: number;
  geminiCompressionTargetTokens: number;
  /**
   * Voice-model thinking budget in tokens for the Gemini Live session. This is
   * the setting that actually governs the Orb's "Thinking…" indicator (the
   * reasoning window before the first audio chunk). Values: `0` (the default)
   * disables thinking entirely (no `thinkingConfig` sent, fastest responses),
   * a positive integer caps the budget in tokens, and `-1` uses the model's
   * automatic/dynamic budget. Read at session start; a change takes effect on the
   * next voice connection.
   */
  geminiThinkingBudget: number;
  /**
   * Minimum time (ms) the "Thinking…" indicator stays visible once a Gemini
   * turn opens, even if the model delivers its first audio in the same event
   * batch. Prevents the on→off signals from coalescing before the widget can
   * paint, so the indicator is actually seen. `0` disables the hold.
   */
  geminiThinkingHoldMs: number;
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
  name: "run_pi_task" | "read_pi_log" | "observe_pi" | "control_pi" | "read_herdr_pane" | "scratchpad" | string;
  arguments: Record<string, unknown>;
}

export interface VoiceProviderSink {
  onAudio(pcm24k: Buffer): void;
  onAudioEnd(): void;
  onInterruption(reason: string): void;
  onInputTranscript(text: string, final: boolean): void;
  onOutputTranscript(text: string, final: boolean): void;
  onStatus(status: string): void;
  /** True while the model is generating but has not yet delivered content. */
  onThinking(thinking: boolean): void;
  /** Optional: latest reasoning text surfaced by the model (Gemini thought parts). */
  onThinkingContent?(text: string): void;
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
  /** True while the voice model is reasoning but has not spoken output yet. */
  thinking: boolean;
  /** How the feed should render reasoning rows (full / minimized / hidden). */
  thinkingDisplay: ThinkingDisplay;
  inputRms: number;
  outputRms: number;
  audioCaptureDrops: number;
  audioQueuedMs: number;
  audioRecoveries: number;
  /** "healthy" | "choppy" | "recovering" — auto-detected playout health. */
  audioPhase: string;
  piAgentStatus: PiAgentStatus;
  activity: ActivityEntry[];
  scratchpad: ScratchpadViewState;
  error: string | undefined;
}
