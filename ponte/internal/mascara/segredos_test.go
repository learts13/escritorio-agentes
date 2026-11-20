package mascara

import (
	"strings"
	"testing"
)

// gitlabFalso é um token de mentira, montado em partes para o scanner de segredos do
// GitHub não confundir com um de verdade.
const gitlabFalso = "glp" + "at-AbCdEf1234567890xyzw"

func TestMascarar(t *testing.T) {
	casos := []struct{ nome, entrada, segredo string }{
		{"openai", "export OPENAI_API_KEY=sk-proj-AbCdEf1234567890XyZ", "sk-proj-AbCdEf1234567890XyZ"},
		{"anthropic", "curl -H x-api-key:sk-ant-api03-AbCdEf1234567890_XyZ-123 https://api", "sk-ant-api03-AbCdEf1234567890_XyZ-123"},
		{"github", "git clone https://ghp_AbCdEf1234567890AbCdEf1234@github.com/x/y", "ghp_AbCdEf1234567890AbCdEf1234"},
		{"github fino", "gh auth login --with-token github_pat_11ABCDEFG0123456789_abcdefXYZ", "github_pat_11ABCDEFG0123456789_abcdefXYZ"},
		{"aws", "aws configure set aws_access_key_id AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7EXAMPLE"},
		{"slack", "curl -d token=xoxb-1234567890-abcdefghij https://slack.com", "xoxb-1234567890-abcdefghij"},
		{"bearer", `curl -H "Authorization: Bearer eyJhbGciOi.abc_def-123" https://api`, "eyJhbGciOi.abc_def-123"},
		{"password=", "mysql --password=Hunter2!segredo -u root", "Hunter2!segredo"},
		{"token=", "https://x.com/hook?token=abc123def456", "abc123def456"},
		{"senha em env", "PGPASSWORD=s3nh4Forte psql", "s3nh4Forte"},
		{"base64 longo", "echo dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgdmFsdWUgMTIzNDU2Nzg5MA== | base64 -d", "dGhpcyBpcyBhIHZlcnkgbG9uZyBzZWNyZXQgdmFsdWUgMTIzNDU2Nzg5MA=="},
		{"claude -p", `claude -p "revise o contrato do cliente Fulano" --model haiku`, "revise o contrato do cliente Fulano"},
		{"claude --print", `cd x && claude --print 'resuma o e-mail da Ana' | tee out`, "resuma o e-mail da Ana"},
		{"claude -p sem aspas", `claude.exe -p segredo-do-prompt`, "segredo-do-prompt"},
		{"claude -p cortado", `claude -p "texto que segue na próxima linha`, "texto que segue"},
		{"codex exec", `codex --no-daemon exec "apague os logs de produção"`, "apague os logs de produção"},
		{"opencode run", `opencode run "conserte o bug do pagamento"`, "conserte o bug do pagamento"},
		{"agy -p", `agy -p "gere a imagem do logo"`, "gere a imagem do logo"},
		{"jwt", "curl -b sessao=x eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ"},
		{"google", "gcloud --key AIzaSyA1234567890abcdefghijklmnopqrstuv", "AIzaSyA1234567890abcdefghijklmnopqrstuv"},
		{"gitlab", "git push https://" + gitlabFalso + "@gitlab.com/x", gitlabFalso},
		{"chave privada", "echo -----BEGIN OPENSSH PRIVATE KEY----- b3BlbnNzaC1rZXk > id", "b3BlbnNzaC1rZXk"},
		{"base64 com barra", "echo QWxhZGRpbjpvcGVuIHNlc2FtZQ1234567890abcdefghijk/lmnop >x", "QWxhZGRpbjpvcGVuIHNlc2FtZQ1234567890abcdefghijk"},
	}
	for _, c := range casos {
		got := Mascarar(c.entrada)
		if strings.Contains(got, c.segredo) {
			t.Errorf("%s: o segredo ficou visível em %q", c.nome, got)
		}
		if !strings.Contains(got, Marca) {
			t.Errorf("%s: esperava a marca %q em %q", c.nome, Marca, got)
		}
	}
}

func TestMascararPreservaOResto(t *testing.T) {
	casos := map[string]string{
		"go test ./...":                     "go test ./...",
		"git commit -m wip":                 "git commit -m wip",
		"main.go":                           "main.go",
		"npm run build --prod":              "npm run build --prod",
		"claude --version":                  "claude --version",
		"curl -s -o NUL https://x":          "curl -s -o NUL https://x",
		"skill-repair --help":               "skill-repair --help",
		`claude -p "x" --model haiku`:       `claude -p ` + Marca + ` --model haiku`,
		"mysql --password=Hunter2 -u root":  "mysql --password=" + Marca + " -u root",
		"Authorization: Bearer abcdefgh123": "Authorization: Bearer " + Marca,
		// Caminho longo real: cada segmento é curto, então nada some.
		`cd C:\Users\helbe\.maestri\roles\b830fadc-c6c4-4a03-9122-517d16a50f27 && go test ./...`: `cd C:\Users\helbe\.maestri\roles\b830fadc-c6c4-4a03-9122-517d16a50f27 && go test ./...`,
		"go test ./internal/fontes/claude/ponte/integracoes/modelos/escritorio/vivo":             "go test ./internal/fontes/claude/ponte/integracoes/modelos/escritorio/vivo",
		"escritorio_vivo_ponte_de_producao_em_go_com_nome_comprido.py":                           "escritorio_vivo_ponte_de_producao_em_go_com_nome_comprido.py",
	}
	for entrada, want := range casos {
		if got := Mascarar(entrada); got != want {
			t.Errorf("Mascarar(%q) = %q, esperava %q", entrada, got, want)
		}
	}
}
