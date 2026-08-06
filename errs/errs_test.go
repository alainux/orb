package errs

import (
	"errors"
	"strings"
	"testing"
)

func TestUserPrefersTypedMessage(t *testing.T) {
	under := errors.New("boom-inside")
	e := Wrap(KindMic, MsgMicDenied, under, true)
	if User(e) != MsgMicDenied {
		t.Errorf("User = %q, want %q", User(e), MsgMicDenied)
	}
	if User(under) != "boom-inside" {
		t.Errorf("User(raw) = %q, want the raw text", User(under))
	}
	if User(nil) != "" {
		t.Errorf("User(nil) should be empty")
	}
}

func TestUnwrapPropagatesCause(t *testing.T) {
	cause := errors.New("root")
	e := Wrap(KindAudio, "problem", cause, false)
	if !errors.Is(e, cause) {
		t.Error("errors.Is should find the wrapped cause")
	}
	var typed *Error
	if !errors.As(e, &typed) {
		t.Fatal("errors.As should recover the typed error")
	}
	if typed.Kind != KindAudio {
		t.Errorf("kind = %v, want audio", typed.Kind)
	}
}

func TestFatalAndRecoverable(t *testing.T) {
	f := New(KindNoAPIKey, MsgNoAPIKey, true)
	if !IsFatal(f) || IsRecoverable(f) {
		t.Error("expected fatal, non-recoverable")
	}
	r := Recoverable(KindConnect, MsgConnLost, errors.New("dial"))
	if IsFatal(r) || !IsRecoverable(r) {
		t.Error("expected recoverable, non-fatal")
	}
	if IsFatal(nil) || IsRecoverable(nil) {
		t.Error("nil is neither fatal nor recoverable")
	}
}

func TestClassifyMicPermission(t *testing.T) {
	e := Classify(errors.New("portaudio: opening input device failed: permission denied"))
	if e.Kind != KindMic {
		t.Fatalf("kind = %v, want mic", e.Kind)
	}
	if !IsFatal(e) {
		t.Error("a hard permission denial should be fatal")
	}
	if User(e) != MsgMicDenied {
		t.Errorf("message = %q, want %q", User(e), MsgMicDenied)
	}
}

func TestClassifyMicTransientIsNotFatal(t *testing.T) {
	e := Classify(errors.New("audio device busy, try again"))
	if e.Kind != KindMic {
		t.Fatalf("kind = %v, want mic", e.Kind)
	}
	if IsFatal(e) {
		t.Error("a transient 'busy' mic error should degrade, not exit")
	}
}

func TestClassifyConnLostRecoverable(t *testing.T) {
	e := Classify(errors.New("websocket: connection reset by peer"))
	if e.Kind != KindConnect {
		t.Fatalf("kind = %v, want connect", e.Kind)
	}
	if !IsRecoverable(e) {
		t.Error("an unambiguous connection reset should be recoverable")
	}
	if User(e) != MsgConnLost {
		t.Errorf("message = %q, want %q", User(e), MsgConnLost)
	}
}

func TestClassifyAPIKey(t *testing.T) {
	for _, m := range []string{"openai: API key is required", "client error: unauthorized 401"} {
		e := Classify(errors.New(m))
		if e.Kind != KindNoAPIKey {
			t.Errorf("for %q: kind = %v, want api-key", m, e.Kind)
		}
	}
}

func TestClassifyUnknownIsInternal(t *testing.T) {
	e := Classify(errors.New("x: panic in the dispatcher"))
	if e.Kind != KindInternal {
		t.Errorf("kind = %v, want internal", e.Kind)
	}
	if !IsFatal(e) {
		t.Error("an unexpected internal error should be fatal")
	}
}

func TestClassifyTypedPassthrough(t *testing.T) {
	orig := New(KindPipe, "pipe failed: exit 1", false)
	if got := Classify(orig); got != orig {
		t.Error("Classify should pass through an already-typed error")
	}
}

func TestClassifyNil(t *testing.T) {
	if Classify(nil) != nil {
		t.Error("Classify(nil) should be nil")
	}
}

func TestString(t *testing.T) {
	for k := KindNone; k <= KindInternal; k++ {
		if k.String() == "" {
			t.Errorf("kind %d has empty String", k)
		}
	}
	if !strings.EqualFold(KindNoAPIKey.String(), "api-key") {
		t.Errorf("unexpected String %q", KindNoAPIKey.String())
	}
}