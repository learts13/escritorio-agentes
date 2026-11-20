package servidor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"firmopolis/ponte/internal/historico"
	"firmopolis/ponte/internal/maestri"
	"firmopolis/ponte/internal/mundo"
)

// Espelho (opt-in): a ponte manda ao servidor do Firmópolis a mesma visão reduzida que o
// navegador recebe dela (paraNavegador: sem o alvo da atividade, workspaces só com nomes, o
// dia sem alvo), para quem usa o navegador noutra máquina ver os terminais sem túnel.
// POST <url>/api/ponte/espelho com Authorization: Bearer <chave>, só por https (ou http no
// próprio PC, para desenvolvimento). Desligado sem o espelho.json da pasta da ponte.

// ArquivoEspelho guarda a URL e a chave (0600) na pasta da ponte; relido a cada envio.
const ArquivoEspelho = "espelho.json"

// Versao vai no User-Agent (a Cloudflare barra o do Go).
const Versao = "2.1.0"

const (
	// MaxEspelho é o teto do corpo; o servidor aceita até 256 KiB. Acima, o dia vai
	// cortado (os mais novos ficam).
	MaxEspelho = 200 << 10
	// EsperaEspelho junta as mudanças antes de mandar; VidaEspelho é o envio mínimo, como
	// sinal de vida (o servidor desliga o espelho com 90 s sem nada).
	EsperaEspelho = 2 * time.Second
	VidaEspelho   = 30 * time.Second
	tempoEspelho  = 10 * time.Second
	recuoMin      = 5 * time.Second
	recuoMax      = 5 * time.Minute
)

// ConfigEspelho é o espelho.json.
type ConfigEspelho struct {
	URL   string `json:"url"`
	Chave string `json:"chave"`
}

// NormalizarEspelho devolve o endereço do Firmópolis sem a barra do fim, ou erro. Vale
// https em qualquer host e http só no próprio PC. Usuário, query e fragmento são recusados.
func NormalizarEspelho(s string) (string, error) {
	u, err := url.Parse(strings.TrimSpace(s))
	if err != nil || u.Host == "" || u.Opaque != "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", errors.New("use o endereço do Firmópolis, como https://escritorio.exemplo.com")
	}
	switch strings.ToLower(u.Scheme) {
	case "https":
	case "http":
		if h := u.Hostname(); h != "localhost" && h != "127.0.0.1" && h != "::1" {
			return "", errors.New("http só vale no próprio PC (localhost); fora dele, use https")
		}
	default:
		return "", errors.New("o endereço começa com https://")
	}
	return strings.ToLower(u.Scheme) + "://" + strings.ToLower(u.Host) + strings.TrimRight(u.EscapedPath(), "/"), nil
}

// LerEspelho devolve a configuração válida, ou ok falso (falta, erro ou inválida: desligado).
func LerEspelho(dir string) (ConfigEspelho, bool) {
	dados, err := os.ReadFile(filepath.Join(dir, ArquivoEspelho))
	if err != nil {
		return ConfigEspelho{}, false
	}
	var c ConfigEspelho
	if json.Unmarshal(dados, &c) != nil || !tokenValido(c.Chave) {
		return ConfigEspelho{}, false
	}
	if c.URL, err = NormalizarEspelho(c.URL); err != nil {
		return ConfigEspelho{}, false
	}
	return c, true
}

// GravarEspelho grava o espelho.json (só o usuário lê), de forma atômica. Config vazia apaga.
func GravarEspelho(dir string, c ConfigEspelho) error {
	arquivo := filepath.Join(dir, ArquivoEspelho)
	if c == (ConfigEspelho{}) {
		if err := os.Remove(arquivo); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	dados, err := json.Marshal(c)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, "espelho-*.tmp") // já nasce 0600
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(dados); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmp.Name(), arquivo)
}

// corpoEspelho é o que vai ao servidor: a visão do navegador, num objeto só.
type corpoEspelho struct {
	V          int                    `json:"v"`
	Teste      bool                   `json:"teste,omitempty"`
	Moradores  []mundo.Morador        `json:"moradores"`
	Workspaces []maestri.Workspace    `json:"workspaces"`
	Dia        []historico.EventoHist `json:"dia"`
}

// codificarEspelho monta o corpo dentro de MaxEspelho: passou, o dia perde a metade mais
// velha até caber (ou ficar vazio).
func codificarEspelho(c corpoEspelho) ([]byte, error) {
	for {
		dados, err := json.Marshal(c)
		if err != nil {
			return nil, err
		}
		if len(dados) <= MaxEspelho {
			return dados, nil
		}
		if len(c.Dia) == 0 {
			return nil, errors.New("o espelho passou do tamanho mesmo sem o dia")
		}
		c.Dia = c.Dia[len(c.Dia)/2+len(c.Dia)%2:]
	}
}

