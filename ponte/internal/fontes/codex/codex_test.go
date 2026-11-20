package codex

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"firmopolis/ponte/internal/mundo"
)

func hook(nome, extras string) []byte {
	c := `{"session_id":"sess-codex","cwd":"C:\\proj\\escritorio","hook_event_name":"` + nome + `","model":"gpt","permission_mode":"bypassPermissions"`
	if extras != "" {
		c += "," + extras
	}
	return []byte(c + "}")
}

func um(t *testing.T, c []byte) mundo.Sinal {
	t.Helper()
	sinais, err := NormalizarCodex(c, "T1")
	if err != nil || len(sinais) != 1 {
		t.Fatalf("esperava 1 sinal, veio %+v %v", sinais, err)
	}
	s := sinais[0]
	if s.Fonte != mundo.ProvedorCodex || s.SessaoID != "sess-codex" || s.TerminalID != "T1" || !s.TS.IsZero() {
		t.Fatalf("campos comuns errados: %+v", s)
	}
	return s
}

func TestEventos(t *testing.T) {
	casos := []struct {
		nome, extras string
		estado       mundo.Estado
	}{
		{"UserPromptSubmit", `"prompt":"PROMPT-SECRETO"`, mundo.Ocupado},
		{"PreToolUse", `"tool_name":"Bash","tool_input":{"command":"echo ok"}`, mundo.Ocupado},
		{"PermissionRequest", `"tool_name":"Bash","tool_input":{"command":"rm -rf build"}`, mundo.EsperandoPermissao},
		{"Stop", `"stop_hook_active":false,"last_assistant_message":"PROMPT-SECRETO"`, mundo.Ocioso},
		{"Interrupt", "", mundo.Ocioso},
		// Sem Notification no Codex, o PostToolUse é o que tira o "esperando permissão".
		{"PostToolUse", `"tool_name":"Bash","tool_input":{"command":"rm -rf build"},"tool_response":{"stdout":"PROMPT-SECRETO"}`, mundo.Ocupado},
	}
	for _, c := range casos {
		s := um(t, hook(c.nome, c.extras))
		if s.Estado != c.estado || strings.Contains(s.Alvo, "PROMPT-SECRETO") {
			t.Errorf("%s: veio %+v, esperava %q", c.nome, s, c.estado)
		}
	}
	if s := um(t, hook("PreToolUse", `"tool_name":"Bash","tool_input":{"command":"echo ok"}`)); s.Ferramenta != "Bash" || s.Alvo != "echo ok" {
		t.Errorf("ferramenta errada: %+v", s)
	}
	if s := um(t, hook("SessionStart", `"source":"startup"`)); !s.Inicio {
		t.Errorf("SessionStart: %+v", s)
	}
	if s := um(t, hook("SessionEnd", `"reason":"other"`)); !s.Fim {
		t.Errorf("SessionEnd: %+v", s)
	}
}

