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

	"firmopolis/ponte/internal/decisao"
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
const Versao = "2.2.0"

const (
	// MaxEspelho é o teto do corpo; o servidor aceita até 256 KiB. Acima, o dia vai
	// cortado (os mais novos ficam).
	MaxEspelho = 200 << 10
	// EsperaEspelho junta as mudanças antes de mandar; VidaEspelho é o envio mínimo, como
	// sinal de vida (o servidor desliga o espelho com 90 s sem nada).
	EsperaEspelho = 2 * time.Second
	VidaEspelho   = 30 * time.Second
	tempoEspelho  = 10 * time.Second
	// intervaloEspelho é o mínimo entre dois envios (o servidor aceita um por segundo): o pedido
	// de permissão novo vai sem juntar, mas não antes disso.
	intervaloEspelho = 1100 * time.Millisecond
	recuoMin         = 5 * time.Second
	recuoMax         = 5 * time.Minute
)

// ConfigEspelho é o espelho.json.
type ConfigEspelho struct {
	URL   string `json:"url"`
	Chave string `json:"chave"`
	// DecidirRemoto (opt-in, `ponte setup|conectar --decidir-remoto`): os pedidos de permissão vão
	// ao servidor e a ponte aceita Permitir/Negar de lá (o celular). Desligado, só a decisão local.
	DecidirRemoto bool `json:"decidir_remoto,omitempty"`
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

// corpoEspelho é o que vai ao servidor: a visão do navegador, num objeto só. Na v2, também os
// pedidos de permissão esperando (só a ferramenta e o resumo mascarado, até 300 caracteres).
type corpoEspelho struct {
	V          int                    `json:"v"`
	Teste      bool                   `json:"teste,omitempty"`
	Moradores  []mundo.Morador        `json:"moradores"`
	Workspaces []maestri.Workspace    `json:"workspaces"`
	Dia        []historico.EventoHist `json:"dia"`
	Pendentes  []decisao.Pendente     `json:"pendentes,omitempty"`
}

// ErrFormato é o 400 do servidor: um servidor anterior à v2 recusa o corpo com os pedidos.
var ErrFormato = errors.New("o servidor recusou o formato (400)")

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
	case resp.StatusCode == http.StatusBadRequest:
		return ErrFormato
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

// corpoDoEspelho é o estado de agora, já reduzido como o do navegador. Os pedidos de permissão só
// vão com o --decidir-remoto ligado e alguém que decide atendendo pelo servidor. v1: nunca (o
// servidor anterior à v2).
func (s *Servidor) corpoDoEspelho(c ConfigEspelho, v1 bool) ([]byte, error) {
	s.mu.Lock()
	snap := paraNavegador(s.snapshot()).(msgSnapshot)
	dia := paraNavegador(s.dia()).(msgDia)
	s.mu.Unlock()
	corpo := corpoEspelho{V: 2, Moradores: snap.Moradores, Workspaces: snap.Workspaces, Dia: dia.Eventos}
	if c.DecidirRemoto && s.atendidoRemoto() {
		corpo.Pendentes = s.dec.Lista()
	}
	if v1 {
		corpo.V, corpo.Pendentes = 1, nil
	}
	return codificarEspelho(corpo)
}

// espelhar é o laço do espelho: manda EsperaEspelho depois de uma mudança e, sem mudança,
// a cada VidaEspelho. Na falha, espera crescente (5 s a 5 min), sem travar a ponte; o log
// diz só quando para e quando volta.
func (s *Servidor) espelhar(ctx context.Context) {
	cliente := clienteEspelho()
	falhas, v1 := 0, false
	var ultimo time.Time
	urgente := func() bool { // o pedido novo vai já, respeitando o intervalo mínimo do servidor
		select {
		case <-ctx.Done():
			return false
		case <-time.After(intervaloEspelho - time.Since(ultimo)):
			return true
		}
	}
	for {
		espera, mudou, pendente := s.op.VidaEspelho, s.espMudou, s.espPendente
		if falhas > 0 {
			// no recuo, mudança não apressa
			espera, mudou, pendente = min(recuoMin<<min(falhas-1, 6), recuoMax), nil, nil
		}
		select {
		case <-ctx.Done():
			return
		case <-pendente:
			if !urgente() {
				return
			}
		case <-mudou:
			select {
			case <-ctx.Done():
				return
			case <-s.espPendente:
				if !urgente() {
					return
				}
			case <-time.After(s.op.EsperaEspelho):
			}
		case <-time.After(espera):
		}
		for _, ch := range []chan struct{}{s.espMudou, s.espPendente} { // o que mudou na espera já vai agora
			select {
			case <-ch:
			default:
			}
		}
		c, ok := s.op.Espelho()
		if !ok {
			falhas = 0
			continue
		}
		corpo, err := s.corpoDoEspelho(c, v1)
		if err == nil {
			err = EnviarEspelho(ctx, cliente, c, corpo)
			ultimo = time.Now()
		}
		if errors.Is(err, ErrFormato) && !v1 {
			v1 = true // servidor anterior à v2: segue o espelho, sem os pedidos de permissão
			log.Print("espelho: o servidor não aceita os pedidos de permissão (versão anterior); mandando sem eles")
			if corpo, err = s.corpoDoEspelho(c, v1); err == nil && urgente() {
				err = EnviarEspelho(ctx, cliente, c, corpo)
				ultimo = time.Now()
			}
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
func clienteEspelho() *http.Client { return clienteSemRedirect(tempoEspelho) }

// clienteSemRedirect é o clienteEspelho com outro prazo (o long-poll das decisões).
func clienteSemRedirect(prazo time.Duration) *http.Client {
	return &http.Client{Timeout: prazo,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}
