package tui

import "github.com/gdamore/tcell/v2"

// Key bindings (R10, AC-10.1..10.5). The UI is voice-primary: there is no
// focus model and all bindings are global (AC-10.4).

type Action int

const (
	ActionNone    Action = iota
	ActionSave           // Ctrl+S — save artifact (+ pipe hook)
	ActionEnd            // Ctrl+D / q — end session, auto-save
	ActionQuit           // Ctrl+C — force quit without saving
	ActionDismiss        // Escape — dismiss current agent suggestion
)

// HandleKey maps a key event to an Action. It is pure and unit-testable.
func HandleKey(key tcell.Key, ch rune) Action {
	switch key {
	case tcell.KeyCtrlS:
		return ActionSave
	case tcell.KeyCtrlD:
		return ActionEnd
	case tcell.KeyCtrlC:
		return ActionQuit
	case tcell.KeyEscape:
		return ActionDismiss
	case tcell.KeyRune:
		if ch == 'q' || ch == 'Q' {
			return ActionEnd
		}
		return ActionNone
	default:
		return ActionNone
	}
}
