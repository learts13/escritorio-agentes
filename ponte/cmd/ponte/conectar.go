package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"firmopolis/ponte/internal/servidor"
)

const usoConectar = `uso: ponte conectar URL [--servico]          (a chave é pedida em seguida)
     ponte conectar URL CHAVE [--servico]    (para scripts: a chave fica no histórico)

  Liga esta máquina ao Firmópolis de uma vez: testa a chave, instala os hooks dos
  agentes e grava o espelho. Os terminais daqui aparecem no mapa de qualquer navegador.
  A URL e a chave estão em Personalizar > Ponte local ("rode isto na máquina dos
  terminais").

  --servico    no Linux, cria o serviço systemd do usuário (firmopolis-ponte), que sobe
               a ponte no login e a reinicia se cair
`

// nomeServico é a unit systemd do usuário que o --servico cria.
const nomeServico = "firmopolis-ponte"

// Trocados nos testes: os hooks de verdade, o systemctl e a ponte já rodando.
var (
	instalarHooks  = func(saida io.Writer) error { return setup([]string{"--aplicar"}, saida) }
	rodarSystemctl = func(args ...string) error {
		return exec.Command("systemctl", append([]string{"--user"}, args...)...).Run()
	}
	ponteRodando = func() bool {
		c, err := net.DialTimeout("tcp", "127.0.0.1:"+strconv.Itoa(servidor.PortaPadrao), 300*time.Millisecond)
		if err != nil {
			return false
		}
		c.Close()
		return true
	}
)

// entradaChave é de onde o conectar lê a chave quando ela não vem como argumento (os testes trocam).
var entradaChave io.Reader = os.Stdin

// lerChave pega a chave da variável FIRMOPOLIS_CHAVE ou, sem ela, de uma linha da entrada.
func lerChave(saida io.Writer) (string, error) {
	if ch := strings.TrimSpace(os.Getenv("FIRMOPOLIS_CHAVE")); ch != "" {
		return ch, nil
	}
	fmt.Fprint(saida, "Cole a chave de Personalizar > Ponte local e tecle Enter: ")
	linha, err := bufio.NewReader(io.LimitReader(entradaChave, 512)).ReadString('\n')
	if strings.TrimSpace(linha) == "" {
		if err == nil {
			err = errors.New("chave vazia")
		}
		return "", fmt.Errorf("não li a chave (%v)", err)
	}
	return strings.TrimSpace(linha), nil
}

// conectar é o `ponte conectar URL [CHAVE]`: testa antes de mudar qualquer coisa, depois
// instala os hooks e grava o espelho, e diz o próximo passo.
func conectar(args []string, saida io.Writer) error {
	var pos []string
	servico := false
	for _, a := range args {
		switch a {
		case "--servico", "-servico":
			servico = true
		default:
			if strings.HasPrefix(a, "-") {
				return errors.New(usoConectar)
			}
			pos = append(pos, a)
		}
	}
	if len(pos) == 1 { // a chave não vai na linha de comando: nem no histórico do shell, nem no /proc/<pid>/cmdline
		ch, err := lerChave(saida)
		if err != nil {
			return err
		}
		pos = append(pos, ch)
	}
	if len(pos) != 2 {
		return errors.New(usoConectar)
	}
	if servico && runtime.GOOS != "linux" {
		return errors.New("o --servico é só para Linux; no Windows, use ponte setup --aplicar --autostart")
	}
	c, err := configEspelho(pos[0], pos[1])
	if err != nil {
		return err
	}
	dir, err := servidor.DirConfig()
	if err != nil {
		return err
	}

	fmt.Fprintln(saida, "1/3 Testando a chave com "+c.URL+"...")
	ctx, cancelar := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancelar()
	if err := servidor.TestarEspelho(ctx, c); err != nil {
		return fmt.Errorf("não deu certo: %v.\nNada foi alterado nesta máquina", err)
	}
	fmt.Fprintln(saida, "    Chave aceita.")

	fmt.Fprintln(saida, "\n2/3 Instalando os hooks dos agentes (Claude Code, Codex, OpenCode, agy e MiniMax)...")
	if err := instalarHooks(saida); err != nil {
		return fmt.Errorf("os hooks não foram instalados: %v", err)
	}

	fmt.Fprintln(saida, "\n3/3 Gravando o espelho em "+filepath.Join(dir, servidor.ArquivoEspelho)+" (só você lê)...")
	if err := servidor.GravarEspelho(dir, c); err != nil {
		return fmt.Errorf("não deu para gravar o espelho: %v", err)
	}

	fmt.Fprintln(saida, "\nDeu certo! Esta máquina está ligada ao Firmópolis em "+c.URL+".")
	fmt.Fprintln(saida, "Vão ao servidor só os nomes dos terminais e dos projetos, os estados e as ferramentas;")
	fmt.Fprintln(saida, "nunca arquivo, comando ou alvo. Para parar: ponte setup --aplicar --sem-espelho")
	return proximoPasso(saida, servico)
}

