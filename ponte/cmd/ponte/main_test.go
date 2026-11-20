package main

import (
	"bytes"
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"firmopolis/ponte/internal/servidor"
)

const tokenTeste = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

var (
	exe   string // o ponte compilado para os testes
	fundo string // o ponte-fundo.exe (-H=windowsgui), só no Windows
)

func TestMain(m *testing.M) {
	dir, err := os.MkdirTemp("", "ponte-teste-")
	if err != nil {
		panic(err)
	}
	exe = filepath.Join(dir, "ponte.exe")
	if saida, err := exec.Command("go", "build", "-o", exe, ".").CombinedOutput(); err != nil {
		os.RemoveAll(dir)
		panic(string(saida))
	}
	if runtime.GOOS == "windows" {
		fundo = filepath.Join(dir, nomeFundo)
		if saida, err := exec.Command("go", "build", "-ldflags=-H=windowsgui", "-o", fundo, ".").CombinedOutput(); err != nil {
			os.RemoveAll(dir)
			panic(string(saida))
		}
	}
	codigo := m.Run()
	os.RemoveAll(dir)
	os.Exit(codigo)
}

// pastaTemp é o t.TempDir() de quem grava arquivo. Logo depois da gravação, o antivírus
// ainda segura o arquivo por alguns ms, e a limpeza do TempDir falha com "The directory
// is not empty" (cerca de 1 em 300; ver o README). Aqui ela tenta de novo por até 2 s.
func pastaTemp(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "ponte-teste-cmd-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		var err error
		for fim := time.Now().Add(2 * time.Second); ; time.Sleep(20 * time.Millisecond) {
			if err = os.RemoveAll(dir); err == nil || time.Now().After(fim) {
				break
			}
		}
		if err != nil {
			t.Errorf("não deu para apagar %s: %v", dir, err)
		}
	})
	return dir
}

// envConfig aponta a pasta de config do usuário (onde fica o token) para dir, nos 3
// sistemas, e põe o MAESTRI_TERMINAL_ID.
func envConfig(t *testing.T, comToken bool) []string {
	t.Helper()
	env, _ := configurar(t, comToken)
	return env
}

// configurar é o envConfig que também diz onde fica a pasta da ponte (token e manifesto).
func configurar(t *testing.T, comToken bool) ([]string, string) {
	t.Helper()
	dir := pastaTemp(t)
	cfg := filepath.Join(dir, "Firmopolis")
	if runtime.GOOS == "darwin" {
		cfg = filepath.Join(dir, "Library", "Application Support", "Firmopolis")
	}
	if comToken {
		os.MkdirAll(cfg, 0o700)
		os.WriteFile(filepath.Join(cfg, "token"), []byte(tokenTeste+"\n"), 0o600)
	}
	return append(os.Environ(), "APPDATA="+dir, "XDG_CONFIG_HOME="+dir, "HOME="+dir, "MAESTRI_TERMINAL_ID=T9"), cfg
}

type recebido struct {
	rota   string
	header http.Header
	corpo  []byte
}

