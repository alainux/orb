declare module "@earendil-works/pi-tui" {
  export interface Component {
    render(width: number): string[];
    handleInput?(data: string): void;
    wantsKeyRelease?: boolean;
    invalidate(): void;
  }
  export interface TUI {
    requestRender(): void;
  }
  export interface Theme {
    fg(name: "toolTitle" | "accent" | "success" | "error" | "warning" | "muted" | "dim", text: string): string;
  }
}
