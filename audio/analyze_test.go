package audio

import (
	"math"
	"testing"
)

func TestComputeRMS_Silence(t *testing.T) {
	samples := make([]int16, 100) // all zeros
	rms := computeRMS(samples)
	if rms != 0 {
		t.Fatalf("silence RMS should be 0, got %f", rms)
	}
}

func TestComputeRMS_MaxAmplitude(t *testing.T) {
	// All samples at max int16 → RMS = MaxInt16 / MaxInt16 = 1.0.
	samples := make([]int16, 100)
	for i := range samples {
		samples[i] = math.MaxInt16
	}
	rms := computeRMS(samples)
	if math.Abs(rms-1.0) > 1e-10 {
		t.Fatalf("max amplitude RMS should be 1.0, got %f", rms)
	}
}

func TestComputeRMS_HalfAmplitude(t *testing.T) {
	// All samples at MaxInt16/2 → RMS = 0.5.
	samples := make([]int16, 100)
	for i := range samples {
		samples[i] = math.MaxInt16 / 2
	}
	rms := computeRMS(samples)
	if math.Abs(rms-0.5) > 1e-3 {
		t.Fatalf("half amplitude RMS should be ~0.5, got %f", rms)
	}
}

func TestComputeRMS_Empty(t *testing.T) {
	rms := computeRMS(nil)
	if rms != 0 {
		t.Fatalf("empty RMS should be 0, got %f", rms)
	}
}

func TestComputeSpectralCentroid_Silence(t *testing.T) {
	samples := make([]int16, 256)
	centroid := computeSpectralCentroid(samples, 24000)
	if centroid != 0 {
		t.Fatalf("silence centroid should be 0, got %f", centroid)
	}
}

func TestComputeSpectralCentroid_PureTone(t *testing.T) {
	// Generate a pure 1000 Hz tone at 24 kHz sample rate.
	sampleRate := 24000
	n := 1024
	samples := make([]int16, n)
	for i := range samples {
		samples[i] = int16(float64(math.MaxInt16/4) *
			math.Sin(2*math.Pi*1000*float64(i)/float64(sampleRate)))
	}

	centroid := computeSpectralCentroid(samples, sampleRate)

	// The centroid of a pure 1000 Hz tone should be approximately 1000 Hz.
	// Allow ±800 Hz tolerance: spectral leakage from rectangular windowing
	// and short DFT size biases the centroid upward. The orb only needs
	// an approximate warm/cool color-temperature, not precise frequency.
	if math.Abs(centroid-1000) > 800 {
		t.Fatalf("1000 Hz tone centroid should be ~1000 Hz, got %.1f Hz", centroid)
	}
}

func TestComputeSpectralCentroid_HighTone(t *testing.T) {
	// Generate a pure 5000 Hz tone at 24 kHz sample rate.
	sampleRate := 24000
	n := 1024
	samples := make([]int16, n)
	for i := range samples {
		samples[i] = int16(float64(math.MaxInt16/4) *
			math.Sin(2*math.Pi*5000*float64(i)/float64(sampleRate)))
	}

	centroid := computeSpectralCentroid(samples, sampleRate)

	// 5000 Hz tone centroid should be approximately 5000 Hz.
	// Allow ±1000 Hz tolerance for the same leakage reasons.
	if math.Abs(centroid-5000) > 1000 {
		t.Fatalf("5000 Hz tone centroid should be ~5000 Hz, got %.1f Hz", centroid)
	}
}

func TestAnalyzer_ZeroInput(t *testing.T) {
	a := NewAnalyzer(24000)
	features := a.Analyze(nil)
	if features.RMS != 0 || features.SpectralCentroid != 0 {
		t.Fatalf("zero input should give zero features, got %+v", features)
	}
}

func TestAnalyzer_Integration(t *testing.T) {
	a := NewAnalyzer(24000)

	// Generate a sine wave at 2000 Hz, moderate amplitude.
	n := 1024
	samples := make([]int16, n)
	for i := range samples {
		samples[i] = int16(float64(math.MaxInt16/2) *
			math.Sin(2*math.Pi*2000*float64(i)/24000))
	}

	features := a.Analyze(samples)

	// RMS should be ~0.707 (sinusoidal at half amplitude → sqrt(0.5²) = 0.3535...).
	// Actually for int16 sinusoid: RMS of sin wave at amplitude A is A/sqrt(2).
	// Amplitude = MaxInt16/2, so RMS = (MaxInt16/2)/sqrt(2) / MaxInt16 ≈ 0.3535.
	if features.RMS < 0.3 || features.RMS > 0.4 {
		t.Fatalf("2000 Hz tone RMS should be ~0.35, got %f", features.RMS)
	}

	// Spectral centroid should be near 2000 Hz (±800 Hz for leakage).
	if math.Abs(features.SpectralCentroid-2000) > 800 {
		t.Fatalf("2000 Hz tone centroid should be ~2000 Hz, got %.1f Hz",
			features.SpectralCentroid)
	}
}
