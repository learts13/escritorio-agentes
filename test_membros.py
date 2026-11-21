# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Contas de membro pelo HTTP: a guarda de papéis (matriz de todas as rotas), o convite de ponta a ponta, a aba Membros,
o perfil e o isolamento entre andares. Servidor de verdade, leitores falsos."""
import contextlib
import io
import json
import os
import re
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

import andares
import avisos
import escritorio as e
from acesso import Acesso

RAIZ = os.path.dirname(os.path.abspath(__file__))
ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
AVATAR = {"color": "rose", "eyes": "round", "accessory": "cap"}
SENHA = "senha-da-pessoa-1"
SENHA_DONO = "senha-bem-grande"


def rotas_do_codigo():
    """Toda rota que o escritorio.py compara (rota == "/..." e rota in (...)): a matriz cresce sozinha com rota nova."""
    fonte = open(os.path.join(RAIZ, "escritorio.py"), encoding="utf-8").read()
    achadas = set(re.findall(r'"(/(?:api|oauth|convite|sair|entrar|primeiro-acesso|logo)[a-z0-9/_-]*)"', fonte))
    return sorted(achadas | set(e.ROTAS_ADMIN_VISITAS) | {"/"})


class Membros(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dados = tempfile.mkdtemp(prefix="membros-http-")
        cls.antes = e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE

        class Leitor:
            def __init__(self, agentes):
                self.agentes = agentes

            def foto(self):
                return {**e.resumir(self.agentes, []), "atualizado": None, "erro": None, "conexao": "conectado"}

            def conversas_do_dia(self):
                return {"por_id": {}, "mudou": {}}

        class Avisos:   # o push do prédio: anota o que apagou da lista de aparelhos
            def __init__(self):
                self.apagou = []

            def limpar(self, conta=None):
                self.apagou.append(("limpar", conta))

            def esquecer(self, conta):
                self.apagou.append(("esquecer", conta))

        cls.Avisos = Avisos
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor = Leitor([{"id": "a1", "name": "Pixel", "handle": "pixel"}])
        cls.srv.cred, cls.srv.acesso = None, Acesso(os.path.join(cls.dados, "contas"))
        e.TIMES, e.ARQ_PLANTA = os.path.join(cls.dados, "times.json"), os.path.join(cls.dados, "planta.json")
        e.ARQ_EQUIPE = os.path.join(cls.dados, "equipe.json")
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"conversas": "ler", "times": [{"nome": "Térreo", "agentes": ["pixel"]}]}, f)
        cls.srv.registro_andares = andares.Andares(cls.dados, e.ORG)
        reg = cls.srv.registro_andares.criar("Marketing", ORG_B)
        extra = e.Andar(reg, cls.dados)
        extra.leitor = Leitor([{"id": "b1", "name": "Bolt", "handle": "bolt"}])
        cls.extra = reg["id"]
        cls.srv.andares = {reg["id"]: extra}
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        e.BASE = cls.base
        acesso = cls.srv.acesso
        with open(os.path.join(cls.dados, "contas", "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        acesso.criar_primeiro(codigo, "dono", SENHA_DONO)   # com o arquivo fechado: no Windows o unlink falha se aberto

    def setUp(self):
        self.dono = self.cookie(self.srv.acesso.entrar("dono", SENHA_DONO))   # cada teste com a sua sessão de admin

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE = cls.antes
        shutil.rmtree(cls.dados, ignore_errors=True)

    @staticmethod
    def cookie(token):
        return {"Cookie": "esc_sessao=" + token}

    def membro(self, usuario, andares_=()):
        """Uma conta de membro nova (convite e aceite) e o cookie da sessão dela."""
        acesso = self.srv.acesso
        if usuario in acesso.usuarios:
            acesso.remover(usuario)
        token, _ = acesso.convidar(usuario.title(), list(andares_))
        return self.cookie(acesso.aceitar_convite(token, usuario, SENHA, usuario.title(), AVATAR))

    @classmethod
    def req(cls, rota, cab=None, dados=None, metodo=None):
        r = urllib.request.Request(cls.base + rota, headers=cab or {}, data=dados, method=metodo)

        class SemRedirecionar(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        try:
            with urllib.request.build_opener(SemRedirecionar).open(r) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers

    def post(self, rota, obj, cab=None, origem=True):
        h = {**(cab or {}), "Content-Type": "application/json", **({"Origin": self.base} if origem is True else {"Origin": origem})}
        st, corpo, headers = self.req(rota, h, json.dumps(obj).encode(), "POST")
        try:
            return st, json.loads(corpo), headers
        except ValueError:
            return st, corpo, headers

    def get(self, rota, cab):
        st, corpo, _ = self.req(rota, cab)
        try:
            return st, json.loads(corpo)
        except ValueError:
            return st, corpo

    @staticmethod
    def da_guarda(st, corpo):
        return st == 403 and (corpo == {"erro": "papel", "mensagem": "Só quem administra o escritório faz isso."}
                              or corpo == "Só quem administra o escritório abre esta página.".encode())

    # ------------------------------------------------------------------ a guarda
    def test_matriz_membro_so_passa_na_lista(self):
        """Toda rota do código, GET e POST, como membro: fora do MEMBRO_GET/MEMBRO_POST, a guarda responde 403 antes
        de qualquer outra conferência; dentro, nunca."""
        ana = self.membro("ana")
        publicos_get = {"/entrar", "/primeiro-acesso", "/logo", "/convite", "/api/ponte/decisoes"}   # a ponte, com Bearer
        rotas = rotas_do_codigo()
        self.assertIn("/api/membros", rotas)   # a descoberta acha as rotas novas
        with contextlib.redirect_stdout(io.StringIO()):
            for rota in rotas:
                if rota not in publicos_get:
                    with self.subTest(metodo="GET", rota=rota):
                        st, corpo = self.get(rota, ana)
                        self.assertEqual(self.da_guarda(st, corpo), rota not in e.MEMBRO_GET, (st, corpo))
                if rota not in e.POST_PUBLICOS:
                    with self.subTest(metodo="POST", rota=rota):
                        st, corpo, _ = self.post(rota, {}, ana)
                        self.assertEqual(self.da_guarda(st, corpo), rota not in e.MEMBRO_POST, (st, corpo))

    def test_admin_nunca_cai_na_guarda(self):
        with contextlib.redirect_stdout(io.StringIO()):
            for rota in rotas_do_codigo():
                with self.subTest(rota=rota):
                    self.assertFalse(self.da_guarda(*self.get(rota, self.dono)))
                    if rota != "/sair":   # o /sair encerraria a sessão do resto da matriz
                        self.assertFalse(self.da_guarda(*self.post(rota, {}, self.dono)[:2]))

    def test_papel_desconhecido_nao_pode_nada(self):
        cab = self.membro("estranha")
        self.srv.acesso.usuarios["estranha"]["andares"] = {"principal": "superadmin"}
        try:
            self.assertTrue(self.da_guarda(*self.get("/api/estado", cab)))
            self.assertTrue(self.da_guarda(*self.post("/api/perfil", {}, cab)[:2]))
        finally:
            self.srv.acesso.remover("estranha")

    def test_membro_ve_o_escritorio_sem_conversas_nem_modo_resposta(self):
        ana = self.membro("ana")
        st, estado = self.get("/api/estado", ana)
        self.assertEqual((st, estado["conversas"], estado["modo_resposta"]), (200, [], None))
        st, cfg = self.get("/api/config", ana)
        self.assertEqual((cfg["papel"], cfg["pode_responder"]), ("membro", False))
        self.assertEqual([a["id"] for a in cfg["andares"]], ["principal"])   # o elevador só mostra o que ela vê
        self.assertEqual(self.get("/api/config", self.dono)[1]["papel"], "admin")

    def test_andar_conferido_contra_a_conta(self):
        ana, bia = self.membro("ana"), self.membro("bia", [self.extra])
        rota = f"/api/estado?andar={self.extra}"
        self.assertEqual(self.get(rota, ana), (404, {"erro": "andar", "codigo": "andar", "mensagem": "Esse andar não existe."}))
        self.assertEqual(self.get("/api/estado?andar=ffffffff", ana)[0], 404)   # a mesma resposta de um andar que não existe
        st, estado = self.get(rota, bia)
        self.assertEqual((st, [a["id"] for a in estado["agentes"]]), (200, ["b1"]))
        self.assertEqual([a["id"] for a in self.get("/api/config", bia)[1]["andares"]], ["principal", self.extra])

    # ------------------------------------------------------------------ convite
    def test_convite_de_ponta_a_ponta(self):
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            st, r, _ = self.post("/api/membros", {"acao": "convidar", "nome": "Carla Dias", "andares": [self.extra],
                                                  "senha": SENHA_DONO}, self.dono)
            self.assertEqual(st, 200, r)
            self.assertTrue(r["link"].startswith(self.base + "/convite#"))
            token = r["link"].split("#", 1)[1]
            self.assertEqual(r["convite"]["andares"], ["principal", self.extra])
            self.assertEqual(self.req("/convite")[0], 200)   # a página é pública
            st, ver, _ = self.post("/convite/ver", {"convite": token})
            self.assertEqual((st, ver["nome"]), (200, "Carla Dias"))
            pedido = {"convite": token, "usuario": "carla", "senha": SENHA, "nome": "Carla", "avatar": AVATAR}
            self.assertEqual(self.post("/convite/aceitar", pedido, origem="https://outro.exemplo")[0], 403)
            st, ok, h = self.post("/convite/aceitar", pedido)
            self.assertEqual((st, ok), (200, {"ok": True}))
            carla = {"Cookie": h["Set-Cookie"].split(";")[0]}
            self.assertEqual(self.get("/api/perfil", carla)[1],
                             {"usuario": "carla", "nome": "Carla", "avatar": AVATAR, "papel": "membro", "aparencia": AVATAR,
                              "avisos": {"modo": "sempre"}})
            self.assertEqual(self.get(f"/api/estado?andar={self.extra}", carla)[0], 200)
            # uso único: o mesmo link não cria outra conta e responde como um convite qualquer que não vale
            st, r2, _ = self.post("/convite/aceitar", {**pedido, "usuario": "carla2"})
            self.assertEqual((st, r2["erro"]), (404, "convite"))
            self.assertEqual(self.post("/convite/ver", {"convite": token})[0], 404)
        self.assertNotIn(token, saida.getvalue())   # o token nunca vai ao log
        self.assertNotIn(SENHA, saida.getvalue())
        self.srv.acesso.remover("carla")

    def test_convite_recusa_pedido_estranho(self):
        token, _ = self.srv.acesso.convidar("Davi", [])
        for corpo in ({"convite": token, "extra": 1}, {"convite": 5}, [token]):
            with self.subTest(corpo=str(corpo)[:30]):
                self.assertEqual(self.post("/convite/ver", corpo)[0], 400)
        st, r, _ = self.post("/convite/aceitar", {"convite": token, "usuario": "dono", "senha": SENHA, "nome": "Davi",
                                                  "avatar": AVATAR})
        self.assertEqual((st, r["erro"]), (409, "usuario_existe"))
        st, r, _ = self.post("/convite/aceitar", {"convite": token, "usuario": "davi", "senha": "curta", "nome": "Davi",
                                                  "avatar": AVATAR})
        self.assertEqual(st, 400)
        self.assertEqual(self.post("/convite/ver", {"convite": token})[0], 200)   # os erros não gastaram o convite

    # ------------------------------------------------------------------ aba Membros
    def test_aba_membros_papel_andares_e_remover(self):
        ana = self.membro("ana")
        with contextlib.redirect_stdout(io.StringIO()):
            st, lista = self.get("/api/membros", self.dono)
            self.assertEqual(st, 200)
            self.assertNotIn("hash", json.dumps(lista))
            st, r, _ = self.post("/api/membros", {"acao": "andares", "usuario": "ana", "andares": [self.extra],
                                                  "senha": SENHA_DONO}, self.dono)
            self.assertEqual({c["usuario"]: c["andares"] for c in r["contas"]}["ana"], ["principal", self.extra])
            self.assertEqual(self.get(f"/api/estado?andar={self.extra}", ana)[0], 200)   # vale no pedido seguinte
            self.assertEqual(self.post("/api/membros", {"acao": "andares", "usuario": "ana", "andares": ["ffffffff"],
                                                        "senha": SENHA_DONO}, self.dono)[0], 400)   # andar que não existe
            # promovida, ela passa pela guarda; rebaixar o último admin não dá
            st, _, _ = self.post("/api/membros", {"acao": "papel", "usuario": "ana", "papel": "admin", "senha": SENHA_DONO},
                                 self.dono)
            self.assertEqual(st, 200)
            self.assertEqual(self.get("/api/membros", ana)[0], 200)
            st, _, _ = self.post("/api/membros", {"acao": "papel", "usuario": "ana", "papel": "membro", "senha": SENHA_DONO},
                                 self.dono)
            self.assertEqual(st, 200)
            st, r, _ = self.post("/api/membros", {"acao": "papel", "usuario": "dono", "papel": "membro", "senha": SENHA_DONO},
                                 self.dono)
            self.assertEqual((st, r["erro"]), (409, "ultimo_admin"))
            # remover pede a senha e derruba a sessão dela na hora
            st, r, _ = self.post("/api/membros", {"acao": "remover", "usuario": "ana", "senha": "errada-errada"}, self.dono)
            self.assertEqual((st, r["erro"]), (403, "senha_incorreta"))
            self.assertEqual(self.post("/api/membros", {"acao": "remover", "usuario": "ana", "senha": SENHA_DONO},
                                       self.dono)[0], 200)
            self.assertEqual(self.get("/api/estado", ana)[0], 401)

    def test_convidar_exige_senha_e_revogar_tira_da_lista(self):
        with contextlib.redirect_stdout(io.StringIO()):
            st, r, _ = self.post("/api/membros", {"acao": "convidar", "nome": "Eva", "andares": [], "senha": "errada-x"},
                                 self.dono)
            self.assertEqual(st, 403)
            st, r, _ = self.post("/api/membros", {"acao": "convidar", "nome": "Eva", "andares": [], "senha": SENHA_DONO},
                                 self.dono)
            id_ = r["convite"]["id"]
            st, r, _ = self.post("/api/membros", {"acao": "revogar", "id": id_}, self.dono)
            self.assertNotIn(id_, [c["id"] for c in r["convites"]])
            self.assertEqual(self.post("/api/membros", {"acao": "revogar", "id": id_}, self.dono)[0], 404)

    def test_papel_e_andares_exigem_a_senha(self):
        """Mudar papel ou andares de uma conta pede a senha de quem administra, como convidar e remover."""
        self.membro("ana")
        pedidos = {"papel": {"acao": "papel", "usuario": "ana", "papel": "admin"},
                   "andares": {"acao": "andares", "usuario": "ana", "andares": [self.extra]}}
        with contextlib.redirect_stdout(io.StringIO()):
            for acao, pedido in pedidos.items():
                st, r, _ = self.post("/api/membros", pedido, self.dono)
                self.assertEqual((st, r["erro"]), (400, "pedido"), acao)   # sem senha
                st, r, _ = self.post("/api/membros", {**pedido, "senha": "errada-errada"}, self.dono)
                self.assertEqual((st, r["erro"]), (403, "senha_incorreta"), acao)
        ana = next(c for c in self.srv.acesso.contas() if c["usuario"] == "ana")
        self.assertEqual((ana["papel"], ana["andares"]), ("membro", ["principal"]))   # nada mudou sem a senha certa

    def test_remover_pelo_nome_sem_normalizar_tira_do_mapa(self):
        ana, bia = self.membro("ana"), self.membro("bia")
        pos = {"x": 40, "y": 80, "destino": None, "sala": "lounge", "olha": "dir"}
        self.assertEqual(self.post("/api/presenca", pos, ana)[0], 200)
        self.assertIn("ana", [p["usuario"] for p in self.get("/api/ao-vivo", bia)[1]["pessoas"]])
        with contextlib.redirect_stdout(io.StringIO()):
            st, _, _ = self.post("/api/membros", {"acao": "remover", "usuario": " ANA ", "senha": SENHA_DONO}, self.dono)
        self.assertEqual(st, 200)
        self.assertNotIn("ana", [p["usuario"] for p in self.get("/api/ao-vivo", bia)[1]["pessoas"]])

    # ------------------------------------------------------------------ presença e chat da sala
    def test_presenca_e_chat_por_sala_e_andar(self):
        ana, bia, caio = self.membro("ana"), self.membro("bia", [self.extra]), self.membro("caio")
        pos = lambda sala, x=40: {"x": x, "y": 80, "destino": [x + 10, 90], "sala": sala, "olha": "dir"}
        self.assertEqual(self.post("/api/presenca", pos("lounge"), ana)[0], 200)
        self.assertEqual(self.post("/api/presenca", pos("lounge", 60), bia)[0], 200)
        self.assertEqual(self.post("/api/presenca", pos("time:Térreo"), caio)[0], 200)
        self.assertEqual(self.post("/api/presenca", pos("cofre"), ana)[0], 400)   # sala que o andar não tem
        self.assertEqual(self.post("/api/presenca", {**pos("lounge"), "nome": "Admin"}, ana)[0], 400)   # nome sai da conta
        st, vivo = self.get("/api/ao-vivo", bia)
        self.assertEqual(st, 200)
        quem = {p["usuario"]: p for p in vivo["pessoas"]}
        self.assertEqual(set(quem), {"ana", "caio"})
        self.assertEqual((quem["ana"]["nome"], quem["ana"]["aparencia"], quem["ana"]["destino"]), ("Ana", AVATAR, [50, 90]))
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            self.assertEqual(self.post("/api/sala/enviar", {"texto": "Café às 15h?"}, ana)[0], 200)
        self.assertEqual(saida.getvalue(), "")   # nada do chat no log
        self.assertEqual([m["texto"] for m in self.get("/api/ao-vivo", bia)[1]["mensagens"]], ["Café às 15h?"])
        self.assertEqual(self.get("/api/ao-vivo", caio)[1]["mensagens"], [])   # outra sala
        # outro andar: só quem tem acesso, e ninguém do principal aparece lá
        self.assertEqual(self.post(f"/api/presenca?andar={self.extra}", pos("lounge"), ana)[0], 404)
        self.assertEqual(self.post(f"/api/presenca?andar={self.extra}", pos("lounge"), bia)[0], 200)
        self.assertEqual(self.get(f"/api/ao-vivo?andar={self.extra}", bia)[1]["pessoas"], [])
        # sair tira do mapa dos outros na hora
        with contextlib.redirect_stdout(io.StringIO()):
            self.req("/sair", {**ana, "Origin": self.base}, b"", "POST")
        self.assertNotIn("ana", [p["usuario"] for p in self.get("/api/ao-vivo", bia)[1]["pessoas"]])

    # ------------------------------------------------------------------ perfil e sair de todos
    def test_perfil_proprio(self):
        ana = self.membro("ana")
        st, r, _ = self.post("/api/perfil", {"nome": "Ana Luz", "avatar": {"color": "sky", "eyes": "dots", "accessory": ""}}, ana)
        self.assertEqual((st, r["nome"], r["avatar"]["color"]), (200, "Ana Luz", "sky"))
        self.assertEqual(self.post("/api/perfil", {"nome": "Ana", "avatar": {"color": "ouro"}}, ana)[0], 400)
        self.assertEqual(self.post("/api/perfil", {"nome": "Ana", "avatar": AVATAR}, ana, origem="https://outro.exemplo")[0], 403)
        self.assertEqual(self.get("/api/perfil", self.dono)[1]["usuario"], "dono")   # cada um só o seu
        self.assertEqual(r["aparencia"], r["avatar"], "com boneco salvo, o efetivo é o salvo")

    def test_nao_perturbe_por_conta(self):
        ana = self.membro("ana")
        self.assertEqual(self.get("/api/perfil", ana)[1]["avisos"], {"modo": "sempre"})   # sem preferência: como hoje
        st, r, _ = self.post("/api/perfil", {"avisos": {"modo": "silencio", "de": "22:00", "ate": "7:00"}}, ana)
        self.assertEqual((st, r["avisos"]), (200, {"modo": "silencio", "de": "22:00", "ate": "07:00"}))
        self.assertEqual(r["nome"], self.get("/api/perfil", ana)[1]["nome"])   # o resto do perfil fica como estava
        self.assertEqual(self.srv.acesso.avisos_de("ana"), {"modo": "silencio", "de": "22:00", "ate": "07:00"})
        self.assertEqual(self.get("/api/perfil", self.dono)[1]["avisos"], {"modo": "sempre"})   # é de cada conta
        for ruim in ({"avisos": {"modo": "nunca"}}, {"avisos": {"modo": "silencio", "de": "22:00", "ate": "22:00"}},
                     {"avisos": {"modo": "sempre"}, "nome": "Ana"}, {"avisos": "sempre"}):
            self.assertEqual(self.post("/api/perfil", ruim, ana)[0], 400, ruim)
        self.assertEqual(self.post("/api/perfil", {"avisos": {"modo": "sempre"}}, ana, origem="https://outro.exemplo")[0], 403)
        self.assertEqual(self.post("/api/perfil", {"avisos": {"modo": "expediente"}}, ana)[1]["avisos"], {"modo": "expediente"})
        self.post("/api/perfil", {"avisos": {"modo": "sempre"}}, ana)
        self.assertIsNone(self.srv.acesso.avisos_de("ana"))   # avisar sempre é o padrão: não fica nada gravado

    def test_perfil_sem_boneco_da_o_padrao_do_servidor(self):
        # quem não salvou boneco se vê com o mesmo padrão que os outros veem na presença (aparencia_da_conta)
        p = self.get("/api/perfil", self.dono)[1]
        self.assertIsNone(p["avatar"])
        self.assertEqual(p["aparencia"], e.aparencia_da_conta("dono", p))
        self.assertEqual(set(p["aparencia"]), {"color", "eyes", "accessory"})

    def test_sair_de_todos_do_membro_so_derruba_as_dele(self):
        ana = self.membro("ana")
        self.srv.avisos = self.Avisos()
        self.addCleanup(delattr, self.srv, "avisos")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.post("/api/sair-todos", {"senha": SENHA}, ana)[0], 200)
        self.assertEqual(self.get("/api/estado", ana)[0], 401)
        self.assertEqual(self.get("/api/estado", self.dono)[0], 200)
        self.assertEqual(self.srv.avisos.apagou, [("limpar", "ana")])   # só os aparelhos que a Ana assinou

    def test_remover_conta_apaga_os_aparelhos_dela(self):
        self.membro("ana")
        self.srv.avisos = self.Avisos()
        self.addCleanup(delattr, self.srv, "avisos")
        with contextlib.redirect_stdout(io.StringIO()):
            st, _, _ = self.post("/api/membros", {"acao": "remover", "usuario": " ANA ", "senha": SENHA_DONO}, self.dono)
        self.assertEqual(st, 200)
        self.assertEqual(self.srv.avisos.apagou, [("esquecer", "ana")])   # pelo nome normalizado da conta


class EmpresasNoSaguao(unittest.TestCase):
    """1.6, modo saguão (andares.json v2): a Dev Maniac's (A) e a empresa B em andares próprios, o térreo vira o saguão.
    Os 4 perfis (admin do prédio, admin da empresa, membro e pessoa do prédio) contra todas as rotas, no andar próprio,
    no alheio e no saguão, e a empresa B sem nada de A."""
    A, B = "aaaaaaaa", "bbbbbbbb"
    PNG = b"\x89PNG\r\n\x1a\n" + b"logo-de-b"

    @classmethod
    def setUpClass(cls):
        cls.dados = tempfile.mkdtemp(prefix="saguao-http-")
        cls.antes = e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE, e.ARQ_MARCA, e.ARQ_LOGO, e.ORG
        e.ORG = ORG_A   # a org da Dev Maniac's, que subiu do térreo para o andar A
        junta = lambda nome: os.path.join(cls.dados, nome)
        e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE, e.ARQ_MARCA, e.ARQ_LOGO = (junta("times.json"), junta("planta.json"),
                                                                        junta("equipe.json"), junta("marca.json"),
                                                                        junta("logo.img"))
        with open(e.TIMES, "w", encoding="utf-8") as f:   # a cópia que ficou na raiz: não pode aparecer no saguão
            json.dump({"conversas": "ler", "times": [{"nome": "Time secreto de A", "agentes": ["pixel"]}]}, f)
        with open(e.ARQ_MARCA, "w", encoding="utf-8") as f:
            json.dump({"empresa": "Prédio Central", "cor": "#123456"}, f)
        with open(junta(andares.ARQ), "w", encoding="utf-8") as f:
            json.dump({"v": 2, "terreo": "saguao", "andares": [{"id": cls.A, "nome": "Dev Maniacs", "org": ORG_A},
                                                                {"id": cls.B, "nome": "Empresa B", "org": ORG_B}]}, f)

        class Leitor:
            def __init__(self, agentes):
                self.agentes = agentes

            def foto(self):
                return {**e.resumir(self.agentes, []), "atualizado": None, "erro": None, "conexao": "conectado"}

            def conversas_do_dia(self):
                return {"por_id": {}, "mudou": {}}

        class Cred:   # sem rede: o Conectar só devolve um endereço
            def url_autorizacao(self, usuario=None):
                return "https://agentes.exemplo/autorizar"

            def tem_escrita(self):
                return False

            def tem_estado(self, estado):
                return False

            def confere_dono(self, estado, usuario, autorizado=True):   # o state é de quem começou (E.2)
                return False

        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor = cls.srv.cred = None   # o saguão não tem conexão
        cls.srv.acesso = Acesso(os.path.join(cls.dados, "contas"))
        cls.srv.registro_andares = andares.Andares(cls.dados, e.ORG)
        cls.srv.andares = {}
        for reg, agente in zip(cls.srv.registro_andares.lista, ({"id": "a1", "name": "Pixel", "handle": "pixel"},
                                                                 {"id": "b1", "name": "Bolt", "handle": "bolt"})):
            andar = e.Andar(reg, cls.dados)
            andar.leitor, andar.cred, andar.conversas, andar.respostas = Leitor([agente]), Cred(), None, None
            cls.srv.andares[reg["id"]] = andar
        cls.srv.avisos = avisos.Avisos("CHAVE", lambda endpoint, agora: "vapid", lambda **k: None, e.FUSO,
                                       pode=lambda conta, andar: e.recebe_avisos(cls.srv, conta, andar))
        cls.srv.id_pessoa = e.IdPessoa(os.path.join(cls.dados, "pessoa.chave"))
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        e.BASE = cls.base
        acesso = cls.srv.acesso
        with open(os.path.join(cls.dados, "contas", "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        acesso.criar_primeiro(codigo, "dono", SENHA_DONO)
        acesso.definir_andares("dono", [cls.A], principal=False)   # o que a migração faz: admin do prédio e de A
        acesso.mudar_papel("dono", "admin", cls.A)
        cls.cab = {}
        for usuario, nome, andar, papel in (("adminb", "Beto", cls.B, "admin"), ("membrob", "Bia", cls.B, "membro"),
                                            ("membroa", "Ana", cls.A, "membro")):
            token, _ = acesso.convidar(nome, [andar], principal=False)
            cls.cab[usuario] = Membros.cookie(acesso.aceitar_convite(token, usuario, SENHA, nome, AVATAR))
            if papel == "admin":
                acesso.mudar_papel(usuario, "admin", andar)
        cls.cab["dono"] = Membros.cookie(acesso.entrar("dono", SENHA_DONO))

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE, e.ARQ_MARCA, e.ARQ_LOGO, e.ORG = cls.antes
        shutil.rmtree(cls.dados, ignore_errors=True)

    req = classmethod(Membros.req.__func__)
    get = Membros.get

    def post(self, rota, obj, cab, bruto=None):
        h = {**cab, "Content-Type": "application/json", "Origin": self.base}
        st, corpo, _ = self.req(rota, h, bruto if bruto is not None else json.dumps(obj).encode(), "POST")
        try:
            return st, json.loads(corpo)
        except ValueError:
            return st, corpo

    @staticmethod
    def resultado(st, corpo):
        if Membros.da_guarda(st, corpo):
            return "guarda"
        if st == 404 and isinstance(corpo, dict) and corpo.get("codigo") == "andar":
            return "andar"
        return "passa"

    # ------------------------------------------------------------------ a matriz
    def test_listas_da_guarda(self):
        """O admin da empresa nunca alcança o que é do prédio, e o saguão é um pedaço do que o membro já via."""
        do_predio = {"/api/andares", "/api/clima", "/api/festas", *e.ROTAS_ADMIN_VISITAS}
        self.assertFalse(do_predio & (e.ADMIN_EMPRESA_GET | e.ADMIN_EMPRESA_POST))
        # a busca de cidade (com o limite global) também serve à cidade do andar, que é do admin da empresa
        self.assertIn("/api/clima/busca", e.ADMIN_EMPRESA_GET)
        self.assertIn("/api/clima/andar", e.ADMIN_EMPRESA_POST)
        self.assertTrue(e.SAGUAO_GET <= e.MEMBRO_GET and e.SAGUAO_POST <= e.MEMBRO_POST)
        self.assertTrue(e.MEMBRO_GET <= e.ADMIN_EMPRESA_GET and e.MEMBRO_POST <= e.ADMIN_EMPRESA_POST)
        self.assertNotIn("/api/conversa", e.SAGUAO_GET)

    def test_matriz_quatro_perfis_por_andar(self):
        """Toda rota do código, GET e POST: no andar próprio vale a lista do papel; no alheio, a rota de andar dá o 404
        de andar que não existe; no saguão, só a lista da pessoa do prédio. O admin do prédio nunca cai na guarda."""
        listas = {"adminb": (e.ADMIN_EMPRESA_GET, e.ADMIN_EMPRESA_POST), "membrob": (e.MEMBRO_GET, e.MEMBRO_POST)}
        publicos = {"/entrar", "/primeiro-acesso", "/logo", "/convite", "/api/ponte/decisoes"}
        with contextlib.redirect_stdout(io.StringIO()):
            for quem in ("dono", "adminb", "membrob"):
                for onde, q in (("proprio", f"?andar={self.B}"), ("alheio", f"?andar={self.A}"), ("saguao", "")):
                    for metodo in ("GET", "POST"):
                        for rota in rotas_do_codigo():
                            if rota in publicos or rota == "/sair" or (metodo == "POST" and rota in e.POST_PUBLICOS):
                                continue
                            with self.subTest(quem=quem, onde=onde, metodo=metodo, rota=rota):
                                if metodo == "GET":
                                    r = self.resultado(*self.get(rota + q, self.cab[quem]))
                                else:
                                    r = self.resultado(*self.post(rota + q, {}, self.cab[quem]))
                                if quem == "dono":
                                    self.assertNotEqual(r, "guarda")
                                    continue
                                lista = listas[quem][metodo == "POST"]
                                comuns = e.PREDIO_GET if metodo == "GET" else e.PREDIO_POST
                                saguao = e.SAGUAO_GET if metodo == "GET" else e.SAGUAO_POST
                                if rota in comuns:
                                    esperado = "passa"
                                elif rota == "/oauth/retorno" and metodo == "GET":   # quem decide é o state (E.2 item 3)
                                    esperado = "passa" if quem == "adminb" else "guarda"
                                elif onde == "saguao" and metodo == "GET" and rota in e.SAGUAO_NAO_TEM:
                                    esperado = "andar"   # o saguão não tem vida social, jornal, conversas nem conexão
                                elif onde == "saguao":
                                    esperado = "passa" if rota in saguao else "guarda"
                                elif onde == "alheio":
                                    de_andar = e.ADMIN_EMPRESA_GET if metodo == "GET" else e.ADMIN_EMPRESA_POST
                                    esperado = "andar" if rota in de_andar else "guarda"
                                else:
                                    esperado = "passa" if rota in lista else "guarda"
                                self.assertEqual(r, esperado)

    # ------------------------------------------------------------------ B sem nada de A
    def test_empresa_b_nao_ve_nada_de_a(self):
        b = self.cab["membrob"]
        st, estado = self.get("/api/estado", b)   # o saguão
        self.assertEqual((st, estado["agentes"], estado["trabalhos"], estado["tarefas"], estado["conversas"]),
                         (200, [], [], [], []))
        self.assertNotIn("visitantes", estado)
        self.assertNotIn("social", estado)
        st, cfg = self.get("/api/config", b)
        self.assertEqual((cfg["terreo"], cfg["andar"], cfg["papel"], cfg["admin_predio"]), ("saguao", "principal", "pessoa", False))
        self.assertEqual((cfg["times"], cfg["aparencia"]), ([], {}))
        self.assertNotIn("Time secreto", json.dumps(cfg))
        self.assertEqual(cfg["andares"], [{"id": "principal", "nome": "Saguão", "conexao": None, "cidade": None},
                                          {"id": self.B, "nome": "Empresa B", "conexao": "conectado", "cidade": None}])
        for rota in ("/api/estado", "/api/config", "/api/jornal", "/api/ao-vivo", "/api/membros", "/logo"):
            with self.subTest(rota=rota):
                self.assertEqual(self.get(f"{rota}?andar={self.A}", b)[0], 404)
        self.assertEqual([a["id"] for a in self.get(f"/api/estado?andar={self.B}", b)[1]["agentes"]], ["b1"])
        self.assertNotIn("visitantes", self.get(f"/api/estado?andar={self.B}", b)[1])

    def test_avisos_e_push_de_a_nao_chegam_em_b(self):
        self.srv.avisos.zerar()
        self.srv.avisos.do_andar(self.A).transicoes([("pediu_aprovacao", "a1", "r-a")], {"agentes": [{"id": "a1", "nome": "Pixel"}]}, 1000)
        self.assertEqual(self.get("/api/avisos", self.cab["membrob"]), (200, {"aviso": None}))
        self.assertEqual(self.get("/api/avisos", self.cab["adminb"]), (200, {"aviso": None}))
        self.assertEqual(self.get("/api/avisos", self.cab["membroa"])[1]["aviso"]["agente"], "a1")
        self.assertTrue(e.recebe_avisos(self.srv, "membroa", self.A))
        for conta, andar in (("membrob", self.A), ("adminb", self.A), (None, self.A), ("membroa", self.B), ("dono", self.B),
                             ("membrob", "principal"), ("ninguem", self.B)):
            self.assertFalse(e.recebe_avisos(self.srv, conta, andar), (conta, andar))

    def test_marca_e_logo_por_andar(self):
        adm, cfg_b = self.cab["adminb"], lambda: self.get(f"/api/config?andar={self.B}", self.cab["membrob"])[1]
        self.assertEqual((cfg_b()["empresa"], cfg_b()["marca_exemplo"]), ("Empresa B", False))   # sem marca: o nome do andar
        self.assertNotEqual(cfg_b()["cor"], "#123456")   # nunca a do prédio
        v_antes = self.get(f"/api/estado?andar={self.B}", adm)[1]["config_v"]
        st, cfg = self.post(f"/api/marca?andar={self.B}", {"empresa": "Bolt S.A.", "cor": "#00ff00", "serio": True}, adm)
        self.assertEqual((st, cfg["empresa"], cfg["serio"]), (200, "Bolt S.A.", True))
        self.assertNotEqual(self.get(f"/api/estado?andar={self.B}", adm)[1]["config_v"], v_antes)
        self.assertEqual(self.get("/api/config", adm)[1]["empresa"], "Prédio Central")   # o saguão segue com a do prédio
        self.assertEqual(self.get(f"/api/config?andar={self.A}", self.cab["dono"])[1]["empresa"], "Dev Maniacs")
        self.assertEqual(self.post(f"/api/marca?andar={self.A}", {"empresa": "X", "cor": "#000000"}, adm)[0], 404)
        self.assertTrue(Membros.da_guarda(*self.post("/api/marca", {"empresa": "X", "cor": "#000000"}, adm)))
        st, cfg = self.post(f"/api/logo?andar={self.B}", None, adm, bruto=self.PNG)
        self.assertEqual(st, 200)
        self.assertTrue(cfg["logo"].startswith(f"/logo?andar={self.B}&v="))
        st, corpo, _ = self.req(cfg["logo"], self.cab["membrob"])
        self.assertEqual((st, corpo), (200, self.PNG))
        self.assertEqual(self.req(cfg["logo"], self.cab["membroa"])[0], 404)   # outra empresa: como se não existisse
        self.assertEqual(self.req(cfg["logo"])[0], 404)   # sem sessão
        self.assertNotEqual(self.req("/logo")[1], self.PNG)   # o da tela de entrar é o do prédio
        self.assertEqual(self.post(f"/api/logo/remover?andar={self.B}", {}, adm)[0], 200)
        self.post(f"/api/marca?andar={self.B}", {"empresa": "Empresa B", "cor": "#00ff00", "serio": False}, adm)

    # ------------------------------------------------------------------ membros e convites do andar
    def test_admin_da_empresa_administra_so_o_andar_dele(self):
        adm = self.cab["adminb"]
        st, lista = self.get(f"/api/membros?andar={self.B}", adm)
        self.assertEqual(st, 200)
        self.assertEqual({c["usuario"]: c["papel"] for c in lista["contas"]}, {"adminb": "admin", "membrob": "membro"})
        self.assertNotIn("andares", json.dumps(lista["contas"]))
        self.assertEqual(self.get(f"/api/membros?andar={self.A}", adm)[0], 404)
        self.assertTrue(Membros.da_guarda(*self.get("/api/membros", adm)))   # a lista do prédio, não
        with contextlib.redirect_stdout(io.StringIO()):
            st, r = self.post(f"/api/membros?andar={self.B}", {"acao": "convidar", "nome": "Gil", "senha": SENHA}, adm)
            self.assertEqual((st, r["convite"]["andares"]), (200, [self.B]))
            token = r["link"].split("#", 1)[1]
            self.assertEqual(self.post(f"/api/membros?andar={self.B}", {"acao": "convidar", "nome": "Gil",
                                                                         "andares": [self.A], "senha": SENHA}, adm)[0], 400)
            st, ok, h = self.req("/convite/aceitar", {"Origin": self.base, "Content-Type": "application/json"}, json.dumps(
                {"convite": token, "usuario": "gil", "senha": SENHA, "nome": "Gil", "avatar": AVATAR}).encode(), "POST")
            gil = {"Cookie": h["Set-Cookie"].split(";")[0]}
            self.assertEqual(self.srv.acesso.andares_da_conta("gil"), [self.B])
            self.assertEqual([a["id"] for a in self.get("/api/config", gil)[1]["andares"]], ["principal", self.B])
            # papel em B; conta sem papel em B responde como conta que não existe
            st, r = self.post(f"/api/membros?andar={self.B}", {"acao": "papel", "usuario": "gil", "papel": "admin",
                                                                "senha": SENHA}, adm)
            self.assertEqual((st, {c["usuario"]: c["papel"] for c in r["contas"]}["gil"]), (200, "admin"))
            for usuario in ("membroa", "dono", "nao-existe"):
                st, r = self.post(f"/api/membros?andar={self.B}", {"acao": "papel", "usuario": usuario, "papel": "admin",
                                                                    "senha": SENHA}, adm)
                self.assertEqual((st, r["erro"]), (404, "nao_existe"), usuario)
            self.assertIsNone(self.srv.acesso.papel("membroa", self.B))
            # remover tira só o andar B; a senha errada não tira nada
            st, r = self.post(f"/api/membros?andar={self.B}", {"acao": "remover", "usuario": "gil", "senha": "errada-x"}, adm)
            self.assertEqual((st, r["erro"]), (403, "senha_incorreta"))
            st, r = self.post(f"/api/membros?andar={self.B}", {"acao": "remover", "usuario": "gil", "senha": SENHA}, adm)
            self.assertEqual((st, "gil" in {c["usuario"] for c in r["contas"]}), (200, False))
            self.assertIn("gil", self.srv.acesso.usuarios)
            self.assertEqual(self.get("/api/estado", gil)[0], 401)   # sem andar nenhum, a sessão caiu
            # o último admin de B não sai nem desce
            st, r = self.post(f"/api/membros?andar={self.B}", {"acao": "papel", "usuario": "adminb", "papel": "membro",
                                                                "senha": SENHA}, adm)
            self.assertEqual((st, r["erro"]), (409, "ultimo_admin"))
            # convites: só os de B, e o de outro andar não se revoga daqui
            _, de_a = self.srv.acesso.convidar("Hugo", [self.A], principal=False)
            st, lista = self.get(f"/api/membros?andar={self.B}", adm)
            self.assertNotIn(de_a["id"], [c["id"] for c in lista["convites"]])
            st, r = self.post(f"/api/membros?andar={self.B}", {"acao": "revogar", "id": de_a["id"]}, adm)
            self.assertEqual((st, r["erro"]), (404, "nao_existe"))
            self.srv.acesso.remover("gil")

    def test_admin_do_predio_no_saguao_convida_sem_o_principal(self):
        dono = self.cab["dono"]
        with contextlib.redirect_stdout(io.StringIO()):
            st, r = self.post("/api/membros", {"acao": "convidar", "nome": "Iara", "andares": [self.B], "senha": SENHA_DONO},
                              dono)
            self.assertEqual((st, r["convite"]["andares"]), (200, [self.B]))
            st, r = self.post("/api/membros", {"acao": "convidar", "nome": "Ivo", "andares": [], "senha": SENHA_DONO}, dono)
            self.assertEqual(st, 400)   # no saguão, pelo menos um andar
            st, r = self.post("/api/membros", {"acao": "andares", "usuario": "adminb", "andares": [self.A, self.B],
                                               "senha": SENHA_DONO}, dono)
            self.assertEqual(st, 200)
            self.assertEqual((self.srv.acesso.papel("adminb", self.B), self.srv.acesso.papel("adminb", self.A),
                              self.srv.acesso.papel("adminb")), ("admin", "membro", None))   # o admin de B não desce
            self.post("/api/membros", {"acao": "andares", "usuario": "adminb", "andares": [self.B], "senha": SENHA_DONO}, dono)
            self.post("/api/membros", {"acao": "revogar", "id": r.get("convite", {}).get("id", "x")}, dono)

    # ------------------------------------------------------------------ o saguão
    def test_saguao_nao_tem_agentes_nem_conexao(self):
        dono = self.cab["dono"]
        st, cfg = self.get("/api/config", dono)
        self.assertEqual((cfg["papel"], cfg["admin_predio"], cfg["pode_responder"]), ("admin", True, False))
        self.assertEqual([a["id"] for a in cfg["andares"]], ["principal", self.A, self.B])
        for rota in ("/api/social?agente=a1", "/api/social/placar", "/api/jornal", "/api/conversa?id=x", "/oauth/conectar"):
            with self.subTest(rota=rota):
                st, _ = self.get(rota, dono)
                self.assertEqual(st, 404)
        st, _, h = self.req(f"/oauth/conectar?andar={self.B}", self.cab["adminb"])
        self.assertEqual((st, h["Location"]), (302, "https://agentes.exemplo/autorizar"))
        self.assertEqual(self.req(f"/oauth/conectar?andar={self.B}", self.cab["membrob"])[0], 403)
        self.assertEqual(self.req(f"/oauth/conectar?andar={self.A}", self.cab["adminb"])[0], 404)
        st, _, _ = self.req("/oauth/retorno?code=c&state=desconhecido", dono)
        self.assertEqual(st, 400)   # no saguão, state desconhecido não cai no principal

    def test_presenca_no_saguao_so_nas_salas_fixas(self):
        pos = lambda sala: {"x": 40, "y": 80, "destino": None, "sala": sala, "olha": "dir"}
        self.assertEqual(self.post("/api/presenca", pos("recepcao"), self.cab["membrob"])[0], 200)
        self.assertEqual(self.post("/api/presenca", pos("time:Time secreto de A"), self.cab["membrob"])[0], 400)
        ao_vivo = self.get("/api/ao-vivo", self.cab["membroa"])[1]
        self.assertEqual([p["nome"] for p in ao_vivo["pessoas"]], ["Bia"])

    def test_presenca_no_saguao_sem_login(self):
        """M2: no saguão, o "usuario" das pessoas e das mensagens e o "eu" são um id opaco estável por pessoa
        ("p_" e 16 hex, o HMAC do login com o segredo de dados/); fora do saguão, o login, como sempre."""
        pos = {"x": 40, "y": 80, "destino": None, "sala": "recepcao", "olha": "dir"}
        for quem in ("membroa", "membrob"):
            self.assertEqual(self.post("/api/presenca", pos, self.cab[quem])[0], 200)
        self.assertEqual(self.post("/api/sala/enviar", {"texto": "oi"}, self.cab["membrob"])[0], 200)
        de_a, de_b = (self.get("/api/ao-vivo", self.cab[q])[1] for q in ("membroa", "membrob"))
        self.assertRegex(de_a["eu"], r"^p_[0-9a-f]{16}$")
        self.assertEqual(de_a["eu"], self.get("/api/ao-vivo", self.cab["membroa"])[1]["eu"])   # estável
        self.assertNotEqual(de_a["eu"], de_b["eu"])
        self.assertIn(de_b["eu"], [p["usuario"] for p in de_a["pessoas"]])
        self.assertEqual([m["usuario"] for m in de_a["mensagens"]], [de_b["eu"]])
        self.assertEqual([m["usuario"] for m in de_b["mensagens"]], [de_b["eu"]])   # a própria mensagem: o mesmo "eu"
        self.assertNotIn("membro", json.dumps([de_a, de_b]).lower())   # nenhum login sai
        self.assertEqual(self.srv.id_pessoa("membrob"), de_b["eu"])
        with open(os.path.join(self.dados, "pessoa.chave"), "rb") as f:   # o segredo em dados/, nunca na resposta
            self.assertEqual(len(f.read()), 32)
        # fora do saguão (o andar da empresa), nada muda: o login
        q = f"?andar={self.B}"
        self.assertEqual(self.post("/api/presenca" + q, pos, self.cab["membrob"])[0], 200)
        self.assertEqual(self.get("/api/ao-vivo" + q, self.cab["membrob"])[1]["eu"], "membrob")

    def test_saguao_sem_nome_proprio_nao_mostra_o_login(self):
        """M2: no saguão, a conta sem nome de exibição (o admin do prédio nasce assim, com o nome igual ao login)
        aparece como "Pessoa" nas pessoas e nas mensagens, e as pessoas saem na ordem do id opaco; fora do saguão, o
        nome de sempre."""
        pos = {"x": 40, "y": 80, "destino": None, "sala": "recepcao", "olha": "dir"}
        for quem in ("dono", "membroa", "membrob"):
            self.assertEqual(self.post("/api/presenca", pos, self.cab[quem])[0], 200)
        self.assertEqual(self.post("/api/sala/enviar", {"texto": "oi de quem sobe"}, self.cab["dono"])[0], 200)
        try:
            de_b = self.get("/api/ao-vivo", self.cab["membrob"])[1]
            dono = self.srv.id_pessoa("dono")
            self.assertEqual({p["usuario"]: p["nome"] for p in de_b["pessoas"]}[dono], "Pessoa")
            self.assertEqual([m["nome"] for m in de_b["mensagens"] if m["usuario"] == dono], ["Pessoa"])
            self.assertNotIn("dono", json.dumps(de_b).lower())   # nem o login, nem um nome igual a ele
            self.assertEqual([p["usuario"] for p in de_b["pessoas"]], sorted(p["usuario"] for p in de_b["pessoas"]))
            q = f"?andar={self.A}"   # no andar da empresa, nada muda
            for quem in ("dono", "membroa"):
                self.assertEqual(self.post("/api/presenca" + q, pos, self.cab[quem])[0], 200)
            de_a = self.get("/api/ao-vivo" + q, self.cab["membroa"])[1]
            self.assertEqual({p["usuario"]: p["nome"] for p in de_a["pessoas"]}["dono"], "dono")
        finally:
            for quem in ("dono", "membroa", "membrob"):
                self.srv.presenca.sair(quem)


if __name__ == "__main__":
    unittest.main()
