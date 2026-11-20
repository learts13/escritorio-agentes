package clima

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"firmopolis/ponte/internal/calendario"
)

// cidadeTeste é uma cidade de fixture (as coordenadas não arredondadas testam o
// arredondamento antes de sair da máquina).
var cidadeTeste = Config{Cidade: "São Paulo", Lat: -23.5475, Lon: -46.63611, Fuso: "America/Sao_Paulo", Pais: "BR", Consentimento: true}

func previsao(codigo int, vento, rajada float64) string {
	return fmt.Sprintf(`{"utc_offset_seconds":-10800,"current":{"time":"2026-11-16T14:15","weather_code":%d,"temperature_2m":24.3,"wind_speed_10m":%g,"wind_gusts_10m":%g,"precipitation":0,"is_day":1},"daily":{"sunrise":["2026-11-16T05:12"],"sunset":["2026-11-16T18:31"]}}`, codigo, vento, rajada)
}

func TestCeuDeCadaCodigoWMO(t *testing.T) {
	// Tabela WMO do Open-Meteo (weather_code), código a código.
	quer := map[int]string{
		0: "limpo", 1: "limpo", 2: "nublado", 3: "nublado", 45: "neblina", 48: "neblina",
		51: "garoa", 53: "garoa", 55: "garoa", 56: "garoa", 57: "garoa",
		61: "chuva", 63: "chuva", 65: "chuva", 66: "chuva", 67: "chuva", 80: "chuva", 81: "chuva", 82: "chuva",
		71: "neve", 73: "neve", 75: "neve", 77: "neve", 85: "neve", 86: "neve",
		95: "tempestade", 96: "granizo", 99: "granizo",
		42: "nublado", // fora da tabela
	}
	for codigo, ceu := range quer {
		c, err := Traduzir([]byte(previsao(codigo, 5, 10)), "x")
		if err != nil {
			t.Fatalf("código %d: %v", codigo, err)
		}
		if c.Ceu != ceu || c.Codigo != codigo {
			t.Errorf("código %d: céu %q, quer %q", codigo, c.Ceu, ceu)
		}
	}
}

func TestVentoPelasRajadas(t *testing.T) {
	casos := []struct {
		vento, rajada float64
		quer          string
	}{
		{10, 20, "calmo"}, {30, 74.9, "calmo"}, {30, 75, "ventania"}, {40, 117.9, "ventania"},
		{50, 118, "furacao"}, {80, 10, "ventania"}, {0, 160, "furacao"},
	}
	for _, c := range casos {
		cl, err := Traduzir([]byte(previsao(3, c.vento, c.rajada)), "x")
		if err != nil {
			t.Fatal(err)
		}
		if cl.Vento != c.quer || cl.RajadaKmh != c.rajada || cl.VentoKmh != c.vento {
			t.Errorf("vento %g, rajada %g: %+v, quer %q", c.vento, c.rajada, cl, c.quer)
		}
	}
}

func TestTraduzirRespostaReal(t *testing.T) {
	dados, err := os.ReadFile("testdata/previsao.json")
	if err != nil {
		t.Fatal(err)
	}
	c, err := Traduzir(dados, "São Paulo")
	if err != nil {
		t.Fatal(err)
	}
	brt := time.FixedZone("", -3*3600)
	quer := Clima{Cidade: "São Paulo", Ceu: "chuva", Vento: "calmo", Codigo: 81, Temperatura: 24.3, VentoKmh: 12.6,
		RajadaKmh: 38.5, Precipitacao: 2.4, Dia: true,
		Nascer: time.Date(2026, 11, 16, 5, 12, 0, 0, brt), Por: time.Date(2026, 11, 16, 18, 31, 0, 0, brt),
		MedidoEm: time.Date(2026, 11, 16, 14, 15, 0, 0, brt)}
	if c.Nascer.Format(time.RFC3339) != "2026-11-16T05:12:00-03:00" || !c.Por.Equal(quer.Por) || !c.MedidoEm.Equal(quer.MedidoEm) || !c.Nascer.Equal(quer.Nascer) {
		t.Fatalf("horas: %+v", c)
	}
	c.Nascer, c.Por, c.MedidoEm = quer.Nascer, quer.Por, quer.MedidoEm
	if *c != quer {
		t.Fatalf("clima:\n got %+v\nwant %+v", *c, quer)
	}
}

