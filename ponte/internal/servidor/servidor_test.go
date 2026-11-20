package servidor

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"

	"firmopolis/ponte/internal/calendario"
	"firmopolis/ponte/internal/clima"
	"firmopolis/ponte/internal/historico"
	"firmopolis/ponte/internal/mundo"
	"firmopolis/ponte/internal/processo"
)

const tokenTeste = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// clienteHTTP tem prazo: um handler que trava (fila bloqueante, por exemplo) falha o
// teste em vez de pendurá-lo.
var clienteHTTP = &http.Client{Timeout: 5 * time.Second}

type ambiente struct {
	s    *Servidor
	url  string // http://127.0.0.1:<porta>
	host string // 127.0.0.1:<porta>
}

// subir liga o servidor numa porta livre de 127.0.0.1; consumir=false deixa a fila parada.
func subir(t *testing.T, op Opcoes, consumir bool) *ambiente {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	op.Porta = ln.Addr().(*net.TCPAddr).Port
	op.Token = tokenTeste
	if op.Passo == 0 {
		op.Passo = time.Hour // nos testes, o passo só roda na largada
	}
	s := Novo(op)
	ts := httptest.NewUnstartedServer(s.Handler())
	ts.Listener.Close()
	ts.Listener = ln
	ts.Start()
	ctx, cancelar := context.WithCancel(context.Background())
	t.Cleanup(func() {
		cancelar()
		s.fecharClientes()
		ts.Close()
	})
	if consumir {
		go s.Consumir(ctx)
	}
	return &ambiente{s: s, url: ts.URL, host: ln.Addr().String()}
}

func (a *ambiente) post(t *testing.T, rota string, corpo []byte, headers map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, a.url+"/evento/"+rota, bytes.NewReader(corpo))
	req.Header.Set("X-Ponte-Token", tokenTeste)
	for k, v := range headers {
		if v == "" {
			req.Header.Del(k)
		} else {
			req.Header.Set(k, v)
		}
	}
	if h, ok := headers["Host"]; ok {
		req.Host = h
	}
	resp, err := clienteHTTP.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { resp.Body.Close() })
	return resp
}

func (a *ambiente) conectar(t *testing.T, header http.Header) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	url := "ws" + strings.TrimPrefix(a.url, "http") + "/ws"
	c, resp, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPHeader: header})
	if c != nil {
		c.SetReadLimit(16 << 20)
		t.Cleanup(func() { c.CloseNow() })
	}
	return c, resp, err
}

func comToken() http.Header {
	return http.Header{"Authorization": {"Bearer " + tokenTeste}}
}

func ler(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	_, dados, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(dados, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

var promptClaude = []byte(`{"session_id":"s1","cwd":"C:\\proj\\loja","hook_event_name":"UserPromptSubmit","prompt":"x"}`)

func TestSemToken403(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	for _, token := range []string{"", "errado", tokenTeste[:63]} {
		hdr := map[string]string{"X-Ponte-Token": token}
		if resp := a.post(t, "claude", promptClaude, hdr); resp.StatusCode != http.StatusForbidden {
			t.Errorf("token %q: veio %d, esperava 403", token, resp.StatusCode)
		}
	}
	for _, header := range []http.Header{nil, {"Authorization": {"Bearer errado"}}, {"Authorization": {tokenTeste}}} {
		if _, resp, err := a.conectar(t, header); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Errorf("ws com %v: esperava 403", header)
		}
	}
}

func TestTokenNaQueryNaoVale(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	url := "ws" + strings.TrimPrefix(a.url, "http") + "/ws?token=" + tokenTeste
	if _, resp, err := websocket.Dial(ctx, url, nil); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
		t.Fatal("o ?token= não pode autenticar o WS")
	}
}

func TestOrigin403(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	for _, origin := range []string{"http://evil.com", "http://127.0.0.1:" + strconv.Itoa(a.s.op.Porta), "null"} {
		if resp := a.post(t, "claude", promptClaude, map[string]string{"Origin": origin}); resp.StatusCode != http.StatusForbidden {
			t.Errorf("POST com Origin %q: veio %d", origin, resp.StatusCode)
		}
		hdr := comToken()
		hdr.Set("Origin", origin)
		if _, resp, err := a.conectar(t, hdr); err == nil || resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Errorf("ws com Origin %q: esperava 403", origin)
		}
	}
}

func TestHostFalso403(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	porta := strconv.Itoa(a.s.op.Porta)
	for _, host := range []string{"evil.com:" + porta, "127.0.0.1", "127.0.0.1:1", "localhost", "127.0.0.2:" + porta, "[::1]:" + porta} {
		if resp := a.post(t, "claude", promptClaude, map[string]string{"Host": host}); resp.StatusCode != http.StatusForbidden {
			t.Errorf("Host %q: veio %d, esperava 403", host, resp.StatusCode)
		}
	}
	for _, host := range []string{"127.0.0.1:" + porta, "localhost:" + porta} {
		if resp := a.post(t, "claude", promptClaude, map[string]string{"Host": host}); resp.StatusCode != http.StatusNoContent {
			t.Errorf("Host %q: veio %d, esperava 204", host, resp.StatusCode)
		}
	}
}

