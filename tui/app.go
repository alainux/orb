package tui

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/alainux/orb/config"
	"github.com/alainux/orb/errs"
	"github.com/alainux/orb/pipe"
	"github.com/alainux/orb/session"
	"github.com/gdamore/tcell/v2"
)

// Status is the current state word shown in the status line / orb pane.
type Status string

const (
	StatusIdle      Status = "idle"
	StatusListening Status = "listening…"
	StatusThinking  Status = "thinking…"
	StatusDrafting  Status = "drafting…"
	StatusSaving    Status = "saving…"
	StatusSaved     Status = "saved"
	StatusError     Status = "error"
	StatusWaiting   Status = "waiting…" // AC-13.3: >30s silence, session still active
)

// App is the tcell application shell: it owns the screen, the key/event loop,
// and the current UI state. Rendering and key mapping live in pure helpers so
// the shell stays thin and testable.
type App struct {
	cfg    *config.Config
	cap    TermCap
	screen tcell.Screen

	mu         sync.Mutex
	width      int
	height     int
	artifact   string
	status     Status
	suggestion string // pending Tide-colored agent suggestion (AC-17)
	savedPath  string
	stream     *RevealBuffer // char-by-char pacing of streamed artifact text (R19)
	words      int           // word count of the revealed text (T7)
	turns      int           // agent turns taken (T7 / AC-14.5)
	saveFlash  time.Time     // when the last save happened → Verdant footer flash (AC-14.4)

	// scripting hook (P-1/P-2): on save the artifact payload is piped to a
	// user-configured command over stdin (R7). Nil when no --pipe configured.
	hook      *pipe.Hook
	pipeErr   string    // last pipe failure message for footer display (AC-7.5)
	pipeErrAt time.Time // when the last pipe failure occurred → transient footer

	// generic error footer (E-2): a transient, non-fatal message rendered in
	// the artifact footer (e.g. "Connection lost — retrying…") via ShowError/
	// OnError. Distinct from the pipe footer so hook failures and session
	// errors can coexist without clobbering each other.
	errMsg   string    // last generic error message for footer display
	errMsgAt time.Time // when the last generic error occurred → transient footer

	// S-1 session lifecycle (R13); nil means no voice session attached.
	lifecycle     *session.Lifecycle
	lastLifePhase session.Phase

	// orb animation state (particle field, energy, reveal timing).
	orb       *OrbField
	energy    float64
	frameDT   float64
	sceneTime float64

	// session-start slide reveal (AC-1.5): reveal in [0,1].
	startTime time.Time
	lastTick  time.Time
	reveal    float64

	running   bool // false => exit the event loop
	forceQuit bool // Ctrl+C — no autosave
}

// NewApp builds an App for the given config. The terminal capability profile
// is derived from the environment (COLORTERM/TERM/ORB_GLYPH + --no-visual).
func NewApp(cfg *config.Config) *App {
	cap := DetectTermCap(
		os.Getenv("COLORTERM"),
		os.Getenv("TERM"),
		os.Getenv("ORB_GLYPH"),
		cfg.NoVisual,
	)
	a := &App{
		cfg:       cfg,
		cap:       cap,
		status:    StatusIdle,
		savedPath: "",
		reveal:    1, // headless renders settled; Run() re-arms the slide reveal
		stream:    &RevealBuffer{},
		mu:        sync.Mutex{},
		startTime: time.Now(),
	}
	a.hook = a.newHookFor(cfg) // scripting hook (P-1/P-2): nil when no --pipe
	return a
}

// newHookFor wires the scripting hook (P-1/P-2) when a pipe command is
// configured via CLI flag or config (R7 AC-7.1). Returns nil when disabled.
func (a *App) newHookFor(cfg *config.Config) *pipe.Hook {
	if cfg == nil || cfg.PipeCommand == "" {
		return nil
	}
	return pipe.New(cfg.PipeCommand, a.onHookResult)
}

func (a *App) onHookResult(res pipe.Result) {
	if res.Err != nil {
		a.SetPipeError(res.ExitMessage())
	}
}

// TermCap exposes the resolved terminal capabilities (for tests/debug).
func (a *App) SetLifecycle(life *session.Lifecycle) {
	a.mu.Lock()
	a.lifecycle = life
	a.lastLifePhase = session.PhaseNone
	a.mu.Unlock()
	a.redraw()
}
func (a *App) TermCap() TermCap { return a.cap }

