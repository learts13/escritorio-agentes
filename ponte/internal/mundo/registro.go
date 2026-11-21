package mundo

import (
	"sort"
	"strings"
	"sync"
	"time"

	"firmopolis/ponte/internal/projeto"
)

// validadeEncerrada é quanto tempo uma sessão encerrada fica marcada para que os
// eventos atrasados dela sejam ignorados.
const validadeEncerrada = time.Hour

// Registro guarda os moradores vivos. Seguro para uso concorrente.
//
// Um terminal do Maestri é um morador só, qualquer que seja a sessão que roda nele
// agora; uma sessão sem terminal é um morador solto, com id "<fonte>:<sessão>".
type Registro struct {
	mu         sync.Mutex
	relogio    func() time.Time
	sessoes    map[string]string    // fonte:sessão → id do morador
	encerradas map[string]time.Time // fonte:sessão encerrada ou substituída → quando
	moradores  map[string]*Morador
	ajudantes  map[string]map[string]bool // id do morador → agent_ids dos ajudantes vivos
	metas      map[string]MetaTerminal    // id do terminal (minúsculo) → meta
	pastas     map[string]string          // pasta do workspace (projeto.Chave) → projeto dele
	projetoDe  func(cwd string) string    // projeto.Padrao().De; os testes trocam
}

// NovoRegistro cria um registro vazio. relogio dá a hora dos sinais sem TS (nil usa time.Now).
func NovoRegistro(relogio func() time.Time) *Registro {
	if relogio == nil {
		relogio = time.Now
	}
	return &Registro{
		relogio:    relogio,
		sessoes:    map[string]string{},
		encerradas: map[string]time.Time{},
		moradores:  map[string]*Morador{},
		ajudantes:  map[string]map[string]bool{},
		metas:      map[string]MetaTerminal{},
		pastas:     map[string]string{},
		projetoDe:  projeto.Padrao().De,
	}
}

