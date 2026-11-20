// Package integracoes instala e desfaz os hooks que ligam os agentes à ponte: o plugin
// do OpenCode, o plugin local do MiniMax Code e os hooks command do Claude Code, do agy
// e do Codex (`ponte hook <rota>`). Toda mudança passa por um plano legível antes de ser feita,
// a edição de JSON é cirúrgica (só a nossa faixa de bytes muda), cada arquivo de
// terceiros ganha backup com data, e o manifesto guarda o sha256 depois de cada
// escrita para o desfazer saber se pode voltar o backup ou se tem de tirar só o nosso.
package integracoes

import (
	"bytes"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// marca identifica tudo o que é nosso: o nome da entrada no agy, os plugins e os backups.
// No Claude e no Codex, onde não cabe chave nova no schema, a marca é o próprio valor
// (o comando "ponte hook claude" ou "ponte hook codex").
const marca = "firmopolis"

// marcaAntiga é a do Escritório Vivo. O setup tira o que ainda estiver com ela (a
// entrada do agy, os plugins do OpenCode e do MiniMax e os backups ficam nos Restos):
// quem atualiza não fica com os hooks em dobro.
const marcaAntiga = "escritorio-vivo"

// Opcoes dizem onde mexer. Home e DirConfig limitam as escritas: nada fora delas.
type Opcoes struct {
	Home       string // a pasta do usuário (nos testes, um TempDir)
	DirConfig  string // a pasta da ponte: token e manifesto
	Gerenciado string // a pasta das configs gerenciadas do Claude ("" não confere)
	DirMiniMax string // a pasta de dados do mcode, o MINIMAX_DATA_DIR ("" = <Home>/.minimax)
	Exe        string // o caminho absoluto do ponte.exe que os hooks chamam
	Token      string
	Porta      int
	Agora      func() time.Time
}

func (op Opcoes) agora() time.Time {
	if op.Agora != nil {
		return op.Agora()
	}
	return time.Now()
}

// Mudanca é o que acontece com um arquivo: Antes nil = não existe; Depois nil = apagar.
type Mudanca struct {
	Integracao string
	Arquivo    string
	Antes      []byte
	Depois     []byte
	Resumo     string

	limpo     bool   // Antes não tem nada nosso: o backup dele é o estado original
	todoNosso bool   // o arquivo é todo nosso (os plugins): sem backup nem diff
	mostrar   bool   // todo nosso, mas o plano mostra o conteúdo (muda com o ponte.exe)
	semBackup bool   // o desfazer volta o original: o atual só tem o nosso a mais
	pasta     string // a pasta para apagar se ficar vazia, sem registro no manifesto
}

// Plano é o que o setup vai fazer, para mostrar antes de fazer.
type Plano struct {
	Mudancas []Mudanca
	Notas    []string // o que fica como está, e por quê
	Avisos   []string // o que a pessoa precisa saber ou fazer
	Erros    []string // o que impede de aplicar; com erro, nada é escrito

	op       Opcoes
	desfazer bool
	esquecer []string // desfazer: registros do manifesto sem nada nosso no arquivo
}

// integracao é um provedor: onde fica o arquivo e como pôr ou tirar o nosso dele.
type integracao struct {
	nome      string
	arquivo   func(op Opcoes) string
	instalado func(op Opcoes) bool // a pasta do provedor existe
	// instalar e tirar recebem o conteúdo atual (nil se não existe) e o registro do
	// manifesto, e devolvem o conteúdo novo (nil = apagar), o resumo e os avisos.
	instalar  func(op Opcoes, doc []byte, reg *registro) ([]byte, string, []string, error)
	tirar     func(op Opcoes, doc []byte, reg *registro) ([]byte, []string, error)
	temNosso  func(op Opcoes, doc []byte) bool
	todoNosso bool
	mostrar   bool
	antiga    bool // só tira o que a marca antiga deixou: sem nota quando não há nada
	// pastaAntiga: a pasta que a instalação antiga criou, apagada se ficar vazia
	// (quando o manifesto não a tem). nil: nenhuma.
	pastaAntiga func(op Opcoes) string
}

var integracoes = []integracao{claude, opencode, opencodeAntigo, agy, codex, miniMax, miniMaxAntigo}

// Planejar diz o que o setup muda em cada provedor instalado, sem escrever nada.
func Planejar(op Opcoes) Plano {
	p := Plano{op: op}
	man, err := op.lerManifesto()
	if err != nil {
		p.Erros = append(p.Erros, err.Error())
		return p
	}
	for _, it := range integracoes {
		if !it.instalado(op) {
			if !it.antiga {
				p.Notas = append(p.Notas, it.nome+": não encontrado nesta máquina, fica de fora")
			}
			continue
		}
		caminho := it.arquivo(op)
		antes, err := lerOpcional(caminho)
		if err != nil {
			p.Erros = append(p.Erros, fmt.Sprintf("%s: %v", it.nome, err))
			continue
		}
		depois, resumo, avisos, err := it.instalar(op, antes, man.Arquivos[caminho])
		if err != nil {
			p.Erros = append(p.Erros, fmt.Sprintf("%s: %s: %v. Nada foi alterado; corrija o arquivo e rode de novo.", it.nome, caminho, err))
			continue
		}
		p.Avisos = append(p.Avisos, avisos...)
		if iguais(antes, depois) {
			if !it.antiga {
				p.Notas = append(p.Notas, it.nome+": já instalado, nada a mudar")
			}
			continue
		}
		p.Mudancas = append(p.Mudancas, Mudanca{
			Integracao: it.nome, Arquivo: caminho, Antes: antes, Depois: depois, Resumo: resumo,
			limpo: antes == nil || !it.temNosso(op, antes), todoNosso: it.todoNosso, mostrar: it.mostrar, pasta: pastaAntigaDe(op, it),
		})
	}
	if len(p.Mudancas) > 0 {
		p.Avisos = append(p.Avisos, "As sessões já abertas só pegam os hooks depois de reiniciar o agente.")
	}
	return p
}

// PlanejarDesfazer diz como tirar tudo o que é nosso. Arquivo que não mudou desde a
// nossa última escrita volta ao backup (ou some, se fomos nós que o criamos); arquivo
// editado depois perde só as nossas entradas, e o plano avisa.
func PlanejarDesfazer(op Opcoes) Plano {
	p := Plano{op: op, desfazer: true}
	man, err := op.lerManifesto()
	if err != nil {
		p.Erros = append(p.Erros, err.Error())
		return p
	}
	for _, it := range integracoes {
		caminho := it.arquivo(op)
		reg := man.Arquivos[caminho]
		antes, err := lerOpcional(caminho)
		if err != nil {
			p.Erros = append(p.Erros, fmt.Sprintf("%s: %v", it.nome, err))
			continue
		}
		if antes == nil {
			if reg != nil {
				p.Notas = append(p.Notas, it.nome+": "+caminho+" não existe mais; nada a desfazer")
				p.esquecer = append(p.esquecer, caminho)
			}
			continue
		}
		depois, resumo, avisos, restaura, err := planejarVolta(op, it, antes, reg)
		if err != nil {
			p.Erros = append(p.Erros, fmt.Sprintf("%s: %s: %v. Nada foi alterado.", it.nome, caminho, err))
			continue
		}
		p.Avisos = append(p.Avisos, avisos...)
		if iguais(antes, depois) {
			if reg != nil {
				p.Notas = append(p.Notas, it.nome+": nada nosso em "+caminho)
				p.esquecer = append(p.esquecer, caminho)
			}
			continue
		}
		p.Mudancas = append(p.Mudancas, Mudanca{
			Integracao: it.nome, Arquivo: caminho, Antes: antes, Depois: depois, Resumo: resumo,
			todoNosso: it.todoNosso, mostrar: it.mostrar, semBackup: restaura, pasta: pastaAntigaDe(op, it),
		})
	}
	return p
}

// planejarVolta diz como fica o arquivo sem o nosso; restaura indica que ele volta
// ao estado de antes da instalação (o sha bate, então não há edição a proteger).
func planejarVolta(op Opcoes, it integracao, antes []byte, reg *registro) (depois []byte, resumo string, avisos []string, restaura bool, err error) {
	if reg != nil && reg.Sha == hash(antes) {
		switch {
		case reg.Criado:
			return nil, "apaga o arquivo, que foi criado pela instalação", nil, true, nil
		case reg.Backup != "":
			if original, err := os.ReadFile(reg.Backup); err == nil && !it.temNosso(op, original) {
				return original, "volta o backup " + reg.Backup + " (o arquivo não mudou desde a instalação)", nil, true, nil
			}
		}
	}
	depois, avisos, err = it.tirar(op, antes, reg)
	if err != nil || iguais(antes, depois) {
		return depois, "", avisos, false, err
	}
	resumo = "tira só as entradas " + marca
	if reg != nil && reg.Sha != hash(antes) {
		avisos = append(avisos, fmt.Sprintf("%s: o arquivo foi editado depois da instalação; tirei só as entradas %s e mantive o resto como está.", it.arquivo(op), marca))
	}
	return depois, resumo, avisos, false, nil
}

func pastaAntigaDe(op Opcoes, it integracao) string {
	if it.pastaAntiga == nil {
		return ""
	}
	return it.pastaAntiga(op)
}

func iguais(a, b []byte) bool {
	return (a == nil) == (b == nil) && bytes.Equal(a, b)
}

// Aplicar faz o plano. Se um arquivo mudar entre o plano e a escrita (a pessoa salvou
// no editor), replaneja a partir do conteúdo novo, até 3 vezes.
func Aplicar(p Plano) error {
	for tentativa := 0; ; tentativa++ {
		if len(p.Erros) > 0 {
			return errors.New(strings.Join(p.Erros, "\n"))
		}
		err := executar(p)
		if !errors.Is(err, errMudou) || tentativa == 2 {
			return err
		}
		if p.desfazer {
			p = PlanejarDesfazer(p.op)
		} else {
			p = Planejar(p.op)
		}
	}
}

// Desfazer planeja e aplica a retirada de tudo o que é nosso, e devolve o plano feito.
func Desfazer(op Opcoes) (Plano, error) {
	p := PlanejarDesfazer(op)
	return p, Aplicar(p)
}

func executar(p Plano) error {
	op := p.op
	man, err := op.lerManifesto()
	if err != nil {
		return err
	}
	if len(p.esquecer) > 0 {
		for _, c := range p.esquecer {
			delete(man.Arquivos, c)
		}
		if err := op.salvarManifesto(man); err != nil {
			return fmt.Errorf("manifesto: %w", err)
		}
	}
	for _, m := range p.Mudancas {
		shaAntes := ""
		if m.Antes != nil {
			shaAntes = hash(m.Antes)
		}
		backup := ""
		if m.Antes != nil && !m.todoNosso && !m.semBackup {
			if backup, err = op.backup(m.Arquivo, m.Antes); err != nil {
				return fmt.Errorf("backup de %s: %w", m.Arquivo, err)
			}
		}
		pasta := ""
		if m.Antes == nil {
			pasta = pastaQueFalta(filepath.Dir(m.Arquivo))
		}
		if m.Depois == nil {
			err = op.remover(m.Arquivo, shaAntes)
		} else {
			err = op.escrever(m.Arquivo, m.Depois, shaAntes)
		}
		if err != nil {
			if backup != "" {
				op.remover(backup, hash(mascararToken(m.Antes))) // o backup de uma escrita que não houve
			}
			return err
		}

		reg := man.Arquivos[m.Arquivo]
		switch {
		case p.desfazer || m.Depois == nil:
			if reg != nil {
				op.removerPastasVazias(filepath.Dir(m.Arquivo), reg.Pasta)
			} else if m.Depois == nil && m.pasta != "" {
				op.removerPastasVazias(filepath.Dir(m.Arquivo), m.pasta)
			}
			delete(man.Arquivos, m.Arquivo)
		case reg != nil && reg.Sha == shaAntes:
			reg.Sha = hash(m.Depois) // a cadeia segue nossa: o backup original continua valendo
		default:
			novo := &registro{Sha: hash(m.Depois), Criado: m.Antes == nil, Pasta: pasta}
			if m.limpo {
				novo.Backup = backup
			}
			man.Arquivos[m.Arquivo] = novo
		}
		if err := op.salvarManifesto(man); err != nil {
			return fmt.Errorf("manifesto: %w", err)
		}
	}
	return nil
}

// Texto é o plano para gente ler: o diff de cada arquivo (sem o token), as notas e
// os avisos.
func (p Plano) Texto() string {
	var b strings.Builder
	if p.desfazer {
		b.WriteString("Firmópolis: o que o desfazer muda\n")
	} else {
		b.WriteString("Firmópolis: o que o setup muda\n")
	}
	if len(p.Mudancas) == 0 {
		b.WriteString("\nNenhum arquivo muda.\n")
	}
	for _, m := range p.Mudancas {
		acao := "editar"
		switch {
		case m.Antes == nil:
			acao = "criar"
		case m.Depois == nil:
			acao = "apagar"
		}
		fmt.Fprintf(&b, "\n== %s: %s (%s)\n   %s\n", m.Integracao, m.Arquivo, acao, m.Resumo)
		if m.Antes != nil && !m.todoNosso && !m.semBackup {
			fmt.Fprintf(&b, "   backup antes: %s.bak-%s-<data>\n", m.Arquivo, marca)
		}
		if m.todoNosso && !m.mostrar {
			// Arquivo todo nosso (o plugin do OpenCode): o conteúdo é o modelo do repositório.
			if m.Depois != nil {
				fmt.Fprintf(&b, "   conteúdo: o modelo do repositório, %d linhas\n", len(linhas(m.Depois)))
			}
			continue
		}
		b.WriteString(diff(m.Antes, m.Depois))
	}
	secao := func(titulo string, itens []string) {
		if len(itens) == 0 {
			return
		}
		fmt.Fprintf(&b, "\n%s:\n", titulo)
		for _, i := range itens {
			fmt.Fprintf(&b, "  - %s\n", i)
		}
	}
	secao("Fica como está", p.Notas)
	secao("Avisos", p.Avisos)
	secao("Erros (nada será aplicado)", p.Erros)
	texto := string(mascararToken([]byte(b.String())))
	if p.op.Token != "" {
		texto = strings.ReplaceAll(texto, p.op.Token, "<token>")
	}
	return texto
}
