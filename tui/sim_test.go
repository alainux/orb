package tui

import (
	"testing"

	"github.com/alainux/orb/config"
	"github.com/gdamore/tcell/v2"
)

// frame simulates the given mode at width×height and returns the cell grid
// plus its dimensions.
func frame(t *testing.T, mode DisplayMode, w, h int) ([]tcell.SimCell, int, int) {
	t.Helper()
	a := NewApp(&config.Config{Format: "md", NoVisual: mode == DisplayNoVisual})
	a.SetCapability(TermCap{Color: ColorTrueColor, Glyph: GlyphBraille, Mode: mode})
	a.SetArtifact("hello world\nsecond line")
	a.SetStatus(StatusListening)

	sim := tcell.NewSimulationScreen("")
	if err := sim.Init(); err != nil {
		t.Fatal(err)
	}
	defer sim.Fini()
	a.RenderTo(sim, w, h)
	cells, cw, ch := sim.GetContents()
	return cells, cw, ch
}

func cellAt(cells []tcell.SimCell, w, x, y int) (tcell.SimCell, bool) {
	if x < 0 || y < 0 || x >= w {
		return tcell.SimCell{}, false
	}
	i := y*w + x
	if i < 0 || i >= len(cells) {
		return tcell.SimCell{}, false
	}
	return cells[i], true
}

func runeAt(sc tcell.SimCell) rune {
	if len(sc.Runes) == 0 {
		return 0
	}
	return sc.Runes[0]
}

// Visual QA — the split frame must show the Veil separator column (AC-1.4),
// a particle glyph at the orb centre (Ember while listening), and artifact
// text on the right pane.
func TestSimSplitVisual(t *testing.T) {
	w, h := 120, 30
	cells, cw, _ := frame(t, DisplayVisual, w, h)
	if cw != w {
		t.Fatalf("sim width = %d, want %d", cw, w)
	}
	layout := ComputeLayout(w, h, DisplayVisual)

	// orb centre carries the braille glyph.
	orb, ok := cellAt(cells, w, layout.OrbW/2, h/2)
	if !ok {
		t.Fatal("orb coordinate out of range")
	}
	if runeAt(orb) != '⣿' {
		t.Errorf("orb centre glyph = %q, want ⣿", runeAt(orb))
	}

	// separator column (ArtX-1) uses the Veil color (AC-1.4).
	sep, ok := cellAt(cells, w, layout.ArtX-1, 5)
	if !ok {
		t.Fatal("separator col out of range")
	}
	fg, _, _ := sep.Style.Decompose()
	if fg != hexColor(VeilHex()) {
		t.Errorf("separator fg = %v, want Veil %v", fg, hexColor(VeilHex()))
	}

	// artifact text begins at the pane origin.
	art, ok := cellAt(cells, w, layout.ArtX, layout.ContentTop+1)
	if !ok || runeAt(art) != 'h' {
		t.Errorf("artifact should start with text; rune %q", runeAt(art))
	}
}

// no-visual frame: no particle glyphs anywhere; artifact spans the full width
// (AC-9.5).
func TestNoVisualDropsOrb(t *testing.T) {
	w, h := 100, 30
	cells, _, _ := frame(t, DisplayNoVisual, w, h)
	for i := range cells {
		switch runeAt(cells[i]) {
		case '⣿', '▀', '█':
			t.Fatalf("no-visual must not render particle glyphs; found at cell %d", i)
		}
	}
}

// narrow mode: 3-line bar then the artifact body (AC-1.3).
func TestNarrowBar(t *testing.T) {
	w, h := 70, 30
	cells, _, _ := frame(t, DisplayVisual, w, h)
	layout := ComputeLayout(w, h, DisplayVisual)
	if layout.Mode != ModeNarrow {
		t.Fatalf("70 cols: want narrow, got %v", layout.Mode)
	}
	if c, ok := cellAt(cells, w, layout.ArtX, layout.ContentTop); !ok || runeAt(c) == 0 {
		t.Error("narrow body row should render artifact text")
	}
}
