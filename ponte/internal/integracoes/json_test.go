package integracoes

import (
	"encoding/json"
	"testing"
)

func TestAnalisarGuardaPosicoes(t *testing.T) {
	doc := []byte("{\n  \"a\": [1, {\"b\": \"x\"}],\n  \"c\": {}\n}")
	raiz, err := analisar(doc)
	if err != nil {
		t.Fatal(err)
	}
	a := raiz.campo("a")
	if got := string(doc[a.ini:a.fim]); got != `[1, {"b": "x"}]` {
		t.Fatalf("faixa de a: %q", got)
	}
	if got := string(doc[a.filhos[1].ini:a.filhos[1].fim]); got != `{"b": "x"}` {
		t.Fatalf("faixa do item: %q", got)
	}
	if got := string(doc[raiz.iniChave[1]:raiz.filhos[1].fim]); got != `"c": {}` {
		t.Fatalf("faixa do campo c: %q", got)
	}
}

func TestAnalisarRecusaInvalido(t *testing.T) {
	for _, doc := range []string{`{"a": }`, `{"a": 1`, `{"a": 1} x`, ``} {
		if _, err := analisar([]byte(doc)); err == nil {
			t.Errorf("deveria recusar %q", doc)
		}
	}
}

func TestEdicoesCirurgicas(t *testing.T) {
	casos := []struct {
		nome, doc, quero string
		editar           func(doc []byte, raiz *no) []byte
	}{
		{"campo em objeto vazio", "{}\n", "{\n  \"x\": 1\n}\n",
			func(d []byte, r *no) []byte { return inserirCampo(d, r, "x", 1) }},
		{"campo no fim", "{\n    \"a\": 1\n}\n", "{\n    \"a\": 1,\n    \"x\": [\n        2\n    ]\n}\n",
			func(d []byte, r *no) []byte { return inserirCampo(d, r, "x", []int{2}) }},
		{"compacto continua compacto", `{"a":[1]}`, `{"a":[1,{"k":"<v>"}]}`,
			func(d []byte, r *no) []byte { return inserirItem(d, r.campo("a"), map[string]string{"k": "<v>"}) }},
		{"item em lista vazia", "{\n  \"a\": []\n}", "{\n  \"a\": [\n    true\n  ]\n}",
			func(d []byte, r *no) []byte { return inserirItem(d, r.campo("a"), true) }},
		{"tira o primeiro de dois", "{\n  \"a\": 1,\n  \"b\": 2\n}", "{\n  \"b\": 2\n}",
			func(d []byte, r *no) []byte { return removerFilho(d, r, 0) }},
		{"tira o último de dois", "{\n  \"a\": 1,\n  \"b\": 2\n}", "{\n  \"a\": 1\n}",
			func(d []byte, r *no) []byte { return removerFilho(d, r, 1) }},
		{"tira o único", "{\n  \"a\": [\n    1\n  ]\n}", "{\n  \"a\": []\n}",
			func(d []byte, r *no) []byte { return removerFilho(d, r.campo("a"), 0) }},
		{"troca no lugar", "{\n  \"a\": 1,\n  \"b\": 2\n}", "{\n  \"a\": \"novo\",\n  \"b\": 2\n}",
			func(d []byte, r *no) []byte { return substituir(d, r.campo("a"), "novo") }},
		{"BOM", "\xef\xbb\xbf{\n  \"a\": 1\n}", "\xef\xbb\xbf{\n  \"a\": 1,\n  \"b\": 2\n}",
			func(d []byte, r *no) []byte { return inserirCampo(d, r, "b", 2) }},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			raiz, err := analisar([]byte(c.doc))
			if err != nil {
				t.Fatal(err)
			}
			got := string(c.editar([]byte(c.doc), raiz))
			if got != c.quero {
				t.Fatalf("\n%q\nquero\n%q", got, c.quero)
			}
			if !json.Valid([]byte(got[len(got)-len(trimBOM([]byte(got))):])) {
				t.Fatal("ficou JSON inválido")
			}
		})
	}
}

func TestObjetoOrdenado(t *testing.T) {
	dados, err := json.Marshal(objeto{{"z", 1}, {"a", objeto{{"y", "<&>"}}}})
	if err != nil {
		t.Fatal(err)
	}
	if string(dados) != `{"z":1,"a":{"y":"\u003c\u0026\u003e"}}` {
		t.Fatalf("ordem ou escape: %s", dados)
	}
}
