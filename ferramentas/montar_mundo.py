"""Monta o mundo vivo: static/mundo/terra.png, brasil.png, mundo.json e o atlas da arte do PixelLab.

Entradas (arte/mundo): cidades.json, biomas.json, serras.json, planeta.json e os contornos e rios do Natural Earth em
fontes/ (países 1:110m, as 27 UFs e os rios 1:50m). Aqui os dados viram pixels: preenchimento de polígono por varredura
par-ímpar (pixel marcado pelo centro), a costa alisada e as linhas das serras e dos rios na escala da imagem. O desenho
do brasil.png (o mapa ilustrado) fica em mundo_terreno.py; o do terra.png (o globo, com os biomas do mundo), em
mundo_planeta.py. O mesmo dado gera sempre os mesmos PNG.

Uso: python ferramentas/montar_mundo.py [pasta de entrada] [pasta de saída]
"""
import hashlib
import json
import math
import os
import re
import string
import sys
from collections import Counter, deque

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mundo_planeta  # noqa: E402  (o desenho do globo; sem Pillow)
import mundo_terreno  # noqa: E402  (o desenho do mapa; sem Pillow)

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ENTRADA = os.path.join(RAIZ, "arte", "mundo")
SAIDA = os.path.join(RAIZ, "static", "mundo")

CAIXA_BRASIL = (-74.0, -34.0, -34.0, 6.0)  # (lon_min, lat_min, lon_max, lat_max)
W_BRASIL, H_BRASIL = 400, 400
CAIXA_TERRA = (-180.0, -90.0, 180.0, 90.0)
W_TERRA, H_TERRA = 720, 360  # 0,5° por pixel
PALETA = mundo_planeta.PALETA  # terra.png
NAO_CAPITAIS = {"mateus-leme"}
ROTA_MAX_KM, ROTAS_MAX = 1500, 40
ESTRANGEIRO = mundo_terreno.ESTRANGEIRO  # rótulo da terra de outros países no mapa do Brasil
FRESTA_LONGE_DO_MAR = 4  # pixels: ver desenhar_brasil()
CIDADE_RAIO = 6  # pixels: até onde a cidade da costa pode ser puxada para a terra brasileira
RIOS = "ne_50m_rivers_lake_centerlines.geojson"
# a camada de perto (a partir de 2x): o mesmo mapa no dobro da resolução, em 4x4 azulejos de 200 px pedidos conforme a
# vista, com as rodovias principais e os rios menores do 1:10m
ESCALA_PERTO, AZULEJO = 2, 200
# o terceiro nível (4x): o de 2x dobrado e refinado (mundo_terreno.refinar), em 8x8 azulejos de 200 px, só os que tocam o
# Brasil (os outros, só mar aberto ou vizinho distante, ficam no de 2x ampliado)
ESCALA_4X = 4
CENTRO_SUL = {"DF", "GO", "MT", "MS", "MG", "ES", "RJ", "SP", "PR", "SC", "RS"}   # onde há lavoura a 4x
RIOS_MENORES, ESTRADAS, LUGARES = ("ne_10m_rivers_lake_centerlines.geojson", "ne_10m_roads.geojson",
                                   "ne_10m_populated_places.geojson")
# as cidades médias (3x): as maiores que não são capitais, longe de toda capital (o subúrbio ficaria sob a miniatura) e
# da média maior vizinha; ERRADAS são duplicatas com a UF trocada no Natural Earth
MEDIAS_MAX, MEDIA_LONGE_KM, MEDIA_VIZINHA_KM = 50, 40, 30
ERRADAS = {("Vila Velha", "Amapi"), ("Natal", "Amazonas"), ("Crato", "Amazonas")}
PAISES = {"ARG": "Argentina", "BOL": "Bolívia", "CHL": "Chile", "COL": "Colômbia", "ECU": "Equador", "FRA": "Guiana Francesa",
          "GUY": "Guiana", "PER": "Peru", "PRY": "Paraguai", "SUR": "Suriname", "URY": "Uruguai", "VEN": "Venezuela"}
PAIS_MIOLO = 6   # pixels: o vizinho só ganha nome se tiver um miolo assim longe da beira (e da névoa da borda)


def para_pixel(lat, lon, caixa, w, h):
    """Pixel (x, y) da coordenada na imagem w×h que cobre a caixa; fora da caixa, preso à borda."""
    lon0, lat0, lon1, lat1 = caixa
    x = math.floor((lon - lon0) / (lon1 - lon0) * w)
    y = math.floor((lat1 - lat) / (lat1 - lat0) * h)
    return min(max(x, 0), w - 1), min(max(y, 0), h - 1)


def preencher(poligono, w, h):
    """Pixels (x, y) cujo centro fica dentro do polígono (vértices em pixels), por varredura par-ímpar."""
    return preencher_aneis([poligono], w, h)


def preencher_aneis(aneis, w, h):
    """Como preencher(), mas com vários anéis de uma vez: a regra par-ímpar já abre os buracos."""
    cortes = {}  # linha -> x onde as arestas cruzam o centro da linha
    for anel in aneis:
        for k in range(len(anel)):
            (x1, y1), (x2, y2) = anel[k - 1], anel[k]
            if y1 == y2:
                continue
            if y1 > y2:
                x1, y1, x2, y2 = x2, y2, x1, y1
            # linhas j com y1 <= j + 0.5 < y2 (meio aberto, para o vértice não contar duas vezes)
            for j in range(max(0, math.ceil(y1 - 0.5)), min(h - 1, math.ceil(y2 - 0.5) - 1) + 1):
                cortes.setdefault(j, []).append(x1 + (j + 0.5 - y1) * (x2 - x1) / (y2 - y1))
    feitos = set()
    for j, xs in cortes.items():
        xs.sort()
        for a, b in zip(xs[0::2], xs[1::2]):  # x com a <= x + 0.5 < b
            for i in range(max(0, math.ceil(a - 0.5)), min(w - 1, math.ceil(b - 0.5) - 1) + 1):
                feitos.add((i, j))
    return feitos


def aneis_em_pixels(geometria, caixa, w, h):
    """Todos os anéis (externos e buracos) de um Polygon ou MultiPolygon, em coordenadas de pixel."""
    lon0, lat0, lon1, lat1 = caixa
    sx, sy = w / (lon1 - lon0), h / (lat1 - lat0)
    poligonos = geometria["coordinates"] if geometria["type"] == "MultiPolygon" else [geometria["coordinates"]]
    return [[((lon - lon0) * sx, (lat1 - lat) * sy) for lon, lat in anel] for poligono in poligonos for anel in poligono]


def distancias(dentro, w, h):
    """Para cada pixel de `dentro`, quantos passos (8 vizinhos) até o pixel mais perto fora dele."""
    dist, fila = {}, deque()
    for y in range(h):
        for x in range(w):
            if (x, y) not in dentro:
                dist[(x, y)] = 0
                fila.append((x, y))
    while fila:
        x, y = fila.popleft()
        d = dist[(x, y)] + 1
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in dist:
                    dist[(nx, ny)] = d
                    fila.append((nx, ny))
    return dist


def vizinhos4(x, y):
    return (x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)