// SetCapability overrides the resolved capability profile (used by the
// screenshot generator and simulation tests to force a given terminal mode).
func (a *App) SetCapability(cap TermCap) {
	a.mu.Lock()
	a.cap = cap
	a.mu.Unlock()
	a.redraw()
}

// SetArtifact replaces the artifact content instantly: the update_artifact
// tool-call path swaps the whole payload at once, with no per-char reveal
// (AC-19.5).
func (a *App) SetArtifact(text string) {
	a.mu.Lock()
	a.artifact = text
	a.stream.Reset(text)
	a.words = wordCount(text)
	a.mu.Unlock()
	a.redraw()
}

// SetArtifactChunk appends a fresh streaming chunk to the artifact. It is not
// shown immediately: reveal pacing reveals it at ~30 ms/character (AC-19.1..19.3).
func (a *App) SetArtifactChunk(chunk string) {
	a.mu.Lock()
	a.stream.Append(chunk)
	a.artifact += chunk
	a.mu.Unlock()
	a.redraw()
}

// advanceReveal moves streamed text from the buffer onto the screen at the
// fixed per-character pace. Called once per rendered frame.
func (a *App) advanceReveal(dt time.Duration) {
	a.mu.Lock()
	a.stream.Tick(dt)
	a.words = wordCount(a.stream.Visible())
	a.mu.Unlock()
}

// PumpReveal advances the reveal clock by ms milliseconds (used by capture
// tooling and tests to render a deterministic mid-stream frame; AC-19.2).
func (a *App) PumpReveal(ms int) {
	a.advanceReveal(time.Duration(ms) * time.Millisecond)
	a.redraw()
}

// SetTurns records the total number of agent turns taken (T7 / AC-14.5).
func (a *App) SetTurns(n int) {
	a.mu.Lock()
	a.turns = n
	a.mu.Unlock()
	a.redraw()
}

// BumpTurns increments the turn counter when a new agent turn begins.
func (a *App) BumpTurns() {
	a.mu.Lock()
	a.turns++
	a.mu.Unlock()
	a.redraw()
}

// FlashSaved records a fresh Verdant footer flash + orb celebration pulse for
// the given save path (AC-14.4).
func (a *App) FlashSaved(path string) {
	a.mu.Lock()
	a.savedPath = path
	a.saveFlash = time.Now()
	a.mu.Unlock()
	a.setStatus(StatusSaved)
	a.redraw()
}

// duringFlash reports whether the recent-save Verdant footer is still visible.
func (a *App) duringFlash() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return !a.saveFlash.IsZero() && time.Since(a.saveFlash) < saveFlashDuration
}

// currentWords returns the current visible word count under lock.
func (a *App) currentWords() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.words
}

// currentTurns returns the current turn count under lock.
func (a *App) currentTurns() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.turns
}

// wordCount counts whitespace-separated tokens (pure helper).
func wordCount(text string) int {
	if text == "" {
		return 0
	}
	return len(strings.Fields(text))
}

// SetStatus updates the status word and forces a redraw.
func (a *App) SetStatus(s Status) {
	a.mu.Lock()
	a.status = s
	a.mu.Unlock()
	a.redraw()
}

// SetSuggestion sets/clears the pending agent suggestion.
func (a *App) SetSuggestion(text string) {
	a.mu.Lock()
	a.suggestion = text
	a.mu.Unlock()
	a.redraw()
}

// Run starts the tcell screen and blocks until the session ends (Ctrl+D / q)
// or is force-quit (Ctrl+C). Returns nil on a clean end, or an error if the
// terminal cannot be initialised.
func (a *App) Run() error {
	defStyle := tcell.StyleDefault.
		Foreground(hexColor(ChalkHex())).
		Background(hexColor(VoidHex()))
	s, err := tcell.NewScreen()
	if err != nil {
		return fmt.Errorf("tcell init: %w", err)
	}
	if err := s.Init(); err != nil {
		return fmt.Errorf("terminal init: %w", err)
	}
	defer s.Fini()
	a.screen = s
	s.SetStyle(defStyle)

	a.width, a.height = s.Size()

	a.startTime = time.Now()
	a.lastTick = time.Now()
	a.sceneTime = 0
	a.reveal = 0 // re-arm the session-start slide reveal (AC-1.5)
	a.running = true
	a.drawFrame()

	// Event loop: drain pending events without blocking, then tick one frame.
	// This keeps a ~30 FPS heartbeat for animation while staying responsive.
	for a.running {
		for s.HasPendingEvent() {
			a.handleEvent(s.PollEvent())
			if !a.running {
				break
			}
		}
		a.reveal = clamp01(time.Since(a.startTime).Seconds() / revealDuration.Seconds())
		now := time.Now()
		dt := now.Sub(a.lastTick)
		a.frameDT = dt.Seconds()
		a.lastTick = now
		a.advanceReveal(dt)
		a.applyLifecyclePhase(now)
		a.redraw()
		time.Sleep(frameInterval)
	}

	if a.forceQuit {
		return nil
	}

	// Graceful end: autosave then print the flight-log summary.
	if a.cfg != nil && strings.TrimSpace(a.artifact) != "" {
		if p, err := a.Save(""); err == nil {
			a.FlashSaved(p)
			a.printSummary()
		}
	}
	// Flush the scripting hook (P-2): let any in-flight / queued pipe finish
	// so the final save is not lost when orb exits.
	if a.hook != nil {
		a.hook.Stop()
	}
	return nil
}

