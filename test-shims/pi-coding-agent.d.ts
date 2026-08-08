declare module "@earendil-works/pi-coding-agent" {
  import type { Component, TUI, Theme, OverlayOptions, OverlayHandle } from "@earendil-works/pi-tui";

  export interface ExtensionUI {
    confirm(title: string, message: string): Promise<boolean>;
    input?(title: string, placeholder?: string): Promise<string | undefined>;
    editor?(title: string, initial?: string): Promise<string | undefined>;
    notify(message: string, level?: "info" | "warning" | "error" | "success"): void;
    setStatus(id: string, value: string | undefined): void;
    setWidget(id: string, widget: string[] | undefined | ((tui: TUI, theme: Theme) => Component), options?: { placement?: "aboveEditor" | "belowEditor" }): void;
    setEditorText(text: string): void;
    getEditorText(): string;
    custom<T>(factory: (tui: TUI, theme: Theme, keybindings?: unknown, done?: (result: T) => void) => Component & { dispose?(): void } | Promise<Component & { dispose?(): void }>, options?: {
        overlay?: boolean;
        overlayOptions?: OverlayOptions | (() => OverlayOptions);
        onHandle?: (handle: OverlayHandle) => void;
    }): Promise<T>;
    readonly theme: Theme;
  }

  export interface ModelLike { provider?: string; id?: string; name?: string }
  export interface ModelRegistryLike { find(provider: string, id: string): ModelLike | undefined; getAvailable?(): Promise<ModelLike[]> }

  export interface ExtensionContext {
    readonly ui: ExtensionUI;
    readonly cwd: string;
    readonly hasUI: boolean;
    readonly mode: "tui" | "rpc" | "json" | "print";
    readonly sessionManager: { getBranch(): unknown[]; getEntries?(): unknown[]; getSessionFile?(): string | undefined };
    readonly modelRegistry: ModelRegistryLike;
    readonly model?: ModelLike;
    isIdle(): boolean;
    abort(): Promise<void> | void;
  }

  export interface ExtensionCommandContext extends ExtensionContext {}

  export interface NativeVoiceToolResult {
    content: { type: string; text?: string }[];
    details?: unknown;
    isError?: boolean;
  }
  export interface NativeVoiceTool {
    label: string;
    parameters: unknown;
    execute(callId: string, params: Record<string, unknown>, signal?: unknown): Promise<NativeVoiceToolResult>;
  }
  export interface NativeToolDefinition {
    name: string;
    label?: string;
    description?: string;
    promptSnippet?: string;
    parameters?: Record<string, unknown>;
  }
  /** Build pi's native coding tools (read/bash/write/edit/grep/find/ls) for direct execution. */
  export function createReadTool(cwd: string, options?: Record<string, unknown>): NativeVoiceTool;
  export function createBashTool(cwd: string, options?: Record<string, unknown>): NativeVoiceTool;
  export function createWriteTool(cwd: string, options?: Record<string, unknown>): NativeVoiceTool;
  export function createEditTool(cwd: string, options?: Record<string, unknown>): NativeVoiceTool;
  export function createGrepTool(cwd: string, options?: Record<string, unknown>): NativeVoiceTool;
  export function createFindTool(cwd: string, options?: Record<string, unknown>): NativeVoiceTool;
  export function createLsTool(cwd: string, options?: Record<string, unknown>): NativeVoiceTool;
  /** Pi's authoritative tool definitions (name + JSON-schema parameters). */
  export function createReadToolDefinition(options?: Record<string, unknown>): NativeToolDefinition;
  export function createBashToolDefinition(options?: Record<string, unknown>): NativeToolDefinition;
  export function createWriteToolDefinition(options?: Record<string, unknown>): NativeToolDefinition;
  export function createEditToolDefinition(options?: Record<string, unknown>): NativeToolDefinition;
  export function createGrepToolDefinition(options?: Record<string, unknown>): NativeToolDefinition;
  export function createFindToolDefinition(options?: Record<string, unknown>): NativeToolDefinition;
  export function createLsToolDefinition(options?: Record<string, unknown>): NativeToolDefinition;

  export interface ExecResult { stdout: string; stderr: string; code: number; killed: boolean }
  export interface ExtensionAPI {
    registerCommand(name: string, options: { description?: string; handler(args: string, ctx: ExtensionCommandContext): Promise<void> | void }): void;
    registerShortcut(shortcut: string, options: { description?: string; handler(ctx: ExtensionCommandContext): Promise<void> | void }): void;
    on(event: string, handler: (event: any, ctx: ExtensionContext) => Promise<any> | any): void;
    sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void | Promise<void>;
    sendMessage?(message: any, options?: any): void | Promise<void>;
    exec(command: string, args: string[], options?: { signal?: AbortSignal; timeout?: number; cwd?: string }): Promise<ExecResult>;
    setModel(model: ModelLike): Promise<boolean>;
    getThinkingLevel(): string;
    setThinkingLevel(level: string): void;
    getActiveTools(): string[];
    setActiveTools(names: string[]): void;
  }
}
