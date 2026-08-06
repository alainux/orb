// Package session orchestrates the voice agent session: it wires the provider,
// conversation tracker, barge-in monitor, and audio pipeline together.
// The TUI/main loop drives audio input; the session manager handles agent events.
//
// Spec references: R3 (AC-3.1–3.5), R5 (AC-5.1–5.2), R6 (AC-6.1–6.4),
// R8 (AC-8.1–8.5), R17 (AC-17.1–17.4).
package session

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/alainux/orb/agent"
	"github.com/alainux/orb/voice"
)

// TurnState mirrors the conversation turn state for external consumers.
type TurnState int

const (
	TurnIdle       TurnState = 0
	TurnListening  TurnState = 1
	TurnProcessing TurnState = 2
	TurnDrafting   TurnState = 3
)

// String returns a human-readable label.
func (s TurnState) String() string {
	switch s {
	case TurnIdle:
		return "idle"
	case TurnListening:
		return "listening"
	case TurnProcessing:
		return "processing"
	case TurnDrafting:
		return "drafting"
	default:
		return "unknown"
	}
}

// SessionManager orchestrates the voice agent session.
type SessionManager struct {
	provider     voice.Provider
	convo        *agent.Conversation
	bargeIn      *BargeInMonitor
	cfg          voice.ProviderConfig
	contextFiles []string

	mu        sync.Mutex
	ctx       context.Context
	cancel    context.CancelFunc
	handler   EventHandler
	lifecycle *Lifecycle // S-1 state machine (R13)
}

// DisconnectHandler is an OPTIONAL capability an EventHandler may additionally
// implement to be told about an abnormal session disconnect (→ crash snapshot,
// AC-11.5). It is a separate interface so existing handler implementations
// remain valid.
type DisconnectHandler interface {
	OnDisconnect()
}

// EventHandler is the callback interface for TUI updates.
type EventHandler interface {
	OnTextDelta(delta string)
	OnToolCall(update *agent.ArtifactUpdate)
	OnTurnEnd()
	OnBargeIn()
	OnStateChange(state TurnState)
	OnError(err error)
}

// SessionConfig holds the full configuration for starting a session.
type SessionConfig struct {
	// Provider is the voice agent provider (OpenAI, Deepgram, etc.).
	Provider voice.Provider

	// APIKey is the provider's API key.
	APIKey string

	// Model is the LLM model identifier.
	Model string

	// Instructions is the system prompt instructions.
	Instructions string

	// ContextFiles are UTF-8 files loaded as agent context (R8).
	ContextFiles []string

	// EventHandler is the callback for TUI updates.
	Handler EventHandler
}

// NewSessionManager creates a new session manager.
func NewSessionManager() *SessionManager {
	return &SessionManager{}
}

// Start connects to the voice agent and begins the event loop.
// It blocks until the context is cancelled or the session ends.
func (sm *SessionManager) Start(ctx context.Context, sessCfg SessionConfig) error {
	sm.mu.Lock()
	sm.provider = sessCfg.Provider
	sm.contextFiles = sessCfg.ContextFiles
	sm.handler = sessCfg.Handler
	sm.convo = agent.NewConversation()
	sm.bargeIn = NewBargeInMonitor(sessCfg.Provider)
	sm.lifecycle = NewLifecycle()
	sm.cfg = voice.ProviderConfig{
		APIKey:           sessCfg.APIKey,
		Model:            sessCfg.Model,
		Instructions:     sessCfg.Instructions,
		Tools:            agent.DefaultTools(),
		SampleRate:       24000,
		OutputModalities: []string{"text"},
	}
	sm.mu.Unlock()

	ctx, cancel := context.WithCancel(ctx)
	sm.ctx = ctx
	sm.cancel = cancel

	if err := voice.ConnectWithRetry(ctx, sm.provider, sm.cfg,
		voice.DefaultConnectAttempts, voice.DefaultConnectBackoff); err != nil {
		cancel()
		return fmt.Errorf("session: connect: %w", err)
	}

	sm.lifecycle.Start(time.Now()) // AC-13.1
	log.Printf("voice session connected (model=%s)", sm.cfg.Model)
	sm.eventLoop(ctx)
	return nil
}

// eventLoop processes agent events and dispatches to the handler.
func (sm *SessionManager) eventLoop(ctx context.Context) {
	events := sm.provider.Events()

	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-events:
			if !ok {
				// The provider event stream closed without a cancel: abnormal
				// disconnect (AC-11.5). Snapshot, notify, and stop — never retry
				// an ambiguous failure (AC-11.6).
				sm.onDisconnect()
				return
			}
			sm.handleEvent(evt)
		}
	}
}

