package agent

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const (
	// maxContextFiles is the maximum number of context files (R8 AC-8.2).
	maxContextFiles = 10

	// maxContextBytes is the maximum total size of context files (100 KB, R8 AC-8.2).
	maxContextBytes = 100 * 1024

	// maxSingleContextBytes is the maximum size of a single context file (50 KB).
	maxSingleContextBytes = 50 * 1024
)

// supportedContextExts is the set of accepted context file extensions (R8
// AC-8.4: Markdown, plaintext, JSON, YAML).
var supportedContextExts = map[string]bool{
	".md": true, ".markdown": true,
	".txt":  true,
	".json": true,
	".yaml": true, ".yml": true,
}

// ValidateContextFiles checks the context file arguments for the AC-8 limits
// (count <= 10, total <= 100 KB, single <= 50 KB, UTF-8, supported format)
// WITHOUT injecting them into a prompt. It is used pre-session so that bad
// context fails fast and cleanly (AC-8.1..8.5). Returns nil on success.
func ValidateContextFiles(paths []string) error {
	if len(paths) > maxContextFiles {
		return fmt.Errorf("too many context files: %d (max %d)", len(paths), maxContextFiles)
	}
	var total int
	for _, p := range paths {
		ext := strings.ToLower(filepath.Ext(p))
		if !supportedContextExts[ext] {
			return fmt.Errorf("unsupported context file %q (supported: md, txt, json, yaml)", p)
		}
		data, err := os.ReadFile(p)
		if err != nil {
			return fmt.Errorf("read context file %s: %w", p, err)
		}
		if !utf8.Valid(data) {
			return fmt.Errorf("context file %s: not valid UTF-8", p)
		}
		if len(data) > maxSingleContextBytes {
			return fmt.Errorf("context file %s: too large (%d bytes, max %d)", p, len(data), maxSingleContextBytes)
		}
		total += len(data)
		if total > maxContextBytes {
			return fmt.Errorf("total context files too large (%d bytes, max %d)", total, maxContextBytes)
		}
	}
	return nil
}

// PromptConfig holds the inputs for building the system prompt.
type PromptConfig struct {
	// ContextFiles are paths to UTF-8 files loaded as agent context (R8).
	ContextFiles []string

	// ArtifactContent is the current artifact text (empty at session start).
	ArtifactContent string

	// TurnCount is the number of completed conversation turns.
	TurnCount int

	// QuestionCount is the number of consecutive questions asked by the agent.
	QuestionCount int
}

// BuildSystemPrompt constructs the system prompt for the voice agent,
// incorporating UTF-8 context files (R8 AC-8.1–8.5) and tool instructions.
//
// The prompt tells the agent:
//   - Its role (collaborative document drafter, not a chatbot)
//   - How to use update_artifact (full replacement, DEC-4)
//   - The conversational policy (1–2 questions max, R17 AC-17.4)
//   - Any loaded context files
func BuildSystemPrompt(cfg PromptConfig) (string, error) {
	var b strings.Builder

	// Core instructions.
	b.WriteString(`You are a voice-powered document drafting agent for the orb terminal workspace.

## Your Role
You collaborate with the user through voice conversation to draft one document (the "artifact"). You are an active collaborator — not a transcriber, not a chatbot.

## How You Work
- The user speaks to you via voice. You see their text transcription.
- You draft and revise the document using the update_artifact tool.
- Your text responses appear in the artifact pane as streaming text.
- After you finish speaking, if the content is ready, call update_artifact with the full document.

## update_artifact Tool
You have ONE tool: update_artifact. Use it to write or revise the document.
- content: The FULL document text (replaces the entire artifact, not incremental).
- cursor_position: Optional. Where to place the cursor after update (0 = end).
- Call update_artifact when you have substantial content to add or revise.
- The content should be well-structured Markdown.

## Conversational Policy
- Ask 1–2 clarifying questions at the start if the user's intent is ambiguous.
- After gathering enough context, start drafting immediately.
- Do NOT ask more than 2 questions in a row without producing draft content.
- Keep responses concise — this is a voice interface, not a text chat.
- When the user gives feedback, revise the document with update_artifact.

## Formatting
- Use Markdown formatting (headers, lists, emphasis).
- Write clearly and concisely for a voice-first interface.
- The document should be self-contained and readable as a standalone file.
`)

	// Context files (R8 AC-8.3: injected into system prompt, not artifact pane).
	contextContent, err := loadContextFiles(cfg.ContextFiles)
	if err != nil {
		return "", fmt.Errorf("load context files: %w", err)
	}
	if contextContent != "" {
		b.WriteString("\n## Context Files\n")
		b.WriteString("The user has provided these files as context. Use them to inform your drafting.\n")
		b.WriteString(contextContent)
	}

	// Current artifact state (if any).
	if cfg.ArtifactContent != "" {
		b.WriteString("\n## Current Artifact\n")
		b.WriteString("The current artifact content is:\n\n")
		b.WriteString("```\n")
		b.WriteString(cfg.ArtifactContent)
		b.WriteString("\n```\n")
	}

	// Turn-aware instructions.
	if cfg.TurnCount == 0 {
		b.WriteString("\n## Session Start\n")
		b.WriteString("This is the beginning of the session. Greet the user briefly and ask what they'd like to work on.\n")
	} else if cfg.QuestionCount >= 2 {
		b.WriteString("\n## Important\n")
		b.WriteString("You have already asked 2 questions. You MUST now produce draft content using update_artifact before asking any more questions.\n")
	}

	return b.String(), nil
}

// loadContextFiles reads and validates UTF-8 context files (R8 AC-8.1–8.5).
// Returns a formatted string suitable for injection into the system prompt.
func loadContextFiles(paths []string) (string, error) {
	if len(paths) == 0 {
		return "", nil
	}

	// Enforce limits, formats, encoding before building the block.
	if err := ValidateContextFiles(paths); err != nil {
		return "", err
	}

	var b strings.Builder
	for _, path := range paths {
		data, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read context file %s: %w", path, err)
		}
		b.WriteString(fmt.Sprintf("\n### File: %s\n", path))
		b.WriteString(string(data))
		b.WriteString("\n")
	}

	return b.String(), nil
}

// EstimatePromptSize returns the estimated character count of the system prompt.
// Used to warn when approaching model context limits.
func EstimatePromptSize(prompt string) int {
	return utf8.RuneCountInString(prompt)
}
