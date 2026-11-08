"""Aviso no celular: avisos.py (endpoint, assinaturas, disparo e limites), a ligação com o vapid.py no escritorio.py, o
gancho no Leitor e as rotas /api/push/chave, /api/push/assinar, /api/push/sair e /api/avisos.
Uso: python -B -m unittest test_escritorio test_avisos
"""
import atexit
import base64
import datetime
import http.server
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

PASTA = tempfile.mkdtemp(prefix="escritorio-teste-avisos-")
os.environ.setdefault("ESCRITORIO_DADOS", PASTA)   # rodando junto com o test_escritorio, vale a pasta dele
if "ESCRITORIO_TIMES" not in os.environ:
    os.environ["ESCRITORIO_TIMES"] = os.path.join(PASTA, "times.json")
    with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as _f:
        json.dump({"conversas": "ler"}, _f)
os.environ.setdefault("AGENTES_ORG", "00000000-0000-4000-8000-000000000000")  # org fictícia
import avisos  # noqa: E402
import escritorio as e  # noqa: E402
import vapid  # noqa: E402
from acesso import Acesso  # noqa: E402

FCM = "https://fcm.googleapis.com/fcm/send/abc123:APA91b-x_y"
MOZ = "https://updates.push.services.mozilla.com/wpush/v2/gAAAAA"
APPLE = "https://web.push.apple.com/QGx-1_aB"
WNS = "https://wns2-par02p.notify.windows.com/w/?token=AwYAAAB%2bx"
T0 = datetime.datetime(2026, 11, 9, 10, 0, tzinfo=e.FUSO).timestamp()


# até o fim do processo, e não no tearDownModule: no discover, o escritorio pode ter sido importado com esta pasta, e os
# módulos de teste seguintes ainda gravam nela
atexit.register(shutil.rmtree, PASTA, ignore_errors=True)


class Logs(list):
    def __call__(self, **campos):
        self.append(campos)


class Envios(list):
    """O enviar() falso: guarda cada pedido e responde o status da vez (o padrão é 201)."""
    def __init__(self):
        super().__init__()
        self.status = {}

    def __call__(self, req):
        self.append(req)
        st = self.status.get(req.full_url, 201)
        if isinstance(st, Exception):
            raise st
        return st


def novo(**k):
    logs, envios, gravados = Logs(), Envios(), []
    a = avisos.Avisos("CHAVE", lambda endpoint, agora: "vapid t=jwt-de-" + endpoint[8:20], logs, e.FUSO,
                      guardar=gravados.append, enviar=envios, **k)
    return a, logs, envios, gravados


def pedido(rid, agente="a1", tipo="pediu_aprovacao"):
    return (tipo, agente, rid)


RESUMO = {"agentes": [{"id": "a1", "nome": "Pixel"}, {"id": "a2", "nome": "Órbita"}]}


