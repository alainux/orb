package agent

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeFile(t *testing.T, name, content string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestValidateContextFiles_EmptyOK(t *testing.T) {
	if err := ValidateContextFiles(nil); err != nil {
		t.Fatalf("nil should be valid: %v", err)
	}
	if err := ValidateContextFiles([]string{}); err != nil {
		t.Fatalf("empty should be valid: %v", err)
	}
}

func TestValidateContextFiles_SupportedExtensions(t *testing.T) {
	for _, name := range []string{"a.md", "b.txt", "c.json", "d.yaml", "e.yml"} {
		p := writeFile(t, name, "hi")
		if err := ValidateContextFiles([]string{p}); err != nil {
			t.Errorf("%s should be accepted: %v", name, err)
		}
	}
}

func TestValidateContextFiles_RejectsBadFormat(t *testing.T) {
	bad := []string{"notes.pdf", "pic.png", "data.csv", "UPPER.DOC"}
	for _, b := range bad {
		p := writeFile(t, b, "x")
		if err := ValidateContextFiles([]string{p}); err == nil {
			t.Errorf("%s should be rejected as unsupported format", b)
		} else if !strings.Contains(err.Error(), "unsupported") {
			t.Errorf("%s: unexpected error %v", b, err)
		}
	}
}

func TestValidateContextFiles_TooMany(t *testing.T) {
	var paths []string
	for i := 0; i < maxContextFiles+1; i++ {
		paths = append(paths, writeFile(t, "f.md", "x"))
	}
	if err := ValidateContextFiles(paths); err == nil {
		t.Fatal(">10 files should fail")
	}
}

func TestValidateContextFiles_TooLargeSingleAndTotal(t *testing.T) {
	big := strings.Repeat("x", maxSingleContextBytes+1)
	p := writeFile(t, "big.md", big)
	if err := ValidateContextFiles([]string{p}); err == nil {
		t.Fatal("single file over 50KB should fail")
	}
}

func TestValidateContextFiles_TotalLimit(t *testing.T) {
	var paths []string
	per := maxContextBytes/maxContextFiles + 1
	for i := 0; i < maxContextFiles; i++ {
		paths = append(paths, writeFile(t, "seg.md", strings.Repeat("y", per)))
	}
	if err := ValidateContextFiles(paths); err == nil {
		t.Fatal("total over 100KB should fail")
	}
}

func TestValidateContextFiles_MissingFile(t *testing.T) {
	if err := ValidateContextFiles([]string{"/def/nope/missing.md"}); err == nil {
		t.Fatal("missing file should fail")
	}
}

func TestValidateContextFiles_InvalidUTF8(t *testing.T) {
	p := filepath.Join(t.TempDir(), "bad.md")
	if err := os.WriteFile(p, []byte{0xff, 0xfe, 'a'}, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := ValidateContextFiles([]string{p}); err == nil {
		t.Fatal("invalid UTF-8 should fail (AC-8.4)")
	}
}
