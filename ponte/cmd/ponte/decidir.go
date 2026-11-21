package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"firmopolis/ponte/internal/decisao"
	"firmopolis/ponte/internal/servidor"
)

// As duas únicas saídas do `ponte decidir`, exatamente como o Claude Code e o Codex leem no
// PermissionRequest. Nunca updatedInput, updatedPermissions, interrupt nem setMode.
const (
	saidaPermitir = `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}`
	saidaNegar    = `{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Negado pelo Firmópolis"}}}`
)

// decidir é o `ponte decidir <claude|codex>`, o hook síncrono do PermissionRequest: manda o
// stdin a POST /pendente/<rota> e espera a resposta. Com "permitir" ou "negar", escreve a
// decisão no stdout; sem decisão (ninguém atendendo, prazo, ponte desligada, qualquer erro),
// nada no stdout e o agente mostra o prompt dele. Sempre exit 0, nada no stderr.
func decidir(args []string, saida io.Writer) {
	defer func() { recover() }()
	fs := flag.NewFlagSet("decidir", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	porta := fs.Int("porta", servidor.PortaPadrao, "porta da ponte")
	if fs.Parse(args) != nil || fs.NArg() != 1 {
		return
	}
	rota := fs.Arg(0)
	if rota != "claude" && rota != "codex" {
		return
	}
	espera := decisao.Espera(rota)
	// teto do processo, para o caso de algo travar fora do HTTP (o stdin): antes do agente matar
	morrer := time.AfterFunc(espera+decisao.Folga-time.Second, func() { os.Exit(0) })
	defer morrer.Stop()
	dir, err := servidor.DirConfig()
	if err != nil {
		return
	}
	token := servidor.LerToken(dir)
	if token == "" {
		return
	}
	corpo, err := io.ReadAll(io.LimitReader(os.Stdin, servidor.MaxCorpo+1))
	if err != nil || len(corpo) > servidor.MaxCorpo {
		return
	}
	// O agente mata o hook em espera+Folga; a resposta precisa sair antes disso.
	ctx, cancelar := context.WithTimeout(context.Background(), espera+decisao.Folga/2)
	defer cancelar()
	url := "http://127.0.0.1:" + strconv.Itoa(*porta) + "/pendente/" + rota
	if acao := pedirDecisao(ctx, url, token, corpo); acao == decisao.Permitir {
		fmt.Fprintln(saida, saidaPermitir)
	} else if acao == decisao.Negar {
		fmt.Fprintln(saida, saidaNegar)
	}
}

// novoNonce são 128 bits de crypto/rand em hex (o rand do Go não falha).
func novoNonce() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// pedirDecisao devolve "permitir", "negar" ou "" (sem decisão). O token nunca vai no pedido: vai
// um nonce e o HMAC do token sobre ele e o corpo. A resposta só vale com o HMAC do token sobre
// o nonce e a ação, então outro processo na porta não decide nem aprende o token.
func pedirDecisao(ctx context.Context, url, token string, corpo []byte) string {
	nonce := novoNonce()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(corpo))
	if err != nil {
		return ""
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Ponte-Nonce", nonce)
	req.Header.Set("X-Ponte-Assinatura", decisao.Assinar(token, []byte(nonce), decisao.Soma(corpo)))
	req.Header.Set("X-Maestri-Terminal-Id", os.Getenv("MAESTRI_TERMINAL_ID"))
	cliente := &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := cliente.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ""
	}
	var d struct {
		Acao       string `json:"acao"`
		Assinatura string `json:"assinatura"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<10)).Decode(&d) != nil ||
		!decisao.ConfereAssinatura(token, d.Assinatura, []byte(nonce), []byte(d.Acao)) {
		return ""
	}
	return d.Acao
}
