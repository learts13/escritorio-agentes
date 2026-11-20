package servidor

import (
	"errors"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// ArquivoOrigens guarda, na pasta da ponte, os endereços do Firmópolis que podem ler a
// ponte pelo navegador: um por linha, como "https://escritorio.exemplo.com". Só o /ws
// aceita Origin, e só dessa lista; o resto da ponte segue recusando qualquer Origin.
const ArquivoOrigens = "origens.txt"

// MaxOrigens limita a lista (é uma lista de poucos endereços, escrita à mão pelo setup).
const MaxOrigens = 16

// NormalizarOrigem devolve a origem "esquema://host[:porta]" de um endereço do app, ou
// erro. Vale https em qualquer host e http só no próprio PC (desenvolvimento). Caminho,
// query, fragmento e usuário são recusados: a origem do navegador nunca os tem.
func NormalizarOrigem(s string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil || u.Host == "" || u.Opaque != "" {
		return "", errors.New("use o endereço do Firmópolis, como https://escritorio.exemplo.com")
	}
	if u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return "", errors.New("use só o começo do endereço, sem caminho: https://escritorio.exemplo.com")
	}
	esquema, host := strings.ToLower(u.Scheme), strings.ToLower(u.Host)
	if strings.ContainsAny(host, "*?[]\\") && !strings.HasPrefix(host, "[::1]") {
		return "", errors.New("o endereço não pode ter * nem outros curingas")
	}
	switch esquema {
	case "https":
	case "http":
		if h := u.Hostname(); h != "localhost" && h != "127.0.0.1" && h != "::1" {
			return "", errors.New("http só vale no próprio PC (localhost); fora dele, use https")
		}
	default:
		return "", errors.New("o endereço começa com https://")
	}
	if strings.HasSuffix(host, ":443") && esquema == "https" {
		host = strings.TrimSuffix(host, ":443") // o navegador não manda a porta padrão
	}
	return esquema + "://" + host, nil
}

// LerOrigens devolve as origens válidas do arquivo (falta ou erro: nenhuma). Linhas que
// não se normalizam são ignoradas, nunca liberadas.
func LerOrigens(dir string) []string {
	dados, err := os.ReadFile(filepath.Join(dir, ArquivoOrigens))
	if err != nil {
		return nil
	}
	var lista []string
	for _, linha := range strings.Split(string(dados), "\n") {
		if o, err := NormalizarOrigem(linha); err == nil && !slices.Contains(lista, o) && len(lista) < MaxOrigens {
			lista = append(lista, o)
		}
	}
	return lista
}

// GravarOrigens grava a lista inteira (só o usuário lê), de forma atômica.
func GravarOrigens(dir string, lista []string) error {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "origens-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	texto := strings.Join(lista, "\n")
	if texto != "" {
		texto += "\n"
	}
	if _, err := tmp.WriteString(texto); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, ArquivoOrigens))
}