// handleEvent dispatches a single agent event.
func (sm *SessionManager) handleEvent(evt voice.AgentEvent) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	switch evt.Type {
	case voice.EventTextDelta:
		sm.convo.OnTextDelta(evt.Content)
		if sm.lifecycle != nil {
			sm.lifecycle.Touch(time.Now())
		}
		if sm.handler != nil {
			sm.handler.OnTextDelta(evt.Content)
		}

	case voice.EventToolCall:
		sm.handleToolCall(evt)

	case voice.EventToolCallDelta:
		// Wait for complete call in EventToolCall.

	case voice.EventTurnEnd:
		sm.convo.OnTurnEnd()
		sm.bargeIn.SetResponseInactive()
		if sm.lifecycle != nil {
			sm.lifecycle.Touch(time.Now())
		}
		if sm.handler != nil {
			sm.handler.OnTurnEnd()
		}

	case voice.EventResponseCancelled:
		sm.convo.OnBargeIn()
		sm.bargeIn.SetResponseInactive()
		if sm.handler != nil {
			sm.handler.OnBargeIn()
		}

	case voice.EventSessionCreated:
		log.Println("voice session created")

	case voice.EventSessionUpdated:
		log.Println("voice session updated")

	case voice.EventInputAudioSpeechStarted:
		if sm.lifecycle != nil {
			sm.lifecycle.MarkActive(time.Now())
		}
		if triggered := sm.bargeIn.OnSpeechStart(); triggered {
			log.Println("barge-in triggered")
			if sm.handler != nil {
				sm.handler.OnBargeIn()
			}
		}

	case voice.EventInputAudioSpeechStopped:
		// Silence detected — used for state easing.

	case voice.EventError:
		log.Printf("voice agent error: %s", evt.Content)
		if sm.handler != nil {
			sm.handler.OnError(fmt.Errorf("agent: %s", evt.Content))
		}
	}
}

// handleToolCall processes a complete update_artifact tool call (DEC-4).
func (sm *SessionManager) handleToolCall(evt voice.AgentEvent) {
	if evt.ToolName != "update_artifact" {
		log.Printf("unknown tool call: %s", evt.ToolName)
		return
	}

	update, err := agent.ParseToolCall(evt.Content)
	if err != nil {
		log.Printf("parse tool call: %v", err)
		return
	}

	sm.convo.OnToolCall(update.Content)

	resultJSON := agent.ToolResultJSON(update, true)
	if err := sm.provider.SubmitToolResult(evt.CallID, resultJSON); err != nil {
		log.Printf("submit tool result: %v", err)
	}

	if sm.handler != nil {
		sm.handler.OnToolCall(update)
	}
}

// ProcessAudio feeds PCM samples to the voice agent.
func (sm *SessionManager) ProcessAudio(samples []int16) error {
	sm.mu.Lock()
	provider := sm.provider
	sm.mu.Unlock()

	if provider == nil {
		return nil
	}
	return provider.SendAudio(samples)
}

// Interrupt triggers a barge-in (R5 AC-5.2).
func (sm *SessionManager) Interrupt() {
	sm.bargeIn.OnSpeechStart()
}

// UpdateSystemPrompt regenerates the system prompt with current state (R8).
func (sm *SessionManager) UpdateSystemPrompt() error {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	cfg := sm.convo.PromptConfig(sm.contextFiles)
	_, err := agent.BuildSystemPrompt(cfg)
	if err != nil {
		return fmt.Errorf("build prompt: %w", err)
	}
	return nil
}

// State returns the current conversation state.
func (sm *SessionManager) State() TurnState {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	return TurnState(sm.convo.State())
}

// Conversation returns the conversation tracker.
func (sm *SessionManager) Conversation() *agent.Conversation {
	return sm.convo
}

// onDisconnect handles an abnormal provider disconnect (AC-11.5/11.6).
func (sm *SessionManager) onDisconnect() {
	sm.mu.Lock()
	handler := sm.handler
	if sm.lifecycle != nil {
		sm.lifecycle.EndCrash()
	}
	sm.mu.Unlock()
	if h, ok := handler.(DisconnectHandler); ok {
		h.OnDisconnect()
	}
}

// Lifecycle returns the S-1 lifecycle controller (R13 / AC-13.x).
func (sm *SessionManager) Lifecycle() *Lifecycle {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	if sm.lifecycle == nil {
		sm.lifecycle = NewLifecycle()
	}
	return sm.lifecycle
}

// Close tears down the session.
func (sm *SessionManager) Close() error {
	if sm.cancel != nil {
		sm.cancel()
	}
	if sm.provider != nil {
		return sm.provider.Close()
	}
	return nil
}
