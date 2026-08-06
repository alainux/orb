package tui

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/alainux/orb/config"
	"github.com/alainux/orb/pipe"
	"github.com/gdamore/tcell/v2"
)

// TestSaveDispatchesJSONPayload is the R7 integration path (AC-7.1..7.3):
// saving with a configured pipe command writes the artifact JSON payload to
// the child's stdin on save.
func TestSaveDispatchesJSONPayload(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX tee")
	}
	dir := t.TempDir()
	echoFile := filepath.Join(dir, "captured.json")
	a := NewApp(&config.Config{Format: "md", PipeCommand: "tee " + echoFile})
	if a.hook == nil {
		t.Fatal("expected a pipe hook when PipeCommand is configured")
	}
	a.SetArtifact("# Hello\n\npipe payload")
	a.SetTurns(3)
	if _, err := a.Save(filepath.Join(dir, "out.md")); err != nil {
		t.Fatalf("Save: %v", err)
	}
	a.hook.Stop() // drain the async worker so the file is guaranteed written

	b, err := os.ReadFile(echoFile)
	if err != nil {
		t.Fatalf("read captured payload: %v (payload not dispatched)", err)
	}
	var p pipe.Payload
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatalf("payload not valid JSON: %v\n%s", err, string(b))
	}
	if p.Artifact != "# Hello\n\npipe payload" {
		t.Errorf("artifact payload mismatch: %q", p.Artifact)
	}
	if p.Session.Turns != 3 {
		t.Errorf("turns = %d, want 3", p.Session.Turns)
	}
	if p.Session.Words != 4 { // "#","Hello","pipe","payload"
		t.Errorf("words = %d, want 4", p.Session.Words)
	}
}

// TestNoPipeCommandIsInert verifies saving without --pipe never spawns a hook.
func TestNoPipeCommandIsInert(t *testing.T) {
	a := NewApp(&config.Config{Format: "md"})
	if a.hook != nil {
		t.Fatal("no hook should be created without a pipe command")
	}
	a.SetArtifact("no hook here")
	if _, err := a.Save(filepath.Join(t.TempDir(), "x.md")); err != nil {
		t.Fatalf("Save: %v", err)
	}
}

// TestSavePipeFailureSetsFooterError is the AC-7.5 / AC-11.4 error path: a
// non-zero pipe exit is surfaced (pipe failed: exit 1) yet the save still
// succeeds (the file was written before the pipe ran).
func TestSavePipeFailureSetsFooterError(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses `false`")
	}
	dir := t.TempDir()
	out := filepath.Join(dir, "out.md")
	a := NewApp(&config.Config{Format: "md", PipeCommand: "false"})
	a.SetArtifact("save must still succeed")
	if _, err := a.Save(out); err != nil {
		t.Fatalf("save must succeed even when the pipe fails: %v", err)
	}
	if _, err := os.Stat(out); err != nil {
		t.Fatalf("artifact file should exist regardless: %v", err)
	}
	a.hook.Stop() // ensure worker finished before asserting the error

	a.mu.Lock()
	msg := a.pipeErr
	a.mu.Unlock()
	if !strings.Contains(msg, "pipe failed: exit 1") {
		t.Errorf("footer error %q should contain 'pipe failed: exit 1'", msg)
	}
	if !a.pipeErrorActive() {
		t.Error("pipeErrorActive should be true right after a failure")
	}
	if a.pipeErrorText() != "! "+a.pipeErr {
		t.Errorf("pipeErrorText should prefix the message: %q", a.pipeErrorText())
	}
}

// TestPipeErrorExpiresAfterFlash verifies the footer error is transient
// (AC-7.5), clearing once the flash window passes.
func TestPipeErrorExpiresAfterFlash(t *testing.T) {
	a := NewApp(&config.Config{Format: "md"})
	a.mu.Lock()
	a.pipeErr = "pipe failed: exit 1"
	a.pipeErrAt = time.Now().Add(-(pipeErrorFlashDuration + time.Second))
	a.mu.Unlock()
	if a.pipeErrorActive() {
		t.Error("a stale pipe error should no longer be active")
	}
}

// TestPipeErrorRendersInFooter is a visual-qa assertion: the pipe error is
// painted into the artifact footer row (AC-7.5 / AC-11.4) as
// "! pipe failed: exit 1".
func TestPipeErrorRendersInFooter(t *testing.T) {
	a := NewApp(&config.Config{Format: "md", NoVisual: true})
	a.SetCapability(TermCap{Color: ColorTrueColor, Glyph: GlyphBraille, Mode: DisplayNoVisual})
	a.SetArtifact("hello")
	a.SetPipeError("pipe failed: exit 1")

	sim := tcell.NewSimulationScreen("")
	if err := sim.Init(); err != nil {
		t.Fatal(err)
	}
	defer sim.Fini()
	w, h := 80, 12
	a.RenderTo(sim, w, h)
	cells, cw, ch := sim.GetContents()

	row := footerRow(cells, cw, ch-1)
	if !strings.Contains(row, "! pipe failed: exit 1") {
		t.Errorf("footer should show the pipe failure, got %q", row)
	}
}

// footerRow joins the runes of a screen row into a string (visual-qa helper).
func footerRow(cells []tcell.SimCell, w, y int) string {
	var b strings.Builder
	for x := 0; x < w; x++ {
		i := y*w + x
		if i < 0 || i >= len(cells) {
			break
		}
		rs := cells[i].Runes
		if len(rs) > 0 {
			b.WriteRune(rs[0])
		}
	}
	return b.String()
}
