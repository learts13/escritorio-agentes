package integracoes

import (
	"fmt"
	"path/filepath"
	"strings"
)

// eventosMiniMax são os eventos que o normalizador do mcode usa (fontes/minimax). Sem
// o PreToolUse: o hook do mcode é síncrono (uns 330 ms por evento com o bash), e o
// PostToolUse já dá a atividade e tira a espera. O mcode 0.7.7 não tem StopFailure.
var eventosMiniMax = []string{"SessionStart", "UserPromptSubmit", "PermissionRequest", "PostToolUse", "SubagentStart", "SubagentStop", "Stop", "SessionEnd"}

// dirMiniMax é a pasta de dados do mcode: o MINIMAX_DATA_DIR (Opcoes.DirMiniMax) ou
// ~/.minimax.
func dirMiniMax(op Opcoes) string {
	if op.DirMiniMax != "" {
		return op.DirMiniMax
	}
	return filepath.Join(op.Home, ".minimax")
}

// pastaPluginMiniMax é a pasta do nosso plugin local. O mcode vigia <dados>/plugins e
// carrega o plugin sozinho (não há comando de instalar); sem a pasta, ele sai.
func pastaPluginMiniMax(op Opcoes) string {
	return filepath.Join(dirMiniMax(op), "plugins", marca)
}

// O plugin é um arquivo só, todo nosso: o .claude-plugin/plugin.json, com os hooks
// inline (o mcode aceita o objeto no campo "hooks" do manifesto no lugar do
// hooks/hooks.json). Sem backup; o desfazer apaga o arquivo e as pastas que criamos.
var miniMax = integracao{
	nome: "MiniMax Code",
	arquivo: func(op Opcoes) string {
		return filepath.Join(pastaPluginMiniMax(op), ".claude-plugin", "plugin.json")
	},
	instalado: func(op Opcoes) bool { return existe(dirMiniMax(op)) },
	instalar: func(op Opcoes, doc []byte, reg *registro) ([]byte, string, []string, error) {
		resumo := fmt.Sprintf("plugin local %s com o hook `%s` em %d eventos (%s)", marca, comandoBash(op.Exe, "mcode"), len(eventosMiniMax), strings.Join(eventosMiniMax, ", "))
		if doc != nil && !nossoPluginMiniMax(op, doc, reg) {
			return doc, resumo, []string{"MiniMax Code: já existe um plugin " + marca + " que não é o nosso; não mexi nele."}, nil
		}
		return pluginMiniMax(op), resumo, nil, nil
	},
	tirar: func(op Opcoes, doc []byte, reg *registro) ([]byte, []string, error) {
		if nossoPluginMiniMax(op, doc, reg) {
			return nil, nil, nil
		}
		return doc, []string{"MiniMax Code: o plugin " + marca + " foi alterado (o hash não é o nosso); mantive o arquivo."}, nil
	},
	temNosso:  func(op Opcoes, doc []byte) bool { return doc != nil && hash(doc) == hash(pluginMiniMax(op)) },
	todoNosso: true,
	mostrar:   true,
}

// nossoPluginMiniMax diz se doc é o plugin que nós pusemos: o de agora ou o da nossa
// última escrita (outro caminho do ponte.exe, outra versão da ponte).
func nossoPluginMiniMax(op Opcoes, doc []byte, reg *registro) bool {
	return hash(doc) == hash(pluginMiniMax(op)) || (reg != nil && hash(doc) == reg.Sha)
}

// pluginMiniMax é o manifesto do plugin. O mcode roda o comando no Git Bash, espera o
// hook (de 1 a 10 s de timeout) e só mostra algo com saída ou exit diferente de 0; o
// `ponte hook` sai sempre com 0 e calado.
func pluginMiniMax(op Opcoes) []byte {
	return manifestoMiniMax(op, marca, "Firmópolis: avisa a ponte local (127.0.0.1) do estado das sessões")
}

// descricaoMiniMaxAntiga é a do plugin do Escritório Vivo (para reconhecê-lo pelo hash).
const descricaoMiniMaxAntiga = "Escritório Vivo: avisa a ponte local (127.0.0.1) do estado das sessões"

func manifestoMiniMax(op Opcoes, nome, descricao string) []byte {
	var hooks objeto
	for _, ev := range eventosMiniMax {
		hooks = append(hooks, par{ev, []any{objeto{
			{"matcher", ""},
			{"hooks", []any{objeto{
				{"type", "command"},
				{"command", comandoBash(op.Exe, "mcode")},
				{"timeout", timeoutHook},
			}}},
		}}})
	}
	manifesto := objeto{
		{"name", nome},
		{"version", "1.0.0"},
		{"description", descricao},
		{"author", objeto{{"name", "Dev Maniac's"}}},
		{"hooks", objeto{{"hooks", hooks}}},
	}
	return append(renderizar(manifesto, "", estilo{recuo: "  ", nl: "\n"}), '\n')
}
