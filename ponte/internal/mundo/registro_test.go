package mundo

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"firmopolis/ponte/internal/projeto"
)

var t0 = time.Date(2026, 11, 14, 9, 0, 0, 0, time.UTC)

func novoRegistro() *Registro {
	return NovoRegistro(func() time.Time { return t0 })
}

var jarvis = MetaTerminal{ID: "T1", Nome: "Jarvis", Papel: "Scout & Testes", Provedor: ProvedorClaude, WorkspaceID: "ws-a", BandID: "b1"}

func TestSinalComTerminalCriaMoradorVinculado(t *testing.T) {
	r := novoRegistro()
	r.Vincular(jarvis)

	m, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado, Cwd: `C:\GODOT\escritoriovivo`})
	if m == nil || saiu != "" {
		t.Fatalf("esperava morador novo, veio %v %q", m, saiu)
	}
	if m.ID != "t1" || m.Nome != "Jarvis" || m.Papel != "Scout & Testes" || m.Solto {
		t.Fatalf("vínculo errado: %+v", m)
	}
	if m.WorkspaceID != "ws-a" || m.BandID != "b1" || m.Estado != Ocupado || m.Projeto != "escritoriovivo" {
		t.Fatalf("campos errados: %+v", m)
	}
	if !m.Desde.Equal(t0) {
		t.Fatalf("desde deveria vir do relógio quando o sinal não traz TS: %v", m.Desde)
	}
}

func TestSinalSemTerminalViraSolto(t *testing.T) {
	r := novoRegistro()

	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocioso, Cwd: "/home/ana/projetos/loja/"})
	if m == nil || m.ID != "claude_code:s1" || !m.Solto || m.Projeto != "loja" {
		t.Fatalf("solto errado: %+v", m)
	}
	if m.Provedor != ProvedorClaude {
		t.Fatalf("provedor deveria vir da fonte: %q", m.Provedor)
	}
}

func TestDuasSessoesMesmoTerminalUmMorador(t *testing.T) {
	r := novoRegistro()
	r.Vincular(jarvis)
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Ajudante: true})

	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t1", Estado: Ocioso})
	if m == nil || m.Estado != Ocioso || m.Ajudantes != 0 {
		t.Fatalf("a sessão nova deveria substituir a antiga (sem herdar ajudantes): %+v", m)
	}
	if snap := r.Snapshot(); len(snap) != 1 {
		t.Fatalf("esperava 1 morador, veio %d", len(snap))
	}

	// O fim atrasado da sessão antiga não derruba o morador da sessão nova.
	if m, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Fim: true}); m != nil || saiu != "" {
		t.Fatalf("fim da sessão antiga não deveria mexer: %v %q", m, saiu)
	}
	if snap := r.Snapshot(); len(snap) != 1 {
		t.Fatalf("o morador da sessão nova sumiu")
	}
}

func TestSinalSemTerminalSegueSessaoJaVinculada(t *testing.T) {
	r := novoRegistro()
	r.Vincular(jarvis)
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})

	// A reconciliação pelas sessões não sabe o terminal: o vínculo vem pelo session_id.
	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: EsperandoPermissao})
	if m == nil || m.ID != "t1" || m.Estado != EsperandoPermissao {
		t.Fatalf("sinal deveria ir para o morador vinculado: %+v", m)
	}
	if snap := r.Snapshot(); len(snap) != 1 {
		t.Fatalf("não deveria criar solto duplicado: %d moradores", len(snap))
	}
}

func TestSoltoPromovidoATerminalSemFantasma(t *testing.T) {
	r := novoRegistro()
	r.Vincular(jarvis)
	// Ponte reiniciada: a reconciliação vê a sessão antes de qualquer hook.
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocupado, Cwd: `C:\proj\loja`})

	m, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1"})
	if m == nil || m.ID != "t1" || m.Solto || m.Nome != "Jarvis" || m.Estado != Ocupado || saiu != "claude_code:s1" {
		t.Fatalf("o solto deveria virar o terminal, com o estado dele: %+v %q", m, saiu)
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].ID != "t1" {
		t.Fatalf("esperava só o t1, veio %+v", snap)
	}
	if _, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Fim: true}); saiu != "t1" {
		t.Fatalf("o fim da sessão deveria tirar o t1, veio %q", saiu)
	}
}