func TestRespostaIncompletaEErro(t *testing.T) {
	for _, corpo := range []string{`{}`, `não é json`, `{"utc_offset_seconds":0,"current":{"time":"2026-11-16T14:15"}}`,
		`{"utc_offset_seconds":0,"current":{"time":"ontem","weather_code":0,"temperature_2m":1}}`,
		`{"utc_offset_seconds":0,"current":{"time":"2026-11-16T14:15","weather_code":0}}`, // sem temperatura
		`{"current":{"time":"2026-11-16T14:15","weather_code":0,"temperature_2m":1}}`} {   // sem fuso
		if _, err := Traduzir([]byte(corpo), "x"); err == nil {
			t.Errorf("%s: esperava erro", corpo)
		}
	}
}

// servidorOM é um Open-Meteo de mentira: responde status e corpo, e guarda as consultas.
type servidorOM struct {
	*httptest.Server
	mu        sync.Mutex
	status    int
	corpo     string
	consultas []string
}

func novoServidorOM(t *testing.T) *servidorOM {
	s := &servidorOM{status: 200, corpo: previsao(0, 5, 10)}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.consultas = append(s.consultas, r.URL.RawQuery)
		w.WriteHeader(s.status)
		fmt.Fprint(w, s.corpo)
	}))
	t.Cleanup(s.Close)
	return s
}

func (s *servidorOM) responder(status int, corpo string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.status, s.corpo = status, corpo
}

func (s *servidorOM) total() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.consultas)
}

// pastaTemp é o t.TempDir() de quem grava arquivo. Logo depois da gravação, o antivírus
// ainda segura o arquivo por alguns ms, e a limpeza do TempDir falha com "The directory
// is not empty" (cerca de 1 em 300; ver o README). Aqui ela tenta de novo por até 2 s.
func pastaTemp(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "ponte-teste-clima-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		var err error
		for fim := time.Now().Add(2 * time.Second); ; time.Sleep(20 * time.Millisecond) {
			if err = os.RemoveAll(dir); err == nil || time.Now().After(fim) {
				break
			}
		}
		if err != nil {
			t.Errorf("não deu para apagar %s: %v", dir, err)
		}
	})
	return dir
}

// relogio é um time.Now que o teste avança.
type relogio struct{ t time.Time }

func (r *relogio) agora() time.Time      { return r.t }
func (r *relogio) andar(d time.Duration) { r.t = r.t.Add(d) }

func fonteDeTeste(cfg Config, dir string, s *servidorOM, r *relogio) *Fonte {
	f := NovaFonte(cfg, dir)
	f.base, f.agora = s.URL, r.agora
	return f
}

func TestBuscarSoMandaCoordenadas(t *testing.T) {
	s := novoServidorOM(t)
	if _, err := Buscar(context.Background(), s.Client(), s.URL, cidadeTeste); err != nil {
		t.Fatal(err)
	}
	q := s.consultas[0]
	if strings.Contains(q, "S%C3%A3o") || strings.Contains(q, "cidade") {
		t.Fatalf("o nome da cidade não sai da máquina: %s", q)
	}
	var chaves []string
	for _, par := range strings.Split(q, "&") {
		chaves = append(chaves, strings.SplitN(par, "=", 2)[0])
	}
	sort.Strings(chaves)
	if strings.Join(chaves, ",") != "current,daily,forecast_days,latitude,longitude,timezone" {
		t.Fatalf("parâmetros: %v", chaves)
	}
	if !strings.Contains(q, "latitude=-23.55") || !strings.Contains(q, "longitude=-46.64") {
		t.Fatalf("coordenadas com 2 casas: %s", q)
	}
	for _, campo := range []string{"weather_code", "temperature_2m", "wind_speed_10m", "wind_gusts_10m", "precipitation", "is_day"} {
		if !strings.Contains(q, campo) {
			t.Errorf("falta %s em current: %s", campo, q)
		}
	}
	if !strings.Contains(q, "sunrise%2Csunset") {
		t.Errorf("falta o nascer e o pôr do sol: %s", q)
	}
}

