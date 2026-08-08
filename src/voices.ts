import type { VoiceProviderName } from "./types.js";

/** Curated, provider-appropriate voices Orb can cycle through live.
 * These are real options the user can actually hear: Gemini
 * Developer-API Live prebuilt voices, and OpenAI Realtime voices. Order is the
 * cycle order for `/voice voice` (next). The current/default is always included. */
export const VOICE_OPTIONS: Record<VoiceProviderName, string[]> = {
  gemini: ["Aoede", "Kore", "Puck", "Charon", "Fenrir", "Atlas", "Zephyr", "Echo"],
  openai: ["alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"],
};

export function voiceOptions(provider: VoiceProviderName): string[] {
  return VOICE_OPTIONS[provider];
}

/** Find a voice by case-insensitive name, returning the canonical spelling. */
export function resolveVoice(provider: VoiceProviderName, raw: string): string | undefined {
  const needle = raw.trim().toLowerCase();
  return VOICE_OPTIONS[provider].find((v) => v.toLowerCase() === needle);
}

/** Return the next voice in the provider's list after `current` (wraps). */
export function nextVoice(provider: VoiceProviderName, current: string): string {
  const options = VOICE_OPTIONS[provider];
  const index = options.indexOf(current);
  const start = index < 0 ? -1 : index;
  return options[(start + 1) % options.length]!;
}

/** Short, distinct mood/personality seed per voice, for auditioning.
 * Spoken by the voice so the user can tell its character apart. */
export const VOICE_AUDITION_SEED: Record<string, string> = {
  Aoede: "a lilting, song-like voice — as if humming along with the work.",
  Kore: "a warm, grounded voice — the steady, reassuring friend.",
  Puck: "a playful, quick voice — lighthearted and ready for a round.",
  Charon: "a low, resonant voice — calm like quiet water at night.",
  Fenrir: "a bold, confident voice — a little fierce, happy to take charge.",
  Atlas: "a measured, steady voice — calm and carrying the weight easily.",
  Zephyr: "a bright, breezy voice — glowing and air-light.",
  Echo: "a crisp, precise voice — clear as a bell, echoing clearly.",
};

/** Build the spoken audition line for a voice: names it and gives the mood. */
export function auditionLine(voice: string): string {
  const mood = VOICE_AUDITION_SEED[voice];
  const script = mood
    ? `My voice name is ${voice} — ${mood}`
    : `This is the ${voice} voice.`;
  return `${script} Speak one short, natural line in that character so I can hear the difference.`;
}