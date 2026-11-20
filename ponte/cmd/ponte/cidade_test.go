package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"firmopolis/ponte/internal/clima"
)

// geocodificacaoTeste troca a busca de cidades e a pasta da ponte por fixtures.
func geocodificacaoTeste(t *testing.T, corpo string) (dir string, consultas *int) {
	t.Helper()
	n := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n++
		w.Write([]byte(corpo))
	}))
	t.Cleanup(s.Close)
	dir = pastaTemp(t)
	antesURL, antesDir := urlGeocodificacao, dirConfigCidade
	urlGeocodificacao, dirConfigCidade = s.URL, func() (string, error) { return dir, nil }
	t.Cleanup(func() { urlGeocodificacao, dirConfigCidade = antesURL, antesDir })
	return dir, &n
}

const duasCidades = `{"results":[
 {"name":"São Paulo","admin1":"São Paulo","country":"Brasil","country_code":"BR","latitude":-23.5475,"longitude":-46.63611,"timezone":"America/Sao_Paulo"},
 {"name":"São Paulo","admin1":"Bahia","country":"Brasil","country_code":"BR","latitude":-12.0,"longitude":-38.0,"timezone":"America/Bahia"}]}`

func TestSetupCidadePlanoNaoGrava(t *testing.T) {
	dir, _ := geocodificacaoTeste(t, duasCidades)
	var saida bytes.Buffer
	if err := setup([]string{"--plano", "--cidade", "São Paulo"}, &saida); err != nil {
		t.Fatal(err)
	}
	texto := saida.String()
	if !strings.Contains(texto, "1. São Paulo, São Paulo, Brasil") || !strings.Contains(texto, "2. São Paulo, Bahia, Brasil") ||
		!strings.Contains(texto, "só a latitude e a longitude") {
		t.Fatalf("o plano deveria listar as cidades e o aviso:\n%s", texto)
	}
	if itens, _ := os.ReadDir(dir); len(itens) != 0 {
		t.Fatalf("o --plano gravou: %v", itens)
	}
}

// TestSetupCidadePlanoComCidadeEscolhidaNaoGrava: mesmo com a cidade definida (única ou
// pela --escolha), o --plano só mostra; o consentimento é o --aplicar.
func TestSetupCidadePlanoComCidadeEscolhidaNaoGrava(t *testing.T) {
	for _, c := range []struct {
		corpo string
		args  []string
	}{
		{`{"results":[{"name":"Lisboa","admin1":"Lisboa","country":"Portugal","country_code":"PT","latitude":38.7,"longitude":-9.1,"timezone":"Europe/Lisbon"}]}`,
			[]string{"--plano", "--cidade", "Lisboa"}},
		{duasCidades, []string{"--plano", "--cidade", "São Paulo", "--escolha", "2"}},
	} {
		dir, _ := geocodificacaoTeste(t, c.corpo)
		var saida bytes.Buffer
		if err := setup(c.args, &saida); err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(saida.String(), "Gravaria em clima.json") {
			t.Fatalf("%v: o plano deveria mostrar o que gravaria:\n%s", c.args, saida.String())
		}
		if _, err := os.Stat(filepath.Join(dir, clima.ArquivoConfig)); !os.IsNotExist(err) {
			t.Fatalf("%v: o --plano criou o %s: %v", c.args, clima.ArquivoConfig, err)
		}
	}
}

func TestSetupCidadeAplicarComEscolha(t *testing.T) {
	dir, _ := geocodificacaoTeste(t, duasCidades)
	var saida bytes.Buffer
	if err := setup([]string{"--aplicar", "--cidade", "São Paulo"}, &saida); err == nil {
		t.Fatal("com duas cidades, o --aplicar pede a --escolha")
	}
	if err := setup([]string{"--aplicar", "--cidade", "São Paulo", "--escolha", "3"}, &saida); err == nil {
		t.Fatal("--escolha fora da lista")
	}
	if err := setup([]string{"--aplicar", "--cidade", "São Paulo", "--escolha", "2", "--pais", "pt"}, &saida); err != nil {
		t.Fatal(err)
	}
	c, err := clima.LerConfig(dir)
	quer := clima.Config{Cidade: "São Paulo, Bahia, Brasil", Lat: -12, Lon: -38, Fuso: "America/Bahia", Pais: "PT", Consentimento: true}
	if err != nil || c != quer {
		t.Fatalf("config: %+v %v", c, err)
	}

	// --sem-cidade: o plano não apaga; o aplicar apaga.
	if err := setup([]string{"--plano", "--sem-cidade"}, &saida); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, clima.ArquivoConfig)); err != nil {
		t.Fatal("o --plano --sem-cidade apagou a cidade")
	}
	if err := setup([]string{"--aplicar", "--sem-cidade"}, &saida); err != nil {
		t.Fatal(err)
	}
	if c, _ := clima.LerConfig(dir); c.Ligado() {
		t.Fatalf("cidade ainda gravada: %+v", c)
	}
}

func TestSetupCidadeUnicaUsaOPaisDela(t *testing.T) {
	dir, _ := geocodificacaoTeste(t, `{"results":[{"name":"Lisboa","admin1":"Lisboa","country":"Portugal","country_code":"PT","latitude":38.71667,"longitude":-9.13333,"timezone":"Europe/Lisbon"}]}`)
	var saida bytes.Buffer
	if err := setup([]string{"--aplicar", "--cidade", "Lisboa"}, &saida); err != nil {
		t.Fatal(err)
	}
	if c, _ := clima.LerConfig(dir); c.Pais != "PT" || c.Lat != 38.72 || c.Lon != -9.13 || !c.Consentimento {
		t.Fatalf("config: %+v", c)
	}
}

func TestSetupCidadeNaoCombinaComOResto(t *testing.T) {
	_, consultas := geocodificacaoTeste(t, duasCidades)
	for _, args := range [][]string{
		{"--desfazer", "--cidade", "x"}, {"--plano", "--aplicar", "--cidade", "x"}, {"--cidade", "x"},
		{"--aplicar", "--cidade", "x", "--autostart"}, {"--aplicar", "--cidade", "x", "--home", "y"},
		{"--aplicar", "--cidade", "x", "--sem-cidade"}, {"--plano", "--escolha", "1"}, {"--plano", "--pais", "BR"},
	} {
		if err := setup(args, &bytes.Buffer{}); err == nil {
			t.Errorf("%v deveria falhar", args)
		}
	}
	if *consultas != 0 {
		t.Fatalf("uso errado não consulta a rede: %d", *consultas)
	}
}

func TestSetupCidadeSemResultadoOuSemRede(t *testing.T) {
	geocodificacaoTeste(t, `{}`)
	if err := setup([]string{"--plano", "--cidade", "Xyzzy"}, &bytes.Buffer{}); err == nil || !strings.Contains(err.Error(), "nenhuma cidade") {
		t.Fatalf("sem resultado: %v", err)
	}
	urlGeocodificacao = "http://127.0.0.1:1"
	if err := setup([]string{"--plano", "--cidade", "x"}, &bytes.Buffer{}); err == nil {
		t.Fatal("sem rede deveria falhar")
	}
}
