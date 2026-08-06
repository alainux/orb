// Package voice defines the provider interface and event types for the orb
// voice agent subsystem. The provider is the abstraction layer between orb
// and a realtime voice API (OpenAI Realtime, Deepgram Voice Agent, etc.).
//
// Spec references: R3 (AC-3.2–3.3), R5 (AC-5.2), R6 (AC-6.1), R24.
package voice

// EventType classifies agent events emitted during a realtime session.
type EventType int

const (
	// EventTextDelta is a streaming text chunk from the agent's response.
	EventTextDelta EventType = iota

	// EventToolCall is a complete function call (arguments fully received).
	EventToolCall

	// EventToolCallDelta is a streaming chunk of function call arguments.
	EventToolCallDelta

	// EventTurnEnd marks the end of an agent response turn.
	EventTurnEnd

	// EventError indicates an error from the voice API.
	EventError

	// EventSessionCreated indicates the session has been initialized.
	EventSessionCreated

	// EventSessionUpdated indicates the session config was acknowledged.
	EventSessionUpdated

	// EventInputAudioSpeechStarted indicates the server detected speech.
	EventInputAudioSpeechStarted

	// EventInputAudioSpeechStopped indicates the server detected silence.
	EventInputAudioSpeechStopped

	// EventResponseCancelled indicates an in-progress response was cancelled
	// (e.g. due to barge-in).
	EventResponseCancelled
)

// String returns a human-readable label for the event type.
func (t EventType) String() string {
	switch t {
	case EventTextDelta:
		return "text_delta"
	case EventToolCall:
		return "tool_call"
	case EventToolCallDelta:
		return "tool_call_delta"
	case EventTurnEnd:
		return "turn_end"
	case EventError:
		return "error"
	case EventSessionCreated:
		return "session_created"
	case EventSessionUpdated:
		return "session_updated"
	case EventInputAudioSpeechStarted:
		return "speech_started"
	case EventInputAudioSpeechStopped:
		return "speech_stopped"
	case EventResponseCancelled:
		return "response_cancelled"
	default:
		return "unknown"
	}
}

// AgentEvent is a single event from the voice agent during a session.
type AgentEvent struct {
	// Type classifies the event.
	Type EventType

	// Content carries the event payload:
	//   - EventTextDelta: the text chunk
	//   - EventToolCall: complete JSON arguments string
	//   - EventToolCallDelta: partial JSON arguments chunk
	//   - EventError: error message
	//   - others: empty
	Content string

	// ToolName is set for EventToolCall/EventToolCallDelta events.
	ToolName string

	// CallID is the function call ID for tool events (used to send results back).
	CallID string

	// ResponseID is the server-assigned response ID.
	ResponseID string

	// ItemID is the server-assigned conversation item ID (for truncation on barge-in).
	ItemID string
}

// ToolDef defines a function tool that the voice agent can call.
type ToolDef struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	Parameters  interface{} `json:"parameters"`
}
