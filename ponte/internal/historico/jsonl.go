// Package historico guarda as transições dos moradores em JSONL, um arquivo por dia
// local (AAAA-MM-DD.jsonl), e entrega o dia atual ao jogo (mensagem "dia").
package historico

import (
	"bufio"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"

	"firmopolis/ponte/internal/mundo"
)

// EventoHist é uma transição de um morador (contrato v1). O alvo já chega mascarado
// e curto (alvo.Resumir é o ponto único da máscara).
type EventoHist struct {
	TS         time.Time    `json:"ts"`
	MoradorID  string       `json:"morador_id"`
	Estado     mundo.Estado `json:"estado"`
	Ferramenta string       `json:"ferramenta"`
	Alvo       string       `json:"alvo"`
}

// chave é o que o dedupe compara: estado|ferramenta|alvo.
func (e EventoHist) chave() string {
	return string(e.Estado) + "|" + e.Ferramenta + "|" + e.Alvo
}

// LimiteDia é o teto, em bytes de JSON, dos eventos que Hoje entrega: bem abaixo dos
// 8 MiB que o cliente aceita por mensagem. Um "dia" maior derrubaria a conexão, e como
// a ponte reenvia o dia a cada reconexão, isso viraria laço. Os mais antigos saem
// primeiro; o arquivo continua com tudo.
const LimiteDia = 4 << 20

// RetencaoPadrao vale quando Abrir recebe retenção 0 ou negativa.
const RetencaoPadrao = 30

var agora = time.Now

var nomeDoDia = regexp.MustCompile(`^(\d{4}-\d{2}-\d{2})\.jsonl$`)

const formatoDia = "2006-01-02"

// Historico é seguro para uso concorrente.
type Historico struct {
	dir      string
	retencao int

	mu      sync.Mutex
	dia     string       // data local do arquivo aberto
	arquivo *os.File     // AAAA-MM-DD.jsonl do dia, em O_APPEND
	eventos []EventoHist // o dia na memória a partir de eventos[ini]
	tamanho []int        // bytes de JSON de cada evento em eventos
	ini     int
	total   int
	ultimo  map[string]string            // morador → chave do último evento do dia
	outros  map[string]map[string]string // arquivo de outro dia → morador → chave (gravarEm)
}

// Abrir prepara a pasta (só do usuário), apaga os dias fora da retenção e recarrega
// o dia atual, para a ponte reiniciada continuar de onde parou.
func Abrir(dir string, retencaoDias int) (*Historico, error) {
	if retencaoDias <= 0 {
		retencaoDias = RetencaoPadrao
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	h := &Historico{dir: dir, retencao: retencaoDias}
	if err := h.trocarDia(agora().Format(formatoDia)); err != nil {
		return nil, err
	}
	return h, nil
}

// Gravar acrescenta o evento ao arquivo do dia dele. Repetir o último estado do
// morador no dia (o que a reconciliação faz depois de um reinício) não grava nada.
// Um ts depois de hoje (relógio atrasado perto da meia-noite) vai para o arquivo do
// dia dele sem virar o dia da memória: senão Hoje ficaria preso a esse dia até a
// meia-noite real, sem os eventos de hoje. O ts do dia da memória fica nela mesmo com
// o relógio corrigido para antes da meia-noite, senão escaparia do dedupe.
func (h *Historico) Gravar(e EventoHist) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	dia := e.TS.In(time.Local).Format(formatoDia)
	chave := e.chave()
	if dia < h.dia || (dia > h.dia && dia > agora().Format(formatoDia)) {
		return h.gravarEm(filepath.Join(h.dir, dia+".jsonl"), e, chave) // de outro dia
	}
	if dia > h.dia {
		if err := h.trocarDia(dia); err != nil {
			return err
		}
	}
	if h.ultimo[e.MoradorID] == chave {
		return nil
	}
	linha, err := json.Marshal(e)
	if err != nil {
		return err
	}
	if _, err := h.arquivo.Write(append(linha, '\n')); err != nil {
		return err
	}
	h.ultimo[e.MoradorID] = chave
	h.guardar(e, len(linha))
	return nil
}

// Hoje devolve os eventos do dia atual que cabem em LimiteDia, do mais antigo ao mais novo.
func (h *Historico) Hoje() []EventoHist {
	h.mu.Lock()
	defer h.mu.Unlock()

	if dia := agora().Format(formatoDia); dia > h.dia {
		if h.trocarDia(dia) != nil {
			return nil
		}
	}
	return append([]EventoHist(nil), h.eventos[h.ini:]...)
}

func (h *Historico) Fechar() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.arquivo == nil {
		return nil
	}
	err := h.arquivo.Close()
	h.arquivo = nil
	return err
}

