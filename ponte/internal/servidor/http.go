// Package servidor é a ponte em 127.0.0.1: recebe os eventos dos hooks e do plugin
// (POST /evento/{rota}), mantém o registro de moradores e fala com o jogo pelo
// WebSocket do contrato v1 (/ws).
package servidor

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"sync"
	"sync/atomic"
	"time"

	"firmopolis/ponte/internal/clima"
	"firmopolis/ponte/internal/decisao"
	"firmopolis/ponte/internal/fontes/agy"
	"firmopolis/ponte/internal/fontes/claude"
	"firmopolis/ponte/internal/fontes/codex"
	"firmopolis/ponte/internal/fontes/minimax"
	"firmopolis/ponte/internal/fontes/opencode"
	"firmopolis/ponte/internal/historico"
	"firmopolis/ponte/internal/maestri"
	"firmopolis/ponte/internal/mundo"
	"firmopolis/ponte/internal/processo"
)

const (
	// PortaPadrao é a porta do contrato v1.
	PortaPadrao = 47820
	// MaxCorpo é o maior corpo aceito em /evento; acima disso, 413.
	MaxCorpo = 256 << 10
	// TamanhoFila é a fila do consumidor único; cheia, o evento é descartado e contado.
	TamanhoFila = 1024
	// MaxConexoes limita as conexões abertas ao mesmo tempo.
	MaxConexoes = 64
	// PassoPadrao é o ticker único (reconciliação, varredura e Maestri).
	PassoPadrao = 3 * time.Second
	// OciosoMax fecha a conexão keep-alive parada: ela ocupa uma das MaxConexoes.
	OciosoMax = 5 * time.Second
)

// Opcoes configuram o servidor. Diretório vazio desliga a fonte correspondente.
type Opcoes struct {
	Porta int
	Token string
	// Origens são os endereços do Firmópolis que leem o /ws pelo navegador (origens.txt,
	// relido a cada pedido: o setup não pede reiniciar). nil: nenhum.
	Origens    func() []string
	Historico  *historico.Historico // nil: não grava
	DirClaude  string               // ~/.claude/sessions
	DirCodex   string               // ~/.codex/sessions
	DirMaestri string               // ~/.maestri
	Passo      time.Duration
	Demo       bool // 10 moradores de mentira; nunca grava histórico
	// Vivo diz se o processo pid, nascido em nascimento, segue vivo (Claude, agentes
	// dos hooks e varredura). nil: processo.VivoDesde; os testes trocam.
	Vivo func(pid int, nascimento uint64) bool
	// Terminal lê o MAESTRI_TERMINAL_ID do ambiente do agente, nas rotas cujo hook não
	// o recebe (terminalDoAgente). nil: processo.TerminalMaestri; os testes trocam.
	Terminal func(pid int) string
	// Clima dá o clima e as datas do dia (Rodar a liga). nil: sem cidade, só as datas.
	Clima *clima.Fonte
	// Espelho dá o espelho.json (relido a cada envio: o setup não pede reiniciar). nil: o
	// espelho nem roda. EsperaEspelho e VidaEspelho: zero vale o padrão; os testes trocam.
	Espelho       func() (ConfigEspelho, bool)
	EsperaEspelho time.Duration
	VidaEspelho   time.Duration
	// EsperaDecisao troca a espera dos pedidos de permissão (zero: decisao.Espera da rota) e
	// EsperaRemota o long-poll das decisões do servidor (zero: EsperaRemota). Os testes trocam.
	EsperaDecisao time.Duration
	EsperaRemota  time.Duration
	// Maestri acha o `maestri` que digita a resposta de uma pergunta (respostas.go). nil:
	// maestri.AcharCLI; os testes trocam.
	Maestri func() (maestri.CLI, bool)
}

// normalizadores liga cada rota de /evento ao normalizador do provedor.
var normalizadores = map[string]func(corpo []byte, terminalID string) ([]mundo.Sinal, error){
	"claude":   claude.NormalizarHook,
	"codex":    codex.NormalizarCodex,
	"opencode": opencode.NormalizarOpenCode,
	"agy":      agy.NormalizarAgy,
	"mcode":    minimax.NormalizarMiniMax,
}

