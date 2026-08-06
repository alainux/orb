package voice

import (
	"context"
	"fmt"
	"sync"
)

// MockProvider is a test double for Provider. It records calls and
// can be programmed to emit events.
type MockProvider struct {
	mu sync.Mutex

	// Connected is true after Connect() returns nil.
	Connected bool

	// AudioSent tracks all PCM samples sent via SendAudio.
	AudioSent [][]int16

	// Interrupted tracks whether Interrupt() was called.
	Interrupted bool

	// ToolResults tracks all SubmitToolResult calls.
	ToolResults []struct {
		CallID string
		Output string
	}

	// Events to emit (programmable).
	events chan AgentEvent

	// Closed tracks whether Close() was called.
	Closed bool

	// ConnectErr, if non-nil, is returned by Connect().
	ConnectErr error

	// SendAudioErr, if non-nil, is returned by SendAudio().
	SendAudioErr error
}

// NewMockProvider creates a new mock provider with a buffered event channel.
func NewMockProvider() *MockProvider {
	return &MockProvider{
		events: make(chan AgentEvent, 32),
	}
}

// Connect records the call and sets Connected = true.
func (m *MockProvider) Connect(_ context.Context, _ ProviderConfig) error {
	if m.ConnectErr != nil {
		return m.ConnectErr
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Connected = true
	return nil
}

// SendAudio records the samples and returns the programmed error.
func (m *MockProvider) SendAudio(samples []int16) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.SendAudioErr != nil {
		return m.SendAudioErr
	}
	// Copy samples to avoid aliasing.
	cp := make([]int16, len(samples))
	copy(cp, samples)
	m.AudioSent = append(m.AudioSent, cp)
	return nil
}

// Events returns the mock event channel.
func (m *MockProvider) Events() <-chan AgentEvent {
	return m.events
}

// Interrupt records the call.
func (m *MockProvider) Interrupt() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Interrupted = true
	return nil
}

// SubmitToolResult records the call.
func (m *MockProvider) SubmitToolResult(callID string, output string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ToolResults = append(m.ToolResults, struct {
		CallID string
		Output string
	}{callID, output})
	return nil
}

// Close records the call.
func (m *MockProvider) Close() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Closed = true
	return nil
}

// Emit sends an event on the mock channel (for testing).
func (m *MockProvider) Emit(evt AgentEvent) {
	select {
	case m.events <- evt:
	default:
	}
}

// EmitToolCall is a convenience to emit a complete tool call event.
func (m *MockProvider) EmitToolCall(callID, name, argsJSON string) {
	m.Emit(AgentEvent{
		Type:     EventToolCall,
		Content:  argsJSON,
		ToolName: name,
		CallID:   callID,
	})
}

// EmitTextDelta is a convenience to emit a text delta event.
func (m *MockProvider) EmitTextDelta(text string) {
	m.Emit(AgentEvent{
		Type:    EventTextDelta,
		Content: text,
	})
}

// EmitTurnEnd is a convenience to emit a turn end event.
func (m *MockProvider) EmitTurnEnd() {
	m.Emit(AgentEvent{
		Type: EventTurnEnd,
	})
}

// EmitSpeechStart is a convenience to emit a speech started event.
func (m *MockProvider) EmitSpeechStart() {
	m.Emit(AgentEvent{
		Type: EventInputAudioSpeechStarted,
	})
}

// AudioSentCount returns the total number of samples sent.
func (m *MockProvider) AudioSentCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	count := 0
	for _, s := range m.AudioSent {
		count += len(s)
	}
	return count
}

// Reset clears all recorded state.
func (m *MockProvider) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Connected = false
	m.AudioSent = nil
	m.Interrupted = false
	m.ToolResults = nil
	m.Closed = false
	m.ConnectErr = nil
	m.SendAudioErr = nil
	// Drain events.
	for {
		select {
		case <-m.events:
		default:
			return
		}
	}
}

// String returns a summary of the mock's state (for debugging).
func (m *MockProvider) String() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	return fmt.Sprintf("MockProvider{connected=%t, audio_frames=%d, interrupted=%t, tool_results=%d, closed=%t}",
		m.Connected, len(m.AudioSent), m.Interrupted, len(m.ToolResults), m.Closed)
}
