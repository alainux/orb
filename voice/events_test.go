package voice_test

import (
	"testing"

	"github.com/alainux/orb/voice"
)

func TestEventTypeString(t *testing.T) {
	tests := []struct {
		et   voice.EventType
		want string
	}{
		{voice.EventTextDelta, "text_delta"},
		{voice.EventToolCall, "tool_call"},
		{voice.EventToolCallDelta, "tool_call_delta"},
		{voice.EventTurnEnd, "turn_end"},
		{voice.EventError, "error"},
		{voice.EventSessionCreated, "session_created"},
		{voice.EventSessionUpdated, "session_updated"},
		{voice.EventInputAudioSpeechStarted, "speech_started"},
		{voice.EventInputAudioSpeechStopped, "speech_stopped"},
		{voice.EventResponseCancelled, "response_cancelled"},
		{voice.EventType(99), "unknown"},
	}
	for _, tt := range tests {
		if got := tt.et.String(); got != tt.want {
			t.Errorf("EventType(%d).String() = %q, want %q", tt.et, got, tt.want)
		}
	}
}

func TestAgentEventFields(t *testing.T) {
	evt := voice.AgentEvent{
		Type:       voice.EventToolCall,
		Content:    `{"content":"hello"}`,
		ToolName:   "update_artifact",
		CallID:     "call_123",
		ResponseID: "resp_456",
	}
	if evt.Type != voice.EventToolCall {
		t.Errorf("Type = %v, want EventToolCall", evt.Type)
	}
	if evt.ToolName != "update_artifact" {
		t.Errorf("ToolName = %q, want update_artifact", evt.ToolName)
	}
	if evt.CallID != "call_123" {
		t.Errorf("CallID = %q, want call_123", evt.CallID)
	}
}