def vizinhos8(x, y):
    return [(x + dx, y + dy) for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dx or dy]


def pintar(w, h, cor_de):
    """Imagem em paleta (modo P): cor_de(x, y) devolve um nome da PALETA."""
    from PIL import Image  # só aqui: preencher() e para_pixel() funcionam sem o Pillow
    nomes = list(PALETA)
    im = Image.new("P", (w, h))
    im.putpalette([int(PALETA[n][i:i + 2], 16) for n in nomes for i in (1, 3, 5)])
    im.putdata([nomes.index(cor_de(x, y)) for y in range(h) for x in range(w)])
    return im


def ler(caminho):
    with open(caminho, encoding="utf-8") as f:
        return json.load(f)


def desenhar_terra(paises, fontes, celulas_brasil):
    """O terra.png (mundo_planeta.desenhar): a terra dos países menos os lagos, os biomas do Brasil (biomas.json; o
    altiplano só fora das células do Brasil) e os do planeta.json, passados para os pixels de 0,5°."""
    terra = set()
    for p in paises:
        terra |= preencher_aneis(aneis_em_pixels(p["geometry"], CAIXA_TERRA, W_TERRA, H_TERRA), W_TERRA, H_TERRA)
    sx, sy = W_TERRA / 360, H_TERRA / 180
    em_px = lambda lon, lat: ((lon + 180) * sx, (90 - lat) * sy)
    poligono = lambda pontos: preencher([em_px(*p) for p in pontos], W_TERRA, H_TERRA)
    planeta = ler(os.path.join(fontes, "planeta.json"))
    for lago in planeta["lagos"]:   # os grandes lagos, que os contornos dos países cobrem
        terra -= poligono(lago["poligono"])
    do_brasil = {(int((CAIXA_BRASIL[0] + 180) * sx) + i, int((90 - CAIXA_BRASIL[3]) * sy) + j)
                 for j, linha in enumerate(celulas_brasil) for i, c in enumerate(linha) if c == "1"}
    biomas = ler(os.path.join(fontes, "biomas.json"))
    brasil = [(mundo_planeta.DO_BRASIL["andes"], poligono(biomas["extras"]["andes"]["poligono"]) - do_brasil),
              (mundo_planeta.DO_BRASIL["araucarias"], poligono(biomas["extras"]["araucarias"]["poligono"]))]
    brasil += [(mundo_planeta.DO_BRASIL[b["id"]], poligono(b["poligono"])) for b in biomas["biomas"]]
    mundo = [(b["classe"], poligono(b["poligono"])) for b in planeta["biomas"]]
    serras = [{"tipo": s["tipo"], "largura": s["largura"] * sx, "linha": [em_px(*p) for p in s["linha"]]}
              for s in planeta["serras"]]
    lista = [(x, y) in terra for y in range(H_TERRA) for x in range(W_TERRA)]
    nomes = mundo_planeta.desenhar(lista, brasil, mundo, serras, W_TERRA, H_TERRA)
    return pintar(W_TERRA, H_TERRA, lambda x, y: nomes[y * W_TERRA + x])


def rotular_brasil(paises, estados, w=W_BRASIL, h=H_BRASIL):
    """O rótulo de cada pixel de terra do mapa w×h (o brasil.png ou a camada de perto): a UF (contorno 1:50m) ou
    ESTRANGEIRO; pixel ausente é água."""
    rotulo, brasil_110m = {}, set()
    for p in paises:
        pixels = preencher_aneis(aneis_em_pixels(p["geometry"], CAIXA_BRASIL, w, h), w, h)
        if p["properties"]["ADM0_A3"] == "BRA":  # o Brasil vem das UFs, no contorno 1:50m
            brasil_110m |= pixels
        else:
            rotulo.update(dict.fromkeys(pixels, ESTRANGEIRO))
    ate_o_mar = distancias(brasil_110m | set(rotulo), w, h)  # mar do 1:110m
    for e in sorted(estados, key=lambda e: e["properties"]["postal"]):
        uf = e["properties"]["postal"]
        for px in preencher_aneis(aneis_em_pixels(e["geometry"], CAIXA_BRASIL, w, h), w, h):
            rotulo[px] = uf
    # O 1:110m e o 1:50m não casam: sobra Brasil 110m fora das UFs. Longe do mar e ligada a um vizinho, é
    # fresta de fronteira e vira terra do vizinho; o resto (costa e canais da foz do Amazonas) fica água.
    fresta = {px for px in brasil_110m - set(rotulo) if ate_o_mar[px] > FRESTA_LONGE_DO_MAR * w / W_BRASIL}
    fila = deque(px for px in sorted(fresta) if any(rotulo.get(v) == ESTRANGEIRO for v in vizinhos8(*px)))
    rotulo.update(dict.fromkeys(fila, ESTRANGEIRO))
    while fila:
        for v in vizinhos8(*fila.popleft()):
            if v in fresta and v not in rotulo:
                rotulo[v] = ESTRANGEIRO
                fila.append(v)
    return alisar_costa(rotulo, w, h)


def rotular_paises(paises, rotulo, w=W_BRASIL, h=H_BRASIL):
    """O país (ADM0_A3) de cada pixel de terra dos vizinhos, para a divisa entre eles e o nome de cada um."""
    pais = {}
    for p in paises:
        if p["properties"]["ADM0_A3"] != "BRA":
            for px in preencher_aneis(aneis_em_pixels(p["geometry"], CAIXA_BRASIL, w, h), w, h):
                if rotulo.get(px) == ESTRANGEIRO:
                    pais[px] = p["properties"]["ADM0_A3"]
    return pais


def miolo(rotulos, w, h, margem=0):
    """Para cada pixel rotulado, a distância (8 vizinhos) até a beira da região dele: um pixel de outro rótulo (ou sem
    rótulo) ou a faixa de `margem` pixels na borda da imagem. O ponto mais fundo é onde cabe o nome."""
    dist, fila = {}, deque()
    for (x, y), r in sorted(rotulos.items()):
        if min(x, y, w - 1 - x, h - 1 - y) < margem or any(rotulos.get(v) != r for v in vizinhos4(x, y)):
            dist[(x, y)] = 1
            fila.append((x, y))
    while fila:
        p = fila.popleft()
        for v in vizinhos8(*p):
            if v not in dist and rotulos.get(v) == rotulos[p]:
                dist[v] = dist[p] + 1
                fila.append(v)
    return dist


def mais_fundo(dist, rotulos, alvo, outros=0):
    """O pixel mais fundo da região `alvo` (no empate, o mais perto do meio dela) e a profundidade; com `outros`, também
    até tantos pontos fundos de reserva (com 45% da profundidade ou mais, a 70% dela uns dos outros), para o nome que não
    couber no primeiro (uma miniatura em cima dele, por exemplo)."""
    pixels = [p for p, r in rotulos.items() if r == alvo]
    mx, my = sum(p[0] for p in pixels) / len(pixels), sum(p[1] for p in pixels) / len(pixels)
    ordem = sorted(pixels, key=lambda p: (-dist[p], (p[0] - mx) ** 2 + (p[1] - my) ** 2, p))
    p, fundo = ordem[0], dist[ordem[0]]
    reservas = []
    for q in ordem[1:]:
        if len(reservas) >= outros or dist[q] < max(2, fundo * 0.45):
            break
        if all((q[0] - a[0]) ** 2 + (q[1] - a[1]) ** 2 >= (fundo * 0.7) ** 2 for a in [p] + reservas):
            reservas.append(q)
    return p, fundo, [[x, y, dist[(x, y)]] for x, y in reservas]


