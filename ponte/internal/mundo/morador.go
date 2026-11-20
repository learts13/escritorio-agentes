// Package mundo é o domínio da ponte: o morador do contrato v1 e o registro que
// transforma os sinais dos normalizadores em moradores.
package mundo

import (
	"encoding/json"
	"time"
)

// Estado é o estado do morador no contrato v1.
type Estado string

const (
	Ocupado            Estado = "ocupado"
	Ocioso             Estado = "ocioso"
	EsperandoPermissao Estado = "esperando_permissao"
	EsperandoResposta  Estado = "esperando_resposta"
	Erro               Estado = "erro"
)

// Provedores do contrato v1. Sinal.Fonte usa estes valores.
const (
	ProvedorClaude       = "claude_code"
	ProvedorCodex        = "codex"
	ProvedorOpenCode     = "open_code"
	ProvedorAgy          = "antigravity_cli"
	ProvedorMiniMax      = "minimax_code"
	ProvedorDesconhecido = "desconhecido"
)

// Opcional é um texto que vai como null no JSON quando vazio (band_id e projeto).
type Opcional string

func (o Opcional) MarshalJSON() ([]byte, error) {
	if o == "" {
		return []byte("null"), nil
	}
	return json.Marshal(string(o))
}

// Atividade é a ferramenta em uso. Alvo já chega curto e mascarado pelo normalizador.
type Atividade struct {
	Ferramenta string    `json:"ferramenta"`
	Alvo       string    `json:"alvo"`
	Desde      time.Time `json:"desde"`
}

// Morador é o que o jogo vê (contrato v1).
type Morador struct {
	ID          string     `json:"id"`
	Nome        string     `json:"nome"`
	Papel       string     `json:"papel"`
	Provedor    string     `json:"provedor"`
	Estado      Estado     `json:"estado"`
	Gerente     bool       `json:"gerente"`
	WorkspaceID string     `json:"workspace_id"`
	BandID      Opcional   `json:"band_id"`
	Solto       bool       `json:"solto"`
	Projeto     Opcional   `json:"projeto"`
	Atividade   *Atividade `json:"atividade"`
	Ajudantes   int        `json:"ajudantes"`
	Desde       time.Time  `json:"desde"`

	projetoCwd string    // projeto do cwd da sessão (pacote projeto); o da meta vale só sem ele
	sessao     string    // chave (fonte:sessão) da sessão que hoje é este morador
	visto      time.Time // TS do sinal mais novo já aplicado a essa sessão
	pid        int       // processo do agente, quando a fonte informa (para a varredura)
	nascimento uint64    // hora em que o pid nasceu (0: desconhecida)
}

// copia devolve um Morador que não compartilha memória com o registro.
func (m *Morador) copia() *Morador {
	c := *m
	if m.Atividade != nil {
		a := *m.Atividade
		c.Atividade = &a
	}
	return &c
}

// Sinal é a saída de todo normalizador de provedor.
//   - Fonte é o provedor do contrato (ProvedorClaude etc.), não o nome da rota do hook.
//   - Cwd é a pasta da sessão; o registro guarda dela só o projeto (projeto.De). Sinal
//     sem Cwd mantém o projeto atual.
//   - Estado vazio mantém o estado atual (um morador novo nasce Ocioso). Com
//     ExcetoOcioso, o Estado não vale para o morador que já está Ocioso: é o diálogo
//     do Claude, que depois do Stop é opcional e, no meio do turno, pede ação.
//   - TS é a hora do fato (zero = agora, a hora do recebimento). Um sinal mais velho
//     que o último aplicado à mesma sessão é ignorado: assim o arquivo de sessão, que
//     atrasa, não desfaz o hook. Regra para os normalizadores: hook vai sempre com TS
//     zero; quem preenche é o servidor, com a hora em que o agente criou o `ponte
//     hook` (X-Ponte-Hora), que põe em ordem os hooks em segundo plano. Fonte com
//     hora própria (sessions/<pid>.json, rollout, evento) só passa TS se for o mesmo
//     relógio da máquina e tiver precisão de milissegundo ou melhor; se truncar em
//     segundos, passa TS zero.
//   - Ajudante marca o início (ou, com Fim, o fim) de um subagente, e só isso: o
//     normalizador emite apenas os eventos de início e fim de subagente, com
//     AjudanteID = id do subagente. O registro conta ids distintos, então início ou
//     fim repetido não altera a contagem.
//   - PID é o processo do agente, quando a fonte informa: o plugin do OpenCode manda
//     no corpo; o `ponte hook` do Claude, do agy, do Codex e do mcode manda o PID do
//     pai dele no header X-Ponte-PID-Hook, e o servidor resolve o agente com
//     processo.Agente antes de responder (o hook ainda está vivo) e copia para o
//     Sinal, com a hora em que ele nasceu (Nascimento, 0 quando desconhecida).
//     Registro.Varrer encerra a sessão quando ele morre ou quando o PID já é de outro
//     processo. O hook do mcode não recebe o MAESTRI_TERMINAL_ID; o servidor o lê do
//     ambiente do agente resolvido (processo.TerminalMaestri) e põe no TerminalID.
//   - Sinal com terminal vindo de outro provedor que não o do terminal (execução filha
//     que herdou o MAESTRI_TERMINAL_ID) é descartado.
//   - Fim sem Ajudante encerra a sessão. Sessão encerrada (ou substituída por outra
//     no mesmo terminal) fica marcada por 1 h e seus eventos atrasados são ignorados;
//     só um sinal com Inicio (a sessão abriu ou foi retomada agora) a traz de volta.
type Sinal struct {
	Fonte, SessaoID, TerminalID string
	Estado                      Estado
	ExcetoOcioso                bool
	Ferramenta, Alvo            string
	Cwd                         string
	Ajudante                    bool
	AjudanteID                  string
	Inicio                      bool
	PID                         int
	Nascimento                  uint64
	Fim                         bool
	TS                          time.Time
}

// MetaTerminal é o terminal do Maestri como o leitor do workspace.json (P4) o entrega.
// Projeto é o da pasta do terminal, do floor ou do workspace, nessa ordem: vale quando
// o cwd da sessão não dá projeto (a pasta do papel na home, por exemplo).
type MetaTerminal struct {
	ID, Nome, Papel, Provedor, WorkspaceID, BandID, Projeto string
	Gerente                                                 bool
}
