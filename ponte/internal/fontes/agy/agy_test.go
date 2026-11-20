package agy

import (
	"testing"

	"firmopolis/ponte/internal/mundo"
)

// hook monta o stdin de um hook do agy (campos da captura do spike, anonimizados).
func hook(nome, extras string) []byte {
	c := `{"conversationId":"conv-0001","cwd":"C:\\proj\\loja","hookEventName":"` + nome + `","lastUserInput":"PROMPT-SECRETO","modelName":"gemini","workspacePaths":["C:/proj/loja"]`
	if extras != "" {
		c += "," + extras
	}
	return []byte(c + "}")
}

func um(t *testing.T, c []byte) mundo.Sinal {
	t.Helper()
	sinais, err := NormalizarAgy(c, "T1")
	if err != nil || len(sinais) != 1 {
		t.Fatalf("esperava 1 sinal, veio %+v %v", sinais, err)
	}
	s := sinais[0]
	if s.Fonte != mundo.ProvedorAgy || s.SessaoID != "conv-0001" || s.TerminalID != "T1" || s.Cwd != `C:\proj\loja` || !s.TS.IsZero() {
		t.Fatalf("campos comuns errados: %+v", s)
	}
	if s.Alvo != "" || s.Ferramenta != "" {
		t.Fatalf("o agy não manda ferramenta verificada, e o prompt nunca vira alvo: %+v", s)
	}
	return s
}

func TestSessionStartInicio(t *testing.T) {
	if s := um(t, hook("SessionStart", "")); !s.Inicio || s.Estado != "" {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestPreInvocationEPreToolUseOcupado(t *testing.T) {
	for _, nome := range []string{"PreInvocation", "PreToolUse"} {
		if s := um(t, hook(nome, `"invocationNum":0,"initialNumSteps":1`)); s.Estado != mundo.Ocupado {
			t.Errorf("%s: %+v", nome, s)
		}
	}
}

func TestStopOcioso(t *testing.T) {
	s := um(t, hook("Stop", `"continuationActive":false,"error":"","executionNum":0,"fullyIdle":true,"terminationReason":"NO_TOOL_CALL"`))
	if s.Estado != mundo.Ocioso {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestAgyStopComContinuacaoContinuaOcupado(t *testing.T) {
	for _, extras := range []string{
		`"continuationActive":true,"error":"","fullyIdle":true`,
		`"continuationActive":false,"error":"","fullyIdle":false`,
		`"error":""`,
	} {
		if s := um(t, hook("Stop", extras)); s.Estado != mundo.Ocupado {
			t.Errorf("%s: deveria continuar ocupado, veio %+v", extras, s)
		}
	}
}

func TestStopComErro(t *testing.T) {
	if s := um(t, hook("Stop", `"continuationActive":false,"error":"quota exceeded","fullyIdle":true`)); s.Estado != mundo.Erro {
		t.Fatalf("sinal errado: %+v", s)
	}
}

func TestEventosIgnoradosECorpoInvalido(t *testing.T) {
	if sinais, err := NormalizarAgy(hook("PostToolUse", ""), "T1"); err != nil || len(sinais) != 0 {
		t.Errorf("PostToolUse não gera sinal: %+v %v", sinais, err)
	}
	for _, c := range []string{`{"conversationId":"c1","hookEvent`, ``, `{"hookEventName":"Stop"}`} {
		if sinais, err := NormalizarAgy([]byte(c), "T1"); err == nil || sinais != nil {
			t.Errorf("%q: esperava erro, veio %+v %v", c, sinais, err)
		}
	}
}
