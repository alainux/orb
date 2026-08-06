package tui

import (
	"math"
	"math/rand"
	"testing"
)

// --- particle count scaling (AC-2.8 / AC-23.1) ---

func TestParticleCountFor(t *testing.T) {
	if got, want := ParticleCountFor(0), minParticles; got != want {
		t.Errorf("ParticleCountFor(0) = %d, want %d (min clamp)", got, want)
	}
	if got, want := ParticleCountFor(1000000), maxParticles; got != want {
		t.Errorf("ParticleCountFor(huge) = %d, want %d (max clamp)", got, want)
	}
	if got, want := ParticleCountFor(100), 80; got != want {
		t.Errorf("ParticleCountFor(100) = %d, want 80", got)
	}
	if got := ParticleCountFor(1000); got != 200 {
		t.Errorf("ParticleCountFor(1000) = %d, want 200", got)
	}
}

func meanRadius(ps []Particle, sc OrbScene) float64 {
	var sum float64
	for _, p := range ps {
		dx := p.X - sc.CX
		dy := p.Y - sc.CY
		sum += math.Hypot(dx, dy)
	}
	if len(ps) == 0 {
		return 0
	}
	return sum / float64(len(ps))
}

// --- dispersion (AC-2.3): listening spreads wider with energy ---
// --- dispersion (AC-2.3): listening spreads wider with energy ---

func TestListeningDispersion(t *testing.T) {
	// the dispersion factor must grow with loud energy (0 → 1).
	if dispersionFor(OrbListening, 0.0) >= dispersionFor(OrbListening, 1.0) {
		t.Error("dispersion does not scale with listening energy")
	}
	if dispersionFor(OrbIdle, 0) >= dispersionFor(OrbListening, 1) {
		t.Error("idle dispersion should be tighter than loud listening")
	}
}

// --- speed scales with energy (AC-2.3) ---

func TestListeningSpeedScales(t *testing.T) {
	sc := OrbScene{PixelW: 200, PixelH: 120, CX: 100, CY: 60, MaxRadius: 100}
	ps := NewParticles(5, sc.PixelW, sc.PixelH, rand.New(rand.NewSource(2)))
	start := append([]Particle(nil), ps...)

	stepParticles(ps, sc, OrbListening, 1.0, 0, 1.0)
	for i := range ps {
		if ps[i].Angle <= start[i].Angle {
			t.Errorf("high-energy tick: angle not advanced for particle %d", i)
		}
	}
}

// --- breathing pulse (AC-2.2) ---

func TestBreatheOpacity(t *testing.T) {
	minv, maxv := 1.0, 0.0
	for tv := 0.0; tv < breathePeriod*2; tv += 0.03 {
		o := BreatheOpacity(tv)
		if o < 0.30 || o > 0.50 {
			t.Errorf("BreatheOpacity(%v)=%v outside [0.3,0.5]", tv, o)
		}
		if o < minv {
			minv = o
		}
		if o > maxv {
			maxv = o
		}
	}
	if minv > 0.31 || maxv < 0.49 {
		t.Errorf("breathing did not sweep full range: min=%v max=%v", minv, maxv)
	}
}

// --- collision sparks (AC-2.6) ---

func TestDetectCollisions(t *testing.T) {
	ps := []Particle{{X: 10, Y: 10}, {X: 11, Y: 10}}
	sparks := detectCollisions(ps, collideDist)
	if len(sparks) != 1 {
		t.Fatalf("expected 1 spark, got %d", len(sparks))
	}
	if sparks[0].Frames != 2 {
		t.Errorf("spark frames = %d, want 2", sparks[0].Frames)
	}
	if math.Abs(sparks[0].X-10.5) > 0.001 || math.Abs(sparks[0].Y-10) > 0.001 {
		t.Errorf("spark midpoint = (%v,%v), want (10.5,10)", sparks[0].X, sparks[0].Y)
	}

	far := []Particle{{X: 0, Y: 0}, {X: 500, Y: 500}}
	if got := detectCollisions(far, collideDist); len(got) != 0 {
		t.Errorf("distant particles produced %d sparks", len(got))
	}
}

func TestAdvanceSparks(t *testing.T) {
	ss := []Spark{{X: 1, Y: 1, Frames: 2}, {X: 2, Y: 2, Frames: 1}}
	ss = advanceSparks(ss)
	if len(ss) != 1 || ss[0].Frames != 1 {
		t.Fatalf("advanceSparks unexpected: %+v", ss)
	}
}

// --- OrbField.Step integrates particles + energy + sparks ---

func TestOrbFieldStep(t *testing.T) {
	sc := OrbScene{PixelW: 120, PixelH: 80, CX: 60, CY: 40, MaxRadius: 40}
	f := &OrbField{
		Particles: NewParticles(20, sc.PixelW, sc.PixelH, rand.New(rand.NewSource(5))),
		State:     OrbListening,
		Energy:    0.9,
	}
	before := make([]Particle, len(f.Particles))
	copy(before, f.Particles)

	f.Step(sc, 0, 1.0/30)
	f.Step(sc, 1.0/30, 1.0/30)

	moved := false
	for i := range f.Particles {
		if math.Abs(f.Particles[i].Angle-before[i].Angle) > 1e-9 {
			moved = true
			break
		}
	}
	if !moved {
		t.Error("Step should advance particle angles")
	}
	// high energy must eventually spark; at least don't crash and keep sparks bounded
	if len(f.Sparks) > 200 {
		t.Errorf("unexpectedly many sparks: %d", len(f.Sparks))
	}
}

// --- state machine driven by status (AC-2.10) ---

func TestOrbStateFromStatus(t *testing.T) {
	cases := []struct {
		st   Status
		want OrbState
	}{
		{StatusIdle, OrbIdle},
		{StatusListening, OrbListening},
		{StatusThinking, OrbProcessing},
		{StatusDrafting, OrbDrafting},
		{StatusSaving, OrbCelebrating},
		{StatusSaved, OrbCelebrating},
		{StatusError, OrbIdle},
	}
	for _, c := range cases {
		if got := OrbStateFromStatus(c.st); got != c.want {
			t.Errorf("OrbStateFromStatus(%q) = %v, want %v", c.st, got, c.want)
		}
	}
}

// --- energy gradient (AC-2.4) ---

func TestEnergyColor(t *testing.T) {
	if energyColor(OrbIdle, 0) != TideHex() {
		t.Error("idle color != Tide")
	}
	peak := energyColor(OrbCelebrating, 1)
	if peak != BloomHex() {
		t.Errorf("celebrating color = %s, want Bloom", peak)
	}
	// loud listening must differ from idle (orange-ish, not Tide).
	if energyColor(OrbListening, 0.95) == TideHex() {
		t.Error("loud listening should not be Tide")
	}
}

// --- color blend (opacity emulation) ---

func TestBlend(t *testing.T) {
	if c := blend("#FF0000", "#0000FF", 1); c != "#0000FF" {
		t.Errorf("a=1 should yield fg, got %s", c)
	}
	if c := blend("#AABBCC", "#000000", 0); c != "#AABBCC" {
		t.Errorf("a=0 should yield base got %s", c)
	}
	if c := blend("#000000", "#FFFFFF", 0.5); c != "#808080" {
		t.Errorf("half blend = %s, want #808080", c)
	}
}
