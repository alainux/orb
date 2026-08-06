//go:build cgo

package audio

import (
	"encoding/binary"
	"sync"
	"time"

	webrtcvad "github.com/maxhawkins/go-webrtcvad"
)

// VADState represents the voice activity detection state.
type VADState int

const (
	// VADIdle indicates silence (no speech detected).
	VADIdle VADState = iota
	// VADListening indicates active speech.
	VADListening
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

const (
	// vadDownsampleRate is the target sample rate for WebRTC VAD (16 kHz).
	vadDownsampleRate = 16000

	// vadFrameDurationMs is the VAD analysis frame duration (20 ms).
	vadFrameDurationMs = 20

	// vadFrameSamples is the number of 16kHz samples per VAD frame (20ms).
	vadFrameSamples = vadDownsampleRate * vadFrameDurationMs / 1000

	// vadEasingMs is the smoothing window for state transitions (spec R5 AC-5.3).
	vadEasingMs = 200
)

// VAD wraps the WebRTC VAD for client-side barge-in detection (DEC-6).
// It downsamples 24kHz PCM to 16kHz and runs the VAD on 20ms frames.
type VAD struct {
	vad *webrtcvad.VAD

	mu          sync.Mutex
	state       VADState
	stateSince  time.Time
	pendingState VADState
	speechCount int // consecutive speech frames
	silenceCount int // consecutive silence frames

	// Downsample buffer: accumulates 24kHz samples until we have enough
	// for one 16kHz VAD frame.
	downBuf []int16
}

// NewVAD creates a new VAD instance with aggressive mode (mode 3 = most
// aggressive, best for barge-in detection).
func NewVAD() (*VAD, error) {
	v, err := webrtcvad.New()
	if err != nil {
		return nil, err
	}
	if err := v.SetMode(3); err != nil {
		return nil, err
	}

	return &VAD{
		vad:         v,
		state:       VADIdle,
		stateSince:  time.Now(),
		pendingState: VADIdle,
		downBuf:     make([]int16, 0, vadFrameSamples*3),
	}, nil
}

// Process feeds 24kHz PCM samples into the VAD and returns the current
// state. Samples are internally downsampled to 16kHz for the WebRTC VAD.
func (v *VAD) Process(samples []int16) VADState {
	v.mu.Lock()
	defer v.mu.Unlock()

	// Append to downsample buffer and process complete VAD frames.
	v.downBuf = append(v.downBuf, samples...)

	for len(v.downBuf) >= vadFrameSamples*3 {
		// Downsample 3 samples of 24kHz → 1 sample of 16kHz.
		down := v.downsample3to2(v.downBuf[:vadFrameSamples*3])
		v.downBuf = v.downBuf[vadFrameSamples*3:]

		// Convert int16 samples to bytes for the WebRTC VAD.
		frameBytes := int16ToBytes(down)

		speech, err := v.vad.Process(vadDownsampleRate, frameBytes)
		if err != nil {
			continue // skip bad frames
		}

		if speech {
			v.speechCount++
			v.silenceCount = 0
		} else {
			v.silenceCount++
			v.speechCount = 0
		}

		// Easing: need consecutive frames in the new state before switching.
		// 200ms easing = vadEasingMs / vadFrameDurationMs consecutive frames.
		framesForTransition := vadEasingMs / vadFrameDurationMs

		if v.speechCount >= framesForTransition && v.state == VADIdle {
			v.state = VADListening
			v.stateSince = time.Now()
		} else if v.silenceCount >= framesForTransition && v.state == VADListening {
			v.state = VADIdle
			v.stateSince = time.Now()
		}
	}

	return v.state
}

// State returns the current VAD state without processing new samples.
func (v *VAD) State() VADState {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.state
}

// StateDuration returns how long the current state has been active.
func (v *VAD) StateDuration() time.Duration {
	v.mu.Lock()
	defer v.mu.Unlock()
	return time.Since(v.stateSince)
}

// downsample3to2 downsamples 3 input samples (at 24kHz) to 2 output samples
// (at 16kHz) by linear interpolation. Input must have at least 3 samples.
func (v *VAD) downsample3to2(in []int16) []int16 {
	out := make([]int16, 2)
	// 24kHz → 16kHz ratio is 3:2. Sample at positions 0 and 1.5 of the
	// 3-sample input window.
	out[0] = in[0]
	// Position 1.5: average of sample 1 and 2.
	out[1] = (in[1] + in[2]) / 2
	return out
}

// Reset clears the VAD state and downsample buffer.
func (v *VAD) Reset() {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.state = VADIdle
	v.stateSince = time.Now()
	v.speechCount = 0
	v.silenceCount = 0
	v.downBuf = v.downBuf[:0]
}



// int16ToBytes converts a slice of int16 samples to a byte slice (little-endian).
func int16ToBytes(samples []int16) []byte {
	b := make([]byte, len(samples)*2)
	for i, s := range samples {
		binary.LittleEndian.PutUint16(b[i*2:], uint16(s))
	}
	return b
}
