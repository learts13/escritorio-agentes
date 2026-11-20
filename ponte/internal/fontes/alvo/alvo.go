// Package alvo resume a entrada de uma ferramenta no alvo curto do contrato v1,
// igual para todos os provedores.
package alvo

import (
	"net/url"
	"path"
	"strings"

	"firmopolis/ponte/internal/mascara"
)

// Max é o limite do contrato v1 para o alvo da atividade, em caracteres.
const Max = 60

// Resumir tira da entrada só o arquivo (nome), o comando (1ª linha) ou a URL (sem
// credenciais). Qualquer outro campo, como o prompt de um subagente, fica de fora.
// Aceita os nomes de campo do Claude e do Codex (file_path) e do OpenCode (filePath).
// Os segredos são mascarados antes do corte (um segredo cortado não seria reconhecido).
func Resumir(entrada map[string]any) string {
	texto := func(chave string) string {
		v, _ := entrada[chave].(string)
		return strings.TrimSpace(v)
	}
	for _, chave := range []string{"file_path", "filePath", "notebook_path", "path"} {
		if v := texto(chave); v != "" {
			return Curto(mascara.Mascarar(path.Base(strings.ReplaceAll(v, `\`, "/"))))
		}
	}
	if v := texto("command"); v != "" {
		linha, _, _ := strings.Cut(v, "\n")
		return Curto(mascara.Mascarar(strings.TrimSpace(linha)))
	}
	if v := texto("url"); v != "" {
		return Curto(mascara.Mascarar(urlSemSegredo(v)))
	}
	return ""
}

// urlSemSegredo devolve só esquema, host e caminho: usuário, senha, query e
// fragmento podem levar credenciais. URL que não se lê não vira alvo.
func urlSemSegredo(bruta string) string {
	u, err := url.Parse(bruta)
	if err != nil {
		return ""
	}
	if u.Host == "" {
		return u.Path
	}
	return u.Scheme + "://" + u.Host + u.Path
}

// Curto corta o texto em Max caracteres, terminando em "…" quando corta.
func Curto(s string) string {
	r := []rune(s)
	if len(r) <= Max {
		return s
	}
	return string(r[:Max-1]) + "…"
}
