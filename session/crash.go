package session

import (
	"fmt"
	"os"
	"path/filepath"
	"time"
)

// CrashDir returns the crash-recovery directory: ~/.orb/crash (AC-11.5).
func CrashDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("crash: user home: %w", err)
	}
	return filepath.Join(home, ".orb", "crash"), nil
}

// WriteCrashSnapshot persists the current (partial) artifact to
// ~/.orb/crash/<timestamp>.md so work is not lost on an abnormal disconnect
// (AC-11.5). The file is written 0600 like the main artifact (AC-14.x).
// Returns the written path.
func WriteCrashSnapshot(content string, now time.Time) (string, error) {
	dir, err := CrashDir()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("crash: mkdir %s: %w", dir, err)
	}
	name := fmt.Sprintf("crash-%s.md", now.Format("20060102-150405"))
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		return "", fmt.Errorf("crash: write %s: %w", path, err)
	}
	return path, nil
}
