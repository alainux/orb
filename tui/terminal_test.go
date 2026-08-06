package tui

import "testing"

// Terminal capability detection (R9, AC-9.1..9.5).
func TestDetectTrueColor(t *testing.T) {
	for _, ct := range []string{"truecolor", "truecolor", "24bit", " 24BIT "} {
		cap := DetectTermCap(ct, "xterm-256color", "", false)
		if cap.Color != ColorTrueColor {
			t.Errorf("COLORTERM=%q: got color %v, want truecolor", ct, cap.Color)
		}
		if cap.Mode != DisplayVisual {
			t.Errorf("COLORTERM=%q: got mode %v, want visual", ct, cap.Mode)
		}
	}
}

func TestDetect256(t *testing.T) {
	cap := DetectTermCap("", "xterm-256color", "", false)
	if cap.Color != Color256 {
		t.Errorf("TERM=xterm-256color: got %v, want 256", cap.Color)
	}
	if cap.Mode != DisplayVisual {
		t.Errorf("TERM=xterm-256color: got mode %v, want visual", cap.Mode)
	}
	// truecolor takes precedence over TERM.
	cap = DetectTermCap("24bit", "xterm", "", false)
	if cap.Color != ColorTrueColor {
		t.Errorf("COLORTERM=24bit + TERM=xterm: got %v, want truecolor", cap.Color)
	}
}

func TestDetect16ColorIsTextOrb(t *testing.T) {
	cap := DetectTermCap("", "xterm", "", false)
	if cap.Color != Color16 {
		t.Errorf("TERM=xterm: got %v, want 16", cap.Color)
	}
	// AC-9.2: 16-color → text-only orb mode (no particles).
	if cap.Mode != DisplayTextOrb {
		t.Errorf("TERM=xterm: got mode %v, want text-orb", cap.Mode)
	}
}

func TestDetectNoVisual(t *testing.T) {
	cap := DetectTermCap("truecolor", "xterm-256color", "", true)
	if cap.Mode != DisplayNoVisual {
		t.Errorf("forceText: got mode %v, want no-visual", cap.Mode)
	}
}

// Braille fallback (AC-9.3): default braille; legacy TERMs fall back to
// half-block; ORB_GLYPH override wins.
func TestGlyphBrailleByDefault(t *testing.T) {
	if g := detectGlyph("xterm-256color", ""); g != GlyphBraille {
		t.Errorf("xterm-256color: got %v, want braille", g)
	}
	if g := detectGlyph("alacritty", ""); g != GlyphBraille {
		t.Errorf("alacritty: got %v, want braille", g)
	}
}

func TestGlyphLegacyFallback(t *testing.T) {
	for _, term := range []string{"dumb", "vt100", "ansi", "cons25"} {
		if g := detectGlyph(term, ""); g != GlyphHalfBlock {
			t.Errorf("TERM=%q: got %v, want half-block", term, g)
		}
	}
}

func TestGlyphOverride(t *testing.T) {
	if g := detectGlyph("xterm-256color", "full"); g != GlyphFullBlock {
		t.Errorf("ORB_GLYPH=full: got %v, want full-block", g)
	}
	if g := detectGlyph("dumb", "braille"); g != GlyphBraille {
		t.Errorf("ORB_GLYPH=braille overrides legacy: got %v, want braille", g)
	}
	if g := detectGlyph("xterm-256color", "half"); g != GlyphHalfBlock {
		t.Errorf("ORB_GLYPH=half: got %v, want half-block", g)
	}
}

// 256-color approximation (AC-9.2): Ember → warm orange, Tide → blue.
func TestNearestApproximation(t *testing.T) {
	oranges := []string{"#FF6B35", "#E0501F", "#FF7F2A", "#CC5500", "#FF8C42"}
	if got := nearest("#FF6B35", oranges); got != "#FF6B35" {
		t.Errorf("exact ember match not selected: %s", got)
	}
	// a warm-orange candidate should be chosen over a cool-blue one.
	m := nearest("#FF6B35", []string{"#4A9EFF", "#FF8C42", "#CC5500"})
	if m != "#FF8C42" {
		t.Errorf("expected nearest warm orange, got %s", m)
	}
	bl := nearest("#4A9EFF", []string{"#FF6B35", "#3B82F6", "#1E90FF"})
	if bl != "#3B82F6" {
		t.Errorf("expected nearest blue, got %s", bl)
	}
}

// parseHex power — malformed input degrades to black instead of panicking.
func TestParseHexDegrades(t *testing.T) {
	if parseHex("") != 0 || parseHex("#123") != 0 || parseHex("#gggggg") != 0 {
		t.Error("malformed hex should parse to 0")
	}
	if parseHex("#1E1E28") != 0x1E1E28 {
		t.Errorf("valid hex misparsed: %d", parseHex("#1E1E28"))
	}
}