func TestEventoAtrasadoDaSessaoAntigaIgnorado(t *testing.T) {
	r := novoRegistro()
	r.Vincular(jarvis)
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t1", Ajudante: true, AjudanteID: "a1"})

	for _, s := range []Sinal{
		{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocioso},
		{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocioso}, // reconciliação, sem terminal
	} {
		if m, saiu := r.Aplicar(s); m != nil || saiu != "" {
			t.Fatalf("evento da sessão antiga deveria ser ignorado: %+v %q", m, saiu)
		}
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].Estado != Ocupado || snap[0].Ajudantes != 1 {
		t.Fatalf("o morador da sessão viva mudou: %+v", snap)
	}
	if _, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t1", Fim: true}); saiu != "t1" {
		t.Fatalf("o fim da sessão viva deveria valer, veio %q", saiu)
	}
}

func TestEventoDepoisDoFimNaoRessuscita(t *testing.T) {
	atrasado := func(sessao string) Sinal {
		return Sinal{Fonte: ProvedorClaude, SessaoID: sessao, TerminalID: "t1", Estado: Ocioso}
	}

	// (a) SessionEnd de s1 e depois um Stop atrasado de s1.
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Fim: true})
	for _, s := range []Sinal{atrasado("s1"), {Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocioso}} {
		if m, _ := r.Aplicar(s); m != nil || len(r.Snapshot()) != 0 {
			t.Fatalf("(a) evento depois do fim recriou o morador: %+v", m)
		}
	}

	// (b) s1 substituída por s2, fim de s2, depois um atrasado de s1.
	r = novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t1", Fim: true})
	if m, _ := r.Aplicar(atrasado("s1")); m != nil || len(r.Snapshot()) != 0 {
		t.Fatalf("(b) evento da sessão substituída recriou o morador: %+v", m)
	}
}

func TestSessaoRetomadaDepoisDoFimVolta(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Fim: true})

	// claude --resume reabre o mesmo session_id: o SessionStart (Inicio) vale.
	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Inicio: true})
	if m == nil || m.ID != "t1" {
		t.Fatalf("a sessão retomada deveria voltar: %+v", m)
	}
}

func TestMarcasDeEncerradaExpiram(t *testing.T) {
	agora := t0
	r := NovoRegistro(func() time.Time { return agora })
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Fim: true})

	agora = t0.Add(2 * time.Hour)
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t2", Estado: Ocupado})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t2", Fim: true})
	if _, ok := r.encerradas["claude_code:s1"]; ok || len(r.encerradas) != 1 {
		t.Fatalf("marcas com mais de 1 h deveriam ser podadas: %v", r.encerradas)
	}
}

func TestSoltoPromovidoATerminalComOutraSessao(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s0", TerminalID: "t1", Estado: Ocioso})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocupado, Ferramenta: "Bash", Alvo: "ls", TS: t0.Add(time.Minute)})

	m, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", TS: t0.Add(2 * time.Minute)})
	if m == nil || saiu != "claude_code:s1" || m.Estado != Ocupado || m.Atividade == nil || m.Atividade.Alvo != "ls" || !m.Desde.Equal(t0.Add(time.Minute)) {
		t.Fatalf("o terminal deveria assumir o estado da sessão do solto: %+v %q", m, saiu)
	}
	// A sessão antiga do terminal (s0) fica encerrada.
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s0", TerminalID: "t1", Estado: Ocioso}); m != nil {
		t.Fatalf("a sessão antiga não pode voltar: %+v", m)
	}
}