func TestSemCidadeOuSemConsentimentoNadaSai(t *testing.T) {
	s := novoServidorOM(t)
	r := &relogio{time.Date(2026, 12, 25, 10, 0, 0, 0, time.Local)}
	semConsentimento := cidadeTeste
	semConsentimento.Consentimento = false
	for _, cfg := range []Config{{}, semConsentimento, {Cidade: "x", Consentimento: true}} {
		e := fonteDeTeste(cfg, pastaTemp(t), s, r).Passo(context.Background())
		if e.Clima != nil {
			t.Errorf("%+v: clima deveria ser nil", cfg)
		}
		if len(e.DatasHoje) != 1 || e.DatasHoje[0].ID != "natal" {
			t.Errorf("%+v: as datas não dependem do clima: %+v", cfg, e.DatasHoje)
		}
	}
	if s.total() != 0 {
		t.Fatalf("sem cidade com consentimento, nenhuma consulta: %v", s.consultas)
	}
}

func TestErro5xxBackoffEValidade(t *testing.T) {
	s := novoServidorOM(t)
	r := &relogio{time.Date(2026, 11, 16, 14, 0, 0, 0, time.Local)}
	f := fonteDeTeste(cidadeTeste, "", s, r)
	ctx := context.Background()

	if e := f.Passo(ctx); e.Clima == nil || e.Clima.Ceu != "limpo" {
		t.Fatalf("1ª busca: %+v", e.Clima)
	}
	r.andar(14 * time.Minute)
	f.Passo(ctx)
	if s.total() != 1 {
		t.Fatalf("antes de 15 min não busca de novo: %d", s.total())
	}

	// 5xx: mantém o último bom e tenta de novo em 1, 2, 4... min, até 15.
	s.responder(503, "indisponível")
	r.andar(time.Minute)
	esperas := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 8 * time.Minute, 15 * time.Minute, 15 * time.Minute}
	for i, espera := range esperas {
		antes := s.total()
		if e := f.Passo(ctx); e.Clima == nil {
			t.Fatalf("falha %d: o último bom ainda vale", i+1)
		}
		if s.total() != antes+1 {
			t.Fatalf("falha %d: esperava uma consulta", i+1)
		}
		r.andar(espera - time.Second)
		f.Passo(ctx)
		if s.total() != antes+1 {
			t.Fatalf("falha %d: tentou antes de %v", i+1, espera)
		}
		r.andar(time.Second)
	}
	// Recebido às 14:00; passou da validade (2 h): vira null.
	r.t = time.Date(2026, 11, 16, 16, 0, 1, 0, time.Local)
	if e := f.Passo(ctx); e.Clima != nil {
		t.Fatalf("clima vencido deveria ser nil: %+v", e.Clima)
	}

	// A rede volta: clima novo, e a espera volta a ser de 15 min.
	s.responder(200, previsao(95, 40, 130))
	r.andar(15 * time.Minute)
	if e := f.Passo(ctx); e.Clima == nil || e.Clima.Ceu != "tempestade" || e.Clima.Vento != "furacao" {
		t.Fatalf("depois da volta: %+v", e.Clima)
	}
}

func TestSemRede(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	fechada := "http://" + ln.Addr().String()
	ln.Close()
	r := &relogio{time.Date(2026, 11, 16, 14, 0, 0, 0, time.Local)}
	f := NovaFonte(cidadeTeste, "")
	f.base, f.agora = fechada, r.agora
	e := f.Passo(context.Background())
	if e.Clima != nil || e.DatasHoje == nil {
		t.Fatalf("sem rede: clima nil e datas presentes: %+v", e)
	}
	if f.falhas != 1 || !f.proxima.Equal(r.t.Add(PrimeiraEspera)) {
		t.Fatalf("sem rede conta como falha: %d, %v", f.falhas, f.proxima)
	}
}

