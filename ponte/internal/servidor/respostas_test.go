package servidor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"firmopolis/ponte/internal/decisao"
	"firmopolis/ponte/internal/maestri"
	"firmopolis/ponte/internal/mundo"
)

// Nenhum teste deste pacote alcança o Maestri de verdade: sem Opcoes.Maestri, nunca acha.
func init() {
	acharMaestri = func() (maestri.CLI, bool) { return maestri.CLI{}, false }
}

// falsoMaestri é o binário do maestri: guarda cada chamada (o ambiente do Maestri e os
// argumentos) e responde o `list` com os conectados.
type falsoMaestri struct {
	mu         sync.Mutex
	chamadas   [][]string // MAESTRI_TERMINAL_ID seguido dos argumentos
	conectados string
	falhar     bool
	falharAsk  bool   // o ask falha (como um timeout depois de digitar)
	aoListar   func() // chamado no 2º list (o da hora de digitar), sem o lock
	listas     int
}

func (f *falsoMaestri) cli() (maestri.CLI, bool) {
	return maestri.CLI{Bin: "/falso/maestri", Socket: "/falso/maestri.sock", Rodar: f.rodar}, true
}

func (f *falsoMaestri) rodar(_ context.Context, bin string, env, args []string) ([]byte, error) {
	f.mu.Lock()
	if args[0] == "list" {
		f.listas++
		if cb := f.aoListar; cb != nil && f.listas == 2 {
			f.mu.Unlock()
			cb()
			f.mu.Lock()
		}
	}
	defer f.mu.Unlock()
	terminal, sock := "", ""
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, "MAESTRI_TERMINAL_ID="); ok {
			terminal = v
		}
		if v, ok := strings.CutPrefix(e, "MAESTRI_SOCKET="); ok {
			sock = v
		}
	}
	if bin != "/falso/maestri" || sock != "/falso/maestri.sock" {
		return nil, errors.New("binário ou socket errado")
	}
	f.chamadas = append(f.chamadas, append([]string{terminal}, args...))
	if f.falhar || f.falharAsk && args[0] == "ask" {
		return nil, errors.New("exit 1")
	}
	if args[0] == "list" {
		return []byte(f.conectados), nil
	}
	return []byte("texto do terminal"), nil
}

func (f *falsoMaestri) asks() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var r [][]string
	for _, c := range f.chamadas {
		if c[1] == "ask" {
			r = append(r, c)
		}
	}
	return r
}

const listaAlvo = `You:
  - name: "Front"

Connected agents:
  - band: "Banda", with you
    - name: "Auditor"
      ⎿ note: "Front · Instruções"
    - name: "Maestro · Opus", maestro: true
  - name: "Outro Workspace"
`

var metasTeste = []mundo.MetaTerminal{
	{ID: "t1", Nome: "Front", WorkspaceID: "w1", Provedor: mundo.ProvedorClaude},
	{ID: "t2", Nome: "Auditor", WorkspaceID: "w1"},
	{ID: "t3", Nome: "Maestro · Opus", WorkspaceID: "w1", Gerente: true},
	{ID: "t4", Nome: "Outro Workspace", WorkspaceID: "w2"},
}

// perguntando sobe a ponte com o maestri falso e põe o morador t1 na pergunta.
func perguntando(t *testing.T, f *falsoMaestri, metas []mundo.MetaTerminal) (*ambiente, decisao.Pendente) {
	t.Helper()
	a := subir(t, Opcoes{Maestri: f.cli}, true)
	a.s.vincular([]maestri.Workspace{{ID: "w1"}, {ID: "w2"}}, metas)
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoResposta, Espera: "notificacao:elicitation_dialog", AceitaTexto: true}})
	var p decisao.Pendente
	esperar(t, func() bool {
		l := a.s.dec.Lista()
		if len(l) == 1 {
			p = l[0]
		}
		return len(l) == 1
	})
	return a, p
}

