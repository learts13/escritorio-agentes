// Comando ponte: o serviço local do Firmópolis em 127.0.0.1.
//
//	ponte [--porta 47820] [--demo]
//	ponte setup --plano | --aplicar | --desfazer [--autostart] [--home PASTA]
//	ponte setup --plano | --aplicar --cidade NOME [--escolha N] [--pais XX]
//	ponte setup --plano | --aplicar --sem-cidade
//	ponte setup --plano | --aplicar --origem URL | --sem-origem URL
//	ponte setup --plano | --aplicar --espelho URL --chave-espelho CHAVE | --sem-espelho
//	ponte conectar URL CHAVE [--servico]
//	ponte hook <claude|agy|codex|mcode>
//	ponte decidir <claude|codex>
//
// Lê os agentes (hooks, plugins, ~/.claude/sessions, ~/.codex/sessions e ~/.maestri),
// guarda o histórico do dia e fala com o jogo e com o Firmópolis no navegador por WebSocket. Com --demo, mostra 10
// moradores de mentira e não lê nem grava nada real. O setup instala e desfaz as
// integrações (e, com --autostart, a subida no login); o hook é o que o Claude Code,
// o agy, o Codex e o MiniMax Code chamam a cada evento.
//
// A ponte só sobe num terminal: com o stdin num pipe ou arquivo, quem chama é um agente
// rodando o ponte.exe puro como hook (um Claude antigo que ignora o "args" do hook).
// Fora do terminal, quem sobe a ponte é o ponte-fundo.exe: o mesmo programa compilado
// com -ldflags=-H=windowsgui, sem console nem janela, que escreve o log em arquivo.
package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"

	"firmopolis/ponte/internal/clima"
	"firmopolis/ponte/internal/historico"
	"firmopolis/ponte/internal/servidor"
)

// nomeFundo é o exe de fundo, que o autostart chama no login.
const nomeFundo = "ponte-fundo.exe"

func main() {
	fundo := ehFundo()
	if fundo {
		logEmArquivo()
	}
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "hook":
			hook(os.Args[2:])
			os.Exit(0)
		case "decidir":
			decidir(os.Args[2:], os.Stdout)
			os.Exit(0)
		case "conectar":
			if err := conectar(os.Args[2:], os.Stdout); err != nil {
				fmt.Fprintln(os.Stderr, "\nponte conectar:", err)
				os.Exit(1)
			}
			return
		case "setup":
			if err := setup(os.Args[2:], os.Stdout); err != nil {
				fmt.Fprintln(os.Stderr, "ponte setup:", err)
				os.Exit(1)
			}
			return
		}
	}
	porta := flag.Int("porta", servidor.PortaPadrao, "porta em 127.0.0.1")
	demo := flag.Bool("demo", false, "10 moradores de mentira, sem ler nem gravar nada real")
	flag.Parse()

	if !fundo && stdinEmPipe() {
		fmt.Fprintln(os.Stderr, "ponte: o stdin é um pipe ou arquivo; a ponte só sobe num terminal (sem terminal, use o "+nomeFundo+")")
		os.Exit(1)
	}
	if err := rodar(*porta, *demo); err != nil {
		log.Println("ponte:", err)
		os.Exit(1)
	}
}

func ehFundo() bool {
	exe, err := os.Executable()
	return err == nil && strings.EqualFold(filepath.Base(exe), nomeFundo)
}

// stdinEmPipe diz se o stdin é um pipe ou arquivo, como num hook. O terminal e o NUL
// de quem roda sem stdin são dispositivos.
func stdinEmPipe() bool {
	info, err := os.Stdin.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice == 0
}

// logEmArquivo manda o log do exe de fundo, que não tem console, para ponte-fundo.log
// na pasta da ponte. Passou de 1 MiB, o arquivo recomeça.
func logEmArquivo() {
	log.SetOutput(io.Discard)
	dir, err := servidor.DirConfig()
	if err != nil || os.MkdirAll(dir, 0o700) != nil {
		return
	}
	arquivo := filepath.Join(dir, "ponte-fundo.log")
	modo := os.O_CREATE | os.O_WRONLY | os.O_APPEND
	if info, err := os.Stat(arquivo); err == nil && info.Size() > 1<<20 {
		modo |= os.O_TRUNC
	}
	if f, err := os.OpenFile(arquivo, modo, 0o600); err == nil {
		log.SetOutput(f)
	}
}

func rodar(porta int, demo bool) error {
	config, err := servidor.DirConfig()
	if err != nil {
		return err
	}
	token, err := servidor.CarregarOuCriarToken(config)
	if err != nil {
		return fmt.Errorf("não deu para preparar o token: %w", err)
	}
	op := servidor.Opcoes{Porta: porta, Token: token, Demo: demo,
		Origens: func() []string { return servidor.LerOrigens(config) }}
	op.Espelho = func() (servidor.ConfigEspelho, bool) { return servidor.LerEspelho(config) }
	if c, ok := servidor.LerEspelho(config); ok {
		log.Printf("espelho: ligado, enviando a %s (ponte setup --sem-espelho desliga)", c.URL) // nunca a chave
	}
	if n := len(servidor.LerOrigens(config)); n > 0 {
		log.Printf("navegador: %d endereço(s) do Firmópolis podem ler a ponte (ponte setup --origem)", n)
	}
	if !demo {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		hist, err := historico.Abrir(filepath.Join(config, "historico"), historico.RetencaoPadrao)
		if err != nil {
			return fmt.Errorf("não deu para abrir o histórico: %w", err)
		}
		defer hist.Fechar()
		op.Historico = hist
		op.DirClaude = filepath.Join(home, ".claude", "sessions")
		op.DirCodex = filepath.Join(home, ".codex", "sessions")
		op.DirMaestri = filepath.Join(home, ".maestri")
		if dir := os.Getenv("MAESTRI_DATA_DIR"); dir != "" {
			op.DirMaestri = dir
		}
		cfg, err := clima.LerConfig(config)
		if err != nil {
			log.Printf("clima: %s ilegível, clima desligado: %v", clima.ArquivoConfig, err)
		}
		if cfg.Ligado() {
			log.Printf("clima: %s", cfg.Cidade)
		} else {
			log.Print("clima: desligado (sem cidade; ponte setup --cidade)")
		}
		op.Clima = clima.NovaFonte(cfg, config)
	}

	ctx, parar := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer parar()
	return servidor.Novo(op).Rodar(ctx)
}
