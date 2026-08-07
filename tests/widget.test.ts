import assert from "node:assert/strict";
import test from "node:test";
import type { TUI } from "@earendil-works/pi-tui";
import { createOrbPalette, mix, rgbToAnsi256, type ColorMode, type Rgb, type ThemeLike } from "../src/theme.js";
import type { VoiceViewState } from "../src/types.js";
import { statusForDisplay, VoiceWidget } from "../src/widget.js";

test("status shows muted in place of listening while the microphone is muted", () => {
  // Not muted: status passes through unchanged.
  assert.equal(statusForDisplay("live · listening", false), "live · listening");
  assert.equal(statusForDisplay("Pi working · listening", false), "Pi working · listening");
  // Muted: "listening" becomes "muted" in the same position, "live" is kept.
  assert.equal(statusForDisplay("live · listening", true), "live · muted");
  assert.equal(statusForDisplay("Pi working · listening", true), "Pi working · muted");
  assert.equal(statusForDisplay("waiting for Pi · listening", true), "waiting for Pi · muted");
  assert.equal(statusForDisplay("Pi task queued · listening", true), "Pi task queued · muted");
  assert.equal(statusForDisplay("Pi cancelled · listening", true), "Pi cancelled · muted");
  // Statuses without "listening" are untouched even while muted.
  assert.equal(statusForDisplay("starting · gemini", true), "starting · gemini");
  assert.equal(statusForDisplay("error · see diagnostics", true), "error · see diagnostics");
  assert.equal(statusForDisplay("off", true), "off");
});

// ---------------------------------------------------------------------------
// Theme-change compliance: Pi swaps the active theme at runtime and calls
// component.invalidate(). The widget must rebuild its derived palette so the
// status text (secondaryText) and orb glyphs (orbGlyph) adopt the new theme.
// ---------------------------------------------------------------------------

