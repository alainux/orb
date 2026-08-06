package voice

import (
	"context"
	"time"

	"github.com/alainux/orb/errs"
)

// Default retry policy for a provider connection (spec R11 AC-11.1): at most
// 3 attempts with a 2s backoff between attempts. Only unambiguous, transient
// failures are retried (AC-11.6).
const (
	DefaultConnectAttempts = 3
	DefaultConnectBackoff  = 2 * time.Second
)

// ConnectWithRetry establishes a provider session with a bounded, safe retry
// loop (AC-11.1 / AC-11.6). It calls p.Connect up to attempts times, waiting
// backoff between attempts.
//
// Only unambiguous, transient failures are retried. A fatal error (auth / API
// key / mic permission) or an ambiguous failure is returned immediately, never
// retried. If every allowed attempt fails, the last error is returned.
//
// It also returns immediately if ctx is cancelled during a backoff wait
// (returning the attempt's error, not ctx.Err, so the caller sees a real
// connect result).
func ConnectWithRetry(ctx context.Context, p Provider, cfg ProviderConfig, attempts int, backoff time.Duration) error {
	if attempts < 1 {
		attempts = 1
	}
	var lastErr error
	for i := 0; i < attempts; i++ {
		lastErr = p.Connect(ctx, cfg)
		if lastErr == nil {
			return nil
		}
		if !retryAllowed(lastErr) {
			// Fatal / ambiguous — retrying would not help (AC-11.6). Return now.
			return lastErr
		}
		if i == attempts-1 {
			break
		}
		timer := time.NewTimer(backoff)
		select {
		case <-ctx.Done():
			timer.Stop()
			return lastErr
		case <-timer.C:
		}
	}
	return lastErr
}

// retryAllowed reports whether a connection failure may be retried. Per
// AC-11.1 / AC-11.6 only unambiguous, transient failures are retried:
//
//   - An error explicitly marked recoverable is always retried.
//   - Fatal errors (no API key, mic permission denied, config/input problems)
//     are never retried — they are deterministic and would fail again.
//   - Other errors (e.g. a raw dial/network failure that does not resolve to a
//     fatal classification) are treated as transient and retried.
func retryAllowed(err error) bool {
	if err == nil {
		return false
	}
	if errs.IsRecoverable(err) {
		return true
	}
	if errs.IsFatal(err) {
		return false
	}
	switch errs.KindOf(err) {
	case errs.KindNoAPIKey, errs.KindMic, errs.KindInput, errs.KindConfig:
		return false
	}
	return true
}