package tui

import (
	"testing"

	"github.com/gdamore/tcell/v2"
)

// Keyboard interaction (R10, AC-10.1..10.5). The UI is voice-primary: no focus
// model; all bindings are global (AC-10.4).
func TestKeyBindings(t *testing.T) {
	cases := []struct {
		name string
		key  tcell.Key
		ch   rune
		want Action
	}{
		{"ctrl-s saves", tcell.KeyCtrlS, 0, ActionSave},
		{"ctrl-d ends", tcell.KeyCtrlD, 0, ActionEnd},
		{"q ends", tcell.KeyRune, 'q', ActionEnd},
		{"Q ends", tcell.KeyRune, 'Q', ActionEnd},
		{"escape dismisses", tcell.KeyEscape, 0, ActionDismiss},
		{"ctrl-c force quits", tcell.KeyCtrlC, 0, ActionQuit},
		{"other keys noop", tcell.KeyRune, 'a', ActionNone},
		{"enter noop", tcell.KeyEnter, 0, ActionNone},
		{"arrow noop", tcell.KeyRight, 0, ActionNone},
	}
	for _, c := range cases {
		if got := HandleKey(c.key, c.ch); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
}

// Wrap — pure helper used by artifact/status rendering.
func TestWrap(t *testing.T) {
	cases := []struct {
		in   string
		w    int
		want int // number of lines
	}{
		{"hello", 20, 1},
		{"hello world", 6, 2},
		{"a b c d e", 3, 3},
		{"", 10, 1},
		{"hello\nworld", 20, 2},
		{"verylongwordwithoutspaces", 4, 1}, // single token stays on one line
	}
	for _, c := range cases {
		got := Wrap(c.in, c.w)
		if len(got) != c.want {
			t.Errorf("Wrap(%q, %d) = %d lines, want %d (%v)", c.in, c.w, len(got), c.want, got)
		}
	}
	// no line may exceed the width (for the multi-word cases).
	for _, line := range Wrap("hello world foo bar baz", 5) {
		if len(line) > 5 {
			t.Errorf("line %q exceeds width 5", line)
		}
	}
}

func TestWrapEdgeWidth(t *testing.T) {
	if got := Wrap("ab", 0); len(got) != 1 {
		t.Errorf("width 0 must degrade to a single line, got %d", len(got))
	}
	if i := Wrap("x", -1); len(i) != 1 {
		t.Errorf("negative width degraded, got %d", len(i))
	}
}

func TestGlyphSelection(t *testing.T) {
	// Text representation corresponds to capability (braille default).
	if g := (&App{cap: TermCap{Glyph: GlyphBraille}}).glyph(); g != '⣿' {
		t.Errorf("braille glyph = %c, want ⣿", g)
	}
	if g := (&App{cap: TermCap{Glyph: GlyphHalfBlock}}).glyph(); g != '▀' {
		t.Errorf("half-block glyph = %c, want ▀", g)
	}
	if g := (&App{cap: TermCap{Glyph: GlyphFullBlock}}).glyph(); g != '█' {
		t.Errorf("full-block glyph = %c, want █", g)
	}
}

// stateColor maps status → accent (mood gradient, AC-2.4).
func TestStateColorMapping(t *testing.T) {
	a := &App{}
	a.mu.Lock()
	a.status = StatusListening
	a.mu.Unlock()
	if a.stateColor() != EmberHex() {
		t.Errorf("listening color = %s, want %s", a.stateColor(), EmberHex())
	}
	a.mu.Lock()
	a.status = StatusIdle
	a.mu.Unlock()
	if a.stateColor() != TideHex() {
		t.Errorf("idle color = %s, want %s", a.stateColor(), TideHex())
	}
}
