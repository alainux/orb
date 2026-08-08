import type { VoiceProviderName } from "./types.js";

export type ScratchpadCommandAction = "open" | "close" | "view" | "edit" | "load" | "save" | "dispatch";
export type VoiceCommand =
  | { action: "start"; provider?: VoiceProviderName }
  | { action: "stop" | "status" | "log" | "help" }
  | { action: "provider"; provider: VoiceProviderName }
  | { action: "mute"; muted: boolean | undefined }
  | { action: "voice"; voice: string | undefined }
  | { action: "thinking"; value: string | undefined }
  | { action: "scratchpad"; scratchpadAction: ScratchpadCommandAction; argument: string };

export function parseVoiceCommand(raw: string): VoiceCommand {
  const trimmed = raw.trim();
  const [head = "start", ...rest] = trimmed.split(/\s+/).filter(Boolean);
  const action = head.toLowerCase();
  const argument = rest[0]?.toLowerCase();
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
    case "mute":
      return { action: "mute", muted: argument === undefined ? undefined : parseMute(argument) };
    case "voice":
      return { action: "voice", voice: argument };
    case "thinking":
    case "thoughts":
      return { action: "thinking", value: argument };
    case "scratchpad":
    case "pad": {
      const sub = (argument ?? "open") as ScratchpadCommandAction;
      if (!["open", "close", "view", "edit", "load", "save", "dispatch"].includes(sub)) throw new Error("Usage: /voice scratchpad [open|view|edit|load <path>|save [path]|dispatch|close]");
      return { action: "scratchpad", scratchpadAction: sub, argument: rest.slice(1).join(" ") };
    }
    default: throw new Error(`Unknown /voice action: ${action}`);
  }
}
function parseProvider(value: string): VoiceProviderName {
  if (value === "gemini" || value === "openai") return value;
  throw new Error("Provider must be gemini or openai.");
}

function parseMute(value: string): boolean {
  switch (value) {
    case "on": case "true": case "yes": case "1": return true;
    case "off": case "false": case "no": case "0": return false;
    default: throw new Error("Usage: /voice mute [on|off]");
  }
}