// handleEvent routes screen events to the appropriate handler.
func (a *App) handleEvent(ev any) {
	switch e := ev.(type) {
	case *tcell.EventKey:
		a.onKey(e)
	case *tcell.EventResize:
		a.width, a.height = e.Size()
		a.drawFrame()
	case *tcell.EventError:
		a.setStatus(StatusError)
		a.drawFrame()
	}
}

// onKey maps a key event to an action and applies it (AC-10.1..10.5).
func (a *App) onKey(e *tcell.EventKey) {
	switch HandleKey(e.Key(), e.Rune()) {
	case ActionSave:
		if p, err := a.Save(""); err != nil {
			a.setStatus(StatusError)
		} else {
			a.FlashSaved(p)
		}
		a.drawFrame()
	case ActionEnd:
		a.running = false
	case ActionQuit:
		a.forceQuit = true
		a.running = false
	case ActionDismiss:
		a.SetSuggestion("")
	}
}

// SetOrbEnergy feeds the current RMS amplitude [0,1] into the orb (AC-2.3).
func (a *App) SetOrbEnergy(energy float64) {
	a.mu.Lock()
	a.energy = clamp01(energy)
	a.mu.Unlock()
	a.redraw()
}

// OrbEnergy returns the current animation energy (for tests/debug).
func (a *App) OrbEnergy() float64 {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.energy
}

// SetRevealProgress overrides the reveal progress for a frame (used by the
// screenshot generator to capture the mid-animation slide-in; AC-1.5).
func (a *App) SetRevealProgress(p float64) {
	a.mu.Lock()
	a.reveal = clamp01(p)
	a.mu.Unlock()
	a.redraw()
}

// Save writes the artifact to disk (configured output path, or a default
// ./orb-<timestamp>.<ext> following --format) and returns the written path
// (AC-14.1..14.3). The pipe hook is wired in a later milestone.
func (a *App) Save(override string) (string, error) {
	a.mu.Lock()
	content := a.artifact
	format := "md"
	if a.cfg != nil && a.cfg.Format != "" {
		format = a.cfg.Format
	}
	a.mu.Unlock()

	path := override
	if path == "" {
		if a.cfg != nil && a.cfg.OutputPath != "" {
			path = a.cfg.OutputPath
		} else {
			path = defaultSavePath(time.Now(), format)
		}
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", err
	}

	a.mu.Lock()
	a.savedPath = path
	a.mu.Unlock()

	// Trigger the scripting hook with the freshly saved artifact (R7 / P-2).
	// The save succeeds independently of the pipe: a pipe failure surfaces as a
	// footer notice and is never fatal (AC-7.5 / AC-11.4).
	a.dispatchHook()
	return path, nil
}

// dispatchHook enqueues the current artifact payload to the scripting hook
// (AC-7.2 / DEC-5). It is a no-op when no --pipe command is configured. It
// lazily starts the single worker so Save works in test/headless contexts too.
func (a *App) dispatchHook() {
	a.mu.Lock()
	h := a.hook
	artifact := a.artifact
	turns := a.turns
	start := a.startTime
	a.mu.Unlock()
	if h == nil {
		return
	}
	words := wordCount(artifact) // full saved artifact, independent of reveal
	d := 0.0
	if !start.IsZero() {
		d = time.Since(start).Seconds()
	}
	h.Start()
	h.Dispatch(pipe.Payload{
		Artifact:  artifact,
		Direction: "",
		Session: pipe.SessionMeta{
			Words:    words,
			Turns:    turns,
			Duration: d,
		},
	})
}