class Endpoint(unittest.TestCase):
    def test_lista_fechada_de_hosts_https(self):
        for bom in (FCM, MOZ, APPLE, WNS, "https://fcm.googleapis.com"):
            self.assertTrue(avisos.endpoint_ok(bom), bom)
        ruins = ["http://fcm.googleapis.com/fcm/send/x", "https://evil.example/fcm", "https://fcm.googleapis.com.evil.example/x",
                 "https://fcm.googleapis.com:8443/x", "https://user@fcm.googleapis.com/x", "https://evil.example@fcm.googleapis.com/x",
                 "https://fcm.googleapis.com/x#frag", "https://FCM.googleapis.com/x", "https://notify.windows.com/x",
                 "https://.notify.windows.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://fcm.googleapis.com/a b",
                 "https://fcm.googleapis.com/a\nb", "https://fcm.googleapis.com/" + "a" * 1000, "", None, 1, ["https://..."],
                 "https://evil.example/.notify.windows.com", "https://evilnotify.windows.com/x", " " + FCM]
        for ruim in ruins:
            self.assertFalse(avisos.endpoint_ok(ruim), ruim)

    def test_corpo_do_assinar_e_do_sair(self):
        bom = {"endpoint": FCM, "expirationTime": None, "keys": {"p256dh": "BOr-x_y" * 12, "auth": "k8Jh-x_Y=="}}
        self.assertEqual(avisos.validar_assinatura(bom), FCM)
        self.assertEqual(avisos.validar_assinatura({"endpoint": FCM}), FCM)
        self.assertEqual(avisos.validar_assinatura({**bom, "expirationTime": 1_900_000_000_000}), FCM)
        with self.assertRaises(avisos.EndpointInvalido):
            avisos.validar_assinatura({**bom, "endpoint": "https://evil.example/x"})
        for ruim in ({**bom, "extra": 1}, {**bom, "expirationTime": True}, {**bom, "expirationTime": 1.5},
                     {**bom, "expirationTime": -1}, {**bom, "keys": {"p256dh": "a b"}}, {**bom, "keys": {"outra": "x"}},
                     {**bom, "keys": []}, {"keys": {}}, [bom], None):
            with self.assertRaises(ValueError):
                avisos.validar_assinatura(ruim)
        self.assertEqual(avisos.validar_saida({"endpoint": "https://qualquer/um"}), "https://qualquer/um")
        for ruim in ({}, {"endpoint": ""}, {"endpoint": 1}, {"endpoint": FCM, "x": 1}, {"endpoint": "a" * 1025}):
            with self.assertRaises(ValueError):
                avisos.validar_saida(ruim)

    def test_arquivo_tudo_ou_nada(self):
        bom = {"v": 1, "assinaturas": [{"endpoint": FCM, "desde": 1}, {"endpoint": APPLE, "desde": 2}]}
        self.assertEqual(avisos.validar_arquivo(bom), bom["assinaturas"])
        a = {"endpoint": FCM, "desde": 1}
        for ruim in ({"v": 2, "assinaturas": []}, {"v": True, "assinaturas": []}, {"v": 1, "assinaturas": [a, a]},
                     {"v": 1, "assinaturas": [{**a, "desde": True}]}, {"v": 1, "assinaturas": [{**a, "desde": 1.0}]},
                     {"v": 1, "assinaturas": [{**a, "endpoint": "https://evil.example/x"}]},
                     {"v": 1, "assinaturas": [{**a, "chaves": "x"}]}, {"v": 1, "assinaturas": {}}, {"v": 1},
                     {"v": 1, "assinaturas": [{"endpoint": f"https://fcm.googleapis.com/{n}", "desde": 1} for n in range(11)]}):
            with self.assertRaises(ValueError):
                avisos.validar_arquivo(ruim)