// pontoFalso é uma ponte de mentira que guarda o que chegou; espera segura a resposta.
func pontoFalso(t *testing.T, espera time.Duration) (porta int, chegou func() []recebido) {
	t.Helper()
	var mu sync.Mutex
	var lista []recebido
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		corpo, _ := io.ReadAll(r.Body)
		mu.Lock()
		lista = append(lista, recebido{r.URL.Path, r.Header.Clone(), corpo})
		mu.Unlock()
		select {
		case <-time.After(espera):
		case <-r.Context().Done():
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(ts.Close)
	return ts.Listener.Addr().(*net.TCPAddr).Port, func() []recebido {
		mu.Lock()
		defer mu.Unlock()
		return append([]recebido(nil), lista...)
	}
}

type resultado struct {
	codigo  int
	stdout  string
	stderr  string
	duracao time.Duration
}

func rodarHook(t *testing.T, env []string, stdin io.Reader, args ...string) resultado {
	t.Helper()
	// Prazo: um hook que não sai falha o teste em vez de pendurá-lo.
	ctx, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	cmd := exec.CommandContext(ctx, exe, append([]string{"hook"}, args...)...)
	cmd.Env = env
	cmd.Stdin = stdin
	var out, errb bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &errb
	ini := time.Now()
	err := cmd.Run()
	r := resultado{stdout: out.String(), stderr: errb.String(), duracao: time.Since(ini)}
	if e, ok := err.(*exec.ExitError); ok {
		r.codigo = e.ExitCode()
	} else if err != nil {
		t.Fatal(err)
	}
	return r
}

func calado(t *testing.T, r resultado) {
	t.Helper()
	if r.codigo != 0 || r.stdout != "" || r.stderr != "" {
		t.Fatalf("o hook tem de sair com 0 e calado: código %d, stdout %q, stderr %q", r.codigo, r.stdout, r.stderr)
	}
}

// maisRapido roda o hook (calado) até 3 vezes e devolve a duração mais curta, parando
// na primeira dentro do limite. A duração inclui criar o processo, que às vezes passa
// de meio segundo com a máquina carregada (o go test ./... roda os pacotes em paralelo)
// ou com o antivírus examinando o exe. Um hook que espere o prazo de verdade fica acima
// do limite nas 3.
func maisRapido(t *testing.T, limite time.Duration, rodar func() resultado) time.Duration {
	t.Helper()
	var menor time.Duration
	for i := 0; i < 3; i++ {
		r := rodar()
		calado(t, r)
		if i == 0 || r.duracao < menor {
			menor = r.duracao
		}
		if menor <= limite {
			break
		}
	}
	return menor
}

func TestHookRepassaComPIDDoPai(t *testing.T) {
	for _, rota := range []string{"claude", "agy", "codex", "mcode"} {
		t.Run(rota, func(t *testing.T) { repassaComPIDDoPai(t, rota) })
	}
}

func repassaComPIDDoPai(t *testing.T, rota string) {
	porta, chegou := pontoFalso(t, 0)
	corpo := `{"session_id":"s1","hook_event_name":"Stop","cwd":"C:\\proj"}`
	antes := time.Now().Add(-time.Second) // folga: a hora de criação vem do relógio do sistema
	r := rodarHook(t, envConfig(t, true), strings.NewReader(corpo), "--porta", strconv.Itoa(porta), rota)
	calado(t, r)

	lista := chegou()
	if len(lista) != 1 {
		t.Fatalf("esperava 1 POST, vieram %d", len(lista))
	}
	got := lista[0]
	if got.rota != "/evento/"+rota || string(got.corpo) != corpo {
		t.Fatalf("rota ou corpo errado: %s %q", got.rota, got.corpo)
	}
	if got.header.Get("X-Ponte-Token") != tokenTeste || got.header.Get("X-Maestri-Terminal-Id") != "T9" {
		t.Fatalf("headers: %v", got.header)
	}
	// O pai do ponte.exe é quem rodou o hook (aqui, o próprio teste): a ponte sobe dele
	// até o agente, e não para no ponte.exe, que não é shell.
	if pid := got.header.Get("X-Ponte-PID-Hook"); pid != strconv.Itoa(os.Getpid()) {
		t.Fatalf("X-Ponte-PID-Hook = %s, quero o PID do pai %d", pid, os.Getpid())
	}
	// A hora é a da criação do processo, de antes do POST.
	ms, err := strconv.ParseInt(got.header.Get("X-Ponte-Hora"), 10, 64)
	if hora := time.UnixMilli(ms); err != nil || hora.Before(antes) || hora.After(time.Now()) {
		t.Fatalf("X-Ponte-Hora = %q, quero a hora de criação do hook", got.header.Get("X-Ponte-Hora"))
	}
}

func TestHookNuncaPassaDeUmSegundo(t *testing.T) {
	porta, _ := pontoFalso(t, 5*time.Second) // ponte travada
	limite := 1100 * time.Millisecond
	if d := maisRapido(t, limite, func() resultado {
		return rodarHook(t, envConfig(t, true), strings.NewReader(`{}`), "--porta", strconv.Itoa(porta), "agy")
	}); d > limite {
		t.Fatalf("com a ponte travada, o hook levou %v (limite 1 s)", d)
	}

	// stdin que nunca fecha também não segura o agente.
	// Um pipe de verdade (os.Pipe): com io.Pipe, o Wait esperaria a cópia do stdin.
	leitor, escritor, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	defer leitor.Close()
	defer escritor.Close()
	if d := maisRapido(t, limite, func() resultado {
		return rodarHook(t, envConfig(t, true), leitor, "--porta", strconv.Itoa(porta), "agy")
	}); d > limite {
		t.Fatalf("com o stdin aberto, o hook levou %v (limite 1 s)", d)
	}
}

func TestHookSemPonteSemTokenOuRotaRuim(t *testing.T) {
	ln, _ := net.Listen("tcp", "127.0.0.1:0")
	livre := ln.Addr().(*net.TCPAddr).Port
	ln.Close()
	if d := maisRapido(t, 500*time.Millisecond, func() resultado {
		return rodarHook(t, envConfig(t, true), strings.NewReader(`{}`), "--porta", strconv.Itoa(livre), "codex")
	}); d > 500*time.Millisecond {
		t.Errorf("sem ponte, o hook deveria sair logo: %v", d)
	}

	porta, chegou := pontoFalso(t, 0)
	calado(t, rodarHook(t, envConfig(t, false), strings.NewReader(`{}`), "--porta", strconv.Itoa(porta), "codex"))
	calado(t, rodarHook(t, envConfig(t, true), strings.NewReader(`{}`), "--porta", strconv.Itoa(porta), "opencode"))
	calado(t, rodarHook(t, envConfig(t, true), strings.NewReader(`{}`), "--porta", strconv.Itoa(porta)))
	if n := len(chegou()); n != 0 {
		t.Fatalf("sem token ou com rota inválida, nada pode ser enviado: %d", n)
	}
}

func TestSetupPlanoNaoEscreve(t *testing.T) {
	env := envConfig(t, true)
	home := pastaTemp(t)
	settings := filepath.Join(home, ".claude", "settings.json")
	os.MkdirAll(filepath.Dir(settings), 0o755)
	os.WriteFile(settings, []byte("{\n  \"theme\": \"dark\"\n}\n"), 0o644)

	cmd := comando(t, "setup", "--plano", "--home", home)
	cmd.Env = env
	saida, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("%v\n%s", err, saida)
	}
	texto := string(saida)
	if !strings.Contains(texto, settings) || !strings.Contains(texto, `"async": true`) || strings.Contains(texto, tokenTeste) {
		t.Fatalf("o plano deveria mostrar o settings.json e o hook, sem o token:\n%s", texto)
	}
	if dados, _ := os.ReadFile(settings); string(dados) != "{\n  \"theme\": \"dark\"\n}\n" {
		t.Fatal("o --plano escreveu no settings.json")
	}
	if itens, _ := os.ReadDir(filepath.Dir(settings)); len(itens) != 1 {
		t.Fatalf("o --plano criou arquivos: %v", itens)
	}
}