func TestCorpoGrande413(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	grande := append([]byte(`{"session_id":"s1","x":"`), bytes.Repeat([]byte("a"), MaxCorpo)...)
	if resp := a.post(t, "claude", append(grande, `"}`...), nil); resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("veio %d, esperava 413", resp.StatusCode)
	}
}

func TestRotasEMetodos(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	if resp := a.post(t, "outro", promptClaude, nil); resp.StatusCode != http.StatusNotFound {
		t.Errorf("rota desconhecida: %d", resp.StatusCode)
	}
	req, _ := http.NewRequest(http.MethodGet, a.url+"/evento/claude", nil)
	req.Header.Set("X-Ponte-Token", tokenTeste)
	resp, err := clienteHTTP.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Errorf("GET em /evento: %d", resp.StatusCode)
	}
	// Corpo que não se lê não incomoda o agente.
	if resp := a.post(t, "claude", []byte(`{"session_id":`), nil); resp.StatusCode != http.StatusNoContent {
		t.Errorf("corpo inválido: %d", resp.StatusCode)
	}
}

func TestEventoResponde204Rapido(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	a.s.aoConsumir = func() { time.Sleep(500 * time.Millisecond) } // processamento lento
	go a.s.Consumir(t.Context())

	// O caminho com X-Ponte-PID-Hook resolve o agente (uma vez por sessão).
	hdr := map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(os.Getpid()), "X-Maestri-Terminal-Id": "T1"}
	evento := func(sessao string) time.Duration {
		corpo := []byte(`{"conversationId":"` + sessao + `","hookEventName":"PreInvocation"}`)
		ini := time.Now()
		resp := a.post(t, "agy", corpo, hdr)
		dur := time.Since(ini)
		resto, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusNoContent || len(resto) != 0 {
			t.Fatalf("esperava 204 sem corpo, veio %d com %q", resp.StatusCode, resto)
		}
		return dur
	}
	// Aquecimento fora da medida: a conexão e a primeira consulta aos processos do
	// sistema, que só custam uma vez na vida da ponte. As sessões medidas ainda
	// resolvem o agente cada uma na sua primeira vez.
	evento("aquece")

	// A mediana pega a lentidão de sempre; o máximo, um evento que esperasse o
	// consumidor (500 ms). Um evento só, num pico de CPU da suíte inteira, não reprova.
	var duracoes []time.Duration
	for i := 0; i < 11; i++ {
		duracoes = append(duracoes, evento("c"+strconv.Itoa(i%2)))
	}
	slices.Sort(duracoes)
	if mediana := duracoes[len(duracoes)/2]; mediana > 50*time.Millisecond {
		t.Errorf("mediana de %v (limite 50 ms): %v", mediana, duracoes)
	}
	if maximo := duracoes[len(duracoes)-1]; maximo > 250*time.Millisecond {
		t.Errorf("um evento levou %v, perto de esperar o consumidor: %v", maximo, duracoes)
	}
	a.s.muPID.Lock()
	pids := []int{a.s.agentes["antigravity_cli:c0"].pid, a.s.agentes["antigravity_cli:c1"].pid}
	a.s.muPID.Unlock()
	if pids[0] != os.Getpid() || pids[1] != os.Getpid() {
		t.Fatalf("o PID do agente deveria ter sido resolvido e guardado nas duas sessões: %v", pids)
	}
}

func TestFilaCheiaDescartaSemTravar(t *testing.T) {
	a := subir(t, Opcoes{}, false) // ninguém consome
	for i := 0; i < TamanhoFila+10; i++ {
		if resp := a.post(t, "claude", promptClaude, nil); resp.StatusCode != http.StatusNoContent {
			t.Fatalf("evento %d: %d", i, resp.StatusCode)
		}
	}
	if d := a.s.Descartados(); d != 10 {
		t.Fatalf("esperava 10 descartados, veio %d", d)
	}
}

