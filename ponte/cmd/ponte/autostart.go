package main

import (
	"debug/pe"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// chaveRun é o que o Windows abre no login do usuário, sem pedir admin. É variável só
// para os testes usarem uma chave de mentira.
var chaveRun = `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`

// nomeAutostart é o nosso valor na chave Run. nomeAutostartAntigo é o do Escritório
// Vivo: o setup o tira, porque subiria a ponte antiga na mesma porta.
const (
	nomeAutostart       = "Firmopolis"
	nomeAutostartAntigo = "EscritorioVivo"
)

// comandoAutostart sobe o exe de fundo, que não tem console: nada de janela no login.
func comandoAutostart(fundo string) string {
	return `"` + fundo + `"`
}

// dirBin é onde a ponte fica instalada (README, passo 1).
func dirBin() string {
	return filepath.Join(os.Getenv("LOCALAPPDATA"), "Firmopolis", "bin")
}

// exeFundo devolve o ponte-fundo.exe do bin instalado. Recusa se o exe do setup não
// está no bin (go run, %TEMP%, a pasta do código), se o fundo falta ou se ele foi
// compilado sem -H=windowsgui (abriria uma janela de console no login).
func exeFundo(exe string) (string, error) {
	bin := dirBin()
	if !strings.EqualFold(filepath.Dir(exe), filepath.Clean(bin)) {
		return "", fmt.Errorf("o --autostart só vale para o ponte.exe instalado em %s (este é %s)", bin, exe)
	}
	fundo := filepath.Join(bin, nomeFundo)
	f, err := pe.Open(fundo)
	if err != nil {
		return "", fmt.Errorf("falta o %s em %s (README, passo 1)", nomeFundo, bin)
	}
	defer f.Close()
	var subsistema uint16
	switch h := f.OptionalHeader.(type) {
	case *pe.OptionalHeader64:
		subsistema = h.Subsystem
	case *pe.OptionalHeader32:
		subsistema = h.Subsystem
	}
	if subsistema != pe.IMAGE_SUBSYSTEM_WINDOWS_GUI {
		return "", fmt.Errorf("o %s foi compilado sem -ldflags=-H=windowsgui e abriria uma janela no login", fundo)
	}
	return fundo, nil
}

func autostartSuportado() error {
	if runtime.GOOS != "windows" {
		return errors.New("o --autostart por enquanto só existe no Windows")
	}
	return nil
}

// lerAutostart devolve o comando gravado no nosso valor, se houver.
func lerAutostart() (string, bool) { return lerValorRun(nomeAutostart) }

func lerValorRun(nome string) (string, bool) {
	saida, err := exec.Command("reg", "query", chaveRun, "/v", nome).Output()
	if err != nil {
		return "", false
	}
	// A linha do valor é "    Firmopolis    REG_SZ    <comando>".
	for _, linha := range strings.Split(string(saida), "\n") {
		campos := strings.SplitN(strings.TrimSpace(linha), "    ", 3)
		if len(campos) == 3 && campos[0] == nome {
			return strings.TrimSpace(campos[2]), true
		}
	}
	return "", false
}

func gravarAutostart(comando string) error {
	if saida, err := exec.Command("reg", "add", chaveRun, "/v", nomeAutostart, "/t", "REG_SZ", "/d", comando, "/f").CombinedOutput(); err != nil {
		return errors.New("não deu para gravar o autostart: " + strings.TrimSpace(string(saida)))
	}
	return nil
}

// tirarAutostart apaga o nosso valor, se existir e chamar um ponte-fundo.exe.
// Devolve o comando que estava lá.
func tirarAutostart() (string, error) { return tirarValorRun(nomeAutostart) }

// tirarAutostartAntigo apaga o valor do Escritório Vivo, com a mesma regra.
func tirarAutostartAntigo() (string, error) { return tirarValorRun(nomeAutostartAntigo) }

func tirarValorRun(nome string) (string, error) {
	comando, ok := lerValorRun(nome)
	if !ok || !strings.HasSuffix(strings.ToLower(comando), `\`+nomeFundo+`"`) {
		return "", nil
	}
	if saida, err := exec.Command("reg", "delete", chaveRun, "/v", nome, "/f").CombinedOutput(); err != nil {
		return "", errors.New("não deu para tirar o autostart: " + strings.TrimSpace(string(saida)))
	}
	return comando, nil
}
