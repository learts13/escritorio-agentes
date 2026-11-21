package integracoes

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
	"time"
)

const tokenTeste = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// Os hooks do memoria que já existem nas configs reais (foco 3 do plano).
const settingsTerceiros = `{
  "permissions": {
    "defaultMode": "auto"
  },
  "model": "opus",
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"C:\\Python314\\python.exe\" \"C:\\Ferramentas\\memoria\\hooks\\claude_session_capture.py\" --quiet",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"C:\\Python314\\python.exe\" \"C:\\Ferramentas\\memoria\\hooks\\codex_context.py\"",
            "timeout": 10
          }
        ]
      }
    ]
  },
  "theme": "dark"
}
`

const agyTerceiros = `{
  "session-end-capture": {
    "Stop": [
      {
        "type": "command",
        "command": "\"C:\\Python314\\python.exe\" \"C:\\Ferramentas\\memoria\\hooks\\claude_session_capture.py\" --agent AGY --quiet",
        "timeout": 30
      }
    ]
  }
}
`

const codexTerceiros = `{
  "hooks": {
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"C:\\Python314\\python.exe\" \"C:\\Ferramentas\\memoria\\hooks\\claude_session_capture.py\" --agent CODEX --quiet",
            "timeout": 3,
            "commandWindows": "& 'C:\\Python314\\python.exe' 'C:\\Ferramentas\\memoria\\hooks\\claude_session_capture.py' --agent CODEX --quiet"
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "\"C:\\Python314\\python.exe\" \"C:\\Ferramentas\\memoria\\hooks\\claude_session_capture.py\" --agent CODEX --quiet",
            "timeout": 3
          }
        ]
      }
    ]
  }
}
`

const configTomlCodex = "model = \"gpt-6\"\n\n[hooks.state]\n"

type ambiente struct {
	op   Opcoes
	raiz string
}

// novoAmbiente monta uma home de mentira com as configs de terceiros e liga a guarda:
// qualquer escrita fora do TempDir falha o teste antes de acontecer.
func novoAmbiente(t *testing.T) *ambiente {
	t.Helper()
	raiz := tempDir(t)
	vigiar(t, raiz, nil)
	relogio := time.Date(2026, 11, 14, 22, 0, 0, 0, time.Local)
	a := &ambiente{raiz: raiz, op: Opcoes{
		Home:       filepath.Join(raiz, "home"),
		DirConfig:  filepath.Join(raiz, "config", "EscritorioVivo"),
		Gerenciado: filepath.Join(raiz, "gerenciado"),
		Exe:        filepath.Join(raiz, "Escritorio Vivo", "ponte.exe"),
		Token:      tokenTeste,
		Porta:      47820,
		Agora: func() time.Time {
			relogio = relogio.Add(time.Second)
			return relogio
		},
	}}
	a.gravar(t, ".claude/settings.json", settingsTerceiros)
	a.gravar(t, ".gemini/config/hooks.json", agyTerceiros)
	a.gravar(t, ".codex/hooks.json", codexTerceiros)
	a.gravar(t, ".codex/config.toml", configTomlCodex)
	a.gravar(t, ".config/opencode/opencode.jsonc", "{}\n")
	a.gravar(t, ".minimax/config.yaml", "dataContribution: false\n")
	return a
}

// tempDir é o t.TempDir com uma limpeza paciente: no Windows, o antivírus segura por
// um instante os arquivos recém-gravados, e o RemoveAll do TempDir falharia o teste.
func tempDir(t *testing.T) string {
	t.Helper()
	raiz := t.TempDir()
	t.Cleanup(func() { // roda antes da limpeza do próprio TempDir
		for i := 0; i < 40 && os.RemoveAll(raiz) != nil; i++ {
			time.Sleep(50 * time.Millisecond)
		}
	})
	return raiz
}

// vigiar instala a guarda de escrita; extra roda depois dela (simula outra edição).
func vigiar(t *testing.T, raiz string, extra func(caminho string)) {
	t.Helper()
	anterior := antesDeTocar
	antesDeTocar = func(caminho string) {
		if !dentroDe(raiz, caminho) {
			t.Fatalf("tentou mexer fora do TempDir: %s", caminho)
		}
		if extra != nil {
			extra(caminho)
		}
	}
	t.Cleanup(func() { antesDeTocar = anterior })
}

