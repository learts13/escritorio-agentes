"""Monta o tema livre do escritório: static/tema/atlas.png + atlas.json.

Móveis: PNGs gerados no PixelLab (arte própria, pode ser redistribuída), escolhidos em
ESCOLHA abaixo e recortados. Pisos e paredes: desenhados aqui em código. Animações (vapor do
café, gato respirando, telas piscando) também são feitas aqui a partir dos sprites.

Uso: python ferramentas/montar_tema.py <pasta com os PNGs gerados>
     python ferramentas/montar_tema.py --logo   (só o logo padrão: static/logo.png, também o favicon)
"""
import json
import os
import random
import sys
from PIL import Image, ImageDraw

ORIGEM = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "..", "arte", "pixellab")
SAIDA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "tema")

# nome usado pelo mapa -> arquivo gerado (sem .png)
ESCOLHA = {
    "planta_alta": "planta_alta_2", "planta_alta2": "planta_alta_1", "planta_alta3": "planta_alta_3",
    "planta": "planta_2", "planta2": "planta_3", "planta_fina": "planta_1",
    "quadro": "quadro_3", "quadro2": "quadro_1", "lousa": "lousa_1", "grafico": "grafico_2", "grafico2": "grafico_1",
    "mural": "mural_1", "bebedouro": "bebedouro_2", "vendas": "vendas_1", "vendas2": "vendas",
    "armario": "estante_1", "estacao_chefe": "armario_1",
    "poltrona_azul": "poltrona_1", "poltrona_amarela": "poltrona_2", "poltrona_couro": "poltrona_3",
    "sofa": "sofa_1", "rack_tv": "rack_tv_1", "estacao_gamer": "estacao_1",
    "pufe_amarelo": "pufe_1", "pufe_azul": "pufe_2", "pufe_vermelho": "pufe_3",
    "arcade1": "arcade_1", "arcade2": "arcade_2", "arcade3": "arcade_3",
    "sinuca": "sinuca_1", "sinuca2": "sinuca_2", "balcao": "balcao_2",
    "gato": "gato_2", "telas_noc": "telas_noc_2", "recepcao": "recepcao_1", "janela": "janela_1",
    "luminaria": "luminaria_1", "impressora": "impressora_1",
    "pebolim": "pebolim_2", "pingpong": "pingpong_1", "dardos": "dardos_1",
    "geladeira": "geladeira_1", "geladeira2": "geladeira_2", "microondas": "microondas_2", "pia": "microondas_3",
    "mesa_cozinha": "cozinha_mesa_2", "mesa_cozinha2": "cozinha_mesa_3",
    "reuniao": "reuniao_2", "tela_reuniao": "tela_reuniao_1", "servidor": "servidor_1", "servidor2": "servidor_2",
    "arquivo": "arquivo_1", "arquivo2": "arquivo_2", "aquario": "aquario_1", "neon": "neon_1", "neon2": "neon_2",
    "relogio": "relogio_1", "poster1": "poster_foguete_1", "poster2": "quadro_abstrato_2", "poster3": "quadro_montanha_2", "trofeus": "trofeus_1",
    "violao": "violao_1", "sofa2": "sofa2_1", "sofa3": "sofa2_2", "mesinha": "mesinha_2", "mesinha2": "mesinha_2",
    "planta_g1": "planta_g_1", "planta_g2": "planta_g_2", "planta_g3": "planta_g_3", "planta_g4": "planta_alta_3",
    "cadeira_gamer": "cadeira_gamer_1", "lixeira": "lixeira_1", "quadro_branco": "quadro_branco_1",
    "tv_parede": "tv_parede_1", "console": "console_1", "piano": "piano_1", "bicicleta": "bicicleta_1",
    "caixas": "caixas_1", "mesa_trabalho": "mesa_trabalho_1", "mesa_trabalho2": "mesa_trabalho_2",
    "arvore1": "arvore_1", "arvore2": "arvore_3", "arbusto1": "arbusto_1", "arbusto2": "arbusto_2",
    "banco": "banco_1", "poste": "poste_1", "bicicletario": "bicicletario_1", "canteiro": "canteiro_1",
    "caixa_correio": "caixa_correio_1", "lixeira_rua": "lixeira_rua_1", "food_truck": "food_truck_1",
    "arvore_natal": "arvore_natal_1", "presentes": "presentes_1", "abobora": "abobora_1", "abobora2": "abobora_2",
    "ovos": "ovos_1", "coelho": "coelho_1", "lanterna": "lanterna_china_1", "fogueira": "fogueira_1",
    "champanhe": "champanhe_1", "mascara": "mascara_1", "diwali": "diwali_1", "arvore3": "pinheiro_1",
    "carro1": "carro_4", "carro2": "carro_5", "carro3": "carro_3", "carro4": "carro_6",
    # salas por tipo de time: Ops, Gabinete e times comuns
    "extintor": "extintor_1", "cabideiro": "cabideiro_1", "sofa_cinza": "sofa_cinza_2", "aparador": "aparador_2",
    "cafeteira": "cafeteira_2", "rack_rede": "rack_rede_2", "nobreak": "nobreak_1", "carrinho_ferramentas": "carrinho_ferramentas_1",
    "globo": "globo_2", "cofre": "cofre_1", "tapete_persa": "tapete_persa_1", "vitrine": "vitrine_2",
    "quadro_montanha": "quadro_montanha_1", "diploma": "diploma_1", "calendario": "calendario_1", "prateleira": "prateleira_2",
    "quadro_abstrato": "quadro_abstrato_1", "tv_grafico": "tv_grafico_1", "geladeira_bebidas": "geladeira_bebidas_1",
    "fruteira": "fruteira_1", "planta_cacto": "planta_cacto_1",
    "estante_baixa": "estante_baixa_1", "luminaria_chao": "luminaria_chao_1", "estante": "estante_2",
    # exterior variado e cantinhos novos da sala comunal
    "arvore_ipe": "arvore_ipe_2", "arvore_jacaranda": "arvore_jacaranda_1", "palmeira": "palmeira_1",
    "banca_jornal": "banca_jornal_2", "orelhao": "orelhao_2", "ponto_onibus": "ponto_onibus_2", "mesa_piquenique": "mesa_piquenique_2",
    "jukebox": "jukebox_2", "pipoqueira": "pipoqueira_2", "rede_descanso": "rede_descanso_2", "mesa_xadrez": "mesa_xadrez_2",
    # a fachada de frente, embaixo do prédio (Firmópolis): peças soltas, a parede é desenhada no mapa.js
    "fachada_porta": "fachada/porta", "fachada_janela": "fachada/janela", "fachada_arandela": "fachada/arandela",
    "fachada_floreira": "fachada/floreira",
    # a porta do banheiro no fim do corredor (Firmópolis): a fila dos terminais
    "banheiro_porta": "banheiro/porta_1",
}

