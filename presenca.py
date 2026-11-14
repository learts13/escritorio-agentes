# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Presença e chat por sala das pessoas da equipe, estilo Gather. Só na memória: sem disco, sem log e sem rede.

O escritorio.py confere sessão, papel e andar antes e passa os dados de quem pediu (nome e boneco saem da conta, nunca
do cliente); aqui ficam os limites, o tempo de vida e as fronteiras de sala e de andar.

- Por andar, quem está com o escritório aberto: nome, boneco, posição, destino do último clique, sala e para onde olha.
  Some PRESENCA_TTL segundos depois do último pedido. No máximo PESSOAS_MAX por andar. Uma conta é um boneco só: as abas
  e os aparelhos da mesma pessoa dividem a posição (vale o último pedido).
- Chat da sala: a mensagem vai para a sala em que o autor está aqui no servidor (o cliente não escolhe a sala), com até
  TEXTO_MAX caracteres, 1 por segundo com rajada de 5. Anel de ANEL mensagens por sala, cada uma vive MENSAGEM_VIDA
  segundos. Ninguém recebe o que foi dito antes de entrar na sala. Reiniciar o serviço apaga tudo.
- seq: um contador por andar, que cresce a cada mudança; o cliente pede o que veio depois do último seq que viu.
- A sala não é fronteira de segurança entre pessoas da equipe (qualquer uma pode andar até lá); o andar é.
"""
import collections
import math
import threading
import time
import unicodedata

PRESENCA_TTL = 30
PESSOAS_MAX = 64
TEXTO_MAX = 500
ANEL = 50
MENSAGEM_VIDA = 600
COORD_MAX = 8192   # px do mundo; o prédio cabe com folga
DIRECOES = ("baixo", "cima", "esq", "dir")
# (por segundo, rajada) de cada tipo de pedido, por pessoa
LIMITES = {"presenca": (2, 4), "ao_vivo": (4, 8), "chat": (1, 5)}


class Limite(Exception):
    """Pedidos demais (o balde da pessoa esvaziou) ou o andar está cheio."""


def _coord(v):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or not 0 <= v <= COORD_MAX:
        raise ValueError("posição fora do mapa")
    return round(v)


def limpar_texto(texto):
    """O texto do chat: sem caracteres de controle nem invisíveis (só a quebra de linha), de 1 a TEXTO_MAX caracteres."""
    if not isinstance(texto, str):
        raise ValueError("Escreva a mensagem.")
    limpo = "".join(c for c in texto.replace("\r\n", "\n")
                    if c == "\n" or unicodedata.category(c) not in ("Cc", "Cf", "Cs", "Co", "Cn")).strip()
    if not limpo:
        raise ValueError("Escreva a mensagem.")
    if len(limpo) > TEXTO_MAX:
        raise ValueError(f"A mensagem passa de {TEXTO_MAX} caracteres.")
    return limpo


class Presenca:
    def __init__(self, relogio=time.monotonic, parede=time.time):
        self.relogio, self.parede = relogio, parede
        self.trava = threading.Lock()
        self.andares = {}   # id do andar -> {"seq", "pessoas": {usuario: {...}}, "salas": {sala: deque[(instante, msg)]}}
        self.baldes = {}    # (usuario, tipo) -> [fichas, instante]

    def _gastar(self, usuario, tipo, agora):
        """Balde de fichas por pessoa e tipo de pedido (chamar com a trava)."""
        taxa, rajada = LIMITES[tipo]
        fichas, antes = self.baldes.get((usuario, tipo), (rajada, agora))
        fichas = min(rajada, fichas + (agora - antes) * taxa)
        if fichas < 1:
            raise Limite("Devagar: pedidos demais em pouco tempo.")
        self.baldes[(usuario, tipo)] = [fichas - 1, agora]

    def _andar(self, andar, agora):
        """O andar, já sem quem saiu (TTL) e sem as mensagens velhas (chamar com a trava)."""
        a = self.andares.setdefault(andar, {"seq": 0, "pessoas": {}, "salas": {}})
        for u in [u for u, p in a["pessoas"].items() if agora - p["visto"] >= PRESENCA_TTL]:
            del a["pessoas"][u]
            a["seq"] += 1
        for sala, anel in list(a["salas"].items()):
            while anel and agora - anel[0][0] >= MENSAGEM_VIDA:
                anel.popleft()
            if not anel:
                del a["salas"][sala]
        if len(self.baldes) > 4 * PESSOAS_MAX * len(LIMITES):   # baldes cheios de novo são iguais a não ter balde
            self.baldes = {k: v for k, v in self.baldes.items() if agora - v[1] < 60}
        return a

    def marcar(self, andar, usuario, nome, aparencia, x, y, destino, sala, olha):
        """A posição de quem pediu (o destino é o do clique: os outros animam o caminho). A sala já vem conferida."""
        x, y = _coord(x), _coord(y)
        if destino is not None:
            if not isinstance(destino, list) or len(destino) != 2:
                raise ValueError("destino inválido")
            destino = [_coord(destino[0]), _coord(destino[1])]
        if olha not in DIRECOES:
            raise ValueError("direção inválida")
        agora = self.relogio()
        with self.trava:
            self._gastar(usuario, "presenca", agora)
            a = self._andar(andar, agora)
            p = a["pessoas"].get(usuario)
            if p is None and len(a["pessoas"]) >= PESSOAS_MAX:
                raise Limite("O andar está cheio agora.")
            a["seq"] += 1
            entrou = a["seq"] if p is None or p["sala"] != sala else p["entrou_seq"]
            a["pessoas"][usuario] = {"nome": nome, "aparencia": aparencia, "x": x, "y": y, "destino": destino, "sala": sala,
                                     "olha": olha, "visto": agora, "entrou_seq": entrou}
            return a["seq"]

    def ao_vivo(self, andar, usuario, desde, renovar=True):
        """Quem mais está no andar e as mensagens novas da sala de quem pediu. renovar=False (a TV): só lê."""
        if isinstance(desde, bool) or not isinstance(desde, int) or desde < 0:
            desde = 0
        agora = self.relogio()
        with self.trava:
            self._gastar(usuario, "ao_vivo", agora)
            a = self._andar(andar, agora)
            eu = a["pessoas"].get(usuario)
            if eu is not None and renovar:
                eu["visto"] = agora
            pessoas = [{"usuario": u, "nome": p["nome"], "aparencia": p["aparencia"], "x": p["x"], "y": p["y"],
                        "destino": p["destino"], "sala": p["sala"], "olha": p["olha"]}
                       for u, p in sorted(a["pessoas"].items()) if u != usuario]
            mensagens = []
            if eu is not None and eu["sala"]:
                inicio = max(desde, eu["entrou_seq"] - 1)
                mensagens = [dict(m) for _, m in a["salas"].get(eu["sala"], ()) if m["seq"] > inicio]
            return {"seq": a["seq"], "pessoas": pessoas, "mensagens": mensagens}

    def enviar(self, andar, usuario, texto):
        """Uma mensagem para a sala onde o autor está agora. Devolve o seq dela."""
        limpo = limpar_texto(texto)
        agora = self.relogio()
        with self.trava:
            self._gastar(usuario, "chat", agora)
            a = self._andar(andar, agora)
            p = a["pessoas"].get(usuario)
            if p is None or not p["sala"]:
                raise ValueError("Entre numa sala para conversar.")
            a["seq"] += 1
            msg = {"seq": a["seq"], "usuario": usuario, "nome": p["nome"], "texto": limpo,
                   "em": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.parede()))}
            a["salas"].setdefault(p["sala"], collections.deque(maxlen=ANEL)).append((agora, msg))
            return a["seq"]

    def sair(self, usuario):
        """A conta saiu ou foi removida: some de todos os andares na hora (sem esperar o TTL)."""
        with self.trava:
            for a in self.andares.values():
                if a["pessoas"].pop(usuario, None) is not None:
                    a["seq"] += 1
