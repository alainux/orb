// Tokyo Night inspired palette for the Orb widget.
//
// Orb inherits Pi's active theme (see README). Pi's Theme object exposes named
// color tokens through fg()/getFgAnsi(), but not raw RGB values, so this module
// recovers the resolved RGB of the tokens we care about by parsing the emitted
// ANSI sequences (truecolor or 256-color). The result is a small palette that
// tracks the active theme while nudging the "secondary accent" toward Tokyo
// Night's signature violet (#bb9af7), so the Orb reads as a cyan→violet
// gradient no matter which theme Pi is currently running.

export type OrbThemeColor =
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
  | "customMessageLabel"
  | "toolTitle"
  | "toolOutput"
  | "mdHeading"
  | "mdLink"
  | "mdCode"
  | "mdListBullet"
  | "syntaxKeyword"
  | "syntaxType"
  | "syntaxString"
  | "syntaxNumber"
  | "syntaxFunction"
  | "thinkingLow"
  | "thinkingMedium"
  | "thinkingHigh"
  | "thinkingXhigh"
  | "bashMode";

export type ColorMode = "truecolor" | "256color";

/** Minimal structural view of Pi's Theme that this widget depends on. */
export interface ThemeLike {
  fg(name: OrbThemeColor, text: string): string;
  getFgAnsi?(name: OrbThemeColor): string;
  getBgAnsi?(name: "selectedBg"): string;
  getColorMode?(): ColorMode;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface OrbPalette {
  /** Resolved RGB of the theme's primary accent. */
  primary: Rgb;
  /** Resolved RGB of the theme's secondary accent (violet). */
  secondary: Rgb;
  /** True when the active theme is dark, used to tune gradient highlights. */
  isDark: boolean;
  /** Style text with the theme's primary accent. */
  primaryText(text: string): string;
  /** Style text with the secondary (violet) accent. */
  secondaryText(text: string): string;
  /**
   * Color a single orb glyph with the primary→secondary gradient.
   * `t` is the position along the gradient, 0 (deep primary) to 1 (bright
   * secondary highlight).
   */
  orbGlyph(t: number, glyph: string): string;
  /** The gradient color at position `t` (0 = deep primary, 1 = bright highlight). */
  rampAt(t: number): Rgb;
  /** Render a glyph with an arbitrary resolved RGB (theme-derived color math). */
  color(c: Rgb, glyph: string): string;
}

// ---------------------------------------------------------------------------
// Tokyo Night reference colors (fallback when a theme token is not parseable)
// ---------------------------------------------------------------------------

const TN_BLUE: Rgb = { r: 0x7a, g: 0xa2, b: 0xf7 }; // #7aa2f7
const TN_VIOLET: Rgb = { r: 0xbb, g: 0x9a, b: 0xf7 }; // #bb9af7
const TN_BG: Rgb = { r: 0x1a, g: 0x1b, b: 0x26 }; // #1a1b26
const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };

// ---------------------------------------------------------------------------
// ANSI parsing — recover RGB from the theme's emitted escape sequences
// ---------------------------------------------------------------------------