func TestPerguntaDoMaestriDigitaComOsArgumentosCertos(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a, p := perguntando(t, f, metasTeste)
	if p.Tipo != decisao.TipoPergunta || p.Via != decisao.ViaMaestri || p.MoradorID != "t1" || p.Completo {
		t.Fatalf("pergunta: %+v", p)
	}
	if f.chamadas[0][0] != "t1" || f.chamadas[0][1] != "list" {
		t.Fatalf("o list roda como o próprio alvo: %v", f.chamadas[0])
	}
	if m := a.s.responder(p.ID, "  sim, pode seguir — ação ✓  ", decisao.PorLocal); m != "" {
		t.Fatalf("recusou: %s", m)
	}
	esperar(t, func() bool { return len(f.asks()) == 1 })
	// chama como o Maestro (conectado e do mesmo workspace), sem shell, com um só Enter no fim
	want := []string{"t3", "ask", "Front", "--raw", `sim, pode seguir — ação ✓\n`}
	if got := f.asks()[0]; strings.Join(got, "|") != strings.Join(want, "|") {
		t.Fatalf("args: %q, queria %q", got, want)
	}
	if m := a.s.responder(p.ID, "de novo", decisao.PorLocal); m != MotivoEncerrado {
		t.Fatalf("uso único: %q", m)
	}
}

func TestPerguntaRecusaForaDoEstadoENaAprovacao(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a, p := perguntando(t, f, metasTeste)
	// o morador vai para a aprovação: a pergunta fecha e nada é digitado
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoPermissao}})
	if m := a.s.responder(p.ID, "1", decisao.PorLocal); m != MotivoEncerrado {
		t.Fatalf("na aprovação: %q", m)
	}
	// uma pergunta aberta à mão, com o morador fora da pergunta: 409 (estado), e ela segue aberta
	q, _, _ := a.s.dec.AbrirPergunta("t1", "", decisao.ViaMaestri, 0, "", time.Minute)
	if m := a.s.responder(q.ID, "sim", decisao.PorLocal); m != MotivoEstado {
		t.Fatalf("fora da pergunta: %q", m)
	}
	if _, ok := a.s.dec.Pegar(q.ID); !ok {
		t.Fatal("a recusa por estado não gasta a pergunta")
	}
	time.Sleep(50 * time.Millisecond)
	if len(f.asks()) != 0 {
		t.Fatalf("nada vai ao terminal: %v", f.asks())
	}
}

func TestPerguntaSemAlvoNaoAbre(t *testing.T) {
	casos := map[string]struct {
		conectados string
		metas      []mundo.MetaTerminal
	}{
		"ninguém conectado":     {"You:\n  - name: \"Front\"\n", metasTeste},
		"só de outro workspace": {"Connected agents:\n  - name: \"Outro Workspace\"\n", metasTeste},
		"nome repetido em outro workspace": {listaAlvo, append(append([]mundo.MetaTerminal{}, metasTeste...),
			mundo.MetaTerminal{ID: "t9", Nome: "Front", WorkspaceID: "w2"})},
		"nome repetido em outra caixa": {listaAlvo, append(append([]mundo.MetaTerminal{}, metasTeste...),
			mundo.MetaTerminal{ID: "t9", Nome: "FRONT", WorkspaceID: "w2"})},
		"nome que começa com -": {strings.ReplaceAll(listaAlvo, `"Front"`, `"-Front"`), []mundo.MetaTerminal{
			{ID: "t1", Nome: "-Front", WorkspaceID: "w1"}, metasTeste[1], metasTeste[2]}},
	}
	for nome, c := range casos {
		t.Run(nome, func(t *testing.T) {
			f := &falsoMaestri{conectados: c.conectados}
			a := subir(t, Opcoes{Maestri: f.cli}, true)
			a.s.vincular([]maestri.Workspace{{ID: "w1"}, {ID: "w2"}}, c.metas)
			a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoResposta, Espera: "notificacao:elicitation_dialog", AceitaTexto: true}})
			time.Sleep(100 * time.Millisecond)
			if l := a.s.dec.Lista(); len(l) != 0 {
				t.Fatalf("sem alvo, sem pergunta: %v", l)
			}
		})
	}
	// sem o binário ou o socket: nem o list roda
	a := subir(t, Opcoes{}, true)
	a.s.vincular([]maestri.Workspace{{ID: "w1"}}, metasTeste)
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoResposta, Espera: "notificacao:elicitation_dialog", AceitaTexto: true}})
	time.Sleep(100 * time.Millisecond)
	if len(a.s.dec.Lista()) != 0 {
		t.Fatal("sem o maestri, sem pergunta")
	}
}

