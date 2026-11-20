// Package maestri lê os terminais, workspaces e bands do Maestri, só para observar.
//
// Lê apenas preferences.json (rolePresets: id e nome) e workspaces/*/workspace.json
// (id, nome e workingDirectory do workspace; id, nome, agentType, assignedRoleId,
// isManager e workingDirectory de cada terminal; nome e membros das bands; groundPath e
// clonePath dos floors), como manda a spec 6.2. As pastas só servem para dar o projeto
// (pacote projeto) e não vão para o jogo. Nunca abre license.json
// nem accounts/. O status do terminal no workspace.json é obsoleto (laudo da Fase 0) e
// nem é decodificado: o estado do morador vem só das sessões vivas.
package maestri

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"time"

	"firmopolis/ponte/internal/mundo"
	"firmopolis/ponte/internal/projeto"
)

// Maestri é o que o leitor entrega: os workspaces (com as bands) e os terminais.
type Maestri struct {
	Workspaces []Workspace
	Terminais  []mundo.MetaTerminal
}

// Workspace e Band seguem o snapshot do contrato v1. Ids sempre em minúsculas.
// Projeto nunca é vazio (ver projetoDoWorkspace); Pasta é o workingDirectory, que fica
// na ponte.
type Workspace struct {
	ID      string `json:"id"`
	Nome    string `json:"nome"`
	Projeto string `json:"projeto"`
	Bands   []Band `json:"bands"`
	Pasta   string `json:"-"`
}

type Band struct {
	ID      string   `json:"id"`
	Nome    string   `json:"nome"`
	Membros []string `json:"membros"`
}

// intervaloObservar é o passo do polling do Observar. Não há watcher: o plano limita
// as dependências à biblioteca padrão (mais o websocket), e um stat por arquivo a
// cada 2 s custa quase nada.
var intervaloObservar = 2 * time.Second

const arquivoPreferencias = "preferences.json"
const padraoWorkspaces = "workspaces/*/workspace.json"

// LerTudo lê o Maestri de dataDir (~/.maestri). Pasta ausente (Maestri não
// instalado) devolve tudo vazio, sem erro; arquivo parcial é pulado.
func LerTudo(dataDir string) (Maestri, error) {
	return novoLeitor(os.DirFS(dataDir)).ler()
}

// Observar chama mudou com a 1ª leitura e depois a cada mudança, até ctx acabar.
// Arquivo parcial (o Maestri regravando) não avisa: vale o último bom de cada arquivo.
func Observar(ctx context.Context, dataDir string, mudou func(Maestri)) {
	o := NovoObservador(dataDir)
	passo := time.NewTicker(intervaloObservar)
	defer passo.Stop()
	for {
		if m, ok := o.Passo(); ok {
			mudou(m)
		}
		select {
		case <-ctx.Done():
			return
		case <-passo.C:
		}
	}
}

// Observador é o Observar sem laço próprio, para quem já tem o seu ticker (o servidor
// usa um só). Não é seguro para uso concorrente: um só chamador.
type Observador struct {
	l          *leitor
	assinatura string
	ultimo     Maestri
	primeira   bool
}

func NovoObservador(dataDir string) *Observador {
	return &Observador{l: novoLeitor(os.DirFS(dataDir)), primeira: true}
}

// Passo relê o que mudou desde o passo anterior. Devolve true na 1ª leitura e quando o
// resultado muda; arquivo parcial mantém o último bom e é relido no passo seguinte.
func (o *Observador) Passo() (Maestri, bool) {
	a, err := o.l.assinatura()
	if err != nil || (!o.primeira && a == o.assinatura) {
		return o.ultimo, false
	}
	m, err := o.l.ler()
	if err != nil {
		return o.ultimo, false
	}
	if !o.l.parcial {
		o.assinatura = a
	}
	if !o.primeira && reflect.DeepEqual(m, o.ultimo) {
		return m, false
	}
	o.primeira, o.ultimo = false, m
	return m, true
}

// leitor guarda o último bom de cada arquivo, para uma leitura parcial não apagar nada.
type leitor struct {
	fsys       fs.FS
	projetos   *projeto.Resolvedor
	papeis     map[string]string // id do role (minúsculo) → nome
	workspaces map[string]lido   // caminho do workspace.json → último bom
	parcial    bool              // a última leitura achou arquivo que não se leu
}

type lido struct {
	ws        Workspace
	terminais []terminal
}

type terminal struct {
	meta  mundo.MetaTerminal
	papel string // id do role, resolvido na montagem
}

