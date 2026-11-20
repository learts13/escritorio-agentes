package processo

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
	"unicode/utf16"
)

func TestVivo(t *testing.T) {
	if !Vivo(os.Getpid()) {
		t.Error("o próprio processo deveria estar vivo")
	}
	if Vivo(0x7ffffff0) || Vivo(0) || Vivo(-1) {
		t.Error("PID inexistente deveria estar morto")
	}
}

func TestAgentePulaShells(t *testing.T) {
	// O hook roda num shell filho do agente; aqui o "agente" é o próprio teste.
	var shell *exec.Cmd
	if runtime.GOOS == "windows" {
		shell = exec.Command("cmd", "/c", "ping -n 6 127.0.0.1 >NUL")
	} else {
		shell = exec.Command("sh", "-c", "sleep 5; true")
	}
	if err := shell.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		shell.Process.Kill()
		shell.Wait()
	}()
	time.Sleep(200 * time.Millisecond)

	if got := Agente(shell.Process.Pid); got != os.Getpid() {
		t.Fatalf("o agente do shell %d deveria ser o teste %d, veio %d", shell.Process.Pid, os.Getpid(), got)
	}
}

func TestAgenteDeQuemNaoEShell(t *testing.T) {
	if got := Agente(os.Getpid()); got != os.Getpid() {
		t.Fatalf("processo que não é shell é o próprio agente: %d", got)
	}
	if got := Agente(0x7ffffff0); got != 0 {
		t.Fatalf("PID inexistente não tem agente: %d", got)
	}
}

func TestNome(t *testing.T) {
	quero := filepath.Base(os.Args[0])
	if got := Nome(os.Getpid()); !strings.EqualFold(got, quero) {
		t.Fatalf("Nome do próprio processo = %q, quero %q", got, quero)
	}
	if got := Nome(0x7ffffff0); got != "" {
		t.Fatalf("PID inexistente não tem nome: %q", got)
	}
}

func TestVivoDesdeRecusaPIDReaproveitado(t *testing.T) {
	eu := os.Getpid()
	inicio := Inicio(eu)
	if runtime.GOOS == "windows" && inicio == 0 {
		t.Fatal("no Windows, a hora de criação do próprio processo deveria sair")
	}
	if !VivoDesde(eu, inicio) || !VivoDesde(eu, 0) {
		t.Error("o próprio processo, com a hora certa ou sem hora, está vivo")
	}
	if runtime.GOOS == "windows" && VivoDesde(eu, inicio+1) {
		t.Error("o mesmo PID com outra hora de criação é outro processo")
	}
	if VivoDesde(0x7ffffff0, 0) || Inicio(0x7ffffff0) != 0 {
		t.Error("PID inexistente está morto e sem hora")
	}
}

// filhoComAmbiente abre um processo que dura uns 5 s com o ambiente do teste, sem o
// MAESTRI_TERMINAL_ID, mais extra, e devolve o PID dele.
func filhoComAmbiente(t *testing.T, extra ...string) int {
	t.Helper()
	var env []string
	for _, e := range os.Environ() {
		if !strings.HasPrefix(strings.ToUpper(e), VarTerminal+"=") {
			env = append(env, e)
		}
	}
	var filho *exec.Cmd
	if runtime.GOOS == "windows" {
		filho = exec.Command("cmd", "/c", "ping -n 6 127.0.0.1 >NUL")
	} else {
		filho = exec.Command("sh", "-c", "sleep 5; true")
	}
	filho.Env = append(env, extra...)
	if err := filho.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		filho.Process.Kill()
		filho.Wait()
	})
	time.Sleep(100 * time.Millisecond)
	return filho.Process.Pid
}

// O terminal sai do ambiente do processo (o MiniMax Code não o repassa ao hook): só o
// MAESTRI_TERMINAL_ID, e só com cara de id.
func TestTerminalMaestri(t *testing.T) {
	if runtime.GOOS != "windows" && runtime.GOOS != "linux" {
		t.Skip("só o Windows e o Linux leem o ambiente de outro processo")
	}
	casos := []struct{ nome, valor, quero string }{
		{"com o terminal", "MAESTRI_TERMINAL_ID=3f2b9c1e-7d4a-4e1b-9a0c-5d6e7f8a9b0c", "3f2b9c1e-7d4a-4e1b-9a0c-5d6e7f8a9b0c"},
		{"sem o terminal", "", ""},
		{"valor que não é id", "MAESTRI_TERMINAL_ID=a b;c", ""},
		{"valor longo demais", "MAESTRI_TERMINAL_ID=" + strings.Repeat("a", 129), ""},
		{"nome com sufixo", "MAESTRI_TERMINAL_IDX=abc", ""},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			var extra []string
			if c.valor != "" {
				extra = append(extra, c.valor)
			}
			if got := TerminalMaestri(filhoComAmbiente(t, extra...)); got != c.quero {
				t.Fatalf("TerminalMaestri = %q, quero %q", got, c.quero)
			}
		})
	}
	if got := TerminalMaestri(0x7ffffff0); got != "" {
		t.Fatalf("PID inexistente não tem terminal: %q", got)
	}
	if got := TerminalMaestri(0); got != "" {
		t.Fatalf("PID 0 não tem terminal: %q", got)
	}
}

// A busca anda pelo bloco como ele vem do sistema (uint16 no Windows, bytes no Linux).
func TestTerminalNoBloco(t *testing.T) {
	const id = "MAESTRI_TERMINAL_ID="
	casos := []struct{ nome, bloco, quero string }{
		{"no fim", "PATH=x\x00" + id + "abc-1.2_3\x00\x00", "abc-1.2_3"},
		{"sem NUL no fim", id + "abc", "abc"},
		{"o NUL duplo encerra o bloco", "PATH=x\x00\x00" + id + "abc\x00\x00", ""},
		{"nome sem caixa, como no Windows", "maestri_terminal_id=abc\x00\x00", "abc"},
		{"nome com sufixo", "MAESTRI_TERMINAL_IDX=abc\x00\x00", ""},
		{"nome com prefixo", "XMAESTRI_TERMINAL_ID=abc\x00\x00", ""},
		{"nome sem o =", "MAESTRI_TERMINAL_ID\x00\x00", ""},
		{"nome que começa com o nosso, sem =", "MAESTRI_TERMINAL_IDXabc\x00\x00", ""},
		{"vazio", id + "\x00\x00", ""},
		{"espaço", id + "a b\x00\x00", ""},
		{"fora do ASCII", id + "abç\x00\x00", ""},
		{"128 caracteres", id + strings.Repeat("a", 128), strings.Repeat("a", 128)},
		{"129 caracteres", id + strings.Repeat("a", 129), ""},
		{"vale a primeira entrada com o nome", id + "a b\x00" + id + "abc\x00\x00", ""},
		{"entrada do Windows que começa com =", "=C:=C:\\x\x00" + id + "abc\x00\x00", "abc"},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			if got := terminalNoBloco([]byte(c.bloco)); got != c.quero {
				t.Errorf("bytes: %q, quero %q", got, c.quero)
			}
			if got := terminalNoBloco(utf16.Encode([]rune(c.bloco))); got != c.quero {
				t.Errorf("uint16: %q, quero %q", got, c.quero)
			}
		})
	}
}
