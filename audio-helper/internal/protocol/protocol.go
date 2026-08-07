package protocol

import (
	"encoding/binary"
	"fmt"
	"io"
)

type Type byte

const (
	Playback      Type = 0x01
	ClearPlayback Type = 0x02
	SetMuted      Type = 0x03
	Shutdown      Type = 0x04

	Capture Type = 0x10
	Levels  Type = 0x11
	Ready   Type = 0x12
	Error   Type = 0x13
)

const MaxPayload = 8 << 20

type Frame struct {
	Type    Type
	Payload []byte
}

func Read(r io.Reader) (Frame, error) {
	var header [5]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return Frame{}, err
	}
	n := binary.LittleEndian.Uint32(header[1:])
	if n > MaxPayload {
		return Frame{}, fmt.Errorf("protocol payload too large: %d", n)
	}
	payload := make([]byte, int(n))
	if n > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return Frame{}, err
		}
	}
	return Frame{Type: Type(header[0]), Payload: payload}, nil
}

func Write(w io.Writer, typ Type, payload []byte) error {
	if len(payload) > MaxPayload {
		return fmt.Errorf("protocol payload too large: %d", len(payload))
	}
	var header [5]byte
	header[0] = byte(typ)
	binary.LittleEndian.PutUint32(header[1:], uint32(len(payload)))
	if _, err := w.Write(header[:]); err != nil {
		return err
	}
	if len(payload) > 0 {
		_, err := w.Write(payload)
		return err
	}
	return nil
}
