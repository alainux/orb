package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/gen2brain/malgo"
	"github.com/alainux/orb/audio-helper/internal/playback"
	"github.com/alainux/orb/audio-helper/internal/protocol"
)

const sampleRate = 24000
const channels = 1

type event struct {
	typ     protocol.Type
	payload []byte
}

type engine struct {
	context      *malgo.AllocatedContext
	device       *malgo.Device
	playback     playback.Queue
	capture      chan []byte
	inputRMS     atomic.Uint64
	outputRMS    atomic.Uint64
	captureDrops atomic.Uint32
	muted        atomic.Bool
}

func newEngine() (*engine, error) {
	e := &engine{capture: make(chan []byte, 128)}
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, func(string) {})
	if err != nil {
		return nil, fmt.Errorf("audio context: %w", err)
	}
	e.context = ctx

	cfg := malgo.DefaultDeviceConfig(malgo.Duplex)
	cfg.Capture.Format = malgo.FormatS16
	cfg.Capture.Channels = channels
	cfg.Playback.Format = malgo.FormatS16
	cfg.Playback.Channels = channels
	cfg.SampleRate = sampleRate
	cfg.PeriodSizeInMilliseconds = 10
	cfg.PerformanceProfile = malgo.LowLatency
	cfg.Alsa.NoMMap = 1

	callbacks := malgo.DeviceCallbacks{Data: func(output, input []byte, _ uint32) {
		clear(output)
		n := e.playback.ReadInto(output)
		if n > 0 {
			e.outputRMS.Store(math.Float64bits(pcmRMS(output[:n])))
		} else {
			e.outputRMS.Store(0)
		}
		if len(input) == 0 {
			return
		}
		e.inputRMS.Store(math.Float64bits(pcmRMS(input)))
		if e.muted.Load() {
			return
		}
		cp := append([]byte(nil), input...)
		select {
		case e.capture <- cp:
		default:
			e.captureDrops.Add(1)
		}
	}}
	dev, err := malgo.InitDevice(ctx.Context, cfg, callbacks)
	if err != nil {
		_ = ctx.Uninit()
		ctx.Free()
		return nil, fmt.Errorf("audio device: %w", err)
	}
	e.device = dev
	return e, nil
}

func (e *engine) start() error {
	if err := e.device.Start(); err != nil {
		return fmt.Errorf("start audio device: %w", err)
	}
	return nil
}
func (e *engine) close() {
	if e.device != nil {
		e.device.Uninit()
	}
	if e.context != nil {
		_ = e.context.Uninit()
		e.context.Free()
	}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "orb-audio:", err)
		os.Exit(1)
	}
}

func run() error {
	e, err := newEngine()
	if err != nil {
		return err
	}
	defer e.close()
	if err := e.start(); err != nil {
		return err
	}

	events := make(chan event, 256)
	done := make(chan struct{})
	go writer(events, done)
	events <- event{typ: protocol.Ready, payload: []byte("24000")}

	go func() {
		for pcm := range e.capture {
			select {
			case events <- event{typ: protocol.Capture, payload: pcm}:
			case <-done:
				return
			}
		}
	}()
	go func() {
		ticker := time.NewTicker(50 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				payload := make([]byte, 24)
				binary.LittleEndian.PutUint64(payload[0:8], e.inputRMS.Load())
				binary.LittleEndian.PutUint64(payload[8:16], e.outputRMS.Load())
				binary.LittleEndian.PutUint32(payload[16:20], e.captureDrops.Load())
				q := uint64(e.playback.Len())
				if q > uint64(^uint32(0)) {
					q = uint64(^uint32(0))
				}
				binary.LittleEndian.PutUint32(payload[20:24], uint32(q))
				select {
				case events <- event{typ: protocol.Levels, payload: payload}:
				case <-done:
					return
				}
			case <-done:
				return
			}
		}
	}()

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(signals)
	commandErr := make(chan error, 1)
	go func() { commandErr <- commandLoop(e, os.Stdin) }()
	select {
	case err := <-commandErr:
		close(done)
		if err != nil && !errors.Is(err, io.EOF) {
			return err
		}
	case <-signals:
		close(done)
	}
	return nil
}

func commandLoop(e *engine, r io.Reader) error {
	for {
		frame, err := protocol.Read(r)
		if err != nil {
			return err
		}
		switch frame.Type {
		case protocol.Playback:
			e.playback.Write(frame.Payload)
		case protocol.ClearPlayback:
			e.playback.Clear()
			e.outputRMS.Store(0)
		case protocol.SetMuted:
			e.muted.Store(len(frame.Payload) > 0 && frame.Payload[0] != 0)
		case protocol.Shutdown:
			return nil
		}
	}
}

func writer(events <-chan event, done <-chan struct{}) {
	for {
		select {
		case ev := <-events:
			if err := protocol.Write(os.Stdout, ev.typ, ev.payload); err != nil {
				fmt.Fprintln(os.Stderr, "stdout:", err)
				return
			}
		case <-done:
			return
		}
	}
}

func pcmRMS(pcm []byte) float64 {
	count := len(pcm) / 2
	if count == 0 {
		return 0
	}
	var sum float64
	for i := 0; i+1 < len(pcm); i += 2 {
		s := float64(int16(binary.LittleEndian.Uint16(pcm[i:i+2]))) / 32768
		sum += s * s
	}
	return math.Sqrt(sum / float64(count))
}
