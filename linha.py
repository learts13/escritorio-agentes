# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Linha do tempo dos agentes: as transições de estado de cada agente, com a hora e nada mais (nenhum rótulo, conversa
ou pessoa), num JSONL por dia (fuso de Brasília) em <pasta>/linha/AAAA-MM-DD.jsonl. Guarda 14 dias e até TETO_DIA
linhas por dia. Quem grava é o Leitor do andar (gravar, a cada leitura que deu certo, fora da trava dele); as rotas
GET /api/linha (um agente num dia) e GET /api/fora (o resumo desde a última visita) só leem, sem trava: uma linha
pela metade no fim do arquivo é ignorada. Nada aqui chama o agentes.chat.

Estados: "livre" (sem tarefa), "trabalhando", "aprovacao" e "resposta" (esperando a pessoa). Cada tarefa que começa,
pede algo, volta a trabalhar ou termina é uma linha {agente, de, para, em}; "para": "livre" é uma tarefa concluída.
"""
import datetime
import json
import os
import re
import threading

ESTADOS = frozenset({"livre", "trabalhando", "aprovacao", "resposta"})
ESPERAS = frozenset({"aprovacao", "resposta"})
DIAS = 14
TETO_DIA = 5000
PASTA = "linha"   # dados/linha/ (ou andares/<id>/linha/): a migração para o saguão a leva junto
FORA_MAX = 7 * 86400   # o resumo olha no máximo 7 dias para trás
ID_OK = re.compile(r"[A-Za-z0-9_-]{1,100}")
ARQ_OK = re.compile(r"([0-9]{4}-[0-9]{2}-[0-9]{2})\.jsonl")


def valido(x):
    return isinstance(x, dict) and set(x) == {"agente", "de", "para", "em"} and isinstance(x["agente"], str) \
        and ID_OK.fullmatch(x["agente"]) is not None and x["de"] in ESTADOS and x["para"] in ESTADOS \
        and type(x["em"]) is int and x["em"] >= 0


class Linha:
    def __init__(self, pasta, fuso, log=None, teto=TETO_DIA):
        self.pasta, self.fuso, self.log, self.teto = os.path.join(pasta, PASTA), fuso, log, teto
        self.trava = threading.Lock()   # só entre gravações (o Leitor é um só, mas o teto e a limpeza contam juntos)
        self.contagem = {}   # dia -> linhas já no arquivo
        self.falhou = False   # uma linha de log por episódio de falha de disco

    def dia_de(self, t):
        return datetime.datetime.fromtimestamp(t, self.fuso).date()

    def _arquivo(self, dia):
        return os.path.join(self.pasta, f"{dia.isoformat()}.jsonl")

    def gravar(self, transicoes, agora):
        """transicoes: [(id do agente, de, para)] de uma leitura. Nunca levanta: a linha do tempo não derruba a leitura."""
        em = int(agora)
        linhas = [{"agente": a, "de": de, "para": para, "em": em} for a, de, para in transicoes]
        linhas = [x for x in linhas if valido(x)]
        if not linhas:
            return
        dia = self.dia_de(agora)
        try:
            with self.trava:
                if dia not in self.contagem:
                    self.contagem = {dia: self._contar(dia)}   # dia novo: os outros saem da memória e do disco
                    self._limpar(dia)
                cabe = linhas[:max(0, self.teto - self.contagem[dia])]
                if cabe:
                    with open(self._arquivo(dia), "a", encoding="utf-8") as f:
                        f.write("".join(json.dumps(x, separators=(",", ":")) + "\n" for x in cabe))
                    self.contagem[dia] += len(cabe)
            self.falhou = False
        except OSError as x:
            if not self.falhou and self.log:
                self.log(evento="linha", resultado="erro_disco", detalhe=type(x).__name__)
            self.falhou = True

    def limpar(self, agora):
        """A varredura diária do servidor: tira os dias com mais de 14 dias mesmo sem gravação nova (o andar parado).
        Nunca levanta."""
        try:
            with self.trava:
                self._limpar(self.dia_de(agora))
        except OSError:
            pass

    def dia_ok(self, dia, agora):
        """O dia (date) está entre hoje-13 e hoje: o que a rota aceita."""
        hoje = self.dia_de(agora)
        return hoje - datetime.timedelta(days=DIAS - 1) <= dia <= hoje

    def _contar(self, dia):
        os.makedirs(self.pasta, exist_ok=True)
        try:
            with open(self._arquivo(dia), "rb") as f:
                return sum(1 for _ in f)
        except FileNotFoundError:
            return 0

    def _limpar(self, hoje):
        corte = hoje - datetime.timedelta(days=DIAS - 1)
        for nome in os.listdir(self.pasta):
            m = ARQ_OK.fullmatch(nome)
            if not m:
                continue
            try:
                velho = datetime.date.fromisoformat(m.group(1)) < corte
            except ValueError:
                continue
            if velho:
                os.remove(os.path.join(self.pasta, nome))

    def _ler(self, dia):
        try:
            with open(self._arquivo(dia), encoding="utf-8") as f:
                brutas = f.read().splitlines()
        except (FileNotFoundError, NotADirectoryError):
            return []
        except (OSError, UnicodeDecodeError):
            return []
        saida = []
        for bruta in brutas:
            try:
                x = json.loads(bruta)
            except ValueError:
                continue
            if valido(x):
                saida.append(x)
        return saida

    def do_dia(self, agente, dia):
        """As transições de um agente num dia ("AAAA-MM-DD"), da mais velha para a mais nova."""
        return [{"de": x["de"], "para": x["para"], "em": x["em"]} for x in self._ler(datetime.date.fromisoformat(dia))
                if x["agente"] == agente]

    def fora(self, desde, agora):
        """O que aconteceu de "desde" até agora (no máximo 7 dias): por agente, as tarefas concluídas e as esperas de
        aprovação e de resposta, com a duração e se foram resolvidas. A espera que começou antes de "desde" e se
        resolveu depois entra (olha um dia a mais para trás). Só os agentes com algo a contar."""
        desde, agora = max(int(desde), int(agora) - FORA_MAX), int(agora)
        if desde > agora:
            return {"desde": desde, "ate": agora, "agentes": []}
        olhar, dia, fim = desde - 86400, self.dia_de(max(0, desde - 86400)), self.dia_de(agora)
        registros = []
        while dia <= fim:
            registros += self._ler(dia)
            dia += datetime.timedelta(days=1)
        registros.sort(key=lambda x: x["em"])   # estável: a ordem do arquivo fica no mesmo segundo
        tarefas, esperas, abertas = {}, {}, {}
        for x in registros:
            if x["em"] < olhar or x["em"] > agora:
                continue
            a = x["agente"]
            if x["de"] in ESPERAS and abertas.get((a, x["de"])):   # fecha a mais velha daquele tipo
                espera = abertas[(a, x["de"])].pop(0)
                espera.update(fim=x["em"], duracao_s=x["em"] - espera["inicio"], resolvida=True)
            if x["para"] in ESPERAS:
                espera = {"tipo": x["para"], "inicio": x["em"], "fim": None, "duracao_s": None, "resolvida": False}
                abertas.setdefault((a, x["para"]), []).append(espera)
                esperas.setdefault(a, []).append(espera)
            if x["para"] == "livre" and x["em"] >= desde:
                tarefas[a] = tarefas.get(a, 0) + 1
        for lista in abertas.values():
            for espera in lista:
                espera["duracao_s"] = agora - espera["inicio"]
        conta = {a: [s for s in lista if s["inicio"] >= desde or s["fim"] is None or s["fim"] >= desde]
                 for a, lista in esperas.items()}
        agentes = sorted({a for a, n in tarefas.items() if n} | {a for a, lista in conta.items() if lista})
        return {"desde": desde, "ate": agora,
                "agentes": [{"agente": a, "tarefas": tarefas.get(a, 0), "esperas": conta.get(a, [])} for a in agentes]}
