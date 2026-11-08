# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Jornal do escritório: os números da semana (de segunda a domingo, no fuso de Brasília) para a página "Jornal", que
monta a manchete e as notas no navegador. Só ids de agentes e números: nenhum rótulo, conversa ou pessoa.

Por agente: as tarefas que terminaram e as aprovações e respostas pedidas (das transições que o Diario já calcula) e os
minutos trabalhando, aproximados pelas leituras. Por dia: o tipo de clima da primeira leitura a partir do meio-dia, as
greves e as brigas (ganchos do social.py). Guarda só a semana atual e a anterior; quem lê e grava o dados/jornal.json é
o escritorio.py (ler_jornal e o guardar que ele passa), no máximo uma vez por minuto. Nada aqui chama o agentes.chat.
"""
import datetime
import json
import re
import threading

JORNAL_BYTES, JORNAL_MAX, JORNAL_TETO = 64 * 1024, 500, 1_000_000   # tamanho do arquivo, agentes por semana, maior número
GRAVA_A_CADA = 60
CREDITO_MAX = 120   # s de trabalho que uma leitura credita: um buraco maior (pausa, reinício) não vira trabalho
CAMPOS = ("tarefas", "aprovacoes", "respostas", "minutos")   # no arquivo, cada agente é a lista nesta ordem
EVENTOS = {"terminou": 0, "pediu_aprovacao": 1, "pediu_resposta": 2}
TRABALHANDO = frozenset({"running", "still_running"})
CLIMAS = frozenset({"limpo", "nublado", "neblina", "garoa", "chuva", "neve", "tempestade"})   # os do tipo_do_clima
ID_OK = re.compile(r"[A-Za-z0-9_-]{1,100}")
DATA_OK = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")


def segunda(dia):
    return dia - datetime.timedelta(days=dia.weekday())


def _numero(x):
    if type(x) is not int or not 0 <= x <= JORNAL_TETO:   # type(): o True não vale como 1
        raise ValueError("número fora da faixa")
    return x


def _data(x):
    if not isinstance(x, str) or not DATA_OK.fullmatch(x):
        raise ValueError("data")
    return datetime.date.fromisoformat(x)


def validar(d):
    """Tudo ou nada: o jornal.json no formato exato, ou ValueError. Devolve as semanas limpas."""
    if not isinstance(d, dict) or set(d) != {"v", "semanas"} or type(d["v"]) is not int or d["v"] != 1 \
            or not isinstance(d["semanas"], dict) or len(d["semanas"]) > 2:
        raise ValueError("formato")
    semanas = {}
    for chave, sem in d["semanas"].items():
        inicio = _data(chave)
        if inicio.weekday() != 0 or not isinstance(sem, dict) or set(sem) != {"agentes", "dias"} \
                or not isinstance(sem["agentes"], dict) or len(sem["agentes"]) > JORNAL_MAX \
                or not isinstance(sem["dias"], dict) or len(sem["dias"]) > 7:
            raise ValueError("semana")
        agentes = {}
        for i, x in sem["agentes"].items():
            if not ID_OK.fullmatch(i) or not isinstance(x, list) or len(x) != len(CAMPOS):
                raise ValueError("agente")
            agentes[i] = [_numero(n) for n in x]
        dias = {}
        for dia, x in sem["dias"].items():
            if not 0 <= (_data(dia) - inicio).days < 7 or not isinstance(x, dict) or set(x) != {"clima", "greves", "brigas"} \
                    or not (x["clima"] is None or isinstance(x["clima"], str) and x["clima"] in CLIMAS):
                raise ValueError("dia")
            dias[dia] = {"clima": x["clima"], "greves": _numero(x["greves"]), "brigas": _numero(x["brigas"])}
        semanas[chave] = {"agentes": agentes, "dias": dias}
    return semanas


class Jornal:
    """Os contadores, sob uma trava. Quem conta: o Leitor (ler, a cada leitura que deu certo) e o Social (contar, nas
    brigas e greves). Só o ler() grava, fora da trava; o GET /api/jornal só lê."""

    def __init__(self, log, fuso, guardar=None, semanas=None, clima=None):
        """guardar(bytes) grava o jornal.json (o gravar() atômico do escritorio.py); semanas é o que o ler_jornal() leu
        ao subir (validado, ou None); clima() devolve o tipo do clima de agora, ou None."""
        self.log, self.fuso, self.guardar, self.clima = log, fuso, guardar, clima
        self.trava = threading.Lock()
        self.semanas = semanas or {}
        self.ultima = None   # instante da última leitura (o crédito dos minutos)
        self.resto = {}   # agente -> segundos de trabalho que ainda não fecharam um minuto
        self.sujo, self.gravado_em, self.falhou_gravar, self.erros = False, None, False, set()
        self.pular = False   # depois do zerar(): a leitura seguinte não conta as transições (as tarefas da conta velha somem)

    def _semana(self, agora):
        """(a semana do instante, criada se preciso, e o dia em ISO). Saem as semanas fora da atual e da anterior."""
        dia = datetime.datetime.fromtimestamp(agora, self.fuso).date()
        inicio = segunda(dia)
        vale = {inicio.isoformat(), (inicio - datetime.timedelta(days=7)).isoformat()}
        for chave in [k for k in self.semanas if k not in vale]:
            del self.semanas[chave]
            self.sujo = True
        return self.semanas.setdefault(inicio.isoformat(), {"agentes": {}, "dias": {}}), dia.isoformat()

    def _somar(self, sem, agente, campo, n):
        x = sem["agentes"].get(agente)
        if x is None:   # agente novo só entra com id que o validar aceita e abaixo do teto
            if len(sem["agentes"]) >= JORNAL_MAX or not isinstance(agente, str) or not ID_OK.fullmatch(agente):
                return
            x = sem["agentes"][agente] = [0] * len(CAMPOS)
        x[campo] = min(x[campo] + n, JORNAL_TETO)
        self.sujo = True

    @staticmethod
    def _dia(sem, dia):
        return sem["dias"].setdefault(dia, {"clima": None, "greves": 0, "brigas": 0})

    def ler(self, novos, resumo, agora):
        """Uma leitura do Leitor: as transições novas do Diario ((tipo, id do agente, ...)), o trabalho desde a leitura anterior
        e o clima do meio-dia. Nunca levanta: um erro aqui não pode virar falha de leitura (1 linha de log por tipo)."""
        try:
            with self.trava:
                dados = self._ler(novos, resumo, agora)
            if dados is not None:
                self._gravar(dados)
        except Exception as x:
            if type(x).__name__ not in self.erros:
                self.erros.add(type(x).__name__)
                self.log(evento="jornal", resultado="erro", detalhe=type(x).__name__)

    def _ler(self, novos, resumo, agora):
        sem, dia = self._semana(agora)
        novos, self.pular = () if self.pular else novos, False
        for tipo, agente, *_ in novos:   # (tipo, id do agente, run_id); o run_id é do push
            if tipo in EVENTOS:
                self._somar(sem, agente, EVENTOS[tipo], 1)
        credito = min(agora - self.ultima, CREDITO_MAX) if self.ultima is not None else 0
        self.ultima = agora
        trabalhando = {t["agente_id"] for t in resumo.get("tarefas", []) if t["status"] in TRABALHANDO}
        resto = {}
        for ag in sorted(trabalhando) if credito > 0 else ():
            minutos, resto[ag] = divmod(self.resto.get(ag, 0) + credito, 60)
            if minutos:
                self._somar(sem, ag, 3, int(minutos))
        self.resto = resto   # quem parou de trabalhar perde a sobra: a conta é aproximada
        if self.clima and datetime.datetime.fromtimestamp(agora, self.fuso).hour >= 12 and \
                sem["dias"].get(dia, {}).get("clima") is None:
            tipo = self.clima()
            if tipo in CLIMAS:
                self._dia(sem, dia)["clima"] = tipo
                self.sujo = True
        if not self.sujo or not self.guardar or (self.gravado_em is not None and agora - self.gravado_em < GRAVA_A_CADA):
            return None
        self.sujo, self.gravado_em = False, agora
        return self._serializar()

    def _gravar(self, dados):
        try:
            self.guardar(dados)
            self.falhou_gravar = False
        except Exception as x:   # tenta de novo na próxima leitura, depois de 1 minuto; 1 linha de log por episódio
            with self.trava:
                self.sujo = True
            if not self.falhou_gravar:
                self.falhou_gravar = True
                self.log(evento="jornal", resultado="nao_gravou", detalhe=type(x).__name__)

    def _serializar(self):
        """O jornal.json (sob a trava). Acima dos 64 KB, saem da semana mais velha os agentes de menos atividade."""
        while True:
            dados = json.dumps({"v": 1, "semanas": self.semanas}, separators=(",", ":")).encode()
            if len(dados) <= JORNAL_BYTES:
                return dados
            sem = self.semanas[min(k for k in self.semanas if self.semanas[k]["agentes"])]
            del sem["agentes"][min(sem["agentes"], key=lambda i: (sum(sem["agentes"][i]), i))]

    def contar(self, tipo, agora):
        """Gancho do social.py: "briga" (no fim da luta) ou "greve" (quando começa). Grava na leitura seguinte."""
        with self.trava:
            sem, dia = self._semana(agora)
            d = self._dia(sem, dia)
            campo = {"briga": "brigas", "greve": "greves"}[tipo]
            d[campo] = min(d[campo] + 1, JORNAL_TETO)
            self.sujo = True

    def publico(self, agora, presentes):
        """GET /api/jornal: a semana atual e a anterior, só com os agentes presentes (o navegador já tem os nomes)."""
        inicio = segunda(datetime.datetime.fromtimestamp(agora, self.fuso).date())
        with self.trava:
            atual, anterior = (self._publica(inicio - datetime.timedelta(days=7 * n), presentes) for n in (0, 1))
        return {"v": 1, "semana": atual, "anterior": anterior}

    def _publica(self, inicio, presentes):
        sem = self.semanas.get(inicio.isoformat(), {"agentes": {}, "dias": {}})
        return {"inicio": inicio.isoformat(),
                "agentes": [{"id": i, **dict(zip(CAMPOS, x))} for i, x in sorted(sem["agentes"].items()) if i in presentes],
                "dias": [{"dia": dia, **x} for dia, x in sorted(sem["dias"].items())]}

    def zerar(self):
        """Troca de conta no OAuth: os números de uma conta não passam para outra (a leitura seguinte grava o vazio)."""
        with self.trava:
            self.semanas, self.resto, self.ultima, self.sujo, self.gravado_em, self.pular = {}, {}, None, True, None, True
