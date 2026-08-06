package tui

import (
	"strings"
	"time"

	"github.com/gdamore/tcell/v2"
)

// Palette hex accessors (single source: DefaultPalette in colors.go).
func ChalkHex() string   { return DefaultPalette().Chalk }
func VoidHex() string    { return DefaultPalette().Void }
func VeilHex() string    { return DefaultPalette().Veil }
func EmberHex() string   { return DefaultPalette().Ember }
func TideHex() string    { return DefaultPalette().Tide }
func BloomHex() string   { return DefaultPalette().Bloom }
func VerdantHex() string { return DefaultPalette().Verdant }
func AshHex() string     { return DefaultPalette().Ash }

// frameInterval drives the animation heartbeat. Renders at up to ~30 FPS;
// specific subsystems may throttle below this under load (R23).
const frameInterval = 33 * time.Millisecond

// saveFlashDuration is how long the footer flashes Verdant after a save
// (AC-14.4 / DESIGN §27.5 — 300 ms).
const saveFlashDuration = 300 * time.Millisecond

// styleFor returns a tcell style with the given fg/bg hex colors.
func (a *App) styleFor(fg, bg string) tcell.Style {
	return tcell.StyleDefault.Foreground(hexColor(fg)).Background(hexColor(bg))
}

// drawFrame clears and paints the current frame, then flushes to the terminal.
func (a *App) drawFrame() {
	if a.screen == nil {
		return
	}
	a.screen.Clear()
	switch a.cap.Mode {
	case DisplayNoVisual:
		a.drawNoVisual()
	case DisplayTextOrb, DisplayVisual:
		a.draw()
	default:
		a.drawNoVisual()
	}
	a.screen.Show()
}

// draw paints the visual two-pane layout at the current terminal size
// (AC-1.1..1.4). Below <80 cols it switches to the single-pane bar shape
// (AC-1.3).
func (a *App) draw() {
	width, height := a.width, a.height
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	layout := ComputeLayout(width, height, a.cap.Mode)
	a.fill(0, 0, width, height, a.styleFor(ChalkHex(), VoidHex()))

	switch layout.Mode {
	case ModeNarrow:
		a.drawNarrow(layout)
	case ModeSplit:
		a.paintSeparator(layout)
		a.drawOrbPane(layout)
		a.drawArtifactPane(layout)
	default:
		a.drawArtifactPane(layout)
	}
}

// drawNarrow renders the single-pane shape: a 3-line animated bar on top with
// the artifact panel underneath (AC-1.3). The bar is a living placeholder.
func (a *App) drawNarrow(layout Layout) {
	a.putStr(0, 0, "● "+string(a.currentStatus()), a.styleFor(EmberHex(), VoidHex()))
	a.putStr(0, 1, "orb — narrow display", a.styleFor(AshHex(), VoidHex()))
	a.putStr(0, 2, "▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔", a.styleFor(AshHex(), VoidHex()))
	top, bot := layout.ArtifactBody()
	a.drawArtifactBody(layout, top, bot)
	a.drawArtifactFooter(layout, bot)
}

// drawNoVisual paints --no-visual: a single status line then the artifact
// pane filling the remainder (AC-9.4 / AC-9.5). No orb visuals at all.
func (a *App) drawNoVisual() {
	width, height := a.width, a.height
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}
	layout := ComputeLayout(width, height, DisplayNoVisual)
	a.fill(0, 0, width, height, a.styleFor(ChalkHex(), VoidHex()))
	a.putStr(0, 0, "● "+string(a.currentStatus()), a.styleFor(themeColor(), VoidHex()))
	top, bot := layout.ArtifactBody()
	a.drawArtifactHeader(layout, top)
	a.drawArtifactBody(layout, top+1, bot)
	a.drawArtifactFooter(layout, bot)
}

// fill paints a rectangle of cells with a style.
func (a *App) fill(x, y, w, h int, st tcell.Style) {
	if a.screen == nil {
		return
	}
	b, eiy := y, y+h
	if b < 0 {
		b = 0
	}
	if eiy > a.height {
		eiy = a.height
	}
	ex := x + w
	if eoff := ex; eoff > a.width {
		ex = a.width
	}
	for row := b; row < eiy; row++ {
		for col := x; col < ex; col++ {
			a.screen.SetContent(col, row, ' ', nil, st)
		}
	}
}