func (a *ambiente) caminho(rel string) string {
	return filepath.Join(a.op.Home, filepath.FromSlash(rel))
}

func (a *ambiente) gravar(t *testing.T, rel, conteudo string) {
	t.Helper()
	c := a.caminho(rel)
	if err := os.MkdirAll(filepath.Dir(c), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(c, []byte(conteudo), 0o644); err != nil {
		t.Fatal(err)
	}
}

func (a *ambiente) ler(t *testing.T, rel string) string {
	t.Helper()
	dados, err := os.ReadFile(a.caminho(rel))
	if err != nil {
		t.Fatal(err)
	}
	return string(dados)
}

// foto guarda o conteúdo de todos os arquivos da raiz.
func foto(t *testing.T, raiz string) map[string]string {
	t.Helper()
	f := map[string]string{}
	filepath.WalkDir(raiz, func(c string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			dados, _ := os.ReadFile(c)
			f[c] = string(dados)
		}
		return nil
	})
	return f
}

func backups(t *testing.T, raiz string) []string {
	t.Helper()
	var bs []string
	for c := range foto(t, raiz) {
		if strings.Contains(filepath.Base(c), ".bak-firmopolis-") {
			bs = append(bs, c)
		}
	}
	return bs
}

func aplicar(t *testing.T, op Opcoes) Plano {
	t.Helper()
	p := Planejar(op)
	if len(p.Erros) > 0 {
		t.Fatalf("plano com erro: %v", p.Erros)
	}
	if err := Aplicar(p); err != nil {
		t.Fatal(err)
	}
	return p
}

func decodificar(t *testing.T, s string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(s), &v); err != nil {
		t.Fatalf("JSON inválido depois da escrita: %v\n%s", err, s)
	}
	return v
}

// semNossos tira dos hooks (formato Claude/Codex) os grupos marcados como nossos,
// e as listas e o "hooks" que ficarem vazios.
func semNossos(v any, nosso func(any) bool) any {
	raiz := v.(map[string]any)
	hooks, ok := raiz["hooks"].(map[string]any)
	if !ok {
		return raiz
	}
	for ev, lista := range hooks {
		var resto []any
		for _, g := range lista.([]any) {
			if !nosso(g) {
				resto = append(resto, g)
			}
		}
		if len(resto) == 0 {
			delete(hooks, ev)
		} else {
			hooks[ev] = resto
		}
	}
	if len(hooks) == 0 {
		delete(raiz, "hooks")
	}
	return raiz
}

// linhasEmOrdem confere que cada linha do original segue no novo, na mesma ordem
// (a única mudança tolerada numa linha antiga é ganhar a vírgula do item seguinte).
func linhasEmOrdem(t *testing.T, antes, depois string) {
	t.Helper()
	novas := strings.Split(depois, "\n")
	j := 0
	for _, l := range strings.Split(antes, "\n") {
		for j < len(novas) && novas[j] != l && novas[j] != l+"," {
			j++
		}
		if j == len(novas) {
			t.Fatalf("a linha %q do original sumiu ou mudou de ordem:\n%s", l, depois)
		}
		j++
	}
}