const ANSI_FG_RGB = /\x1b\[38;2;(\d+);(\d+);(\d+)m/;
const ANSI_FG_256 = /\x1b\[38;5;(\d+)m/;
const ANSI_BG_RGB = /\x1b\[48;2;(\d+);(\d+);(\d+)m/;
const ANSI_BG_256 = /\x1b\[48;5;(\d+)m/;

export function parseFgRgb(ansi: string): Rgb | undefined {
  const rgb = ansi.match(ANSI_FG_RGB);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  const idx = ansi.match(ANSI_FG_256);
  if (idx) return ansi256ToRgb(Number(idx[1]));
  return undefined;
}

export function parseBgRgb(ansi: string): Rgb | undefined {
  const rgb = ansi.match(ANSI_BG_RGB);
  if (rgb) return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  const idx = ansi.match(ANSI_BG_256);
  if (idx) return ansi256ToRgb(Number(idx[1]));
  return undefined;
}

// ---------------------------------------------------------------------------
// 256-color mapping (standard xterm palette)
// ---------------------------------------------------------------------------

const BASIC16: Rgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 0, b: 0 },
  { r: 0, g: 128, b: 0 },
  { r: 128, g: 128, b: 0 },
  { r: 0, g: 0, b: 128 },
  { r: 128, g: 0, b: 128 },
  { r: 0, g: 128, b: 128 },
  { r: 192, g: 192, b: 192 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
];

const CUBE = [0, 95, 135, 175, 215, 255];

export function ansi256ToRgb(index: number): Rgb {
  if (index < 16) return BASIC16[index] ?? BLACK;
  if (index < 232) {
    const i = index - 16;
    return {
      r: CUBE[Math.floor(i / 36)] ?? 0,
      g: CUBE[Math.floor((i % 36) / 6)] ?? 0,
      b: CUBE[i % 6] ?? 0,
    };
  }
  const gray = 8 + (index - 232) * 10;
  return { r: gray, g: gray, b: gray };
}

export function rgbToAnsi256(c: Rgb): number {
  const rIdx = nearestIndex(c.r, CUBE);
  const gIdx = nearestIndex(c.g, CUBE);
  const bIdx = nearestIndex(c.b, CUBE);
  const cubeIndex = 16 + 36 * rIdx + 6 * gIdx + bIdx;
  const cubeDist = colorDistance(c, { r: CUBE[rIdx] ?? 0, g: CUBE[gIdx] ?? 0, b: CUBE[bIdx] ?? 0 });

  const gray = Math.round(0.299 * c.r + 0.587 * c.g + 0.114 * c.b);
  const grayIdx = Math.min(23, Math.max(0, Math.round((gray - 8) / 10)));
  const grayDist = colorDistance(c, { r: gray, g: gray, b: gray });

  const spread = Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  if (spread < 10 && grayDist < cubeDist) return 232 + grayIdx;
  return cubeIndex;
}

// ---------------------------------------------------------------------------
// Color math
// ---------------------------------------------------------------------------

export function mix(a: Rgb, b: Rgb, t: number): Rgb {
  const k = clamp01(t);
  return {
    r: Math.round(a.r + (b.r - a.r) * k),
    g: Math.round(a.g + (b.g - a.g) * k),
    b: Math.round(a.b + (b.b - a.b) * k),
  };
}

export function luminance(c: Rgb): number {
  return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) / 255;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function nearestIndex(value: number, ramp: readonly number[]): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ramp.length; i++) {
    const dist = Math.abs(value - (ramp[i] ?? 0));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

// ---------------------------------------------------------------------------
// Palette construction
// ---------------------------------------------------------------------------

/**
 * Gradient anchors for the orb, from deep primary mist through the primary
 * accent into the violet secondary and a bright filament highlight.
 */
function buildRamp(primary: Rgb, secondary: Rgb, isDark: boolean): Rgb[] {
  const deep = isDark ? mix(primary, TN_BG, 0.68) : mix(primary, BLACK, 0.3);
  const mid = mix(primary, secondary, 0.55);
  const bright = isDark ? mix(secondary, WHITE, 0.38) : mix(secondary, BLACK, 0.08);
  return [deep, primary, mid, secondary, bright];
}

function rampColor(ramp: readonly Rgb[], t: number): Rgb {
  const scaled = clamp01(t) * (ramp.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(ramp.length - 1, lower + 1);
  return mix(ramp[lower] ?? BLACK, ramp[upper] ?? BLACK, scaled - lower);
}

function detectDark(theme: ThemeLike): boolean {
  const ansi = safeBgAnsi(theme, "selectedBg");
  const rgb = ansi ? parseBgRgb(ansi) : undefined;
  return rgb ? luminance(rgb) < 0.5 : true;
}

function safeFgAnsi(theme: ThemeLike, name: OrbThemeColor): string | undefined {
  if (!theme.getFgAnsi) return undefined;
  try {
    return theme.getFgAnsi(name);
  } catch {
    return undefined;
  }
}

function safeBgAnsi(theme: ThemeLike, name: "selectedBg"): string | undefined {
  if (!theme.getBgAnsi) return undefined;
  try {
    return theme.getBgAnsi(name);
  } catch {
    return undefined;
  }
}

function ansiPrefix(c: Rgb, mode: ColorMode | undefined): string {
  if (mode === "256color") return `\x1b[38;5;${rgbToAnsi256(c)}m`;
  // Truecolor ANSI requires integer components 0-255; the orb's dimming/
  // desaturation helpers can produce float channels, so clamp+round here at
  // the single choke point where every color leaves for the terminal.
  return `\x1b[38;2;${Math.round(Math.max(0, Math.min(255, c.r)))};${Math.round(Math.max(0, Math.min(255, c.g)))};${Math.round(Math.max(0, Math.min(255, c.b)))}m`;
}

export function createOrbPalette(theme: ThemeLike): OrbPalette {
  const mode = theme.getColorMode?.();
  const primary = parseFgRgb(safeFgAnsi(theme, "accent") ?? "") ?? TN_BLUE;
  const secondaryBase = parseFgRgb(safeFgAnsi(theme, "customMessageLabel") ?? "") ?? TN_VIOLET;
  // Nudge the theme's label violet toward Tokyo Night's signature violet so the
  // secondary accent always reads as a rich purple, even in muted themes.
  const secondary = mix(secondaryBase, TN_VIOLET, 0.55);
  const isDark = detectDark(theme);
  const ramp = buildRamp(primary, secondary, isDark);
  const codes = Array.from({ length: 33 }, (_, i) => ansiPrefix(rampColor(ramp, i / 32), mode));

  return {
    primary,
    secondary,
    isDark,
    primaryText: (text: string) => theme.fg("accent", text),
    secondaryText: (text: string) => `${ansiPrefix(secondary, mode)}${text}\x1b[39m`,
    orbGlyph: (t: number, glyph: string) => {
      const index = Math.min(32, Math.max(0, Math.round(clamp01(t) * 32)));
      return `${codes[index] ?? "\x1b[39m"}${glyph}\x1b[39m`;
    },
    rampAt: (t: number) => rampColor(ramp, t),
    color: (c: Rgb, glyph: string) => `${ansiPrefix(c, mode)}${glyph}\x1b[39m`,
  };
}
