package voice_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/alainux/orb/voice"
)

func TestMockProvider_Connect(t *testing.T) {
	m := voice.NewMockProvider()

	if m.Connected {
		t.Fatal("should not be connected before Connect()")
	}

	err := m.Connect(context.Background(), voice.ProviderConfig{APIKey: "test"})
	if err != nil {
		t.Fatalf("Connect returned error: %v", err)
	}
	if !m.Connected {
		t.Fatal("should be connected after Connect()")
	}
}

func TestMockProvider_ConnectError(t *testing.T) {
	m := voice.NewMockProvider()
	m.ConnectErr = fmt.Errorf("connection refused")

	err := m.Connect(context.Background(), voice.ProviderConfig{})
	if err == nil {
		t.Fatal("expected error from Connect()")
	}
}

func TestMockProvider_SendAudio(t *testing.T) {
	m := voice.NewMockProvider()
	_ = m.Connect(context.Background(), voice.ProviderConfig{APIKey: "test"})

	samples := []int16{100, 200, 300}
	err := m.SendAudio(samples)
	if err != nil {
		t.Fatalf("SendAudio returned error: %v", err)
	}

	if m.AudioSentCount() != 3 {
		t.Fatalf("AudioSentCount = %d, want 3", m.AudioSentCount())
	}
}

func TestMockProvider_SendAudioError(t *testing.T) {
	m := voice.NewMockProvider()
	m.SendAudioErr = fmt.Errorf("write failed")

	err := m.SendAudio([]int16{1, 2, 3})
	if err == nil {
		t.Fatal("expected error from SendAudio()")
	}
}

func TestMockProvider_Interrupt(t *testing.T) {
	m := voice.NewMockProvider()
	if m.Interrupted {
		t.Fatal("should not be interrupted before Interrupt()")
	}

	_ = m.Interrupt()
	if !m.Interrupted {
		t.Fatal("should be interrupted after Interrupt()")
	}
}

func TestMockProvider_SubmitToolResult(t *testing.T) {
	m := voice.NewMockProvider()
	err := m.SubmitToolResult("call_1", `{"ok":true}`)
	if err != nil {
		t.Fatalf("SubmitToolResult returned error: %v", err)
	}
	if len(m.ToolResults) != 1 {
		t.Fatalf("ToolResults count = %d, want 1", len(m.ToolResults))
	}
	if m.ToolResults[0].CallID != "call_1" {
		t.Errorf("CallID = %q, want call_1", m.ToolResults[0].CallID)
	}
}

func TestMockProvider_EmitEvents(t *testing.T) {
	m := voice.NewMockProvider()

	m.EmitTextDelta("hello ")
	m.EmitTextDelta("world")
	m.EmitToolCall("call_1", "update_artifact", `{"content":"test"}`)
	m.EmitTurnEnd()
	m.EmitSpeechStart()

	// Verify events arrive in order.
	expected := []voice.EventType{
		voice.EventTextDelta,
		voice.EventTextDelta,
		voice.EventToolCall,
		voice.EventTurnEnd,
		voice.EventInputAudioSpeechStarted,
	}
	for i, want := range expected {
		evt := <-m.Events()
		if evt.Type != want {
			t.Errorf("event %d: Type = %v, want %v", i, evt.Type, want)
		}
	}
}

func TestMockProvider_Reset(t *testing.T) {
	m := voice.NewMockProvider()
	_ = m.Connect(context.Background(), voice.ProviderConfig{APIKey: "test"})
	_ = m.SendAudio([]int16{1, 2, 3})
	_ = m.Interrupt()

	m.Reset()

	if m.Connected {
		t.Error("should not be connected after Reset()")
	}
	if m.AudioSentCount() != 0 {
		t.Errorf("AudioSentCount = %d, want 0", m.AudioSentCount())
	}
	if m.Interrupted {
		t.Error("should not be interrupted after Reset()")
	}
}

func TestMockProvider_String(t *testing.T) {
	m := voice.NewMockProvider()
	s := m.String()
	if s == "" {
		t.Error("String() returned empty")
	}
}
