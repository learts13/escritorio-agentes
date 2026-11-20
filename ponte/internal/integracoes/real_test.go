package integracoes

import (
	"bufio"
	"context"
	"encoding/json"
	"maps"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

// Testes com os agentes de verdade, fora da suíte comum (precisam do binário
// instalado): PONTE_TESTE_CLAUDE=1 e PONTE_TESTE_CODEX=1. Nenhum chama modelo nem
// toca a config real: o Claude roda só com a config do projeto temporário e o Codex
// com um CODEX_HOME temporário.

// ponteCompilada compila o ponte.exe em dir/bin e prepara um APPDATA com o token de
// teste, para o hook de verdade ler.
func ponteCompilada(t *testing.T, dir string) (exe, appdata string) {
	t.Helper()
	exe = filepath.Join(dir, "bin", "ponte.exe")
	if saida, err := exec.Command("go", "build", "-o", exe, "firmopolis/ponte/cmd/ponte").CombinedOutput(); err != nil {
		t.Fatalf("go build: %v\n%s", err, saida)
	}
	appdata = filepath.Join(dir, "appdata")
	os.MkdirAll(filepath.Join(appdata, "EscritorioVivo"), 0o700)
	os.WriteFile(filepath.Join(appdata, "EscritorioVivo", "token"), []byte(tokenTeste+"\n"), 0o600)
	return exe, appdata
}

// anotador é uma ponte de mentira: guarda os headers do último POST de cada evento.
type anotador struct {
	porta  int
	srv    *http.Server
	mu     sync.Mutex
	vistos map[string]http.Header
}

func novoAnotador(t *testing.T) *anotador {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	a := &anotador{porta: ln.Addr().(*net.TCPAddr).Port, vistos: map[string]http.Header{}}
	a.srv = &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var e struct {
			Nome string `json:"hook_event_name"`
		}
		json.NewDecoder(r.Body).Decode(&e)
		a.mu.Lock()
		a.vistos[e.Nome] = r.Header.Clone()
		a.mu.Unlock()
		w.WriteHeader(http.StatusNoContent)
	})}
	go a.srv.Serve(ln)
	t.Cleanup(func() { a.srv.Close() })
	return a
}

// conferir espera os hooks em segundo plano chegarem (até 3 s) e confere cada evento:
// token, terminal e hora de criação. Devolve os headers vistos.
func (a *anotador) conferir(t *testing.T, terminal string, eventos ...string) map[string]http.Header {
	t.Helper()
	falta := func() []string {
		a.mu.Lock()
		defer a.mu.Unlock()
		var lista []string
		for _, ev := range eventos {
			if _, ok := a.vistos[ev]; !ok {
				lista = append(lista, ev)
			}
		}
		return lista
	}
	for i := 0; i < 30 && len(falta()) > 0; i++ {
		time.Sleep(100 * time.Millisecond)
	}
	a.mu.Lock()
	vistos := maps.Clone(a.vistos)
	a.mu.Unlock()
	if f := falta(); len(f) > 0 {
		t.Errorf("não chegaram: %v; vistos: %v", f, slices.Collect(maps.Keys(vistos)))
	}
	for _, ev := range eventos {
		h, ok := vistos[ev]
		if !ok {
			continue
		}
		if h.Get("X-Maestri-Terminal-Id") != terminal || h.Get("X-Ponte-Token") != tokenTeste {
			t.Errorf("%s: terminal %q ou token errado", ev, h.Get("X-Maestri-Terminal-Id"))
		}
		if h.Get("X-Ponte-Hora") == "" {
			t.Errorf("%s: sem X-Ponte-Hora", ev)
		}
	}
	return vistos
}

// semPonteNaSaida falha se a saída do agente falar da ponte.
func semPonteNaSaida(t *testing.T, saida string) {
	t.Helper()
	for _, palavra := range []string{"ponte", "127.0.0.1", "refused", "recusou", "ECONNREFUSED"} {
		if strings.Contains(strings.ToLower(saida), strings.ToLower(palavra)) {
			t.Errorf("a saída mostrou %q:\n%s", palavra, saida)
		}
	}
}

