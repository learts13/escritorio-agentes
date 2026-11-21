package decisao

import (
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDecisaoValeUmaVez(t *testing.T) {
	r := NovoRegistro(nil)
	p, fim, err := r.Abrir("t1", "Bash", Resumo{"ls", true}, time.Minute)
	if err != nil || !IDValido(p.ID) || p.Tipo != "permissao" || p.MoradorID != "t1" {
		t.Fatalf("abrir: %v %+v", err, p)
	}
	if _, _, ok := r.Decidir(p.ID, "talvez", PorLocal); ok {
		t.Fatal("ação fora de permitir/negar não vale")
	}
	if _, _, ok := r.Decidir(p.ID, Permitir, PorLocal); !ok {
		t.Fatal("a primeira decisão vale")
	}
	if res := <-fim; res != (Resultado{Acao: Permitir, Por: PorLocal}) {
		t.Fatalf("resultado: %+v", res)
	}
	if _, _, ok := r.Decidir(p.ID, Negar, PorRemoto); ok {
		t.Fatal("a segunda decisão no mesmo id não vale")
	}
	if _, _, ok := r.Decidir("AAAAAAAAAAAAAAAAAAAAAA", Permitir, PorLocal); ok {
		t.Fatal("id que este registro não criou não vale")
	}
	if len(r.Lista()) != 0 {
		t.Fatal("decidido sai da lista")
	}
}

func TestDecisaoDepoisDoPrazoNaoVale(t *testing.T) {
	agora := time.Now()
	r := NovoRegistro(func() time.Time { return agora })
	p, fim, _ := r.Abrir("t1", "Bash", Resumo{"ls", true}, time.Second)
	agora = agora.Add(time.Second)
	if _, _, ok := r.Decidir(p.ID, Permitir, PorRemoto); ok {
		t.Fatal("decisão vencida não vale")
	}
	if res := <-fim; res.Acao != "" || res.Por != PorExpirou {
		t.Fatalf("resultado: %+v", res)
	}
}

func TestTetoDePedidos(t *testing.T) {
	r := NovoRegistro(nil)
	for i := 0; i < Max; i++ {
		if _, _, err := r.Abrir("t", "Bash", Resumo{}, time.Minute); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := r.Abrir("t", "Bash", Resumo{}, time.Minute); err != ErrCheio {
		t.Fatalf("o 17º não espera: %v", err)
	}
}

// Terminal e navegador ao mesmo tempo: só um leva, e o canal recebe um resultado só.
func TestCorridaTerminalENavegador(t *testing.T) {
	for i := 0; i < 200; i++ {
		r := NovoRegistro(nil)
		p, fim, _ := r.Abrir("t1", "Bash", Resumo{"x", true}, time.Minute)
		var ganhou atomic.Int32
		var wg sync.WaitGroup
		wg.Add(3)
		go func() { defer wg.Done(); _, ok := r.Encerrar(p.ID, PorTerminal); bump(&ganhou, ok) }()
		go func() { defer wg.Done(); _, _, ok := r.Decidir(p.ID, Permitir, PorLocal); bump(&ganhou, ok) }()
		go func() { defer wg.Done(); _, _, ok := r.Decidir(p.ID, Negar, PorRemoto); bump(&ganhou, ok) }()
		wg.Wait()
		if ganhou.Load() != 1 {
			t.Fatalf("ganharam %d", ganhou.Load())
		}
		<-fim
		select {
		case res := <-fim:
			t.Fatalf("dois resultados: %+v", res)
		default:
		}
	}
}

func bump(n *atomic.Int32, ok bool) {
	if ok {
		n.Add(1)
	}
}

func TestIDsDiferentesECom128Bits(t *testing.T) {
	r := NovoRegistro(nil)
	vistos := map[string]bool{}
	for i := 0; i < Max; i++ {
		p, _, _ := r.Abrir("t", "Bash", Resumo{}, time.Minute)
		if vistos[p.ID] || len(p.ID) != 22 {
			t.Fatalf("id: %q", p.ID)
		}
		vistos[p.ID] = true
	}
	for _, ruim := range []string{"", "curto", strings.Repeat("a", 23), "AAAAAAAAAAAAAAAAAAAA=="} {
		if IDValido(ruim) {
			t.Errorf("%q não é id", ruim)
		}
	}
}

func TestResumoMascaraCortaENaoLevaAPasta(t *testing.T) {
	cmd := Resumir("Bash", map[string]any{"command": "curl -H 'Authorization: Bearer abcdefghijklmnop' x\nrm -rf /tmp/x"}, "/home/ana/loja")
	if strings.Contains(cmd.Texto, "abcdefghijklmnop") || !strings.Contains(cmd.Texto, "rm -rf /tmp/x") || !strings.Contains(cmd.Texto, "↵") || !cmd.Completo {
		t.Errorf("comando: %+v", cmd)
	}
	if got := Resumir("Bash", map[string]any{"command": "echo " + strings.Repeat("a ", 400)}, ""); len([]rune(got.Texto)) != MaxResumo || !strings.HasSuffix(got.Texto, "…") || got.Completo {
		t.Errorf("corte: %d %v", len([]rune(got.Texto)), got.Completo)
	}
	casos := []struct {
		ferramenta string
		entrada    map[string]any
		cwd        string
		texto      string
		completo   bool
	}{
		{"Bash", map[string]any{"command": "ls", "description": "x", "timeout": 5.0, "run_in_background": false}, "", "ls", true},
		{"Bash", map[string]any{"command": "ls", "dangerouslyDisableSandbox": true}, "", "ls", false},
		{"mcp__srv__run", map[string]any{"command": "ls", "args": []any{"-la"}}, "", "ls", false},
		{"Write", map[string]any{"file_path": "/home/ana/loja/src/app.go", "content": "x"}, "/home/ana/loja", "src/app.go", false},
		{"Edit", map[string]any{"file_path": "/home/ana/loja/a.go", "old_string": "a", "new_string": "b"}, "/home/ana/loja", "a.go", false},
		{"MultiEdit", map[string]any{"file_path": "/home/ana/loja/a.go"}, "/home/ana/loja", "a.go", false},
		{"NotebookEdit", map[string]any{"notebook_path": "/home/ana/loja/n.ipynb"}, "/home/ana/loja", "n.ipynb", false},
		{"Read", map[string]any{"file_path": "/home/ana/.ssh/authorized_keys"}, "/home/ana/loja", "fora do projeto: …/.ssh/authorized_keys", false},
		{"Read", map[string]any{"file_path": "/home/ana/loja/../.bashrc"}, "/home/ana/loja", "fora do projeto: …/ana/.bashrc", false},
		{"Read", map[string]any{"file_path": "/etc"}, "/home/ana/loja", "fora do projeto: /etc", false},
		{"Read", map[string]any{"file_path": `C:\Users\ana\loja\a.txt`}, `C:\Users\ana\loja`, "a.txt", false},
		{"WebFetch", map[string]any{"url": "https://u:senha@x.com/a?token=1"}, "", "https://x.com/a", false},
		{"WebFetch", map[string]any{"url": "https://x.com/a", "prompt": "resuma"}, "", "https://x.com/a", true},
		{"WebFetch", map[string]any{"url": "https://x.com/a", "headers": "x"}, "", "https://x.com/a", false},
		{"Bash", map[string]any{"prompt": "segredo do usuário"}, "", "", false},
	}
	for _, c := range casos {
		if got := Resumir(c.ferramenta, c.entrada, c.cwd); got.Texto != c.texto || got.Completo != c.completo {
			t.Errorf("%s %v: %+v", c.ferramenta, c.entrada, got)
		}
	}
}

// Bidi, largura zero e controle (C0 e C1) viram uma marca visível: nada se esconde nem inverte.
func TestCaracteresEnganososFicamVisiveis(t *testing.T) {
	got := Resumir("Bash", map[string]any{"command": "echo ok \u202e;tsil-tes \u200b\u2066x \x1b[2J"}, "")
	if c := Cortar("a\u0085b\u00adc"); c != "a‹U+0085›b‹U+00AD›c" {
		t.Errorf("C1 e Cf: %q", c)
	}
	for _, marca := range []string{"‹U+202E›", "‹U+200B›", "‹U+2066›", "‹U+001B›"} {
		if !strings.Contains(got.Texto, marca) {
			t.Errorf("faltou %s em %q", marca, got.Texto)
		}
	}
	if strings.ContainsAny(got.Texto, "\u202e\u200b\u2066\x1b") {
		t.Errorf("sobrou caractere invisível: %q", got.Texto)
	}
}

// Pedido incompleto: do servidor, só Negar vale; Permitir local segue valendo.
func TestIncompletoSoNegaDeLonge(t *testing.T) {
	r := NovoRegistro(nil)
	p, fim, _ := r.Abrir("t1", "Bash", Resumo{"x…", false}, time.Minute)
	if p.Completo {
		t.Fatal("incompleto")
	}
	if _, _, ok := r.Decidir(p.ID, Permitir, PorRemoto); ok {
		t.Fatal("permitir remoto num pedido incompleto não vale")
	}
	if _, _, ok := r.Decidir(p.ID, Negar, PorRemoto); !ok {
		t.Fatal("negar remoto vale")
	}
	<-fim
	p, _, _ = r.Abrir("t1", strings.Repeat("F", MaxFerramenta+1), Resumo{"ls", true}, time.Minute)
	if p.Completo || len([]rune(p.Ferramenta)) != MaxFerramenta {
		t.Fatalf("ferramenta cortada deixa incompleto: %+v", p)
	}
	if _, _, ok := r.Decidir(p.ID, Permitir, PorLocal); !ok {
		t.Fatal("permitir local vale (a tela local mostra o pedido inteiro do terminal ao lado)")
	}
}

func TestAssinatura(t *testing.T) {
	a := Assinar("tok", []byte("n1"), Soma([]byte("corpo")))
	if !ConfereAssinatura("tok", a, []byte("n1"), Soma([]byte("corpo"))) || ConfereAssinatura("outro", a, []byte("n1"), Soma([]byte("corpo"))) ||
		ConfereAssinatura("tok", a, []byte("n2"), Soma([]byte("corpo"))) || ConfereAssinatura("tok", a, []byte("n1"), Soma([]byte("outro"))) {
		t.Fatal("assinatura")
	}
	// o mesmo valor que o plugin do OpenCode calcula com node:crypto
	if got := Assinar("tok-123", []byte("0123456789abcdef0123456789abcdef"), Soma([]byte(`{"a":1}`))); got != "ccd03744866d3da4dcd53ed2417b7aae96d4d42c0dfaff454f8d407901aa324a" {
		t.Fatalf("HMAC diferente do plugin: %s", got)
	}
}

func TestValidarTextoRecusaCadaClasseProibida(t *testing.T) {
	ruins := map[string]string{
		"vazio":              "",
		"só espaços":         "   ",
		"quebra de linha":    "sim\nnão",
		"retorno":            "sim\r",
		"tab":                "a\tb",
		"ESC":                "\x1b[A",
		"NUL":                "a\x00b",
		"DEL":                "a\x7fb",
		"C1":                 "a\u0085b",
		"CSI de 8 bits":      "a\u009bb",
		"barra invertida":    `a\nb`,
		"escape \\e":         `\e[A`,
		"escape \\x":         `\x03`,
		"bidi RLO":           "a\u202eb",
		"bidi isolado":       "a\u2066b",
		"largura zero":       "a\u200bb",
		"ZWJ":                "a\u200db",
		"BOM":                "\ufeffa",
		"separador de linha": "a\u2028b",
		"separador de par.":  "a\u2029b",
		"uso privado":        "a\ue000b",
		"tag":                "a\U000E0041b",
		"UTF-8 inválido":     "a\xffb",
		"1001 runas":         strings.Repeat("é", 1001),
		"começa com -":       "--raw x",
		"- depois de espaço": "  -1",
	}
	for nome, s := range ruins {
		_, err := ValidarTexto(s)
		if err == nil {
			t.Errorf("%s: %q passou", nome, s)
		} else if s != "" && strings.Contains(err.Error(), s) {
			t.Errorf("%s: o erro traz o texto", nome)
		}
	}
	bons := map[string]string{
		"  sim  ":                      "sim",
		"Pode seguir, é isso mesmo ✓":  "Pode seguir, é isso mesmo ✓",
		"1":                            "1",
		"日本語 テスト":                      "日本語 テスト",
		"emoji 👍🏽 e acento é":          "emoji 👍🏽 e acento é",
		"a\u00a0b":                     "a\u00a0b",
		strings.Repeat("é", 1000):      strings.Repeat("é", 1000),
		`"aspas" $(x) ; | & * ~ -- -x`: `"aspas" $(x) ; | & * ~ -- -x`,
	}
	for s, want := range bons {
		if got, err := ValidarTexto(s); err != nil || got != want {
			t.Errorf("%q: %q %v", s, got, err)
		}
	}
}

func TestPerguntaSoAceitaResponderUmaVez(t *testing.T) {
	r := NovoRegistro(nil)
	p, fim, err := r.AbrirPergunta("t1", "Qual\u202e banco?", ViaMaestri, 0, "", time.Minute)
	if err != nil || p.Tipo != TipoPergunta || p.Via != ViaMaestri || p.Completo || p.Resumo != "Qual‹U+202E› banco?" {
		t.Fatalf("abrir: %v %+v", err, p)
	}
	if _, _, ok := r.Decidir(p.ID, Permitir, PorLocal); ok {
		t.Fatal("pergunta não aceita permitir")
	}
	if _, ok := r.Responder(p.ID, "", PorLocal); ok {
		t.Fatal("texto vazio não vale")
	}
	if _, ok := r.Responder(p.ID, "Postgres", PorRemoto); !ok {
		t.Fatal("responder")
	}
	if res := <-fim; res.Acao != Responder || res.Texto != "Postgres" || res.Por != PorRemoto {
		t.Fatalf("resultado: %+v", res)
	}
	if _, ok := r.Responder(p.ID, "de novo", PorLocal); ok {
		t.Fatal("uso único")
	}
	q, _, _ := r.Abrir("t1", "Bash", Resumo{"ls", true}, time.Minute)
	if _, ok := r.Responder(q.ID, "sim", PorLocal); ok {
		t.Fatal("permissão não aceita texto")
	}
	if ids := r.DoMorador("t1", TipoPergunta); len(ids) != 0 {
		t.Fatalf("só perguntas: %v", ids)
	}
	if ids := r.DoMorador("t1", ""); len(ids) != 1 || ids[0] != q.ID {
		t.Fatalf("todos: %v", ids)
	}
}

func TestPerguntaVencidaNaoRecebeResposta(t *testing.T) {
	agora := time.Unix(1000, 0)
	r := NovoRegistro(func() time.Time { return agora })
	p, fim, _ := r.AbrirPergunta("t1", "", ViaMaestri, 0, "", time.Second)
	agora = agora.Add(2 * time.Second)
	r.Responder(p.ID, "tarde", PorLocal)
	if res := <-fim; res.Acao != "" || res.Por != PorExpirou {
		t.Fatalf("vencida: %+v", res)
	}
}
