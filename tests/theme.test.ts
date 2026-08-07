import assert from "node:assert/strict";
import test from "node:test";
import { orbLayerHeat } from "../src/orb.js";
import {
  ansi256ToRgb,
  createOrbPalette,
  luminance,
  mix,
  parseBgRgb,
  parseFgRgb,
  rgbToAnsi256,
  type ColorMode,
  type Rgb,
  type ThemeLike,
} from "../src/theme.js";

// Dark theme tokens (mirror pi's built-in dark.json).
const DARK: Record<string, string> = {
  accent: "#8abeb7",
  customMessageLabel: "#9575cd",
  selectedBg: "#3a3a4a",
  mdLink: "#81a2be",
  toolTitle: "#d4d4d4",
  toolOutput: "#808080",
  thinkingText: "#808080",
  success: "#b5bd68",
  error: "#cc6666",
  muted: "#808080",
  dim: "#666666",
};

function hex(hexColor: string): Rgb {
  const cleaned = hexColor.replace("#", "");
  return {
    r: parseInt(cleaned.slice(0, 2), 16),
    g: parseInt(cleaned.slice(2, 4), 16),
    b: parseInt(cleaned.slice(4, 6), 16),
  };
}

function fakeTheme(mode: ColorMode = "truecolor"): ThemeLike {
  const fgAnsi = (name: string): string => {
    const rgb = hex(DARK[name] ?? "#000000");
    return mode === "truecolor" ? `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m` : `\x1b[38;5;${rgbToAnsi256(rgb)}m`;
  };
  return {
    fg: (name, text) => `${fgAnsi(name)}${text}\x1b[39m`,
    getFgAnsi: (name) => fgAnsi(name),
    getBgAnsi: () => (mode === "truecolor" ? "\x1b[48;2;58;58;74m" : "\x1b[48;5;236m"),
    getColorMode: () => mode,
  };
}

test("ANSI fg parsing recovers RGB from truecolor and 256-color sequences", () => {
  assert.deepEqual(parseFgRgb("\x1b[38;2;138;190;183m"), { r: 138, g: 190, b: 183 });
  assert.deepEqual(parseFgRgb("\x1b[38;5;109m"), { r: 135, g: 175, b: 175 });
  assert.equal(parseFgRgb("\x1b[39m"), undefined);
  assert.equal(parseFgRgb(""), undefined);
});

test("ANSI bg parsing recovers RGB and 256-color indexing round-trips", () => {
  assert.deepEqual(parseBgRgb("\x1b[48;2;58;58;74m"), { r: 58, g: 58, b: 74 });
  assert.deepEqual(parseBgRgb("\x1b[48;5;236m"), ansi256ToRgb(236));
  assert.deepEqual(ansi256ToRgb(69), { r: 95, g: 135, b: 255 });
  assert.equal(rgbToAnsi256({ r: 95, g: 135, b: 255 }), 69);
  assert.equal(rgbToAnsi256(hex("#8abeb7")), 109);
});

test("palette derives primary/secondary from the active theme tokens", () => {
  const palette = createOrbPalette(fakeTheme("truecolor"));
  assert.deepEqual(palette.primary, hex("#8abeb7")); // theme accent token
  // secondary = theme customMessageLabel nudged toward Tokyo Night violet
  assert.deepEqual(palette.secondary, mix(hex("#9575cd"), { r: 0xbb, g: 0x9a, b: 0xf7 }, 0.55));
  assert.equal(palette.isDark, true);
  // secondaryText uses the secondary RGB with a proper fg reset
  assert.equal(palette.secondaryText("·"), `\x1b[38;2;170;137;228m·\x1b[39m`);
  // primaryText delegates to the theme's accent token
  assert.equal(palette.primaryText("ORB"), "\x1b[38;2;138;190;183mORB\x1b[39m");
});

test("palette falls back to Tokyo Night colors when the theme exposes no RGB", () => {
  const bare: ThemeLike = { fg: (name, text) => `${name}:${text}` };
  const palette = createOrbPalette(bare);
  assert.deepEqual(palette.primary, { r: 0x7a, g: 0xa2, b: 0xf7 }); // Tokyo Night blue
  assert.deepEqual(palette.secondary, { r: 0xbb, g: 0x9a, b: 0xf7 }); // Tokyo Night violet
  assert.equal(palette.isDark, true);
  const glyph = palette.orbGlyph(0.5, "∙");
  assert.match(glyph, /^\x1b\[38;2;\d+;\d+;\d+m∙\x1b\[39m$/);
});

test("palette quantizes to 256-color in 256-color mode", () => {
  const palette = createOrbPalette(fakeTheme("256color"));
  assert.deepEqual(palette.primary, ansi256ToRgb(rgbToAnsi256(hex("#8abeb7"))));
  assert.match(palette.orbGlyph(0, "·"), /^\x1b\[38;5;\d+m·\x1b\[39m$/);
  assert.match(palette.secondaryText("x"), /^\x1b\[38;5;\d+mx\x1b\[39m$/);
});

test("orb gradient spans primary to secondary and highlights toward the end", () => {
  const palette = createOrbPalette(fakeTheme("truecolor"));
  const low = palette.orbGlyph(0, "·");
  const high = palette.orbGlyph(1, "·");
  const lowRgb = low.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  const highRgb = high.match(/\x1b\[38;2;(\d+);(\d+);(\d+)m/);
  assert.ok(lowRgb && highRgb);
  const a = { r: Number(lowRgb[1]), g: Number(lowRgb[2]), b: Number(lowRgb[3]) };
  const b = { r: Number(highRgb[1]), g: Number(highRgb[2]), b: Number(highRgb[3]) };
  assert.ok(luminance(a) < luminance(b), "highlight end is brighter than the deep end");
  assert.ok(b.r > 190 && b.b > 190, "highlight end is a bright violet");
});

test("orb layers map onto the theme gradient deterministically", () => {
  assert.equal(orbLayerHeat("filament", 1), 1);
  assert.ok(Math.abs(orbLayerHeat("filament", 0.5) - 0.83) < 1e-12);
  assert.equal(orbLayerHeat("mistA", 0), 0.4);
  assert.equal(orbLayerHeat("mistB", 0), 0.16);
  assert.equal(orbLayerHeat("mistC", 0), 0.03);
  assert.equal(orbLayerHeat("none", 0.9), 0);
  assert.ok(orbLayerHeat("mistA", 10) <= 1, "clamps at the bright end");
  assert.ok(orbLayerHeat("mistC", -1) >= 0, "clamps at the deep end");
});
