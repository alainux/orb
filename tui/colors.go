// Package tui defines the orb terminal palette and a minimal renderer used
// by main.go to smoke-test the DESIGN.md constants in milestone 1.
//
// The palette values match DESIGN.md §3 exactly. Later milestones add
// Braille mapping, half-block fallback, and the full tcell renderer.
package tui

import (
	"fmt"
	"strings"
)

// Palette is the canonical set of DESIGN.md colors for orb.
type Palette struct {
	Void    string // Background
	Ink     string // Surface / pane separator
	Chalk   string // Body text
	Ash     string // Secondary / muted
	Ember   string // Active voice energy
	Tide    string // Idle / listening
	Bloom   string // Peak energy
	Verdant string // Saved / success
	Veil    string // Separator, barely visible
}

// DefaultPalette returns the DESIGN.md palette as hex strings.
func DefaultPalette() Palette {
	return Palette{
		Void:    "#0A0A0F",
		Ink:     "#12121A",
		Chalk:   "#E8E4DE",
		Ash:     "#6B6873",
		Ember:   "#FF6B35",
		Tide:    "#4A9EFF",
		Bloom:   "#FF3CAC",
		Verdant: "#2DD4A8",
		Veil:    "#1E1E28",
	}
}

// PaletteRenderer is a tiny helper that turns palette entries into a
// human-readable summary and a text-mode swatch for smoke-testing.
type PaletteRenderer struct {
	palette Palette
	noViz   bool
}

// NewPaletteRenderer constructs a renderer. noViz mirrors --no-visual.
func NewPaletteRenderer(noViz bool) *PaletteRenderer {
	return &PaletteRenderer{
		palette: DefaultPalette(),
		noViz:   noViz,
	}
}

// PaletteSummary returns a plain-text table of role → hex.
func (r *PaletteRenderer) PaletteSummary() string {
	var b strings.Builder
	b.WriteString("Palette:\n")
	rows := []struct {
		role string
		hex  string
	}{
		{"Void", r.palette.Void},
		{"Ink", r.palette.Ink},
		{"Chalk", r.palette.Chalk},
		{"Ash", r.palette.Ash},
		{"Ember", r.palette.Ember},
		{"Tide", r.palette.Tide},
		{"Bloom", r.palette.Bloom},
		{"Verdant", r.palette.Verdant},
		{"Veil", r.palette.Veil},
	}
	for _, row := range rows {
		b.WriteString(fmt.Sprintf("  %-8s %s\n", row.role, row.hex))
	}
	return b.String()
}

// Swatch returns a text-mode approximation of the palette for terminal
// verification. When noViz is true it skips color work and returns a
// single-line status note.
func (r *PaletteRenderer) Swatch() string {
	if r.noViz {
		return "[no-visual] palette constants loaded; orb rendering disabled."
	}
	var b strings.Builder
	b.WriteString("Swatch: ")
	b.WriteString(colorBlock(r.palette.Void))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Ink))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Chalk))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Ash))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Ember))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Tide))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Bloom))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Verdant))
	b.WriteString(" ")
	b.WriteString(colorBlock(r.palette.Veil))
	b.WriteString("\n")
	return b.String()
}

func colorBlock(hex string) string {
	// In a real TUI we would emit true-color ANSI sequences; for milestone 1
	// the swatch is a label so the constant values are auditable in logs.
	return fmt.Sprintf("[%s]", hex)
}