func TestAplicarPreservaTerceiros(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)

	settings := a.ler(t, ".claude/settings.json")
	linhasEmOrdem(t, settingsTerceiros, settings)
	if got, want := semNossos(decodificar(t, settings), qualquerClaudeNosso), decodificar(t, settingsTerceiros); !reflect.DeepEqual(got, want) {
		t.Fatalf("o settings.json mudou fora da nossa marca:\n%v\n%v", got, want)
	}
	hooks := decodificar(t, settings).(map[string]any)["hooks"].(map[string]any)
	for _, ev := range eventosClaude {
		lista, ok := hooks[ev].([]any)
		if !ok || !qualquerClaudeNosso(lista[len(lista)-1]) {
			t.Errorf("faltou o nosso hook no fim de %s", ev)
		}
	}
	// O nosso vai depois do memoria, nunca antes.
	if stop := hooks["Stop"].([]any); len(stop) != 2 || grupoClaudeNosso(stop[0]) {
		t.Errorf("Stop deveria ter o do memoria e depois o nosso: %v", stop)
	}

	codex := a.ler(t, ".codex/hooks.json")
	linhasEmOrdem(t, codexTerceiros, codex)
	if got, want := semNossos(decodificar(t, codex), qualquerCodexNosso), decodificar(t, codexTerceiros); !reflect.DeepEqual(got, want) {
		t.Fatalf("o hooks.json do Codex mudou fora da nossa marca")
	}

	agy := a.ler(t, ".gemini/config/hooks.json")
	linhasEmOrdem(t, agyTerceiros, agy)
	v := decodificar(t, agy).(map[string]any)
	if _, ok := v[marca]; !ok {
		t.Fatal("faltou a entrada firmopolis no agy")
	}
	delete(v, marca)
	if !reflect.DeepEqual(any(v), decodificar(t, agyTerceiros)) {
		t.Fatal("o hooks.json do agy mudou fora da nossa marca")
	}

	if got := a.ler(t, ".config/opencode/plugins/firmopolis.js"); got != string(pluginOpenCode()) {
		t.Fatal("o plugin do OpenCode não foi copiado igual ao modelo")
	}
	if got := a.ler(t, ".codex/config.toml"); got != configTomlCodex {
		t.Fatalf("o config.toml do Codex não pode mudar (nada de trusted_hash forjado): %q", got)
	}
	if len(backups(t, a.raiz)) != 3 {
		t.Errorf("esperava 3 backups (os 3 JSON de terceiros), veio %v", backups(t, a.raiz))
	}
}

func TestHookClaudeEmSegundoPlanoSemShell(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	settings := a.ler(t, ".claude/settings.json")
	if strings.Contains(settings, tokenTeste) {
		t.Fatal("o token não vai mais no settings.json: o hook lê do arquivo da ponte")
	}
	hooks := decodificar(t, settings).(map[string]any)["hooks"].(map[string]any)
	lista := hooks["PreToolUse"].([]any)
	h := lista[0].(map[string]any)["hooks"].([]any)[0].(map[string]any)
	want := map[string]any{
		"type":    "command",
		"command": a.op.Exe,
		"args":    []any{"hook", "--porta", "47820", "claude"},
		"async":   true,
		"timeout": float64(10),
	}
	if !reflect.DeepEqual(h, want) {
		t.Fatalf("hook do Claude:\n%v\nquero\n%v", h, want)
	}
}

// hookHttpAntigo é o grupo que as versões anteriores do setup punham no Claude.
const hookHttpAntigo = `{"matcher": "", "hooks": [{"type": "http", "url": "http://127.0.0.1:47820/evento/claude",
  "headers": {"X-Ponte-Token": "` + tokenTeste + `", "X-Maestri-Terminal-Id": "$MAESTRI_TERMINAL_ID"},
  "allowedEnvVars": ["MAESTRI_TERMINAL_ID"], "timeout": 2}]}`

// TestTrocaOHookHttpAntigo: quem já tinha o hook http (que mostra erro em toda ação
// com a ponte desligada) ganha o command no mesmo lugar, e o desfazer tira os dois.
func TestTrocaOHookHttpAntigo(t *testing.T) {
	a := novoAmbiente(t)
	antigo := strings.Replace(settingsTerceiros, `"Stop": [`, `"PreToolUse": [`+hookHttpAntigo+`],
    "Stop": [`+hookHttpAntigo+`,`, 1)
	if antigo == settingsTerceiros {
		t.Fatal("o fixture mudou: não achei o Stop")
	}
	a.gravar(t, ".claude/settings.json", antigo)
	if !grupoClaudeNosso(decodificar(t, hookHttpAntigo)) {
		t.Fatal("o hook http antigo tem de ser reconhecido como nosso")
	}
	aplicar(t, a.op)
	settings := a.ler(t, ".claude/settings.json")
	if strings.Contains(settings, "/evento/claude") || strings.Contains(settings, tokenTeste) {
		t.Fatalf("o hook http antigo (e o token) deveria sair:\n%s", settings)
	}
	if n := strings.Count(settings, `"async": true`); n != len(eventosClaude) {
		t.Fatalf("esperava um hook nosso por evento, veio %d:\n%s", n, settings)
	}
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	final := a.ler(t, ".claude/settings.json")
	if strings.Contains(final, "async") || strings.Contains(final, "/evento/claude") {
		t.Fatalf("o desfazer deveria tirar o nosso, novo ou antigo:\n%s", final)
	}
}