func TestPerguntaRecusaTextoProibidoELimite(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a, p := perguntando(t, f, metasTeste)
	for _, ruim := range []string{"", "   ", "linha\noutra", "a\\nb", "\x1b[A", "a\tb", "\u202eabc", "a\u200bb", "\u0085", "\u2028", "\ue000", strings.Repeat("a", 1001)} {
		if m := a.s.responder(p.ID, ruim, decisao.PorLocal); m != MotivoTexto {
			t.Fatalf("%q: %q", ruim, m)
		}
	}
	if _, ok := a.s.dec.Pegar(p.ID); !ok {
		t.Fatal("texto recusado não gasta a pergunta")
	}
	for _, ruim := range []string{"--raw x", " -1"} { // começa com "-": vira opção do maestri
		if m := a.s.responder(p.ID, ruim, decisao.PorLocal); m != MotivoTexto {
			t.Fatalf("%q: %q", ruim, m)
		}
	}
	// id lixo ou desconhecido não conta no limite
	for i := 0; i < 50; i++ {
		if m := a.s.responder("x", "sim", decisao.PorLocal); m != MotivoEncerrado {
			t.Fatalf("id lixo: %q", m)
		}
		a.s.responder("AAAAAAAAAAAAAAAAAAAAAA", "sim", decisao.PorRemoto)
	}
	// já foram 14 tentativas; até 20 por minuto, depois "limite"
	for i := 0; i < 6; i++ {
		a.s.responder(p.ID, "a\nb", decisao.PorLocal)
	}
	if m := a.s.responder(p.ID, "sim", decisao.PorLocal); m != MotivoLimite {
		t.Fatalf("21ª tentativa: %q", m)
	}
	if len(f.asks()) != 0 {
		t.Fatal("nada foi digitado")
	}
}

func TestPerguntaPeloWSRecusaEResponde(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a := subir(t, Opcoes{Maestri: f.cli}, true)
	c, _, err := a.conectar(t, comToken())
	if err != nil {
		t.Fatal(err)
	}
	ler(t, c)
	ler(t, c)
	a.s.vincular([]maestri.Workspace{{ID: "w1"}}, metasTeste)
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoResposta, Espera: "notificacao:elicitation_dialog", AceitaTexto: true}})
	p := lerTipo(t, c, "pendente")["pendente"].(map[string]any)
	id := p["id"].(string)
	if p["tipo"] != "pergunta" || p["via"] != "maestri" {
		t.Fatalf("pendente: %v", p)
	}
	escrever(t, c, `{"v":1,"tipo":"responder","id":"`+id+`","texto":"a\\u0000b"}`)
	r := lerTipo(t, c, "recusado")
	if r["id"] != id || r["motivo"] != MotivoTexto {
		t.Fatalf("recusado: %v", r)
	}
	escrever(t, c, `{"v":1,"tipo":"responder","id":"`+id+`","texto":"ok"}`)
	if r := lerTipo(t, c, "resolvido"); r["id"] != id || r["por"] != decisao.PorLocal {
		t.Fatalf("resolvido: %v", r)
	}
	esperar(t, func() bool { return len(f.asks()) == 1 })
	if got := f.asks()[0]; got[4] != `ok\n` {
		t.Fatalf("args: %q", got)
	}
}

func TestPerguntaVenceEReabre(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a := subir(t, Opcoes{Maestri: f.cli, EsperaDecisao: 80 * time.Millisecond}, true)
	a.s.vincular([]maestri.Workspace{{ID: "w1"}}, metasTeste)
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoResposta, Espera: "notificacao:elicitation_dialog", AceitaTexto: true}})
	var primeiro string
	esperar(t, func() bool {
		l := a.s.dec.Lista()
		if len(l) == 1 && primeiro == "" {
			primeiro = l[0].ID
		}
		return len(l) == 1 && l[0].ID != primeiro
	})
	// saiu da pergunta: fecha e não abre de novo
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.Ocupado}})
	time.Sleep(150 * time.Millisecond)
	if l := a.s.dec.Lista(); len(l) != 0 {
		t.Fatalf("fora da pergunta: %v", l)
	}
}

