"""Desenha o celular do site: um Galaxy Z Flip 6 aberto (com o escritório na tela) e um fechado (com o aviso na
tela de fora), em pixel art. Uso: python3 flip.py <captura 720x1760 do app> <logo 32 px> <fonte pixel> <saída.webp>
A captura vem do modo demonstração (viewport 360x880, escala 2), na proporção 22:9 da tela do Flip 6."""
import sys
from PIL import Image, ImageDraw, ImageFont

U = 6                                   # pixels da imagem por pixel da arte (a imagem sai em 2x; no site, 3 px por pixel)
TINTA = (13, 13, 18)
ARO = [(143, 179, 217), (92, 128, 176), (52, 78, 116)]      # aro de metal azul: luz, meio, sombra
TAMPA = [(120, 158, 204), (84, 118, 166), (60, 90, 134)]    # vidro colorido da tampa (Flip 6 azul)


def caixa(d, x, y, w, h, cor, r=0):
    """retângulo em unidades da arte, com cantos em degrau de raio r"""
    for j in range(h):
        corte = 0
        if r:
            dy = min(j, h - 1 - j)
            if dy < r:
                corte = r - int(((r * r) - (r - dy - 0.5) ** 2) ** 0.5 + 0.5)
        d.rectangle([(x + corte) * U, (y + j) * U, (x + w - corte) * U - 1, (y + j + 1) * U - 1], fill=cor)


def mascara(w, h, r):
    m = Image.new('L', (w * U, h * U), 0)
    caixa(ImageDraw.Draw(m), 0, 0, w, h, 255, r)
    return m


def aberto(tela):
    W, H = 110, 254                      # tela 100x244 (22:9) + 3 de borda + 2 de aro
    img = Image.new('RGBA', ((W + 2) * U, H * U), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    caixa(d, 2, 0, W - 2, H, ARO[2], 9)                  # botões do lado direito ficam fora do corpo
    caixa(d, 0, 0, W - 2, H, ARO[1], 9)
    caixa(d, 0, 0, W - 3, H - 1, ARO[0], 9)
    caixa(d, 1, 1, W - 4, H - 3, ARO[1], 8)
    caixa(d, 2, 2, W - 6, H - 4, TINTA, 7)               # borda preta
    d.rectangle([(W - 2) * U, 60 * U, (W - 1) * U - 1, 84 * U - 1], fill=ARO[2])   # volume
    d.rectangle([(W - 2) * U, 92 * U, (W - 1) * U - 1, 104 * U - 1], fill=ARO[2])  # liga e digital
    for lado in (0, W - 3):                                                           # dobradiça no aro
        d.rectangle([lado * U, 122 * U, (lado + 3) * U - 1, 132 * U - 1], fill=ARO[2])
        d.rectangle([lado * U, 126 * U, (lado + 3) * U - 1, 128 * U - 1], fill=TINTA)
    t = tela.convert('RGBA').resize((100 * U, 244 * U), Image.LANCZOS)
    img.paste(t, (4 * U, 5 * U), mascara(100, 244, 5))
    vinco = Image.new('RGBA', (100 * U, U), (255, 255, 255, 34))                   # o vinco da dobra na tela
    img.alpha_composite(vinco, (4 * U, 127 * U))
    caixa(d, 52, 8, 3, 3, TINTA, 1)                      # câmera de furo no topo
    d.rectangle([53 * U, 9 * U, 54 * U - 1, 10 * U - 1], fill=(40, 52, 80))
    return img


def fechado(logo, fonte):
    W, H = 66, 78
    img = Image.new('RGBA', (W * U, (H + 2) * U), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    caixa(d, 0, 2, W, H, (0, 0, 0, 90), 8)              # sombra
    caixa(d, 0, 0, W, H, ARO[1], 8)
    caixa(d, 0, 0, W - 1, H - 1, ARO[0], 8)
    caixa(d, 1, 1, W - 2, H - 2, TAMPA[1], 7)
    caixa(d, 2, 2, W - 4, 4, TAMPA[0], 0)                # reflexo no vidro
    caixa(d, 0, H - 8, W, 8, ARO[2], 4)                  # dobradiça embaixo
    caixa(d, 1, H - 7, W - 2, 2, ARO[1], 0)
    # a tela de fora ocupa a tampa, menos o recorte das duas câmeras no canto de baixo à esquerda
    caixa(d, 4, 4, W - 8, 58, TINTA, 4)
    caixa(d, 4, 44, 22, 18, TAMPA[1], 0)
    caixa(d, 4, 40, 4, 22, TAMPA[1], 0)
    for cx in (7, 17):
        caixa(d, cx, 49, 8, 8, ARO[2], 3)
        caixa(d, cx + 1, 50, 6, 6, TINTA, 2)
        d.rectangle([(cx + 2) * U, 51 * U, (cx + 3) * U - 1, 52 * U - 1], fill=(70, 90, 140))
    d.rectangle([28 * U, 52 * U, 30 * U - 1, 54 * U - 1], fill=(255, 236, 170))         # flash
    # o aviso: o mascote, a hora e o pedido
    lg = logo.convert('RGBA').resize((16 * U, 16 * U), Image.NEAREST)
    img.alpha_composite(lg, (8 * U, 8 * U))
    ImageDraw.fontmode = '1'
    d.text((27 * U, 8 * U), '10:30', font=fonte(5 * U), fill=(255, 244, 220))
    d.text((27 * U, 16 * U), 'Firmópolis', font=fonte(3 * U), fill=(245, 184, 61))
    d.text((8 * U, 27 * U), 'Hana precisa', font=fonte(3 * U), fill=(255, 244, 220))
    d.text((8 * U, 32 * U), 'do seu OK', font=fonte(3 * U), fill=(255, 244, 220))
    caixa(d, 40, 30, 18, 8, (245, 184, 61), 2)
    d.text((45 * U, 31 * U + U // 2), "Ver", font=fonte(3 * U), fill=TINTA)
    return img


def main():
    tela, logo, fonte_ttf, saida = sys.argv[1:5]
    fonte = lambda px: ImageFont.truetype(fonte_ttf, px)
    a, f = aberto(Image.open(tela)), fechado(Image.open(logo), fonte)
    W = a.width + f.width - 10 * U
    img = Image.new('RGBA', (W, a.height), (0, 0, 0, 0))
    img.alpha_composite(a, (f.width - 10 * U, 0))
    img.alpha_composite(f, (0, a.height - f.height - 14 * U))
    img.save(saida, 'WEBP', quality=88, method=6)
    print(saida, img.size)


if __name__ == '__main__':
    main()
