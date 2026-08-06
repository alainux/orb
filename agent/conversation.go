package agent

import (
	"strings"
)

const (
	// MaxConsecutiveQuestions is the maximum questions in a row without
	// producing draft content (R17 AC-17.4).
	MaxConsecutiveQuestions = 2

	// TurnEndDelayMs is the debounce window for turn-end events.
	TurnEndDelayMs = 500
)

// TurnState tracks the state of a single conversation turn.
type TurnState int

const (
	// TurnIdle indicates no active turn.
	TurnIdle TurnState = iota

	// TurnListening indicates the user is speaking (VAD detected speech).
	TurnListening

	// TurnProcessing indicates the server is processing the user's input.
	TurnProcessing

	// TurnDrafting indicates the agent is streaming text / tool calls.
	TurnDrafting
)

// String returns a human-readable label for the turn state.
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

// Conversation manages conversation turn state and enforces the agent's
// conversational policy (R17): max 2 consecutive questions, then must draft.
type Conversation struct {
	state           TurnState
	turnCount       int  // total completed turns
	questionCount   int  // consecutive questions without drafting
	textBuffer      string // accumulated text delta for current turn
	artifactContent string // current artifact content (from latest tool call)
}

// NewConversation creates a new conversation tracker in idle state.
func NewConversation() *Conversation {
	return &Conversation{
		state: TurnIdle,
	}
}

// State returns the current turn state.
func (c *Conversation) State() TurnState {
	return c.state
}

// SetState updates the turn state.
func (c *Conversation) SetState(state TurnState) {
	c.state = state
}

// TurnCount returns the total number of completed conversation turns.
func (c *Conversation) TurnCount() int {
	return c.turnCount
}

// QuestionCount returns the number of consecutive questions without drafting.
func (c *Conversation) QuestionCount() int {
	return c.questionCount
}

// ArtifactContent returns the current artifact content.
func (c *Conversation) ArtifactContent() string {
	return c.artifactContent
}

// OnTextDelta is called when a text delta arrives from the agent.
// It accumulates text and tracks whether the turn is a question.
func (c *Conversation) OnTextDelta(delta string) {
	c.textBuffer += delta
	c.state = TurnDrafting
}

// OnTurnEnd is called when the agent finishes a response turn.
// It checks whether the turn was a question (incrementing questionCount)
// or produced content (resetting questionCount).
func (c *Conversation) OnTurnEnd() {
	c.turnCount++

	text := strings.TrimSpace(c.textBuffer)

	// Detect if the turn was a question (ends with '?' or contains '?' as
	// the final punctuation of the meaningful content).
	if isQuestion(text) {
		c.questionCount++
	} else {
		// Any non-question turn resets the consecutive question counter
		// (the agent produced draft content or made a statement).
		c.questionCount = 0
	}

	c.textBuffer = ""
	c.state = TurnIdle
}

// OnToolCall is called when the agent calls update_artifact.
// It updates the artifact content and resets the question counter
// (producing draft content is the explicit requirement from R17 AC-17.4).
func (c *Conversation) OnToolCall(content string) {
	c.artifactContent = content
	c.questionCount = 0
}

// OnBargeIn is called when the user interrupts the agent (barge-in).
// It truncates the current turn and resets the text buffer.
func (c *Conversation) OnBargeIn() {
	c.textBuffer = ""
	c.state = TurnListening
}

// CanAskQuestion returns true if the agent is still within the 2-question limit.
// R17 AC-17.4: "never more than 2 questions in a row without producing draft content."
func (c *Conversation) CanAskQuestion() bool {
	return c.questionCount < MaxConsecutiveQuestions
}

// MustDraft returns true if the agent has hit the question limit and
// must produce draft content (call update_artifact) before asking more questions.
func (c *Conversation) MustDraft() bool {
	return c.questionCount >= MaxConsecutiveQuestions
}

// Reset clears all conversation state. Used when starting a new session.
func (c *Conversation) Reset() {
	c.state = TurnIdle
	c.turnCount = 0
	c.questionCount = 0
	c.textBuffer = ""
	c.artifactContent = ""
}

// PromptConfig returns a PromptConfig suitable for BuildSystemPrompt,
// incorporating the current conversation state.
func (c *Conversation) PromptConfig(contextFiles []string) PromptConfig {
	return PromptConfig{
		ContextFiles:    contextFiles,
		ArtifactContent: c.artifactContent,
		TurnCount:       c.turnCount,
		QuestionCount:   c.questionCount,
	}
}

// isQuestion heuristic: the text ends with '?' and contains actual content.
func isQuestion(text string) bool {
	if len(text) == 0 {
		return false
	}
	// Trim trailing whitespace and check last meaningful character.
	trimmed := strings.TrimRight(text, " \t\n\r")
	if len(trimmed) == 0 {
		return false
	}
	return trimmed[len(trimmed)-1] == '?'
}