func TestPerguntaRemotaPeloLongPoll(t *testing.T) {
	falso := &decisoesFalsas{atendendo: true}
	ts := httptest.NewServer(falso)
	t.Cleanup(ts.Close)
	f := &falsoMaestri{conectados: listaAlvo}
	cfg := ConfigEspelho{URL: ts.URL, Chave: chaveTeste, DecidirRemoto: true}
	a, p := perguntando(t, f, metasTeste)
	a.s.op.Espelho, a.s.op.EsperaRemota = func() (ConfigEspelho, bool) { return cfg, true }, time.Second
	ctx, cancelar := context.WithCancel(context.Background())
	t.Cleanup(cancelar)
	go a.s.decisoesRemotas(ctx)
	falso.mu.Lock()
	falso.fila = []DecisaoRemota{{ID: p.ID, Acao: decisao.Responder, Texto: "a\u202eb"}, {ID: p.ID, Acao: decisao.Responder, Texto: "pelo celular"}}
	falso.mu.Unlock()
	esperar(t, func() bool { return len(f.asks()) == 1 })
	if got := f.asks()[0]; got[4] != `pelo celular\n` {
		t.Fatalf("args: %q", got)
	}
}

const perguntaOpenCode = `{"sessionID":"ses_1","id":"que_1","pergunta":"Qual banco? token=abc123segredo","cwd":"/home/ana/loja"}`

func TestPerguntaDoOpenCodeVoltaAssinada(t *testing.T) {
	a := subir(t, Opcoes{}, true) // sem ninguém atendendo: a pergunta espera mesmo assim
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorOpenCode, SessaoID: "ses_1", TerminalID: "T1", Estado: mundo.EsperandoResposta, Espera: "notificacao:elicitation_dialog", AceitaTexto: true}})
	resp := a.pedirPendente(t, "opencode-pergunta", perguntaOpenCode, context.Background())
	nonce := fmt.Sprintf("%032x", nonceSeq.Load()) // o assinarPendente roda antes de o pedido sair
	var p decisao.Pendente
	esperar(t, func() bool {
		l := a.s.dec.Lista()
		if len(l) == 1 {
			p = l[0]
		}
		return len(l) == 1
	})
	if p.Tipo != decisao.TipoPergunta || p.Via != decisao.ViaOpenCode || strings.Contains(p.Resumo, "abc123segredo") || !strings.Contains(p.Resumo, "Qual banco?") {
		t.Fatalf("pergunta: %+v", p)
	}
	if m := a.s.responder(p.ID, "Postgres", decisao.PorLocal); m != "" {
		t.Fatalf("recusou: %s", m)
	}
	r := <-resp
	var corpo map[string]string
	if r.status != http.StatusOK || json.Unmarshal([]byte(r.corpo), &corpo) != nil || corpo["acao"] != "responder" || corpo["texto"] != "Postgres" {
		t.Fatalf("resposta: %d %s", r.status, r.corpo)
	}
	if !decisao.ConfereAssinatura(tokenTeste, corpo["assinatura"], []byte(nonce), []byte("responder"), []byte("Postgres")) {
		t.Fatal("a resposta vai assinada sobre o nonce, a ação e o texto")
	}
}

func TestPerguntaNaoAceitaDecidirNemPermissaoAceitaResponder(t *testing.T) {
	a, c := atendido(t, Opcoes{})
	resp := a.pedirPendente(t, "claude", pedidoBash, context.Background())
	id := lerTipo(t, c, "pendente")["pendente"].(map[string]any)["id"].(string)
	a.s.aplicar([]mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoResposta, Espera: "notificacao:elicitation_dialog", AceitaTexto: true}})
	if m := a.s.responder(id, "sim", decisao.PorLocal); m != MotivoEncerrado {
		t.Fatalf("permissão não recebe texto: %q", m)
	}
	q, _, _ := a.s.dec.AbrirPergunta("t1", "", decisao.ViaMaestri, 0, "", time.Minute)
	if a.s.decidir(q.ID, decisao.Permitir, decisao.PorLocal) {
		t.Fatal("pergunta não recebe permitir")
	}
	escrever(t, c, `{"v":1,"tipo":"decidir","id":"`+id+`","acao":"negar"}`)
	if r := <-resp; r.status != http.StatusOK {
		t.Fatalf("a permissão segue valendo: %d", r.status)
	}
}

// espera é o sinal do Claude no terminal T1 com o tipo de espera dado.
func espera(estado mundo.Estado, tipo string, aceita bool) []mundo.Sinal {
	return []mundo.Sinal{{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: estado, Espera: tipo, AceitaTexto: aceita}}
}

