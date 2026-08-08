import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The single authoritative default system prompt. It lives in the shipped
// `prompts/default.md` file, which carries the whole default: identity,
// invariants, persona, tool guidance, and delegation behavior.
function readDefaultPrompt(): string {
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
  // degrade to an empty string rather than crash.
  if (!raw) return "";

  // Strip the document header (explanation for the human) up to the first
  // '---' separator so only the actual prompt body reaches the model.
  const sep = raw.indexOf("\n---\n");
  return (sep >= 0 ? raw.slice(sep + 5) : raw).trim();
}

const DEFAULT_PROMPT = readDefaultPrompt();

// Two-layer model: the single default prompt, plus an optional user override.
// An override — a prompt file, ORB_SYSTEM_PROMPT, or voice.systemPrompt inline
// string — replaces the default entirely. With no override, the shipped
// prompts/default.md is used as-is.
export function composeSystemPrompt(layer?: string): string {
  return (layer === undefined ? DEFAULT_PROMPT : layer).trim();
}

// The full default prompt (used when no override is configured).
export const DEFAULT_VOICE_SYSTEM_PROMPT = composeSystemPrompt();