func TestSetupExigeUmModo(t *testing.T) {
	for _, args := range [][]string{{"setup"}, {"setup", "--plano", "--aplicar"}} {
		cmd := comando(t, args...)
		cmd.Env = envConfig(t, true)
		if saida, err := cmd.CombinedOutput(); err == nil {
			t.Errorf("%v deveria falhar:\n%s", args, saida)
		}
	}
}

// O plugin do mcode vai para o MINIMAX_DATA_DIR, se houver; com --home, sempre para
// <home>/.minimax, para uma cópia das configs nunca tocar a pasta real.
func TestOpcoesSetupDirMiniMax(t *testing.T) {
	raiz := pastaTemp(t)
	t.Setenv("USERPROFILE", filepath.Join(raiz, "usuario"))
	t.Setenv("HOME", filepath.Join(raiz, "usuario"))
	t.Setenv("APPDATA", filepath.Join(raiz, "appdata"))
	t.Setenv("XDG_CONFIG_HOME", filepath.Join(raiz, "appdata"))
	t.Chdir(raiz)
	casos := []struct{ nome, env, home, quero string }{
		{"sem a variável", "", "", ""},
		{"com a variável", filepath.Join(raiz, "dados"), "", filepath.Join(raiz, "dados")},
		{"variável relativa", "dados", "", filepath.Join(raiz, "dados")},
		{"--home ignora a variável", filepath.Join(raiz, "dados"), filepath.Join(raiz, "copia"), ""},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			t.Setenv("MINIMAX_DATA_DIR", c.env)
			op, err := opcoesSetup(c.home)
			if err != nil {
				t.Fatal(err)
			}
			if op.DirMiniMax != c.quero {
				t.Fatalf("DirMiniMax = %q, quero %q", op.DirMiniMax, c.quero)
			}
		})
	}
}

