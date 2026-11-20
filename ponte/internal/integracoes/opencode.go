package integracoes

import (
	"path/filepath"

	"firmopolis/ponte/integracoes/modelos"
)

func pluginOpenCode() []byte { return modelos.PluginOpenCode }

// nossoPlugin diz se doc é o plugin que nós pusemos: o modelo atual ou o da nossa
// última escrita (uma versão anterior da ponte).
func nossoPlugin(doc []byte, reg *registro) bool {
	return hash(doc) == hash(pluginOpenCode()) || (reg != nil && hash(doc) == reg.Sha)
}

// O plugin é um arquivo todo nosso em ~/.config/opencode/plugins: sem backup, e o
// desfazer só apaga se o hash for o nosso.
var opencode = integracao{
	nome: "OpenCode",
	arquivo: func(op Opcoes) string {
		return filepath.Join(op.Home, ".config", "opencode", "plugins", marca+".js")
	},
	instalado: func(op Opcoes) bool { return existe(filepath.Join(op.Home, ".config", "opencode")) },
	instalar: func(op Opcoes, doc []byte, reg *registro) ([]byte, string, []string, error) {
		resumo := "plugin " + marca + ".js (envia o estado das sessões para a ponte)"
		if doc != nil && !nossoPlugin(doc, reg) {
			return doc, resumo, []string{"OpenCode: já existe um " + marca + ".js que não é o nosso; não mexi nele."}, nil
		}
		return pluginOpenCode(), resumo, nil, nil
	},
	tirar: func(op Opcoes, doc []byte, reg *registro) ([]byte, []string, error) {
		if nossoPlugin(doc, reg) {
			return nil, nil, nil
		}
		return doc, []string{"OpenCode: o " + marca + ".js foi alterado (o hash não é o nosso); mantive o arquivo."}, nil
	},
	temNosso:  func(_ Opcoes, doc []byte) bool { return doc != nil && hash(doc) == hash(pluginOpenCode()) },
	todoNosso: true,
}
