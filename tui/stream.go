package tui

import "time"

// revealInterval is the fixed per-character display pace for streamed agent
// text (AC-19.2).
const revealInterval = 30 * time.Millisecond

// RevealBuffer paces agent text so the artifact pane appears to type
// character-by-character (R19 / AC-19.1..19.5):
//
//   - Live streamed chunks are appended to pending and shown only as fast as
//     revealInterval allows (AC-19.3: fast stream stays pre-buffered).
//   - When the stream is slow the buffer simply has nothing to give out, so
//     the next chunk is shown once it actually arrives — no artificial delay
//     is injected (AC-19.4).
//   - Reset() replaces the whole pane instantly, matching an update_artifact
//     tool call that swaps the full content (AC-19.5).
//
// The type is pure (no UI/screen access) and unit-testable.
type RevealBuffer struct {
	visible string  // already-revealed text shown in the pane
	pending string  // streamed but not yet displayed
	phase   float64 // accumulated time since the last consumed character
}

// Visible returns the text that should currently be on screen.
func (rb *RevealBuffer) Visible() string { return rb.visible }

// Pending returns the text buffered but not yet revealed.
func (rb *RevealBuffer) Pending() string { return rb.pending }

// Append queues a fresh streaming chunk without revealing it (AC-19.1).
func (rb *RevealBuffer) Append(chunk string) {
	if chunk == "" {
		return
	}
	rb.pending += chunk
}

// Reset replaces the entire buffer with text shown immediately and fully. This
// is the update_artifact instant-replace path (AC-19.5).
func (rb *RevealBuffer) Reset(text string) {
	rb.visible = text
	rb.pending = ""
	rb.phase = 0
}

// Tick advances the reveal clock by dt, moving characters from pending into
// visible at revealInterval per character. Returns the number of characters
// revealed during this tick.
func (rb *RevealBuffer) Tick(dt time.Duration) int {
	if rb.pending == "" {
		rb.phase = 0 // nothing buffered: don't bank time, wait for the next chunk
		return 0
	}
	rb.phase += float64(dt)
	n := int(rb.phase / float64(revealInterval))
	if n <= 0 {
		return 0
	}
	if n > len(rb.pending) {
		n = len(rb.pending)
	}
	rb.visible += rb.pending[:n]
	rb.pending = rb.pending[n:]
	rb.phase -= float64(n) * float64(revealInterval)
	return n
}

// Revealed returns true when nothing remains pending (fully caught up).
func (rb *RevealBuffer) Revealed() bool { return rb.pending == "" }
