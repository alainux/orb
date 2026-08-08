// Inline Markdown + row styling + ANSI-aware wrapping for the Orb conversation
// feed.
//
// Activity rows are single logical lines, so this renders *inline* Markdown
// (bold, italic, strikethrough, `code`, `[text](url)`) rather than block
// Markdown (headings, lists, code fences) that a full document renderer would
// emit as many lines. Colors come from Pi's active theme via the same named
// tokens (`mdLink`, `mdCode`, body colors…) the rest of the widget uses, and a
// body token distinguishes "standard" (primary/plain) from "secondary"
// (deemphasized) text so thinking snippets read as quieter than conversation,
// matching Pi's treatment of reasoning.

import type { OrbThemeColor, ThemeLike } from "./theme.js";
import type { ThinkingDisplay } from "./types.js";

/**
 * Visual treatment for a single activity row.
 *
 * `body` is the base foreground token applied to the row's prose; `italic`
 * marks the row as secondary content (Pi-style thought text). Both are theme
 * tokens resolved through the active theme, so no color is hard-coded.
 */
export interface FeedTextStyle {
  /** Short colored marker drawn before the row (YOU / ORB / · / ERR…). */
  label: string;
  /** Theme token for the marker color. */
  labelColor: OrbThemeColor;
  /** Base theme token for the row's body text. */
  body: OrbThemeColor;
  /** When true the row is "thinking"/secondary content: italic + base body token. */
  italic: boolean;
  /** When true the row's prose is parsed as inline Markdown. */
  markdown: boolean;
}

/** Collate a row style from an activity kind. */
export function feedRowStyle(kind: string): FeedTextStyle {
  switch (kind) {
    case "you": return { label: "YOU", labelColor: "accent", body: "muted", italic: false, markdown: true };
    case "voice": return { label: "ORB", labelColor: "customMessageLabel", body: "muted", italic: false, markdown: true };
    case "voice-tool": return { label: "ORB›", labelColor: "toolTitle", body: "toolOutput", italic: false, markdown: false };
    case "error": return { label: "ERR", labelColor: "error", body: "error", italic: false, markdown: true };
    case "system": return { label: "·", labelColor: "thinkingText", body: "muted", italic: false, markdown: true };
    case "thinking": return { label: "·", labelColor: "thinkingText", body: "dim", italic: true, markdown: true };
    default: return { label: "·", labelColor: "dim", body: "muted", italic: false, markdown: true };
  }
}

// ---------------------------------------------------------------------------
// Inline Markdown → styled tokens
// ---------------------------------------------------------------------------

/** A single styled run produced by the inline tokenizer. */
interface Span {
  text: string;
  color?: OrbThemeColor;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

/**
 * Tokenize inline Markdown into styled spans. Plain prose (unmatched text)
 * becomes a span with no override, so the caller's base body color applies.
 */
export function tokenizeInline(text: string): Span[] {
  const re = new RegExp(
    "`([^`]+)`|" +                        // 1 code
    "\\*\\*([^*]+)\\*\\*|__([^_]+)__|" +  // 2,3 bold
    "\\*([^*]+)\\*|_([^_]+)_|" +          // 4,5 italic
    "~~([^~]+)~~|" +                      // 6 strike
    "\\[([^\\]]+)\\]\\(([^)\\s]+)\\)",    // 7 label, 8 url link
    "g",
  );
  const spans: Span[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index) });
    const [, code, b1, b2, i1, i2, st, link, url] = m;
    if (code !== undefined) spans.push({ text: code, color: "mdCode" });
    else if (b1 !== undefined || b2 !== undefined) spans.push({ text: (b1 ?? b2) ?? "", bold: true });
    else if (i1 !== undefined || i2 !== undefined) spans.push({ text: (i1 ?? i2) ?? "", italic: true });
    else if (st !== undefined) spans.push({ text: st, strike: true });
    else if (url !== undefined) spans.push({ text: link ?? "", color: "mdLink", underline: true });
    last = re.lastIndex;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans;
}

