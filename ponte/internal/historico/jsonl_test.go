package historico

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"firmopolis/ponte/internal/mundo"
)

// noDia fixa o relógio do pacote num horário do dia d e devolve a hora.
func noDia(t *testing.T, d time.Time) time.Time {
	t.Helper()
	antes := agora
	agora = func() time.Time { return d }
	t.Cleanup(func() { agora = antes })
	return d
}

func abrir(t *testing.T, dir string) *Historico {
	t.Helper()
	h, err := Abrir(dir, 30)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { h.Fechar() })
	return h
}

func gravar(t *testing.T, h *Historico, e EventoHist) {
	t.Helper()
	if err := h.Gravar(e); err != nil {
		t.Fatal(err)
	}
}

var hoje = time.Date(2026, 11, 14, 15, 0, 0, 0, time.Local)

func TestGravarEHoje(t *testing.T) {
	noDia(t, hoje)
	dir := t.TempDir()
	h := abrir(t, dir)
	eventos := []EventoHist{
		{TS: hoje, MoradorID: "t1", Estado: mundo.Ocupado, Ferramenta: "Edit", Alvo: "main.go"},
		{TS: hoje.Add(time.Second), MoradorID: "t2", Estado: mundo.Ocioso},
		{TS: hoje.Add(2 * time.Second), MoradorID: "t1", Estado: mundo.EsperandoPermissao},
	}
	for _, e := range eventos {
		gravar(t, h, e)
	}
	if got := h.Hoje(); !reflect.DeepEqual(got, eventos) {
		t.Fatalf("Hoje:\n got %+v\nwant %+v", got, eventos)
	}

	linhas := lerLinhas(t, filepath.Join(dir, "2026-11-14.jsonl"))
	if len(linhas) != 3 {
		t.Fatalf("esperava 3 linhas, veio %d", len(linhas))
	}
	var bruto map[string]any
	if err := json.Unmarshal([]byte(linhas[0]), &bruto); err != nil {
		t.Fatal(err)
	}
	for _, chave := range []string{"ts", "morador_id", "estado", "ferramenta", "alvo"} {
		if _, ok := bruto[chave]; !ok {
			t.Errorf("faltou %q na linha do contrato: %s", chave, linhas[0])
		}
	}
}

func TestReinicioMantemHistoricoSemDuplicar(t *testing.T) {
	noDia(t, hoje)
	dir := t.TempDir()
	h := abrir(t, dir)
	gravar(t, h, EventoHist{TS: hoje, MoradorID: "t1", Estado: mundo.Ocupado, Ferramenta: "Bash", Alvo: "go test ./..."})
	gravar(t, h, EventoHist{TS: hoje.Add(time.Second), MoradorID: "t2", Estado: mundo.Ocioso})
	antes := h.Hoje()
	h.Fechar()

	// A ponte caiu no meio de uma escrita: a última linha ficou pela metade.
	arq := filepath.Join(dir, "2026-11-14.jsonl")
	f, _ := os.OpenFile(arq, os.O_APPEND|os.O_WRONLY, 0)
	f.WriteString(`{"ts":"2026-11-14T15:00:0`)
	f.Close()

	h = abrir(t, dir)
	if got := h.Hoje(); !reflect.DeepEqual(got, antes) {
		t.Fatalf("o histórico de hoje deveria voltar igual:\n got %+v\nwant %+v", got, antes)
	}
	// A reconciliação refaz o mesmo estado: não vira evento repetido.
	gravar(t, h, EventoHist{TS: hoje.Add(time.Minute), MoradorID: "t1", Estado: mundo.Ocupado, Ferramenta: "Bash", Alvo: "go test ./..."})
	gravar(t, h, EventoHist{TS: hoje.Add(time.Minute), MoradorID: "t2", Estado: mundo.Ocioso})
	if got := h.Hoje(); len(got) != 2 {
		t.Fatalf("o estado refeito depois do reinício não pode duplicar: %+v", got)
	}
	gravar(t, h, EventoHist{TS: hoje.Add(2 * time.Minute), MoradorID: "t1", Estado: mundo.Ocioso})
	if got := h.Hoje(); len(got) != 3 || got[2].Estado != mundo.Ocioso {
		t.Fatalf("estado novo grava: %+v", got)
	}

	// A linha nova começa limpa, depois da parcial; só a parcial fica inválida.
	invalidas := 0
	for _, l := range lerLinhas(t, arq) {
		var e EventoHist
		if json.Unmarshal([]byte(l), &e) != nil {
			invalidas++
		}
	}
	if invalidas != 1 {
		t.Fatalf("esperava só a linha parcial inválida, veio %d", invalidas)
	}
}