// proximoPasso diz como deixar a ponte rodando (ou que ela já está).
func proximoPasso(saida io.Writer, servico bool) error {
	fmt.Fprintln(saida, "\nPróximo passo:")
	if ponteRodando() && !servico {
		fmt.Fprintln(saida, "  A ponte já está rodando: ela começa a enviar em poucos segundos, sem reiniciar.")
		fmt.Fprintln(saida, "  No Firmópolis, Personalizar > Ponte local mostra \"pelo servidor\".")
		return nil
	}
	switch runtime.GOOS {
	case "linux":
		if servico {
			return criarServico(saida)
		}
		fmt.Fprintln(saida, "  Deixe a ponte rodando como serviço (sobe no login e volta se cair):")
		fmt.Fprintln(saida, "    ponte conectar <a mesma URL> --servico")
		fmt.Fprintln(saida, "  Ou, só para ver agora, rode num terminal: ponte")
	case "windows":
		fmt.Fprintln(saida, "  Para a ponte subir sozinha no login: ponte setup --aplicar --autostart")
		fmt.Fprintln(saida, "  Ou, só para ver agora, rode num terminal: ponte")
	default:
		fmt.Fprintln(saida, "  Rode a ponte num terminal e deixe aberto: ponte")
	}
	return nil
}

// unidadeServico é a unit systemd do usuário que roda este executável.
func unidadeServico(exe string) string {
	return `[Unit]
Description=Firmópolis: ponte local (terminais desta máquina para o mapa, só em 127.0.0.1)

[Service]
ExecStart=` + exe + `
StandardInput=null
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
}

// criarServico grava a unit (sem sobrescrever uma que já exista) e a liga.
func criarServico(saida io.Writer) error {
	base, err := os.UserConfigDir()
	if err != nil {
		return err
	}
	arquivo := filepath.Join(base, "systemd", "user", nomeServico+".service")
	if _, err := os.Stat(arquivo); err == nil {
		fmt.Fprintln(saida, "  O serviço "+nomeServico+" já existe ("+arquivo+"); deixei como está.")
		fmt.Fprintln(saida, "  Se ele estiver parado: systemctl --user restart "+nomeServico)
		return nil
	}
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	if strings.Contains(exe, "go-build") {
		return errors.New("rode o ponte compilado, não o go run: o serviço guarda o caminho deste executável")
	}
	if strings.ContainsAny(exe, " \t\n%\"'\\") {
		return errors.New("o caminho da ponte tem espaço ou caractere especial; mova o executável para uma pasta simples")
	}
	if err := os.MkdirAll(filepath.Dir(arquivo), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(arquivo, []byte(unidadeServico(exe)), 0o644); err != nil {
		return err
	}
	fmt.Fprintln(saida, "  Criei o serviço "+nomeServico+" ("+arquivo+").")
	if err := rodarSystemctl("daemon-reload"); err == nil {
		err = rodarSystemctl("enable", "--now", nomeServico)
	}
	if err != nil {
		fmt.Fprintln(saida, "  Não deu para ligar sozinho; rode: systemctl --user daemon-reload && systemctl --user enable --now "+nomeServico)
		return nil
	}
	fmt.Fprintln(saida, "  Ligado: a ponte sobe no login e volta se cair. Ver o log: journalctl --user -u "+nomeServico)
	fmt.Fprintln(saida, "  Para rodar mesmo sem você logado: sudo loginctl enable-linger $USER")
	return nil
}