func TestCacheEntreReinicios(t *testing.T) {
	s := novoServidorOM(t)
	dir := pastaTemp(t)
	// O cache é lido com a hora real (o recebido no futuro não vale): o relógio parte dela.
	r := &relogio{time.Now().Add(-10 * time.Minute)}
	fonteDeTeste(cidadeTeste, dir, s, r).Passo(context.Background())

	// Reiniciada 5 min depois: o cache vale, e a próxima busca só vem aos 15 min.
	r.andar(5 * time.Minute)
	s.responder(500, "")
	f := fonteDeTeste(cidadeTeste, dir, s, r)
	if e := f.Passo(context.Background()); e.Clima == nil || e.Clima.Ceu != "limpo" || s.total() != 1 {
		t.Fatalf("cache: %+v, %d consultas", e.Clima, s.total())
	}

	// Outra cidade não usa o cache da anterior.
	outra := cidadeTeste
	outra.Cidade, outra.Lat = "Outra", -10
	if e := fonteDeTeste(outra, dir, s, r).Passo(context.Background()); e.Clima != nil {
		t.Fatalf("cache de outra cidade: %+v", e.Clima)
	}

	// ApagarConfig leva o cache junto.
	if err := GravarConfig(dir, cidadeTeste); err != nil {
		t.Fatal(err)
	}
	if err := ApagarConfig(dir); err != nil {
		t.Fatal(err)
	}
	if c, err := LerConfig(dir); err != nil || c.Ligado() {
		t.Fatalf("config apagada: %+v %v", c, err)
	}
	if _, err := os.Stat(dir + "/" + ArquivoCache); !os.IsNotExist(err) {
		t.Fatalf("o cache deveria sumir: %v", err)
	}
}

func TestConfigArredondaCoordenadas(t *testing.T) {
	dir := pastaTemp(t)
	if err := GravarConfig(dir, cidadeTeste); err != nil {
		t.Fatal(err)
	}
	c, err := LerConfig(dir)
	if err != nil || c.Lat != -23.55 || c.Lon != -46.64 || !c.Ligado() || c.Fuso != "America/Sao_Paulo" {
		t.Fatalf("config: %+v %v", c, err)
	}
}

func TestRodarAvisaNaLargada(t *testing.T) {
	ctx, cancelar := context.WithCancel(context.Background())
	var estados []Estado
	f := NovaFonte(Config{}, "")
	f.agora = func() time.Time { return time.Date(2026, 10, 31, 9, 0, 0, 0, time.Local) }
	f.Rodar(ctx, func(e Estado) { estados = append(estados, e); cancelar() })
	if len(estados) != 1 || estados[0].Clima != nil || len(estados[0].DatasHoje) != 1 || estados[0].DatasHoje[0].ID != "halloween" {
		t.Fatalf("estados: %+v", estados)
	}
}

func TestGeocodificar(t *testing.T) {
	dados, err := os.ReadFile("testdata/geocodificacao.json")
	if err != nil {
		t.Fatal(err)
	}
	var consulta string
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		consulta = r.URL.RawQuery
		w.Write(dados)
	}))
	defer s.Close()
	lugares, err := Geocodificar(context.Background(), s.Client(), s.URL, "São Paulo")
	if err != nil {
		t.Fatal(err)
	}
	if len(lugares) != 2 || lugares[0].Rotulo() != "São Paulo, São Paulo, Brasil" || lugares[0].Codigo != "BR" ||
		lugares[0].Fuso != "America/Sao_Paulo" || lugares[0].Lat != -23.5475 {
		t.Fatalf("lugares: %+v", lugares)
	}
	if !strings.Contains(consulta, "name=S%C3%A3o+Paulo") || !strings.Contains(consulta, "language=pt") {
		t.Fatalf("consulta: %s", consulta)
	}

	s5 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(502) }))
	defer s5.Close()
	if _, err := Geocodificar(context.Background(), s5.Client(), s5.URL, "x"); err == nil {
		t.Fatal("5xx na geocodificação deveria ser erro")
	}
}

// TestBackoffNaoEstouraEmHorasDeErro: 24 h seguidas de 503. A espera dobra até 15 min
// e fica nisso; com o deslocamento de bits, a partir da 29ª falha ela estourava e a
// ponte tentava a cada minuto (953 consultas num dia).
func TestBackoffNaoEstouraEmHorasDeErro(t *testing.T) {
	s := novoServidorOM(t)
	s.responder(503, "indisponível")
	inicio := time.Date(2026, 11, 16, 0, 0, 0, 0, time.Local)
	r := &relogio{inicio}
	f := fonteDeTeste(cidadeTeste, "", s, r)
	for r.t.Before(inicio.Add(24 * time.Hour)) {
		f.Passo(context.Background())
		espera := f.proxima.Sub(r.t)
		quer := Intervalo
		if f.falhas <= 4 {
			quer = PrimeiraEspera << (f.falhas - 1)
		}
		if espera != quer {
			t.Fatalf("falha %d: espera %v, quer %v", f.falhas, espera, quer)
		}
		r.t = f.proxima
	}
	if f.falhas < 30 || s.total() > 24*4+5 {
		t.Fatalf("24 h de 503: %d falhas, %d consultas (no máximo umas 100)", f.falhas, s.total())
	}
}