func TestSnapshotDepoisDia(t *testing.T) {
	hist, err := historico.Abrir(t.TempDir(), 30)
	if err != nil {
		t.Fatal(err)
	}
	defer hist.Fechar()
	a := subir(t, Opcoes{Historico: hist}, true)

	// Um morador antes de o jogo conectar: vai no snapshot e no dia.
	a.post(t, "claude", promptClaude, map[string]string{"X-Maestri-Terminal-Id": "T1"})
	esperar(t, func() bool { return len(a.s.reg.Snapshot()) == 1 })

	c, _, err := a.conectar(t, comToken())
	if err != nil {
		t.Fatal(err)
	}
	snap := ler(t, c)
	if snap["tipo"] != "snapshot" || snap["v"] != float64(1) || len(snap["moradores"].([]any)) != 1 {
		t.Fatalf("1ª mensagem deveria ser o snapshot: %v", snap)
	}
	if _, ok := snap["workspaces"].([]any); !ok {
		t.Fatalf("workspaces vai como lista: %v", snap)
	}
	dia := ler(t, c)
	if dia["tipo"] != "dia" || len(dia["eventos"].([]any)) != 1 {
		t.Fatalf("2ª mensagem deveria ser o dia: %v", dia)
	}

	// Mudança depois da conexão chega como "morador".
	a.post(t, "claude", []byte(`{"session_id":"s1","hook_event_name":"Stop","background_tasks":[]}`), map[string]string{"X-Maestri-Terminal-Id": "T1"})
	m := ler(t, c)
	if m["tipo"] != "morador" || m["morador"].(map[string]any)["estado"] != "ocioso" {
		t.Fatalf("esperava a mudança do morador: %v", m)
	}
	// O histórico grava só as transições.
	if n := len(hist.Hoje()); n != 2 {
		t.Fatalf("esperava 2 transições no histórico, veio %d", n)
	}
	a.post(t, "claude", []byte(`{"session_id":"s1","hook_event_name":"SessionEnd","reason":"other"}`), map[string]string{"X-Maestri-Terminal-Id": "T1"})
	if m := ler(t, c); m["tipo"] != "saiu" || m["id"] != "t1" {
		t.Fatalf("esperava saiu: %v", m)
	}
}

func TestLeituraDoJogoIgnoradaComLimite(t *testing.T) {
	a := subir(t, Opcoes{}, true)
	c, _, err := a.conectar(t, comToken())
	if err != nil {
		t.Fatal(err)
	}
	ler(t, c) // snapshot
	ler(t, c) // dia
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	if err := c.Write(ctx, websocket.MessageText, []byte(`{"tipo":"comando"}`)); err != nil {
		t.Fatal(err)
	}
	a.post(t, "claude", promptClaude, nil)
	if m := ler(t, c); m["tipo"] != "morador" {
		t.Fatalf("o que o jogo manda é ignorado e a conexão segue: %v", m)
	}
	// Acima de 64 KiB, a ponte encerra.
	c.Write(ctx, websocket.MessageText, bytes.Repeat([]byte("a"), limiteLeitura+1))
	if _, _, err := c.Read(ctx); err == nil {
		t.Fatal("quadro acima do limite deveria encerrar a conexão")
	}
}

func TestClienteLentoDesconectado(t *testing.T) {
	s := Novo(Opcoes{Token: tokenTeste})
	fechado := false
	lento := &cliente{fila: make(chan []byte, filaCliente), fechar: func() { fechado = true }}
	s.clientes[lento] = true
	s.mu.Lock()
	for i := 0; i <= filaCliente; i++ {
		s.transmitir(msgSaiu{V: 1, Tipo: "saiu", ID: "x"})
	}
	s.mu.Unlock()
	if !fechado || len(s.clientes) != 0 {
		t.Fatal("cliente com a fila cheia deveria ser desconectado")
	}
}

// TestRodarLigaOClima: o Rodar do servidor põe a fonte do clima para rodar; o 1º estado
// dela (datas nunca nil) chega ao ambiente que vai ao jogo.
func TestRodarLigaOClima(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	livre := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	s := Novo(Opcoes{Porta: livre, Token: tokenTeste})
	ctx, cancelar := context.WithCancel(context.Background())
	fim := make(chan error, 1)
	go func() { fim <- s.Rodar(ctx) }()
	esperar(t, func() bool {
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.ambiente.DatasHoje != nil
	})
	cancelar()
	if err := <-fim; err != nil {
		t.Fatal(err)
	}
}

func TestPortaOcupada(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	s := Novo(Opcoes{Porta: ln.Addr().(*net.TCPAddr).Port, Token: tokenTeste})
	err = s.Rodar(t.Context())
	if err == nil || !strings.Contains(err.Error(), "ocupada") {
		t.Fatalf("esperava erro claro de porta ocupada, veio %v", err)
	}
}

func TestDemoComDezMoradoresSemGravar(t *testing.T) {
	dir := t.TempDir()
	hist, err := historico.Abrir(dir, 30)
	if err != nil {
		t.Fatal(err)
	}
	defer hist.Fechar()
	a := subir(t, Opcoes{Demo: true, Historico: hist, Passo: 10 * time.Millisecond}, true)
	esperar(t, func() bool { return len(a.s.reg.Snapshot()) == 10 })
	time.Sleep(100 * time.Millisecond) // alguns passos

	snap := a.s.reg.Snapshot()
	for _, m := range snap {
		if m.Nome == "" || m.Solto || m.WorkspaceID != "demo" {
			t.Fatalf("morador do demo incompleto: %+v", m)
		}
	}
	if eventos := hist.Hoje(); len(eventos) != 0 {
		t.Fatalf("o demo nunca grava: %d eventos", len(eventos))
	}
	entradas, _ := os.ReadDir(dir)
	for _, e := range entradas {
		if info, _ := e.Info(); info.Size() > 0 {
			t.Fatalf("o demo gravou em %s", filepath.Join(dir, e.Name()))
		}
	}
}

