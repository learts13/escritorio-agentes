"""O desenho do brasil.png: o mapa ilustrado em pixel art, a partir dos dados já em pixels (montar_mundo.py).

Camadas, de baixo para cima: o chão de cada bioma (dois tons em manchas, com a passagem entre biomas em pontilhado),
os glifos do bioma (copas, capim, cactos, poças, tufos, araucárias) empilhados de cima para baixo, os rios, as serras
(glifos de montanha com luz à esquerda e sombra à direita), a areia da costa, as divisas (a da UF um tom mais escuro do
chão, a do país forte), o mar (duas faixas rasas em pontilhado e ondas no fundo) e a vinheta na borda da caixa, que
some no mar de fora da imagem. Os vizinhos usam as mesmas cores, apagadas. Tudo sai de semente fixa na posição: o
mesmo dado dá sempre a mesma imagem. Água tem B > G e terra G >= B (o navegador separa as duas pela cor).
"""
import math
from collections import deque

ESTRANGEIRO = "--"
BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
VINHETA = 18      # pixels: até onde, na média, a borda da caixa some no mar de fora (com ruído, nunca em linha reta)
FORA = "mar_fundo"  # o mar além da imagem (o navegador pinta essa cor e as ondas fora dela)
NEVOA = ("nevoa", "nevoa_2")   # a névoa em que a terra esmaece na borda, antes do mar de fora
NEVOA_ESCURA, NEVOA_FORA = 0.22, 0.42   # na borda: acima de 0 a névoa clara, depois a escura, depois o mar
ESTRADA = {"estrada", "estrada_sombra"}   # as rodovias (só na camada de perto)
LARGOS = {"Amazonas", "Paraná", "São Francisco"}   # rios de 2 px
# a camada de perto: os glifos miúdos entre os grandes saem com MIUDO da chance da camada
MIUDO = 0.4

# as cores cheias (Brasil); cada uma ganha a versão apagada (vizinhos) e a da divisa de UF (mais escura; na Amazônia, o
# verde claro am_divisa, que lê sobre as copas escuras)
BASE = {
    "mar": "#1d3b5c", "mar_fundo": "#1a3452", "onda": "#26496d", "raso": "#2a5a7c", "raso_claro": "#3a7a99",
    "rio": "#56a2d2", "areia": "#dcc890", "fronteira": "#2a2217",
    "estrada": "#8b877d", "estrada_sombra": "#6a6558", "nevoa": "#7c8c98", "nevoa_2": "#4a6680",
    # só a 4x (refinar): a ponte, o asfalto (o mesmo cinza da linha de 2x) e a faixa da rodovia, a lavoura e o pasto perto
    # das cidades
    "ponte": "#c4bcaa", "lavoura": "#cdb65c", "lavoura_verde": "#9cb24f", "pasto": "#b4cc72",
    "terra_arada": "#9a7048", "asfalto": "#8b877d", "faixa": "#d9d3c1",
    # Amazônia: copas densas e escuras
    "am_chao": "#173d22", "am_chao2": "#1c4626", "am_sombra": "#22532b", "am_copa": "#2c6a32", "am_luz": "#41843a",
    "am_brilho": "#5f9e43", "am_divisa": "#93bd66",
    # Mata Atlântica: copas mais claras e recortadas
    "ma_chao": "#3b7a3c", "ma_chao2": "#468644", "ma_sombra": "#2e6836", "ma_copa": "#409046", "ma_luz": "#62ad55",
    "ma_brilho": "#8cc868",
    # Cerrado: capim amarelado e árvores tortas
    "ce_chao": "#a89f53", "ce_chao2": "#b5ab5c", "ce_capim": "#cdbf6b", "ce_seco": "#8e8743", "ce_arvore": "#5f7d37",
    "ce_arvore_luz": "#7d9a45", "ce_arvore_sombra": "#465f2b", "ce_tronco": "#6b4a2b",
    # Caatinga: chão seco alaranjado, mato e mandacarus
    "ca_chao": "#c28a4c", "ca_chao2": "#cd9757", "ca_claro": "#ddad6b", "ca_sombra": "#a3703e", "ca_mato": "#8a8b55",
    "ca_cacto": "#4b7639", "ca_cacto_luz": "#73a04a",
    # Pantanal: verde úmido com poças
    "pa_chao": "#5a9649", "pa_chao2": "#4e8842", "pa_capim": "#7db45b", "pa_margem": "#3d7238", "pa_poca": "#3f86ae",
    "pa_poca_luz": "#7cbadb",
    # Pampa: campo claro com tufos e as araucárias do planalto
    "pp_chao": "#93b85e", "pp_chao2": "#88ad56", "pp_tufo": "#b3d27b", "pp_tufo_sombra": "#6f9548", "pp_flor": "#e3d47c",
    "pp_arau": "#2a5532", "pp_arau_luz": "#3d7141", "pp_tronco": "#5d402b",
    # altiplano e puna (só nos vizinhos)
    "an_chao": "#a88c60", "an_chao2": "#b69b6c", "an_pedra": "#7c6446", "an_mato": "#7f8650", "an_sal": "#e2dccb",
    # chaco (só nos vizinhos): mato seco oliva com quebrachos, palmeiras carandá e esteros
    "ch_chao": "#9a9152", "ch_chao2": "#a79d5c", "ch_seco": "#c2b26c", "ch_copa": "#5d6f33", "ch_luz": "#7f8f42",
    "ch_sombra": "#424f25", "ch_tronco": "#5e4429", "ch_palma": "#6f8a3c", "ch_estero": "#4e8790", "ch_estero_luz": "#8cc0c8",
    # as serras do mapa de longe (os montes de 1x), nos tons das peças de relevo de perto (a troca 1x -> 2x não muda a cor
    # da serra): de mata com o cume de pedra, de rocha clara, com neve (sempre G >= B: a terra continua terra) e a chapada
    "mv_luz": "#4f8a3f", "mv_sombra": "#2c5a33", "mv_contorno": "#14261a", "mv_pico": "#a2a69e", "mv_pico_sombra": "#5c615c",
    "mr_luz": "#e2dec4", "mr_sombra": "#8a8474", "mr_contorno": "#2e2a24",
    "mn_luz": "#8aa6a6", "mn_sombra": "#566c6c", "mn_contorno": "#1e2626", "mn_neve": "#f3f4ef", "mn_neve_sombra": "#c9d0ce",
    "mc_luz": "#d86a3c", "mc_sombra": "#953c38", "mc_contorno": "#2e2826",
}
AGUA_BASE = {"mar", "mar_fundo", "onda", "raso", "raso_claro", "rio", "pa_poca", "pa_poca_luz", "ch_estero", "ch_estero_luz",
             *NEVOA}
CINZA = (112, 117, 106)   # para onde os vizinhos se apagam (G >= B: a terra continua terra)
APAGA, ESCURECE = 0.42, 0.74


def _rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def _hex(c):
    return "#%02x%02x%02x" % tuple(max(0, min(255, round(v))) for v in c)


# as cores que só o refino de 4x usa não ganham a versão da divisa (as divisas já vêm prontas do 2x); a lavoura e a ponte,
# só no Brasil, nem a apagada. A paleta do PNG tem no máximo 256 cores
SO_4X = {"ponte", "lavoura", "lavoura_verde", "pasto", "terra_arada", "asfalto", "faixa"}
SO_BRASIL = {"ponte", "lavoura", "lavoura_verde", "pasto", "terra_arada"}


def _paleta():
    cores = dict(BASE)
    for n, h in BASE.items():
        c = _rgb(h)
        if n not in SO_BRASIL:
            cores[n + "_ap"] = _hex([v * (1 - APAGA) + g * APAGA for v, g in zip(c, CINZA)])
        if n not in AGUA_BASE and n not in SO_4X:
            cores[n + "~"] = BASE["am_divisa"] if n.startswith("am_") else _hex([v * ESCURECE for v in c])
    return cores


CORES = _paleta()   # nome -> '#rrggbb', na ordem dos índices do PNG
AGUA = {n for n in CORES if n.split("_ap")[0].rstrip("~") in AGUA_BASE}
PREFIXO = {"amazonia": "am_", "mata-atlantica": "ma_", "cerrado": "ce_", "caatinga": "ca_", "pantanal": "pa_",
           "pampa": "pp_", "andes": "an_", "chaco": "ch_"}
