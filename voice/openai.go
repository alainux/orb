package voice

import (
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	// openaiRealtimeURL is the WebSocket endpoint for the Realtime API.
	openaiRealtimeURL = "wss://api.openai.com/v1/realtime"

	// openaiTokenURL is the ephemeral token endpoint.
	openaiTokenURL = "https://api.openai.com/v1/realtime/client_secrets"

	// defaultModel is the default Realtime model when none specified.
	defaultModel = "gpt-4o-realtime-preview"

	// sendAudioChunkSize is the max number of PCM samples per WebSocket frame.
	// ~20ms at 24kHz = 480 samples; base64 expands 4:3.
	sendAudioChunkSize = 480

	// wsWriteTimeout is the timeout for WebSocket write operations.
	wsWriteTimeout = 5 * time.Second

	// wsReadBufferSize is the WebSocket read buffer size.
	wsReadBufferSize = 64 * 1024

	// wsWriteBufferSize is the WebSocket write buffer size.
	wsWriteBufferSize = 64 * 1024
)

// OpenAIProvider implements Provider for the OpenAI Realtime API.
// It connects via WebSocket with a standard API key (server-to-server).
type OpenAIProvider struct {
	apiKey string
	model  string

	conn   *websocket.Conn
	events chan AgentEvent
	cancel context.CancelFunc
	wg     sync.WaitGroup

	mu         sync.Mutex
	inResponse bool   // true while processing a server response
	currentID  string // current response ID for barge-in truncation
	itemID     string // current conversation item ID
}

// NewOpenAIProvider creates a new OpenAI Realtime API provider.
func NewOpenAIProvider() *OpenAIProvider {
	return &OpenAIProvider{
		events: make(chan AgentEvent, 64),
	}
}

// Connect establishes a WebSocket connection to the OpenAI Realtime API.
// It uses the API key directly for server-to-server authentication (DEC-1).
func (p *OpenAIProvider) Connect(ctx context.Context, cfg ProviderConfig) error {
	p.apiKey = cfg.APIKey
	if p.apiKey == "" {
		return fmt.Errorf("openai: API key is required")
	}

	p.model = cfg.Model
	if p.model == "" {
		p.model = defaultModel
	}

	ctx, cancel := context.WithCancel(ctx)
	p.cancel = cancel

	// Connect WebSocket directly with API key (server-to-server).
	wsURL := fmt.Sprintf("%s?model=%s", openaiRealtimeURL, p.model)

	dialer := websocket.Dialer{
		ReadBufferSize:  wsReadBufferSize,
		WriteBufferSize: wsWriteBufferSize,
	}

	header := http.Header{}
	header.Set("Authorization", "Bearer "+p.apiKey)

	conn, _, err := dialer.DialContext(ctx, wsURL, header)
	if err != nil {
		cancel()
		return fmt.Errorf("openai: WebSocket dial: %w", err)
	}
	p.conn = conn

	// Start reader goroutine.
	p.wg.Add(1)
	go p.readLoop(ctx)

	// Wait for session.created event.
	select {
	case evt := <-p.events:
		if evt.Type != EventSessionCreated {
			cancel()
			p.conn.Close()
			return fmt.Errorf("openai: expected session.created, got %s", evt.Type)
		}
	case <-ctx.Done():
		p.conn.Close()
		return ctx.Err()
	case <-time.After(10 * time.Second):
		cancel()
		p.conn.Close()
		return fmt.Errorf("openai: timeout waiting for session.created")
	}

	// Configure the session: PCM16 24kHz, text output, instructions, tools.
	if err := p.configureSession(cfg); err != nil {
		cancel()
		p.conn.Close()
		return fmt.Errorf("openai: configure session: %w", err)
	}

	// Wait for session.updated.
	select {
	case evt := <-p.events:
		if evt.Type != EventSessionUpdated {
			cancel()
			p.conn.Close()
			return fmt.Errorf("openai: expected session.updated, got %s", evt.Type)
		}
	case <-ctx.Done():
		p.conn.Close()
		return ctx.Err()
	case <-time.After(10 * time.Second):
		cancel()
		p.conn.Close()
		return fmt.Errorf("openai: timeout waiting for session.updated")
	}

	return nil
}

// configureSession sends the session.update event with audio config,
// instructions, and tools (spec R8, R6, DEC-1).
func (p *OpenAIProvider) configureSession(cfg ProviderConfig) error {
	// Build tools array for the session.
	var tools []map[string]interface{}
	for _, t := range cfg.Tools {
		tool := map[string]interface{}{
			"type":        "function",
			"name":        t.Name,
			"description": t.Description,
			"parameters":  t.Parameters,
		}
		tools = append(tools, tool)
	}

	session := map[string]interface{}{
		"type":             "realtime",
		"model":            p.model,
		"output_modalities": cfg.OutputModalities,
		"audio": map[string]interface{}{
			"input": map[string]interface{}{
				"format": map[string]interface{}{
					"type": "audio/pcm",
					"rate": cfg.SampleRate,
				},
				"turn_detection": map[string]interface{}{
					"type": "server_vad",
				},
			},
			"output": map[string]interface{}{
				"format": map[string]interface{}{
					"type": "audio/pcm",
				},
			},
		},
	}

	if cfg.Instructions != "" {
		session["instructions"] = cfg.Instructions
	}

	if len(tools) > 0 {
		session["tools"] = tools
		session["tool_choice"] = "auto"
	}

	update := map[string]interface{}{
		"type":    "session.update",
		"session": session,
	}

	return p.sendJSON(update)
}

