package claude

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"firmopolis/ponte/internal/mundo"
)

// hook monta o stdin de um hook com os campos comuns mais os extras (JSON sem chaves).
func hook(nome, extras string) []byte {
	corpo := `{"session_id":"sess-0001","cwd":"C:\\proj\\escritorio","hook_event_name":"` + nome + `"`
	if extras != "" {
		corpo += "," + extras
	}
	return []byte(corpo + "}")
}

func normalizar(t *testing.T, corpo []byte) []mundo.Sinal {
	t.Helper()
	sinais, err := NormalizarHook(corpo, "T1")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	return sinais
}

func um(t *testing.T, corpo []byte) mundo.Sinal {
	t.Helper()
	sinais := normalizar(t, corpo)
	if len(sinais) != 1 {
		t.Fatalf("esperava 1 sinal, veio %+v", sinais)
	}
	s := sinais[0]
	if s.Fonte != mundo.ProvedorClaude || s.SessaoID != "sess-0001" || s.TerminalID != "T1" || s.Cwd != `C:\proj\escritorio` {
		t.Fatalf("campos comuns errados: %+v", s)
	}
	return s
}

func nenhum(t *testing.T, corpo []byte) {
	t.Helper()
	if sinais := normalizar(t, corpo); len(sinais) != 0 {
		t.Fatalf("esperava nenhum sinal, veio %+v", sinais)
	}
}

