package tui

import "math/rand"

// orbSeed keeps the particle field deterministic across renders (and runs),
// which the visual QA (simulation captures) and unit tests rely on.
const orbSeed = 7

// orbScene derives the authoritative geometry for the orb pane from the split
// layout, converting terminal cells into particle pixel space (2×4 per cell).
func (a *App) orbScene(layout Layout) OrbScene {
	return sceneFromLayout(layout.OrbW, layout.Height)
}

// beginOrb lazily seeds the particle field. The actual density is recomputed
// per-pane on the first frame (stepOrb).
func (a *App) beginOrb() {
	if a.orb != nil {
		return
	}
	sc := sceneFromLayout(40, 16)
	a.orb = &OrbField{
		Particles: NewParticles(
			ParticleCountFor(sc.CellsW*sc.CellsH),
			sc.PixelW,
			sc.PixelH,
			rand.New(rand.NewSource(orbSeed)),
		),
	}
}

// stepOrb advances the simulation one tick for the current layout: it (re)
// seeds the field when the pane area changes, syncs state/energy from the
// status word (AC-2.10) and RMS energy, then steps particles + sparks.
func (a *App) stepOrb(layout Layout) {
	if a.orb == nil {
		a.beginOrb()
	}
	sc := a.orbScene(layout)

	need := ParticleCountFor(sc.CellsW * sc.CellsH)
	if len(a.orb.Particles) != need {
		a.orb.Particles = NewParticles(need, sc.PixelW, sc.PixelH, rand.New(rand.NewSource(orbSeed)))
	}

	a.orb.State = OrbStateFromStatus(a.status)
	a.orb.Energy = a.energy

	dt := a.frameDT
	if dt <= 0 {
		dt = 1.0 / 30
	}
	if dt > 0.1 {
		dt = 0.1 // clamp huge first-frame jumps
	}
	a.orb.Step(sc, a.sceneTime, dt)
	a.sceneTime += dt
}
