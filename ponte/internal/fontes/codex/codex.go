// Package codex normaliza o Codex CLI: os hooks "command" de ~/.codex/hooks.json, que
// repassam o stdin a POST /evento/codex (`ponte hook codex`, instalado pelo `ponte setup`), e o
// session_meta dos rollouts, que diz de onde veio cada sessão (Origens).
package codex

import (
	"encoding/json"
	"errors"
	"fmt"

	"firmopolis/ponte/internal/fontes/claude"
	"firmopolis/ponte/internal/mundo"
)

// NormalizarCodex traduz o stdin de um hook do Codex. O formato é o do Claude (mesmos
// nomes de evento e campos snake_case), então as regras são as do Claude, mais o
// Interrupt, que o Claude não tem: o turno interrompido acaba e o agente fica ocioso.
// O Codex não tem Notification; a espera vem do PermissionRequest.
func NormalizarCodex(corpo []byte, terminalID string) ([]mundo.Sinal, error) {
	var e struct {
		SessionID string `json:"session_id"`
		Cwd       string `json:"cwd"`
		Nome      string `json:"hook_event_name"`
	}
	if err := json.Unmarshal(corpo, &e); err != nil {
		return nil, fmt.Errorf("hook do codex: %w", err)
	}
	var estado mundo.Estado
	switch e.Nome {
	case "Interrupt":
		estado = mundo.Ocioso
	case "PostToolUse":
		// Sem Notification, é a ferramenta terminando que tira o "esperando permissão".
		// O Codex espera cada hook command terminar (o `ponte hook` só sai depois do POST),
		// então um PostToolUse não chega depois do Stop do mesmo turno, o risco que
		// fez o Claude, com hook http assíncrono, ignorá-lo.
		estado = mundo.Ocupado
	default:
		return claude.NormalizarComo(corpo, terminalID, mundo.ProvedorCodex)
	}
	if e.SessionID == "" {
		return nil, errors.New("hook do codex sem session_id")
	}
	return []mundo.Sinal{{Fonte: mundo.ProvedorCodex, SessaoID: e.SessionID, TerminalID: terminalID, Cwd: e.Cwd, Estado: estado}}, nil
}