// Aplicar incorpora um sinal. Devolve uma cópia do morador quando algo visível mudou
// e/ou o id de quem saiu do mundo. Sinal repetido ou sem efeito devolve (nil, "").
func (r *Registro) Aplicar(s Sinal) (mudou *Morador, saiu string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if s.Fonte == "" {
		s.Fonte = ProvedorDesconhecido
	}
	if s.TS.IsZero() {
		s.TS = r.relogio()
	}
	chave := s.Fonte + ":" + s.SessaoID
	id := r.idDe(s.TerminalID, chave)
	m := r.moradores[id]
	if s.TerminalID != "" && r.execucaoFilha(id, m, chave, s.Fonte) {
		return nil, ""
	}
	if s.Inicio {
		delete(r.encerradas, chave) // aberta ou retomada agora: volta a valer
	} else if _, encerrada := r.encerradas[chave]; encerrada {
		return nil, "" // evento atrasado de sessão que já acabou ou foi substituída
	}

	switch {
	case s.Ajudante:
		// Subagente não vira morador: conta no pai, e só na sessão atual dele.
		if m == nil || m.sessao != chave {
			return nil, ""
		}
		ids := r.ajudantes[id]
		// Só mexe quando o sinal contradiz o que já se sabe (início de id novo, fim de id vivo).
		if s.Fim == ids[s.AjudanteID] {
			if s.Fim {
				delete(ids, s.AjudanteID)
			} else {
				if ids == nil {
					ids = map[string]bool{}
					r.ajudantes[id] = ids
				}
				ids[s.AjudanteID] = true
			}
		}
		if m.Ajudantes == len(ids) {
			return nil, ""
		}
		m.Ajudantes = len(ids)
		return m.copia(), ""

	case s.Fim:
		r.encerrar(chave, s.TS)
		if m == nil || m.sessao != chave {
			return nil, ""
		}
		r.remover(id)
		return nil, id
	}

	if m != nil && m.sessao == chave && s.TS.Before(m.visto) {
		return nil, ""
	}

	base := m
	var herdados map[string]bool
	atrasado := false // sinal mais velho que o estado herdado: só vale a identidade
	if antigo, ok := r.sessoes[chave]; ok && antigo != id {
		// A sessão era um morador solto (visto antes do hook dizer o terminal): ele
		// sai do mundo e o terminal assume a sessão, com o estado e os ajudantes dela.
		if a := r.moradores[antigo]; a != nil {
			c := *a
			c.ID = id
			base = &c
			atrasado = s.TS.Before(a.visto)
		}
		herdados = r.ajudantes[antigo]
		r.remover(antigo)
		saiu = antigo
	}
	if m != nil && m.sessao != chave {
		// Sessão nova no mesmo terminal substitui a antiga, sem herdar os ajudantes dela.
		delete(r.sessoes, m.sessao)
		r.encerrar(m.sessao, s.TS)
		delete(r.ajudantes, id)
	}

	var novo Morador
	if base != nil {
		novo = *base
	} else {
		novo = Morador{ID: id, Estado: Ocioso, Desde: s.TS}
	}
	if novo.sessao != chave {
		novo.sessao = chave
		novo.Ajudantes = 0
		novo.pid, novo.nascimento = 0, 0
	}
	if s.PID > 0 {
		novo.pid, novo.nascimento = s.PID, s.Nascimento
	}
	r.sessoes[chave] = id
	if herdados != nil {
		r.ajudantes[id] = herdados
		novo.Ajudantes = len(herdados)
	}

	novo.Provedor = s.Fonte
	novo.Solto = id == chave
	if s.Cwd != "" {
		novo.projetoCwd = r.projetoDoCwd(s.Cwd, novo.Solto)
	}
	switch meta, ok := r.metas[id]; {
	case ok:
		aplicarMeta(&novo, meta)
	case novo.Solto:
		novo.Projeto = Opcional(novo.projetoCwd)
		novo.Nome = novo.projetoCwd
		if novo.Nome == "" {
			novo.Nome = novo.Provedor
		}
	default:
		novo.Projeto = Opcional(novo.projetoCwd)
		novo.Nome = "" // terminal ainda sem meta: o Vincular preenche
	}

	if !atrasado {
		if s.EsperaFraca && s.Estado == novo.Estado {
			s.Espera, s.AceitaTexto = novo.Espera, novo.AceitaTexto // mesmo estado: fica a espera de quem sabe (o hook)
		}
		if s.Estado != "" && (s.Estado != novo.Estado || s.Espera != novo.Espera) && !(s.ExcetoOcioso && novo.Estado == Ocioso) {
			if s.Estado != novo.Estado {
				novo.Desde = s.TS
			}
			novo.Estado, novo.Espera = s.Estado, s.Espera
			novo.Geracao++
		}
		if s.Estado != "" && novo.Estado == s.Estado && novo.Espera == s.Espera {
			novo.AceitaTexto = s.AceitaTexto && s.Estado == EsperandoResposta
		}
		switch {
		case s.Ferramenta != "":
			if a := novo.Atividade; a == nil || a.Ferramenta != s.Ferramenta || a.Alvo != s.Alvo {
				novo.Atividade = &Atividade{Ferramenta: s.Ferramenta, Alvo: s.Alvo, Desde: s.TS}
			}
		case novo.Estado == Ocioso:
			novo.Atividade = nil
		}
	}

	// O diálogo (ExcetoOcioso) não avança o visto: lido do arquivo antes de o Stop sair
	// da fila, ele faria o Stop, mais velho, ser ignorado. Se for pausa de verdade, a
	// próxima leitura do arquivo o aplica de novo.
	if s.TS.After(novo.visto) && !s.ExcetoOcioso {
		novo.visto = s.TS
	}
	// Os campos só são reatribuídos quando mudam, então a comparação direta basta
	// (visto, pid e nascimento não contam como mudança visível).
	if m != nil {
		igual := *m
		igual.visto, igual.pid, igual.nascimento, igual.projetoCwd = novo.visto, novo.pid, novo.nascimento, novo.projetoCwd
		if igual == novo {
			m.visto, m.pid, m.nascimento, m.projetoCwd = novo.visto, novo.pid, novo.nascimento, novo.projetoCwd
			return nil, saiu
		}
	}
	r.moradores[id] = &novo
	return novo.copia(), saiu
}

// Vincular registra (ou atualiza) os dados de um terminal do Maestri. Se o morador
// desse terminal já existe e mudou, devolve a cópia dele, para quem chama reenviar
// ao jogo; senão devolve nil.
func (r *Registro) Vincular(meta MetaTerminal) *Morador {
	r.mu.Lock()
	defer r.mu.Unlock()

	id := strings.ToLower(meta.ID)
	meta.ID = id
	r.metas[id] = meta
	m := r.moradores[id]
	if m == nil {
		return nil
	}
	antes := *m
	aplicarMeta(m, meta)
	if *m == antes {
		return nil
	}
	return m.copia()
}

// DefinirPastas troca o mapa pasta do workspace → projeto (maestri.Pastas). Vale a
// partir do próximo sinal de cada solto (a reconciliação do Claude passa a cada passo).
func (r *Registro) DefinirPastas(pastas map[string]string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.pastas = pastas
}