// putStr safely writes a string starting at (x,y), clipping to screen width.
// Wide/combination runes are handled via tcell's SetContent.
func (a *App) putStr(x, y int, s string, st tcell.Style) {
	if a.screen == nil || y < 0 || y >= a.height {
		return
	}
	col := a.shiftX(x)
	for _, r := range s {
		if col >= a.width {
			break
		}
		if r == '\n' {
			y++
			col = x
			continue
		}
		a.screen.SetContent(col, y, r, nil, st)
		col++
	}
}

// paintSeparator draws the 1-column Veil separator between the panes (AC-1.4).
// It also labels the orb pane header row with a muted "orb" word.
func (a *App) paintSeparator(layout Layout) {
	col := a.shiftX(layout.ArtX - 1)
	if col < 0 || col >= a.width {
		return
	}
	st := a.styleFor(VeilHex(), VeilHex())
	for row := 0; row < layout.Height; row++ {
		a.screen.SetContent(col, row, ' ', nil, st)
	}
	a.putStr(0, 0, "orb", a.styleFor(AshHex(), VoidHex()))
}

// drawOrbPane renders the live orb pane: it steps the particle field,
// rasterises it with the resolved glyph set (Braille / half-block / full-
// block) and a centre glow, then overlays the status label + hint.
func (a *App) drawOrbPane(layout Layout) {
	// Text-orb mode keeps the pane but drops the constellation (16-color).
	if a.cap.Mode == DisplayTextOrb {
		a.drawTextOrb(layout)
		return
	}
	a.stepOrb(layout)
	grid := RenderOrb(a.orb, a.orbScene(layout), a.cap.Glyph, a.sceneTime)
	for y := 0; y < len(grid) && y < layout.Height; y++ {
		for x := 0; x < len(grid[y]) && x < layout.OrbW; x++ {
			cell := grid[y][x]
			if cell.Rune == 0 {
				continue
			}
			col := a.shiftX(x)
			if col < 0 || col >= layout.OrbW {
				continue
			}
			a.screen.SetContent(col, y, cell.Rune, nil, a.styleFor(cell.Color, VoidHex()))
		}
	}

	cx := layout.OrbW / 2
	cy := layout.Height / 2
	label := string(a.currentStatus())
	a.putStr(cx-len(label)/2, min(cy+2, layout.Height-1), label, a.styleFor(AshHex(), VoidHex()))
	a.putStr(cx-8, min(cy+3, layout.Height-1), "talk · Ctrl+D end", a.styleFor(AshHex(), VoidHex()))
}

// drawTextOrb renders the low-fidelity orb pane: a single state-coloured
// glyph at the centre plus the status label (no particle constellation).
func (a *App) drawTextOrb(layout Layout) {
	cx, cy := a.shiftX(layout.OrbW/2), layout.Height/2
	if cx >= 0 && cx < layout.OrbW {
		a.screen.SetContent(cx, cy, a.glyph(), nil, a.styleFor(a.stateColor(), VoidHex()))
	}
	label := string(a.currentStatus())
	a.putStr(layout.OrbW/2-len(label)/2, min(cy+2, layout.Height-1), label, a.styleFor(AshHex(), VoidHex()))
	a.putStr(layout.OrbW/2-8, min(cy+3, layout.Height-1), "talk · Ctrl+D end", a.styleFor(AshHex(), VoidHex()))
}

// stateColor maps the current status to a hex colour (AC-2.4 gradient mood).
func (a *App) stateColor() string {
	switch a.currentStatus() {
	case StatusListening, StatusSaving:
		return EmberHex()
	case StatusThinking:
		return TideHex()
	case StatusDrafting:
		return EmberHex()
	case StatusSaved:
		return VerdantHex()
	case StatusError:
		return BloomHex()
	default:
		return TideHex()
	}
}

// themeColor returns the active accent for status line "●" (no orb visuals).
func themeColor() string { return EmberHex() }

// drawArtifactPane renders the artifact panel: header, body, footer.
func (a *App) drawArtifactPane(layout Layout) {
	top, bot := layout.ArtifactBody()
	a.drawArtifactHeader(layout, top)
	a.drawArtifactBody(layout, top+1, bot)
	a.drawArtifactFooter(layout, bot)
}

// drawArtifactHeader renders the pane's title row.
func (a *App) drawArtifactHeader(layout Layout, row int) {
	title := "artifact"
	if a.cap.Mode == DisplayNoVisual {
		title = ""
	}
	a.putStr(layout.ArtX, row, title, a.styleFor(AshHex(), VoidHex()))
}

