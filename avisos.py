# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Aviso no celular: push nativo do navegador SEM conteúdo (nada de payload nem da cifra do RFC 8291), só com a
assinatura VAPID (ES256, do vapid.py, que o escritorio.py passa pronta em cabecalho). O serviço de push só acorda o
sw.js, que busca o GET /api/avisos com o cookie e mostra o aviso; quem não tem sessão vê um texto genérico.

As assinaturas ficam em dados/push.json (até 10, só o endpoint e desde quando), gravadas de forma atômica sob a trava;
quem lê e grava o arquivo é o escritorio.py (ler_push e o guardar que ele passa). O endpoint precisa ser https, num host
de uma lista fechada, e nunca vai ao log; o envio não segue redirecionamento, e 404 ou 410 apagam a assinatura.
Dispara nas transições pediu_aprovacao e pediu_resposta do Diario, numa thread própria: um aviso por run_id e estado,
no máximo 1 por minuto e 50 por dia em cada aparelho. Nada aqui chama o agentes.chat.
"""
import datetime
import queue
import re
import threading
import json
import urllib.error
import urllib.parse
import urllib.request

ASSINATURAS_MAX, PUSH_BYTES, CORPO_MAX, ENDPOINT_MAX = 10, 16 * 1024, 2048, 1024
# os serviços de push dos navegadores (Chrome e Edge pelo FCM, Firefox, Safari e o WNS do Windows)
HOSTS = frozenset({"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"})
WINDOWS = ".notify.windows.com"
# host só com letras minúsculas, dígitos, hífen e ponto (sem porta, usuário nem IP com colchetes); caminho sem espaço,
# aspas nem "#" (sem fragmento)
ENDPOINT_OK = re.compile(r"https://([a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)(/[!$-~]*)?")
CHAVE_OK = re.compile(r"[A-Za-z0-9_-]{1,200}={0,2}")   # p256dh e auth, em base64url
TIPOS = ("pediu_aprovacao", "pediu_resposta")
TTL, URGENCIA, TIMEOUT = 300, "high", 10   # o aviso vale 5 min no serviço de push; depois disso, perdeu a graça
ENTRE_ENVIOS, POR_DIA = 60, 50   # por aparelho
VISTOS_MAX, FILA_MAX, DESDE_TETO = 1000, 50, 10 ** 11
DESLIGADO = {"precisa_https": "O aviso no celular precisa do escritório em https (ESCRITORIO_BASE)."}
CABECALHO_VALE = 11 * 3600   # o mesmo Authorization por aud, até 1 h antes do exp do JWT (12 h, no vapid.py)


class EndpointInvalido(ValueError):
    pass


def endpoint_ok(url):
    """O endpoint vale: https, host da lista fechada (ou um *.notify.windows.com), sem porta, usuário nem fragmento."""
    if not isinstance(url, str) or len(url) > ENDPOINT_MAX:
        return False
    m = ENDPOINT_OK.fullmatch(url)
    if not m:
        return False
    host = m.group(1)
    return host in HOSTS or (host.endswith(WINDOWS) and len(host) > len(WINDOWS))


def validar_assinatura(d):
    """O corpo do POST /api/push/assinar (o PushSubscription.toJSON()), tudo ou nada: devolve o endpoint. Levanta
    EndpointInvalido para o endpoint fora da regra e ValueError para o resto. As chaves p256dh e auth são conferidas,
    mas não ficam guardadas: a mensagem vai vazia, sem cifra."""
    if not isinstance(d, dict) or "endpoint" not in d or not set(d) <= {"endpoint", "expirationTime", "keys"}:
        raise ValueError("formato")
    expira = d.get("expirationTime")
    if expira is not None and (type(expira) is not int or expira < 0):   # type(): o True não vale como 1
        raise ValueError("expirationTime")
    chaves = d.get("keys", {})
    if not isinstance(chaves, dict) or not set(chaves) <= {"p256dh", "auth"} or \
            not all(isinstance(v, str) and CHAVE_OK.fullmatch(v) for v in chaves.values()):
        raise ValueError("keys")
    if not endpoint_ok(d["endpoint"]):
        raise EndpointInvalido("endpoint")
    return d["endpoint"]


def validar_saida(d):
    """O corpo do POST /api/push/sair: {"endpoint": "..."}. Sair de um endpoint que não existe também vale."""
    if not isinstance(d, dict) or set(d) != {"endpoint"} or not isinstance(d["endpoint"], str) or \
            not 0 < len(d["endpoint"]) <= ENDPOINT_MAX:
        raise ValueError("formato")
    return d["endpoint"]


def validar_arquivo(d):
    """Tudo ou nada: o push.json no formato exato, ou ValueError. Devolve a lista de assinaturas."""
    if not isinstance(d, dict) or set(d) != {"v", "assinaturas"} or type(d["v"]) is not int or d["v"] != 1 \
            or not isinstance(d["assinaturas"], list) or len(d["assinaturas"]) > ASSINATURAS_MAX:
        raise ValueError("formato")
    lista, vistos = [], set()
    for a in d["assinaturas"]:
        if not isinstance(a, dict) or set(a) != {"endpoint", "desde"} or not endpoint_ok(a["endpoint"]) \
                or a["endpoint"] in vistos or type(a["desde"]) is not int or not 0 <= a["desde"] <= DESDE_TETO:
            raise ValueError("assinatura")
        vistos.add(a["endpoint"])
        lista.append({"endpoint": a["endpoint"], "desde": a["desde"]})
    return lista


class _SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None   # o 3xx vira HTTPError: o envio só fala com o endpoint conferido


_ABRIDOR = urllib.request.build_opener(_SemRedirecionar)


def abrir(req):
    """Status HTTP do envio (3xx incluído, sem seguir), ou None sem resposta (rede, tempo esgotado)."""
    try:
        with _ABRIDOR.open(req, timeout=TIMEOUT) as r:
            return r.status
    except urllib.error.HTTPError as x:
        with x:
            return x.code
    except (urllib.error.URLError, OSError, ValueError):
        return None


class Avisos(threading.Thread):
    """As assinaturas, o último aviso e a fila de envio, sob uma trava. O Leitor só põe na fila (transicoes); quem fala
    com os serviços de push é esta thread, fora da trava."""

    def __init__(self, chave, cabecalho, log, fuso, guardar=None, assinaturas=None, enviar=abrir, destino=None,
                 desligado=None):
        """chave: a chave pública VAPID (base64url) do GET /api/push/chave; cabecalho(endpoint, agora): o Authorization do
        envio ("vapid t=..., k=..."), assinado de novo só a cada CABECALHO_VALE por aud; guardar(bytes): o gravar() atômico do push.json; assinaturas: o que o ler_push()
        leu ao subir (validado, ou None); destino(endpoint): só a prévia (--push) passa, e manda tudo a um servidor falso
        local em vez do serviço de push. desligado: o motivo do DESLIGADO (sem chave nem cabecalho), quando o push não
        pode funcionar: nada se assina nem se envia, e as rotas dizem o porquê (409)."""
        super().__init__(daemon=True)
        if (desligado is None) == (chave is None) or (desligado is not None and desligado not in DESLIGADO):
            raise ValueError("chave e cabecalho, ou o motivo de estar desligado")
        self.chave, self.cabecalho, self.log, self.fuso, self.desligado = chave, cabecalho, log, fuso, desligado
        self.guardar, self.enviar, self.destino = guardar, enviar, destino
        self.assinaturas = list(assinaturas or [])
        self.trava = threading.Lock()
        self.fila = queue.Queue(FILA_MAX)
        self.vistos = {}   # (run_id, tipo) -> None, na ordem de chegada: um aviso por run_id e estado
        self.contas = {}   # endpoint -> [último envio, dia, envios no dia]
        self.ultimo = None
        self.erros = set()
        self.cabecalhos = {}   # aud (https://host) -> (Authorization, até quando vale); só a thread do envio mexe

    # ------------------------------------------------------------ assinaturas (rotas)

    def _gravar(self):
        if self.guardar:
            self.guardar(json.dumps({"v": 1, "assinaturas": self.assinaturas}, separators=(",", ":")).encode())

    def _recusa(self):
        return 409, {"erro": self.desligado, "mensagem": DESLIGADO[self.desligado]}

    def chave_publica(self):
        """GET /api/push/chave: (status HTTP, corpo)."""
        return self._recusa() if self.desligado else (200, {"chave": self.chave})

    def assinar(self, endpoint, agora):
        """POST /api/push/assinar, com o endpoint já validado: (status HTTP, corpo). O mesmo endpoint não duplica."""
        if self.desligado:
            return self._recusa()
        with self.trava:
            if any(a["endpoint"] == endpoint for a in self.assinaturas):
                return 200, {"ok": True}
            if len(self.assinaturas) >= ASSINATURAS_MAX:
                return 409, {"erro": "cheio", "mensagem": f"Já há {ASSINATURAS_MAX} aparelhos avisados. Desligue um antes."}
            self.assinaturas.append({"endpoint": endpoint, "desde": int(agora)})
            try:
                self._gravar()
            except OSError as x:   # o arquivo fica como estava, e a memória também
                self.assinaturas.pop()
                self.log(evento="push", resultado="nao_gravou", detalhe=type(x).__name__)
                return 500, {"erro": "disco", "mensagem": "Não consegui guardar. Tente de novo."}
            total = len(self.assinaturas)
        self.log(evento="push", resultado="assinou", aparelhos=total)
        return 200, {"ok": True}

    def sair(self, endpoint):
        """POST /api/push/sair: (status HTTP, corpo); o endpoint que não existe também responde ok."""
        with self.trava:
            antes = list(self.assinaturas)
            self.assinaturas = [a for a in antes if a["endpoint"] != endpoint]
            if len(self.assinaturas) == len(antes):
                return 200, {"ok": True}
            try:
                self._gravar()
            except OSError as x:
                self.assinaturas = antes
                self.log(evento="push", resultado="nao_gravou", detalhe=type(x).__name__)
                return 500, {"erro": "disco", "mensagem": "Não consegui guardar. Tente de novo."}
            total = len(self.assinaturas)
        self.log(evento="push", resultado="saiu", aparelhos=total)
        return 200, {"ok": True}

    def limpar(self):
        """"Sair de todos os aparelhos": nenhum aparelho segue recebendo aviso (um celular perdido, por exemplo)."""
        with self.trava:
            if not self.assinaturas:
                return
            antes, self.assinaturas = self.assinaturas, []
            try:
                self._gravar()
            except OSError as x:   # a memória já está vazia; o arquivo é regravado na próxima mudança
                self.log(evento="push", resultado="nao_gravou", detalhe=type(x).__name__)
        self.log(evento="push", resultado="limpou", aparelhos=len(antes))

    def publico(self):
        """GET /api/avisos: o último aviso (agente, nome, tipo e quando), nunca o rótulo da tarefa."""
        with self.trava:
            return {"aviso": dict(self.ultimo) if self.ultimo else None}

    def zerar(self):
        """Troca de conta no OAuth: o aviso e os run_id da conta anterior saem; as assinaturas são dos aparelhos e ficam."""
        with self.trava:
            self.ultimo, self.vistos = None, {}

    # ------------------------------------------------------------ disparo

    def transicoes(self, novos, resumo, agora):
        """Gancho do Leitor, a cada leitura que deu certo: os pedidos novos ((tipo, id do agente, run_id) do Diario) viram
        avisos na fila. Rápido e sem rede; nunca levanta (1 linha de log por tipo de erro)."""
        try:
            nomes = {a["id"]: a.get("nome", "") for a in resumo.get("agentes", [])}
            with self.trava:
                for tipo, agente, rid in novos:
                    if tipo not in TIPOS or (rid, tipo) in self.vistos:
                        continue
                    self.vistos[(rid, tipo)] = None
                    if len(self.vistos) > VISTOS_MAX:
                        del self.vistos[next(iter(self.vistos))]
                    self.ultimo = {"agente": agente, "nome": nomes.get(agente, ""), "tipo": tipo, "quando": int(agora)}
                    if self.assinaturas and not self.desligado:
                        try:
                            self.fila.put_nowait((agora, dict(self.ultimo)))
                        except queue.Full:   # a thread está atrasada: este aviso fica só no GET /api/avisos
                            pass
        except Exception as x:
            self._erro(x)

    def _erro(self, x):
        if type(x).__name__ not in self.erros:
            self.erros.add(type(x).__name__)
            self.log(evento="push", resultado="erro", detalhe=type(x).__name__)

    def _escolher(self, agora):
        """Os endpoints que podem receber agora (1 por minuto e 50 por dia em cada aparelho), já contados."""
        dia = datetime.datetime.fromtimestamp(agora, self.fuso).date()
        escolhidos = []
        with self.trava:
            vivos = {a["endpoint"] for a in self.assinaturas}
            self.contas = {k: v for k, v in self.contas.items() if k in vivos}
            for endpoint in sorted(vivos):
                ultimo, dia_conta, n = self.contas.get(endpoint, (None, dia, 0))
                n = n if dia_conta == dia else 0
                if (ultimo is not None and agora - ultimo < ENTRE_ENVIOS) or n >= POR_DIA:
                    continue
                self.contas[endpoint] = [agora, dia, n + 1]
                escolhidos.append(endpoint)
        return escolhidos

    def _autorizacao(self, endpoint, agora):
        """O Authorization do aud do endpoint: o mesmo JWT serve a todos os aparelhos do serviço até perto do exp."""
        partes = urllib.parse.urlsplit(endpoint)
        aud = f"{partes.scheme}://{partes.netloc}"
        cab, ate = self.cabecalhos.get(aud, (None, 0))
        if agora >= ate:
            cab, ate = self.cabecalho(endpoint, agora), agora + CABECALHO_VALE
            self.cabecalhos[aud] = (cab, ate)
        return cab

    def _mandar(self, endpoint, agora):
        """Um envio vazio: só o Authorization VAPID, o TTL e a Urgency. Fora da prévia, só para endpoint da lista."""
        if self.destino is None and not endpoint_ok(endpoint):
            return None
        req = urllib.request.Request(self.destino(endpoint) if self.destino else endpoint, data=None, method="POST",
                                     headers={"Authorization": self._autorizacao(endpoint, agora), "TTL": str(TTL),
                                              "Urgency": URGENCIA})
        return self.enviar(req)

    def disparar(self, agora):
        """Envia o aviso a cada aparelho que pode receber; 404 e 410 apagam a assinatura. O log leva só contagens."""
        enviados = falhas = 0
        apagar, codigos = set(), set()
        for endpoint in self._escolher(agora):
            try:
                st = self._mandar(endpoint, agora)
            except Exception as x:   # o cabecalho ou o envio com erro: conta como falha, sem derrubar a thread
                self._erro(x)
                st = None
            if st is not None and not 200 <= st < 300:
                codigos.add(st)
            if st in (404, 410):
                apagar.add(endpoint)
            elif st is not None and 200 <= st < 300:
                enviados += 1
            else:
                falhas += 1
        if apagar:
            with self.trava:
                self.assinaturas = [a for a in self.assinaturas if a["endpoint"] not in apagar]
                try:
                    self._gravar()
                except OSError as x:   # some da memória já; o arquivo é regravado na próxima mudança
                    self.log(evento="push", resultado="nao_gravou", detalhe=type(x).__name__)
        if enviados or falhas or apagar:
            self.log(evento="push", resultado="aviso", enviados=enviados, falhas=falhas, apagados=len(apagar),
                     codigos=sorted(codigos))   # para o teste real (um 403 da Apple, por exemplo), sem o endpoint

    def run(self):
        while True:
            agora, _ = self.fila.get()
            try:
                self.disparar(agora)
            except Exception as x:
                self._erro(x)