// SendAudio streams PCM samples to the Realtime API via WebSocket.
// Samples are base64-encoded in chunks of ~20ms (DEC-1, R3 AC-3.1).
func (p *OpenAIProvider) SendAudio(samples []int16) error {
	if p.conn == nil {
		return fmt.Errorf("openai: not connected")
	}

	// Chunk samples into ~20ms frames (480 samples at 24kHz).
	for i := 0; i < len(samples); i += sendAudioChunkSize {
		end := i + sendAudioChunkSize
		if end > len(samples) {
			end = len(samples)
		}
		chunk := samples[i:end]

		// Encode PCM int16 to bytes, then base64.
		b64 := encodePCM16(chunk)

		msg := map[string]interface{}{
			"type":  "input_audio_buffer.append",
			"audio": b64,
		}

		if err := p.sendJSON(msg); err != nil {
			return fmt.Errorf("openai: send audio: %w", err)
		}
	}

	return nil
}

// Events returns the channel of agent events.
func (p *OpenAIProvider) Events() <-chan AgentEvent {
	return p.events
}

// Interrupt signals a barge-in by clearing the input audio buffer and
// cancelling any in-progress response (R5 AC-5.2, DEC-6).
func (p *OpenAIProvider) Interrupt() error {
	p.mu.Lock()
	inResponse := p.inResponse
	itemID := p.itemID
	p.mu.Unlock()

	if !inResponse {
		return nil
	}

	// Clear the input audio buffer.
	if err := p.sendJSON(map[string]interface{}{
		"type": "input_audio_buffer.clear",
	}); err != nil {
		return fmt.Errorf("openai: interrupt clear: %w", err)
	}

	// Truncate the current response at 0ms (discard unplayed).
	if itemID != "" {
		if err := p.sendJSON(map[string]interface{}{
			"type":          "conversation.item.truncate",
			"item_id":       itemID,
			"content_index": 0,
			"audio_end_ms":  0,
		}); err != nil {
			return fmt.Errorf("openai: interrupt truncate: %w", err)
		}
	}

	// Cancel the in-progress response.
	if err := p.sendJSON(map[string]interface{}{
		"type": "response.cancel",
	}); err != nil {
		return fmt.Errorf("openai: interrupt cancel: %w", err)
	}

	return nil
}

// SubmitToolResult sends a function call result back to the agent (DEC-4).
func (p *OpenAIProvider) SubmitToolResult(callID string, output string) error {
	return p.sendJSON(map[string]interface{}{
		"type": "conversation.item.create",
		"item": map[string]interface{}{
			"type":    "function_call_output",
			"call_id": callID,
			"output":  output,
		},
	})
}

// Close tears down the WebSocket connection and waits for the reader to exit.
func (p *OpenAIProvider) Close() error {
	if p.cancel != nil {
		p.cancel()
	}
	if p.conn != nil {
		// Send close frame, then close the underlying connection.
		p.conn.WriteMessage(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		p.conn.Close()
	}
	p.wg.Wait()
	close(p.events)
	return nil
}

// sendJSON writes a JSON message to the WebSocket with a write timeout.
func (p *OpenAIProvider) sendJSON(v interface{}) error {
	if p.conn == nil {
		return fmt.Errorf("openai: not connected")
	}
	p.conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return p.conn.WriteJSON(v)
}

// readLoop reads WebSocket messages and parses them into AgentEvents.
// It runs until the connection is closed or the context is cancelled.
func (p *OpenAIProvider) readLoop(ctx context.Context) {
	defer p.wg.Done()

	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		_, message, err := p.conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(err,
				websocket.CloseNormalClosure,
				websocket.CloseGoingAway) {
				return
			}
			if ctx.Err() != nil {
				return
			}
			// Connection error — emit and return.
			p.emitEvent(AgentEvent{
				Type:    EventError,
				Content: fmt.Sprintf("WebSocket read: %v", err),
			})
			return
		}

		p.parseServerEvent(message)
	}
}

