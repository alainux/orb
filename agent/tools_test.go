package agent_test

import (
	"testing"

	"github.com/alainux/orb/agent"
)

func TestUpdateArtifactTool(t *testing.T) {
	tool := agent.UpdateArtifactTool()

	if tool.Name != "update_artifact" {
		t.Errorf("Name = %q, want update_artifact", tool.Name)
	}
	if tool.Description == "" {
		t.Error("Description should not be empty")
	}

	// Verify parameters structure.
	params, ok := tool.Parameters.(map[string]interface{})
	if !ok {
		t.Fatal("Parameters should be a map")
	}
	if params["type"] != "object" {
		t.Errorf("Parameters.type = %v, want object", params["type"])
	}

	props, ok := params["properties"].(map[string]interface{})
	if !ok {
		t.Fatal("Parameters.properties should be a map")
	}
	if _, ok := props["content"]; !ok {
		t.Error("Parameters.properties should contain 'content'")
	}

	required, ok := params["required"].([]string)
	if !ok {
		t.Fatal("Parameters.required should be []string")
	}
	if len(required) != 1 || required[0] != "content" {
		t.Errorf("Parameters.required = %v, want [content]", required)
	}
}

func TestDefaultTools(t *testing.T) {
	tools := agent.DefaultTools()
	if len(tools) != 1 {
		t.Fatalf("DefaultTools() returned %d tools, want 1", len(tools))
	}
	if tools[0].Name != "update_artifact" {
		t.Errorf("DefaultTools()[0].Name = %q, want update_artifact", tools[0].Name)
	}
}

func TestParseToolCall_Valid(t *testing.T) {
	update, err := agent.ParseToolCall(`{"content":"Hello world","cursor_position":5}`)
	if err != nil {
		t.Fatalf("ParseToolCall returned error: %v", err)
	}
	if update.Content != "Hello world" {
		t.Errorf("Content = %q, want 'Hello world'", update.Content)
	}
	if update.CursorPosition != 5 {
		t.Errorf("CursorPosition = %d, want 5", update.CursorPosition)
	}
	if update.WordCount != 2 {
		t.Errorf("WordCount = %d, want 2", update.WordCount)
	}
}

func TestParseToolCall_EmptyContent(t *testing.T) {
	_, err := agent.ParseToolCall(`{"content":""}`)
	if err == nil {
		t.Fatal("expected error for empty content")
	}
}

func TestParseToolCall_InvalidJSON(t *testing.T) {
	_, err := agent.ParseToolCall(`{invalid json}`)
	if err == nil {
		t.Fatal("expected error for invalid JSON")
	}
}

func TestParseToolCall_WithoutCursor(t *testing.T) {
	update, err := agent.ParseToolCall(`{"content":"Test content"}`)
	if err != nil {
		t.Fatalf("ParseToolCall returned error: %v", err)
	}
	if update.CursorPosition != 0 {
		t.Errorf("CursorPosition = %d, want 0 (default)", update.CursorPosition)
	}
}

func TestToolResultJSON(t *testing.T) {
	update := &agent.ArtifactUpdate{
		Content:        "Hello",
		CursorPosition: 0,
		WordCount:      1,
	}
	result := agent.ToolResultJSON(update, true)
	if result == "" {
		t.Fatal("ToolResultJSON returned empty string")
	}
	// Verify it contains expected fields.
	if !contains(result, `"success":true`) {
		t.Error("result should contain success:true")
	}
	if !contains(result, `"word_count":1`) {
		t.Error("result should contain word_count:1")
	}
}

func TestToolResultJSON_Failure(t *testing.T) {
	update := &agent.ArtifactUpdate{Content: "err", WordCount: 1}
	result := agent.ToolResultJSON(update, false)
	if !contains(result, `"success":false`) {
		t.Error("result should contain success:false")
	}
}

func TestCountWords(t *testing.T) {
	// Test word counting via ParseToolCall. Avoid newlines in JSON string
	// literals — use the ArtifactUpdate struct directly for multi-line content.
	tests := []struct {
		input string
		want  int
	}{
		{"hello", 1},
		{"hello world", 2},
		{"  hello  world  ", 2},
		{"one two three four five", 5},
	}
	for _, tt := range tests {
		parsed, err := agent.ParseToolCall(`{"content":"` + tt.input + `"}`)
		if err != nil {
			t.Fatalf("ParseToolCall(%q) error: %v", tt.input, err)
		}
		if parsed.WordCount != tt.want {
			t.Errorf("countWords(%q) = %d, want %d", tt.input, parsed.WordCount, tt.want)
		}
	}

	// Test multi-line word count using the internal countWords via ParseToolCall.
	// We need to JSON-encode the content properly.
	multiLine := `{"content":"hello\nworld\tfoo"}`
	parsed, err := agent.ParseToolCall(multiLine)
	if err != nil {
		t.Fatalf("ParseToolCall multi-line error: %v", err)
	}
	if parsed.WordCount != 3 {
		t.Errorf("countWords(multi-line) = %d, want 3", parsed.WordCount)
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsSubstr(s, substr))
}

func containsSubstr(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
