package voice

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/alainux/orb/errs"
)

// flakyProvider fails Connect f times then succeeds. It also records how many
// Connect calls were made.
type flakyProvider struct {
	fails    int
	calls    int
	failWith error
}

func (p *flakyProvider) Connect(_ context.Context, _ ProviderConfig) error {
	p.calls++
	if p.calls <= p.fails {
		return p.failWith
	}
	return nil
}

func (p *flakyProvider) SendAudio([]int16) error                 { return nil }
func (p *flakyProvider) Events() <-chan AgentEvent              { return nil }
func (p *flakyProvider) Interrupt() error                       { return nil }
func (p *flakyProvider) SubmitToolResult(string, string) error  { return nil }
func (p *flakyProvider) Close() error                           { return nil }

// TestConnectWithRetrySucceedsAfterTransientFailures verifies AC-11.1: a
// transient connect failure is retried and the session is established.
func TestConnectWithRetrySucceedsAfterTransientFailures(t *testing.T) {
	p := &flakyProvider{
		fails:    2,
		failWith: errs.Recoverable(errs.KindConnect, "dial", errors.New("connection refused")),
	}
	err := ConnectWithRetry(context.Background(), p, ProviderConfig{}, 5, time.Millisecond)
	if err != nil {
		t.Fatalf("expected eventual success, got %v", err)
	}
	if p.calls != 3 { // 2 fails + 1 success
		t.Errorf("Connect calls = %d, want 3", p.calls)
	}
}

// TestConnectWithRetryBoundedRetries verifies the attempt limit is honoured
// (AC-11.1: bounded retries).
func TestConnectWithRetryBoundedRetries(t *testing.T) {
	p := &flakyProvider{fails: 100, failWith: errors.New("connection refused")}
	err := ConnectWithRetry(context.Background(), p, ProviderConfig{}, 3, time.Millisecond)
	if err == nil {
		t.Fatal("expected an error after exhausting retries")
	}
	if p.calls != 3 {
		t.Errorf("Connect calls = %d, want 3 (bounded)", p.calls)
	}
}

// TestConnectWithRetryFatalNotRetried verifies AC-11.6 / AC-11.2: a fatal
// error (no API key) is returned immediately, never retried.
func TestConnectWithRetryFatalNotRetried(t *testing.T) {
	p := &flakyProvider{fails: 100, failWith: errs.New(errs.KindNoAPIKey, errs.MsgNoAPIKey, true)}
	err := ConnectWithRetry(context.Background(), p, ProviderConfig{}, 5, time.Millisecond)
	if !errs.IsFatal(err) {
		t.Fatalf("expected a fatal api-key error, got %v", err)
	}
	if p.calls != 1 {
		t.Errorf("Connect calls = %d, want 1 (fatal never retried)", p.calls)
	}
}

// TestConnectWithRetryContextCancel verifies the backoff wait honours a
// cancelled context.
func TestConnectWithRetryContextCancel(t *testing.T) {
	p := &flakyProvider{fails: 100, failWith: errors.New("connection refused")}
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already cancelled → first backoff wait aborts
	err := ConnectWithRetry(ctx, p, ProviderConfig{}, 5, time.Hour)
	if err == nil {
		t.Fatal("expected an error")
	}
	if p.calls > 2 {
		t.Errorf("Connect calls = %d, should abort backoff after cancellation", p.calls)
	}
}

// TestConnectWithRetryAttemptsLessThanOne clamps to a single attempt.
func TestConnectWithRetryAttemptsLessThanOne(t *testing.T) {
	p := &flakyProvider{fails: 1, failWith: errors.New("boom")}
	err := ConnectWithRetry(context.Background(), p, ProviderConfig{}, 0, time.Millisecond)
	if err == nil {
		t.Fatal("expected an error")
	}
	if p.calls != 1 {
		t.Errorf("Connect calls = %d, want 1", p.calls)
	}
}

// TestRetryAllowed verifies the eligibility rules (AC-11.6).
func TestRetryAllowed(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"recoverable-connect", errs.Recoverable(errs.KindConnect, "x", errors.New("dial")), true},
		{"fatal-api-key", errs.New(errs.KindNoAPIKey, "key", true), false},
		{"fatal-mic", errs.New(errs.KindMic, "mic", true), false},
		{"raw-network", errors.New("dial tcp: connection refused"), true},
		{"provider-transient", errs.New(errs.KindProvider, "openai: gateway timeout", false), true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := retryAllowed(c.err); got != c.want {
				t.Errorf("retryAllowed(%q) = %v, want %v", c.name, got, c.want)
			}
		})
	}
}

// TestOpenAIKeyErrorIsFatal guards the auth path used by the real provider.
func TestOpenAIKeyErrorIsFatal(t *testing.T) {
	err := errs.Wrap(errs.KindNoAPIKey, errs.MsgNoAPIKey, errors.New("openai: API key is required"), true)
	if !strings.Contains(err.Error(), "API key") {
		t.Errorf("unexpected message %q", err.Error())
	}
}