assert len(CORES) <= 256, "a paleta do PNG tem no máximo 256 cores"


def cores_do_bioma(bioma):
    """As cores cheias (e a versão da divisa) do bioma, em '#rrggbb'."""
    p = PREFIXO[bioma]
    return {h for n, h in CORES.items() if n.startswith(p) and "_ap" not in n}


def cores_apagadas():
    return {h for n, h in CORES.items() if "_ap" in n}


# --- ruído e sementes -------------------------------------------------------------------------------------------------
def _h(x, y, s):
    """Número em [0, 1) fixo para (x, y, s)."""
    n = (x * 374761393 + y * 668265263 + s * 1442695041) & 0xffffffff
    n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
    return ((n ^ (n >> 16)) & 0xffffffff) / 4294967296


def _ruido(x, y, passo, s):
    """Ruído de valor suave (manchas de `passo` pixels)."""
    fx, fy = x / passo, y / passo
    x0, y0 = int(fx), int(fy)
    ax, ay = fx - x0, fy - y0
    ax, ay = ax * ax * (3 - 2 * ax), ay * ay * (3 - 2 * ay)
    a, b = _h(x0, y0, s), _h(x0 + 1, y0, s)
    c, d = _h(x0, y0 + 1, s), _h(x0 + 1, y0 + 1, s)
    return (a + (b - a) * ax) + ((c + (d - c) * ax) - (a + (b - a) * ax)) * ay


