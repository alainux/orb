package session_test

import (
	"context"
	"testing"
	"time"

	"github.com/alainux/orb/agent"
	"github.com/alainux/orb/session"
	"github.com/alainux/orb/voice"
)

// testHandler implements session.EventHandler for testing.
type testHandler struct {
	textDeltas  []string
	toolCalls   []*agent.ArtifactUpdate
	turnEnds    int
	bargeIns    int
	errors      []error
	stateChanges []session.TurnState
}

func newTestHandler() *testHandler {
	return &testHandler{}
}

func (h *testHandler) OnTextDelta(delta string) {
	h.textDeltas = append(h.textDeltas, delta)
}

func (h *testHandler) OnToolCall(update *agent.ArtifactUpdate) {
	h.toolCalls = append(h.toolCalls, update)
}

func (h *testHandler) OnTurnEnd() {
	h.turnEnds++
}

func (h *testHandler) OnBargeIn() {
	h.bargeIns++
}

func (h *testHandler) OnStateChange(state session.TurnState) {
	h.stateChanges = append(h.stateChanges, state)
}

func (h *testHandler) OnError(err error) {
	h.errors = append(h.errors, err)
}

func TestSessionManager_StartAndClose(t *testing.T) {
	m := voice.NewMockProvider()
	handler := newTestHandler()

	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
			Model:    "test-model",
			Handler:  handler,
		})
	}()

	// Give the event loop a moment to start.
	time.Sleep(50 * time.Millisecond)

	if !m.Connected {
		t.Error("provider should be connected")
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_TextDeltas(t *testing.T) {
	m := voice.NewMockProvider()
	handler := newTestHandler()

	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
			Handler:  handler,
		})
	}()

	time.Sleep(50 * time.Millisecond)

	// Emit text deltas.
	m.EmitTextDelta("Hello ")
	m.EmitTextDelta("world")
	m.EmitTurnEnd()

	time.Sleep(100 * time.Millisecond)

	if len(handler.textDeltas) != 2 {
		t.Errorf("textDeltas count = %d, want 2", len(handler.textDeltas))
	}
	if handler.textDeltas[0] != "Hello " || handler.textDeltas[1] != "world" {
		t.Errorf("textDeltas = %v, want [Hello  world]", handler.textDeltas)
	}
	if handler.turnEnds != 1 {
		t.Errorf("turnEnds = %d, want 1", handler.turnEnds)
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_ToolCall(t *testing.T) {
	m := voice.NewMockProvider()
	handler := newTestHandler()

	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
			Handler:  handler,
		})
	}()

	time.Sleep(50 * time.Millisecond)

	// Emit a tool call.
	m.EmitToolCall("call_1", "update_artifact", `{"content":"# My Document\n\nHello world."}`)

	time.Sleep(100 * time.Millisecond)

	if len(handler.toolCalls) != 1 {
		t.Fatalf("toolCalls count = %d, want 1", len(handler.toolCalls))
	}
	if handler.toolCalls[0].Content != "# My Document\n\nHello world." {
		t.Errorf("tool call content = %q", handler.toolCalls[0].Content)
	}
	if handler.toolCalls[0].WordCount != 5 {
		t.Errorf("tool call word count = %d, want 5", handler.toolCalls[0].WordCount)
	}

	// Verify tool result was sent back.
	if len(m.ToolResults) != 1 {
		t.Fatalf("ToolResults count = %d, want 1", len(m.ToolResults))
	}
	if m.ToolResults[0].CallID != "call_1" {
		t.Errorf("ToolResult CallID = %q, want call_1", m.ToolResults[0].CallID)
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_ProcessAudio(t *testing.T) {
	m := voice.NewMockProvider()
	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
		})
	}()

	time.Sleep(50 * time.Millisecond)

	samples := []int16{100, 200, 300, 400}
	err := sm.ProcessAudio(samples)
	if err != nil {
		t.Fatalf("ProcessAudio returned error: %v", err)
	}

	if m.AudioSentCount() != 4 {
		t.Errorf("AudioSentCount = %d, want 4", m.AudioSentCount())
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_BargeIn(t *testing.T) {
	m := voice.NewMockProvider()
	handler := newTestHandler()

	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
			Handler:  handler,
		})
	}()

	time.Sleep(50 * time.Millisecond)

	// Simulate speech started during response.
	m.EmitSpeechStart()

	time.Sleep(100 * time.Millisecond)

	// Should not trigger barge-in if no response is active.
	if m.Interrupted {
		t.Error("should not interrupt when no response is active")
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_State(t *testing.T) {
	m := voice.NewMockProvider()
	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
		})
	}()

	time.Sleep(50 * time.Millisecond)

	state := sm.State()
	if state != session.TurnIdle {
		t.Errorf("initial state = %v, want TurnIdle", state)
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_UpdateSystemPrompt(t *testing.T) {
	m := voice.NewMockProvider()
	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
		})
	}()

	time.Sleep(50 * time.Millisecond)

	err := sm.UpdateSystemPrompt()
	if err != nil {
		t.Fatalf("UpdateSystemPrompt returned error: %v", err)
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_Conversation(t *testing.T) {
	m := voice.NewMockProvider()
	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
		})
	}()

	time.Sleep(50 * time.Millisecond)

	convo := sm.Conversation()
	if convo == nil {
		t.Fatal("Conversation() returned nil")
	}
	if convo.TurnCount() != 0 {
		t.Errorf("TurnCount = %d, want 0", convo.TurnCount())
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}

func TestSessionManager_ErrorEvent(t *testing.T) {
	m := voice.NewMockProvider()
	handler := newTestHandler()

	sm := session.NewSessionManager()
	ctx, cancel := context.WithCancel(context.Background())

	go func() {
		sm.Start(ctx, session.SessionConfig{
			Provider: m,
			APIKey:   "test-key",
			Handler:  handler,
		})
	}()

	time.Sleep(50 * time.Millisecond)

	m.Emit(voice.AgentEvent{
		Type:    voice.EventError,
		Content: "rate limit exceeded",
	})

	time.Sleep(100 * time.Millisecond)

	if len(handler.errors) != 1 {
		t.Errorf("errors count = %d, want 1", len(handler.errors))
	}

	cancel()
	time.Sleep(50 * time.Millisecond)
	sm.Close()
}
