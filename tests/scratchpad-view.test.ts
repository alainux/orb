import assert from "node:assert/strict";
import test from "node:test";
import { ScratchpadViewer } from "../src/scratchpad-view.js";
import type { Theme, ThemeColor } from "@earendil-works/pi-tui";

function fakeTheme(): Theme {
  return {
    fg: (_c: ThemeColor, text: string) => text,
    getFgAnsi: () => "",
    getBgAnsi: () => "",
    getColorMode: () => "256color" as const,
    bold: (text: string) => text,
    italic: (text: string) => text,
    underline: (text: string) => text,
    strikethrough: (text: string) => text,
    dim: (text: string) => text,
  };
}

function fakeTui(rows = 24) {
  return { requestRender: () => {}, terminal: { rows, columns: 100 } } as never;
}

const paragraphs = (n: number): string => Array.from({ length: n }, (_, i) => `L${i}`).join("\n\n");

test("renders a box: header + viewport rows + footer", () => {
  const viewer = new ScratchpadViewer(
    fakeTui(24),
    fakeTheme(),
    { content: () => "# Title\n\nbody", title: () => "todos" },
    () => {},
  );
  const lines = viewer.render(50);
  // rows = clamp(24 - 6, 8, 40) = 18, plus header + footer = 20.
  assert.equal(lines.length, 20);
  assert.ok(lines[0]!.includes("SCRATCHPAD"));
  assert.ok(lines[0]!.includes("todos"));
  assert.ok(lines[lines.length - 1]!.includes("esc close"));
});

test("follows the live tail by default and pins when scrolling up", () => {
  const viewer = new ScratchpadViewer(
    fakeTui(24),
    fakeTheme(),
    { content: () => paragraphs(40), title: () => "pad" },
    () => {},
  );
  viewer.render(60);
  // 40 paragraphs -> ~79 rendered rows; viewport 18 => anchored at 79 - 18.
  assert.equal(viewer.isFollowingEnd, true);
  const tail = viewer.scrollTop;
  assert.ok(tail > 0);

  viewer.handleInput("\u001b[A"); // up one line -> pins
  assert.equal(viewer.scrollTop, tail - 1);
  assert.equal(viewer.isFollowingEnd, false);

  viewer.handleInput("\u001b[5~"); // page up
  assert.ok(viewer.scrollTop < tail - 1);

  viewer.handleInput("\u001b[F"); // end -> back to tail, re-follow
  assert.equal(viewer.scrollTop, tail);
  assert.equal(viewer.isFollowingEnd, true);
});

test("draws a scrollbar thumb only when content overflows the viewport", () => {
  const short = new ScratchpadViewer(
    fakeTui(24),
    fakeTheme(),
    { content: () => "## hi\n\nshort content", title: () => "" },
    () => {},
  );
  assert.ok(!short.render(60).some((l) => l.includes("█")));

  const long = new ScratchpadViewer(
    fakeTui(24),
    fakeTheme(),
    { content: () => paragraphs(200), title: () => "" },
    () => {},
  );
  assert.ok(long.render(60).some((l) => l.includes("█")));
});

test("dismisses on Escape and re-reads live content on re-render", () => {
  let current = paragraphs(3);
  let dismissed = 0;
  const viewer = new ScratchpadViewer(
    fakeTui(12),
    fakeTheme(),
    { content: () => current, title: () => "", onDismiss: () => dismissed++ },
    () => {},
  );

  assert.ok(viewer.render(60).some((l) => l.includes("L2")));

  // New content appended while open -> tail follows it.
  current = paragraphs(4);
  assert.ok(viewer.render(60).some((l) => l.includes("L3")));

  viewer.handleInput("\u001b");
  assert.equal(dismissed, 1);
  viewer.handleInput("q");
  assert.equal(dismissed, 2);
});