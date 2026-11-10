"""O desenho do terra.png (a textura do globo, 0,5° por pixel), na mesma língua do mapa do Brasil (mundo_terreno.py).

Camadas: a classe de cada pixel de terra (os biomas do Brasil do biomas.json, depois os polígonos do planeta.json e, fora
de todos, a faixa de latitude), com a borda deformada por ruído e passada em pontilhado de Bayer; o chão de cada classe
em dois tons com pontos de um terceiro (dunas em listras no deserto); as serras com luz a noroeste, sombra a sudeste e
neve no alto; gelo nos polos; e o mar com duas faixas rasas claras na costa, o alto-mar mais escuro e o gelo do Ártico.
As cores saem da paleta do mapa (mundo_terreno.CORES), mais as do frio. Água tem B > G e terra G >= B: o navegador
separa as duas pela cor, sem cópia da paleta. Tudo sai de semente fixa: o mesmo dado dá sempre a mesma imagem.
"""
from collections import deque

from mundo_terreno import CORES, _bayer, _h, _ruido

# as cores do frio (tundra, gelo) e das dunas, que o mapa do Brasil não tem, e os tons das serras do globo (os montes do
# mapa do Brasil seguem as peças de relevo; o globo fica com os dele)
NOVAS = {"gelo": "#eef3f1", "gelo2": "#dce7e5", "gelo_sombra": "#c2d0ce", "tu_chao": "#7d8862", "tu_chao2": "#8e9672",
         "duna": "#cfb27a", "es_chao": "#a49a62", "mn_meio": "#978f81", "mr_meio": "#bba077", "mv_meio": "#8f9e74",
         "mv_luz": "#b4c08e", "mv_sombra": "#6d7d5a", "mr_luz": "#dcc596", "mr_sombra": "#9a7c58", "mn_luz": "#bdb5a6",
         "mn_sombra": "#746c62"}
# cada classe: dois tons em manchas e o tom dos pontos, com a chance do ponto
ESTILOS = {
    "floresta": ("am_copa", "am_sombra", "am_luz", 0.12), "mata": ("ma_chao", "ma_chao2", "ma_sombra", 0.10),
    "cerrado": ("ce_chao", "ce_chao2", "ce_arvore", 0.12), "savana": ("ce_chao2", "ce_capim", "ce_arvore", 0.08),
    "caatinga": ("ca_chao", "ca_chao2", "ca_mato", 0.10), "pantanal": ("pa_chao", "pa_chao2", "pa_capim", 0.10),
    "pampa": ("pp_chao", "pp_chao2", "pp_tufo", 0.08), "altiplano": ("an_chao", "an_chao2", "an_pedra", 0.10),
    "estepe": ("es_chao", "ce_chao", "ce_seco", 0.10), "deserto": ("areia", "duna", "ca_claro", 0.06),
    "taiga": ("pp_arau", "pp_arau_luz", "am_chao2", 0.10), "tundra": ("tu_chao", "tu_chao2", "mn_luz", 0.06),
    "gelo": ("gelo", "gelo2", "gelo_sombra", 0.05),
}
# as serras: (luz, meio, sombra) da rocha e da neve; no deserto a rocha é a quente do mapa
SERRAS = {"neve": ("mn_luz", "mn_meio", "mn_sombra"), "rocha": ("mn_luz", "mn_meio", "mn_sombra"),
          "verde": ("mv_luz", "mv_meio", "mv_sombra")}
ROCHA_QUENTE, NEVE = ("mr_luz", "mr_meio", "mr_sombra"), ("mn_neve", "mn_neve", "mn_neve_sombra")
AGUA = {"mar", "mar_fundo", "raso", "raso_claro"}
# os biomas do Brasil (biomas.json) no globo
DO_BRASIL = {"amazonia": "floresta", "mata-atlantica": "mata", "cerrado": "cerrado", "caatinga": "caatinga",
             "pantanal": "pantanal", "pampa": "pampa", "andes": "altiplano", "araucarias": "mata"}

_usadas = sorted({n for e in ESTILOS.values() for n in e[:3]} | {n for p in SERRAS.values() for n in p}
                 | set(ROCHA_QUENTE) | set(NEVE) | AGUA)
