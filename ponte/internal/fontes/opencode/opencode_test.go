package opencode

import (
	"testing"

	"firmopolis/ponte/internal/mundo"
)

// corpo monta o envelope que o plugin manda (ver integracoes/modelos/opencode-escritorio-vivo.js).
func corpo(tipo, propriedades, extras string) []byte {
	c := `{"type":"` + tipo + `","properties":` + propriedades + `,"cwd":"C:\\proj\\loja"`
	if extras != "" {
		c += "," + extras
	}
	return []byte(c + "}")
}

func normalizar(t *testing.T, c []byte) []mundo.Sinal {
	t.Helper()
	sinais, err := NormalizarOpenCode(c, "T1")
	if err != nil {
		t.Fatalf("erro inesperado: %v", err)
	}
	return sinais
}

func um(t *testing.T, c []byte) mundo.Sinal {
	t.Helper()
	sinais := normalizar(t, c)
	if len(sinais) != 1 {
		t.Fatalf("esperava 1 sinal, veio %+v", sinais)
	}
	s := sinais[0]
	if s.Fonte != mundo.ProvedorOpenCode || s.TerminalID != "T1" || s.Cwd != `C:\proj\loja` || !s.TS.IsZero() {
		t.Fatalf("campos comuns errados: %+v", s)
	}
	return s
}

func TestEstados(t *testing.T) {
	casos := []struct {
		tipo, propriedades string
		estado             mundo.Estado
	}{
		{"session.status", `{"sessionID":"s1","status":{"type":"busy"}}`, mundo.Ocupado},
		{"session.status", `{"sessionID":"s1","status":{"type":"retry"}}`, mundo.Ocupado},
		{"session.status", `{"sessionID":"s1","status":{"type":"idle"}}`, mundo.Ocioso},
		{"session.idle", `{"sessionID":"s1"}`, mundo.Ocioso},
		{"permission.asked", `{"sessionID":"s1"}`, mundo.EsperandoPermissao},
		{"permission.v2.asked", `{"sessionID":"s1"}`, mundo.EsperandoPermissao},
		{"permission.replied", `{"sessionID":"s1"}`, mundo.Ocupado},
		{"question.asked", `{"sessionID":"s1"}`, mundo.EsperandoResposta},
		{"question.replied", `{"sessionID":"s1"}`, mundo.Ocupado},
		{"question.rejected", `{"sessionID":"s1"}`, mundo.Ocupado},
		{"session.error", `{"sessionID":"s1","error":{"name":"ApiError"}}`, mundo.Erro},
	}
	for _, c := range casos {
		s := um(t, corpo(c.tipo, c.propriedades, ""))
		if s.SessaoID != "s1" || s.Estado != c.estado || s.Ajudante || s.Fim {
			t.Errorf("%s %s: veio %+v, esperava %q", c.tipo, c.propriedades, s, c.estado)
		}
	}
}

