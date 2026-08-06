package tui

// Layout describes the packed geometry of the UI for the current terminal
// size and terminal mode. It is derived purely from width/height + mode and is
// fully unit-testable (AC-1.1..1.3, R9 / R1).

// LayoutMode distinguishes the three responsive shapes.
type LayoutMode int

const (
	// ModeSplit is the normal two-pane arrangement (orb + artifact).
	ModeSplit LayoutMode = iota
	// ModeNarrow is the single-pane arrangement used below 80 columns: a
	// 3-line animated bar on top of the artifact (AC-1.3).
	ModeNarrow
	// ModeNoVisual is --no-visual: a status line plus the artifact pane only
	// (AC-9.5).
	ModeNoVisual
)

// Layout is the computed geometry for one frame.
type Layout struct {
	Mode   LayoutMode
	Width  int
	Height int

	// Split mode geometry (orb left, 1-col separator, artifact right).
	OrbOn bool
	OrbW  int
	ArtX  int
	ArtW  int

	// Vertical bounds of the content region.
	ContentTop int // first content row into which a header is drawn
	BarH       int // height of the top bar / header (narrow / no-visual)
	FooterH    int // height of the artifact footer

	// True when the content area is tall enough for a footer; otherwise the
	// footer is skipped so text still fits.
	HasFooter bool
}

const (
	// separator width between panes (AC-1.4 — one Veil column).
	sepWidth = 1
	// narrow-mode 3-line animated bar (AC-1.3).
	narrowBarH = 3
	// --no-visual / text-orb single status line (AC-9.5).
	statusLineH = 1
	// minimum orb pane width (AC-18.5), also used as a floor in split mode.
	minOrbW = 10
)

// ComputeLayout derives geometry for the given terminal size and mode.
func ComputeLayout(width, height int, mode DisplayMode) Layout {
	if width < 1 {
		width = 1
	}
	if height < 1 {
		height = 1
	}

	l := Layout{
		Mode:      ModeSplit,
		Width:     width,
		Height:    height,
		FooterH:   1,
		HasFooter: height >= 3,
	}

	switch mode {
	case DisplayNoVisual:
		l.Mode = ModeNoVisual
		l.OrbOn = false
		l.BarH = statusLineH
		l.ArtW = width
		// content = status line then artifact text through the footer.
		l.ContentTop = l.BarH
		return l
	case DisplayTextOrb, DisplayVisual:
		// continue to responsive branching below
	default:
		// Unknown mode — safest fallback is no-visual.
		l.Mode = ModeNoVisual
		l.OrbOn = false
		l.BarH = statusLineH
		l.ArtW = width
		l.ContentTop = l.BarH
		return l
	}

	// Narrow terminal (<80 cols): single pane with a 3-line bar (AC-1.3).
	if width < 80 {
		l.Mode = ModeNarrow
		l.OrbOn = false
		l.BarH = narrowBarH
		l.ContentTop = l.BarH
		l.ArtX = 0
		l.ArtW = width
		return l
	}

	// Split mode: 40/60 at >=120, 35/65 at 80..119 (AC-1.1 / AC-1.2).
	l.Mode = ModeSplit
	l.OrbOn = true

	orbPct := 35
	if width >= 120 {
		orbPct = 40
	}
	orbW := width * orbPct / 100
	if orbW < minOrbW {
		orbW = minOrbW
	}
	// keep room for the separator column and a sliver of artifact.
	if orbW+sepWidth >= width {
		orbW = width - sepWidth
	}
	if orbW < 1 {
		orbW = 1
	}
	l.OrbW = orbW
	l.ArtX = orbW + sepWidth
	l.ArtW = width - l.ArtX
	if l.ArtW < 1 {
		l.ArtW = 1
	}
	l.ContentTop = 1
	return l
}

// ArtifactBodyTop returns the row where artifact body text begins (above the
// footer) for the current geometry.
func (l Layout) ArtifactBody() (top, bot int) {
	top = l.ContentTop
	bot = l.Height
	if l.HasFooter {
		bot = l.Height - l.FooterH
	}
	if bot <= top {
		return top, l.Height
	}
	return top, bot
}