func novoLeitor(fsys fs.FS) *leitor {
	return &leitor{fsys: fsys, projetos: projeto.Padrao(), papeis: map[string]string{}, workspaces: map[string]lido{}}
}

func (l *leitor) ler() (Maestri, error) {
	l.parcial = false
	if dados, err := fs.ReadFile(l.fsys, arquivoPreferencias); errors.Is(err, fs.ErrNotExist) {
		l.papeis = map[string]string{}
	} else if p, ok := lerPreferencias(dados, err); ok {
		l.papeis = p
	} else {
		l.parcial = true
	}

	arquivos, err := fs.Glob(l.fsys, padraoWorkspaces)
	if err != nil {
		return Maestri{}, err
	}
	presentes := map[string]bool{}
	for _, arq := range arquivos {
		presentes[arq] = true
		dados, err := fs.ReadFile(l.fsys, arq)
		if w, ok := l.lerWorkspace(dados, err); ok {
			l.workspaces[arq] = w
		} else {
			l.parcial = true
		}
	}
	for arq := range l.workspaces {
		if !presentes[arq] {
			delete(l.workspaces, arq) // apagado de verdade
		}
	}
	return l.montar(), nil
}

// assinatura muda quando algum arquivo lido muda (nome, hora e tamanho).
func (l *leitor) assinatura() (string, error) {
	arquivos, err := fs.Glob(l.fsys, padraoWorkspaces)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, arq := range append([]string{arquivoPreferencias}, arquivos...) {
		b.WriteString(arq)
		if info, err := fs.Stat(l.fsys, arq); err == nil {
			b.WriteString("|" + strconv.FormatInt(info.ModTime().UnixNano(), 10) + "|" + strconv.FormatInt(info.Size(), 10))
		}
		b.WriteString("\n")
	}
	return b.String(), nil
}

func (l *leitor) montar() Maestri {
	m := Maestri{Workspaces: []Workspace{}, Terminais: []mundo.MetaTerminal{}}
	for _, w := range l.workspaces {
		m.Workspaces = append(m.Workspaces, w.ws)
		for _, t := range w.terminais {
			t.meta.Papel = l.papeis[t.papel]
			m.Terminais = append(m.Terminais, t.meta)
		}
	}
	sort.Slice(m.Workspaces, func(i, j int) bool { return m.Workspaces[i].ID < m.Workspaces[j].ID })
	sort.Slice(m.Terminais, func(i, j int) bool { return m.Terminais[i].ID < m.Terminais[j].ID })
	return m
}

// Os formatos abaixo decodificam só os campos permitidos; o resto do arquivo é pulado.

