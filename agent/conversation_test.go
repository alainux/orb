package agent_test

import (
	"testing"

	"github.com/alainux/orb/agent"
)

func TestConversation_New(t *testing.T) {
	c := agent.NewConversation()
	if c.State() != agent.TurnIdle {
		t.Errorf("initial state = %v, want TurnIdle", c.State())
	}
	if c.TurnCount() != 0 {
		t.Errorf("TurnCount = %d, want 0", c.TurnCount())
	}
	if c.QuestionCount() != 0 {
		t.Errorf("QuestionCount = %d, want 0", c.QuestionCount())
	}
	if c.ArtifactContent() != "" {
		t.Errorf("ArtifactContent = %q, want empty", c.ArtifactContent())
	}
}

func TestConversation_OnTextDelta(t *testing.T) {
	c := agent.NewConversation()
	c.OnTextDelta("Hello ")
	c.OnTextDelta("world")

	if c.State() != agent.TurnDrafting {
		t.Errorf("state = %v, want TurnDrafting", c.State())
	}
}

func TestConversation_OnTurnEnd_Question(t *testing.T) {
	c := agent.NewConversation()

	// Simulate a question turn.
	c.OnTextDelta("What kind of document do you want? ")
	c.OnTurnEnd()

	if c.TurnCount() != 1 {
		t.Errorf("TurnCount = %d, want 1", c.TurnCount())
	}
	if c.QuestionCount() != 1 {
		t.Errorf("QuestionCount = %d, want 1 (question detected)", c.QuestionCount())
	}
	if c.State() != agent.TurnIdle {
		t.Errorf("state = %v, want TurnIdle", c.State())
	}
}

func TestConversation_OnTurnEnd_Statement(t *testing.T) {
	c := agent.NewConversation()

	// Simulate a non-question turn.
	c.OnTextDelta("I'll start drafting now.")
	c.OnTurnEnd()

	if c.QuestionCount() != 0 {
		t.Errorf("QuestionCount = %d, want 0 (statement resets counter)", c.QuestionCount())
	}
}

func TestConversation_QuestionLimit(t *testing.T) {
	c := agent.NewConversation()

	// Ask 2 questions in a row.
	c.OnTextDelta("What is the topic? ")
	c.OnTurnEnd()
	if !c.CanAskQuestion() {
		t.Error("should be able to ask after 1 question")
	}

	c.OnTextDelta("What format do you prefer? ")
	c.OnTurnEnd()
	if c.CanAskQuestion() {
		t.Error("should NOT be able to ask after 2 questions")
	}
	if !c.MustDraft() {
		t.Error("MustDraft should be true after 2 questions")
	}
}

func TestConversation_OnToolCall_ResetsQuestionCount(t *testing.T) {
	c := agent.NewConversation()

	// Ask 2 questions.
	c.OnTextDelta("What is the topic? ")
	c.OnTurnEnd()
	c.OnTextDelta("What format? ")
	c.OnTurnEnd()
	if c.QuestionCount() != 2 {
		t.Fatalf("QuestionCount = %d, want 2", c.QuestionCount())
	}

	// Call tool (produces draft content) — should reset question count.
	c.OnToolCall("# Draft\n\nHere is the document.")
	if c.QuestionCount() != 0 {
		t.Errorf("QuestionCount = %d, want 0 after tool call", c.QuestionCount())
	}
	if c.ArtifactContent() != "# Draft\n\nHere is the document." {
		t.Errorf("ArtifactContent not updated")
	}
}

func TestConversation_OnBargeIn(t *testing.T) {
	c := agent.NewConversation()
	c.OnTextDelta("This is a partial response...")
	c.OnBargeIn()

	if c.State() != agent.TurnListening {
		t.Errorf("state = %v, want TurnListening after barge-in", c.State())
	}
}

func TestConversation_Reset(t *testing.T) {
	c := agent.NewConversation()
	c.OnTextDelta("Hello?")
	c.OnTurnEnd()
	c.OnToolCall("content")

	c.Reset()

	if c.TurnCount() != 0 {
		t.Errorf("TurnCount = %d, want 0 after reset", c.TurnCount())
	}
	if c.QuestionCount() != 0 {
		t.Errorf("QuestionCount = %d, want 0 after reset", c.QuestionCount())
	}
	if c.ArtifactContent() != "" {
		t.Errorf("ArtifactContent = %q, want empty after reset", c.ArtifactContent())
	}
}

func TestConversation_PromptConfig(t *testing.T) {
	c := agent.NewConversation()
	c.OnTextDelta("What is the topic? ")
	c.OnTurnEnd()
	c.OnToolCall("some content")

	cfg := c.PromptConfig([]string{"file1.md", "file2.md"})

	if cfg.TurnCount != 1 {
		t.Errorf("TurnCount = %d, want 1", cfg.TurnCount)
	}
	if cfg.ArtifactContent != "some content" {
		t.Errorf("ArtifactContent = %q, want 'some content'", cfg.ArtifactContent)
	}
	if len(cfg.ContextFiles) != 2 {
		t.Errorf("ContextFiles len = %d, want 2", len(cfg.ContextFiles))
	}
}

func TestConversation_MultipleQuestionStatementQuestion(t *testing.T) {
	c := agent.NewConversation()

	// Question → resets to 1
	c.OnTextDelta("What topic? ")
	c.OnTurnEnd()
	if c.QuestionCount() != 1 {
		t.Errorf("after 1st question: QuestionCount = %d, want 1", c.QuestionCount())
	}

	// Statement → resets counter
	c.OnTextDelta("I see, let me draft that.")
	c.OnTurnEnd()
	if c.QuestionCount() != 0 {
		t.Errorf("after statement: QuestionCount = %d, want 0", c.QuestionCount())
	}

	// Question again → back to 1
	c.OnTextDelta("Any specific format? ")
	c.OnTurnEnd()
	if c.QuestionCount() != 1 {
		t.Errorf("after new question: QuestionCount = %d, want 1", c.QuestionCount())
	}
}
