package servidor

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"firmopolis/ponte/internal/historico"
	"firmopolis/ponte/internal/mundo"
)

func TestNormalizarOrigem(t *testing.T) {
	bons := map[string]string{
		"https://escritorio.exemplo.com":      "https://escritorio.exemplo.com",
		"https://Escritorio.Exemplo.com/":     "https://escritorio.exemplo.com",
		"https://escritorio.exemplo.com:443":  "https://escritorio.exemplo.com",
		"https://escritorio.exemplo.com:8443": "https://escritorio.exemplo.com:8443",
		"http://localhost:8080":               "http://localhost:8080",
		"http://127.0.0.1:8080":               "http://127.0.0.1:8080",
		"  https://a.b  ":                     "https://a.b",
	}
	for entrada, quero := range bons {
		if got, err := NormalizarOrigem(entrada); err != nil || got != quero {
			t.Errorf("%q: veio %q, %v; queria %q", entrada, got, err, quero)
		}
	}
	for _, ruim := range []string{"", "escritorio.exemplo.com", "http://escritorio.exemplo.com", "ftp://a.b",
		"https://a.b/escritorio", "https://a.b?x=1", "https://a.b#x", "https://u:s@a.b", "javascript:alert(1)", "null", "https://"} {
		if got, err := NormalizarOrigem(ruim); err == nil {
			t.Errorf("%q deveria ser recusado, veio %q", ruim, got)
		}
	}
}

func TestOrigensGravarELer(t *testing.T) {
	dir := t.TempDir()
	if got := LerOrigens(dir); len(got) != 0 {
		t.Fatalf("sem arquivo, nenhuma origem: %v", got)
	}
	if err := GravarOrigens(dir, []string{"https://a.b", "http://localhost:8080"}); err != nil {
		t.Fatal(err)
	}
	if got := LerOrigens(dir); !slices.Equal(got, []string{"https://a.b", "http://localhost:8080"}) {
		t.Fatalf("veio %v", got)
	}
	// linha inválida ou repetida não libera nada
	os.WriteFile(filepath.Join(dir, ArquivoOrigens), []byte("https://a.b\nlixo\nhttp://evil.com\nhttps://a.b/\n"), 0o600)
	if got := LerOrigens(dir); !slices.Equal(got, []string{"https://a.b"}) {
		t.Fatalf("veio %v", got)
	}
}

func TestDirConfigMigraDoEscritorioVivo(t *testing.T) {
	base := t.TempDir()
	if got := dirConfigEm(base); got != filepath.Join(base, "Firmopolis") {
		t.Fatalf("sem nada, a pasta nova: %s", got)
	}
	antiga := filepath.Join(base, "EscritorioVivo")
	os.MkdirAll(antiga, 0o700)
	os.WriteFile(filepath.Join(antiga, "token"), []byte(tokenTeste), 0o600)
	nova := dirConfigEm(base)
	if nova != filepath.Join(base, "Firmopolis") || LerToken(nova) != tokenTeste {
		t.Fatalf("o token deveria vir junto para %s", nova)
	}
	if _, err := os.Stat(antiga); !os.IsNotExist(err) {
		t.Fatal("a pasta antiga deveria ter sido renomeada")
	}
	// já migrada: a antiga que reaparecer não é tocada
	os.MkdirAll(antiga, 0o700)
	if dirConfigEm(base) != nova {
		t.Fatal("com a nova, vale a nova")
	}
}

const origemApp = "https://escritorio.exemplo.com"

// conectarNavegador abre o /ws como o navegador: Origin e o token no subprotocolo.
func (a *ambiente) conectarNavegador(t *testing.T, origem string, protocolos ...string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	url := "ws" + strings.TrimPrefix(a.url, "http") + "/ws"
	c, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origem}}, Subprotocols: protocolos})
	if c != nil {
		c.SetReadLimit(16 << 20)
		t.Cleanup(func() { c.CloseNow() })
	}
	return c, resp, err
}

