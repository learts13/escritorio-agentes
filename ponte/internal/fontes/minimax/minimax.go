// Package minimax normaliza o MiniMax Code (mcode): os hooks do plugin local
// firmopolis, que repassam o stdin a POST /evento/mcode (`ponte hook mcode`,
// instalado pelo `ponte setup`).
package minimax

import (
	"encoding/json"
	"errors"
	"fmt"

	"firmopolis/ponte/internal/fontes/alvo"
	"firmopolis/ponte/internal/fontes/claude"
	"firmopolis/ponte/internal/mundo"
)

// NormalizarMiniMax traduz o stdin de um hook do mcode. O formato é o do Claude
// (mesmos nomes de evento e campos snake_case; as ferramentas vêm em minúsculas:
// bash, read, edit...), então as regras são as do Claude, mais o PostToolUse. O mcode
// não tem Notification: a espera vem do PermissionRequest, e é a ferramenta
// terminando que a tira. O plugin não assina o PreToolUse (cada hook síncrono custa
// uns 330 ms), então a atividade vem do PostToolUse. O hook do mcode é síncrono (o
// `ponte hook` só sai depois do POST), então um PostToolUse não chega depois do Stop
// do mesmo turno.
//
// Evento de subagente (com agent_id): o SubagentStart e o SubagentStop vêm com o
// session_id do pai e seguem as regras do Claude. Os demais vêm com o session_id do
// próprio subagente, que não é morador; são ignorados, inclusive o PermissionRequest
// (no Claude, ele vira espera do pai, mas aqui não há como achar o pai).
func NormalizarMiniMax(corpo []byte, terminalID string) ([]mundo.Sinal, error) {
	var e struct {
		SessionID string         `json:"session_id"`
		Cwd       string         `json:"cwd"`
		Nome      string         `json:"hook_event_name"`
		ToolName  string         `json:"tool_name"`
		ToolInput map[string]any `json:"tool_input"`
		AgentID   string         `json:"agent_id"`
	}
	if err := json.Unmarshal(corpo, &e); err != nil {
		return nil, fmt.Errorf("hook do mcode: %w", err)
	}
	if e.SessionID == "" {
		return nil, errors.New("hook do mcode sem session_id")
	}
	switch {
	case e.AgentID != "" && e.Nome != "SubagentStart" && e.Nome != "SubagentStop":
		return nil, nil
	case e.Nome != "PostToolUse":
		return claude.NormalizarComo(corpo, terminalID, mundo.ProvedorMiniMax)
	}
	// Sem ferramenta, o sinal só tira a espera: a atividade de antes fica.
	s := mundo.Sinal{Fonte: mundo.ProvedorMiniMax, SessaoID: e.SessionID, TerminalID: terminalID, Cwd: e.Cwd, Estado: mundo.Ocupado}
	if e.ToolName != "" {
		s.Ferramenta, s.Alvo = e.ToolName, alvo.Resumir(e.ToolInput)
	}
	return []mundo.Sinal{s}, nil
}
