package playback

import (
	"sync"
	"sync/atomic"
)

// Buffer adds a small hardware-side jitter buffer on top of Queue. The Node
// process may briefly stall while Pi renders or processes agent events; the
// audio device must never respond by emitting tiny PCM fragments forever.
// After an underrun, Buffer pauses, rebuilds a lead, then resumes at the
// hardware clock. It never skips or time-compresses PCM.
type Buffer struct {
	mu           sync.Mutex
	q            Queue
	baseTarget   int
	target       int
	maxTarget    int
	recoveryStep int
	playing      bool
	ending       bool
	recoveries   atomic.Uint32
}

func NewBuffer(baseTarget, maxTarget, recoveryStep int) *Buffer {
	if baseTarget < 0 {
		baseTarget = 0
	}
	if maxTarget < baseTarget {
		maxTarget = baseTarget
	}
	if recoveryStep < 1 {
		recoveryStep = 1
	}
	return &Buffer{baseTarget: baseTarget, target: baseTarget, maxTarget: maxTarget, recoveryStep: recoveryStep}
}

func (b *Buffer) Write(p []byte) { b.q.Write(p) }

func (b *Buffer) End() {
	b.mu.Lock()
	b.ending = true
	if b.q.Len() == 0 && !b.playing {
		b.ending = false
	}
	b.mu.Unlock()
}

func (b *Buffer) Clear() {
	b.mu.Lock()
	b.q.Clear()
	b.playing = false
	b.ending = false
	b.mu.Unlock()
}

func (b *Buffer) Len() int           { return b.q.Len() }
func (b *Buffer) Recoveries() uint32 { return b.recoveries.Load() }
func (b *Buffer) TargetBytes() int   { b.mu.Lock(); defer b.mu.Unlock(); return b.target }

// ReadInto is called only by the hardware callback. dst is already cleared by
// the caller. A return shorter than len(dst) is therefore silence for the
// remainder of the callback period, never duplicated or accelerated audio.
func (b *Buffer) ReadInto(dst []byte) int {
	b.mu.Lock()
	defer b.mu.Unlock()
	queued := b.q.Len()
	if !b.playing {
		if queued >= b.target || (b.ending && queued > 0) {
			b.playing = true
		} else {
			return 0
		}
	}

	// If a live response cannot fill one complete hardware callback, do not
	// consume or emit a tiny fragment. Preserve those samples, pause output,
	// rebuild a lead, then resume on a later device callback. This is the key
	// difference between a recoverable underrun and the permanent "micro-spike"
	// choppiness produced by repeatedly draining partial frames.
	if !b.ending && queued < len(dst) {
		b.playing = false
		b.recoveries.Add(1)
		if b.target < b.maxTarget {
			b.target += b.recoveryStep
			if b.target > b.maxTarget {
				b.target = b.maxTarget
			}
		}
		return 0
	}

	n := b.q.ReadInto(dst)
	if n == len(dst) {
		return n
	}

	if b.ending && b.q.Len() == 0 {
		// Natural response tail. Slowly relax adaptive latency after a clean end.
		b.playing = false
		b.ending = false
		if b.target > b.baseTarget {
			b.target -= b.recoveryStep / 2
			if b.target < b.baseTarget {
				b.target = b.baseTarget
			}
		}
		return n
	}

	// Mid-response starvation: stop producing fragments, build a lead, resume.
	b.playing = false
	b.recoveries.Add(1)
	if b.target < b.maxTarget {
		b.target += b.recoveryStep
		if b.target > b.maxTarget {
			b.target = b.maxTarget
		}
	}
	return n
}