// comando prepara o ponte com prazo de 10 s.
func comando(t *testing.T, args ...string) *exec.Cmd {
	t.Helper()
	ctx, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancelar)
	return exec.CommandContext(ctx, exe, args...)
}

// homeComClaude monta uma home de teste com um settings.json do Claude.
func homeComClaude(t *testing.T, conteudo string) (home, settings string) {
	t.Helper()
	home = pastaTemp(t)
	settings = filepath.Join(home, ".claude", "settings.json")
	os.MkdirAll(filepath.Dir(settings), 0o755)
	os.WriteFile(settings, []byte(conteudo), 0o644)
	return home, settings
}

func TestSetupAplicarComErroNaoCriaToken(t *testing.T) {
	env, cfg := configurar(t, false)
	home, settings := homeComClaude(t, `{"hooks": `)
	cmd := comando(t, "setup", "--aplicar", "--home", home)
	cmd.Env = env
	saida, err := cmd.CombinedOutput()
	if err == nil {
		t.Fatalf("--aplicar com JSON inválido deveria falhar:\n%s", saida)
	}
	if _, err := os.Stat(filepath.Join(cfg, "token")); !os.IsNotExist(err) {
		t.Fatal("com erro no plano, o --aplicar não pode criar o token")
	}
	if dados, _ := os.ReadFile(settings); string(dados) != `{"hooks": ` {
		t.Fatal("o settings.json inválido foi alterado")
	}
}

func TestSetupDesfazerDizOQueFicou(t *testing.T) {
	env, _ := configurar(t, true)
	home, _ := homeComClaude(t, "{\n  \"theme\": \"dark\"\n}\n")
	for _, modo := range []string{"--aplicar", "--desfazer"} {
		cmd := comando(t, "setup", modo, "--home", home)
		cmd.Env = env
		saida, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("%s: %v\n%s", modo, err, saida)
		}
		if modo == "--desfazer" {
			texto := string(saida)
			if strings.Contains(texto, "não sobrou nada") || !strings.Contains(texto, ".bak-firmopolis-") {
				t.Fatalf("com backups no disco, o desfazer não pode dizer que não sobrou nada:\n%s", texto)
			}
		}
	}
}

func TestSetupAutostartSoComUsuarioReal(t *testing.T) {
	home, _ := homeComClaude(t, "{}\n")
	for _, args := range [][]string{
		{"setup", "--plano", "--autostart", "--home", home},
		{"setup", "--desfazer", "--autostart"},
		{"setup", "--plano", "--autostart"}, // o exe do teste não está no bin instalado
	} {
		cmd := comando(t, args...)
		cmd.Env = envConfig(t, true)
		if saida, err := cmd.CombinedOutput(); err == nil {
			t.Errorf("%v deveria falhar:\n%s", args, saida)
		}
	}
}

