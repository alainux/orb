// Package errs provides orb's structured error model (E-1). Errors are
// classified by a stable Kind so the CLI, TUI, and session code can react to
// *type* rather than string matching, while still carrying a safe, human-
// readable message and an optional wrapped cause. Lifecycle flags (Fatal,
// Recoverable) tell the caller whether to exit, report, or retry.
//
// Spec references: R11 (AC-11.1..11.6), R12 (security), R15 (AC-15.2).
package errs

import (
	"errors"
	"fmt"
	"strings"
)

// Kind classifies an error.
type Kind int

const (
	// KindNone is the default (unclassified) kind.
	KindNone Kind = iota
	// KindConfig is a configuration validation problem.
	KindConfig
	// KindNoAPIKey is a missing/invalid provider API key (AC-11.2 / AC-15.2).
	KindNoAPIKey
	// KindInput is bad CLI input (bad context path / format).
	KindInput
	// KindMic is a microphone access problem (AC-11.3).
	KindMic
	// KindAudio is a general audio subsystem failure.
	KindAudio
	// KindProvider is a provider / protocol / auth failure.
	KindProvider
	// KindConnect is a transient connection failure (AC-11.1).
	KindConnect
	// KindPipe is a scripting-hook failure (AC-11.4 / AC-7.5).
	KindPipe
	// KindTerminal is a terminal / TUI failure.
	KindTerminal
	// KindInternal is an unexpected internal error.
	KindInternal
)

// String returns a short stable label for the kind.
func (k Kind) String() string {
	switch k {
	case KindConfig:
		return "config"
	case KindNoAPIKey:
		return "api-key"
	case KindInput:
		return "input"
	case KindMic:
		return "mic"
	case KindAudio:
		return "audio"
	case KindProvider:
		return "provider"
	case KindConnect:
		return "connect"
	case KindPipe:
		return "pipe"
	case KindTerminal:
		return "terminal"
	case KindInternal:
		return "internal"
	default:
		return "unknown"
	}
}

// Error is a classified, user-comprehensible error.
type Error struct {
	// Kind is the category used for programmatic decisions.
	Kind Kind
	// Message is a safe, user-facing message (may be empty to fall back to
	// Cause.Error()).
	Message string
	// Cause is the underlying error, when one exists.
	Cause error
	// Fatal indicates the process should exit after surfacing (e.g. no API
	// key, mic permission denied). False for recoverable/transient failures.
	Fatal bool
	// Recoverable indicates a transient, unambiguous failure eligible for a
	// bounded retry (AC-11.1). Ambiguous failures are NEVER recoverable (AC-11.6).
	Recoverable bool
}

// Error implements the error interface.
func (e *Error) Error() string {
	if e.Message != "" {
		return e.Message
	}
	if e.Cause != nil {
		return e.Cause.Error()
	}
	return "an error occurred"
}

// Unwrap exposes the cause for errors.Is/As traversal.
func (e *Error) Unwrap() error { return e.Cause }

// New builds a classified error with a literal message and no cause.
func New(kind Kind, message string, fatal bool) *Error {
	return &Error{Kind: kind, Message: message, Fatal: fatal}
}

// Errorf builds a classified, formatted error (no cause).
func Errorf(kind Kind, fatal bool, format string, a ...any) *Error {
	return &Error{Kind: kind, Message: fmt.Sprintf(format, a...), Fatal: fatal}
}

// Wrap classifies a raw error, wrapping it as the cause.
func Wrap(kind Kind, message string, cause error, fatal bool) *Error {
	return &Error{Kind: kind, Message: message, Cause: cause, Fatal: fatal}
}

// Recoverable builds a typed error eligible for a bounded retry (AC-11.1).
// Callers pass this ONLY for unambiguous, transient failures — ambiguous
// surfaces must remain non-recoverable (AC-11.6).
func Recoverable(kind Kind, message string, cause error) *Error {
	return &Error{Kind: kind, Message: message, Cause: cause, Recoverable: true}
}

// User returns the user-facing message for err. For a typed Error the explicit
// Message wins; otherwise err.Error() is used. A nil error yields "".
func User(err error) string {
	if err == nil {
		return ""
	}
	var e *Error
	if errors.As(err, &e) && e.Message != "" {
		return e.Message
	}
	return err.Error()
}

// KindOf returns the classification of err (KindNone for non-typed errors).
func KindOf(err error) Kind {
	var e *Error
	if errors.As(err, &e) {
		return e.Kind
	}
	return KindNone
}

// IsKind reports whether err is classified as the given kind.
func IsKind(err error, kind Kind) bool { return KindOf(err) == kind }

// IsFatal reports whether err is a typed error that requires process exit.
func IsFatal(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.Fatal
}

// IsRecoverable reports whether err is a typed error eligible for a bounded
// retry (true only for unambiguous transient failures, AC-11.1 / AC-11.6).
func IsRecoverable(err error) bool {
	var e *Error
	return errors.As(err, &e) && e.Recoverable
}

// Well-known user-facing messages (kept greppable for tests).
const (
	MsgNoAPIKey    = "No API key found. Set OPENAI_API_KEY or orb.api_key in config."
	MsgMicDenied   = "Microphone access denied. Check OS permissions."
	MsgConnLost    = "Connection lost — retrying…"
	MsgAuthFailed  = "Provider rejected the API key. Check OPENAI_API_KEY or orb.api_key."
	MsgDegradedMic = "Microphone unavailable — running in text mode without voice input."
)

// norm lowercases and trims the error's message for pattern matching.
func norm(err error) string { return strings.ToLower(err.Error()) }

// contains reports whether err's normalized message includes any needle.
func containsErr(err error, needles ...string) bool {
	s := norm(err)
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}

// Classify maps an arbitrary raw error into a classified *Error via text
// heuristics. It is a fallback for errors not created with this package (e.g.
// wrapped library errors). For a non-nil input it always returns non-nil.
func Classify(err error) *Error {
	if err == nil {
		return nil
	}
	var e *Error
	if errors.As(err, &e) {
		return e
	}

	switch {
	// Transient OS/device condition (e.g. "device busy, try again"): degrade
	// to a text-only mode rather than exit (AC-11.3 recovery path).
	case containsErr(err, "busy", "in use", "try again", "temporarily unavailable"):
		return Wrap(KindMic, MsgMicDenied, err, false)
	// Provider rejected the key (AC-11.2 / AC-15.2).
	case containsErr(err, "api key", "invalid key", "unauthorized", "401",
		"authentication", "forbidden", "403"):
		return Wrap(KindNoAPIKey, MsgAuthFailed, err, true)
	// Mic permission / device failure (AC-11.3). A hard denial is fatal.
	case containsErr(err, "permission", "permission denied", "denied",
		"microphone", "mic", "audio input", "access refused", "no input device",
		"capture"):
		return Wrap(KindMic, MsgMicDenied, err, true)
	// Transient connectivity (AC-11.1); recoverable only when unambiguous.
	case containsErr(err, "connection", "dial", "timeout", "reset",
		"connection refused", "websocket", "i/o timeout", "network"):
		return Recoverable(KindConnect, MsgConnLost, err)
	// Config / input problems (fatal).
	case containsErr(err, "invalid config", "unsupported", "not supported"):
		return Wrap(KindInput, err.Error(), err, true)
	// Provider-generic (non-fatal → degrade rather than exit).
	case containsErr(err, "openai", "provider", "api error", "gateway"):
		return Wrap(KindProvider, err.Error(), err, false)
	}

	return Wrap(KindInternal, err.Error(), err, true)
}
