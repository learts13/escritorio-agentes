// Package agy normaliza o Antigravity CLI: os hooks "command" de hooks.json, que
// repassam o stdin a POST /evento/agy (`ponte hook agy`, instalado pelo `ponte setup`).
package agy

import (
	"encoding/json"
	"errors"
	"fmt"

	"firmopolis/ponte/internal/mundo"
)

// evento é o subconjunto do stdin dos hooks do agy que a ponte usa (camelCase).
// O lastUserInput (o prompt) não é lido.
type evento struct {
	ConversationID     string `json:"conversationId"`
	Cwd                string `json:"cwd"`
	Nome               string `json:"hookEventName"`
	FullyIdle          bool   `json:"fullyIdle"`
	ContinuationActive bool   `json:"continuationActive"`
	Error              string `json:"error"`
}

// NormalizarAgy traduz o stdin de um hook do agy; o conversationId é a sessão.
// O agy não tem evento de permissão nem de fim de sessão (spec 6.2), e o PreToolUse
// ainda não foi visto em execução: ele só marca Ocupado, sem ferramenta.
func NormalizarAgy(corpo []byte, terminalID string) ([]mundo.Sinal, error) {
	var e evento
	if err := json.Unmarshal(corpo, &e); err != nil {
		return nil, fmt.Errorf("hook do agy: %w", err)
	}
	if e.ConversationID == "" {
		return nil, errors.New("hook do agy sem conversationId")
	}
	s := mundo.Sinal{Fonte: mundo.ProvedorAgy, SessaoID: e.ConversationID, TerminalID: terminalID, Cwd: e.Cwd}

	switch e.Nome {
	case "SessionStart":
		s.Inicio = true
	case "PreInvocation", "PreToolUse":
		s.Estado = mundo.Ocupado
	case "Stop":
		// Ocioso só quando o agy diz que parou de vez: com continuação ativa ou sem
		// fullyIdle, ele ainda vai trabalhar.
		switch {
		case e.Error != "":
			s.Estado = mundo.Erro
		case e.FullyIdle && !e.ContinuationActive:
			s.Estado = mundo.Ocioso
		default:
			s.Estado = mundo.Ocupado
		}
	default:
		return nil, nil
	}
	return []mundo.Sinal{s}, nil
}
