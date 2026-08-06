package tui

import (
	"fmt"
	"strings"
	"time"
)

// StatusBar is the footer readout row (T7 / AC-14.5): word count, turns taken,
// and a save indicator. Pure and unit-testable.
//
//   - saveState == "saved" → Verdant "saved → <path>" flash.
//   - saveState == "saving" → transient "saving…".
//   - saveState == "idle" → idle hint.
func StatusBar(words, turns int, saveState, savedPath string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "%d words", words)
	fmt.Fprintf(&b, "  ·  %d turns", turns)

	switch saveState {
	case "save", "saved":
		b.WriteString("  ·  saved → ")
		if savedPath != "" {
			b.WriteString(savedPath)
		} else {
			b.WriteString("saved")
		}
	case "saving":
		b.WriteString("  ·  saving…")
	case "idle":
		b.WriteString("  ·  Ctrl+S save · Ctrl+D end · Esc dismiss")
	}
	return b.String()
}

// defaultSavePath builds the default artifact name: ./orb-<timestamp>.<ext>
// where ext follows the --format flag (AC-14.1 / AC-14.3).
func defaultSavePath(now time.Time, format string) string {
	return fmt.Sprintf("orb-%s.%s", now.Format("20060102-150405"), formatExtension(format))
}

// formatExtension maps the configured format flag to a file extension.
func formatExtension(format string) string {
	if strings.EqualFold(format, "txt") {
		return "txt"
	}
	return "md"
}

// summarizeSession builds the end-of-session flight log (AC-14.5).
func summarizeSession(words, turns int, path string) string {
	return fmt.Sprintf("\norb — session complete\n  words drawn:     %d\n  turns taken:    %d\n  artifact saved:  %s\n",
		words, turns, path)
}