func TestComandosCodexEAgy(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	exe := a.op.Exe

	codex := decodificar(t, a.ler(t, ".codex/hooks.json")).(map[string]any)["hooks"].(map[string]any)
	stop := codex["Stop"].([]any)
	h := stop[len(stop)-1].(map[string]any)["hooks"].([]any)[0].(map[string]any)
	if h["command"] != `'`+exe+`' hook codex` {
		t.Errorf("command do Codex: %v", h["command"])
	}
	if h["commandWindows"] != `& '`+exe+`' hook codex` {
		t.Errorf("commandWindows do Codex (PowerShell): %v", h["commandWindows"])
	}
	for _, ev := range eventosCodex {
		lista, ok := codex[ev].([]any)
		if !ok {
			t.Errorf("faltou o evento %s no Codex", ev)
			continue
		}
		// Em segundo plano, menos no SessionEnd, que o Codex só roda síncrono. No PermissionRequest,
		// o último é o `ponte decidir` (conferido abaixo); o do estado vem antes.
		i := len(lista) - 1
		if ev == eventoDecidir {
			i--
		}
		nosso := lista[i].(map[string]any)["hooks"].([]any)[0].(map[string]any)
		if async, _ := nosso["async"].(bool); async != (ev != "SessionEnd") {
			t.Errorf("Codex %s: async = %v", ev, nosso["async"])
		}
		// 10 s para o arranque frio; no SessionEnd e no Interrupt, o máximo do Codex.
		quero := float64(10)
		if ev == "SessionEnd" || ev == "Interrupt" {
			quero = 3
		}
		if nosso["timeout"] != quero {
			t.Errorf("Codex %s: timeout = %v, quero %v", ev, nosso["timeout"], quero)
		}
	}

	agy := decodificar(t, a.ler(t, ".gemini/config/hooks.json")).(map[string]any)[marca].(map[string]any)
	for _, ev := range eventosAgy {
		lista, ok := agy[ev].([]any)
		if !ok || lista[0].(map[string]any)["command"] != `"`+exe+`" hook agy` || lista[0].(map[string]any)["timeout"] != float64(10) {
			t.Errorf("agy %s: %v", ev, agy[ev])
		}
	}
}

func TestDesfazerVoltaByteAByte(t *testing.T) {
	a := novoAmbiente(t)
	antes := foto(t, a.op.Home)
	aplicar(t, a.op)

	p, err := Desfazer(a.op)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Erros) > 0 {
		t.Fatal(p.Erros)
	}
	depois := foto(t, a.op.Home)
	for c, conteudo := range antes {
		if depois[c] != conteudo {
			t.Errorf("%s não voltou byte a byte:\n%q\n%q", c, depois[c], conteudo)
		}
	}
	for c := range depois {
		if _, ok := antes[c]; !ok && !strings.Contains(c, ".bak-firmopolis-") {
			t.Errorf("sobrou um arquivo nosso: %s", c)
		}
	}
	if _, err := os.Stat(a.caminho(".config/opencode/plugins")); !os.IsNotExist(err) {
		t.Error("a pasta plugins, criada por nós, deveria ter saído")
	}
	if _, err := os.Stat(filepath.Join(a.op.DirConfig, "integracoes.json")); !os.IsNotExist(err) {
		t.Error("o manifesto deveria sair depois do desfazer")
	}
}

