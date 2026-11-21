package main

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"firmopolis/ponte/internal/servidor"
)

const chaveConectar = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

// trocar põe os falsos do conectar (hooks, systemctl, ponte rodando) e a pasta da ponte num temporário.
func trocar(t *testing.T, rodando bool) (dir string, hooks *int, systemctl *[]string) {
	t.Helper()
	raiz := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", raiz)
	t.Setenv("APPDATA", raiz)
	dir, _ = servidor.DirConfig()
	h, sc := 0, []string{}
	antes := []any{instalarHooks, rodarSystemctl, ponteRodando}
	instalarHooks = func(io.Writer) error { h++; return nil }
	rodarSystemctl = func(args ...string) error { sc = append(sc, strings.Join(args, " ")); return nil }
	ponteRodando = func() bool { return rodando }
	t.Cleanup(func() {
		instalarHooks = antes[0].(func(io.Writer) error)
		rodarSystemctl = antes[1].(func(...string) error)
		ponteRodando = antes[2].(func() bool)
	})
	return dir, &h, &sc
}

func firmopolis(t *testing.T, status int) *httptest.Server {
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+chaveConectar {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(status)
	}))
	t.Cleanup(ts.Close)
	return ts
}

func TestConectarDePontaAPonta(t *testing.T) {
	dir, hooks, _ := trocar(t, true)
	ts := firmopolis(t, http.StatusNoContent)
	var saida strings.Builder
	if err := conectar([]string{ts.URL + "/", strings.ToUpper(chaveConectar)}, &saida); err != nil {
		t.Fatal(err, saida.String())
	}
	c, ok := servidor.LerEspelho(dir)
	if !ok || c.URL != ts.URL || c.Chave != chaveConectar || *hooks != 1 {
		t.Fatalf("grava o espelho e instala os hooks: %+v %v %d", c, ok, *hooks)
	}
	out := saida.String()
	if !strings.Contains(out, "Deu certo!") || !strings.Contains(out, "já está rodando") || strings.Contains(out, chaveConectar) {
		t.Fatalf("saída:\n%s", out)
	}
}

func TestConectarChaveRecusadaNaoMudaNada(t *testing.T) {
	dir, hooks, _ := trocar(t, false)
	ts := firmopolis(t, http.StatusNoContent)
	var saida strings.Builder
	err := conectar([]string{ts.URL, strings.Repeat("ab", 32)}, &saida)
	if err == nil || !strings.Contains(err.Error(), "recusou a chave") || !strings.Contains(err.Error(), "Nada foi alterado") {
		t.Fatalf("erro claro: %v", err)
	}
	if _, ok := servidor.LerEspelho(dir); ok || *hooks != 0 {
		t.Fatal("o teste vem antes de mudar qualquer coisa")
	}
	for _, args := range [][]string{{ts.URL}, {"http://firmo.com", chaveConectar}, {ts.URL, "curta"}, {ts.URL, chaveConectar, "--outra"}} {
		if err := conectar(args, io.Discard); err == nil {
			t.Fatalf("%v deveria falhar", args)
		}
	}
	instalarHooks = func(io.Writer) error { return errors.New("plano com erro") }
	if err := conectar([]string{ts.URL, chaveConectar}, io.Discard); err == nil {
		t.Fatal("hooks com erro: falha")
	}
}

func TestConectarServicoNoLinux(t *testing.T) {
	_, _, sc := trocar(t, false)
	base, _ := os.UserConfigDir()
	unit := filepath.Join(base, "systemd", "user", nomeServico+".service")
	os.MkdirAll(filepath.Dir(unit), 0o755)
	os.WriteFile(unit, []byte("a minha"), 0o644)
	var saida strings.Builder
	if err := criarServico(&saida); err != nil {
		t.Fatal(err)
	}
	if dados, _ := os.ReadFile(unit); string(dados) != "a minha" || len(*sc) != 0 {
		t.Fatal("um serviço que já existe fica como está")
	}
	u := unidadeServico("/opt/ponte")
	if !strings.Contains(u, "ExecStart=/opt/ponte\n") || !strings.Contains(u, "StandardInput=null") || !strings.Contains(u, "WantedBy=default.target") {
		t.Fatalf("unit:\n%s", u)
	}
}

func TestSetupEspelho(t *testing.T) {
	dir := t.TempDir()
	var saida strings.Builder
	if err := setupEspelho(dir, "https://firmo.exemplo.com", chaveConectar, false, false, &saida); err != nil {
		t.Fatal(err)
	}
	if _, ok := servidor.LerEspelho(dir); ok {
		t.Fatal("o --plano não grava")
	}
	if err := setupEspelho(dir, "https://firmo.exemplo.com", chaveConectar, false, true, &saida); err != nil {
		t.Fatal(err)
	}
	if _, ok := servidor.LerEspelho(dir); !ok || strings.Contains(saida.String(), chaveConectar) {
		t.Fatalf("grava e nunca mostra a chave:\n%s", saida.String())
	}
	if err := setupEspelho(dir, "", "", false, true, &saida); err != nil {
		t.Fatal(err)
	}
	if _, ok := servidor.LerEspelho(dir); ok {
		t.Fatal("o --sem-espelho apaga")
	}
	// a decisão pelo servidor é opt-in: desligada por padrão, ligada só com --decidir-remoto
	if err := setupEspelho(dir, "https://firmo.exemplo.com", chaveConectar, false, true, &saida); err != nil {
		t.Fatal(err)
	}
	if c, _ := servidor.LerEspelho(dir); c.DecidirRemoto {
		t.Fatal("decidir remoto vem desligado")
	}
	if err := setupDecidirRemoto(dir, true, true, &saida); err != nil {
		t.Fatal(err)
	}
	if c, _ := servidor.LerEspelho(dir); !c.DecidirRemoto {
		t.Fatal("--decidir-remoto liga")
	}
	if err := setupDecidirRemoto(dir, false, true, &saida); err != nil {
		t.Fatal(err)
	}
	if c, ok := servidor.LerEspelho(dir); !ok || c.DecidirRemoto {
		t.Fatal("--sem-decidir-remoto desliga e mantém o espelho")
	}
	if err := setupDecidirRemoto(t.TempDir(), true, true, &saida); err == nil {
		t.Fatal("sem espelho, não liga")
	}
	for _, args := range [][]string{{"--aplicar", "--espelho", "https://x.com"}, {"--aplicar", "--sem-espelho", "--espelho", "https://x.com", "--chave-espelho", chaveConectar},
		{"--aplicar", "--decidir-remoto", "--sem-decidir-remoto"}, {"--aplicar", "--sem-espelho", "--decidir-remoto"},
		{"--espelho", "https://x.com", "--chave-espelho", chaveConectar}} {
		if err := setup(args, io.Discard); err == nil {
			t.Fatalf("%v deveria dar o uso", args)
		}
	}
}

// Sem a chave na linha de comando, ela vem da entrada (uma linha) e nunca aparece na saída.
func TestConectarLeAChaveDaEntrada(t *testing.T) {
	antes := entradaChave
	defer func() { entradaChave = antes }()
	entradaChave = strings.NewReader("\n")
	var saida strings.Builder
	if err := conectar([]string{"https://firmopolis.exemplo.com"}, &saida); err == nil {
		t.Fatal("aceitou chave vazia")
	}
	entradaChave = strings.NewReader(strings.Repeat("ab", 32) + "\n")
	ch, err := lerChave(&saida)
	if err != nil || ch != strings.Repeat("ab", 32) || strings.Contains(saida.String(), ch) {
		t.Fatalf("lerChave: %q %v %q", ch, err, saida.String())
	}
}
