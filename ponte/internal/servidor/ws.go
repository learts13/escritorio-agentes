package servidor

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"

	"firmopolis/ponte/internal/calendario"
	"firmopolis/ponte/internal/clima"
	"firmopolis/ponte/internal/historico"
	"firmopolis/ponte/internal/maestri"
	"firmopolis/ponte/internal/mundo"
)

const (
	// filaCliente é quantas mensagens um cliente pode ter pendentes; cheia, ele é
	// desconectado (cliente lento não segura os outros nem o consumidor).
	filaCliente = 256
	// limiteLeitura é o maior quadro que o jogo pode mandar; o que chega é ignorado.
	limiteLeitura = 64 << 10
	escritaMax    = 5 * time.Second
)

// Mensagens do contrato v1 (ponte → jogo).
type msgSnapshot struct {
	V          int                 `json:"v"`
	Tipo       string              `json:"tipo"`
	GeradoEm   time.Time           `json:"gerado_em"`
	Workspaces []maestri.Workspace `json:"workspaces"`
	Moradores  []mundo.Morador     `json:"moradores"`
	Clima      *clima.Clima        `json:"clima"`
	DatasHoje  []calendario.Data   `json:"datas_hoje"`
}

// msgClima vai na largada da fonte e a cada mudança do clima ou do dia.
type msgClima struct {
	V         int               `json:"v"`
	Tipo      string            `json:"tipo"`
	Clima     *clima.Clima      `json:"clima"`
	DatasHoje []calendario.Data `json:"datas_hoje"`
}

type msgMorador struct {
	V       int           `json:"v"`
	Tipo    string        `json:"tipo"`
	Morador mundo.Morador `json:"morador"`
}

type msgSaiu struct {
	V    int    `json:"v"`
	Tipo string `json:"tipo"`
	ID   string `json:"id"`
}

type msgDia struct {
	V       int                    `json:"v"`
	Tipo    string                 `json:"tipo"`
	Eventos []historico.EventoHist `json:"eventos"`
}

type cliente struct {
	fila      chan []byte
	fechar    context.CancelFunc
	navegador bool // veio com Origin (o Firmópolis): recebe a versão reduzida (paraNavegador)
}

// Subprotocolo é o que o Firmópolis no navegador pede ao abrir o /ws. O navegador não
// manda Authorization no WebSocket: o token vai como um segundo subprotocolo,
// "token.<hex>", que a ponte confere e nunca devolve (a resposta escolhe só este).
const Subprotocolo = "firmopolis.v1"

