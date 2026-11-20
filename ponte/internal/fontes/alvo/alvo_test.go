package alvo

import (
	"strings"
	"testing"
)

func TestResumirMascaraAntesDeCortar(t *testing.T) {
	casos := []struct {
		entrada map[string]any
		segredo string
	}{
		// O corte em 60 partiria a chave ao meio, e o pedaço não casaria mais com o padrão.
		{map[string]any{"command": "cd /projeto/muito/comprido/aqui && export KEY=sk-ant-api03-AbCdEf1234567890XyZ"}, "sk-ant-api03-AbCd"},
		{map[string]any{"command": `claude -p "revise o contrato sigiloso do cliente" --model haiku`}, "contrato sigiloso"},
		{map[string]any{"url": "https://api.exemplo.com/bot/ghp_AbCdEf1234567890AbCdEf1234/send"}, "ghp_AbCdEf"},
	}
	for _, c := range casos {
		got := Resumir(c.entrada)
		if strings.Contains(got, c.segredo) || len([]rune(got)) > Max {
			t.Errorf("Resumir(%v) = %q: segredo visível ou alvo longo demais", c.entrada, got)
		}
	}
	if got := Resumir(map[string]any{"command": "go test ./..."}); got != "go test ./..." {
		t.Errorf("comando comum muda: %q", got)
	}
}

// TestMascaraAntesDoCorte prende a ordem Curto(Mascarar(...)): em cada caso o segredo
// começa antes do limite e termina depois dele, então cortar primeiro deixaria à
// mostra um pedaço curto demais para casar com o padrão.
func TestMascaraAntesDoCorte(t *testing.T) {
	casos := []struct {
		nome     string
		entrada  map[string]any
		resumido string // o texto que o Resumir corta (comando, URL sem query, nome do arquivo)
		segredo  string
	}{
		{"comando", map[string]any{"command": "echo 1234567890 1234567890 1234567890 && gh auth ghp_AbCdEfGhIj1234567890AbCdEfGhIj12"},
			"echo 1234567890 1234567890 1234567890 && gh auth ghp_AbCdEfGhIj1234567890AbCdEfGhIj12", "ghp_AbCdEfGhIj1234567890AbCdEfGhIj12"},
		{"url", map[string]any{"url": "https://api.exemplo.com/v1/canal/geral/mensagens/xoxb-1234567890-AbCdEfGhIjKl/enviar?x=1"},
			"https://api.exemplo.com/v1/canal/geral/mensagens/xoxb-1234567890-AbCdEfGhIjKl/enviar", "xoxb-1234567890-AbCdEfGhIjKl"},
		{"caminho", map[string]any{"file_path": `C:\dados\relatorio.final.cliente.2026.11.14.versao.revisada.AKIAIOSFODNN7EXAMPLE.txt`},
			"relatorio.final.cliente.2026.11.14.versao.revisada.AKIAIOSFODNN7EXAMPLE.txt", "AKIAIOSFODNN7EXAMPLE"},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			ini := strings.Index(c.resumido, c.segredo)
			if ini < 0 || ini >= Max-1 || ini+len(c.segredo) <= Max-1 {
				t.Fatalf("o caso precisa de um segredo atravessando o corte (início %d, fim %d, corte %d)", ini, ini+len(c.segredo), Max-1)
			}
			visivel := c.segredo[:Max-1-ini] // o que sobraria do segredo se cortasse antes
			got := Resumir(c.entrada)
			if strings.Contains(got, visivel) {
				t.Fatalf("Resumir = %q: o pedaço %q do segredo ficou à mostra", got, visivel)
			}
			if !strings.Contains(got, "***") || len([]rune(got)) > Max {
				t.Fatalf("Resumir = %q: o segredo deveria virar *** e o alvo caber em %d", got, Max)
			}
		})
	}
}
