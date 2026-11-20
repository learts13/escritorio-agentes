//go:build !windows

package processo

import (
	"bytes"
	"errors"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
)

// Vivo diz se o processo pid existe (EPERM: existe, mas é de outro usuário).
func Vivo(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = p.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}

// Inicio devolve a hora de criação do processo; fora do Windows, a ponte não a lê
// (0, desconhecida), e o VivoDesde fica só com o Vivo.
func Inicio(int) uint64 { return 0 }

func vivoEInicio(pid int) (bool, uint64) { return Vivo(pid), 0 }

// consulta responde pai e nome por PID: /proc/<pid>/stat no Linux, ps nos demais.
// Cada consulta já lê o estado atual, então não há foto para refazer.
func consulta(bool) (func(pid int) (pai int, nome string, ok bool), error) {
	return func(pid int) (int, string, bool) {
		if dados, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/stat"); err == nil {
			return lerStat(dados)
		}
		saida, err := exec.Command("ps", "-o", "ppid=,comm=", "-p", strconv.Itoa(pid)).Output()
		if err != nil {
			return 0, "", false
		}
		campos := strings.Fields(string(saida))
		if len(campos) < 2 {
			return 0, "", false
		}
		pai, err := strconv.Atoi(campos[0])
		return pai, strings.Join(campos[1:], " "), err == nil
	}, nil
}

// lerStat lê "pid (comm) estado ppid ..."; o comm pode ter espaços e parênteses.
func lerStat(dados []byte) (int, string, bool) {
	ini, fim := bytes.IndexByte(dados, '('), bytes.LastIndexByte(dados, ')')
	if ini < 0 || fim < ini {
		return 0, "", false
	}
	campos := strings.Fields(string(dados[fim+1:]))
	if len(campos) < 2 {
		return 0, "", false
	}
	pai, err := strconv.Atoi(campos[1])
	return pai, string(dados[ini+1 : fim]), err == nil
}

// terminalNoAmbiente lê o VarTerminal do /proc/<pid>/environ no Linux; nos demais,
// "". Um processo de outro usuário não deixa ler o arquivo.
func terminalNoAmbiente(pid int) string {
	dados, err := os.ReadFile("/proc/" + strconv.Itoa(pid) + "/environ")
	if err != nil {
		return ""
	}
	defer clear(dados)
	return terminalNoBloco(dados)
}
