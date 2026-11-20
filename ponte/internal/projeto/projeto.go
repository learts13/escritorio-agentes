// Package projeto dá o nome legível do projeto de uma pasta: o nome da raiz git, com
// worktree e floor do Maestri contando como o repositório de origem.
//
// Regra (De):
//   - O cwd que o Maestri dá aos terminais, <pasta>/.maestri/roles/<papel>, conta como
//     a <pasta> (a do workspace).
//   - Sobe a partir da pasta até achar um .git. Pasta .git: o projeto é o nome da raiz.
//     Arquivo .git de worktree (gitdir: <gitdir>/worktrees/<x>): o repositório do
//     <gitdir>, sem o .git (<repo>/.git, <repo>.git do repo bare, <repo>/.git/modules/<sub>
//     do submódulo). Outro arquivo .git (submódulo, ou sem gitdir:): o nome da raiz.
//   - Dentro de um floor do Maestri (<pasta>/.maestri/floors/<repo>--<floor>), a busca não
//     passa do floor; sem .git nele, o projeto é o <repo> do nome da pasta, com a caixa
//     da pasta irmã de mesmo nome em <pasta>, se houver (o Maestri põe o nome em minúsculas).
//   - Sem git, o nome da própria pasta. A busca para antes da home e da raiz do disco.
//   - Caminho de rede (\\servidor\pasta\...): não lê o disco, para não travar com o
//     servidor fora do ar; vale o nome da pasta.
//   - Pasta genérica (a home, a raiz do disco ou do compartilhamento), cwd vazio ou
//     relativo: "".
//   - Junction e symlink não são resolvidos: o projeto é o nome do link.
//
// O resultado fica em cache por cwd, então o disco só é lido uma vez por pasta.
package projeto

import (
	"os"
	"path"
	"path/filepath"
	"strings"
	"sync"
)

// maxCache limita o cache; passou disso, ele recomeça (o comum são poucas dezenas de pastas).
const maxCache = 1024

// Resolvedor resolve e guarda o projeto de cada cwd. Seguro para uso concorrente.
type Resolvedor struct {
	home  string // em barras normais e minúsculas
	mu    sync.Mutex
	cache map[string]string
}

// Novo cria um resolvedor que trata home como pasta genérica.
func Novo(home string) *Resolvedor {
	return &Resolvedor{home: chave(normalizar(home)), cache: map[string]string{}}
}

// Padrao é o resolvedor da home do usuário de verdade, criado no primeiro uso.
var Padrao = sync.OnceValue(func() *Resolvedor {
	home, _ := os.UserHomeDir()
	return Novo(home)
})

// Chave é a forma comparável de uma pasta: barras normais e minúsculas.
func Chave(pasta string) string { return chave(normalizar(pasta)) }

// PastaDoPapel devolve a <pasta> de um cwd <pasta>/.maestri/roles/<papel>.
func PastaDoPapel(cwd string) (string, bool) {
	p := normalizar(cwd)
	i := strings.Index(chave(p), "/.maestri/roles/")
	if i < 0 {
		return "", false
	}
	return p[:i], true
}

// De devolve o projeto do cwd ("" quando não há um que valha).
func (r *Resolvedor) De(cwd string) string {
	if cwd == "" {
		return ""
	}
	r.mu.Lock()
	p, ok := r.cache[cwd]
	r.mu.Unlock()
	if ok {
		return p
	}
	p = r.resolver(cwd)
	r.mu.Lock()
	if len(r.cache) >= maxCache {
		r.cache = map[string]string{}
	}
	r.cache[cwd] = p
	r.mu.Unlock()
	return p
}

// Generica diz se a pasta não serve de projeto (vazia, a home ou a raiz do disco).
func (r *Resolvedor) Generica(pasta string) bool {
	p := normalizar(pasta)
	return raizDoDisco(p) || chave(p) == r.home
}