// TestSucessoZeraAsFalhas: depois de voltar, a próxima falha recomeça em 1 min.
func TestSucessoZeraAsFalhas(t *testing.T) {
	s := novoServidorOM(t)
	s.responder(503, "indisponível")
	r := &relogio{time.Date(2026, 11, 16, 14, 0, 0, 0, time.Local)}
	f := fonteDeTeste(cidadeTeste, "", s, r)
	ctx := context.Background()
	for range 6 {
		f.Passo(ctx)
		r.t = f.proxima
	}
	s.responder(200, previsao(0, 5, 10))
	if e := f.Passo(ctx); e.Clima == nil || f.falhas != 0 || f.proxima.Sub(r.t) != Intervalo {
		t.Fatalf("a volta: clima %+v, %d falhas, espera %v", e.Clima, f.falhas, f.proxima.Sub(r.t))
	}
	r.t = f.proxima
	s.responder(503, "indisponível")
	f.Passo(ctx)
	if espera := f.proxima.Sub(r.t); espera != PrimeiraEspera {
		t.Fatalf("a 1ª falha depois da volta espera %v, quer %v", espera, PrimeiraEspera)
	}
}

func TestBuscarRecusa5xxComJSONEOCorpoGigante(t *testing.T) {
	s := novoServidorOM(t)
	s.responder(503, previsao(0, 5, 10)) // corpo legível, status de erro
	if _, err := Buscar(context.Background(), s.Client(), s.URL, cidadeTeste); !errors.As(err, new(ErroHTTP)) {
		t.Fatalf("5xx com JSON válido deveria ser ErroHTTP: %v", err)
	}
	// Uma previsão válida de verdade, mas com mais que maxCorpo: o corte a torna ilegível.
	gigante := strings.TrimSuffix(previsao(0, 5, 10), "}") + `,"extra":"` + strings.Repeat("a", 2*maxCorpo) + `"}`
	if _, err := Traduzir([]byte(gigante), "x"); err != nil {
		t.Fatalf("a resposta gigante é válida inteira: %v", err)
	}
	s.responder(200, gigante)
	if _, err := Buscar(context.Background(), s.Client(), s.URL, cidadeTeste); err == nil {
		t.Fatal("resposta acima de maxCorpo deveria ser cortada (e recusada)")
	}
}

func TestBuscarSemFusoPedeAuto(t *testing.T) {
	s := novoServidorOM(t)
	semFuso := cidadeTeste
	semFuso.Fuso = ""
	for _, c := range []struct {
		cfg  Config
		quer string
	}{{semFuso, "timezone=auto"}, {cidadeTeste, "timezone=America%2FSao_Paulo"}} {
		if _, err := Buscar(context.Background(), s.Client(), s.URL, c.cfg); err != nil {
			t.Fatal(err)
		}
		if q := s.consultas[len(s.consultas)-1]; !strings.Contains(q, c.quer) {
			t.Errorf("fuso %q: %s, quer %s", c.cfg.Fuso, q, c.quer)
		}
	}
}

func TestCacheDoFuturoNaoVale(t *testing.T) {
	dir := pastaTemp(t)
	gravar := func(recebido time.Time) {
		c := cache{Cidade: cidadeTeste.Cidade, Lat: arredondar(cidadeTeste.Lat), Lon: arredondar(cidadeTeste.Lon),
			Recebido: recebido, Clima: &Clima{Cidade: cidadeTeste.Cidade, Ceu: "limpo"}}
		if err := gravarJSON(dir, ArquivoCache, c); err != nil {
			t.Fatal(err)
		}
	}
	gravar(time.Now().Add(time.Hour))
	if f := NovaFonte(cidadeTeste, dir); f.ultimo != nil || !f.proxima.IsZero() {
		t.Fatalf("cache recebido no futuro não vale: %+v, próxima %v", f.ultimo, f.proxima)
	}
	gravar(time.Now().Add(-time.Minute))
	if f := NovaFonte(cidadeTeste, dir); f.ultimo == nil {
		t.Fatal("cache de 1 min atrás vale")
	}
}

