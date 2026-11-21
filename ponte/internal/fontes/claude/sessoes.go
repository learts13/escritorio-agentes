package claude

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"firmopolis/ponte/internal/mundo"
)

// EntrypointsExcluidos lista as sessões que não são interativas e não viram morador
// (spec 6.3.1). "sdk-cli" é o claude -p; o campo kind não serve para isso.
var EntrypointsExcluidos = []string{"sdk-cli"}

// Sessao é o que a ponte lê de ~/.claude/sessions/<pid>.json.
// Atualizado vem de statusUpdatedAt e vira o TS do sinal de reconciliação. Inicio vem
// de procStart, a hora em que o processo nasceu (0 quando falta): com ela, um PID
// reaproveitado por outro processo não passa por vivo.
type Sessao struct {
	SessionID, Status, WaitingFor, Entrypoint, Cwd string
	PID                                            int
	Inicio                                         uint64
	Atualizado                                     time.Time
}

// Vivo diz se o processo é da sessão (pid e inicio): a assinatura do processo.VivoDesde.
type Vivo func(pid int, inicio uint64) bool

func (s Sessao) excluida() bool {
	return slices.Contains(EntrypointsExcluidos, s.Entrypoint)
}

type arquivoSessao struct {
	PID             int    `json:"pid"`
	SessionID       string `json:"sessionId"`
	Cwd             string `json:"cwd"`
	Status          string `json:"status"`
	WaitingFor      string `json:"waitingFor"`
	Entrypoint      string `json:"entrypoint"`
	StatusUpdatedAt int64  `json:"statusUpdatedAt"`
	ProcStart       string `json:"procStart"`
}

// LerSessoes lê os <pid>.json de dir, indexados por session_id. Arquivo parcial
// (o Claude regrava o tempo todo) ou que sumiu no meio da leitura é pulado: a próxima
// leitura pega. Pasta inexistente (Claude não instalado) devolve mapa vazio.
func LerSessoes(dir string) (map[string]Sessao, error) {
	entradas, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return map[string]Sessao{}, nil
	}
	if err != nil {
		return nil, err
	}
	sess := make(map[string]Sessao, len(entradas))
	for _, e := range entradas {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		dados, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var a arquivoSessao
		if json.Unmarshal(dados, &a) != nil || a.SessionID == "" {
			continue
		}
		s := Sessao{SessionID: a.SessionID, Status: a.Status, WaitingFor: a.WaitingFor, Entrypoint: a.Entrypoint, Cwd: a.Cwd, PID: a.PID}
		s.Inicio, _ = strconv.ParseUint(a.ProcStart, 10, 64)
		if a.StatusUpdatedAt > 0 {
			s.Atualizado = time.UnixMilli(a.StatusUpdatedAt)
		}
		sess[s.SessionID] = s
	}
	return sess, nil
}

// Reconciliar transforma a leitura atual (agora) em sinais, sem terminal: o registro
// liga cada uma pelo session_id. O TS é a hora do status no arquivo (ms, mesmo relógio),
// para não desfazer um hook mais novo. Sessões excluídas não geram sinal.
//
// Fim sai em dois casos: o arquivo existe mas o processo morreu (crash, ou o PID já é
// de outro processo), ou a sessão estava na leitura anterior (antes) e sumiu. Como o
// Claude apaga o arquivo ao sair, este é o caso comum; mas só vale se o processo morreu
// ou o PID já mostra outra sessão (/clear), porque um arquivo pulado por estar sendo
// regravado também some de uma leitura.
func Reconciliar(antes, agora map[string]Sessao, vivo Vivo) []mundo.Sinal {
	var sinais []mundo.Sinal
	pids := map[int]bool{}
	for _, id := range ordenadas(agora) {
		x := agora[id]
		pids[x.PID] = true
		if x.excluida() {
			continue
		}
		s := mundo.Sinal{Fonte: mundo.ProvedorClaude, SessaoID: x.SessionID, Cwd: x.Cwd, TS: x.Atualizado}
		if !vivo(x.PID, x.Inicio) {
			s.Fim, s.TS = true, time.Time{}
		} else {
			s.Estado, s.ExcetoOcioso = estadoDoArquivo(x.Status, x.WaitingFor)
			if s.Estado == mundo.EsperandoResposta {
				s.Espera, s.EsperaFraca = esperaDoArquivo(x.WaitingFor)
			}
		}
		sinais = append(sinais, s)
	}
	for _, id := range ordenadas(antes) {
		x := antes[id]
		if _, segue := agora[id]; segue || x.excluida() {
			continue
		}
		if pids[x.PID] || !vivo(x.PID, x.Inicio) {
			sinais = append(sinais, mundo.Sinal{Fonte: mundo.ProvedorClaude, SessaoID: x.SessionID, Fim: true})
		}
	}
	return sinais
}

