package playback

import (
	"sync"
	"sync/atomic"
	"time"
)

// Buffer adds a small hardware-side jitter buffer on top of Queue. The Node
// process may briefly stall while Pi renders or processes agent events; the
// audio device must never respond by emitting tiny PCM fragments forever.
// After an underrun, Buffer pauses, rebuilds a lead, then resumes at the
// hardware clock. It never skips or time-compresses PCM.
//
// Two escalation behaviors keep a transient stall from hardening into
// persistent choppiness:
//
//   - A *rapid underrun spiral* (a second underrun arriving while the previous
//     rebuild has not yet had a chance to deliver a healthy lead) means the
//     producer is short for longer than the current cushion. Rather than
//     inching the target up one step per 10 ms gap (a long, audible choppy
//     tail), the target is raised by a larger step so the re-prime completes
//     and builds a solid lead in fewer, hence shorter, interruptions.
//
//   - Once delivery has been continuously healthy for a sustained streak, the
//     escalated target is gently brought back toward the base so latency does
//     not permanently ratchet to max and linger into the following response.
const (
	// rapidUnderrunWindow is how recently the previous underrun must have
	// occurred for this one to count as part of a spiral rather than an
	// independent transient stall (~12 hardware callbacks).
	rapidUnderrunWindow = 120 * time.Millisecond
	// escalateMultiplier multiplies one recovery step when in a spiral so the
	// cushion re-primes in fewer interruptions.
	rapidEscalateFactor = 2
	// steadyReadsBeforeRelax is how many consecutive full-callback reads must
	// be observed (i.e. sustained healthy delivery) before the escalated
	// target is relaxed back toward the base.
	steadyReadsBeforeRelax = 30
)

type Buffer struct {
	mu           sync.Mutex
	q            Queue
	baseTarget   int
	target       int
	maxTarget    int
	recoveryStep int
	playing      bool
	ending       bool
	// lastUnderrunN is the unix-nano timestamp of the most recent underrun.
	lastUnderrunN int64
	// steadyReads counts consecutive full callbacks delivered since the last
	// underrun or escalation. Used to confirm recovery before relaxing latency.
	steadyReads int
	recoveries  atomic.Uint32
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
	b.steadyReads = 0
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
			b.steadyReads = 0
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
		b.escalate(time.Now().UnixNano())
		return 0
	}

	n := b.q.ReadInto(dst)
	if n == len(dst) {
		// Resonance is healthy: note delivery so the escalated latency can be
		// relaxed once the streak is long enough.
		if b.steadyReads >= 0 {
			b.steadyReads++
			if b.steadyReads >= steadyReadsBeforeRelax && b.target > b.baseTarget {
				b.target -= b.recoveryStep / 2
				if b.target < b.baseTarget {
					b.target = b.baseTarget
				}
				b.steadyReads = 0
			}
		}
		return n
	}

	if b.ending && b.q.Len() == 0 {
		// Natural response tail. Slowly relax adaptive latency after a clean end.
		b.playing = false
		b.ending = false
		b.steadyReads = 0
		b.relaxToBase()
		return n
	}

	// Mid-response starvation: stop producing fragments, build a lead, resume.
	b.escalate(time.Now().UnixNano())
	return n
}

// escalate handles an underrun: pause playback, count the recovery, and raise
// the adaptive lead so the rebuild no longer under-flood. A rapid second
// underrun (an underrun still in the middle of a rebuild) means the shortfall
// is deeper than one step; escalate by a larger step to re-prime faster.
// Caller holds b.mu.
func (b *Buffer) escalate(now int64) {
	b.playing = false
	b.steadyReads = 0
	step := b.recoveryStep
	if b.lastUnderrunN > 0 && now-b.lastUnderrunN < int64(rapidUnderrunWindow) {
		step *= rapidEscalateFactor
	}
	b.lastUnderrunN = now
	b.recoveries.Add(1)
	if b.target < b.maxTarget {
		b.target += step
		if b.target > b.maxTarget {
			b.target = b.maxTarget
		}
	}
}

// relaxToBase returns the adaptive latency to its nominal base. Used after a
// clean natural end and (via repeated healthy delivery) after a recovered,
// sustained burst, so an escalated cushion never lingers into the next turn.
// Caller holds b.mu.
func (b *Buffer) relaxToBase() {
	b.target = b.baseTarget
}
