package tui

import (
	"math"
	"math/rand"
)

// OrbState is the living-state machine that drives particle behaviour
// (AC-2.10): idle → listening → processing → drafting → celebrating.
type OrbState int

const (
	OrbIdle OrbState = iota
	OrbListening
	OrbProcessing
	OrbDrafting
	OrbCelebrating
)

func (s OrbState) String() string {
	switch s {
	case OrbListening:
		return "listening"
	case OrbProcessing:
		return "processing"
	case OrbDrafting:
		return "drafting"
	case OrbCelebrating:
		return "celebrating"
	default:
		return "idle"
	}
}

// OrbStateFromStatus drives the state machine from the App's status word
// (AC-2.10: the orb follows the session's lifecycle).
func OrbStateFromStatus(s Status) OrbState {
	switch s {
	case StatusListening:
		return OrbListening
	case StatusThinking:
		return OrbProcessing
	case StatusDrafting:
		return OrbDrafting
	case StatusSaving, StatusSaved:
		return OrbCelebrating
	default: // idle, error
		return OrbIdle
	}
}

// Particle is one element of the orbit constellation. Coordinates are in
// "pixels" where each terminal cell is 2 wide × 4 tall (Braille shape).
type Particle struct {
	X, Y   float64 // current position (pixels)
	Angle  float64 // orbit angle (radians)
	Speed  float64 // base angular speed (rad/s)
	BaseR  float64 // target radius as a fraction of the max pane radius [0,1]
	Phase  float64 // per-particle noise/breathing phase offset
	Bright float64 // intrinsic brightness [0.4,1.0] — size/energy variance
}

// Spark is a transient collision flicker lit for a short number of frames
// (AC-2.6).
type Spark struct {
	X, Y   float64
	Frames int
}

// ParticleCountFor sizes the field to the pane area at a fixed density
// (AC-23.1: pane_area_cells × 0.8, clamped to [40, 200]).
func ParticleCountFor(cells int) int {
	if cells < 1 {
		return minParticles
	}
	n := float64(cells) * particlesPerCell
	if n < minParticles {
		return minParticles
	}
	if n > maxParticles {
		return maxParticles
	}
	return int(math.Round(n))
}

const (
	particlesPerCell = 0.8 // density (AC-2.8 / AC-23.1)
	minParticles     = 40
	maxParticles     = 200
	// Braille cell is 2 pixels wide, 4 pixels tall (AC-18.1).
	cellW = 2
	cellH = 4
	// collision threshold in pixels (AC-2.6).
	collideDist = 4.0
	// loud-energy threshold above which collisions spark (AC-2.6).
	collisionEnergy = 0.5
	// bubble / breathing period (AC-2.2: 3s).
	breathePeriod = 3.0
)

// NewParticles builds a field seeded for reproducible tests. Positions are
// spread across the pane so early frames are already populated.
func NewParticles(count, pw, ph int, rng *rand.Rand) []Particle {
	ps := make([]Particle, 0, count)
	for i := 0; i < count; i++ {
		ps = append(ps, Particle{
			X:     randIn(rng, 0, float64(pw)),
			Y:     randIn(rng, 0, float64(ph)),
			Angle: randIn(rng, 0, 2*math.Pi),
			Speed: 0.4 + rng.Float64()*0.8,
			BaseR: 0.08 + rng.Float64()*0.82,
			Phase: randIn(rng, 0, 2*math.Pi),
		})
	}
	return ps
}

func randIn(r *rand.Rand, lo, hi float64) float64 { return lo + r.Float64()*(hi-lo) }

// clamp01 bounds v to [0,1].
func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

// BreatheOpacity is the idle breathing pulse: a 3s sine sweeping opacity
// between 30% and 50% (AC-2.2).
func BreatheOpacity(t float64) float64 {
	return 0.30 + 0.20*(1+math.Sin(2*math.Pi*t/breathePeriod))/2
}

// breatheScale is the idle constellation scale pulse (DESIGN §4, 0.95..1.05).
func breatheScale(t float64) float64 {
	return 0.95 + 0.10*(1+math.Sin(2*math.Pi*t/breathePeriod))/2
}

// dispersionFor returns the radial-spread multiplier for a state/energy.
// Listening spreads with RMS amplitude; other states hold a characteristic
// radius (AC-2.3).
func dispersionFor(state OrbState, energy float64) float64 {
	switch state {
	case OrbIdle:
		return 0.45 // tight, calm
	case OrbListening:
		return 0.4 + 0.6*clamp01(energy) // louder ⇒ wider (AC-2.3)
	case OrbProcessing:
		return 0.60
	case OrbDrafting:
		return 0.72
	case OrbCelebrating:
		return 0.90 // celebratory burst
	default:
		return 0.5
	}
}