// TestAutostartGravaLeTira usa uma chave de teste no lugar da Run de verdade, mas
// ainda no HKCU do usuário: só roda com PONTE_TESTE_REGISTRO=1.
func TestAutostartGravaLeTira(t *testing.T) {
	if runtime.GOOS != "windows" || os.Getenv("PONTE_TESTE_REGISTRO") != "1" {
		t.Skip("grava no HKCU (chave de teste): PONTE_TESTE_REGISTRO=1, no Windows")
	}
	const raiz = `HKCU\Software\FirmopolisTeste`
	anterior := chaveRun
	chaveRun = raiz + `\Run`
	t.Cleanup(func() {
		chaveRun = anterior
		exec.Command("reg", "delete", raiz, "/f").Run()
	})

	exe := `C:\Users\Fulano de Tal\AppData\Local\Firmopolis\bin\ponte-fundo.exe`
	comando := comandoAutostart(exe)
	if comando != `"`+exe+`"` {
		t.Fatalf("comando do autostart: %s", comando)
	}
	if _, ok := lerAutostart(); ok {
		t.Fatal("a chave de teste deveria começar vazia")
	}
	if !strings.Contains(planoAutostart(exe), " = "+comando) {
		t.Fatalf("o plano deveria mostrar o comando: %s", planoAutostart(exe))
	}
	if err := gravarAutostart(comando); err != nil {
		t.Fatal(err)
	}
	if got, ok := lerAutostart(); !ok || got != comando {
		t.Fatalf("lido %q, gravado %q", got, comando)
	}
	if !strings.Contains(planoAutostart(exe), "já está ligado") {
		t.Fatalf("o plano deveria dizer que já está ligado: %s", planoAutostart(exe))
	}
	if tirado, err := tirarAutostart(); err != nil || tirado != comando {
		t.Fatalf("tirarAutostart = %q, %v", tirado, err)
	}
	if _, ok := lerAutostart(); ok {
		t.Fatal("o valor deveria ter saído")
	}

	// Valor com o nosso nome que não termina num ponte-fundo.exe fica.
	for _, alheio := range []string{`"C:\outro\app.exe"`, `"C:\outro\minha-ponte-fundo.exe"`, `"C:\outro\ponte.exe"`, `"C:\x\ponte-fundo.exe" --outra-coisa`} {
		if err := gravarAutostart(alheio); err != nil {
			t.Fatal(err)
		}
		if tirado, err := tirarAutostart(); err != nil || tirado != "" {
			t.Fatalf("%s não é nosso, não podia sair: %q, %v", alheio, tirado, err)
		}
		if _, ok := lerAutostart(); !ok {
			t.Fatalf("o valor de outro sumiu: %s", alheio)
		}
	}
}

// TestExeFundoSoNoBinInstalado: o --autostart só grava o ponte-fundo.exe do bin
// instalado, e só se ele foi compilado sem console.
func TestExeFundoSoNoBinInstalado(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("o autostart é do Windows")
	}
	local := pastaTemp(t)
	t.Setenv("LOCALAPPDATA", local)
	bin := filepath.Join(local, "Firmopolis", "bin")
	os.MkdirAll(bin, 0o700)
	instalado := filepath.Join(bin, "ponte.exe")

	if _, err := exeFundo(exe); err == nil || !strings.Contains(err.Error(), "instalado") {
		t.Fatalf("exe fora do bin deveria ser recusado: %v", err)
	}
	if _, err := exeFundo(instalado); err == nil || !strings.Contains(err.Error(), "falta") {
		t.Fatalf("sem o fundo deveria ser recusado: %v", err)
	}
	copiar(t, exe, filepath.Join(bin, nomeFundo)) // de console
	if _, err := exeFundo(instalado); err == nil || !strings.Contains(err.Error(), "windowsgui") {
		t.Fatalf("fundo com console deveria ser recusado: %v", err)
	}
	copiar(t, fundo, filepath.Join(bin, nomeFundo))
	if got, err := exeFundo(instalado); err != nil || got != filepath.Join(bin, nomeFundo) {
		t.Fatalf("exeFundo = %q, %v", got, err)
	}
}

func copiar(t *testing.T, de, para string) {
	t.Helper()
	dados, err := os.ReadFile(de)
	if err == nil {
		err = os.WriteFile(para, dados, 0o700)
	}
	if err != nil {
		t.Fatal(err)
	}
}

func portaLivre(t *testing.T) int {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	return ln.Addr().(*net.TCPAddr).Port
}

