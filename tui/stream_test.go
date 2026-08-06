package tui

import (
	"strings"
	"testing"
	"time"
)

// --- reveal buffer (R19 / AC-19.1..19.5) ---

func TestRevealResetIsInstant(t *testing.T) {
	rb := &RevealBuffer{}
	long := "A complete artifact that should appear all at once."
	rb.Reset(long)
	if rb.Visible() != long {
		t.Errorf("Reset should show full text immediately, got %q", rb.Visible())
	}
	if rb.Pending() != "" {
		t.Errorf("Reset should clear pending, got %q", rb.Pending())
	}
	if !rb.Revealed() {
		t.Error("Reset should leave the buffer fully revealed")
	}
}

func TestRevealFastStreamIsPaced(t *testing.T) {
	// AC-19.3: a fast stream is buffered and shown at the fixed 30 ms pace.
	rb := &RevealBuffer{}
	rb.Append("hello world") // 11 chars arrive instantly
	if rb.Visible() != "" {
		t.Fatalf("append should not reveal immediately, got %q", rb.Visible())
	}
	if got := rb.Pending(); got != "hello world" {
		t.Fatalf("pending = %q, want buffered chunk", got)
	}

	for i := 1; i <= 11; i++ {
		rb.Tick(30 * time.Millisecond) // one char per fixed interval
	}
	if rb.Visible() != "hello world" {
		t.Errorf("after 11 ticks visible = %q, want full text", rb.Visible())
	}
	if !rb.Revealed() {
		t.Error("buffer not fully revealed after draining its pending")
	}
}

func TestRevealPaceOneCharPerInterval(t *testing.T) {
	rb := &RevealBuffer{}
	rb.Append("abcdef") // 6 chars
	rb.Tick(30 * time.Millisecond)
	if rb.Visible() != "a" {
		t.Errorf("one 30 ms tick should reveal exactly one char, got %q", rb.Visible())
	}
	// two more chars on a longer-but-not-multi tick
	rb.Tick(90 * time.Millisecond) // 3 intervals elapsed
	want := "a" + "bcd"
	if rb.Visible() != want {
		t.Errorf("90 ms tick should reveal 3 more, got %q want %q", rb.Visible(), want)
	}
}

func TestRevealNoArtificialDelayWhenIdle(t *testing.T) {
	// AC-19.4: when there is nothing pending (slow stream gap) we wait on the
	// next chunk, not on an injected delay.
	rb := &RevealBuffer{}
	rb.Reset("already shown")
	before := rb.Visible()
	for i := 0; i < 100; i++ {
		rb.Tick(30 * time.Millisecond)
	}
	if rb.Visible() != before {
		t.Errorf("idle buffer should not mutate, got %q", rb.Visible())
	}
}

func TestRevealSlowChunkShownWhenItArrives(t *testing.T) {
	// A slow stream delivers "<", THEN "slow>" later. Each char shows the
	// instant its 30 ms budget is satisfied, without waiting for the next.
	rb := &RevealBuffer{}
	rb.Append("slow")
	rb.Tick(20 * time.Millisecond) // not yet due
	if rb.Visible() != "" {
		t.Fatalf("under-due char revealed too early: %q", rb.Visible())
	}
	rb.Tick(11 * time.Millisecond) // crosses 30 ms
	if rb.Visible() != "s" {
		t.Errorf("after budget visible = %q, want the first char", rb.Visible())
	}
}

func TestRevealAppendAfterExisting(t *testing.T) {
	rb := &RevealBuffer{}
	rb.Append("abc")
	rb.Tick(30 * time.Millisecond)
	rb.Tick(30 * time.Millisecond)
	if rb.Visible() != "ab" {
		t.Fatalf("initial visible = %q", rb.Visible())
	}
	rb.Append("def") // more arrives mid-stream — still paced
	rb.Tick(30 * time.Millisecond)
	if want := "abc"; rb.Visible() != want {
		t.Errorf("mid-stream append pacing = %q, want %q", rb.Visible(), want)
	}
	rb.Tick(30 * time.Millisecond)
	if rb.Visible() != "abcd" {
		t.Errorf("second tick should reach abcd, got %q", rb.Visible())
	}
}

// --- tokenizer: word count (T7) ---

func TestWordCount(t *testing.T) {
	cases := []struct {
		in   string
		want int
	}{
		{"", 0},
		{"   ", 0},
		{"one", 1},
		{"one two three", 3},
		{"one  two   three", 3},
		{"a\nb\nc", 3},
		{"hello, world!", 2},
		{"\n# Heading\n\nbody text here", 5},
	}
	for _, c := range cases {
		if got := wordCount(c.in); got != c.want {
			t.Errorf("wordCount(%q) = %d, want %d", c.in, got, c.want)
		}
	}
	if strings.Fields("a b")[0] != "a" {
		t.Fatal("sanity")
	}
}

// --- summary formatting (AC-14.5) ---

func TestSummarizeSession(t *testing.T) {
	out := summarizeSession(7, 3, "./orb-x.md")
	for _, frag := range []string{"words drawn:", "7", "turns taken:", "3", "orb-x.md"} {
		if !strings.Contains(out, frag) {
			t.Errorf("summary missing %q:\n%s", frag, out)
		}
	}
}
