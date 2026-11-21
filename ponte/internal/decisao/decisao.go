// Package decisao guarda os pedidos que esperam uma resposta do Firmópolis (o navegador neste
// PC, pelo /ws, ou o servidor, pelo celular): os de permissão ("Permitir" ou "Negar") e as
// perguntas (um texto curto). Cada pedido tem um id de 128 bits de crypto/rand, vale uma vez
// só e some no prazo. A resposta só vale para um id que este registro criou e do tipo dele; o
// primeiro a responder leva (o terminal, o navegador ou o prazo), e quem chega depois recebe
// "não existe".
package decisao

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"path"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"firmopolis/ponte/internal/fontes/alvo"
	"firmopolis/ponte/internal/mascara"
)

// Acoes aceitas: Permitir e Negar no pedido de permissão, Responder (com o texto) na pergunta.
const (
	Permitir  = "permitir"
	Negar     = "negar"
	Responder = "responder"
)

// Tipos de pedido.
const (
	TipoPermissao = "permissao"
	TipoPergunta  = "pergunta"
)

// Por onde a resposta de uma pergunta chega ao agente (Pendente.Via).
const (
	ViaMaestri  = "maestri"  // digitada no terminal pelo `maestri ask --raw`
	ViaOpenCode = "opencode" // pelo plugin, na API de perguntas do OpenCode
)

// Quem resolveu o pedido (a mensagem "resolvido" do /ws).
const (
	PorLocal    = "local"    // o navegador neste PC, pelo /ws
	PorRemoto   = "remoto"   // o servidor do Firmópolis (outro navegador ou o celular)
	PorTerminal = "terminal" // respondido no próprio terminal, ou o agente desistiu de esperar
	PorExpirou  = "expirou"
)

const (
	// Max é o teto de pedidos esperando ao mesmo tempo; acima, o pedido não espera.
	Max = 16
	// MaxResumo é o teto do resumo que vai à tela (e, com o espelho, ao servidor).
	MaxResumo = 300
	// MaxFerramenta é o teto do nome da ferramenta, o mesmo na ponte, no servidor e na tela.
	MaxFerramenta = 80
	// EsperaClaude é quanto o pedido do Claude Code espera: o diálogo do terminal aparece junto
	// (testado no 2.1.327), então esperar não atrasa quem responde por lá.
	EsperaClaude = 120 * time.Second
	// EsperaCodex é mais curta: não deu para confirmar se o Codex mostra o prompt do terminal
	// enquanto o hook síncrono roda.
	EsperaCodex = 25 * time.Second
	// EsperaOpenCode: o plugin não segura o OpenCode (o diálogo segue na tela).
	EsperaOpenCode = 120 * time.Second
	// Folga é o que o agente dá a mais ao `ponte decidir` (timeout do hook = espera + folga).
	Folga = 10 * time.Second
	// EsperaPergunta é quanto uma pergunta fica aberta; vencida com o morador ainda na pergunta,
	// a ponte abre outra (o servidor não aceita pedido de mais de 10 min).
	EsperaPergunta = 5 * time.Minute
	// MaxTexto é o teto da resposta, em runas.
	MaxTexto = 1000
)

// Espera diz quanto o pedido de cada rota espera (zero: rota sem decisão).
func Espera(rota string) time.Duration {
	switch rota {
	case "claude":
		return EsperaClaude
	case "codex":
		return EsperaCodex
	case "opencode":
		return EsperaOpenCode
	case "opencode-pergunta":
		return EsperaPergunta
	}
	return 0
}

// ErrCheio: já há Max pedidos esperando.
var ErrCheio = errors.New("decisao: pedidos demais esperando")

// Pendente é o pedido como a tela o vê: a ferramenta e um resumo já mascarado e cortado.
// Completo falso (resumo cortado, vazio, arquivo fora do projeto ou ferramenta cortada): a
// ponte não aceita "permitir" vindo do servidor, e a tela só oferece Negar. Na pergunta, o
// resumo é o texto da pergunta quando o agente o dá (o OpenCode), Completo é sempre falso e
// Via diz por onde a resposta chega.
type Pendente struct {
	ID         string    `json:"id"`
	MoradorID  string    `json:"morador_id"`
	Tipo       string    `json:"tipo"` // "permissao" ou "pergunta"
	Ferramenta string    `json:"ferramenta"`
	Resumo     string    `json:"resumo"`
	Completo   bool      `json:"completo"`
	Via        string    `json:"via,omitempty"`
	ExpiraEm   time.Time `json:"expira_em"`
	// Só na ponte: a geração e o tipo de espera do morador quando a pergunta abriu (Morador.Geracao
	// e Morador.Espera). A resposta só é digitada se os dois ainda forem os mesmos. Geracao 0:
	// pergunta que não depende disso (a do OpenCode, respondida pela API dele).
	Geracao uint64 `json:"-"`
	Espera  string `json:"-"`
}