// speedFor returns the orbit-speed multiplier. Listening ramps with energy so
// louder speech spins the constellation faster (AC-2.3).
func speedFor(state OrbState, energy float64) float64 {
	switch state {
	case OrbIdle:
		return 0.45
	case OrbListening:
		return 0.4 + 1.6*clamp01(energy)
	case OrbProcessing:
		return 1.05
	case OrbDrafting:
		return 0.75
	case OrbCelebrating:
		return 1.4
	default:
		return 0.5
	}
}

// OrbField owns the particle constellation + transient sparks and steps it
// forward one tick.
type OrbField struct {
	Particles []Particle
	Sparks    []Spark
	State     OrbState
	Energy    float64
}

// OrbScene is the pure geometry describing a pane being rendered; passed to
// step/render so the math is terminal-size independent and unit-testable.
type OrbScene struct {
	PixelW, PixelH int     // pane in pixels (cells * 2/4)
	CellsW, CellsH int     // pane in terminal cells
	CX, CY         float64 // centre (pixels)
	MaxRadius      float64
}

// sceneFromLayout derives an OrbScene for an orb pane of w×h cells.
func sceneFromLayout(w, h int) OrbScene {
	pw, ph := w*cellW, h*cellH
	return OrbScene{
		PixelW:    pw,
		PixelH:    ph,
		CellsW:    w,
		CellsH:    h,
		CX:        float64(pw) / 2,
		CY:        float64(ph) / 2,
		MaxRadius: float64(min(pw, ph)) / 2,
	}
}

// stepParticles advances all particles by dt seconds around the scene centre,
// honouring the state machine and RMS energy. It mutates and returns ps for
// convenient chaining.
func stepParticles(ps []Particle, sc OrbScene, state OrbState, energy, t, dt float64) []Particle {
	disp := dispersionFor(state, energy)
	spd := speedFor(state, energy)
	var breathe float64 = 1
	if state == OrbIdle {
		breathe = breatheScale(t)
	}
	for i := range ps {
		p := &ps[i]
		p.Angle += p.Speed * spd * dt

		// radius = base ∘ dispersion ∘ breathing ∘ slow per-particle wobble.
		r := sc.MaxRadius * p.BaseR * disp * breathe
		r *= 1 + 0.06*math.Sin(t*0.5+p.Phase)

		sx := 1.5 * math.Sin(t*1.3+p.Phase) // gentle chaotic drift
		sy := 1.5 * math.Cos(t*1.1+p.Phase)
		x := math.Cos(p.Angle)*r + p.X/16 + sx
		y := math.Sin(p.Angle)*r*0.62 + p.Y/20 + sy

		// keep within the pane, softly.
		p.X = clampf(x, 1, float64(sc.PixelW)-1)
		p.Y = clampf(y, 1, float64(sc.PixelH)-1)
	}
	return ps
}

func clampf(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// detectCollisions finds particle pairs within threshold px and returns a
// blink spark at their midpoint (AC-2.6). Only meaningful when energy is high.
func detectCollisions(ps []Particle, threshold float64) []Spark {
	var out []Spark
	t2 := threshold * threshold
	for i := 0; i < len(ps)-1; i++ {
		for j := i + 1; j < len(ps); j++ {
			dx := ps[i].X - ps[j].X
			dy := ps[i].Y - ps[j].Y
			if dx*dx+dy*dy < t2 {
				out = append(out, Spark{
					X:      (ps[i].X + ps[j].X) / 2,
					Y:      (ps[i].Y + ps[j].Y) / 2,
					Frames: 2,
				})
			}
		}
	}
	return out
}

// advanceSparks decays spark lifetimes by one frame, dropping expired ones.
func advanceSparks(ss []Spark) []Spark {
	out := ss[:0]
	for _, st := range ss {
		if st.Frames > 1 {
			st.Frames--
			out = append(out, st)
		}
	}
	return out
}

// OrbField.Step runs one simulation tick: advance particles, spawn/decay
// sparks, and remember state/energy for the renderer.
func (f *OrbField) Step(sc OrbScene, t, dt float64) {
	f.Particles = stepParticles(f.Particles, sc, f.State, f.Energy, t, dt)

	if f.State == OrbListening && f.Energy >= collisionEnergy {
		f.Sparks = append(f.Sparks, detectCollisions(f.Particles, collideDist)...)
	}
	f.Sparks = advanceSparks(f.Sparks)
}
