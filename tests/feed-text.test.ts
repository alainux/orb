import assert from "node:assert/strict";
import test from "node:test";
import { feedRowStyle, tokenizeInline, wrapFeed, clipThoughtForDisplay } from "../src/feed-text.js";
import type { ThemeLike } from "../src/theme.js";

function fakeTheme(): ThemeLike {
  return {
    fg: (name, text) => `\x1b[38;2;0;0;0m${text}\x1b[39m`,
    // Each token resolves to a quantifiable SGR: muted=90, dim=55, others=1/2/3.
    getFgAnsi: (name) =>
      `\x1b[38;2;${name === "muted" ? 90 : name === "dim" ? 55 : 1};${
        name === "muted" ? 90 : name === "dim" ? 55 : 2
      };${name === "muted" ? 100 : name === "dim" ? 60 : 3}m`,
    getBgAnsi: () => "\x1b[48;2;0;0;0m",
    getColorMode: () => "truecolor",
  };
}

function strip(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
function codes(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(/\x1b\[([0-9;]*)m/g)) out.push(m[1] ?? "");
  return out;
}

test("tokenizeSplit splits bold, emphasis, code, strike and link tokens", () => {
  const s = tokenizeInline("a **bold** `code` [x](http://e) *it* ~~no~~");
  assert.deepEqual(
    s.map((x) => x.text),
    ["a ", "bold", " ", "code", " ", "x", " ", "it", " ", "no"],
  );
});

test("thinking rows are italic secondary content; user/voice rows stay primary", () => {
  const t = feedRowStyle("thinking");
  assert.equal(t.italic, true);
  assert.equal(t.body, "dim");
  assert.equal(feedRowStyle("voice").italic, false);
  assert.equal(feedRowStyle("voice").body, "muted");
  assert.equal(feedRowStyle("you").italic, false);
});

test("thinking text renders italic in the dim (secondary) color", () => {
  const joined = wrapFeed("ping", fakeTheme(), feedRowStyle("thinking"), 20).join(" ");
  const params = codes(joined);
  assert.ok(params.some((p) => p.includes("55;55;60")), "dim color must be applied");
  assert.ok(params.some((p) => p.split(";").includes("3")), "italic (;3) must be applied");
  assert.equal(strip(joined), "ping");
});

test("primary (voice) text is not italicized", () => {
  const joined = wrapFeed("ping", fakeTheme(), feedRowStyle("voice"), 20).join(" ");
  assert.ok(codes(joined).every((p) => !p.split(";").includes("3")), "no italic in primary text");
  assert.equal(strip(joined), "ping");
});

test("markdown spans apply md-link / md-code unlike plain body color", () => {
  const theme = fakeTheme();
  const style = feedRowStyle("voice");
  const joined = wrapFeed("hi `x` [y](https://e) end", theme, style, 40).join("\n");
  const params = codes(joined);
  // The code + link spans resolve to the generic "other" token (1;2;3), while
  // plain prose uses the muted body color (90;90;100). Both must appear, so we
  // know markdown spans colored independently of the body.
  assert.ok(params.some((p) => p.includes("90;90;100")), "body prose uses muted color");
  assert.ok(params.some((p) => p.includes("38;2;1;2;3")), "code/link span colored");
});

test("wrapFeed wraps prose to the visible width", () => {
  const lines = wrapFeed("one two three four five six seven eight", fakeTheme(), feedRowStyle("voice"), 12);
  assert.ok(lines.length > 1, "long row must wrap");
  for (const line of lines) assert.ok(strip(line).length <= 12, `line too long: ${JSON.stringify(strip(line))}`);
});

test("clipThoughtForDisplay: full shows the whole thought, hidden drops it", () => {
  const long = "Thought for 120ms · " + "the user upgraded to a pricier plan last month and mentioned they are hitting the limit ".repeat(6);
  // full → untouched full content
  assert.equal(clipThoughtForDisplay(long, "full"), long);
  // hidden → dropped entirely
  assert.equal(clipThoughtForDisplay(long, "hidden"), null);
});

test("clipThoughtForDisplay: minimized keeps the meta prefix and clips the body", () => {
  const long = "Thought for 120ms · " + "the user upgraded to a pricier plan recently and their invoice was fully refunded so they are happy ".repeat(10);
  const out = clipThoughtForDisplay(long, "minimized") ?? "";
  assert.match(out, /^Thought for 120ms · /, "meta prefix preserved");
  assert.ok(out.length < long.length, "minimized body must be shorter than the full row");
  assert.ok(out.endsWith("…"), "a clipped body is signalled with an ellipsis");
});

test("clipThoughtForDisplay: short content and the marker pass through minimized", () => {
  assert.equal(clipThoughtForDisplay("Thought for 40ms · done", "minimized"), "Thought for 40ms · done");
  assert.equal(clipThoughtForDisplay("Thinking…", "full"), "Thinking…");
  assert.equal(clipThoughtForDisplay("Thinking…", "minimized"), "Thinking…");
  assert.equal(clipThoughtForDisplay("Thinking…", "hidden"), null);
});