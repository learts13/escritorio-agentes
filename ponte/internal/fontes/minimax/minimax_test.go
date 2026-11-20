package minimax

import (
	"bufio"
	"os"
	"testing"

	"firmopolis/ponte/internal/mundo"
)

const sessao = "mvs_2bca3a4fb6ce475ea4eb7e6d82b24d05"

// Os payloads reais do mcode 0.7.7 (mcode exec com o plugin local; o prompt foi
// barrado com exit 2): SessionStart e UserPromptSubmit.
func TestPayloadsReais(t *testing.T) {
	f, err := os.Open("testdata/hooks_exec.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var sinais []mundo.Sinal
	for sc := bufio.NewScanner(f); sc.Scan(); {
		s, err := NormalizarMiniMax(sc.Bytes(), "T1")
		if err != nil {
			t.Fatal(err)
		}
		sinais = append(sinais, s...)
	}
	if len(sinais) != 2 {
		t.Fatalf("esperava 2 sinais, veio %+v", sinais)
	}
	for _, s := range sinais {
		if s.Fonte != mundo.ProvedorMiniMax || s.SessaoID != sessao || s.TerminalID != "T1" || s.Cwd != `C:\GODOT\.maestri\floors\escritoriovivo--fase1-ponte` {
			t.Fatalf("sinal sem a sessão, o terminal ou o cwd: %+v", s)
		}
	}
	if !sinais[0].Inicio || sinais[0].Estado != "" {
		t.Errorf("SessionStart liga a sessão sem mudar o estado: %+v", sinais[0])
	}
	if sinais[1].Estado != mundo.Ocupado {
		t.Errorf("UserPromptSubmit é ocupado: %+v", sinais[1])
	}
}

// Os demais eventos seguem o formato do Claude (recon do mcode 0.7.7 e o código dele);
// as ferramentas vêm em minúsculas e vão como estão. Sem o PreToolUse no plugin, a
// atividade vem do PostToolUse.
func TestEventosDoTurno(t *testing.T) {
	casos := []struct {
		nome, corpo string
		quero       mundo.Sinal
	}{
		{"PermissionRequest", `{"hook_event_name":"PermissionRequest","session_id":"` + sessao + `","tool_name":"bash"}`,
			mundo.Sinal{Estado: mundo.EsperandoPermissao}},
		{"PostToolUse tira a espera e dá a atividade", `{"hook_event_name":"PostToolUse","session_id":"` + sessao + `","tool_name":"bash","tool_input":{"command":"go test ./...\nfim"},"tool_response":{},"tool_use_id":"t1"}`,
			mundo.Sinal{Estado: mundo.Ocupado, Ferramenta: "bash", Alvo: "go test ./..."}},
		{"PostToolUse sem ferramenta não mexe na atividade", `{"hook_event_name":"PostToolUse","session_id":"` + sessao + `"}`,
			mundo.Sinal{Estado: mundo.Ocupado}},
		{"SubagentStart", `{"hook_event_name":"SubagentStart","session_id":"` + sessao + `","agent_id":"ag1","agent_type":"explore"}`,
			mundo.Sinal{Ajudante: true, AjudanteID: "ag1"}},
		{"SubagentStop", `{"hook_event_name":"SubagentStop","session_id":"` + sessao + `","agent_id":"ag1","agent_type":"explore","stop_hook_active":false,"last_assistant_message":"ok"}`,
			mundo.Sinal{Ajudante: true, AjudanteID: "ag1", Fim: true}},
		{"Stop", `{"hook_event_name":"Stop","session_id":"` + sessao + `"}`,
			mundo.Sinal{Estado: mundo.Ocioso}},
		{"SessionEnd", `{"hook_event_name":"SessionEnd","session_id":"` + sessao + `","reason":"other"}`,
			mundo.Sinal{Fim: true}},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			s, err := NormalizarMiniMax([]byte(c.corpo), "")
			if err != nil || len(s) != 1 {
				t.Fatalf("esperava 1 sinal: %+v, %v", s, err)
			}
			c.quero.Fonte, c.quero.SessaoID = mundo.ProvedorMiniMax, sessao
			if s[0] != c.quero {
				t.Fatalf("veio %+v, quero %+v", s[0], c.quero)
			}
		})
	}
}

// Os eventos de dentro do subagente vêm com o session_id dele (só o SubagentStart e o
// SubagentStop trazem o do pai): não tiram a espera do pai nem viram morador.
func TestEventosDoSubagenteSaoIgnorados(t *testing.T) {
	for _, ev := range []string{"PostToolUse", "PermissionRequest", "PreToolUse", "UserPromptSubmit", "Stop"} {
		corpo := `{"hook_event_name":"` + ev + `","session_id":"mvs_filho","agent_id":"ag1","agent_type":"explore","tool_name":"bash"}`
		if s, err := NormalizarMiniMax([]byte(corpo), "T1"); err != nil || s != nil {
			t.Errorf("%s do subagente: %+v, %v", ev, s, err)
		}
	}
}

func TestCorposRuins(t *testing.T) {
	for _, corpo := range []string{`{`, `{"hook_event_name":"PostToolUse"}`, `{"hook_event_name":"Stop"}`, `{"hook_event_name":"PostToolUse","agent_id":"ag1"}`} {
		if _, err := NormalizarMiniMax([]byte(corpo), ""); err == nil {
			t.Errorf("%s deveria dar erro", corpo)
		}
	}
	// O /clear num terminal não encerra o morador: a sessão nova assume.
	if s, err := NormalizarMiniMax([]byte(`{"hook_event_name":"SessionEnd","session_id":"x","reason":"clear"}`), "T1"); err != nil || s != nil {
		t.Errorf("SessionEnd do /clear com terminal: %+v, %v", s, err)
	}
}