PALETA = {n: NOVAS.get(n) or CORES[n] for n in _usadas}   # nome -> '#rrggbb', na ordem dos índices do PNG


def cores_da_classe(classe):
    """As cores '#rrggbb' de uma classe do chão, ou das serras ('rocha', 'neve')."""
    nomes = {"rocha": SERRAS["rocha"] + ROCHA_QUENTE + SERRAS["verde"], "neve": NEVE}.get(classe) or ESTILOS[classe][:3]
    return {PALETA[n] for n in nomes}


def _distancia(dentro, w, h, limite):
    """Para cada índice com dentro[i], a distância (euclidiana, quase exata: cada pixel herda o ponto de fora mais perto
    do vizinho) até o pixel mais perto fora, até `limite`; fora, 0. A longitude dá a volta."""
    dist = [0.0 if not d else float(limite) for d in dentro]
    fonte = [(i % w, i // w) if not dentro[i] else None for i in range(w * h)]
    fila = deque(i for i in range(w * h) if not dentro[i])
    while fila:
        i = fila.popleft()
        fx, fy = fonte[i]
        x, y = i % w, i // w
        for dy in (-1, 0, 1):
            ny = y + dy
            if not 0 <= ny < h:
                continue
            for dx in (-1, 0, 1):
                nx = (x + dx) % w
                j = ny * w + nx
                ex = min(abs(nx - fx), w - abs(nx - fx))
                d = (ex * ex + (ny - fy) ** 2) ** 0.5
                if d < dist[j] and d < limite:
                    dist[j], fonte[j] = d, (fx, fy)
                    fila.append(j)
    return dist


def _padrao(lat):
    """A classe da terra fora de todos os polígonos, pela faixa de latitude."""
    if lat > 58:
        return "tundra"
    if lat > 23 or lat < -23:
        return "mata"
    return "savana"


def _classes(terra, brasil, biomas, w, h):
    """A classe de cada pixel de terra: gelo nos polos, o Brasil, os polígonos e a faixa; a borda deformada por ruído
    (até uns 7 px: 4,5 da escala grande, 1,5 da pequena e 1 do Bayer) e passada em pontilhado de Bayer."""
    N, base = w * h, [None] * (w * h)
    for nome, pixels in brasil + biomas:
        for x, y in pixels:
            i = y * w + x
            if terra[i] and base[i] is None:
                base[i] = nome
    for i in range(N):
        if terra[i]:
            x, y = i % w, i // w
            lat = 90 - (y + 0.5) * 180 / h + (_ruido(x, y, 7, 21) - 0.5) * 4
            if lat < -60 or lat > 77:
                base[i] = "gelo"
            elif base[i] is None:
                base[i] = _padrao(lat)
    classe = list(base)
    for i in range(N):
        if not terra[i]:
            continue
        x, y = i % w, i // w
        o = _bayer(x, y)
        sx = (x + round((_ruido(x, y, 14, 23) - 0.5) * 9 + (_ruido(x, y, 4, 25) - 0.5) * 3 + (o * 4 % 1 - 0.5) * 2)) % w
        sy = y + round((_ruido(x, y, 14, 24) - 0.5) * 9 + (_ruido(x, y, 4, 26) - 0.5) * 3 + (o - 0.5) * 2)
        if 0 <= sy < h and base[sy * w + sx] is not None:
            classe[i] = base[sy * w + sx]
    return classe


def _crista(x, y):
    """Ruído de cristas (0 a 1): linhas altas e vales estreitos, em duas escalas."""
    return (1 - abs(2 * _ruido(x, y, 2.6, 31) - 1)) * 0.6 + (1 - abs(2 * _ruido(x, y, 1.3, 32) - 1)) * 0.4


def _perfis(terra, classe, serras, w, h):
    """O perfil (0 a 1) das serras: 1 no eixo da linha e 0 na largura; o tipo da serra no pixel; e se ela é um maciço
    (largura de 5 px ou mais, como o Himalaia), nevado de ponta a ponta."""
    perfil, tipo, macico = [0.0] * (w * h), [None] * (w * h), [False] * (w * h)
    for s in serras:
        larg = s["largura"] * 1.3
        for (x0, y0), (x1, y1) in zip(s["linha"], s["linha"][1:]):
            dx, dy = x1 - x0, y1 - y0
            seg = dx * dx + dy * dy or 1
            for y in range(int(min(y0, y1) - larg) - 1, int(max(y0, y1) + larg) + 2):
                for x in range(int(min(x0, x1) - larg) - 1, int(max(x0, x1) + larg) + 2):
                    if not 0 <= y < h:
                        continue
                    i = y * w + x % w
                    if not terra[i] or classe[i] == "gelo":
                        continue
                    t = max(0.0, min(1.0, ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / seg))
                    d = ((x + 0.5 - x0 - t * dx) ** 2 + (y + 0.5 - y0 - t * dy) ** 2) ** 0.5 / larg
                    if d >= 1:
                        continue
                    if 1 - d > perfil[i]:
                        perfil[i], tipo[i], macico[i] = 1 - d, s["tipo"], s["largura"] >= 5
    return perfil, tipo, macico


def desenhar(terra, brasil, biomas, serras, w, h):
    """O terra.png em nomes da PALETA (um por pixel, linha a linha). terra: lista de bool; brasil e biomas: listas
    (classe, pixels) na ordem de precedência; serras: {tipo, largura, linha} em pixels."""
    classe = _classes(terra, brasil, biomas, w, h)
    perfil, tipo, macico = _perfis(terra, classe, serras, w, h)
    da_terra = _distancia(terra, w, h, 3)
    do_mar = _distancia([not t for t in terra], w, h, 20)
    cor = ["mar"] * (w * h)
    for i in range(w * h):
        x, y = i % w, i // w
        lat, t = 90 - (y + 0.5) * 180 / h, _bayer(x, y)
        if not terra[i]:
            d = do_mar[i]
            gelo = lat + (_ruido(x, y, 6, 41) - 0.5) * 6
            if gelo > 80 or (gelo > 78 and t < (gelo - 78) / 2) or (lat < -64 and d <= 2 and _h(x, y, 42) < 0.7):
                cor[i] = "gelo2" if _ruido(x, y, 3, 43) > 0.55 else "gelo"
            elif d + t <= 2.0:
                cor[i] = "raso_claro"
            elif d + 1.5 * t <= 4.6:
                cor[i] = "raso"
            elif d > 12 + 6 * _ruido(x, y, 18, 44) + 3 * t:
                cor[i] = "mar_fundo"
            continue
        c = classe[i]
        if c == "gelo" and lat > 0 and da_terra[i] <= 1:   # a costa da Groenlândia e das ilhas do Ártico, de rocha
            c = "tundra"
        c1, c2, c3, chance = ESTILOS[c]
        v = _ruido(x, y, 6, 3) * 0.7 + _ruido(x, y, 2.5, 4) * 0.3
        nome = c2 if v > 0.42 + 0.16 * t else c1
        if c == "deserto" and (x + 2 * y + int(_ruido(x, y, 8, 5) * 9)) % 6 == 0:   # dunas em listras
            nome = "duna"
        if _h(x, y, 5) < chance:
            nome = c3
        forca = perfil[i] * (0.55 + 0.9 * _ruido(x, y, 5, 33))   # a borda da serra, recortada
        if forca > 0.42:   # cristas com luz a noroeste e sombra a sudeste, o meio no alto e neve nos picos
            s = _crista(x + 1, y + 1) - _crista(x - 1, y - 1)
            alto = min(1.0, forca) * (0.55 + 0.45 * _crista(x, y))
            pico = perfil[i] * (0.6 + 0.4 * _crista(x, y)) + (_h(x, y, 6) - 0.5) * 0.08   # neve no eixo, com vales
            trecho = macico[i] or (_ruido(x, y, 5, 48) > 0.6 and pico > 0.74)   # nas serras estreitas, só nos picos altos
            neve = tipo[i] == "neve" and trecho and pico > (0.6 if abs(lat) > 45 else 0.66)
            tons = NEVE if neve else ROCHA_QUENTE if c in ("deserto", "estepe") and tipo[i] != "verde" else SERRAS[tipo[i]]
            if s > 0.09:
                nome = tons[0]
            elif s < -0.09:
                nome = tons[2]
            elif alto > 0.45 or neve:
                nome = tons[1]
        cor[i] = nome
    return cor