// TestClaudeRealHookEmSegundoPlano prova, com o claude de verdade e o ponte.exe
// compilado, que o hook command async chega à ponte com o token (lido do arquivo da
// ponte), o MAESTRI_TERMINAL_ID herdado, a hora de criação e o PID do pai; e que, com a
// ponte desligada, nada da ponte aparece na saída. Um hook síncrono do próprio teste
// barra o prompt (exit 2), então o modelo não é chamado.
func TestClaudeRealHookEmSegundoPlano(t *testing.T) {
	if os.Getenv("PONTE_TESTE_CLAUDE") != "1" {
		t.Skip("PONTE_TESTE_CLAUDE=1 roda o claude de verdade")
	}
	projeto := tempDir(t)
	vigiar(t, projeto, nil)
	exe, appdata := ponteCompilada(t, projeto)
	ponte := novoAnotador(t)

	os.MkdirAll(filepath.Join(projeto, ".claude"), 0o755)
	op := Opcoes{Home: projeto, DirConfig: filepath.Join(projeto, "cfg"), Exe: exe, Token: tokenTeste, Porta: ponte.porta}
	aplicar(t, op) // o .claude/settings.json do projeto é o mesmo arquivo que o global seria na home
	settings := filepath.Join(projeto, ".claude", "settings.json")
	var cfg map[string]any
	dados, _ := os.ReadFile(settings)
	if err := json.Unmarshal(dados, &cfg); err != nil {
		t.Fatal(err)
	}
	hooks := cfg["hooks"].(map[string]any)
	hooks["UserPromptSubmit"] = append(hooks["UserPromptSubmit"].([]any), map[string]any{
		"hooks": []any{map[string]any{"type": "command", "command": "exit 2"}},
	})
	dados, _ = json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(settings, dados, 0o644)

	rodar := func() (string, int) {
		ctx, cancelar := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancelar()
		cmd := exec.CommandContext(ctx, "claude", "-p", "oi", "--setting-sources", "project", "--strict-mcp-config",
			"--disable-slash-commands", "--no-session-persistence", "--model", "haiku")
		cmd.Dir = projeto
		cmd.Env = append(os.Environ(), "MAESTRI_TERMINAL_ID=ev-teste-p6", "APPDATA="+appdata)
		saida, _ := cmd.CombinedOutput()
		t.Logf("claude: %s", strings.TrimSpace(string(saida)))
		return string(saida), cmd.Process.Pid
	}

	_, pid := rodar()
	vistos := ponte.conferir(t, "ev-teste-p6", "SessionStart", "UserPromptSubmit", "SessionEnd")
	for ev, h := range vistos {
		t.Logf("%s: PID do pai %s (claude %d)", ev, h.Get("X-Ponte-PID-Hook"), pid)
	}

	// Ponte desligada: o Claude segue e nada da ponte aparece.
	ponte.srv.Close()
	saida, _ := rodar()
	semPonteNaSaida(t, saida)
}

// TestCodexRealExecHooksEmSegundoPlano roda um codex exec de verdade com o hooks.json
// gerado. O CODEX_HOME temporário não tem login (e as chaves de API saem do ambiente),
// então o modelo não é chamado: a chamada volta 401. O --dangerously-bypass-hook-trust
// vale só para esta execução, no lugar da aprovação do /hooks (nada grava trusted_hash).
// Prova que os eventos chegam com o vínculo e que o Codex não mostra nada dos hooks em
// segundo plano, nem com a ponte desligada.
func TestCodexRealExecHooksEmSegundoPlano(t *testing.T) {
	if os.Getenv("PONTE_TESTE_CODEX") != "1" {
		t.Skip("PONTE_TESTE_CODEX=1 roda o codex de verdade")
	}
	raiz := tempDir(t)
	vigiar(t, raiz, nil)
	exe, appdata := ponteCompilada(t, raiz)
	ponte := novoAnotador(t)
	home := filepath.Join(raiz, "home")
	codexHome := filepath.Join(home, ".codex")
	projeto := filepath.Join(raiz, "proj")
	os.MkdirAll(codexHome, 0o755)
	os.MkdirAll(projeto, 0o755)
	aplicar(t, Opcoes{Home: home, DirConfig: filepath.Join(raiz, "cfg"), Exe: exe, Token: tokenTeste, Porta: ponte.porta})
	// O comando do Codex usa a porta padrão; aqui ele aponta para a ponte de mentira.
	hooksJSON := filepath.Join(codexHome, "hooks.json")
	dados, _ := os.ReadFile(hooksJSON)
	os.WriteFile(hooksJSON, []byte(strings.ReplaceAll(string(dados), "hook codex", "hook --porta "+strconv.Itoa(ponte.porta)+" codex")), 0o644)

	nome := "codex"
	if runtime.GOOS == "windows" {
		nome = "codex.cmd"
	}
	rodar := func() string {
		ctx, cancelar := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancelar()
		cmd := exec.CommandContext(ctx, nome, "exec", "--skip-git-repo-check", "--dangerously-bypass-hook-trust", "oi")
		cmd.Dir = projeto
		cmd.Env = append(os.Environ(), "CODEX_HOME="+codexHome, "APPDATA="+appdata, "MAESTRI_TERMINAL_ID=ev-teste-codex",
			"OPENAI_API_KEY=", "CODEX_API_KEY=")
		cmd.Stdin = strings.NewReader("")
		saida, _ := cmd.CombinedOutput()
		texto := string(saida)
		if !strings.Contains(texto, "401") {
			t.Fatalf("esperava o 401 de quem não tem login (o modelo não pode ser chamado):\n%s", texto)
		}
		return texto
	}

	saida := rodar()
	// O Stop não vem: o turno acaba no 401. Os dois primeiros são em segundo plano e
	// rodam no primeiro uso do ponte.exe recém-compilado, o caso do arranque frio.
	vistos := ponte.conferir(t, "ev-teste-codex", "SessionStart", "UserPromptSubmit")
	// O SessionEnd é síncrono, e o Codex dá a ele no máximo 3 s contando a abertura do
	// PowerShell: com a máquina carregada ele se perde, e a ponte encerra a sessão pela
	// morte do processo do Codex. Quando chega, passa pela mesma conferência.
	if _, ok := vistos["SessionEnd"]; ok {
		ponte.conferir(t, "ev-teste-codex", "SessionEnd")
	} else {
		t.Log("o SessionEnd não chegou (prazo de 3 s do Codex, com a máquina carregada)")
	}
	// O Codex mostra "hook: <evento>" e "Completed" dos hooks síncronos de início de
	// sessão e de prompt; dos em segundo plano, nada.
	for _, linha := range strings.Split(saida, "\n") {
		if strings.HasPrefix(strings.TrimSpace(linha), "hook:") || strings.Contains(linha, "running async") {
			t.Errorf("o Codex mostrou o hook: %s", linha)
		}
	}
	semPonteNaSaida(t, saida)

	ponte.srv.Close()
	semPonteNaSaida(t, rodar())
}

