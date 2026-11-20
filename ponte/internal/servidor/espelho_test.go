package servidor

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"firmopolis/ponte/internal/historico"
	"firmopolis/ponte/internal/maestri"
	"firmopolis/ponte/internal/mundo"
)

const chaveTeste = "c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0c0"

// recebedor é o Firmópolis de mentira: guarda cada POST e responde com status.
type recebedor struct {
	mu      sync.Mutex
	pedidos []*http.Request
	corpos  []string
	status  int
}

func (r *recebedor) ServeHTTP(w http.ResponseWriter, p *http.Request) {
	corpo, _ := io.ReadAll(p.Body)
	r.mu.Lock()
	r.pedidos, r.corpos = append(r.pedidos, p), append(r.corpos, string(corpo))
	st := r.status
	r.mu.Unlock()
	if st == 0 {
		st = http.StatusNoContent
	}
	w.WriteHeader(st)
}

func (r *recebedor) n() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pedidos)
}

func espelhoDeTeste(t *testing.T, status int, op Opcoes) (*Servidor, *recebedor) {
	t.Helper()
	rec := &recebedor{status: status}
	ts := httptest.NewServer(rec)
	t.Cleanup(ts.Close)
	c := ConfigEspelho{URL: ts.URL, Chave: chaveTeste}
	op.Espelho = func() (ConfigEspelho, bool) { return c, true }
	s := Novo(op)
	ctx, cancelar := context.WithCancel(context.Background())
	t.Cleanup(cancelar)
	go s.espelhar(ctx)
	return s, rec
}

func sinal(ferramenta string) mundo.Sinal {
	return mundo.Sinal{Fonte: "claude", SessaoID: "s1", Estado: mundo.Ocupado, Ferramenta: ferramenta,
		Alvo: "/home/segredo/chave.pem", Cwd: "/home/x/loja", Inicio: true, TS: time.Now()}
}

func TestEspelhoMandaAVisaoReduzidaComChaveEDebounce(t *testing.T) {
	s, rec := espelhoDeTeste(t, 0, Opcoes{EsperaEspelho: 150 * time.Millisecond, VidaEspelho: time.Hour})
	s.mu.Lock()
	s.workspaces = []maestri.Workspace{{ID: "w1", Nome: "Loja", Projeto: "/home/x/loja-secreta",
		Bands: []maestri.Band{{ID: "b1", Nome: "Front", Membros: []string{"T1"}}}}}
	s.mu.Unlock()
	for _, f := range []string{"Read", "Edit", "Bash"} { // três mudanças seguidas: um envio só
		s.aplicar([]mundo.Sinal{sinal(f)})
	}
	esperar(t, func() bool { return rec.n() >= 1 })
	time.Sleep(400 * time.Millisecond)
	if n := rec.n(); n != 1 {
		t.Fatalf("o debounce junta as mudanças: %d envios", n)
	}
	p, corpo := rec.pedidos[0], rec.corpos[0]
	if p.URL.Path != "/api/ponte/espelho" || p.Method != http.MethodPost || p.Header.Get("Authorization") != "Bearer "+chaveTeste ||
		!strings.HasPrefix(p.Header.Get("User-Agent"), "Firmopolis-ponte/") || p.Header.Get("Content-Type") != "application/json" {
		t.Fatalf("pedido errado: %s %s %v", p.Method, p.URL.Path, p.Header)
	}
	for _, proibido := range []string{"segredo", "chave.pem", "loja-secreta", `"T1"`, chaveTeste} {
		if strings.Contains(corpo, proibido) {
			t.Fatalf("%q não sai da máquina: %s", proibido, corpo)
		}
	}
	var d corpoEspelho
	if err := json.Unmarshal([]byte(corpo), &d); err != nil || d.V != 1 || len(d.Moradores) != 1 || len(d.Workspaces) != 1 ||
		d.Moradores[0].Atividade == nil || d.Moradores[0].Atividade.Ferramenta != "Bash" || d.Workspaces[0].Bands[0].Nome != "Front" {
		t.Fatalf("corpo: %v %+v", err, d)
	}
}

func TestEspelhoSinalDeVida(t *testing.T) {
	_, rec := espelhoDeTeste(t, 0, Opcoes{VidaEspelho: 80 * time.Millisecond})
	esperar(t, func() bool { return rec.n() >= 3 })
}

func TestEspelhoRecuaNaFalha(t *testing.T) {
	s, rec := espelhoDeTeste(t, http.StatusUnauthorized, Opcoes{EsperaEspelho: 20 * time.Millisecond, VidaEspelho: 50 * time.Millisecond})
	esperar(t, func() bool { return rec.n() >= 1 })
	for i := 0; i < 5; i++ {
		s.aplicar([]mundo.Sinal{sinal("Edit")})
		time.Sleep(60 * time.Millisecond)
	}
	if n := rec.n(); n != 1 {
		t.Fatalf("na falha, espera %v antes de tentar de novo: %d envios", recuoMin, n)
	}
}

func TestEspelhoDesligadoNaoManda(t *testing.T) {
	rec := &recebedor{}
	ts := httptest.NewServer(rec)
	defer ts.Close()
	s := Novo(Opcoes{VidaEspelho: 20 * time.Millisecond, Espelho: func() (ConfigEspelho, bool) { return ConfigEspelho{}, false }})
	ctx, cancelar := context.WithCancel(context.Background())
	go s.espelhar(ctx)
	time.Sleep(150 * time.Millisecond)
	cancelar()
	if rec.n() != 0 {
		t.Fatal("sem espelho.json, nada sai")
	}
}

