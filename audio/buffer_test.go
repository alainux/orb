package audio

import (
	"testing"
)

func TestRingBuffer_WriteRead(t *testing.T) {
	rb := NewRingBuffer()
	if rb.Capacity() != 4800 {
		t.Fatalf("expected capacity 4800, got %d", rb.Capacity())
	}

	// Write 100 samples.
	samples := make([]int16, 100)
	for i := range samples {
		samples[i] = int16(i + 1)
	}
	rb.Write(samples)

	if rb.Available() != 100 {
		t.Fatalf("expected 100 available, got %d", rb.Available())
	}

	// Read them back.
	dst := make([]int16, 100)
	n := rb.ReadFrame(dst)
	if n != 100 {
		t.Fatalf("expected to read 100, got %d", n)
	}
	for i, v := range dst {
		if v != int16(i+1) {
			t.Fatalf("sample %d: expected %d, got %d", i, i+1, v)
		}
	}

	if rb.Available() != 0 {
		t.Fatalf("expected 0 available after read, got %d", rb.Available())
	}
}

func TestRingBuffer_PartialRead(t *testing.T) {
	rb := NewRingBuffer()

	samples := []int16{10, 20, 30}
	rb.Write(samples)

	// Try to read more than available.
	dst := make([]int16, 10)
	n := rb.ReadFrame(dst)
	if n != 3 {
		t.Fatalf("expected to read 3, got %d", n)
	}
	if dst[0] != 10 || dst[1] != 20 || dst[2] != 30 {
		t.Fatalf("unexpected values: %v", dst[:n])
	}
}

func TestRingBuffer_EmptyRead(t *testing.T) {
	rb := NewRingBuffer()

	dst := make([]int16, 10)
	n := rb.ReadFrame(dst)
	if n != 0 {
		t.Fatalf("expected 0 from empty buffer, got %d", n)
	}
}

func TestRingBuffer_OverflowDropsOldest(t *testing.T) {
	rb := NewRingBuffer()

	// Fill the buffer completely.
	full := make([]int16, 4800)
	for i := range full {
		full[i] = int16(i)
	}
	rb.Write(full)

	if rb.Available() != 4800 {
		t.Fatalf("expected 4800 available, got %d", rb.Available())
	}
	if rb.OverflowCount() != 0 {
		t.Fatalf("expected 0 overflow, got %d", rb.OverflowCount())
	}

	// Write 100 more samples — causes overflow.
	extra := make([]int16, 100)
	for i := range extra {
		extra[i] = int16(5000 + i)
	}
	rb.Write(extra)

	// Overflow: 100 oldest samples dropped.
	if rb.OverflowCount() != 100 {
		t.Fatalf("expected 100 overflow, got %d", rb.OverflowCount())
	}

	// Buffer should still be full (4800).
	if rb.Available() != 4800 {
		t.Fatalf("expected 4800 available after overflow, got %d", rb.Available())
	}

	// Read all — the oldest samples (0..99) should be gone.
	dst := make([]int16, 4800)
	n := rb.ReadFrame(dst)
	if n != 4800 {
		t.Fatalf("expected to read 4800, got %d", n)
	}

	// First readable sample should be 100 (sample 0 was dropped).
	if dst[0] != 100 {
		t.Fatalf("expected first sample to be 100, got %d", dst[0])
	}

	// Last samples should be the extra ones (5000..5099).
	if dst[4700] != 5000 {
		t.Fatalf("expected sample at 4700 to be 5000, got %d", dst[4700])
	}
}

func TestRingBuffer_OverflowMs(t *testing.T) {
	rb := NewRingBuffer()

	// Fill and overflow by 2400 samples (= 100ms at 24kHz).
	full := make([]int16, 4800)
	rb.Write(full)

	extra := make([]int16, 2400)
	rb.Write(extra)

	expectedMs := 2400.0 / float64(BufferSampleRate) * 1000.0 // 100ms
	if rb.OverflowMs() != expectedMs {
		t.Fatalf("expected OverflowMs %.1f, got %.1f", expectedMs, rb.OverflowMs())
	}
}

func TestRingBuffer_WrapAround(t *testing.T) {
	rb := NewRingBuffer()

	// Write and read repeatedly to exercise the ring wrap-around.
	for cycle := 0; cycle < 5; cycle++ {
		samples := make([]int16, 2000)
		for i := range samples {
			samples[i] = int16(cycle*2000 + i)
		}
		rb.Write(samples)

		dst := make([]int16, 2000)
		n := rb.ReadFrame(dst)
		if n != 2000 {
			t.Fatalf("cycle %d: expected to read 2000, got %d", cycle, n)
		}
		for i, v := range dst {
			expected := int16(cycle*2000 + i)
			if v != expected {
				t.Fatalf("cycle %d, sample %d: expected %d, got %d", cycle, i, expected, v)
			}
		}
	}
}

func TestRingBuffer_Reset(t *testing.T) {
	rb := NewRingBuffer()

	samples := make([]int16, 100)
	rb.Write(samples)

	rb.Reset()

	if rb.Available() != 0 {
		t.Fatalf("expected 0 after reset, got %d", rb.Available())
	}
	if rb.OverflowCount() != 0 {
		t.Fatalf("expected 0 overflow after reset, got %d", rb.OverflowCount())
	}
}

func TestRingBuffer_LargeOverflow(t *testing.T) {
	rb := NewRingBuffer()

	// Fill buffer.
	full := make([]int16, 4800)
	rb.Write(full)

	// Overflow by more than the full buffer — only the most recent 4800
	// samples should remain.
	extra := make([]int16, 9600)
	for i := range extra {
		extra[i] = int16(10000 + i)
	}
	rb.Write(extra)

	if rb.OverflowCount() != 9600 {
		t.Fatalf("expected 9600 overflow, got %d", rb.OverflowCount())
	}

	dst := make([]int16, 4800)
	n := rb.ReadFrame(dst)
	if n != 4800 {
		t.Fatalf("expected 4800, got %d", n)
	}

	// The oldest samples should be from the tail of the extra write.
	if dst[0] != int16(10000+4800) {
		t.Fatalf("expected first sample %d, got %d", 10000+4800, dst[0])
	}
}
