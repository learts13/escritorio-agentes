// Package mascara esconde segredos e prompts no texto que a ponte mostra ou guarda
// (o alvo da atividade e o histórico). Na dúvida, mascara: mostrar a mais é pior.
package mascara

import (
	"regexp"
	"strings"
	"unicode"
)

// Marca é o que fica no lugar do que foi escondido.
const Marca = "***"

// argumento casa o argumento seguinte: entre aspas (mesmo sem fechar, quando a linha
// foi cortada) ou uma palavra só.
const argumento = `(?:"[^"]*"?|'[^']*'?|[^\s"'|;&]+)`

var regras = []struct {
	re   *regexp.Regexp
	novo string
}{
	// Prompt passado na linha de comando a outro agente (claude -p "...", codex exec
	// "...", opencode run "...", agy -p "..."): é texto do usuário, nunca aparece.
	{regexp.MustCompile(`(?i)(\b(?:claude|agy|gemini)(?:\.exe)?\b[^|;&\n]*?\s(?:-p|--print|--prompt)\s+)` + argumento), "${1}" + Marca},
	{regexp.MustCompile(`(?i)(\bcodex(?:\.exe)?\b[^|;&\n]*?\sexec\s+(?:--?[\w-]+\s+)*)` + argumento), "${1}" + Marca},
	{regexp.MustCompile(`(?i)(\bopencode(?:\.exe)?\b[^|;&\n]*?\srun\s+(?:--?[\w-]+\s+)*)` + argumento), "${1}" + Marca},
	// chave=valor e chave: valor de senha, token, segredo e chave de API.
	{regexp.MustCompile(`(?i)(\b[\w.-]*(?:password|passwd|pwd|senha|token|secret|api[_-]?key|apikey)[\w.-]*["']?\s*[=:]\s*)` + argumento), "${1}" + Marca},
	{regexp.MustCompile(`(?i)(\bBearer\s+)[A-Za-z0-9._~+/=-]{8,}`), "${1}" + Marca},
	// Formatos conhecidos de chave.
	{regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{16,}`), Marca},
	{regexp.MustCompile(`\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})`), Marca},
	{regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`), Marca},
	{regexp.MustCompile(`\bxox[abprs]-[A-Za-z0-9-]{10,}`), Marca},
	{regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]*){0,2}`), Marca}, // JWT
	{regexp.MustCompile(`\bAIza[0-9A-Za-z_-]{20,}`), Marca},                         // Google
	{regexp.MustCompile(`\bglpat-[A-Za-z0-9_-]{20,}`), Marca},                       // GitLab
	{regexp.MustCompile(`-----BEGIN[^\n]*`), Marca},                                 // chave privada (PEM)
}

// longo casa um segmento (o que fica entre /, \ e espaço) de base64 ou base64url com
// mais de 40 caracteres. Por segmento, um caminho comprido não some inteiro.
var longo = regexp.MustCompile(`[A-Za-z0-9+_=-]{41,}`)

// Mascarar troca por Marca os segredos (sk-…, ghp_…, github_pat_…, AKIA…, xox…,
// eyJ… (JWT), AIza…, glpat-…, -----BEGIN…, Bearer …, password=, token= e afins, e
// segmentos de base64 com mais de 40 caracteres) e o prompt passado a
// outro agente pela linha de comando. Precisa rodar antes de cortar o texto, senão um
// segredo cortado deixa de casar com o padrão.
func Mascarar(s string) string {
	for _, r := range regras {
		s = r.re.ReplaceAllString(s, r.novo)
	}
	return longo.ReplaceAllStringFunc(s, func(m string) string {
		if pareceSegredo(m) {
			return Marca
		}
		return m
	})
}

// pareceSegredo separa base64 de um nome comprido: segredo mistura letras e dígitos.
func pareceSegredo(s string) bool {
	return strings.IndexFunc(s, unicode.IsLetter) >= 0 && strings.IndexFunc(s, unicode.IsDigit) >= 0
}
