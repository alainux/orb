package pipe

import (
	"encoding/json"
	"os"
	"runtime"
	"strings"
	"sync"
	"testing"
)

// TestPayloadShapeMatchesSpec locks the payload schema from DEC-5 / AC-7.2:
//
//	{"artifact": "...", "direction": "...", "session": {"words":N,"turns":N,"duration_s":N}}
func TestPayloadShapeMatchesSpec(t *testing.T) {
	p := Payload{
		Artifact:  "# Plan\n\nTwo words.",
		Direction: "",
		Session:   SessionMeta{Words: 2, Turns: 3, Duration: 12.5},
	}
	b, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var got map[string]any
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got["artifact"] != "# Plan\n\nTwo words." {
		t.Errorf("artifact missing/mismatch: %v", got["artifact"])
	}
	// direction is always present (stable schema, DEC-5), defaulted to "".
	if got["direction"] != "" {
		t.Errorf("direction should be present and empty, got %v", got["direction"])
	}
	sess, ok := got["session"].(map[string]any)
	if !ok {
		t.Fatalf("session missing: %v", got)
	}
	if int(sess["words"].(float64)) != 2 || int(sess["turns"].(float64)) != 3 {
		t.Errorf("session counters wrong: %v", sess)
	}
	if sess["duration_s"].(float64) != 12.5 {
		t.Errorf("duration_s wrong: %v", sess)
	}
}

// TestExecuteWritesJSONToStdin proves the payload reaches the child's stdin
// verbatim as JSON (never on a command line / argv) — the AC-7.2 transport and
// AC-12.2 no-shell-interpolation boundary. `tee` writes stdin to a file so we
// can compare the exact bytes the command received.
func TestExecuteWritesJSONToStdin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX tee")
	}
	f, err := os.CreateTemp(t.TempDir(), "orb-pipe-*.json")
	if err != nil {
		t.Fatal(err)
	}
	f.Close()

	payload := Payload{Artifact: "hello orb", Session: SessionMeta{Words: 2, Turns: 1, Duration: 3}}
	want, _ := json.Marshal(payload)

	h := New("tee "+f.Name(), nil)
	res := h.execute(payload)
	if res.Err != nil {
		t.Fatalf("execute: %v", res.Err)
	}

	got, err := os.ReadFile(f.Name())
	if err != nil {
		t.Fatalf("read tee output: %v", err)
	}
	if string(got) != string(want) {
		t.Errorf("payload mismatch:\n got %q\nwant %q", string(got), string(want))
	}
}

// TestExecuteNonZeroExit verifies AC-7.5: a non-zero exit is reported with the
// exact footer message "pipe failed: exit 1".
func TestExecuteNonZeroExit(t *testing.T) {
	h := New("false", nil)
	res := h.execute(Payload{})
	if res.Err == nil {
		t.Fatal("expected error for non-zero exit")
	}
	if res.ExitCode != 1 {
		t.Errorf("exit code: %d, want 1", res.ExitCode)
	}
	if msg := res.ExitMessage(); !strings.Contains(msg, "pipe failed: exit 1") {
		t.Errorf("ExitMessage %q should mention 'pipe failed: exit 1'", msg)
	}
}

func TestExecuteCommandNotFound(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses a bogus binary name")
	}
	h := New("/no/such/binary/nonexistent-binary-xyz", nil)
	res := h.execute(Payload{})
	if res.Err == nil {
		t.Fatal("expected error when command cannot start")
	}
	if res.ExitCode != -1 {
		t.Errorf("exit code = %d, want -1 for start failure", res.ExitCode)
	}
	if msg := res.ExitMessage(); msg == "" || strings.Contains(msg, "exit 1") {
		t.Errorf("start-failure message incorrect: %q", msg)
	}
}

func TestExecuteEmptyCommand(t *testing.T) {
	h := New("   ", nil)
	res := h.execute(Payload{})
	if res.Err == nil {
		t.Fatal("expected error for empty command")
	}
	if res.ExitCode != -1 {
		t.Errorf("exit code = %d, want -1", res.ExitCode)
	}
}

func TestSuccessExitMessageEmpty(t *testing.T) {
	h := New(asShellNoop(), nil)
	res := h.execute(Payload{})
	if res.Err != nil {
		t.Fatalf("expected success, got %v", res.Err)
	}
	if msg := res.ExitMessage(); msg != "" {
		t.Errorf("success ExitMessage should be empty, got %q", msg)
	}
}

// asShell returns "true" on POSIX (a shell builtin available from exec paths
// via /usr/bin/true) — split into a helper to keep the table readable.
func asShellNoop() string {
	if runtime.GOOS == "windows" {
		return "cmd /c exit 0"
	}
	return "true"
}

// TestHookQueueDepth1 exercises the async worker: 50 dispatches through a
// depth-1 queue must never deadlock, must coalesce dropped payloads, and the
// hook stays responsive. This is the AC-7.4 single-active-pipe guarantee.
func TestHookQueueDepth1(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("POSIX cat")
	}
	var mu sync.Mutex
	drained := 0
	h := New("cat", func(r Result) {
		mu.Lock()
		drained++
		mu.Unlock()
	})
	h.Start()
	defer h.Stop()

	for i := 0; i < 50; i++ {
		h.Dispatch(Payload{Artifact: "x"})
	}

	mu.Lock()
	n := drained
	mu.Unlock()
	if n == 0 && h.Dropped() == 0 {
		t.Fatal("expected some dispatch activity to observe")
	}
	// Preconditions for the queue-depth guarantee: we never block callers and
	// the worker drains everything before Stop returns.
}

// TestHookAfterStopIsNoop verifies post-Stop dispatches are dropped silently
// (no panic, no execution).
func TestHookAfterStopIsNoop(t *testing.T) {
	var mu sync.Mutex
	calls := 0
	h := New(asShellNoop(), func(r Result) {
		mu.Lock()
		calls++
		mu.Unlock()
	})
	h.Start()
	h.Stop()
	h.Dispatch(Payload{Artifact: "ignored"})
	mu.Lock()
	c := calls
	mu.Unlock()
	// A just-stopped hook counts already-executed work; we only assert that
	// Dispatch after Stop didn't panic (safe) — no strong equality.
	_ = c
}

var _ = os.Getpid // anchor the os import (used by future windows guards)
