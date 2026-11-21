package servidor

import (
	"context"
	"log"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"firmopolis/ponte/internal/decisao"
	"firmopolis/ponte/internal/maestri"
	"firmopolis/ponte/internal/mundo"
)

// Responder pelo escritório, fase 2: quando a espera de um morador aceita texto digitado
// (Morador.AceitaTexto: só o "input needed" e as notificações elicitation_dialog e
// agent_needs_input do Claude, e a pergunta do OpenCode; nunca um diálogo de opções, em que
// texto e Enter confirmariam a opção padrão), quem decide manda um texto curto e a ponte o
// leva ao agente.
//   - Terminal do Maestri (menos o OpenCode): a ponte abre a pergunta sozinha quando o morador
//     entra na pergunta e, com a resposta, digita o texto e Enter pelo `maestri ask --raw`
//     (maestri.CLI), chamando como um terminal conectado ao alvo.
//   - OpenCode: o plugin abre a pergunta por POST /pendente/opencode-pergunta (decisoes.go) e
//     responde pela API de perguntas do OpenCode.
//   - O resto (Claude, Codex e agy soltos, sem o Maestri): sem pergunta, sem botão.
// A resposta só vale para uma pergunta aberta, uma vez só, com o morador na pergunta naquela
// hora (nunca na aprovação: lá, o texto viraria tecla no diálogo de permissão), e passa pelo
// decisao.ValidarTexto. No máximo RespostasPorMinuto tentativas por minuto. O log leva só o
// tamanho do texto, nunca o conteúdo.

// RespostasPorMinuto é o teto de tentativas de resposta (do navegador e do servidor, juntas).
const RespostasPorMinuto = 20

// acharMaestri é o padrão do Opcoes.Maestri; os testes do pacote trocam por um que nunca acha,
// para nenhum teste chegar ao Maestri de verdade.
var acharMaestri = maestri.AcharCLI

// Motivos da recusa ({"v":1,"tipo":"recusado","id","motivo"} para o navegador que respondeu).
const (
	MotivoTexto     = "texto"     // vazia, grande demais ou com caractere proibido
	MotivoEstado    = "estado"    // o morador não está na pergunta agora (409)
	MotivoEncerrado = "encerrado" // a pergunta não existe, já foi respondida ou venceu (410)
	MotivoLimite    = "limite"    // tentativas demais no último minuto
)

type msgRecusado struct {
	V      int    `json:"v"`
	Tipo   string `json:"tipo"`
	ID     string `json:"id"`
	Motivo string `json:"motivo"`
}

// estadoPergunta é o que a ponte guarda de cada morador para as perguntas: se a espera dele
// aceita texto digitado (Morador.AceitaTexto, que já implica esperando_resposta), a geração e o
// tipo da espera. Atualizado em publicar, sob s.mu.
type estadoPergunta struct {
	aceita  bool
	geracao uint64
	espera  string
}

// responder entrega o texto à pergunta id. "" deu certo; senão, o motivo da recusa. A tentativa
// só conta no limite depois de achar a pergunta (id lixo não gasta a cota de quem responde).
func (s *Servidor) responder(id, texto, por string) string {
	if !decisao.IDValido(id) {
		return MotivoEncerrado
	}
	p, ok := s.dec.Pegar(id)
	if !ok || p.Tipo != decisao.TipoPergunta {
		return MotivoEncerrado
	}
	if !s.contarResposta() {
		return MotivoLimite
	}
	t, err := decisao.ValidarTexto(texto)
	if err != nil {
		return MotivoTexto
	}
	if !s.mesmaPergunta(p) {
		return MotivoEstado
	}
	if _, ok := s.dec.Responder(id, t, por); !ok {
		return MotivoEncerrado
	}
	return ""
}

func (s *Servidor) contarResposta() bool {
	s.muResp.Lock()
	defer s.muResp.Unlock()
	agora := time.Now()
	vivas := s.respostas[:0]
	for _, t := range s.respostas {
		if agora.Sub(t) < time.Minute {
			vivas = append(vivas, t)
		}
	}
	s.respostas = vivas
	if len(vivas) >= RespostasPorMinuto {
		return false
	}
	s.respostas = append(s.respostas, agora)
	return true
}

