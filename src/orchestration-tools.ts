/**
 * The voice agent's orchestration tools: delegate/observe/read hooks into the
 * Pi harness, an orchestration-cancel, read-only access to open herdr panes,
 * and the scratchpad. These are the voice
 * agent's ONLY tools. There are deliberately NO configuration capabilities
 * (no control_pi model/thinking/tools/shell switches, no set_voice) — the voice
 * companion cannot re-configure itself or the agent at runtime; it is configured
 * solely by the config file. There are
 * deliberately NO native project tools (no bash/write/read/edit/grep/find/ls)
 * — the voice companion can only talk to the human and direct the background
 * agent; it can never directly edit the project tree. Its one special,
 * agent-managed working area is the scratchpad (for larger prompts or the
 * longer explore-and-plan playbooks). This catalog is the single, authoritative
 * source feeding BOTH providers' registrations, so the
 * descriptions and parameter schemas can never silently drift apart between
 * the OpenAI Realtime and Gemini Live providers.
 *
 * Each entry is stored once in canonical JSON-schema form (lower-case types),
 * then rendered per provider:
 *  - OpenAI Realtime: `{ type: "function", name, description, parameters }`
 *    with the canonical `parameters` used as-is (keeps `additionalProperties`).
 *  - Gemini Live: `{ name, description, parameters }` where `parameters` is
 *    derived via the shared `convertToGemini`.
 *
 * `read_herdr_pane` is registered only when herdr is actually detected in the
 * environment (see `herdrInstalled`). When herdr is missing the tool is simply
 * omitted from both providers' registrations — silently, never throwing and
 * never preventing startup.
 */
import { herdrInstalled } from "./herdr.js";
import type { RunLog } from "./log.js";

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
      "Cancel the background Pi agent's currently running turn when the human changes direction. Orchestration-only: no model/thinking/tools/shell configuration is exposed here (those are controlled by the voice config file, not by you).",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        action: { type: "string", enum: ["cancel"] },
        timeout_ms: { type: "number" },
      },
      required: ["action"],
    },
  },
  {
    name: "read_herdr_pane",
    description:
      "Read the recent terminal output (log) of an open herdr pane. Herdr is a terminal multiplexer (like tmux) for running terminals/agents; use this when you need the actual output a concurrent terminal produced. Reads the pane's unwrapped recent scrollback (best for logs). Requires herdr to be installed and running. Omit pane_id to list the open panes to choose from; sends a run of `herdr pane read <pane_id> --source recent-unwrapped --lines N`.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        pane_id: { type: "string", description: "herdr pane id (e.g. w1:p3) to read. Omit to list open panes." },
        lines: { type: "number", minimum: 1, maximum: 2000, description: "Number of recent terminal rows to read (default 120)." },
        source: { type: "string", enum: ["visible", "recent", "recent-unwrapped", "detection"], description: "Read source; recent-unwrapped is best for logs." },
      },
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
];

/** Tool registrations for the OpenAI Realtime provider (JSON-schema style). */
export async function openAIOrchestrationTools(log?: RunLog): Promise<Array<Record<string, unknown>>> {
  const catalog = await availableTools(log);
  return catalog.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }));
}

/** Tool registrations for the Gemini Live provider (function-declaration style). */
export async function geminiOrchestrationTools(log?: RunLog): Promise<Array<Record<string, unknown>>> {
  const catalog = await availableTools(log);
  return catalog.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: convertToGemini(tool.parameters),
  }));
}

/** Which tools are available right now. The herdr pane reader is served only when herdr is detected. */
async function availableTools(log?: RunLog): Promise<readonly OrchestrationTool[]> {
  // herdrInstalled never throws (returns false on a missing/broken herdr), so a
  // missing herdr simply omits the tool — no error output, no startup impact.
  const herdrReady = await herdrInstalled();
  // Discreet internal observability only: records whether the herdr pane reader
  // was wired up or left out, for debugging session logs. Never shown to users.
  if (log) {
    void log.debug("read_herdr_pane tool", { initialized: herdrReady, herdrPresent: herdrReady });
  }
  return herdrReady
    ? ORCHESTRATION_CATALOG
    : ORCHESTRATION_CATALOG.filter((tool) => tool.name !== "read_herdr_pane");
}

/**
 * Convert a canonical (JSON-schema-style, lower-case) parameter schema into a
 * Gemini function-declaration schema, shared by every orchestration tool so
 * both providers get the same single source of truth. Preserves `description`,
 * `enum`, nested `properties`/`items`, and `required`;
 * `additionalProperties`/`minimum`/`maximum` are deliberately not carried
 * through (Gemini declarations don't need them).
 */
function convertToGemini(schema: Record<string, unknown>): Record<string, unknown> {
  const typeMap: Record<string, string> = {
    string: "STRING",
    number: "NUMBER",
    integer: "INTEGER",
    boolean: "BOOLEAN",
    object: "OBJECT",
    array: "ARRAY",
  };
  const convert = (node: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { type: typeMap[String(node.type).toLowerCase()] ?? "OBJECT" };
    if (typeof node.description === "string") out.description = node.description;
    if (Array.isArray(node.enum)) out.enum = node.enum;
    const props = node.properties;
    if (props && typeof props === "object" && !Array.isArray(props)) {
      const converted: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(props)) {
        converted[key] = convert(value as Record<string, unknown>);
      }
      out.properties = converted;
    }
    const items = node.items;
    if (items && typeof items === "object" && !Array.isArray(items)) {
      out.items = convert(items as Record<string, unknown>);
    }
    if (Array.isArray(node.required)) out.required = node.required;
    return out;
  };
  return convert(schema);
}