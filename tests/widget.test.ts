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
    orbAspect: 2, orbDensity: 1.3, panelHeight: 10, activityLines: 6, scratchpadPanelHeight: 8,
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

test("secondary accent nudge keeps a fixed identity regardless of render timing", () => {
  // Regression guard: the nudge is a pure function of the theme token, so a
  // rebuilt palette never depends on when it was created.
  const a = createOrbPalette(fakeTheme(DARK_THEME));
  const b = createOrbPalette(fakeTheme(DARK_THEME));
  assert.deepEqual(a.secondary, b.secondary);
  assert.deepEqual(a.secondary, mix(hex("#9575cd"), { r: 0xbb, g: 0x9a, b: 0xf7 }, 0.55));
});
