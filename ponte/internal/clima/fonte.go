package clima

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"
	_ "time/tzdata" // o fuso da cidade sem depender do Go instalado na máquina

	"firmopolis/ponte/internal/calendario"
)

const (
	// Intervalo entre as buscas que deram certo.
	Intervalo = 15 * time.Minute
	// PrimeiraEspera é o backoff depois da 1ª falha; dobra a cada falha, até o Intervalo.
	PrimeiraEspera = time.Minute
	// Validade: clima recebido há mais que isso (sem rede, 5xx) vira null.
	Validade = 2 * time.Hour
	// passoRelogio é de quanto em quanto o Rodar confere a hora da busca e o dia.
	passoRelogio = time.Minute
	prazoBusca   = 10 * time.Second
)

// Estado é o que vai ao jogo: o clima de agora (nil sem cidade, sem consentimento ou
// sem um clima válido) e as datas do dia, que não dependem de rede.
type Estado struct {
	Clima     *Clima
	DatasHoje []calendario.Data
}

// Fonte busca o clima no ritmo certo e guarda o último bom em disco. Um só chamador.
type Fonte struct {
	cfg     Config
	dir     string // pasta do cache; "" não grava nem lê
	base    string
	cliente *http.Client
	agora   func() time.Time
	fuso    *time.Location // o "hoje" das datas: o fuso da cidade; sem cidade, o do PC
	passo   time.Duration  // de quanto em quanto o Rodar confere (passoRelogio; os testes trocam)

	ultimo   *Clima
	recebido time.Time // hora local em que o último bom chegou (a validade conta daqui)
	proxima  time.Time
	falhas   int
}

// cache é o clima-cache.json: vale só para a mesma cidade e coordenadas.
type cache struct {
	Cidade   string    `json:"cidade"`
	Lat      float64   `json:"lat"`
	Lon      float64   `json:"lon"`
	Recebido time.Time `json:"recebido"`
	Clima    *Clima    `json:"clima"`
}

// NovaFonte prepara a fonte da config, retomando o cache de dir quando é da mesma
// cidade (a ponte reiniciada não busca de novo antes da hora). Com cidade, o dia vira
// no fuso dela; sem cidade (ou com um fuso desconhecido), no do PC.
func NovaFonte(cfg Config, dir string) *Fonte {
	f := &Fonte{cfg: cfg, dir: dir, base: URLPrevisao, cliente: &http.Client{Timeout: prazoBusca}, agora: time.Now,
		fuso: time.Local, passo: passoRelogio}
	if !cfg.Ligado() {
		return f
	}
	if loc, err := time.LoadLocation(cfg.Fuso); err == nil && cfg.Fuso != "" {
		f.fuso = loc
	}
	if dir == "" {
		return f
	}
	dados, err := os.ReadFile(filepath.Join(dir, ArquivoCache))
	var c cache
	// Recebido no futuro (relógio adiantado quando gravou) valeria para sempre: ignora.
	if err != nil || json.Unmarshal(dados, &c) != nil || c.Clima == nil || c.Recebido.After(f.agora()) ||
		c.Cidade != cfg.Cidade || c.Lat != arredondar(cfg.Lat) || c.Lon != arredondar(cfg.Lon) {
		return f
	}
	f.ultimo, f.recebido, f.proxima = c.Clima, c.Recebido, c.Recebido.Add(Intervalo)
	return f
}

// Passo busca o clima se já é hora e devolve o estado de agora.
func (f *Fonte) Passo(ctx context.Context) Estado {
	agora := f.agora()
	if f.cfg.Ligado() && !agora.Before(f.proxima) {
		ctx, cancelar := context.WithTimeout(ctx, prazoBusca)
		c, err := Buscar(ctx, f.cliente, f.base, f.cfg)
		cancelar()
		if err == nil {
			if f.falhas > 0 {
				log.Printf("clima: voltou depois de %d falha(s)", f.falhas)
			}
			f.ultimo, f.recebido, f.falhas, f.proxima = c, agora, 0, agora.Add(Intervalo)
			f.gravarCache()
		} else {
			f.falhas++
			espera := esperaDepois(f.falhas)
			f.proxima = agora.Add(espera)
			log.Printf("clima: %v (nova tentativa em %v)", err, espera)
		}
	}
	return f.estado(agora)
}

// estado é o de agora sem buscar nada: as datas do dia e o último clima ainda válido.
func (f *Fonte) estado(agora time.Time) Estado {
	e := Estado{DatasHoje: calendario.DatasDe(agora.In(f.fuso), f.cfg.Pais)}
	if f.cfg.Ligado() && f.ultimo != nil && agora.Sub(f.recebido) <= Validade {
		c := *f.ultimo
		e.Clima = &c
	}
	return e
}

// esperaDepois é o backoff depois de n falhas seguidas: PrimeiraEspera, dobrando até o
// Intervalo. Dobra sem deslocar bits: PrimeiraEspera<<(n-1) estoura o int64 a partir da
// 29ª falha (umas 6 h de erro), a espera vira 0 e a ponte tentaria a cada passo.
func esperaDepois(n int) time.Duration {
	espera := PrimeiraEspera
	for i := 1; i < n && espera < Intervalo; i++ {
		espera *= 2
	}
	return min(espera, Intervalo)
}

// Rodar dá o estado já na largada, antes da 1ª busca na rede (as datas e o clima do
// cache), e depois só quando ele muda (clima novo, clima vencido, dia novo), até ctx acabar.
func (f *Fonte) Rodar(ctx context.Context, mudou func(Estado)) {
	var anterior []byte
	avisar := func(e Estado) {
		if atual, err := json.Marshal(e); err == nil && !bytes.Equal(atual, anterior) {
			anterior = atual
			mudou(e)
		}
	}
	avisar(f.estado(f.agora()))
	passo := time.NewTicker(f.passo)
	defer passo.Stop()
	for {
		avisar(f.Passo(ctx))
		select {
		case <-ctx.Done():
			return
		case <-passo.C:
		}
	}
}

func (f *Fonte) gravarCache() {
	if f.dir == "" {
		return
	}
	c := cache{Cidade: f.cfg.Cidade, Lat: arredondar(f.cfg.Lat), Lon: arredondar(f.cfg.Lon), Recebido: f.recebido, Clima: f.ultimo}
	if err := gravarJSON(f.dir, ArquivoCache, c); err != nil {
		log.Printf("clima: não deu para gravar o cache: %v", err)
	}
}