// terminalDoAgente são as rotas cujo hook não recebe o MAESTRI_TERMINAL_ID: o mcode
// passa ao hook só uma lista fixa de variáveis. O terminal sai do ambiente do agente.
var terminalDoAgente = map[string]bool{"mcode": true}

type Servidor struct {
	op         Opcoes
	reg        *mundo.Registro
	monitor    *claude.Monitor
	origens    *codex.Origens
	observador *maestri.Observador
	demo       *demo

	fila        chan func()
	descartados atomic.Int64
	espMudou    chan struct{} // avisa o laço do espelho (espelho.go) de que algo mudou
	espPendente chan struct{} // pedido de permissão novo: o espelho manda já (sem juntar)

	dec         *decisao.Registro // os pedidos de permissão esperando (decisoes.go)
	atendLocal  atomic.Int64      // UnixNano do último "atender" de um cliente do /ws
	atendRemoto atomic.Int64      // UnixNano do último long-poll em que o servidor disse "atendendo"

	muResp      sync.Mutex                // respostas.go
	perguntando map[string]bool           // moradores com a pergunta do Maestri aberta
	perguntas   map[string]estadoPergunta // o estado de pergunta publicado de cada morador (sob s.mu)
	respostas   []time.Time               // as tentativas de resposta do último minuto

	muPID     sync.Mutex
	agentes   map[string]agente // fonte:sessão → agente já resolvido
	agenteLog map[string]bool   // fontes cujo agente resolvido já foi registrado

	// mu ordena a sequência de mudanças: aplicar no registro, gravar e transmitir
	// acontecem sob ele, e o cliente novo se inscreve sob ele antes do snapshot.
	mu         sync.Mutex
	clientes   map[*cliente]bool
	workspaces []maestri.Workspace
	terminais  []mundo.MetaTerminal    // os terminais do Maestri, de todos os workspaces (respostas.go)
	ambiente   clima.Estado            // clima e datas do dia
	estados    map[string]mundo.Estado // o último estado publicado de cada morador (decisoes.go)

	aoConsumir func() // testes: simula um processamento lento
	aoPassar   func() // testes: conta os passos do ticker
}

// agente é o processo que rodou o hook: o PID e a hora em que nasceu (processo.Inicio).
// A hora fica por sessão: um PID reaproveitado por outro agente não a sobrescreve.
type agente struct {
	pid        int
	nascimento uint64
	terminal   string // MAESTRI_TERMINAL_ID do ambiente dele (só em terminalDoAgente)
}

func Novo(op Opcoes) *Servidor {
	if op.Porta == 0 {
		op.Porta = PortaPadrao
	}
	if op.Passo <= 0 {
		op.Passo = PassoPadrao
	}
	if op.Vivo == nil {
		op.Vivo = processo.VivoDesde
	}
	if op.Terminal == nil {
		op.Terminal = processo.TerminalMaestri
	}
	if op.Clima == nil {
		op.Clima = clima.NovaFonte(clima.Config{}, "")
	}
	if op.Maestri == nil {
		op.Maestri = acharMaestri
	}
	if op.EsperaEspelho <= 0 {
		op.EsperaEspelho = EsperaEspelho
	}
	if op.VidaEspelho <= 0 {
		op.VidaEspelho = VidaEspelho
	}
	s := &Servidor{
		op:          op,
		reg:         mundo.NovoRegistro(nil),
		fila:        make(chan func(), TamanhoFila),
		espMudou:    make(chan struct{}, 1),
		espPendente: make(chan struct{}, 1),
		dec:         decisao.NovoRegistro(nil),
		estados:     map[string]mundo.Estado{},
		perguntando: map[string]bool{},
		perguntas:   map[string]estadoPergunta{},
		agentes:     map[string]agente{},
		agenteLog:   map[string]bool{},
		clientes:    map[*cliente]bool{},
		workspaces:  []maestri.Workspace{},
	}
	if op.Demo {
		s.op.Historico = nil // o demo nunca grava
		s.demo = &demo{}
		return s
	}
	if op.DirClaude != "" {
		s.monitor = claude.NovoMonitor(op.DirClaude, op.Vivo)
	}
	if op.DirCodex != "" {
		s.origens = codex.NovasOrigens(op.DirCodex)
	}
	if op.DirMaestri != "" {
		s.observador = maestri.NovoObservador(op.DirMaestri)
	}
	return s
}

