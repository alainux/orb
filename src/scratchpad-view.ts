import {
  Markdown,
  ScrollView,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type MarkdownTheme,
  type Theme,
  type TUI,
} from "@earendil-works/pi-tui";

/**
 * A focusable, scrollable viewer for the voice scratchpad.
 *
 * It renders the scratchpad as Markdown (styled like the active agent's theme)
 * inside a real Pi `ScrollView` and drives it with the standard scroll keys
 * (↑/↓, k/j, PgUp/PgDn, Ctrl+U/D, Home/End). PI's overlay compositor renders
 * plain lines at a fixed box, so we window the `ScrollView`'s content ourselves
 * and draw a slim scrollbar in the box's last column.
 *
 * By default it follows the live tail (like a console), so new lines keep
 * arriving at the bottom; scrolling up pins you in place and scrolling back to
 * the bottom re-anchors to the tail. A scrollbar thumb appears only when the
 * content is taller than the viewport.
 */
export interface ScratchpadViewerOptions {
  /** Fetches the current markdown content on each render. */
  content: () => string;
  /** Fetches the current scratchpad title. */
  title: () => string;
  /** Called when the user asks to close the viewer (Esc/q/Ctrl+C). */
  onDismiss?: () => void;
}

const SIDE = 2; // left + right box borders
const SB = 1; // scrollbar column

export class ScratchpadViewer {
  private readonly theme: Theme;
  private readonly options: ScratchpadViewerOptions;
  private readonly scroll: ScrollView;
  private readonly markdown: Markdown;
  private readonly viewportRows: number;
  private readonly requestRender: () => void;
  private lastContent: string | null = null;

  constructor(
    tui: TUI,
    theme: Theme,
    options: ScratchpadViewerOptions,
    requestRender?: () => void,
  ) {
    this.theme = theme;
    this.options = options;
    this.requestRender = requestRender ?? (() => tui.requestRender());
    this.viewportRows = Math.max(8, Math.min(40, (tui.terminal?.rows ?? 24) - 6));
    this.markdown = new Markdown(options.content(), 0, 0, buildMarkdownTheme(theme));
    this.scroll = new ScrollView(this.markdown, { axis: "vertical", follow: "end", scrollbar: "auto" });
  }

  /** The `Component + handleInput` object handed to `ctx.ui.custom(...)`. */
  ui(): { render(width: number): string[]; handleInput(data: string): void; invalidate(): void } {
    return {
      render: (width: number) => this.render(width),
      handleInput: (data: string) => this.handleInput(data),
      invalidate: () => this.invalidate(),
    };
  }

  invalidate(): void {
    this.markdown.invalidate();
  }

  /** Current scroll offset (in content rows). Useful for observability/dispatch. */
  get scrollTop(): number {
    return this.scroll.scrollTop;
  }

  /** True while the viewer is anchored to the live bottom. */
  get isFollowingEnd(): boolean {
    return this.scroll.isFollowingEnd;
  }

  /** Rendered content height in rows. */
  get contentHeight(): number {
    return this.scroll.contentHeight;
  }

  dispose(): void {
    // The Markdown / ScrollView are purely in-memory view objects with no
    // external handles; nothing to release on close.
  }

  handleInput(data: string): void {
    const body = this.viewportRows;
    if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c") || matchesKey(data, "q")) {
      this.options.onDismiss?.();
      return;
    }
    if (matchesKey(data, "up") || matchesKey(data, "k")) this.scroll.scrollBy(-1);
    else if (matchesKey(data, "down") || matchesKey(data, "j")) this.scroll.scrollBy(1);
    else if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+b")) this.scroll.scrollBy(-body);
    else if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+f")) this.scroll.scrollBy(body);
    else if (matchesKey(data, "ctrl+u")) this.scroll.scrollBy(-Math.max(1, Math.floor(body / 2)));
    else if (matchesKey(data, "ctrl+d")) this.scroll.scrollBy(Math.max(1, Math.floor(body / 2)));
    else if (matchesKey(data, "home") || matchesKey(data, "g")) this.scroll.scrollToStart();
    else if (matchesKey(data, "end")) this.scroll.scrollToEnd();
    else if (data === "r" || data === "R") { this.lastContent = null; this.invalidate(); }
    else return;
    this.requestRender();
  }

  render(width: number): string[] {
    const body = this.viewportRows;
    const content = this.options.content();
    if (content !== this.lastContent) {
      this.lastContent = content;
      this.markdown.setText(content);
      this.markdown.invalidate();
    }
    const bodyW = Math.max(1, width - SIDE - SB);
    const full = this.markdown.render(bodyW);
    const scrollable = full.length > body;
    this.scroll.updateLayout(full.length, body, () => this.requestRender());
    const top = this.scroll.scrollTop;
    const thumb = scrollable ? Math.round((top / Math.max(1, full.length - body)) * (body - 1)) : -1;

    const out: string[] = [this.headerLine(width)];
    for (let i = 0; i < body; i++) out.push(this.bodyRow(full, top + i, bodyW, scrollable && i === thumb));
    out.push(this.footerLine(width));
    return out;
  }

  private headerLine(width: number): string {
    const inner = Math.max(1, width - SIDE);
    const cap = truncateToWidth(this.theme.fg("accent", ` SCRATCHPAD · ${this.options.title()}`), inner);
    const fill = Math.max(0, inner - visibleWidth(cap));
    return this.theme.fg("borderMuted", "┌─") + cap + this.theme.fg("borderMuted", "─".repeat(fill) + "┐");
  }

  private bodyRow(full: string[], index: number, bodyW: number, thumbHere: boolean): string {
    const side = this.theme.fg("borderMuted", "│");
    const seg = padTo(truncateToWidth(full[index] ?? "", bodyW), bodyW);
    const bar = full.length > this.viewportRows
      ? (thumbHere ? this.theme.fg("accent", "█") : this.theme.fg("borderMuted", "╷"))
      : side;
    return side + seg + bar + side;
  }

  private footerLine(width: number): string {
    const inner = Math.max(1, width - SIDE);
    const hint = this.theme.fg(
      "dim",
      "esc close · ↑/↓ scroll · PgUp/PgDn · Home/End · r re-read",
    );
    const cap = truncateToWidth(hint, inner);
    const fill = Math.max(0, inner - visibleWidth(cap));
    return this.theme.fg("borderMuted", "└─") + cap + this.theme.fg("borderMuted", "─".repeat(fill) + "┘");
  }
}

function buildMarkdownTheme(theme: Theme): MarkdownTheme {
  const md = (color: MdColor) => (text: string) => theme.fg(color, text);
  return {
    heading: md("mdHeading"),
    link: md("mdLink"),
    linkUrl: md("mdLinkUrl"),
    code: md("mdCode"),
    codeBlock: md("mdCodeBlock"),
    codeBlockBorder: md("mdCodeBlockBorder"),
    quote: md("mdQuote"),
    quoteBorder: md("mdQuoteBorder"),
    hr: md("mdHr"),
    listBullet: md("mdListBullet"),
    bold: (text) => theme.bold(text),
    italic: (text) => theme.italic(text),
    underline: (text) => theme.underline(text),
    strikethrough: (text) => theme.strikethrough(text),
  };
}

type MdColor =
  | "mdHeading" | "mdLink" | "mdLinkUrl" | "mdCode" | "mdCodeBlock"
  | "mdCodeBlockBorder" | "mdQuote" | "mdQuoteBorder" | "mdHr" | "mdListBullet";

function padTo(line: string, width: number): string {
  const w = visibleWidth(line);
  return w >= width ? line : line + " ".repeat(width - w);
}