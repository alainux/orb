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