func TestDesfazerSemArquivoCriadoApaga(t *testing.T) {
	a := novoAmbiente(t)
	os.Remove(a.caminho(".claude/settings.json"))
	aplicar(t, a.op)
	if _, err := os.Stat(a.caminho(".claude/settings.json")); err != nil {
		t.Fatal("o settings.json deveria ter sido criado")
	}
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(a.caminho(".claude/settings.json")); !os.IsNotExist(err) {
		t.Fatal("o settings.json que nós criamos deveria sair no desfazer")
	}
}

func TestDesfazerNaoRestauraBackupVelhoPorCimaDeEdicaoNova(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)

	// O usuário edita o settings.json depois da instalação.
	editado := strings.Replace(a.ler(t, ".claude/settings.json"), `"theme": "dark"`, `"theme": "light",
  "autoUpdatesChannel": "latest"`, 1)
	a.gravar(t, ".claude/settings.json", editado)

	p, err := Desfazer(a.op)
	if err != nil {
		t.Fatal(err)
	}
	final := a.ler(t, ".claude/settings.json")
	if !strings.Contains(final, `"autoUpdatesChannel": "latest"`) || !strings.Contains(final, `"theme": "light"`) {
		t.Fatalf("o desfazer apagou a edição do usuário:\n%s", final)
	}
	if strings.Contains(final, "/evento/claude") {
		t.Fatalf("sobrou hook nosso:\n%s", final)
	}
	want := strings.Replace(settingsTerceiros, `"theme": "dark"`, `"theme": "light",
  "autoUpdatesChannel": "latest"`, 1)
	if final != want {
		t.Fatalf("a remoção cirúrgica deveria devolver o original com a edição:\n%s\nquero\n%s", final, want)
	}
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "editado depois") {
		t.Errorf("faltou avisar que o arquivo foi editado depois: %v", p.Avisos)
	}
}

func TestAplicarDuasVezesIdempotente(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	primeira := foto(t, a.raiz)

	p := Planejar(a.op)
	if len(p.Mudancas) != 0 {
		t.Fatalf("a segunda vez não deveria mudar nada: %+v", p.Mudancas)
	}
	if err := Aplicar(p); err != nil {
		t.Fatal(err)
	}
	if segunda := foto(t, a.raiz); !reflect.DeepEqual(primeira, segunda) {
		t.Fatal("a segunda aplicação mexeu em arquivos (ou criou backup)")
	}
}

func TestExeNovoAtualizaNoLugar(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	velhoJSON, _ := json.Marshal(a.op.Exe) // como o caminho aparece no settings.json
	if !strings.Contains(a.ler(t, ".claude/settings.json"), string(velhoJSON)) {
		t.Fatal("o exe da primeira aplicação deveria estar no settings.json")
	}
	a.op.Exe = filepath.Join(a.raiz, "outro lugar", "ponte.exe")
	aplicar(t, a.op)
	settings := a.ler(t, ".claude/settings.json")
	if strings.Contains(settings, string(velhoJSON)) || strings.Count(settings, `"async": true`) != len(eventosClaude) {
		t.Fatalf("o exe novo deveria trocar o velho, sem duplicar o hook:\n%s", settings)
	}
	// Mesmo depois de duas escritas nossas, o desfazer volta ao original.
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	if got := a.ler(t, ".claude/settings.json"); got != settingsTerceiros {
		t.Fatalf("o desfazer depois de duas aplicações deveria voltar ao original:\n%s", got)
	}
}

func TestJSONInvalidoNaoToca(t *testing.T) {
	a := novoAmbiente(t)
	a.gravar(t, ".claude/settings.json", settingsTerceiros[:200])
	antes := foto(t, a.raiz)

	p := Planejar(a.op)
	if len(p.Erros) == 0 || !strings.Contains(p.Erros[0], "settings.json") {
		t.Fatalf("o plano deveria explicar o JSON inválido: %v", p.Erros)
	}
	if err := Aplicar(p); err == nil {
		t.Fatal("aplicar com erro no plano deveria falhar")
	}
	if depois := foto(t, a.raiz); !reflect.DeepEqual(antes, depois) {
		t.Fatal("com um JSON inválido, nenhum arquivo pode mudar")
	}
}