// Handler é o HTTP da ponte, já atrás da guarda de Host e Origin.
func (s *Servidor) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /evento/{rota}", s.evento)
	mux.HandleFunc("POST /pendente/{rota}", s.pendente)
	mux.HandleFunc("GET /ws", s.ws)
	return s.guarda(mux)
}

// Rodar escuta em 127.0.0.1:<porta> até ctx acabar. Porta ocupada é erro (instância
// única): a ponte não troca de porta sozinha.
func (s *Servidor) Rodar(ctx context.Context) error {
	ln, err := net.Listen("tcp", "127.0.0.1:"+strconv.Itoa(s.op.Porta))
	if err != nil {
		return fmt.Errorf("a porta %d está ocupada (já há uma ponte rodando?): %w", s.op.Porta, err)
	}
	modo := ""
	if s.op.Demo {
		modo = " (demo)"
	}
	log.Printf("ponte em 127.0.0.1:%d%s", s.op.Porta, modo) // nunca o token
	srv := &http.Server{
		Handler:           s.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       OciosoMax,
		ErrorLog:          log.New(io.Discard, "", 0), // nada de corpo nem header em log
	}
	go s.Consumir(ctx)
	go s.op.Clima.Rodar(ctx, s.definirAmbiente)
	if s.op.Espelho != nil {
		go s.espelhar(ctx)
		go s.decisoesRemotas(ctx)
	}
	go func() {
		<-ctx.Done()
		desligar, cancelar := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancelar()
		srv.Shutdown(desligar)
		s.fecharClientes()
	}()
	if err := srv.Serve(limitar(ln, MaxConexoes)); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

// evento recebe o JSON de um hook ou do plugin. Responde 204 com corpo vazio (o Claude
// lê o corpo do hook http como decisão) logo depois de normalizar; aplicar fica para o
// consumidor.
func (s *Servidor) evento(w http.ResponseWriter, r *http.Request) {
	normalizar, ok := normalizadores[r.PathValue("rota")]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	// O hook e o plugin atuais assinam (nonce e HMAC do token sobre o corpo, como o /pendente): o
	// token não viaja. X-Ponte-Token puro ainda vale só para o plugin do OpenCode de uma versão
	// anterior, até o próximo `ponte setup --aplicar` trocá-lo (transição; sai numa versão futura).
	token := r.Header.Get("X-Ponte-Token")
	if token != "" && !iguais(token, s.op.Token) || token == "" && !nonceValido(r.Header.Get("X-Ponte-Nonce")) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	corpo, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxCorpo))
	var grande *http.MaxBytesError
	if errors.As(err, &grande) {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	if token == "" && !s.assinado(r, corpo) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	// Corpo que não se lê não é erro para o agente: responde 204 e ignora.
	rota := r.PathValue("rota")
	terminal := r.Header.Get("X-Maestri-Terminal-Id")
	if sinais, err := normalizar(corpo, terminal); err == nil && len(sinais) > 0 {
		if pid, err := strconv.Atoi(r.Header.Get("X-Ponte-PID-Hook")); err == nil && pid > 0 {
			if a, ok := s.agenteDe(sinais[0], pid, terminalDoAgente[rota]); ok {
				if terminal == "" && a.terminal != "" {
					// O terminal muda a regra de alguns eventos (o SessionEnd do /clear).
					if sinais, err = normalizar(corpo, a.terminal); err != nil {
						sinais = nil
					}
				}
				for i := range sinais {
					sinais[i].PID, sinais[i].Nascimento = a.pid, a.nascimento
				}
			}
		}
		if hora := horaDoHook(r.Header.Get("X-Ponte-Hora"), time.Now()); !hora.IsZero() {
			for i := range sinais {
				sinais[i].TS = hora
			}
		}
		if len(sinais) > 0 {
			s.enfileirar(func() { s.aplicarFonte(rota, sinais) })
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

// horaDoHook lê o X-Ponte-Hora (ms Unix de quando o agente criou o `ponte hook`). Fora
// do último minuto, ou no futuro, vale zero (a hora do recebimento): uma hora adiantada
// faria a sessão ignorar os eventos seguintes. A hora volta presa à leitura monotônica
// de agora: um ajuste do relógio (NTP) não faz a sessão ignorar os eventos do hook.
func horaDoHook(valor string, agora time.Time) time.Time {
	ms, err := strconv.ParseInt(valor, 10, 64)
	if err != nil {
		return time.Time{}
	}
	hora := time.UnixMilli(ms)
	if hora.After(agora) || agora.Sub(hora) > time.Minute {
		return time.Time{}
	}
	return agora.Add(hora.Sub(agora))
}

// agenteDe resolve o agente do hook (o script ainda espera a resposta, então a
// cadeia de processos está viva) uma vez por sessão: o PID, a hora em que ele nasceu
// e, com doAmbiente, o terminal do ambiente dele. Agente que morreu (ou cujo PID já é
// de outro processo) é resolvido de novo.
func (s *Servidor) agenteDe(sn mundo.Sinal, pidHook int, doAmbiente bool) (agente, bool) {
	chave := sn.Fonte + ":" + sn.SessaoID
	s.muPID.Lock()
	a, ok := s.agentes[chave]
	s.muPID.Unlock()
	if ok && s.op.Vivo(a.pid, a.nascimento) {
		return a, true
	}
	pid := processo.Agente(pidHook)
	if pid <= 0 {
		return agente{}, false
	}
	a = agente{pid: pid, nascimento: processo.Inicio(pid)}
	if doAmbiente {
		a.terminal = s.op.Terminal(pid)
	}
	s.muPID.Lock()
	s.agentes[chave] = a
	primeiro := !s.agenteLog[sn.Fonte]
	s.agenteLog[sn.Fonte] = true
	s.muPID.Unlock()
	if primeiro {
		// Uma vez por fonte: mostra se a subida pelos pais parou no agente (e não
		// num shell ou no próprio ponte.exe do hook). Fica para o consumidor, fora
		// do caminho da resposta.
		fonte, terminal := sn.Fonte, ""
		if doAmbiente {
			terminal = ", terminal do ambiente: não"
			if a.terminal != "" {
				terminal = ", terminal do ambiente: sim"
			}
		}
		s.enfileirar(func() {
			log.Printf("hook %s: agente resolvido = %s (pid %d%s)", fonte, processo.Nome(pid), pid, terminal)
		})
	}
	return a, true
}

// enfileirar entrega uma tarefa ao consumidor único. Fila cheia descarta e conta,
// sem nunca travar quem chamou.
func (s *Servidor) enfileirar(tarefa func()) bool {
	select {
	case s.fila <- tarefa:
		return true
	default:
		s.descartados.Add(1)
		return false
	}
}

// Descartados conta os eventos perdidos por fila cheia.
func (s *Servidor) Descartados() int64 { return s.descartados.Load() }

// Consumir é o consumidor único: aplica os eventos em ordem e, no mesmo laço, dá o
// passo do ticker (reconciliação do Claude, varredura de PIDs e leitura do Maestri).
func (s *Servidor) Consumir(ctx context.Context) {
	passo := time.NewTicker(s.op.Passo)
	defer passo.Stop()
	s.passo()
	for {
		select {
		case <-ctx.Done():
			return
		case tarefa := <-s.fila:
			if s.aoConsumir != nil {
				s.aoConsumir()
			}
			if ctx.Err() != nil {
				return // desligando: o select sorteia entre fila e ctx, e o que sobrou fica
			}
			tarefa()
		case <-passo.C:
			if ctx.Err() != nil {
				return // mesmo sorteio do select: desligando, o passo não roda
			}
			s.passo()
		}
	}
}

func (s *Servidor) passo() {
	if s.aoPassar != nil {
		s.aoPassar()
	}
	if s.demo != nil {
		workspaces, metas, sinais := s.demo.passo()
		s.vincular(workspaces, metas)
		s.aplicar(sinais)
		return
	}
	// O Maestri primeiro, para os moradores já nascerem com nome.
	if s.observador != nil {
		if m, mudou := s.observador.Passo(); mudou {
			s.vincular(m.Workspaces, m.Terminais)
		}
	}
	if s.monitor != nil {
		if sinais, err := s.monitor.Ler(); err == nil {
			s.aplicar(sinais)
		}
	}
	s.mu.Lock()
	for _, id := range s.reg.Varrer(s.op.Vivo) {
		s.publicar(nil, id)
	}
	s.mu.Unlock()
	s.limparPIDs()
}

// aplicarFonte passa os sinais pelo filtro da fonte (claude -p, codex exec...) e aplica.
func (s *Servidor) aplicarFonte(rota string, sinais []mundo.Sinal) {
	switch {
	case rota == "claude" && s.monitor != nil:
		sinais = s.monitor.Filtrar(sinais)
	case rota == "codex" && s.origens != nil:
		sinais = s.origens.Filtrar(sinais, s.reg.SessaoAtual)
	}
	s.aplicar(sinais)
}

func (s *Servidor) aplicar(sinais []mundo.Sinal) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, sn := range sinais {
		s.publicar(s.reg.Aplicar(sn))
	}
}

func (s *Servidor) vincular(workspaces []maestri.Workspace, metas []mundo.MetaTerminal) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if workspaces != nil {
		s.workspaces = workspaces
		s.terminais = metas                             // o leitor manda sempre todos os terminais junto com os workspaces
		s.reg.DefinirPastas(maestri.Pastas(workspaces)) // antes das metas e dos sinais
	}
	for _, meta := range metas {
		if m := s.reg.Vincular(meta); m != nil {
			s.publicar(m, "")
		}
	}
}

// publicar grava a transição no histórico e a transmite. Chamar com s.mu.
func (s *Servidor) publicar(m *mundo.Morador, saiu string) {
	if saiu != "" {
		s.transmitir(msgSaiu{V: 1, Tipo: "saiu", ID: saiu})
		s.respondidoNoTerminal(saiu, "")
		delete(s.perguntas, saiu)
	}
	if m == nil {
		return
	}
	s.respondidoNoTerminal(m.ID, m.Estado)
	if s.atualizarPergunta(m) {
		s.abrirPerguntaMaestri(m)
	}
	if s.op.Historico != nil {
		e := historico.EventoHist{TS: instante(m), MoradorID: m.ID, Estado: m.Estado}
		if m.Atividade != nil {
			e.Ferramenta, e.Alvo = m.Atividade.Ferramenta, m.Atividade.Alvo
		}
		if err := s.op.Historico.Gravar(e); err != nil {
			log.Printf("histórico: não deu para gravar: %v", err)
		}
	}
	s.transmitir(msgMorador{V: 1, Tipo: "morador", Morador: *m})
}

// instante é o ts da transição, com a regra que o jogo aplica ao morador ao vivo
// (linha_do_tempo.gd): no ocupado com ferramenta, o desde dela; senão, o do estado.
// O jogo junta o dia e o ao vivo por ts+estado+ferramenta+alvo; com o time.Now() da
// gravação, a reconciliação de um reinício (desde = statusUpdatedAt) aparecia duas vezes.
func instante(m *mundo.Morador) time.Time {
	if m.Estado == mundo.Ocupado && m.Atividade != nil {
		return m.Atividade.Desde
	}
	return m.Desde
}

// limparPIDs esquece os agentes já mortos (ou com o PID reaproveitado).
func (s *Servidor) limparPIDs() {
	s.muPID.Lock()
	defer s.muPID.Unlock()
	for chave, a := range s.agentes {
		if !s.op.Vivo(a.pid, a.nascimento) {
			delete(s.agentes, chave)
		}
	}
}

// limitar segura o Accept quando já há max conexões abertas.
func limitar(ln net.Listener, max int) net.Listener {
	return &limitado{Listener: ln, vagas: make(chan struct{}, max)}
}

type limitado struct {
	net.Listener
	vagas chan struct{}
}

func (l *limitado) Accept() (net.Conn, error) {
	l.vagas <- struct{}{}
	c, err := l.Listener.Accept()
	if err != nil {
		<-l.vagas
		return nil, err
	}
	return &conexao{Conn: c, liberar: sync.OnceFunc(func() { <-l.vagas })}, nil
}

type conexao struct {
	net.Conn
	liberar func()
}

func (c *conexao) Close() error {
	err := c.Conn.Close()
	c.liberar()
	return err
}
