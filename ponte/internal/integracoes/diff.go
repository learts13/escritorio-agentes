package integracoes

import (
	"fmt"
	"strings"
)

// contexto é quantas linhas iguais aparecem em volta de cada trecho que muda.
const contexto = 2

// diff mostra, linha a linha, o que muda de antes para depois: "+" entra, "-" sai,
// com o número da linha no arquivo novo (ou no antigo, para o que sai).
func diff(antes, depois []byte) string {
	a, b := linhas(antes), linhas(depois)
	// Maior subsequência comum (os arquivos de config têm poucas centenas de linhas).
	lcs := make([][]int, len(a)+1)
	for i := range lcs {
		lcs[i] = make([]int, len(b)+1)
	}
	for i := len(a) - 1; i >= 0; i-- {
		for j := len(b) - 1; j >= 0; j-- {
			if a[i] == b[j] {
				lcs[i][j] = lcs[i+1][j+1] + 1
			} else {
				lcs[i][j] = max(lcs[i+1][j], lcs[i][j+1])
			}
		}
	}
	type op struct {
		tipo  byte // ' ', '+' ou '-'
		linha int
		texto string
	}
	var ops []op
	i, j := 0, 0
	for i < len(a) || j < len(b) {
		switch {
		case i < len(a) && j < len(b) && a[i] == b[j]:
			ops = append(ops, op{' ', j + 1, b[j]})
			i, j = i+1, j+1
		case j < len(b) && (i == len(a) || lcs[i][j+1] >= lcs[i+1][j]):
			ops = append(ops, op{'+', j + 1, b[j]})
			j++
		default:
			ops = append(ops, op{'-', i + 1, a[i]})
			i++
		}
	}

	// Mostra cada linha que muda e as que ficam a até `contexto` linhas dela.
	mostrar := make([]bool, len(ops))
	for k, o := range ops {
		if o.tipo != ' ' {
			for x := max(0, k-contexto); x <= min(len(ops)-1, k+contexto); x++ {
				mostrar[x] = true
			}
		}
	}
	var s strings.Builder
	for k, o := range ops {
		if !mostrar[k] {
			continue
		}
		if k > 0 && !mostrar[k-1] && s.Len() > 0 {
			s.WriteString("   ...\n")
		}
		fmt.Fprintf(&s, "   %4d %c %s\n", o.linha, o.tipo, o.texto)
	}
	return s.String()
}

func linhas(dados []byte) []string {
	if len(dados) == 0 {
		return nil
	}
	texto := strings.TrimSuffix(strings.ReplaceAll(string(dados), "\r\n", "\n"), "\n")
	return strings.Split(texto, "\n")
}