func TestNavegadorDaListaLeOWS(t *testing.T) {
	a := subir(t, Opcoes{Origens: func() []string { return []string{origemApp} }}, true)
	c, _, err := a.conectarNavegador(t, origemApp, Subprotocolo, "token."+tokenTeste)
	if err != nil {
		t.Fatal(err)
	}
	if c.Subprotocol() != Subprotocolo {
		t.Fatalf("a resposta escolhe só o %s (nunca o token), veio %q", Subprotocolo, c.Subprotocol())
	}
	if m := ler(t, c); m["tipo"] != "snapshot" {
		t.Fatalf("a primeira mensagem é o snapshot, veio %v", m["tipo"])
	}
}

func TestNavegadorSemTokenOuForaDaLista403(t *testing.T) {
	a := subir(t, Opcoes{Origens: func() []string { return []string{origemApp} }}, false)
	casos := []struct {
		origem     string
		protocolos []string
	}{
		{origemApp, nil},
		{origemApp, []string{Subprotocolo}},
		{origemApp, []string{"token." + tokenTeste}},        // sem o subprotocolo
		{origemApp, []string{Subprotocolo, "token.errado"}}, // token errado
		{origemApp, []string{Subprotocolo, "token." + tokenTeste[:63]}},
		{"https://evil.com", []string{Subprotocolo, "token." + tokenTeste}},
		{"https://escritorio.exemplo.com.evil.com", []string{Subprotocolo, "token." + tokenTeste}},
		{"http://escritorio.exemplo.com", []string{Subprotocolo, "token." + tokenTeste}},
		{"null", []string{Subprotocolo, "token." + tokenTeste}},
	}
	for _, c := range casos {
		if _, resp, err := a.conectarNavegador(t, c.origem, c.protocolos...); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Errorf("Origin %q com %v: esperava 403", c.origem, c.protocolos)
		}
	}
}

func TestOrigemDaListaSoValeNoWS(t *testing.T) {
	a := subir(t, Opcoes{Origens: func() []string { return []string{origemApp} }}, false)
	if resp := a.post(t, "claude", promptClaude, map[string]string{"Origin": origemApp}); resp.StatusCode != http.StatusForbidden {
		t.Errorf("POST /evento com Origin da lista: veio %d, esperava 403", resp.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodGet, a.url+"/ws", nil)
	req.Header.Add("Origin", origemApp)
	req.Header.Add("Origin", "https://evil.com")
	resp, err := clienteHTTP.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("dois Origin: veio %d, esperava 403", resp.StatusCode)
	}
}

func TestOrigensRelidasACadaPedido(t *testing.T) {
	var lista atomic.Pointer[[]string]
	lista.Store(&[]string{})
	a := subir(t, Opcoes{Origens: func() []string { return *lista.Load() }}, false)
	if _, resp, err := a.conectarNavegador(t, origemApp, Subprotocolo, "token."+tokenTeste); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatal("fora da lista: 403")
	}
	lista.Store(&[]string{origemApp})
	if _, _, err := a.conectarNavegador(t, origemApp, Subprotocolo, "token."+tokenTeste); err != nil {
		t.Fatalf("o setup gravou: vale sem reiniciar: %v", err)
	}
}

func TestOrigemComCuringaRecusada(t *testing.T) {
	for _, o := range []string{"https://*.exemplo.com", "https://a?.b", "https://[a].b"} {
		if _, err := NormalizarOrigem(o); err == nil {
			t.Errorf("%q deveria ser recusada", o)
		}
	}
	if _, err := NormalizarOrigem("http://[::1]:8080"); err != nil {
		t.Errorf("[::1] vale no próprio PC: %v", err)
	}
}