func TestUserPromptSubmitOcupado(t *testing.T) {
	s := um(t, hook("UserPromptSubmit", `"prompt":"conserte o login"`))
	if s.Estado != mundo.Ocupado || s.Ferramenta != "" || s.Fim || s.Ajudante {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestTaskNotificationIgnorado(t *testing.T) {
	nenhum(t, hook("UserPromptSubmit", `"prompt":"<task-notification>\n<task-id>agente-0001</task-id>\n</task-notification>"`))
}

func TestPreToolUseFerramentaEAlvo(t *testing.T) {
	longo := strings.Repeat("x", 80)
	casos := []struct{ ferramenta, entrada, alvo string }{
		{"Edit", `{"file_path":"C:\\proj\\escritorio\\escritorio.py","old_string":"a","new_string":"b"}`, "escritorio.py"},
		{"Read", `{"file_path":"/home/ana/loja/main.go"}`, "main.go"},
		{"NotebookEdit", `{"notebook_path":"C:\\proj\\analise.ipynb"}`, "analise.ipynb"},
		{"Bash", `{"command":"go test ./...\necho fim","description":"Roda os testes"}`, "go test ./..."},
		{"WebFetch", `{"url":"https://exemplo.com/docs?token=abc#x","prompt":"resuma"}`, "https://exemplo.com/docs"},
		{"WebFetch", `{"url":"https://ana:senha@exemplo.com/x"}`, "https://exemplo.com/x"},
		{"WebFetch", `{"url":"::não é url"}`, ""},
		{"Bash", `{"command":"` + longo + `"}`, strings.Repeat("x", 59) + "…"},
		{"TodoWrite", `{"todos":[]}`, ""},
	}
	for _, c := range casos {
		s := um(t, hook("PreToolUse", `"tool_name":"`+c.ferramenta+`","tool_input":`+c.entrada))
		if s.Estado != mundo.Ocupado || s.Ferramenta != c.ferramenta || s.Alvo != c.alvo {
			t.Errorf("%s %s: veio %+v, esperava alvo %q", c.ferramenta, c.entrada, s, c.alvo)
		}
		if n := len([]rune(s.Alvo)); n > 60 {
			t.Errorf("alvo com %d caracteres", n)
		}
	}
}

func TestNotificacoes(t *testing.T) {
	casos := map[string]mundo.Estado{
		"permission_prompt":      mundo.EsperandoPermissao,
		"idle_prompt":            mundo.Ocioso,
		"elicitation_dialog":     mundo.EsperandoResposta,
		"elicitation_url_dialog": mundo.EsperandoResposta,
		"agent_needs_input":      mundo.EsperandoResposta,
	}
	for tipo, estado := range casos {
		if s := um(t, hook("Notification", `"notification_type":"`+tipo+`","message":"x"`)); s.Estado != estado {
			t.Errorf("%s: veio %q, esperava %q", tipo, s.Estado, estado)
		}
	}
	nenhum(t, hook("Notification", `"notification_type":"auth_success","message":"x"`))
}

// Só a espera que pede uma resposta escrita aceita texto digitado; diálogo de opções nunca.
func TestAceitaTextoSoNaListaPositiva(t *testing.T) {
	notif := map[string]bool{"elicitation_dialog": true, "elicitation_url_dialog": false, "permission_prompt": false}
	for tipo, aceita := range notif {
		s := um(t, hook("Notification", `"notification_type":"`+tipo+`","message":"x"`))
		if s.AceitaTexto != aceita || aceita && s.Espera != "notificacao:"+tipo {
			t.Errorf("%s: %+v", tipo, s)
		}
	}
	// agent_needs_input: só a pergunta escrita; o "Teammate setup" (iTerm2 ou tmux), os avisos do
	// modo auto e o desconhecido são diálogos de opções
	mensagens := map[string]bool{
		"Your cloud session needs an answer before it can start":              true,
		"Teammate setup needs your input":                                     false,
		"Auto mode has a classifier billing notice to acknowledge":            false,
		"Auto mode can't check actions in this session and needs your choice": false,
		"Builder needs your input: pick a branch":                             false,
		"": false,
	}
	esperas := map[string]bool{}
	for msg, aceita := range mensagens {
		s := um(t, hook("Notification", `"notification_type":"agent_needs_input","message":"`+msg+`"`))
		if s.Estado != mundo.EsperandoResposta || s.AceitaTexto != aceita {
			t.Errorf("agent_needs_input %q: %+v", msg, s)
		}
		esperas[s.Espera] = true
	}
	if len(esperas) != len(mensagens) {
		t.Error("cada mensagem é uma espera diferente (a troca muda a geração)")
	}
	// o arquivo nunca liga o AceitaTexto (o "input needed" vale também para a elicitação de link);
	// o "input needed" é fraco: não troca a espera que o hook pôs
	arquivo := map[string]bool{"input needed": true, "Input Needed": true, "dialog open": false, "sandbox request": false,
		"goal proposal": false, "algo novo": false, "": false}
	for w, fraca := range arquivo {
		sinais := Reconciliar(nil, map[string]Sessao{"s": {SessionID: "s", Status: "waiting", WaitingFor: w, PID: 1}},
			func(int, uint64) bool { return true })
		if len(sinais) != 1 || sinais[0].AceitaTexto || sinais[0].EsperaFraca != fraca {
			t.Errorf("waitingFor %q: %+v", w, sinais)
		}
	}
}

func TestPermissionRequestEsperandoPermissao(t *testing.T) {
	s := um(t, hook("PermissionRequest", `"tool_name":"Bash","tool_input":{"command":"rm -rf build"}`))
	if s.Estado != mundo.EsperandoPermissao {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestStop(t *testing.T) {
	if s := um(t, hook("Stop", `"background_tasks":[],"session_crons":[]`)); s.Estado != mundo.Ocioso {
		t.Errorf("stop sem tarefas: %+v", s)
	}
	if s := um(t, hook("Stop", `"session_crons":[]`)); s.Estado != mundo.Ocioso {
		t.Errorf("stop sem o campo background_tasks: %+v", s)
	}
	if s := um(t, hook("Stop", `"background_tasks":[{"id":"agente-0001","type":"subagent","status":"running"}]`)); s.Estado != mundo.Ocupado {
		t.Errorf("stop com subagente rodando: %+v", s)
	}
	// Só subagente rodando segura o Ocupado: shell em segundo plano ou subagente já concluído, não.
	if s := um(t, hook("Stop", `"background_tasks":[{"id":"b1","type":"shell","status":"running"},{"id":"a1","type":"subagent","status":"completed"}]`)); s.Estado != mundo.Ocioso {
		t.Errorf("stop só com shell em segundo plano: %+v", s)
	}
}

func TestPermissaoDeSubagenteVaiProPai(t *testing.T) {
	casos := []struct {
		evento, extras string
		estado         mundo.Estado
	}{
		{"PermissionRequest", `"tool_name":"Bash","tool_input":{"command":"rm -rf build"}`, mundo.EsperandoPermissao},
		{"Notification", `"notification_type":"permission_prompt","message":"x"`, mundo.EsperandoPermissao},
		{"Notification", `"notification_type":"elicitation_dialog","message":"x"`, mundo.EsperandoResposta},
	}
	for _, c := range casos {
		s := um(t, hook(c.evento, `"agent_id":"agente-0001",`+c.extras))
		if s.Estado != c.estado || s.Ajudante || s.Ferramenta != "" {
			t.Errorf("%s %s: veio %+v, esperava %q no pai", c.evento, c.extras, s, c.estado)
		}
	}
}

func TestStopFailureErro(t *testing.T) {
	if s := um(t, hook("StopFailure", `"error":"rate_limit"`)); s.Estado != mundo.Erro {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestSessionEnd(t *testing.T) {
	if s := um(t, hook("SessionEnd", `"reason":"other"`)); !s.Fim || s.Ajudante {
		t.Fatalf("sinal errado: %+v", s)
	}
	// /clear troca a sessão no mesmo terminal: o SessionStart da nova assume o morador.
	nenhum(t, hook("SessionEnd", `"reason":"clear"`))
}

func TestClearEmSoltoEncerraAntiga(t *testing.T) {
	// Sem terminal, a sessão nova vira outro solto: a antiga precisa sair.
	sinais, err := NormalizarHook(hook("SessionEnd", `"reason":"clear"`), "")
	if err != nil || len(sinais) != 1 || !sinais[0].Fim {
		t.Fatalf("o /clear de um solto deveria encerrar a sessão antiga: %+v %v", sinais, err)
	}
}

func TestSessionStartNaoMudaEstado(t *testing.T) {
	if s := um(t, hook("SessionStart", `"source":"compact"`)); s.Estado != "" || s.Fim || !s.Inicio {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestSubagenteViraAjudante(t *testing.T) {
	ini := um(t, hook("SubagentStart", `"agent_id":"agente-0001","agent_type":"general-purpose"`))
	if !ini.Ajudante || ini.Fim || ini.AjudanteID != "agente-0001" || ini.Estado != "" {
		t.Fatalf("início errado: %+v", ini)
	}
	fim := um(t, hook("SubagentStop", `"agent_id":"agente-0001","background_tasks":[{"status":"running"}]`))
	if !fim.Ajudante || !fim.Fim || fim.AjudanteID != "agente-0001" {
		t.Fatalf("fim errado: %+v", fim)
	}
	// As ferramentas do subagente não mexem no pai.
	nenhum(t, hook("PreToolUse", `"agent_id":"agente-0001","tool_name":"Bash","tool_input":{"command":"echo ok"}`))
	// Sem agent_id não há como deduplicar: todo ajudante sai com AjudanteID preenchido.
	nenhum(t, hook("SubagentStart", `"agent_type":"general-purpose"`))
	nenhum(t, hook("SubagentStop", ""))
}

func TestEventosSemSinal(t *testing.T) {
	nenhum(t, hook("PostToolUse", `"tool_name":"Bash","tool_input":{"command":"echo ok"}`))
	nenhum(t, hook("PreCompact", ""))
}

func TestJSONParcialIgnorado(t *testing.T) {
	for _, corpo := range []string{`{"session_id":"sess-0001","hook_event_name":"Sto`, ``, `{"hook_event_name":"Stop"}`} {
		if sinais, err := NormalizarHook([]byte(corpo), "T1"); err == nil || sinais != nil {
			t.Errorf("%q: esperava erro e nenhum sinal, veio %+v %v", corpo, sinais, err)
		}
	}

	dir := t.TempDir()
	escrever(t, dir, "1001.json", `{"pid":1001,"sessionId":"sess-0001","status":"busy","entrypoint":"cli"}`)
	escrever(t, dir, "1002.json", `{"pid":1002,"sessionId":"sess-00`)
	sess, err := LerSessoes(dir)
	if err != nil || len(sess) != 1 {
		t.Fatalf("o arquivo parcial deveria ser pulado: %+v %v", sess, err)
	}
}

func TestAlvoSemPrompt(t *testing.T) {
	segredo := "PROMPT-SECRETO"
	corpos := [][]byte{
		hook("UserPromptSubmit", `"prompt":"`+segredo+`"`),
		hook("PreToolUse", `"tool_name":"Agent","tool_input":{"description":"Revisa","prompt":"`+segredo+`","subagent_type":"general-purpose"}`),
		hook("PreToolUse", `"tool_name":"WebFetch","tool_input":{"url":"https://exemplo.com","prompt":"`+segredo+`"}`),
		hook("Stop", `"last_assistant_message":"`+segredo+`","background_tasks":[]`),
	}
	for _, corpo := range corpos {
		for _, s := range normalizar(t, corpo) {
			if strings.Contains(s.Alvo+s.Ferramenta+s.Cwd, segredo) {
				t.Errorf("o prompt vazou no sinal: %+v", s)
			}
		}
	}
}

// replay aplica uma fixture de hooks, uma linha por evento, ao registro.
func replay(t *testing.T, r *mundo.Registro, arquivo string) (estados []mundo.Morador, saidas []string) {
	t.Helper()
	f, err := os.Open(filepath.Join("testdata", arquivo))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	linhas := bufio.NewScanner(f)
	for linhas.Scan() {
		sinais, err := NormalizarHook(linhas.Bytes(), "T1")
		if err != nil {
			t.Fatalf("%s: %v", linhas.Text(), err)
		}
		for _, s := range sinais {
			m, saiu := r.Aplicar(s)
			if m != nil {
				estados = append(estados, *m)
			}
			if saiu != "" {
				saidas = append(saidas, saiu)
			}
		}
	}
	return estados, saidas
}

func TestStopComSubagenteRodandoNaoFicaOcioso(t *testing.T) {
	r := mundo.NovoRegistro(nil)
	estados, saidas := replay(t, r, "hooks_subagente.jsonl")

	// O 1º Stop chega com o subagente rodando: o morador não pode ficar ocioso antes
	// do fim do subagente, e o <task-notification> não conta como prompt.
	var resumo []string
	for _, m := range estados {
		resumo = append(resumo, string(m.Estado)+"/"+string(rune('0'+m.Ajudantes)))
	}
	got := strings.Join(resumo, " ")
	if want := "ocioso/0 ocupado/0 ocupado/0 ocupado/1 ocupado/0 ocioso/0"; got != want {
		t.Fatalf("sequência de estados:\n got %s\nwant %s", got, want)
	}
	if len(saidas) != 1 || saidas[0] != "t1" {
		t.Fatalf("o SessionEnd deveria tirar o t1: %v", saidas)
	}
}

func TestPostToolUseDepoisDoStopNaoReabre(t *testing.T) {
	r := mundo.NovoRegistro(nil)
	for _, corpo := range [][]byte{
		hook("UserPromptSubmit", `"prompt":"x"`),
		hook("PreToolUse", `"tool_name":"Bash","tool_input":{"command":"ls"}`),
		hook("Stop", `"background_tasks":[]`),
		hook("PostToolUse", `"tool_name":"Bash","tool_input":{"command":"ls"}`),
		hook("Stop", `"background_tasks":[]`),
	} {
		for _, s := range normalizar(t, corpo) {
			r.Aplicar(s)
		}
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].Estado != mundo.Ocioso || snap[0].Atividade != nil {
		t.Fatalf("estado final errado: %+v", snap)
	}
}

func escrever(t *testing.T, dir, nome, conteudo string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, nome), []byte(conteudo), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestLerSessoes(t *testing.T) {
	dir := t.TempDir()
	escrever(t, dir, "1001.json", `{"pid":1001,"sessionId":"sess-0001","cwd":"C:\\proj\\a","status":"waiting","waitingFor":"dialog open","entrypoint":"cli","kind":"interactive","statusUpdatedAt":1794688224427,"procStart":"134392615501887306"}`)
	escrever(t, dir, "1002.json", `{"pid":1002,"sessionId":"sess-0002","cwd":"C:\\proj\\b","status":null,"entrypoint":"sdk-cli"}`)
	escrever(t, dir, "1002.abc.key", `não é sessão`)

	sess, err := LerSessoes(dir)
	if err != nil {
		t.Fatal(err)
	}
	want := Sessao{SessionID: "sess-0001", Status: "waiting", WaitingFor: "dialog open", Entrypoint: "cli", Cwd: `C:\proj\a`, PID: 1001, Inicio: 134392615501887306, Atualizado: time.UnixMilli(1794688224427)}
	if got := sess["sess-0001"]; got != want {
		t.Fatalf("sessão lida errada:\n got %+v\nwant %+v", got, want)
	}
	if got := sess["sess-0002"]; got.Status != "" || got.Entrypoint != "sdk-cli" || !got.Atualizado.IsZero() || got.Inicio != 0 {
		t.Fatalf("sessão com status null: %+v", got)
	}
	if len(sess) != 2 {
		t.Fatalf("esperava 2 sessões, veio %d", len(sess))
	}

	if sess, err := LerSessoes(filepath.Join(dir, "nao-existe")); err != nil || len(sess) != 0 {
		t.Fatalf("pasta ausente (Claude não instalado) não é erro: %+v %v", sess, err)
	}
}

func TestReconciliar(t *testing.T) {
	ts := time.UnixMilli(1794688224427)
	sess := map[string]Sessao{
		"s-idle":  {SessionID: "s-idle", Status: "idle", PID: 1, Cwd: `C:\proj\a`, Atualizado: ts},
		"s-busy":  {SessionID: "s-busy", Status: "busy", PID: 2},
		"s-shell": {SessionID: "s-shell", Status: "shell", PID: 3},
		"s-perm":  {SessionID: "s-perm", Status: "waiting", WaitingFor: "permission", PID: 4},
		"s-dlg":   {SessionID: "s-dlg", Status: "waiting", WaitingFor: "dialog open", PID: 5},
		"s-input": {SessionID: "s-input", Status: "waiting", WaitingFor: "input needed", PID: 8},
		"s-nulo":  {SessionID: "s-nulo", PID: 6},
		"s-morto": {SessionID: "s-morto", Status: "busy", PID: 7},
	}
	vivo := func(pid int, _ uint64) bool { return pid != 7 }

	got := map[string]mundo.Sinal{}
	for _, s := range Reconciliar(nil, sess, vivo) {
		got[s.SessaoID] = s
	}
	want := map[string]mundo.Estado{"s-idle": mundo.Ocioso, "s-busy": mundo.Ocupado, "s-shell": mundo.Ocupado,
		"s-perm": mundo.EsperandoPermissao, "s-dlg": mundo.EsperandoResposta, "s-input": mundo.EsperandoResposta, "s-nulo": ""}
	for id, estado := range want {
		s, ok := got[id]
		if !ok || s.Estado != estado || s.ExcetoOcioso != (id == "s-dlg") || s.Fim || s.Fonte != mundo.ProvedorClaude || s.TerminalID != "" {
			t.Errorf("%s: veio %+v, esperava %q", id, s, estado)
		}
	}
	if s := got["s-idle"]; !s.TS.Equal(ts) || s.Cwd != `C:\proj\a` {
		t.Errorf("TS e cwd devem vir do arquivo: %+v", s)
	}
	if s := got["s-morto"]; !s.Fim {
		t.Errorf("PID morto vira Fim: %+v", s)
	}
}

func TestArquivoAtrasadoNaoDesfazHook(t *testing.T) {
	agora := time.UnixMilli(1794688230000)
	r := mundo.NovoRegistro(func() time.Time { return agora })
	for _, corpo := range [][]byte{hook("UserPromptSubmit", `"prompt":"x"`), hook("Stop", `"background_tasks":[]`)} {
		for _, s := range normalizar(t, corpo) {
			r.Aplicar(s)
		}
	}
	// O arquivo ainda diz busy, com a hora em que ficou busy (antes do Stop).
	sess := map[string]Sessao{"sess-0001": {SessionID: "sess-0001", Status: "busy", PID: 1, Atualizado: agora.Add(-3 * time.Second)}}
	for _, s := range Reconciliar(nil, sess, func(int, uint64) bool { return true }) {
		if m, _ := r.Aplicar(s); m != nil {
			t.Fatalf("a reconciliação atrasada desfez o Stop: %+v", m)
		}
	}
}

func TestSdkCliDescartado(t *testing.T) {
	sess := map[string]Sessao{
		"s-p":   {SessionID: "s-p", Status: "busy", Entrypoint: "sdk-cli", PID: 1},
		"s-cli": {SessionID: "s-cli", Status: "busy", Entrypoint: "cli", PID: 2},
	}
	sinais := Reconciliar(nil, sess, func(int, uint64) bool { return false })
	if len(sinais) != 1 || sinais[0].SessaoID != "s-cli" {
		t.Fatalf("a sessão sdk-cli não pode virar sinal: %+v", sinais)
	}

	// O claude -p herda o MAESTRI_TERMINAL_ID: sem o filtro, tomaria o morador do terminal.
	hook := []mundo.Sinal{
		{Fonte: mundo.ProvedorClaude, SessaoID: "s-p", TerminalID: "T1", Estado: mundo.Ocupado},
		{Fonte: mundo.ProvedorClaude, SessaoID: "s-cli", TerminalID: "T1", Estado: mundo.Ocupado},
		{Fonte: mundo.ProvedorClaude, SessaoID: "s-desconhecida", TerminalID: "T2", Estado: mundo.Ocupado},
	}
	var ficaram []string
	for _, s := range FiltrarExcluidas(hook, sess) {
		ficaram = append(ficaram, s.SessaoID)
	}
	if got := strings.Join(ficaram, ","); got != "s-cli,s-desconhecida" {
		t.Fatalf("filtro errado: %s", got)
	}
}

func TestSessaoQueSumiuEncerra(t *testing.T) {
	antes := map[string]Sessao{
		"s-saiu":    {SessionID: "s-saiu", Status: "idle", PID: 10},
		"s-parcial": {SessionID: "s-parcial", Status: "busy", PID: 11},
		"s-clear":   {SessionID: "s-clear", Status: "idle", PID: 12},
	}
	agora := map[string]Sessao{"s-nova": {SessionID: "s-nova", Status: "idle", PID: 12}}
	vivo := func(pid int, _ uint64) bool { return pid != 10 }

	got := map[string]mundo.Sinal{}
	for _, s := range Reconciliar(antes, agora, vivo) {
		got[s.SessaoID] = s
	}
	if !got["s-saiu"].Fim {
		t.Errorf("o arquivo sumiu e o processo morreu: deveria encerrar: %+v", got["s-saiu"])
	}
	if _, ok := got["s-parcial"]; ok {
		t.Errorf("arquivo ausente com processo vivo (leitura parcial) não encerra: %+v", got["s-parcial"])
	}
	if !got["s-clear"].Fim || got["s-nova"].Estado != mundo.Ocioso {
		t.Errorf("o mesmo PID com outra sessão (/clear) encerra a antiga: %+v", got)
	}
}

func TestMonitorRelePastaParaSessaoDesconhecida(t *testing.T) {
	dir := t.TempDir()
	m := NovoMonitor(dir, func(int, uint64) bool { return true })
	if _, err := m.Ler(); err != nil {
		t.Fatal(err)
	}

	// O claude -p abriu depois da última leitura: o hook chega antes da próxima.
	escrever(t, dir, "2001.json", `{"pid":2001,"sessionId":"s-p","status":"busy","entrypoint":"sdk-cli"}`)
	hook := []mundo.Sinal{
		{Fonte: mundo.ProvedorClaude, SessaoID: "s-p", TerminalID: "T1", Estado: mundo.Ocupado},
		{Fonte: mundo.ProvedorClaude, SessaoID: "s-sem-arquivo", TerminalID: "T2", Estado: mundo.Ocupado},
	}
	ficaram := m.Filtrar(hook)
	if len(ficaram) != 1 || ficaram[0].SessaoID != "s-sem-arquivo" {
		t.Fatalf("o -p deveria ser filtrado depois de reler a pasta: %+v", ficaram)
	}

	// A leitura seguinte já conhece o -p e não gera sinal para ele.
	sinais, err := m.Ler()
	if err != nil || len(sinais) != 0 {
		t.Fatalf("o -p não pode virar sinal na reconciliação: %+v %v", sinais, err)
	}
}

func TestMonitorGuardaSessaoSumidaComPIDVivo(t *testing.T) {
	dir := t.TempDir()
	vivo := true
	m := NovoMonitor(dir, func(int, uint64) bool { return vivo })
	escrever(t, dir, "3001.json", `{"pid":3001,"sessionId":"s1","status":"busy","entrypoint":"cli"}`)
	if _, err := m.Ler(); err != nil {
		t.Fatal(err)
	}

	// Leitura pulada (arquivo sendo regravado) com o processo vivo: nada sai...
	os.Remove(filepath.Join(dir, "3001.json"))
	if sinais, _ := m.Ler(); len(sinais) != 0 {
		t.Fatalf("PID vivo não encerra: %+v", sinais)
	}
	// ...e se o processo sair antes da leitura seguinte, o Fim ainda sai.
	vivo = false
	sinais, _ := m.Ler()
	if len(sinais) != 1 || sinais[0].SessaoID != "s1" || !sinais[0].Fim {
		t.Fatalf("a sessão sumida deveria seguir lembrada até o Fim: %+v", sinais)
	}
	if sinais, _ := m.Ler(); len(sinais) != 0 {
		t.Fatalf("depois do Fim ela sai da memória: %+v", sinais)
	}
}

// Fantasmas da Fase 1: no fim de cada turno, o Claude abre um diálogo opcional e grava
// "waiting"/"dialog open" no arquivo. O terminal que só terminou o turno segue ocioso.
func TestDialogoDeFimDeTurnoNaoViraEspera(t *testing.T) {
	agora := time.UnixMilli(1794688230000)
	r := mundo.NovoRegistro(func() time.Time { return agora })
	for _, corpo := range [][]byte{hook("UserPromptSubmit", `"prompt":"x"`), hook("Stop", `"background_tasks":[]`)} {
		for _, s := range normalizar(t, corpo) {
			r.Aplicar(s)
		}
	}
	sess := map[string]Sessao{"sess-0001": {SessionID: "sess-0001", Status: "waiting", WaitingFor: "dialog open", PID: 1, Atualizado: agora.Add(16 * time.Millisecond)}}
	for _, s := range Reconciliar(nil, sess, func(int, uint64) bool { return true }) {
		r.Aplicar(s)
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].Estado != mundo.Ocioso {
		t.Fatalf("o diálogo opcional não é esperando você: %+v", snap)
	}
}

// O mesmo "dialog open" no meio do turno é diálogo que pede ação: "Session paused"
// (tentar de novo no modelo de reserva depois de uma recusa da API), ultraplan...
func TestDialogoNoMeioDoTurnoViraEspera(t *testing.T) {
	agora := time.UnixMilli(1794688230000)
	r := mundo.NovoRegistro(func() time.Time { return agora })
	for _, s := range normalizar(t, hook("UserPromptSubmit", `"prompt":"x"`)) {
		r.Aplicar(s)
	}
	sess := map[string]Sessao{"sess-0001": {SessionID: "sess-0001", Status: "waiting", WaitingFor: "dialog open", PID: 1, Atualizado: agora.Add(time.Second)}}
	for _, s := range Reconciliar(nil, sess, func(int, uint64) bool { return true }) {
		r.Aplicar(s)
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].Estado != mundo.EsperandoResposta {
		t.Fatalf("a sessão pausada espera você: %+v", snap)
	}
}

// Um PID que o Windows reaproveitou para outro processo não mantém a sessão: vale a
// hora de nascimento do processo (procStart), com o arquivo presente ou já apagado.
func TestPIDReaproveitadoEncerra(t *testing.T) {
	nascimento := map[int]uint64{20: 111, 21: 999, 22: 444} // 21 e 22 já são outros processos
	vivo := func(pid int, inicio uint64) bool { return inicio == 0 || nascimento[pid] == inicio }

	agora := map[string]Sessao{
		"s-viva":     {SessionID: "s-viva", Status: "idle", PID: 20, Inicio: 111},
		"s-reusada":  {SessionID: "s-reusada", Status: "waiting", WaitingFor: "input needed", PID: 21, Inicio: 222},
		"s-sem-hora": {SessionID: "s-sem-hora", Status: "idle", PID: 21}, // procStart ausente: só o PID
	}
	// PID só dela: o Fim tem de sair da hora, não do PID que outra sessão mostra.
	antes := map[string]Sessao{"s-sumiu": {SessionID: "s-sumiu", Status: "idle", PID: 22, Inicio: 333}}
	got := map[string]mundo.Sinal{}
	for _, s := range Reconciliar(antes, agora, vivo) {
		got[s.SessaoID] = s
	}
	if got["s-viva"].Fim || got["s-sem-hora"].Fim {
		t.Errorf("processo da sessão vivo não encerra: %+v", got)
	}
	if !got["s-reusada"].Fim || !got["s-sumiu"].Fim {
		t.Errorf("PID reaproveitado encerra a sessão: %+v", got)
	}
}

// /exit em que o SessionEnd se perdeu (o hook não chega a sair): quando o arquivo some
// e o processo morreu, o terminal deixa o prédio, mesmo esperando você.
func TestExitSemSessionEndTiraOTerminal(t *testing.T) {
	dir := t.TempDir()
	vivo := true
	m := NovoMonitor(dir, func(int, uint64) bool { return vivo })
	r := mundo.NovoRegistro(nil)
	r.Aplicar(mundo.Sinal{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Inicio: true})
	r.Aplicar(mundo.Sinal{Fonte: mundo.ProvedorClaude, SessaoID: "s1", TerminalID: "T1", Estado: mundo.EsperandoResposta})

	escrever(t, dir, "4001.json", `{"pid":4001,"sessionId":"s1","status":"waiting","waitingFor":"input needed","entrypoint":"cli"}`)
	sinais, _ := m.Ler()
	for _, s := range sinais {
		r.Aplicar(s)
	}
	if snap := r.Snapshot(); len(snap) != 1 || snap[0].ID != "t1" {
		t.Fatalf("o terminal vivo segue no prédio: %+v", snap)
	}

	os.Remove(filepath.Join(dir, "4001.json"))
	vivo = false
	sinais, _ = m.Ler()
	var saiu string
	for _, s := range sinais {
		if _, id := r.Aplicar(s); id != "" {
			saiu = id
		}
	}
	if saiu != "t1" || len(r.Snapshot()) != 0 {
		t.Fatalf("o terminal que saiu deixa o prédio: saiu %q, sobrou %+v", saiu, r.Snapshot())
	}
}
