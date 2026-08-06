package config_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/alainux/orb/config"
)

func TestDefaults(t *testing.T) {
	cfg := config.Defaults()
	if cfg.Provider != "openai" {
		t.Errorf("provider default = %q, want openai", cfg.Provider)
	}
	if cfg.Format != "md" {
		t.Errorf("format default = %q, want md", cfg.Format)
	}
	if cfg.APIKey != "" {
		t.Errorf("api_key default = %q, want empty", cfg.APIKey)
	}
}

func TestLoadMissingFile(t *testing.T) {
	cfg, err := config.Load("/nonexistent/path/config.json")
	if err != nil {
		t.Fatalf("Load missing file returned error: %v", err)
	}
	if cfg == nil {
		t.Fatal("Load missing file returned nil config")
	}
	if cfg.Provider != "openai" {
		t.Errorf("missing file -> provider = %q, want openai", cfg.Provider)
	}
}

func TestLoadValidFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	content := `{
		"api_key": "file-key",
		"provider": "deepgram",
		"model": "dg-1",
		"pipe_command": "cat > /dev/null",
		"bell": true,
		"no_bell": true,
		"no_visual": true
	}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	if cfg.APIKey != "file-key" {
		t.Errorf("api_key = %q, want file-key", cfg.APIKey)
	}
	if cfg.Provider != "deepgram" {
		t.Errorf("provider = %q, want deepgram", cfg.Provider)
	}
	if cfg.Model != "dg-1" {
		t.Errorf("model = %q, want dg-1", cfg.Model)
	}
	if cfg.PipeCommand != "cat > /dev/null" {
		t.Errorf("pipe_command = %q, want 'cat > /dev/null'", cfg.PipeCommand)
	}
	if !cfg.Bell {
		t.Error("bell = false, want true")
	}
	if !cfg.NoBell {
		t.Error("no_bell = false, want true")
	}
	if !cfg.NoVisual {
		t.Error("no_visual = false, want true")
	}
}

func TestLoadInvalidJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad.json")
	if err := os.WriteFile(path, []byte(`{bad json`), 0o600); err != nil {
		t.Fatal(err)
	}
	_, err := config.Load(path)
	if err == nil {
		t.Error("Load invalid json expected error, got nil")
	}
}

func TestApplyEnv(t *testing.T) {
	cfg := config.Defaults()
	cfg.APIKey = "file-key"
	cfg.Provider = "deepgram"
	cfg.Model = "dg-1"

	os.Setenv("OPENAI_API_KEY", "env-key")
	os.Setenv("ORB_PROVIDER", "openai")
	os.Setenv("ORB_MODEL", "gpt-4o-mini")
	defer func() {
		os.Unsetenv("OPENAI_API_KEY")
		os.Unsetenv("ORB_PROVIDER")
		os.Unsetenv("ORB_MODEL")
	}()

	cfg.ApplyEnv()
	if cfg.APIKey != "env-key" {
		t.Errorf("api_key after ApplyEnv = %q, want env-key", cfg.APIKey)
	}
	if cfg.Provider != "openai" {
		t.Errorf("provider after ApplyEnv = %q, want openai", cfg.Provider)
	}
	if cfg.Model != "gpt-4o-mini" {
		t.Errorf("model after ApplyEnv = %q, want gpt-4o-mini", cfg.Model)
	}
}

func TestValidateMissingAPIKey(t *testing.T) {
	cfg := config.Defaults()
	if err := cfg.Validate(); err == nil {
		t.Error("Validate expected error for missing api_key, got nil")
	}
}

func TestValidateBadFormat(t *testing.T) {
	cfg := config.Defaults()
	cfg.APIKey = "key"
	cfg.Format = "pdf"
	if err := cfg.Validate(); err == nil {
		t.Error("Validate expected error for unsupported format, got nil")
	}
}

func TestValidateOK(t *testing.T) {
	cfg := config.Defaults()
	cfg.APIKey = "key"
	if err := cfg.Validate(); err != nil {
		t.Errorf("Validate expected nil, got %v", err)
	}
}

func TestResolutionOrder(t *testing.T) {
	// Env vars override config file values per R15.AC-15.1.
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	content := `{"api_key":"file-key","provider":"deepgram","model":"dg-1"}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}

	os.Setenv("OPENAI_API_KEY", "env-key")
	os.Setenv("ORB_PROVIDER", "openai")
	os.Setenv("ORB_MODEL", "gpt-4o-mini")
	defer func() {
		os.Unsetenv("OPENAI_API_KEY")
		os.Unsetenv("ORB_PROVIDER")
		os.Unsetenv("ORB_MODEL")
	}()

	cfg, err := config.Load(path)
	if err != nil {
		t.Fatalf("Load returned error: %v", err)
	}
	cfg.ApplyEnv()

	if cfg.APIKey != "env-key" {
		t.Errorf("api_key = %q, want env-key (env overrides file)", cfg.APIKey)
	}
	if cfg.Provider != "openai" {
		t.Errorf("provider = %q, want openai (env overrides file)", cfg.Provider)
	}
	if cfg.Model != "gpt-4o-mini" {
		t.Errorf("model = %q, want gpt-4o-mini (env overrides file)", cfg.Model)
	}
}

func TestConfigFilePermissions(t *testing.T) {
	// The config file is expected to be created with mode 0600 by users;
	// the loader itself does not enforce mode, but we document the contract.
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(`{"api_key":"perm-test"}`), 0o600); err != nil {
		t.Fatal(err)
	}

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("stat config: %v", err)
	}
	mode := info.Mode().Perm()
	if mode != 0o600 {
		t.Errorf("config file mode = %o, want 0600 (documented contract)", mode)
	}
}
