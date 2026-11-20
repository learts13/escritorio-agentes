package projeto

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

// fixture monta, numa pasta temporária, uma home e projetos como os de quem usa vários agentes:
//
//	home/                              (genérica; tem um .git, que não pode valer)
//	home/.maestri/roles/papel          (cwd de terminal de workspace na home)
//	home/projetos/solto/sub            (sem git)
//	dev/EscritorioVivo/.git/           (repo; cwd numa subpasta)
//	dev/.maestri/floors/escritoriovivo--fase1-ponte/.git   (arquivo: worktree do repo)
//	dev/.maestri/floors/purple-ribbon--login/              (floor sem .git)
//	dev/wt/.git                        (worktree comum, gitdir relativo)
//	dev/EscritorioVivo/vendor/lib/.git (submódulo)
//	dev/dm-erp/.maestri/roles/papel    (cwd de terminal do workspace dm-erp, sem git)
func fixture(t *testing.T) (raiz string, r *Resolvedor) {
	t.Helper()
	raiz = filepath.ToSlash(t.TempDir())
	pastas := []string{
		"home/.git", "home/.maestri/roles/papel", "home/projetos/solto/sub",
		"dev/EscritorioVivo/.git/worktrees/escritoriovivo--fase1-ponte", "dev/EscritorioVivo/ponte/cmd",
		"dev/.maestri/floors/escritoriovivo--fase1-ponte/ponte",
		"dev/.maestri/floors/purple-ribbon--login/src",
		"dev/wt", "dev/EscritorioVivo/vendor/lib",
		"dev/dm-erp/.maestri/roles/papel",
	}
	for _, p := range pastas {
		if err := os.MkdirAll(filepath.FromSlash(raiz+"/"+p), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	arquivos := map[string]string{
		"dev/.maestri/floors/escritoriovivo--fase1-ponte/.git": "gitdir: " + raiz + "/dev/EscritorioVivo/.git/worktrees/escritoriovivo--fase1-ponte\n",
		"dev/wt/.git":                        "gitdir: ../EscritorioVivo/.git/worktrees/wt\n",
		"dev/EscritorioVivo/vendor/lib/.git": "gitdir: ../../.git/modules/lib\n",
	}
	for p, conteudo := range arquivos {
		if err := os.WriteFile(filepath.FromSlash(raiz+"/"+p), []byte(conteudo), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return raiz, Novo(raiz + "/home")
}

func TestDe(t *testing.T) {
	raiz, r := fixture(t)
	casos := []struct{ nome, cwd, quer string }{
		{"raiz git", raiz + "/dev/EscritorioVivo", "EscritorioVivo"},
		{"subpasta de repo", raiz + "/dev/EscritorioVivo/ponte/cmd", "EscritorioVivo"},
		{"barra invertida e barra no fim", filepath.FromSlash(raiz+"/dev/EscritorioVivo/ponte") + `\`, "EscritorioVivo"},
		{"floor do Maestri vira o repo de origem", raiz + "/dev/.maestri/floors/escritoriovivo--fase1-ponte/ponte", "EscritorioVivo"},
		{"floor sem .git usa o nome do floor", raiz + "/dev/.maestri/floors/purple-ribbon--login/src", "purple-ribbon"},
		{"worktree com gitdir relativo", raiz + "/dev/wt", "EscritorioVivo"},
		{"submódulo é o próprio", raiz + "/dev/EscritorioVivo/vendor/lib", "lib"},
		{"papel do Maestri conta como a pasta do workspace", raiz + "/dev/dm-erp/.maestri/roles/papel", "dm-erp"},
		{"sem git: nome da pasta", raiz + "/home/projetos/solto/sub", "sub"},
		{"home é genérica, mesmo com .git", raiz + "/home", ""},
		{"papel na home é genérico", raiz + "/home/.maestri/roles/papel", ""},
		{"raiz do disco", `C:\`, ""},
		{"raiz do disco sem barra", "C:", ""},
		{"raiz unix", "/", ""},
		{"vazio", "", ""},
		{"pasta que não existe", "/nao/existe/loja", "loja"},
	}
	for _, c := range casos {
		if got := r.De(c.cwd); got != c.quer {
			t.Errorf("%s: De(%q) = %q, quer %q", c.nome, c.cwd, got, c.quer)
		}
	}
}

func TestDeUsaCache(t *testing.T) {
	raiz, r := fixture(t)
	cwd := raiz + "/dev/EscritorioVivo/ponte"
	if got := r.De(cwd); got != "EscritorioVivo" {
		t.Fatalf("1ª leitura = %q", got)
	}
	// Sem o .git, uma nova leitura daria "ponte"; o cache mantém o que já se resolveu.
	if err := os.RemoveAll(filepath.FromSlash(raiz + "/dev/EscritorioVivo/.git")); err != nil {
		t.Fatal(err)
	}
	if got := r.De(cwd); got != "EscritorioVivo" {
		t.Fatalf("2ª leitura = %q, quer o valor do cache", got)
	}
	if got := Novo(raiz + "/home").De(cwd); got != "ponte" {
		t.Fatalf("resolvedor novo = %q, quer ler o disco de novo", got)
	}
}

func TestPastaDoPapel(t *testing.T) {
	casos := []struct {
		cwd, quer string
		ok        bool
	}{
		{`C:\Users\ana\.maestri\roles\B830FADC`, "C:/Users/ana", true},
		{`C:\Dev\x\.Maestri\Roles\b830`, "C:/Dev/x", true},
		{"/home/ana/projetos/loja", "", false},
	}
	for _, c := range casos {
		if got, ok := PastaDoPapel(c.cwd); got != c.quer || ok != c.ok {
			t.Errorf("PastaDoPapel(%q) = %q, %v; quer %q, %v", c.cwd, got, ok, c.quer, c.ok)
		}
	}
}

// TestDeBordas monta, noutra pasta temporária:
//
//	acima/.git/                                  (repo acima dos floors: a busca não sobe até ele)
//	acima/Loja/                                  (pasta irmã que dá a caixa ao floor loja--x)
//	acima/.maestri/floors/loja--x/src            (floor sem .git)
//	acima/.maestri/floors/semirma--y/src         (floor sem .git e sem pasta irmã)
//	repo/.git/worktrees/wt, repo/wt/.git         (worktree dentro do repo, gitdir relativo)
//	nu.git/worktrees/nwt, nwt/.git               (worktree de repo bare)
//	repo/.git/modules/lib/worktrees/lwt, lwt/.git (worktree de submódulo)
//	vazio/.git, lixo/.git                        (arquivo .git sem gitdir:)
func TestDeBordas(t *testing.T) {
	raiz := filepath.ToSlash(t.TempDir())
	for _, p := range []string{
		"home", "acima/.git", "acima/Loja", "acima/.maestri/floors/loja--x/src", "acima/.maestri/floors/semirma--y/src",
		"repo/.git/worktrees/wt", "repo/wt", "nu.git/worktrees/nwt", "nwt",
		"repo/.git/modules/lib/worktrees/lwt", "lwt", "vazio", "lixo",
	} {
		if err := os.MkdirAll(filepath.FromSlash(raiz+"/"+p), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for p, conteudo := range map[string]string{
		"repo/wt/.git": "gitdir: ../.git/worktrees/wt\n",
		"nwt/.git":     "gitdir: " + raiz + "/nu.git/worktrees/nwt\n",
		"lwt/.git":     "gitdir: " + filepath.FromSlash(raiz+"/repo/.git/modules/lib/worktrees/lwt") + "\n",
		"vazio/.git":   "",
		"lixo/.git":    "../repo/.git/worktrees/wt\n",
	} {
		if err := os.WriteFile(filepath.FromSlash(raiz+"/"+p), []byte(conteudo), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	r := Novo(raiz + "/home")
	casos := []struct{ nome, cwd, quer string }{
		{"floor não sobe até o .git de cima", raiz + "/acima/.maestri/floors/semirma--y/src", "semirma"},
		{"floor herda a caixa da pasta irmã", raiz + "/acima/.maestri/floors/loja--x/src", "Loja"},
		{"worktree dentro do repo, gitdir relativo", raiz + "/repo/wt", "repo"},
		{"worktree de repo bare", raiz + "/nwt", "nu"},
		{"worktree de submódulo", raiz + "/lwt", "lib"},
		{".git vazio", raiz + "/vazio", "vazio"},
		{".git sem gitdir:", raiz + "/lixo", "lixo"},
		{"relativo", "dev/EscritorioVivo", ""},
		{"ponto", ".", ""},
		{"relativo ao disco", "C:dev", ""},
		{"rede", `\\servidor-que-nao-existe.invalid\share\repo\src`, "src"},
		{"rede: compartilhamento", `\\servidor-que-nao-existe.invalid\share`, ""},
		{"rede: servidor", `\\servidor-que-nao-existe.invalid`, ""},
		{"rede: papel no compartilhamento", `\\servidor-que-nao-existe.invalid\share\.maestri\roles\papel`, ""},
	}
	for _, c := range casos {
		if got := r.De(c.cwd); got != c.quer {
			t.Errorf("%s: De(%q) = %q, quer %q", c.nome, c.cwd, got, c.quer)
		}
	}
}

func TestChaveDeRedeMantemAsDuasBarras(t *testing.T) {
	if got := Chave(`\\Servidor\Share\Repo\`); got != "//servidor/share/repo" {
		t.Fatalf("Chave = %q", got)
	}
	if got, ok := PastaDoPapel(`\\Servidor\Share\.maestri\roles\x`); !ok || got != "//Servidor/Share" {
		t.Fatalf("PastaDoPapel = %q, %v", got, ok)
	}
}

// TestRedeNaoLeODisco: um worktree da pasta temporária visto pelo compartilhamento
// administrativo (\\localhost\C$\...). Lendo o .git, o projeto seria o repo de origem;
// sem ler, é o nome da pasta.
func TestRedeNaoLeODisco(t *testing.T) {
	raiz := t.TempDir()
	if len(raiz) < 3 || raiz[1] != ':' {
		t.Skip("só no Windows")
	}
	if err := os.MkdirAll(filepath.Join(raiz, "wt"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(raiz, "wt", ".git"), []byte("gitdir: "+filepath.ToSlash(raiz)+"/origem/.git/worktrees/wt\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	unc := `\\localhost\` + raiz[:1] + `$` + raiz[2:] + `\wt`
	if _, err := os.Stat(unc + `\.git`); err != nil {
		t.Skip("compartilhamento administrativo indisponível:", err)
	}
	if got := Novo(raiz + "/home").De(unc); got != "wt" {
		t.Fatalf("De(%q) = %q, quer %q (sem ler o .git pela rede)", unc, got, "wt")
	}
}

func TestDeLimitaOCache(t *testing.T) {
	r := Novo("/home/ana")
	for i := 0; i <= maxCache; i++ {
		r.De("/nao/existe/" + strconv.Itoa(i))
	}
	if n := len(r.cache); n > maxCache {
		t.Fatalf("cache com %d entradas, o limite é %d", n, maxCache)
	}
	if got := r.De("/nao/existe/loja"); got != "loja" {
		t.Fatalf("depois de recomeçar o cache, De = %q", got)
	}
}
