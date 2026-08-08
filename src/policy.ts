import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE_ORB_PROMPT } from "./base-prompt.js";

// The user-overridable default layer. It lives in the shipped
// `prompts/default.md` file, which is the single source of truth for the
// default layer. That file, a prompt file, or an inline override are the ways
// to customize it. The fixed base (BASE_ORB_PROMPT) is always composed on top
// of whatever the layer is.
function readDefaultPromptLayer(): string {
  // The shipped prompts/default.md sits at the package root. The compiled
  // module may live in dist/src/, .test-dist/src/, or src/, so walk up from
  // this module until we find the "prompts/default.md" directory.
  let dir = dirname(fileURLToPath(import.meta.url));
  let raw = "";
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "prompts", "default.md");
    try {
      if (existsSync(candidate)) { raw = readFileSync(candidate, "utf8"); break; }
    } catch {
      /* keep walking */
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // The package always ships prompts/default.md; if it is ever missing we
  // degrade to the base prompt alone rather than crash.
  if (!raw) return "";

  // Strip the leading document header (explanation for the human) up to the
  // first '---' separator so only the actual prompt body reaches the model.
  const sep = raw.indexOf("\n---\n");
  return (sep >= 0 ? raw.slice(sep + 5) : raw).trim();
}

const DEFAULT_PROMPT_LAYER = readDefaultPromptLayer();

// Compose the final system prompt: the fixed base, then the layer. A
// user-supplied layer (inline string) replaces the default layer; the base is
// never replaceable.
export function composeSystemPrompt(layer?: string): string {
  const body = (layer === undefined ? DEFAULT_PROMPT_LAYER : layer).trim();
  return body ? `${BASE_ORB_PROMPT}\n\n${body}` : BASE_ORB_PROMPT;
}

// Backward-compatible alias for the full default prompt (base + default layer).
export const DEFAULT_VOICE_SYSTEM_PROMPT = composeSystemPrompt();

const GREETING_CUES = [
  "Open casual, like an engineer already in the current project: a short warm line (\"Hey, what\'s going on?\"), then ask what we\'re working on. One or two sentences — no pitching what you can do, no workflow explanation.",
  "Start with a brief, relaxed greeting as if you\'re already there (\"Hey, how\'s it going?\" / \"What\'s up?\"), then ask what\'s next. No name-and-capabilities intro.",
  "Begin with a natural, friendly opener such as \"What are we tackling today?\" and get to it — don\'t announce your name or list your abilities unless asked.",
  "Open like a teammate already at the same keyboard: casual, direct, and short (\"Hey, what are we building?\"). No name-drop, no capabilities pitch, no small talk.",
];

export function greetingCue(random = Math.random): string {
  return GREETING_CUES[Math.floor(random() * GREETING_CUES.length)] ?? GREETING_CUES[0]!;
}