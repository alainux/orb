import { convertToGemini } from "./agent-tools.js";

/**
 * The voice agent's orchestration tools: control-plane hooks into the Pi
 * harness (delegate/observe/control/read), plus Orb's own scratchpad and
 * voice switching. These mirror the native coding tools in `agent-tools.ts` —
 * ONE authoritative catalog feeding BOTH providers' registrations, so the
 * descriptions and parameter schemas can never silently drift apart between
 * the OpenAI Realtime and Gemini Live providers.
 *
 * Each entry is stored once in canonical JSON-schema form (lower-case types),
 * then rendered per provider:
 *  - OpenAI Realtime: `{ type: "function", name, description, parameters }`
 *    with the canonical `parameters` used as-is (keeps `additionalProperties`).
 *  - Gemini Live: `{ name, description, parameters }` where `parameters` is
 *    derived via the shared `convertToGemini`.
 */
type OrchestrationTool = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

const ORCHESTRATION_CATALOG: readonly OrchestrationTool[] = [
  {
    name: "run_pi_task",
    description:
      "Delegate a complete coding task directly to Pi. Use it proactively for project exploration, implementation, debugging, tests, refactoring, documentation, specs, and other engineering work.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        instruction: { type: "string", description: "Complete, autonomous engineering instruction for Pi." },
        summary: { type: "string", description: "Optional short label for the delegated task." },
      },
      required: ["instruction"],
    },
  },
  {
    name: "read_pi_log",
    description:
      "Read recent visible Pi conversation and tool results when factual project state is needed. Hidden reasoning is excluded.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: { max_entries: { type: "number", minimum: 1, maximum: 40 } },
    },
  },
  {
    name: "observe_pi",
    description:
      "Wait for meaningful visible activity from Pi, or until Pi settles after delegated work. Use after delegating work instead of asking the human to report when it is done.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        after_revision: { type: "number", minimum: 0 },
        until: { type: "string", enum: ["activity", "settled"] },
        timeout_ms: { type: "number", minimum: 100, maximum: 60000 },
        max_entries: { type: "number", minimum: 1, maximum: 40 },
      },
    },
  },
  {
    name: "control_pi",
    description:
      "Control the Pi background agent (the coding harness running underneath Orb) directly: cancel an active run, list or set its model, change ITS thinking level, list or set its active tools, or run a shell command where permissions allow. Note: set_thinking only changes the background agent's reasoning level — it does NOT affect the Orb voice model's thinking or the visible Thinking indicator. Cancel the background agent immediately when the human changes direction.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["cancel", "list_models", "set_model", "set_thinking", "list_tools", "set_tools", "shell"],
        },
        model: { type: "string" },
        level: { type: "string" },
        tools: { type: "array", items: { type: "string" } },
        command: { type: "string" },
        timeout_ms: { type: "number" },
      },
      required: ["action"],
    },
  },
  {
    name: "scratchpad",
    description:
      "Manage Orb's ephemeral collaborative scratchpad: open/view it as an overlay, read/replace/append its content, load/save it to a file, or dispatch selected content to Pi as a task.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["open", "view", "read", "replace", "append", "load", "save", "dispatch", "close"] },
        title: { type: "string" },
        content: { type: "string" },
        path: { type: "string" },
        summary: { type: "string" },
      },
      required: ["action"],
    },
  },
  {
    name: "set_voice",
    description: "Change Orb's active spoken voice to audition or pick a different sound.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        voice: { type: "string", description: "Exact voice name available on the active provider." },
      },
      required: ["voice"],
    },
  },
];

/** Tool registrations for the OpenAI Realtime provider (JSON-schema style). */
export function openAIOrchestrationTools(): Array<Record<string, unknown>> {
  return ORCHESTRATION_CATALOG.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/** Tool registrations for the Gemini Live provider (function-declaration style). */
export function geminiOrchestrationTools(): Array<Record<string, unknown>> {
  return ORCHESTRATION_CATALOG.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: convertToGemini(tool.parameters),
  }));
}