func TestPromocaoComHookMaisVelhoMantemEstadoDoSolto(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocupado, TS: t0.Add(10 * time.Second)})

	m, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocioso, TS: t0.Add(5 * time.Second)})
	if m == nil || m.ID != "t1" || saiu != "claude_code:s1" || m.Estado != Ocupado {
		t.Fatalf("promove o terminal, mas o estado mais novo do solto fica: %+v %q", m, saiu)
	}
}

func TestTerminalPromovidoSemMetaNaoHerdaNomeDeSolto(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocupado})
	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1"})
	if m == nil || m.Nome != "" {
		t.Fatalf("o nome de reserva é só do solto; o terminal espera o Vincular: %+v", m)
	}
}

func TestOutroProvedorNoTerminalNaoToma(t *testing.T) {
	// Com meta: o terminal é de Claude; um agy -p ou codex exec chamado de dentro dele
	// herda o MAESTRI_TERMINAL_ID, mas é execução filha.
	r := novoRegistro()
	r.Vincular(jarvis)
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	for _, s := range []Sinal{
		{Fonte: ProvedorAgy, SessaoID: "c1", TerminalID: "t1", Estado: Ocioso, Inicio: true},
		{Fonte: ProvedorCodex, SessaoID: "x1", TerminalID: "t1", Fim: true},
		{Fonte: ProvedorAgy, SessaoID: "c1", TerminalID: "t1", Ajudante: true, AjudanteID: "a"},
	} {
		if m, saiu := r.Aplicar(s); m != nil || saiu != "" {
			t.Fatalf("execução filha de outro provedor não toma o terminal: %+v %q", m, saiu)
		}
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].Provedor != ProvedorClaude || snap[0].Estado != Ocupado {
		t.Fatalf("o morador do terminal mudou: %+v", snap)
	}

	// Sem meta: não substitui a sessão viva de outra fonte.
	r = novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t2", Estado: Ocupado})
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorCodex, SessaoID: "x1", TerminalID: "t2", Estado: Ocupado}); m != nil {
		t.Fatalf("sem meta, outra fonte não substitui a sessão viva: %+v", m)
	}

	// Terminal de shell genérico (provedor desconhecido na meta): qualquer agente vale.
	r = novoRegistro()
	r.Vincular(MetaTerminal{ID: "t3", Nome: "Ponte", Provedor: ProvedorDesconhecido})
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorAgy, SessaoID: "c1", TerminalID: "t3", Estado: Ocupado}); m == nil || m.Provedor != ProvedorAgy {
		t.Fatalf("terminal genérico aceita o agente que rodar nele: %+v", m)
	}
}

func TestVarrerTiraSessaoDePIDMorto(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorAgy, SessaoID: "c1", TerminalID: "t1", Estado: Ocupado, PID: 10})
	r.Aplicar(Sinal{Fonte: ProvedorOpenCode, SessaoID: "o1", Estado: Ocupado, PID: 11})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t2", Estado: Ocupado}) // sem PID: não é varrido

	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorAgy, SessaoID: "c1", TerminalID: "t1", Estado: Ocupado, PID: 10}); m != nil {
		t.Fatalf("PID repetido não é mudança visível: %+v", m)
	}
	saidas := r.Varrer(func(pid int, _ uint64) bool { return pid != 10 })
	if len(saidas) != 1 || saidas[0] != "t1" || len(r.Snapshot()) != 2 {
		t.Fatalf("só o PID morto sai: %v %+v", saidas, r.Snapshot())
	}
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorAgy, SessaoID: "c1", TerminalID: "t1", Estado: Ocioso}); m != nil {
		t.Fatalf("a sessão varrida fica encerrada: %+v", m)
	}
	if saidas := r.Varrer(func(int, uint64) bool { return true }); len(saidas) != 0 {
		t.Fatalf("nada mais a varrer: %v", saidas)
	}
}

