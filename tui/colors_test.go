package tui_test

import (
	"strings"
	"testing"

	"github.com/alainux/orb/tui"
)

func TestDefaultPaletteMatchesDESIGN(t *testing.T) {
	p := tui.DefaultPalette()

	want := map[string]string{
		"Void":    "#0A0A0F",
		"Ink":     "#12121A",
		"Chalk":   "#E8E4DE",
		"Ash":     "#6B6873",
		"Ember":   "#FF6B35",
		"Tide":    "#4A9EFF",
		"Bloom":   "#FF3CAC",
		"Verdant": "#2DD4A8",
		"Veil":    "#1E1E28",
	}

	got := map[string]string{
		"Void":    p.Void,
		"Ink":     p.Ink,
		"Chalk":   p.Chalk,
		"Ash":     p.Ash,
		"Ember":   p.Ember,
		"Tide":    p.Tide,
		"Bloom":   p.Bloom,
		"Verdant": p.Verdant,
		"Veil":    p.Veil,
	}

	for role, wantHex := range want {
		gotHex := got[role]
		if gotHex != wantHex {
			t.Errorf("%s = %q, want %q", role, gotHex, wantHex)
		}
	}
}

func TestPaletteRendererSummaryContainsAllRoles(t *testing.T) {
	r := tui.NewPaletteRenderer(false)
	summary := r.PaletteSummary()
	for _, role := range []string{"Void", "Ink", "Chalk", "Ash", "Ember", "Tide", "Bloom", "Verdant", "Veil"} {
		if !contains(summary, role) {
			t.Errorf("summary missing role %q", role)
		}
	}
}

func TestPaletteRendererSwatchNoVisual(t *testing.T) {
	r := tui.NewPaletteRenderer(true)
	out := r.Swatch()
	if !contains(out, "[no-visual]") {
		t.Errorf("no-visual swatch missing marker, got %q", out)
	}
}

func TestPaletteRendererSwatchVisual(t *testing.T) {
	r := tui.NewPaletteRenderer(false)
	out := r.Swatch()
	if !contains(out, "[#0A0A0F]") {
		t.Errorf("visual swatch missing Void block, got %q", out)
	}
	if !contains(out, "[#FF3CAC]") {
		t.Errorf("visual swatch missing Bloom block, got %q", out)
	}
}

func contains(s, substr string) bool {
	return strings.Contains(s, substr)
}
