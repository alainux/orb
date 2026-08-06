//go:build cgo

package audio

import (
	"fmt"

	"github.com/alainux/orb/errs"
	"github.com/gordonklaus/portaudio"
)

const (
	// CaptureSampleRate is the PortAudio capture sample rate (24 kHz mono).
	CaptureSampleRate = 24000
	// CaptureChannels is the number of input channels (mono).
	CaptureChannels = 1
	// CaptureFramesPerBuffer is the PortAudio callback buffer size.
	// 1024 samples ≈ 42.7 ms at 24 kHz. This is the chunk PortAudio delivers
	// to our callback on each invocation.
	CaptureFramesPerBuffer = 1024
)

// Capture wraps PortAudio for 16-bit 24 kHz mono PCM capture (spec R3 AC-3.1).
// Captured frames are pushed into a RingBuffer for downstream consumers
// (animation sampler + WebSocket uploader).
type Capture struct {
	stream *portaudio.Stream
	buf    *RingBuffer
}

// NewCapture creates a Capture backed by the given ring buffer.
// The PortAudio library is NOT initialized here — call InitializeAudio()
// once at program startup before creating any Capture.
func NewCapture(buf *RingBuffer) *Capture {
	return &Capture{buf: buf}
}

// InitializeAudio initializes the PortAudio library. Must be called once
// before any Capture operations. Defer TerminateAudio() in main.
func InitializeAudio() error {
	return portaudio.Initialize()
}

// TerminateAudio releases PortAudio resources. Call after all streams are closed.
func TerminateAudio() error {
	return portaudio.Terminate()
}

// Start opens the default input stream and begins capturing PCM frames
// into the ring buffer. Returns an error if the stream cannot be opened
// (e.g. mic permission denied — spec R11 AC-11.3).
func (c *Capture) Start() error {
	if c.stream != nil {
		return errs.Wrap(errs.KindMic, "capture already started", nil, true)
	}

	// Open the default input stream: mono, 24 kHz, int16, 1024 frames/buffer.
	in := make([]int16, CaptureFramesPerBuffer)
	stream, err := portaudio.OpenDefaultStream(
		CaptureChannels,  // input channels
		0,                // output channels
		float64(CaptureSampleRate),
		CaptureFramesPerBuffer,
		in,
	)
	if err != nil {
		// AC-11.3: a transient "busy" device degrades to text mode; a hard
		// permission denial is fatal. Classify so the caller can react by kind.
		return classifyStartErr(err)
	}

	if err := stream.Start(); err != nil {
		stream.Close()
		return classifyStartErr(err)
	}

	c.stream = stream

	// Continuously read frames from PortAudio into the ring buffer.
	// In production this runs on the PortAudio callback thread. Here we
	// use a polling loop for simplicity; the ring buffer is lock-free so
	// the PortAudio callback thread can also push directly in a future
	// optimization.
	go c.readLoop(in)

	return nil
}

// readLoop continuously reads from the PortAudio stream into the ring buffer.
func (c *Capture) readLoop(buf []int16) {
	for c.stream != nil {
		if err := c.stream.Read(); err != nil {
			// Stream closed or error — stop the loop.
			return
		}
		// Copy the frame and push to ring buffer.
		frame := make([]int16, len(buf))
		copy(frame, buf)
		c.buf.Write(frame)
	}
}

// Stop halts the capture stream and releases PortAudio resources.
func (c *Capture) Stop() error {
	if c.stream == nil {
		return nil
	}
	s := c.stream
	c.stream = nil // signals readLoop to exit

	if err := s.Stop(); err != nil {
		s.Close()
		return fmt.Errorf("stop audio stream: %w", err)
	}
	return s.Close()
}

// RingBuffer returns the underlying ring buffer for reading captured frames.
func (c *Capture) RingBuffer() *RingBuffer {
	return c.buf
}
