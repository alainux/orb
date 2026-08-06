package tui

import "testing"

// Two-pane responsive layout (R1, AC-1.1..1.3) and no-visual (AC-9.4..9.5).

func TestLayoutSplitWide(t *testing.T) {
	// >=120 cols → 40/60 (AC-1.1).
	l := ComputeLayout(120, 40, DisplayVisual)
	if l.Mode != ModeSplit || !l.OrbOn {
		t.Fatalf("120 cols: expected split, got mode=%v orbOn=%v", l.Mode, l.OrbOn)
	}
	if l.OrbW != 48 {
		t.Errorf("120 cols: orb width = %d, want 48 (40%%)", l.OrbW)
	}
	// separator column between orb and artifact.
	if l.ArtX != 49 {
		t.Errorf("120 cols: artX=%d, want 49 (orb 48 + sep 1)", l.ArtX)
	}
	if l.ArtW != 71 {
		t.Errorf("120 cols: artW=%d, want 71", l.ArtW)
	}
}

func TestLayoutSplitMid(t *testing.T) {
	// 80..119 cols → 35/65 (AC-1.2).
	l := ComputeLayout(100, 40, DisplayVisual)
	if l.Mode != ModeSplit || !l.OrbOn {
		t.Fatalf("100 cols: expected split, got mode=%v orbOn=%v", l.Mode, l.OrbOn)
	}
	if l.OrbW != 35 {
		t.Errorf("100 cols: orb width = %d, want 35 (35%%)", l.OrbW)
	}
	if l.ArtX != 36 || l.ArtW != 64 {
		t.Errorf("100 cols: artX=%d artW=%d, want 36/64", l.ArtX, l.ArtW)
	}
}

func TestSplitGeometryFitsTerminal(t *testing.T) {
	l := ComputeLayout(120, 40, DisplayVisual)
	// orb + 1 separator + artifact must tile the exported width exactly.
	if l.OrbW+sepWidth+l.ArtW != l.Width {
		t.Errorf("geometry must tile terminal: orbW=%d + sep + artW=%d != %d",
			l.OrbW, l.ArtW, l.Width)
	}
	if l.ArtX != l.OrbW+sepWidth {
		t.Errorf("artifact must begin after separator: artX=%d want %d",
			l.ArtX, l.OrbW+sepWidth)
	}
}

func TestLayoutNarrow(t *testing.T) {
	// <80 cols → single-pane, 3-line artifact on top, artifact below (AC-1.3).
	l := ComputeLayout(70, 30, DisplayVisual)
	if l.Mode != ModeNarrow {
		t.Fatalf("70 cols: expected narrow, got mode=%v", l.Mode)
	}
	if l.OrbOn {
		t.Error("narrow mode must disable the orb pane")
	}
	if l.BarH != narrowBarH {
		t.Errorf("narrow bar height = %d, want %d", l.BarH, narrowBarH)
	}
	if l.ContentTop != narrowBarH {
		t.Errorf("contentTop = %d, want %d", l.ContentTop, narrowBarH)
	}
	top, bot := l.ArtifactBody()
	if top != narrowBarH || bot != l.Height-l.FooterH {
		t.Errorf("artifact body bounds [%d,%d), want [%d,%d)", top, bot, narrowBarH, l.Height-l.FooterH)
	}
}

func TestTextOrbUsesSameResponsiveLayout(t *testing.T) {
	// 16-color text-orb mode keeps the two-pane split for the status text.
	l := ComputeLayout(100, 30, DisplayTextOrb)
	if l.Mode != ModeSplit || !l.OrbOn {
		t.Fatalf("text-orb at 100 cols: mode=%v orbOn=%v", l.Mode, l.OrbOn)
	}
	if l.OrbW != 35 {
		t.Errorf("text-orb orb width = %d, want 35", l.OrbW)
	}
}

func TestLayoutNoVisual(t *testing.T) {
	// --no-visual: single status line + full-width artifact, no orb.
	l := ComputeLayout(120, 40, DisplayNoVisual)
	if l.Mode != ModeNoVisual {
		t.Fatalf("no-visual: mode=%v, want ModeNoVisual", l.Mode)
	}
	if l.OrbOn {
		t.Error("no-visual must not allocate an orb pane")
	}
	if l.BarH != statusLineH {
		t.Errorf("no-visual status height = %d, want %d", l.BarH, statusLineH)
	}
	if l.ArtW != l.Width {
		t.Errorf("no-visual artifact should span full width: %d != %d", l.ArtW, l.Width)
	}
}

// Degenerate terminal sizes must not panic or overrun the width.
func TestLayoutDegenerate(t *testing.T) {
	l := ComputeLayout(1, 1, DisplayVisual)
	if l.Width != 1 || l.ArtW != 1 {
		t.Errorf("1-col terminal should collapse to artifact: %+v", l)
	}
	// must not panic
	_, _ = ComputeLayout(0, 0, DisplayVisual).ArtifactBody()
}
