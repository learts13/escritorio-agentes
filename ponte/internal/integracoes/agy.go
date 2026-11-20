package integracoes

import (
	"fmt"
	"path/filepath"
	"strings"
)

// eventosAgy são os eventos que o normalizador do agy usa (fontes/agy).
var eventosAgy = []string{"SessionStart", "PreInvocation", "PreToolUse", "Stop"}

// O hooks.json do agy é {"<nome>": {"<Evento>": [<hook>]}}: a nossa entrada é a de
// nome "firmopolis", ao lado das outras. A "escritorio-vivo" (marcaAntiga) sai junto.
var agy = integracao{
	nome: "agy",
	arquivo: func(op Opcoes) string {
		return filepath.Join(op.Home, ".gemini", "config", "hooks.json")
	},
	instalado: func(op Opcoes) bool { return existe(filepath.Join(op.Home, ".gemini")) },
	instalar: func(op Opcoes, doc []byte, _ *registro) ([]byte, string, []string, error) {
		doc = docOuVazio(doc)
		raiz, err := raizObjeto(doc)
		if err != nil {
			return nil, "", nil, err
		}
		quero := entradaAgy(op)
		resumo := fmt.Sprintf("entrada %q com o comando `%s` em %d eventos (%s)", marca, comandoPosix(op.Exe, "agy"), len(eventosAgy), strings.Join(eventosAgy, ", "))
		if i := raiz.indice(marcaAntiga); i >= 0 { // a do Escritório Vivo: sem ela, os eventos não vão em dobro
			resumo += fmt.Sprintf("; tira a entrada antiga %q", marcaAntiga)
			doc = removerFilho(doc, raiz, i)
			if raiz, err = raizObjeto(doc); err != nil {
				return nil, "", nil, err
			}
		}
		switch atual := raiz.campo(marca); {
		case atual == nil:
			return inserirCampo(doc, raiz, marca, quero), resumo, nil, nil
		case !mesmoValor(atual.valor(doc), quero):
			return substituir(doc, atual, quero), resumo, nil, nil
		}
		return doc, resumo, nil, nil
	},
	tirar: func(_ Opcoes, doc []byte, _ *registro) ([]byte, []string, error) {
		raiz, err := raizObjeto(docOuVazio(doc))
		if err != nil {
			return nil, nil, err
		}
		for _, m := range []string{marca, marcaAntiga} {
			if i := raiz.indice(m); i >= 0 {
				doc = removerFilho(doc, raiz, i)
				if raiz, err = raizObjeto(doc); err != nil {
					return nil, nil, err
				}
			}
		}
		return doc, nil, nil
	},
	temNosso: func(_ Opcoes, doc []byte) bool {
		raiz, err := raizObjeto(docOuVazio(doc))
		return err == nil && (raiz.campo(marca) != nil || raiz.campo(marcaAntiga) != nil)
	},
}

func entradaAgy(op Opcoes) objeto {
	var e objeto
	for _, ev := range eventosAgy {
		e = append(e, par{ev, []any{objeto{
			{"type", "command"},
			{"command", comandoPosix(op.Exe, "agy")},
			{"timeout", timeoutHook},
		}}})
	}
	return e
}
