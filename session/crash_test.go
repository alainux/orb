package session

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
	"time"
)

func withHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	if err := os.Setenv("HOME", home); err != nil {
		t.Fatalf("set HOME: %v", err)
	}
	t.Cleanup(func() { os.Unsetenv("HOME") })
	return home
}

func TestWriteCrashSnapshotPathAndContent(t *testing.T) {
	home := withHome(t)
	now := time.Date(2026, 8, 6, 18, 30, 15, 0, time.UTC)

	p, err := WriteCrashSnapshot("partial artifact text", now)
	if err != nil {
		t.Fatalf("WriteCrashSnapshot: %v", err)
	}

	rel, err := filepath.Rel(home, p)
	if err != nil {
		t.Fatalf("Rel: %v", err)
	}
	want := filepath.Join(".orb", "crash", "crash-20260806-183015.md")
	rel = filepath.ToSlash(rel)
	want = filepath.ToSlash(want)
	if rel != want {
		t.Errorf("snapshot rel path = %q, want %q", rel, want)
	}
	if ok, _ := regexp.MatchString(`\.md$`, p); !ok {
		t.Errorf("snapshot should be a .md file: %q", p)
	}

	b, err := os.ReadFile(p)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	if string(b) != "partial artifact text" {
		t.Errorf("snapshot content = %q", string(b))
	}
}

func TestCrashSnapshotCreatesOrderedTimestampedNames(t *testing.T) {
	withHome(t)
	a := time.Date(2026, 8, 6, 1, 2, 3, 0, time.UTC)
	b := time.Date(2026, 8, 6, 4, 5, 6, 0, time.UTC)
	p1, err := WriteCrashSnapshot("one", a)
	if err != nil {
		t.Fatal(err)
	}
	p2, err := WriteCrashSnapshot("two", b)
	if err != nil {
		t.Fatal(err)
	}
	if p1 == p2 || p1 > p2 {
		t.Errorf("timestamped names should sort chronologically: %q vs %q", p1, p2)
	}
}

func TestWriteCrashSnapshotEmptyYieldsFile(t *testing.T) {
	home := withHome(t)
	p, err := WriteCrashSnapshot("", time.Now())
	if err != nil {
		t.Fatalf("empty snapshot should still write: %v", err)
	}
	if filepath.Dir(p) != filepath.Join(home, ".orb", "crash") {
		t.Errorf("expected crash dir under HOME/.orb/crash, got %q", p)
	}
}
