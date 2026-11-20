package integracoes

import (
	"path/filepath"
)

// O Escritório Vivo instalava os plugins do OpenCode e do MiniMax com a marca
// escritorio-vivo, em outro caminho. Estas duas integrações só tiram esses plugins:
// no --aplicar (para o agente não mandar cada evento em dobro) e no --desfazer. Só
// apagam o que é nosso: o hash bate com a nossa última escrita (o manifesto, que vem
// junto na migração da pasta de config) ou com o modelo que o Escritório Vivo punha (o
// plugin do OpenCode da última versão; o do MiniMax só com o mesmo caminho do exe).
// Arquivo de outra pessoa fica, com aviso.

// shaPluginOpenCodeAntigo é o sha256 do opencode-escritorio-vivo.js do Escritório Vivo.
const shaPluginOpenCodeAntigo = "b0b12256339e1a9ca283f19ba725a370c510d283a2df6386f016df45f4b9de80"

var (
	regraOpenCodeAntigo = tirarAntigo("OpenCode", marcaAntiga+".js", func(_ Opcoes, doc []byte) bool { return hash(doc) == shaPluginOpenCodeAntigo })
	regraMiniMaxAntigo  = tirarAntigo("MiniMax Code", "plugin "+marcaAntiga, func(op Opcoes, doc []byte) bool {
		return hash(doc) == hash(manifestoMiniMax(op, marcaAntiga, descricaoMiniMaxAntiga))
	})
)

var opencodeAntigo = integracao{
	nome: "OpenCode (plugin antigo)",
	arquivo: func(op Opcoes) string {
		return filepath.Join(op.Home, ".config", "opencode", "plugins", marcaAntiga+".js")
	},
	instalado: func(op Opcoes) bool { return existe(filepath.Join(op.Home, ".config", "opencode")) },
	instalar:  regraOpenCodeAntigo,
	tirar:     tirarComo(regraOpenCodeAntigo),
	temNosso:  func(_ Opcoes, doc []byte) bool { return doc != nil },
	todoNosso: true,
	antiga:    true,
}

// tirarComo usa a regra do instalar no desfazer: as integrações antigas só tiram.
func tirarComo(instalar func(Opcoes, []byte, *registro) ([]byte, string, []string, error)) func(Opcoes, []byte, *registro) ([]byte, []string, error) {
	return func(op Opcoes, doc []byte, reg *registro) ([]byte, []string, error) {
		depois, _, avisos, err := instalar(op, doc, reg)
		return depois, avisos, err
	}
}

var miniMaxAntigo = integracao{
	nome: "MiniMax Code (plugin antigo)",
	arquivo: func(op Opcoes) string {
		return filepath.Join(pastaPluginMiniMaxAntiga(op), ".claude-plugin", "plugin.json")
	},
	instalado:   func(op Opcoes) bool { return existe(dirMiniMax(op)) },
	instalar:    regraMiniMaxAntigo,
	tirar:       tirarComo(regraMiniMaxAntigo),
	temNosso:    func(_ Opcoes, doc []byte) bool { return doc != nil },
	todoNosso:   true,
	antiga:      true,
	pastaAntiga: pastaPluginMiniMaxAntiga,
}

func pastaPluginMiniMaxAntiga(op Opcoes) string {
	return filepath.Join(dirMiniMax(op), "plugins", marcaAntiga)
}

// tirarAntigo apaga o arquivo antigo, se for nosso; senão, deixa e avisa.
func tirarAntigo(agente, oque string, doModelo func(Opcoes, []byte) bool) func(Opcoes, []byte, *registro) ([]byte, string, []string, error) {
	return func(op Opcoes, doc []byte, reg *registro) ([]byte, string, []string, error) {
		if doc == nil {
			return nil, "", nil, nil
		}
		if (reg != nil && reg.Sha == hash(doc)) || doModelo(op, doc) {
			return nil, "apaga o " + oque + " do Escritório Vivo (o novo é o " + marca + ")", nil, nil
		}
		return doc, "", []string{agente + ": o " + oque + " do Escritório Vivo foi alterado ou não é o nosso; não mexi nele. Se for o antigo, apague à mão: com os dois, cada evento vai em dobro."}, nil
	}
}