func TestDirConfigMigracaoConcorrente(t *testing.T) {
	base := t.TempDir()
	antiga := filepath.Join(base, "EscritorioVivo")
	os.MkdirAll(antiga, 0o700)
	os.WriteFile(filepath.Join(antiga, "token"), []byte(tokenTeste), 0o600)
	nova := filepath.Join(base, "Firmopolis")
	var wg sync.WaitGroup
	erros := make(chan string, 16)
	for range 16 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if got := dirConfigEm(base); got != nova {
				erros <- got
			}
		}()
	}
	wg.Wait()
	close(erros)
	for got := range erros {
		t.Errorf("hooks em paralelo: todos ficam com a nova, um ficou com %s", got)
	}
	if LerToken(nova) != tokenTeste {
		t.Fatal("o token veio junto")
	}
}

func TestNavegadorRecebeSoOQueATelaUsa(t *testing.T) {
	msg := msgMorador{V: 1, Tipo: "morador", Morador: mundo.Morador{ID: "a", Atividade: &mundo.Atividade{Ferramenta: "Edit", Alvo: "segredo.go"}}}
	r, ok := paraNavegador(msg).(msgMorador)
	if !ok || r.Morador.Atividade.Alvo != "" || r.Morador.Atividade.Ferramenta != "Edit" {
		t.Fatalf("sem o alvo, com a ferramenta: %+v", r.Morador.Atividade)
	}
	if msg.Morador.Atividade.Alvo != "segredo.go" {
		t.Fatal("o original (o do jogo) não muda")
	}
	dia := msgDia{V: 1, Tipo: "dia", Eventos: []historico.EventoHist{{MoradorID: "a", Ferramenta: "Edit", Alvo: "segredo.go"}}}
	rd, ok := paraNavegador(dia).(msgDia)
	if !ok || len(rd.Eventos) != 1 || rd.Eventos[0].Alvo != "" || rd.Eventos[0].Ferramenta != "Edit" {
		t.Fatalf("o dia vai sem o alvo: %+v", rd)
	}
	if dia.Eventos[0].Alvo != "segredo.go" {
		t.Fatal("o dia original (o do jogo) não muda")
	}
}

// O navegador recebe o dia depois do snapshot, sem nenhum alvo; o jogo, com o alvo.
func TestNavegadorRecebeODiaSemAlvo(t *testing.T) {
	hist, err := historico.Abrir(t.TempDir(), 30)
	if err != nil {
		t.Fatal(err)
	}
	defer hist.Fechar()
	a := subir(t, Opcoes{Historico: hist, Origens: func() []string { return []string{origemApp} }}, true)
	a.post(t, "claude", promptClaude, map[string]string{"X-Maestri-Terminal-Id": "T1"})
	a.post(t, "claude", []byte(`{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Edit","tool_input":{"file_path":"C:\\proj\\loja\\segredo.go"}}`), map[string]string{"X-Maestri-Terminal-Id": "T1"})
	esperar(t, func() bool { return len(hist.Hoje()) == 2 })

	jogo, _, err := a.conectar(t, comToken())
	if err != nil {
		t.Fatal(err)
	}
	ler(t, jogo) // snapshot
	comAlvo := false
	for _, e := range ler(t, jogo)["eventos"].([]any) {
		comAlvo = comAlvo || e.(map[string]any)["alvo"] != ""
	}
	if !comAlvo {
		t.Fatal("o jogo recebe o dia com o alvo")
	}

	c, _, err := a.conectarNavegador(t, origemApp, Subprotocolo, "token."+tokenTeste)
	if err != nil {
		t.Fatal(err)
	}
	if m := ler(t, c); m["tipo"] != "snapshot" {
		t.Fatalf("1ª mensagem: o snapshot, veio %v", m["tipo"])
	}
	dia := ler(t, c)
	eventos, _ := dia["eventos"].([]any)
	if dia["tipo"] != "dia" || len(eventos) != 2 {
		t.Fatalf("2ª mensagem: o dia com os 2 eventos, veio %v", dia)
	}
	for _, e := range eventos {
		if alvo := e.(map[string]any)["alvo"]; alvo != "" {
			t.Fatalf("o dia do navegador vai sem o alvo, veio %v", alvo)
		}
	}
}
