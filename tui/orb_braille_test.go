package tui

import (
	"math/rand"
	"testing"
)

func TestDotBit(t *testing.T) {
	cases := []struct {
		dx, dy int
		want   int
	}{
		{0, 0, 1}, {1, 0, 8}, {0, 2, 4}, {1, 2, 32},
		{0, 3, 64}, {1, 3, 128}, {0, 1, 2}, {1, 1, 16},
	}
	for _, c := range cases {
		if got := dotBit(c.dx, c.dy); got != c.want {
			t.Errorf("dotBit(%d,%d) = %d, want %d", c.dx, c.dy, got, c.want)
		}
	}
}

func TestBrailleRune(t *testing.T) {
	if brailleRune(0) != '\u2800' {
		t.Error("empty braille cell should be blank U+2800")
	}
	if brailleRune(0xFF) != '\u28FF' {
		t.Errorf("all dots = %U, want U+28FF", brailleRune(0xFF))
	}
	if brailleRune(1) != '\u2801' {
		t.Error("dot1 should be U+2801")
	}
}

func TestHalfBlockRune(t *testing.T) {
	if halfBlockRune(true, false) != '▀' {
		t.Error("top-only should be ▀")
	}
	if halfBlockRune(false, true) != '▄' {
		t.Error("bottom-only should be ▄")
	}
	if halfBlockRune(true, true) != '█' {
		t.Error("both should be █")
	}
	if halfBlockRune(false, false) != ' ' {
		t.Error("neither should be blank")
	}
}

func TestRenderOrbBraillePresence(t *testing.T) {
	sc := OrbScene{PixelW: 120, PixelH: 60, CellsW: 60, CellsH: 15, CX: 60, CY: 30, MaxRadius: 30}
	f := &OrbField{
		Particles: NewParticles(80, sc.PixelW, sc.PixelH, rand.New(rand.NewSource(3))),
		State:     OrbIdle,
		Energy:    0,
	}
	grid := RenderOrb(f, sc, GlyphBraille, 0)
	if len(grid) != sc.CellsH || len(grid[0]) != sc.CellsW {
		t.Fatalf("grid dims = %dx%d, want %dx%d", len(grid), len(grid[0]), sc.CellsH, sc.CellsW)
	}
	found, braille := 0, false
	for _, row := range grid {
		for _, c := range row {
			if c.Rune == 0 {
				continue
			}
			found++
			if c.Rune >= '\u2800' && c.Rune <= '\u28FF' {
				braille = true
			}
		}
	}
	if found == 0 {
		t.Error("Braille render produced no lit cells")
	}
	if !braille {
		t.Error("Braille glyph set should emit braille cells")
	}
	if grid[sc.CellsH/2][sc.CellsW/2].Rune != '\u28FF' {
		t.Errorf("centre glow rune = %U, want ⣿", grid[sc.CellsH/2][sc.CellsW/2].Rune)
	}
}

func TestRenderOrbHalfBlockGlyphs(t *testing.T) {
	sc := OrbScene{PixelW: 120, PixelH: 120, CellsW: 60, CellsH: 30, CX: 60, CY: 60, MaxRadius: 40}
	f := &OrbField{
		Particles: NewParticles(100, sc.PixelW, sc.PixelH, rand.New(rand.NewSource(4))),
		State:     OrbListening,
		Energy:    0.6,
	}
	grid := RenderOrb(f, sc, GlyphHalfBlock, 1)
	block := false
	for _, row := range grid {
		for _, c := range row {
			switch c.Rune {
			case '▀', '▄', '█':
				block = true
			case 0, ' ':
			default:
				if c.Rune >= '\u2800' && c.Rune <= '\u28FF' {
					t.Errorf("half-block set produced braille rune %U", c.Rune)
				}
			}
		}
	}
	if !block {
		t.Error("half-block render produced no block glyphs")
	}
	if grid[sc.CellsH/2][sc.CellsW/2].Rune != '█' {
		t.Errorf("centre glow should be █ under half-block, got %U", grid[sc.CellsH/2][sc.CellsW/2].Rune)
	}
}

func TestRenderOrbFullBlock(t *testing.T) {
	sc := OrbScene{PixelW: 60, PixelH: 60, CellsW: 30, CellsH: 15, CX: 30, CY: 30, MaxRadius: 20}
	f := &OrbField{
		Particles: NewParticles(40, sc.PixelW, sc.PixelH, rand.New(rand.NewSource(6))),
		State:     OrbProcessing,
		Energy:    0,
	}
	grid := RenderOrb(f, sc, GlyphFullBlock, 0)
	lit := 0
	for _, row := range grid {
		for _, c := range row {
			if c.Rune == '█' {
				lit++
			}
		}
	}
	if lit == 0 {
		t.Error("full-block render produced no glyphs")
	}
}
