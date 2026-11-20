# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Gera site/novidades.html (o changelog do site) a partir do CHANGELOG.pt-BR.md, com o mesmo leitor do app
(novidades.analisar): as 10 entradas mais novas, links só para o repositório. Rode da raiz depois de mudar o CHANGELOG:

    python3 ferramentas/montar_novidades_site.py

Só biblioteca padrão. A saída é estática e determinística (o site não roda JavaScript para isso).
"""
import html
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import novidades  # noqa: E402

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro",
         "novembro", "dezembro"]


def data_br(iso):
    a, m, d = iso.split("-")
    return f"{int(d)} de {MESES[int(m) - 1]} de {a}"


def inline(md):
    """Markdown inline cru (já com os links limpos) para HTML: escapa tudo e só então põe **, ` e [texto](REPO...)."""
    t = html.escape(md, quote=True)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    return re.sub(r"\[([^\[\]]*)\]\((" + re.escape(novidades.REPO) + r"[^)\s\"<>]*)\)",
                  r'<a href="\2" rel="noopener">\1</a>', t)


def entrada(e):
    rotulo = f"Versão {e['versao']}" if e["versao"] else "Marco"
    secoes = "".join(
        f'<h3>{html.escape(s["nome"])}</h3><ul>' + "".join(f"<li>{inline(i)}</li>" for i in s["itens"]) + "</ul>"
        for s in e["secoes"])
    ancora = "v" + e["versao"].replace(".", "-") if e["versao"] else "m" + e["data"]
    return (f'<article class="versao" id="{ancora}"><header class="versao-cabeca">'
            f'<p class="versao-rotulo">{rotulo}</p><h2>{html.escape(e["titulo"])}</h2>'
            f'<p class="versao-data"><time datetime="{e["data"]}">{data_br(e["data"])}</time></p></header>'
            f'<div class="versao-corpo">{secoes}</div></article>')


def main():
    with open(os.path.join(RAIZ, "CHANGELOG.pt-BR.md"), encoding="utf-8") as f:
        entradas = novidades.analisar(f.read())
    with open(os.path.join(RAIZ, "site", "novidades.modelo.html"), encoding="utf-8") as f:
        modelo = f.read()
    corpo = "\n".join(entrada(e) for e in entradas)
    saida = modelo.replace("<!-- ENTRADAS -->", corpo)
    with open(os.path.join(RAIZ, "site", "novidades.html"), "w", encoding="utf-8") as f:
        f.write(saida)
    print(f"site/novidades.html: {len(entradas)} entradas")


if __name__ == "__main__":
    main()
