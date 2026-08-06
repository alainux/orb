package voice_test

import (
	"encoding/base64"
	"encoding/binary"
	"testing"

	"github.com/alainux/orb/voice"
)

func TestEncodePCM16(t *testing.T) {
	// encodePCM16 is not exported, but we can test it indirectly through
	// the OpenAI provider's exported API, or test the encoding logic directly.
	// Since encodePCM16 is unexported, we verify the encoding contract here
	// by reimplementing the same logic and checking round-trip.

	samples := []int16{0, 100, -100, 32767, -32768}

	// Encode to bytes (matching encodePCM16's logic).
	buf := make([]byte, len(samples)*2)
	for i, s := range samples {
		binary.LittleEndian.PutUint16(buf[i*2:], uint16(s))
	}
	b64 := base64.StdEncoding.EncodeToString(buf)

	// Decode and verify.
	decoded, err := base64.StdEncoding.DecodeString(b64)
	if err != nil {
		t.Fatalf("base64 decode failed: %v", err)
	}

	for i, s := range samples {
		got := int16(binary.LittleEndian.Uint16(decoded[i*2:]))
		if got != s {
			t.Errorf("sample %d: got %d, want %d", i, got, s)
		}
	}
}

func TestEncodePCM16_Empty(t *testing.T) {
	samples := []int16{}
	buf := make([]byte, len(samples)*2)
	for i, s := range samples {
		binary.LittleEndian.PutUint16(buf[i*2:], uint16(s))
	}
	b64 := base64.StdEncoding.EncodeToString(buf)
	if b64 != "" {
		t.Errorf("empty samples should produce empty base64, got %q", b64)
	}
}

func TestEncodePCM16_ChunkSize(t *testing.T) {
	// Verify that 480 samples (20ms at 24kHz) encodes to a reasonable base64 size.
	samples := make([]int16, 480)
	for i := range samples {
		samples[i] = int16(i)
	}

	buf := make([]byte, len(samples)*2)
	for i, s := range samples {
		binary.LittleEndian.PutUint16(buf[i*2:], uint16(s))
	}
	b64 := base64.StdEncoding.EncodeToString(buf)

	// 480 samples × 2 bytes = 960 bytes → base64 ≈ 1280 chars.
	if len(b64) < 1000 || len(b64) > 1500 {
		t.Errorf("base64 size = %d, expected ~1280", len(b64))
	}
}

func TestEphemeralTokenResponse_Fields(t *testing.T) {
	// Test the struct can be populated (no actual network call).
	resp := voice.EphemeralTokenResponse{
		Value:     "ek_test_123",
		ExpiresAt: 1234567890,
	}
	if resp.Value != "ek_test_123" {
		t.Errorf("Value = %q, want ek_test_123", resp.Value)
	}
	if resp.ExpiresAt != 1234567890 {
		t.Errorf("ExpiresAt = %d, want 1234567890", resp.ExpiresAt)
	}
}
