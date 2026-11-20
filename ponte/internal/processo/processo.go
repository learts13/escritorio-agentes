// Package processo responde duas perguntas sobre processos da máquina: se um PID está
// vivo e qual agente rodou um hook.
package processo

import (
	"path"
	"strings"
)

// shells são os intermediários que um agente pode abrir para rodar o hook.
var shells = map[string]bool{"cmd": true, "powershell": true, "pwsh": true, "sh": true, "bash": true, "dash": true, "zsh": true}

// maxNiveis limita a subida pelos pais (um laço de PIDs reaproveitados não trava).
const maxNiveis = 8

func eShell(nome string) bool {
	n := strings.ToLower(path.Base(strings.ReplaceAll(nome, `\`, "/")))
	n = strings.TrimPrefix(strings.TrimSuffix(n, ".exe"), "-") // "-bash" é shell de login
	return shells[n]
}

// Agente devolve o PID do agente que rodou o hook cujo script tem o PID pid: sobe
// pelos pais enquanto o processo for um shell e para no primeiro que não é. Tem de
// ser chamado enquanto o script está vivo (o servidor chama antes de responder ao
// POST, e o script espera a resposta). 0 quando não acha.
func Agente(pid int) int {
	consultar, err := consulta(false)
	if err != nil {
		return 0
	}
	if _, _, ok := consultar(pid); !ok {
		// A foto em cache é anterior ao script do hook, que acabou de nascer.
		if consultar, err = consulta(true); err != nil {
			return 0
		}
	}
	atual := pid
	for i := 0; i < maxNiveis; i++ {
		pai, nome, ok := consultar(atual)
		if !ok {
			return 0
		}
		if !eShell(nome) {
			return atual
		}
		atual = pai
	}
	return 0
}

// VivoDesde diz se o processo pid está vivo e é o mesmo que nasceu em inicio: um PID
// que o sistema reaproveitou para outro processo conta como morto. Com inicio 0
// (desconhecido), ou sem como ler a hora do processo, vale o Vivo.
func VivoDesde(pid int, inicio uint64) bool {
	vivo, atual := vivoEInicio(pid)
	return vivo && (inicio == 0 || atual == 0 || atual == inicio)
}

// Nome devolve o nome do executável do processo pid ("" quando não acha).
func Nome(pid int) string {
	for _, fresca := range []bool{false, true} {
		consultar, err := consulta(fresca)
		if err != nil {
			return ""
		}
		if _, nome, ok := consultar(pid); ok {
			return nome
		}
	}
	return ""
}

// VarTerminal é a única variável que a ponte lê do ambiente de outro processo.
const VarTerminal = "MAESTRI_TERMINAL_ID"

// maxTerminal limita o id lido do ambiente (um id do Maestri tem uns 36 caracteres).
const maxTerminal = 128

// TerminalMaestri devolve o MAESTRI_TERMINAL_ID do ambiente do processo pid, para o
// agente que não o repassa ao hook (o MiniMax Code passa ao hook uma lista fixa de
// variáveis). Lê só essa variável, e só de um processo do mesmo usuário; "" sem ela,
// com um valor que não parece id ou sem como ler.
func TerminalMaestri(pid int) string {
	if pid <= 0 {
		return ""
	}
	return terminalNoAmbiente(pid)
}

// terminalNoBloco procura o VarTerminal num bloco de ambiente (entradas NOME=valor
// separadas por NUL, até o NUL duplo) direto nos elementos, sem decodificar as outras
// entradas. O nome vale sem caixa, como no Windows. Vale a primeira entrada com o
// nome: "" quando o valor dela não parece id.
func terminalNoBloco[E byte | uint16](bloco []E) string {
	for ini := 0; ini < len(bloco); {
		fim := ini
		for fim < len(bloco) && bloco[fim] != 0 {
			fim++
		}
		if fim == ini {
			return "" // NUL duplo: fim do bloco
		}
		if valor, ok := valorDoTerminal(bloco[ini:fim]); ok {
			return valor
		}
		ini = fim + 1
	}
	return ""
}

// valorDoTerminal diz se a entrada é a do VarTerminal e, se for, devolve o valor, ""
// quando ele não é id: só letras, dígitos, ".", "_" e "-", até maxTerminal. O valor
// vem de outro processo e vai para um header e para o registro.
func valorDoTerminal[E byte | uint16](entrada []E) (string, bool) {
	n := len(VarTerminal)
	if len(entrada) <= n || entrada[n] != '=' {
		return "", false
	}
	for i := 0; i < n; i++ {
		c := entrada[i]
		if c >= 'a' && c <= 'z' {
			c -= 'a' - 'A'
		}
		if c != E(VarTerminal[i]) {
			return "", false
		}
	}
	valor := entrada[n+1:]
	if len(valor) == 0 || len(valor) > maxTerminal {
		return "", true
	}
	id := make([]byte, len(valor))
	for i, c := range valor {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '.' || c == '_' || c == '-') {
			return "", true
		}
		id[i] = byte(c)
	}
	return string(id), true
}
