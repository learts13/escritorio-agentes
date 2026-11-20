"""Monta a folha do Bairro (a vista de frente da página Mundo): static/mundo/bairro.png + bairro.json.

As peças vêm do PixelLab (arte/pixellab/bairro, geradas com arte/pixellab/fachada/gerar.py): cada PNG é recortado
no conteúdo e posto lado a lado. O json diz onde cada uma ficou: {"nome": [x, y, w, h]}.
Uso: python3 ferramentas/montar_bairro.py
"""
import json
import os
from PIL import Image

RAIZ = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ORIGEM, SAIDA = os.path.join(RAIZ, "arte", "pixellab", "bairro"), os.path.join(RAIZ, "static", "mundo")
# o cachorro e o banco saem grandes perto da gente (12x18 px): metade, sem suavizar
MEIA = {"cachorro", "banco"}
PECAS = ["escritorio", "vizinho_cafe", "vizinho_casa", "arvore1", "arvore2", "poste", "banco", "carro", "cachorro"]


def main():
    imgs = []
    for n in PECAS:
        im = Image.open(os.path.join(ORIGEM, n + ".png")).convert("RGBA")
        im = im.crop(im.getbbox())
        if n in MEIA: im = im.resize((im.width // 2, im.height // 2), Image.NEAREST)
        imgs.append((n, im))
    folha = Image.new("RGBA", (sum(im.width + 1 for _, im in imgs), max(im.height for _, im in imgs)), (0, 0, 0, 0))
    mapa, x = {}, 0
    for n, im in imgs:
        folha.paste(im, (x, 0)); mapa[n] = [x, 0, im.width, im.height]; x += im.width + 1
    folha.save(os.path.join(SAIDA, "bairro.png"), optimize=True)
    with open(os.path.join(SAIDA, "bairro.json"), "w") as f:
        json.dump(mapa, f, separators=(",", ":"))
    print(mapa)


if __name__ == "__main__":
    main()
