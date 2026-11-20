package maestri

import (
	"context"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"firmopolis/ponte/internal/mundo"
	"firmopolis/ponte/internal/projeto"
)

const fixture = "testdata/maestri"

func TestTerminalComPapelEBand(t *testing.T) {
	m, err := LerTudo(fixture)
	if err != nil {
		t.Fatal(err)
	}
	// O provedor sai nos valores do contrato (o Registro descarta sinal de provedor
	// diferente do da meta): agentType conhecido passa, shell genérico vira desconhecido.
	want := []mundo.MetaTerminal{
		{ID: "t-agy", Nome: "Braçal · Gemini", Provedor: mundo.ProvedorAgy, WorkspaceID: "ws-a", Projeto: "alfa"},
		{ID: "t-mae", Nome: "Maestro", Provedor: mundo.ProvedorClaude, WorkspaceID: "ws-a", BandID: "b-1", Gerente: true, Projeto: "alfa"},
		{ID: "t-neo", Nome: "Neo", Papel: "Implementador Sênior", Provedor: mundo.ProvedorClaude, WorkspaceID: "ws-a", BandID: "b-1", Projeto: "alfa"},
		{ID: "t-oc", Nome: "Braçal · DeepSeek", Provedor: mundo.ProvedorOpenCode, WorkspaceID: "ws-a", Projeto: "alfa"},
		{ID: "t-pon", Nome: "Ponte", Provedor: mundo.ProvedorDesconhecido, WorkspaceID: "ws-a", Projeto: "alfa"},
		{ID: "t-spo", Nome: "Spock", Papel: "Auditor", Provedor: mundo.ProvedorClaude, WorkspaceID: "ws-a", BandID: "b-1", Projeto: "alfa"},
		// Terminal de um floor do workspace: mesmo formato de nó, em payload.floors[].nodes.
		// O projeto é o do floor (sem groundPath, o do clonePath).
		{ID: "t-tri", Nome: "Trinity", Provedor: mundo.ProvedorCodex, WorkspaceID: "ws-a", Projeto: "alfa-f1"},
	}
	if !reflect.DeepEqual(m.Terminais, want) {
		t.Fatalf("terminais:\n got %+v\nwant %+v", m.Terminais, want)
	}

	// A band é um nó com content.band._0 {name, memberNodeIds}; os membros são os ids
	// dos nós de terminal (no workspace.json real, node.id == terminal.id), e as
	// connections são só as cordas desenhadas no canvas, não a ligação da band.
	wantWS := []Workspace{
		{ID: "ws-a", Nome: "Escritório Alfa", Projeto: "alfa", Pasta: `C:\proj\alfa`,
			Bands: []Band{{ID: "b-1", Nome: "Esquadrão", Membros: []string{"t-neo", "t-spo", "t-mae"}}}},
		{ID: "ws-b", Nome: "Vazio", Projeto: "Vazio", Bands: []Band{}}, // sem pasta: o nome do canvas
	}
	if !reflect.DeepEqual(m.Workspaces, wantWS) {
		t.Fatalf("workspaces:\n got %+v\nwant %+v", m.Workspaces, wantWS)
	}
}

func TestStatusDoWorkspaceNaoEntra(t *testing.T) {
	// O status do workspace.json é obsoleto (laudo): "running" e "stopped" saem iguais.
	dir := copiar(t)
	trocar(t, filepath.Join(dir, "workspaces", "ws-a", "workspace.json"), `"status":"running"`, `"status":"stopped"`)
	antes, _ := LerTudo(fixture)
	depois, _ := LerTudo(dir)
	if !reflect.DeepEqual(antes, depois) {
		t.Fatal("o status do terminal não pode mudar o que o leitor entrega")
	}
}

// fsRegistrado anota cada caminho aberto.
type fsRegistrado struct {
	fs.FS
	mu      sync.Mutex
	abertos []string
}

func (r *fsRegistrado) Open(nome string) (fs.File, error) {
	r.mu.Lock()
	r.abertos = append(r.abertos, nome)
	r.mu.Unlock()
	return r.FS.Open(nome)
}