class Assinaturas(unittest.TestCase):
    def test_assinar_sem_duplicar_teto_e_sair(self):
        a, logs, _, gravados = novo()
        self.assertEqual(a.assinar(FCM, T0), (200, {"ok": True}))
        self.assertEqual(a.assinar(FCM, T0 + 5), (200, {"ok": True}))   # o mesmo endpoint não duplica nem regrava
        self.assertEqual(len(gravados), 1)
        for n in range(avisos.ASSINATURAS_MAX - 1):
            self.assertEqual(a.assinar(f"https://fcm.googleapis.com/fcm/send/{n}", T0)[0], 200)
        st, corpo = a.assinar(APPLE, T0)
        self.assertEqual((st, corpo["erro"]), (409, "cheio"))
        self.assertEqual(avisos.validar_arquivo(json.loads(gravados[-1]))[0], {"endpoint": FCM, "desde": int(T0)})
        self.assertEqual(a.sair(FCM), (200, {"ok": True}))
        self.assertEqual(a.sair(FCM), (200, {"ok": True}))   # o que não existe também
        self.assertEqual(len(avisos.validar_arquivo(json.loads(gravados[-1]))), avisos.ASSINATURAS_MAX - 1)
        self.assertEqual(a.assinar(APPLE, T0)[0], 200)   # a vaga voltou
        self.assertNotIn("fcm.googleapis", json.dumps(logs))   # o endpoint nunca vai ao log

    def test_disco_com_erro_nao_muda_nada(self):
        a, logs, _, _ = novo()

        def falha(dados):
            raise OSError("disco cheio")
        a.guardar = falha
        self.assertEqual(a.assinar(FCM, T0)[0], 500)
        self.assertEqual(a.assinaturas, [])
        a.guardar = lambda dados: None
        a.assinar(FCM, T0)
        a.guardar = falha
        self.assertEqual(a.sair(FCM)[0], 500)
        self.assertEqual([x["endpoint"] for x in a.assinaturas], [FCM])
        self.assertEqual([x["resultado"] for x in logs].count("nao_gravou"), 2)

    def test_desligado_sem_https_nao_assina_nem_enfileira(self):
        logs = Logs()
        a = avisos.Avisos(None, None, logs, e.FUSO, assinaturas=[{"endpoint": FCM, "desde": 1}], desligado="precisa_https")
        self.assertEqual(a.chave_publica()[1]["erro"], "precisa_https")
        self.assertEqual((a.assinar(APPLE, T0)[0], a.assinar(APPLE, T0)[1]["erro"]), (409, "precisa_https"))
        a.transicoes([pedido("r1")], RESUMO, T0)
        self.assertTrue(a.fila.empty())
        with self.assertRaises(ValueError):   # ou a chave, ou o motivo
            avisos.Avisos("CHAVE", None, logs, e.FUSO, desligado="precisa_https")