// A hora de nascimento fica no morador: um PID reaproveitado por um agente novo não
// mantém o morador velho, mesmo que o novo apareça antes da varredura.
func TestVarrerUsaONascimentoDoMorador(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorAgy, SessaoID: "velha", TerminalID: "t1", Estado: Ocupado, PID: 10, Nascimento: 111})
	r.Aplicar(Sinal{Fonte: ProvedorAgy, SessaoID: "nova", TerminalID: "t2", Estado: Ocupado, PID: 10, Nascimento: 222})
	saidas := r.Varrer(func(pid int, nascimento uint64) bool { return pid == 10 && nascimento == 222 })
	if len(saidas) != 1 || saidas[0] != "t1" {
		t.Fatalf("só o morador do processo que morreu sai: %v %+v", saidas, r.Snapshot())
	}
}

// ExcetoOcioso é o "dialog open" do Claude: não tira do Ocioso (diálogo opcional do
// fim do turno) e, fora dele, vale (sessão pausada pedindo ação).
func TestEstadoExcetoOcioso(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocioso})
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: EsperandoResposta, ExcetoOcioso: true}); m != nil {
		t.Fatalf("o ocioso segue ocioso: %+v", m)
	}
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: EsperandoResposta, ExcetoOcioso: true}); m == nil || m.Estado != EsperandoResposta {
		t.Fatalf("o ocupado passa a esperar você: %+v", m)
	}
}

// O arquivo pode mostrar o diálogo do fim do turno antes de o hook Stop, 16 ms mais
// velho, sair da fila: o Stop ainda vale, e o morador não fica preso esperando.
func TestStopAtrasadoVenceODialogo(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado, TS: t0})
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: EsperandoResposta, ExcetoOcioso: true, TS: t0.Add(2 * time.Second)})
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocioso, TS: t0.Add(time.Second)}); m == nil || m.Estado != Ocioso {
		t.Fatalf("o Stop atrasado deixa o morador ocioso: %+v", m)
	}
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: EsperandoResposta, ExcetoOcioso: true, TS: t0.Add(2 * time.Second)}); m != nil {
		t.Fatalf("a releitura do diálogo não tira do ocioso: %+v", m)
	}
}

func TestSessaoAtual(t *testing.T) {
	r := novoRegistro()
	if _, _, ok := r.SessaoAtual("T1"); ok {
		t.Fatal("terminal sem morador não tem sessão")
	}
	r.Aplicar(Sinal{Fonte: ProvedorCodex, SessaoID: "x1", TerminalID: "t1", Estado: Ocupado})
	if fonte, sessao, ok := r.SessaoAtual("T1"); !ok || fonte != ProvedorCodex || sessao != "x1" {
		t.Fatalf("sessão atual errada: %q %q %v", fonte, sessao, ok)
	}
}

func TestSoltoSemCwdUsaProvedorComoNome(t *testing.T) {
	r := novoRegistro()
	m, _ := r.Aplicar(Sinal{Fonte: ProvedorAgy, SessaoID: "c1", Estado: Ocupado})
	if m == nil || m.Nome != ProvedorAgy {
		t.Fatalf("nome de reserva errado: %+v", m)
	}
}

func TestVincularDevolveMoradorAlterado(t *testing.T) {
	r := novoRegistro()
	if m := r.Vincular(jarvis); m != nil {
		t.Fatalf("sem morador não há o que reenviar: %+v", m)
	}
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})
	if m := r.Vincular(jarvis); m != nil {
		t.Fatalf("meta igual não muda nada: %+v", m)
	}
	renomeado := jarvis
	renomeado.Nome = "Jarvis II"
	if m := r.Vincular(renomeado); m == nil || m.Nome != "Jarvis II" {
		t.Fatalf("esperava o morador renomeado: %+v", m)
	}
}