// TestDiaViraNoFusoDaCidade: 23:30 UTC de 24/12 ainda é véspera em São Paulo e já é
// Natal em Tóquio. Sem cidade (ou com fuso desconhecido), vale o fuso do PC.
func TestDiaViraNoFusoDaCidade(t *testing.T) {
	s := novoServidorOM(t)
	r := &relogio{time.Date(2026, 12, 24, 23, 30, 0, 0, time.UTC)}
	toquio := cidadeTeste
	toquio.Cidade, toquio.Fuso, toquio.Pais = "Tóquio", "Asia/Tokyo", "JP"
	ruim := cidadeTeste
	ruim.Fuso = "Fuso/Inexistente"
	doPC := calendario.DatasDe(r.t.In(time.Local), "BR")
	for _, c := range []struct {
		nome string
		cfg  Config
		quer []calendario.Data
	}{
		{"Tóquio", toquio, calendario.DatasDe(time.Date(2026, 12, 25, 12, 0, 0, 0, time.UTC), "JP")},
		{"São Paulo", cidadeTeste, calendario.DatasDe(time.Date(2026, 12, 24, 12, 0, 0, 0, time.UTC), "BR")},
		{"fuso desconhecido", ruim, doPC},
		{"sem cidade", Config{}, doPC},
	} {
		if e := fonteDeTeste(c.cfg, "", s, r).Passo(context.Background()); !reflect.DeepEqual(e.DatasHoje, c.quer) {
			t.Errorf("%s: %+v, quer %+v", c.nome, e.DatasHoje, c.quer)
		}
	}
}

// TestRodarSoAvisaQuandoMuda: o Rodar confere a cada passo, mas só avisa o jogo quando o
// estado muda (aqui, na virada do dia), não a cada minuto.
func TestRodarSoAvisaQuandoMuda(t *testing.T) {
	ctx, cancelar := context.WithCancel(context.Background())
	defer cancelar()
	vespera := time.Date(2026, 12, 24, 23, 0, 0, 0, time.Local)
	chamadas := 0
	f := NovaFonte(Config{}, "")
	f.passo = time.Millisecond
	f.agora = func() time.Time {
		chamadas++
		if chamadas >= 40 {
			cancelar()
		}
		if chamadas > 20 {
			return vespera.Add(2 * time.Hour)
		}
		return vespera
	}
	var avisos []string
	f.Rodar(ctx, func(e Estado) {
		for _, d := range e.DatasHoje {
			avisos = append(avisos, d.ID)
		}
	})
	if strings.Join(avisos, ",") != "vespera_de_natal,natal" {
		t.Fatalf("em %d passos, os avisos foram %v; quer um na largada e um na virada", chamadas, avisos)
	}
}

// TestRodarMandaAsDatasAntesDaRede: com o Open-Meteo lento, as datas (e o clima do
// cache) saem na largada, sem esperar a 1ª busca.
func TestRodarMandaAsDatasAntesDaRede(t *testing.T) {
	liberar := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		<-liberar
		fmt.Fprint(w, previsao(0, 5, 10))
	}))
	defer s.Close()
	f := NovaFonte(cidadeTeste, "")
	f.base = s.URL
	f.agora = func() time.Time { return time.Date(2026, 12, 25, 13, 0, 0, 0, time.UTC) }
	ctx, cancelar := context.WithCancel(context.Background())
	primeiro := make(chan Estado, 1)
	fim := make(chan struct{})
	go func() {
		defer close(fim)
		f.Rodar(ctx, func(e Estado) {
			select {
			case primeiro <- e:
			default:
			}
		})
	}()
	select {
	case e := <-primeiro:
		if e.Clima != nil || len(e.DatasHoje) != 1 || e.DatasHoje[0].ID != "natal" {
			t.Errorf("largada: %+v", e)
		}
	case <-time.After(3 * time.Second):
		t.Error("as datas esperaram a busca na rede")
	}
	close(liberar)
	cancelar()
	<-fim
}
