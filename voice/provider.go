package voice

import (
	"context"
)

// ProviderConfig holds the configuration for connecting to a voice agent API.
type ProviderConfig struct {
	// APIKey is the provider's API key (from env or config file).
	APIKey string

	// Model is the LLM model identifier (e.g. "gpt-4o-realtime-preview").
	Model string

	// Instructions is the system prompt / instructions for the agent.
	Instructions string

	// Tools defines the function tools available to the agent.
	Tools []ToolDef

	// SampleRate is the PCM sample rate for audio (24000 for orb).
	SampleRate int

	// OutputModalities controls what the agent returns ("text", "audio", or both).
	OutputModalities []string
}

// Provider is the abstraction over a realtime voice agent API.
// Implementations stream audio from the client to the API and emit
// AgentEvents (text deltas, tool calls, turn ends) back to the caller.
//
// Spec references: R3 (AC-3.2), DEC-1 (pluggable provider).
type Provider interface {
	// Connect establishes a session with the voice agent API.
	// After Connect returns successfully, SendAudio and the event channel
	// are available for use.
	Connect(ctx context.Context, cfg ProviderConfig) error

	// SendAudio streams a chunk of 16-bit 24kHz mono PCM to the API.
	// The implementation handles base64 encoding and framing.
	SendAudio(samples []int16) error

	// Events returns a read-only channel of agent events. The channel is
	// closed when the session ends or the context is cancelled.
	Events() <-chan AgentEvent

	// Interrupt signals a barge-in: the client's VAD detected speech while
	// the agent was responding. The implementation cancels any in-progress
	// server response.
	Interrupt() error

	// SubmitToolResult sends the result of a tool call back to the agent.
	// callID is the ID from the original function call; output is a JSON string.
	SubmitToolResult(callID string, output string) error

	// Close tears down the session and releases resources.
	Close() error
}

// BargeInTrigger is called by the session manager when the client VAD
// detects speech onset during an agent response. The provider implementation
// uses this to cancel the in-progress response and truncate the output.
type BargeInTrigger interface {
	// OnBargeIn is called when the client VAD transitions from idle to
	// listening while the agent is responding. itemID and audioEndMS
	// identify what to truncate.
	OnBargeIn(itemID string, audioEndMS int) error
}
