//go:build !windows

package maestri

import (
	"os"
	"path/filepath"
	"testing"
)

func TestBinarioSeguro(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "maestri")
	if err := os.WriteFile(bin, []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if !binarioSeguro(bin) {
		t.Fatal("do usuário, sem escrita para outros: vale")
	}
	for _, modo := range []os.FileMode{0o775, 0o757, 0o644} {
		os.Chmod(bin, modo)
		if binarioSeguro(bin) {
			t.Errorf("modo %o não vale", modo)
		}
	}
	if binarioSeguro(dir) || binarioSeguro(filepath.Join(dir, "nada")) {
		t.Error("pasta ou arquivo ausente não vale")
	}
}
