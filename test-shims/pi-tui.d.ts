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
  export type ThemeColor =
    | "accent"
    | "border"
    | "borderAccent"
    | "borderMuted"
    | "success"
    | "error"
    | "warning"
    | "muted"
    | "dim"
    | "text"
    | "thinkingText"
    | "userMessageText"
    | "customMessageText"
    | "customMessageLabel"
    | "toolTitle"
    | "toolOutput"
    | "mdHeading"
    | "mdLink"
    | "mdLinkUrl"
    | "mdCode"
    | "mdCodeBlock"
    | "mdCodeBlockBorder"
    | "mdQuote"
    | "mdQuoteBorder"
    | "mdHr"
    | "mdListBullet"
    | "toolDiffAdded"
    | "toolDiffRemoved"
    | "toolDiffContext"
    | "syntaxComment"
    | "syntaxKeyword"
    | "syntaxFunction"
    | "syntaxVariable"
    | "syntaxString"
    | "syntaxNumber"
    | "syntaxType"
    | "syntaxOperator"
    | "syntaxPunctuation"
    | "thinkingOff"
    | "thinkingMinimal"
    | "thinkingLow"
    | "thinkingMedium"
    | "thinkingHigh"
    | "thinkingXhigh"
    | "thinkingMax"
    | "bashMode";
  export type ThemeBg = "selectedBg" | "scrollbarThumb" | "userMessageBg" | "customMessageBg" | "toolPendingBg" | "toolSuccessBg" | "toolErrorBg";
  export interface Theme {
    fg(name: ThemeColor, text: string): string;
    getFgAnsi(name: ThemeColor): string;
    getBgAnsi(name: ThemeBg): string;
    getColorMode(): "truecolor" | "256color";
  }
}