class Disparo(unittest.TestCase):
    def test_um_aviso_por_run_e_estado_vazio_com_vapid_ttl_e_urgencia(self):
        a, logs, envios, _ = novo()
        a.assinar(FCM, T0)
        a.assinar(APPLE, T0)
        a.transicoes([("comecou", "a1", "r1"), ("terminou", "a2", "r0"), pedido("r1")], RESUMO, T0)
        a.transicoes([pedido("r1")], RESUMO, T0 + 30)   # o mesmo pedido de novo: nada
        self.assertEqual(a.fila.qsize(), 1)
        self.assertEqual(a.publico(), {"aviso": {"agente": "a1", "nome": "Pixel", "tipo": "pediu_aprovacao", "quando": int(T0)}})
        a.disparar(a.fila.get()[0])
        self.assertEqual(sorted(r.full_url for r in envios), sorted([FCM, APPLE]))
        for r in envios:
            self.assertEqual((r.get_method(), r.data), ("POST", None))   # sem payload
            self.assertEqual(r.get_header("Authorization"), "vapid t=jwt-de-" + r.full_url[8:20])
            self.assertEqual((r.get_header("Ttl"), r.get_header("Urgency")), (str(avisos.TTL), "high"))
        self.assertEqual(logs[-1], {"evento": "push", "resultado": "aviso", "enviados": 2, "falhas": 0, "apagados": 0,
                                    "codigos": []})

    def test_um_por_minuto_e_50_por_dia_em_cada_aparelho(self):
        a, _, envios, _ = novo()
        a.assinar(FCM, T0)
        a.disparar(T0)
        a.disparar(T0 + 59)   # menos de 1 minuto: não manda
        self.assertEqual(len(envios), 1)
        for n in range(1, 80):
            a.disparar(T0 + 60 * n)
        self.assertEqual(len(envios), avisos.POR_DIA)   # o teto do dia
        amanha = datetime.datetime(2026, 11, 10, 0, 1, tzinfo=e.FUSO).timestamp()
        a.disparar(amanha)
        self.assertEqual(len(envios), avisos.POR_DIA + 1)

    def test_cabecalho_assinado_uma_vez_por_aud_ate_perto_do_exp(self):
        assinados = []
        a, _, envios, _ = novo()
        a.cabecalho = lambda endpoint, agora: assinados.append((endpoint.split("/")[2], agora)) or f"vapid t={len(assinados)}"
        for endpoint in (FCM, "https://fcm.googleapis.com/fcm/send/outro", APPLE):
            a.assinar(endpoint, T0)
        a.disparar(T0)   # dois aparelhos no FCM e um na Apple: duas assinaturas
        self.assertEqual(assinados, [("fcm.googleapis.com", T0), ("web.push.apple.com", T0)])
        a.disparar(T0 + avisos.CABECALHO_VALE - 1)   # ainda vale: reaproveita
        self.assertEqual(len(assinados), 2)
        self.assertEqual({r.get_header("Authorization") for r in envios if "apple" in r.full_url}, {"vapid t=2"})
        a.disparar(T0 + avisos.CABECALHO_VALE + 60)   # perto do exp (e passado o 1 por minuto): assina de novo
        self.assertEqual(len(assinados), 4)

    def test_404_e_410_apagam_o_resto_fica(self):
        a, logs, envios, gravados = novo()
        for endpoint in (FCM, MOZ, APPLE, WNS):
            a.assinar(endpoint, T0)
        envios.status = {FCM: 404, MOZ: 410, APPLE: 500, WNS: OSError("rede")}
        a.disparar(T0)
        self.assertEqual([x["endpoint"] for x in a.assinaturas], [APPLE, WNS])
        self.assertEqual([x["endpoint"] for x in avisos.validar_arquivo(json.loads(gravados[-1]))], [APPLE, WNS])
        self.assertEqual(logs[-1], {"evento": "push", "resultado": "aviso", "enviados": 0, "falhas": 2, "apagados": 2,
                                    "codigos": [404, 410, 500]})
        self.assertNotIn("googleapis", json.dumps(logs)); self.assertNotIn("mozilla", json.dumps(logs))

    def test_fila_cheia_nao_trava_o_leitor_e_zerar_esquece_os_vistos(self):
        a, _, _, _ = novo()
        a.assinar(FCM, T0)
        leitura = threading.Thread(target=a.transicoes, args=([pedido(f"r{n}") for n in range(avisos.FILA_MAX + 5)], RESUMO, T0),
                                   daemon=True)   # se travasse, o teste falha em vez de segurar o processo
        leitura.start()
        leitura.join(5)
        self.assertFalse(leitura.is_alive())   # a fila lotou e o Leitor seguiu: o resto fica só no GET /api/avisos
        self.assertEqual((a.fila.qsize(), a.publico()["aviso"]["quando"]), (avisos.FILA_MAX, int(T0)))
        while not a.fila.empty():
            a.fila.get_nowait()
        a.transicoes([pedido("r0")], RESUMO, T0 + 1)   # o mesmo pedido: já visto
        self.assertTrue(a.fila.empty())
        a.zerar()
        self.assertEqual(a.publico(), {"aviso": None})
        a.transicoes([pedido("r0")], RESUMO, T0 + 2)   # depois do zerar (troca de conta), avisa de novo
        self.assertEqual(a.fila.qsize(), 1)

    def test_limpar_desliga_todos_os_aparelhos(self):
        a, logs, _, gravados = novo()
        a.limpar()   # sem aparelhos: nem grava
        self.assertEqual(gravados, [])
        for endpoint in (FCM, APPLE):
            a.assinar(endpoint, T0)
        a.limpar()
        self.assertEqual((a.assinaturas, avisos.validar_arquivo(json.loads(gravados[-1]))), ([], []))
        self.assertEqual(logs[-1], {"evento": "push", "resultado": "limpou", "aparelhos": 2})

    def test_fora_da_previa_so_manda_para_host_da_lista(self):
        a, _, envios, _ = novo()
        a.assinaturas = [{"endpoint": "https://evil.example/push", "desde": 1}, {"endpoint": "http://127.0.0.1:9/push", "desde": 1}]
        a.disparar(T0)   # mesmo que entrasse na memória por outro caminho, nada sai para fora da lista
        self.assertEqual(envios, [])
        self.assertEqual(a.assinar("http://127.0.0.1:9/push", T0)[0], 200)   # o método confia na rota, que valida antes

    def test_transicoes_nunca_levanta(self):
        a, logs, _, _ = novo()
        a.assinar(FCM, T0)
        for ruim in ([("pediu_aprovacao",)], None, [pedido("r1")]):
            a.transicoes(ruim, None if ruim is None else {"agentes": "x"}, T0)
        self.assertEqual({x["resultado"] for x in logs if x["evento"] == "push"} - {"assinou"}, {"erro"})

    def test_envio_de_verdade_nao_segue_redirecionamento(self):
        vistos = []

        class Pagina(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                vistos.append((self.command, self.path, self.headers.get("Content-Length"), self.headers.get("Content-Type")))
                self.send_response(302 if self.path == "/primeiro" else 201)
                self.send_header("Location", "/segundo")
                self.send_header("Content-Length", "0")
                self.end_headers()
            do_GET = do_POST   # seguindo o 302, o urllib repetiria o pedido como GET

            def log_message(self, *a):
                pass
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Pagina)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        self.addCleanup(srv.server_close)
        self.addCleanup(srv.shutdown)
        logs = Logs()
        a = avisos.Avisos("CHAVE", lambda endpoint, agora: "vapid t=x, k=y", logs, e.FUSO,
                          destino=lambda endpoint: "http://127.0.0.1:%d/primeiro" % srv.server_address[1])
        a.assinaturas = [{"endpoint": FCM, "desde": 1}]
        a.disparar(T0)
        self.assertEqual(vistos, [("POST", "/primeiro", "0", None)])   # vazio, sem Content-Type, e o 302 não foi seguido
        self.assertEqual(logs[-1]["falhas"], 1)


