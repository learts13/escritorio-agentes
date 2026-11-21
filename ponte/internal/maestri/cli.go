package maestri

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strings"
	"time"
)

// CLI é o `maestri` que a ponte chama para digitar a resposta de uma pergunta num terminal.
//
// O `maestri` só funciona com MAESTRI_SOCKET (o socket do app) e MAESTRI_TERMINAL_ID (quem
// chama) no ambiente, e só alcança os terminais conectados a quem chama: um terminal não
// alcança a si mesmo ("No connection to ..."). A ponte, que roda como serviço fora do Maestri,
// acha o socket sozinha (acharSocket) e chama como um terminal conectado ao alvo (Conectados,
// lido do `maestri list` do próprio alvo). Sempre sem shell: o exec recebe os argumentos.
type CLI struct {
	Bin, Socket string
	// Rodar executa o binário (nil: os/exec com tempo-limite). Os testes trocam.
	Rodar func(ctx context.Context, bin string, env, args []string) ([]byte, error)
}

const (
	tempoCLI  = 10 * time.Second
	maxSaida  = 64 << 10
	maxNomeCL = 200
)

// caminhosCLI são onde o instalador do Maestri põe o binário; o serviço da ponte (systemd)
// não tem essa pasta no PATH.
var caminhosCLI = []string{
	"/opt/maestri-box/resources/cli/maestri",
	"/Applications/Maestri.app/Contents/Resources/cli/maestri",
}

// AcharCLI acha o binário (MAESTRI_CLI, PATH, os caminhos do instalador) e o socket do app.
// false: sem um dos dois, a ponte não oferece responder por terminal do Maestri.
func AcharCLI() (CLI, bool) {
	sock := acharSocket()
	if sock == "" {
		return CLI{}, false
	}
	candidatos := []string{os.Getenv("MAESTRI_CLI")}
	if p, err := exec.LookPath("maestri"); err == nil {
		candidatos = append(candidatos, p)
	}
	for _, c := range append(candidatos, caminhosCLI...) {
		if c == "" {
			continue
		}
		if binarioSeguro(c) {
			return CLI{Bin: c, Socket: sock}, true
		}
	}
	return CLI{}, false
}

func (c CLI) rodar(ctx context.Context, terminalID string, args ...string) ([]byte, error) {
	env := []string{"MAESTRI_SOCKET=" + c.Socket, "MAESTRI_TERMINAL_ID=" + terminalID}
	for _, e := range os.Environ() { // o resto do ambiente da ponte, sem um Maestri herdado
		if !strings.HasPrefix(e, "MAESTRI_") {
			env = append(env, e)
		}
	}
	ctx, cancelar := context.WithTimeout(ctx, tempoCLI)
	defer cancelar()
	if c.Rodar != nil {
		return c.Rodar(ctx, c.Bin, env, args)
	}
	cmd := exec.CommandContext(ctx, c.Bin, args...)
	cmd.Env = env
	var saida bytes.Buffer
	cmd.Stdout = &limitado{w: &saida, resta: maxSaida}
	cmd.Stderr = io.Discard // pode trazer texto do terminal: nunca vai ao log
	err := cmd.Run()
	return saida.Bytes(), err
}

// conectado é a linha de um agente no `maestri list`: `  - name: "Nome"` (com ", maestro:
// true" no Maestro).
var conectado = regexp.MustCompile(`^\s*- name: "(.+?)"(?:, maestro: true)?\s*$`)

// Conectados são os nomes dos agentes conectados ao terminal terminalID (a seção "Connected
// agents:" do `maestri list` rodado como ele).
func (c CLI) Conectados(ctx context.Context, terminalID string) ([]string, error) {
	saida, err := c.rodar(ctx, terminalID, "list")
	if err != nil {
		return nil, errors.New("o maestri list falhou")
	}
	var nomes []string
	secao := false
	sc := bufio.NewScanner(bytes.NewReader(saida))
	for sc.Scan() {
		linha := sc.Text()
		if linha != "" && linha[0] != ' ' { // cabeçalho de seção ("You:", "Connected agents:"...)
			secao = linha == "Connected agents:"
			continue
		}
		if m := conectado.FindStringSubmatch(linha); secao && m != nil && len(m[1]) <= maxNomeCL {
			nomes = append(nomes, m[1])
		}
	}
	return nomes, nil
}

// Digitar digita texto e Enter no terminal nome, chamando como o terminal deID (conectado a
// ele): `maestri ask <nome> --raw <texto>\n`. O texto já passou pelo decisao.ValidarTexto (sem
// barra invertida, então nenhum escape do --raw sai dele); o `\n` do fim é o único Enter.
func (c CLI) Digitar(ctx context.Context, deID, nome, texto string) error {
	if _, err := c.rodar(ctx, deID, "ask", nome, "--raw", texto+`\n`); err != nil {
		return errors.New("o maestri ask falhou")
	}
	return nil
}

// limitado guarda até resta bytes e descarta o resto sem erro (o processo não trava).
type limitado struct {
	w     io.Writer
	resta int
}

func (l *limitado) Write(p []byte) (int, error) {
	n := len(p)
	if l.resta > 0 {
		q := p
		if len(q) > l.resta {
			q = q[:l.resta]
		}
		l.resta -= len(q)
		l.w.Write(q)
	}
	return n, nil
}
