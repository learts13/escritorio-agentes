package processo

import (
	"fmt"
	"strings"
	"syscall"
	"testing"
	"unsafe"
)

var getProcessHandleCount = syscall.NewLazyDLL("kernel32.dll").NewProc("GetProcessHandleCount")

// Um bloco de ambiente acima de 1 MiB não é lido.
func TestAmbienteGrandeDemais(t *testing.T) {
	ambiente := func(variaveis int) []string {
		env := []string{"MAESTRI_TERMINAL_ID=abc"}
		for i := range variaveis {
			env = append(env, fmt.Sprintf("EV_TESTE_%d=%s", i, strings.Repeat("x", 30000)))
		}
		return env
	}
	if got := TerminalMaestri(filhoComAmbiente(t, ambiente(10)...)); got != "abc" {
		t.Fatalf("com uns 600 KB de ambiente, o terminal sai: %q", got)
	}
	if got := TerminalMaestri(filhoComAmbiente(t, ambiente(20)...)); got != "" {
		t.Fatalf("com uns 1,2 MB de ambiente, nada é lido: %q", got)
	}
}

// Só a leitura inteira vale.
func TestLeituraParcialNaoVale(t *testing.T) {
	pid := filhoComAmbiente(t, "MAESTRI_TERMINAL_ID=abc")
	if got := TerminalMaestri(pid); got != "abc" {
		t.Fatalf("TerminalMaestri = %q", got)
	}
	original := lerProcesso
	t.Cleanup(func() { lerProcesso = original })
	lerProcesso = func(h syscall.Handle, endereco uintptr, destino unsafe.Pointer, tam uintptr) (bool, uintptr) {
		ok, lidos := original(h, endereco, destino, tam)
		return ok, lidos - 1
	}
	if got := TerminalMaestri(pid); got != "" {
		t.Fatalf("leitura parcial não vale: %q", got)
	}
}

// Só de um processo cujo dono é o usuário da ponte.
func TestSoDoMesmoDono(t *testing.T) {
	pid := filhoComAmbiente(t, "MAESTRI_TERMINAL_ID=abc")
	if got := TerminalMaestri(pid); got != "abc" {
		t.Fatalf("TerminalMaestri = %q", got)
	}
	original := sidPonte
	t.Cleanup(func() { sidPonte = original })
	for _, sid := range []string{"S-1-5-18", ""} { // SYSTEM; sem como ler o da ponte
		sidPonte = func() string { return sid }
		if got := TerminalMaestri(pid); got != "" {
			t.Fatalf("processo de outro dono (ponte %q): %q", sid, got)
		}
	}
}

// Cada leitura fecha o que abriu (o processo e o token dele).
func TestAmbienteFechaOsHandles(t *testing.T) {
	abertos := func() int {
		var n uint32
		eu, _ := syscall.GetCurrentProcess()
		if r, _, err := getProcessHandleCount.Call(uintptr(eu), uintptr(unsafe.Pointer(&n))); r == 0 {
			t.Fatal(err)
		}
		return int(n)
	}
	pid := filhoComAmbiente(t, "MAESTRI_TERMINAL_ID=abc")
	TerminalMaestri(pid) // a primeira carrega as DLLs e o SID da ponte
	antes := abertos()
	for range 200 {
		TerminalMaestri(pid)
	}
	if depois := abertos(); depois-antes > 50 {
		t.Fatalf("200 leituras deixaram %d handles abertos", depois-antes)
	}
}
