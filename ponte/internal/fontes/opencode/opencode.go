// Package opencode normaliza o OpenCode, a partir do que o plugin global
// (integracoes/modelos/opencode-firmopolis.js) manda para POST /evento/opencode.
package opencode

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"firmopolis/ponte/internal/fontes/alvo"
	"firmopolis/ponte/internal/mundo"
)

// envelope é o corpo do plugin: o evento do OpenCode (type e properties, só os campos
// que a ponte usa), o diretório do processo e, para sessão filha (subagente), o pai.
type envelope struct {
	Type       string `json:"type"`
	Properties struct {
		SessionID string `json:"sessionID"`
		Status    struct {
			Type string `json:"type"`
		} `json:"status"`
		Info struct {
			ID        string `json:"id"`
			ParentID  string `json:"parentID"`
			Directory string `json:"directory"`
		} `json:"info"`
		Error *struct {
			Name string `json:"name"`
		} `json:"error"`
		Tool string         `json:"tool"`
		Args map[string]any `json:"args"`
	} `json:"properties"`
	Cwd string `json:"cwd"`
	Pai string `json:"pai"`
	PID int    `json:"pid"` // process.pid do OpenCode, para a varredura (Registro.Varrer)
}

// NormalizarOpenCode traduz um evento do plugin do OpenCode. Evento que não interessa
// devolve (nil, nil); corpo inválido ou sem sessão devolve erro. Sem TS: os eventos
// do OpenCode não trazem hora, vale a do recebimento.
func NormalizarOpenCode(corpo []byte, terminalID string) ([]mundo.Sinal, error) {
	var e envelope
	if err := json.Unmarshal(corpo, &e); err != nil {
		return nil, fmt.Errorf("evento do opencode: %w", err)
	}
	p := e.Properties
	sessao := p.SessionID
	if sessao == "" {
		sessao = p.Info.ID
	}
	// permission.v2.asked e permission.asked são o mesmo fato em versões diferentes.
	tipo := strings.Replace(e.Type, ".v2.", ".", 1)
	if sessao == "" {
		if tipo == "session.error" {
			return nil, nil // erro global, sem sessão a quem atribuir
		}
		return nil, errors.New("evento do opencode sem sessão")
	}
	cwd := e.Cwd
	if cwd == "" {
		cwd = p.Info.Directory
	}
	s := mundo.Sinal{Fonte: mundo.ProvedorOpenCode, SessaoID: sessao, TerminalID: terminalID, Cwd: cwd, PID: e.PID}

	pai := e.Pai
	if pai == "" {
		pai = p.Info.ParentID
	}
	if pai != "" {
		// Sessão filha é subagente: conta como ajudante do pai, e um pedido de
		// permissão ou de resposta dela aparece no pai.
		s.SessaoID = pai
		switch {
		case tipo == "session.created", tipo == "session.status" && p.Status.Type == "busy":
			s.Ajudante, s.AjudanteID = true, sessao
		case tipo == "session.idle", tipo == "session.deleted", tipo == "session.status" && p.Status.Type == "idle":
			s.Ajudante, s.AjudanteID, s.Fim = true, sessao, true
		case tipo == "permission.asked":
			s.Estado = mundo.EsperandoPermissao
		case tipo == "question.asked":
			s.Estado = mundo.EsperandoResposta
		case tipo == "permission.replied", tipo == "question.replied", tipo == "question.rejected":
			s.Estado = mundo.Ocupado
		default:
			return nil, nil
		}
		return []mundo.Sinal{s}, nil
	}

	switch tipo {
	case "session.created":
		s.Inicio = true
	case "session.deleted":
		s.Fim = true
	case "session.status":
		switch p.Status.Type {
		case "busy", "retry":
			s.Estado = mundo.Ocupado
		case "idle":
			s.Estado = mundo.Ocioso
		default:
			return nil, nil
		}
	case "session.idle":
		s.Estado = mundo.Ocioso
	case "permission.asked":
		s.Estado = mundo.EsperandoPermissao
	case "question.asked":
		s.Estado = mundo.EsperandoResposta
	case "permission.replied", "question.replied", "question.rejected":
		s.Estado = mundo.Ocupado // respondido: o agente segue (se parar, vem session.idle)
	case "session.error":
		if p.Error != nil && p.Error.Name == "MessageAbortedError" {
			return nil, nil // o usuário interrompeu; o session.idle que vem depois resolve
		}
		s.Estado = mundo.Erro
	case "tool.execute.before":
		s.Estado, s.Ferramenta, s.Alvo = mundo.Ocupado, p.Tool, alvo.Resumir(p.Args)
	default:
		return nil, nil
	}
	return []mundo.Sinal{s}, nil
}
