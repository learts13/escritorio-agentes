// Package claude normaliza o Claude Code: os hooks (POST /evento/claude) e os
// arquivos ~/.claude/sessions/<pid>.json, que servem de reconciliação.
package claude

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"firmopolis/ponte/internal/fontes/alvo"
	"firmopolis/ponte/internal/mundo"
)

// evento é o subconjunto do stdin dos hooks do Claude Code que a ponte usa.
// O texto de prompt só é lido para reconhecer o <task-notification>; nunca sai daqui.
type evento struct {
	SessionID        string         `json:"session_id"`
	Cwd              string         `json:"cwd"`
	Nome             string         `json:"hook_event_name"`
	Prompt           string         `json:"prompt"`
	ToolName         string         `json:"tool_name"`
	ToolInput        map[string]any `json:"tool_input"`
	NotificationType string         `json:"notification_type"`
	Message          string         `json:"message"`
	BackgroundTasks  []tarefa       `json:"background_tasks"`
	AgentID          string         `json:"agent_id"`
	Reason           string         `json:"reason"`
}

type tarefa struct {
	Type   string `json:"type"`
	Status string `json:"status"`
}

// mensagensDeTexto são as mensagens do agent_needs_input que pedem uma resposta escrita (lidas
// no Claude Code 2.1.329: o diálogo com needs "answer: ..."). As outras ("Teammate setup needs
// your input", "Auto mode has a classifier billing notice to acknowledge", "Auto mode can't
// check actions in this session and needs your choice", "<agente> needs your input...") são
// diálogos de opções ou de outra sessão: sem texto.
var mensagensDeTexto = map[string]bool{"Your cloud session needs an answer before it can start": true}

// cortarMensagem guarda da mensagem só o bastante para distinguir uma espera de outra.
func cortarMensagem(m string) string {
	r := []rune(strings.TrimSpace(m))
	if len(r) > 80 {
		r = r[:80]
	}
	return string(r)
}

// NormalizarHook traduz o stdin de um hook do Claude Code. terminalID é o
// MAESTRI_TERMINAL_ID do header (vazio fora do Maestri). Evento que não interessa
// devolve (nil, nil); corpo inválido ou sem session_id devolve erro.
func NormalizarHook(corpo []byte, terminalID string) ([]mundo.Sinal, error) {
	return NormalizarComo(corpo, terminalID, mundo.ProvedorClaude)
}

// NormalizarComo aplica as regras do Claude a um provedor que usa o mesmo formato de
// hook (o Codex), com fonte no lugar de ProvedorClaude.
func NormalizarComo(corpo []byte, terminalID, fonte string) ([]mundo.Sinal, error) {
	var e evento
	if err := json.Unmarshal(corpo, &e); err != nil {
		return nil, fmt.Errorf("hook do %s: %w", fonte, err)
	}
	if e.SessionID == "" {
		return nil, errors.New("hook do " + fonte + " sem session_id")
	}
	s := mundo.Sinal{Fonte: fonte, SessaoID: e.SessionID, TerminalID: terminalID, Cwd: e.Cwd}

	if e.AgentID != "" {
		// Evento de subagente: o início e o fim contam como ajudante do pai, e um pedido
		// de permissão ou de resposta aparece no terminal do pai, então vira espera dele.
		switch e.Nome {
		case "SubagentStart":
			s.Ajudante, s.AjudanteID = true, e.AgentID
			return []mundo.Sinal{s}, nil
		case "SubagentStop":
			s.Ajudante, s.AjudanteID, s.Fim = true, e.AgentID, true
			return []mundo.Sinal{s}, nil
		case "PermissionRequest":
		case "Notification":
			if e.NotificationType == "idle_prompt" {
				return nil, nil
			}
		default:
			return nil, nil
		}
	}

	switch e.Nome {
	case "SessionStart":
		// Liga a sessão ao morador sem mudar o estado: compact e resume chegam no meio
		// do trabalho. Inicio faz uma sessão retomada (mesmo session_id) voltar a valer.
		s.Inicio = true
	case "UserPromptSubmit":
		if strings.HasPrefix(strings.TrimSpace(e.Prompt), "<task-notification>") {
			return nil, nil // aviso sintético de fim de subagente, não é o usuário
		}
		s.Estado = mundo.Ocupado
	case "PreToolUse":
		s.Estado, s.Ferramenta, s.Alvo = mundo.Ocupado, e.ToolName, alvo.Resumir(e.ToolInput)
	case "PermissionRequest":
		s.Estado = mundo.EsperandoPermissao
	case "Notification":
		switch e.NotificationType {
		case "permission_prompt":
			s.Estado = mundo.EsperandoPermissao
		case "idle_prompt":
			s.Estado = mundo.Ocioso
		case "elicitation_dialog":
			// o formulário de elicitação do MCP: pede uma resposta escrita
			s.Estado, s.Espera, s.AceitaTexto = mundo.EsperandoResposta, "notificacao:"+e.NotificationType, true
		case "agent_needs_input":
			// o mesmo tipo serve a diálogos de opções ("Teammate setup needs your input", os dois
			// avisos do modo auto, em que Enter confirma a opção padrão) e a perguntas escritas: só a
			// mensagem distingue, e só as da lista aceitam texto. A mensagem entra na Espera, para a
			// troca de uma por outra mudar a geração.
			s.Estado, s.Espera = mundo.EsperandoResposta, "notificacao:"+e.NotificationType+":"+cortarMensagem(e.Message)
			s.AceitaTexto = mensagensDeTexto[strings.TrimSpace(e.Message)]
		case "elicitation_url_dialog":
			s.Estado, s.Espera = mundo.EsperandoResposta, "notificacao:"+e.NotificationType
		default:
			return nil, nil
		}
	case "Stop":
		// O Stop dispara com subagente ainda rodando: ocioso só sem subagente rodando
		// (shell em segundo plano não conta como trabalho do agente).
		s.Estado = mundo.Ocioso
		for _, t := range e.BackgroundTasks {
			if t.Type == "subagent" && t.Status == "running" {
				s.Estado = mundo.Ocupado
			}
		}
	case "StopFailure":
		s.Estado = mundo.Erro
	case "SessionEnd":
		if e.Reason == "clear" && terminalID != "" {
			// O terminal segue e o SessionStart da sessão nova assume o morador. Sem
			// terminal, a sessão nova vira outro solto, então a antiga precisa sair.
			return nil, nil
		}
		s.Fim = true
	default:
		// PostToolUse e os demais não mudam o estado. Ignorar o PostToolUse também
		// impede que um atrasado, chegando depois do Stop, reabra o morador.
		return nil, nil
	}
	return []mundo.Sinal{s}, nil
}