func TestAjudanteNaoCriaMorador(t *testing.T) {
	r := novoRegistro()
	r.Vincular(jarvis)
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado})

	ajudante := func(agente string, fim bool) Sinal {
		return Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Ajudante: true, AjudanteID: agente, Fim: fim}
	}
	m, _ := r.Aplicar(ajudante("a1", false))
	if m == nil || m.Ajudantes != 1 || m.Estado != Ocupado {
		t.Fatalf("ajudante deveria somar no pai: %+v", m)
	}
	if m, _ := r.Aplicar(ajudante("a1", false)); m != nil {
		t.Fatalf("início repetido do mesmo ajudante não soma: %+v", m)
	}
	r.Aplicar(ajudante("a2", false))
	r.Aplicar(ajudante("a1", true))
	m, saiu := r.Aplicar(ajudante("a2", true))
	if m == nil || m.Ajudantes != 0 || saiu != "" {
		t.Fatalf("fim do ajudante deveria descontar sem remover o pai: %+v %q", m, saiu)
	}
	if m, _ := r.Aplicar(ajudante("a2", true)); m != nil {
		t.Fatalf("ajudantes não passam de 0: %+v", m)
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].Ajudantes != 0 {
		t.Fatalf("snapshot errado: %+v", snap)
	}

	// Ajudante sem pai conhecido é descartado.
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s9", Ajudante: true}); m != nil || len(r.Snapshot()) != 1 {
		t.Fatalf("ajudante órfão não pode virar morador: %+v", m)
	}
}

func TestRepeticaoNaoGeraMudanca(t *testing.T) {
	r := novoRegistro()
	s := Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocupado, Ferramenta: "Bash", Alvo: "go test ./...", TS: t0}
	if m, _ := r.Aplicar(s); m == nil {
		t.Fatal("o primeiro sinal deveria criar o morador")
	}
	s.TS = t0.Add(time.Second)
	if m, _ := r.Aplicar(s); m != nil {
		t.Fatalf("repetição não deveria gerar mudança: %+v", m)
	}

	s.Ferramenta, s.Alvo = "Edit", "main.go"
	m, _ := r.Aplicar(s)
	if m == nil || m.Atividade == nil || m.Atividade.Ferramenta != "Edit" || !m.Desde.Equal(t0) {
		t.Fatalf("troca de ferramenta muda a atividade, não o desde do estado: %+v", m)
	}

	m, _ = r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocioso, TS: t0.Add(time.Minute)})
	if m == nil || m.Atividade != nil || !m.Desde.Equal(t0.Add(time.Minute)) {
		t.Fatalf("ocioso limpa a atividade e muda o desde: %+v", m)
	}
}

func TestSinalMaisVelhoNaoDesfazOMaisNovo(t *testing.T) {
	r := novoRegistro()
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Estado: Ocioso, TS: t0.Add(10 * time.Second)})

	// O arquivo de sessão atrasa: ainda diz "busy", com a hora de quando ficou busy.
	if m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocupado, TS: t0.Add(5 * time.Second)}); m != nil {
		t.Fatalf("sinal mais velho não pode desfazer o mais novo: %+v", m)
	}
	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocupado, TS: t0.Add(20 * time.Second)})
	if m == nil || m.Estado != Ocupado {
		t.Fatalf("sinal mais novo deveria valer: %+v", m)
	}
}

func TestFimRemove(t *testing.T) {
	r := novoRegistro()
	r.Vincular(jarvis)
	r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: Ocupado})

	m, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Fim: true})
	if m != nil || saiu != "t1" {
		t.Fatalf("esperava saiu=t1, veio %v %q", m, saiu)
	}
	if len(r.Snapshot()) != 0 {
		t.Fatal("o morador deveria ter saído")
	}
	if _, saiu := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t1", Fim: true}); saiu != "" {
		t.Fatalf("fim repetido não deveria sair de novo: %q", saiu)
	}
}

func TestMoradorDevolvidoNaoVazaEstadoInterno(t *testing.T) {
	r := novoRegistro()
	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", Estado: Ocupado, Ferramenta: "Bash", Alvo: "ls"})
	m.Estado = Erro
	m.Atividade.Alvo = "mexido"

	snap := r.Snapshot()
	if snap[0].Estado != Ocupado || snap[0].Atividade.Alvo != "ls" {
		t.Fatalf("alterar a cópia mexeu no registro: %+v", snap[0])
	}
}

