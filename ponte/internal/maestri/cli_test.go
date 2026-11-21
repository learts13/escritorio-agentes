package maestri

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// falsoBinario é um maestri de mentira: grava cada argumento numa linha, mais o ambiente do
// Maestri, e responde o list com a saída dada.
func falsoBinario(t *testing.T, saidaList string) (bin, registro string) {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("o binário falso é um script sh")
	}
	dir := t.TempDir()
	registro = filepath.Join(dir, "registro")
	lista := filepath.Join(dir, "lista")
	if err := os.WriteFile(lista, []byte(saidaList), 0o600); err != nil {
		t.Fatal(err)
	}
	bin = filepath.Join(dir, "maestri")
	script := "#!/bin/sh\n" +
		"printf 'TERM=%s\\nSOCK=%s\\n' \"$MAESTRI_TERMINAL_ID\" \"$MAESTRI_SOCKET\" >> '" + registro + "'\n" +
		"for a in \"$@\"; do printf 'ARG=%s\\n' \"$a\" >> '" + registro + "'; done\n" +
		"[ \"$1\" = list ] && cat '" + lista + "'\n" +
		"exit 0\n"
	if err := os.WriteFile(bin, []byte(script), 0o700); err != nil {
		t.Fatal(err)
	}
	return bin, registro
}

func TestDigitarPassaOsArgumentosSemShell(t *testing.T) {
	bin, registro := falsoBinario(t, "")
	c := CLI{Bin: bin, Socket: "/tmp/maestri-x/maestri.sock"}
	texto := `sim; rm -rf / $(whoami) "aspas" 'simples' * ~ | & > ok`
	if err := c.Digitar(context.Background(), "peer-1", "Front · Opus", texto); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(registro)
	want := "TERM=peer-1\nSOCK=/tmp/maestri-x/maestri.sock\nARG=ask\nARG=Front · Opus\nARG=--raw\nARG=" + texto + `\n` + "\n"
	if string(b) != want {
		t.Fatalf("registro:\n%s\nqueria:\n%s", b, want)
	}
}

func TestConectadosLeSoOsAgentesConectados(t *testing.T) {
	saida := `You:
  - name: "Front", maestro: true

Connected agents:
  - band: "Banda", with you
    - name: "Auditor"
      ⎿ fichário: "Fichário"
        ⎿ note: "untitled"
    - name: "Maestro · Opus", maestro: true
  - name: "Com "aspas" no nome"
Notes:
  - name: "nota solta"
`
	bin, registro := falsoBinario(t, saida)
	nomes, err := CLI{Bin: bin, Socket: "/s"}.Conectados(context.Background(), "alvo-1")
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(nomes, "|"); got != `Auditor|Maestro · Opus|Com "aspas" no nome` {
		t.Fatalf("conectados: %q", got)
	}
	if b, _ := os.ReadFile(registro); !strings.HasPrefix(string(b), "TERM=alvo-1\n") {
		t.Fatalf("o list roda como o próprio alvo: %s", b)
	}
}

// TestMaestriReal digita num terminal de teste de verdade, achando o binário e o socket como o
// serviço acha. Desligado por padrão; nunca aponte para um terminal que alguém usa:
//
//	PONTE_TESTE_MAESTRI="<id do terminal de teste>|<nome dele>" env -u MAESTRI_SOCKET -u MAESTRI_TERMINAL_ID go test ./internal/maestri -run Real
func TestMaestriReal(t *testing.T) {
	alvo, nome, ok := strings.Cut(os.Getenv("PONTE_TESTE_MAESTRI"), "|")
	if !ok {
		t.Skip("PONTE_TESTE_MAESTRI não definido")
	}
	c, ok := AcharCLI()
	if !ok {
		t.Fatal("sem o binário ou o socket")
	}
	conectados, err := c.Conectados(context.Background(), alvo)
	if err != nil || len(conectados) == 0 {
		t.Fatalf("conectados: %v %v", conectados, err)
	}
	t.Logf("binário %s, socket %s, conectados ao alvo: %d", c.Bin, c.Socket, len(conectados))
	de := os.Getenv("PONTE_TESTE_MAESTRI_DE") // o id de um terminal conectado ao alvo
	if err := c.Digitar(context.Background(), de, nome, "echo ponte-real-ok"); err != nil {
		t.Fatal(err)
	}
}

func TestFalhaDoBinarioViraErroSemTexto(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("script sh")
	}
	bin := filepath.Join(t.TempDir(), "maestri")
	os.WriteFile(bin, []byte("#!/bin/sh\necho 'texto do terminal' >&2\nexit 1\n"), 0o700)
	err := CLI{Bin: bin, Socket: "/s"}.Digitar(context.Background(), "a", "b", "c")
	if err == nil || strings.Contains(err.Error(), "texto do terminal") {
		t.Fatalf("erro: %v", err)
	}
}