func ordenadas(sess map[string]Sessao) []string {
	ids := make([]string, 0, len(sess))
	for id := range sess {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}

// esperaDoArquivo é o tipo da espera ("arquivo:<waitingFor>"). O arquivo nunca liga o
// AceitaTexto: o "input needed" vale para toda elicitação, inclusive a de abrir um link (um
// diálogo de opções), e só o hook distingue. Por isso o "input needed" é fraco (fraca=true): com
// o morador já esperando resposta, a espera que o hook pôs fica. Os outros valores ("dialog
// open", "sandbox request", "goal proposal"...) trocam a espera e desligam o AceitaTexto.
func esperaDoArquivo(waitingFor string) (espera string, fraca bool) {
	w := strings.ToLower(strings.TrimSpace(waitingFor))
	return "arquivo:" + w, w == "input needed"
}

// estadoDoArquivo traduz status e waitingFor. Espera que fala de permissão é esperando
// permissão; o resto ("input needed", que também dispara o hook Notification) é
// esperando resposta. "dialog open" cobre dois casos: o diálogo opcional que o Claude
// abre logo depois do Stop (a pesquisa de fim de turno, a oferta de compactar...), que
// ninguém precisa responder, e o que pede ação ("Session paused" depois de uma recusa
// da API, ultraplan, managed settings). Por isso vale exceto para quem já está Ocioso
// (o Stop veio antes). Status desconhecido ou nulo devolve "", que mantém o estado atual.
func estadoDoArquivo(status, waitingFor string) (estado mundo.Estado, excetoOcioso bool) {
	switch status {
	case "idle":
		return mundo.Ocioso, false
	case "busy", "shell":
		return mundo.Ocupado, false
	case "waiting":
		switch w := strings.ToLower(waitingFor); {
		case strings.Contains(w, "permission"):
			return mundo.EsperandoPermissao, false
		case w == "dialog open":
			return mundo.EsperandoResposta, true
		}
		return mundo.EsperandoResposta, false
	}
	return "", false
}

// FiltrarExcluidas tira os sinais de hook cujas sessões são excluídas (o claude -p
// herda o MAESTRI_TERMINAL_ID e tomaria o morador do terminal). Sessão que ainda não
// está em sess passa.
func FiltrarExcluidas(sinais []mundo.Sinal, sess map[string]Sessao) []mundo.Sinal {
	var ficam []mundo.Sinal
	for _, s := range sinais {
		if x, ok := sess[s.SessaoID]; ok && x.excluida() {
			continue
		}
		ficam = append(ficam, s)
	}
	return ficam
}

// Monitor guarda a última leitura de ~/.claude/sessions entre as reconciliações e
// filtra os hooks por ela. É o que o servidor (P5) usa: Ler a cada poucos segundos
// e Filtrar em cada hook do Claude, antes de aplicar no registro.
type Monitor struct {
	dir  string
	vivo Vivo

	mu         sync.Mutex
	ultima     map[string]Sessao
	semArquivo map[string]bool // sessões que seguiram desconhecidas depois de reler a pasta
}

func NovoMonitor(dir string, vivo Vivo) *Monitor {
	return &Monitor{dir: dir, vivo: vivo, ultima: map[string]Sessao{}, semArquivo: map[string]bool{}}
}

// Ler relê a pasta e devolve os sinais de reconciliação contra a leitura anterior.
func (m *Monitor) Ler() ([]mundo.Sinal, error) {
	agora, err := LerSessoes(m.dir)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	sinais := Reconciliar(m.ultima, agora, m.vivo)
	encerradas := map[string]bool{}
	for _, s := range sinais {
		if s.Fim {
			encerradas[s.SessaoID] = true
		}
	}
	// Quem sumiu sem Fim (arquivo pulado, PID vivo) segue lembrado, para o Fim sair
	// quando o processo morrer, mesmo que o arquivo não volte.
	for id, x := range m.ultima {
		if _, segue := agora[id]; !segue && !encerradas[id] && !x.excluida() {
			agora[id] = x
		}
	}
	m.ultima, m.semArquivo = agora, map[string]bool{}
	return sinais, nil
}

// Filtrar tira os sinais de sessões excluídas. O 1º hook de uma sessão nova (um
// claude -p, por exemplo) chega antes da próxima leitura, então session_id
// desconhecido faz reler a pasta (o <pid>.json já existe quando o SessionStart roda);
// se continuar desconhecido, passa, e não se relê de novo por ele até o próximo Ler.
func (m *Monitor) Filtrar(sinais []mundo.Sinal) []mundo.Sinal {
	m.mu.Lock()
	defer m.mu.Unlock()

	var desconhecidas []string
	for _, s := range sinais {
		if _, ok := m.ultima[s.SessaoID]; !ok && !m.semArquivo[s.SessaoID] {
			desconhecidas = append(desconhecidas, s.SessaoID)
		}
	}
	if len(desconhecidas) > 0 {
		if agora, err := LerSessoes(m.dir); err == nil {
			// Só acrescenta: trocar a leitura esconderia do próximo Ler quem sumiu nesse meio-tempo.
			for id, x := range agora {
				if _, ok := m.ultima[id]; !ok {
					m.ultima[id] = x
				}
			}
		}
		for _, id := range desconhecidas {
			if _, ok := m.ultima[id]; !ok {
				m.semArquivo[id] = true
			}
		}
	}
	return FiltrarExcluidas(sinais, m.ultima)
}
