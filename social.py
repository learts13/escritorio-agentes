# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Vida social dos bots (fatias 1 e 2): o diretor. Camada de diversão sorteada; não reflete nada do trabalho real.

O servidor decide amizades, eventos e brigas com o dado real de quem está livre e manda tudo no /api/estado, igual
para todos; o navegador só encena. Livre é quem está na leitura e sem tarefa: quem trabalha ou espera a pessoa nunca
entra em evento nem em briga. Fica só na memória (sem rede nem disco): reiniciar o serviço volta todo mundo à base.
A exceção é o placar semanal do ringue (fatia 1c): quem lê e grava o dados/placar.json é o escritorio.py (ler_placar e o
guardar que ele passa); aqui só se conta, se vira a semana e se serializa. As brigas e as greves também vão para o
jornal da semana (jornal.py), pelo contar_jornal que o escritorio.py passa. Nada aqui chama o agentes.chat.
"""
import collections
import datetime
import functools
import hashlib
import json
import random
import secrets
import threading
import time

# Números da fatia 1: hipóteses, para ajustar depois de um dia de uso
PASSO = 60                                # segundos entre dois passos do diretor
SOBE_A_CADA, DESCE_A_CADA = 600, 1800     # reconciliação: delta negativo sobe 1 a cada 10 min; positivo desce 1 a cada 30 min
COMEMORA, COMEMORA_COLEGAS = 2, 2         # quem terminou uma tarefa ganha +2 com até 2 colegas de time presentes
TRABALHO_PERTO = 1                        # um par por passo de colegas de time trabalhando ao mesmo tempo
CHANCE_BOM, CHANCE_RUIM = 0.35, 0.15      # evento público por passo, com pelo menos 2 livres
REENCONTRO = 0.5                          # o evento ruim cai num par que já é rival (a rivalidade cresce)
EFEITO = {"cafe": 4, "papo": 2, "esbarrao": -3, "grampeador": -6, "pazes": 10}
PAZES_DE, PAZES_ATE = 3600, 10800         # o par que brigou faz as pazes de 60 a 180 min depois, uma vez por dia
LIMIAR_BRIGA = 20                         # briga automática só abaixo disso; a base nunca fica abaixo (só evento leva ao ringue)
BRIGAS_AUTO_DIA, ENTRE_AUTO = 4, 7200     # até 4 automáticas por dia, com 2 h entre elas (espalha pela tarde)
FOLGA_CENA = 60                           # do fim de uma cena ao começo da outra
AVISO, LUTA, VISIVEL = 15, 30, 10         # a briga começa 15 s depois de marcada, dura 30 s e fica à vista até 10 s depois
MARGEM_FECHA = 120                        # nenhuma cena termina depois do fechamento menos 2 min
PERDE_BRIGA = 5
ORDENS_DIA = 20                           # "mandar pro ringue": teto do dia, para todas as sessões juntas
DELTAS_MAX, HISTORICO = 5000, 50          # memória: pares com delta; eventos e brigas do dia guardados
EVENTO_VISIVEL, EVENTOS_NO_ESTADO = 120, 10
TIPOS_BONS, TIPOS_RUINS = ("cafe", "papo"), ("esbarrao", "grampeador")
# fatia 2: reclamação, sugestão e fofoca (depois dos bons e ruins, na mesma sorte do passo) e a greve
CHANCE_RECLAMA, CHANCE_SUGERE, CHANCE_FOFOCA = 0.006, 0.006, 0.02
FOFOCA_AB, FOFOCA_A, FOFOCA_B = 2, -3, -2  # a e b se aproximam; os dois esfriam com quem é o assunto
# gatilho: 4+ livres com média abaixo de 30 entre si, ou 5 reclamações hoje. O 45 do contrato disparava só com os valores de
# base (25 a 90), na abertura, todo dia; com 30 e as chances acima, o dia simulado (20 sementes) deu greve em 75% dos dias
# com 67 agentes e em 45% com 9, espalhada da manhã ao fim da tarde
GREVE_MEDIA, GREVE_RECLAMACOES = 30, 5
GREVE_MIN, GREVE_MAX, GREVES_DIA = 3, 8, 1   # participantes (só livres) e teto do dia
GREVE_DURA, GREVE_MINIMA = 1800, 300      # acaba sozinha em 30 min; só começa se couber 5 min antes do fechamento menos 2 min
ATENDIDA = 4                              # atender a greve: +4 entre os participantes
PLACAR_MAX, PLACAR_BYTES, PLACAR_TETO = 500, 64 * 1024, 100_000   # entradas, tamanho do placar.json e maior número guardado
ID_PLACAR = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")   # o [A-Za-z0-9_-] do ler_placar


def _iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _erro(status, codigo, mensagem):
    return status, {"erro": codigo, "mensagem": mensagem}


def _par(a, b):
    return (a, b) if a < b else (b, a)


@functools.lru_cache(maxsize=8192)   # pura; a greve olha todos os pares de livres a cada passo
def base(a, b):
    """Valor de partida de um par, de 25 a 90: simétrico e fixo entre reinícios e instalações."""
    a, b = _par(a, b)
    return 25 + int.from_bytes(hashlib.sha256(f"{a}|{b}".encode("utf-8", "surrogatepass")).digest()[:4], "big") % 66


def _segundos(hhmm):
    h, m = hhmm.split(":")
    return int(h) * 3600 + int(m) * 60


def fechamento(agora, expediente, fuso):
    """Instante em que fecha o turno em curso, ou None fora do expediente. A regra do expediente.js, no fuso de
    Brasília: abre < fecha vale abre ≤ h < fecha; abre > fecha é o turno que vira a meia-noite."""
    d = datetime.datetime.fromtimestamp(agora, fuso)
    h = d.hour * 3600 + d.minute * 60 + d.second + d.microsecond / 1e6
    abre, fecha = _segundos(expediente["abre"]), _segundos(expediente["fecha"])
    dia = d.date()
    if abre < fecha:
        if not abre <= h < fecha:
            return None
    elif h >= abre:   # turno da noite, antes da meia-noite: fecha amanhã
        dia += datetime.timedelta(days=1)
    elif h >= fecha:
        return None
    return datetime.datetime.combine(dia, datetime.time(fecha // 3600, fecha % 3600 // 60), fuso).timestamp()


def _times(leitura, cfg):
    """agente -> nome do time pelo handle no times.json; quem não está em time nenhum fica com None (o "Novos" do app.js)."""
    por_handle = {}
    for t in cfg.get("times", []):
        for h in t.get("agentes", []):
            por_handle.setdefault(h, t["nome"])
    return {a["id"]: por_handle.get(a.get("handle")) for a in leitura.get("agentes", [])}


def segunda(dia):
    """A segunda-feira (data) da semana do placar em que cai o dia: a semana vira na segunda às 00:00 de Brasília."""
    return dia - datetime.timedelta(days=dia.weekday())


def _ordem(item):
    """Ranking: mais vitórias, depois menos derrotas, depois o menor id."""
    i, x = item
    return -x["v"], x["d"], i


def campeao(placar):
    """{"id", "v", "d"} de quem lidera o placar, ou None se ninguém lutou."""
    if not placar:
        return None
    i, x = min(placar.items(), key=_ordem)
    return {"id": i, "v": x["v"], "d": x["d"]}


class Social(threading.Thread):
    """O diretor: um passo por minuto com a leitura do Leitor e a config pública. Tudo sob uma trava; o GET só lê."""

    def __init__(self, leitor, config, log, fuso, aleatorio=None, guardar=None, placar=None, contar_jornal=None):
        """guardar(bytes) grava o placar.json (o gravar() atômico do escritorio.py); placar é o que o ler_placar() leu
        ao subir (validado, ou None), alinhado à semana no primeiro passo. contar_jornal(tipo, instante) leva ao jornal
        cada briga que terminou e cada greve que começou."""
        super().__init__(daemon=True)
        self.leitor, self.config, self.log, self.fuso = leitor, config, log, fuso
        self.rng = aleatorio or random.Random()
        self.trava = threading.Lock()
        self.erros = set()   # tipos de erro que já foram para o log
        self.guardar, self.carregado, self.falhou_gravar = guardar, placar, False
        self.contar_jornal = contar_jornal
        self._zerar()

    def _zerar(self):
        self.deltas = {}   # (a, b) com a < b -> int; o valor do par é base + delta, sempre de 0 a 100
        self.cena = None   # uma por vez. briga: id, tipo, a, b, vencedor, inicio, fim (instantes), origem e assentada;
        # greve: id, tipo, participantes, motivo, inicio, ate e origem
        self.eventos = collections.deque(maxlen=HISTORICO)   # do mais velho para o mais novo
        self.brigas_hoje = collections.deque(maxlen=HISTORICO)   # a, b, vencedor, em (o fim) e pazes (quando)
        self.pares_hoje, self.pazes_hoje = set(), set()
        self.autos_hoje = self.ordens_hoje = self.greves_hoje = 0
        self.reclamaram_hoje = []   # quem reclamou hoje, na ordem, um registro por reclamação
        self.ultima_auto = self.fim_ultima = None   # início da última automática; fim da última cena
        self.ocupados_antes = set()
        self.dia = None   # data de hoje em Brasília
        self.sobe_em = self.desce_em = None   # próximos tiques da reconciliação
        self.placar, self.anterior = {}, None   # da semana: id -> {"v", "d", "seq"}; o campeão da semana passada
        self.semana = None   # a segunda-feira da semana do placar (alinhada no primeiro passo)
        self.sujo = False   # o placar mudou e o passo seguinte grava

    # ------------------------------------------------------------ valores

    def valor(self, a, b):
        par = _par(a, b)
        return max(0, min(100, base(*par) + self.deltas.get(par, 0)))

    def _mudar(self, a, b, pontos):
        """Soma pontos ao par; o delta fica preso entre o que leva o valor a 0 e a 100, e o delta 0 sai do dicionário."""
        par = _par(a, b)
        b0 = base(*par)
        d = max(-b0, min(100 - b0, self.deltas.get(par, 0) + pontos))
        if d:
            self.deltas[par] = d
        else:
            self.deltas.pop(par, None)

    def _reconciliar(self, agora):
        """Item 1: com o tempo, a rivalidade some (+1 a cada 10 min) e a amizade esfria (−1 a cada 30 min)."""
        if self.sobe_em is None:
            self.sobe_em, self.desce_em = agora + SOBE_A_CADA, agora + DESCE_A_CADA
        sobe = desce = 0
        if agora >= self.sobe_em:
            sobe = int((agora - self.sobe_em) // SOBE_A_CADA) + 1
            self.sobe_em += sobe * SOBE_A_CADA
        if agora >= self.desce_em:
            desce = int((agora - self.desce_em) // DESCE_A_CADA) + 1
            self.desce_em += desce * DESCE_A_CADA
        if sobe or desce:
            novo = {}
            for par, d in self.deltas.items():
                d = min(0, d + sobe) if d < 0 else max(0, d - desce)
                if d:
                    novo[par] = d
            self.deltas = novo

    def _podar(self):
        """Acima do teto, saem os pares de delta mais perto de zero."""
        sobra = len(self.deltas) - DELTAS_MAX
        if sobra > 0:
            for par in sorted(self.deltas, key=lambda p: abs(self.deltas[p]))[:sobra]:
                del self.deltas[par]

    # ------------------------------------------------------------ dia, cena e eventos

    def _virar_dia(self, agora):
        dia = datetime.datetime.fromtimestamp(agora, self.fuso).date()
        if dia != self.dia:
            self.dia = dia
            self.autos_hoje = self.ordens_hoje = self.greves_hoje = 0
            self.reclamaram_hoje = []
            self.pares_hoje, self.pazes_hoje = set(), set()
            self.brigas_hoje.clear()

    def _virar_semana(self, agora):
        """Ao subir, alinha o placar lido do arquivo; depois, na segunda às 00:00, o campeão vai para o anterior."""
        hoje = segunda(datetime.datetime.fromtimestamp(agora, self.fuso).date())
        if self.semana is None:
            lido, self.carregado = self.carregado, None
            if lido:
                semana = datetime.date.fromisoformat(lido["semana"])
                if semana == hoje:
                    self.placar, self.anterior = {i: dict(x) for i, x in lido["placar"].items()}, lido["anterior"]
                else:   # a semana passada vira o anterior; mais velha ou no futuro sobe vazia
                    self.anterior = campeao(lido["placar"]) if semana == hoje - datetime.timedelta(days=7) else None
                    self.sujo = True
            self.semana = hoje
        elif hoje != self.semana:
            self.anterior, self.placar, self.semana, self.sujo = campeao(self.placar), {}, hoje, True

    def _contar(self, c):
        """Uma vez por briga, no fim (auto e ordem; a cancelada não chega aqui). Só ids que o ler_placar aceita."""
        for agente, venceu in ((c["a"], c["vencedor"] == c["a"]), (c["b"], c["vencedor"] == c["b"])):
            if not 0 < len(agente) <= 100 or not set(agente) <= ID_PLACAR:
                continue
            x = self.placar.setdefault(agente, {"v": 0, "d": 0, "seq": 0})
            if venceu:
                x["v"], x["seq"] = min(x["v"] + 1, PLACAR_TETO), min(max(x["seq"], 0) + 1, PLACAR_TETO)
            else:
                x["d"], x["seq"] = min(x["d"] + 1, PLACAR_TETO), max(min(x["seq"], 0) - 1, -PLACAR_TETO)
        sobra = len(self.placar) - PLACAR_MAX   # acima do teto, saem os de menos lutas (empate pelo id)
        if sobra > 0:
            for i in sorted(self.placar, key=lambda i: (self.placar[i]["v"] + self.placar[i]["d"], i))[:sobra]:
                del self.placar[i]
        self.sujo = True

    def _serializar(self):
        """O placar.json (sob a trava). Com ids enormes, saem os de menos lutas até caber nos 64 KB que o ler_placar aceita."""
        while True:
            dados = json.dumps({"v": 1, "semana": self.semana.isoformat(), "placar": self.placar, "anterior": self.anterior},
                               separators=(",", ":")).encode()
            if len(dados) <= PLACAR_BYTES or not self.placar:
                return dados
            del self.placar[min(self.placar, key=lambda i: (self.placar[i]["v"] + self.placar[i]["d"], i))]

    def _assentar(self, agora):
        """Item 7: no fim da briga, o par perde mais 5 e entra no pares_hoje; a cena fica à vista até o fim + 10 s."""
        c = self.cena
        if c is not None and c["tipo"] == "greve":   # a greve acaba sozinha no "ate"
            if agora >= c["ate"]:
                self.cena, self.fim_ultima = None, c["ate"]
            return
        if c is None or agora < c["fim"]:
            return
        if not c["assentada"]:
            c["assentada"] = True
            self._mudar(c["a"], c["b"], -PERDE_BRIGA)
            self.pares_hoje.add(_par(c["a"], c["b"]))
            self.brigas_hoje.append({"a": c["a"], "b": c["b"], "vencedor": c["vencedor"], "em": c["fim"],
                                     "pazes": c["fim"] + self.rng.randint(PAZES_DE, PAZES_ATE)})
            self.fim_ultima = c["fim"]
            self._contar(c)
            if self.contar_jornal:
                self.contar_jornal("briga", c["fim"])
        if agora >= c["fim"] + VISIVEL:
            self.cena = None

    def _marcar(self, a, b, inicio, origem):
        self.cena = {"id": secrets.token_urlsafe(6), "tipo": "briga", "a": a, "b": b, "vencedor": self.rng.choice((a, b)),
                     "inicio": inicio, "fim": inicio + LUTA, "origem": origem, "assentada": False}
        return self.cena

    def _evento(self, agora, tipo, a=None, b=None, **extra):
        """Evento público: a e b (o b só nos de par), mais o que o tipo pede (sobre, greve, participantes)."""
        if tipo in EFEITO:
            self._mudar(a, b, EFEITO[tipo])
        ev = {"id": secrets.token_urlsafe(6), "tipo": tipo, "a": a, "b": b, **extra, "em": agora}
        self.eventos.append({k: v for k, v in ev.items() if v is not None})

    @staticmethod
    def _envolvidos(ev):
        return {x for x in (ev.get("a"), ev.get("b"), ev.get("sobre"), *ev.get("participantes", ())) if x is not None}

    @staticmethod
    def _sem_quem_sumiu(ev, presentes):
        """O evento sem quem sumiu: no "atendida", sai só o id do participantes, e o evento fica enquanto sobrar alguém (as
        telas que ainda não o viram encenam a entrega); nos outros, sem o a, o b ou o assunto, o evento sai (None)."""
        if "participantes" in ev:
            ev = {**ev, "participantes": [p for p in ev["participantes"] if p in presentes]}
            if not ev["participantes"]:
                return None
        return ev if {x for x in (ev.get("a"), ev.get("b"), ev.get("sobre")) if x is not None} <= presentes else None

    @staticmethod
    def _publica(c):
        if c["tipo"] == "greve":
            return {"id": c["id"], "tipo": "greve", "participantes": list(c["participantes"]), "motivo": c["motivo"],
                    "inicio": _iso(c["inicio"]), "ate": _iso(c["ate"]), "origem": c["origem"]}
        return {"id": c["id"], "tipo": c["tipo"], "a": c["a"], "b": c["b"], "vencedor": c["vencedor"],
                "inicio": _iso(c["inicio"]), "fim": _iso(c["fim"]), "origem": c["origem"]}

    def _visivel(self, agora):
        c = self.cena
        if not c:
            return None
        return self._publica(c) if agora < (c["ate"] if c["tipo"] == "greve" else c["fim"] + VISIVEL) else None

    # ------------------------------------------------------------ o passo

    def passo(self, agora, leitura, cfg):
        """Um passo. Com a leitura com erro, fora do expediente ou no modo sério, só reconcilia, vira o dia (e a semana) e
        deixa a cena em curso terminar; nada novo nasce. O placar sujo é serializado sob a trava e gravado fora dela: só
        esta thread grava, nunca um GET ou um POST."""
        with self.trava:
            self._passo(agora, leitura, cfg)
            dados = self._serializar() if self.sujo and self.guardar and self.semana else None
            if dados is not None:
                self.sujo = False
        if dados is None:
            return
        try:
            self.guardar(dados)
            self.falhou_gravar = False
        except Exception as x:   # tenta de novo no passo seguinte; 1 linha de log por episódio
            with self.trava:
                self.sujo = True
            if not self.falhou_gravar:
                self.falhou_gravar = True
                self.log(evento="social", resultado="placar_nao_gravou", detalhe=type(x).__name__)

    def _passo(self, agora, leitura, cfg):
        self._virar_dia(agora)
        self._virar_semana(agora)
        self._reconciliar(agora)
        self._assentar(agora)
        serio = cfg.get("serio") is True
        if serio:
            self.cena = None
        if leitura.get("erro"):   # leitura velha (agentes.chat fora do ar, pausa de 429): não decide quem está livre
            return
        presentes = {a["id"] for a in leitura.get("agentes", [])}
        ocupados = {t["agente_id"] for t in leitura.get("trabalhos", [])} & presentes
        livres = presentes - ocupados
        # item 8: lutador que sumiu ou pegou tarefa antes do início cancela a cena, sem efeito. Com o passo de 60 s e o
        # aviso de 15 s, na prática só pega a "ordem" marcada entre dois passos; o resto fica com o navegador (o
        # trabalho real tira o lutador da cena)
        c = self.cena
        if c and c["tipo"] == "briga" and agora < c["inicio"] and not {c["a"], c["b"]} <= livres:
            self.cena = None
        if c and c["tipo"] == "greve":   # quem pegou tarefa ou sumiu sai da greve (o trabalho real manda); com menos de 2, acaba
            c["participantes"] = [p for p in c["participantes"] if p in livres]
            if len(c["participantes"]) < 2:
                self.cena, self.fim_ultima = None, agora
        if any(not self._envolvidos(ev) <= presentes for ev in self.eventos):   # S6: quem some sai dos eventos
            self.eventos = collections.deque((ev for ev in map(lambda ev: self._sem_quem_sumiu(ev, presentes), self.eventos) if ev),
                                             maxlen=HISTORICO)
        terminaram, self.ocupados_antes = (self.ocupados_antes & livres), ocupados
        fecha = fechamento(agora, cfg["expediente"], self.fuso)
        if serio or fecha is None:
            return
        times = _times(leitura, cfg)
        self._comemorar(terminaram, presentes, times)
        self._trabalho_perto(ocupados, times)
        self._evento_publico(agora, livres, presentes)
        self._pazes(agora, livres)
        self._briga_automatica(agora, livres, fecha)
        self._greve(agora, livres, fecha)
        self._podar()

    def _comemorar(self, terminaram, presentes, times):
        """Item 2, silencioso (a página já aplaude quem terminou)."""
        for ag in sorted(terminaram):
            colegas = sorted(p for p in presentes if p != ag and times.get(p) == times.get(ag))
            for c in self.rng.sample(colegas, min(COMEMORA_COLEGAS, len(colegas))):
                self._mudar(ag, c, COMEMORA)

    def _trabalho_perto(self, ocupados, times):
        """Item 3, silencioso: um par de colegas de time trabalhando ao mesmo tempo."""
        por_time = collections.defaultdict(list)
        for ag in sorted(ocupados):
            por_time[times.get(ag)].append(ag)
        grupos = [g for _, g in sorted(por_time.items(), key=lambda x: x[0] or "") if len(g) >= 2]
        if grupos:
            self._mudar(*self.rng.sample(self.rng.choice(grupos), 2), TRABALHO_PERTO)

    def _evento_publico(self, agora, livres, presentes):
        """Item 4: café ou papo; esbarrão ou grampeador, no reencontro de rivais ou no pior de 3 pares sorteados. O par
        que já brigou hoje fica fora dos eventos ruins: depois da briga, só a reconciliação e as pazes. Na mesma sorte vem
        a fatia 2 (_evento_fatia2)."""
        if len(livres) < 2:
            return
        lista, sorte = sorted(livres), self.rng.random()
        if sorte < CHANCE_BOM:
            return self._evento(agora, self.rng.choice(TIPOS_BONS), *self.rng.sample(lista, 2))
        if sorte >= CHANCE_BOM + CHANCE_RUIM:
            return self._evento_fatia2(agora, sorte - CHANCE_BOM - CHANCE_RUIM, lista, presentes)
        tipo = self.rng.choice(TIPOS_RUINS)
        rivais = sorted(p for p, d in self.deltas.items() if d < 0 and p[0] in livres and p[1] in livres and p not in self.pares_hoje)
        if rivais and self.rng.random() < REENCONTRO:
            par = self.rng.choice(rivais)
        else:
            pares = [p for p in (_par(*self.rng.sample(lista, 2)) for _ in range(3)) if p not in self.pares_hoje]
            if not pares:
                return
            par = min(pares, key=lambda p: (self.valor(*p), p))
        self._evento(agora, tipo, *par)

    def _evento_fatia2(self, agora, sorte, lista, presentes):
        """Reclamação e sugestão: balão de um livre, sem efeito (a reclamação conta para a greve). Fofoca: dois livres
        sobre um terceiro presente (a e b +2; a e o assunto −3; b e o assunto −2)."""
        if sorte < CHANCE_RECLAMA:
            a = self.rng.choice(lista)
            self.reclamaram_hoje.append(a)
            return self._evento(agora, "reclamacao", a)
        sorte -= CHANCE_RECLAMA
        if sorte < CHANCE_SUGERE:
            return self._evento(agora, "sugestao", self.rng.choice(lista))
        sorte -= CHANCE_SUGERE
        if sorte < CHANCE_FOFOCA:
            a, b = self.rng.sample(lista, 2)
            outros = sorted(presentes - {a, b})
            if outros:
                sobre = self.rng.choice(outros)
                self._mudar(a, b, FOFOCA_AB)
                self._mudar(a, sobre, FOFOCA_A)
                self._mudar(b, sobre, FOFOCA_B)
                self._evento(agora, "fofoca", a, b, sobre=sobre)

    def _pazes(self, agora, livres):
        """Item 5: o par que brigou hoje, com os dois livres, no horário sorteado ao fim da briga (até 180 min depois)."""
        for br in self.brigas_hoje:
            par = _par(br["a"], br["b"])
            if par not in self.pazes_hoje and br["pazes"] <= agora <= br["em"] + PAZES_ATE and set(par) <= livres:
                self.pazes_hoje.add(par)
                self._evento(agora, "pazes", *par)

    def _briga_automatica(self, agora, livres, fecha):
        """Item 6: o par livre de menor valor abaixo do limiar, que ainda não brigou hoje."""
        if self.cena or self.autos_hoje >= BRIGAS_AUTO_DIA:
            return
        if (self.fim_ultima is not None and agora - self.fim_ultima < FOLGA_CENA) or \
                (self.ultima_auto is not None and agora - self.ultima_auto < ENTRE_AUTO):
            return
        inicio = agora + AVISO
        if inicio + LUTA > fecha - MARGEM_FECHA:
            return
        candidatos = [(self.valor(*p), p) for p, d in self.deltas.items()
                      if d < 0 and p[0] in livres and p[1] in livres and p not in self.pares_hoje]
        candidatos = [x for x in candidatos if x[0] < LIMIAR_BRIGA]
        if candidatos:
            self._marcar(*min(candidatos)[1], inicio, "auto")
            self.autos_hoje += 1
            self.ultima_auto = inicio

    def _insatisfeitos(self, livres):
        """Até 8 livres de média baixa entre si (abaixo do GREVE_MEDIA), com pelo menos 4; ou None. Guloso: os livres em ordem da
        média com os outros livres, do menor para o maior, e o maior grupo do começo da fila que passa."""
        if len(livres) < 4:
            return None
        lista = sorted(livres)
        media = {x: sum(self.valor(x, o) for o in lista if o != x) / (len(lista) - 1) for x in lista}
        fila = sorted(lista, key=lambda x: (media[x], x))
        for k in range(min(GREVE_MAX, len(fila)), 3, -1):
            pares = [(p, q) for i, p in enumerate(fila[:k]) for q in fila[i + 1:k]]
            if sum(self.valor(p, q) for p, q in pares) / len(pares) < GREVE_MEDIA:
                return fila[:k]
        return None

    def _greve(self, agora, livres, fecha):
        """Fatia 2: no máximo 1 por dia, sem outra cena e dentro do expediente; só livres participam. Gatilho: um grupo de
        insatisfeitos, ou 5 reclamações hoje (quem reclamou e está livre entra primeiro)."""
        if self.cena or self.greves_hoje >= GREVES_DIA or len(livres) < GREVE_MIN:
            return
        if self.fim_ultima is not None and agora - self.fim_ultima < FOLGA_CENA:
            return
        ate = min(agora + GREVE_DURA, fecha - MARGEM_FECHA)
        if ate - agora < GREVE_MINIMA:
            return
        grupo = self._insatisfeitos(livres)
        if grupo is None and len(self.reclamaram_hoje) >= GREVE_RECLAMACOES:
            primeiro = list(dict.fromkeys(a for a in self.reclamaram_hoje if a in livres))
            resto = sorted(livres - set(primeiro), key=lambda x: (sum(self.valor(x, o) for o in livres if o != x), x))
            grupo = (primeiro + resto)[:GREVE_MAX]
        if grupo:
            self.cena = {"id": secrets.token_urlsafe(6), "tipo": "greve", "participantes": grupo,
                         "motivo": self.rng.randrange(1000), "inicio": agora, "ate": ate, "origem": "auto"}
            self.greves_hoje += 1
            if self.contar_jornal:
                self.contar_jornal("greve", agora)

    # ------------------------------------------------------------ o que as rotas usam

    def foto(self, agora, serio, presentes=None):
        """O bloco "social" do /api/estado: a cena até o fim + 10 s, os eventos dos últimos 120 s (até 10, do mais novo
        para o mais velho) e o placar (top 3 dos presentes e o campeão da semana passada). No modo sério, sem cena nem
        eventos e com placar null."""
        with self.trava:
            cena = None if serio else self._visivel(agora)
            eventos = [] if serio else [{**ev, "em": _iso(ev["em"])} for ev in reversed(self.eventos)
                                        if 0 <= agora - ev["em"] <= EVENTO_VISIVEL]
            placar = None if serio else self._placar(agora, presentes, 3)
        return {"v": 1, "agora": _iso(agora), "serio": serio, "cena": cena, "eventos": eventos[:EVENTOS_NO_ESTADO],
                "placar": placar and {"semana": placar["semana"], "top": placar["ranking"], "anterior": placar["anterior"]}}

    def _placar(self, agora, presentes, maximo=None):
        """Só lê: antes do primeiro passo, a semana sai do relógio (sem alinhar nada)."""
        semana = self.semana or segunda(datetime.datetime.fromtimestamp(agora, self.fuso).date())
        ranking = [{"id": i, **x} for i, x in sorted(self.placar.items(), key=_ordem)
                   if presentes is None or i in presentes][:maximo]
        return {"semana": semana.isoformat(), "ranking": ranking, "anterior": dict(self.anterior) if self.anterior else None}

    def ranking(self, agora, presentes):
        """GET /api/social/placar: o ranking da semana, só de presentes com pelo menos 1 luta, e o campeão anterior."""
        with self.trava:
            return self._placar(agora, presentes)

    def amizades(self, agente, presentes):
        """Dados da ficha: só ids e números, só de quem está presente (o navegador já tem os nomes)."""
        with self.trava:
            valores = [(self.valor(agente, o), o) for o in sorted(set(presentes) - {agente})]
            briga = next(({"contra": outro, "venceu": br["vencedor"] == agente, "em": _iso(br["em"])}
                          for br in reversed(self.brigas_hoje) if agente in (br["a"], br["b"])
                          for outro in [br["b"] if br["a"] == agente else br["a"]] if outro in presentes), None)
        amigos = sorted((x for x in valores if x[0] >= 60), key=lambda x: (-x[0], x[1]))[:3]
        rivais = sorted(x for x in valores if x[0] <= 40)[:3]
        return {"agente": agente, "media": round(sum(v for v, _ in valores) / len(valores)) if valores else None,
                "amigos": [{"id": o, "valor": v} for v, o in amigos], "rivais": [{"id": o, "valor": v} for v, o in rivais],
                "ultima_briga": briga}

    def ordenar(self, a, b, agora, leitura, cfg):
        """"Mandar pro ringue": devolve (status HTTP, corpo). A rota já conferiu origem, sessão e o formato do pedido."""
        with self.trava:
            self._virar_dia(agora)
            self._virar_semana(agora)
            self._assentar(agora)
            if cfg.get("serio") is True:
                return _erro(409, "modo_serio", "O modo sério está ligado: o ringue está fechado.")
            if a == b:
                return _erro(409, "mesmo_agente", "Escolha dois agentes diferentes.")
            presentes = {x["id"] for x in leitura.get("agentes", [])}
            if a not in presentes or b not in presentes:
                return _erro(404, "agente", "Esse agente não está no escritório.")
            inicio = agora + AVISO
            fecha = fechamento(agora, cfg["expediente"], self.fuso)
            if fecha is None or inicio + LUTA > fecha - MARGEM_FECHA:
                return _erro(409, "fora_do_expediente", "Fora do expediente: o ringue está fechado.")
            if {a, b} & {t["agente_id"] for t in leitura.get("trabalhos", [])}:
                return _erro(409, "trabalhando", "Um dos dois está trabalhando agora.")
            if self.cena or (self.fim_ultima is not None and agora - self.fim_ultima < FOLGA_CENA):
                st, corpo = _erro(409, "ocupado", "Acabou de ter briga; espere um minuto." if not self.cena else
                                  "Tem uma greve no escritório; atenda o pedido primeiro." if self.cena["tipo"] == "greve" else
                                  "Já tem briga no ringue; espere um minuto.")
                return st, {**corpo, "cena": self._visivel(agora)}
            if self.ordens_hoje >= ORDENS_DIA:
                return _erro(429, "teto_dia", "O ringue já teve brigas demais hoje; volta amanhã.")
            self.ordens_hoje += 1
            return 200, {"cena": self._publica(self._marcar(a, b, inicio, "ordem"))}

    def atender(self, ident, agora, cfg):
        """"Atender o pedido" da greve: devolve (status HTTP, corpo). A rota já conferiu origem, sessão e o formato."""
        with self.trava:
            self._virar_dia(agora)
            self._virar_semana(agora)
            self._assentar(agora)
            if cfg.get("serio") is True:
                return _erro(409, "modo_serio", "O modo sério está ligado: a vida social está pausada.")
            c = self.cena
            if not c or c["tipo"] != "greve" or c["id"] != ident:
                return _erro(404, "greve", "Essa greve já acabou.")
            ps = c["participantes"]
            for i, a in enumerate(ps):
                for b in ps[i + 1:]:
                    self._mudar(a, b, ATENDIDA)
            self._evento(agora, "atendida", greve=c["id"], motivo=c["motivo"], participantes=list(ps))   # cada tela encena a entrega
            self.cena, self.fim_ultima = None, agora
            return 200, {"cena": None}

    def cancelar(self, agora):
        """Modo sério ligado: tira a cena (briga ou greve). A briga que já terminou conta; a que não terminou sai sem efeito."""
        with self.trava:
            self._assentar(agora)
            self.cena = None

    def zerar(self):
        """Troca de conta no OAuth: a relação de uma conta não passa para outra, nem o placar (o passo seguinte grava o vazio)."""
        with self.trava:
            self._zerar()
            self.carregado, self.sujo = None, True

    parado = False   # parar(): andar removido

    def parar(self):
        self.parado = True

    def run(self):
        while not self.parado:
            try:
                self.passo(time.time(), self.leitor.foto(), self.config())
            except Exception as x:   # um passo com erro não para o diretor: 1 linha de log por tipo de erro
                if type(x).__name__ not in self.erros:
                    self.erros.add(type(x).__name__)
                    self.log(evento="social", resultado="erro", detalhe=type(x).__name__)
            time.sleep(PASSO)
