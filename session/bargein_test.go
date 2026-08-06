package session_test

import (
	"testing"

	"github.com/alainux/orb/session"
	"github.com/alainux/orb/voice"
)

func TestBargeInMonitor_NoResponse(t *testing.T) {
	m := voice.NewMockProvider()
	mon := session.NewBargeInMonitor(m)

	// Speech start when no response is active → no barge-in.
	triggered := mon.OnSpeechStart()
	if triggered {
		t.Error("should not trigger barge-in when no response is active")
	}
	if m.Interrupted {
		t.Error("provider should not be interrupted")
	}
}

func TestBargeInMonitor_WithResponse(t *testing.T) {
	m := voice.NewMockProvider()
	mon := session.NewBargeInMonitor(m)

	// Mark response as active.
	mon.SetResponseActive("resp_1", "item_1")
	if !mon.InResponse() {
		t.Fatal("InResponse should be true after SetResponseActive")
	}

	// Speech start during response → barge-in triggered.
	triggered := mon.OnSpeechStart()
	if !triggered {
		t.Error("should trigger barge-in when response is active")
	}
	if !m.Interrupted {
		t.Error("provider should be interrupted")
	}
	if mon.InResponse() {
		t.Error("InResponse should be false after barge-in")
	}
}

func TestBargeInMonitor_Disabled(t *testing.T) {
	m := voice.NewMockProvider()
	mon := session.NewBargeInMonitor(m)
	mon.Enable(false)
	mon.SetResponseActive("resp_1", "item_1")

	triggered := mon.OnSpeechStart()
	if triggered {
		t.Error("should not trigger when disabled")
	}
}

func TestBargeInMonitor_Callback(t *testing.T) {
	m := voice.NewMockProvider()
	mon := session.NewBargeInMonitor(m)

	callbackFired := false
	mon.SetOnBargeIn(func() {
		callbackFired = true
	})

	mon.SetResponseActive("resp_1", "item_1")
	mon.OnSpeechStart()

	if !callbackFired {
		t.Error("barge-in callback should have fired")
	}
}

func TestBargeInMonitor_SetResponseInactive(t *testing.T) {
	m := voice.NewMockProvider()
	mon := session.NewBargeInMonitor(m)

	mon.SetResponseActive("resp_1", "item_1")
	mon.SetResponseInactive()

	if mon.InResponse() {
		t.Error("InResponse should be false after SetResponseInactive")
	}

	// Speech start after response ended → no barge-in.
	triggered := mon.OnSpeechStart()
	if triggered {
		t.Error("should not trigger after response ended")
	}
}

func TestBargeInMonitor_UpdateAudioEndMS(t *testing.T) {
	m := voice.NewMockProvider()
	mon := session.NewBargeInMonitor(m)

	// Just verify it doesn't panic.
	mon.UpdateAudioEndMS(1500)
	mon.UpdateAudioEndMS(0)
}

func TestBargeInMonitor_MultipleRounds(t *testing.T) {
	m := voice.NewMockProvider()
	mon := session.NewBargeInMonitor(m)

	// Round 1: response active → barge-in
	mon.SetResponseActive("resp_1", "item_1")
	mon.OnSpeechStart()
	if m.Interrupted != true {
		t.Error("should interrupt in round 1")
	}

	// Reset mock.
	m.Interrupted = false

	// Round 2: new response → barge-in again
	mon.SetResponseActive("resp_2", "item_2")
	mon.OnSpeechStart()
	if m.Interrupted != true {
		t.Error("should interrupt in round 2")
	}
}