func (r *Resolvedor) resolver(cwd string) string {
	p := normalizar(cwd)
	if base, ok := PastaDoPapel(p); ok {
		p = base
	}
	if r.Generica(p) || !absoluto(p) {
		return ""
	}
	if rede(p) {
		return path.Base(p)
	}

	// Dentro de um floor, a busca não sai dele.
	limite, doFloor, pastaFloor := "", "", ""
	if i := strings.Index(chave(p), "/.maestri/floors/"); i >= 0 {
		nome, _, _ := strings.Cut(p[i+len("/.maestri/floors/"):], "/")
		limite = p[:i] + "/.maestri/floors/" + nome
		doFloor, _, _ = strings.Cut(nome, "--")
		pastaFloor = p[:i]
	}

	for d := p; ; d = path.Dir(d) {
		if r.Generica(d) {
			break
		}
		if nome := raizGit(d); nome != "" {
			return nome
		}
		if chave(d) == chave(limite) || path.Dir(d) == d {
			break
		}
	}
	if doFloor != "" {
		return comCaixaDe(pastaFloor, doFloor)
	}
	return path.Base(p)
}

// comCaixaDe devolve o nome da pasta de dir igual a nome sem diferenciar maiúsculas;
// sem nenhuma, o próprio nome.
func comCaixaDe(dir, nome string) string {
	itens, _ := os.ReadDir(filepath.FromSlash(dir + "/"))
	for _, it := range itens {
		if it.IsDir() && strings.EqualFold(it.Name(), nome) {
			return it.Name()
		}
	}
	return nome
}

// raizGit devolve o projeto se d tem um .git: o nome de d, ou o do repositório de
// origem quando é um worktree.
func raizGit(d string) string {
	git := filepath.FromSlash(d + "/.git")
	info, err := os.Stat(git)
	if err != nil {
		return ""
	}
	if info.IsDir() {
		return path.Base(d)
	}
	dados, err := os.ReadFile(git)
	if err != nil {
		return path.Base(d)
	}
	alvo, ok := strings.CutPrefix(strings.TrimSpace(string(dados)), "gitdir:")
	if !ok {
		return path.Base(d)
	}
	alvo = normalizar(strings.TrimSpace(alvo))
	if !absoluto(alvo) {
		alvo = path.Join(d, alvo)
	}
	if wt := path.Dir(alvo); strings.EqualFold(path.Base(wt), "worktrees") {
		gitdir := path.Dir(wt)
		base := path.Base(gitdir)
		switch {
		case strings.EqualFold(base, ".git"): // <repo>/.git
			return path.Base(path.Dir(gitdir))
		case len(base) > 4 && strings.EqualFold(base[len(base)-4:], ".git"): // <repo>.git, repo bare
			return base[:len(base)-4]
		default: // <repo>/.git/modules/<sub>, submódulo
			return base
		}
	}
	return path.Base(d)
}

// normalizar usa barras normais, sem barra no fim (exceto na raiz) e sem . nem ..,
// para caminhos de Windows e Unix. O caminho de rede mantém as duas barras do início.
func normalizar(p string) string {
	p = strings.ReplaceAll(strings.TrimSpace(p), `\`, "/")
	if p == "" {
		return ""
	}
	if rede(p) {
		return "/" + path.Clean(p[1:])
	}
	p = path.Clean(p)
	if len(p) == 2 && p[1] == ':' {
		return p + "/" // C: é a raiz do disco C:/
	}
	return p
}

// chave compara pastas sem diferenciar maiúsculas (Windows e macOS).
func chave(p string) string { return strings.ToLower(p) }

// raizDoDisco também vale para o \\servidor e o \\servidor\compartilhamento.
func raizDoDisco(p string) bool {
	return p == "" || p == "/" || p == "." || (len(p) == 3 && p[1] == ':' && p[2] == '/') ||
		(rede(p) && strings.Count(p[2:], "/") <= 1)
}

// rede diz se p (já com barras normais) é um caminho UNC, //servidor/....
func rede(p string) bool { return len(p) > 2 && p[0] == '/' && p[1] == '/' && p[2] != '/' }

func absoluto(p string) bool {
	return strings.HasPrefix(p, "/") || (len(p) >= 3 && p[1] == ':' && p[2] == '/')
}
