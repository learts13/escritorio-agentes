package calendario

import (
	"reflect"
	"testing"
	"time"
)

func dia(ano int, mes time.Month, d int) time.Time {
	return time.Date(ano, mes, d, 15, 30, 0, 0, time.FixedZone("BRT", -3*3600))
}

func TestPascoaDeCincoAnos(t *testing.T) {
	// Datas conferidas no calendário litúrgico.
	quer := map[int]string{2024: "2024-03-31", 2025: "2025-04-20", 2026: "2026-04-05", 2027: "2027-03-28", 2028: "2028-04-16"}
	for ano, data := range quer {
		if got := Pascoa(ano).Format("2006-01-02"); got != data {
			t.Errorf("Páscoa de %d = %s, quer %s", ano, got, data)
		}
	}
}

func ids(datas []Data) []string {
	out := []string{}
	for _, d := range datas {
		out = append(out, d.ID)
	}
	return out
}

func TestDatasDoBrasil(t *testing.T) {
	casos := []struct {
		dia  time.Time
		quer []string
	}{
		{dia(2026, time.February, 13), []string{}},
		{dia(2026, time.February, 14), []string{"carnaval"}}, // sábado; Cinzas em 18/02
		{dia(2026, time.February, 17), []string{"carnaval"}}, // terça
		{dia(2026, time.February, 18), []string{}},
		{dia(2026, time.April, 3), []string{"sexta_santa"}},
		{dia(2026, time.April, 5), []string{"pascoa"}},
		{dia(2026, time.June, 4), []string{"corpus_christi", "festa_junina"}},
		{dia(2026, time.June, 24), []string{"festa_junina"}},
		{dia(2026, time.September, 13), []string{"dia_do_programador"}},
		{dia(2028, time.September, 12), []string{"dia_do_programador"}}, // ano bissexto
		{dia(2026, time.October, 12), []string{"nossa_senhora_aparecida", "dia_das_criancas"}},
		{dia(2026, time.October, 31), []string{"halloween"}},
		{dia(2026, time.November, 20), []string{"consciencia_negra"}},
		{dia(2026, time.December, 24), []string{"vespera_de_natal"}},
		{dia(2026, time.December, 25), []string{"natal"}},
		{dia(2026, time.December, 31), []string{"reveillon"}},
		{dia(2027, time.January, 1), []string{"ano_novo"}},
	}
	for _, c := range casos {
		if got := ids(DatasDe(c.dia, "")); !reflect.DeepEqual(got, c.quer) {
			t.Errorf("%s: %v, quer %v", c.dia.Format("2006-01-02"), got, c.quer)
		}
	}
	if d := DatasDe(dia(2026, time.December, 25), "br"); len(d) != 1 || !d[0].Feriado || d[0].Nome != "Natal" {
		t.Errorf("Natal é feriado no BR: %+v", d)
	}
	// Minúsculo e com espaço também é o BR: vale a data que só existe aqui.
	for _, pais := range []string{"br", " BR "} {
		if d := DatasDe(dia(2026, time.November, 15), pais); len(d) != 1 || d[0].ID != "proclamacao_da_republica" || !d[0].Feriado {
			t.Errorf("país %q deveria ser o BR: %+v", pais, d)
		}
	}
}

func TestOutroPaisSoAsUniversais(t *testing.T) {
	if got := ids(DatasDe(dia(2026, time.September, 7), "PT")); len(got) != 0 {
		t.Errorf("Independência do Brasil fora do BR: %v", got)
	}
	if got := DatasDe(dia(2026, time.October, 31), "US"); len(got) != 1 || got[0].ID != "halloween" || got[0].Feriado {
		t.Errorf("Halloween nos EUA: %+v", got)
	}
	if got := ids(DatasDe(dia(2026, time.February, 16), "US")); len(got) != 0 {
		t.Errorf("Carnaval é só do BR: %v", got)
	}
	// Fora do BR, só Ano Novo e Natal são feriado.
	for _, c := range []struct {
		dia     time.Time
		feriado bool
	}{{dia(2027, time.January, 1), true}, {dia(2026, time.December, 25), true}, {dia(2026, time.April, 5), false}, {dia(2026, time.December, 31), false}} {
		if d := DatasDe(c.dia, "PT"); len(d) != 1 || d[0].Feriado != c.feriado {
			t.Errorf("%s em PT: %+v, feriado deveria ser %v", c.dia.Format("2006-01-02"), d, c.feriado)
		}
	}
}
