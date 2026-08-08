import type { VoiceConfig } from "../types.js";

/** Build a Gemini Developer API Live config without importing the SDK.
 * Keeping this pure makes the wire shape directly regression-testable.
 */
export function buildGeminiLiveConfig(
  config: VoiceConfig,
  handle = "",
  functionDeclarations: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return {
    responseModalities: ["AUDIO"],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    systemInstruction: { parts: [{ text: config.systemPrompt }] },
    temperature: config.temperature,
    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.voice } } },
    realtimeInputConfig: { automaticActivityDetection: { disabled: false, prefixPaddingMs: 180, silenceDurationMs: 650 } },
    // Voice-model reasoning. Passed at the top level of the Live connect config
    // (Gemini's LiveConnectionConfig.thinkingConfig, NOT generationConfig).
    // IncludeThoughts makes the model return thought parts, which is what lets the
    // app's "Thinking…" indicator track the real reasoning window; the reasoning
    // isn't read or spoken (audio-only turns), only used to hold the indicator.
    // budget: 0 = disabled, -1 = automatic/dynamic, positive = explicit token cap.
    ...(config.geminiThinkingBudget !== 0
      ? { thinkingConfig: { thinkingBudget: config.geminiThinkingBudget ?? -1, includeThoughts: true } }
      : {}),
    // Developer API session resumption is intentionally limited to the
    // documented empty config / handle shape. `transparent` is Enterprise-only.
    ...(config.geminiSessionResumption ? { sessionResumption: handle ? { handle } : {} } : {}),
    ...(config.geminiContextCompression ? {
      contextWindowCompression: {
        triggerTokens: String(config.geminiCompressionTriggerTokens),
        slidingWindow: { targetTokens: String(config.geminiCompressionTargetTokens) },
      },
    } : {}),
    tools: [{ functionDeclarations }],
  };
}
