package voice

import (
	"context"
	"fmt"
)

// DeepgramProvider is a placeholder for the Deepgram Voice Agent provider.
// It is not yet implemented — the OpenAI provider is the default (DEC-1).
type DeepgramProvider struct{}

// NewDeepgramProvider creates a stub Deepgram provider.
func NewDeepgramProvider() *DeepgramProvider {
	return &DeepgramProvider{}
}

// Connect returns an error — Deepgram Voice Agent is not yet implemented.
func (d *DeepgramProvider) Connect(_ context.Context, _ ProviderConfig) error {
	return fmt.Errorf("deepgram: not implemented (use openai provider)")
}

// SendAudio is a stub.
func (d *DeepgramProvider) SendAudio(_ []int16) error {
	return fmt.Errorf("deepgram: not implemented")
}

// Events returns nil — not implemented.
func (d *DeepgramProvider) Events() <-chan AgentEvent {
	return nil
}

// Interrupt is a stub.
func (d *DeepgramProvider) Interrupt() error {
	return fmt.Errorf("deepgram: not implemented")
}

// SubmitToolResult is a stub.
func (d *DeepgramProvider) SubmitToolResult(_, _ string) error {
	return fmt.Errorf("deepgram: not implemented")
}

// Close is a stub.
func (d *DeepgramProvider) Close() error {
	return nil
}