// guardar mantém na memória só o rabo do dia que cabe no limite (cada evento vai
// como JSON mais a vírgula do array). Os descartados saem pelo índice ini, e o
// slice só é compactado quando metade dele já saiu, para não copiar a cada evento.
func (h *Historico) guardar(e EventoHist, n int) {
	h.eventos = append(h.eventos, e)
	h.tamanho = append(h.tamanho, n+1)
	h.total += n + 1
	for h.total > LimiteDia-64 && h.ini < len(h.eventos)-1 {
		h.total -= h.tamanho[h.ini]
		h.ini++
	}
	if h.ini > len(h.eventos)/2 {
		h.eventos = append([]EventoHist(nil), h.eventos[h.ini:]...)
		h.tamanho = append([]int(nil), h.tamanho[h.ini:]...)
		h.ini = 0
	}
}

// trocarDia fecha o arquivo atual, aplica a retenção e abre (recarregando) o do dia.
func (h *Historico) trocarDia(dia string) error {
	if h.arquivo != nil {
		h.arquivo.Close()
		h.arquivo = nil
	}
	h.dia = dia
	h.eventos, h.tamanho, h.ini, h.total, h.ultimo = nil, nil, 0, 0, map[string]string{}
	h.outros = nil // o dia que sai da memória passa a ser lido do arquivo
	h.aplicarRetencao()

	caminho := filepath.Join(h.dir, dia+".jsonl")
	if err := h.recarregar(caminho); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := os.OpenFile(caminho, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	h.arquivo = f
	return nil
}

// recarregar lê o arquivo do dia, pulando linhas que não se leem (a última pode ter
// ficado pela metade num crash), e garante que a próxima escrita começa numa linha nova.
func (h *Historico) recarregar(caminho string) error {
	f, err := os.Open(caminho)
	if err != nil {
		return err
	}
	defer f.Close()

	leitor := bufio.NewReader(f)
	terminaComQuebra := true
	for {
		linha, err := leitor.ReadBytes('\n')
		if len(linha) > 0 {
			terminaComQuebra = linha[len(linha)-1] == '\n'
			var e EventoHist
			if json.Unmarshal(linha, &e) == nil && e.MoradorID != "" {
				h.ultimo[e.MoradorID] = e.chave()
				h.guardar(e, len(linha)-boolInt(terminaComQuebra))
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	if !terminaComQuebra {
		return gravarBruto(caminho, []byte("\n"))
	}
	return nil
}

// aplicarRetencao apaga só os arquivos com o nosso padrão de nome cuja data (a do
// nome) saiu da janela de retenção.
func (h *Historico) aplicarRetencao() {
	hoje, err := time.ParseInLocation(formatoDia, h.dia, time.Local)
	if err != nil {
		return
	}
	limite := hoje.AddDate(0, 0, -h.retencao)
	entradas, err := os.ReadDir(h.dir)
	if err != nil {
		return
	}
	for _, e := range entradas {
		m := nomeDoDia.FindStringSubmatch(e.Name())
		if m == nil || e.IsDir() {
			continue
		}
		data, err := time.ParseInLocation(formatoDia, m[1], time.Local)
		if err == nil && data.Before(limite) {
			os.Remove(filepath.Join(h.dir, e.Name()))
		}
	}
}

// gravarEm acrescenta o evento ao arquivo de um dia que não é o da memória, com o
// mesmo dedupe de Gravar. O último estado de cada morador vem de uma leitura do
// arquivo, na primeira vez que ele aparece, e depois fica em h.outros até a troca de dia.
func (h *Historico) gravarEm(caminho string, e EventoHist, chave string) error {
	ultimos, ok := h.outros[caminho]
	if !ok {
		var err error
		if ultimos, err = ultimosEstados(caminho); err != nil {
			return err
		}
		if h.outros == nil {
			h.outros = map[string]map[string]string{}
		}
		h.outros[caminho] = ultimos
	}
	if ultimos[e.MoradorID] == chave {
		return nil
	}
	linha, err := json.Marshal(e)
	if err != nil {
		return err
	}
	if err := gravarBruto(caminho, append(linha, '\n')); err != nil {
		return err
	}
	ultimos[e.MoradorID] = chave
	return nil
}

// ultimosEstados devolve a chave do último evento de cada morador no arquivo; arquivo
// ausente dá o mapa vazio. Linhas ilegíveis são puladas, e uma linha longa demais
// encerra a leitura com o que já veio: no pior caso o dedupe falha e repete um estado,
// em vez de o arquivo parar de receber eventos.
func ultimosEstados(caminho string) (map[string]string, error) {
	ultimos := map[string]string{}
	f, err := os.Open(caminho)
	if errors.Is(err, os.ErrNotExist) {
		return ultimos, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()

	s := bufio.NewScanner(f)
	s.Buffer(nil, 1<<20)
	for s.Scan() {
		var e EventoHist
		if json.Unmarshal(s.Bytes(), &e) == nil && e.MoradorID != "" {
			ultimos[e.MoradorID] = e.chave()
		}
	}
	return ultimos, nil
}

func gravarBruto(caminho string, dados []byte) error {
	f, err := os.OpenFile(caminho, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = f.Write(dados)
	if errFechar := f.Close(); err == nil {
		err = errFechar
	}
	return err
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
