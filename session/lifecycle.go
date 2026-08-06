package session

import (
	"sync"
	"time"
)

// Phase is the current session lifecycle stage (R13 / AC-13.1..13.6).
type Phase int

const (
	// PhaseNone is the pre-start state.
	PhaseNone Phase = iota
	// PhaseStarted: reveal fired, idle orb, ready for voice (AC-13.1).
	PhaseStarted
	// PhaseActive: a conversational turn in progress (AC-13.2).
	PhaseActive
	// PhasePaused: 30s silence settle; orb idle, status "waiting…" (AC-13.3).
	PhasePaused
	// PhaseEnded: clean end after autosave + summary (AC-13.4).
	PhaseEnded
	// PhaseCrash: abnormal disconnect that triggered a crash snapshot (AC-11.5).
	PhaseCrash
)

func (p Phase) String() string {
	switch p {
	case PhaseNone:
		return "none"
	case PhaseStarted:
		return "started"
	case PhaseActive:
		return "active"
	case PhasePaused:
		return "waiting"
	case PhaseEnded:
		return "ended"
	case PhaseCrash:
		return "crash"
	default:
		return "unknown"
	}
}

// Lifecycle models the S-1 session state machine. Sessions are ephemeral
// (AC-13.6): an ended session is ended, with no resume. The controller is pure
// (no audio/provider) and unit-testable, so the UI phases its reveal, orb, and
// end behaviour from a single timeline.
type Lifecycle struct {
	mu           sync.Mutex
	phase        Phase
	turns        int
	lastActivity time.Time
}

// NewLifecycle returns a controller in PhaseNone.
func NewLifecycle() *Lifecycle { return &Lifecycle{} }

// Start begins the session and fires the reveal/idle (AC-13.1).
func (l *Lifecycle) Start(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.phase = PhaseStarted
	l.lastActivity = now
}

// MarkActive records the start of a new conversational turn (AC-13.2).
func (l *Lifecycle) MarkActive(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.turns++
	l.phase = PhaseActive
	l.lastActivity = now
}

// Touch records recent activity (a delta, barge-in, or turn end) without
// starting a new turn. It revives a paused session into active.
func (l *Lifecycle) Touch(now time.Time) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.lastActivity = now
	if l.phase == PhasePaused {
		l.phase = PhaseActive
	}
}

// Tick applies the idle-pause rule (AC-13.3): if active and silent for longer
// than pauseAfter, the session settles to PhasePaused ("waiting…").
func (l *Lifecycle) Tick(now time.Time, pauseAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.phase != PhaseActive {
		return
	}
	if now.Sub(l.lastActivity) >= pauseAfter {
		l.phase = PhasePaused
	}
}

// End marks a clean end (autosave + summary) (AC-13.4).
func (l *Lifecycle) End() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.phase == PhaseEnded || l.phase == PhaseCrash {
		return
	}
	l.phase = PhaseEnded
}

// EndCrash marks an abnormal end that writes a crash snapshot (AC-11.5). It is
// terminal: once ended/crashed, the session never regresses.
func (l *Lifecycle) EndCrash() {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.phase == PhaseEnded || l.phase == PhaseCrash {
		return
	}
	l.phase = PhaseCrash
}

// Phase returns the current lifecycle phase.
func (l *Lifecycle) Phase() Phase {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.phase
}

// Turns returns the number of conversational turns completed so far.
func (l *Lifecycle) Turns() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.turns
}
