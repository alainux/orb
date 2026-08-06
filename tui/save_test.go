package tui

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/alainux/orb/config"
)

func TestSaveRespectsOutputOverride(t *testing.T) {
	dir := t.TempDir()
	out := filepath.Join(dir, "notes.md")
	a := NewApp(&config.Config{Format: "md", OutputPath: out})
	a.SetArtifact("# Plan\n\ntwo words")

	got, err := a.Save("")
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if got != out {
		t.Errorf("Save returned %q, want override %q", got, out)
	}
	b, _ := os.ReadFile(out)
	if string(b) != "# Plan\n\ntwo words" {
		t.Errorf("content mismatch: %q", string(b))
	}
}

func TestSaveDefaultsToCwdTimestamped(t *testing.T) {
	dir := t.TempDir()
	old, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(old)

	a := NewApp(&config.Config{Format: "md"})
	a.SetArtifact("one word")
	p, err := a.Save("")
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if !strings.HasPrefix(filepath.Base(p), "orb-") || !strings.HasSuffix(p, ".md") {
		t.Errorf("default path %q should be ./orb-<timestamp>.md", p)
	}
	if _, err := os.Stat(p); err != nil {
		t.Errorf("saved file missing: %v", err)
	}
	b, _ := os.ReadFile(p)
	if string(b) != "one word" {
		t.Errorf("content mismatch: %q", string(b))
	}
	os.Remove(p)
}

func TestSaveHonorsFormatChoice(t *testing.T) {
	dir := t.TempDir()
	old, _ := os.Getwd()
	if err := os.Chdir(dir); err != nil {
		t.Fatal(err)
	}
	defer os.Chdir(old)

	a := NewApp(&config.Config{Format: "txt"})
	a.SetArtifact("plain text artifact")
	p, err := a.Save("")
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if !strings.HasSuffix(p, ".txt") {
		t.Errorf("txt format should produce .txt default path, got %q", p)
	}
	if _, err := os.Stat(p); err != nil {
		t.Errorf("saved txt file missing: %v", err)
	}
	os.Remove(p)
}