/** Pull the SGR color parameters (e.g. `38;2;R;G;B`) from a theme token. */
function fgSgr(theme: ThemeLike, name: OrbThemeColor): string | undefined {
  const ansi = theme.getFgAnsi ? theme.getFgAnsi(name) : undefined;
  if (!ansi) return undefined;
  const m = ansi.match(/^\x1b\[([\d;]+)m/);
  return m ? m[1] : undefined;
}

/** A Word tagged with its SGR parameter list (empty = unstyled). */
interface StyledWord {
  text: string;
  codes: string[];
}

function fmtWord(w: StyledWord): string {
  return w.codes.length ? `\x1b[0m\x1b[${w.codes.join(";")}m${w.text}\x1b[0m` : w.text;
}

/** Walk spans and flatten them to words, folding in the row's base style. */
function spanWords(theme: ThemeLike, spans: Span[], style: FeedTextStyle): StyledWord[] {
  const words: StyledWord[] = [];
  for (const span of spans) {
    const codes: string[] = [];
    const sgr = fgSgr(theme, span.color ?? style.body);
    if (sgr) codes.push(sgr);
    if (span.bold) codes.push("1");
    if (span.italic || style.italic) codes.push("3");
    if (span.underline) codes.push("4");
    if (span.strike) codes.push("9");
    for (const word of span.text.split(/\s+/).filter(Boolean)) words.push({ text: word, codes });
  }
  return words;
}

/**
 * Render inline Markdown to ANSI-styled lines that wrap at `width` measured by
 * visible (non-code) characters. Each word is self-styled with a leading
 * `\x1b[0m` reset, so a wrap boundary never leaks or corrupts an active text
 * style across lines.
 */
export function wrapFeed(text: string, theme: ThemeLike, style: FeedTextStyle, width: number): string[] {
  const words = spanWords(theme, tokenizeInline(text), style);
  if (!words.length) return [""];
  const lines: string[] = [];
  let cur: StyledWord[] = [];
  let curW = 0;
  for (const w of words) {
    const wv = w.text.length;
    if (cur.length === 0) { cur = [w]; curW = wv; continue; }
    if (curW + 1 + wv <= width) { cur.push(w); curW += 1 + wv; }
    else {
      lines.push(cur.map(fmtWord).join(" "));
      cur = [w]; curW = wv;
    }
  }
  if (cur.length) lines.push(cur.map(fmtWord).join(" "));
  return lines;
}

/** Word-wrap plain text (used for non-Markdown rows, e.g. tool output). */
export function wrapPlain(text: string, width: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let cur = "";
  for (const word of words) {
    const next = cur ? `${cur} ${word}` : word;
    if (next.length <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = word.length > width ? word.slice(0, width) : word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Resolve how a thinking row should be shown for the active display mode.
 * The feed row always carries the FULL thought text; this applies the user's
 * preference at render time so the toggle updates every row immediately.
 *
 * Returns `null` (drop the row entirely) for `hidden`, the full text for
 * `full`, and a clipped summary for `minimized`. The row's "Thought for Nms · "
 * meta prefix is preserved in minimized mode.
 */
export function clipThoughtForDisplay(text: string, mode: ThinkingDisplay): string | null {
  if (mode === "hidden") return null;
  if (mode === "full") return text;
  const marker = " · ";
  const idx = text.indexOf(marker);
  const meta = idx >= 0 ? text.slice(0, idx + marker.length) : "";
  const content = (idx >= 0 ? text.slice(idx + marker.length) : text).replace(/\s+/g, " ").trim();
  const maxChars = 140;
  if (content.length <= maxChars) return meta + content;
  const clipped = content.slice(0, maxChars);
  const cut = clipped.search(/\s+\S*$/);
  return meta + (cut > 0 ? clipped.slice(0, cut) : clipped).trimEnd() + "…";
}