func TestEstruturaInesperadaNaoToca(t *testing.T) {
	a := novoAmbiente(t)
	a.gravar(t, ".codex/hooks.json", `{"hooks": []}`)
	p := Planejar(a.op)
	if len(p.Erros) != 1 || !strings.Contains(p.Erros[0], "hooks.json") {
		t.Fatalf("hooks que não é objeto deveria virar erro: %v", p.Erros)
	}
}

func TestEdicaoConcorrenteReplaneja(t *testing.T) {
	a := novoAmbiente(t)
	alvo := a.caminho(".claude/settings.json")
	editou := false
	vigiar(t, a.raiz, func(c string) {
		if c == alvo && !editou {
			editou = true // o usuário salva o arquivo entre o plano e o rename
			dados, _ := os.ReadFile(alvo)
			os.WriteFile(alvo, bytes.Replace(dados, []byte(`"model": "opus"`), []byte(`"model": "sonnet"`), 1), 0o644)
		}
	})
	aplicar(t, a.op)
	final := a.ler(t, ".claude/settings.json")
	if !strings.Contains(final, `"model": "sonnet"`) {
		t.Fatalf("a edição concorrente do usuário se perdeu:\n%s", final)
	}
	if strings.Count(final, `"async": true`) != len(eventosClaude) {
		t.Fatalf("depois de replanejar, os hooks deveriam estar lá uma vez só:\n%s", final)
	}
}

func TestPreservaCRLFERecuoComTab(t *testing.T) {
	a := novoAmbiente(t)
	original := strings.ReplaceAll(strings.ReplaceAll(settingsTerceiros, "  ", "\t"), "\n", "\r\n")
	a.gravar(t, ".claude/settings.json", original)
	aplicar(t, a.op)

	novo := a.ler(t, ".claude/settings.json")
	if strings.Count(novo, "\n") != strings.Count(novo, "\r\n") {
		t.Fatal("o arquivo com CRLF ganhou linhas só com LF")
	}
	if strings.Contains(novo, "\n  ") {
		t.Fatal("o recuo com tab ganhou linhas com espaços")
	}
	decodificar(t, novo)
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	if got := a.ler(t, ".claude/settings.json"); got != original {
		t.Fatal("o desfazer não voltou o arquivo CRLF byte a byte")
	}
}

func TestPreservaPermissao(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("permissão Unix")
	}
	a := novoAmbiente(t)
	os.Chmod(a.caminho(".claude/settings.json"), 0o600)
	aplicar(t, a.op)
	info, err := os.Stat(a.caminho(".claude/settings.json"))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("a permissão 0600 deveria ser mantida: %v %v", info.Mode(), err)
	}
}

func TestNaoInstaladoFicaDeFora(t *testing.T) {
	a := novoAmbiente(t)
	os.RemoveAll(a.caminho(".gemini"))
	os.RemoveAll(a.caminho(".config/opencode"))
	os.RemoveAll(a.caminho(".minimax"))
	aplicar(t, a.op)
	if _, err := os.Stat(a.caminho(".minimax")); !os.IsNotExist(err) {
		t.Error("sem MiniMax Code instalado, a pasta .minimax não pode ser criada")
	}
	if _, err := os.Stat(a.caminho(".gemini")); !os.IsNotExist(err) {
		t.Error("sem agy instalado, a pasta .gemini não pode ser criada")
	}
	if _, err := os.Stat(a.caminho(".config/opencode")); !os.IsNotExist(err) {
		t.Error("sem OpenCode instalado, a pasta não pode ser criada")
	}
}

func TestPluginAlheioNaoEApagadoNemSobrescrito(t *testing.T) {
	a := novoAmbiente(t)
	alheio := "// plugin de outra pessoa com o mesmo nome\n"
	a.gravar(t, ".config/opencode/plugins/firmopolis.js", alheio)

	p := Planejar(a.op)
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "firmopolis.js") {
		t.Errorf("faltou avisar do plugin alheio: %v", p.Avisos)
	}
	if err := Aplicar(p); err != nil {
		t.Fatal(err)
	}
	if got := a.ler(t, ".config/opencode/plugins/firmopolis.js"); got != alheio {
		t.Fatal("o plugin alheio foi sobrescrito")
	}
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	if got := a.ler(t, ".config/opencode/plugins/firmopolis.js"); got != alheio {
		t.Fatal("o desfazer apagou um plugin que não é o nosso")
	}
}

