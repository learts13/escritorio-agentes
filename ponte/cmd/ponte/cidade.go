package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"firmopolis/ponte/internal/clima"
	"firmopolis/ponte/internal/servidor"
)

// urlGeocodificacao e dirConfigCidade são trocados nos testes.
var (
	urlGeocodificacao = clima.URLGeocodificacao
	dirConfigCidade   = servidor.DirConfig
)

const avisoClima = `Clima: com a cidade gravada, a ponte consulta o Open-Meteo (open-meteo.com) a cada
15 min e manda só a latitude e a longitude (com 2 casas, cerca de 1 km) e o fuso.
Nenhum dado dos terminais sai da máquina. Para desligar: ponte setup --sem-cidade --aplicar`

// setupCidade é o `ponte setup --cidade` e o `--sem-cidade`: só mexe no clima.json da
// pasta da ponte. Com --aplicar, a cidade gravada vale como o consentimento.
func setupCidade(nome string, escolha int, pais string, aplicar bool, saida io.Writer) error {
	dir, err := dirConfigCidade()
	if err != nil {
		return err
	}
	if nome == "" { // --sem-cidade
		atual, _ := clima.LerConfig(dir)
		switch {
		case !atual.Ligado() && atual.Cidade == "":
			fmt.Fprintln(saida, "Clima: já está desligado (sem cidade).")
		case !aplicar:
			fmt.Fprintf(saida, "Clima: tiraria a cidade %q (%s); o clima passaria a null.\nNada foi alterado.\n", atual.Cidade, dir)
		default:
			if err := clima.ApagarConfig(dir); err != nil {
				return err
			}
			fmt.Fprintf(saida, "Clima: tirei a cidade %q. Reinicie a ponte.\n", atual.Cidade)
		}
		return nil
	}

	fmt.Fprintln(saida, avisoClima)
	fmt.Fprintf(saida, "\nProcurando %q no Open-Meteo (só o nome sai da máquina)...\n", nome)
	ctx, cancelar := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelar()
	lugares, err := clima.Geocodificar(ctx, &http.Client{}, urlGeocodificacao, nome)
	if err != nil {
		return fmt.Errorf("não deu para procurar a cidade: %w", err)
	}
	if len(lugares) == 0 {
		return fmt.Errorf("nenhuma cidade com o nome %q", nome)
	}
	for i, l := range lugares {
		fmt.Fprintf(saida, "  %d. %s (%.2f, %.2f; %s)\n", i+1, l.Rotulo(), l.Lat, l.Lon, l.Fuso)
	}
	if escolha == 0 && len(lugares) == 1 {
		escolha = 1
	}
	if escolha < 1 || escolha > len(lugares) {
		msg := "achei mais de uma: diga qual com --escolha N (1 a " + strconv.Itoa(len(lugares)) + ")"
		if escolha != 0 {
			msg = "a --escolha vai de 1 a " + strconv.Itoa(len(lugares))
		}
		if !aplicar && escolha == 0 {
			fmt.Fprintln(saida, "\nAchei mais de uma: no --aplicar, diga qual com --escolha N.\nNada foi alterado.")
			return nil
		}
		return errors.New(msg)
	}
	l := lugares[escolha-1]
	if pais == "" {
		pais = l.Codigo
	}
	cfg := clima.Config{Cidade: l.Rotulo(), Lat: l.Lat, Lon: l.Lon, Fuso: l.Fuso, Pais: strings.ToUpper(pais), Consentimento: true}
	verbo := "Gravaria"
	if aplicar {
		verbo = "Gravando"
	}
	fmt.Fprintf(saida, "\n%s em %s: cidade %q, lat %.2f, lon %.2f, fuso %s, país %s\n",
		verbo, clima.ArquivoConfig, cfg.Cidade, cfg.Lat, cfg.Lon, cfg.Fuso, cfg.Pais)
	if !aplicar {
		fmt.Fprintln(saida, "Nada foi alterado. Para gravar: ponte setup --aplicar --cidade ... (com a mesma --escolha)")
		return nil
	}
	if err := clima.GravarConfig(dir, cfg); err != nil {
		return err
	}
	fmt.Fprintln(saida, "Pronto. Reinicie a ponte para o clima começar.")
	return nil
}
