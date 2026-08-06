package session

import (
	"sync"

	"github.com/alainux/orb/voice"
)

// BargeInMonitor watches VAD state transitions and triggers provider
// interrupts when speech onset occurs during an agent response.
// This implements the client-side barge-in per DEC-6 and R5 AC-5.1–5.2.
//
// The monitor is driven by the session manager's main loop:
//  1. VAD detects speech onset → BargeInMonitor.OnSpeechStart()
//  2. If agent is responding → provider.Interrupt() is called
//  3. Orb state transitions to Bloom spike (handled by TUI, not here)
type BargeInMonitor struct {
	provider   voice.Provider
	mu         sync.Mutex
	inResponse bool
	responseID string
	itemID     string
	audioEndMS int
	enabled    bool
	onBargeIn  func()
}

// NewBargeInMonitor creates a monitor that triggers interrupts on the provider.
func NewBargeInMonitor(provider voice.Provider) *BargeInMonitor {
	return &BargeInMonitor{
		provider: provider,
		enabled:  true,
	}
}

// SetOnBargeIn sets an optional callback invoked when a barge-in occurs.
func (m *BargeInMonitor) SetOnBargeIn(fn func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.onBargeIn = fn
}

// Enable turns the monitor on or off.
func (m *BargeInMonitor) Enable(on bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.enabled = on
}

// SetResponseActive marks the start of a server response.
func (m *BargeInMonitor) SetResponseActive(responseID, itemID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inResponse = true
	m.responseID = responseID
	m.itemID = itemID
	m.audioEndMS = 0
}

// SetResponseInactive marks the end of a server response.
func (m *BargeInMonitor) SetResponseInactive() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.inResponse = false
	m.responseID = ""
	m.itemID = ""
	m.audioEndMS = 0
}

// UpdateAudioEndMS updates the estimated playback position for truncation.
func (m *BargeInMonitor) UpdateAudioEndMS(ms int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.audioEndMS = ms
}

// OnSpeechStart is called when the client VAD detects speech onset.
// If the agent is currently responding, this triggers a barge-in interrupt.
// Returns true if a barge-in was triggered (R5 AC-5.2).
func (m *BargeInMonitor) OnSpeechStart() bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	if !m.enabled || !m.inResponse {
		return false
	}

	_ = m.provider.Interrupt()

	if m.onBargeIn != nil {
		m.onBargeIn()
	}

	m.inResponse = false
	m.responseID = ""
	m.itemID = ""

	return true
}

// InResponse returns whether the agent is currently responding.
func (m *BargeInMonitor) InResponse() bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.inResponse
}
