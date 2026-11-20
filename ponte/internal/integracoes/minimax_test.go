package integracoes

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
)

const pluginMiniMaxRel = ".minimax/plugins/firmopolis/.claude-plugin/plugin.json"

// O plugin é um arquivo só, com os hooks inline, o `ponte hook mcode` em cada evento e
// o timeout de 10 s (o máximo do mcode).
func TestMiniMaxPluginLocal(t *testing.T) {
	a := novoAmbiente(t)
	p := aplicar(t, a.op)
	texto := p.Texto()
	if !strings.Contains(texto, "== MiniMax Code: ") || !strings.Contains(texto, "(criar)") || !strings.Contains(texto, `ponte.exe' hook mcode`) {
		t.Errorf("o plano deveria mostrar o plugin que vai criar, com o comando:\n%s", texto)
	}

	v := decodificar(t, a.ler(t, pluginMiniMaxRel)).(map[string]any)
	if v["name"] != marca || v["version"] == nil || v["description"] == nil || v["author"] == nil {
		t.Fatalf("manifesto incompleto: %v", v)
	}
	// Sem o PreToolUse (cada hook síncrono custa uns 330 ms); com os do subagente.
	quero := []string{"SessionStart", "UserPromptSubmit", "PermissionRequest", "PostToolUse", "SubagentStart", "SubagentStop", "Stop", "SessionEnd"}
	if !slices.Equal(eventosMiniMax, quero) {
		t.Fatalf("eventos do mcode: %v, quero %v", eventosMiniMax, quero)
	}
	hooks := v["hooks"].(map[string]any)["hooks"].(map[string]any)
	if len(hooks) != len(eventosMiniMax) {
		t.Fatalf("esperava %d eventos, veio %v", len(eventosMiniMax), hooks)
	}
	for _, ev := range eventosMiniMax {
		h := hooks[ev].([]any)[0].(map[string]any)["hooks"].([]any)[0].(map[string]any)
		if h["type"] != "command" || h["command"] != comandoBash(a.op.Exe, "mcode") || h["timeout"] != float64(10) {
			t.Errorf("%s: hook errado: %v", ev, h)
		}
	}
	if got := a.ler(t, ".minimax/config.yaml"); got != "dataContribution: false\n" {
		t.Error("o config.yaml do mcode não pode mudar")
	}
	for _, b := range backups(t, a.raiz) {
		if strings.Contains(b, ".minimax") {
			t.Errorf("o plugin é todo nosso, sem backup: %s", b)
		}
	}
	if p := Planejar(a.op); !strings.Contains(strings.Join(p.Notas, "\n"), "MiniMax Code: já instalado") {
		t.Errorf("aplicar de novo não muda nada: %v", p.Notas)
	}
}

// O desfazer apaga o plugin e as pastas que a instalação criou, e só elas.
func TestMiniMaxDesfazerApagaAPasta(t *testing.T) {
	t.Run("plugins criada por nós", func(t *testing.T) {
		a := novoAmbiente(t)
		aplicar(t, a.op)
		if _, err := Desfazer(a.op); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(a.caminho(".minimax/plugins")); !os.IsNotExist(err) {
			t.Error("a pasta plugins, criada por nós, deveria ter saído")
		}
		if got := a.ler(t, ".minimax/config.yaml"); got != "dataContribution: false\n" {
			t.Error("o desfazer não toca no resto do .minimax")
		}
	})
	t.Run("plugins que já existia", func(t *testing.T) {
		a := novoAmbiente(t)
		a.gravar(t, ".minimax/plugins/outro/.claude-plugin/plugin.json", `{"name":"outro"}`)
		aplicar(t, a.op)
		if _, err := Desfazer(a.op); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(a.caminho(".minimax/plugins/firmopolis")); !os.IsNotExist(err) {
			t.Error("a pasta firmopolis deveria ter saído inteira")
		}
		if got := a.ler(t, ".minimax/plugins/outro/.claude-plugin/plugin.json"); got != `{"name":"outro"}` {
			t.Error("o plugin dos outros fica")
		}
	})
	t.Run("plugins vazia que já existia", func(t *testing.T) {
		a := novoAmbiente(t)
		if err := os.MkdirAll(a.caminho(".minimax/plugins"), 0o755); err != nil {
			t.Fatal(err)
		}
		aplicar(t, a.op)
		if _, err := Desfazer(a.op); err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(a.caminho(".minimax/plugins/firmopolis")); !os.IsNotExist(err) {
			t.Error("a pasta firmopolis deveria ter saído inteira")
		}
		if _, err := os.Stat(a.caminho(".minimax/plugins")); err != nil {
			t.Error("a pasta plugins já existia: a limpeza para na pasta que a instalação criou")
		}
	})
}

