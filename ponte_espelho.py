# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Espelho da ponte local no servidor (opt-in): a ponte de uma máquina (ponte/, em Go) manda por POST a mesma visão
reduzida que o navegador recebe dela (sem alvo de atividade, workspaces só com nomes, o dia sem alvo), e quem é do andar
lê por GET /api/ponte, sem precisar do PC onde a ponte roda. Fica só na memória, com a hora em que chegou: passou de
90 s sem novidade, o espelho conta como desligado. Tudo é conferido e cortado com os mesmos limites do static/ponte.js;
o que a ponte mandar fora disso não é guardado nem devolvido.

Responder pelo escritório (v2 do espelho): a ponte manda também os pedidos de permissão que esperam (a ferramenta e um
resumo já mascarado, até 300 caracteres; nunca a entrada inteira, a pasta nem o histórico). Quem decide (o admin do
prédio ou um ESCRITORIO_PONTE_DECISORES) responde por POST /api/ponte/decidir; a decisão fica numa fila na memória e a
ponte a busca por long-poll (GET /api/ponte/decisoes), uma vez só. Cada id vale uma decisão.

Fase 2, as perguntas: quando um terminal espera uma resposta, a ponte manda um pedido do tipo "pergunta" (o texto da
pergunta só quando o agente o dá, mascarado). Quem decide responde com {"id", "acao": "responder", "texto"}: até 1000
caracteres visíveis numa linha só (texto_resposta), e só com o terminal na pergunta no último espelho. A ponte confere
tudo de novo antes de digitar."""
import hmac
import os
import re
import secrets
import threading
import time
import unicodedata
from datetime import datetime, timedelta, timezone

from acesso import gravar

CORPO_MAX = 256 * 1024            # o corpo do POST
FRESCOR_S = 90                    # sem envio há mais que isso: {"ativo": false}
INTERVALO_MIN_S = 1.0             # entre dois envios aceitos (a ponte manda a cada ~2 s, no mínimo a cada 30 s)
MAX_MORADORES, MAX_WS, MAX_DIA, MAX_EVENTOS = 48, 32, 200, 200   # os do static/ponte.js
ESTADOS = frozenset({"ocupado", "ocioso", "esperando_permissao", "esperando_resposta", "erro"})
PROVEDORES = frozenset({"claude_code", "codex", "open_code", "antigravity_cli", "minimax_code"})
_CONTROLE = re.compile(r"[\x00-\x1f\x7f]")
MAX_PENDENTES, MAX_RESUMO, MAX_FERRAMENTA = 16, 300, 80   # os da ponte (decisao.Max, MaxResumo e MaxFerramenta)
PRAZO_MAX = timedelta(minutes=10)            # um pedido não espera mais que isso (a ponte espera até 2 min)
ESPERA_MAX_S = 25                            # o long-poll das decisões
ATENDENDO_S = 10                             # quem decide leu o /api/ponte há menos que isso: alguém atendendo
DECISOES_POR_MIN = 20                        # por pessoa
ACOES = frozenset({"permitir", "negar"})
RESPONDER = "responder"                      # a ação da pergunta, com o texto
MAX_TEXTO = 1000                             # o da ponte (decisao.MaxTexto), em caracteres
VIAS = frozenset({"maestri", "opencode"})    # por onde a resposta chega ao agente
_ID = re.compile(r"[A-Za-z0-9_-]{22}")
_HORA = re.compile(r"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})")


class Limite(ValueError):
    """Envio cedo demais depois do último aceito (429)."""


class Encerrado(LookupError):
    """O pedido não existe, já venceu ou já foi decidido (410)."""


class Incompleto(ValueError):
    """Permitir um pedido cujo resumo não conta tudo (cortado, arquivo fora do projeto): só de perto (409)."""


class TipoErrado(ValueError):
    """Texto para um pedido de permissão, ou permitir/negar uma pergunta (409)."""


class ForaDaPergunta(ValueError):
    """O terminal da pergunta não está mais esperando uma resposta no último espelho (409)."""


def texto_resposta(v):
    """A resposta de uma pergunta sem os espaços das pontas, ou None. Como o decisao.ValidarTexto da ponte, recusa (não
    troca): mais de MAX_TEXTO caracteres, a barra invertida (o maestri --raw lê \\n, \\e e \\xNN como teclas) e tudo o que
    não é letra, marca, número, pontuação, símbolo ou espaço: controle (quebra de linha, tab, ESC), C1, bidi, largura
    zero, separador de linha, uso privado, surrogate solto e não atribuído; e o texto que começa com "-"."""
    if not isinstance(v, str) or len(v) > MAX_TEXTO or "\\" in v:
        return None
    for c in v:
        cat = unicodedata.category(c)
        if cat[0] not in "LMNPS" and cat != "Zs":
            return None
    v = v.strip()
    return v if v and not v.startswith("-") else None   # começando com "-", viraria opção do maestri


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


def visivel(v, maximo):
    """O texto de um pedido de permissão: os caracteres invisíveis ou enganosos (controle, C1, bidi, largura zero: as
    categorias Cc e Cf) viram uma marca visível, como ‹U+202E›, e corta em maximo. Nada se esconde nem inverte."""
    if not isinstance(v, str):
        return ""
    s = "".join(f"‹U+{ord(c):04X}›" if unicodedata.category(c) in ("Cc", "Cf") and c != "\t" else c
                for c in v.replace("\t", " "))
    return s.strip()[:maximo]


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


def id_valido(v):
    return isinstance(v, str) and _ID.fullmatch(v) is not None


def _pendentes(lista, agora):
    """Os pedidos válidos e ainda no prazo: id, morador, ferramenta, resumo e o vencimento (datetime UTC)."""
    saida, ids = [], set()
    for p in lista[:MAX_PENDENTES] if isinstance(lista, list) else []:
        expira = hora(p.get("expira_em")) if isinstance(p, dict) else None
        if expira is None or not id_valido(p.get("id")) or p["id"] in ids or p.get("tipo") not in ("permissao", "pergunta") \
                or not texto(p.get("morador_id"), 200) or not (agora < expira <= agora + PRAZO_MAX):
            continue
        if p["tipo"] == "pergunta":   # a pergunta: o texto dela (se houver) e por onde a resposta chega
            if p.get("via") not in VIAS:
                continue
            ids.add(p["id"])
            saida.append({"id": p["id"], "morador_id": texto(p["morador_id"], 200), "tipo": "pergunta", "ferramenta": "",
                          "resumo": visivel(p.get("resumo"), MAX_RESUMO), "completo": False, "via": p["via"],
                          "expira": expira.astimezone(timezone.utc)})
            continue
        ids.add(p["id"])
        ferramenta, resumo = visivel(p.get("ferramenta"), MAX_FERRAMENTA), visivel(p.get("resumo"), MAX_RESUMO)
        # completo só se a ponte disse e nada foi cortado aqui: senão, de longe, só Negar
        completo = p.get("completo") is True and bool(ferramenta) and bool(resumo) \
            and ferramenta == p.get("ferramenta") and resumo == p.get("resumo")
        saida.append({"id": p["id"], "morador_id": texto(p["morador_id"], 200), "tipo": "permissao",
                      "ferramenta": ferramenta, "resumo": resumo, "completo": completo,
                      "expira": expira.astimezone(timezone.utc)})
    return saida


def validar(dados, agora=None):
    """O corpo da ponte já conferido e cortado, ou ValueError (400). v1 sem os pedidos; v2 com eles."""
    if not isinstance(dados, dict) or type(dados.get("v")) is not int or dados.get("v") not in (1, 2) or not isinstance(dados.get("moradores"), list):
        raise ValueError("formato")
    moradores, ids = [], set()
    for m in dados["moradores"][:MAX_MORADORES]:
        t = _morador(m)
        if t and t["id"] not in ids:
            ids.add(t["id"])
            moradores.append(t)
    pendentes = _pendentes(dados.get("pendentes"), agora or datetime.now(timezone.utc)) if dados["v"] == 2 else []
    return {"moradores": moradores, "workspaces": _workspaces(dados.get("workspaces")), "dia": _dia(dados.get("dia")),
            "pendentes": pendentes}


class Espelho:
    """A chave e o último espelho recebido (só na memória). A chave vem da variável ESCRITORIO_PONTE_CHAVE (fixa) ou do
    arquivo em dados/ que a tela gera (Personalizar > Ponte local); sem nenhuma, o espelho está desligado. relogio: o
    monotônico (os testes trocam)."""

    def __init__(self, chave_fixa=None, arquivo=None, relogio=time.monotonic, utc=None):
        self._fixa, self._arquivo, self._agora = chave_valida(chave_fixa), arquivo, relogio
        self._utc = utc or (lambda: datetime.now(timezone.utc))
        self._trava = threading.Lock()
        self._sinal = threading.Condition(self._trava)   # acorda o long-poll: decisão nova ou alguém começou a atender
        self._dados, self._quando = None, None
        self._chave = self._fixa or self._ler_arquivo()
        self._usados = {}          # id decidido → vencimento (não vale de novo, nem se a ponte mandar outra vez)
        self._fila = []            # decisões à espera da ponte
        self._atendido = None      # monotônico da última leitura de quem decide
        self._por_pessoa = {}      # usuário → monotônicos das últimas decisões (limite por minuto)

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
            self._fila.clear()
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
            self._fila.clear()

    def autorizado(self, cabecalho):
        with self._trava:
            esperado = ("Bearer " + self._chave).encode() if self._chave else None
        bruto = (cabecalho or "").encode("utf-8", "replace")
        return esperado is not None and hmac.compare_digest(bruto, esperado)

    def receber(self, dados):
        """Guarda o espelho (validar() antes de tudo). {"teste": true} só confere a chave e o formato (ponte conectar):
        não troca o que está guardado. Limite: cedo demais depois do último aceito."""
        limpo = validar(dados, self._utc())
        if dados.get("teste") is True:
            return
        with self._trava:
            agora = self._agora()
            if self._quando is not None and agora - self._quando < INTERVALO_MIN_S:
                raise Limite("cedo")
            self._dados, self._quando = limpo, agora

    def ler(self, decide=False):
        """O espelho fresco. decide: quem lê pode responder (os pedidos vão junto, e conta como alguém atendendo);
        sem isso, os pedidos nunca saem daqui."""
        with self._trava:
            if self._dados is None or self._chave is None or self._agora() - self._quando >= FRESCOR_S:
                return {"ativo": False}
            saida = {"ativo": True, "idade_s": int(self._agora() - self._quando),
                     **{k: v for k, v in self._dados.items() if k != "pendentes"}}
            if decide:
                if not self._atendendo():
                    self._sinal.notify_all()   # a ponte fica sabendo já, não no fim do long-poll
                self._atendido = self._agora()
                agora = self._utc()
                saida["pendentes"] = [{**{k: v for k, v in p.items() if k != "expira"},
                                       "resta_s": max(0, int((p["expira"] - agora).total_seconds()))}
                                      for p in self._pendentes_vivos(agora)]
            return saida

    # ---------- responder pelo escritório (os _ chamam com a trava) ----------
    def _atendendo(self):
        return self._atendido is not None and self._agora() - self._atendido < ATENDENDO_S

    def _pendentes_vivos(self, agora):
        for i, venc in list(self._usados.items()):
            if venc <= agora:
                del self._usados[i]
        if self._dados is None or self._agora() - self._quando >= FRESCOR_S:
            return []
        return [p for p in self._dados.get("pendentes", []) if p["expira"] > agora and p["id"] not in self._usados]

    def limite_decisao(self, usuario):
        """Conta uma tentativa de decisão; False passou de DECISOES_POR_MIN no último minuto (429)."""
        with self._trava:
            agora = self._agora()
            vezes = [t for t in self._por_pessoa.get(usuario, []) if agora - t < 60]
            if len(vezes) >= DECISOES_POR_MIN:
                self._por_pessoa[usuario] = vezes
                return False
            self._por_pessoa[usuario] = vezes + [agora]
            for u in [u for u, ts in self._por_pessoa.items() if not ts or agora - ts[-1] >= 60]:
                del self._por_pessoa[u]
            return True

    def decidir(self, id_, acao, texto_=None):
        """Põe a decisão (ou a resposta da pergunta, com o texto) na fila da ponte e devolve o pedido (para o log).
        Encerrado: o id não existe, venceu ou já foi decidido. TipoErrado: texto para permissão ou permitir/negar uma
        pergunta. ForaDaPergunta: o terminal não está mais na pergunta (o pedido segue valendo)."""
        if acao not in ACOES and acao != RESPONDER or not id_valido(id_):
            raise ValueError("pedido")
        if acao == RESPONDER:
            texto_ = texto_resposta(texto_)
            if texto_ is None:
                raise ValueError("texto")
        with self._trava:
            agora = self._utc()
            p = next((p for p in self._pendentes_vivos(agora) if p["id"] == id_), None)
            if p is None or self._chave is None:
                raise Encerrado(id_)
            if (acao == RESPONDER) != (p["tipo"] == "pergunta"):
                raise TipoErrado(id_)
            if acao == "permitir" and not p["completo"]:
                raise Incompleto(id_)
            if acao == RESPONDER and not any(m["id"] == p["morador_id"] and m["estado"] == "esperando_resposta"
                                             for m in self._dados["moradores"]):
                raise ForaDaPergunta(id_)
            self._usados[id_] = p["expira"]
            self._fila.append({"id": id_, "acao": acao, **({"texto": texto_} if acao == RESPONDER else {})})
            del self._fila[:-MAX_PENDENTES]
            self._sinal.notify_all()
            return {"ferramenta": p["ferramenta"], "morador_id": p["morador_id"], "tipo": p["tipo"]}

    def esperar_decisoes(self, espera_s):
        """O long-poll da ponte: as decisões novas (cada uma entregue uma vez só) e se alguém está atendendo. Volta na
        hora com decisão na fila; senão, na primeira decisão, quando alguém começar a atender ou no fim da espera."""
        with self._trava:
            fim = self._agora() + espera_s
            ja_atendia = self._atendendo()
            while not self._fila and self._chave is not None and self._atendendo() == ja_atendia:
                resta = fim - self._agora()
                if resta <= 0:
                    break
                self._sinal.wait(min(resta, 1.0))
            decisoes, self._fila = self._fila, []
            return decisoes, self._atendendo()
