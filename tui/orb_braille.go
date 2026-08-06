package tui

import (
	"fmt"
	"math"
)

// OrbCell is one terminal cell produced by the orb rasteriser: a rune plus the
// blended foreground colour that already carries the state "opacity".
type OrbCell struct {
	Rune  rune
	Color string
}

// dotBit maps a sub-position within a Braille cell (2 wide × 4 tall) to the
// Unicode Braille bit for that dot (AC-18.2).
//
//	row0: dot1 (left)  dot4 (right)
//	row1: dot2         dot5
//	row2: dot3         dot6
//	row3: dot7         dot8
func dotBit(dx, dy int) int {
	var bit int
	switch {
	default:
		bit = 0
	}
	switch dy {
	case 0:
		if dx == 0 {
			bit = 1
		} else {
			bit = 8
		}
	case 1:
		if dx == 0 {
			bit = 2
		} else {
			bit = 16
		}
	case 2:
		if dx == 0 {
			bit = 4
		} else {
			bit = 32
		}
	case 3:
		if dx == 0 {
			bit = 64
		} else {
			bit = 128
		}
	}
	return bit
}

// brailleRune turns an 8-bit dot mask into the Unicode Braille cell
// ⠀(U+2800)..⣿(U+28FF) (AC-18.1).
func brailleRune(bits byte) rune { return rune(0x2800) + rune(bits) }

// halfBlockRune maps the top/bottom occupancy to ▀ ▄ █ (AC-18.4).
func halfBlockRune(top, bottom bool) rune {
	switch {
	case top && bottom:
		return '█'
	case top:
		return '▀'
	case bottom:
		return '▄'
	default:
		return ' '
	}
}

// RenderOrb rasterises a stepped OrbField onto a grid of terminal cells using
// the selected glyph set (Braille → half-block → full-block). It returns a
// grid [cy][cx] of OrbCell; zero cells have Rune==0.
//
// It is pure given (field, scene, glyph, time) so it is unit-testable.
func RenderOrb(f *OrbField, sc OrbScene, glyph GlyphMode, t float64) [][]OrbCell {
	cw, ch := sc.CellsW, sc.CellsH
	grid := make([][]OrbCell, ch)
	for y := 0; y < ch; y++ {
		grid[y] = make([]OrbCell, cw)
	}

	colour := energyColor(f.State, f.Energy)
	opac := orbOpacity(f.State, f.Energy, t)
	fg := blend(VoidHex(), colour, opac)

	switch glyph {
	case GlyphBraille:
		renderBraille(grid, f, sc, fg)
	case GlyphHalfBlock:
		renderHalfBlock(grid, f, sc, fg)
	default:
		renderFullBlock(grid, f, sc, fg)
	}

	// Centre gaussian glow (AC-2.5 / AC-18.3).
	renderGlow(grid, sc, f.State, t, glyph)
	// Collision sparks (AC-2.6).
	renderSparks(grid, sc, f.Sparks)
	return grid
}

// renderBraille aggregates particle sub-pixels per cell into a Braille mask
// (AC-18.2).
func renderBraille(grid [][]OrbCell, f *OrbField, sc OrbScene, colour string) {
	cw, ch := sc.CellsW, sc.CellsH
	bits := make([][]byte, ch)
	for y := range bits {
		bits[y] = make([]byte, cw)
	}
	for _, p := range f.Particles {
		cx, cy, dx, dy, ok := pixelToCell(p.X, p.Y, cw, ch)
		if !ok {
			continue
		}
		bits[cy][cx] |= byte(dotBit(dx, dy))
	}
	for cy := 0; cy < ch; cy++ {
		for cx := 0; cx < cw; cx++ {
			if bits[cy][cx] != 0 {
				grid[cy][cx] = OrbCell{Rune: brailleRune(bits[cy][cx]), Color: colour}
			}
		}
	}
}

// renderHalfBlock aggregates into per-cell (top, bottom) halves (AC-18.4).
func renderHalfBlock(grid [][]OrbCell, f *OrbField, sc OrbScene, colour string) {
	cw, ch := sc.CellsW, sc.CellsH
	top := make([][]bool, ch)
	bot := make([][]bool, ch)
	for y := range top {
		top[y] = make([]bool, cw)
		bot[y] = make([]bool, cw)
	}
	for _, p := range f.Particles {
		cx, cy, _, dy, ok := pixelToCell(p.X, p.Y, cw, ch)
		if !ok {
			continue
		}
		if dy >= cellH/2 {
			bot[cy][cx] = true
		} else {
			top[cy][cx] = true
		}
	}
	for cy := 0; cy < ch; cy++ {
		for cx := 0; cx < cw; cx++ {
			r := halfBlockRune(top[cy][cx], bot[cy][cx])
			if r != ' ' {
				grid[cy][cx] = OrbCell{Rune: r, Color: colour}
			}
		}
	}
}

// renderFullBlock lights a cell if any particle falls inside (lowest fidelity).
func renderFullBlock(grid [][]OrbCell, f *OrbField, sc OrbScene, colour string) {
	cw, ch := sc.CellsW, sc.CellsH
	for _, p := range f.Particles {
		cx, cy, _, _, ok := pixelToCell(p.X, p.Y, cw, ch)
		if !ok {
			continue
		}
		grid[cy][cx] = OrbCell{Rune: '█', Color: colour}
	}
}