T = 16
# Identidade própria, brasileira e moderna, em tons quentes e terrosos (nada de "azul Habbo").
# Os índices continuam os mesmos de times.json (piso 0-9, parede 0-5); 6 e 7 do piso e 6 da parede
# são da cozinha e da reunião (o mapa.js não deixa sala de time usar).
PISOS = [  # (base, variação, tipo)
    ((222, 214, 200), (198, 188, 172), "granilite"),   # 0 granilite claro (corredor e salas)
    ((184, 132, 84), (160, 110, 66), "espinha"),       # 1 taco em espinha de peixe, mel
    ((150, 144, 136), (138, 132, 124), "cimento"),     # 2 cimento queimado
    ((226, 218, 206), (196, 186, 172), "geometrico"),  # 3 carpete geométrico (ganha a cor do time)
    ((78, 80, 84), (66, 68, 72), "tecnico"),           # 4 piso técnico elevado (Ops)
    ((224, 214, 200), (194, 182, 166), "triangulos"),  # 5 carpete de triângulos (ganha a cor do time)
    ((234, 226, 208), (194, 116, 88), "hidraulico"),   # 6 ladrilho hidráulico (cozinha)
    ((196, 176, 144), (176, 156, 124), "sisal"),       # 7 carpete de sisal (reunião)
    ((188, 182, 172), (174, 168, 158), "cimento"),     # 8 cimento queimado claro
    ((122, 82, 54), (104, 68, 44), "espinha"),         # 9 taco em espinha escuro
]
PAREDES = [  # (corpo, acabamento, rodapé, desenho)
    ((228, 216, 196), (244, 236, 222), (118, 92, 70), "lambri"),     # 0 creme com lambri de madeira
    ((150, 102, 64), (186, 140, 98), (80, 54, 34), "ripado"),         # 1 painel ripado de madeira
    ((208, 200, 188), (232, 226, 216), (112, 102, 92), "cobogo"),     # 2 cobogó de cimento
    ((44, 90, 86), (84, 132, 126), (74, 50, 32), "meia"),             # 3 verde-petróleo com meia-parede de madeira
    ((44, 82, 52), (122, 92, 62), (70, 52, 36), "jardim"),            # 4 jardim vertical
    ((184, 98, 68), (214, 140, 106), (96, 54, 38), "terracota"),      # 5 terracota com faixa
    ((238, 236, 228), (250, 248, 242), (92, 108, 116), "azulejo"),    # 6 azulejo (só a cozinha)
]


