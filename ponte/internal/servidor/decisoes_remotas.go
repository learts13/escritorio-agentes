package servidor

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"firmopolis/ponte/internal/decisao"
)

// Decisões pelo servidor (com o espelho ligado): a ponte pergunta ao servidor do Firmópolis,
// por long-poll, GET <url>/api/ponte/decisoes?espera=25 com o mesmo Bearer do espelho, se
// alguém respondeu um pedido pelo navegador de outra máquina ou pelo celular. A resposta diz
// também se alguém está atendendo (X-Ponte-Atendendo: 1), o que faz a ponte segurar os pedidos
// novos. A conexão é sempre de dentro para fora: a ponte nunca abre porta.

// EsperaRemota é o long-poll; o servidor aceita até 25 s.
const EsperaRemota = 25 * time.Second

// MaxDecisoes é o teto do corpo da resposta (16 respostas de até 1000 runas cabem).
const MaxDecisoes = 128 << 10

// DecisaoRemota é uma decisão vinda do servidor: permitir/negar, ou responder com o texto.
type DecisaoRemota struct {
	ID    string `json:"id"`
	Acao  string `json:"acao"`
	Texto string `json:"texto,omitempty"`
}

func (s *Servidor) esperaRemota() time.Duration {
	if s.op.EsperaRemota > 0 {
		return s.op.EsperaRemota
	}
	return EsperaRemota
}

// BuscarDecisoes faz um long-poll. O erro nunca traz a chave.
func BuscarDecisoes(ctx context.Context, cliente *http.Client, c ConfigEspelho, espera time.Duration) (atendendo bool, decisoes []DecisaoRemota, err error) {
	segundos := strconv.Itoa(int(espera / time.Second))
	pedido, err := http.NewRequestWithContext(ctx, http.MethodGet, c.URL+"/api/ponte/decisoes?espera="+segundos, nil)
	if err != nil {
		return false, nil, errors.New("endereço inválido")
	}
	pedido.Header.Set("Authorization", "Bearer "+c.Chave)
	pedido.Header.Set("User-Agent", "Firmopolis-ponte/"+Versao)
	resp, err := cliente.Do(pedido)
	if err != nil {
		var u *url.Error
		if errors.As(err, &u) {
			err = u.Err
		}
		return false, nil, fmt.Errorf("sem resposta do servidor: %v", err)
	}
	defer resp.Body.Close()
	atendendo = resp.Header.Get("X-Ponte-Atendendo") == "1"
	switch resp.StatusCode {
	case http.StatusNoContent:
		return atendendo, nil, nil
	case http.StatusOK:
		var corpo struct {
			Decisoes []DecisaoRemota `json:"decisoes"`
		}
		if err := json.NewDecoder(io.LimitReader(resp.Body, MaxDecisoes)).Decode(&corpo); err != nil {
			return atendendo, nil, errors.New("resposta ilegível do servidor")
		}
		return atendendo, corpo.Decisoes, nil
	}
	io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10))
	return false, nil, fmt.Errorf("o servidor respondeu %d", resp.StatusCode)
}

// decisoesRemotas é o laço do long-poll. Sem espelho configurado, confere de novo a cada 30 s;
// na falha (servidor antigo sem a rota, fora do ar), espera crescente de 5 s a 5 min.
func (s *Servidor) decisoesRemotas(ctx context.Context) {
	cliente := clienteSemRedirect(s.esperaRemota() + tempoEspelho)
	falhas := 0
	for {
		var espera time.Duration
		c, ok := s.op.Espelho()
		if !ok || !c.DecidirRemoto { // sem o opt-in, nem pergunta ao servidor
			s.atendRemoto.Store(0)
			espera = 30 * time.Second
		} else {
			inicio := time.Now()
			atendendo, decisoes, err := BuscarDecisoes(ctx, cliente, c, s.esperaRemota())
			if ctx.Err() != nil {
				return
			}
			switch {
			case err != nil:
				s.atendRemoto.Store(0)
				if falhas == 0 {
					log.Printf("decisões pelo servidor: %v; tentando de novo com espera crescente", err)
				}
				falhas++
				espera = min(recuoMin<<min(falhas-1, 6), recuoMax)
			default:
				if falhas > 0 {
					log.Print("decisões pelo servidor: voltou")
				}
				falhas = 0
				// relê o espelho.json: um --sem-decidir-remoto durante o long-poll vale já, e as
				// decisões que chegaram com ele não são aplicadas
				if agora, ok := s.op.Espelho(); !ok || !agora.DecidirRemoto {
					s.atendRemoto.Store(0)
					continue
				}
				if atendendo {
					s.atendRemoto.Store(time.Now().UnixNano())
				} else {
					s.atendRemoto.Store(0)
				}
				for _, d := range decisoes {
					if d.Acao == decisao.Responder {
						s.responder(d.ID, d.Texto, decisao.PorRemoto)
					} else {
						s.decidir(d.ID, d.Acao, decisao.PorRemoto)
					}
				}
				if time.Since(inicio) < time.Second && len(decisoes) == 0 {
					espera = time.Second // um servidor que responde na hora não vira laço apertado
				}
			}
		}
		if espera > 0 {
			select {
			case <-ctx.Done():
				return
			case <-time.After(espera):
			}
		}
	}
}
