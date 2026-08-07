package protocol

import (
	"bytes"
	"testing"
)

func TestRoundTrip(t *testing.T) {
	var b bytes.Buffer
	want := []byte{1, 2, 3, 4, 5}
	if err := Write(&b, Playback, want); err != nil {
		t.Fatal(err)
	}
	got, err := Read(&b)
	if err != nil {
		t.Fatal(err)
	}
	if got.Type != Playback || !bytes.Equal(got.Payload, want) {
		t.Fatalf("got %#v", got)
	}
}