class ComVapid(unittest.TestCase):
    """O criar_avisos() do escritorio.py com o vapid.py de verdade: a chave, o cabeçalho e os motivos de desligar."""
    def setUp(self):
        self.antes = e.BASE, e.ARQ_VAPID, e.ARQ_PUSH
        pasta = tempfile.mkdtemp(prefix="avisos-vapid-")
        self.addCleanup(shutil.rmtree, pasta, ignore_errors=True)
        e.ARQ_VAPID, e.ARQ_PUSH = os.path.join(pasta, "vapid.json"), os.path.join(pasta, "push.json")
        self.logs = Logs()
        self.log_antes, e.log = e.log, self.logs

    def tearDown(self):
        e.BASE, e.ARQ_VAPID, e.ARQ_PUSH = self.antes
        e.log = self.log_antes

    def test_https_assina_com_a_base_e_o_aud_do_endpoint(self):
        e.BASE = "https://escritorio.exemplo.com"
        a = e.criar_avisos()
        st, corpo = a.chave_publica()
        publica = base64.urlsafe_b64decode(corpo["chave"] + "=")
        self.assertEqual((st, len(publica), publica[0], "=" in corpo["chave"]), (200, 65, 4, False))   # 0x04||X||Y, sem padding
        agora = time.time()
        t, k = a._autorizacao(FCM, agora).removeprefix("vapid t=").split(", k=")
        self.assertEqual(k, corpo["chave"])
        cab, carga, assinatura = t.split(".")
        dados = json.loads(base64.urlsafe_b64decode(carga + "=" * (-len(carga) % 4)))
        self.assertEqual((dados["aud"], dados["sub"], dados["exp"]), ("https://fcm.googleapis.com", e.BASE, int(agora) + 12 * 3600))
        self.assertTrue(vapid.verificar(base64.urlsafe_b64decode(k + "="), f"{cab}.{carga}".encode(),
                                        base64.urlsafe_b64decode(assinatura + "=" * (-len(assinatura) % 4))))
        self.assertEqual(e.criar_avisos().chave, corpo["chave"])   # a mesma chave na subida seguinte
        d = vapid.carregar_ou_criar(e.ARQ_VAPID)   # o d não fica em atributo, repr nem log
        for forma in (str(d), format(d, "x"), base64.urlsafe_b64encode(d.to_bytes(32, "big")).decode().rstrip("=")):
            self.assertNotIn(forma, repr(vars(a)) + repr(a) + json.dumps(self.logs))

    def test_sem_https_ou_chave_ilegivel_desliga(self):
        e.BASE = "http://127.0.0.1:7371"
        a = e.criar_avisos()
        self.assertEqual((a.desligado, os.path.exists(e.ARQ_VAPID)), ("precisa_https", False))   # nem cria a chave
        e.BASE = "https://escritorio.exemplo.com"
        with open(e.ARQ_VAPID, "w", encoding="utf-8") as f:
            f.write("{quebrado")
        self.assertIsNone(e.criar_avisos())   # o push sai: as rotas respondem 404 push_desligado
        with open(e.ARQ_VAPID, encoding="utf-8") as f:
            self.assertEqual(f.read(), "{quebrado")   # não gerou outra por cima
        self.assertEqual([x.get("motivo") for x in self.logs], ["precisa_https", "chave_invalida"])


