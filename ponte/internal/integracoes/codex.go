package integracoes

import (
	"fmt"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"

	"firmopolis/ponte/internal/decisao"
)

// eventosCodex são os eventos que o normalizador do Codex usa (fontes/codex). O
// Codex não tem Notification; tem Interrupt.
var eventosCodex = []string{
	"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PermissionRequest",
	"Stop", "Interrupt", "SubagentStart", "SubagentStop", "SessionEnd",
}

// reComando reconhece o nosso comando, com ou sem .exe e aspas, em qualquer pasta.
func reComando(rota string) *regexp.Regexp {
	return regexp.MustCompile(`(?:^|[\\/"'\s&])ponte(?:\.exe)?["']?\s+hook\s+` + rota + `\s*$`)
}

var reComandoCodex = reComando("codex")

// comandoPosix é o comando com o caminho entre aspas duplas: serve no sh e no cmd (o
// agy). No sh, as aspas duplas ainda expandem $ e crase; onde só há sh, use comandoBash.
func comandoPosix(exe, rota string) string {
	return `"` + strings.ReplaceAll(exe, `"`, `\"`) + `" hook ` + rota
}

// comandoBash é o comando com o caminho entre aspas simples, que o sh e o bash não
// expandem (uma aspa simples do caminho fecha as aspas, entra escapada e as reabre): o
// do mcode, que roda no Git Bash, e o command do Codex fora do Windows.
func comandoBash(exe, rota string) string {
	return "'" + strings.ReplaceAll(exe, "'", `'\''`) + "' hook " + rota
}

// comandoPowerShell é o commandWindows do Codex, que roda no PowerShell.
func comandoPowerShell(exe, rota string) string {
	return "& '" + strings.ReplaceAll(exe, "'", "''") + "' hook " + rota
}

var codex = integracao{
	nome: "Codex",
	arquivo: func(op Opcoes) string {
		return filepath.Join(op.Home, ".codex", "hooks.json")
	},
	instalado: func(op Opcoes) bool { return existe(filepath.Join(op.Home, ".codex")) },
	instalar: func(op Opcoes, doc []byte, _ *registro) ([]byte, string, []string, error) {
		novo, havia := doc, false
		for _, ev := range eventosCodex {
			n, h, err := instalarGrupos(novo, []string{ev}, grupoCodex(op, ev), grupoCodexNosso)
			if err != nil {
				return nil, "", nil, err
			}
			novo, havia = n, havia || h
		}
		n, h, err := instalarGrupos(novo, []string{eventoDecidir}, grupoCodexDecidir(op), grupoCodexDecidirNosso)
		if err != nil {
			return nil, "", nil, err
		}
		novo, havia = n, havia || h
		var avisos []string
		if string(novo) != string(docOuVazio(doc)) {
			// A aprovação fica no [hooks.state] do config.toml, com um trusted_hash que
			// só o Codex calcula. A ponte não grava esse hash: quem aprova é a pessoa.
			if havia {
				avisos = append(avisos, "Codex: o nosso hook mudou, e com ele o hash da aprovação. Abra o codex, rode /hooks e aprove de novo os hooks do ponte.exe.")
			} else {
				avisos = append(avisos, "Codex: hook novo só roda depois de aprovado. Abra o codex, rode /hooks e aprove os hooks do ponte.exe (a ponte não grava o trusted_hash por você).")
			}
		}
		resumo := fmt.Sprintf("hook command `%s` em %d eventos (%s), em segundo plano menos no %s; no %s, também o `%s`, "+
			"síncrono, que espera até %d s a resposta pelo Firmópolis (só com alguém atendendo)",
			comandoBash(op.Exe, "codex"), len(eventosCodex), strings.Join(eventosCodex, ", "), eventoCodexSincrono,
			eventoDecidir, comandoDecidirBash(op.Exe, op.Porta), int(decisao.EsperaCodex/time.Second))
		return novo, resumo, avisos, nil
	},
	tirar: func(op Opcoes, doc []byte, _ *registro) ([]byte, []string, error) {
		novo, meio, err := tirarGrupos(doc, qualquerCodexNosso)
		var avisos []string
		if meio {
			avisos = append(avisos, "Codex: havia hooks de outros depois do nosso; eles mudam de posição e o Codex vai pedir a aprovação deles de novo em /hooks.")
		}
		return novo, avisos, err
	},
	temNosso: func(_ Opcoes, doc []byte) bool { return temGrupo(doc, qualquerCodexNosso) },
}

// eventoCodexSincrono é o único evento em que o Codex não aceita hook async: ele
// roda síncrono e avisa na tela. Nos outros, o Codex não espera o PowerShell que abre
// o hook (500 a 700 ms por evento no Windows).
const eventoCodexSincrono = "SessionEnd"

// No SessionEnd e no Interrupt, o Codex aceita no máximo 3 s (acima disso, corta e
// avisa).
var eventosCodexCurtos = []string{"SessionEnd", "Interrupt"}

const timeoutCodexCurto = 3

func grupoCodex(op Opcoes, ev string) objeto {
	timeout := timeoutHook
	if slices.Contains(eventosCodexCurtos, ev) {
		timeout = timeoutCodexCurto
	}
	h := objeto{
		{"type", "command"},
		{"command", comandoBash(op.Exe, "codex")},
		{"commandWindows", comandoPowerShell(op.Exe, "codex")},
		{"timeout", timeout},
	}
	if ev != eventoCodexSincrono {
		h = append(h, par{"async", true})
	}
	return objeto{
		{"matcher", ""},
		{"hooks", []any{h}},
	}
}

// O `ponte decidir codex`: síncrono, só no PermissionRequest, num grupo só dele.
var reDecidirCodex = regexp.MustCompile(`(?:^|[\\/"'\s&])ponte(?:\.exe)?["']?\s+decidir\s+(?:--porta\s+\d+\s+)?codex\s*$`)

func comandoDecidirBash(exe string, porta int) string {
	return "'" + strings.ReplaceAll(exe, "'", `'\''`) + "' decidir --porta " + strconv.Itoa(porta) + " codex"
}

func comandoDecidirPowerShell(exe string, porta int) string {
	return "& '" + strings.ReplaceAll(exe, "'", "''") + "' decidir --porta " + strconv.Itoa(porta) + " codex"
}

func grupoCodexDecidir(op Opcoes) objeto {
	return objeto{
		{"matcher", ""},
		{"hooks", []any{objeto{
			{"type", "command"},
			{"command", comandoDecidirBash(op.Exe, op.Porta)},
			{"commandWindows", comandoDecidirPowerShell(op.Exe, op.Porta)},
			{"timeout", timeoutDecidir("codex")},
		}}},
	}
}

func grupoCodexDecidirNosso(v any) bool {
	return grupoCom(v, func(h map[string]any) bool {
		cmd, _ := h["command"].(string)
		return h["type"] == "command" && reDecidirCodex.MatchString(cmd)
	})
}

func qualquerCodexNosso(v any) bool { return grupoCodexNosso(v) || grupoCodexDecidirNosso(v) }

func grupoCodexNosso(v any) bool {
	return grupoCom(v, func(h map[string]any) bool {
		cmd, _ := h["command"].(string)
		return h["type"] == "command" && reComandoCodex.MatchString(cmd)
	})
}