// Resumo é o texto que a tela mostra e se ele conta o pedido inteiro.
type Resumo struct {
	Texto    string
	Completo bool
}

// Resultado é como o pedido acabou: Acao vazia é "sem decisão" (o agente mostra o prompt dele).
// Texto é a resposta da pergunta (só com Acao Responder).
type Resultado struct {
	Acao  string
	Texto string
	Por   string
}

type item struct {
	Pendente
	criado time.Time
	fim    chan Resultado
}

// Registro guarda os pedidos esperando. relogio: os testes trocam.
type Registro struct {
	mu      sync.Mutex
	itens   map[string]*item
	relogio func() time.Time
}

func NovoRegistro(relogio func() time.Time) *Registro {
	if relogio == nil {
		relogio = time.Now
	}
	return &Registro{itens: map[string]*item{}, relogio: relogio}
}

// Abrir registra um pedido e devolve o canal por onde chega o resultado (um só). Com Max
// pedidos já esperando, ErrCheio.
func (r *Registro) Abrir(moradorID, ferramenta string, resumo Resumo, prazo time.Duration) (Pendente, <-chan Resultado, error) {
	id, err := novoID()
	if err != nil {
		return Pendente{}, nil, err
	}
	nome, inteiro := cortar(ferramenta, MaxFerramenta)
	return r.abrir(Pendente{ID: id, MoradorID: moradorID, Tipo: TipoPermissao, Ferramenta: nome,
		Resumo: resumo.Texto, Completo: resumo.Completo && inteiro && nome != ""}, prazo)
}

// AbrirPergunta registra uma pergunta do morador. pergunta é o texto que o agente mostra, já
// mascarado ("" quando a ponte não o tem); via, por onde a resposta chega.
func (r *Registro) AbrirPergunta(moradorID, pergunta, via string, geracao uint64, espera string, prazo time.Duration) (Pendente, <-chan Resultado, error) {
	id, err := novoID()
	if err != nil {
		return Pendente{}, nil, err
	}
	return r.abrir(Pendente{ID: id, MoradorID: moradorID, Tipo: TipoPergunta, Resumo: Cortar(pergunta), Via: via,
		Geracao: geracao, Espera: espera}, prazo)
}

func (r *Registro) abrir(p Pendente, prazo time.Duration) (Pendente, <-chan Resultado, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.itens) >= Max {
		return Pendente{}, nil, ErrCheio
	}
	agora := r.relogio()
	p.ExpiraEm = agora.Add(prazo)
	it := &item{Pendente: p, criado: agora, fim: make(chan Resultado, 1)}
	r.itens[p.ID] = it
	return it.Pendente, it.fim, nil
}

// Pegar devolve o pedido id, se ainda espera.
func (r *Registro) Pegar(id string) (Pendente, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	it, ok := r.itens[id]
	if !ok {
		return Pendente{}, false
	}
	return it.Pendente, true
}

// Decidir entrega a decisão ao pedido id (só um id que este registro criou e que ainda
// espera). Devolve o pedido, quanto ele esperou e true; id desconhecido, já usado ou
// vencido, false. A remoção é sob o lock: duas decisões no mesmo id, só a primeira vale.
func (r *Registro) Decidir(id, acao, por string) (Pendente, time.Duration, bool) {
	if acao != Permitir && acao != Negar {
		return Pendente{}, 0, false
	}
	p, espera, res, ok := r.fechar(id, Resultado{Acao: acao, Por: por}, func(it *item) bool {
		// sem o pedido inteiro na tela de quem está longe, só Negar vale de lá
		return it.Tipo == TipoPermissao && (acao == Negar || por != PorRemoto || it.Completo)
	})
	return p, espera, ok && res.Acao != ""
}

// Responder entrega o texto (já passado pelo ValidarTexto) à pergunta id: só uma pergunta que
// este registro criou e que ainda espera, uma vez só, como no Decidir.
func (r *Registro) Responder(id, texto, por string) (Pendente, bool) {
	if texto == "" {
		return Pendente{}, false
	}
	p, _, res, ok := r.fechar(id, Resultado{Acao: Responder, Texto: texto, Por: por}, func(it *item) bool { return it.Tipo == TipoPergunta })
	return p, ok && res.Acao != ""
}

// Encerrar fecha o pedido sem decisão (respondido no terminal ou vencido).
func (r *Registro) Encerrar(id, por string) (Pendente, bool) {
	p, _, _, ok := r.fechar(id, Resultado{Por: por}, nil)
	return p, ok
}

