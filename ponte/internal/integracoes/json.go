package integracoes

import (
	"bytes"
	"encoding/json"
	"errors"
	"reflect"
)

// Edição cirúrgica de JSON: o documento é lido uma vez só para saber onde cada valor
// começa e termina (offsets do json.Decoder), e cada mudança troca só a faixa de bytes
// necessária. Tudo fora dela (recuo, ordem das chaves, fim de linha, espaços) fica como
// o usuário deixou.

var bom = []byte("\xef\xbb\xbf")

// no é um valor JSON com a faixa [ini, fim) que ocupa no texto.
type no struct {
	ini, fim int
	tipo     byte     // '{', '[' ou 0 (escalar)
	chaves   []string // objeto: as chaves, na ordem do texto
	iniChave []int    // objeto: onde começa cada chave (a aspa)
	filhos   []*no    // objeto: os valores; lista: os itens
}

var errInvalido = errors.New("não é um JSON válido")

func trimBOM(doc []byte) []byte { return bytes.TrimPrefix(doc, bom) }

// analisar lê doc e devolve a árvore de posições. JSON inválido é erro.
func analisar(doc []byte) (*no, error) {
	corpo := trimBOM(doc)
	if !json.Valid(corpo) {
		return nil, errInvalido
	}
	dec := json.NewDecoder(bytes.NewReader(corpo))
	return lerNo(dec, doc, len(doc)-len(corpo))
}

// inicioToken pula o que pode vir entre dois tokens (espaço, vírgula e dois-pontos).
func inicioToken(doc []byte, pos int) int {
	for pos < len(doc) {
		switch doc[pos] {
		case ' ', '\t', '\n', '\r', ',', ':':
			pos++
		default:
			return pos
		}
	}
	return pos
}

func lerNo(dec *json.Decoder, doc []byte, base int) (*no, error) {
	n := &no{ini: inicioToken(doc, base+int(dec.InputOffset()))}
	tok, err := dec.Token()
	if err != nil {
		return nil, err
	}
	switch tok {
	case json.Delim('{'):
		n.tipo = '{'
		for dec.More() {
			ini := inicioToken(doc, base+int(dec.InputOffset()))
			chave, err := dec.Token()
			if err != nil {
				return nil, err
			}
			filho, err := lerNo(dec, doc, base)
			if err != nil {
				return nil, err
			}
			n.chaves = append(n.chaves, chave.(string))
			n.iniChave = append(n.iniChave, ini)
			n.filhos = append(n.filhos, filho)
		}
		if _, err := dec.Token(); err != nil {
			return nil, err
		}
	case json.Delim('['):
		n.tipo = '['
		for dec.More() {
			filho, err := lerNo(dec, doc, base)
			if err != nil {
				return nil, err
			}
			n.filhos = append(n.filhos, filho)
		}
		if _, err := dec.Token(); err != nil {
			return nil, err
		}
	}
	n.fim = base + int(dec.InputOffset())
	return n, nil
}

// campo devolve o valor da chave num objeto (nil se não há).
func (n *no) campo(chave string) *no {
	if i := n.indice(chave); i >= 0 {
		return n.filhos[i]
	}
	return nil
}

func (n *no) indice(chave string) int {
	for i, k := range n.chaves {
		if k == chave {
			return i
		}
	}
	return -1
}

// valor decodifica o trecho do nó.
func (n *no) valor(doc []byte) any {
	var v any
	json.Unmarshal(doc[n.ini:n.fim], &v) // o documento inteiro já foi validado
	return v
}

// mesmoValor compara um valor decodificado com um valor Go, pelo JSON dos dois.
func mesmoValor(atual, quero any) bool {
	dados, err := json.Marshal(quero)
	if err != nil {
		return false
	}
	var v any
	json.Unmarshal(dados, &v)
	return reflect.DeepEqual(atual, v)
}

// estilo é o jeito do arquivo: unidade de recuo, fim de linha e se é de uma linha só.
type estilo struct {
	recuo, nl string
	compacto  bool
}

func detectarEstilo(doc []byte) estilo {
	e := estilo{recuo: "  ", nl: "\n"}
	if bytes.Contains(doc, []byte("\r\n")) {
		e.nl = "\r\n"
	}
	corpo := bytes.TrimSpace(trimBOM(doc))
	e.compacto = !bytes.Contains(corpo, []byte("\n")) && len(corpo) > 2
	for _, linha := range bytes.Split(doc, []byte("\n"))[1:] {
		r := linha[:len(linha)-len(bytes.TrimLeft(linha, " \t"))]
		if len(r) > 0 && len(bytes.TrimSpace(linha)) > 0 {
			e.recuo = string(r)
			break
		}
	}
	return e
}

// recuoDaLinha é o recuo da linha onde fica pos.
func recuoDaLinha(doc []byte, pos int) string {
	ini := bytes.LastIndexByte(doc[:pos], '\n') + 1
	fim := ini
	for fim < len(doc) && (doc[fim] == ' ' || doc[fim] == '\t') {
		fim++
	}
	return string(doc[ini:fim])
}

