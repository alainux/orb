import {
  createBashTool,
  createBashToolDefinition,
  createEditTool,
  createEditToolDefinition,
  createFindTool,
  createFindToolDefinition,
  createGrepTool,
  createGrepToolDefinition,
  createLsTool,
  createLsToolDefinition,
  createReadTool,
  createReadToolDefinition,
  createWriteTool,
  createWriteToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { OrbPermissions } from "./types.js";

/**
 * The voice agent's native coding tools: the same seven tools the Pi coding
 * agent itself exposes (`read`, `bash`, `write`, `edit`, `grep`, `find`,
 * `ls`), built from Pi's own SDK tool factories and executed in-process
 * against the project cwd. This is what lets the realtime voice model "code
 * like an agent" for smaller/quick tasks instead of always delegating a whole
 * Pi turn.
 *
 * Each tool has exactly ONE authoritative source: Pi's own
 * `create<Name>ToolDefinition().parameters`. We never hand-author the names or
 * JSON parameter schemas here — we only attach a short, voice-tuned
 * `description` for the model card and point both providers' registrations and
 * the in-process executor at the same per-tool entry.
 *
 * NOTE: these execute at filesystem level with the extension's full permissions
 * and DO NOT go through Pi's interactive confirmation flow. Callers should
 * route them through the same `permissions` gate and surface the feed so the
 * human always sees what the voice agent is doing in the project.
 *
 * TODO(native-tools): add a configurable guard so dangerous ops (rm -rf,
 * force-push, destructive git rewrites, writes outside the project, etc.)
 * request spoken/human confirmation before the voice agent executes them,
 * mirroring Pi's own confirmation flow. Also consider a Path-B-style private
 * AgentSession so the voice can run multi-turn agentic sub-tasks, not just
 * single tool calls.
 */
export type CodingToolName = "bash" | "read" | "write" | "edit" | "grep" | "find" | "ls";

export const CODING_TOOL_NAMES: readonly CodingToolName[] = [
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "find",
  "ls",
];

export type NativeToolResult = { ok: true; output: string } | { ok: false; error: string };

type ToolLike = {
  label?: string;
  execute: (callId: string, params: Record<string, unknown>, signal?: unknown) => Promise<{
    content?: { type: string; text?: string }[];
    details?: unknown;
  }>;
};

type ToolDefinitionLike = {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
};

/**
 * Single catalog for every native coding tool. `create` builds the in-process
 * executor and `schema` returns Pi's authoritative tool definition (name +
 * JSON-schema parameters); `description` is the short voice-tuned copy shown
 * to the realtime model.
 */
const TOOL_CATALOG: Record<
  CodingToolName,
  {
    create: (cwd: string) => ToolLike;
    schema: () => ToolDefinitionLike;
    description: string;
  }
> = {
  bash: {
    create: (cwd) => createBashTool(cwd),
    schema: createBashToolDefinition,
    description: "Run a bash command in the project: builds, tests, git, package managers, environment inspection.",
  },
  read: {
    create: (cwd) => createReadTool(cwd),
    schema: createReadToolDefinition,
    description: "Read file contents from the project.",
  },
  write: {
    create: (cwd) => createWriteTool(cwd),
    schema: createWriteToolDefinition,
    description: "Overwrite or create a file with the exact given content.",
  },
  edit: {
    create: (cwd) => createEditTool(cwd),
    schema: createEditToolDefinition,
    description: "Apply one or more precise text replacements in a file.",
  },
  grep: {
    create: (cwd) => createGrepTool(cwd),
    schema: createGrepToolDefinition,
    description: "Search file contents for a pattern (respects .gitignore).",
  },
  find: {
    create: (cwd) => createFindTool(cwd),
    schema: createFindToolDefinition,
    description: "Find files by glob pattern (respects .gitignore).",
  },
  ls: {
    create: (cwd) => createLsTool(cwd),
    schema: createLsToolDefinition,
    description: "List entries in a directory.",
  },
};

export class AgentToolbox {
  private tools: Record<string, ToolLike> | undefined;

  constructor(
    private readonly cwd: string,
    private readonly permissions: OrbPermissions,
  ) {}

  static isCodingTool(name: string): boolean {
    return (CODING_TOOL_NAMES as readonly string[]).includes(name);
  }

  /** Whether the native coding tools are permitted under this config. */
  enabled(): boolean {
    return this.permissions.nativeTools;
  }

  private ensure(): void {
    if (!this.permissions.nativeTools) {
      throw new Error("Permission disabled: permissions.nativeTools");
    }
    if (!this.tools) {
      this.tools = {};
      for (const name of CODING_TOOL_NAMES) {
        this.tools[name] = TOOL_CATALOG[name].create(this.cwd);
      }
    }
  }

  async run(name: string, callId: string, args: Record<string, unknown>): Promise<NativeToolResult> {
    try {
      this.ensure();
    } catch (error) {
      return { ok: false, error: asError(error).message };
    }
    const tool = this.tools?.[name];
    if (!tool || typeof tool.execute !== "function") {
      return { ok: false, error: `Native tool not available: ${name}` };
    }
    try {
      const result = await tool.execute(callId, args ?? {});
      const text = (Array.isArray(result?.content) ? result.content : [])
        .filter((block) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
        .map((block) => block.text as string)
        .join("\n");
      const details = result?.details && typeof result.details === "object" && Object.keys(result.details).length
        ? JSON.stringify(result.details)
        : "";
      const output = [text.trim(), details].filter(Boolean).join("\n");
      return { ok: true, output: output || "(no text output)" };
    } catch (error) {
      return { ok: false, error: asError(error).message };
    }
  }
}

/**
 * Provider-facing tool cards. Both formats are derived from the SAME catalog
 * (Pi's authoritative names + parameter schemas plus our short descriptions),
 * so there is a single source of truth and no per-provider copy to drift.
 */

/** Tool registrations for the OpenAI Realtime provider (JSON-schema style). */
export function openAICodingTools(): Array<Record<string, unknown>> {
  return CODING_TOOL_NAMES.map((name) => {
    const def = TOOL_CATALOG[name].schema();
    return {
      type: "function",
      name: def.name,
      description: TOOL_CATALOG[name].description,
      parameters: def.parameters ?? {},
    };
  });
}

/** Tool registrations for the Gemini Live provider (Gemini function-declaration style). */
export function geminiCodingTools(): Array<Record<string, unknown>> {
  return CODING_TOOL_NAMES.map((name) => {
    const def = TOOL_CATALOG[name].schema();
    return {
      name: def.name,
      description: TOOL_CATALOG[name].description,
      parameters: convertToGemini(def.parameters ?? {}),
    };
  });
}

/**
 * Convert a canonical (JSON-schema-style, lower-case) parameter schema into a
 * Gemini function-declaration schema. Shared by the native coding tools and
 * the orchestration tools so both providers get the same single source of
 * truth. Preserves `description`, `enum`, nested `properties`/`items`, and
 * `required`; `additionalProperties`/`minimum`/`maximum` are deliberately not
 * carried through (Gemini declarations don't need them).
 */
export function convertToGemini(schema: Record<string, unknown>): Record<string, unknown> {
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

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}