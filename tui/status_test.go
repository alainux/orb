package tui

import (
	"regexp"
	"strings"
	"testing"
	"time"
)

func TestFormatExtension(t *testing.T) {
	if formatExtension("") != "md" {
		t.Error("empty format should default to md")
	}
	if formatExtension("md") != "md" {
		t.Error("md -> md")
	}
	if formatExtension("txt") != "txt" {
		t.Error("txt -> txt")
	}
	if formatExtension("TXT") != "txt" {
		t.Error("case-insensitive txt -> txt")
	}
	if formatExtension("bogus") != "md" {
		t.Error("unknown format should degrade to md")
	}
}

func TestDefaultSavePath(t *testing.T) {
	now := time.Date(2026, 8, 6, 17, 42, 5, 0, time.UTC)

	p := defaultSavePath(now, "md")
	if ok, _ := regexp.MatchString(`^orb-[0-9]{8}-[0-9]{6}\.md$`, p); !ok {
		t.Errorf("md default path malformed: %q", p)
	}
	if !strings.HasSuffix(p, ".md") {
		t.Errorf("md path should end .md, got %q", p)
	}

	pt := defaultSavePath(now, "txt")
	if ok, _ := regexp.MatchString(`^orb-[0-9]{8}-[0-9]{6}\.txt$`, pt); !ok {
		t.Errorf("txt default path malformed: %q", pt)
	}
	if !strings.HasPrefix(p, "orb-") {
		t.Errorf("default path should start with orb-, got %q", p)
	}
}

func TestDefaultSavePathUniqueTimestamps(t *testing.T) {
	a := defaultSavePath(time.Now(), "md")
	b := defaultSavePath(time.Now().Add(2*time.Second), "md")
	if a == b {
		t.Errorf("distinct timestamps should produce distinct names: %q", a)
	}
}

func TestStatusBarIdle(t *testing.T) {
	got := StatusBar(12, 4, "idle", "")
	for _, frag := range []string{"12 words", "4 turns", "Ctrl+S save", "Ctrl+D end"} {
		if !strings.Contains(got, frag) {
			t.Errorf("idle bar missing %q: %q", frag, got)
		}
	}
}

func TestStatusBarSaved(t *testing.T) {
	got := StatusBar(0, 2, "saved", "./orb-x.md")
	for _, frag := range []string{"0 words", "2 turns", "saved", "./orb-x.md"} {
		if !strings.Contains(got, frag) {
			t.Errorf("saved bar missing %q: %q", frag, got)
		}
	}
}

func TestStatusBarSaving(t *testing.T) {
	got := StatusBar(3, 1, "saving", "")
	if !strings.Contains(got, "saving…") {
		t.Errorf("saving bar should indicate saving…, got %q", got)
	}
	if strings.Contains(got, "./") {
		t.Errorf("saving bar should not show a path yet: %q", got)
	}
}
