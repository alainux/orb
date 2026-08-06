package audio

import (
	"errors"
	"testing"

	"github.com/alainux/orb/errs"
)

// TestClassifyStartErrPermissionIsFatal verifies a hard mic permission denial
// surfaces as the classified, fatal mic error (AC-11.3).
func TestClassifyStartErrPermissionIsFatal(t *testing.T) {
	e := classifyStartErr(errors.New("opening input device failed: permission denied"))
	if e == nil {
		t.Fatal("expected a classified error")
	}
	if e.Kind != errs.KindMic {
		t.Errorf("kind = %v, want mic", e.Kind)
	}
	if !errs.IsFatal(e) {
		t.Error("a hard permission denial should be fatal")
	}
	if errs.User(e) != errs.MsgMicDenied {
		t.Errorf("message = %q, want %q", errs.User(e), errs.MsgMicDenied)
	}
}

// TestClassifyStartErrBusyDegrades verifies a transient "busy" device error is
// classified as mic and is non-fatal, so the caller can degrade to text mode
// instead of exiting (AC-11.3).
func TestClassifyStartErrBusyDegrades(t *testing.T) {
	e := classifyStartErr(errors.New("audio device busy, try again"))
	if e == nil {
		t.Fatal("expected a classified error")
	}
	if e.Kind != errs.KindMic {
		t.Errorf("kind = %v, want mic", e.Kind)
	}
	if errs.IsFatal(e) {
		t.Error("a transient busy device should degrade, not exit")
	}
}

// TestClassifyStartErrUnknownNormalisesToMic verifies any unrecognised capture
// failure is still surfaced as a fatal mic/device error (AC-11.3) rather than
// a generic internal error.
func TestClassifyStartErrUnknownNormalisesToMic(t *testing.T) {
	e := classifyStartErr(errors.New("portaudio: unexpected internal mixer error 0x0a"))
	if e == nil {
		t.Fatal("expected a classified error")
	}
	if e.Kind != errs.KindMic {
		t.Errorf("kind = %v, want mic", e.Kind)
	}
}

// TestClassifyStartErrNil is a defensive check.
func TestClassifyStartErrNil(t *testing.T) {
	if e := classifyStartErr(nil); e != nil {
		t.Fatalf("classifyStartErr(nil) = %v, want nil", e)
	}
}