// Diálogo de opções (dialog open, sandbox request, goal proposal, link de elicitação): texto e
// Enter confirmariam a opção padrão. Sem pergunta, e a aberta fecha quando a espera muda para um.
func TestDialogoDeOpcoesNaoAbrePergunta(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a := subir(t, Opcoes{Maestri: f.cli}, true)
	a.s.vincular([]maestri.Workspace{{ID: "w1"}}, metasTeste)
	for _, tipo := range []string{"arquivo:dialog open", "arquivo:sandbox request", "arquivo:goal proposal", "notificacao:elicitation_url_dialog"} {
		a.s.aplicar(espera(mundo.EsperandoResposta, tipo, false))
	}
	time.Sleep(100 * time.Millisecond)
	if l := a.s.dec.Lista(); len(l) != 0 || len(f.chamadas) != 0 {
		t.Fatalf("diálogo de opções: %v %v", l, f.chamadas)
	}
	a.s.aplicar(espera(mundo.EsperandoResposta, "notificacao:elicitation_dialog", true))
	var p decisao.Pendente
	esperar(t, func() bool {
		l := a.s.dec.Lista()
		if len(l) == 1 {
			p = l[0]
		}
		return len(l) == 1
	})
	// a espera vira um diálogo de opções (o mesmo estado): a pergunta fecha e o texto não vale
	a.s.aplicar(espera(mundo.EsperandoResposta, "arquivo:sandbox request", false))
	if m := a.s.responder(p.ID, "sim", decisao.PorLocal); m != MotivoEncerrado {
		t.Fatalf("depois do diálogo de opções: %q", m)
	}
	time.Sleep(100 * time.Millisecond)
	if len(a.s.dec.Lista()) != 0 || len(f.asks()) != 0 {
		t.Fatal("nada aberto, nada digitado")
	}
}

// A espera muda entre a resposta e a hora de digitar (TOCTOU): nada é digitado, e a pergunta
// reabre na geração nova.
func TestEsperaMudaAntesDeDigitar(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a, p := perguntando(t, f, metasTeste)
	f.aoListar = func() {
		a.s.aplicar(espera(mundo.EsperandoResposta, "notificacao:agent_needs_input", true))
	}
	if m := a.s.responder(p.ID, "sim", decisao.PorLocal); m != "" {
		t.Fatalf("recusou: %s", m)
	}
	esperar(t, func() bool {
		l := a.s.dec.Lista()
		return len(l) == 1 && l[0].ID != p.ID
	})
	if len(f.asks()) != 0 {
		t.Fatalf("a geração mudou: nada digitado, %v", f.asks())
	}
	// e uma resposta da pergunta velha, com a geração velha, não vale
	if m := a.s.responder(p.ID, "sim", decisao.PorLocal); m != MotivoEncerrado {
		t.Fatalf("pergunta velha: %q", m)
	}
}

// Na hora de digitar, o alvo é resolvido de novo: com o nome trocado, nada é digitado.
func TestNomeMudaAntesDeDigitar(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo}
	a, p := perguntando(t, f, metasTeste)
	// o nome muda depois de a pergunta abrir (o alvo dela ainda é "Front")
	outro := append([]mundo.MetaTerminal{{ID: "t1", Nome: "Front 2", WorkspaceID: "w1"}}, metasTeste[1:]...)
	a.s.vincular([]maestri.Workspace{{ID: "w1"}, {ID: "w2"}}, outro)
	if m := a.s.responder(p.ID, "sim", decisao.PorLocal); m != "" {
		t.Fatalf("recusou: %s", m)
	}
	time.Sleep(150 * time.Millisecond)
	if len(f.asks()) != 0 {
		t.Fatalf("nome trocado: nada digitado, %v", f.asks())
	}
}

// Erro do maestri ask (um timeout pode vir depois de digitar): não reabre, para não responder duas vezes.
func TestErroAoDigitarNaoReabre(t *testing.T) {
	f := &falsoMaestri{conectados: listaAlvo, falharAsk: true}
	a, p := perguntando(t, f, metasTeste)
	if m := a.s.responder(p.ID, "sim", decisao.PorLocal); m != "" {
		t.Fatalf("recusou: %s", m)
	}
	esperar(t, func() bool { return len(f.asks()) == 1 })
	time.Sleep(150 * time.Millisecond)
	if l := a.s.dec.Lista(); len(l) != 0 || len(f.asks()) != 1 {
		t.Fatalf("depois do erro: %v, %d asks", l, len(f.asks()))
	}
}