def _bayer(x, y):
    return (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16


# --- glifos: cada letra é um papel, trocado pela cor do bioma; "." é vazio ---------------------------------------------
COPA_G = [".bll.", "blccs", "lccss", ".css."]
COPA_M = [".bl.", "lccs", ".ss."]
COPA_GG = ["..bll..", ".bllcc.", "blcccss", "lcccsss", ".cssss."]
COPA_MATA = [".bl.", "lccs", "lcss", ".ss."]
COPA_MATA_P = [".l.", "lcs", ".s."]
ARVORE_CERRADO = [".ll..", "lccs.", ".sst.", "...t."]
ARVORE_CERRADO_2 = ["..ll.", ".lccs", "lcs..", ".t...", ".t..."]
TUFO = ["k.k", ".d."]
CAPIM = ["k.k.k"]
CACTO = ["..a..", "a.ab.", "a.a.b", ".aab.", "..ab.", "..a.."]
CACTO_P = [".a.", "aab", ".ab", ".a."]
MATO = ["mm", "s."]
POCA_G = [".mppm.", "mpLppm", ".mppm."]
POCA_M = ["mpLm", ".mm."]
ARAUCARIA = [".lllll.", "aaaaaaa", "..lll..", ".aaaaa.", "...t...", "...t..."]
PEDRA = [".p", "pp"]
ARBUSTO = [".m.", "mms"]
SALAR = [".ss..", "sssss", ".sss."]
QUEBRACHO = [".llll.", "lcccss", ".ssss.", "..tt..", "..t..."]   # copa chata de guarda-chuva
CARANDA = ["p.l.p", ".plp.", "..t..", "..t..", "..t.."]            # a palmeira do chaco
ESTERO = [".mmmm.", "meEeem", ".meem."]                             # o banhado raso

# por bioma: as cores dos papéis e as camadas de glifos (célula da grade, chance, glifos)
ESTILOS = {
    "amazonia": {"papeis": {"b": "am_brilho", "l": "am_luz", "c": "am_copa", "s": "am_sombra"},
                 "manchas": ("am_chao", "am_chao2", None),
                 "camadas": [((4, 3), 0.97, [COPA_G, COPA_M, COPA_GG, COPA_G])]},
    "mata-atlantica": {"papeis": {"b": "ma_brilho", "l": "ma_luz", "c": "ma_copa", "s": "ma_sombra"},
                       "manchas": ("ma_chao", "ma_chao2", None),
                       "camadas": [((5, 4), 0.8, [COPA_MATA, COPA_MATA_P, COPA_M])]},
    "cerrado": {"papeis": {"l": "ce_arvore_luz", "c": "ce_arvore", "s": "ce_arvore_sombra", "t": "ce_tronco",
                           "k": "ce_capim", "d": "ce_seco"},
                "manchas": ("ce_chao", "ce_chao2", "ce_capim"),
                "camadas": [((5, 4), 0.55, [TUFO, CAPIM]), ((10, 8), 0.5, [ARVORE_CERRADO, ARVORE_CERRADO_2])]},
    "caatinga": {"papeis": {"a": "ca_cacto_luz", "b": "ca_cacto", "m": "ca_mato", "s": "ca_sombra"},
                 "manchas": ("ca_chao", "ca_chao2", "ca_claro"),
                 "camadas": [((5, 4), 0.5, [MATO]), ((11, 9), 0.6, [CACTO, CACTO_P])]},
    "pantanal": {"papeis": {"m": "pa_margem", "p": "pa_poca", "L": "pa_poca_luz", "k": "pa_capim", "d": "pa_margem"},
                 "manchas": ("pa_chao", "pa_chao2", "pa_capim"),
                 "camadas": [((5, 4), 0.45, [TUFO]), ((9, 7), 0.6, [POCA_G, POCA_M])]},
    "pampa": {"papeis": {"k": "pp_tufo", "d": "pp_tufo_sombra", "a": "pp_arau", "l": "pp_arau_luz", "t": "pp_tronco"},
              "manchas": ("pp_chao", "pp_chao2", "pp_flor"),
              "camadas": [((5, 4), 0.55, [TUFO, CAPIM])]},
    "andes": {"papeis": {"p": "an_pedra", "m": "an_mato", "s": "an_sal"}, "manchas": ("an_chao", "an_chao2", "an_pedra"),
              "camadas": [((5, 4), 0.55, [PEDRA, ARBUSTO, PEDRA]), ((23, 19), 0.35, [SALAR])]},
    "chaco": {"papeis": {"l": "ch_luz", "c": "ch_copa", "s": "ch_sombra", "t": "ch_tronco", "p": "ch_palma", "k": "ch_seco",
                         "d": "ch_sombra", "m": "ch_sombra", "e": "ch_estero", "E": "ch_estero_luz"},
              "manchas": ("ch_chao", "ch_chao2", "ch_seco"),
              "camadas": [((5, 4), 0.45, [TUFO, CAPIM]), ((7, 6), 0.6, [QUEBRACHO, QUEBRACHO, CARANDA]),
                          ((19, 14), 0.45, [ESTERO])]},
}
ARAUCARIAS = ((7, 6), 0.75, [ARAUCARIA])
ONDA = [".ww..", "w..ww"]
SERRA_CORES = {"verde": ("mv_luz", "mv_sombra", "mv_contorno", "mv_pico", "mv_pico_sombra"),
               "rocha": ("mr_luz", "mr_sombra", "mr_contorno", "mr_luz", "mr_sombra"),
               "neve": ("mn_luz", "mn_sombra", "mn_contorno", "mn_neve", "mn_neve_sombra"),
               "mesa": ("mc_luz", "mc_sombra", "mc_contorno", "mc_luz", "mc_sombra")}


def montanha(alto, mesa=False):
    """Glifo de montanha com `alto` linhas: contorno escuro em cima, luz à esquerda, sombra à direita e o cume com
    neve (N/M). Mesa: o topo chato da chapada."""
    meio, linhas = alto - 1, []
    topo = alto // 2 if mesa else 0
    for r in range(alto):
        a = max(r, topo)
        s = ""
        for c in range(2 * alto - 1):
            d = c - meio
            if abs(d) > a:
                s += "."
            elif (abs(d) == a or (mesa and r == topo and topo)) and r < alto - 1:
                s += "o"
            else:
                neve = r <= alto * 0.4 and not mesa
                luz = d <= -(r // 3)
                if alto >= 10 and not mesa and r > alto * 0.4:   # as grandes (de perto): uma aresta clara na face da sombra
                    if d == r // 2 + 1 and r < alto - 1:          # e um sulco escuro na face da luz
                        luz = True
                    elif d == -(r * 2 // 3) and r > alto * 0.55:
                        luz = False
                s += ("N" if neve else "L") if luz else ("M" if neve else "S")
        linhas.append(s if r >= topo or not mesa else "." * (2 * alto - 1))
    return [l for l in linhas if l.strip(".")]


_DOBROS = {}


def _dobro(glifo):
    """O glifo no dobro por Scale2x (EPX): cada pixel vira 2x2 e a quina vira a cor dos dois vizinhos iguais dela. O
    desenho e as cores ficam os mesmos; as diagonais saem em degraus de 1 px, não de 2."""
    chave = tuple(glifo)
    if chave in _DOBROS:
        return _DOBROS[chave]
    alto, largo = len(glifo), len(glifo[0])
    em = lambda x, y: glifo[y][x] if 0 <= x < largo and 0 <= y < alto else "."
    linhas = []
    for y in range(alto):
        cima, baixo = "", ""
        for x in range(largo):
            p, a, b, c, d = em(x, y), em(x, y - 1), em(x + 1, y), em(x - 1, y), em(x, y + 1)
            cima += (a if c == a and c != d and a != b else p) + (b if a == b and a != c and b != d else p)
            baixo += (c if d == c and d != b and c != a else p) + (d if b == d and b != a and d != c else p)
        linhas += [cima, baixo]
    _DOBROS[chave] = linhas
    return linhas


# --- o desenho ---------------------------------------------------------------------------------------------------------
def _distancia(dentro, w, h):
    """Para cada índice com dentro[i], passos (8 vizinhos) até o pixel mais perto fora; fora, 0."""
    dist, fila = [0] * (w * h), deque()
    for i in range(w * h):
        if not dentro[i]:
            fila.append(i)
    visto = [not d for d in dentro]
    while fila:
        i = fila.popleft()
        x, y = i % w, i // w
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and not visto[ny * w + nx]:
                    visto[ny * w + nx] = True
                    dist[ny * w + nx] = dist[i] + 1
                    fila.append(ny * w + nx)
    return dist


def _biomas(terra, biomas, w, h, f=1):
    """O bioma de cada pixel de terra: o primeiro polígono que o contém ou, fora de todos, o mais perto (pela terra).
    f: a escala da imagem sobre o mapa de longe (as manchas grandes seguem o mapa de longe; o grão fica mais fino)."""
    bioma, fila = [None] * (w * h), deque()
    for nome, pixels in biomas:
        for x, y in sorted(pixels):
            i = y * w + x
            if 0 <= x < w and 0 <= y < h and terra[i] and bioma[i] is None:
                bioma[i] = nome
    fila.extend(i for i in range(w * h) if bioma[i] is not None)
    while fila:
        i = fila.popleft()
        x, y = i % w, i // w
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and terra[ny * w + nx] and bioma[ny * w + nx] is None:
                bioma[ny * w + nx] = bioma[i]
                fila.append(ny * w + nx)
    # a passagem: cada pixel pega o bioma de um ponto deslocado por ruído suave (a divisa ondula, sem linha reta nem de
    # polígono) e por um sorteio fixo de ±2 px (o pontilhado, sem a faixa regular de uma matriz)
    misto = list(bioma)
    for y in range(h):
        for x in range(w):
            sx = x + round((_ruido(x / f, y / f, 16, 21) - 0.5) * 22 * f) + int(_h(x, y, 23) * 5) - 2
            sy = y + round((_ruido(x / f, y / f, 16, 22) - 0.5) * 22 * f) + int(_h(x, y, 24) * 5) - 2
            if terra[y * w + x] and 0 <= sx < w and 0 <= sy < h and bioma[sy * w + sx] is not None:
                misto[y * w + x] = bioma[sy * w + sx]
    return misto


def linha(x0, y0, x1, y1):
    """Pixels de (x0, y0) a (x1, y1) (Bresenham)."""
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
    erro, pontos = dx + dy, []
    while True:
        pontos.append((x0, y0))
        if x0 == x1 and y0 == y1:
            return pontos
        e2 = 2 * erro
        if e2 >= dy:
            erro += dy
            x0 += sx
        if e2 <= dx:
            erro += dx
            y0 += sy


def _ao_longo(linha, passo):
    """Pontos a cada `passo` pixels sobre a polilinha (em pixels), com a direção do trecho."""
    pontos, sobra = [], 0.0
    for (x0, y0), (x1, y1) in zip(linha, linha[1:]):
        seg = ((x1 - x0) ** 2 + (y1 - y0) ** 2) ** 0.5
        if not seg:
            continue
        t = sobra
        while t <= seg:
            pontos.append((x0 + (x1 - x0) * t / seg, y0 + (y1 - y0) * t / seg, (x1 - x0) / seg, (y1 - y0) / seg))
            t += passo
        sobra = t - seg
    return pontos


def desenhar(rotulo, biomas, extras, serras, rios, w, h, escala=1, estradas=(), afluentes=(), paises=None, registro=None):
    """O mapa em índices da paleta CORES. rotulo: (x, y) -> UF ou ESTRANGEIRO (ausente é mar); biomas: lista
    (nome, pixels) na ordem de precedência; extras: nome -> pixels ('araucarias', 'andes', 'chaco'); serras: lista de
    {tipo, linhas, picos, forma} em pixels; rios: lista (nome, linhas) em pixels; paises: (x, y) -> país do vizinho
    (para a divisa entre dois vizinhos), opcional.
    escala: 1 é o brasil.png (o mapa de longe); 2 é a camada de perto, o mesmo mapa no dobro da resolução: as manchas
    grandes (biomas, chão, mar fundo, borda) seguem o ruído do mapa de longe, e o detalhe (glifos, rios, serras,
    costa, divisas) sai na resolução nova, mais denso. Só ela leva as rodovias e os rios menores (afluentes).
    registro: um dict que, se vier, recebe os objetos do desenho para o refino de 4x (refinar): o chão (nomes por pixel,
    antes dos glifos), os carimbos (pé, centro, desenho, papéis, glifo original, escala), as serras (para as peças de
    relevo) e as rodovias."""
    f = escala
    N = w * h
    estado = [0] * N   # 0 mar, 1 Brasil, 2 vizinho
    uf = [None] * N
    for (x, y), r in rotulo.items():
        if 0 <= x < w and 0 <= y < h:
            estado[y * w + x] = 2 if r == ESTRANGEIRO else 1
            uf[y * w + x] = r
    terra = [e > 0 for e in estado]
    fora_do_brasil = lambda nome: {p for p in extras.get(nome, ()) if rotulo.get(p) == ESTRANGEIRO}
    bioma = _biomas(terra, [("andes", fora_do_brasil("andes")), ("chaco", fora_do_brasil("chaco"))] + biomas, w, h, f)
    arau = [False] * N
    for x, y in extras.get("araucarias", ()):   # só no Brasil: na Argentina, a beira reta do polígono (lon -54) apareceria
        if 0 <= x < w and 0 <= y < h and estado[y * w + x] == 1:
            arau[y * w + x] = True
    cor = ["mar"] * N

    def por(i, nome):   # a cor no pixel, apagada nos vizinhos
        cor[i] = nome + "_ap" if estado[i] == 2 else nome

    # 1. o chão: dois tons em manchas, com pontilhado entre eles, e uns pontos de um terceiro tom
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not terra[i]:
                continue
            b = "pampa" if arau[i] and bioma[i] in ("mata-atlantica", "pampa") else bioma[i]
            c1, c2, c3 = ESTILOS[b]["manchas"]
            v = _ruido(x / f, y / f, 14, 3) * 0.7 + _ruido(x, y, 5, 4) * 0.3
            nome = c2 if v > 0.42 + 0.16 * _bayer(x, y) else c1
            if c3 and _h(x, y, 5) < 0.07:
                nome = c3
            por(i, nome)
    if registro is not None:
        registro["chao"], registro["estradas"] = cor[:], estradas

    # 2. os glifos dos biomas, de cima para baixo (a copa de baixo cobre a de cima). De perto, a mesma grade nos mesmos
    # lugares (vezes f), com cada glifo no dobro, redesenhado por Scale2x (o mesmo desenho, de beira mais fina): a troca
    # de camada não pula. Entre eles, uma grade de glifos miúdos (os de longe, no tamanho deles, com MIUDO da chance):
    # o detalhe que só aparece de perto
    carimbos = []

    def semear(celula, chance, glifos, s, m, papeis, aqui, sementes=None):
        """Uma grade de glifos: célula `celula` em pixels de longe vezes m; sementes (x, y, chance, glifo) fixas."""
        cw, ch = celula
        sx, sy, sc, sg = sementes or (s, s + 7, s + 13, s + 17)
        for gy in range(-1, h // (ch * m) + 2):
            for gx in range(-1, w // (cw * m) + 2):
                ax, ay = (gx * cw + int(_h(gx, gy, sx) * cw)) * m, (gy * ch + int(_h(gx, gy, sy) * ch)) * m
                if not (0 <= ax < w and 0 <= ay < h) or not terra[ay * w + ax] or not aqui(ay * w + ax):
                    continue
                if _h(gx, gy, sc) > chance * (0.95 if estado[ay * w + ax] == 2 and sg is not None else 1):
                    continue
                g = glifos[int(_h(gx, gy, sg) * len(glifos))] if sg is not None else glifos[0]
                carimbos.append((ay, ax, g if m == 1 else _dobro(g), papeis, g, m))

    def do_bioma(nome):
        return lambda i: ("pampa" if arau[i] and bioma[i] in ("mata-atlantica", "pampa") else bioma[i]) == nome
    for nome, estilo in ESTILOS.items():
        for k, (celula, chance, glifos) in enumerate(estilo["camadas"]):
            s = len(nome) * 31 + k   # semente da camada
            semear(celula, chance, glifos, s, f, estilo["papeis"], do_bioma(nome))
            if f > 1:
                semear(celula, chance * MIUDO, glifos, s + 500, 1, estilo["papeis"], do_bioma(nome))
    celula, chance, glifos = ARAUCARIAS
    semear(celula, chance, glifos, 91, f, ESTILOS["pampa"]["papeis"], lambda i: arau[i], sementes=(91, 92, 93, None))
    if registro is not None:
        registro["carimbos"] = carimbos
    for ay, ax, g, papeis, _, _ in sorted(carimbos, key=lambda c: (c[0] + len(c[2]), c[1])):   # pelo pé do glifo
        for dy, fileira in enumerate(g):
            for dx, letra in enumerate(fileira):
                x, y = ax + dx - len(fileira) // 2, ay + dy
                if letra != "." and 0 <= x < w and 0 <= y < h and terra[y * w + x]:
                    por(y * w + x, papeis[letra])

    # 3. os rios, por cima da terra (os três largos com 2 px de longe; tudo na largura vezes a escala); de perto, os rios
    # menores em 1 px
    def tracar(linhas, largura, nome):
        for traco in linhas:
            for (x0, y0), (x1, y1) in zip(traco, traco[1:]):
                a, b = (int(x0), int(y0)), (int(x1), int(y1))
                deitado = abs(b[0] - a[0]) >= abs(b[1] - a[1])
                for x, y in linha(*a, *b):
                    for k in range(largura):
                        px, py = (x, y + k) if deitado else (x + k, y)
                        if 0 <= px < w and 0 <= py < h and terra[py * w + px]:
                            yield py * w + px
    for nome, linhas in afluentes:
        for i in tracar(linhas, 1, nome):
            por(i, "rio")
    for nome, linhas in rios:
        for i in tracar(linhas, (2 if " ".join(nome.split()) in LARGOS else 1) * f, nome):
            por(i, "rio")

    # 4. as rodovias (só de perto): 1 px claro com a sombra embaixo; passam por cima dos rios (a ponte)
    via = [False] * N
    for linhas in estradas:
        for i in tracar(linhas, 1, ""):
            via[i] = True
    for i in range(N):
        if via[i]:
            por(i, "estrada")
            if i + w < N and terra[i + w] and not via[i + w] and cor[i + w].split("_ap")[0] != "rio":
                por(i + w, "estrada_sombra")

    # 5. as serras: no mapa de longe, fileiras de montanhas, de cima para baixo; de perto (2x e 4x), as peças de relevo
    # pintadas, carimbadas por cima do mapa pronto (carimbar_relevo), nos mesmos lugares nos dois níveis
    if registro is not None:
        registro["serras"] = serras
    montes = []
    for serra in serras if f == 1 else ():
        mesa = serra.get("forma") == "mesa"
        for k, fileira in enumerate(serra["linhas"]):
            grande = serra["tipo"] == "neve"
            for j, (x, y, ux, uy) in enumerate(_ao_longo(fileira, 4.0 if grande else 5.0)):
                if grande:   # os Andes: picos de 4 a 8 linhas, uns fora da fila e outros faltando (nada de zíper)
                    if _h(j, k, 60) < 0.15:
                        continue
                    alto = 4 + int(_h(j, k, 61) ** 1.5 * 5)
                    lado, ao_longo = (_h(j, k, 63) - 0.5) * 7, (_h(j, k, 64) - 0.5) * 2.5
                else:
                    alto, lado, ao_longo = (6 if _h(j, k, 62) < 0.4 else 5), (1 if j % 2 else -1) * 1.5, 0
                montes.append((x - uy * lado + ux * ao_longo, y + ux * lado + uy * ao_longo, montanha(alto, mesa), familia(serra)))
        for x, y in serra.get("picos", ()):
            montes.append((x, y, montanha(9), serra["tipo"]))
    for x, y, g, tipo in sorted(montes, key=lambda m: (round(m[1]), round(m[0]))):
        luz, sombra, contorno, neve, neve_sombra = SERRA_CORES[tipo]
        papel = {"L": luz, "S": sombra, "o": contorno, "N": neve, "M": neve_sombra}
        x0, y0 = round(x) - len(g[0]) // 2, round(y) - len(g) + 1
        for dy, fileira in enumerate(g):
            for dx, c in enumerate(fileira):
                px, py = x0 + dx, y0 + dy
                if c != "." and 0 <= px < w and 0 <= py < h and terra[py * w + px]:
                    if tipo == "neve":   # os Andes com neve ficam em tons cheios: são o marco da borda oeste
                        cor[py * w + px] = papel[c]
                    else:
                        por(py * w + px, papel[c])

    # 6. a areia da costa (1 px) e 7. as divisas: a da UF, um tom mais escuro do chão; a do país, forte (f px); a entre
    # dois vizinhos, pontilhada no tom apagado
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if not terra[i]:
                continue
            viz = [(x + dx, y + dy) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))]
            if any(0 <= vx < w and 0 <= vy < h and not terra[vy * w + vx] for vx, vy in viz):
                if cor[i].split("_ap")[0] != "rio":
                    por(i, "areia")
                continue
            if estado[i] == 1:
                perto = [(x + dx * k, y + dy * k) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) for k in range(1, f + 1)]
                if any(estado[vy * w + vx] == 2 for vx, vy in perto if 0 <= vx < w and 0 <= vy < h):
                    cor[i] = "fronteira"
                elif any(0 <= vx < w and 0 <= vy < h and estado[vy * w + vx] == 1 and uf[vy * w + vx] != uf[i]
                         for vx, vy in viz[0::2]) and cor[i] not in AGUA:
                    cor[i] = cor[i] + "~"
            elif paises and (x // f + y // f) % 2 == 0 and cor[i] not in AGUA:
                meu = paises.get((x, y))
                if meu and any(paises.get(v, meu) != meu for v in viz[0::2] if 0 <= v[0] < w and 0 <= v[1] < h
                               and estado[v[1] * w + v[0]] == 2):
                    cor[i] = "fronteira_ap"

    # 8. o mar: duas faixas rasas em pontilhado junto da costa, ondas no fundo e o alto-mar um pouco mais escuro
    do_mar = _distancia([not t for t in terra], w, h)
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if terra[i]:
                continue
            d, t = do_mar[i], _bayer(x, y)
            if d <= f or (d <= 2 * f and t < 0.5):
                cor[i] = "raso_claro"
            elif d <= 4 * f or (d <= 5 * f and t < 0.5) or (d <= 6 * f and t < 0.25):
                cor[i] = "raso"
            elif d > (24 + 8 * _ruido(x / f, y / f, 30, 8) + 4 * t) * f:
                cor[i] = "mar_fundo"
            else:
                cor[i] = "mar"
    onda = ONDA if f == 1 else _dobro(ONDA)   # de perto, as mesmas ondas nos mesmos lugares, redesenhadas no dobro
    for gy in range(h // (7 * f) + 1):
        for gx in range(w // (11 * f) + 1):
            ax, ay = (gx * 11 + int(_h(gx, gy, 71) * 11)) * f, (gy * 7 + int(_h(gx, gy, 72) * 7)) * f
            if _h(gx, gy, 73) > 0.6:
                continue
            for dy, fileira in enumerate(onda):
                for dx, c in enumerate(fileira):
                    px, py = ax + dx, ay + dy
                    if c != "." and 0 <= px < w and 0 <= py < h and not terra[py * w + px] and do_mar[py * w + px] > 7 * f:
                        cor[py * w + px] = "onda"

    # 9. a borda: o mapa some no mar de fora da imagem (FORA) a uma distância que ondula com o ruído; a terra esmaece em
    # névoa (dois tons, em manchinhas) antes do mar, e nunca encosta nele; a terra do Brasil numa faixa estreita (o
    # litoral do Nordeste e as cidades dele ficam longe da borda); os 2 px de fora são só mar, iguais ao que o navegador
    # pinta além da imagem
    for y in range(h):
        for x in range(w):
            i = y * w + x
            e = min(x, y, w - 1 - x, h - 1 - y)
            alcance = VINHETA * f * (0.6 + 1.0 * _ruido(x / f, y / f, 19, 31))
            if estado[i] == 1:
                alcance = min(alcance, 7 * f)
            sorte = 0.75 * _ruido(x / f, y / f, 6, 34) + 0.25 * _h(x, y, 33)   # em manchas de névoa, não em grão solto
            nevoa = ((alcance - e) / alcance) ** 0.7 - sorte if e < alcance else -1
            raso = cor[i] in ("raso", "raso_claro")   # o raso da costa fica (a costa nunca encosta no mar de fora)
            if e < 2 * f or (not terra[i] and not raso and nevoa > 0) or (terra[i] and nevoa > NEVOA_FORA):
                cor[i] = FORA
            elif terra[i] and nevoa > NEVOA_ESCURA:
                cor[i] = "nevoa_2"
            elif terra[i] and nevoa > 0:
                cor[i] = "nevoa"
    for y in range(h):   # terra colada no mar de fora vira névoa escura (nunca um recorte seco de terra)
        for x in range(w):
            i = y * w + x
            if cor[i] not in AGUA and any(0 <= x + a < w and 0 <= y + b < h and cor[(y + b) * w + x + a] == FORA
                                          for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                cor[i] = "nevoa_2"

    indice = {n: k for k, n in enumerate(CORES)}
    return [indice[n] for n in cor]


# --- o terceiro nível (4x) ----------------------------------------------------------------------------------------------
# O mapa de 4x sai do de 2x dobrado por Scale2x (as mesmas formas grandes e cores: a troca de nível não pula). Em cima,
# o que só cabe nessa escala, nos mesmos lugares dos objetos do 2x e na mesma paleta, com semente fixa na posição: as
# árvores grandes e as serras redesenhadas (cada uma com forma, tamanho e tom próprios), as rodovias com acostamento,
# asfalto e faixa, pontes, margens e bancos de areia nos rios, o grão do chão e a lavoura em talhões perto das cidades
# do Centro-Sul.
LAVOURAS = ("lavoura", "lavoura_verde", "pasto", "terra_arada")
# os glifos de 2x redesenhados a 4x (os miúdos, cactos, tufos, poças e pedras seguem dobrados)
REDESENHO = {**dict.fromkeys(map(tuple, (COPA_G, COPA_M, COPA_GG, COPA_MATA, COPA_MATA_P)), "copa"),
             tuple(ARVORE_CERRADO): "cerrado", tuple(ARVORE_CERRADO_2): "cerrado", tuple(QUEBRACHO): "quebracho",
             tuple(CARANDA): "caranda", tuple(ARAUCARIA): "araucaria", tuple(CACTO): "cacto", tuple(CACTO_P): "cacto"}
CLAREIRA = 0.07   # a chance de uma copa da floresta não ser desenhada (fica o chão: a clareira)


def dobrar(indices, w, h):
    """A imagem em índices no dobro, por Scale2x (EPX), como _dobro faz com os glifos."""
    W, saida = 2 * w, [0] * (4 * w * h)
    for y in range(h):
        lin, cima, baixo = y * w, (y - 1) * w if y else y * w, (y + 1) * w if y < h - 1 else y * w
        for x in range(w):
            p, a, d = indices[lin + x], indices[cima + x], indices[baixo + x]
            c, b = indices[lin + x - 1] if x else p, indices[lin + x + 1] if x < w - 1 else p
            o = 2 * y * W + 2 * x
            saida[o] = a if c == a and c != d and a != b else p
            saida[o + 1] = b if a == b and a != c and b != d else p
            saida[o + W] = c if d == c and d != b and c != a else p
            saida[o + W + 1] = d if b == d and b != a and d != c else p
    return saida


def _bolhas(larg, alto, s, n):
    """Uma silhueta de copa: a união de n círculos sorteados dentro de larg×alto (semente s). Devolve (dentro(x, y), os
    círculos)."""
    bolas = [(larg / 2, alto * 0.55, min(larg, alto) * 0.42)]
    for k in range(n - 1):
        r = min(larg, alto) * (0.22 + 0.18 * _h(s, k, 301))
        bolas.append((r + (larg - 2 * r) * _h(s, k, 302), r + (alto - 2 * r) * _h(s, k, 303) * 0.8, r))
    return (lambda x, y: any((x - bx) ** 2 + (y - by) ** 2 <= br * br for bx, by, br in bolas)), bolas


def copa4(larg, alto, s, tom=0.0):
    """Uma copa a 4x, larg×alto: silhueta irregular de bolhas, luz de cima à esquerda em quatro tons (b, l, c, s), tufos de
    folha pelo ruído e a beira de baixo e da direita na sombra. tom > 0 clareia a copa inteira, < 0 escurece."""
    dentro, bolas = _bolhas(larg, alto, s, 3 + int(_h(s, 1, 304) * 3))
    linhas = []
    for y in range(alto):
        fila = ""
        for x in range(larg):
            px, py = x + 0.5, y + 0.5
            if not dentro(px, py):
                fila += "."
                continue
            bx, by, br = min(bolas, key=lambda b: (px - b[0]) ** 2 + (py - b[1]) ** 2 - b[2] ** 2)
            v = (-(px - bx) - (py - by)) / (br * 1.4) + (_ruido(x + s * 7, y, 2.5, 305) - 0.5) * 0.7 + tom
            borda = not dentro(px + 1, py) or not dentro(px, py + 1)
            fila += "s" if borda or v < -0.35 else "c" if v < 0.18 else "l" if v < 0.55 else "b"
        linhas.append(fila)
    return linhas


def cerrado4(larg, alto, s):
    """A árvore torta do cerrado a 4x: tronco que entorta (t) e a copa achatada (l, c, s) por cima, deslocada."""
    ac = max(4, alto // 2)
    copa = copa4(larg, ac, s, (_h(s, 3, 306) - 0.5) * 0.4)
    linhas = [f.replace("b", "l") for f in copa]
    x = larg // 2 + int((_h(s, 4, 307) - 0.5) * larg * 0.3)
    for y in range(alto - ac):
        if _h(s, y, 308) < 0.35:
            x += 1 if _h(s, y, 309) < 0.5 else -1
        x = max(1, min(larg - 2, x))
        linhas.append("." * x + "tt" + "." * (larg - x - 2))
    return linhas


def quebracho4(larg, alto, s):
    """O quebracho do chaco a 4x: copa larga e chata de guarda-chuva e o tronco reto."""
    ac = max(3, alto // 3)
    linhas = [f.replace("b", "l") for f in copa4(larg, ac, s, 0.1)]
    for y in range(alto - ac):
        linhas.append("." * (larg // 2 - 1) + "tt" + "." * (larg - larg // 2 - 1))
    return linhas


def caranda4(larg, alto, s):
    """A palmeira carandá a 4x: o estipe fino que curva e as folhas abertas em leque no alto (p, l)."""
    grade = [["."] * larg for _ in range(alto)]
    topo = alto // 3
    cx = larg // 2
    for k in range(6):   # as folhas: arcos que saem do topo e caem
        ang = -2.6 + k * 1.05 + (_h(s, k, 310) - 0.5) * 0.4
        comp = larg * (0.38 + 0.12 * _h(s, k, 311))
        for t in range(1, int(comp) + 1):
            x = round(cx + (t * (1 if ang > -1.57 else -1) * abs(math.cos(ang))))
            y = round(topo + t * math.sin(ang) + (t / comp) ** 2 * 3)
            if 0 <= x < larg and 0 <= y < alto:
                grade[y][x] = "l" if t < comp * 0.5 else "p"
    x = cx
    for y in range(topo, alto):
        if y > topo + 2 and _h(s, y, 312) < 0.2:
            x += 1 if _h(s, y, 313) < 0.5 else -1
        x = max(0, min(larg - 1, x))
        grade[y][x] = "t"
    return ["".join(f) for f in grade]


def mandacaru4(larg, alto, s):
    """O mandacaru a 4x: o tronco de 3 px (luz à esquerda, a, e sombra à direita, b) e de 1 a 3 braços que saem de lado e
    sobem, em alturas sorteadas; cada um com a sua altura e a sua forma."""
    grade = [["."] * larg for _ in range(alto)]
    cx = larg // 2 - 1
    for y in range(1, alto):
        for k, letra in enumerate("aab"):
            if 0 <= cx + k < larg:
                grade[y][cx + k] = letra
    grade[0][cx + 1] = "a"
    for k in range(1 + int(_h(s, 0, 360) * 3)):
        lado = -1 if (k + int(_h(s, 1, 361) * 2)) % 2 else 1
        y0 = int(alto * (0.35 + 0.4 * _h(s, k, 362)))
        dist = 2 + int(_h(s, k, 363) * max(1, larg // 2 - 3))
        x = cx + (3 if lado > 0 else -1)
        for d in range(dist):   # o braço sai de lado
            xx = x + lado * d
            if 0 <= xx < larg and 0 <= y0 < alto:
                grade[y0][xx] = "b" if lado > 0 else "a"
        xx = x + lado * (dist - 1)
        for y in range(max(0, y0 - int(alto * (0.25 + 0.25 * _h(s, k, 364)))), y0 + 1):   # e sobe
            for j, letra in enumerate("ab"):
                if 0 <= xx + j - (1 if lado < 0 else 0) < larg:
                    grade[y][xx + j - (1 if lado < 0 else 0)] = letra
    return ["".join(f) for f in grade]


def tamanho4(tipo, lw, lh, s):
    """O tamanho (largura, altura) do glifo de 4x de uma árvore cujo desenho de 2x tem lw×lh: o dobro, variado pela
    semente; a araucária (o glifo de 2x é largo) fica entre a metade e 3/4 dele, nunca mais larga que a copa da mata
    vizinha, e com alturas e copas variadas."""
    if tipo == "araucaria":
        return round(lw * (0.75 + 0.5 * _h(s, 0, 340))), round(lh * (1.0 + 0.8 * _h(s, 1, 341)))
    return round(2 * lw * (0.85 + 0.35 * _h(s, 0, 340))), round(2 * lh * (0.85 + 0.3 * _h(s, 1, 341)))


def araucaria4(larg, alto, s):
    """A araucária a 4x: tronco reto e a copa de candelabro, andares chatos que se abrem para cima (a, l), com o número
    de andares e a altura da copa pela semente."""
    grade = [["."] * larg for _ in range(alto)]
    cx, andares = larg // 2, 2 + int(_h(s, 1, 314) * 3)
    alto_copa = alto * (0.4 + 0.2 * _h(s, 2, 316))
    for k in range(andares):   # do alto para baixo: o andar de cima é o mais largo
        y = int(k * alto_copa / andares)
        meia = int(larg / 2 * (1 - k * 0.18) * (0.9 + 0.2 * _h(s, k, 315)))
        for dy in range(2):
            for x in range(cx - meia + dy, cx + meia - dy + 1):
                if 0 <= x < larg and 0 <= y + dy < alto:
                    grade[y + dy][x] = "l" if dy == 0 and x < cx + meia // 2 else "a"
    for y in range(int(alto_copa * 0.4), alto):
        for x in (cx, cx + 1):
            if grade[y][min(x, larg - 1)] == ".":
                grade[y][min(x, larg - 1)] = "t"
    return ["".join(f) for f in grade]


def _carimbar(cor, W, H, glifo, x0, y0, papel, pode):
    """Pinta o glifo com o canto em (x0, y0): cada letra vira o índice papel[letra], onde pode(i) deixar."""
    for dy, fila in enumerate(glifo):
        y = y0 + dy
        if not 0 <= y < H:
            continue
        for dx, letra in enumerate(fila):
            x = x0 + dx
            if letra != "." and 0 <= x < W and letra in papel and pode(y * W + x):
                cor[y * W + x] = papel[letra]


def refinar(indices, w, h, focos=(), objetos=None):
    """O nível de 4x (2w x 2h) a partir do de 2x (indices, w x h) e dos objetos dele (o registro de desenhar: chao,
    carimbos, estradas). Scale2x e então, de baixo para cima:
    1. as árvores grandes de 2x voltam ao chão (o chão de 2x dobrado) e as rodovias também;
    2. as árvores redesenhadas a 4x nos mesmos lugares (copas de forma, tamanho e tom próprios; clareiras na floresta;
       árvore torta do cerrado, quebracho, carandá e araucária reconhecíveis);
    3. as rodovias em 3 px de asfalto (o cinza da linha de 2x) com a faixa tracejada no meio; ponte sobre o rio;
    4. os rios com margem escura, o canal mais fundo no meio e bancos de areia nos largos; o grão do chão;
    5. a lavoura em talhões perto de cada foco (x, y, raio interno, raio externo, em pixels de 4x);
    6. as divisas, a areia da costa e os rios de 2x por cima de tudo, como no 2x.
    As serras não saem aqui: são as peças de relevo, carimbadas depois nos dois níveis (carimbar_relevo)."""
    W, H, N = 2 * w, 2 * h, 4 * w * h
    base = dobrar(indices, w, h)
    cor = base[:]
    nomes = list(CORES)
    ind = {n: k for k, n in enumerate(nomes)}
    ap = lambda k: "_ap" in nomes[k]
    agua = {ind[n] for n in AGUA}
    obj = objetos or {}
    if not obj:
        return cor
    chao = dobrar([ind[n] for n in obj["chao"]], w, h)
    estrada = {ind[n] for n in ("estrada", "estrada_ap", "estrada_sombra", "estrada_sombra_ap")}
    por_cima = {k for k, n in enumerate(nomes) if n.endswith("~") or n.startswith(("fronteira", "areia", "rio"))}
    terra = lambda i: base[i] not in agua

    def bloco(x, y):   # os 4 pixels de 4x do pixel (x, y) de 2x
        if 0 <= x < w and 0 <= y < h:
            o = 2 * y * W + 2 * x
            yield from (o, o + 1, o + W, o + W + 1)

    # 1. apagar: o desenho de 2x das árvores grandes e das rodovias volta ao chão
    for ay, ax, desenho, papeis, original, m in obj.get("carimbos", ()):
        if m == 1 or tuple(original) not in REDESENHO:
            continue
        deles = {ind[n + s] for n in papeis.values() for s in ("", "_ap") if n + s in ind}
        usadas = {ind[papeis[l] + s] for f in desenho for l in f if l in papeis for s in ("", "_ap") if papeis[l] + s in ind}
        for dy in range(-1, len(desenho) + 1):   # e a volta do glifo: o dobro suaviza a beira para fora dele
            for dx in range(-1, len(desenho[0]) + 1):
                dentro = 0 <= dy < len(desenho) and 0 <= dx < len(desenho[0]) and desenho[dy][dx] != "."
                for i in bloco(ax + dx - len(desenho[0]) // 2, ay + dy):
                    if base[i] in (deles if dentro else usadas):
                        cor[i] = chao[i]
    for i in range(N):   # as rodovias só saem desses tons (e o dobro suaviza o contorno para fora do glifo)
        if base[i] in estrada:
            cor[i] = chao[i]

    # 2. as árvores a 4x, de cima para baixo (a de baixo cobre a de cima), no lugar e no tamanho do desenho de 2x
    arvores, araucarias = [], []
    for ay, ax, desenho, papeis, original, m in obj.get("carimbos", ()):
        tipo = REDESENHO.get(tuple(original)) if m > 1 else None
        if tipo:
            arvores.append((2 * ay + 2 * len(desenho), 2 * ax, 2 * ay, tipo, papeis, len(desenho[0]), len(desenho)))
    for pe, cx, topo, tipo, papeis, lw, lh in sorted(arvores):
        s = cx * 7919 + topo * 104729
        apagada = ap(chao[min(N - 1, max(0, min(pe - 1, H - 1) * W + cx))])
        papel = {k: ind[v + ("_ap" if apagada else "")] for k, v in papeis.items() if v + ("_ap" if apagada else "") in ind}
        larg, alto = tamanho4(tipo, lw, lh, s)
        if tipo == "araucaria":   # a copa de uma não cobre a de outra
            caixa = (cx - larg // 2, pe - alto, cx + larg - larg // 2, pe - alto + round(alto * 0.6))
            if any(caixa[0] < b[2] and b[0] < caixa[2] and caixa[1] < b[3] and b[1] < caixa[3] for b in araucarias):
                continue
            araucarias.append(caixa)
        if tipo == "copa":
            if _h(s, 2, 342) < CLAREIRA:
                continue
            g = copa4(larg, alto, s, (_h(s, 3, 343) - 0.45) * 0.6)
        elif tipo == "cerrado":
            g = cerrado4(larg, alto, s)
        elif tipo == "quebracho":
            g = quebracho4(larg, alto, s)
        elif tipo == "cacto":
            g = mandacaru4(larg + 2, alto, s)
        elif tipo == "caranda":
            g = caranda4(larg, alto, s)
        else:
            g = araucaria4(larg, alto, s)
        _carimbar(cor, W, H, g, cx - len(g[0]) // 2, pe - len(g), papel, terra)

    # 3. as rodovias: a pista de 3 px no cinza da linha de 2x (asfalto), com a faixa clara tracejada no meio onde ela cabe (no
    # trecho reto, longe das emendas); sobre o rio, a ponte
    via = [0] * N   # 2 asfalto, 3 faixa, 4 ponte
    for linhas in obj.get("estradas", ()):
        for traco in linhas:
            passo = 0
            for (x0, y0), (x1, y1) in zip(traco, traco[1:]):
                a, b = (round(2 * x0), round(2 * y0)), (round(2 * x1), round(2 * y1))
                deitado = abs(b[0] - a[0]) >= abs(b[1] - a[1])
                pontos = linha(*a, *b)
                for q, (x, y) in enumerate(pontos):
                    passo += 1
                    cabe = 2 <= q < len(pontos) - 2
                    for k in (-1, 0, 1):
                        px, py = (x, y + k) if deitado else (x + k, y)
                        if 0 <= px < W and 0 <= py < H:
                            i = py * W + px
                            via[i] = max(via[i], 3 if k == 0 and cabe and passo % 6 < 3 else 2)
    for i in range(N):
        if via[i] and terra(i) is False and nomes[base[i]].startswith("rio"):
            via[i] = 4
    for i in range(N):
        v = via[i]
        if not v:
            continue
        if v == 4:
            cor[i] = ind["ponte"]
        elif base[i] not in agua:
            cor[i] = ind[("asfalto", "faixa")[v - 2] + ("_ap" if ap(chao[i]) else "")]

    # 4. os rios: margem escura, o canal mais fundo no meio e, nos largos, bancos de areia; e o grão do chão
    escuro = [ind.get(n + "~", k) for k, n in enumerate(nomes)]
    rio, raso, areia = ind["rio"], ind["raso_claro"], ind["areia"]
    graos = {}
    for e in ESTILOS.values():
        c1, c2, c3 = e["manchas"]
        for s_ in ("", "_ap"):
            graos[ind[c1 + s_]], graos[ind[c2 + s_]] = ind[(c3 or c2) + s_], ind[(c3 or c1) + s_]
    viz4 = ((1, 0), (-1, 0), (0, 1), (0, -1))
    for i in range(N):
        x, y = i % W, i // W
        if base[i] == rio:
            perto = [base[(y + b) * W + x + a] for a in range(-2, 3) for b in range(-2, 3) if 0 <= x + a < W and 0 <= y + b < H]
            if len(perto) == 25 and all(p == rio for p in perto) and _ruido(x, y, 9, 207) > 0.74:
                cor[i] = areia
            elif all(p == rio for p in perto[6:9] + perto[11:14] + perto[16:19]) and _ruido(x, y, 6, 205) > 0.55:
                cor[i] = raso
        elif cor[i] in graos and not via[i]:
            if any(0 <= x + a < W and 0 <= y + b < H and base[(y + b) * W + x + a] == rio for a, b in viz4):
                cor[i] = escuro[cor[i]]
            elif _h(x, y, 209) < 0.05:
                cor[i] = graos[cor[i]]

    # 5. a lavoura: talhões de tamanhos, formas e culturas variados num anel em volta de cada foco, com a cerca (o tom
    # escuro do chão) e, dentro, as fileiras do plantio; só no chão liso do Brasil, nunca uma colcha
    culturas = {"lavoura": ("lavoura", "lavoura_verde"), "lavoura_verde": ("lavoura_verde", "pa_capim"),
                "pasto": ("pasto", "pasto"), "terra_arada": ("terra_arada", "ca_sombra")}   # o sulco, terra mais viva
    livre = lambda i: cor[i] in graos and not ap(cor[i]) and not via[i]
    for k, (fx, fy, r0, r1) in enumerate(focos):
        postos = []
        for t in range(int(10 + (r1 - r0) / 3)):
            ang, d = _h(k, t, 350) * 6.2832, r0 + (r1 - r0) * _h(k, t, 351) ** 0.8
            lw, lh = 7 + int(_h(k, t, 352) * 8), 6 + int(_h(k, t, 353) * 5)   # nunca uma tábua: 4 fileiras no mínimo
            x0 = round(fx + d * math.cos(ang) - lw / 2)
            y0 = round(fy + d * math.sin(ang) - lh / 2)
            if any(x0 < px + pw + 2 and px < x0 + lw + 2 and y0 < py + ph + 2 and py < y0 + lh + 2 for px, py, pw, ph in postos):
                continue
            dentro = [(x, y) for y in range(y0, y0 + lh) for x in range(x0, x0 + lw) if 0 <= x < W and 0 <= y < H]
            if not dentro or sum(livre(y * W + x) for x, y in dentro) < len(dentro) * 0.8:
                continue
            postos.append((x0, y0, lw, lh))
            cultura = LAVOURAS[int(_h(k, t, 354) * len(LAVOURAS))]
            claro, fileira = culturas[cultura]
            deitado = _h(k, t, 355) < 0.5
            for x, y in dentro:
                i = y * W + x
                if not livre(i):
                    continue
                if x in (x0, x0 + lw - 1) or y in (y0, y0 + lh - 1):
                    cor[i] = escuro[cor[i]]   # a cerca
                else:
                    listra = ((y - y0) if deitado else (x - x0)) % (3 if cultura == "terra_arada" else 2) == 1
                    cor[i] = ind[fileira if listra and cultura != "pasto" else claro]
                    if cultura == "pasto" and _h(x, y, 356) < 0.12:
                        cor[i] = ind["lavoura_verde"]

    # 6. por cima de tudo, como no 2x: as divisas, a areia da costa e os rios (a ponte fica)
    for i in range(N):
        if base[i] in por_cima and via[i] != 4 and not (base[i] == rio and cor[i] in (areia, raso)):
            cor[i] = base[i]
    return cor


# --- o relevo de perto: as peças pintadas (PixelLab, arte/pixellab/mundo/relevo-*.png) carimbadas ao longo das serras ----
# Cada serra vira fileiras deslocadas de peças da família dela, as de trás primeiro e as da frente por cima (pelo pé),
# as maiores atrás e as menores na frente, com escolha, espelho e pequeno deslocamento fixos pela posição e sem a mesma
# peça duas vezes seguidas na fileira. As mesmas peças, nos mesmos lugares, a 4x (no tamanho delas) e a 2x (na metade):
# a troca de nível não pula. A montagem lê as peças (com o Pillow) e reduz as cores de cada família.
# família -> (as peças da fileira de trás, as da frente); "nome/2" é a peça na metade já a 4x
RELEVO = {"verde": (("serra-verde-4", "serra-verde-1"), ("pico-1", "serra-verde-1/2", "pico-1/2")),
          "rocha": (("serra-rocha-3", "serra-rocha-1"), ("serra-rocha-1", "serra-rocha-3/2")),
          "neve": (("serra-neve-1", "serra-neve-2"), ("serra-neve-2", "serra-neve-3")),
          "mesa": (("chapada-1",), ("chapada-1/2",))}
PICO = "pico-1"   # o pico isolado (Pico da Neblina)
# família -> (o passo ao longo da linha, as fileiras: o desvio para trás (+) ou para a frente (-), a fase no passo e qual
# grupo de peças), em pixels de 4x
FILEIRAS = {"verde": (34, ((7, 0.0, 0), (-7, 0.5, 1))),
            "rocha": (30, ((6, 0.0, 0), (-8, 0.5, 1))),
            "neve": (28, ((14, 0.0, 0), (2, 0.5, 1), (-10, 0.25, 1))),
            "mesa": (48, ((12, 0.0, 0), (-16, 0.5, 1)))}
ZIGUE = {"mesa": 10}   # as chapadas saem em ziguezague (uma de cada lado da linha), não numa coluna
LADO = {"neve": 10}    # o quanto a peça sai da fileira para os lados (os Andes, largos, sem cara de grade); o resto, 4
FALTA = {"neve": 0.2, "rocha": 0.15}   # a chance de faltar uma peça nas fileiras da frente (sem fila contínua)
FUNDO = 4        # pixels de 4x: o pé da peça se desfaz no chão nessa altura (2 a 2x)
CORTE = 0.12     # a peça que perderia mais que isso (fora da imagem, na água ou na névoa) não é carimbada


def familia(serra):
    """A família de peças da serra: mesa (chapada) ou o tipo dela (verde, rocha, neve)."""
    return "mesa" if serra.get("forma") == "mesa" else serra["tipo"]


def apagada(h):
    """A cor '#rrggbb' apagada (a dos vizinhos), como a paleta faz."""
    return _hex([v * (1 - APAGA) + g * APAGA for v, g in zip(_rgb(h), CINZA)])


def paleta_com_relevo(pecas):
    """A paleta estendida: as cores de CORES (os mesmos índices) e, depois delas, as das peças e as apagadas delas, em
    ordem fixa. Devolve (lista de '#rrggbb', cor -> índice)."""
    lista = list(CORES.values())
    cores = {c for _, _, px in pecas.values() for c in px if c}
    lista += sorted((cores | {apagada(c) for c in cores}) - set(lista))
    indice = {}
    for k, c in enumerate(lista):
        indice.setdefault(c, k)
    return lista, indice


def metade(peca):
    """A peça na metade (o nível de 2x): cada bloco 2x2 vira um pixel, cheio quando 2 ou mais dos 4 são. Por dentro, a cor
    mais clara do bloco (as peças têm muito traço escuro por dentro, e a média vira um borrão); na beira (bloco com vazio),
    a mais escura dele (o contorno não some). Pixel nítido, alfa binário."""
    w, h, px = peca
    lum = lambda c: (sum(k * v for k, v in zip((0.3, 0.59, 0.11), _rgb(c))), c)
    saida = []
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            bloco = [px[yy * w + xx] if xx < w and yy < h else None for yy in (y, y + 1) for xx in (x, x + 1)]
            cheias = [c for c in bloco if c]
            saida.append(None if len(cheias) < 2 else min(cheias, key=lum) if len(cheias) < 4 else max(cheias, key=lum))
    return (w + 1) // 2, (h + 1) // 2, saida


def espelho(peca):
    w, h, px = peca
    return w, h, [px[y * w + w - 1 - x] for y in range(h) for x in range(w)]


def carimbos_do_relevo(serras, pecas, k=2):
    """Onde vai cada peça de relevo, em pixels de 4x (as linhas das serras vêm em pixels de 2x, vezes k): (x, y do pé,
    família, nome, espelhada), da de trás para a da frente (pelo pé, depois por x). pecas: nome -> (w, h, pixels)."""
    lista = []
    for n_s, serra in enumerate(serras):
        fam = familia(serra)
        passo, fileiras = FILEIRAS[fam]
        for n_l, fileira in enumerate(serra["linhas"]):
            pts = [(x * k, y * k) for x, y in fileira]
            for r, (desvio, fase, grupo) in enumerate(fileiras):
                grupo, antes = RELEVO[fam][grupo], None
                for j, (x, y, ux, uy) in enumerate(_ao_longo(pts, passo)):
                    s = n_s * 1009 + n_l * 101 + r * 13
                    if r and _h(j, s, 405) < FALTA.get(fam, 0):   # só nas fileiras da frente
                        continue
                    a, b = (uy, -ux), (-uy, ux)   # para trás: o norte (na serra norte-sul, o oeste)
                    tras = (a if a[0] < 0 else b) if abs(ux) < 0.3 else (a if a[1] < 0 else b)
                    ao_longo = (fase + (_h(j, s, 401) - 0.5) * 0.3) * passo
                    lado = desvio + (_h(j, s, 402) - 0.5) * LADO.get(fam, 4) + ZIGUE.get(fam, 0) * (1 if j % 2 else -1)
                    nome = grupo[int(_h(j, s, 403) * len(grupo))]
                    if nome == antes and len(grupo) > 1:
                        nome = grupo[(grupo.index(nome) + 1) % len(grupo)]
                    antes = nome
                    lista.append((x + ux * ao_longo + tras[0] * lado, y + uy * ao_longo + tras[1] * lado, fam, nome,
                                   _h(j, s, 404) < 0.5))
        for x, y in serra.get("picos", ()):
            lista.append((x * k, y * k, fam, PICO, False))
    return sorted(lista, key=lambda c: (round(c[1]), round(c[0])))


def carimbar_relevo(indices, W, H, carimbos, pecas, nivel, indice, apagado, mar, so=None):
    """Carimba as peças de relevo no mapa (indices, W x H, na paleta estendida de paleta_com_relevo), no nível 4 (as
    peças no tamanho delas) ou 2 (na metade), por cima de tudo (a rodovia e o rio passam por baixo). O canto de cada peça
    cai em pixel par de 4x, então a de 2x cobre exatamente os mesmos blocos. O pé se desfaz no chão em FUNDO px (sem
    contorno reto nem halo). Fora do Brasil (apagado(x, y) em pixels de 4x), a peça sai apagada, menos a neve dos Andes.
    O pixel no mar (mar(x, y), em pixels de 4x) ou na névoa da borda fica de fora (o rio, não: ele passa por baixo); a
    peça que perderia mais de CORTE dos pixels assim (ou fora da imagem) não sai; so: as que podem sair (as que saíram no
    outro nível). Devolve as que saíram."""
    nevoa = {indice[CORES[n]] for n in CORES if n.split("_ap")[0] in NEVOA + (FORA,)}
    q = 4 // nivel
    meia, fundo, postos = nivel == 2, FUNDO // (4 // nivel), []
    cache = {}

    def peca(nome, meia, esp):   # "nome/2": a peça na metade já a 4x (a menor, da frente)
        if (nome, meia, esp) not in cache:
            p = pecas[nome.split("/")[0]]
            for _ in range(nome.endswith("/2") + meia):
                p = metade(p)
            cache[(nome, meia, esp)] = espelho(p) if esp else p
        return cache[(nome, meia, esp)]
    for c in carimbos:
        x, y, fam, nome, esp = c
        if so is not None and c not in so:
            continue
        p = peca(nome, False, False)
        x0, y0 = (round(x) - p[0] // 2) & ~1, (round(y) - p[1] + 1) & ~1
        w, h, px = peca(nome, meia, esp)
        if meia:
            x0, y0 = x0 // 2, y0 // 2
        ap = fam != "neve" and apagado(round(x), round(y))
        baixo = [max((yy for yy in range(h) if px[yy * w + xx]), default=-1) for xx in range(w)]
        pontos, perdidos = [], 0
        for yy in range(h):
            for xx in range(w):
                cor = px[yy * w + xx]
                if not cor:
                    continue
                gx, gy = x0 + xx, y0 + yy
                d = baixo[xx] - yy
                if d < fundo and _h(gx * q // 2, gy * q // 2, 77) >= (d + 0.5) / fundo:
                    continue
                if not (0 <= gx < W and 0 <= gy < H) or indices[gy * W + gx] in nevoa or mar(gx * q, gy * q):
                    perdidos += 1
                    continue
                pontos.append((gy * W + gx, indice[apagada(cor) if ap else cor]))
        if so is None and perdidos > CORTE * (len(pontos) + perdidos):
            continue
        for i, k in pontos:
            indices[i] = k
        postos.append(c)
    return postos
