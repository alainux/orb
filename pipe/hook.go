// Package pipe implements the scripting hook (P-1/P-2): on save, orb
// serialises the artifact payload to JSON and writes it to the stdin of a
// user-configured command (DEC-5).
//
// Security boundary (INC-4 / AC-6 / AC-12.3): orb only writes bytes to a
// child process's stdin. The payload is never surfaced on a command line and
// never interpreted as code by orb — the pipeline is one-way and the command
// itself is explicitly configured by the user via --pipe or orb.pipe_command.
// There is no `sh -c "$payload"` anywhere in this package.
//
// Concurrency (AC-7.4): a single worker runs at most one command at a time. A
// bounded queue of depth 1 holds the latest pending payload; further saves
// replace (never pile up) the queued item so memory can't grow unbounded.
//
// Spec references: R7 (AC-7.1..7.6), R12 (AC-12.2), R11 (AC-11.4).
package pipe

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"
)

// SessionMeta captures session-level counters included in the hook payload
// (DEC-5 / AC-7.2).
type SessionMeta struct {
	Words    int     `json:"words"`
	Turns    int     `json:"turns"`
	Duration float64 `json:"duration_s"`
}

// Payload is the JSON object piped to the external command on save (AC-7.2 /
// DEC-5). Shape is stable and documented:
//
//	{"artifact": "<full text>", "direction": "<optional voice command>", "session": {"words": N, "turns": N, "duration_s": N}}
type Payload struct {
	Artifact  string      `json:"artifact"`
	Direction string      `json:"direction"`
	Session   SessionMeta `json:"session"`
}

// Result reports the outcome of one pipe dispatch (exit-code + raw error).
type Result struct {
	// Command is the configured pipe command that was invoked.
	Command string
	// ExitCode is the command's exit status, or -1 when it could not start.
	ExitCode int
	// Err is non-nil when the command failed (non-zero exit or start failure).
	Err error
}

// ExitMessage renders the user-facing footer/error string for a failed pipe.
// Non-zero exit → "pipe failed: exit N" (AC-7.5); start failure (binary
// missing) → a descriptive "pipe failed: <reason>". Returns "" on success.
func (r Result) ExitMessage() string {
	if r.Err == nil {
		return ""
	}
	if r.ExitCode > 0 {
		return fmt.Sprintf("pipe failed: exit %d", r.ExitCode)
	}
	if r.ExitCode == -1 {
		return fmt.Sprintf("%v", r.Err)
	}
	return "pipe failed: " + r.Err.Error()
}

// Hook dispatches the artifact payload to a child process on save. It is safe
// for concurrent use but is designed to be owned by a single App.
type Hook struct {
	command  string
	timeout  time.Duration
	onResult func(Result)

	queue   chan Payload
	mu      sync.Mutex
	closed  bool
	wg      sync.WaitGroup
	dropped uint64 // count of coalesced (dropped) queued payload, for tests
}

// New builds a Hook for the given command and result callback. When command
// is empty the hook is inert (New still returns a usable, no-op hook).
// onResult is invoked on the worker goroutine and may be nil.
func New(command string, onResult func(Result)) *Hook {
	return &Hook{
		command:  strings.TrimSpace(command),
		onResult: onResult,
		timeout:  60 * time.Second,
	}
}

// Start launches the single worker goroutine. It is idempotent.
func (h *Hook) Start() {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.queue != nil {
		return
	}
	// depth 1: at most one item sits waiting behind the running command.
	h.queue = make(chan Payload, 1)
	h.wg.Add(1)
	go h.worker()
}

// Dispatch enqueues a payload for the single worker. It never blocks the
// caller: when a command is already running and the queue is full, the fresh
// payload replaces the queued stale one (coalescing to depth 1, AC-7.4). After
// Stop it is a no-op.
func (h *Hook) Dispatch(p Payload) {
	h.mu.Lock()
	if h.closed || h.command == "" || h.queue == nil {
		h.mu.Unlock()
		return
	}
	q := h.queue
	h.mu.Unlock()

	// Drop-oldest coalescing: loop so the newest payload always wins a slot
	// even if the worker drains the dropped item concurrently.
	for {
		select {
		case q <- p:
			return
		default:
			select {
			case <-q:
				h.mu.Lock()
				h.dropped++
				h.mu.Unlock()
			default:
				// Worker is about to consume; retry the send.
			}
		}
	}
}

// Dropped returns how many payload were coalesced/dropped (test/diagnostics).
func (h *Hook) Dropped() uint64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.dropped
}

// worker runs a single command at a time, draining the queue until it is
// closed (Stop).
func (h *Hook) worker() {
	defer h.wg.Done()
	for {
		p, ok := <-h.queue
		if !ok {
			return
		}
		res := h.execute(p)
		if h.onResult != nil {
			h.onResult(res)
		}
	}
}

// execute runs one command, feeding the JSON payload on stdin (AC-7.2). The
// command is invoked directly (no shell) so the payload can never be
// interpolated/executed (AC-6.6 / AC-12.2).
func (h *Hook) execute(p Payload) Result {
	res := Result{Command: h.command, ExitCode: 0}

	data, err := json.Marshal(p)
	if err != nil {
		res.Err = fmt.Errorf("payload marshall failure: %w", err)
		return res
	}

	args := strings.Fields(h.command)
	if len(args) == 0 {
		res.ExitCode = -1
		res.Err = fmt.Errorf("pipe command is empty")
		return res
	}

	ctx := context.Background()
	if h.timeout > 0 {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, h.timeout)
		defer cancel()
	}

	cmd := exec.CommandContext(ctx, args[0], args[1:]...)
	var out bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &out
	cmd.Stdin = bytes.NewReader(data)

	if err := cmd.Run(); err != nil {
		var ee *exec.ExitError
		var notFound *exec.Error
		switch {
		case errors.As(err, &ee):
			res.ExitCode = ee.ExitCode()
			res.Err = fmt.Errorf("pipe command %q exited with %d: %s",
				h.command, res.ExitCode, strings.TrimSpace(out.String()))
		case errors.As(err, &notFound):
			res.ExitCode = -1
			res.Err = notFound.Err
		case ctx.Err() != nil:
			res.ExitCode = -1
			res.Err = fmt.Errorf("pipe command %q timed out after %s: %s",
				h.command, h.timeout, strings.TrimSpace(out.String()))
		default:
			res.ExitCode = -1
			res.Err = fmt.Errorf("pipe command %q failed: %w: %s",
				h.command, err, strings.TrimSpace(out.String()))
		}
	}
	return res
}

// Stop prevents new dispatches, drains whatever is still queued, lets the
// active command finish, and waits for the worker to exit. It is safe to call
// more than once.
func (h *Hook) Stop() {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return
	}
	h.closed = true
	q := h.queue
	h.mu.Unlock()
	if q != nil {
		close(q)
	}
	h.wg.Wait()
}
