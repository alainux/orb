import type { VoiceSessionContext } from "../types.js";

/** Normalize an unknown thrown value to an Error for logging / sink emission. */
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Build the shared agent-context preamble sent to the model on connect. */
export function buildEnvironmentContext(context: VoiceSessionContext): string {
  return `PI_CODING_CONTEXT\nProject cwd: ${context.cwd}\nPi status: ${context.piStatus}\nRecent visible Pi activity:\n${context.recentPiActivity}`;
}

/**
 * Register an already-validated tool-call id in a bounded dedup set. Returns
 * true when the id was already present (caller should skip re-execution) or
 * the id is empty (never tracked). Keeps the set LRU-capped at 256 entries.
 */
export function markSeenCall(set: Set<string>, id: string): boolean {
  if (!id) return false;
  if (set.has(id)) return true;
  set.add(id);
  if (set.size > 256) {
    const oldest = set.values().next().value;
    if (typeof oldest === "string") set.delete(oldest);
  }
  return false;
}

export function safeJsonParse(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function mergeTranscript(current: string, incoming: string): string {
  const clean = incoming.trim();
  if (!clean) return current;
  if (!current) return clean;
  if (clean.startsWith(current)) return clean;
  if (current.endsWith(clean)) return current;
  return `${current}${/\s$/.test(current) || /^[,.;:!?]/.test(clean) ? "" : " "}${clean}`;
}

export function isExpectedGeminiRotationError(message: string): boolean {
  const text = message.toLowerCase();
  return text.includes("goaway") || text.includes("go away") || text.includes("session duration") || text.includes("failed to close the connection after receiving a goaway");
}