func TestRetencaoApagaAntigos(t *testing.T) {
	noDia(t, hoje)
	dir := t.TempDir()
	nomes := map[string]bool{ // nome → deve ficar
		hoje.AddDate(0, 0, -40).Format("2006-01-02") + ".jsonl": false,
		hoje.AddDate(0, 0, -31).Format("2006-01-02") + ".jsonl": false,
		hoje.AddDate(0, 0, -30).Format("2006-01-02") + ".jsonl": true,
		hoje.AddDate(0, 0, -1).Format("2006-01-02") + ".jsonl":  true,
		"notas.txt":         true, // não é nosso
		"2026-13-99.jsonl":  true, // nome que não é data
		"backup-2020.jsonl": true,
	}
	for nome := range nomes {
		os.WriteFile(filepath.Join(dir, nome), []byte("{}\n"), 0o600)
	}
	abrir(t, dir)
	for nome, fica := range nomes {
		_, err := os.Stat(filepath.Join(dir, nome))
		if existe := err == nil; existe != fica {
			t.Errorf("%s: existe=%v, deveria ficar=%v", nome, existe, fica)
		}
	}
}

func TestDiaCabeNoLimite(t *testing.T) {
	// Um "dia" grande demais derruba a conexão do jogo (teto de 8 MiB no cliente) e,
	// como a ponte reenvia o dia a cada reconexão, vira laço.
	noDia(t, hoje)
	dir := t.TempDir()
	h := abrir(t, dir)
	// 100 mil transições num dia (gate P5, item 7), com alvos de até 60 caracteres.
	alvo := strings.Repeat("a", 60)
	const escritos = 100_000
	for i := 0; i < escritos; i++ {
		gravar(t, h, EventoHist{TS: hoje.Add(time.Duration(i) * time.Millisecond), MoradorID: "t" + string(rune('a'+i%26)),
			Estado: mundo.Ocupado, Ferramenta: "Bash", Alvo: alvo[:30+i%30]})
	}
	if info, _ := os.Stat(filepath.Join(dir, "2026-11-14.jsonl")); info.Size() <= LimiteDia {
		t.Fatalf("o arquivo deveria passar do limite para o teste valer: %d", info.Size())
	}

	conferir := func(h *Historico) {
		t.Helper()
		dia := h.Hoje()
		msg, _ := json.Marshal(map[string]any{"v": 1, "tipo": "dia", "eventos": dia})
		if len(msg) > LimiteDia+1024 || len(msg) >= 8<<20 {
			t.Fatalf("o dia tem %d bytes; limite %d", len(msg), LimiteDia)
		}
		if len(dia) == 0 || dia[len(dia)-1].TS != hoje.Add(time.Duration(escritos-1)*time.Millisecond) {
			t.Fatal("o dia deveria terminar no evento mais recente")
		}
		if dia[0].TS == hoje {
			t.Fatal("o dia cortado deveria ter perdido os mais antigos")
		}
	}
	conferir(h)
	h.Fechar()
	conferir(abrir(t, dir)) // o mesmo limite vale ao recarregar o arquivo
}