// TestCodexRealAceitaHooksJSON confere, pelo hooks/list do app-server, que o Codex lê
// o hooks.json gerado sem erro e enxerga o nosso hook em cada evento.
func TestCodexRealAceitaHooksJSON(t *testing.T) {
	if os.Getenv("PONTE_TESTE_CODEX") != "1" {
		t.Skip("PONTE_TESTE_CODEX=1 roda o codex app-server de verdade")
	}
	a := novoAmbiente(t)
	aplicar(t, a.op)
	codexHome := a.caminho(".codex")

	nome := "codex"
	if runtime.GOOS == "windows" {
		nome = "codex.cmd"
	}
	ctx, cancelar := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancelar()
	cmd := exec.CommandContext(ctx, nome, "app-server")
	cmd.Env = append(os.Environ(), "CODEX_HOME="+codexHome)
	entrada, _ := cmd.StdinPipe()
	saidaPipe, _ := cmd.StdoutPipe()
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cmd.Process.Kill()
		cmd.Wait()
	}()
	leitor := bufio.NewReader(saidaPipe)
	enviar := func(m map[string]any) {
		m["jsonrpc"] = "2.0"
		dados, _ := json.Marshal(m)
		entrada.Write(append(dados, '\n'))
	}
	esperar := func(id int) map[string]any {
		for {
			linha, err := leitor.ReadBytes('\n')
			if err != nil {
				t.Fatalf("o app-server parou: %v", err)
			}
			var m map[string]any
			if json.Unmarshal(linha, &m) == nil && m["id"] == float64(id) {
				return m
			}
		}
	}
	enviar(map[string]any{"id": 1, "method": "initialize", "params": map[string]any{"clientInfo": map[string]any{"name": "ponte-teste", "title": "ponte", "version": "0"}}})
	esperar(1)
	enviar(map[string]any{"method": "initialized"})
	enviar(map[string]any{"id": 2, "method": "hooks/list", "params": map[string]any{"cwds": []string{a.op.Home}}})
	resp := esperar(2)
	bruto, _ := json.Marshal(resp)
	t.Logf("hooks/list: %s", bruto)

	resultado, _ := resp["result"].(map[string]any)
	dados, _ := resultado["data"].([]any)
	if len(dados) == 0 {
		t.Fatalf("hooks/list sem dados: %s", bruto)
	}
	vistos := map[string]bool{}
	for _, d := range dados {
		e := d.(map[string]any)
		if erros, _ := e["errors"].([]any); len(erros) > 0 {
			t.Errorf("o Codex reclamou do hooks.json: %v", erros)
		}
		if avisos, _ := e["warnings"].([]any); len(avisos) > 0 {
			t.Errorf("o Codex avisou sobre o hooks.json: %v", avisos)
		}
		hooks, _ := e["hooks"].([]any)
		for _, h := range hooks {
			m := h.(map[string]any)
			if c, _ := m["command"].(string); strings.Contains(c, "hook codex") {
				ev := strings.ToLower(m["eventName"].(string))
				vistos[ev] = true
				// Em segundo plano, menos o SessionEnd, como o Codex entende.
				if async, _ := m["async"].(bool); async != (ev != "sessionend") {
					t.Errorf("o Codex leu async=%v no %s", m["async"], ev)
				}
			}
		}
	}
	for _, ev := range eventosCodex {
		if !vistos[strings.ToLower(ev)] {
			t.Errorf("o Codex não enxergou o nosso hook em %s (vistos: %v)", ev, vistos)
		}
	}
}