// fechar tira o pedido e entrega o resultado; vale (nil: sempre) diz, sob o lock, se o pedido
// aceita esse resultado.
func (r *Registro) fechar(id string, res Resultado, vale func(*item) bool) (Pendente, time.Duration, Resultado, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	it, ok := r.itens[id]
	if !ok || vale != nil && !vale(it) {
		return Pendente{}, 0, Resultado{}, false
	}
	delete(r.itens, id)
	agora := r.relogio()
	if res.Acao != "" && !agora.Before(it.ExpiraEm) {
		res = Resultado{Por: PorExpirou} // decisão que chegou depois do prazo não vale
	}
	it.fim <- res
	return it.Pendente, agora.Sub(it.criado), res, true
}

// DoMorador são os ids do tipo (vazio: todos) que esperam por um morador.
func (r *Registro) DoMorador(moradorID, tipo string) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	var ids []string
	for id, it := range r.itens {
		if it.MoradorID == moradorID && (tipo == "" || it.Tipo == tipo) {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

// Lista são os pedidos esperando, do que vence primeiro ao último.
func (r *Registro) Lista() []Pendente {
	r.mu.Lock()
	defer r.mu.Unlock()
	lista := make([]Pendente, 0, len(r.itens))
	for _, it := range r.itens {
		lista = append(lista, it.Pendente)
	}
	sort.Slice(lista, func(i, j int) bool {
		if !lista[i].ExpiraEm.Equal(lista[j].ExpiraEm) {
			return lista[i].ExpiraEm.Before(lista[j].ExpiraEm)
		}
		return lista[i].ID < lista[j].ID
	})
	return lista
}

// IDValido diz se s tem a forma de um id deste pacote (22 letras de base64url).
func IDValido(s string) bool {
	if len(s) != 22 {
		return false
	}
	_, err := base64.RawURLEncoding.DecodeString(s)
	return err == nil
}

func novoID() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// Lista fechada do que pode ser permitido de longe: o resumo é o pedido inteiro só no Bash com
// estas chaves (nada como dangerouslyDisableSandbox) e no WebFetch de URL sem query. Qualquer
// outra ferramenta (escrita, MCP, leitura) ou chave fica completo=false: de longe, só Negar.
var chavesCompletas = map[string]map[string]bool{
	"Bash":     {"command": true, "description": true, "timeout": true, "run_in_background": true},
	"WebFetch": {"url": true, "prompt": true},
}

func soChaves(entrada map[string]any, permitidas map[string]bool) bool {
	if permitidas == nil {
		return false
	}
	for k := range entrada {
		if !permitidas[k] {
			return false
		}
	}
	return true
}

// Resumir monta o resumo do pedido: o comando inteiro (com as quebras de linha à vista, para
// nada se esconder nas linhas de baixo), o arquivo relativo à pasta da sessão (fora dela,
// "fora do projeto: …/pasta/arquivo", nunca a pasta inteira) ou a URL sem credenciais.
// Mascara antes de cortar em MaxResumo. Completo só na lista fechada (chavesCompletas) e
// quando nada foi cortado nem escondido.
func Resumir(ferramenta string, entrada map[string]any, cwd string) Resumo {
	r := resumirTexto(entrada, cwd)
	ok := soChaves(entrada, chavesCompletas[ferramenta])
	switch ferramenta {
	case "Bash":
		ok = ok && strings.TrimSpace(textoDe(entrada, "command")) != ""
	case "WebFetch":
		u := textoDe(entrada, "url")
		ok = ok && u != "" && !strings.ContainsAny(u, "?#@")
	}
	r.Completo = r.Completo && ok
	return r
}

func textoDe(entrada map[string]any, chave string) string {
	v, _ := entrada[chave].(string)
	return v
}

func resumirTexto(entrada map[string]any, cwd string) Resumo {
	texto := func(chave string) string {
		v, _ := entrada[chave].(string)
		return strings.TrimSpace(v)
	}
	if v := texto("command"); v != "" {
		t, inteiro := cortar(mascara.Mascarar(strings.Join(strings.Fields(strings.ReplaceAll(v, "\n", " ↵ ")), " ")), MaxResumo)
		return Resumo{t, inteiro}
	}
	for _, chave := range []string{"file_path", "filePath", "notebook_path", "path"} {
		if v := texto(chave); v != "" {
			rel, dentro := Relativo(v, cwd)
			t, inteiro := cortar(mascara.Mascarar(rel), MaxResumo)
			return Resumo{t, inteiro && dentro}
		}
	}
	if v := texto("url"); v != "" {
		t, inteiro := cortar(alvo.Resumir(map[string]any{"url": v}), MaxResumo)
		return Resumo{t, inteiro && t != "" && !strings.HasSuffix(t, "…") && !strings.ContainsAny(v, "?#@")}
	}
	return Resumo{}
}

// Relativo é o caminho dentro da pasta da sessão (dentro=true); fora dela, "fora do projeto:"
// com as duas últimas partes do caminho.
func Relativo(caminho, cwd string) (string, bool) {
	c := path.Clean(strings.ReplaceAll(caminho, `\`, "/"))
	base := path.Clean(strings.ReplaceAll(cwd, `\`, "/"))
	if cwd != "" && base != "/" && base != "." {
		if rel, ok := strings.CutPrefix(c, base+"/"); ok && rel != "" && !strings.HasPrefix(rel, "../") {
			return rel, true
		}
	}
	partes := strings.Split(strings.Trim(c, "/"), "/")
	if len(partes) > 2 {
		partes = partes[len(partes)-2:]
		return "fora do projeto: …/" + strings.Join(partes, "/"), false
	}
	return "fora do projeto: " + c, false
}

// Erros do ValidarTexto: nenhum traz o texto.
var (
	ErrTextoVazio    = errors.New("decisao: resposta vazia")
	ErrTextoGrande   = errors.New("decisao: resposta acima de 1000 caracteres")
	ErrTextoProibido = errors.New("decisao: resposta com caractere proibido")
)

// ValidarTexto confere a resposta de uma pergunta antes de ela ir ao terminal e a devolve sem
// os espaços das pontas. Recusa (nunca troca nem marca, como o cortar): UTF-8 inválido, mais de
// MaxTexto runas, a barra invertida (o `maestri ask --raw` lê \n, \e e \xNN como teclas) e tudo
// o que não é visível: controle (inclusive quebra de linha, tab e ESC), C1, bidi e largura
// zero (Cc e Cf), separador de linha e de parágrafo, uso privado e não atribuído. Só passa o que
// o unicode.IsGraphic aceita: letras, marcas, números, pontuação, símbolos e espaços. A quebra
// de linha é recusada porque, no terminal, ela manda a resposta pela metade. Também recusa o
// texto que começa com "-" (depois dos espaços): ele vai como argumento do `maestri`, e assim
// nenhum parser de opções o lê como opção.
func ValidarTexto(s string) (string, error) {
	if !utf8.ValidString(s) {
		return "", ErrTextoProibido
	}
	if utf8.RuneCountInString(s) > MaxTexto {
		return "", ErrTextoGrande
	}
	for _, r := range s {
		if r == '\\' || !unicode.IsGraphic(r) {
			return "", ErrTextoProibido
		}
	}
	s = strings.TrimSpace(s)
	if s == "" {
		return "", ErrTextoVazio
	}
	if strings.HasPrefix(s, "-") {
		return "", ErrTextoProibido
	}
	return s, nil
}

// Cortar é o cortar em MaxResumo, só o texto.
func Cortar(s string) string {
	t, _ := cortar(s, MaxResumo)
	return t
}

// cortar troca os caracteres invisíveis ou enganosos (controle, C1, bidi, largura zero:
// unicode.IsControl e a categoria Cf) por uma marca visível, como ‹U+202E›, e corta em max
// runas, terminando em "…". inteiro diz se nada foi cortado.
func cortar(s string, max int) (string, bool) {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		switch {
		case r == '\t':
			b.WriteRune(' ')
		case unicode.IsControl(r) || unicode.Is(unicode.Cf, r):
			fmt.Fprintf(&b, "‹U+%04X›", r)
		default:
			b.WriteRune(r)
		}
	}
	runas := []rune(b.String())
	if len(runas) <= max {
		return string(runas), true
	}
	return string(runas[:max-1]) + "…", false
}

// Assinar é o HMAC-SHA256 (hex) do token sobre as partes: o `ponte decidir` assina o pedido
// (nonce e o sha256 do corpo) e a ponte assina a resposta (nonce e a ação), para nenhum dos
// dois confiar em quem estiver na porta só por estar lá.
func Assinar(token string, partes ...[]byte) string {
	m := hmac.New(sha256.New, []byte(token))
	for _, p := range partes {
		m.Write(p)
		m.Write([]byte{0})
	}
	return hex.EncodeToString(m.Sum(nil))
}

// ConfereAssinatura compara em tempo constante.
func ConfereAssinatura(token, assinatura string, partes ...[]byte) bool {
	return hmac.Equal([]byte(Assinar(token, partes...)), []byte(assinatura))
}

// Soma é o sha256 do corpo, como vai na assinatura.
func Soma(corpo []byte) []byte {
	s := sha256.Sum256(corpo)
	return s[:]
}
