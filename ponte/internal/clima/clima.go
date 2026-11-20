// Package clima busca o tempo de agora no Open-Meteo e o traduz para o contrato v1, com
// as datas do dia (pacote calendario).
//
// Privacidade: é a única saída de rede da ponte. Só sai com uma cidade configurada e
// com consentimento (clima.json), e leva só a latitude e a longitude (arredondadas a
// 2 casas, cerca de 1 km) e o fuso. A geocodificação do setup leva o nome da cidade,
// uma vez, quando o usuário pede.
package clima

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// URLPrevisao é a API de previsão do Open-Meteo (sem chave).
const URLPrevisao = "https://api.open-meteo.com/v1/forecast"

// Limiares do vento, pelas rajadas (ou pelo vento médio, se for maior), em km/h.
const (
	LimiarVentania = 75.0
	LimiarFuracao  = 118.0
)

// Clima é o tempo de agora no contrato v1. As horas vão no fuso da cidade.
type Clima struct {
	Cidade       string    `json:"cidade"`
	Ceu          string    `json:"ceu"`   // limpo, nublado, garoa, chuva, tempestade, neblina, neve ou granizo
	Vento        string    `json:"vento"` // calmo, ventania ou furacao
	Codigo       int       `json:"codigo"`
	Temperatura  float64   `json:"temperatura"`  // °C
	VentoKmh     float64   `json:"vento_kmh"`    // vento médio a 10 m
	RajadaKmh    float64   `json:"rajada_kmh"`   // rajadas a 10 m
	Precipitacao float64   `json:"precipitacao"` // mm na última hora
	Dia          bool      `json:"dia"`
	Nascer       time.Time `json:"nascer"`
	Por          time.Time `json:"por"`
	MedidoEm     time.Time `json:"medido_em"`
}

// Ceu traduz o código WMO do Open-Meteo. Código desconhecido vira nublado.
func Ceu(codigo int) string {
	switch codigo {
	case 0, 1:
		return "limpo"
	case 2, 3:
		return "nublado"
	case 45, 48:
		return "neblina"
	case 51, 53, 55, 56, 57:
		return "garoa"
	case 61, 63, 65, 66, 67, 80, 81, 82:
		return "chuva"
	case 71, 73, 75, 77, 85, 86:
		return "neve"
	case 95:
		return "tempestade"
	case 96, 99:
		return "granizo" // tempestade com granizo
	}
	return "nublado"
}

// Vento dá a intensidade pela rajada (ou pelo vento médio, se for maior).
func Vento(ventoKmh, rajadaKmh float64) string {
	v := math.Max(ventoKmh, rajadaKmh)
	switch {
	case v >= LimiarFuracao:
		return "furacao"
	case v >= LimiarVentania:
		return "ventania"
	}
	return "calmo"
}

// resposta é o pedaço da resposta do Open-Meteo que a ponte usa. As horas vêm sem fuso
// (no fuso pedido), e utc_offset_seconds diz qual é.
type resposta struct {
	Offset  *int `json:"utc_offset_seconds"`
	Current *struct {
		Time          string   `json:"time"`
		WeatherCode   *int     `json:"weather_code"`
		Temperature   *float64 `json:"temperature_2m"`
		WindSpeed     float64  `json:"wind_speed_10m"`
		WindGusts     float64  `json:"wind_gusts_10m"`
		Precipitation float64  `json:"precipitation"`
		IsDay         int      `json:"is_day"`
	} `json:"current"`
	Daily struct {
		Sunrise []string `json:"sunrise"`
		Sunset  []string `json:"sunset"`
	} `json:"daily"`
}

// ErroHTTP é a resposta fora de 2xx.
type ErroHTTP struct{ Status int }

func (e ErroHTTP) Error() string { return "open-meteo respondeu " + strconv.Itoa(e.Status) }

