package tui

import (
	"math"
	"time"
)

// revealDuration is the session-start slide-in: panes emanate from the centre
// to their resting columns. The dispatch milestone standardises on 1.2s (the
// written AC-1.5 says 0.5s; see final report for the note).
const revealDuration = 1200 * time.Millisecond

// easeOutCubic gives a fast-start, soft-land easing for the reveal.
func easeOutCubic(p float64) float64 {
	q := 1 - clamp01(p)
	return 1 - q*q*q
}

// revealShift maps a resting column toward the horizontal centre by the
// inverse of completion: at progress=0 everything collapses to the centre, at
// progress=1 columns are unchanged. It is pure and unit-tested (AC-1.5).
func revealShift(col int, progress float64, width int) int {
	if progress >= 1 || width <= 1 {
		return col
	}
	e := easeOutCubic(clamp01(progress))
	center := width / 2
	off := float64(col-center) * e
	return center + int(math.Round(off))
}

// shiftX routes a column through the active reveal transform (identity once
// the reveal completes). Used by panes that draw at fixed pane coordinates.
func (a *App) shiftX(col int) int {
	a.mu.Lock()
	r := a.reveal
	w := a.width
	a.mu.Unlock()
	return revealShift(col, r, w)
}
