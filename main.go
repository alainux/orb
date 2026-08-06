package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/alainux/orb/agent"
	"github.com/alainux/orb/config"
	"github.com/alainux/orb/errs"
	"github.com/alainux/orb/session"
	"github.com/alainux/orb/tui"
)

// buildVersion is injected via ldflags at release time.
var buildVersion = "dev"

func main() {
	fs := flag.NewFlagSet("orb", flag.ContinueOnError)
	fs.Usage = func() {
		fmt.Fprintf(fs.Output(), "Usage: orb [options] [context-files...]\n\nOptions:\n")
		fs.PrintDefaults()
	}

	var (
		configPath = fs.String("config", "", "Path to config file (default: ~/.orb/config.json)")
		pipeCmd    = fs.String("pipe", "", "Scripting hook command (JSON payload piped on save)")
		outputPath = fs.String("output", "", "Save artifact to this path (default: ./orb-<timestamp>.md)")
		format     = fs.String("format", "md", "Artifact format: md or txt")
		noVisual   = fs.Bool("no-visual", false, "Disable orb animation (text-only mode)")
		noBell     = fs.Bool("no-bell", false, "Suppress terminal bell on save")
		provider   = fs.String("provider", "", "Voice-agent provider (openai, deepgram)")
		model      = fs.String("model", "", "LLM model for the agent")
	)

	if err := fs.Parse(os.Args[1:]); err != nil {
		if err == flag.ErrHelp {
			return
		}
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	// Resolve config file path: flag > default ~/.orb/config.json
	cfgPath := *configPath
	if cfgPath == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			fmt.Fprintf(os.Stderr, "error: cannot determine home directory: %v\n", err)
			os.Exit(1)
		}
		cfgPath = filepath.Join(home, ".orb", "config.json")
	}

	cfg, err := config.Load(cfgPath)
	if err != nil {
		// Config file is optional; missing file is not fatal.
		if !os.IsNotExist(err) {
			fmt.Fprintf(os.Stderr, "warning: config load error: %v\n", err)
		}
		cfg = config.Defaults()
	}

	// Apply environment variable overrides (checked before config file, per R15).
	cfg.ApplyEnv()

	// Apply CLI flag overrides (highest precedence).
	if fs.Lookup("pipe").Value.String() != "" {
		cfg.PipeCommand = *pipeCmd
	}
	if fs.Lookup("output").Value.String() != "" {
		cfg.OutputPath = *outputPath
	}
	if fs.Lookup("format").Value.String() != "" {
		cfg.Format = *format
	}
	if fs.Lookup("no-visual").Value.String() != "" {
		cfg.NoVisual = *noVisual
	}
	if fs.Lookup("no-bell").Value.String() != "" {
		cfg.NoBell = *noBell
	}
	if fs.Lookup("provider").Value.String() != "" {
		cfg.Provider = *provider
	}
	if fs.Lookup("model").Value.String() != "" {
		cfg.Model = *model
	}

	// Validate required configuration (R11 / R15). A fatal validation error
	// (e.g. no API key, R15 AC-15.2) exits via errs.IsFatal, surfacing the
	// user-facing message. A non-fatal validation error degrades to a
	// text-only session instead of crashing (E-3 degraded-mode fallback).
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", errs.User(err))
		if errs.IsFatal(err) {
			os.Exit(1)
		}
		cfg.NoVisual = true
	}

	// Context files from positional args (R8 AC-8.1..8.5).
	contextFiles := fs.Args()
	if err := agent.ValidateContextFiles(contextFiles); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}

	// Launch the terminal UI shell. The TUI owns the screen, key bindings, and
	// pane layout; the S-1 lifecycle drives reveal/idle/active/pause/end phases.
	app := tui.NewApp(cfg)
	lifecycle := session.NewLifecycle()
	lifecycle.Start(time.Now())
	app.SetLifecycle(lifecycle)

	if err := app.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "error: %v\n", err)
		os.Exit(1)
	}
	// Run() has autosaved and printed the summary (AC-13.4); close the lifecycle.
	lifecycle.End()
}