// SetPipeError records a scripting-hook failure so the artifact footer can
// surface it transiently (AC-7.5: "pipe failed: exit 1"); the save itself has
// already succeeded by the time this runs.
func (a *App) SetPipeError(msg string) {
	a.mu.Lock()
	a.pipeErr = msg
	a.pipeErrAt = time.Now()
	a.mu.Unlock()
	a.setStatus(StatusError)
	// No forced redraw here: SetPipeError runs on the pipe worker goroutine.
	// The main rendering loop repaints every frame (~30 FPS), so the transient
	// footer notice appears on its next frame without touching the screen from
	// a background goroutine.
}

// pipeErrorFlash is how long the footer shows a recent pipe failure.
const pipeErrorFlashDuration = 6 * time.Second

// errorFlashDuration is how long the footer shows a recent generic error
// (E-2). It mirrors the pipe flash so both footer error paths surface for the
// same recovery window.
const errorFlashDuration = 6 * time.Second

// ShowError surfaces a transient, non-fatal error in the artifact footer
// (E-2 / AC-11.1 recovery path). It paints the message in Bloom for a short
// window so recovery/error text (e.g. "Connection lost — retrying…") is
// visible without interrupting the TUI.
func (a *App) ShowError(msg string) {
	a.mu.Lock()
	a.errMsg = msg
	a.errMsgAt = time.Now()
	a.mu.Unlock()
	a.setStatus(StatusError)
}

// OnError implements session.EventHandler so the TUI can render a session/provider
// error in the footer. The user-facing text is derived via errs.User, so a
// classified *Error keeps its safe message; any error falls back to err.Error().
func (a *App) OnError(err error) {
	if err == nil {
		return
	}
	a.ShowError(errs.User(err))
}

// printSummary writes the session flight log to stdout (AC-14.5).
func (a *App) printSummary() {
	a.mu.Lock()
	visible := a.stream.Visible()
	full := a.artifact
	turns := a.turns
	path := a.savedPath
	a.mu.Unlock()
	words := wordCount(visible)
	if words == 0 {
		words = wordCount(full)
	}
	fmt.Fprint(os.Stdout, summarizeSession(words, turns, path))
}

// CrashSnapshot persists the current artifact to the crash-recovery directory
// (/.orb/crash/<timestamp>.md) so it is not lost on an abnormal end (AC-11.5).
// Returns the written path, or ("", nil) when there is nothing worth saving.
func (a *App) CrashSnapshot() (string, error) {
	a.mu.Lock()
	content := a.artifact
	a.mu.Unlock()
	if strings.TrimSpace(content) == "" {
		return "", nil
	}
	return session.WriteCrashSnapshot(content, time.Now())
}

func (a *App) OnDisconnect() {
	if _, err := a.CrashSnapshot(); err != nil {
		a.setStatus(StatusError)
	} else {
		a.setStatus(StatusWaiting)
	}
	a.redraw()
}

func (a *App) applyLifecyclePhase(now time.Time) {
	a.mu.Lock()
	lc := a.lifecycle
	phase := a.lastLifePhase
	a.mu.Unlock()
	if lc == nil {
		return
	}
	cur := lc.Phase()
	if cur == phase {
		return
	}
	switch cur {
	case session.PhasePaused:
		a.setStatus(StatusWaiting)
	case session.PhaseEnded, session.PhaseCrash:
		a.setStatus(StatusIdle)
	}
	a.mu.Lock()
	a.lastLifePhase = cur
	a.mu.Unlock()
	a.redraw()
}

// currentState returns the current status word under lock.
func (a *App) currentStatus() Status {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.status
}

func (a *App) setStatus(s Status) {
	a.mu.Lock()
	a.status = s
	a.mu.Unlock()
}

// redraw clears and repaints the whole screen.
func (a *App) redraw() {
	if a.screen == nil {
		return
	}
	a.drawFrame()
}

// RenderTo paints the current frame onto the given screen at the given cell
// size without initialising a real terminal. It is used for headless visual
// captures (screenshots) and simulation tests.
func (a *App) RenderTo(s tcell.Screen, w, h int) {
	a.mu.Lock()
	a.screen = s
	a.width = w
	a.height = h
	// Headless captures use the current reveal (defaults to settled unless a
	// SetRevealProgress call armed a mid-animation capture) and a fixed tick.
	a.frameDT = 1.0 / 30
	a.beginOrb()
	a.mu.Unlock()
	// Simulation/headless screens expose SetSize; honour it so the grid matches.
	if ss, ok := any(s).(interface{ SetSize(int, int) }); ok {
		ss.SetSize(w, h)
	}
	a.screen.Clear()
	a.drawFrame()
}