func TestPluginEditadoDepoisFica(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	a.gravar(t, ".config/opencode/plugins/firmopolis.js", "// mexi no plugin\n")
	p, err := Desfazer(a.op)
	if err != nil {
		t.Fatal(err)
	}
	if got := a.ler(t, ".config/opencode/plugins/firmopolis.js"); got != "// mexi no plugin\n" {
		t.Fatal("o desfazer apagou um plugin com hash diferente do nosso")
	}
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "firmopolis.js") {
		t.Errorf("faltou avisar que o plugin ficou: %v", p.Avisos)
	}
}

func TestPlanoMostraOQueMudaSemToken(t *testing.T) {
	a := novoAmbiente(t)
	antes := foto(t, a.raiz)
	p := Planejar(a.op)
	texto := p.Texto()
	if depois := foto(t, a.raiz); !reflect.DeepEqual(antes, depois) {
		t.Fatal("o plano não pode escrever nada")
	}
	if strings.Contains(texto, tokenTeste) {
		t.Fatal("o plano mostrou o token")
	}
	for _, quero := range []string{
		a.caminho(".claude/settings.json"), a.caminho(".codex/hooks.json"),
		a.caminho(".gemini/config/hooks.json"), a.caminho(".config/opencode/plugins/firmopolis.js"),
		`+ `, `"async": true`, "hook --porta 47820 claude", "/hooks", "reiniciar",
	} {
		if !strings.Contains(texto, quero) {
			t.Errorf("o plano deveria mostrar %q:\n%s", quero, texto)
		}
	}
}

func TestCodexAvisaAprovacaoEHashNovo(t *testing.T) {
	a := novoAmbiente(t)
	p := Planejar(a.op)
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "/hooks") {
		t.Fatalf("o plano deveria ensinar a aprovar no Codex: %v", p.Avisos)
	}
	aplicar(t, a.op)

	a.op.Exe = filepath.Join(a.raiz, "outro lugar", "ponte.exe")
	p = Planejar(a.op)
	avisos := strings.Join(p.Avisos, "\n")
	if !strings.Contains(avisos, "hash") || !strings.Contains(avisos, "/hooks") {
		t.Fatalf("com o comando novo, o plano deveria avisar que o hash mudou: %v", p.Avisos)
	}
}

func TestCodexAvisaIndiceDosOutrosNoDesfazer(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	// Depois da instalação, outra ferramenta põe um hook depois do nosso no Stop.
	codex := a.ler(t, ".codex/hooks.json")
	v := decodificar(t, codex).(map[string]any)
	stop := v["hooks"].(map[string]any)["Stop"].([]any)
	novo := map[string]any{"matcher": "", "hooks": []any{map[string]any{"type": "command", "command": "outro"}}}
	v["hooks"].(map[string]any)["Stop"] = append(stop, novo)
	dados, _ := json.MarshalIndent(v, "", "  ")
	a.gravar(t, ".codex/hooks.json", string(dados))

	p, err := Desfazer(a.op)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(p.Avisos, "\n"), "aprovação") {
		t.Fatalf("faltou avisar que os hooks depois do nosso mudam de posição: %v", p.Avisos)
	}
}