// A limpeza só sobe a partir de uma pasta de dentro da que a instalação criou.
func TestRemoverPastasVaziasForaDaPasta(t *testing.T) {
	a := novoAmbiente(t)
	fora := a.caminho("vazia/funda")
	if err := os.MkdirAll(fora, 0o755); err != nil {
		t.Fatal(err)
	}
	a.op.removerPastasVazias(fora, a.caminho(".minimax/plugins/firmopolis"))
	if _, err := os.Stat(fora); err != nil {
		t.Error("uma pasta fora da que criamos não pode sair, mesmo vazia")
	}
}

// bashDeVerdade é o bash que o mcode usa: o Git Bash no Windows.
func bashDeVerdade(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		bash := filepath.Join(os.Getenv("ProgramFiles"), "Git", "bin", "bash.exe")
		if _, err := os.Stat(bash); err != nil {
			t.Skip("sem o Git Bash")
		}
		return bash
	}
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("sem bash")
	}
	return bash
}

// O mcode roda o comando no Git Bash (bash -c), e o Codex, fora do Windows, no sh: o
// caminho do ponte.exe vai literal, sem expandir $, crase nem aspas.
func TestComandoBashNaoExpande(t *testing.T) {
	bash := bashDeVerdade(t)
	raiz := tempDir(t)
	pasta := filepath.Join(raiz, "a $HOME `touch crase` $(touch dolar) 'b' \"c\" d")
	if runtime.GOOS == "windows" {
		pasta = filepath.Join(raiz, "a $HOME `touch crase` $(touch dolar) 'b' d") // o Windows não aceita " no nome
	}
	if err := os.MkdirAll(pasta, 0o755); err != nil {
		t.Fatal(err)
	}
	// Um ponte de mentira: um script que grava os argumentos que recebeu.
	exe := filepath.Join(pasta, "ponte")
	if err := os.WriteFile(exe, []byte("#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$SAIDA\"\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	op := Opcoes{Home: filepath.Join(raiz, "home"), Exe: exe}
	plugin := decodificar(t, string(pluginMiniMax(op))).(map[string]any)["hooks"].(map[string]any)["hooks"].(map[string]any)
	comandos := map[string]string{
		"mcode": comandoDoGrupo(plugin["Stop"].([]any)[0]),
		"codex": comandoDoGrupo(decodificar(t, string(renderizar(grupoCodex(op, "Stop"), "", estilo{compacto: true})))),
	}
	for rota, comando := range comandos {
		t.Run(rota, func(t *testing.T) {
			saida := filepath.Join(raiz, rota+".txt")
			cmd := exec.Command(bash, "-c", comando)
			cmd.Dir = raiz
			cmd.Env = append(os.Environ(), "SAIDA="+saida)
			if out, err := cmd.CombinedOutput(); err != nil || len(out) > 0 {
				t.Fatalf("bash -c %s: %v, %q", comando, err, out)
			}
			dados, err := os.ReadFile(saida)
			if err != nil {
				t.Fatal(err)
			}
			if got := string(dados); got != "hook\n"+rota+"\n" {
				t.Errorf("argumentos: %q", got)
			}
			for _, f := range []string{"crase", "dolar"} {
				if _, err := os.Stat(filepath.Join(raiz, f)); !os.IsNotExist(err) {
					t.Errorf("o bash rodou o comando do caminho (%s)", f)
				}
			}
		})
	}
}

// comandoDoGrupo é o command do primeiro hook de um grupo {"matcher", "hooks": [...]}.
func comandoDoGrupo(grupo any) string {
	h := grupo.(map[string]any)["hooks"].([]any)[0].(map[string]any)
	return h["command"].(string)
}

// Com o MINIMAX_DATA_DIR fora da home, o plugin vai para lá, e nada para a home.
func TestMiniMaxDataDirForaDaHome(t *testing.T) {
	a := novoAmbiente(t)
	os.RemoveAll(a.caminho(".minimax"))
	a.op.DirMiniMax = filepath.Join(a.raiz, "dados-mcode")
	if err := os.MkdirAll(a.op.DirMiniMax, 0o755); err != nil {
		t.Fatal(err)
	}
	aplicar(t, a.op)
	arquivo := filepath.Join(a.op.DirMiniMax, "plugins", marca, ".claude-plugin", "plugin.json")
	if _, err := os.Stat(arquivo); err != nil {
		t.Fatalf("o plugin deveria estar no MINIMAX_DATA_DIR: %v", err)
	}
	if _, err := os.Stat(a.caminho(".minimax")); !os.IsNotExist(err) {
		t.Error("com o MINIMAX_DATA_DIR, nada vai para ~/.minimax")
	}
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	// A pasta plugins fica (vazia): fora da home, só a pasta do nosso plugin pode ser
	// tocada. O mcode cria a plugins sozinho, então ela não é nossa.
	if _, err := os.Stat(filepath.Join(a.op.DirMiniMax, "plugins", marca)); !os.IsNotExist(err) {
		t.Error("o desfazer deveria tirar a pasta do plugin do MINIMAX_DATA_DIR")
	}
	// Fora da pasta do plugin, o MINIMAX_DATA_DIR segue fora das raízes.
	if a.op.tocar(filepath.Join(a.op.DirMiniMax, "config.yaml")) == nil {
		t.Error("só a pasta do nosso plugin pode ser tocada no MINIMAX_DATA_DIR")
	}
}

// Um ponte.exe em outro lugar troca o comando no lugar, e o desfazer ainda reconhece
// o plugin da instalação anterior.
func TestMiniMaxExeNovo(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	a.op.Exe = filepath.Join(a.raiz, "outro lugar", "ponte.exe")
	aplicar(t, a.op)
	if got := a.ler(t, pluginMiniMaxRel); !strings.Contains(got, "outro lugar") {
		t.Fatalf("o comando deveria apontar para o ponte.exe novo:\n%s", got)
	}
	a.op.Exe = filepath.Join(a.raiz, "terceiro", "ponte.exe")
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(a.caminho(".minimax/plugins")); !os.IsNotExist(err) {
		t.Error("o plugin da última escrita é nosso pelo manifesto e deveria sair")
	}
}

func TestMiniMaxPluginAlheioFica(t *testing.T) {
	a := novoAmbiente(t)
	alheio := `{"name":"firmopolis","hooks":{}}`
	a.gravar(t, pluginMiniMaxRel, alheio)
	p := Planejar(a.op)
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "MiniMax Code: já existe um plugin") {
		t.Errorf("faltou avisar do plugin alheio: %v", p.Avisos)
	}
	if err := Aplicar(p); err != nil {
		t.Fatal(err)
	}
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	if got := a.ler(t, pluginMiniMaxRel); got != alheio {
		t.Fatal("um plugin que não é o nosso não pode ser sobrescrito nem apagado")
	}
}