// perguntaAtual é o estado de pergunta do morador, se a espera dele aceita texto agora.
func (s *Servidor) perguntaAtual(id string) (estadoPergunta, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.perguntas[id]
	return e, e.aceita && s.estados[id] == mundo.EsperandoResposta
}

// mesmaPergunta: o morador da pergunta p ainda aceita texto e, se p guardou a geração (a do
// Maestri), na mesma geração e no mesmo tipo de espera.
func (s *Servidor) mesmaPergunta(p decisao.Pendente) bool {
	e, ok := s.perguntaAtual(p.MoradorID)
	return ok && (p.Geracao == 0 || e.geracao == p.Geracao && e.espera == p.Espera)
}

// atualizarPergunta guarda o estado de pergunta do morador publicado e fecha as perguntas que
// deixaram de valer: todas quando a espera não aceita mais texto, e as do Maestri de outra
// geração. Devolve se é preciso abrir uma pergunta do Maestri (aceita texto agora, numa
// geração nova ou antes não aceitava). Chamar com s.mu.
func (s *Servidor) atualizarPergunta(m *mundo.Morador) bool {
	antes := s.perguntas[m.ID]
	agora := estadoPergunta{aceita: m.AceitaTexto && m.Estado == mundo.EsperandoResposta, geracao: m.Geracao, espera: m.Espera}
	s.perguntas[m.ID] = agora
	for _, id := range s.dec.DoMorador(m.ID, decisao.TipoPergunta) {
		if p, ok := s.dec.Pegar(id); ok && (!agora.aceita || p.Geracao != 0 && p.Geracao != agora.geracao) {
			s.dec.Encerrar(id, decisao.PorTerminal)
		}
	}
	return agora.aceita && (!antes.aceita || antes.geracao != agora.geracao)
}

func (s *Servidor) esperaPergunta() time.Duration {
	if s.op.EsperaDecisao > 0 {
		return s.op.EsperaDecisao
	}
	return decisao.EsperaPergunta
}

// anunciar e resolvido mandam o pedido novo e o fim dele ao /ws (e acordam o espelho).
func (s *Servidor) anunciar(p decisao.Pendente) {
	s.mu.Lock()
	s.transmitir(msgPendente{V: 1, Tipo: "pendente", Pendente: p})
	s.mu.Unlock()
	s.avisarPendente()
}

func (s *Servidor) resolvido(id, por string) {
	s.mu.Lock()
	s.transmitir(msgResolvido{V: 1, Tipo: "resolvido", ID: id, Por: por})
	s.mu.Unlock()
}

// abrirPerguntaMaestri começa a pergunta de um terminal do Maestri cuja espera passou a aceitar
// texto. Chamar com s.mu; o resto (o `maestri list`) roda fora dele.
func (s *Servidor) abrirPerguntaMaestri(m *mundo.Morador) {
	if s.demo != nil || m.Solto || m.Provedor == mundo.ProvedorOpenCode || m.Nome == "" {
		return
	}
	s.muResp.Lock()
	ja := s.perguntando[m.ID]
	s.perguntando[m.ID] = true
	s.muResp.Unlock()
	if !ja {
		go s.perguntarMaestri(m.ID, s.terminais)
	}
}

// alvoMaestri é para onde vai a resposta: o nome do terminal e o terminal que chama.
type alvoMaestri struct {
	cli      maestri.CLI
	nome, de string
}

