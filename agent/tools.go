// Package agent implements the orb voice agent subsystem: tool definitions,
// system prompt construction, and conversation turn management.
//
// Spec references: R6 (AC-6.1–6.4), R8 (AC-8.1–8.5), R17 (AC-17.1–17.4),
// DEC-4 (full-replacement tool surface).
package agent

import (
	"encoding/json"
	"fmt"

	"github.com/alainux/orb/voice"
)

// UpdateArtifactArgs is the parsed arguments from an update_artifact tool call.
type UpdateArtifactArgs struct {
	Content        string `json:"content"`
	CursorPosition int    `json:"cursor_position,omitempty"`
}

// ArtifactUpdate represents the result of processing an update_artifact call.
type ArtifactUpdate struct {
	// Content is the full artifact text (DEC-4: full replacement).
	Content string

	// CursorPosition is where the cursor should be placed after update.
	// 0 means end of document.
	CursorPosition int

	// WordCount is the word count of the new content.
	WordCount int
}

// UpdateArtifactTool returns the ToolDef for the update_artifact function.
// Per DEC-4 (spec §3.4), the agent has exactly one tool: update_artifact
// with full-replacement semantics.
func UpdateArtifactTool() voice.ToolDef {
	return voice.ToolDef{
		Name:        "update_artifact",
		Description: "Write or revise the document being drafted. The content replaces the entire artifact (full replacement, not incremental).",
		Parameters: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"content": map[string]interface{}{
					"type":        "string",
					"description": "The full document content. This replaces the entire artifact.",
				},
				"cursor_position": map[string]interface{}{
					"type":        "integer",
					"description": "Optional. Character offset where the cursor should be placed after update. 0 = end of document.",
				},
			},
			"required":             []string{"content"},
			"additionalProperties": false,
		},
	}
}

// DefaultTools returns the complete set of tools available to the agent.
// Currently only update_artifact (DEC-4: single tool surface).
func DefaultTools() []voice.ToolDef {
	return []voice.ToolDef{
		UpdateArtifactTool(),
	}
}

// ParseToolCall parses the JSON arguments from a tool call into an
// ArtifactUpdate. Returns an error if the arguments are malformed or
// the content is empty (R6 AC-6.1: content is required).
func ParseToolCall(argsJSON string) (*ArtifactUpdate, error) {
	var args UpdateArtifactArgs
	if err := json.Unmarshal([]byte(argsJSON), &args); err != nil {
		return nil, fmt.Errorf("parse update_artifact args: %w", err)
	}

	if args.Content == "" {
		return nil, fmt.Errorf("update_artifact: content must not be empty")
	}

	return &ArtifactUpdate{
		Content:        args.Content,
		CursorPosition: args.CursorPosition,
		WordCount:      countWords(args.Content),
	}, nil
}

// ToolResultJSON returns a JSON string suitable for SubmitToolResult.
func ToolResultJSON(update *ArtifactUpdate, success bool) string {
	result := map[string]interface{}{
		"success":    success,
		"word_count": update.WordCount,
	}
	b, _ := json.Marshal(result)
	return string(b)
}

// countWords counts words in a string by splitting on whitespace.
func countWords(s string) int {
	count := 0
	inWord := false
	for _, r := range s {
		if r == ' ' || r == '\n' || r == '\t' || r == '\r' {
			if inWord {
				count++
				inWord = false
			}
		} else {
			inWord = true
		}
	}
	if inWord {
		count++
	}
	return count
}