class LeituraDoLeitor(unittest.TestCase):
    def test_pedido_novo_vai_para_a_fila(self):
        class Mcp:
            sessao, pedidos = "s", 0
            tarefas = [{"run_id": "r1", "agent": {"id": "a1"}, "status": "running"}]

            def iniciar(self, token):
                pass

            def ferramenta(self, nome, args, token):
                self.pedidos += 1
                if nome == "list_agents":
                    return {"agents": [{"id": "a1", "name": "Pixel", "handle": "pixel"}]}
                return {"tasks": self.tarefas}

        class Cred:
            def token(self):
                return "t"
        leitor = e.Leitor(Cred())
        leitor.mcp, (leitor.avisos, _, _, _) = Mcp(), novo()
        leitor.avisos.assinar(FCM, T0)
        leitor.ciclo(T0)   # a base: nada
        self.assertTrue(leitor.avisos.fila.empty())
        leitor.mcp.tarefas = [{"run_id": "r1", "agent": {"id": "a1"}, "status": "waiting_input"}]
        leitor.ciclo(T0 + 30)
        self.assertEqual(leitor.avisos.fila.get_nowait()[1], {"agente": "a1", "nome": "Pixel", "tipo": "pediu_resposta",
                                                                "quando": int(T0 + 30)})