func TestToolExecuteBefore(t *testing.T) {
	s := um(t, corpo("tool.execute.before", `{"sessionID":"s1","tool":"edit","args":{"filePath":"C:\\proj\\loja\\main.go"}}`, ""))
	if s.Estado != mundo.Ocupado || s.Ferramenta != "edit" || s.Alvo != "main.go" {
		t.Fatalf("sinal errado: %+v", s)
	}
	s = um(t, corpo("tool.execute.before", `{"sessionID":"s1","tool":"bash","args":{"command":"go test ./...\nfim"}}`, ""))
	if s.Ferramenta != "bash" || s.Alvo != "go test ./..." {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestSessaoCriadaEApagada(t *testing.T) {
	if s := um(t, corpo("session.created", `{"sessionID":"s1","info":{"id":"s1","directory":"C:\\proj\\loja"}}`, "")); !s.Inicio || s.Estado != "" || s.SessaoID != "s1" {
		t.Errorf("criação errada: %+v", s)
	}
	if s := um(t, corpo("session.deleted", `{"sessionID":"s1","info":{"id":"s1"}}`, "")); !s.Fim || s.Ajudante {
		t.Errorf("remoção errada: %+v", s)
	}
}

func TestSessaoFilhaViraAjudante(t *testing.T) {
	ini := um(t, corpo("session.created", `{"sessionID":"f1","info":{"id":"f1","parentID":"s1"}}`, `"pai":"s1"`))
	if !ini.Ajudante || ini.Fim || ini.SessaoID != "s1" || ini.AjudanteID != "f1" {
		t.Fatalf("filha deveria virar ajudante do pai: %+v", ini)
	}
	// O plugin marca os eventos seguintes da filha com o pai.
	for _, fim := range [][]byte{
		corpo("session.idle", `{"sessionID":"f1"}`, `"pai":"s1"`),
		corpo("session.status", `{"sessionID":"f1","status":{"type":"idle"}}`, `"pai":"s1"`),
		corpo("session.deleted", `{"sessionID":"f1","info":{"id":"f1","parentID":"s1"}}`, `"pai":"s1"`),
	} {
		if s := um(t, fim); !s.Ajudante || !s.Fim || s.SessaoID != "s1" || s.AjudanteID != "f1" {
			t.Errorf("fim da filha errado: %+v", s)
		}
	}
	// Pedido de permissão da filha aparece no pai, sem ser ajudante.
	if s := um(t, corpo("permission.asked", `{"sessionID":"f1"}`, `"pai":"s1"`)); s.Ajudante || s.SessaoID != "s1" || s.Estado != mundo.EsperandoPermissao {
		t.Errorf("permissão da filha deveria ir para o pai: %+v", s)
	}
	// As ferramentas da filha não mexem no pai.
	if sinais := normalizar(t, corpo("tool.execute.before", `{"sessionID":"f1","tool":"bash","args":{"command":"ls"}}`, `"pai":"s1"`)); len(sinais) != 0 {
		t.Errorf("ferramenta da filha não gera sinal: %+v", sinais)
	}
}

func TestPIDDoPlugin(t *testing.T) {
	// O OpenCode não avisa quando o processo sai: o PID vai no sinal para a varredura.
	s := um(t, corpo("session.idle", `{"sessionID":"s1"}`, `"pid":4321`))
	if s.PID != 4321 {
		t.Fatalf("o PID do plugin deveria ir no sinal: %+v", s)
	}
	f := um(t, corpo("session.created", `{"sessionID":"f1","info":{"id":"f1","parentID":"s1"}}`, `"pai":"s1","pid":4321`))
	if f.PID != 4321 {
		t.Fatalf("o PID vai também no sinal da filha: %+v", f)
	}
}

func TestOpenCodeBusyRepetidoUmaMudanca(t *testing.T) {
	r := mundo.NovoRegistro(nil)
	mudancas := 0
	for i := 0; i < 3; i++ {
		for _, s := range normalizar(t, corpo("session.status", `{"sessionID":"s1","status":{"type":"busy"}}`, "")) {
			if m, _ := r.Aplicar(s); m != nil {
				mudancas++
			}
		}
	}
	if mudancas != 1 {
		t.Fatalf("busy ×3 deveria dar 1 mudança, deu %d", mudancas)
	}
}

func TestEventosIgnorados(t *testing.T) {
	for _, c := range [][]byte{
		corpo("message.part.updated", `{"sessionID":"s1"}`, ""),
		corpo("session.error", `{"sessionID":"s1","error":{"name":"MessageAbortedError"}}`, ""),
		corpo("session.error", `{"error":{"name":"ApiError"}}`, ""),
		corpo("session.status", `{"sessionID":"s1","status":{"type":"novo"}}`, ""),
	} {
		if sinais := normalizar(t, c); len(sinais) != 0 {
			t.Errorf("%s: esperava nenhum sinal, veio %+v", c, sinais)
		}
	}
}

func TestCorpoInvalido(t *testing.T) {
	for _, c := range []string{`{"type":"session.idle","prop`, ``, `{"type":"session.idle","properties":{}}`} {
		if sinais, err := NormalizarOpenCode([]byte(c), "T1"); err == nil || sinais != nil {
			t.Errorf("%q: esperava erro, veio %+v %v", c, sinais, err)
		}
	}
}
