declare module "@earendil-works/pi-coding-agent" {
  import type { Component, TUI, Theme } from "@earendil-works/pi-tui";

  export interface ExtensionUI {
    confirm(title: string, message: string): Promise<boolean>;
    notify(message: string, level?: "info" | "warning" | "error" | "success"): void;
    setStatus(id: string, value: string | undefined): void;
    setWidget(id: string, widget: string[] | undefined | ((tui: TUI, theme: Theme) => Component), options?: { placement?: "aboveEditor" | "belowEditor" }): void;
    setEditorText(text: string): void;
    getEditorText(): string;
    readonly theme: Theme;
  }

  export interface ExtensionContext {
    readonly ui: ExtensionUI;
    readonly cwd: string;
    readonly hasUI: boolean;
    readonly mode: "tui" | "rpc" | "json" | "print";
    readonly sessionManager: { getBranch(): unknown[]; getEntries?(): unknown[]; getSessionFile?(): string | undefined };
    isIdle(): boolean;
  }

  export interface ExtensionCommandContext extends ExtensionContext {}

  export interface ExtensionAPI {
    registerCommand(name: string, options: { description?: string; handler(args: string, ctx: ExtensionCommandContext): Promise<void> | void }): void;
    registerShortcut(shortcut: string, options: { description?: string; handler(ctx: ExtensionCommandContext): Promise<void> | void }): void;
    on(event: string, handler: (event: any, ctx: ExtensionContext) => Promise<void> | void): void;
    sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): void | Promise<void>;
  }
}
