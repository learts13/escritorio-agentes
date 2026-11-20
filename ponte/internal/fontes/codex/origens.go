package codex

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"firmopolis/ponte/internal/mundo"
)

// OrigensExcluidas são as origens de sessão que não viram morador: "exec" é o codex
// exec (não interativo) e "subagent" cobre os filhos de thread_spawn e as revisões
// automáticas "guardian", que sem filtro virariam centenas de moradores falsos.
var OrigensExcluidas = []string{"exec", "subagent"}

// Origens descobre a origem de cada sessão do Codex no session_meta, a 1ª linha do
// rollout (<dir>/AAAA/MM/DD/rollout-<data>-<id>.jsonl, dir = ~/.codex/sessions).
// O stdin do hook não traz essa informação. Origem achada fica guardada; sem rollout
// (ainda não escrito, ou --ephemeral), a sessão passa e é procurada de novo no próximo hook.
type Origens struct {
	dir string

	mu     sync.Mutex
	origem map[string]string // session_id → cli, vscode, exec, subagent...
}

func NovasOrigens(dir string) *Origens {
	return &Origens{dir: dir, origem: map[string]string{}}
}

// Filtrar tira os sinais de sessões com origem excluída. atual (Registro.SessaoAtual;
// nil = sem essa informação) cobre o rollout que ainda não existe: um codex exec ou
// subagente de origem desconhecida que traz o terminal, quando o terminal já tem
// outra sessão viva do Codex, é descartado; ele volta a ser avaliado no próximo
// hook, quando o rollout já pode dizer a origem. Sem terminal, passa como solto.
func (o *Origens) Filtrar(sinais []mundo.Sinal, atual func(terminalID string) (fonte, sessao string, ok bool)) []mundo.Sinal {
	o.mu.Lock()
	defer o.mu.Unlock()

	var ficam []mundo.Sinal
	for _, s := range sinais {
		origem := o.origemDe(s.SessaoID)
		if slices.Contains(OrigensExcluidas, origem) {
			continue
		}
		if origem == "" && s.TerminalID != "" && atual != nil {
			if fonte, sessao, ok := atual(s.TerminalID); ok && fonte == s.Fonte && sessao != s.SessaoID {
				continue
			}
		}
		ficam = append(ficam, s)
	}
	return ficam
}

func (o *Origens) origemDe(id string) string {
	if origem, ok := o.origem[id]; ok {
		return origem
	}
	origem := lerOrigem(o.dir, id)
	if origem != "" {
		o.origem[id] = origem
	}
	return origem
}

// lerOrigem procura o rollout da sessão na pasta do dia em que ela foi criada (o id
// é um UUIDv7, que traz a hora) e nos vizinhos, por causa do fuso.
func lerOrigem(dir, id string) string {
	if id == "" || strings.Trim(id, "0123456789abcdefABCDEF-") != "" {
		return "" // o id vem do hook: nada de caminho nem curinga
	}
	base, ok := criacao(id)
	if !ok {
		base = time.Now()
	}
	for _, d := range []int{0, -1, 1} {
		dia := base.AddDate(0, 0, d)
		achados, _ := filepath.Glob(filepath.Join(dir, dia.Format("2006"), dia.Format("01"), dia.Format("02"), "rollout-*-"+id+".jsonl"))
		if len(achados) > 0 {
			return origemDoRollout(achados[0])
		}
	}
	return ""
}

// origemDoRollout lê só o 1º valor JSON do arquivo (o session_meta). Rollout ainda
// sendo escrito devolve "", para tentar de novo depois.
func origemDoRollout(arquivo string) string {
	f, err := os.Open(arquivo)
	if err != nil {
		return ""
	}
	defer f.Close()

	var linha struct {
		Type    string `json:"type"`
		Payload struct {
			Source json.RawMessage `json:"source"`
		} `json:"payload"`
	}
	if json.NewDecoder(f).Decode(&linha) != nil || linha.Type != "session_meta" {
		return ""
	}
	var texto string
	if json.Unmarshal(linha.Payload.Source, &texto) == nil {
		return texto
	}
	var objeto map[string]json.RawMessage
	if json.Unmarshal(linha.Payload.Source, &objeto) == nil {
		if _, ok := objeto["subagent"]; ok {
			return "subagent"
		}
		return "outra"
	}
	return ""
}

// criacao lê a hora de criação de um UUIDv7 (os 48 primeiros bits são ms Unix).
func criacao(id string) (time.Time, bool) {
	hex := strings.ReplaceAll(id, "-", "")
	if len(hex) != 32 || hex[12] != '7' {
		return time.Time{}, false
	}
	ms, err := strconv.ParseInt(hex[:12], 16, 64)
	if err != nil {
		return time.Time{}, false
	}
	return time.UnixMilli(ms), true
}