func TestEnviarEspelhoErroSemAChave(t *testing.T) {
	for _, st := range []int{401, 404, 500} {
		rec := &recebedor{status: st}
		ts := httptest.NewServer(rec)
		err := EnviarEspelho(context.Background(), http.DefaultClient, ConfigEspelho{URL: ts.URL, Chave: chaveTeste}, []byte("{}"))
		ts.Close()
		if err == nil || strings.Contains(err.Error(), chaveTeste) {
			t.Fatalf("%d: %v", st, err)
		}
	}
	err := EnviarEspelho(context.Background(), &http.Client{Timeout: time.Second}, ConfigEspelho{URL: "http://127.0.0.1:1", Chave: chaveTeste}, nil)
	if err == nil || strings.Contains(err.Error(), chaveTeste) {
		t.Fatalf("sem servidor: %v", err)
	}
	rec := &recebedor{}
	ts := httptest.NewServer(rec)
	defer ts.Close()
	if err := TestarEspelho(context.Background(), ConfigEspelho{URL: ts.URL, Chave: chaveTeste}); err != nil || !strings.Contains(rec.corpos[0], `"teste":true`) {
		t.Fatalf("o teste do conectar: %v %v", err, rec.corpos)
	}
}

func TestConfigEspelho(t *testing.T) {
	bons := map[string]string{"https://Firmo.Exemplo.com/": "https://firmo.exemplo.com", "https://x.com/app/": "https://x.com/app",
		"http://localhost:7371": "http://localhost:7371"}
	for in, quer := range bons {
		if got, err := NormalizarEspelho(in); err != nil || got != quer {
			t.Fatalf("%s: %q %v", in, got, err)
		}
	}
	for _, ruim := range []string{"http://firmo.com", "ftp://x", "https://u:s@x.com", "https://x.com/?a=1", "x.com", ""} {
		if _, err := NormalizarEspelho(ruim); err == nil {
			t.Fatalf("%q deveria ser recusado", ruim)
		}
	}
	dir := t.TempDir()
	if _, ok := LerEspelho(dir); ok {
		t.Fatal("sem arquivo: desligado")
	}
	c := ConfigEspelho{URL: "https://firmo.exemplo.com", Chave: chaveTeste}
	if err := GravarEspelho(dir, c); err != nil {
		t.Fatal(err)
	}
	if info, err := os.Stat(filepath.Join(dir, ArquivoEspelho)); err != nil || (info.Mode().Perm()&0o077 != 0 && os.PathSeparator == '/') {
		t.Fatalf("só o usuário lê: %v %v", info.Mode(), err)
	}
	if got, ok := LerEspelho(dir); !ok || got != c {
		t.Fatalf("ler: %+v %v", got, ok)
	}
	os.WriteFile(filepath.Join(dir, ArquivoEspelho), []byte(`{"url":"http://firmo.com","chave":"`+chaveTeste+`"}`), 0o600)
	if _, ok := LerEspelho(dir); ok {
		t.Fatal("arquivo mexido à mão com http fora do PC: desligado")
	}
	if err := GravarEspelho(dir, ConfigEspelho{}); err != nil || fileExiste(filepath.Join(dir, ArquivoEspelho)) {
		t.Fatal("config vazia apaga")
	}
}

func fileExiste(p string) bool { _, err := os.Stat(p); return err == nil }

func TestCodificarEspelhoCortaODia(t *testing.T) {
	dia := make([]historico.EventoHist, 5000)
	for i := range dia {
		dia[i] = historico.EventoHist{TS: time.Unix(int64(i), 0), MoradorID: strings.Repeat("m", 40), Estado: mundo.Ocupado, Ferramenta: "Edit"}
	}
	dados, err := codificarEspelho(corpoEspelho{V: 1, Moradores: []mundo.Morador{}, Workspaces: []maestri.Workspace{}, Dia: dia})
	if err != nil || len(dados) > MaxEspelho {
		t.Fatalf("%d bytes, %v", len(dados), err)
	}
	var d corpoEspelho
	json.Unmarshal(dados, &d)
	if len(d.Dia) == 0 || !d.Dia[len(d.Dia)-1].TS.Equal(time.Unix(4999, 0)) {
		t.Fatal("ficam os mais novos")
	}
}

// Um redirecionamento nunca leva a chave adiante: o destino não recebe Authorization nem corpo, e o 3xx vira erro.
func TestEspelhoNaoSegueRedirecionamento(t *testing.T) {
	var vazou sync.Mutex
	recebeu := ""
	destino := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		vazou.Lock()
		recebeu = r.Header.Get("Authorization")
		vazou.Unlock()
	}))
	defer destino.Close()
	origem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, destino.URL+r.URL.Path, http.StatusPermanentRedirect)
	}))
	defer origem.Close()
	err := EnviarEspelho(context.Background(), clienteEspelho(), ConfigEspelho{URL: origem.URL, Chave: chaveTeste}, []byte("{}"))
	vazou.Lock()
	defer vazou.Unlock()
	if err == nil || recebeu != "" {
		t.Fatalf("seguiu o redirecionamento: err=%v auth=%q", err, recebeu)
	}
}
