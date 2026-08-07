package playback

import (
	"bytes"
	"testing"
)

func TestQueuePreservesAllAudioInOrder(t *testing.T) {
	q := &Queue{}
	a := bytes.Repeat([]byte{1, 2}, 24000*5)
	b := bytes.Repeat([]byte{3, 4}, 24000*3)
	q.Write(a)
	q.Write(b)
	out := make([]byte, len(a)+len(b))
	n := q.ReadInto(out)
	if n != len(out) {
		t.Fatalf("read %d want %d", n, len(out))
	}
	want := append(append([]byte(nil), a...), b...)
	if !bytes.Equal(out, want) {
		t.Fatal("audio order changed")
	}
}

func TestClear(t *testing.T) {
	q := &Queue{}
	q.Write([]byte{1, 2, 3})
	q.Clear()
	if q.Len() != 0 {
		t.Fatal(q.Len())
	}
}