def estados_do_mapa(rotulo, estados, cidades):
    """As UFs para o navegador: lista com sigla, nome, capital e o ponto do nome (o mais fundo da UF), e o mapa da UF de
    cada pixel em linhas de texto: a letra da UF (a-z e A-Z, na ordem da lista; '.' fora do Brasil) e quantos pixels."""
    ufs = {p: r for p, r in rotulo.items() if r != ESTRANGEIRO}
    nomes = {e["properties"]["postal"]: e["properties"]["name"] for e in estados}
    capitais = {c["uf"]: c["id"] for c in cidades if c["id"] not in NAO_CAPITAIS}
    dist, lista = miolo(ufs, W_BRASIL, H_BRASIL), []
    for uf in sorted(nomes):
        (x, y), r, outros = mais_fundo(dist, ufs, uf, outros=3)
        lista.append({"uf": uf, "nome": nomes[uf], "capital": capitais[uf], "x": x, "y": y, "r": r, "outros": outros})
    return {"lista": lista, "mapa": mapa_das_ufs(rotulo, W_BRASIL, H_BRASIL)}


def mapa_das_ufs(rotulo, w, h):
    """A UF de cada pixel do mapa w×h em linhas de texto: a letra da UF (a-z e A-Z, na ordem alfabética das siglas; '.'
    fora do Brasil) e quantos pixels seguidos."""
    ufs = {p: r for p, r in rotulo.items() if r != ESTRANGEIRO}
    letra = {uf: string.ascii_letters[k] for k, uf in enumerate(sorted(set(ufs.values())))}
    mapa = []
    for y in range(h):
        linha, x = "", 0
        while x < w:
            atual, n = ufs.get((x, y)), 0
            while x < w and ufs.get((x, y)) == atual:
                x, n = x + 1, n + 1
            linha += (letra[atual] if atual else ".") + str(n)
        mapa.append(linha)
    return mapa


def focos_de_lavoura(cidades, medias):
    """Onde a lavoura aparece a 4x: um anel junto de cada capital e cidade média do Centro-Sul (x, y, raio de dentro e de
    fora, em pixels do nível de 4x; o de dentro fica sob a miniatura). Nada no Norte e no Nordeste."""
    k = ESCALA_4X
    return [(c["x"] * k + k / 2, c["y"] * k + k / 2, 3 * k, (6 if c.get("id") not in NAO_CAPITAIS else 4.5) * k)
            for c in list(cidades) + list(medias) if c["uf"] in CENTRO_SUL]


