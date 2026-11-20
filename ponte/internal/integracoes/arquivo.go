package integracoes

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"
)

// errMudou: o arquivo mudou entre o plano e a escrita; o Aplicar replaneja.
var errMudou = errors.New("o arquivo mudou desde o plano")

// antesDeTocar roda antes de qualquer escrita, troca de nome ou remoção (testes: a
// guarda que falha se algo sair do TempDir).
var antesDeTocar func(caminho string)

// dentroDe diz se caminho fica em raiz (ou é a própria raiz).
func dentroDe(raiz, caminho string) bool {
	rel, err := filepath.Rel(filepath.Clean(raiz), filepath.Clean(caminho))
	return err == nil && rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// tocar autoriza mexer em caminho: só dentro da home, da pasta da ponte e das pastas do
// nosso plugin do mcode, a nova e a do Escritório Vivo (o MINIMAX_DATA_DIR pode ficar
// fora da home).
func (op Opcoes) tocar(caminho string) error {
	if !dentroDe(op.Home, caminho) && !dentroDe(op.DirConfig, caminho) && !dentroDe(pastaPluginMiniMax(op), caminho) &&
		!dentroDe(pastaPluginMiniMaxAntiga(op), caminho) {
		return fmt.Errorf("recusei mexer em %s: fora de %s e de %s", caminho, op.Home, op.DirConfig)
	}
	if antesDeTocar != nil {
		antesDeTocar(caminho)
	}
	return nil
}

func hash(dados []byte) string {
	s := sha256.Sum256(dados)
	return hex.EncodeToString(s[:])
}

// lerOpcional devolve o conteúdo, ou nil se o arquivo não existe.
func lerOpcional(caminho string) ([]byte, error) {
	dados, err := os.ReadFile(caminho)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	if err == nil && dados == nil {
		dados = []byte{} // existe e está vazio: diferente de não existir
	}
	return dados, err
}

// hashAtual é o sha256 do arquivo agora ("" se não existe).
func hashAtual(caminho string) (string, error) {
	dados, err := lerOpcional(caminho)
	if err != nil || dados == nil {
		return "", err
	}
	return hash(dados), nil
}

// escrever grava dados em caminho de forma atômica: temporário na mesma pasta, com a
// permissão do arquivo atual, e rename. Logo antes do rename confere se o arquivo
// ainda tem o sha esperado ("" = não existir); se mudou, desiste com errMudou.
func (op Opcoes) escrever(caminho string, dados []byte, shaEsperado string) error {
	if err := op.tocar(caminho); err != nil {
		return err
	}
	modo := fs.FileMode(0o644)
	if info, err := os.Stat(caminho); err == nil {
		modo = info.Mode().Perm()
	}
	dir := filepath.Dir(caminho)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "."+filepath.Base(caminho)+".firmopolis-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name()) // sem efeito depois do rename
	if _, err := tmp.Write(dados); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp.Name(), modo); err != nil {
		return err
	}
	if atual, err := hashAtual(caminho); err != nil {
		return err
	} else if atual != shaEsperado {
		return errMudou
	}
	return renomear(tmp.Name(), caminho)
}