// Buscar pede o tempo de agora em base (URLPrevisao; os testes trocam). maxCorpo
// limita a resposta.
func Buscar(ctx context.Context, cliente *http.Client, base string, cfg Config) (*Clima, error) {
	q := url.Values{}
	q.Set("latitude", strconv.FormatFloat(arredondar(cfg.Lat), 'f', -1, 64))
	q.Set("longitude", strconv.FormatFloat(arredondar(cfg.Lon), 'f', -1, 64))
	q.Set("current", "weather_code,temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,is_day")
	q.Set("daily", "sunrise,sunset")
	q.Set("forecast_days", "1")
	fuso := cfg.Fuso
	if fuso == "" {
		fuso = "auto"
	}
	q.Set("timezone", fuso)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := cliente.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, ErroHTTP{resp.StatusCode}
	}
	dados, err := io.ReadAll(io.LimitReader(resp.Body, maxCorpo))
	if err != nil {
		return nil, err
	}
	return Traduzir(dados, cfg.Cidade)
}

const maxCorpo = 64 << 10

// Traduzir converte a resposta do Open-Meteo no Clima do contrato.
func Traduzir(dados []byte, cidade string) (*Clima, error) {
	var r resposta
	if err := json.Unmarshal(dados, &r); err != nil {
		return nil, fmt.Errorf("resposta do open-meteo ilegível: %w", err)
	}
	c := r.Current
	if c == nil || c.WeatherCode == nil || c.Temperature == nil || r.Offset == nil {
		return nil, errors.New("resposta do open-meteo sem o tempo de agora")
	}
	fuso := time.FixedZone("", *r.Offset)
	medido, err := time.ParseInLocation("2006-01-02T15:04", c.Time, fuso)
	if err != nil {
		return nil, fmt.Errorf("hora do open-meteo ilegível: %w", err)
	}
	cl := &Clima{
		Cidade: cidade, Ceu: Ceu(*c.WeatherCode), Vento: Vento(c.WindSpeed, c.WindGusts),
		Codigo: *c.WeatherCode, Temperatura: *c.Temperature, VentoKmh: c.WindSpeed, RajadaKmh: c.WindGusts,
		Precipitacao: c.Precipitation, Dia: c.IsDay == 1, MedidoEm: medido,
	}
	if len(r.Daily.Sunrise) > 0 {
		cl.Nascer, _ = time.ParseInLocation("2006-01-02T15:04", r.Daily.Sunrise[0], fuso)
	}
	if len(r.Daily.Sunset) > 0 {
		cl.Por, _ = time.ParseInLocation("2006-01-02T15:04", r.Daily.Sunset[0], fuso)
	}
	return cl, nil
}

// arredondar deixa a coordenada com 2 casas (cerca de 1 km): basta para o tempo.
func arredondar(x float64) float64 { return math.Round(x*100) / 100 }

// URLGeocodificacao é a busca de cidades do Open-Meteo (sem chave).
const URLGeocodificacao = "https://geocoding-api.open-meteo.com/v1/search"

// Lugar é um resultado da geocodificação.
type Lugar struct {
	Nome   string  `json:"name"`
	Estado string  `json:"admin1"`
	Pais   string  `json:"country"`
	Codigo string  `json:"country_code"`
	Lat    float64 `json:"latitude"`
	Lon    float64 `json:"longitude"`
	Fuso   string  `json:"timezone"`
}

// Rotulo é o lugar por extenso: "Belo Horizonte, Minas Gerais, Brasil".
func (l Lugar) Rotulo() string {
	partes := []string{}
	for _, p := range []string{l.Nome, l.Estado, l.Pais} {
		if p != "" {
			partes = append(partes, p)
		}
	}
	return strings.Join(partes, ", ")
}

// Geocodificar procura a cidade pelo nome (até 5 resultados), em base
// (URLGeocodificacao; os testes trocam).
func Geocodificar(ctx context.Context, cliente *http.Client, base, nome string) ([]Lugar, error) {
	q := url.Values{}
	q.Set("name", nome)
	q.Set("count", "5")
	q.Set("language", "pt")
	q.Set("format", "json")
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, base+"?"+q.Encode(), nil)
	if err != nil {
		return nil, err
	}
	resp, err := cliente.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return nil, ErroHTTP{resp.StatusCode}
	}
	var r struct {
		Results []Lugar `json:"results"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxCorpo)).Decode(&r); err != nil {
		return nil, fmt.Errorf("resposta da geocodificação ilegível: %w", err)
	}
	return r.Results, nil
}
