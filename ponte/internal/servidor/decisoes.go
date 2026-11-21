package servidor

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"path"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"

	"firmopolis/ponte/internal/decisao"
	"firmopolis/ponte/internal/mascara"
	"firmopolis/ponte/internal/mundo"
)

// Responder pelo escritório: o `ponte decidir` (Claude Code e Codex, no PermissionRequest) e o
// plugin do OpenCode mandam o pedido a POST /pendente/{rota} e esperam a resposta na mesma
// conexão. A ponte só segura o pedido se alguém está atendendo (um navegador neste PC mandou
// "atender" no último minuto, ou o servidor disse "atendendo" no último long-poll); senão,
// responde 204 na hora e o agente mostra o prompt dele. A decisão chega pelo /ws ("decidir")
// ou do servidor (decisoes_remotas.go). Sem decisão (prazo, terminal ou desistência), 204.

const (
	// validadeAtender é quanto vale o último "atender" do navegador neste PC.
	validadeAtender = 60 * time.Second
	// maxComando é o maior quadro de comando que o /ws lê ("responder" leva até 1000 runas,
	// que no JSON chegam a uns 6 KiB).
	maxComando = 8 << 10
)

// Mensagens do /ws (ponte → jogo e navegador).
type msgPendente struct {
	V        int              `json:"v"`
	Tipo     string           `json:"tipo"`
	Pendente decisao.Pendente `json:"pendente"`
}

type msgResolvido struct {
	V    int    `json:"v"`
	Tipo string `json:"tipo"`
	ID   string `json:"id"`
	Por  string `json:"por"`
}

// pedido é o que a ponte tira do corpo: a sessão, a ferramenta e o resumo. pergunta: é a
// pergunta do OpenCode (o resumo é o texto dela).
type pedido struct {
	fonte, sessao, ferramenta string
	resumo                    decisao.Resumo
	pergunta                  bool
}

// semDecisao são as ferramentas cujo "pedido" é uma pergunta ou um plano, não um comando: o
// Firmópolis não responde por elas (204, o agente mostra o diálogo dele).
var semDecisao = map[string]bool{"AskUserQuestion": true, "ExitPlanMode": true}

// lerPedido entende o stdin do PermissionRequest (Claude Code e Codex) e o corpo do plugin do
// OpenCode. ok falso: não é um pedido de permissão (a ponte responde 204).
func lerPedido(rota string, corpo []byte) (pedido, bool) {
	switch rota {
	case "claude", "codex":
		var e struct {
			SessionID string          `json:"session_id"`
			Nome      string          `json:"hook_event_name"`
			ToolName  string          `json:"tool_name"`
			ToolInput json.RawMessage `json:"tool_input"`
			Cwd       string          `json:"cwd"`
		}
		if json.Unmarshal(corpo, &e) != nil || e.Nome != "PermissionRequest" || e.SessionID == "" || e.ToolName == "" || semDecisao[e.ToolName] {
			return pedido{}, false
		}
		var entrada map[string]any
		_ = json.Unmarshal(e.ToolInput, &entrada)
		fonte := mundo.ProvedorClaude
		if rota == "codex" {
			fonte = mundo.ProvedorCodex
		}
		return pedido{fonte: fonte, sessao: e.SessionID, ferramenta: e.ToolName, resumo: decisao.Resumir(e.ToolName, entrada, e.Cwd)}, true
	case "opencode":
		var e struct {
			SessionID  string   `json:"sessionID"`
			Pai        string   `json:"pai"`
			ID         string   `json:"id"`
			Permission string   `json:"permission"`
			Patterns   []string `json:"patterns"`
			Cwd        string   `json:"cwd"`
		}
		if json.Unmarshal(corpo, &e) != nil || e.SessionID == "" || e.Permission == "" {
			return pedido{}, false
		}
		sessao := e.SessionID
		if e.Pai != "" {
			sessao = e.Pai // o pedido do subagente aparece no pai, como no normalizador
		}
		partes, dentro := make([]string, 0, len(e.Patterns)), true
		for _, p := range e.Patterns {
			if pareceCaminho(p) {
				var ok bool
				p, ok = decisao.Relativo(p, e.Cwd)
				dentro = dentro && ok
			}
			partes = append(partes, p)
		}
		texto := mascara.Mascarar(strings.Join(strings.Fields(strings.Join(partes, " ")), " "))
		resumo := decisao.Resumo{Texto: decisao.Cortar(texto)}
		// só o "bash" do OpenCode (os padrões são o comando) pode ser completo; "edit" e o resto, nunca
		resumo.Completo = e.Permission == "bash" && dentro && resumo.Texto != "" && len([]rune(resumo.Texto)) < decisao.MaxResumo
		return pedido{fonte: mundo.ProvedorOpenCode, sessao: sessao, ferramenta: e.Permission, resumo: resumo}, true
	case "opencode-pergunta":
		// o plugin só manda a pergunta única que aceita texto livre (custom); o texto dela vai
		// mascarado e cortado, como o resumo da permissão
		var e struct {
			SessionID string `json:"sessionID"`
			Pai       string `json:"pai"`
			ID        string `json:"id"`
			Pergunta  string `json:"pergunta"`
		}
		if json.Unmarshal(corpo, &e) != nil || e.SessionID == "" || e.ID == "" {
			return pedido{}, false
		}
		sessao := e.SessionID
		if e.Pai != "" {
			sessao = e.Pai
		}
		texto := mascara.Mascarar(strings.Join(strings.Fields(e.Pergunta), " "))
		return pedido{fonte: mundo.ProvedorOpenCode, sessao: sessao, resumo: decisao.Resumo{Texto: texto}, pergunta: true}, true
	}
	return pedido{}, false
}

