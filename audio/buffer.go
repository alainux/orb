// Package audio implements the orb audio subsystem: PCM ring buffer,
// PortAudio capture, RMS/spectral-centroid analysis, and client-side VAD.
//
// Spec references: R3 (AC-3.1), R4 (AC-4.1–4.4), R5 (AC-5.1–5.3),
// DEC-2 (jitter buffer), DEC-6 (VAD ownership).
package audio

import (
	"sync/atomic"
	"time"
)

// BufferSampleRate is the native PCM sample rate (24 kHz mono, per spec R3).
const BufferSampleRate = 24000

// BufferDurationMs is the jitter buffer capacity in milliseconds (DEC-2).
const BufferDurationMs = 200

// bufferCapacity is the ring buffer capacity in int16 samples.
// 24000 * 200 / 1000 = 4800 samples.
const bufferCapacity = BufferSampleRate * BufferDurationMs / 1000

// RingBuffer is a lock-free single-producer single-consumer ring buffer
// for int16 PCM samples. The PortAudio callback thread writes; one or
// more goroutines read. Overflow drops oldest samples (DEC-2 backpressure).
type RingBuffer struct {
	buf  [bufferCapacity]int16
	head atomic.Uint64 // write position (monotonically increasing)
	tail atomic.Uint64 // read position (monotonically increasing)

	// overflowCount is the total number of samples dropped due to overflow.
	overflowCount atomic.Uint64
}

// NewRingBuffer creates a zero-value ring buffer ready for use.
func NewRingBuffer() *RingBuffer {
	return &RingBuffer{}
}

// Capacity returns the buffer capacity in samples.
func (rb *RingBuffer) Capacity() int {
	return bufferCapacity
}

// Write pushes samples into the ring buffer. If the buffer is full (writer
// is more than capacity ahead of reader), oldest samples are dropped and
// overflowCount is incremented. Safe to call from the PortAudio callback.
func (rb *RingBuffer) Write(samples []int16) {
	h := rb.head.Load()
	t := rb.tail.Load()

	available := h - t
	space := uint64(bufferCapacity) - available

	if uint64(len(samples)) > space {
		// Overflow: advance tail to make room (drop oldest).
		drop := uint64(len(samples)) - space
		rb.tail.Add(drop)
		rb.overflowCount.Add(drop)
	}

	// Write samples into the buffer ring.
	for i, s := range samples {
		idx := (h + uint64(i)) % uint64(bufferCapacity)
		rb.buf[idx] = s
	}
	rb.head.Add(uint64(len(samples)))
}

// ReadFrame reads exactly n samples into dst. Returns the number of samples
// actually read (may be less than n if not enough data is available).
// The caller must not hold dst across calls; it is filled in-place.
func (rb *RingBuffer) ReadFrame(dst []int16) int {
	h := rb.head.Load()
	t := rb.tail.Load()

	available := int(h - t)
	n := len(dst)
	if n > available {
		n = available
	}
	if n <= 0 {
		return 0
	}

	for i := 0; i < n; i++ {
		idx := (t + uint64(i)) % uint64(bufferCapacity)
		dst[i] = rb.buf[idx]
	}
	rb.tail.Add(uint64(n))
	return n
}

// ReadFrameBlocking blocks until at least n samples are available or ctx is
// done. Returns the number of samples read (0 on context cancellation).
func (rb *RingBuffer) ReadFrameBlocking(dst []int16, timeout time.Duration) int {
	deadline := time.Now().Add(timeout)
	n := len(dst)

	for {
		h := rb.head.Load()
		t := rb.tail.Load()
		available := int(h - t)
		if available >= n {
			for i := 0; i < n; i++ {
				idx := (t + uint64(i)) % uint64(bufferCapacity)
				dst[i] = rb.buf[idx]
			}
			rb.tail.Add(uint64(n))
			return n
		}
		if time.Now().After(deadline) {
			// Partial read: return whatever is available.
			if available > 0 {
				for i := 0; i < available; i++ {
					idx := (t + uint64(i)) % uint64(bufferCapacity)
					dst[i] = rb.buf[idx]
				}
				rb.tail.Add(uint64(available))
			}
			return available
		}
		// Yield to avoid busy-spinning.
		time.Sleep(time.Millisecond)
	}
}

// Available returns the number of samples currently buffered (unread).
func (rb *RingBuffer) Available() int {
	return int(rb.head.Load() - rb.tail.Load())
}

// OverflowCount returns the total number of samples dropped due to overflow.
func (rb *RingBuffer) OverflowCount() uint64 {
	return rb.overflowCount.Load()
}

// OverflowMs returns the total duration of dropped audio in milliseconds.
func (rb *RingBuffer) OverflowMs() float64 {
	return float64(rb.OverflowCount()) / float64(BufferSampleRate) * 1000.0
}

// Reset clears the buffer and all metrics. Not safe for concurrent use.
func (rb *RingBuffer) Reset() {
	rb.head.Store(0)
	rb.tail.Store(0)
	rb.overflowCount.Store(0)
}