func TestToken(t *testing.T) {
	dir := filepath.Join(pastaTemp(t), "EscritorioVivo")
	t1, err := CarregarOuCriarToken(dir)
	if err != nil || !tokenValido(t1) {
		t.Fatalf("token novo inválido: %q %v", t1, err)
	}
	t2, err := CarregarOuCriarToken(dir)
	if err != nil || t1 != t2 {
		t.Fatal("o token existente deveria ser reaproveitado")
	}
	os.WriteFile(filepath.Join(dir, "token"), []byte("curto"), 0o600)
	t3, err := CarregarOuCriarToken(dir)
	if err != nil || t3 == t1 || !tokenValido(t3) {
		t.Fatalf("token inválido no arquivo deveria ser trocado: %q %v", t3, err)
	}
	sobras, _ := filepath.Glob(filepath.Join(dir, "*.tmp"))
	if len(sobras) != 0 {
		t.Fatalf("temporário esquecido: %v", sobras)
	}
}

// pastaTemp é um TempDir com limpeza tolerante: no Windows, o antivírus segura por um
// instante o arquivo recém-renomeado, e o RemoveAll do TempDir falharia o teste.
func pastaTemp(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "ev-token-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		for i := 0; i < 20 && os.RemoveAll(dir) != nil; i++ {
			time.Sleep(50 * time.Millisecond)
		}
	})
	return dir
}

func esperar(t *testing.T, ok func() bool) {
	t.Helper()
	limite := time.Now().Add(3 * time.Second)
	for !ok() {
		if time.Now().After(limite) {
			t.Fatal("a condição não se cumpriu a tempo")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

var _ = mundo.Ocupado

func TestAgenteResolvidoRegistradoUmaVez(t *testing.T) {
	saida := &logSeguro{}
	log.SetOutput(saida)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	a := subir(t, Opcoes{}, true)
	hdr := map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(os.Getpid())}
	for i := 0; i < 3; i++ { // três sessões: o PID é resolvido três vezes, o log sai uma
		corpo := []byte(`{"conversationId":"c` + strconv.Itoa(i) + `","hookEventName":"PreInvocation"}`)
		a.post(t, "agy", corpo, hdr)
	}
	pronto := make(chan struct{}) // o consumidor já passou por tudo o que veio antes
	a.s.enfileirar(func() { close(pronto) })
	<-pronto

	texto := saida.String()
	nome := strings.ToLower(filepath.Base(os.Args[0]))
	if n := strings.Count(texto, "agente resolvido"); n != 1 || !strings.Contains(strings.ToLower(texto), nome) {
		t.Fatalf("esperava 1 linha com o nome do agente (%s), veio %d:\n%s", nome, n, texto)
	}
}

// processar espera o consumidor passar por tudo o que veio antes (o passo da largada
// inclusive).
func (a *ambiente) processar() {
	pronto := make(chan struct{})
	a.s.enfileirar(func() { close(pronto) })
	<-pronto
}

// O agente guardado cujo processo já não é o mesmo (a vida diz não para a hora
// guardada) é resolvido de novo no hook seguinte, com a hora do processo de agora.
func TestAgenteComOutroNascimentoResolveDeNovo(t *testing.T) {
	// Sem consumidor: o passo da largada esqueceria o agente morto antes do hook.
	a := subir(t, Opcoes{Vivo: func(_ int, nascimento uint64) bool { return nascimento != 1 }}, false)
	a.s.muPID.Lock()
	a.s.agentes["antigravity_cli:c0"] = agente{pid: os.Getpid(), nascimento: 1} // o PID de um agente que morreu
	a.s.muPID.Unlock()

	a.post(t, "agy", []byte(`{"conversationId":"c0","hookEventName":"PreInvocation"}`), map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(os.Getpid())})
	a.s.muPID.Lock()
	got := a.s.agentes["antigravity_cli:c0"]
	a.s.muPID.Unlock()
	if quer := (agente{pid: os.Getpid(), nascimento: processo.Inicio(os.Getpid())}); got != quer {
		t.Fatalf("o agente deveria ter sido resolvido de novo: %+v, quero %+v", got, quer)
	}
}

// A varredura pergunta à vida pelo PID e pela hora em que o agente do hook nasceu: o
// mesmo PID com outra hora é outro processo, e o morador sai.
func TestVarreduraUsaONascimentoDoAgente(t *testing.T) {
	var morto atomic.Uint64
	morto.Store(^uint64(0))
	a := subir(t, Opcoes{Vivo: func(_ int, nascimento uint64) bool { return nascimento != morto.Load() }}, true)
	a.post(t, "agy", []byte(`{"conversationId":"c0","hookEventName":"PreInvocation"}`), map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(os.Getpid()), "X-Maestri-Terminal-Id": "T1"})
	a.processar()
	if snap := a.s.reg.Snapshot(); len(snap) != 1 {
		t.Fatalf("esperava o morador do agy: %+v", snap)
	}

	morto.Store(processo.Inicio(os.Getpid())) // o processo que nasceu nessa hora morreu
	a.s.enfileirar(a.s.passo)
	a.processar()
	if snap := a.s.reg.Snapshot(); len(snap) != 0 {
		t.Fatalf("o morador do agente morto deveria ter saído: %+v", snap)
	}
}

