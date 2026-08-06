package tui

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alainux/orb/config"
	"github.com/alainux/orb/errs"
	"github.com/gdamore/tcell/v2"
)

// TestOnErrorSurfacesUserMessage verifies OnError renders a classified error's
// safe message (E-2 / AC-11.1): a typed errs error keeps its user-facing text.
func TestOnErrorSurfacesUserMessage(t *testing.T) {
	a := NewApp(&config.Config{Format: "md"})
	e := errs.Recoverable(errs.KindConnect, errs.MsgConnLost, errors.New("dial tcp: refused"))
	a.OnError(e)
	a.mu.Lock()
	msg := a.errMsg
	atSet := !a.errMsgAt.IsZero()
	status := a.status
	a.mu.Unlock()
	if msg != errs.MsgConnLost {
		t.Errorf("errMsg = %q, want %q", msg, errs.MsgConnLost)
	}
	if !atSet {
		t.Error("errMsgAt should be set after OnError")
	}
	if status != StatusError {
		t.Errorf("status = %q, want error", status)
	}
}

// TestOnErrorNilIsIgnored is a defensive check.
func TestOnErrorNilIsIgnored(t *testing.T) {
	a := NewApp(&config.Config{Format: "md"})
	a.OnError(nil)
	a.mu.Lock()
	msg := a.errMsg
	a.mu.Unlock()
	if msg != "" {
		t.Errorf("OnError(nil) should not set an error, got %q", msg)
	}
}

// TestShowErrorTransientWindow verifies the generic error footer expires after
// its flash window (mirrors the pipe footer).
func TestShowErrorTransientWindow(t *testing.T) {
	a := NewApp(&config.Config{Format: "md"})
	a.mu.Lock()
	a.errMsg = "connection lost — retrying…"
	a.errMsgAt = time.Now().Add(-(errorFlashDuration + time.Second))
	a.mu.Unlock()
	if a.errorActive() {
		t.Error("a stale generic error should no longer be active")
	}
}

// TestShowErrorRendersInFooter is a visual-qa assertion: a transient generic
// error is painted in the artifact footer as "! <message>" (E-2).
func TestShowErrorRendersInFooter(t *testing.T) {
	a := NewApp(&config.Config{Format: "md"})
	a.SetCapability(TermCap{Color: ColorTrueColor, Glyph: GlyphBraille, Mode: DisplayNoVisual})
	a.SetArtifact("hello")
	a.ShowError(errs.MsgConnLost)

	sim := tcell.NewSimulationScreen("")
	if err := sim.Init(); err != nil {
		t.Fatal(err)
	}
	defer sim.Fini()
	w, h := 70, 12
	a.RenderTo(sim, w, h)
	cells, cw, ch := sim.GetContents()

	row := footerRow(cells, cw, ch-1)
	if !strings.Contains(row, "! "+errs.MsgConnLost) {
		t.Errorf("footer should show the generic error, got %q", row)
	}
}