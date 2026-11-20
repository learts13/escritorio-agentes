package integracoes

import (
	"errors"
	"strings"
)

// O Claude Code e o Codex usam o mesmo formato: {"hooks": {"<Evento>": [<grupo>]}},
// com grupo = {"matcher": "", "hooks": [<hook>]}. O nosso é um grupo próprio no fim
// de cada lista, reconhecido pelo valor (a URL ou o comando), nunca por chave nova.

// timeoutHook é o prazo que o Claude Code, o agy e o Codex dão ao `ponte hook`,
// contado do spawn (no Codex, do PowerShell), em segundo plano ou não; estourou, o
// agente mata o processo. Não é a espera normal (o `ponte hook` sai sozinho em 0,9 s):
// é a folga para o primeiro uso de um ponte.exe novo, que leva de 1,2 a 2,5 s (até
// 4 s com a máquina carregada) para arrancar no Windows, enquanto o antivírus examina
// o binário. Com 2 s, os primeiros eventos depois de instalar ou atualizar se perdiam.
const timeoutHook = 10

// docOuVazio trata arquivo ausente ou em branco como um objeto vazio.
func docOuVazio(doc []byte) []byte {
	if len(strings.TrimSpace(string(trimBOM(doc)))) == 0 {
		return []byte("{}\n")
	}
	return doc
}

// raizObjeto lê doc e exige que a raiz seja um objeto.
func raizObjeto(doc []byte) (*no, error) {
	raiz, err := analisar(doc)
	if err != nil {
		return nil, err
	}
	if raiz.tipo != '{' {
		return nil, errors.New("a raiz não é um objeto JSON")
	}
	return raiz, nil
}

// instalarGrupos deixa um grupo nosso, igual a grupo, em cada evento: troca no lugar o
// nosso que mudou, tira os repetidos e acrescenta no fim das listas onde falta (no fim,
// para não mudar a posição dos hooks dos outros, que o Codex usa na aprovação).
// Devolve também se já havia algum grupo nosso.
func instalarGrupos(doc []byte, eventos []string, grupo any, nosso func(any) bool) ([]byte, bool, error) {
	doc = docOuVazio(doc)
	havia := false
	for _, ev := range eventos {
		for pronto := false; !pronto; {
			raiz, err := raizObjeto(doc)
			if err != nil {
				return nil, false, err
			}
			hooks := raiz.campo("hooks")
			if hooks == nil {
				doc = inserirCampo(doc, raiz, "hooks", objeto{})
				continue
			}
			if hooks.tipo != '{' {
				return nil, false, errors.New(`"hooks" não é um objeto`)
			}
			lista := hooks.campo(ev)
			if lista == nil {
				doc, pronto = inserirCampo(doc, hooks, ev, []any{grupo}), true
				continue
			}
			if lista.tipo != '[' {
				return nil, false, errors.New(`"hooks.` + ev + `" não é uma lista`)
			}
			var nossos []int
			for i, item := range lista.filhos {
				if nosso(item.valor(doc)) {
					nossos = append(nossos, i)
				}
			}
			switch {
			case len(nossos) == 0:
				doc, pronto = inserirItem(doc, lista, grupo), true
			case len(nossos) > 1:
				havia = true
				doc = removerFilho(doc, lista, nossos[len(nossos)-1])
			default:
				havia = true
				if item := lista.filhos[nossos[0]]; !mesmoValor(item.valor(doc), grupo) {
					doc = substituir(doc, item, grupo)
				}
				pronto = true
			}
		}
	}
	return doc, havia, nil
}

// tirarGrupos remove os grupos nossos de todos os eventos, e a lista (ou o "hooks")
// que ficar vazia por isso. meio diz se algum nosso tinha hooks dos outros depois.
func tirarGrupos(doc []byte, nosso func(any) bool) (novo []byte, meio bool, err error) {
	if len(strings.TrimSpace(string(trimBOM(doc)))) == 0 {
		return doc, false, nil
	}
	tirou := false
	for {
		raiz, err := raizObjeto(doc)
		if err != nil {
			return nil, false, err
		}
		hooks := raiz.campo("hooks")
		if hooks == nil || hooks.tipo != '{' {
			return doc, meio, nil
		}
		if tirou && len(hooks.filhos) == 0 {
			return removerFilho(doc, raiz, raiz.indice("hooks")), meio, nil
		}
		achou := false
		for i, lista := range hooks.filhos {
			if lista.tipo != '[' {
				continue
			}
			for j, item := range lista.filhos {
				if !nosso(item.valor(doc)) {
					continue
				}
				for _, depois := range lista.filhos[j+1:] {
					if !nosso(depois.valor(doc)) {
						meio = true
					}
				}
				if len(lista.filhos) == 1 {
					doc = removerFilho(doc, hooks, i)
				} else {
					doc = removerFilho(doc, lista, j)
				}
				achou = true
				break
			}
			if achou {
				break
			}
		}
		if !achou {
			return doc, meio, nil
		}
		tirou = true
	}
}

// temGrupo diz se doc tem algum grupo nosso.
func temGrupo(doc []byte, nosso func(any) bool) bool {
	novo, _, err := tirarGrupos(doc, nosso)
	return err == nil && string(novo) != string(doc)
}

// grupoCom diz se v é um grupo cujos hooks são todos reconhecidos por eh.
func grupoCom(v any, eh func(h map[string]any) bool) bool {
	g, ok := v.(map[string]any)
	if !ok {
		return false
	}
	hooks, ok := g["hooks"].([]any)
	if !ok || len(hooks) == 0 {
		return false
	}
	for _, h := range hooks {
		m, ok := h.(map[string]any)
		if !ok || !eh(m) {
			return false
		}
	}
	return true
}