// A reconciliação do Claude usa a mesma vida, com o procStart do arquivo.
func TestReconciliacaoUsaAVida(t *testing.T) {
	dir := t.TempDir()
	for nome, corpo := range map[string]string{
		"1.json": `{"pid":` + strconv.Itoa(os.Getpid()) + `,"sessionId":"s-morta","status":"busy","entrypoint":"cli","procStart":"123"}`,
		"2.json": `{"pid":` + strconv.Itoa(os.Getpid()) + `,"sessionId":"s-viva","status":"busy","entrypoint":"cli","procStart":"456"}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, nome), []byte(corpo), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	a := subir(t, Opcoes{DirClaude: dir, Vivo: func(_ int, nascimento uint64) bool { return nascimento != 123 }}, true)
	a.processar()
	if snap := a.s.reg.Snapshot(); len(snap) != 1 || snap[0].ID != "claude_code:s-viva" {
		t.Fatalf("só a sessão com o processo vivo fica: %+v", snap)
	}
}

// logSeguro é um destino de log que o teste pode ler enquanto o consumidor escreve.
type logSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *logSeguro) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *logSeguro) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

func TestConsumidorParaDepoisDeCancelado(t *testing.T) {
	a := subir(t, Opcoes{}, false)
	ctx, cancelar := context.WithCancel(context.Background())
	rodou := false
	a.s.enfileirar(cancelar) // a ponte desliga com a fila ainda cheia
	a.s.enfileirar(func() { rodou = true })
	a.s.Consumir(ctx)
	if rodou {
		t.Fatal("depois de cancelado, o consumidor não pode rodar o que sobrou na fila")
	}
}

func TestPassoNaoRodaDepoisDeCancelado(t *testing.T) {
	a := subir(t, Opcoes{Passo: time.Millisecond}, false)
	ctx, cancelar := context.WithCancel(context.Background())
	cancelado := false
	depois := 0
	a.s.aoPassar = func() {
		if cancelado {
			depois++
		}
	}
	a.s.enfileirar(func() {
		cancelar()
		cancelado = true
		time.Sleep(20 * time.Millisecond) // o ticker dispara enquanto isso
	})
	a.s.Consumir(ctx)
	if depois > 0 {
		t.Fatalf("depois de cancelado, o passo rodou %d vez(es)", depois)
	}
}

// O ts do histórico é o instante da mudança, o mesmo "desde" que o morador ao vivo leva:
// o jogo junta os dois pela chave ts+estado+ferramenta+alvo. Com o time.Now() de quando a
// ponte grava, a reconciliação de um reinício (desde = statusUpdatedAt, segundos ou horas
// antes) virava o mesmo "Ocupado" duas vezes na linha do tempo.
func TestHistoricoComODesdeDoMorador(t *testing.T) {
	dirHist, dirClaude := t.TempDir(), t.TempDir()
	atualizado := time.Now().Add(-30 * time.Second).Truncate(time.Millisecond)
	if atualizado.Day() != time.Now().Day() {
		atualizado = time.Now().Truncate(time.Millisecond) // perto da meia-noite, o evento iria para o arquivo de ontem
	}
	sessao := `{"pid":` + strconv.Itoa(os.Getpid()) + `,"sessionId":"s1","cwd":"/proj/loja","status":"busy","entrypoint":"cli","statusUpdatedAt":` + strconv.FormatInt(atualizado.UnixMilli(), 10) + `}`
	if err := os.WriteFile(filepath.Join(dirClaude, "1.json"), []byte(sessao), 0o600); err != nil {
		t.Fatal(err)
	}

	// conferir: o último evento do histórico tem o ts que o jogo tira do morador ao vivo.
	conferir := func(hist *historico.Historico, a *ambiente, n int) {
		t.Helper()
		esperar(t, func() bool { return len(hist.Hoje()) == n })
		eventos, snap := hist.Hoje(), a.s.reg.Snapshot()
		if len(snap) != 1 {
			t.Fatalf("esperava 1 morador: %v", snap)
		}
		m, e := snap[0], eventos[n-1]
		quer := m.Desde
		if m.Estado == mundo.Ocupado && m.Atividade != nil {
			quer = m.Atividade.Desde
		}
		if !e.TS.Equal(quer) {
			t.Fatalf("ts do histórico %v, o morador diz %v (%+v)", e.TS, quer, m)
		}
	}

	abrir := func() *historico.Historico {
		hist, err := historico.Abrir(dirHist, 30)
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { hist.Fechar() })
		return hist
	}

	hist := abrir()
	a := subir(t, Opcoes{Historico: hist, DirClaude: dirClaude}, true)
	conferir(hist, a, 1) // reconciliação: desde = statusUpdatedAt
	if e := hist.Hoje()[0]; !e.TS.Equal(atualizado) {
		t.Fatalf("a reconciliação deveria gravar o statusUpdatedAt %v, gravou %v", atualizado, e.TS)
	}
	a.post(t, "claude", []byte(`{"session_id":"s1","cwd":"/proj/loja","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"go test ./..."}}`), nil)
	conferir(hist, a, 2) // troca de ferramenta: atividade.desde
	hist.Fechar()

	// A ponte reinicia: o histórico reabre e a reconciliação recria o morador.
	hist = abrir()
	conferir(hist, subir(t, Opcoes{Historico: hist, DirClaude: dirClaude}, true), 3)
}

// TestHoraDoHookPoeEmOrdem: o hook do Claude roda em segundo plano, então um evento
// pode chegar depois do seguinte. Com o X-Ponte-Hora, o atrasado não desfaz o novo.
func TestHoraDoHookPoeEmOrdem(t *testing.T) {
	a := subir(t, Opcoes{}, true)
	agora := time.Now()
	hora := func(d time.Duration) map[string]string {
		return map[string]string{"X-Maestri-Terminal-Id": "T1", "X-Ponte-Hora": strconv.FormatInt(agora.Add(d).UnixMilli(), 10)}
	}
	a.post(t, "claude", promptClaude, hora(-300*time.Millisecond))
	a.post(t, "claude", []byte(`{"session_id":"s1","hook_event_name":"Stop","background_tasks":[]}`), hora(-100*time.Millisecond))
	a.post(t, "claude", []byte(`{"session_id":"s1","hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"ls"}}`), hora(-200*time.Millisecond))
	// Uma sessão nova depois: quando ela aparece, a fila já passou pelo atrasado.
	a.post(t, "claude", []byte(`{"session_id":"s2","cwd":"C:\\proj\\outro","hook_event_name":"UserPromptSubmit","prompt":"x"}`), map[string]string{"X-Maestri-Terminal-Id": "T2"})
	esperar(t, func() bool { return len(a.s.reg.Snapshot()) == 2 })
	for _, m := range a.s.reg.Snapshot() {
		if m.ID == "t1" && m.Estado != mundo.Ocioso {
			t.Fatalf("o PreToolUse atrasado desfez o Stop: %+v", m)
		}
	}
}

func TestHoraDoHookForaDoPrazoValeZero(t *testing.T) {
	agora := time.Now()
	ms := func(d time.Duration) string { return strconv.FormatInt(agora.Add(d).UnixMilli(), 10) }
	for valor, zero := range map[string]bool{
		ms(-time.Second): false, "": true, "abc": true, ms(time.Second): true, ms(-2 * time.Minute): true,
	} {
		got := horaDoHook(valor, agora)
		if got.IsZero() != zero {
			t.Errorf("horaDoHook(%q) = %v, quero zero=%v", valor, got, zero)
		}
		if !zero && !strings.Contains(got.String(), " m=") {
			t.Errorf("horaDoHook(%q) perdeu a leitura monotônica: %v", valor, got)
		}
	}
}

func TestProjetoNoSnapshot(t *testing.T) {
	// Workspace numa pasta de repo git e uma sessão solta no papel do Maestri dentro
	// dela: o workspace e o morador chegam ao jogo com o nome da raiz do repo.
	raiz := t.TempDir()
	repo := filepath.Join(raiz, "pasta-privada", "Loja")
	papel := filepath.Join(repo, ".maestri", "roles", "papel")
	dirMaestri := filepath.Join(raiz, "maestri")
	dirClaude := filepath.Join(raiz, "sessions")
	for _, d := range []string{filepath.Join(repo, ".git"), papel, filepath.Join(dirMaestri, "workspaces", "ws"), dirClaude} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	emJSON := func(v string) string { b, _ := json.Marshal(v); return string(b) }
	arquivos := map[string]string{
		filepath.Join(dirMaestri, "workspaces", "ws", "workspace.json"): `{"payload":{"id":"WS","name":"Canvas","workingDirectory":` + emJSON(repo) + `,"nodes":[]}}`,
		filepath.Join(dirClaude, "1.json"):                              `{"pid":` + strconv.Itoa(os.Getpid()) + `,"sessionId":"s1","cwd":` + emJSON(papel) + `,"status":"idle","entrypoint":"cli"}`,
	}
	for arq, corpo := range arquivos {
		if err := os.WriteFile(arq, []byte(corpo), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	a := subir(t, Opcoes{DirClaude: dirClaude, DirMaestri: dirMaestri, Vivo: func(int, uint64) bool { return true }}, true)
	a.processar()

	c, _, err := a.conectar(t, comToken())
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancelar := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelar()
	_, bruto, err := c.Read(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// Privacidade: a pasta do workspace e o cwd do morador não saem da máquina, com
	// nenhum nome de campo.
	if strings.Contains(string(bruto), "pasta-privada") {
		t.Fatalf("a pasta do repo vazou no snapshot: %s", bruto)
	}
	var snap map[string]any
	if err := json.Unmarshal(bruto, &snap); err != nil {
		t.Fatal(err)
	}
	ws := snap["workspaces"].([]any)
	if len(ws) != 1 || ws[0].(map[string]any)["projeto"] != "Loja" {
		t.Fatalf("workspace sem o projeto: %v", ws)
	}
	ms := snap["moradores"].([]any)
	if len(ms) != 1 || ms[0].(map[string]any)["projeto"] != "Loja" {
		t.Fatalf("morador sem o projeto: %v", ms)
	}
}

// TestProjetoDoSoltoNoPapelDaHome: o workspace na home (pasta genérica) e uma sessão
// solta no papel do Maestri dela. O cwd não dá projeto, e o solto fica com o do
// workspace, que o vincular passa ao registro (DefinirPastas). Nada da home é lido.
func TestProjetoDoSoltoNoPapelDaHome(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("sem home:", err)
	}
	raiz := t.TempDir()
	dirMaestri := filepath.Join(raiz, "maestri")
	dirClaude := filepath.Join(raiz, "sessions")
	for _, d := range []string{filepath.Join(dirMaestri, "workspaces", "ws"), dirClaude} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	emJSON := func(v string) string { b, _ := json.Marshal(v); return string(b) }
	papel := filepath.Join(home, ".maestri", "roles", "papel-do-teste-da-ponte")
	arquivos := map[string]string{
		filepath.Join(dirMaestri, "workspaces", "ws", "workspace.json"): `{"payload":{"id":"WS","name":"Canvas da Home","workingDirectory":` + emJSON(home) + `,"nodes":[]}}`,
		filepath.Join(dirClaude, "1.json"):                              `{"pid":` + strconv.Itoa(os.Getpid()) + `,"sessionId":"s1","cwd":` + emJSON(papel) + `,"status":"idle","entrypoint":"cli"}`,
	}
	for arq, corpo := range arquivos {
		if err := os.WriteFile(arq, []byte(corpo), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	a := subir(t, Opcoes{DirClaude: dirClaude, DirMaestri: dirMaestri, Vivo: func(int, uint64) bool { return true }}, true)
	a.processar()

	snap := a.s.reg.Snapshot()
	if len(snap) != 1 || !snap[0].Solto || snap[0].Projeto != "Canvas da Home" {
		t.Fatalf("o solto no papel da home deveria levar o projeto do workspace: %+v", snap)
	}
}

func TestClimaNoSnapshotENaMensagem(t *testing.T) {
	a := subir(t, Opcoes{}, true)
	c, _, err := a.conectar(t, comToken())
	if err != nil {
		t.Fatal(err)
	}
	snap := ler(t, c)
	if v, ok := snap["clima"]; !ok || v != nil {
		t.Fatalf("sem cidade, o snapshot leva clima null: %v", snap)
	}
	if d, ok := snap["datas_hoje"].([]any); !ok || len(d) != 0 {
		t.Fatalf("antes da 1ª leitura, datas_hoje é lista vazia: %v", snap["datas_hoje"])
	}
	ler(t, c) // dia

	medido := time.Date(2026, 12, 25, 14, 15, 0, 0, time.FixedZone("", -3*3600))
	a.s.definirAmbiente(clima.Estado{
		Clima:     &clima.Clima{Cidade: "São Paulo", Ceu: "tempestade", Vento: "ventania", Codigo: 95, RajadaKmh: 80, MedidoEm: medido},
		DatasHoje: calendario.DatasDe(medido, "BR"),
	})
	m := ler(t, c)
	cl, _ := m["clima"].(map[string]any)
	datas, _ := m["datas_hoje"].([]any)
	if m["tipo"] != "clima" || m["v"] != float64(1) || cl["ceu"] != "tempestade" || cl["vento"] != "ventania" ||
		cl["medido_em"] != "2026-12-25T14:15:00-03:00" || len(datas) != 1 || datas[0].(map[string]any)["id"] != "natal" {
		t.Fatalf("mensagem de clima: %v", m)
	}

	c2, _, err := a.conectar(t, comToken())
	if err != nil {
		t.Fatal(err)
	}
	if snap := ler(t, c2); snap["clima"].(map[string]any)["ceu"] != "tempestade" || len(snap["datas_hoje"].([]any)) != 1 {
		t.Fatalf("o snapshot leva o último clima: %v", snap)
	}
}

// O hook do mcode não recebe o MAESTRI_TERMINAL_ID: o terminal sai do ambiente do
// agente resolvido, uma vez por sessão, e só nas rotas de terminalDoAgente.
func TestTerminalDoAmbienteDoAgente(t *testing.T) {
	var mu sync.Mutex
	consultas := map[int]int{}
	a := subir(t, Opcoes{Terminal: func(pid int) string {
		mu.Lock()
		defer mu.Unlock()
		consultas[pid]++
		return "Term-MM"
	}}, true)
	hdr := map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(os.Getpid())}
	evento := func(nome, extra string) {
		a.post(t, "mcode", []byte(`{"hook_event_name":"`+nome+`","session_id":"mvs_1"`+extra+`}`), hdr)
	}
	evento("SessionStart", "")
	evento("UserPromptSubmit", `,"prompt":"oi"`)
	a.processar()
	snap := a.s.reg.Snapshot()
	if len(snap) != 1 || snap[0].ID != "term-mm" || snap[0].Provedor != mundo.ProvedorMiniMax || snap[0].Solto || snap[0].Estado != mundo.Ocupado {
		t.Fatalf("o mcode deveria morar no terminal do ambiente: %+v", snap)
	}
	// O /clear no terminal não encerra o morador (a regra muda com o terminal).
	evento("SessionEnd", `,"reason":"clear"`)
	a.processar()
	if snap := a.s.reg.Snapshot(); len(snap) != 1 {
		t.Fatalf("o /clear no terminal não tira o morador: %+v", snap)
	}
	// As outras rotas recebem o terminal no header e não leem o ambiente.
	a.post(t, "agy", []byte(`{"conversationId":"c1","hookEventName":"PreInvocation"}`), hdr)
	a.processar()
	mu.Lock()
	defer mu.Unlock()
	if len(consultas) != 1 || consultas[os.Getpid()] != 1 {
		t.Fatalf("o ambiente deveria ser lido uma vez, só para a sessão do mcode: %v", consultas)
	}
}

// Sem terminal no ambiente (o mcode fora do Maestri), o mcode é solto.
func TestMiniMaxSemTerminalESolto(t *testing.T) {
	a := subir(t, Opcoes{Terminal: func(int) string { return "" }}, true)
	hdr := map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(os.Getpid())}
	a.post(t, "mcode", []byte(`{"hook_event_name":"SessionStart","session_id":"mvs_2"}`), hdr)
	a.processar()
	snap := a.s.reg.Snapshot()
	if len(snap) != 1 || !snap[0].Solto || snap[0].Provedor != mundo.ProvedorMiniMax {
		t.Fatalf("o mcode sem terminal deveria ser solto: %+v", snap)
	}
}

// Com o terminal no header, ele vale: o ambiente só cobre o hook que não o recebe.
func TestMiniMaxHeaderVenceOAmbiente(t *testing.T) {
	a := subir(t, Opcoes{Terminal: func(int) string { return "Term-Ambiente" }}, true)
	hdr := map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(os.Getpid()), "X-Maestri-Terminal-Id": "Term-Header"}
	a.post(t, "mcode", []byte(`{"hook_event_name":"UserPromptSubmit","session_id":"mvs_3","prompt":"oi"}`), hdr)
	a.processar()
	if snap := a.s.reg.Snapshot(); len(snap) != 1 || snap[0].ID != "term-header" {
		t.Fatalf("o terminal do header deveria valer: %+v", snap)
	}
}

// bashDeVerdade é o bash que o mcode usa: o Git Bash no Windows.
func bashDeVerdade(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		bash := filepath.Join(os.Getenv("ProgramFiles"), "Git", "bin", "bash.exe")
		if _, err := os.Stat(bash); err != nil {
			t.Skip("sem o Git Bash")
		}
		return bash
	}
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("sem bash")
	}
	return bash
}

// A cadeia do mcode: o hook roda num bash -c, e, no Windows, o bash.exe do Git é um
// lançador que abre o bash de verdade. O agente resolvido (aqui, o teste) passa pelos
// dois bash; é dele que sai o terminal.
func TestMiniMaxCadeiaComBash(t *testing.T) {
	script := "echo $$; sleep 5; :" // o ":" no fim impede o bash de trocar a si mesmo pelo sleep (exec do último comando)
	if runtime.GOOS == "windows" {
		script = "cat /proc/$$/winpid; sleep 5"
	}
	bash := exec.Command(bashDeVerdade(t), "-c", script)
	saida, err := bash.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err := bash.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		bash.Process.Kill()
		bash.Wait()
	}()
	linha, err := bufio.NewReader(saida).ReadString('\n')
	if err != nil {
		t.Fatal(err)
	}
	pidHook, err := strconv.Atoi(strings.TrimSpace(linha))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS == "windows" && pidHook == bash.Process.Pid {
		t.Fatal("o Git Bash deveria abrir um segundo bash")
	}

	agentes := make(chan int, 1)
	a := subir(t, Opcoes{Terminal: func(pid int) string { agentes <- pid; return "Term-Bash" }}, true)
	a.post(t, "mcode", []byte(`{"hook_event_name":"SessionStart","session_id":"mvs_4"}`), map[string]string{"X-Ponte-PID-Hook": strconv.Itoa(pidHook)})
	if got := <-agentes; got != os.Getpid() {
		t.Fatalf("o agente do bash %d (%s) deveria ser o teste %d, veio %d (%s)", pidHook, processo.Nome(pidHook), os.Getpid(), got, processo.Nome(got))
	}
}