// renderizar escreve v no estilo do arquivo, com as linhas seguintes a partir de
// prefixo. Sem escapar <, > e & (o commandWindows do Codex começa com "& ").
func renderizar(v any, prefixo string, e estilo) []byte {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if !e.compacto {
		enc.SetIndent(prefixo, e.recuo)
	}
	enc.Encode(v) // só valores montados aqui, que sempre serializam
	saida := bytes.TrimSuffix(buf.Bytes(), []byte("\n"))
	if e.nl != "\n" {
		saida = bytes.ReplaceAll(saida, []byte("\n"), []byte(e.nl))
	}
	return saida
}

func trocar(doc []byte, ini, fim int, novo []byte) []byte {
	saida := make([]byte, 0, len(doc)-(fim-ini)+len(novo))
	saida = append(saida, doc[:ini]...)
	saida = append(saida, novo...)
	return append(saida, doc[fim:]...)
}

// mesmaLinha diz se não há quebra de linha entre a e b.
func mesmaLinha(doc []byte, a, b int) bool {
	return !bytes.Contains(doc[a:b], []byte("\n"))
}

// inserir põe um filho novo no fim de pai. texto escreve o filho (com a chave, num
// objeto) no estilo dado, com as linhas seguintes a partir de prefixo.
func inserir(doc []byte, pai *no, texto func(prefixo string, e estilo) []byte) []byte {
	e := detectarEstilo(doc)
	if len(pai.filhos) == 0 {
		if e.compacto {
			return trocar(doc, pai.ini+1, pai.fim-1, texto("", e))
		}
		base := recuoDaLinha(doc, pai.ini)
		item := base + e.recuo
		novo := append([]byte(e.nl+item), texto(item, e)...)
		return trocar(doc, pai.ini+1, pai.fim-1, append(novo, e.nl+base...))
	}
	ultimo := pai.filhos[len(pai.filhos)-1]
	iniUltimo := ultimo.ini
	if pai.tipo == '{' {
		iniUltimo = pai.iniChave[len(pai.iniChave)-1]
	}
	if e.compacto || mesmaLinha(doc, pai.ini, iniUltimo) {
		// Lista ou objeto escrito numa linha só: o novo filho vai na mesma linha.
		sep := ", "
		if e.compacto {
			sep = ","
		}
		linha := e
		linha.compacto = true
		return trocar(doc, ultimo.fim, ultimo.fim, append([]byte(sep), texto("", linha)...))
	}
	item := recuoDaLinha(doc, iniUltimo)
	novo := append([]byte(","+e.nl+item), texto(item, e)...)
	return trocar(doc, ultimo.fim, ultimo.fim, novo)
}

func inserirItem(doc []byte, lista *no, v any) []byte {
	return inserir(doc, lista, func(prefixo string, e estilo) []byte {
		return renderizar(v, prefixo, e)
	})
}

func inserirCampo(doc []byte, obj *no, chave string, v any) []byte {
	k, _ := json.Marshal(chave)
	return inserir(doc, obj, func(prefixo string, e estilo) []byte {
		sep := ": "
		if e.compacto {
			sep = ":"
		}
		return append(append(k, sep...), renderizar(v, prefixo, e)...)
	})
}

// substituir troca o valor do nó, no mesmo lugar.
func substituir(doc []byte, n *no, v any) []byte {
	e := detectarEstilo(doc)
	return trocar(doc, n.ini, n.fim, renderizar(v, recuoDaLinha(doc, n.ini), e))
}

// removerFilho tira o i-ésimo filho de pai, com a vírgula e o espaço que o separam.
func removerFilho(doc []byte, pai *no, i int) []byte {
	inicio := func(j int) int {
		if pai.tipo == '{' {
			return pai.iniChave[j]
		}
		return pai.filhos[j].ini
	}
	switch {
	case len(pai.filhos) == 1:
		return trocar(doc, pai.ini+1, pai.fim-1, nil)
	case i > 0:
		return trocar(doc, pai.filhos[i-1].fim, pai.filhos[i].fim, nil)
	default:
		return trocar(doc, inicio(0), inicio(1), nil)
	}
}

// par e objeto montam objetos JSON com as chaves na ordem escrita aqui.
type par struct {
	k string
	v any
}

type objeto []par

func (o objeto) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, p := range o {
		if i > 0 {
			buf.WriteByte(',')
		}
		k, _ := json.Marshal(p.k)
		buf.Write(k)
		buf.WriteByte(':')
		enc := json.NewEncoder(&buf)
		enc.SetEscapeHTML(false)
		if err := enc.Encode(p.v); err != nil {
			return nil, err
		}
		buf.Truncate(buf.Len() - 1) // o Encode termina com \n
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}
