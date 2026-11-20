package integracoes

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"firmopolis/ponte/integracoes/modelos"
)

// Quem vem do Escritório Vivo: o --aplicar põe o firmopolis e tira o escritorio-vivo
// (entrada do agy e plugins do OpenCode e do MiniMax), sem tocar no que não é nosso.
func TestAplicarMigraOEscritorioVivo(t *testing.T) {
	a := novoAmbiente(t)
	agy := `{"outra":{"Stop":[{"type":"command","command":"x"}]},"escritorio-vivo":{"Stop":[{"type":"command","command":"ponte hook agy"}]}}` + "\n"
	a.gravar(t, ".gemini/config/hooks.json", agy)
	pluginVelho := string(antigoOpenCode(t))
	a.gravar(t, ".config/opencode/plugins/escritorio-vivo.js", pluginVelho)
	a.gravar(t, ".minimax/plugins/escritorio-vivo/.claude-plugin/plugin.json", string(manifestoMiniMax(a.op, marcaAntiga, descricaoMiniMaxAntiga)))

	p := aplicar(t, a.op)
	texto := p.Texto()
	for _, quero := range []string{"OpenCode (plugin antigo)", "MiniMax Code (plugin antigo)", `tira a entrada antiga "escritorio-vivo"`} {
		if !strings.Contains(texto, quero) {
			t.Errorf("o plano deveria mostrar %q:\n%s", quero, texto)
		}
	}
	v := decodificar(t, a.ler(t, ".gemini/config/hooks.json")).(map[string]any)
	if _, ok := v["escritorio-vivo"]; ok {
		t.Error("a entrada antiga do agy deveria sair")
	}
	if v["firmopolis"] == nil || v["outra"] == nil {
		t.Errorf("a nova entra e a de terceiros fica: %v", v)
	}
	for _, rel := range []string{".config/opencode/plugins/escritorio-vivo.js", ".minimax/plugins/escritorio-vivo"} {
		if _, err := os.Stat(a.caminho(rel)); !os.IsNotExist(err) {
			t.Errorf("%s deveria ter saído", rel)
		}
	}
	if a.ler(t, ".config/opencode/plugins/firmopolis.js") != string(modelos.PluginOpenCode) {
		t.Error("o plugin novo entra")
	}
	// de novo: nada a mudar, e nada de nota sobre os antigos
	p = Planejar(a.op)
	if len(p.Mudancas) != 0 || strings.Contains(p.Texto(), "antigo") {
		t.Errorf("a segunda vez não muda nada:\n%s", p.Texto())
	}
}

func TestPluginAntigoAlheioFicaComAviso(t *testing.T) {
	a := novoAmbiente(t)
	a.gravar(t, ".config/opencode/plugins/escritorio-vivo.js", "// meu plugin\n")
	p := aplicar(t, a.op)
	if a.ler(t, ".config/opencode/plugins/escritorio-vivo.js") != "// meu plugin\n" {
		t.Fatal("o arquivo alheio não pode ser apagado")
	}
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "escritorio-vivo.js do Escritório Vivo foi alterado") {
		t.Errorf("faltou o aviso: %v", p.Avisos)
	}
}

func TestDesfazerTiraOAntigoTambem(t *testing.T) {
	a := novoAmbiente(t)
	a.gravar(t, ".gemini/config/hooks.json", `{"escritorio-vivo":{"Stop":[]},"outra":{}}`+"\n")
	a.gravar(t, ".config/opencode/plugins/escritorio-vivo.js", string(antigoOpenCode(t)))
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	v := decodificar(t, a.ler(t, ".gemini/config/hooks.json")).(map[string]any)
	if _, ok := v["escritorio-vivo"]; ok || v["outra"] == nil {
		t.Errorf("o desfazer tira a entrada antiga e deixa a dos outros: %v", v)
	}
	if _, err := os.Stat(a.caminho(".config/opencode/plugins/escritorio-vivo.js")); !os.IsNotExist(err) {
		t.Error("o plugin antigo sai no desfazer")
	}
}

// antigoOpenCode é o plugin que o Escritório Vivo instalava (testdata), conferido pelo
// mesmo sha que o setup usa para reconhecê-lo.
func antigoOpenCode(t *testing.T) []byte {
	t.Helper()
	dados, err := os.ReadFile("testdata/opencode-escritorio-vivo.js")
	if err != nil {
		t.Fatal(err)
	}
	if hash(dados) != shaPluginOpenCodeAntigo {
		t.Fatal("o testdata não é o plugin do Escritório Vivo")
	}
	return dados
}

// O plugin antigo do MiniMax editado (sem o atalho do manifesto): o desfazer não pode
// cair, e o arquivo alheio fica.
func TestDesfazerComPluginAntigoDoMiniMaxEditado(t *testing.T) {
	a := novoAmbiente(t)
	a.gravar(t, ".minimax/plugins/escritorio-vivo/.claude-plugin/plugin.json", "{\"name\":\"editado\"}\n")
	p, err := Desfazer(a.op)
	if err != nil {
		t.Fatal(err)
	}
	if a.ler(t, ".minimax/plugins/escritorio-vivo/.claude-plugin/plugin.json") != "{\"name\":\"editado\"}\n" {
		t.Fatal("o plugin editado fica")
	}
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "plugin escritorio-vivo do Escritório Vivo foi alterado") {
		t.Errorf("faltou o aviso: %v", p.Avisos)
	}
}

// Com o MINIMAX_DATA_DIR fora da home, o plugin antigo de lá também sai.
func TestMiniMaxAntigoNoDataDirForaDaHome(t *testing.T) {
	a := novoAmbiente(t)
	os.RemoveAll(a.caminho(".minimax"))
	a.op.DirMiniMax = filepath.Join(a.raiz, "dados-mcode")
	antigo := filepath.Join(a.op.DirMiniMax, "plugins", marcaAntiga, ".claude-plugin", "plugin.json")
	os.MkdirAll(filepath.Dir(antigo), 0o755)
	os.WriteFile(antigo, manifestoMiniMax(a.op, marcaAntiga, descricaoMiniMaxAntiga), 0o644)
	aplicar(t, a.op)
	if _, err := os.Stat(filepath.Join(a.op.DirMiniMax, "plugins", marcaAntiga)); !os.IsNotExist(err) {
		t.Error("a pasta do plugin antigo deveria sair")
	}
	if _, err := os.Stat(filepath.Join(a.op.DirMiniMax, "plugins", marca, ".claude-plugin", "plugin.json")); err != nil {
		t.Errorf("o plugin novo entra: %v", err)
	}
}