// TestPonteNaoSobeComStdinEmPipe: um agente que roda o ponte.exe puro como hook (um
// Claude antigo que ignora o "args") manda o JSON no stdin; a ponte não sobe.
func TestPonteNaoSobeComStdinEmPipe(t *testing.T) {
	ctx, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	cmd := exec.CommandContext(ctx, exe, "--porta", strconv.Itoa(portaLivre(t)), "--demo")
	cmd.Env = envConfig(t, true)
	cmd.Stdin = strings.NewReader(`{"hook_event_name":"Stop"}`)
	saida, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		t.Fatal("a ponte subiu com o stdin num pipe")
	}
	if e, ok := err.(*exec.ExitError); !ok || e.ExitCode() != 1 || !strings.Contains(string(saida), nomeFundo) {
		t.Fatalf("deveria sair com 1 e apontar o %s: %v\n%s", nomeFundo, err, saida)
	}
}

// TestFundoSobeSemTerminalESegundoSaiCalado: o exe de fundo sobe mesmo com o stdin num
// pipe e, com a porta ocupada, um segundo sai sem escrever nada fora do log.
func TestFundoSobeSemTerminalESegundoSaiCalado(t *testing.T) {
	if runtime.GOOS != "windows" {
		t.Skip("o exe de fundo é do Windows")
	}
	env, cfg := configurar(t, true)
	porta := strconv.Itoa(portaLivre(t))
	primeiro := exec.Command(fundo, "--porta", porta, "--demo")
	primeiro.Env = env
	primeiro.Stdin = strings.NewReader("{}")
	if err := primeiro.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { primeiro.Process.Kill(); primeiro.Wait() })
	esperarPorta(t, porta)

	ctx, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	segundo := exec.CommandContext(ctx, fundo, "--porta", porta, "--demo")
	segundo.Env = env
	saida, err := segundo.CombinedOutput()
	if e, ok := err.(*exec.ExitError); !ok || e.ExitCode() != 1 || len(saida) != 0 {
		t.Fatalf("o segundo deveria sair com 1 e calado: %v, %q", err, saida)
	}
	log, _ := os.ReadFile(filepath.Join(cfg, "ponte-fundo.log"))
	if strings.Count(string(log), "ponte em 127.0.0.1:"+porta) != 1 || !strings.Contains(string(log), "ocupada") {
		t.Fatalf("o log deveria ter a subida do primeiro e a porta ocupada do segundo:\n%s", log)
	}
}

func esperarPorta(t *testing.T, porta string) {
	t.Helper()
	for fim := time.Now().Add(10 * time.Second); time.Now().Before(fim); time.Sleep(50 * time.Millisecond) {
		if c, err := net.Dial("tcp", "127.0.0.1:"+porta); err == nil {
			c.Close()
			return
		}
	}
	t.Fatal("o exe de fundo não subiu")
}

func TestSetupOrigem(t *testing.T) {
	dir := t.TempDir()
	var saida strings.Builder
	if err := setupOrigem(dir, "https://Escritorio.Exemplo.com/", "", false, &saida); err != nil {
		t.Fatal(err)
	}
	if len(servidor.LerOrigens(dir)) != 0 {
		t.Fatal("o --plano não grava")
	}
	saida.Reset()
	if err := setupOrigem(dir, "https://escritorio.exemplo.com", "", true, &saida); err != nil {
		t.Fatal(err)
	}
	token := servidor.LerToken(dir)
	if got := servidor.LerOrigens(dir); len(got) != 1 || got[0] != "https://escritorio.exemplo.com" || token == "" || !strings.Contains(saida.String(), token) {
		t.Fatalf("o --aplicar grava a origem e mostra o token: %v\n%s", got, saida.String())
	}
	if err := setupOrigem(dir, "http://evil.com", "", true, &saida); err == nil {
		t.Fatal("http fora do PC é recusado")
	}
	saida.Reset()
	if err := setupOrigem(dir, "", "https://escritorio.exemplo.com", true, &saida); err != nil || len(servidor.LerOrigens(dir)) != 0 || strings.Contains(saida.String(), token) {
		t.Fatalf("o --sem-origem tira e não mostra o token: %v\n%s", err, saida.String())
	}
}
