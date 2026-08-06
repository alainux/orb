//go:build !cgo

package audio

import (
	"fmt"

	"github.com/alainux/orb/errs"
)

// Capture is a stub for builds without CGO. All methods return an error
// indicating that audio capture requires PortAudio + CGO (spec R3 AC-3.1,
// DEC-3 build constraint).
type Capture struct {
	buf *RingBuffer
}

// NewCapture returns a stub Capture. It will fail on Start().
func NewCapture(buf *RingBuffer) *Capture {
	return &Capture{buf: buf}
}

// InitializeAudio is a no-op stub when CGO is disabled.
func InitializeAudio() error {
	return nil
}

// TerminateAudio is a no-op stub when CGO is disabled.
func TerminateAudio() error {
	return nil
}

// Start returns an error: audio capture requires PortAudio with CGO_ENABLED=1.
// The error is non-fatal so the caller can degrade to a text-only session
// (spec R11 AC-11.3 degraded-mode fallback) rather than exiting.
func (c *Capture) Start() error {
	return errs.Wrap(errs.KindMic, errs.MsgDegradedMic, fmt.Errorf("audio capture requires PortAudio; rebuild with CGO_ENABLED=1"), false)
}

// Stop is a no-op stub.
func (c *Capture) Stop() error {
	return nil
}

// RingBuffer returns the underlying ring buffer.
func (c *Capture) RingBuffer() *RingBuffer {
	return c.buf
}

// VADState is defined in vad.go for the cgo build; the stub build does
// not include vad.go (it has a //go:build cgo tag). Define VADState here
// so non-cgo code that references the type compiles.
type VADState int

const (
	VADIdle      VADState = 0
	VADListening VADState = 1
)

// String returns a human-readable label for the state.
func (s VADState) String() string {
	switch s {
	case VADIdle:
		return "idle"
	case VADListening:
		return "listening"
	default:
		return "unknown"
	}
}

// VAD is a stub for builds without CGO.
type VAD struct{}

// NewVAD returns a stub VAD.
func NewVAD() (*VAD, error) {
	return &VAD{}, nil
}

// Process returns VADIdle (no speech detection without CGO).
func (v *VAD) Process(samples []int16) VADState {
	return VADIdle
}

// State returns VADIdle.
func (v *VAD) State() VADState {
	return VADIdle
}

// Reset is a no-op.
func (v *VAD) Reset() {}