// drawArtifactBody renders the artifact text (word-wrapped) and, if a
// suggestion is pending, appends it in Tide (AC-17 / AC-6.4) after a blank.
func (a *App) drawArtifactBody(layout Layout, top, bot int) {
	a.mu.Lock()
	visible := a.stream.Visible()
	suggestion := a.suggestion
	a.mu.Unlock()

	text := visible
	if suggestion != "" {
		if text == "" {
			text = suggestion
		} else {
			text = visible + "\n\n" + suggestion
		}
	}
	baseLines := len(Wrap(visible, layout.ArtW))
	all := Wrap(text, layout.ArtW)

	row := top
	for i := 0; i < len(all) && row < bot; i++ {
		st := a.styleFor(ChalkHex(), VoidHex())
		if suggestion != "" && i >= baseLines {
			st = a.styleFor(TideHex(), VoidHex())
		}
		a.putStr(layout.ArtX, row, all[i], st)
		row++
	}
}

// drawArtifactFooter renders the bottom status row (save path / prompt).
// drawArtifactFooter renders the status bar (T7): word count, turns taken,
// and the save indicator. While the recent-save flash is active it renders
// Verdant with the saved path (AC-14.4 / AC-14.5).
func (a *App) drawArtifactFooter(layout Layout, row int) {
	if !layout.HasFooter {
		return
	}
	a.mu.Lock()
	savedPath := a.savedPath
	flashing := !a.saveFlash.IsZero() && time.Since(a.saveFlash) < saveFlashDuration
	a.mu.Unlock()

	state := "idle"
	if flashing {
		state = "saved"
	}
	txt := StatusBar(a.currentWords(), a.currentTurns(), state, savedPath)

	// Surface a recent scripting-hook failure in the footer (AC-7.5 / AC-11.4):
	// "pipe failed: exit 1” in Bloom while the notice is fresh, so a failing
	// pipe is visible even though the save itself succeeded. A generic
	// transient error (E-2, e.g. connection retry) takes precedence.
	if a.errorActive() {
		a.putStr(layout.ArtX, row, a.errorText(), a.styleFor(BloomHex(), VoidHex()))
		return
	}
	if a.pipeErrorActive() {
		a.putStr(layout.ArtX, row, a.pipeErrorText(), a.styleFor(BloomHex(), VoidHex()))
		return
	}

	st := a.styleFor(AshHex(), VoidHex())
	if flashing {
		st = a.styleFor(VerdantHex(), VoidHex())
	}
	a.putStr(layout.ArtX, row, txt, st)
}

// errorActive reports whether a generic transient error should still be shown
// in the footer (E-2, transient window). Reads state under lock so it is safe
// on any goroutine.
func (a *App) errorActive() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.errMsg != "" && !a.errMsgAt.IsZero() &&
		time.Since(a.errMsgAt) < errorFlashDuration
}

// errorText returns the footer string for a generic transient error.
func (a *App) errorText() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return "! " + a.errMsg
}

// pipeErrorActive reports whether a pipe failure should still be shown in the
// footer (transient window). It reads state so it is safe on any goroutine.
func (a *App) pipeErrorActive() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.pipeErr != "" && !a.pipeErrAt.IsZero() &&
		time.Since(a.pipeErrAt) < pipeErrorFlashDuration
}

// pipeErrorText returns the footer string for a recent pipe failure.
func (a *App) pipeErrorText() string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return "! " + a.pipeErr
}

// Wrap breaks text into lines no wider than w cells, splitting on whitespace.
// It is pure and unit-testable (used by artifact + status rendering).
func Wrap(text string, w int) []string {
	if w < 1 {
		w = 1
	}
	var out []string
	for _, para := range strings.Split(text, "\n") {
		if para == "" {
			out = append(out, "")
			continue
		}
		words := strings.Fields(para)
		if len(words) == 0 {
			out = append(out, "")
			continue
		}
		line := ""
		for _, word := range words {
			if line != "" && len(line)+1+len(word) > w {
				out = append(out, line)
				line = word
			} else if line == "" {
				line = word
			} else {
				line += " " + word
			}
		}
		out = append(out, line)
	}
	return out
}

// glyph returns the single-cell particle glyph selected by capability.
func (a *App) glyph() rune {
	switch a.cap.Glyph {
	case GlyphHalfBlock:
		return '▀'
	case GlyphFullBlock:
		return '█'
	default:
		return '⣿'
	}
}