func (s *Servidor) perguntarMaestri(id string, terminais []mundo.MetaTerminal) {
	defer func() {
		s.muResp.Lock()
		delete(s.perguntando, id)
		s.muResp.Unlock()
	}()
	alvo, ok := s.acharAlvo(id, terminais)
	if !ok {
		return // sem o maestri, sem nome único ou sem quem chame: sem botão
	}
	for {
		e, ok := s.perguntaAtual(id)
		if !ok {
			return // saiu da pergunta, ou a espera não aceita texto
		}
		p, fim, err := s.dec.AbrirPergunta(id, "", decisao.ViaMaestri, e.geracao, e.espera, s.esperaPergunta())
		if err != nil {
			return
		}
		s.anunciar(p)
		if !s.mesmaPergunta(p) { // mudou entre o teste e o abrir: ninguém mais a fecha
			s.dec.Encerrar(p.ID, decisao.PorTerminal)
		}
		prazo := time.NewTimer(time.Until(p.ExpiraEm))
		var res decisao.Resultado
		select {
		case res = <-fim:
		case <-prazo.C:
			s.dec.Encerrar(p.ID, decisao.PorExpirou)
			res = <-fim
		}
		prazo.Stop()
		s.resolvido(p.ID, res.Por)
		if res.Acao != decisao.Responder {
			continue // vencida ou fechada por mudança: abre outra se a espera ainda aceita texto
		}
		resultado, tentou := s.entregar(p, alvo.nome, res.Texto)
		log.Printf("resposta: pedido %s… (maestri) %d caracteres por %s: %s", p.ID[:6], utf8.RuneCountInString(res.Texto), res.Por, resultado)
		if tentou {
			return // entregue, ou falhou depois de chamar o maestri: nunca outra pergunta (resposta em dobro)
		}
	}
}

// entregar confere tudo de novo na hora de digitar: a mesma geração e o mesmo tipo de espera
// (nunca na aprovação, num diálogo de opções ou numa pergunta nova) e o alvo resolvido de novo,
// com os terminais de agora e um `maestri list` novo, com o mesmo nome. tentou: chamou o maestri.
func (s *Servidor) entregar(p decisao.Pendente, nome, texto string) (resultado string, tentou bool) {
	if !s.mesmaPergunta(p) {
		return "não entregue (a espera do terminal mudou)", false
	}
	s.mu.Lock()
	terminais := s.terminais
	s.mu.Unlock()
	alvo, ok := s.acharAlvo(p.MoradorID, terminais)
	if !ok || alvo.nome != nome {
		return "não entregue (o terminal mudou de nome ou não tem mais quem chame)", false
	}
	if !s.mesmaPergunta(p) { // o `maestri list` leva uns décimos: confere de novo
		return "não entregue (a espera do terminal mudou)", false
	}
	if err := alvo.cli.Digitar(context.Background(), alvo.de, alvo.nome, texto); err != nil {
		return "não entregue (" + err.Error() + ")", true
	}
	return "entregue", true
}

// acharAlvo resolve o terminal do morador id: o nome (único entre todos os terminais do
// Maestri, sem diferença de caixa, porque o `maestri ask` acha pelo nome, e sem começar com
// "-") e um terminal do mesmo workspace conectado a ele (o Maestro primeiro), que é quem chama:
// um terminal não alcança a si mesmo.
func (s *Servidor) acharAlvo(id string, terminais []mundo.MetaTerminal) (alvoMaestri, bool) {
	var meta mundo.MetaTerminal
	porNome := map[string][]mundo.MetaTerminal{}
	for _, t := range terminais {
		k := strings.ToLower(t.Nome)
		porNome[k] = append(porNome[k], t)
		if strings.ToLower(t.ID) == id {
			meta = t
		}
	}
	if meta.ID == "" || meta.Nome == "" || strings.HasPrefix(meta.Nome, "-") || len(porNome[strings.ToLower(meta.Nome)]) != 1 {
		return alvoMaestri{}, false
	}
	cli, ok := s.op.Maestri()
	if !ok {
		return alvoMaestri{}, false
	}
	nomes, err := cli.Conectados(context.Background(), meta.ID)
	if err != nil {
		return alvoMaestri{}, false
	}
	var candidatos []mundo.MetaTerminal
	for _, n := range nomes {
		ms := porNome[strings.ToLower(n)]
		if !strings.EqualFold(n, meta.Nome) && len(ms) == 1 && ms[0].Nome == n && ms[0].WorkspaceID == meta.WorkspaceID {
			candidatos = append(candidatos, ms[0])
		}
	}
	if len(candidatos) == 0 {
		return alvoMaestri{}, false
	}
	sort.SliceStable(candidatos, func(i, j int) bool {
		if candidatos[i].Gerente != candidatos[j].Gerente {
			return candidatos[i].Gerente
		}
		return candidatos[i].Nome < candidatos[j].Nome
	})
	return alvoMaestri{cli: cli, nome: meta.Nome, de: candidatos[0].ID}, true
}
