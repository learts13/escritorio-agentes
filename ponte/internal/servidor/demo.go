package servidor

import (
	"fmt"

	"firmopolis/ponte/internal/maestri"
	"firmopolis/ponte/internal/mundo"
)

// demo gera 10 moradores de mentira (--demo) que mudam de estado a cada passo, para
// testar o jogo sem nenhum agente rodando. Não lê nada real e nunca grava histórico.
type demo struct {
	passos int
}

var (
	nomesDemo       = []string{"Ada", "Bento", "Cecília", "Davi", "Elisa", "Fábio", "Gaia", "Heitor", "Íris", "João"}
	papeisDemo      = []string{"Maestro", "Implementador Sênior", "Auditor", "Front", "Arquiteto"}
	provedoresDemo  = []string{mundo.ProvedorClaude, mundo.ProvedorCodex, mundo.ProvedorOpenCode, mundo.ProvedorAgy}
	estadosDemo     = []mundo.Estado{mundo.Ocupado, mundo.Ocioso, mundo.Ocupado, mundo.EsperandoPermissao, mundo.Ocupado, mundo.EsperandoResposta, mundo.Ocioso, mundo.Erro}
	atividadesDemo  = [][2]string{{"Edit", "main.go"}, {"Bash", "go test ./..."}, {"Read", "README.md"}, {"WebFetch", "https://exemplo.com/docs"}}
	tamanhoBandDemo = 6
)

func idDemo(i int) string { return fmt.Sprintf("demo-%02d", i+1) }

// passo devolve, na 1ª vez, o workspace e as metas; e, em todas, o estado de cada morador.
func (d *demo) passo() ([]maestri.Workspace, []mundo.MetaTerminal, []mundo.Sinal) {
	var workspaces []maestri.Workspace
	var metas []mundo.MetaTerminal
	if d.passos == 0 {
		band := maestri.Band{ID: "demo-band", Nome: "Time da demonstração", Membros: []string{}}
		for i, nome := range nomesDemo {
			meta := mundo.MetaTerminal{ID: idDemo(i), Nome: nome, Papel: papeisDemo[i%len(papeisDemo)],
				Provedor: provedoresDemo[i%len(provedoresDemo)], WorkspaceID: "demo", Gerente: i == 0}
			if i < tamanhoBandDemo {
				meta.BandID = band.ID
				band.Membros = append(band.Membros, meta.ID)
			}
			metas = append(metas, meta)
		}
		workspaces = []maestri.Workspace{{ID: "demo", Nome: "Demonstração", Projeto: "firmopolis", Bands: []maestri.Band{band}}}
	}

	sinais := make([]mundo.Sinal, 0, len(nomesDemo))
	for i := range nomesDemo {
		s := mundo.Sinal{Fonte: provedoresDemo[i%len(provedoresDemo)], SessaoID: fmt.Sprintf("sessao-%02d", i+1),
			TerminalID: idDemo(i), Estado: estadosDemo[(d.passos+3*i)%len(estadosDemo)], Cwd: "/demo/firmopolis"}
		if s.Estado == mundo.Ocupado {
			a := atividadesDemo[(d.passos+i)%len(atividadesDemo)]
			s.Ferramenta, s.Alvo = a[0], a[1]
		}
		sinais = append(sinais, s)
	}
	d.passos++
	return workspaces, metas, sinais
}
