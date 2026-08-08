package playback

import (
	"bytes"
	"testing"
)

func TestBufferPrebuffersAndPreservesCadenceOrder(t *testing.T) {
	b := NewBuffer(8, 20, 4)
	b.Write([]byte{1, 2, 3, 4})
	out := make([]byte, 4)
	if n := b.ReadInto(out); n != 0 {
		t.Fatalf("played before prebuffer: %d", n)
	}
	b.Write([]byte{5, 6, 7, 8, 9, 10, 11, 12})
	if n := b.ReadInto(out); n != 4 {
		t.Fatalf("read %d", n)
	}
	if !bytes.Equal(out, []byte{1, 2, 3, 4}) {
		t.Fatalf("order changed: %v", out)
	}
	if n := b.ReadInto(out); n != 4 || !bytes.Equal(out, []byte{5, 6, 7, 8}) {
		t.Fatalf("second frame %d %v", n, out)
	}
}

func TestBufferRebuffersAfterUnderrunInsteadOfMicroSpiking(t *testing.T) {
	b := NewBuffer(4, 12, 4)
	b.Write([]byte{1, 2, 3, 4, 5, 6})
	out := make([]byte, 4)
	if n := b.ReadInto(out); n != 4 {
		t.Fatal(n)
	}
	if n := b.ReadInto(out); n != 0 {
		t.Fatalf("live underrun emitted a micro-fragment: %d", n)
	}
	if b.Recoveries() != 1 {
		t.Fatalf("recoveries %d", b.Recoveries())
	}
	b.Write([]byte{7, 8, 9, 10})
	if n := b.ReadInto(out); n != 0 {
		t.Fatalf("should still rebuffer, got %d", n)
	}
	b.Write([]byte{11, 12})
	if n := b.ReadInto(out); n != 4 {
		t.Fatalf("did not recover: %d", n)
	}
	if !bytes.Equal(out, []byte{5, 6, 7, 8}) {
		t.Fatalf("recovery skipped/reordered preserved tail: %v", out)
	}
}

func TestBufferNaturalEndDoesNotCountAsRecovery(t *testing.T) {
	b := NewBuffer(8, 16, 4)
	b.Write([]byte{1, 2, 3, 4, 5, 6})
	b.End()
	out := make([]byte, 4)
	if n := b.ReadInto(out); n != 4 {
		t.Fatal(n)
	}
	if n := b.ReadInto(out); n != 2 {
		t.Fatal(n)
	}
	if b.Recoveries() != 0 {
		t.Fatalf("natural end counted as recovery")
	}
}

func TestClearDropsInterruptedResponseAndRequiresFreshLead(t *testing.T) {
	b := NewBuffer(4, 12, 4)
	b.Write([]byte{1, 2, 3, 4, 5, 6, 7, 8})
	out := make([]byte, 4)
	if n := b.ReadInto(out); n != 4 {
		t.Fatal(n)
	}
	b.Clear()
	b.Write([]byte{9, 10})
	if n := b.ReadInto(out); n != 0 {
		t.Fatalf("interrupted tail leaked: %d", n)
	}
	b.Write([]byte{11, 12})
	if n := b.ReadInto(out); n != 4 || !bytes.Equal(out, []byte{9, 10, 11, 12}) {
		t.Fatalf("fresh response wrong %d %v", n, out)
	}
}

func TestBufferEscalatesFasterOnRapidUnderrunSpiral(t *testing.T) {
	// A second underrun arriving while the previous rebuild has not yet
	// delivered a healthy lead means the shortfall is deeper than one step.
	// The target must grow by a bigger step so the re-prime finishes in fewer
	// (hence shorter) interruptions instead of a long choppy tail.
	b := NewBuffer(4, 100, 4)
	out := make([]byte, 4)

	b.Write([]byte{1, 2, 3, 4, 5, 6})
	if n := b.ReadInto(out); n != 4 {
		t.Fatalf("prime consumed %d", n)
	}

	// Underrun #1 and #2 back-to-back (>~ 120ms apart is impossible in this
	// call sequence), so the second underrun counts as a spiral and should
	// escalate by 2x the recovery step instead of 1x.
	if n := b.ReadInto(out); n != 0 {
		t.Fatalf("expected underrun, played %d", n)
	}
	got := b.TargetBytes()
	if want := 4 + 4; got != want {
		t.Fatalf("first underrun target=%d want %d", got, want)
	}

	b.Write(bytes.Repeat([]byte{1}, 6)) // queued=2+6=8 == target -> re-prime
	b.ReadInto(out)                     // consumes 4, queued=4
	b.ReadInto(out)                     // consumes 4, queued=0
	if n := b.ReadInto(out); n != 0 {
		t.Fatalf("expected rapid underrun, played %d", n)
	}
	got = b.TargetBytes()
	if want := 4 + 4 + 8; got != want {
		t.Fatalf("rapid underrun did not escalate 2x: target=%d want %d", got, want)
	}
	if b.Recoveries() != 2 {
		t.Fatalf("recoveries=%d want 2", b.Recoveries())
	}
}

func TestBufferRelaxesEscalatedLatencyAfterSustainedHealth(t *testing.T) {
	// After a choppy episode the adaptive target may have been pushed toward
	// max. Once delivery is sustained and healthy it must relax back toward the
	// base so the extra latency does not linger into the next response.
	b := NewBuffer(10, 40, 4)
	b.mu.Lock()
	b.target = 24 // simulate a prior escalation (base 10)
	b.mu.Unlock()

	out := make([]byte, 4)
	b.Write(bytes.Repeat([]byte{9}, 24)) // first prime above the escalated target
	for i := 0; i < steadyReadsBeforeRelax+4; i++ {
		b.Write(bytes.Repeat([]byte{byte(i % 250)}, 12)) // keep the queue fed for each full read
		if n := b.ReadInto(out); n != 4 {
			t.Fatalf("unexpected underrun during healthy run at read %d: %d", i, n)
		}
	}
	if got := b.TargetBytes(); got >= 24 {
		t.Fatalf("latency never relaxed: target=%d", got)
	}
	if got := b.TargetBytes(); got < 10 {
		t.Fatalf("relaxed below base: target=%d", got)
	}
	if b.Recoveries() != 0 {
		t.Fatalf("healthy run counted recoveries: %d", b.Recoveries())
	}
}
