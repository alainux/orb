declare module "@earendil-works/pi-coding-agent" {
  import type { Component, TUI, Theme } from "@earendil-works/pi-tui";

  export interface ExtensionUI {
    confirm(title: string, message: string): Promise<boolean>;
    input?(title: string, placeholder?: string): Promise<string | undefined>;
    editor?(title: string, initial?: string): Promise<string | undefined>;
    notify(message: string, level?: "info" | "warning" | "error" | "success"): void;
    setStatus(id: string, value: string | undefined): void;
    setWidget(id: string, widget: string[] | undefined | ((tui: TUI, theme: Theme) => Component), options?: { placement?: "aboveEditor" | "belowEditor" }): void;
    setEditorText(text: string): void;
    getEditorText(): string;
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