// parseServerEvent dispatches a raw WebSocket message to the appropriate
// AgentEvent type on the events channel.
func (p *OpenAIProvider) parseServerEvent(raw []byte) {
	var base struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal(raw, &base); err != nil {
		return
	}

	switch base.Type {
	case "session.created":
		p.emitEvent(AgentEvent{Type: EventSessionCreated})

	case "session.updated":
		p.emitEvent(AgentEvent{Type: EventSessionUpdated})

	case "response.output_text.delta":
		var evt struct {
			Delta string `json:"delta"`
		}
		if err := json.Unmarshal(raw, &evt); err == nil {
			p.emitEvent(AgentEvent{
				Type:    EventTextDelta,
				Content: evt.Delta,
			})
		}

	case "response.function_call_arguments.delta":
		var evt struct {
			CallID    string `json:"call_id"`
			Name      string `json:"name"`
			Delta     string `json:"delta"`
			ResponseID string `json:"response_id"`
		}
		if err := json.Unmarshal(raw, &evt); err == nil {
			p.emitEvent(AgentEvent{
				Type:       EventToolCallDelta,
				Content:    evt.Delta,
				ToolName:   evt.Name,
				CallID:     evt.CallID,
				ResponseID: evt.ResponseID,
			})
		}

	case "response.done":
		var evt struct {
			Response struct {
				ID     string `json:"id"`
				Output []struct {
					Type      string `json:"type"`
					Name      string `json:"name"`
					CallID    string `json:"call_id"`
					Arguments string `json:"arguments"`
				} `json:"output"`
			} `json:"response"`
		}
		if err := json.Unmarshal(raw, &evt); err == nil {
			// Check for function calls in the completed response.
			for _, out := range evt.Response.Output {
				if out.Type == "function_call" {
					p.emitEvent(AgentEvent{
						Type:       EventToolCall,
						Content:    out.Arguments,
						ToolName:   out.Name,
						CallID:     out.CallID,
						ResponseID: evt.Response.ID,
					})
				}
			}
			// Turn end.
			p.emitEvent(AgentEvent{
				Type:       EventTurnEnd,
				ResponseID: evt.Response.ID,
			})
			p.mu.Lock()
			p.inResponse = false
			p.mu.Unlock()
		}

	case "response.created":
		var evt struct {
			Response struct {
				ID string `json:"id"`
			} `json:"response"`
		}
		if err := json.Unmarshal(raw, &evt); err == nil {
			p.mu.Lock()
			p.inResponse = true
			p.currentID = evt.Response.ID
			p.mu.Unlock()
		}

	case "conversation.item.added":
		var evt struct {
			Item struct {
				ID   string `json:"id"`
				Type string `json:"type"`
			} `json:"item"`
		}
		if err := json.Unmarshal(raw, &evt); err == nil {
			p.mu.Lock()
			if evt.Item.Type == "message" || evt.Item.Type == "function_call" {
				p.itemID = evt.Item.ID
			}
			p.mu.Unlock()
		}

	case "input_audio_buffer.speech_started":
		p.emitEvent(AgentEvent{Type: EventInputAudioSpeechStarted})

	case "input_audio_buffer.speech_stopped":
		p.emitEvent(AgentEvent{Type: EventInputAudioSpeechStopped})

	case "response.cancelled", "response.canceled":
		p.emitEvent(AgentEvent{Type: EventResponseCancelled})
		p.mu.Lock()
		p.inResponse = false
		p.mu.Unlock()

	case "error":
		var evt struct {
			Error struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(raw, &evt); err == nil {
			p.emitEvent(AgentEvent{
				Type:    EventError,
				Content: evt.Error.Message,
			})
		}
	}
}

// emitEvent sends an event to the events channel, dropping if full.
func (p *OpenAIProvider) emitEvent(evt AgentEvent) {
	select {
	case p.events <- evt:
	default:
		// Channel full — drop oldest events to avoid blocking the reader.
		select {
		case <-p.events:
		default:
		}
		p.events <- evt
	}
}

// encodePCM16 encodes a slice of int16 PCM samples to a base64 string.
// The format is 16-bit little-endian PCM, matching the Realtime API's pcm16 spec.
func encodePCM16(samples []int16) string {
	buf := make([]byte, len(samples)*2)
	for i, s := range samples {
		binary.LittleEndian.PutUint16(buf[i*2:], uint16(s))
	}
	return base64.StdEncoding.EncodeToString(buf)
}

// --- Ephemeral token exchange (for client-side / WebRTC use) ---

// EphemeralTokenResponse is the response from POST /v1/realtime/client_secrets.
type EphemeralTokenResponse struct {
	Value     string `json:"value"`
	ExpiresAt int64  `json:"expires_at"`
}

// FetchEphemeralToken obtains a short-lived token from the OpenAI API
// for client-side Realtime connections (WebRTC). For server-to-server
// WebSocket connections, use the API key directly instead.
func FetchEphemeralToken(ctx context.Context, apiKey, model string, expiresSec int) (*EphemeralTokenResponse, error) {
	if model == "" {
		model = defaultModel
	}
	if expiresSec <= 0 {
		expiresSec = 60
	}

	body := map[string]interface{}{
		"model": model,
		"expires_after": map[string]interface{}{
			"anchor":  "created_at",
			"seconds": expiresSec,
		},
	}
	bodyBytes, _ := json.Marshal(body)

	req, err := http.NewRequestWithContext(ctx, "POST", openaiTokenURL,
		strings.NewReader(string(bodyBytes)))
	if err != nil {
		return nil, fmt.Errorf("openai token: new request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai token: request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("openai token: read body: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("openai token: status %d: %s", resp.StatusCode, string(respBody))
	}

	var tokenResp EphemeralTokenResponse
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		return nil, fmt.Errorf("openai token: parse: %w", err)
	}

	return &tokenResp, nil
}
