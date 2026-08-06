package session

import (
	"testing"
	"time"
)

func TestLifecycleStartToStarted(t *testing.T) {
	lc := NewLifecycle()
	if got := lc.Phase(); got != PhaseNone {
		t.Fatalf("new lifecycle phase = %v, want none", got)
	}
	lc.Start(time.Now())
	if got := lc.Phase(); got != PhaseStarted {
		t.Fatalf("after Start phase = %v, want started", got)
	}
	if lc.Turns() != 0 {
		t.Errorf("start should not count a turn, got %d", lc.Turns())
	}
}

func TestLifecycleMarkActiveCountsTurns(t *testing.T) {
	lc := NewLifecycle()
	now := time.Now()
	lc.Start(now)
	lc.MarkActive(now)
	lc.MarkActive(now.Add(2 * time.Second))
	if lc.Phase() != PhaseActive {
		t.Fatalf("active phase = %v", lc.Phase())
	}
	if lc.Turns() != 2 {
		t.Errorf("turns = %d, want 2", lc.Turns())
	}
}

func TestLifecyclePauseAfterSilence(t *testing.T) {
	lc := NewLifecycle()
	now := time.Now()
	lc.Start(now)
	lc.MarkActive(now)

	// A short silence (< 30s) keeps the session active.
	lc.Tick(now.Add(10*time.Second), 30*time.Second)
	if lc.Phase() != PhaseActive {
		t.Fatalf("silence <30s should stay active, got %v", lc.Phase())
	}

	// Long silence settles to Paused (AC-13.3).
	lc.Tick(now.Add(31*time.Second), 30*time.Second)
	if lc.Phase() != PhasePaused {
		t.Fatalf("silence >30s should pause, got %v", lc.Phase())
	}
}

func TestLifecycleTouchRevivesPaused(t *testing.T) {
	lc := NewLifecycle()
	now := time.Now()
	lc.Start(now)
	lc.MarkActive(now)
	lc.Tick(now.Add(40*time.Second), 30*time.Second)
	if lc.Phase() != PhasePaused {
		t.Fatalf("should be paused, got %v", lc.Phase())
	}

	lc.Touch(now.Add(41 * time.Second))
	if lc.Phase() != PhaseActive {
		t.Fatalf("Touch should revive to active, got %v", lc.Phase())
	}
	// Reviving is not itself a new turn.
	if lc.Turns() != 1 {
		t.Errorf("touch should not count a turn, got %d", lc.Turns())
	}
}

func TestLifecycleEndIdempotent(t *testing.T) {
	lc := NewLifecycle()
	now := time.Now()
	lc.Start(now)
	lc.End()
	lc.End() // idempotent
	if lc.Phase() != PhaseEnded {
		t.Fatalf("phase = %v, want ended", lc.Phase())
	}
	lc.EndCrash() // an ended session must not regress to crash
	if lc.Phase() != PhaseEnded {
		t.Fatalf("Ended should stick, got %v", lc.Phase())
	}
}

func TestLifecycleCrashTerminal(t *testing.T) {
	lc := NewLifecycle()
	lc.Start(time.Now())
	lc.EndCrash()
	if lc.Phase() != PhaseCrash {
		t.Fatalf("phase = %v, want crash", lc.Phase())
	}
	lc.End() // normal end after crash must not override
	if lc.Phase() != PhaseCrash {
		t.Fatalf("crash should be terminal, got %v", lc.Phase())
	}
}