class Rotas(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Leitor:
            def foto(self):
                return {"agentes": [], "trabalhos": [], "atualizado": None, "erro": None}
        cls.dados = tempfile.mkdtemp(prefix="avisos-rota-")
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor, cls.srv.cred, cls.srv.acesso = Leitor(), None, Acesso(cls.dados)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        with open(os.path.join(cls.dados, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")
        cls.sessao = {"Cookie": "%s=%s" % (e.nome_cookie(), cls.srv.acesso.entrar("dono", "senha-bem-grande"))}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        shutil.rmtree(cls.dados, ignore_errors=True)

    def setUp(self):
        self.antes, e.BASE = e.BASE, self.base
        self.srv.avisos, self.logs, self.envios, self.gravados = novo()
        self.js = {**self.sessao, "Origin": self.base, "Content-Type": "application/json"}

    def tearDown(self):
        e.BASE = self.antes

    def req(self, rota, cab=None, dados=None):
        corpo = dados if dados is None or isinstance(dados, bytes) else json.dumps(dados).encode()
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + rota, headers=cab or {}, data=corpo)) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as err:
            with err:
                return err.code, json.loads(err.read())

    def test_fluxo_do_contrato(self):
        self.assertEqual(self.req("/api/push/chave", self.sessao), (200, {"chave": "CHAVE"}))
        self.assertEqual(self.req("/api/avisos", self.sessao), (200, {"aviso": None}))
        assinatura = {"endpoint": FCM, "expirationTime": None, "keys": {"p256dh": "BNc", "auth": "tBH"}}
        self.assertEqual(self.req("/api/push/assinar", self.js, assinatura), (200, {"ok": True}))
        self.assertEqual(self.req("/api/push/assinar", self.js, assinatura), (200, {"ok": True}))
        self.assertEqual(len(self.srv.avisos.assinaturas), 1)
        st, corpo = self.req("/api/push/assinar", self.js, {**assinatura, "endpoint": "https://evil.example/push"})
        self.assertEqual((st, corpo["erro"]), (400, "endpoint_invalido"))
        self.assertNotIn("evil", json.dumps(corpo))
        for n in range(avisos.ASSINATURAS_MAX - 1):
            self.req("/api/push/assinar", self.js, {"endpoint": f"https://fcm.googleapis.com/fcm/send/{n}"})
        st, corpo = self.req("/api/push/assinar", self.js, {"endpoint": APPLE})
        self.assertEqual((st, corpo["erro"]), (409, "cheio"))
        self.assertEqual(self.req("/api/push/sair", self.js, {"endpoint": FCM}), (200, {"ok": True}))
        self.assertEqual(self.req("/api/push/sair", self.js, {"endpoint": "https://nunca.assinou/x"}), (200, {"ok": True}))
        self.srv.avisos.transicoes([pedido("r9", "a2", "pediu_resposta")], RESUMO, T0)
        self.assertEqual(self.req("/api/avisos", self.sessao),
                         (200, {"aviso": {"agente": "a2", "nome": "Órbita", "tipo": "pediu_resposta", "quando": int(T0)}}))
        self.assertNotIn("fcm.googleapis", json.dumps(self.logs))

    def test_barreiras(self):
        assinatura = json.dumps({"endpoint": FCM}).encode()
        for rota in ("/api/push/chave", "/api/avisos"):
            self.assertEqual(self.req(rota)[0], 401, rota)
        for rota in ("/api/push/assinar", "/api/push/sair"):
            with self.subTest(rota=rota):
                sem_sessao = {"Origin": self.base, "Content-Type": "application/json"}
                self.assertEqual(self.req(rota, sem_sessao, assinatura)[0], 401)
                self.assertEqual(self.req(rota, {**self.js, "Origin": "https://outro.exemplo"}, assinatura)[0], 403)
                self.assertEqual(self.req(rota, {**self.js, "Origin": "null"}, assinatura)[0], 403)
                sem_origin = {k: v for k, v in self.js.items() if k != "Origin"}
                self.assertEqual(self.req(rota, {**sem_origin, "Referer": self.base + "/"}, assinatura)[0], 403)
                self.assertEqual(self.req(rota, {**self.js, "Content-Type": "text/plain"}, assinatura)[0], 415)
                grande = assinatura[:-1] + b" " * avisos.CORPO_MAX + b"}"
                self.assertEqual(self.req(rota, self.js, grande)[0], 400)
                self.assertEqual(self.req(rota, self.js, b'{"endpoint": NaN}')[0], 400)
                self.assertEqual(self.req(rota, self.js, assinatura)[0], 200)   # controle
        self.assertEqual(self.gravados and len(self.srv.avisos.assinaturas), 0)   # o controle do sair tirou o do assinar

    def test_desligado_e_sem_push(self):
        self.srv.avisos = avisos.Avisos(None, None, self.logs, e.FUSO, desligado="precisa_https")
        self.assertEqual(self.req("/api/push/chave", self.sessao)[1]["erro"], "precisa_https")
        st, corpo = self.req("/api/push/assinar", self.js, {"endpoint": FCM})
        self.assertEqual((st, corpo["erro"]), (409, "precisa_https"))
        self.srv.avisos = None
        for rota, dados in (("/api/push/chave", None), ("/api/avisos", None), ("/api/push/assinar", {"endpoint": FCM})):
            st, corpo = self.req(rota, self.js if dados else self.sessao, dados)
            self.assertEqual((st, corpo["erro"]), (404, "push_desligado"), rota)


if __name__ == "__main__":
    unittest.main()