func TestCamposProibidosNaoLidos(t *testing.T) {
	reg := &fsRegistrado{FS: os.DirFS(fixture)}
	l := novoLeitor(reg)
	if _, err := l.ler(); err != nil {
		t.Fatal(err)
	}
	if _, err := l.assinatura(); err != nil {
		t.Fatal(err)
	}
	if len(reg.abertos) == 0 {
		t.Fatal("o leitor não abriu nada pelo FS registrado")
	}
	for _, nome := range reg.abertos {
		if nome == "license.json" || nome == "accounts" || strings.HasPrefix(nome, "accounts/") || nome == "." {
			t.Errorf("abriu um caminho proibido: %q (todos: %v)", nome, reg.abertos)
		}
	}
}

func TestJSONParcialMantemUltimoBom(t *testing.T) {
	dir := copiar(t)
	l := novoLeitor(os.DirFS(dir))
	bom, err := l.ler()
	if err != nil {
		t.Fatal(err)
	}

	arq := filepath.Join(dir, "workspaces", "ws-a", "workspace.json")
	escrever(t, arq, `{"schemaVersion":2,"type":"workspace","payload":{"id":"WS-A","name":"Escr`)
	escrever(t, filepath.Join(dir, "preferences.json"), `{"payload":{"rolePre`)
	parcial, err := l.ler()
	if err != nil || !reflect.DeepEqual(parcial, bom) {
		t.Fatalf("o arquivo parcial deveria manter o último bom:\n got %+v %v\nwant %+v", parcial, err, bom)
	}

	// Workspace apagado sai de vez (não é parcial, é ausência).
	os.RemoveAll(filepath.Join(dir, "workspaces", "ws-b"))
	if m, _ := l.ler(); len(m.Workspaces) != 1 {
		t.Fatalf("o workspace apagado deveria sair: %+v", m.Workspaces)
	}
}

func TestPastaAusenteNaoEErro(t *testing.T) {
	m, err := LerTudo(filepath.Join(t.TempDir(), "nao-existe"))
	if err != nil || len(m.Terminais) != 0 || len(m.Workspaces) != 0 {
		t.Fatalf("sem Maestri instalado: %+v %v", m, err)
	}
}

func TestObservar(t *testing.T) {
	intervaloObservar = 10 * time.Millisecond
	dir := copiar(t)
	ctx, cancelar := context.WithCancel(context.Background())
	chegou := make(chan Maestri, 10)
	feito := make(chan struct{})
	go func() {
		Observar(ctx, dir, func(m Maestri) { chegou <- m })
		close(feito)
	}()

	primeiro := receber(t, chegou)
	if len(primeiro.Terminais) != 7 {
		t.Fatalf("a 1ª leitura sai logo: %+v", primeiro)
	}

	arq := filepath.Join(dir, "workspaces", "ws-a", "workspace.json")
	escrever(t, arq, `{"payload":{"id":"WS-A","name":"Escr`) // parcial: sem aviso
	time.Sleep(100 * time.Millisecond)
	select {
	case m := <-chegou:
		t.Fatalf("arquivo parcial não deveria avisar: %+v", m)
	default:
	}

	copiarArquivo(t, filepath.Join(fixture, "workspaces", "ws-a", "workspace.json"), arq)
	trocar(t, arq, `"name":"Neo"`, `"name":"Neo II"`)
	m := receber(t, chegou)
	if m.Terminais[2].Nome != "Neo II" {
		t.Fatalf("a mudança deveria chegar: %+v", m.Terminais)
	}

	cancelar()
	select {
	case <-feito:
	case <-time.After(2 * time.Second):
		t.Fatal("Observar não parou com o contexto")
	}
}

func receber(t *testing.T, c chan Maestri) Maestri {
	t.Helper()
	select {
	case m := <-c:
		return m
	case <-time.After(3 * time.Second):
		t.Fatal("nenhum aviso chegou")
	}
	return Maestri{}
}

