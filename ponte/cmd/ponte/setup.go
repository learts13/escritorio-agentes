package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"firmopolis/ponte/internal/integracoes"
	"firmopolis/ponte/internal/servidor"
)

const usoSetup = `uso: ponte setup --plano | --aplicar | --desfazer [--autostart] [--home PASTA]
     ponte setup --plano | --aplicar --cidade NOME [--escolha N] [--pais XX]
     ponte setup --plano | --aplicar --sem-cidade
     ponte setup --plano | --aplicar --origem URL | --sem-origem URL
     ponte setup --plano | --aplicar --espelho URL --chave-espelho CHAVE [--decidir-remoto] | --sem-espelho
     ponte setup --plano | --aplicar --decidir-remoto | --sem-decidir-remoto

  --plano      mostra o que muda em cada arquivo, sem mudar nada
  --aplicar    mostra o plano e instala (backup com data de cada arquivo de terceiros)
  --desfazer   tira tudo o que é firmopolis (e o que sobrou do escritorio-vivo), inclusive o autostart
  --autostart  com --plano ou --aplicar: a ponte sobe sozinha, sem janela, no login
               do Windows (valor Firmopolis na chave Run do usuário, chamando o
               ponte-fundo.exe do bin instalado)
  --home       outra pasta de usuário (para conferir numa cópia das configs)

  --cidade     a cidade do clima: procura no Open-Meteo (manda só o nome) e, com
               --aplicar, grava em clima.json na pasta da ponte. Não mexe em nenhuma
               config de agente. Reinicie a ponte depois.
  --escolha    qual dos resultados (1 a 5), quando a busca acha mais de um
  --pais       país das datas e feriados (BR, US...); sem ele, o da cidade
  --sem-cidade tira a cidade: o clima volta a ser null e nada mais sai da máquina

  --origem     o endereço do Firmópolis que pode ler a ponte pelo navegador (como
               https://escritorio.exemplo.com). Com --aplicar, grava em origens.txt
               e mostra o token para colar no Firmópolis (Ajustes > Ponte local).
               Os dados seguem só no seu PC: é o navegador que lê a ponte.
  --sem-origem tira esse endereço da lista

  --espelho    o endereço do Firmópolis que recebe o espelho da ponte, para ver os
               terminais desta máquina de qualquer navegador, sem túnel. Com
               --chave-espelho (a chave de Personalizar > Ponte local) e --aplicar,
               grava em espelho.json (só você lê). Vai ao servidor só o que a tela usa:
               nomes dos terminais e dos projetos, estados e ferramentas; nunca
               arquivo, comando ou alvo. Vale na hora, sem reiniciar a ponte.
  --sem-espelho para de enviar e apaga o espelho.json

Para fazer tudo de uma vez (hooks, espelho e teste): ponte conectar URL CHAVE
`

// tokenAusente aparece no plano no lugar do token que ainda não existe.
const tokenAusente = "<token>"

