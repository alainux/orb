package audio

import "math"

// Analyzer computes audio features from raw PCM int16 frames.
// Intended to be called at 30 FPS from the animation sampler.
type Analyzer struct {
	sampleRate int
}

// NewAnalyzer creates an analyzer for the given sample rate.
func NewAnalyzer(sampleRate int) *Analyzer {
	return &Analyzer{sampleRate: sampleRate}
}

// AudioFeatures holds the computed features for a single analysis frame.
type AudioFeatures struct {
	// RMS is the root-mean-square amplitude normalized to [0.0, 1.0].
	// 0.0 = silence, 1.0 = maximum int16 amplitude.
	RMS float64

	// SpectralCentroid is the weighted mean frequency in Hz.
	// Higher values indicate brighter/higher-pitched sounds;
	// lower values indicate warmer/low-frequency sounds.
	SpectralCentroid float64
}

// Analyze computes RMS amplitude and spectral centroid from PCM int16 samples.
// Returns zero features for nil or empty input.
func (a *Analyzer) Analyze(samples []int16) AudioFeatures {
	if len(samples) == 0 {
		return AudioFeatures{}
	}

	rms := computeRMS(samples)
	centroid := computeSpectralCentroid(samples, a.sampleRate)

	return AudioFeatures{
		RMS:              rms,
		SpectralCentroid: centroid,
	}
}

// computeRMS returns the root-mean-square amplitude normalized to [0,1].
func computeRMS(samples []int16) float64 {
	if len(samples) == 0 {
		return 0
	}
	var sum float64
	for _, s := range samples {
		v := float64(s)
		sum += v * v
	}
	rms := math.Sqrt(sum / float64(len(samples)))
	// Normalize to [0, 1] against max int16 amplitude.
	return math.Min(rms/float64(math.MaxInt16), 1.0)
}

// computeSpectralCentroid computes the weighted mean frequency using a
// simple DFT on the input. Accuracy is intentionally coarse — the orb
// only needs a warm/cool color-temperature approximation (spec R2 AC-2.4),
// not high-fidelity spectral analysis.
func computeSpectralCentroid(samples []int16, sampleRate int) float64 {
	n := len(samples)
	if n == 0 || sampleRate == 0 {
		return 0
	}

	// Limit DFT size to 1024 for performance (sample at 30 FPS, keep
	// each frame under 1 ms of CPU). This covers ~42ms of 24kHz audio.
	dftSize := n
	if dftSize > 1024 {
		dftSize = 1024
	}

	// Compute magnitudes for bins 1..N/2 (skip DC at bin 0).
	var weightedSum float64
	var magnitudeSum float64
	halfN := dftSize / 2
	binFreqStep := float64(sampleRate) / float64(dftSize)

	for k := 1; k <= halfN; k++ {
		// DFT bin k: real and imaginary parts.
		var re, im float64
		angleStep := 2 * math.Pi * float64(k) / float64(dftSize)
		for i := 0; i < dftSize; i++ {
			angle := angleStep * float64(i)
			v := float64(samples[i])
			re += v * math.Cos(angle)
			im -= v * math.Sin(angle)
		}
		mag := math.Sqrt(re*re + im*im)
		freq := float64(k) * binFreqStep
		weightedSum += freq * mag
		magnitudeSum += mag
	}

	if magnitudeSum == 0 {
		return 0
	}
	return weightedSum / magnitudeSum
}
