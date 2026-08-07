declare module "@earendil-works/pi-tui" {
  export interface Component {
    render(width: number): string[];
    handleInput?(data: string): void;
    wantsKeyRelease?: boolean;
    invalidate(): void;
  }
  export interface Focusable {
    focused: boolean;
  }
  export interface TUI {
    requestRender(): void;
    terminal?: { rows: number; columns: number };
    setFocus(component: Component | null): void;
    showOverlay(component: Component, options?: OverlayOptions): OverlayHandle;
    hideOverlay(): void;
    hasOverlay(): boolean;
  }
  export type SizeValue = number | `${number}%`;
  export type OverlayAnchor =
    | "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right"
    | "top-center" | "bottom-center" | "left-center" | "right-center";
  export interface OverlayMargin { top?: number; right?: number; bottom?: number; left?: number }
  export interface OverlayOptions {
    width?: SizeValue; minWidth?: number; maxWidth?: number; maxHeight?: SizeValue;
    anchor?: OverlayAnchor; offsetX?: number; offsetY?: number;
    row?: SizeValue; col?: SizeValue; margin?: OverlayMargin | number;
    visible?: (termWidth: number, termHeight: number) => boolean;
    nonCapturing?: boolean;
  }
  export interface OverlayHandle {
    hide(): void; setHidden(hidden: boolean): void; isHidden(): boolean;
    focus(): void; unfocus(options?: { target: Component | null }): void;
    isFocused(): boolean;
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
    bold(text: string): string;
    italic(text: string): string;
    underline(text: string): string;
    strikethrough(text: string): string;
    dim(text: string): string;
  }

  export interface DefaultTextStyle {
    color?: (text: string) => string;
    bgColor?: (text: string) => string;
    bold?: boolean; italic?: boolean; strikethrough?: boolean; underline?: boolean;
  }
  export interface MarkdownTheme {
    heading(text: string): string;
    link(text: string): string;
    linkUrl(text: string): string;
    code(text: string): string;
    codeBlock(text: string): string;
    codeBlockBorder(text: string): string;
    quote(text: string): string;
    quoteBorder(text: string): string;
    hr(text: string): string;
    listBullet(text: string): string;
    bold(text: string): string;
    italic(text: string): string;
    strikethrough(text: string): string;
    underline(text: string): string;
    highlightCode?(code: string, lang?: string): string[];
    codeBlockIndent?: string;
  }
  export class Markdown implements Component {
    constructor(text: string, paddingX: number, paddingY: number, theme: MarkdownTheme, defaultTextStyle?: DefaultTextStyle, options?: Record<string, unknown>);
    setText(text: string): void;
    invalidate(): void;
    render(width: number): string[];
  }
  export class ScrollView implements Component {
    constructor(component: Component, options?: ScrollViewOptions);
    readonly scrollTop: number;
    readonly contentHeight: number;
    readonly viewportHeight: number;
    readonly isFollowingEnd: boolean;
    scrollTo(scrollTop: number): void;
    scrollBy(lines: number): number;
    scrollToStart(): void;
    scrollToEnd(): void;
    updateLayout(contentHeight: number, viewportHeight: number, requestRender: () => void): void;
    getContentWidth(width: number): number;
    render(width: number): string[];
    invalidate(): void;
  }
  export type ScrollViewScrollbar = "auto" | "hidden" | "always";
  export interface ScrollViewOptions {
    axis?: "vertical" | "horizontal";
    follow?: "none" | "end";
    overscroll?: "chain" | "contain";
    primary?: boolean;
    scrollbar?: ScrollViewScrollbar;
    scrollbarStyle?: (text: string) => string;
    scrollbarHideDelayMs?: number;
  }
  export function matchesKey(input: string, key: string): boolean;
  export function truncateToWidth(text: string, width: number, ellipsis?: string): string;
  export function visibleWidth(text: string): number;
}