# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Espelho da ponte local no servidor (opt-in): a ponte de uma máquina (ponte/, em Go) manda por POST a mesma visão
reduzida que o navegador recebe dela (sem alvo de atividade, workspaces só com nomes, o dia sem alvo), e quem é do andar
lê por GET /api/ponte, sem precisar do PC onde a ponte roda. Fica só na memória, com a hora em que chegou: passou de
90 s sem novidade, o espelho conta como desligado. Tudo é conferido e cortado com os mesmos limites do static/ponte.js;
o que a ponte mandar fora disso não é guardado nem devolvido."""
import hmac
import os
import re
import secrets
import threading
import time
from datetime import datetime

from acesso import gravar

CORPO_MAX = 256 * 1024            # o corpo do POST
FRESCOR_S = 90                    # sem envio há mais que isso: {"ativo": false}
INTERVALO_MIN_S = 1.0             # entre dois envios aceitos (a ponte manda a cada ~2 s, no mínimo a cada 30 s)
MAX_MORADORES, MAX_WS, MAX_DIA, MAX_EVENTOS = 48, 32, 200, 200   # os do static/ponte.js
ESTADOS = frozenset({"ocupado", "ocioso", "esperando_permissao", "esperando_resposta", "erro"})
PROVEDORES = frozenset({"claude_code", "codex", "open_code", "antigravity_cli", "minimax_code"})
_CONTROLE = re.compile(r"[\x00-\x1f\x7f]")
_HORA = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})")


class Limite(ValueError):
    """Envio cedo demais depois do último aceito (429)."""


def chave_valida(chave):
    """A chave do ESCRITORIO_PONTE_CHAVE: 64 letras hexadecimais (minúsculas), ou None (espelho desligado)."""
    chave = (chave or "").strip().lower()
    return chave if re.fullmatch(r"[0-9a-f]{64}", chave) else None


def texto(v, maximo):
    return _CONTROLE.sub("", v).strip()[:maximo] if isinstance(v, str) else ""


def hora(v):
    """A hora RFC 3339 da ponte (Go manda até 9 casas de fração) como datetime, ou None."""
    m = _HORA.fullmatch(v) if isinstance(v, str) and len(v) < 64 else None
    if not m:
        return None
    try:
        return datetime.fromisoformat(m[1] + ("." + m[2][:6].ljust(6, "0") if m[2] else "") +
                                      ("+00:00" if m[3] == "Z" else m[3]))
    except ValueError:
        return None


def _morador(m):
    if not isinstance(m, dict) or not texto(m.get("id"), 200) or not isinstance(m.get("estado"), str) or m.get("estado") not in ESTADOS:
        return None
    at, aj = m.get("atividade"), m.get("ajudantes")
    return {"id": texto(m["id"], 200), "nome": texto(m.get("nome"), 40),
            "provedor": m["provedor"] if isinstance(m.get("provedor"), str) and m["provedor"] in PROVEDORES else "", "estado": m["estado"],
            "projeto": texto(m.get("projeto"), 60),
            "atividade": {"ferramenta": texto(at.get("ferramenta"), 40)} if isinstance(at, dict) else None,
            "gerente": m.get("gerente") is True, "papel": texto(m.get("papel"), 40),
            "workspace_id": texto(m.get("workspace_id"), 200), "band_id": texto(m.get("band_id"), 200),
            "solto": m.get("solto") is True,
            "ajudantes": max(0, min(99, aj)) if isinstance(aj, int) and not isinstance(aj, bool) else 0,
            "desde": m["desde"] if hora(m.get("desde")) else ""}


def _workspaces(lista):
    saida = []
    for w in lista[:MAX_WS] if isinstance(lista, list) else []:
        if not isinstance(w, dict) or not texto(w.get("id"), 200):
            continue
        bands = [{"id": texto(b["id"], 200), "nome": texto(b.get("nome"), 60)}
                 for b in (w.get("bands")[:MAX_WS] if isinstance(w.get("bands"), list) else [])
                 if isinstance(b, dict) and texto(b.get("id"), 200)]
        saida.append({"id": texto(w["id"], 200), "nome": texto(w.get("nome"), 60), "bands": bands})
    return saida


def _dia(eventos):
    """Os eventos válidos (hora, morador, estado e ferramenta; nunca o alvo), os 200 mais novos de até 200 moradores."""
    por_id = {}
    validos = []
    for e in eventos if isinstance(eventos, list) else []:
        quando = hora(e.get("ts")) if isinstance(e, dict) else None
        if quando is None or not texto(e.get("morador_id"), 200) or not isinstance(e.get("estado"), str) or e.get("estado") not in ESTADOS:
            continue
        validos.append((quando, {"ts": e["ts"], "morador_id": texto(e["morador_id"], 200), "estado": e["estado"],
                                 "ferramenta": texto(e.get("ferramenta"), 40)}))
    validos.sort(key=lambda par: par[0])
    for _, e in validos:
        lista = por_id.get(e["morador_id"])
        if lista is None:
            if len(por_id) >= MAX_DIA:
                continue
            lista = por_id[e["morador_id"]] = []
        lista.append(e)
    return [e for lista in por_id.values() for e in lista[-MAX_EVENTOS:]]


def validar(dados):
    """O corpo da ponte já conferido e cortado, ou ValueError (400)."""
    if not isinstance(dados, dict) or type(dados.get("v")) is not int or dados.get("v") != 1 or not isinstance(dados.get("moradores"), list):
        raise ValueError("formato")
    moradores, ids = [], set()
    for m in dados["moradores"][:MAX_MORADORES]:
        t = _morador(m)
        if t and t["id"] not in ids:
            ids.add(t["id"])
            moradores.append(t)
    return {"moradores": moradores, "workspaces": _workspaces(dados.get("workspaces")), "dia": _dia(dados.get("dia"))}


class Espelho:
    """A chave e o último espelho recebido (só na memória). A chave vem da variável ESCRITORIO_PONTE_CHAVE (fixa) ou do
    arquivo em dados/ que a tela gera (Personalizar > Ponte local); sem nenhuma, o espelho está desligado. relogio: o
    monotônico (os testes trocam)."""

    def __init__(self, chave_fixa=None, arquivo=None, relogio=time.monotonic):
        self._fixa, self._arquivo, self._agora = chave_valida(chave_fixa), arquivo, relogio
        self._trava = threading.Lock()
        self._dados, self._quando = None, None
        self._chave = self._fixa or self._ler_arquivo()

    def _ler_arquivo(self):
        try:
            with open(self._arquivo, encoding="utf-8") as f:
                return chave_valida(f.read(100))
        except (OSError, TypeError, ValueError):
            return None

    def origem(self):
        """De onde vem a chave: "variavel", "tela" ou "" (desligado)."""
        with self._trava:
            return "variavel" if self._fixa else "tela" if self._chave else ""

    def ligado(self):
        with self._trava:
            return self._chave is not None

    def gerar(self):
        """Uma chave nova no arquivo (a anterior para de valer na hora). Com a variável, ValueError: quem manda é ela."""
        with self._trava:
            if self._fixa or not self._arquivo:
                raise ValueError("variavel")
            chave = secrets.token_hex(32)
            gravar(self._arquivo, chave.encode())   # 0600, atômico
            self._chave, self._dados, self._quando = chave, None, None
            return chave

    def desligar(self):
        """Apaga a chave da tela e o que foi recebido. Com a variável, ValueError."""
        with self._trava:
            if self._fixa:
                raise ValueError("variavel")
            try:
                os.unlink(self._arquivo)
            except (OSError, TypeError):
                pass
            self._chave, self._dados, self._quando = None, None, None

    def autorizado(self, cabecalho):
        with self._trava:
            esperado = ("Bearer " + self._chave).encode() if self._chave else None
        bruto = (cabecalho or "").encode("utf-8", "replace")
        return esperado is not None and hmac.compare_digest(bruto, esperado)

    def receber(self, dados):
        """Guarda o espelho (validar() antes de tudo). {"teste": true} só confere a chave e o formato (ponte conectar):
        não troca o que está guardado. Limite: cedo demais depois do último aceito."""
        limpo = validar(dados)
        if dados.get("teste") is True:
            return
        with self._trava:
            agora = self._agora()
            if self._quando is not None and agora - self._quando < INTERVALO_MIN_S:
                raise Limite("cedo")
            self._dados, self._quando = limpo, agora

    def ler(self):
        with self._trava:
            if self._dados is None or self._chave is None or self._agora() - self._quando >= FRESCOR_S:
                return {"ativo": False}
            return {"ativo": True, "idade_s": int(self._agora() - self._quando), **self._dados}
