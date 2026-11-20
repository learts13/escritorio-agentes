// Package calendario dá as datas festivas e os feriados de um dia, para o jogo decorar
// o prédio. É só conta: nada sai da máquina.
package calendario

import (
	"strings"
	"time"
)

// PaisPadrao é o país quando a config não diz outro.
const PaisPadrao = "BR"

// Data é uma data do dia no contrato v1. ID é estável (o jogo traduz pelo id); Nome é
// o texto em português; Feriado diz se é feriado nacional no país.
type Data struct {
	ID      string `json:"id"`
	Nome    string `json:"nome"`
	Feriado bool   `json:"feriado"`
}

// Pascoa devolve o domingo de Páscoa do ano (calendário gregoriano, algoritmo de
// Meeus/Jones/Butcher).
func Pascoa(ano int) time.Time {
	a := ano % 19
	b, c := ano/100, ano%100
	d, e := b/4, b%4
	f := (b + 8) / 25
	g := (b - f + 1) / 3
	h := (19*a + b - d - g + 15) % 30
	i, k := c/4, c%4
	l := (32 + 2*e + 2*i - h - k) % 7
	m := (a + 11*h + 22*l) / 451
	mes := (h + l - 7*m + 114) / 31
	dia := (h+l-7*m+114)%31 + 1
	return time.Date(ano, time.Month(mes), dia, 0, 0, 0, 0, time.UTC)
}

// regra diz se a data vale no dia (ano, mês, dia e a Páscoa do ano já calculada).
type regra struct {
	data  Data
	vale  func(d, pascoa time.Time) bool
	todos bool // vale em qualquer país (senão, só no BR); nessas, só Ano Novo e Natal são feriado
}

func fixa(mes time.Month, dia int) func(d, _ time.Time) bool {
	return func(d, _ time.Time) bool { return d.Month() == mes && d.Day() == dia }
}

// daPascoa vale de de a ate dias a partir do domingo de Páscoa (inclusive).
func daPascoa(de, ate int) func(d, pascoa time.Time) bool {
	return func(d, pascoa time.Time) bool {
		n := int(d.Sub(pascoa).Hours() / 24)
		return n >= de && n <= ate
	}
}

// regras na ordem em que saem. O Carnaval vai do sábado à terça antes da Quarta-feira
// de Cinzas; a Festa Junina, o mês de junho; o Dia do Programador é o 256º dia do ano.
var regras = []regra{
	{Data{"ano_novo", "Ano Novo", true}, fixa(time.January, 1), true},
	{Data{"carnaval", "Carnaval", false}, daPascoa(-50, -47), false},
	{Data{"sexta_santa", "Sexta-feira Santa", true}, daPascoa(-2, -2), false},
	{Data{"pascoa", "Páscoa", false}, daPascoa(0, 0), true},
	{Data{"tiradentes", "Tiradentes", true}, fixa(time.April, 21), false},
	{Data{"dia_do_trabalho", "Dia do Trabalho", true}, fixa(time.May, 1), false},
	{Data{"corpus_christi", "Corpus Christi", false}, daPascoa(60, 60), false},
	{Data{"festa_junina", "Festa Junina", false}, func(d, _ time.Time) bool { return d.Month() == time.June }, false},
	{Data{"independencia", "Independência do Brasil", true}, fixa(time.September, 7), false},
	{Data{"dia_do_programador", "Dia do Programador", false}, func(d, _ time.Time) bool { return d.YearDay() == 256 }, true},
	{Data{"nossa_senhora_aparecida", "Nossa Senhora Aparecida", true}, fixa(time.October, 12), false},
	{Data{"dia_das_criancas", "Dia das Crianças", false}, fixa(time.October, 12), false},
	{Data{"halloween", "Halloween", false}, fixa(time.October, 31), true},
	{Data{"finados", "Finados", true}, fixa(time.November, 2), false},
	{Data{"proclamacao_da_republica", "Proclamação da República", true}, fixa(time.November, 15), false},
	{Data{"consciencia_negra", "Consciência Negra", true}, fixa(time.November, 20), false},
	{Data{"vespera_de_natal", "Véspera de Natal", false}, fixa(time.December, 24), true},
	{Data{"natal", "Natal", true}, fixa(time.December, 25), true},
	{Data{"reveillon", "Réveillon", false}, fixa(time.December, 31), true},
}

// DatasDe devolve as datas do dia (a data no fuso de dia; a hora não conta) no país.
// Fora do BR, só as datas que valem em todo lugar, e só Ano Novo e Natal como feriado.
// Nunca devolve nil.
func DatasDe(dia time.Time, pais string) []Data {
	pais = strings.ToUpper(strings.TrimSpace(pais))
	if pais == "" {
		pais = PaisPadrao
	}
	d := time.Date(dia.Year(), dia.Month(), dia.Day(), 0, 0, 0, 0, time.UTC)
	pascoa := Pascoa(d.Year())
	datas := []Data{}
	for _, r := range regras {
		if (!r.todos && pais != PaisPadrao) || !r.vale(d, pascoa) {
			continue
		}
		datas = append(datas, r.data)
	}
	return datas
}