def recorte(nome):
    im = Image.open(os.path.join(ORIGEM, nome + ".png")).convert("RGBA")
    bb = im.getbbox()
    return im.crop(bb) if bb else im


def tom(c, k):
    return tuple(max(0, min(255, int(v + k))) for v in c[:3])


def piso(base, var, tipo, semente):
    """Bloco de 48x32 que o mapa repete; a variação por tile o mapa.js põe por cima (sem cara de carimbo)."""
    rnd = random.Random(semente)
    W, H = 3 * T, 2 * T
    im = Image.new("RGBA", (W, H), base + (255,))
    d = ImageDraw.Draw(im)
    if tipo == "granilite":  # pedrinhas coloridas sobre base clara, com junta de latão a cada bloco
        for _ in range(W * H // 8):
            d.point((rnd.randrange(W), rnd.randrange(H)), fill=tom(base, rnd.randrange(-6, 5)))
        lascas = [(184, 120, 96), (120, 112, 108), (176, 168, 156), (214, 182, 116), (246, 242, 234), (150, 162, 148)]
        for _ in range(W * H // 40):
            x, y, cor = rnd.randrange(W), rnd.randrange(H), rnd.choice(lascas)
            d.point((x, y), fill=cor)
            if rnd.random() < 0.3: d.point(((x + 1) % W, y), fill=cor)
        d.line([(0, 0), (W, 0)], fill=(206, 188, 150)); d.line([(0, 0), (0, H)], fill=(206, 188, 150))   # junta de latão
    elif tipo == "espinha":  # tacos em espinha de peixe: colunas de 8 px com réguas na diagonal, alternando o sentido
        C = 8
        for y in range(H):
            for x in range(W):
                col, cx = x // C, x % C
                k = cx if col % 2 == 0 else C - 1 - cx
                faixa = (y + k) // 4
                h = (col * 92821 + faixa * 68917) % 23
                cor = tom(base, h - 11)
                if (y + k) % 4 == 0: cor = tom(base, -30)        # emenda entre réguas
                elif (y + k) % 4 == 1: cor = tom(cor, 10)        # brilho da borda
                if cx == 0: cor = tom(base, -24)                 # emenda entre colunas
                if rnd.random() < 0.05: cor = tom(cor, -8)       # veio
                d.point((x, y), fill=cor)
    elif tipo == "cimento":  # cimento queimado: manchas largas e suaves, marcas de desempenadeira
        for _ in range(26):
            x, y, r = rnd.randrange(W), rnd.randrange(H), rnd.randrange(4, 10)
            k = rnd.choice([-5, -3, 3, 5])
            for yy in range(y - r, y + r):
                for xx in range(x - r, x + r):
                    if (xx - x) ** 2 + (yy - y) ** 2 < r * r and rnd.random() < 0.55:
                        d.point((xx % W, yy % H), fill=tom(base, k))
        for _ in range(10):
            x, y = rnd.randrange(W), rnd.randrange(H)
            for k in range(rnd.randrange(4, 9)): d.point(((x + k) % W, (y + (k // 3)) % H), fill=tom(base, 7))
        for _ in range(40): d.point((rnd.randrange(W), rnd.randrange(H)), fill=tom(base, -14))
    elif tipo in ("geometrico", "triangulos"):  # carpete claro com desenho; o mapa.js tinge com a cor do time
        for y in range(H):
            for x in range(W):
                cor = base
                if tipo == "geometrico":
                    a, b = x % 8, y % 8
                    if abs(a - 3.5) + abs(b - 3.5) in (3.0, 4.0): cor = var            # losangos
                    elif a in (3, 4) and b in (3, 4): cor = tom(var, -12)               # miolo
                else:
                    a, b = x % 8, y % 8
                    if (b > a) == ((x // 8 + y // 8) % 2 == 0): cor = tom(base, -12)   # triângulos alternados
                    if a == b: cor = var
                if (x * 7 + y * 13) % 5 == 0: cor = tom(cor, -5)                     # trama
                d.point((x, y), fill=cor)
    elif tipo == "tecnico":  # placas de 16x16 com rejunte, metade perfuradas (ventilação)
        for ty in range(0, H, T):
            for tx in range(0, W, T):
                cor = tom(base, rnd.randrange(-3, 4))
                d.rectangle([tx, ty, tx + T - 1, ty + T - 1], fill=cor)
                d.line([(tx + 1, ty + 1), (tx + T - 2, ty + 1)], fill=tom(cor, 14)); d.line([(tx + 1, ty + 1), (tx + 1, ty + T - 2)], fill=tom(cor, 9))
                d.line([(tx + 1, ty + T - 2), (tx + T - 2, ty + T - 2)], fill=tom(cor, -14)); d.line([(tx + T - 2, ty + 1), (tx + T - 2, ty + T - 2)], fill=tom(cor, -10))
                if (tx // T + ty // T) % 2 == 0:
                    for yy in range(ty + 4, ty + T - 3, 3):
                        for xx in range(tx + 4, tx + T - 3, 3): d.point((xx, yy), fill=tom(cor, -26))
                else:
                    for k in (3, T - 4):
                        d.point((tx + k, ty + 3), fill=tom(cor, 20)); d.point((tx + k, ty + T - 4), fill=tom(cor, 20))   # parafusos
                d.line([(tx, ty), (tx + T - 1, ty)], fill=tom(base, -34)); d.line([(tx, ty), (tx, ty + T - 1)], fill=tom(base, -34))
    elif tipo == "hidraulico":  # ladrilho hidráulico: círculos nos cantos e losango no meio, em terracota e verde
        terra, verde, escuro = var, (92, 146, 136), (150, 104, 86)
        for ty in range(0, H, T):
            for tx in range(0, W, T):
                for y in range(T):
                    for x in range(T):
                        r = ((min(x, T - 1 - x) + 0.5) ** 2 + (min(y, T - 1 - y) + 0.5) ** 2) ** 0.5
                        m = abs(x - 7.5) + abs(y - 7.5)
                        cor = base
                        if r < 4.6: cor = terra
                        elif r < 5.6: cor = escuro
                        if m < 3.2: cor = verde
                        elif m < 4.2: cor = tom(base, -8)
                        elif 5.4 < m < 6.4 and r >= 5.6: cor = tom(terra, 30)
                        if x == 0 or y == 0: cor = tom(cor, -14)                       # rejunte
                        if rnd.random() < 0.05: cor = tom(cor, rnd.choice([-6, 6]))     # desgaste
                        d.point((tx + x, ty + y), fill=cor)
    else:  # sisal: trama de cesto em blocos de 4x4 alternando o sentido
        for y in range(H):
            for x in range(W):
                hor = (x // 4 + y // 4) % 2 == 0
                k = (y % 4) if hor else (x % 4)
                cor = tom(base, (8, 0, -6, -14)[k])
                if rnd.random() < 0.06: cor = tom(cor, -10)
                d.point((x, y), fill=cor)
    return im


def coluna_parede(corpo, acab, rodape, desenho, col, semente):
    """Faixa de 16x48 (3 tiles) de parede; depois é fatiada em 3."""
    rnd = random.Random(semente * 7 + col)
    im = Image.new("RGBA", (T, 3 * T), corpo + (255,))
    d = ImageDraw.Draw(im)
    H = 3 * T
    if desenho == "ripado":  # ripas de 3 px com fresta escura, cada uma num tom
        for x in range(0, T, 4):
            cor = tom(corpo, rnd.randrange(-10, 11))
            d.rectangle([x, 6, x + 2, H - 6], fill=cor)
            d.line([(x, 6), (x, H - 6)], fill=tom(cor, 14))
            d.line([(x + 3, 6), (x + 3, H - 6)], fill=tom(corpo, -42))
            for y in range(8, H - 6, 6): d.point((x + 1 + rnd.randrange(2), y + rnd.randrange(3)), fill=tom(cor, -12))
    elif desenho == "cobogo":  # blocos vazados de 8x8 com a abertura em folha, mostrando a sombra de trás
        for y0 in range(6, H - 6, 8):
            for x0 in range(0, T, 8):
                d.rectangle([x0, y0, x0 + 7, y0 + 7], fill=tom(corpo, rnd.randrange(-4, 5)))
                for yy in range(8):
                    for xx in range(8):
                        dx, dy = xx - 3.5, yy - 3.5
                        if abs(dx) + abs(dy) < 3.2 and not (abs(dx) < 0.6 and abs(dy) < 0.6):
                            d.point((x0 + xx, y0 + yy), fill=tom(corpo, -78))
                d.line([(x0, y0), (x0 + 7, y0)], fill=tom(corpo, 14)); d.line([(x0, y0 + 7), (x0 + 7, y0 + 7)], fill=tom(corpo, -22))
                d.line([(x0 + 7, y0), (x0 + 7, y0 + 7)], fill=tom(corpo, -22))
    elif desenho == "meia":  # pintura lisa em cima, meia-parede de madeira com frisos embaixo
        for _ in range(30): d.point((rnd.randrange(T), rnd.randrange(6, 26)), fill=tom(corpo, rnd.choice([-4, 4])))
        madeira = (140, 96, 60)
        d.rectangle([0, 26, T - 1, H - 5], fill=madeira)
        d.line([(0, 25), (T, 25)], fill=tom(madeira, 30)); d.line([(0, 26), (T, 26)], fill=tom(madeira, -36))
        for x in range(0, T, 8): d.line([(x, 27), (x, H - 5)], fill=tom(madeira, -24))
        d.line([(0, 34), (T, 34)], fill=tom(madeira, -14))
    elif desenho == "jardim":  # jardim vertical: folhas em vários verdes e algumas flores
        for _ in range(70):
            x, y = rnd.randrange(T), rnd.randrange(6, H - 6)
            cor = rnd.choice([(58, 112, 62), (78, 138, 70), (104, 160, 82), (40, 92, 54), (132, 176, 92)])
            d.point((x, y), fill=cor); d.point(((x + 1) % T, y), fill=tom(cor, -14))
            if rnd.random() < 0.5: d.point((x, min(H - 7, y + 1)), fill=tom(cor, -24))
        for _ in range(3):
            d.point((rnd.randrange(T), rnd.randrange(8, H - 8)), fill=rnd.choice([(236, 118, 132), (246, 206, 92), (248, 240, 236)]))
    elif desenho == "terracota":  # parede terracota com textura de cal e uma faixa clara no meio
        for _ in range(50): d.point((rnd.randrange(T), rnd.randrange(6, H - 6)), fill=tom(corpo, rnd.choice([-6, -3, 4, 6])))
        d.rectangle([0, 22, T - 1, 24], fill=(236, 214, 182)); d.line([(0, 25), (T, 25)], fill=tom(corpo, -22))
    elif desenho == "azulejo":  # azulejo branco 8x8 com uma barra de azulejos estampados
        for y0 in range(6, H - 5, 8):
            for x0 in range(0, T, 8):
                cor = tom(corpo, rnd.randrange(-3, 4))
                d.rectangle([x0, y0, x0 + 7, y0 + 7], fill=cor)
                d.point((x0 + 1, y0 + 1), fill=(255, 255, 255))
                d.line([(x0, y0 + 7), (x0 + 7, y0 + 7)], fill=tom(corpo, -30)); d.line([(x0 + 7, y0), (x0 + 7, y0 + 7)], fill=tom(corpo, -30))
        y0 = 22
        for x0 in range(0, T, 8):  # barra estampada (estrela em verde e terracota)
            d.rectangle([x0, y0, x0 + 6, y0 + 6], fill=(236, 230, 214))
            d.line([(x0 + 3, y0), (x0 + 3, y0 + 6)], fill=(52, 112, 104)); d.line([(x0, y0 + 3), (x0 + 6, y0 + 3)], fill=(52, 112, 104))
            d.point((x0 + 3, y0 + 3), fill=(176, 82, 58))
            for k in ((1, 1), (5, 1), (1, 5), (5, 5)): d.point((x0 + k[0], y0 + k[1]), fill=(176, 82, 58))
    elif desenho == "lambri":  # metade de baixo em painel de madeira, com friso
        madeira = (150, 106, 70)
        d.rectangle([0, 28, T - 1, H - 5], fill=madeira)
        d.line([(0, 27), (T, 27)], fill=tom(madeira, 34)); d.line([(0, 28), (T, 28)], fill=tom(madeira, -40))
        d.rectangle([3, 31, T - 4, H - 8], outline=tom(madeira, -26))
        d.line([(4, 32), (T - 5, 32)], fill=tom(madeira, 12))
        for _ in range(20): d.point((rnd.randrange(T), rnd.randrange(6, 27)), fill=tom(corpo, rnd.choice([-4, 3])))
    # acabamento no topo (moldura) e rodapé
    d.rectangle([0, 0, T - 1, 3], fill=acab)
    d.line([(0, 0), (T, 0)], fill=tom(acab, 14))
    d.line([(0, 4), (T, 4)], fill=tom(corpo, -45)); d.line([(0, 5), (T, 5)], fill=tom(corpo, -18))
    d.rectangle([0, H - 4, T - 1, H - 1], fill=rodape)
    d.line([(0, H - 5), (T, H - 5)], fill=tom(rodape, 26))
    if col == 0: d.line([(0, 0), (0, H)], fill=tom(corpo, -55))
    if col == 3: d.line([(T - 1, 0), (T - 1, H)], fill=tom(corpo, -55))
    return im


def vapor(k):
    """Quadros de vapor subindo (8x10) para a xícara do balcão."""
    im = Image.new("RGBA", (8, 10)); d = ImageDraw.Draw(im)
    for i in range(3):
        y = 9 - ((k * 2 + i * 3) % 10)
        x = 3 + (1 if (k + i) % 2 else -1)
        d.point((x, y), fill=(255, 255, 255, 150 - i * 30))
        d.point((x + 1, y - 1), fill=(255, 255, 255, 110 - i * 25))
    return im


def respirar(img, k):
    """Gato dormindo: o corpo sobe 1px no quadro 1."""
    if k == 0:
        return img
    w, h = img.size
    out = Image.new("RGBA", (w, h))
    topo = img.crop((0, 0, w, h // 2))
    out.alpha_composite(img, (0, 0))
    out.alpha_composite(Image.new("RGBA", (w, 1)), (0, 0))
    out.paste(topo, (0, -1), topo)
    return out


def piscar(img, k):
    """Telas: clareia pixels de tela (azuis/verdes) em padrões diferentes por quadro."""
    rnd = random.Random(k)
    out = img.copy(); px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a and (g > r + 30 or b > r + 40) and rnd.random() < 0.25:
                px[x, y] = (min(255, r + 50), min(255, g + 50), min(255, b + 50), a)
    return out


def tapete(w, h, cor, borda):
    """Tapete oval visto de cima, com borda e listras."""
    im = Image.new("RGBA", (w, h)); d = ImageDraw.Draw(im)
    d.ellipse([0, 0, w - 1, h - 1], fill=borda)
    d.ellipse([2, 2, w - 3, h - 3], fill=cor)
    d.ellipse([7, 5, w - 8, h - 6], outline=borda)
    for y in range(4, h - 4, 3):
        for x in range(4, w - 4, 4):
            if ((x - w / 2) / (w / 2 - 4)) ** 2 + ((y - h / 2) / (h / 2 - 3)) ** 2 < 1 and (x // 4 + y // 3) % 2:
                im.putpixel((x, y), tuple(min(255, c + 14) for c in cor[:3]) + (255,))
    return im


def recolorir(img, matiz_para_branco=True):
    """Versão clara (branca/creme) de um sprite: tira a saturação e clareia."""
    out = img.copy(); px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                l = int(0.3 * r + 0.59 * g + 0.11 * b)
                v = min(255, 70 + l * 3 // 4 + 40)
                px[x, y] = (v, v, max(0, v - 8), a)
    return out


def main():
    pecas = {}
    for nome, arq in ESCOLHA.items():
        if os.path.exists(os.path.join(ORIGEM, arq + ".png")):
            pecas[nome] = recorte(arq)
        else:
            print("faltando:", arq)
    if "pufe_azul" in pecas:
        pecas["pufe_branco"] = recolorir(pecas["pufe_azul"])
    # hatch, táxi e van foram gerados virados para a esquerda (lanterna traseira à direita):
    # todos os veículos ficam virados para a direita; a moto já nasceu assim
    for n in ("carro1", "carro2", "carro3"):
        if n in pecas:
            pecas[n] = pecas[n].transpose(Image.FLIP_LEFT_RIGHT)
    for n in ("carro1", "carro2", "carro3", "carro4"):  # versão andando para a esquerda
        if n in pecas:
            pecas[n + "_esq"] = pecas[n].transpose(Image.FLIP_LEFT_RIGHT)
    if "fruteira" in pecas:  # gerada grande demais para ir em cima da mesinha
        f = pecas["fruteira"]; pecas["fruteira"] = f.resize((f.width // 2, f.height // 2), Image.NEAREST)
    if "armario" in pecas:
        pecas["armario2"] = pecas["armario"].transpose(Image.FLIP_LEFT_RIGHT)
    pecas["tapete"] = tapete(76, 40, (70, 110, 190, 255), (40, 62, 120, 255))
    pecas["tapete2"] = tapete(80, 30, (176, 82, 70, 255), (112, 46, 40, 255))
    pecas["tapete3"] = tapete(92, 56, (86, 120, 92, 255), (52, 80, 58, 255))
    for i, (b, v, tipo) in enumerate(PISOS):
        pecas[f"piso{i}"] = piso(b, v, tipo, i)
    for s, (c, a, r, desenho) in enumerate(PAREDES):
        for col in range(4):
            faixa = coluna_parede(c, a, r, desenho, col, s)
            for lin in range(3):
                pecas[f"parede{s}_{col}_{lin}"] = faixa.crop((0, lin * T, T, (lin + 1) * T))
    quadros = {"cafe": 6, "gato": 2, "telas_noc": 4}
    for k in range(6):
        pecas[f"cafe_{k}"] = vapor(k)
    if "gato" in pecas:
        for k in range(2):
            pecas[f"gato_{k}"] = respirar(pecas["gato"], k)
    if "telas_noc" in pecas:
        for k in range(4):
            pecas[f"telas_noc_{k}"] = piscar(pecas["telas_noc"], k)
    largura, x, y, alt, pos = 512, 0, 0, 0, {}
    for nome, im in sorted(pecas.items(), key=lambda kv: -kv[1].height):
        if x + im.width > largura:
            x, y, alt = 0, y + alt + 1, 0
        pos[nome] = [x, y, im.width, im.height]
        x += im.width + 1
        alt = max(alt, im.height)
    atlas = Image.new("RGBA", (largura, y + alt + 1))
    for nome, (px, py, _, _) in pos.items():
        atlas.alpha_composite(pecas[nome], (px, py))
    os.makedirs(SAIDA, exist_ok=True)
    atlas.save(os.path.join(SAIDA, "atlas.png"), optimize=True)
    import hashlib
    versao = hashlib.sha256(open(os.path.join(SAIDA, "atlas.png"), "rb").read()).hexdigest()[:12]
    with open(os.path.join(SAIDA, "atlas.json"), "w", encoding="utf-8") as f:
        json.dump({"versao": versao, "sprites": pos, "quadros": quadros, "licenca": "arte própria (PixelLab) e desenhada em código"}, f, separators=(",", ":"))
    print("atlas", atlas.size, len(pos), "peças")


# Logo padrão do projeto (neutro, sem marca de ninguém): um prédio de escritório em pixel art, 13x13, ampliado 16x
# sem suavizar. 13 porque o mapa desenha o logo com 26 px de altura: fica exatamente 2x, nítido.
LOGO = [
    "......r......",
    "......p......",
    "..ttttttttt..",
    ".TTTTTTTTTTT.",
    ".cCCCCCCCCCs.",
    ".cAcBcAcBcAs.",
    ".cAcBcAcBcAs.",
    ".cCCCCCCCCCs.",
    ".cBcCmmmCcBs.",
    ".cBcCdDdCcBs.",
    ".cCCCdDdCCCs.",
    "ggggggggggggg",
    ".............",
]
CORES_LOGO = {
    "r": "#ff5a4e", "p": "#8a8fa3",                  # luz e haste da antena
    "t": "#d9684a", "T": "#a8452f",                  # telhado
    "c": "#fff4dc", "C": "#ecd9b4", "s": "#b99d72",  # fachada: luz, corpo e sombra
    "A": "#ffcf5c", "B": "#4d78c9",                  # janela acesa e janela com o céu
    "m": "#3fae74", "d": "#7a5232", "D": "#4a3020",  # toldo e porta
    "g": "#6b7080",                                  # calçada
}


def montar_logo():
    img = Image.new("RGBA", (13, 13), (0, 0, 0, 0))
    for y, linha in enumerate(LOGO):
        for x, ch in enumerate(linha):
            if ch != ".":
                img.putpixel((x, y), tuple(int(CORES_LOGO[ch][i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    destino = os.path.join(SAIDA, "..", "logo.png")
    img.resize((13 * 16, 13 * 16), Image.NEAREST).save(destino, optimize=True)
    print("logo:", os.path.normpath(destino))


if __name__ == "__main__":
    montar_logo() if "--logo" in sys.argv[1:] else main()
