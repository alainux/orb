package tui

import "strings"

// ColorDepth describes the terminal's color capability, detected from the
// COLORTERM / TERM environment per R9 (AC-9.1, AC-9.2).
type ColorDepth int

const (
	ColorTrueColor ColorDepth = iota // 24-bit true color
	Color256                         // 256-color indexed
	Color16                          // 16-color / limited
	ColorNone                        // no usable color
)

// GlyphMode describes how the orb renders particle density. Braille offers 8
// sub-positions per cell (2x4). Half-block offers 2 vertical sub-positions.
// Full-block is the lowest-fidelity fallback. Per spec R9 (AC-9.3) / R18.
type GlyphMode int

const (
	GlyphBraille GlyphMode = iota
	GlyphHalfBlock
	GlyphFullBlock
)

// DisplayMode is the high-level presentation chosen for the session.
type DisplayMode int

const (
	// DisplayVisual is the full two-pane experience with rendered particles
	// and the full palette (24-bit or 256-color).
	DisplayVisual DisplayMode = iota
	// DisplayTextOrb keeps the two-pane layout but renders the orb pane as
	// status text only (no particles) — used at 16 color / no color.
	DisplayTextOrb
	// DisplayNoVisual drops the orb pane entirely; the UI is a single status
	// line plus the artifact pane (--no-visual, AC-9.4 / AC-9.5).
	DisplayNoVisual
)

// TermCap is the resolved terminal capability profile. It is the single
// source of truth that drives layout and rendering decisions.
type TermCap struct {
	Color ColorDepth
	Glyph GlyphMode
	Mode  DisplayMode
}

// DetectTermCap inspects the environment to build a TermCap. env is called
// for COLORTERM and TERM (injectable for testing). forceText selects the
// --no-visual path. glyphOpt is the value of the optional ORB_GLYPH override
// (empty when not set): "braille", "half", or "full".
func DetectTermCap(colorterm, term, glyphOpt string, forceText bool) TermCap {
	if forceText {
		return TermCap{Color: ColorNone, Glyph: GlyphFullBlock, Mode: DisplayNoVisual}
	}

	cap := TermCap{Glyph: detectGlyph(term, glyphOpt)}

	switch {
	case supportsTrueColor(colorterm):
		cap.Color = ColorTrueColor
		cap.Mode = DisplayVisual
	case supports256(term):
		cap.Color = Color256
		cap.Mode = DisplayVisual
	default:
		cap.Color = Color16
		cap.Mode = DisplayTextOrb
	}
	return cap
}

// supportsTrueColor reports a 24-bit capable terminal: COLORTERM is
// "truecolor" or "24bit".
func supportsTrueColor(colorTerm string) bool {
	switch strings.ToLower(strings.TrimSpace(colorTerm)) {
	case "truecolor", "24bit":
		return true
	}
	return false
}

// supports256 reports a 256-color terminal from TERM. True colour is decided
// by COLORTERM first; TERM suffixes such as "256color" indicate indexed color.
func supports256(term string) bool {
	t := strings.ToLower(term)
	return strings.Contains(t, "256color") || strings.Contains(t, "256-color")
}

// detectGlyph resolves the glyph set. An explicit ORB_GLYPH override wins.
// Otherwise Braille is preferred; TERMs that are legacy / known-lacking fall
// back to half-block (the terminal font can't be introspected, so we use a
// conservative heuristic for these).
func detectGlyph(term, glyphOpt string) GlyphMode {
	switch strings.ToLower(strings.TrimSpace(glyphOpt)) {
	case "braille":
		return GlyphBraille
	case "half", "half-block", "half_block":
		return GlyphHalfBlock
	case "full", "full-block", "full_block", "block":
		return GlyphFullBlock
	}

	switch strings.ToLower(term) {
	// Legacy / minimal terminals with no Braille glyph coverage. Fall back to
	// half-block ("▀"/"▄"), which ships in the base character set.
	case "dumb", "cons25", "vt100", "vt220", "ansi":
		return GlyphHalfBlock
	}
	return GlyphBraille
}

// String returns a human-readable label, used in --version/debug output.
func (c ColorDepth) String() string {
	switch c {
	case ColorTrueColor:
		return "truecolor"
	case Color256:
		return "256"
	case Color16:
		return "16"
	default:
		return "none"
	}
}

// String returns a human-readable label.
func (g GlyphMode) String() string {
	switch g {
	case GlyphBraille:
		return "braille"
	case GlyphHalfBlock:
		return "half-block"
	default:
		return "full-block"
	}
}
