package agent_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alainux/orb/agent"
)

func TestBuildSystemPrompt_Basic(t *testing.T) {
	prompt, err := agent.BuildSystemPrompt(agent.PromptConfig{})
	if err != nil {
		t.Fatalf("BuildSystemPrompt returned error: %v", err)
	}
	if prompt == "" {
		t.Fatal("BuildSystemPrompt returned empty prompt")
	}
	// Should contain the role description.
	if !containsSubstr(prompt, "document drafting agent") {
		t.Error("prompt should contain role description")
	}
	// Should mention update_artifact.
	if !containsSubstr(prompt, "update_artifact") {
		t.Error("prompt should mention update_artifact")
	}
}

func TestBuildSystemPrompt_SessionStart(t *testing.T) {
	prompt, err := agent.BuildSystemPrompt(agent.PromptConfig{TurnCount: 0})
	if err != nil {
		t.Fatalf("BuildSystemPrompt returned error: %v", err)
	}
	if !containsSubstr(prompt, "Session Start") {
		t.Error("prompt should contain session start instructions for turn 0")
	}
}

func TestBuildSystemPrompt_MustDraft(t *testing.T) {
	prompt, err := agent.BuildSystemPrompt(agent.PromptConfig{
		TurnCount:     3,
		QuestionCount: 2,
	})
	if err != nil {
		t.Fatalf("BuildSystemPrompt returned error: %v", err)
	}
	if !containsSubstr(prompt, "MUST now produce draft content") {
		t.Error("prompt should instruct agent to produce draft when question limit hit")
	}
}

func TestBuildSystemPrompt_WithArtifact(t *testing.T) {
	prompt, err := agent.BuildSystemPrompt(agent.PromptConfig{
		ArtifactContent: "# My Document\n\nHello world.",
		TurnCount:       1,
	})
	if err != nil {
		t.Fatalf("BuildSystemPrompt returned error: %v", err)
	}
	if !containsSubstr(prompt, "# My Document") {
		t.Error("prompt should contain current artifact content")
	}
}

func TestBuildSystemPrompt_WithValidContextFiles(t *testing.T) {
	dir := t.TempDir()
	f1 := filepath.Join(dir, "context1.md")
	f2 := filepath.Join(dir, "context2.txt")

	if err := os.WriteFile(f1, []byte("# Context 1\nSome context."), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f2, []byte("Plain text context."), 0o644); err != nil {
		t.Fatal(err)
	}

	prompt, err := agent.BuildSystemPrompt(agent.PromptConfig{
		ContextFiles: []string{f1, f2},
	})
	if err != nil {
		t.Fatalf("BuildSystemPrompt returned error: %v", err)
	}
	if !containsSubstr(prompt, "Context Files") {
		t.Error("prompt should contain Context Files section")
	}
	if !containsSubstr(prompt, "# Context 1") {
		t.Error("prompt should contain context1.md content")
	}
	if !containsSubstr(prompt, "Plain text context.") {
		t.Error("prompt should contain context2.txt content")
	}
}

func TestBuildSystemPrompt_TooManyContextFiles(t *testing.T) {
	dir := t.TempDir()
	var paths []string
	for i := 0; i < 11; i++ {
		p := filepath.Join(dir, "file.md")
		os.WriteFile(p, []byte("content"), 0o644)
		paths = append(paths, p)
	}

	_, err := agent.BuildSystemPrompt(agent.PromptConfig{
		ContextFiles: paths,
	})
	if err == nil {
		t.Fatal("expected error for too many context files")
	}
}

func TestBuildSystemPrompt_ContextFileTooLarge(t *testing.T) {
	dir := t.TempDir()
	big := filepath.Join(dir, "big.md")

	// Create a file >50KB.
	data := make([]byte, 60*1024)
	for i := range data {
		data[i] = 'a'
	}
	if err := os.WriteFile(big, data, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := agent.BuildSystemPrompt(agent.PromptConfig{
		ContextFiles: []string{big},
	})
	if err == nil {
		t.Fatal("expected error for too-large context file")
	}
}

func TestBuildSystemPrompt_InvalidUTF8(t *testing.T) {
	dir := t.TempDir()
	bad := filepath.Join(dir, "bad.md")

	// Write invalid UTF-8 bytes.
	if err := os.WriteFile(bad, []byte{0xff, 0xfe, 'h', 'i'}, 0o644); err != nil {
		t.Fatal(err)
	}

	_, err := agent.BuildSystemPrompt(agent.PromptConfig{
		ContextFiles: []string{bad},
	})
	if err == nil {
		t.Fatal("expected error for invalid UTF-8 file")
	}
}

func TestBuildSystemPrompt_ContextFileNotFound(t *testing.T) {
	_, err := agent.BuildSystemPrompt(agent.PromptConfig{
		ContextFiles: []string{"/nonexistent/file.md"},
	})
	if err == nil {
		t.Fatal("expected error for nonexistent context file")
	}
}

func TestEstimatePromptSize(t *testing.T) {
	prompt := "Hello world"
	size := agent.EstimatePromptSize(prompt)
	if size != 11 {
		t.Errorf("EstimatePromptSize = %d, want 11", size)
	}
}

func TestBuildSystemPrompt_FullSession(t *testing.T) {
	// Simulate a session with context files, artifact, and questions.
	dir := t.TempDir()
	ctx := filepath.Join(dir, "notes.md")
	os.WriteFile(ctx, []byte("# Notes\nThese are my notes."), 0o644)

	prompt, err := agent.BuildSystemPrompt(agent.PromptConfig{
		ContextFiles:    []string{ctx},
		ArtifactContent: "# My Essay\n\nDraft content here.",
		TurnCount:       5,
		QuestionCount:   0,
	})
	if err != nil {
		t.Fatalf("BuildSystemPrompt returned error: %v", err)
	}

	// Should have all sections.
	checks := []string{
		"document drafting agent",
		"update_artifact",
		"Context Files",
		"# Notes",
		"# My Essay",
	}
	for _, check := range checks {
		if !containsSubstr(prompt, check) {
			t.Errorf("prompt missing %q", check)
		}
	}
	// Should NOT contain session start or must-draft (turn 5, question 0).
	if containsSubstr(prompt, "Session Start") {
		t.Error("prompt should not contain Session Start for turn 5")
	}
	if containsSubstr(prompt, "MUST now produce draft") {
		t.Error("prompt should not contain must-draft when question count is 0")
	}
}