// setup é o `ponte setup`: liga o Claude Code, o OpenCode, o agy, o Codex e o MiniMax Code à ponte.
func setup(args []string, saida io.Writer) error {
	fs := flag.NewFlagSet("setup", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	plano := fs.Bool("plano", false, "")
	aplicar := fs.Bool("aplicar", false, "")
	desfazer := fs.Bool("desfazer", false, "")
	autostart := fs.Bool("autostart", false, "")
	home := fs.String("home", "", "")
	cidade := fs.String("cidade", "", "")
	escolha := fs.Int("escolha", 0, "")
	pais := fs.String("pais", "", "")
	semCidade := fs.Bool("sem-cidade", false, "")
	origem := fs.String("origem", "", "")
	semOrigem := fs.String("sem-origem", "", "")
	espelho := fs.String("espelho", "", "")
	chaveEspelho := fs.String("chave-espelho", "", "")
	semEspelho := fs.Bool("sem-espelho", false, "")
	decidirRemoto := fs.Bool("decidir-remoto", false, "")
	semDecidirRemoto := fs.Bool("sem-decidir-remoto", false, "")
	err := fs.Parse(args)
	if err == nil && *espelho == "" && *chaveEspelho == "" && !*semEspelho && (*decidirRemoto || *semDecidirRemoto) {
		if fs.NArg() > 0 || contar(*plano, *aplicar) != 1 || *desfazer || *autostart || *home != "" || *cidade != "" || *semCidade ||
			*escolha != 0 || *pais != "" || *origem != "" || *semOrigem != "" || *decidirRemoto == *semDecidirRemoto {
			return errors.New(usoSetup)
		}
		dir, err := servidor.DirConfig()
		if err != nil {
			return err
		}
		return setupDecidirRemoto(dir, *decidirRemoto, *aplicar, saida)
	}
	if err == nil && (*espelho != "" || *chaveEspelho != "" || *semEspelho) {
		if fs.NArg() > 0 || contar(*plano, *aplicar) != 1 || *desfazer || *autostart || *home != "" || *cidade != "" || *semCidade ||
			*escolha != 0 || *pais != "" || *origem != "" || *semOrigem != "" || *semEspelho == (*espelho != "") ||
			(*espelho != "") != (*chaveEspelho != "") || *semDecidirRemoto || *decidirRemoto && *semEspelho {
			return errors.New(usoSetup)
		}
		dir, err := servidor.DirConfig()
		if err != nil {
			return err
		}
		return setupEspelho(dir, *espelho, *chaveEspelho, *decidirRemoto, *aplicar, saida)
	}
	if err == nil && (*origem != "" || *semOrigem != "") {
		if fs.NArg() > 0 || contar(*plano, *aplicar) != 1 || *desfazer || *autostart || *home != "" || *cidade != "" || *semCidade ||
			*escolha != 0 || *pais != "" || (*origem != "") == (*semOrigem != "") {
			return errors.New(usoSetup)
		}
		dir, err := servidor.DirConfig()
		if err != nil {
			return err
		}
		return setupOrigem(dir, *origem, *semOrigem, *aplicar, saida)
	}
	if err == nil && (*cidade != "" || *semCidade) {
		if fs.NArg() > 0 || contar(*plano, *aplicar) != 1 || *desfazer || *autostart || *home != "" || (*cidade != "") == *semCidade {
			return errors.New(usoSetup)
		}
		return setupCidade(*cidade, *escolha, *pais, *aplicar, saida)
	}
	if err != nil || fs.NArg() > 0 || contar(*plano, *aplicar, *desfazer) != 1 || *autostart && *desfazer || *escolha != 0 || *pais != "" {
		return errors.New(usoSetup)
	}
	if *autostart {
		if *home != "" {
			return errors.New("o --autostart mexe no registro do usuário de verdade; não combina com --home")
		}
		if err := autostartSuportado(); err != nil {
			return err
		}
	}

	op, err := opcoesSetup(*home)
	if err != nil {
		return err
	}
	var fundo string
	if *autostart {
		if fundo, err = exeFundo(op.Exe); err != nil {
			return err
		}
	}
	switch {
	case *plano:
		p := integracoes.Planejar(op)
		fmt.Fprint(saida, p.Texto())
		if *autostart {
			fmt.Fprintln(saida, "\n"+planoAutostart(fundo))
		}
		if op.Token == tokenAusente {
			fmt.Fprintln(saida, "\nO token da ponte ainda não existe: o --aplicar cria (os hooks leem do arquivo da ponte).")
		}
		if len(p.Erros) > 0 {
			return errors.New("o plano tem erros; nada seria aplicado")
		}
		fmt.Fprintln(saida, "\nNada foi alterado. Para instalar: ponte setup --aplicar")
	case *aplicar:
		if strings.Contains(op.Exe, "go-build") {
			return errors.New("rode o ponte.exe compilado, não o go run: os hooks guardam o caminho deste executável")
		}
		p := integracoes.Planejar(op)
		if len(p.Erros) > 0 {
			fmt.Fprint(saida, p.Texto())
			return errors.New("o plano tem erros; nada foi aplicado")
		}
		if op.Token == tokenAusente {
			// O token só nasce quando o plano está limpo e vai ser aplicado.
			if op.Token, err = servidor.CarregarOuCriarToken(op.DirConfig); err != nil {
				return fmt.Errorf("não deu para preparar o token: %w", err)
			}
			p = integracoes.Planejar(op)
		}
		fmt.Fprint(saida, p.Texto())
		if err := integracoes.Aplicar(p); err != nil {
			return err
		}
		if *autostart {
			fmt.Fprintln(saida, "\n"+planoAutostart(fundo))
			if err := gravarAutostart(comandoAutostart(fundo)); err != nil {
				return err
			}
		}
		if *home == "" && autostartSuportado() == nil {
			// O autostart do Escritório Vivo subiria a ponte antiga na mesma porta.
			if tirado, err := tirarAutostartAntigo(); err != nil {
				return err
			} else if tirado != "" {
				fmt.Fprintln(saida, "\nAutostart: tirei o antigo "+nomeAutostartAntigo+" da chave "+chaveRun+" ("+tirado+").")
				if !*autostart {
					fmt.Fprintln(saida, "Para a ponte nova subir no login, rode de novo com --autostart.")
				}
			}
		}
		fmt.Fprintln(saida, "\nPronto. Para desfazer: ponte setup --desfazer")
	case *desfazer:
		p, err := integracoes.Desfazer(op)
		fmt.Fprint(saida, p.Texto())
		if err != nil {
			return err
		}
		// Com --home é uma cópia das configs: o registro do usuário fica como está.
		if *home == "" && autostartSuportado() == nil {
			for _, tirar := range []func() (string, error){tirarAutostart, tirarAutostartAntigo} {
				tirado, err := tirar()
				if err != nil {
					return err
				}
				if tirado != "" {
					fmt.Fprintln(saida, "\nAutostart: tirei da chave "+chaveRun+" ("+tirado+").")
				}
			}
		}
		restos := integracoes.Restos(op)
		if len(p.Avisos) == 0 && len(restos) == 0 {
			fmt.Fprintln(saida, "\nPronto: não sobrou nada da ponte nas configs.")
			return nil
		}
		fmt.Fprintln(saida, "\nPronto: as entradas da ponte saíram das configs.")
		if len(p.Avisos) > 0 {
			fmt.Fprintln(saida, "Veja nos avisos acima o que ficou de propósito.")
		}
		if len(restos) > 0 {
			fmt.Fprintln(saida, "Os backups ficaram no disco (com o token mascarado); apague quando quiser:")
			for _, r := range restos {
				fmt.Fprintln(saida, "  "+r)
			}
		}
	}
	return nil
}

// planoAutostart diz o que o --autostart grava, ou que já está assim.
func planoAutostart(fundo string) string {
	comando := comandoAutostart(fundo)
	if atual, ok := lerAutostart(); ok && atual == comando {
		return "Autostart: já está ligado (" + chaveRun + `\` + nomeAutostart + ")."
	}
	return "Autostart: " + chaveRun + `\` + nomeAutostart + " = " + comando
}

func contar(bs ...bool) int {
	n := 0
	for _, b := range bs {
		if b {
			n++
		}
	}
	return n
}

// opcoesSetup monta as opções reais sem criar nada: sem token, ele fica tokenAusente.
func opcoesSetup(home string) (integracoes.Opcoes, error) {
	var op integracoes.Opcoes
	dirMiniMax := ""
	if home == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return op, err
		}
		home = h
		// O mcode guarda os dados no MINIMAX_DATA_DIR, se houver. Com --home, vale
		// sempre <home>/.minimax: uma cópia das configs nunca toca a pasta real.
		if d := os.Getenv("MINIMAX_DATA_DIR"); d != "" {
			if dirMiniMax, err = filepath.Abs(d); err != nil {
				return op, err
			}
		}
	}
	home, err := filepath.Abs(home)
	if err != nil {
		return op, err
	}
	config, err := servidor.DirConfig()
	if err != nil {
		return op, err
	}
	exe, err := os.Executable()
	if err != nil {
		return op, err
	}
	if real, err := filepath.EvalSymlinks(exe); err == nil {
		exe = real
	}
	token := servidor.LerToken(config)
	if token == "" {
		token = tokenAusente // o --aplicar cria o de verdade, se o plano não tiver erro
	}
	return integracoes.Opcoes{
		Home:       home,
		DirConfig:  config,
		Gerenciado: integracoes.DirGerenciadoClaude(),
		DirMiniMax: dirMiniMax,
		Exe:        exe,
		Token:      token,
		Porta:      servidor.PortaPadrao,
	}, nil
}

// setupOrigem põe ou tira um endereço do Firmópolis de origens.txt. Com --aplicar e um
// endereço novo, mostra o token (que só o usuário lê no próprio terminal).
func setupOrigem(dir, origem, semOrigem string, aplicar bool, saida io.Writer) error {
	alvo, err := servidor.NormalizarOrigem(origem + semOrigem)
	if err != nil {
		return err
	}
	lista := servidor.LerOrigens(dir)
	tem := slices.Contains(lista, alvo)
	switch {
	case origem != "" && tem:
		fmt.Fprintln(saida, "Navegador: "+alvo+" já pode ler a ponte.")
	case origem != "" && len(lista) >= servidor.MaxOrigens:
		return fmt.Errorf("a lista já tem %d endereços; tire um com --sem-origem", servidor.MaxOrigens)
	case origem != "":
		fmt.Fprintln(saida, "Navegador: "+alvo+" passa a poder ler a ponte (em "+servidor.ArquivoOrigens+").")
		lista = append(lista, alvo)
	case !tem:
		fmt.Fprintln(saida, "Navegador: "+alvo+" não está na lista; nada a tirar.")
		return nil
	default:
		fmt.Fprintln(saida, "Navegador: "+alvo+" deixa de poder ler a ponte.")
		lista = slices.DeleteFunc(lista, func(o string) bool { return o == alvo })
	}
	if !aplicar {
		fmt.Fprintln(saida, "\nNada foi alterado. Para gravar: ponte setup --aplicar --origem "+alvo)
		return nil
	}
	if err := servidor.GravarOrigens(dir, lista); err != nil {
		return err
	}
	if semOrigem != "" {
		fmt.Fprintln(saida, "\nPronto. Vale na hora, sem reiniciar a ponte.")
		return nil
	}
	token, err := servidor.CarregarOuCriarToken(dir)
	if err != nil {
		return fmt.Errorf("não deu para preparar o token: %w", err)
	}
	fmt.Fprintln(saida, "\nPronto. Vale na hora, sem reiniciar a ponte. Agora, no Firmópolis, abra")
	fmt.Fprintln(saida, "Ajustes > Ponte local e cole este token (não mande para ninguém):")
	fmt.Fprintln(saida, "\n  "+token)
	return nil
}

// setupEspelho grava ou apaga o espelho.json. A chave nunca é mostrada.
func setupEspelho(dir, endereco, chave string, decidirRemoto, aplicar bool, saida io.Writer) error {
	if endereco == "" {
		if _, ok := servidor.LerEspelho(dir); !ok {
			fmt.Fprintln(saida, "Espelho: já está desligado; nada a tirar.")
		} else {
			fmt.Fprintln(saida, "Espelho: a ponte para de enviar ao servidor (apaga "+servidor.ArquivoEspelho+").")
		}
		if !aplicar {
			fmt.Fprintln(saida, "\nNada foi alterado. Para desligar: ponte setup --aplicar --sem-espelho")
			return nil
		}
		if err := servidor.GravarEspelho(dir, servidor.ConfigEspelho{}); err != nil {
			return err
		}
		fmt.Fprintln(saida, "\nPronto. Vale na hora, sem reiniciar a ponte.")
		return nil
	}
	c, err := configEspelho(endereco, chave)
	if err != nil {
		return err
	}
	c.DecidirRemoto = decidirRemoto
	fmt.Fprintln(saida, "Espelho: a ponte passa a enviar a "+c.URL+" os nomes dos terminais e dos projetos, os estados e")
	fmt.Fprintln(saida, "as ferramentas (nunca arquivo, comando ou alvo). Fica em "+servidor.ArquivoEspelho+", que só você lê.")
	fmt.Fprintln(saida, textoDecidirRemoto(decidirRemoto))
	if !aplicar {
		fmt.Fprintln(saida, "\nNada foi alterado. Para gravar: ponte setup --aplicar --espelho "+c.URL+" --chave-espelho <chave>")
		return nil
	}
	if err := servidor.GravarEspelho(dir, c); err != nil {
		return err
	}
	fmt.Fprintln(saida, "\nPronto. Vale na hora, sem reiniciar a ponte.")
	return nil
}

func textoDecidirRemoto(ligado bool) string {
	if ligado {
		return "Responder pelo celular: LIGADO. Com alguém que decide atendendo pelo servidor, vão também a ferramenta e um\n" +
			"resumo mascarado (até 300 caracteres) de cada pedido de permissão, e a ponte aceita Permitir/Negar de lá."
	}
	return "Responder pelo celular: desligado (só no navegador deste PC). Para ligar: --decidir-remoto."
}

// setupDecidirRemoto liga ou desliga só a decisão pelo servidor, no espelho já gravado.
func setupDecidirRemoto(dir string, ligar, aplicar bool, saida io.Writer) error {
	c, ok := servidor.LerEspelho(dir)
	if !ok {
		return errors.New("o espelho está desligado; ligue antes com ponte conectar URL (ou --espelho URL --chave-espelho CHAVE)")
	}
	c.DecidirRemoto = ligar
	fmt.Fprintln(saida, textoDecidirRemoto(ligar))
	if !aplicar {
		fmt.Fprintln(saida, "\nNada foi alterado. Para gravar, rode de novo com --aplicar.")
		return nil
	}
	if err := servidor.GravarEspelho(dir, c); err != nil {
		return err
	}
	fmt.Fprintln(saida, "\nPronto. Vale na hora, sem reiniciar a ponte.")
	return nil
}

// configEspelho confere o endereço e a chave (64 letras de 0 a 9 e a a f).
func configEspelho(endereco, chave string) (servidor.ConfigEspelho, error) {
	u, err := servidor.NormalizarEspelho(endereco)
	if err != nil {
		return servidor.ConfigEspelho{}, err
	}
	chave = strings.ToLower(strings.TrimSpace(chave))
	if len(chave) != 64 || strings.Trim(chave, "0123456789abcdef") != "" {
		return servidor.ConfigEspelho{}, errors.New("a chave tem 64 letras e números (0 a 9, a a f); copie de novo de Personalizar > Ponte local")
	}
	return servidor.ConfigEspelho{URL: u, Chave: chave}, nil
}
