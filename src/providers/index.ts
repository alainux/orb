import type { RunLog } from "../log.js";
import type { VoiceConfig, VoiceProvider } from "../types.js";
import { GeminiLiveProvider } from "./gemini.js";
import { OpenAIRealtimeProvider } from "./openai.js";

export function createProvider(config: VoiceConfig, log: RunLog): VoiceProvider {
  return config.provider === "gemini"
    ? new GeminiLiveProvider(config, log)
    : new OpenAIRealtimeProvider(config, log);
}