// channelXY maps a particle at (pX,pY) px to its cell + sub-pixel offset.
func pixelToCell(px, py float64, cw, ch int) (cx, cy, dx, dy int, ok bool) {
	ix, iy := int(px), int(py)
	cx, cy = ix/cellW, iy/cellH
	if cx < 0 || cx >= cw || cy < 0 || cy >= ch {
		return 0, 0, 0, 0, false
	}
	dx, dy = ix%cellW, iy%cellH
	return cx, cy, dx, dy, true
}

// renderGlow paints the centre cell(s) as a full density at the glow opacity
// (AC-2.5: Tide 15% idle / Ember 25% active; AC-18.3).
func renderGlow(grid [][]OrbCell, sc OrbScene, state OrbState, t float64, glyph GlyphMode) {
	cx, cy := sc.CellsW/2, sc.CellsH/2
	if cx < 0 || cx >= sc.CellsW || cy < 0 || cy >= sc.CellsH {
		return
	}
	active := state != OrbIdle
	alpha := 0.15
	if active {
		alpha = 0.25
	}
	if active {
		alpha += 0.03 * math.Sin(4*2*math.Pi*t)
		if alpha > 0.3 {
			alpha = 0.3
		}
	}
	col := TideHex()
	if active {
		col = EmberHex()
	}

	core, ring := renderGlowGlyphs(glyph)
	grid[cy][cx] = OrbCell{Rune: core, Color: blend(VoidHex(), col, alpha)}
	for _, rr := range []struct{ dx, dy int }{
		{-1, 0}, {1, 0}, {0, -1}, {0, 1},
	} {
		rx, ry := cx+rr.dx, cy+rr.dy
		if rx < 0 || rx >= sc.CellsW || ry < 0 || ry >= sc.CellsH {
			continue
		}
		if grid[ry][rx].Rune == 0 {
			grid[ry][rx] = OrbCell{Rune: ring, Color: blend(VoidHex(), col, alpha*0.6)}
		}
	}
}

// renderGlyphGlyphs returns the core + ring runes for a glyph set, so the
// centre glow stays on-backend (no Braille leaking into half/full-block).
func renderGlowGlyphs(glyph GlyphMode) (core, ring rune) {
	switch glyph {
	case GlyphHalfBlock:
		return '█', '▀'
	case GlyphFullBlock:
		return '█', '█'
	default:
		return '\u28FF', '\u2816'
	}
}

// renderSparks paints transient collision blinks in Bloom (AC-2.6).
func renderSparks(grid [][]OrbCell, sc OrbScene, sparks []Spark) {
	for _, sp := range sparks {
		cx, cy, _, _, ok := pixelToCell(sp.X, sp.Y, sc.CellsW, sc.CellsH)
		if !ok {
			continue
		}
		grid[cy][cx] = OrbCell{Rune: '★', Color: BloomHex()}
	}
}

// energyColor shifts the constellation gradient across the state machine:
// Tide (idle) → Ember (listening/processing) → Bloom (peak energy) (AC-2.4).
func energyColor(state OrbState, energy float64) string {
	energy = clamp01(energy)
	switch state {
	case OrbListening:
		if energy < 0.5 {
			return lerpHex(TideHex(), EmberHex(), energy/0.5)
		}
		return lerpHex(EmberHex(), BloomHex(), (energy-0.5)/0.5)
	case OrbProcessing, OrbDrafting:
		return EmberHex()
	case OrbCelebrating:
		return BloomHex()
	default: // idle
		return TideHex()
	}
}

// orbOpacity is the state-driven foreground alpha used to emulate terminal
// opacity by blending toward the Void background (AC-2.2, AC-2.3).
func orbOpacity(state OrbState, energy float64, t float64) float64 {
	switch state {
	case OrbIdle:
		return BreatheOpacity(t) // 30–50%
	case OrbListening:
		return 0.35 + 0.45*clamp01(energy)
	case OrbCelebrating:
		return 0.60
	case OrbProcessing:
		return 0.50
	default: // drafting
		return 0.45
	}
}

// ---- color math (pure, unit-testable) ----

// parseRGBChannels returns the (r,g,b) channels of a "#RRGGBB" string.
func parseRGBChannels(hex string) (float64, float64, float64) {
	v := parseHex(hex)
	return float64((v >> 16) & 0xff), float64((v >> 8) & 0xff), float64(v & 0xff)
}

// blend mixes fg into fg toward a bg with the given amount in [0,1] by
// scaling towards fg: colour = fg * a + bg * (1 - a). This lets us simulate
// terminal character opacity (a = 1 is fully opaque fg).
func blend(bg, fg string, a float64) string {
	a = clamp01(a)
	br, bg2, bb := parseRGBChannels(bg)
	fr, fg2, fb := parseRGBChannels(fg)
	r := br + (fr-br)*a
	g := bg2 + (fg2-bg2)*a
	b := bb + (fb-bb)*a
	return fmt.Sprintf("#%02X%02X%02X", int(math.Round(r)), int(math.Round(g)), int(math.Round(b)))
}

// lerpHex linearly interpolates between two hex colours (t in [0,1]).
func lerpHex(a, bHex string, t float64) string {
	t = clamp01(t)
	ar, ag, ab := parseRGBChannels(a)
	br, bg2, bb := parseRGBChannels(bHex)
	r := ar + (br-ar)*t
	g := ag + (bg2-ag)*t
	bl := ab + (bb-ab)*t
	return fmt.Sprintf("#%02X%02X%02X", int(math.Round(r)), int(math.Round(g)), int(math.Round(bl)))
}
