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
