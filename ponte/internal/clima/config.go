package clima

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
)

// ArquivoConfig é a cidade do clima, na pasta da ponte (servidor.DirConfig). Só o
// `ponte setup --cidade` grava; nenhuma config de agente é tocada.
const ArquivoConfig = "clima.json"

// ArquivoCache guarda o último clima bom, para a ponte reiniciada não começar sem tempo.
const ArquivoCache = "clima-cache.json"

// Config é a cidade do clima. Sem Consentimento (ou sem cidade), nada sai da máquina.
type Config struct {
	Cidade        string  `json:"cidade"`
	Lat           float64 `json:"lat"`
	Lon           float64 `json:"lon"`
	Fuso          string  `json:"fuso"`
	Pais          string  `json:"pais"`
	Consentimento bool    `json:"consentimento"`
}

// Ligado diz se a ponte pode buscar o clima.
func (c Config) Ligado() bool {
	return c.Consentimento && c.Cidade != "" && (c.Lat != 0 || c.Lon != 0)
}

// LerConfig lê dir/clima.json. Arquivo ausente é a config vazia (clima desligado).
func LerConfig(dir string) (Config, error) {
	var c Config
	dados, err := os.ReadFile(filepath.Join(dir, ArquivoConfig))
	if errors.Is(err, fs.ErrNotExist) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	return c, json.Unmarshal(dados, &c)
}

// GravarConfig grava dir/clima.json (temporário na mesma pasta + rename), com as
// coordenadas arredondadas a 2 casas.
func GravarConfig(dir string, c Config) error {
	c.Lat, c.Lon = arredondar(c.Lat), arredondar(c.Lon)
	return gravarJSON(dir, ArquivoConfig, c)
}

// ApagarConfig tira dir/clima.json e o cache: o clima volta a ser null.
func ApagarConfig(dir string) error {
	for _, nome := range []string{ArquivoConfig, ArquivoCache} {
		if err := os.Remove(filepath.Join(dir, nome)); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return err
		}
	}
	return nil
}

func gravarJSON(dir, nome string, v any) error {
	dados, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, nome+"-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // sem efeito depois do rename
	if _, err := tmp.Write(dados); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), filepath.Join(dir, nome))
}