func TestReplayDaCaptura(t *testing.T) {
	f, err := os.Open(filepath.Join("testdata", "hooks_exec.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	r := mundo.NovoRegistro(nil)
	var estados []string
	linhas := bufio.NewScanner(f)
	for linhas.Scan() {
		sinais, err := NormalizarCodex(linhas.Bytes(), "T1")
		if err != nil {
			t.Fatal(err)
		}
		for _, s := range sinais {
			m, saiu := r.Aplicar(s)
			if m != nil {
				estados = append(estados, string(m.Estado))
			}
			if saiu != "" {
				estados = append(estados, "saiu:"+saiu)
			}
		}
	}
	if got, want := strings.Join(estados, " "), "ocioso ocupado ocupado ocioso saiu:t1"; got != want {
		t.Fatalf("sequência:\n got %s\nwant %s", got, want)
	}
}

// idDe gera um id UUIDv7 do Codex criado em t.
func idDe(t time.Time, n int) string {
	h := fmt.Sprintf("%012x", t.UnixMilli())
	return fmt.Sprintf("%s-%s-7000-8000-%012d", h[:8], h[8:12], n)
}

func rollout(t *testing.T, dir, id, source string) {
	t.Helper()
	criado, _ := criacao(id)
	pasta := filepath.Join(dir, criado.Format("2006"), criado.Format("01"), criado.Format("02"))
	if err := os.MkdirAll(pasta, 0o700); err != nil {
		t.Fatal(err)
	}
	meta := `{"timestamp":"2026-11-14T20:04:32.000Z","type":"session_meta","payload":{"id":"` + id + `","cwd":"C:\\proj","source":` + source + `,"base_instructions":{"text":"longo"}}}` + "\n" + `{"type":"event_msg"}` + "\n"
	if err := os.WriteFile(filepath.Join(pasta, "rollout-"+criado.Format("2006-01-02T15-04-05")+"-"+id+".jsonl"), []byte(meta), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestOrigensFiltraExecSubagenteEGuardian(t *testing.T) {
	dir := t.TempDir()
	quando := time.Date(2026, 11, 14, 20, 4, 32, 0, time.Local)
	ids := map[string]string{
		"cli":      `"cli"`,
		"vscode":   `"vscode"`,
		"exec":     `"exec"`,
		"guardian": `{"subagent":{"other":"guardian"}}`,
		"filho":    `{"subagent":{"thread_spawn":{"parent_thread_id":"x","depth":1}}}`,
	}
	porNome := map[string]string{}
	i := 0
	for nome, source := range ids {
		i++
		id := idDe(quando, i)
		porNome[nome] = id
		rollout(t, dir, id, source)
	}
	porNome["sem-rollout"] = idDe(quando, 99)

	var sinais []mundo.Sinal
	for _, nome := range []string{"cli", "vscode", "exec", "guardian", "filho", "sem-rollout"} {
		sinais = append(sinais, mundo.Sinal{Fonte: mundo.ProvedorCodex, SessaoID: porNome[nome], TerminalID: "T1", Inicio: true})
	}
	o := NovasOrigens(dir)
	var ficaram []string
	for _, s := range o.Filtrar(sinais, nil) {
		for nome, id := range porNome {
			if id == s.SessaoID {
				ficaram = append(ficaram, nome)
			}
		}
	}
	if got := strings.Join(ficaram, ","); got != "cli,vscode,sem-rollout" {
		t.Fatalf("filtro errado: %s", got)
	}

	// O rollout pode nascer depois do 1º hook: quem não tinha origem é procurado de novo.
	rollout(t, dir, porNome["sem-rollout"], `"exec"`)
	if ficou := o.Filtrar(sinais[5:], nil); len(ficou) != 0 {
		t.Fatalf("a sessão exec achada depois deveria ser filtrada: %+v", ficou)
	}
}

func TestOrigensRolloutParcialPassa(t *testing.T) {
	dir := t.TempDir()
	id := idDe(time.Date(2026, 11, 14, 23, 59, 0, 0, time.Local), 1)
	criado, _ := criacao(id)
	pasta := filepath.Join(dir, criado.Format("2006/01/02"))
	os.MkdirAll(pasta, 0o700)
	os.WriteFile(filepath.Join(pasta, "rollout-x-"+id+".jsonl"), []byte(`{"type":"session_meta","payload":{"sou`), 0o600)

	s := []mundo.Sinal{{Fonte: mundo.ProvedorCodex, SessaoID: id, Estado: mundo.Ocupado}}
	if ficou := NovasOrigens(dir).Filtrar(s, nil); len(ficou) != 1 {
		t.Fatalf("rollout ainda sendo escrito não filtra: %+v", ficou)
	}
}

func TestOrigemDesconhecidaNaoTomaTerminalOcupado(t *testing.T) {
	// codex exec de um delegate, dentro de um terminal Codex, antes de o rollout
	// existir: a origem é desconhecida e o terminal já tem outra sessão viva do Codex.
	o := NovasOrigens(t.TempDir())
	s := []mundo.Sinal{{Fonte: mundo.ProvedorCodex, SessaoID: "x-exec", TerminalID: "T1", Inicio: true}}
	atual := func(sessao, fonte string, ok bool) func(string) (string, string, bool) {
		return func(terminal string) (string, string, bool) {
			if terminal != "T1" {
				t.Fatalf("consultou o terminal errado: %q", terminal)
			}
			return fonte, sessao, ok
		}
	}
	if ficou := o.Filtrar(s, atual("x-interativa", mundo.ProvedorCodex, true)); len(ficou) != 0 {
		t.Fatalf("não pode tomar o terminal de outra sessão Codex viva: %+v", ficou)
	}
	for _, caso := range []func(string) (string, string, bool){
		atual("", "", false),                          // terminal livre: é a sessão dele
		atual("x-exec", mundo.ProvedorCodex, true),    // já é a sessão do terminal
		atual("s-claude", mundo.ProvedorClaude, true), // outro provedor: o registro decide
	} {
		if ficou := o.Filtrar(s, caso); len(ficou) != 1 {
			t.Errorf("deveria passar: %+v", ficou)
		}
	}
	solto := []mundo.Sinal{{Fonte: mundo.ProvedorCodex, SessaoID: "x-exec", Inicio: true}}
	if ficou := o.Filtrar(solto, atual("x-interativa", mundo.ProvedorCodex, true)); len(ficou) != 1 {
		t.Errorf("sem terminal, a origem desconhecida passa como solto: %+v", ficou)
	}
}