function hex(hexColor: string): Rgb {
  const cleaned = hexColor.replace("#", "");
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function fakeTheme(colors: Record<string, string>, mode: ColorMode = "truecolor"): ThemeLike {
  const fgAnsi = (name: string): string => {
    const rgb = hex(colors[name] ?? "#000000");
    return mode === "truecolor" ? `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m` : `\x1b[38;5;${rgbToAnsi256(rgb)}m`;
  };
  return {
    fg: (name, text) => `${fgAnsi(name)}${text}\x1b[39m`,
    getFgAnsi: (name) => fgAnsi(name),
    getBgAnsi: () => (mode === "truecolor" ? "\x1b[48;2;58;58;74m" : "\x1b[48;5;236m"),
    getColorMode: () => mode,
  };
}

const DARK_THEME = {
  accent: "#8abeb7",
  customMessageLabel: "#9575cd",
  selectedBg: "#3a3a4a",
  mdLink: "#81a2be",
};
const LIGHT_THEME = {
  accent: "#0066cc",
  customMessageLabel: "#cc0000",
  selectedBg: "#f0f0f0",
  mdLink: "#1a5f9e",
};

function viewState(): VoiceViewState {
  return {
    active: true, status: "live · listening", source: "idle", muted: false,
    inputTranscript: "", outputTranscript: "", inputRms: 0, outputRms: 0,
    audioCaptureDrops: 0, audioQueuedMs: 0, audioRecoveries: 0,
    piAgentStatus: "idle", activity: [], error: undefined,
    scratchpad: { open: false, title: "Scratchpad", content: "", dirty: false },
  };
}

test("widget palette adopts a runtime theme change via invalidate()", () => {
  const requests: number[] = [];
  const tui = { requestRender: () => requests.push(1) } as unknown as TUI;
  // Pi's real `theme` is a live proxy: every fg()/getFgAnsi() call re-resolves
  // against the currently active theme. Model that with a mutable record the
  // fake theme reads at call time.
  const themeColors: Record<string, string> = { ...DARK_THEME };
  const theme = fakeTheme(themeColors);
  const widget = new VoiceWidget(tui, theme, viewState, {
    orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: false, panelHeight: 10, activityLines: 6, scratchpadPanelHeight: 8,
  });

  const before = widget.render(80);
  const darkSecondary = createOrbPalette(fakeTheme(DARK_THEME)).secondary;
  assert.ok(before[0]!.includes(`38;2;${darkSecondary.r};${darkSecondary.g};${darkSecondary.b}`), "status line starts with the dark theme's secondary accent");

  // Theme change in settings → Pi swaps the active theme and calls invalidate().
  Object.assign(themeColors, LIGHT_THEME);
  widget.invalidate();
  const after = widget.render(80);
  assert.ok(requests.length > 0, "invalidate must request a render");

  // Status text (secondaryText) must adopt the new theme's secondary accent.
  const lightPalette = createOrbPalette(fakeTheme(LIGHT_THEME));
  assert.ok(after[0]!.includes(`38;2;${lightPalette.secondary.r};${lightPalette.secondary.g};${lightPalette.secondary.b}`), "status line adopts the light theme's secondary accent");
  assert.ok(!before[0]!.includes(`38;2;${lightPalette.secondary.r};${lightPalette.secondary.g};${lightPalette.secondary.b}`), "old render must not already contain the new theme's color");

  // The ORB label (theme accent, live proxy) must follow the new theme too.
  assert.ok(after[0]!.includes(`38;2;${lightPalette.primary.r};${lightPalette.primary.g};${lightPalette.primary.b}`), "ORB label adopts the light theme's primary accent");

  // The orb glyph area must re-color with the new palette (the two ramps are
  // built from different primaries, so every gradient code changes).
  assert.notEqual(after.slice(1).join("\n"), before.slice(1).join("\n"), "orb visualization adopts the new theme's gradient");
  const newGradientCodes = new Set(Array.from({ length: 33 }, (_, i) => lightPalette.orbGlyph(i / 32, "·").split("·")[0]));
  assert.ok(after.join("\n").split("\n").some((line) => newGradientCodes.has(line.match(/\x1b\[38;2;[^m]*m/)?.[0] ?? "")), "orb glyphs use the new theme's gradient codes");
});

test("orb animation mode follows voice state: composing while talking, searching while working", () => {
  const requests: number[] = [];
  const tui = { requestRender: () => requests.push(1) } as unknown as TUI;
  const state = viewState();
  const widget = new VoiceWidget(tui, fakeTheme({ ...DARK_THEME }), () => state, {
    orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: false, panelHeight: 10, activityLines: 6, scratchpadPanelHeight: 8,
  });
  // Converge the motion envelope so static states stop repainting.
  let now = 1_000;
  for (let i = 0; i < 80; i++) { now += 16; widget.tickAnimation(now); }
  requests.length = 0;

  // Pi working → searching mode animates on the continuous clock.
  state.piAgentStatus = "working";
  now += 16; widget.tickAnimation(now);
  assert.ok(requests.length > 0, "working state must animate the searching orb");

  // Back to idle: the smoke orb keeps animating — the wave and the drifting
  // light run on the continuous clock, so the living sphere repaints as t
  // advances even in total silence.
  state.piAgentStatus = "idle";
  widget.tickAnimation(now += 16); // mode switch repaints once
  requests.length = 0;
  for (let i = 0; i < 5; i++) { now += 16; widget.tickAnimation(now); }
  assert.ok(requests.length > 0, "idle smoke orb must keep repainting as the clock advances");

  // Talking → composing mode keeps animating even with a steady mic level.
  state.source = "user";
  state.inputRms = 0.5;
  widget.tickAnimation(now += 16); // mode switch repaints once
  requests.length = 0;
  for (let i = 0; i < 5; i++) { now += 16; widget.tickAnimation(now); }
  assert.ok(requests.length > 0, "talking state must keep the composing wave animating");
});

test("secondary accent nudge keeps a fixed identity regardless of render timing", () => {
  // Regression guard: the nudge is a pure function of the theme token, so a
  // rebuilt palette never depends on when it was created.
  const a = createOrbPalette(fakeTheme(DARK_THEME));
  const b = createOrbPalette(fakeTheme(DARK_THEME));
  assert.deepEqual(a.secondary, b.secondary);
  assert.deepEqual(a.secondary, mix(hex("#9575cd"), { r: 0xbb, g: 0x9a, b: 0xf7 }, 0.55));
});

// ---------------------------------------------------------------------------
// Coloring follows the two-energy-region identity field: every orb cell is
// painted by its `identity` (where it sits on the signed drifting field) along
// the theme's primary accent ↔ secondary violet anchors, with a mode-dependent
// boundary. Muted renders gray. These tests probe the widget's mapping and
// that the composed sphere surfaces BOTH energy anchors.
// ---------------------------------------------------------------------------

interface ColoredGlyph { x: number; c: Rgb }
/** Walk an ANSI-rendered line, recording each glyph's position and resolved RGB. */
function scanColors(line: string): ColoredGlyph[] {
  const out: ColoredGlyph[] = [];
  let x = 0;
  let current: Rgb | undefined;
  let i = 0;
  while (i < line.length) {
    if (line[i] === "\x1b") {
      const rgb = line.slice(i).match(/^\x1b\[38;2;(\d+);(\d+);(\d+)m/);
      if (rgb) { current = { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) }; i += rgb[0].length; continue; }
      const reset = line.slice(i).match(/^\x1b\[\d+m/);
      if (reset) { current = undefined; i += reset[0].length; continue; }
      i++;
      continue;
    }
    if (line[i] !== " ") out.push({ x, c: current ?? { r: 0, g: 0, b: 0 } });
    x++;
    i++;
  }
  return out;
}
function orbGlyphs(lines: string[], width: number): ColoredGlyph[] {
  // Full view: line 0 is the title, the trailing lines are the meters bar and
  // rule — everything between is the body, where the orb occupies only the
  // left `leftWidth` columns (the right panel is the activity feed).
  const leftWidth = Math.min(39, Math.max(25, Math.floor(width * 0.31)));
  return lines.slice(1, Math.max(1, lines.length - 2)).flatMap((line) => scanColors(line).filter((g) => g.x < leftWidth));
}
function averageViolet(glyphs: ColoredGlyph[], predicate: (g: ColoredGlyph) => boolean): number {
  const picked = glyphs.filter(predicate);
  if (picked.length === 0) return 0;
  const avg = picked.reduce((acc, g) => ({ r: acc.r + g.c.r, g: acc.g + g.c.g, b: acc.b + g.c.b }), { r: 0, g: 0, b: 0 });
  const n = picked.length;
  return (avg.b / n) - (avg.r / n); // violet reads as b > r
}

test("the identity field surfaces the theme's two energy anchors across the orb", () => {
  const tui = { requestRender: () => {} } as unknown as TUI;
  const theme = fakeTheme({ ...DARK_THEME });
  const state = viewState();
  state.inputRms = 0.4;
  const widget = new VoiceWidget(tui, theme, () => state, {
    orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: false, panelHeight: 16, activityLines: 8, scratchpadPanelHeight: 8,
  });
  let now = 1_000;
  for (let i = 0; i < 60; i++) { now += 16; widget.tickAnimation(now); }
  const glyphs = orbGlyphs(widget.render(80), 80);
  assert.ok(glyphs.length > 40, `orb rendered ${glyphs.length} glyphs`);
  // The signed two-region field maps onto the theme's two anchors — the sphere
  // paints cells biasing to BOTH the primary accent and the secondary (violet)
  // side of the drifting boundary, never collapsing to a single hue.
  const pal = createOrbPalette(fakeTheme({ ...DARK_THEME }));
  const nearPrimary = (g: ColoredGlyph) => (g.c.r - pal.primary.r) ** 2 + (g.c.g - pal.primary.g) ** 2 + (g.c.b - pal.primary.b) ** 2;
  const nearSecondary = (g: ColoredGlyph) => (g.c.r - pal.secondary.r) ** 2 + (g.c.g - pal.secondary.g) ** 2 + (g.c.b - pal.secondary.b) ** 2;
  let primaryArm = 0;
  let secondaryArm = 0;
  for (const g of glyphs) {
    if (nearPrimary(g) < nearSecondary(g)) primaryArm++;
    else secondaryArm++;
  }
  assert.ok(primaryArm > 5, `orb cells biased toward the primary accent: ${primaryArm}`);
  assert.ok(secondaryArm > 5, `orb cells biased toward the secondary violet: ${secondaryArm}`);
});
test("muted orb renders a gray sphere while Pi works", () => {
  const tui = { requestRender: () => {} } as unknown as TUI;
  const state = viewState();
  state.piAgentStatus = "working";
  state.muted = true;
  const widget = new VoiceWidget(tui, fakeTheme({ ...DARK_THEME }), () => state, {
    orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: false, panelHeight: 16, activityLines: 6, scratchpadPanelHeight: 8,
  });
  widget.tickAnimation(1_000);
  const glyphs = orbGlyphs(widget.render(80), 80);
  assert.ok(glyphs.length > 40, `muted orb rendered ${glyphs.length} glyphs`);
  for (const g of glyphs) {
    assert.equal(g.c.r, g.c.g, `gray requires r===g at x=${g.x} (${g.c.r},${g.c.g},${g.c.b})`);
    assert.equal(g.c.g, g.c.b, `gray requires g===b at x=${g.x} (${g.c.r},${g.c.g},${g.c.b})`);
  }
});

test("braille mode renders 8-dot glyphs through the theme pipeline", () => {
  const tui = { requestRender: () => {} } as unknown as TUI;
  const theme = fakeTheme({ ...DARK_THEME });
  const state = viewState();
  state.source = "user";
  state.inputRms = 0.5;
  const widget = new VoiceWidget(tui, theme, () => state, {
    orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: true, panelHeight: 16, activityLines: 6, scratchpadPanelHeight: 8,
  });
  let now = 1_000;
  for (let i = 0; i < 40; i++) { now += 16; widget.tickAnimation(now); }
  const glyphs = orbGlyphs(widget.render(80), 80);
  assert.ok(glyphs.length > 40, `braille orb rendered ${glyphs.length} glyphs`);
  // Every orb glyph is a Braille character and is theme-colored (not black).
  for (const g of glyphs) {
    // scanColors only records x; re-parse: Braille glyphs are U+2800+mask.
    assert.ok(g.c.r + g.c.g + g.c.b > 0, "braille cells must be colored");
  }
  // The rendered lines themselves contain Braille codepoints in the orb panel.
  const lines = widget.render(80);
  const orbText = lines.slice(1, Math.max(1, lines.length - 2)).join("");
  const brailleCount = [...orbText].filter((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return cp >= 0x2800 && cp <= 0x28ff;
  }).length;
  assert.ok(brailleCount > 40, `orb area carries ${brailleCount} Braille glyphs`);
});

test("working orb reads calmer than the talking orb", () => {
  const tui = { requestRender: () => {} } as unknown as TUI;
  const theme = fakeTheme({ ...DARK_THEME });
  const run = (talking: boolean): ColoredGlyph[] => {
    const state = viewState();
    if (talking) { state.source = "user"; state.inputRms = 0.5; }
    else state.piAgentStatus = "working";
    const widget = new VoiceWidget(tui, theme, () => state, {
      orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: false, panelHeight: 16, activityLines: 6, scratchpadPanelHeight: 8,
    });
    let now = 1_000;
    for (let i = 0; i < 40; i++) { now += 16; widget.tickAnimation(now); }
    const glyphs = orbGlyphs(widget.render(80), 80);
    assert.ok(glyphs.length > 40, `orb rendered ${glyphs.length} glyphs`);
    return glyphs;
  };
  const brightness = (gs: ColoredGlyph[]) => gs.reduce((s, g) => s + (g.c.r + g.c.g + g.c.b) / 3, 0) / Math.max(1, gs.length);
  const talking = run(true);
  const working = run(false);
  // The working globe is dimmed and softly desaturated; talking flares bright.
  assert.ok(brightness(working) < brightness(talking) * 0.95, `working ${brightness(working).toFixed(1)} vs talking ${brightness(talking).toFixed(1)}`);
});

test("listening color intensifies with mic input and stays alive in silence", () => {
  const tui = { requestRender: () => {} } as unknown as TUI;
  const theme = fakeTheme({ ...DARK_THEME });
  const run = (mic: boolean): ColoredGlyph[] => {
    const state = viewState();
    if (mic) { state.source = "user"; state.inputRms = 0.6; }
    const widget = new VoiceWidget(tui, theme, () => state, {
      orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: false, panelHeight: 16, activityLines: 6, scratchpadPanelHeight: 8,
    });
    let now = 1_000;
    for (let i = 0; i < 40; i++) { now += 16; widget.tickAnimation(now); }
    const glyphs = orbGlyphs(widget.render(80), 80);
    assert.ok(glyphs.length > 15, `listening orb rendered ${glyphs.length} glyphs`);
    return glyphs;
  };
  const brightness = (gs: ColoredGlyph[]) => gs.reduce((s, g) => s + (g.c.r + g.c.g + g.c.b) / 3, 0) / Math.max(1, gs.length);
  // Without audio the wave stays alive but minimal: dim, yet still themed
  // (colored — never black or gray).
  const silent = run(false);
  assert.ok(silent.every((g) => g.c.r + g.c.g + g.c.b > 0), "silent listening must not render black cells");
  // Mic input intensifies both color saturation and brightness.
  const loud = run(true);
  const whiteish = (gs: ColoredGlyph[]) => gs.filter((g) => g.c.r > 190 && g.c.g > 190 && g.c.b > 190).length;
  // Mic input flares the composing sphere toward white (the pressure bloom),
  // so loud produces near-white cells the silent idle does not.
  assert.ok(whiteish(loud) > whiteish(silent), `mic produces near-white bloom cells (${whiteish(loud)} vs ${whiteish(silent)})`);
  assert.ok(brightness(loud) > brightness(silent), `mic must brighten the sphere (${brightness(loud).toFixed(1)} vs ${brightness(silent).toFixed(1)})`);
});

test("mode switch dissolves keep repainting until the crossfade ends", () => {
  const requests: number[] = [];
  const tui = { requestRender: () => requests.push(1) } as unknown as TUI;
  const state = viewState();
  const widget = new VoiceWidget(tui, fakeTheme({ ...DARK_THEME }), () => state, {
    orbAspect: 2, orbDensity: 1.3, orbReactivity: 0.7, orbBraille: false, panelHeight: 10, activityLines: 6, scratchpadPanelHeight: 8,
  });
  let now = 1_000;
  for (let i = 0; i < 80; i++) { now += 16; widget.tickAnimation(now); }
  // Pi finishes working → back to idle: the searching→smoke dissolve begins
  // on the first repaint and must keep the orb repainting for its duration.
  state.piAgentStatus = "idle";
  widget.tickAnimation(now += 16); // mode switch repaints once
  widget.render(80); // actual repaint — the renderer starts dissolving
  requests.length = 0;
  for (let i = 0; i < 12; i++) { now += 16; widget.tickAnimation(now); widget.render(80); }
  assert.ok(requests.length > 0, "the mode dissolve must keep requesting repaints");
  // Once the fade completes the orb keeps repainting — the living sphere's
  // wave and drifting light run on the continuous clock, so only the dissolve
  // itself is a time-boxed burst, not the animation.
  for (let i = 0; i < 40; i++) { now += 16; widget.tickAnimation(now); widget.render(80); }
  requests.length = 0;
  for (let i = 0; i < 5; i++) { now += 16; widget.tickAnimation(now); widget.render(80); }
  assert.ok(requests.length > 0, "the living sphere keeps repainting after the fade ends");
});
