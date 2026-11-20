package servidor

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
)

// DirConfig é a pasta da ponte na config do usuário: %APPDATA%\Firmopolis no Windows,
// ~/Library/Application Support/Firmopolis no macOS e $XDG_CONFIG_HOME/Firmopolis (ou
// ~/.config) no Linux. Quem vem do Escritório Vivo tem a pasta EscritorioVivo: na
// primeira chamada ela é renomeada (token, histórico, clima e manifesto vêm juntos). Se
// não der para renomear (no Windows, uma ponte antiga ainda aberta), segue na antiga.
func DirConfig() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return dirConfigEm(base), nil
}

func dirConfigEm(base string) string {
	nova, antiga := filepath.Join(base, "Firmopolis"), filepath.Join(base, "EscritorioVivo")
	if _, err := os.Stat(nova); err == nil {
		return nova
	}
	if _, err := os.Stat(antiga); err != nil {
		return nova
	}
	if err := os.Rename(antiga, nova); err != nil {
		// Outro processo (hooks rodam em paralelo) pode ter renomeado antes: vale a nova.
		if _, err := os.Stat(nova); err == nil {
			return nova
		}
		return antiga
	}
	return nova
}

// CarregarOuCriarToken devolve o token de dir/token, criando um novo (32 bytes de
// crypto/rand em hexadecimal) quando falta ou é inválido. A gravação é atômica
// (temporário na mesma pasta + rename) e só o usuário lê.
func CarregarOuCriarToken(dir string) (string, error) {
	arquivo := filepath.Join(dir, "token")
	if t := LerToken(dir); t != "" {
		return t, nil
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	bruto := make([]byte, 32)
	if _, err := rand.Read(bruto); err != nil {
		return "", err
	}
	token := hex.EncodeToString(bruto)

	tmp, err := os.CreateTemp(dir, "token-*.tmp") // já nasce 0600
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name()) // sem efeito depois do rename
	if _, err := tmp.WriteString(token); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), arquivo); err != nil {
		return "", err
	}
	return token, nil
}

// LerToken devolve o token de dir/token sem criar nada ("" se falta ou é inválido).
func LerToken(dir string) string {
	dados, err := os.ReadFile(filepath.Join(dir, "token"))
	if t := strings.TrimSpace(string(dados)); err == nil && tokenValido(t) {
		return t
	}
	return ""
}

func tokenValido(t string) bool {
	_, err := hex.DecodeString(t)
	return len(t) == 64 && err == nil
}

func iguais(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

// guarda barra o que não vem do próprio PC antes de qualquer rota: Host diferente de
// 127.0.0.1:<porta> ou localhost:<porta> (DNS rebinding) e Origin, que só um navegador
// manda (CSRF). A única exceção é o GET /ws com um Origin só, da lista do setup
// (origens.txt): o Firmópolis aberto no navegador lendo a ponte, que ainda pede o token.
// Responde 403 sem corpo.
func (s *Servidor) guarda(proximo http.Handler) http.Handler {
	porta := strconv.Itoa(s.op.Porta)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hostOk := r.Host == "127.0.0.1:"+porta || r.Host == "localhost:"+porta
		origens := r.Header.Values("Origin")
		if !hostOk || len(origens) > 1 || len(origens) == 1 && !s.origemDoApp(r, origens[0]) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		proximo.ServeHTTP(w, r)
	})
}

// origemDoApp diz se o pedido é o WebSocket do Firmópolis num endereço da lista.
func (s *Servidor) origemDoApp(r *http.Request, origem string) bool {
	if r.Method != http.MethodGet || r.URL.Path != "/ws" || s.op.Origens == nil {
		return false
	}
	return slices.Contains(s.op.Origens(), origem)
}