func TestViradaDoDia(t *testing.T) {
	noDia(t, hoje)
	dir := t.TempDir()
	h := abrir(t, dir)
	gravar(t, h, EventoHist{TS: hoje, MoradorID: "t1", Estado: mundo.Ocupado})

	amanha := noDia(t, hoje.AddDate(0, 0, 1))
	if got := h.Hoje(); len(got) != 0 {
		t.Fatalf("depois da meia-noite o dia começa vazio: %+v", got)
	}
	gravar(t, h, EventoHist{TS: amanha, MoradorID: "t1", Estado: mundo.Ocupado})
	if got := h.Hoje(); len(got) != 1 {
		t.Fatalf("o mesmo estado num dia novo grava (é o 1º do dia): %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, amanha.Format("2006-01-02")+".jsonl")); err != nil {
		t.Fatalf("o arquivo do dia novo deveria existir: %v", err)
	}
}

func TestTSNoFuturoNaoViraODia(t *testing.T) {
	// Relógio atrasado perto da meia-noite: chega um ts de amanhã. O dia da memória
	// continua o de hoje, para a mensagem "dia" não perder os eventos de hoje.
	noDia(t, hoje)
	dir := t.TempDir()
	h := abrir(t, dir)
	antes := EventoHist{TS: hoje, MoradorID: "t1", Estado: mundo.Ocupado, Ferramenta: "Edit", Alvo: "a.go"}
	futuro := EventoHist{TS: hoje.AddDate(0, 0, 1), MoradorID: "t2", Estado: mundo.Ocioso}
	depois := EventoHist{TS: hoje.Add(time.Minute), MoradorID: "t1", Estado: mundo.Ocioso}
	gravar(t, h, antes)
	gravar(t, h, futuro)
	gravar(t, h, futuro) // repetido: o dedupe vale também fora do dia da memória
	gravar(t, h, depois)

	want := []EventoHist{antes, depois}
	if got := h.Hoje(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Hoje:\n got %+v\nwant %+v", got, want)
	}
	msg, _ := json.Marshal(map[string]any{"v": 1, "tipo": "dia", "eventos": h.Hoje()})
	wantMsg, _ := json.Marshal(map[string]any{"v": 1, "tipo": "dia", "eventos": want})
	if string(msg) != string(wantMsg) {
		t.Fatalf("mensagem dia:\n got %s\nwant %s", msg, wantMsg)
	}
	if n := len(lerLinhas(t, filepath.Join(dir, "2026-11-14.jsonl"))); n != 2 {
		t.Fatalf("hoje deveria ter 2 linhas no arquivo, veio %d", n)
	}
	if n := len(lerLinhas(t, filepath.Join(dir, "2026-11-15.jsonl"))); n != 1 {
		t.Fatalf("o evento de amanhã vai uma vez para o arquivo de amanhã, veio %d", n)
	}

	// Na meia-noite real, o dia novo recarrega o evento que tinha chegado adiantado.
	noDia(t, hoje.AddDate(0, 0, 1))
	if got := h.Hoje(); !reflect.DeepEqual(got, []EventoHist{futuro}) {
		t.Fatalf("o dia de amanhã deveria trazer o evento adiantado: %+v", got)
	}
}

func TestAtrasadoDeOntemNaoDuplicaNoReinicio(t *testing.T) {
	// A reconciliação de cada reinício refaz o estado com o desde de ontem: o arquivo
	// de ontem não pode ganhar uma linha repetida por reinício.
	noDia(t, hoje)
	dir := t.TempDir()
	ontem := hoje.AddDate(0, 0, -1)
	e := EventoHist{TS: ontem, MoradorID: "t1", Estado: mundo.Ocioso}
	for i := 0; i < 3; i++ {
		h := abrir(t, dir)
		gravar(t, h, e)
		h.Fechar()
	}
	h := abrir(t, dir)
	gravar(t, h, EventoHist{TS: ontem.Add(time.Second), MoradorID: "t1", Estado: mundo.Ocupado})
	gravar(t, h, EventoHist{TS: ontem.Add(time.Second), MoradorID: "t2", Estado: mundo.Ocioso})
	if n := len(lerLinhas(t, filepath.Join(dir, "2026-11-13.jsonl"))); n != 3 {
		t.Fatalf("esperava 3 linhas em ontem (uma por estado novo), veio %d", n)
	}
	if got := h.Hoje(); len(got) != 0 {
		t.Fatalf("atrasado de ontem não entra em hoje: %+v", got)
	}
}

func TestAtrasadoDedupePorMoradorEChaveInteira(t *testing.T) {
	// A→B→A em ontem com dois moradores intercalados: o dedupe compara com o último
	// evento do mesmo morador, pela chave inteira (estado, ferramenta e alvo).
	passos := []struct {
		e      EventoHist
		linhas int
	}{
		{EventoHist{MoradorID: "t1", Estado: mundo.Ocioso}, 1},
		{EventoHist{MoradorID: "t2", Estado: mundo.Ocioso}, 2},
		{EventoHist{MoradorID: "t1", Estado: mundo.Ocupado}, 3},
		{EventoHist{MoradorID: "t1", Estado: mundo.Ocioso}, 4},
		{EventoHist{MoradorID: "t1", Estado: mundo.Ocioso}, 4},
		{EventoHist{MoradorID: "t2", Estado: mundo.Ocioso, Ferramenta: "Bash"}, 5},
		{EventoHist{MoradorID: "t2", Estado: mundo.Ocioso, Ferramenta: "Bash", Alvo: "go test"}, 6},
		{EventoHist{MoradorID: "t2", Estado: mundo.Ocioso, Ferramenta: "Bash", Alvo: "go test"}, 6},
		{EventoHist{MoradorID: "t1", Estado: mundo.Ocioso}, 6},
	}
	// Sem reabrir, o último estado vem da memória de gravarEm; reabrindo a cada passo,
	// vem da leitura do arquivo.
	for _, reabrir := range []bool{false, true} {
		t.Run(map[bool]string{false: "memoria", true: "arquivo"}[reabrir], func(t *testing.T) {
			noDia(t, hoje)
			dir := t.TempDir()
			ontem := hoje.AddDate(0, 0, -1)
			h := abrir(t, dir)
			for i, p := range passos {
				if reabrir {
					h.Fechar()
					h = abrir(t, dir)
				}
				p.e.TS = ontem.Add(time.Duration(i) * time.Second)
				gravar(t, h, p.e)
				if n := len(lerLinhas(t, filepath.Join(dir, "2026-11-13.jsonl"))); n != p.linhas {
					t.Fatalf("passo %d (%+v): esperava %d linhas, veio %d", i, p.e, p.linhas, n)
				}
			}
		})
	}
}

func TestRelogioVoltaAtrasDaMeiaNoite(t *testing.T) {
	// O dia da memória já virou para 15 e o relógio é corrigido para 23:59:30 de 14:
	// um ts de 15 continua indo para a memória, senão sai do dedupe e duplica.
	noDia(t, hoje)
	dir := t.TempDir()
	h := abrir(t, dir)
	madrugada := noDia(t, time.Date(2026, 11, 15, 0, 0, 30, 0, time.Local))
	ocupado := EventoHist{TS: madrugada, MoradorID: "t1", Estado: mundo.Ocupado}
	ocioso := EventoHist{TS: madrugada.Add(time.Second), MoradorID: "t1", Estado: mundo.Ocioso}
	gravar(t, h, ocupado)
	noDia(t, madrugada.Add(-time.Minute)) // relógio corrigido para trás
	gravar(t, h, ocioso)
	noDia(t, madrugada.Add(time.Minute))
	gravar(t, h, EventoHist{TS: madrugada.Add(2 * time.Second), MoradorID: "t1", Estado: mundo.Ocioso}) // reconciliação

	if n := len(lerLinhas(t, filepath.Join(dir, "2026-11-15.jsonl"))); n != 2 {
		t.Fatalf("esperava 2 linhas no arquivo de 15, veio %d", n)
	}
	if got, want := h.Hoje(), []EventoHist{ocupado, ocioso}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Hoje:\n got %+v\nwant %+v", got, want)
	}
}

func lerLinhas(t *testing.T, arq string) []string {
	t.Helper()
	f, err := os.Open(arq)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	var linhas []string
	s := bufio.NewScanner(f)
	for s.Scan() {
		linhas = append(linhas, s.Text())
	}
	return linhas
}