// EnviarEspelho manda um corpo ao servidor. O erro nunca traz a chave.
func EnviarEspelho(ctx context.Context, cliente *http.Client, c ConfigEspelho, corpo []byte) error {
	pedido, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+"/api/ponte/espelho", bytes.NewReader(corpo))
	if err != nil {
		return errors.New("endereço inválido")
	}
	pedido.Header.Set("Authorization", "Bearer "+c.Chave)
	pedido.Header.Set("Content-Type", "application/json")
	pedido.Header.Set("User-Agent", "Firmopolis-ponte/"+Versao)
	resp, err := cliente.Do(pedido)
	if err != nil {
		var u *url.Error
		if errors.As(err, &u) {
			err = u.Err // sem repetir a URL inteira
		}
		return fmt.Errorf("sem resposta do servidor: %v", err)
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	resp.Body.Close()
	switch {
	case resp.StatusCode/100 == 2:
		return nil
	case resp.StatusCode == http.StatusUnauthorized:
		return errors.New("o servidor recusou a chave (401): gere outra em Personalizar > Ponte local")
	case resp.StatusCode == http.StatusNotFound:
		return errors.New("o servidor não tem o espelho ligado (404): gere a chave em Personalizar > Ponte local")
	}
	return fmt.Errorf("o servidor respondeu %d", resp.StatusCode)
}

// TestarEspelho manda um corpo de teste ({"teste": true}): o servidor confere a chave e não
// troca o que está guardado.
func TestarEspelho(ctx context.Context, c ConfigEspelho) error {
	corpo, _ := json.Marshal(corpoEspelho{V: 1, Teste: true, Moradores: []mundo.Morador{},
		Workspaces: []maestri.Workspace{}, Dia: []historico.EventoHist{}})
	return EnviarEspelho(ctx, clienteEspelho(), c, corpo)
}

// avisarEspelho acorda o laço do espelho (sem travar: um aviso pendente já basta).
func (s *Servidor) avisarEspelho() {
	select {
	case s.espMudou <- struct{}{}:
	default:
	}
}

// corpoDoEspelho é o estado de agora, já reduzido como o do navegador.
func (s *Servidor) corpoDoEspelho() ([]byte, error) {
	s.mu.Lock()
	snap := paraNavegador(s.snapshot()).(msgSnapshot)
	dia := paraNavegador(s.dia()).(msgDia)
	s.mu.Unlock()
	return codificarEspelho(corpoEspelho{V: 1, Moradores: snap.Moradores, Workspaces: snap.Workspaces, Dia: dia.Eventos})
}

// espelhar é o laço do espelho: manda EsperaEspelho depois de uma mudança e, sem mudança,
// a cada VidaEspelho. Na falha, espera crescente (5 s a 5 min), sem travar a ponte; o log
// diz só quando para e quando volta.
func (s *Servidor) espelhar(ctx context.Context) {
	cliente := clienteEspelho()
	falhas := 0
	for {
		espera, mudou := s.op.VidaEspelho, s.espMudou
		if falhas > 0 {
			espera, mudou = min(recuoMin<<min(falhas-1, 6), recuoMax), nil // no recuo, mudança não apressa
		}
		select {
		case <-ctx.Done():
			return
		case <-mudou:
			select {
			case <-ctx.Done():
				return
			case <-time.After(s.op.EsperaEspelho):
			}
		case <-time.After(espera):
		}
		select { // o que mudou durante a espera já vai neste envio
		case <-s.espMudou:
		default:
		}
		c, ok := s.op.Espelho()
		if !ok {
			falhas = 0
			continue
		}
		corpo, err := s.corpoDoEspelho()
		if err == nil {
			err = EnviarEspelho(ctx, cliente, c, corpo)
		}
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			if falhas == 0 {
				log.Printf("espelho: não deu para enviar (%v); tentando de novo com espera crescente", err)
			}
			falhas++
			continue
		}
		if falhas > 0 {
			log.Print("espelho: voltou a enviar")
		}
		falhas = 0
	}
}

// clienteEspelho nunca segue redirecionamento: o Go repassa o Authorization a um redirect para o mesmo host em
// http:// (ou a um subdomínio), e a chave iria em texto puro. Um 3xx vira "o servidor respondeu 30x".
func clienteEspelho() *http.Client {
	return &http.Client{Timeout: tempoEspelho,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