// renomear tenta de novo por um instante: no Windows, o rename falha enquanto outro
// programa (o próprio agente lendo o settings.json) está com o arquivo aberto.
func renomear(de, para string) error {
	var err error
	for i := 0; i < 5; i++ {
		if err = os.Rename(de, para); err == nil {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	return err
}

// remover apaga caminho se ele ainda tem o sha esperado.
func (op Opcoes) remover(caminho, shaEsperado string) error {
	if err := op.tocar(caminho); err != nil {
		return err
	}
	if atual, err := hashAtual(caminho); err != nil {
		return err
	} else if atual != shaEsperado {
		return errMudou
	}
	return os.Remove(caminho)
}

// removerPastasVazias apaga as pastas vazias de dir para cima, até pasta (a que a
// instalação criou, inclusive), e para na primeira que não está vazia. Fora de pasta,
// não sobe.
func (op Opcoes) removerPastasVazias(dir, pasta string) {
	if pasta == "" || !dentroDe(pasta, dir) {
		return
	}
	for d := dir; ; d = filepath.Dir(d) {
		if op.tocar(d) != nil {
			return
		}
		if itens, err := os.ReadDir(d); err != nil || len(itens) > 0 || os.Remove(d) != nil {
			return
		}
		if filepath.Clean(d) == filepath.Clean(pasta) {
			return
		}
	}
}

// pastaQueFalta é a pasta mais alta que ainda não existe no caminho até dir ("" se
// dir já existe): é o que o desfazer apaga se ficar vazia.
func pastaQueFalta(dir string) string {
	falta := ""
	for d := dir; ; d = filepath.Dir(d) {
		if _, err := os.Stat(d); err == nil {
			return falta
		}
		falta = d
		if filepath.Dir(d) == d {
			return falta
		}
	}
}

// reToken casa o valor do header do token no hook do Claude, em qualquer versão.
var reToken = regexp.MustCompile(`("X-Ponte-Token"\s*:\s*")[^"]*(")`)

// mascararToken troca o valor do token por <token>: backup e plano não o guardam.
func mascararToken(dados []byte) []byte {
	return reToken.ReplaceAll(dados, []byte("${1}<token>${2}"))
}

// backup copia o conteúdo atual, com o token mascarado, para
// <arquivo>.bak-firmopolis-<AAAAMMDD-HHMMSS> (com -2, -3... se já houver um com
// o mesmo nome) e devolve o caminho. O backup que o desfazer restaura é o de antes da
// instalação, que não tem token, então a máscara não muda nada nele.
func (op Opcoes) backup(caminho string, dados []byte) (string, error) {
	dados = mascararToken(dados)
	base := caminho + ".bak-" + marca + "-" + op.agora().Format("20060102-150405")
	for i := 1; ; i++ {
		nome := base
		if i > 1 {
			nome += "-" + strconv.Itoa(i)
		}
		if _, err := os.Stat(nome); err == nil {
			continue
		}
		return nome, op.escrever(nome, dados, "")
	}
}

// registro é o que o manifesto guarda de cada arquivo que nós mexemos.
type registro struct {
	Sha    string `json:"sha256"`                 // depois da nossa última escrita
	Backup string `json:"backup,omitempty"`       // o estado de antes da instalação
	Criado bool   `json:"criado,omitempty"`       // o arquivo não existia
	Pasta  string `json:"pasta_criada,omitempty"` // a pasta que criamos para ele
}

type manifesto struct {
	V        int                  `json:"v"`
	Arquivos map[string]*registro `json:"arquivos"`
}

func (op Opcoes) arquivoManifesto() string {
	return filepath.Join(op.DirConfig, "integracoes.json")
}

func (op Opcoes) lerManifesto() (*manifesto, error) {
	m := &manifesto{V: 1, Arquivos: map[string]*registro{}}
	dados, err := lerOpcional(op.arquivoManifesto())
	if err != nil || dados == nil {
		return m, err
	}
	if err := json.Unmarshal(dados, m); err != nil {
		return nil, fmt.Errorf("manifesto %s ilegível: %w", op.arquivoManifesto(), err)
	}
	if m.Arquivos == nil {
		m.Arquivos = map[string]*registro{}
	}
	return m, nil
}

// salvarManifesto grava o manifesto (ou o apaga quando não sobra nada).
func (op Opcoes) salvarManifesto(m *manifesto) error {
	caminho := op.arquivoManifesto()
	atual, err := hashAtual(caminho)
	if err != nil {
		return err
	}
	if len(m.Arquivos) == 0 {
		if atual == "" {
			return nil
		}
		return op.remover(caminho, atual)
	}
	dados, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return op.escrever(caminho, append(dados, '\n'), atual)
}

// Restos são os backups que ficam no disco ao lado dos arquivos das integrações.
func Restos(op Opcoes) []string {
	var restos []string
	for _, it := range integracoes {
		for _, m := range []string{marca, marcaAntiga} {
			achados, _ := filepath.Glob(it.arquivo(op) + ".bak-" + m + "-*")
			restos = append(restos, achados...)
		}
	}
	sort.Strings(restos)
	return restos
}
