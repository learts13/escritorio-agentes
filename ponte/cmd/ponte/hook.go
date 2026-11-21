package main

import (
	"bytes"
	"context"
	"flag"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"firmopolis/ponte/internal/decisao"
	"firmopolis/ponte/internal/servidor"
)

// prazoHook é o máximo que `ponte hook` vive, do início ao fim (stdin incluído).
const prazoHook = 900 * time.Millisecond

// hook é o `ponte hook <claude|agy|codex|mcode>` que os agentes rodam a cada evento: repassa
// o JSON do stdin a POST /evento/<rota> assinado com o token (nonce e HMAC; o token não viaja), o MAESTRI_TERMINAL_ID, em
// X-Ponte-PID-Hook o PID do pai (o agente, ou o shell que ele abriu) e, em
// X-Ponte-Hora, a hora em que o agente criou este processo (o Claude e o Codex rodam
// o hook em segundo plano, e os eventos podem chegar fora de ordem). A ponte sobe do
// pai até o agente enquanto este processo espera a resposta; o próprio ponte.exe não
// é shell, então mandar o PID dele faria a subida parar aqui.
//
// Nunca atrapalha o agente: nada no stdout nem no stderr, sempre exit 0 e no máximo
// prazoHook, com ou sem ponte, token ou stdin fechado.
func hook(args []string) {
	hora := horaCriacao()
	morrer := time.AfterFunc(prazoHook, func() { os.Exit(0) })
	defer morrer.Stop()
	defer func() { recover() }()

	fs := flag.NewFlagSet("hook", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	porta := fs.Int("porta", servidor.PortaPadrao, "porta da ponte")
	if fs.Parse(args) != nil || fs.NArg() != 1 {
		return
	}
	rota := fs.Arg(0)
	if rota != "claude" && rota != "agy" && rota != "codex" && rota != "mcode" {
		return
	}
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

	ctx, cancelar := context.WithTimeout(context.Background(), prazoHook-100*time.Millisecond)
	defer cancelar()
	url := "http://127.0.0.1:" + strconv.Itoa(*porta) + "/evento/" + rota
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(corpo))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	// o token não viaja: um nonce e o HMAC dele sobre o nonce e o corpo, como no `ponte decidir`
	nonce := novoNonce()
	req.Header.Set("X-Ponte-Nonce", nonce)
	req.Header.Set("X-Ponte-Assinatura", decisao.Assinar(token, []byte(nonce), decisao.Soma(corpo)))
	req.Header.Set("X-Maestri-Terminal-Id", os.Getenv("MAESTRI_TERMINAL_ID"))
	req.Header.Set("X-Ponte-PID-Hook", strconv.Itoa(os.Getppid()))
	req.Header.Set("X-Ponte-Hora", strconv.FormatInt(hora.UnixMilli(), 10))
	if resp, err := http.DefaultClient.Do(req); err == nil {
		resp.Body.Close()
	}
}