def azulejos_do_brasil(rotulo, n):
    """Os azulejos do nível de 4x (n x n) que tocam o Brasil (com 2 px de folga, em pixels de longe): só eles são gerados."""
    lado = W_BRASIL // n
    return {(i, j) for (x, y), r in rotulo.items() if r != ESTRANGEIRO
            for i in {max(0, (x - 2) // lado), min(n - 1, (x + 2) // lado)} for j in {max(0, (y - 2) // lado), min(n - 1, (y + 2) // lado)}}


def nomes_dos_paises(pais):
    """O ponto do nome de cada vizinho com miolo de PAIS_MIOLO px ou mais (longe da beira e da névoa da borda)."""
    dist, lista = miolo(pais, W_BRASIL, H_BRASIL, margem=mundo_terreno.VINHETA + 8), []
    for a3 in sorted(set(pais.values())):
        (x, y), r, _ = mais_fundo(dist, pais, a3)
        if r >= PAIS_MIOLO and a3 in PAISES:
            lista.append({"nome": PAISES[a3], "x": x, "y": y})
    return lista


def cidades_medias(fontes, cidades, rotulo):
    """As cidades médias do 3x: do recorte do Natural Earth, as maiores (POP_MAX) a mais de MEDIA_LONGE_KM de toda
    cidade do mundo e a mais de MEDIA_VIZINHA_KM de uma média já escolhida, no pixel de UF mais perto (até 2 px)."""
    escolhidas = []
    for f in ler(os.path.join(fontes, "fontes", LUGARES))["features"]:
        p, (lon, lat) = f["properties"], f["geometry"]["coordinates"]
        ponto = {"lat": lat, "lon": lon}
        if (p["NAME"], p["ADM1NAME"]) in ERRADAS or any(km(ponto, c) < MEDIA_LONGE_KM for c in cidades) \
                or any(km(ponto, m) < MEDIA_VIZINHA_KM for m in escolhidas):
            continue
        x0, y0 = para_pixel(lat, lon, CAIXA_BRASIL, W_BRASIL, H_BRASIL)
        perto = sorted((dx * dx + dy * dy, dy, dx) for dy in range(-2, 3) for dx in range(-2, 3)
                       if rotulo.get((x0 + dx, y0 + dy)) not in (None, ESTRANGEIRO))
        if not perto:
            continue
        x, y = x0 + perto[0][2], y0 + perto[0][1]
        if any((x - c["x"]) ** 2 + (y - c["y"]) ** 2 <= 9 for c in cidades):
            continue
        escolhidas.append({"nome": p["NAME"], "uf": rotulo[(x, y)], "x": x, "y": y, "pop": p["POP_MAX"], **ponto})
        if len(escolhidas) == MEDIAS_MAX:
            break
    # entra-se nelas também: o id para o endereço (#cidade=<id>), o porte pela população e a praia quando o mar fica a
    # até 2 px (uns 25 km)
    return [{**{k: m[k] for k in ("nome", "uf", "x", "y", "pop")}, "id": ident(m["nome"]), "porte": porte_media(m["pop"]),
             "litoral": any((m["x"] + dx, m["y"] + dy) not in rotulo for dx in range(-2, 3) for dy in range(-2, 3))}
            for m in escolhidas]


def ident(nome):
    """O id de uma cidade média: o nome sem acento, em minúsculas e com hífens (São José dos Campos: sao-jose-dos-campos)."""
    import unicodedata
    s = unicodedata.normalize("NFD", nome).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:40]


def porte_media(pop):
    """O porte da cidade média pela população (do Natural Earth, com a região metropolitana)."""
    return "grande" if pop >= 1_000_000 else "media" if pop >= 400_000 else "pequena"


def alisar_costa(rotulo, w, h, vezes=2):
    """Tira os dentes da costa: pixel de terra com um vizinho de terra ou menos (dos 4) vira água, e pixel de água
    cercado de terra em 3 lados vira terra, com o rótulo mais comum em volta."""
    for _ in range(vezes):
        tirar, por = [], {}
        for y in range(h):
            for x in range(w):
                viz = [rotulo[v] for v in vizinhos4(x, y) if v in rotulo]
                if (x, y) in rotulo and len(viz) <= 1:
                    tirar.append((x, y))
                elif (x, y) not in rotulo and len(viz) >= 3 and 0 < x < w - 1 and 0 < y < h - 1:
                    por[(x, y)] = sorted(Counter(viz).items(), key=lambda kv: (-kv[1], kv[0]))[0][0]
        for px in tirar:
            del rotulo[px]
        rotulo.update(por)
    return rotulo


def em_pixels(lon, lat, w=W_BRASIL, h=H_BRASIL):
    """(lon, lat) em pixels (fracionários) do mapa w×h (o brasil.png ou a camada de perto)."""
    lon0, lat0, lon1, lat1 = CAIXA_BRASIL
    return (lon - lon0) * w / (lon1 - lon0), (lat1 - lat) * h / (lat1 - lat0)


def rios_menores(fontes):
    """Os rios do 1:10m que o 1:50m não tem (os afluentes): sai a feição com metade ou mais dos pontos a até 1 px (de
    longe) de um rio do 1:50m, que já é desenhado com a forma do mapa de longe."""
    grandes = set()
    for r in ler(os.path.join(fontes, "fontes", RIOS))["features"]:
        for l in r["geometry"]["coordinates"]:
            for (x0, y0), (x1, y1) in zip(l, l[1:]):
                for x, y in mundo_terreno.linha(*map(int, em_pixels(x0, y0)), *map(int, em_pixels(x1, y1))):
                    grandes.update((x + a, y + b) for a in (-1, 0, 1) for b in (-1, 0, 1))
    menores = []
    for r in ler(os.path.join(fontes, "fontes", RIOS_MENORES))["features"]:
        pontos = [tuple(map(int, em_pixels(*p))) for l in r["geometry"]["coordinates"] for p in l]
        if 2 * sum(p in grandes for p in pontos) < len(pontos):
            menores.append(r)
    return menores


def desenhar_brasil(rotulo, fontes, pais, w=W_BRASIL, h=H_BRASIL, escala=1, registro=None):
    """O mapa ilustrado (mundo_terreno.desenhar) em w×h, com biomas, serras e rios passados para pixels; na escala de
    perto, também as rodovias e os rios menores. registro: o dict que recebe os objetos do desenho (para o 4x)."""
    from PIL import Image
    px = lambda p: em_pixels(*p, w, h)
    poligono = lambda pontos: preencher([px(p) for p in pontos], w, h)
    dados = ler(os.path.join(fontes, "biomas.json"))
    biomas = [(b["id"], poligono(b["poligono"])) for b in dados["biomas"]]
    extras = {nome: poligono(e["poligono"]) for nome, e in dados["extras"].items()}
    serras = [{"tipo": s["tipo"], "forma": s.get("forma"), "linhas": [[px(p) for p in l] for l in s["linhas"]],
               "picos": [px(p["ponto"]) for p in s.get("picos", [])]}
              for s in ler(os.path.join(fontes, "serras.json"))]
    linhas = lambda r: [[px(p) for p in l] for l in r["geometry"]["coordinates"]]
    rios = [(r["properties"]["name"], linhas(r)) for r in ler(os.path.join(fontes, "fontes", RIOS))["features"]]
    afluentes, estradas = [], []
    if escala > 1:
        afluentes = [(r["properties"]["name"] or "", linhas(r)) for r in rios_menores(fontes)]
        estradas = [linhas(r) for r in ler(os.path.join(fontes, "fontes", ESTRADAS))["features"]]
    indices = mundo_terreno.desenhar(rotulo, biomas, extras, serras, rios, w, h, escala=escala, estradas=estradas,
                                     afluentes=afluentes, paises=pais, registro=registro)
    im = Image.new("P", (w, h))
    im.putpalette([int(c[i:i + 2], 16) for c in mundo_terreno.CORES.values() for i in (1, 3, 5)])
    im.putdata(indices)
    return im


def paletizar(indices, w, h, paleta, indice):
    """Os índices da paleta estendida (mundo_terreno.paleta_com_relevo) numa imagem P só com as cores que ela usa, na ordem
    da paleta (cada azulejo cabe em 256 cores: o mapa usa menos de 90 por azulejo e as peças, até RELEVO_CORES por família)."""
    from PIL import Image
    cores = sorted({paleta[k] for k in set(indices)}, key=indice.get)
    if len(cores) > 256:
        raise ValueError(f"{len(cores)} cores numa imagem de {w}x{h}: o PNG paletizado tem no máximo 256")
    local = {c: n for n, c in enumerate(cores)}
    im = Image.new("P", (w, h))
    im.putpalette([int(c[i:i + 2], 16) for c in cores for i in (1, 3, 5)])
    im.putdata([local[paleta[k]] for k in indices])
    return im


def azulejos(indices, w, paleta, indice):
    """O mapa (índices, w x w) cortado em azulejos AZULEJO×AZULEJO, cada um com a paleta dele: {(coluna, linha): imagem}."""
    n, A = w // AZULEJO, AZULEJO
    return {(i, j): paletizar([indices[(j * A + y) * w + i * A + x] for y in range(A) for x in range(A)], A, A, paleta, indice)
            for j in range(n) for i in range(n)}


def celulas(rotulo):
    """As células de 0,5° do Brasil, para o globo: 80 linhas (de lat 6 para baixo) de 80 '0'/'1' (de lon −74 para a
    direita). A célula é do Brasil se 4 das 9 amostras (1, 2 e 3 px dentro do bloco de 5x5) forem de UF."""
    uf = lambda x, y: rotulo.get((x, y)) not in (None, ESTRANGEIRO)
    return ["".join("1" if sum(uf(i * 5 + a, j * 5 + b) for a in (1, 2, 3) for b in (1, 2, 3)) >= 4 else "0"
                    for i in range(80)) for j in range(80)]


CAMPOS_EXTERIOR = ("id", "nome", "pais", "lat", "lon", "marco", "marco_nome", "porte", "litoral", "regiao")


def exterior(fontes):
    """As cidades de fora do Brasil (arte/mundo/exterior.json), só com os campos que a página usa; sem o arquivo, []."""
    caminho = os.path.join(fontes, "exterior.json")
    return [{k: c[k] for k in CAMPOS_EXTERIOR} for c in ler(caminho)] if os.path.exists(caminho) else []


def na_terra(cidade, rotulo):
    """Pixel da cidade no brasil.png: o de para_pixel ou, se ele cair fora do Brasil (cidade da costa,
    de ilha ou de baía), o pixel de UF mais perto em distância euclidiana, até CIDADE_RAIO."""
    x, y = para_pixel(cidade["lat"], cidade["lon"], CAIXA_BRASIL, W_BRASIL, H_BRASIL)
    perto = sorted((dx * dx + dy * dy, dy, dx) for dy in range(-CIDADE_RAIO, CIDADE_RAIO + 1)
                   for dx in range(-CIDADE_RAIO, CIDADE_RAIO + 1)
                   if dx * dx + dy * dy <= CIDADE_RAIO ** 2 and rotulo.get((x + dx, y + dy)) not in (None, ESTRANGEIRO))
    if not perto:
        raise ValueError(f"cidade {cidade['id']}: nenhum pixel do Brasil a até {CIDADE_RAIO} px de ({x}, {y})")
    _, dy, dx = perto[0]
    return x + dx, y + dy


def km(a, b):
    """Distância em km pelo círculo máximo (haversine)."""
    la1, lo1, la2, lo2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    s = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(s))


def rotas(cidades):
    """Pares de capitais a menos de ROTA_MAX_KM, dos mais perto aos mais longe, até ROTAS_MAX."""
    capitais = [c for c in cidades if c["id"] not in NAO_CAPITAIS]
    pares = sorted((km(a, b), a["id"], b["id"]) for i, a in enumerate(capitais) for b in capitais[i + 1:])
    return [[a, b] for d, a, b in pares if d < ROTA_MAX_KM][:ROTAS_MAX]


def versao(pixels, dados):
    """A versão derivada do conteúdo (os bytes dos arquivos e os dados), para o navegador não guardar arquivo velho."""
    return int(hashlib.sha256(pixels + json.dumps(dados, sort_keys=True).encode()).hexdigest()[:8], 16)


def versao_dos_arquivos(saida, dados):
    """A versão do mundo: os bytes dos arquivos gravados em `saida` (os PNG levam a paleta deles, então trocar uma cor
    muda a versão mesmo com os mesmos índices), em ordem fixa, e os dados do mundo.json (sem a versão)."""
    nomes = ["terra.png", "brasil.png", os.path.join("perto", "ufs.json")]
    for pasta in ("perto", "perto4x"):
        nomes += sorted(os.path.join(pasta, n) for n in os.listdir(os.path.join(saida, pasta)) if n.endswith(".png"))
    conteudo = b""
    for n in nomes:
        with open(os.path.join(saida, n), "rb") as f:
            conteudo += f.read()
    return versao(conteudo, dados)


def montar(fontes, saida):
    """Desenha terra.png e brasil.png em `saida` a partir de `fontes` (arte/mundo) e devolve o mundo.json."""
    cidades = ler(os.path.join(fontes, "cidades.json"))
    paises = ler(os.path.join(fontes, "fontes", "ne_110m_admin_0_countries.geojson"))["features"]
    estados = ler(os.path.join(fontes, "fontes", "ne_50m_admin_1_states_provinces_lakes.geojson"))["features"]
    rotulo = rotular_brasil(paises, estados)
    pais = rotular_paises(paises, rotulo)
    terra, brasil = desenhar_terra(paises, fontes, celulas(rotulo)), desenhar_brasil(rotulo, fontes, pais)
    wp, hp = W_BRASIL * ESCALA_PERTO, H_BRASIL * ESCALA_PERTO   # a camada de perto, desenhada de novo na resolução dela
    rotulo_perto = rotular_brasil(paises, estados, wp, hp)
    objetos = {}   # o que o 2x desenhou (chão, árvores, serras, rodovias), para o 4x redesenhar no mesmo lugar
    perto = desenhar_brasil(rotulo_perto, fontes, rotular_paises(paises, rotulo_perto, wp, hp), wp, hp, ESCALA_PERTO, objetos)

    mundo = {
        "cidades": [{"id": c["id"], "nome": c["nome"], "uf": c["uf"], "lat": c["lat"], "lon": c["lon"],
                     "x": x, "y": y, "marco": c["marco"], "marco_nome": c["marco_nome"], "porte": c["porte"],
                     "litoral": c["litoral"]}
                    for c in cidades for x, y in [na_terra(c, rotulo)]],
        "rotas": rotas(cidades),
        # as cidades de fora do Brasil, no globo: clicar desce direto à cidade (sem mapa do país)
        "exterior": exterior(fontes),
    }
    medias = cidades_medias(fontes, mundo["cidades"], rotulo)
    w4, h4 = W_BRASIL * ESCALA_4X, H_BRASIL * ESCALA_4X
    dois = list(perto.tobytes())
    quatro = mundo_terreno.refinar(dois, wp, hp, focos_de_lavoura(mundo["cidades"], medias), objetos)
    # as serras de perto: as peças de relevo, as mesmas nos mesmos lugares a 2x (na metade) e a 4x; quem decide se a peça
    # cabe é o 2x, e o 4x carimba as mesmas
    pecas = pecas_do_relevo()
    paleta, indice = mundo_terreno.paleta_com_relevo(pecas)
    carimbos = mundo_terreno.carimbos_do_relevo(objetos["serras"], pecas)
    chao = objetos["chao"]
    no_chao = lambda x, y: chao[min(hp - 1, max(0, y // 2)) * wp + min(wp - 1, max(0, x // 2))]   # (x, y) de 4x
    fora, mar = (lambda x, y: "_ap" in no_chao(x, y)), (lambda x, y: no_chao(x, y) == "mar")
    postos = mundo_terreno.carimbar_relevo(dois, wp, hp, carimbos, pecas, 2, indice, fora, mar)
    mundo_terreno.carimbar_relevo(quatro, w4, h4, postos, pecas, 4, indice, fora, mar, so=set(postos))
    n4 = w4 // AZULEJO
    no_brasil = azulejos_do_brasil(rotulo, n4)
    ufs_perto = {"w": wp, "h": hp, "mapa": mapa_das_ufs(rotulo_perto, wp, hp)}   # o realce de 2x em diante, na grade de 2x
    mundo["niveis"] = {"brasil": {
        "w": W_BRASIL, "h": H_BRASIL, "caixa": list(CAIXA_BRASIL), "celulas": celulas(rotulo),
        "perto": {"escala": ESCALA_PERTO, "azulejo": AZULEJO, "n": wp // AZULEJO},
        "perto4x": {"escala": ESCALA_4X, "azulejo": AZULEJO, "n": n4,
                    "azulejos": "".join("1" if (i, j) in no_brasil else "0" for j in range(n4) for i in range(n4))},
        "ufs": estados_do_mapa(rotulo, estados, cidades), "medias": medias, "paises": nomes_dos_paises(pais)}}
    os.makedirs(os.path.join(saida, "perto"), exist_ok=True)
    os.makedirs(os.path.join(saida, "perto4x"), exist_ok=True)
    for n in os.listdir(os.path.join(saida, "perto4x")):   # o azulejo de 4x que a máscara não tem mais
        if n.endswith(".png") and tuple(map(int, n[:-4].split("-"))) not in no_brasil:
            os.remove(os.path.join(saida, "perto4x", n))
    terra.save(os.path.join(saida, "terra.png"), optimize=True)
    brasil.save(os.path.join(saida, "brasil.png"), optimize=True)
    for (i, j), azulejo in azulejos(dois, wp, paleta, indice).items():
        azulejo.save(os.path.join(saida, "perto", f"{i}-{j}.png"), optimize=True)
    for (i, j), azulejo in azulejos(quatro, w4, paleta, indice).items():
        if (i, j) in no_brasil:
            azulejo.save(os.path.join(saida, "perto4x", f"{i}-{j}.png"), optimize=True)
    with open(os.path.join(saida, "perto", "ufs.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(ufs_perto, f, separators=(",", ":"))
        f.write("\n")
    mundo = {"versao": versao_dos_arquivos(saida, mundo), **mundo}
    with open(os.path.join(saida, "mundo.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(mundo, f, ensure_ascii=False, indent=1)
        f.write("\n")
    return mundo


ARTE = os.path.join(RAIZ, "arte", "pixellab", "mundo")   # a arte do PixelLab (marcos, peças genéricas e o relevo)
# as peças de relevo do PixelLab (lote 5, relevo-*.png: mata, rocha, neve e chapada), carimbadas nas serras a 2x e a 4x
# (mundo_terreno.RELEVO); as cores de cada família são reduzidas a RELEVO_CORES, para cada azulejo caber em 256
RELEVO_CORES = 32


def pecas_do_relevo(arte=ARTE):
    """As peças de relevo: nome -> (w, h, pixels '#rrggbb' ou None no vazio), com alfa binário e as cores de cada família
    reduzidas juntas a RELEVO_CORES (corte mediano, sem pontilhado: o mesmo dado dá sempre as mesmas cores)."""
    from PIL import Image
    pecas = {}
    for filas in mundo_terreno.RELEVO.values():
        nomes = sorted({n.split("/")[0] for fila in filas for n in fila})
        dados = {}
        for n in nomes:
            im = Image.open(os.path.join(arte, f"relevo-{n}.png")).convert("RGBA")
            b = im.tobytes()
            dados[n] = (im.width, im.height, [tuple(b[i:i + 3]) if b[i + 3] >= 128 else None for i in range(0, len(b), 4)])
        todas = [c for _, _, px in dados.values() for c in px if c]
        tira = Image.new("RGB", (len(todas), 1))
        tira.putdata(todas)
        q = tira.quantize(colors=RELEVO_CORES, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        pal = q.getpalette()
        mapa = {c: "#%02x%02x%02x" % tuple(pal[3 * k:3 * k + 3]) for c, k in zip(todas, q.tobytes())}
        for n, (w, h, px) in dados.items():
            pecas[n] = (w, h, [mapa[c] if c else None for c in px])
    return pecas
# as peças que toda cidade pode usar: prédios, casas, chalés, árvores e canteiros, carros, aviões, a praça, o lazer (campo,
# parquinho, lago, coreto, feira e quadra), a praia e o mobiliário da rua
GENERICOS = ([f"predios-{i}" for i in range(1, 15)] + [f"chale-{i}" for i in range(1, 9)] + [f"casa-{i}" for i in range(1, 7)]
             + [f"arvore-{i}" for i in range(1, 8)] + ["canteiro-1", "canteiro-2"]
             + [f"carro-{i}" for i in range(1, 6)] + ["aviao-1", "aviao-2"]
             + [f"lazer-{i}" for i in range(1, 7)] + [f"praia-{i}" for i in range(1, 5)]
             + ["praca-1", "banca-1", "ponto-onibus-1", "carrinho-1", "banco-poste-1"] + [f"rua-{i}" for i in range(1, 5)])
# as peças das festas, ao lado da fonte da praça: entram quando a arte existe (sem ela, a festa fica só nos enfeites)
OPCIONAIS = ["festa-arvore-natal", "festa-fogueira", "festa-barraca-junina", "festa-abobora", "festa-ovo-pascoa",
             "festa-carro-alegorico", "festa-palco-anonovo"]
# desenhadas pelo PixelLab grandes demais para a cidade: entram no atlas na metade (o navegador desenha 1:1)
METADE = {"carro-1", "carro-2", "carro-3", "carro-4", "carro-5", "banca-1", "ponto-onibus-1", "carrinho-1", "banco-poste-1",
          "rua-1", "rua-2", "rua-3", "rua-4", "canteiro-1", "canteiro-2", "praia-1", "praia-2", *OPCIONAIS}
# manchas soltas que a arte trouxe: a cor que sai quando ligada ao fundo (a sombra cinza do canto do predios-11)
MANCHAS = {"predios-11": (64, 64, 64)}
# o píer sai sem o bloco de água e a borda de terra do desenho, para pousar no mar da cidade (sem_agua)
SEM_AGUA = {"praia-4"}
# em 3/4 (pixel nítido, ver tres_quartos): o coreto, menor que os marcos e maior que uma casa
TRES_QUARTOS = {"lazer-4"}
# as construções com janelas (acesas à noite): até JANELAS_MAX por peça, só as pequenas e fora da base do desenho
COM_JANELAS = ("chale-", "casa-", "predios-", "marco-")
JANELAS_MAX, JANELA_AREA = 48, 30
ATLAS_LARGURA = 512
MINI_MARCO, MINI_AVIAO = 32, 20   # pixels: o lado maior da miniatura do mapa, antes do contorno de 1 px
MINI_CONTORNO = (28, 22, 18, 255)


# os veículos desenhados aqui, pixel a pixel (o PixelLab não desenha ônibus nem bicicleta vistos de cima): de frente para
# o leste, como os carros, que a cidade gira conforme o sentido
CONTORNO, VIDRO, BRILHO, PNEU = (24, 24, 32, 255), (38, 48, 70, 255), (112, 140, 186, 255), (16, 16, 20, 255)
FAROL, LANTERNA = (255, 236, 168, 255), (214, 64, 64, 255)



def onibus_de_cima(corpo, claro, escuro, faixa):
    """O ônibus de cima, de frente para o leste (como os carros, que a cidade gira conforme o sentido): 44x17, com as
    janelas dos dois lados, o teto com dois aparelhos de ar, o para-brisa, faróis, lanternas e as rodas embaixo."""
    w, h = 44, 17   # 16 de carroceria e a linha das rodas
    from PIL import Image
    im = Image.new("RGBA", (w, h))
    px = im.load()
    teto, teto_luz, teto_sombra = (222, 226, 232, 255), (242, 245, 249, 255), (188, 194, 204, 255)
    for x in range(w):
        for y in range(16):
            if (x in (0, w - 1) and y in (0, 1, 14, 15)) or (x in (1, w - 2) and y in (0, 15)):
                continue   # os cantos arredondados
            borda = x in (0, w - 1) or y in (0, 15) or (x in (1, w - 2) and y in (1, 14))
            px[x, y] = CONTORNO if borda else corpo
    for x in range(2, w - 2):
        px[x, 1] = claro; px[x, 14] = escuro
        px[x, 4] = faixa; px[x, 11] = faixa   # a faixa da empresa, nos dois lados
    for x in range(3, w - 6):   # as janelas: vidro em trechos de 5, com colunas na cor do ônibus
        if (x - 3) % 6 != 5:
            px[x, 2] = BRILHO if (x - 3) % 6 == 0 else VIDRO
            px[x, 3] = VIDRO; px[x, 12] = VIDRO; px[x, 13] = VIDRO
    for x in range(4, w - 7):   # o teto
        for y in range(5, 11):
            px[x, y] = teto
        px[x, 5] = teto_luz; px[x, 10] = teto_sombra
    for x0 in (9, 25):   # os dois aparelhos de ar-condicionado
        for x in range(x0, x0 + 8):
            for y in range(6, 10):
                px[x, y] = (150, 158, 172, 255)
            px[x, 6] = (176, 184, 196, 255); px[x, 9] = (112, 120, 134, 255)
        for x in range(x0 + 1, x0 + 7, 2):
            px[x, 7] = px[x, 8] = (98, 106, 120, 255)
    for y in range(2, 14):   # para-brisa (leste) e vidro de trás
        for x in (w - 6, w - 5, w - 4):
            px[x, y] = VIDRO
        px[2, y] = VIDRO
    for y in (3, 4, 5):
        px[w - 5 + (y - 3) // 2, y] = BRILHO
    px[w - 3, 2] = px[w - 3, 13] = FAROL
    px[1, 2] = px[1, 13] = LANTERNA
    for x in list(range(7, 12)) + list(range(30, 35)):   # as rodas, aparecendo embaixo
        px[x, 16] = PNEU
    return im


def bici(camisa, sombra, pele, cabelo):
    """A bicicleta de cima, de frente para o leste: 13x7, rodas na frente e atrás, guidão, e o ciclista (ombros na cor
    da camisa e a cabeça)."""
    w, h = 13, 7
    from PIL import Image
    im = Image.new("RGBA", (w, h))
    px = im.load()
    for x in (0, 1, 2, 10, 11, 12):   # as rodas
        px[x, 3] = PNEU
    for x in range(3, 10):   # o quadro
        px[x, 3] = (190, 196, 204, 255)
    px[9, 1] = px[9, 2] = px[9, 4] = px[9, 5] = (60, 60, 68, 255)   # o guidão
    for x in range(4, 8):   # os ombros e as costas
        for y in range(1, 6):
            px[x, y] = camisa
        px[x, 5] = sombra
    px[3, 2] = px[3, 3] = px[3, 4] = sombra
    for x in (6, 7):   # a cabeça
        for y in (2, 3, 4):
            px[x, y] = cabelo
    px[8, 3] = pele
    px[8, 2] = px[8, 4] = (pele[0] - 30, pele[1] - 30, pele[2] - 30, 255)   # os braços até o guidão
    return im


def desenhados():
    """As peças feitas por código: dois ônibus (amarelo e azul) e três bicicletas (ciclistas de camisas diferentes)."""
    return {
        "onibus-cima-1": onibus_de_cima((236, 178, 40, 255), (252, 206, 90, 255), (190, 132, 24, 255), (46, 110, 190, 255)),
        "onibus-cima-2": onibus_de_cima((52, 112, 196, 255), (96, 152, 226, 255), (34, 78, 146, 255), (236, 178, 40, 255)),
        "bici-1": bici((214, 70, 70, 255), (160, 44, 44, 255), (224, 172, 128, 255), (60, 40, 30, 255)),
        "bici-2": bici((60, 160, 110, 255), (36, 116, 78, 255), (150, 100, 70, 255), (24, 20, 20, 255)),
        "bici-3": bici((240, 200, 60, 255), (190, 150, 30, 255), (236, 190, 150, 255), (180, 120, 50, 255)),
    }


def metade(im):
    """A peça na metade, sem borrão nem borda translúcida: cada bloco 2x2 vira um pixel com a média das cores opacas
    (pela pré-multiplicação do alfa), opaco se a maior parte do bloco era opaca. Recortada de novo pelo alfa."""
    from PIL import Image
    w, h = im.size
    par = Image.new("RGBA", (w + w % 2, h + h % 2))
    par.paste(im, (0, 0))
    menor = par.convert("RGBa").reduce(2).convert("RGBA")
    menor.putalpha(menor.getchannel("A").point(lambda a: 255 if a >= 128 else 0))
    return menor.crop(menor.getchannel("A").getbbox())


def mini(im, lado):
    """A miniatura do mapa do Brasil: a peça reduzida até `lado` px no lado maior, com contorno escuro de 1 px (para
    ler sobre qualquer terreno). Cada bloco vira a cor real do bloco mais perto da média das cores opacas (sem borrão e
    sem cor nova), opaco se a maior parte do bloco era opaca; o alfa fica binário."""
    from PIL import Image
    w, h = im.size
    f = max(w, h) / lado
    nw, nh = max(1, round(w / f)), max(1, round(h / f))
    px, out = im.load(), Image.new("RGBA", (nw + 2, nh + 2))
    o = out.load()
    for j in range(nh):
        for i in range(nw):
            x0, y0 = i * w // nw, j * h // nh
            x1, y1 = max(x0 + 1, (i + 1) * w // nw), max(y0 + 1, (j + 1) * h // nh)
            bloco = [px[x, y] for y in range(y0, y1) for x in range(x0, x1)]
            opacos = [c for c in bloco if c[3] >= 128]
            if len(opacos) * 2 < len(bloco):
                continue
            m = [sum(c[k] for c in opacos) / len(opacos) for k in range(3)]
            o[i + 1, j + 1] = min(opacos, key=lambda c: (sum((c[k] - m[k]) ** 2 for k in range(3)), c))[:3] + (255,)
    borda = [(x, y) for y in range(nh + 2) for x in range(nw + 2) if not o[x, y][3]
             and any(0 <= x + dx < nw + 2 and 0 <= y + dy < nh + 2 and o[x + dx, y + dy][3] == 255
                     for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
    for p in borda:
        o[p] = MINI_CONTORNO
    return out


def sem_mancha(im, cor):
    """Tira a mancha da cor `cor` ligada ao fundo transparente (4 vizinhos): a sombra solta que a arte trouxe."""
    w, h = im.size
    px = im.load()
    fila = deque((x, y) for y in range(h) for x in range(w) if px[x, y][3] == 255 and px[x, y][:3] == cor
                 and any(not (0 <= a < w and 0 <= b < h) or px[a, b][3] == 0 for a, b in vizinhos4(x, y)))
    while fila:
        x, y = fila.popleft()
        if px[x, y][3] == 0:
            continue
        px[x, y] = (0, 0, 0, 0)
        fila.extend((a, b) for a, b in vizinhos4(x, y) if 0 <= a < w and 0 <= b < h and px[a, b][3] == 255 and px[a, b][:3] == cor)
    return im.crop(im.getchannel("A").getbbox())


def sem_agua(im):
    """A peça sem a água: some todo pixel azul (mais azul que vermelho) e, do que sobra, o pedaço que é quase todo a
    borda de baixo do desenho (a terra do bloco, até 4 px acima do pé de cada coluna) ou miúdo demais."""
    w, h = im.size
    px = im.load()
    pe = [max([y for y in range(h) if px[x, y][3]] or [-1]) for x in range(w)]
    for y in range(h):
        for x in range(w):
            c = px[x, y]
            if c[3] and c[2] > c[0] + 12 and c[2] >= c[1] - 30:
                px[x, y] = (0, 0, 0, 0)
    visto = set()
    for y in range(h):
        for x in range(w):
            if not px[x, y][3] or (x, y) in visto:
                continue
            pedaco, fila = [], deque([(x, y)])
            visto.add((x, y))
            while fila:
                p = fila.popleft()
                pedaco.append(p)
                for v in vizinhos8(*p):
                    if 0 <= v[0] < w and 0 <= v[1] < h and v not in visto and px[v][3]:
                        visto.add(v)
                        fila.append(v)
            if len(pedaco) < 6 or 2 * sum(1 for a, b in pedaco if pe[a] - b <= 4) >= len(pedaco):
                for p in pedaco:
                    px[p] = (0, 0, 0, 0)
    return im.crop(im.getchannel("A").getbbox())


def tres_quartos(im):
    """A peça em 3/4 com pixel nítido: ampliada 3x pelo vizinho e reduzida em blocos de 4x4, cada bloco com a cor mais
    frequente dos pixels opacos (o contorno escuro pesa o dobro, para não sumir); opaco se a maior parte era opaca."""
    from PIL import Image
    w, h = im.size
    tres = im.resize((w * 3, h * 3), Image.NEAREST)
    px, nw, nh = tres.load(), (w * 3 + 3) // 4, (h * 3 + 3) // 4
    out = Image.new("RGBA", (nw, nh))
    o = out.load()
    for j in range(nh):
        for i in range(nw):
            bloco = [px[x, y] for y in range(j * 4, min(j * 4 + 4, h * 3)) for x in range(i * 4, min(i * 4 + 4, w * 3))]
            opacos = [c for c in bloco if c[3] >= 128]
            if len(opacos) * 2 < len(bloco):
                continue
            conta = Counter()
            for c in opacos:
                conta[c[:3]] += 2 if sum(c[:3]) < 150 else 1
            o[i, j] = min(conta.items(), key=lambda kv: (-kv[1], kv[0]))[0] + (255,)
    return out.crop(out.getchannel("A").getbbox())


def janelas(im):
    """As janelas da peça, [x, y, w, h, ...]: manchas de vidro (azul) pequenas, fora da base (os 12% de baixo, onde ficam
    flores e grama), em ordem de leitura; acima de JANELAS_MAX, um de cada tantos (espalhadas pela fachada)."""
    w, h = im.size
    px = im.load()
    vidro = lambda c: c[3] == 255 and c[2] >= c[0] + 30 and c[2] >= c[1] - 5 and c[2] >= 60 and c[0] < 170
    visto, achadas = set(), []
    for y in range(h):
        for x in range(w):
            if (x, y) in visto or not vidro(px[x, y]):
                continue
            mancha, fila = [], deque([(x, y)])
            visto.add((x, y))
            while fila:
                p = fila.popleft()
                mancha.append(p)
                for v in vizinhos4(*p):
                    if 0 <= v[0] < w and 0 <= v[1] < h and v not in visto and vidro(px[v]):
                        visto.add(v)
                        fila.append(v)
            xs, ys = [p[0] for p in mancha], [p[1] for p in mancha]
            x0, y0, jw, jh = min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
            if len(mancha) <= JANELA_AREA and jw <= 10 and jh <= 12 and y0 + jh <= h * 0.88:
                achadas.append([x0, y0, jw, jh])
    achadas.sort(key=lambda j: (j[1], j[0]))
    if len(achadas) > JANELAS_MAX:
        achadas = [achadas[i * len(achadas) // JANELAS_MAX] for i in range(JANELAS_MAX)]
    return [v for j in achadas for v in j]


def montar_atlas(arte, cidades, saida):
    """atlas.png e atlas.json em `saida` com a arte do PixelLab (`arte`): os marcos das cidades e as peças genéricas.
    Cada peça vai recortada pela caixa do alfa (o código ancora pelo pé do recorte), as de METADE já reduzidas, e é
    empilhada em prateleiras, da mais alta para a mais baixa. Marco ou peça OPCIONAL sem arte fica de fora (a cidade
    usa os prédios genéricos, a festa fica nos enfeites desenhados por código); peça genérica sem arte é erro. Cada
    marco e os dois aviões ganham também a miniatura do mapa do Brasil (mini-<nome>, ver mini()). As construções levam
    as janelas (janelas()), para a cidade acender à noite."""
    from PIL import Image
    pecas = {}

    def abrir(nome):
        im = Image.open(os.path.join(arte, nome + ".png")).convert("RGBA")
        im = im.crop(im.getchannel("A").getbbox())
        if nome in MANCHAS:
            im = sem_mancha(im, MANCHAS[nome])
        if nome in SEM_AGUA:
            im = sem_agua(im)
        return metade(im) if nome in METADE else tres_quartos(im) if nome in TRES_QUARTOS else im
    for nome in GENERICOS:
        if not os.path.exists(os.path.join(arte, nome + ".png")):
            raise FileNotFoundError(f"atlas: falta a arte {nome}.png em {arte}")
        pecas[nome] = abrir(nome)
    for nome in OPCIONAIS:
        if os.path.exists(os.path.join(arte, nome + ".png")):
            pecas[nome] = abrir(nome)
    pecas.update(desenhados())
    for nome in ("aviao-1", "aviao-2"):
        pecas["mini-" + nome] = mini(pecas[nome], MINI_AVIAO)
    for c in cidades:
        nome = "marco-" + c["marco"] if c["marco"] else None
        if nome and os.path.exists(os.path.join(arte, nome + ".png")):
            pecas[nome] = abrir(nome)
            pecas["mini-" + c["marco"]] = mini(pecas[nome], MINI_MARCO)
        elif nome:
            print(f"atlas: sem {nome}.png, {c['id']} usa os prédios genéricos")

    x = y = alto = 0
    quadros = {}
    for nome, im in sorted(pecas.items(), key=lambda p: (-p[1].height, p[0])):
        if x + im.width > ATLAS_LARGURA:
            x, y, alto = 0, y + alto + 1, 0
        quadros[nome] = [x, y, im.width, im.height]
        x += im.width + 1
        alto = max(alto, im.height)
    imagem = Image.new("RGBA", (ATLAS_LARGURA, y + alto))
    for nome, (px, py, _, _) in quadros.items():
        imagem.paste(pecas[nome], (px, py))
    quadros = dict(sorted(quadros.items()))
    vidros = {nome: j for nome, im in sorted(pecas.items()) if nome.startswith(COM_JANELAS) for j in [janelas(im)] if j}
    h = hashlib.sha256(imagem.tobytes() + json.dumps([quadros, vidros], sort_keys=True).encode())
    atlas = {"versao": int(h.hexdigest()[:8], 16), "quadros": quadros, "janelas": vidros}

    os.makedirs(saida, exist_ok=True)
    imagem.save(os.path.join(saida, "atlas.png"), optimize=True)
    with open(os.path.join(saida, "atlas.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(atlas, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    return atlas


def main():
    entrada = sys.argv[1] if len(sys.argv) > 1 else ENTRADA
    saida = sys.argv[2] if len(sys.argv) > 2 else SAIDA
    mundo = montar(entrada, saida)
    print(f"mundo: {len(mundo['cidades'])} cidades, {len(mundo['rotas'])} rotas, versão {mundo['versao']} -> {os.path.normpath(saida)}")
    atlas = montar_atlas(ARTE, ler(os.path.join(entrada, "cidades.json")) + exterior(entrada), saida)
    print(f"atlas: {len(atlas['quadros'])} peças, versão {atlas['versao']} -> {os.path.normpath(saida)}")


if __name__ == "__main__":
    main()