// ws atende o jogo e o Firmópolis. O token vai em Authorization: Bearer (o jogo) ou no
// subprotocolo (o navegador, que a guarda já conferiu pelo Origin); nunca em ?token=.
func (s *Servidor) ws(w http.ResponseWriter, r *http.Request) {
	origem := r.Header.Get("Origin")
	if !iguais(r.Header.Get("Authorization"), "Bearer "+s.op.Token) && !(origem != "" && s.tokenNoSubprotocolo(r)) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	var aceitar *websocket.AcceptOptions
	if origem != "" {
		u, err := url.Parse(origem)
		if err != nil {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		aceitar = &websocket.AcceptOptions{Subprotocols: []string{Subprotocolo}, OriginPatterns: []string{u.Host}}
	}
	c, err := websocket.Accept(w, r, aceitar)
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(limiteLeitura)

	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	cl := &cliente{fila: make(chan []byte, filaCliente), fechar: cancelar, navegador: origem != ""}

	// Inscrição e snapshot sob o mesmo lock das mudanças: nada se perde entre os dois,
	// e o snapshot vai antes do dia, que vai antes de qualquer mudança nova.
	s.mu.Lock()
	if cl.navegador {
		cl.fila <- codificar(paraNavegador(s.snapshot()))
		cl.fila <- codificar(paraNavegador(s.dia()))
	} else {
		cl.fila <- codificar(s.snapshot())
		cl.fila <- codificar(s.dia())
	}
	s.clientes[cl] = true
	s.mu.Unlock()
	defer s.desinscrever(cl)

	go ignorarLeituras(ctx, c, cancelar)
	for {
		select {
		case <-ctx.Done():
			c.Close(websocket.StatusGoingAway, "")
			return
		case msg := <-cl.fila:
			escrita, cancelarEscrita := context.WithTimeout(ctx, escritaMax)
			err := c.Write(escrita, websocket.MessageText, msg)
			cancelarEscrita()
			if err != nil {
				return
			}
		}
	}
}

// tokenNoSubprotocolo confere o "token.<hex>" ao lado do Subprotocolo.
func (s *Servidor) tokenNoSubprotocolo(r *http.Request) bool {
	pediu, ok := false, false
	for _, linha := range r.Header.Values("Sec-WebSocket-Protocol") {
		for _, p := range strings.Split(linha, ",") {
			p = strings.TrimSpace(p)
			if p == Subprotocolo {
				pediu = true
			} else if t, achou := strings.CutPrefix(p, "token."); achou && iguais(t, s.op.Token) {
				ok = true
			}
		}
	}
	return pediu && ok
}

// ignorarLeituras consome o que o jogo mandar (o canal de comandos é da Fase 3). Quadro
// acima do limite ou conexão fechada encerram o cliente.
func ignorarLeituras(ctx context.Context, c *websocket.Conn, cancelar context.CancelFunc) {
	defer cancelar()
	for {
		_, leitor, err := c.Reader(ctx)
		if err != nil {
			return
		}
		if _, err := io.Copy(io.Discard, leitor); err != nil {
			return
		}
	}
}

// transmitir põe a mensagem na fila de cada cliente. Chamar com s.mu.
func (s *Servidor) transmitir(msg any) {
	s.avisarEspelho()
	if len(s.clientes) == 0 {
		return
	}
	var dados, dadosNav []byte // codificadas uma vez só, na primeira vez que alguém precisa
	navPronto := false
	for cl := range s.clientes {
		var d []byte
		if cl.navegador {
			if !navPronto {
				navPronto = true
				if reduzida := paraNavegador(msg); reduzida != nil {
					dadosNav = codificar(reduzida)
				}
			}
			if dadosNav == nil {
				continue // o navegador não recebe esta mensagem
			}
			d = dadosNav
		} else {
			if dados == nil {
				dados = codificar(msg)
			}
			d = dados
		}
		select {
		case cl.fila <- d:
		default:
			cl.fechar()
			delete(s.clientes, cl)
		}
	}
}

// paraNavegador é o que o Firmópolis no navegador recebe: só o que a tela usa. Sai o
// alvo da atividade (mesmo mascarado), também do histórico do dia, que vai só com a hora,
// o estado e a ferramenta. Se a origem liberada for comprometida, vaza o mínimo.
func paraNavegador(msg any) any {
	semAlvo := func(m mundo.Morador) mundo.Morador {
		if m.Atividade != nil {
			a := *m.Atividade
			a.Alvo = ""
			m.Atividade = &a
		}
		return m
	}
	switch m := msg.(type) {
	case msgDia:
		es := make([]historico.EventoHist, len(m.Eventos)) // cópia: o do jogo segue com o alvo
		for i, e := range m.Eventos {
			e.Alvo = ""
			es[i] = e
		}
		m.Eventos = es
		return m
	case msgSnapshot:
		ms := make([]mundo.Morador, len(m.Moradores))
		for i, x := range m.Moradores {
			ms[i] = semAlvo(x)
		}
		m.Moradores = ms
		// dos workspaces, só os nomes: a tela não usa o projeto nem os membros das bands
		wss := make([]maestri.Workspace, len(m.Workspaces))
		for i, w := range m.Workspaces {
			bs := make([]maestri.Band, len(w.Bands))
			for j, b := range w.Bands {
				bs[j] = maestri.Band{ID: b.ID, Nome: b.Nome}
			}
			wss[i] = maestri.Workspace{ID: w.ID, Nome: w.Nome, Bands: bs}
		}
		m.Workspaces = wss
		return m
	case msgMorador:
		m.Morador = semAlvo(m.Morador)
		return m
	}
	return msg
}

func (s *Servidor) desinscrever(cl *cliente) {
	s.mu.Lock()
	delete(s.clientes, cl)
	s.mu.Unlock()
}

func (s *Servidor) fecharClientes() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for cl := range s.clientes {
		cl.fechar()
		delete(s.clientes, cl)
	}
}

// snapshot e dia montam as mensagens da conexão. Chamar com s.mu.
func (s *Servidor) snapshot() msgSnapshot {
	return msgSnapshot{V: 1, Tipo: "snapshot", GeradoEm: time.Now(), Workspaces: s.workspaces, Moradores: s.reg.Snapshot(),
		Clima: s.ambiente.Clima, DatasHoje: datas(s.ambiente.DatasHoje)}
}

// definirAmbiente guarda o clima e as datas do dia e manda aos clientes.
func (s *Servidor) definirAmbiente(e clima.Estado) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.ambiente = e
	s.transmitir(msgClima{V: 1, Tipo: "clima", Clima: e.Clima, DatasHoje: datas(e.DatasHoje)})
}

// datas nunca é nil no JSON: sem data no dia (ou antes da 1ª leitura), vai [].
func datas(d []calendario.Data) []calendario.Data {
	if d == nil {
		return []calendario.Data{}
	}
	return d
}

func (s *Servidor) dia() msgDia {
	eventos := []historico.EventoHist{}
	if s.op.Historico != nil {
		if hoje := s.op.Historico.Hoje(); hoje != nil {
			eventos = hoje
		}
	}
	return msgDia{V: 1, Tipo: "dia", Eventos: eventos}
}

func codificar(msg any) []byte {
	dados, err := json.Marshal(msg)
	if err != nil {
		log.Printf("ws: mensagem que não se codifica: %T", msg)
		return []byte(`{}`)
	}
	return dados
}