func TestJSONDoContrato(t *testing.T) {
	r := novoRegistro()
	m, _ := r.Aplicar(Sinal{Fonte: ProvedorOpenCode, SessaoID: "s1", Estado: Ocioso})
	b, err := json.Marshal(m)
	if err != nil {
		t.Fatal(err)
	}
	got := string(b)
	for _, trecho := range []string{`"id":"open_code:s1"`, `"band_id":null`, `"projeto":null`, `"atividade":null`, `"estado":"ocioso"`, `"solto":true`, `"workspace_id":""`} {
		if !strings.Contains(got, trecho) {
			t.Errorf("faltou %s em %s", trecho, got)
		}
	}
	if strings.Contains(got, "sessao") {
		t.Errorf("campo interno vazou: %s", got)
	}
}

func TestProjetoDoCwdDoPapelEDaMeta(t *testing.T) {
	// cwd de papel do Maestri: <pasta do workspace>/.maestri/roles/<papel>. Na home
	// (genérica), o terminal fica com o projeto da meta e o solto com o do workspace
	// dessa pasta; fora dela, vale o projeto do cwd.
	r := novoRegistro()
	r.projetoDe = projeto.Novo(`C:\Users\ana`).De
	// O workspace da home e a meta do terminal com projetos diferentes: o terminal nunca
	// pega o da home pelo cwd, só o solto.
	r.DefinirPastas(map[string]string{projeto.Chave(`C:\Users\ana`): "DaHome"})
	neo := MetaTerminal{ID: "t2", Nome: "Neo", Provedor: ProvedorClaude, WorkspaceID: "ws-dm", Projeto: "EscritorioVivo"}
	r.Vincular(neo)

	m, _ := r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s1", TerminalID: "t2", Cwd: `C:\Users\ana\.maestri\roles\b830fadc`})
	if m == nil || m.Projeto != "EscritorioVivo" {
		t.Fatalf("terminal com cwd genérico deveria levar o projeto da meta: %+v", m)
	}
	m, _ = r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s2", TerminalID: "t2", Inicio: true, Cwd: `C:\dev\dm-erp\.maestri\roles\b830fadc`})
	if m == nil || m.Projeto != "dm-erp" {
		t.Fatalf("o projeto do cwd vale antes do da meta: %+v", m)
	}
	neo.Projeto = "Outro"
	if m := r.Vincular(neo); m != nil {
		t.Fatalf("meta nova não troca o projeto que veio do cwd: %+v", m)
	}

	m, _ = r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s3", Cwd: `C:\Users\ana\.maestri\roles\a878b0ec`})
	if m == nil || !m.Solto || m.Projeto != "DaHome" || m.Nome != "DaHome" {
		t.Fatalf("solto no papel da home deveria levar o projeto do workspace da home: %+v", m)
	}
	m, _ = r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s4", Cwd: `C:\Users\ana`})
	if m == nil || m.Projeto != "" || m.Nome != ProvedorClaude {
		t.Fatalf("solto na própria home não tem projeto: %+v", m)
	}
	r.DefinirPastas(map[string]string{projeto.Chave(`C:\Users\ana`): ""}) // pasta de dois workspaces
	m, _ = r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s5", Cwd: `C:\Users\ana\.maestri\roles\a878b0ec`})
	if m == nil || m.Projeto != "" {
		t.Fatalf("pasta ambígua não dá projeto ao solto: %+v", m)
	}
	m, _ = r.Aplicar(Sinal{Fonte: ProvedorClaude, SessaoID: "s3", Estado: Ocupado})
	if m == nil || m.Projeto != "DaHome" {
		t.Fatalf("sinal sem cwd mantém o projeto: %+v", m)
	}
}
