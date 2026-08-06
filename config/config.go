// Package config implements the orb configuration system: defaults, config
// file loading (~/.orb/config.json), environment variable resolution, CLI
// flag overrides, and validation.
//
// Resolution order (highest precedence wins):
//  1. CLI flags
//  2. Environment variables (OPENAI_API_KEY, ORB_PROVIDER, ORB_MODEL)
//  3. Config file (~/.orb/config.json)
//  4. Built-in defaults
//
// Spec references: R15 (BYO API key), R12 (security / file permissions),
// R6/R7 (pipe + output defaults).
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/alainux/orb/errs"
)

// Config holds the resolved runtime configuration.
type Config struct {
	APIKey      string
	Provider    string
	Model       string
	PipeCommand string
	Bell        bool
	NoBell      bool
	NoVisual    bool
	OutputPath  string
	Format      string
}

// Defaults returns a Config pre-populated with sensible defaults.
func Defaults() *Config {
	return &Config{
		Provider: "openai",
		Format:   "md",
	}
}

// Load reads config from path. If the file does not exist it returns
// Defaults() with no error. Any other read/parse error is returned.
func Load(path string) (*Config, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return Defaults(), nil
		}
		return nil, err
	}

	var fileCfg struct {
		APIKey      string `json:"api_key"`
		Provider    string `json:"provider"`
		Model       string `json:"model"`
		PipeCommand string `json:"pipe_command"`
		Bell        bool   `json:"bell"`
		NoBell      bool   `json:"no_bell"`
		NoVisual    bool   `json:"no_visual"`
	}

	if err := json.Unmarshal(b, &fileCfg); err != nil {
		return nil, fmt.Errorf("parse %s: %w", path, err)
	}

	cfg := Defaults()
	cfg.APIKey = fileCfg.APIKey
	if fileCfg.Provider != "" {
		cfg.Provider = fileCfg.Provider
	}
	if fileCfg.Model != "" {
		cfg.Model = fileCfg.Model
	}
	cfg.PipeCommand = fileCfg.PipeCommand
	cfg.Bell = fileCfg.Bell
	cfg.NoBell = fileCfg.NoBell
	cfg.NoVisual = fileCfg.NoVisual

	_ = ensureDir(filepath.Dir(path))
	return cfg, nil
}

// ApplyEnv overlays environment variables onto cfg.
// OPENAI_API_KEY is checked first per R15.AC-15.1.
func (c *Config) ApplyEnv() {
	if v := os.Getenv("OPENAI_API_KEY"); v != "" {
		c.APIKey = v
	}
	if v := os.Getenv("ORB_PROVIDER"); v != "" {
		c.Provider = v
	}
	if v := os.Getenv("ORB_MODEL"); v != "" {
		c.Model = v
	}
}

// Validate checks the configuration for correctness and returns a
// classified, user-facing error if something is missing or inconsistent.
// Errors are typed via errs so the caller can react by kind (E-1/E-2).
func (c *Config) Validate() error {
	if c.APIKey == "" {
		return errs.Errorf(errs.KindNoAPIKey, true,
			"No API key found. Set OPENAI_API_KEY or orb.api_key in %s/.orb/config.json",
			"$HOME")
	}
	switch c.Format {
	case "md", "txt":
	default:
		return errs.Errorf(errs.KindInput, true, "unsupported format %q (use md or txt)", c.Format)
	}
	return nil
}

func ensureDir(path string) error {
	if path == "" || path == "." {
		return nil
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := os.MkdirAll(path, 0o700); err != nil {
			return err
		}
	}
	return nil
}
