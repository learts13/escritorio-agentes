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
Não perturbe: cada assinatura guarda a conta que assinou, e a conta pode escolher avisar sempre (o padrão), só no
expediente ou fora de uma janela de silêncio (HH:MM a HH:MM, no fuso do escritório). O aviso calado não vira push depois
nem gasta o teto: fica só no GET /api/avisos ("Esperando você"). Assinatura sem conta (de antes) avisa sempre.
Por andar (1.6): o Avisos é um só no prédio (a fila, as assinaturas e a VAPID), e cada andar põe os pedidos dele
(do_andar). Com pode(conta, andar), o aviso só vai para os aparelhos das contas com papel no andar, conferido na hora do
envio (quem perde o papel para de receber na hora), e o GET /api/avisos mostra só o que é da conta da sessão.
"""
import collections
import datetime
import queue
import re
import threading
import time
import json
import unicodedata
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
CONTA_OK = re.compile(r"[a-z0-9][a-z0-9._-]{2,31}")   # o mesmo formato do usuário do acesso.py
HHMM_OK = re.compile(r"([01]?[0-9]|2[0-3]):([0-5][0-9])")   # [0-9]: o \d aceita dígitos de outras escritas
EXPEDIENTE_PADRAO = {"abre": "07:00", "fecha": "20:00"}
TIPOS = ("pediu_aprovacao", "pediu_resposta")
TTL, URGENCIA, TIMEOUT = 300, "high", 10   # o aviso vale 5 min no serviço de push; depois disso, perdeu a graça
ENTRE_ENVIOS, POR_DIA = 60, 50   # por aparelho
VISTOS_MAX, FILA_MAX, DESDE_TETO = 1000, 50, 10 ** 11
DESLIGADO = {"precisa_https": "O aviso no celular precisa do escritório em https (ESCRITORIO_BASE)."}
PRINCIPAL = "principal"   # o id do andar principal (acesso.ANDAR_PRINCIPAL)
CABECALHO_VALE = 11 * 3600   # o mesmo Authorization por aud, até 1 h antes do exp do JWT (12 h, no vapid.py)
PESSOAIS_MAX, CONTAS_MAX, COMECO_MAX = 20, 1000, 60   # E.4: a fila de avisos de cada conta, só na memória


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
        if not isinstance(a, dict) or set(a) - {"conta"} != {"endpoint", "desde"} or not endpoint_ok(a["endpoint"]) \
                or a["endpoint"] in vistos or type(a["desde"]) is not int or not 0 <= a["desde"] <= DESDE_TETO \
                or ("conta" in a and not (isinstance(a["conta"], str) and CONTA_OK.fullmatch(a["conta"]))):
            raise ValueError("assinatura")
        vistos.add(a["endpoint"])
        lista.append({k: a[k] for k in ("endpoint", "desde", "conta") if k in a})
    return lista


def _hhmm(valor):
    m = HHMM_OK.fullmatch(valor) if isinstance(valor, str) else None
    if not m:
        raise ValueError("horário no formato HH:MM, de 00:00 a 23:59")
    return f"{int(m.group(1)):02d}:{m.group(2)}"


def validar_preferencia(d):
    """O "Não perturbe" da conta, tudo ou nada: {"modo": "sempre"}, {"modo": "expediente"} ou {"modo": "silencio",
    "de": "HH:MM", "ate": "HH:MM"} (de > ate vira a meia-noite; de == ate é recusado), com o "comeco" opcional (mostrar
    o começo da mensagem no aviso, E.4; ligado é o padrão e não fica gravado). Devolve normalizado."""
    if not isinstance(d, dict) or d.get("modo") not in ("sempre", "expediente", "silencio"):
        raise ValueError("modo: sempre, expediente ou silencio")
    if "comeco" in d and type(d["comeco"]) is not bool:
        raise ValueError("comeco: true ou false")
    extra = {"comeco": False} if d.get("comeco") is False else {}
    chaves = set(d) - {"comeco"}
    if d["modo"] != "silencio":
        if chaves != {"modo"}:
            raise ValueError("formato")
        return {"modo": d["modo"], **extra}
    if chaves != {"modo", "de", "ate"}:
        raise ValueError("formato")
    de, ate = _hhmm(d["de"]), _hhmm(d["ate"])
    if de == ate:
        raise ValueError("o silêncio precisa começar e acabar em horários diferentes")
    return {"modo": "silencio", "de": de, "ate": ate, **extra}


def mostra_comeco(pref):
    """A conta quer o começo da mensagem no aviso? Sem preferência (ou uma que não valida), sim (D5 b)."""
    return not (isinstance(pref, dict) and pref.get("comeco") is False)


def comeco(texto, maximo=COMECO_MAX):
    """O corpo do aviso: texto puro numa linha só (sem controle, invisível nem bidi), até 60 caracteres; o corte é no
    último espaço depois do 40º, com "…"."""
    limpo = " ".join("".join(c if unicodedata.category(c) not in ("Cc", "Cf", "Cs", "Co", "Cn") else
                             (" " if c in "\n\r\t" else "") for c in texto).split())
    if len(limpo) <= maximo:
        return limpo
    corte = limpo[:maximo - 1]
    espaco = corte.rfind(" ")
    return (corte[:espaco] if espaco >= 40 else corte).rstrip() + "…"


def _dentro(minuto, de, ate):
    """O minuto do dia está em [de, ate)? de > ate é a janela que vira a meia-noite."""
    a, b = (int(x[:2]) * 60 + int(x[3:]) for x in (de, ate))
    return a <= minuto < b if a < b else minuto >= a or minuto < b


def calado(pref, expediente, agora, fuso):
    """O push fica calado agora para esta preferência? Sem preferência (ou uma que não valida), nunca: como hoje. "Só no
    expediente" usa o expediente do escritório (sem um válido, 07:00 às 20:00); a hora é a do fuso do escritório."""
    try:
        pref = validar_preferencia(pref)
    except ValueError:
        return False
    if pref["modo"] == "sempre":
        return False
    hora = datetime.datetime.fromtimestamp(agora, fuso)
    minuto = hora.hour * 60 + hora.minute
    if pref["modo"] == "silencio":
        return _dentro(minuto, pref["de"], pref["ate"])
    try:
        abre, fecha = _hhmm(expediente["abre"]), _hhmm(expediente["fecha"])
    except (ValueError, TypeError, KeyError):
        abre, fecha = EXPEDIENTE_PADRAO["abre"], EXPEDIENTE_PADRAO["fecha"]
    return abre != fecha and not _dentro(minuto, abre, fecha)


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
                 desligado=None, preferencia=None, expediente=None, pode=None):
        """chave: a chave pública VAPID (base64url) do GET /api/push/chave; cabecalho(endpoint, agora): o Authorization do
        envio ("vapid t=..., k=..."), assinado de novo só a cada CABECALHO_VALE por aud; guardar(bytes): o gravar() atômico do push.json; assinaturas: o que o ler_push()
        leu ao subir (validado, ou None); destino(endpoint): só a prévia (--push) passa, e manda tudo a um servidor falso
        local em vez do serviço de push. desligado: o motivo do DESLIGADO (sem chave nem cabecalho), quando o push não
        pode funcionar: nada se assina nem se envia, e as rotas dizem o porquê (409). preferencia(conta): o "Não perturbe"
        da conta (ou None); expediente(): o {"abre", "fecha"} do escritório (expediente(andar) num andar extra). Sem
        eles, avisa sempre. pode(conta, andar): a conta (None: a assinatura de antes, sem conta) recebe os avisos do
        andar? Sem ele, todo aparelho recebe tudo (o escritório de um andar só)."""
        super().__init__(daemon=True)
        if (desligado is None) == (chave is None) or (desligado is not None and desligado not in DESLIGADO):
            raise ValueError("chave e cabecalho, ou o motivo de estar desligado")
        self.chave, self.cabecalho, self.log, self.fuso, self.desligado = chave, cabecalho, log, fuso, desligado
        self.guardar, self.enviar, self.destino = guardar, enviar, destino
        self.preferencia, self.expediente, self.pode = preferencia, expediente, pode
        self.assinaturas = list(assinaturas or [])
        self.trava = threading.Lock()
        self.fila = queue.Queue(FILA_MAX)
        self.vistos = {}   # (andar, run_id, tipo) -> None, na ordem de chegada: um aviso por andar, run_id e estado
        self.contas = {}   # endpoint -> [último envio, dia, envios no dia]
        self.ultimos = {}   # andar -> o último aviso dele, do mais antigo ao mais novo
        # E.4: conta -> deque[(quando, item, andar)] dos avisos só dela (menção, DM, aceno), válidos por TTL. O item não
        # leva texto: resolver(conta, item, andar, mais) monta título e corpo na hora do GET (None: não mostra)
        self.pessoais, self.resolver = {}, None
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

    def assinar(self, endpoint, agora, conta=None):
        """POST /api/push/assinar, com o endpoint já validado: (status HTTP, corpo). O mesmo endpoint não duplica; assinado
        de novo por outra conta (outra pessoa no mesmo aparelho), passa a seguir o "Não perturbe" dela."""
        if self.desligado:
            return self._recusa()
        nova = {"endpoint": endpoint, "desde": int(agora), **({"conta": conta} if conta else {})}
        with self.trava:
            antes = list(self.assinaturas)
            i = next((i for i, a in enumerate(antes) if a["endpoint"] == endpoint), None)
            if i is not None and antes[i].get("conta") == conta:
                return 200, {"ok": True}
            if i is None and len(antes) >= ASSINATURAS_MAX:
                return 409, {"erro": "cheio", "mensagem": f"Já há {ASSINATURAS_MAX} aparelhos avisados. Desligue um antes."}
            if i is None:
                self.assinaturas.append(nova)
            else:
                self.assinaturas[i] = {**nova, "desde": antes[i]["desde"]}
            try:
                self._gravar()
            except OSError as x:   # o arquivo fica como estava, e a memória também
                self.assinaturas = antes
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

    def limpar(self, conta=None):
        """"Sair de todos os aparelhos" (um celular perdido, por exemplo): sem conta, nenhum aparelho segue recebendo
        aviso (o admin); com conta, só os aparelhos que ela assinou (o membro, ou a conta removida)."""
        with self.trava:
            antes = self.assinaturas
            self.assinaturas = [a for a in antes if conta is not None and a.get("conta") != conta]
            if len(self.assinaturas) == len(antes):
                return
            try:
                self._gravar()
            except OSError as x:   # a memória já está sem eles; o arquivo é regravado na próxima mudança
                self.log(evento="push", resultado="nao_gravou", detalhe=type(x).__name__)
        self.log(evento="push", resultado="limpou", aparelhos=len(antes) - len(self.assinaturas))

    def esquecer(self, conta):
        """A conta foi removida do prédio: os aparelhos que ela assinou param de receber aviso."""
        with self.trava:
            self.pessoais.pop(conta, None)
        self.limpar(conta)

    def _recebe(self, conta, andar):
        """A conta recebe os avisos do andar? Sem pode(), sim; pode() com erro, não (falha fechada)."""
        if self.pode is None:
            return True
        try:
            return bool(self.pode(conta, andar))
        except Exception as x:
            self._erro(x)
            return False

    def publico(self, conta=None, agora=None):
        """GET /api/avisos: o aviso mais novo para a conta. O de agente (agente, nome, tipo e quando, nunca o rótulo da
        tarefa) dos andares em que ela recebe, ou o pessoal (menção, DM, aceno), montado pelo resolver na hora."""
        agora = time.time() if agora is None else agora
        with self.trava:
            ultimos = list(self.ultimos.items())
            fila = self.pessoais.get(conta)
            pessoais = [p for p in fila if agora - p[0] < TTL] if conta is not None and fila else []
        vale = [aviso for andar, aviso in ultimos if self._recebe(conta, andar)]   # fora da trava: o pode() lê as contas
        aviso = dict(vale[-1]) if vale else None
        if pessoais and self.resolver and (aviso is None or pessoais[-1][0] >= aviso["quando"]):
            quando, item, andar = pessoais[-1]
            try:
                montado = self.resolver(conta, dict(item), andar, len(pessoais) - 1) if self._recebe(conta, andar) else None
            except Exception as x:
                self._erro(x)
                montado = None
            if montado is not None:
                aviso = {**montado, "quando": int(quando), "andar": andar}
        return {"aviso": aviso}

    def pessoal(self, conta, andar, item, agora, push=True):
        """Um aviso só desta conta (E.4): entra na fila dela (até 20, por 5 min, só na memória) e, com push, vai só para
        os aparelhos que ela assinou (o "Não perturbe", o papel no andar e os tetos valem como sempre)."""
        with self.trava:
            fila = self.pessoais.get(conta)
            if fila is None:
                if len(self.pessoais) >= CONTAS_MAX:
                    self.pessoais = {k: v for k, v in self.pessoais.items() if v and agora - v[-1][0] < TTL}
                fila = self.pessoais[conta] = collections.deque(maxlen=PESSOAIS_MAX)
            fila.append((agora, dict(item), andar))
            if push and not self.desligado and any(a.get("conta") == conta for a in self.assinaturas):
                try:
                    self.fila.put_nowait((agora, None, andar, conta))
                except queue.Full:
                    pass

    def zerar(self, andar=None):
        """Troca de conta no OAuth do andar (None: de todos): o aviso e os run_id da conta anterior saem; as assinaturas
        são dos aparelhos e ficam."""
        with self.trava:
            if andar is None:
                self.ultimos, self.vistos = {}, {}
            else:
                self.ultimos.pop(andar, None)
                self.vistos = {k: v for k, v in self.vistos.items() if k[0] != andar}

    def do_andar(self, andar):
        """O gancho que o Leitor do andar usa (leitor.avisos): os pedidos dele entram na fila com o andar."""
        return _DoAndar(self, andar)

    # ------------------------------------------------------------ disparo

    def transicoes(self, novos, resumo, agora, andar=PRINCIPAL):
        """Gancho do Leitor do andar, a cada leitura que deu certo: os pedidos novos ((tipo, id do agente, run_id) do
        Diario) viram avisos na fila, com o andar. Rápido e sem rede; nunca levanta (1 linha de log por tipo de erro)."""
        try:
            nomes = {a["id"]: a.get("nome", "") for a in resumo.get("agentes", [])}
            with self.trava:
                for tipo, agente, rid in novos:
                    if tipo not in TIPOS or (andar, rid, tipo) in self.vistos:
                        continue
                    self.vistos[(andar, rid, tipo)] = None
                    if len(self.vistos) > VISTOS_MAX:
                        del self.vistos[next(iter(self.vistos))]
                    aviso = {"agente": agente, "nome": nomes.get(agente, ""), "tipo": tipo, "quando": int(agora)}
                    self.ultimos.pop(andar, None)   # reentra no fim: o mais novo de todos fica por último
                    self.ultimos[andar] = aviso
                    if self.assinaturas and not self.desligado:
                        try:
                            self.fila.put_nowait((agora, dict(aviso), andar))
                        except queue.Full:   # a thread está atrasada: este aviso fica só no GET /api/avisos
                            pass
        except Exception as x:
            self._erro(x)

    def _erro(self, x):
        if type(x).__name__ not in self.erros:
            self.erros.add(type(x).__name__)
            self.log(evento="push", resultado="erro", detalhe=type(x).__name__)

    def _calados(self, contas, agora, andar=PRINCIPAL):
        """As contas com o push calado agora (o "Não perturbe"), pelo expediente do andar. Preferência ou expediente com
        erro: avisa, como hoje."""
        if not self.preferencia or not contas:
            return set()
        try:
            expediente = (self.expediente(*(() if andar == PRINCIPAL else (andar,)))) if self.expediente else None
        except Exception as x:
            self._erro(x)
            expediente = None
        calados = set()
        for conta in contas:
            try:
                if calado(self.preferencia(conta), expediente, agora, self.fuso):
                    calados.add(conta)
            except Exception as x:
                self._erro(x)
        return calados

    def _escolher(self, agora, andar=PRINCIPAL, conta=None):
        """Os endpoints que podem receber agora o aviso do andar (só de contas com papel nele; com conta, só os dela; 1 por
        minuto e 50 por dia em cada aparelho), já contados. O de conta calada fica de fora sem contar no teto."""
        dia = datetime.datetime.fromtimestamp(agora, self.fuso).date()
        escolhidos = []
        with self.trava:
            donos = {a["endpoint"]: a.get("conta") for a in self.assinaturas if conta is None or a.get("conta") == conta}
        # fora da trava: o pode() e o "Não perturbe" leem as contas e o expediente
        donos = {k: c for k, c in donos.items() if self._recebe(c, andar)}
        calados = self._calados({c for c in donos.values() if c}, agora, andar)
        with self.trava:
            vivos = {a["endpoint"] for a in self.assinaturas}
            self.contas = {k: v for k, v in self.contas.items() if k in vivos}
            vivos &= set(donos)
            for endpoint in sorted(vivos - {k for k, c in donos.items() if c in calados}):
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

    def disparar(self, agora, andar=PRINCIPAL, conta=None):
        """Envia o aviso do andar a cada aparelho que pode receber (com conta, só aos dela); 404 e 410 apagam a
        assinatura. O log leva só contagens."""
        enviados = falhas = 0
        apagar, codigos = set(), set()
        for endpoint in self._escolher(agora, andar, conta):
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
            agora, _, andar, *conta = self.fila.get()   # o pessoal leva a conta no 4º campo
            try:
                self.disparar(agora, andar, *conta)
            except Exception as x:
                self._erro(x)


class _DoAndar:
    """leitor.avisos de um andar: o transicoes() do Avisos do prédio com o id do andar."""

    def __init__(self, avisos, andar):
        self.avisos, self.andar = avisos, andar

    def transicoes(self, novos, resumo, agora):
        self.avisos.transicoes(novos, resumo, agora, self.andar)