// Snapshot devolve cópias de todos os moradores, ordenadas por id.
func (r *Registro) Snapshot() []Morador {
	r.mu.Lock()
	defer r.mu.Unlock()

	lista := make([]Morador, 0, len(r.moradores))
	for _, m := range r.moradores {
		lista = append(lista, *m.copia())
	}
	sort.Slice(lista, func(i, j int) bool { return lista[i].ID < lista[j].ID })
	return lista
}

// idDe escolhe o morador do sinal: o terminal, se veio; senão o morador a que a
// sessão já foi ligada; senão a própria sessão, como solto.
func (r *Registro) idDe(terminalID, chave string) string {
	if terminalID != "" {
		return strings.ToLower(terminalID)
	}
	if id, ok := r.sessoes[chave]; ok {
		return id
	}
	return chave
}

// IDDe diz qual morador é (ou vai ser) a sessão da fonte: a regra do idDe, para o pedido
// de permissão aparecer no morador certo.
func (r *Registro) IDDe(terminalID, fonte, sessao string) string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.idDe(terminalID, fonte+":"+sessao)
}

// encerrar marca a sessão e poda as marcas vencidas.
func (r *Registro) encerrar(chave string, quando time.Time) {
	for c, t := range r.encerradas {
		if quando.Sub(t) > validadeEncerrada {
			delete(r.encerradas, c)
		}
	}
	r.encerradas[chave] = quando
}

// remover tira o morador e o que aponta para ele (as marcas de encerrada ficam).
func (r *Registro) remover(id string) {
	if m := r.moradores[id]; m != nil {
		delete(r.sessoes, m.sessao)
	}
	delete(r.moradores, id)
	delete(r.ajudantes, id)
}

func aplicarMeta(m *Morador, meta MetaTerminal) {
	m.Nome = meta.Nome
	m.Projeto = Opcional(m.projetoCwd)
	if m.Projeto == "" {
		m.Projeto = Opcional(meta.Projeto)
	}
	m.Papel = meta.Papel
	m.WorkspaceID = meta.WorkspaceID
	m.BandID = Opcional(meta.BandID)
	m.Gerente = meta.Gerente
	if m.Provedor == ProvedorDesconhecido && meta.Provedor != "" {
		m.Provedor = meta.Provedor
	}
}

// projetoDoCwd é o projeto do cwd. O solto cujo cwd é o papel do Maestri numa pasta
// genérica (<home>/.maestri/roles/<papel>) leva o projeto do workspace dessa pasta; o
// terminal, nesse caso, fica com o da meta (aplicarMeta).
func (r *Registro) projetoDoCwd(cwd string, solto bool) string {
	if p := r.projetoDe(cwd); p != "" || !solto {
		return p
	}
	if pasta, ok := projeto.PastaDoPapel(cwd); ok {
		return r.pastas[projeto.Chave(pasta)]
	}
	return ""
}

// Varrer encerra os moradores cuja sessão informou um PID que já morreu (ou que já é
// de outro processo: vivo recebe a hora em que ele nasceu): o agy e o OpenCode não
// avisam quando o processo sai. Devolve os ids que saíram, em ordem. O servidor (P5)
// chama periodicamente, com o mesmo vivo da reconciliação.
func (r *Registro) Varrer(vivo func(pid int, nascimento uint64) bool) []string {
	r.mu.Lock()
	defer r.mu.Unlock()

	var saidas []string
	for id, m := range r.moradores {
		if m.pid > 0 && !vivo(m.pid, m.nascimento) {
			r.encerrar(m.sessao, r.relogio())
			r.remover(id)
			saidas = append(saidas, id)
		}
	}
	sort.Strings(saidas)
	return saidas
}

// SessaoAtual diz qual sessão (fonte e id) é hoje o morador do terminal.
func (r *Registro) SessaoAtual(terminalID string) (fonte, sessao string, ok bool) {
	r.mu.Lock()
	defer r.mu.Unlock()

	m := r.moradores[strings.ToLower(terminalID)]
	if m == nil || m.Solto {
		return "", "", false
	}
	fonte, sessao, _ = strings.Cut(m.sessao, ":")
	return fonte, sessao, true
}

// execucaoFilha diz se o sinal, que traz o terminal, é de outro provedor rodando
// dentro dele (agy -p chamado por um MCP, codex exec de um delegate): esses herdam o
// MAESTRI_TERMINAL_ID, mas não são o agente do terminal. Com meta, vale o provedor
// do Maestri; sem meta (ou shell genérico), não se substitui a sessão viva de outra fonte.
func (r *Registro) execucaoFilha(id string, m *Morador, chave, fonte string) bool {
	if meta, ok := r.metas[id]; ok && meta.Provedor != "" && meta.Provedor != ProvedorDesconhecido {
		return meta.Provedor != fonte
	}
	return m != nil && m.sessao != chave && m.Provedor != fonte
}