func pareceCaminho(s string) bool {
	return path.IsAbs(strings.ReplaceAll(s, `\`, "/")) || len(s) > 2 && s[1] == ':' && (s[2] == '\\' || s[2] == '/')
}

// atendendo diz se alguém pode responder agora: um navegador neste PC (o "atender" do /ws) ou
// o servidor (o último long-poll).
func (s *Servidor) atendendo() bool {
	agora := time.Now().UnixNano()
	return agora-s.atendLocal.Load() < int64(validadeAtender) || s.atendidoRemoto()
}

// atendidoRemoto: o servidor disse "atendendo" no último long-poll (só com o --decidir-remoto).
func (s *Servidor) atendidoRemoto() bool {
	return time.Now().UnixNano()-s.atendRemoto.Load() < int64(s.esperaRemota()+15*time.Second)
}

// pendente é o POST /pendente/{rota}: fora da fila única, com o teto do decisao.Registro. Só o
// token vale (a guarda já recusou qualquer Origin).
func (s *Servidor) pendente(w http.ResponseWriter, r *http.Request) {
	rota := r.PathValue("rota")
	espera := decisao.Espera(rota)
	if espera == 0 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	nonce := r.Header.Get("X-Ponte-Nonce")
	if !nonceValido(nonce) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	corpo, err := io.ReadAll(http.MaxBytesReader(w, r.Body, MaxCorpo))
	var grande *http.MaxBytesError
	if errors.As(err, &grande) {
		w.WriteHeader(http.StatusRequestEntityTooLarge)
		return
	}
	// O token nunca vai no pedido: só o HMAC dele sobre o nonce e o corpo.
	if err == nil && !s.assinado(r, corpo) {
		w.WriteHeader(http.StatusForbidden)
		return
	}
	// a pergunta espera mesmo sem ninguém atendendo agora: quem abrir o mapa depois ainda responde
	if err != nil || s.demo != nil || !s.atendendo() && rota != "opencode-pergunta" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	ped, ok := lerPedido(rota, corpo)
	if !ok {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if s.op.EsperaDecisao > 0 {
		espera = s.op.EsperaDecisao
	}
	morador := s.reg.IDDe(r.Header.Get("X-Maestri-Terminal-Id"), ped.fonte, ped.sessao)
	var p decisao.Pendente
	var fim <-chan decisao.Resultado
	if ped.pergunta {
		p, fim, err = s.dec.AbrirPergunta(morador, ped.resumo.Texto, decisao.ViaOpenCode, 0, "", espera)
	} else {
		p, fim, err = s.dec.Abrir(morador, ped.ferramenta, ped.resumo, espera)
	}
	if err != nil {
		w.WriteHeader(http.StatusNoContent) // cheio: este não espera
		return
	}
	inicio := time.Now()
	s.mu.Lock()
	s.transmitir(msgPendente{V: 1, Tipo: "pendente", Pendente: p})
	s.mu.Unlock()
	s.avisarPendente()

	prazo := time.NewTimer(espera)
	defer prazo.Stop()
	var res decisao.Resultado
	select {
	case res = <-fim:
	case <-r.Context().Done(): // o agente desistiu (respondido no terminal, timeout do hook)
		s.dec.Encerrar(p.ID, decisao.PorTerminal)
		res = <-fim
	case <-prazo.C:
		s.dec.Encerrar(p.ID, decisao.PorExpirou)
		res = <-fim
	}
	s.resolvido(p.ID, res.Por)
	if p.Tipo == decisao.TipoPergunta {
		s.respostaOpenCode(w, p, res, nonce)
		return
	}
	acao := res.Acao
	if acao == "" {
		acao = "sem decisão"
	}
	// nunca o resumo nem a entrada: a ferramenta, a ação, quem e quanto esperou
	log.Printf("decisão: pedido %s… (%s) %s por %s em %d ms", p.ID[:6], p.Ferramenta, acao, res.Por, time.Since(inicio).Milliseconds())
	if res.Acao == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	// a resposta vai assinada: o `ponte decidir` só escreve a decisão se ela vier desta ponte
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"acao": res.Acao,
		"assinatura": decisao.Assinar(s.op.Token, []byte(nonce), []byte(res.Acao))})
}

// respostaOpenCode devolve ao plugin a resposta da pergunta, assinada sobre o nonce, a ação e
// o texto (HMAC(token, nonce‖"responder"‖texto)). Sem resposta, 204. O log leva só o tamanho.
func (s *Servidor) respostaOpenCode(w http.ResponseWriter, p decisao.Pendente, res decisao.Resultado, nonce string) {
	if res.Acao != decisao.Responder {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	log.Printf("resposta: pedido %s… (opencode) %d caracteres por %s: entregue ao plugin", p.ID[:6], utf8.RuneCountInString(res.Texto), res.Por)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"acao": res.Acao, "texto": res.Texto,
		"assinatura": decisao.Assinar(s.op.Token, []byte(nonce), []byte(res.Acao), []byte(res.Texto))})
}

func nonceValido(nonce string) bool {
	return len(nonce) == 32 && strings.Trim(strings.ToLower(nonce), "0123456789abcdef") == ""
}

// assinado confere X-Ponte-Assinatura = HMAC(token, nonce‖sha256(corpo)): o pedido veio de quem
// tem o token, sem o token viajar (/evento e /pendente).
func (s *Servidor) assinado(r *http.Request, corpo []byte) bool {
	nonce := r.Header.Get("X-Ponte-Nonce")
	return nonceValido(nonce) && decisao.ConfereAssinatura(s.op.Token, r.Header.Get("X-Ponte-Assinatura"), []byte(nonce), decisao.Soma(corpo))
}

// decidir entrega uma decisão (do /ws ou do servidor). Só um id que esta ponte criou.
func (s *Servidor) decidir(id, acao, por string) bool {
	if !decisao.IDValido(id) {
		return false
	}
	_, _, ok := s.dec.Decidir(id, acao, por)
	return ok
}

// respondidoNoTerminal fecha os pedidos de permissão do morador quando ele sai da espera de
// permissão (o terminal respondeu), as perguntas quando ele sai da pergunta, e todos quando ele
// sai do mundo (estado vazio). Chamar com s.mu.
func (s *Servidor) respondidoNoTerminal(id string, estado mundo.Estado) {
	antes := s.estados[id]
	if estado == "" {
		delete(s.estados, id)
	} else {
		s.estados[id] = estado
	}
	for tipo, espera := range map[string]mundo.Estado{decisao.TipoPermissao: mundo.EsperandoPermissao, decisao.TipoPergunta: mundo.EsperandoResposta} {
		if estado != "" && (antes != espera || estado == espera) {
			continue
		}
		for _, p := range s.dec.DoMorador(id, tipo) {
			s.dec.Encerrar(p, decisao.PorTerminal)
		}
	}
}

// avisarPendente acorda o espelho para mandar o pedido novo sem juntar.
func (s *Servidor) avisarPendente() {
	select {
	case s.espPendente <- struct{}{}:
	default:
	}
}

// lerComandos lê o que o cliente (já autenticado pelo token) manda no /ws: {"v":1,"tipo":
// "atender"}, {"v":1,"tipo":"decidir","id","acao":"permitir|negar"} e {"v":1,"tipo":
// "responder","id","texto"} (recusado, só este cliente recebe {"tipo":"recusado","id",
// "motivo"}). O resto é ignorado; quadro acima do limite de leitura ou conexão fechada encerram
// o cliente.
func (s *Servidor) lerComandos(ctx context.Context, c *websocket.Conn, cl *cliente) {
	defer cl.fechar()
	for {
		tipo, dados, err := c.Read(ctx)
		if err != nil {
			return
		}
		if tipo != websocket.MessageText || len(dados) > maxComando {
			continue
		}
		var cmd struct {
			V     int    `json:"v"`
			Tipo  string `json:"tipo"`
			ID    string `json:"id"`
			Acao  string `json:"acao"`
			Texto string `json:"texto"`
		}
		dec := json.NewDecoder(bytes.NewReader(dados))
		dec.DisallowUnknownFields()
		if dec.Decode(&cmd) != nil || cmd.V != 1 {
			continue
		}
		switch cmd.Tipo {
		case "atender":
			s.atendLocal.Store(time.Now().UnixNano())
		case "decidir":
			s.decidir(cmd.ID, cmd.Acao, decisao.PorLocal)
		case "responder":
			if motivo := s.responder(cmd.ID, cmd.Texto, decisao.PorLocal); motivo != "" {
				if !decisao.IDValido(cmd.ID) {
					cmd.ID = ""
				}
				select {
				case cl.fila <- codificar(msgRecusado{V: 1, Tipo: "recusado", ID: cmd.ID, Motivo: motivo}):
				default:
				}
			}
		}
	}
}