// copiar põe a fixture numa pasta temporária, para o teste poder mexer nela.
func copiar(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	err := filepath.WalkDir(fixture, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		rel, _ := filepath.Rel(fixture, p)
		copiarArquivo(t, p, filepath.Join(dir, rel))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return dir
}

func copiarArquivo(t *testing.T, de, para string) {
	t.Helper()
	dados, err := os.ReadFile(de)
	if err != nil {
		t.Fatal(err)
	}
	os.MkdirAll(filepath.Dir(para), 0o700)
	escrever(t, para, string(dados))
}

func escrever(t *testing.T, arq, conteudo string) {
	t.Helper()
	if err := os.WriteFile(arq, []byte(conteudo), 0o600); err != nil {
		t.Fatal(err)
	}
}

func trocar(t *testing.T, arq, de, para string) {
	t.Helper()
	dados, err := os.ReadFile(arq)
	if err != nil || !strings.Contains(string(dados), de) {
		t.Fatalf("%s não tem %q: %v", arq, de, err)
	}
	escrever(t, arq, strings.Replace(string(dados), de, para, 1))
}

func TestProjetoDoWorkspaceNaHome(t *testing.T) {
	// Workspace na home (genérica): o projeto é o mais comum entre os floors e as pastas
	// dos terminais; o terminal sem pasta própria herda o do workspace, e o de pasta
	// genérica também. Sem candidato, vale o nome do canvas.
	ws := func(id, nome, corpo string) *fstest.MapFile {
		return &fstest.MapFile{Data: []byte(`{"payload":{"id":"` + id + `","name":"` + nome + `",` + corpo + `}}`)}
	}
	terminal := func(id, pasta string) string {
		return `{"id":"` + id + `","content":{"terminal":{"_0":{"id":"` + id + `","name":"` + id + `","agentType":"claude_code","workingDirectory":"` + pasta + `"}}}}`
	}
	fsys := fstest.MapFS{
		"workspaces/dm/workspace.json": ws("DM", "Escritório DM", `"workingDirectory":"C:\\Users\\ana",
			"nodes":[`+terminal("t-mae", "")+`,`+terminal("t-neo", `C:\\Users\\ana`)+`,`+terminal("t-erp", `C:\\dev\\dm-erp`)+`],
			"floors":[{"groundPath":"C:/dev/EscritorioVivo","clonePath":"C:\\dev\\.maestri\\floors\\escritoriovivo--a","nodes":[]},
			          {"clonePath":"C:\\dev\\.maestri\\floors\\escritoriovivo--b","nodes":[`+terminal("t-tro", "")+`]}]`),
		"workspaces/vazio/workspace.json": ws("VAZIO", "Canvas Novo", `"workingDirectory":"C:\\Users\\ana","nodes":[`+terminal("t-x", "")+`]`),
	}
	l := novoLeitor(fsys)
	l.projetos = projeto.Novo(`C:\Users\ana`)
	m, err := l.ler()
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]string{}
	for _, w := range m.Workspaces {
		got[w.ID] = w.Projeto
	}
	for _, x := range m.Terminais {
		got[x.ID] = x.Projeto
	}
	want := map[string]string{
		"dm": "EscritorioVivo", "vazio": "Canvas Novo",
		"t-mae": "EscritorioVivo", "t-neo": "EscritorioVivo", "t-erp": "dm-erp", "t-tro": "escritoriovivo", "t-x": "Canvas Novo",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("projetos:\n got %v\nwant %v", got, want)
	}

	// As duas na mesma pasta, com projetos diferentes: o solto não tem como escolher.
	if p := Pastas(m.Workspaces); len(p) != 1 || p[projeto.Chave(`C:\Users\ana`)] != "" {
		t.Fatalf("pastas ambíguas = %v", p)
	}
	m.Workspaces[1].Projeto = "EscritorioVivo"
	if p := Pastas(m.Workspaces); p["c:/users/ana"] != "EscritorioVivo" {
		t.Fatalf("pastas = %v", p)
	}
}
