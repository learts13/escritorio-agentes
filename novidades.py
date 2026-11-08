# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Novidades: o CHANGELOG.pt-BR.md da versão instalada, para a página "Novidades" (GET /api/novidades).

Lido do disco e guardado em memória pelo mtime (e pelo tamanho): só um arquivo novo é lido de novo. Nada aqui chama o
agentes.chat. Cada "## " é uma entrada ("1.1.0 · 2026-11-08 · Título" ou "2026-11-06 · Título"; sem data válida, como
o "Não lançado", fica de fora), cada "### " uma seção e cada "- " um item, em markdown inline cru. Os links saem só para
o repositório (os relativos ./ viram o /blob/main/ dele); qualquer outro vira o texto dele. Quem desenha é o navegador,
só com textContent.
Só biblioteca padrão do Python 3.
"""
import datetime
import os
import re
import threading

ARQUIVO_MAX = 1024 * 1024   # um changelog maior que isso é tratado como ilegível
ENTRADAS_MAX, ITEM_MAX, TITULO_MAX, SECAO_MAX = 10, 2000, 200, 80
REPO = "https://github.com/HelbertMoura/escritorio-agentes/"
VERSAO_OK = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
DATA_OK = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
# Texto e endereço sem "[": cada tentativa para no próximo "[", então milhares de "[" ou de "[a](" custam tempo linear
LINK = re.compile(r"\[([^\[\]\n]*)\]\(([^)\s\[]*)\)")
# \w: letras com acento valem (a âncora "#modo-construção" do README); aspas, espaços, < > e parênteses, nunca
LINK_REPO = re.compile(re.escape(REPO) + r"[\w.~/#%+=&?:-]*")
RELATIVO = re.compile(r"\./[\w.~/#%+-]+")


def cortar(texto, maximo):
    return texto if len(texto) <= maximo else texto[:maximo - 1] + "…"


def do_repo(url):
    """Só o REPO, sem segmento "." ou ".." no caminho (nem %2e): o navegador resolveria para fora dele. O "..." do
    compare (v2026.11.06...v1.1.0) é um segmento comum."""
    if not LINK_REPO.fullmatch(url):
        return False
    caminho = re.split(r"[?#]", url[len(REPO):], maxsplit=1)[0]
    return all(s.lower().replace("%2e", ".") not in (".", "..") for s in caminho.split("/"))


def _link(m):
    texto, url = m.group(1), m.group(2)
    if RELATIVO.fullmatch(url):
        url = REPO + "blob/main/" + url[2:]
    return f"[{texto}]({url})" if do_repo(url) else texto


def limpar_links(texto):
    """Os links do REPO ficam; os outros viram o texto. Depois, todo "](" que sobrou fora de um link do REPO (o de fora
    de um aninhado, um endereço com "[") vira "] (": o navegador só lê como link o que tem "](", e assim todo link que
    ele achar termina num endereço do REPO. Duas passadas lineares, sem repetir até parar de mudar."""
    texto = LINK.sub(_link, texto)
    saida, fim = [], 0
    for m in LINK.finditer(texto):
        if do_repo(m.group(2)):
            saida += [texto[fim:m.start()].replace("](", "] ("), m.group(0)]
            fim = m.end()
    saida.append(texto[fim:].replace("](", "] ("))
    return "".join(saida)


def _data(x):
    if not DATA_OK.fullmatch(x):
        return None
    try:
        return datetime.date.fromisoformat(x).isoformat()
    except ValueError:
        return None


def _titulo(linha):
    """'1.1.0 · 2026-11-08 · Conectar…' -> (titulo, versao, data); a versão e a data só valem no começo."""
    partes = [p.strip() for p in linha.split("·")]
    versao = partes.pop(0) if len(partes) > 1 and VERSAO_OK.fullmatch(partes[0]) else None
    data = _data(partes[0]) if partes else None
    if data:
        partes.pop(0)
    titulo = " · ".join(p for p in partes if p) or versao or data or ""
    return cortar(titulo, TITULO_MAX), versao, data


def analisar(texto):
    """O texto do changelog -> as entradas, das mais novas para as mais antigas (no máximo ENTRADAS_MAX)."""
    entradas, entrada, secao, item = [], None, None, None
    for linha in texto.splitlines():
        if linha.startswith("## "):
            titulo, versao, data = _titulo(linha[3:])
            entrada = {"titulo": titulo, "versao": versao, "data": data, "secoes": []} if data else None
            if entrada:
                entradas.append(entrada)
            secao = item = None
        elif linha.startswith("# "):
            entrada = secao = item = None
        elif entrada is None:
            continue
        elif linha.startswith("### "):
            nome = linha[4:].strip()
            secao = {"nome": cortar(nome, SECAO_MAX), "itens": []} if nome else None
            if secao:
                entrada["secoes"].append(secao)
            item = None
        elif secao is not None and linha[:2] in ("- ", "* "):
            item = [linha[2:].strip()]
            secao["itens"].append(item)
        elif item is not None and linha[:1] in (" ", "\t") and linha.strip():   # continuação do item, indentada
            item.append(linha.strip())
        else:
            item = None
    for ent in entradas:
        for sec in ent["secoes"]:
            # corta antes (a regex só vê 2.000 caracteres) e depois (o ./ relativo cresce ao virar o endereço do REPO)
            sec["itens"] = [cortar(limpar_links(cortar(" ".join(partes), ITEM_MAX)), ITEM_MAX) for partes in sec["itens"]]
        ent["secoes"] = [sec for sec in ent["secoes"] if sec["itens"]]
    # sorted é estável: as entradas do mesmo dia ficam na ordem do arquivo
    return sorted(entradas, key=lambda ent: ent["data"], reverse=True)[:ENTRADAS_MAX]


class Novidades:
    def __init__(self, caminho, log):
        self.caminho, self.log = caminho, log
        self.trava = threading.Lock()
        self.chave, self.erro, self.entradas = None, None, []   # chave: (mtime, tamanho) da última leitura, boa ou ruim

    def publico(self):
        """As entradas do changelog. Ausente, grande demais ou ilegível: [] e 1 linha de log. O resultado, bom ou ruim, fica
        na memória até o arquivo mudar."""
        with self.trava:
            try:
                st = os.stat(self.caminho)
            except OSError as x:
                return self._falha(None, x)
            chave = (st.st_mtime_ns, st.st_size)
            if chave == self.chave:
                return self.entradas
            try:
                if st.st_size > ARQUIVO_MAX:
                    raise ValueError("grande demais")
                with open(self.caminho, encoding="utf-8-sig") as f:
                    entradas = analisar(f.read())
            except (OSError, ValueError) as x:   # UnicodeDecodeError é ValueError
                return self._falha(chave, x)
            self.chave, self.erro, self.entradas = chave, None, entradas
            return entradas

    def _falha(self, chave, x):
        erro = type(x).__name__
        if (chave, erro) != (self.chave, self.erro):
            self.log(evento="novidades", resultado="ilegivel", detalhe=erro)
        self.chave, self.erro, self.entradas = chave, erro, []
        return []