func TestClaudeAvisaBloqueioPorPolitica(t *testing.T) {
	casos := []struct {
		nome, gerenciado, global string
		bloqueia                 bool
	}{
		{"sem política", "", "", false},
		{"lista de urls http não vale para command", `{"allowedHttpHookUrls": []}`, "", false},
		{"só hooks gerenciados", `{"allowManagedHooksOnly": true}`, "", true},
		{"hooks desligados", "", `{"disableAllHooks": true}`, true},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			a := novoAmbiente(t)
			if c.gerenciado != "" {
				os.MkdirAll(filepath.Join(a.op.Gerenciado, "managed-settings.d"), 0o755)
				os.WriteFile(filepath.Join(a.op.Gerenciado, "managed-settings.d", "10-politica.json"), []byte(c.gerenciado), 0o644)
			}
			if c.global != "" {
				a.gravar(t, ".claude/settings.json", c.global)
			}
			p := Planejar(a.op)
			bloqueia := strings.Contains(strings.Join(p.Avisos, "\n"), "bloqueia")
			if bloqueia != c.bloqueia {
				t.Fatalf("aviso de bloqueio = %v, quero %v: %v", bloqueia, c.bloqueia, p.Avisos)
			}
		})
	}
}

func TestDentroDe(t *testing.T) {
	raiz := filepath.Join(t.TempDir(), "home")
	casos := map[string]bool{
		filepath.Join(raiz, ".claude", "settings.json"): true,
		raiz:                                   true,
		filepath.Join(raiz, "..", "fora.json"): false,
		filepath.Join(raiz+"2", "x.json"):      false,
	}
	for c, quero := range casos {
		if got := dentroDe(raiz, c); got != quero {
			t.Errorf("dentroDe(%q) = %v, quero %v", c, got, quero)
		}
	}
}

func TestRecusaEscreverForaDasRaizes(t *testing.T) {
	a := novoAmbiente(t)
	fora := filepath.Join(a.raiz, "fora", "x.json")
	vigiar(t, a.raiz, nil)
	if err := a.op.escrever(fora, []byte("{}"), ""); err == nil {
		t.Fatal("escrever fora da home e da config da ponte deveria falhar")
	}
	if _, err := os.Stat(fora); !os.IsNotExist(err) {
		t.Fatal("o arquivo de fora não pode existir")
	}
}

func TestDesfazerQueRestauraNaoGuardaOToken(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	for _, b := range backups(t, a.raiz) {
		if dados, _ := os.ReadFile(b); strings.Contains(string(dados), tokenTeste) {
			t.Errorf("sobrou backup com o token depois do desfazer: %s", b)
		}
	}
}

func TestDesfazerCirurgicoGuardaBackupDaEdicao(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	editado := strings.Replace(a.ler(t, ".claude/settings.json"), `"model": "opus"`, `"model": "sonnet"`, 1)
	a.gravar(t, ".claude/settings.json", editado)
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	// O backup guarda a edição do usuário, mas com o token mascarado.
	quero := strings.ReplaceAll(editado, tokenTeste, "<token>")
	achou := false
	for _, b := range backups(t, a.raiz) {
		dados, _ := os.ReadFile(b)
		if strings.Contains(string(dados), tokenTeste) {
			t.Errorf("backup com o token: %s", b)
		}
		if string(dados) == quero {
			achou = true
		}
	}
	if !achou {
		t.Fatal("antes de tirar o nosso de um arquivo editado, o desfazer deveria guardar backup dele")
	}
}

func TestNenhumBackupGuardaOToken(t *testing.T) {
	a := novoAmbiente(t)
	aplicar(t, a.op)
	a.op.Token = strings.Repeat("e", 64) // token novo: a 2ª instalação faz backup do arquivo com o velho
	aplicar(t, a.op)
	for _, b := range backups(t, a.raiz) {
		if dados, _ := os.ReadFile(b); strings.Contains(string(dados), tokenTeste) {
			t.Errorf("backup com o token velho: %s", b)
		}
	}
}

func TestRestosListaOsBackups(t *testing.T) {
	a := novoAmbiente(t)
	if r := Restos(a.op); len(r) != 0 {
		t.Fatalf("sem instalação, não há restos: %v", r)
	}
	aplicar(t, a.op)
	if _, err := Desfazer(a.op); err != nil {
		t.Fatal(err)
	}
	if r := Restos(a.op); len(r) != len(backups(t, a.raiz)) || len(r) == 0 {
		t.Fatalf("Restos = %v, os backups são %v", r, backups(t, a.raiz))
	}
}