type arquivoPrefs struct {
	Payload *struct {
		RolePresets []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"rolePresets"`
	} `json:"payload"`
}

func lerPreferencias(dados []byte, err error) (map[string]string, bool) {
	var a arquivoPrefs
	if err != nil || json.Unmarshal(dados, &a) != nil || a.Payload == nil {
		return nil, false
	}
	papeis := map[string]string{}
	for _, r := range a.Payload.RolePresets {
		papeis[strings.ToLower(r.ID)] = r.Name
	}
	return papeis, true
}

type no struct {
	ID      string `json:"id"`
	Content struct {
		Terminal *struct {
			T struct {
				ID               string `json:"id"`
				Name             string `json:"name"`
				AgentType        string `json:"agentType"`
				AssignedRoleID   string `json:"assignedRoleId"`
				IsManager        bool   `json:"isManager"`
				WorkingDirectory string `json:"workingDirectory"`
			} `json:"_0"`
		} `json:"terminal"`
		Band *struct {
			B struct {
				Name          string   `json:"name"`
				MemberNodeIDs []string `json:"memberNodeIds"`
			} `json:"_0"`
		} `json:"band"`
	} `json:"content"`
}

type arquivoWorkspace struct {
	Payload *struct {
		ID               string `json:"id"`
		Name             string `json:"name"`
		WorkingDirectory string `json:"workingDirectory"`
		Nodes            []no   `json:"nodes"`
		Floors           []struct {
			GroundPath string `json:"groundPath"`
			ClonePath  string `json:"clonePath"`
			Nodes      []no   `json:"nodes"`
		} `json:"floors"`
	} `json:"payload"`
}

func (l *leitor) lerWorkspace(dados []byte, err error) (lido, bool) {
	var a arquivoWorkspace
	if err != nil || json.Unmarshal(dados, &a) != nil || a.Payload == nil || a.Payload.ID == "" {
		return lido{}, false
	}
	p := a.Payload
	w := lido{ws: Workspace{ID: strings.ToLower(p.ID), Nome: p.Name, Bands: []Band{}, Pasta: p.WorkingDirectory}}

	// Terminais do chão e dos floors do workspace têm o mesmo formato de nó. O projeto
	// de cada terminal vem da pasta dele; sem ela, do floor; sem floor, do workspace.
	nos := p.Nodes
	proprio := map[string]string{} // id do terminal → projeto da pasta dele ou do floor
	var candidatos []string        // projetos dos floors e das pastas dos terminais
	for _, f := range p.Floors {
		pf := l.projetos.De(f.GroundPath)
		if pf == "" {
			pf = l.projetos.De(f.ClonePath)
		}
		candidatos = append(candidatos, pf)
		for _, n := range f.Nodes {
			if n.Content.Terminal != nil {
				proprio[strings.ToLower(n.Content.Terminal.T.ID)] = pf
			}
		}
		nos = append(nos, f.Nodes...)
	}
	for _, n := range nos {
		if t := n.Content.Terminal; t != nil {
			if pt := l.projetos.De(t.T.WorkingDirectory); pt != "" {
				proprio[strings.ToLower(t.T.ID)] = pt
				candidatos = append(candidatos, pt)
			}
		}
	}
	w.ws.Projeto = projetoDoWorkspace(l.projetos.De(p.WorkingDirectory), p.Name, candidatos)

	eTerminal := map[string]bool{}
	for _, n := range nos {
		if n.Content.Terminal != nil {
			eTerminal[strings.ToLower(n.Content.Terminal.T.ID)] = true
		}
	}

	bandDe := map[string]string{}
	for _, n := range nos {
		if n.Content.Band == nil {
			continue
		}
		b := Band{ID: strings.ToLower(n.ID), Nome: n.Content.Band.B.Name, Membros: []string{}}
		for _, membro := range n.Content.Band.B.MemberNodeIDs {
			// Membro é o id do nó; no nó de terminal, node.id == terminal.id.
			if id := strings.ToLower(membro); eTerminal[id] {
				b.Membros = append(b.Membros, id)
				if _, ja := bandDe[id]; !ja {
					bandDe[id] = b.ID
				}
			}
		}
		w.ws.Bands = append(w.ws.Bands, b)
	}

	for _, n := range nos {
		if n.Content.Terminal == nil {
			continue
		}
		t := n.Content.Terminal.T
		id := strings.ToLower(t.ID)
		pt := proprio[id]
		if pt == "" {
			pt = w.ws.Projeto
		}
		w.terminais = append(w.terminais, terminal{
			meta: mundo.MetaTerminal{ID: id, Nome: t.Name, Provedor: provedor(t.AgentType),
				WorkspaceID: w.ws.ID, BandID: bandDe[id], Gerente: t.IsManager, Projeto: pt},
			papel: strings.ToLower(t.AssignedRoleID),
		})
	}
	return w, true
}

// projetoDoWorkspace é o projeto da pasta do workspace; com a pasta genérica (a home),
// o mais comum entre os candidatos (no empate, o primeiro em ordem alfabética); sem
// nenhum, o nome do canvas.
func projetoDoWorkspace(daPasta, nome string, candidatos []string) string {
	if daPasta != "" {
		return daPasta
	}
	contagem := map[string]int{}
	melhor := ""
	for _, c := range candidatos {
		if c == "" {
			continue
		}
		contagem[c]++
		if melhor == "" || contagem[c] > contagem[melhor] || (contagem[c] == contagem[melhor] && c < melhor) {
			melhor = c
		}
	}
	if melhor != "" {
		return melhor
	}
	return nome
}

// Pastas liga a pasta de cada workspace (projeto.Chave) ao projeto dele, para o
// registro dar projeto ao solto cujo cwd é o papel do Maestri numa pasta genérica. Pasta
// de mais de um workspace, com projetos diferentes, fica vazia: não dá para saber qual é.
func Pastas(workspaces []Workspace) map[string]string {
	pastas := map[string]string{}
	for _, w := range workspaces {
		if w.Pasta == "" {
			continue
		}
		k := projeto.Chave(w.Pasta)
		if antes, ja := pastas[k]; ja && antes != w.Projeto {
			pastas[k] = ""
			continue
		}
		pastas[k] = w.Projeto
	}
	return pastas
}

// provedor confere o agentType contra os provedores do contrato.
func provedor(agentType string) string {
	switch agentType {
	case mundo.ProvedorClaude, mundo.ProvedorCodex, mundo.ProvedorOpenCode, mundo.ProvedorAgy, mundo.ProvedorMiniMax:
		return agentType
	}
	return mundo.ProvedorDesconhecido
}
