import type { VoiceProviderName } from "./types.js";

export type VoiceCommand =
  | { action: "start"; provider?: VoiceProviderName }
  | { action: "stop" | "status" | "log" | "help" }
  | { action: "provider"; provider: VoiceProviderName };

export function parseVoiceCommand(raw: string): VoiceCommand {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const action = (parts[0] ?? "start").toLowerCase();
  const argument = parts[1]?.toLowerCase();
  switch (action) {
    case "start": return argument ? { action: "start", provider: parseProvider(argument) } : { action: "start" };
    case "stop":
    case "off": return { action: "stop" };
    case "status":
    case "log":
    case "help": return { action };
    case "provider":
      if (!argument) throw new Error("Usage: /voice provider gemini|openai");
      return { action: "provider", provider: parseProvider(argument) };
    default: throw new Error(`Unknown /voice action: ${action}`);
  }
}
function parseProvider(value: string): VoiceProviderName {
  if (value === "gemini" || value === "openai") return value;
  throw new Error("Provider must be gemini or openai.");
}
