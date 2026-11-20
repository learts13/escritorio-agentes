package integracoes

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
)

// eventosClaude são os eventos que o normalizador do Claude usa (fontes/claude).
var eventosClaude = []string{
	"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest",
	"Notification", "Stop", "StopFailure", "SubagentStart", "SubagentStop", "SessionEnd",
}

// reURLClaude reconhece o hook http das versões anteriores, para o setup trocar ou tirar.
var reURLClaude = regexp.MustCompile(`^http://127\.0\.0\.1:\d+/evento/claude$`)

// reExe reconhece o caminho do ponte.exe, em qualquer pasta.
var reExe = regexp.MustCompile(`(?:^|[\\/])ponte(?:\.exe)?$`)

var claude = integracao{
	nome: "Claude Code",
	arquivo: func(op Opcoes) string {
		return filepath.Join(op.Home, ".claude", "settings.json")
	},
	instalado: func(op Opcoes) bool { return existe(filepath.Join(op.Home, ".claude")) },
	instalar: func(op Opcoes, doc []byte, _ *registro) ([]byte, string, []string, error) {
		novo, _, err := instalarGrupos(doc, eventosClaude, grupoClaude(op), grupoClaudeNosso)
		if err != nil {
			return nil, "", nil, err
		}
		resumo := fmt.Sprintf("hook command em segundo plano `\"%s\" %s` em %d eventos (%s)",
			op.Exe, strings.Join(argsClaude(op), " "), len(eventosClaude), strings.Join(eventosClaude, ", "))
		return novo, resumo, bloqueiosClaude(op, novo), nil
	},
	tirar: func(_ Opcoes, doc []byte, _ *registro) ([]byte, []string, error) {
		novo, _, err := tirarGrupos(doc, grupoClaudeNosso)
		return novo, nil, err
	},
	temNosso: func(_ Opcoes, doc []byte) bool { return temGrupo(doc, grupoClaudeNosso) },
}

func argsClaude(op Opcoes) []string {
	return []string{"hook", "--porta", strconv.Itoa(op.Porta), "claude"}
}

// grupoClaude é o `ponte hook claude` em exec form (args: sem shell no meio) e async:
// o Claude dispara e segue, sem esperar o spawn (70 a 200 ms no Windows) nem a
// ponte. O hook sai sempre com 0 e calado, então nada aparece na sessão com a ponte
// desligada, travada ou lenta. Fora de ordem, os eventos se acertam pela hora que o
// hook manda (X-Ponte-Hora). O MAESTRI_TERMINAL_ID vem do ambiente, herdado.
func grupoClaude(op Opcoes) objeto {
	return objeto{
		{"matcher", ""},
		{"hooks", []any{objeto{
			{"type", "command"},
			{"command", op.Exe},
			{"args", argsClaude(op)},
			{"async", true},
			{"timeout", timeoutHook},
		}}},
	}
}

// grupoClaudeNosso reconhece o hook atual e o http das versões anteriores.
func grupoClaudeNosso(v any) bool {
	return grupoCom(v, func(h map[string]any) bool {
		switch h["type"] {
		case "http":
			url, _ := h["url"].(string)
			return reURLClaude.MatchString(url)
		case "command":
			cmd, _ := h["command"].(string)
			args, _ := h["args"].([]any)
			return reExe.MatchString(cmd) && len(args) > 0 && args[0] == "hook" && args[len(args)-1] == "claude"
		}
		return false
	})
}

// politicaClaude são as chaves que podem barrar o nosso hook.
type politicaClaude struct {
	SemHooks      bool `json:"disableAllHooks"`
	SoGerenciados bool `json:"allowManagedHooksOnly"`
}

// DirGerenciadoClaude é a pasta das configs gerenciadas (managed-settings.json e
// managed-settings.d) do Claude Code em cada sistema.
func DirGerenciadoClaude() string {
	switch runtime.GOOS {
	case "windows":
		base := os.Getenv("ProgramFiles")
		if base == "" {
			base = `C:\Program Files`
		}
		return filepath.Join(base, "ClaudeCode")
	case "darwin":
		return "/Library/Application Support/ClaudeCode"
	default:
		return "/etc/claude-code"
	}
}

// bloqueiosClaude avisa quando a config global (o próprio settings.json) ou a
// gerenciada impede o hook: hooks desligados ou só os gerenciados. A política por
// registro do Windows ou MDM não é lida.
func bloqueiosClaude(op Opcoes, global []byte) []string {
	fontes := map[string][]byte{"settings.json": global}
	if op.Gerenciado != "" {
		arquivos := []string{filepath.Join(op.Gerenciado, "managed-settings.json")}
		extras, _ := filepath.Glob(filepath.Join(op.Gerenciado, "managed-settings.d", "*.json"))
		sort.Strings(extras)
		arquivos = append(arquivos, extras...)
		for _, a := range arquivos {
			if strings.HasPrefix(filepath.Base(a), ".") {
				continue
			}
			if dados, err := os.ReadFile(a); err == nil {
				fontes[a] = dados
			}
		}
	}

	var avisos []string
	for nome, dados := range fontes {
		var p politicaClaude
		if err := json.Unmarshal(trimBOM(dados), &p); err != nil {
			if nome != "settings.json" {
				avisos = append(avisos, "Claude Code: não consegui ler a config gerenciada "+nome+"; confira se ela bloqueia hooks.")
			}
			continue
		}
		if p.SemHooks {
			avisos = append(avisos, "Claude Code: disableAllHooks em "+nome+" bloqueia todos os hooks, inclusive o nosso.")
		}
		if p.SoGerenciados && nome != "settings.json" {
			avisos = append(avisos, "Claude Code: allowManagedHooksOnly em "+nome+" bloqueia os hooks do usuário, inclusive o nosso.")
		}
	}
	sort.Strings(avisos)
	return avisos
}

func existe(caminho string) bool {
	_, err := os.Stat(caminho)
	return err == nil
}
