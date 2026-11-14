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
import escritorio as e
from acesso import Acesso

RAIZ = os.path.dirname(os.path.abspath(__file__))
ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
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

        class Avisos:   # o push do prédio: conta quantas vezes zerou a lista de aparelhos
            zerou = 0

            def limpar(self):
                Avisos.zerou += 1

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
        publicos_get = {"/entrar", "/primeiro-acesso", "/logo", "/convite"}
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
                             {"usuario": "carla", "nome": "Carla", "avatar": AVATAR, "papel": "membro", "aparencia": AVATAR})
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
        antes = self.Avisos.zerou
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(self.post("/api/sair-todos", {"senha": SENHA}, ana)[0], 200)
        self.assertEqual(self.get("/api/estado", ana)[0], 401)
        self.assertEqual(self.get("/api/estado", self.dono)[0], 200)
        self.assertEqual(self.Avisos.zerou, antes)   # a lista de aparelhos do prédio fica


if __name__ == "__main__":
    unittest.main()
