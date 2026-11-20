"""Clima por andar: cada andar extra pode ter a sua cidade (dados/andares/<id>/clima.json, com o fuso), herda a do prédio
sem ela, e só quem tem acesso ao andar vê a cidade dele. O Clima do servidor consulta cada coordenada uma vez só."""
import atexit
import contextlib
import io
import json
import os
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

PASTA = tempfile.mkdtemp(prefix="escritorio-teste-clima-andar-")


@atexit.register
def _apagar_pasta():
    for _ in range(10):
        shutil.rmtree(PASTA, ignore_errors=True)
        if not os.path.exists(PASTA):
            return
        time.sleep(0.2)


os.environ.setdefault("ESCRITORIO_DADOS", PASTA)   # rodando junto com os outros, vale a pasta do primeiro
if "ESCRITORIO_TIMES" not in os.environ:
    os.environ["ESCRITORIO_TIMES"] = os.path.join(PASTA, "times.json")
    with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as _f:
        _f.write("{}")
os.environ.setdefault("AGENTES_ORG", "00000000-0000-4000-8000-000000000000")  # org fictícia
import ajustes  # noqa: E402
import andares  # noqa: E402
import escritorio as e  # noqa: E402
from acesso import Acesso  # noqa: E402

ORG_B = "11111111-1111-4111-8111-111111111111"
ORG_C = "22222222-2222-4222-8222-222222222222"
BH = {"cidade": "Belo Horizonte", "lat": -19.92, "lon": -43.94}
LISBOA = {"cidade": "Lisboa", "lat": 38.72, "lon": -9.14, "fuso": "Europe/Lisbon"}


class Validacao(unittest.TestCase):
    def test_fuso_so_na_cidade_do_andar(self):
        self.assertEqual(ajustes.validar_clima({**LISBOA, "lat": 38.7169}, fuso=True), {**LISBOA, "lat": 38.72})
        self.assertEqual(ajustes.validar_clima(BH, fuso=True), BH)   # o fuso é opcional
        with self.assertRaises(ValueError):   # o clima do prédio continua sem fuso, como sempre
            ajustes.validar_clima(LISBOA)
        for ruim in ("../etc", "America/Sao_Paulo;x", "", "a" * 41, 3, "sao_paulo", "Foo/Bar"):   # Foo/Bar: não existe
            with self.assertRaises(ValueError, msg=ruim):
                ajustes.validar_clima({**LISBOA, "fuso": ruim}, fuso=True)
        self.assertEqual(ajustes.validar_fuso("America/Argentina/Buenos_Aires"), "America/Argentina/Buenos_Aires")
        self.assertIsNone(ajustes.validar_fuso("<script>"))


class CachePorCidade(unittest.TestCase):
    """O Clima do servidor: o prédio e as cidades dos andares, uma consulta por coordenada, no máximo 1 por minuto."""

    def clima(self, predio, extras):
        c = e.Clima(lambda: predio[0], lambda: list(extras))
        c.agora, c.consultas = 1000.0, []
        c.relogio = lambda: c.agora

        def consultar(lat, lon):
            c.consultas.append((lat, lon))
            return {"weather_code": 61 if lat > 0 else 0, "temperature_2m": round(lat)}
        c._consultar = consultar
        return c

    def test_mesma_cidade_uma_consulta_so(self):
        extras = [dict(BH, cidade="BH"), dict(BH)]   # dois andares na mesma cidade do prédio
        c = self.clima([BH], extras)
        self.assertEqual((c.ciclo(), c.consultas), (900, [(-19.92, -43.94)]))
        self.assertEqual(c.foto()["cidade"], "Belo Horizonte")
        self.assertEqual(c.foto(extras[0])["cidade"], "BH")   # o tempo é o mesmo; o nome, o do andar
        self.assertEqual(c.foto(extras[0])["temperatura"], c.foto()["temperatura"])

    def test_cidades_diferentes_uma_por_minuto(self):
        extras = [LISBOA]
        c = self.clima([BH], extras)
        self.assertEqual(c.ciclo(), 60)   # consultou o prédio; Lisboa espera o minuto
        self.assertIsNone(c.foto(LISBOA))
        c.agora += 60
        self.assertEqual(c.ciclo(), 840)
        self.assertEqual(c.consultas, [(-19.92, -43.94), (38.72, -9.14)])
        self.assertEqual((c.foto()["tipo"], c.foto(LISBOA)["tipo"]), ("limpo", "chuva"))
        c.agora += 840
        c.ciclo()
        self.assertEqual(len(c.consultas), 3)   # cada uma de 15 em 15 min
        extras.clear()   # o andar voltou a herdar: o tempo de Lisboa sai já
        c.ciclo()
        self.assertIsNone(c.foto(LISBOA))

    def test_so_andar_com_cidade(self):
        c = self.clima([None], [LISBOA])
        self.assertEqual((c.ciclo(), c.foto()), (900, None))   # o prédio segue sem clima
        self.assertEqual(c.foto(LISBOA)["cidade"], "Lisboa")


class Http(unittest.TestCase):
    """O principal (o prédio em Belo Horizonte) e dois andares extras: B e C."""

    @classmethod
    def setUpClass(cls):
        cls.dados = tempfile.mkdtemp(prefix="clima-andar-http-")
        cls.antes = e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE, e.ARQ_CLIMA, e.ARQ_MARCA

        class Leitor:
            def foto(self):
                return {**e.resumir([], []), "atualizado": None, "erro": None, "conexao": "conectado"}

        class Clima:   # o tempo de cada lugar pela coordenada, sem rede
            acordou = 0

            def acordar(self):
                self.acordou += 1

            def foto(self, lugar=None):
                lugar = lugar or e.clima_vigente()[0]
                return {"tipo": "chuva" if lugar["lat"] > 0 else "limpo", "temperatura": 20, "cidade": lugar["cidade"]} \
                    if lugar else None

        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor, cls.srv.cred, cls.srv.clima = Leitor(), None, Clima()
        cls.srv.acesso = Acesso(os.path.join(cls.dados, "contas"))
        e.TIMES, e.ARQ_PLANTA = os.path.join(cls.dados, "times.json"), os.path.join(cls.dados, "planta.json")
        e.ARQ_EQUIPE, e.ARQ_CLIMA = os.path.join(cls.dados, "equipe.json"), os.path.join(cls.dados, "clima.json")
        e.ARQ_MARCA = os.path.join(cls.dados, "marca.json")
        with open(e.TIMES, "w", encoding="utf-8") as f:
            f.write("{}")
        e.gravar(e.ARQ_CLIMA, ajustes.bytes_do_clima(BH))
        cls.srv.registro_andares = andares.Andares(cls.dados, e.ORG)
        cls.b = e.Andar(cls.srv.registro_andares.criar("Dev Maniacs", ORG_B), cls.dados)
        cls.c = e.Andar(cls.srv.registro_andares.criar("Outra", ORG_C), cls.dados)
        for a in (cls.b, cls.c):
            a.leitor = Leitor()
        cls.srv.andares = {cls.b.id: cls.b, cls.c.id: cls.c}
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = e.BASE = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        with open(os.path.join(cls.dados, "contas", "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
        st, _, h = cls.req("/entrar", {"Origin": cls.base, "Content-Type": "application/x-www-form-urlencoded"}, corpo)
        assert st == 303, st
        cls.dono = {"Cookie": h["Set-Cookie"].split(";")[0]}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE, e.ARQ_CLIMA, e.ARQ_MARCA = cls.antes
        shutil.rmtree(cls.dados, ignore_errors=True)

    def setUp(self):
        for a in (self.b, self.c):
            if os.path.exists(a.arq_clima):
                os.unlink(a.arq_clima)
            a.acertar_fuso()   # o arquivo saiu por fora da rota: o relógio volta a Brasília
        self.log = contextlib.redirect_stdout(io.StringIO())
        self.log.__enter__()
        self.addCleanup(self.log.__exit__, None, None, None)

    @classmethod
    def req(cls, rota, cab=None, dados=None):
        class SemRedirecionar(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        r = urllib.request.Request(cls.base + rota, headers=cab or {}, data=dados)
        try:
            with urllib.request.build_opener(SemRedirecionar).open(r) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers

    def get(self, rota, cab=None):
        st, corpo, _ = self.req(rota, cab or self.dono)
        return st, json.loads(corpo) if corpo else None

    def post(self, rota, dados, cab=None):
        cab = {**(cab or self.dono), "Origin": self.base, "Content-Type": "application/json"}
        st, corpo, _ = self.req(rota, cab, json.dumps(dados).encode())
        return st, json.loads(corpo) if corpo else None

    def conta(self, usuario, andar, papel="membro"):
        """Uma conta só de um andar extra, pelo convite, e o cookie dela."""
        acesso = self.srv.acesso
        if usuario in acesso.usuarios:
            acesso.remover(usuario)
        token, _ = acesso.convidar(usuario.title(), [andar.id], principal=False)
        cab = {"Cookie": "esc_sessao=" + acesso.aceitar_convite(token, usuario, "senha-da-pessoa-1", usuario.title(),
                                                                {"color": "rose", "eyes": "round", "accessory": "cap"})}
        if papel == "admin":
            acesso.mudar_papel(usuario, "admin", andar.id)
        self.addCleanup(acesso.remover, usuario)
        return cab

    def test_sem_cidade_propria_herda_a_do_predio(self):
        st, cfg = self.get(f"/api/config?andar={self.b.id}")
        self.assertEqual((st, cfg["clima"], cfg["ajustes"]["clima"]), (200, BH, "tela"))
        self.assertEqual(self.get(f"/api/estado?andar={self.b.id}")[1]["clima"]["cidade"], "Belo Horizonte")
        cidades = {a["id"]: a["cidade"] for a in self.get("/api/config")[1]["andares"]}
        self.assertEqual(cidades, {"principal": "Belo Horizonte", self.b.id: "Belo Horizonte", self.c.id: "Belo Horizonte"})

    def test_cidade_propria_vale_so_no_andar(self):
        q = f"?andar={self.b.id}"
        st, corpo = self.post("/api/clima/andar" + q, {"clima": {**LISBOA, "lat": 38.7169}})
        self.assertEqual((st, corpo), (200, {"clima": LISBOA, "origem": "andar"}))   # 2 casas, com o fuso
        self.assertEqual(self.srv.clima.acordou > 0, True)
        cfg = self.get("/api/config" + q)[1]
        self.assertEqual((cfg["clima"], cfg["ajustes"]["clima"]), (LISBOA, "andar"))
        estado = self.get("/api/estado" + q)[1]
        self.assertEqual((estado["clima"]["cidade"], estado["clima"]["tipo"]), ("Lisboa", "chuva"))
        # o principal, o prédio e o outro andar seguem com Belo Horizonte
        self.assertEqual(self.get("/api/config")[1]["clima"], BH)
        self.assertEqual(self.get("/api/estado")[1]["clima"]["cidade"], "Belo Horizonte")
        self.assertEqual(self.get(f"/api/config?andar={self.c.id}")[1]["clima"], BH)
        self.assertEqual(e.clima_vigente(), (BH, "tela"))
        cidades = {a["id"]: a["cidade"] for a in self.get("/api/config")[1]["andares"]}
        self.assertEqual((cidades[self.b.id], cidades[self.c.id]), ("Lisboa", "Belo Horizonte"))
        lista = {a["id"]: a["cidade"] for a in self.get("/api/andares")[1]["andares"]}
        self.assertEqual(lista, {self.b.id: "Lisboa", self.c.id: None})   # None: herda a do prédio
        # voltar a herdar apaga o arquivo do andar
        st, corpo = self.post("/api/clima/andar" + q, {"limpar": True})
        self.assertEqual((st, corpo), (200, {"clima": BH, "origem": "tela"}))
        self.assertFalse(os.path.exists(self.b.arq_clima))

    def test_vida_social_e_jornal_no_relogio_da_cidade(self):
        """A regra: o expediente do servidor (ringue e hora extra) usa o mesmo fuso que a tela usa no Ceu."""
        import datetime
        import social
        q = f"?andar={self.b.id}"
        self.assertEqual((self.b.social.fuso, self.b.jornal.fuso), (e.FUSO, e.FUSO))   # sem cidade própria: Brasília
        self.post("/api/clima/andar" + q, {"clima": LISBOA})
        lisboa = ajustes.zona("Europe/Lisbon")
        self.assertEqual((self.b.social.fuso, self.b.jornal.fuso), (lisboa, lisboa))
        self.assertEqual((self.c.social.fuso, self.c.jornal.fuso), (e.FUSO, e.FUSO))   # o outro andar não muda
        self.assertEqual(e.Andar({"id": self.b.id, "nome": "B", "org": ORG_B}, self.dados).social.fuso, lisboa)   # ao subir
        # 06:00 em Brasília é 09:00 em Lisboa: com o expediente 07:00-20:00, o ringue de B está aberto, como na tela
        agora = datetime.datetime(2026, 11, 20, 6, 0, tzinfo=e.FUSO).timestamp()
        expediente = {"abre": "07:00", "fecha": "20:00"}
        self.assertIsNotNone(social.fechamento(agora, expediente, self.b.social.fuso))
        self.assertIsNone(social.fechamento(agora, expediente, self.c.social.fuso))
        self.post("/api/clima/andar" + q, {"limpar": True})   # voltou a herdar: volta a Brasília
        self.assertEqual((self.b.social.fuso, self.b.jornal.fuso), (e.FUSO, e.FUSO))

    def test_config_v_muda_com_a_cidade_do_andar(self):
        antes = e.config_v(self.b)
        self.post(f"/api/clima/andar?andar={self.b.id}", {"clima": LISBOA})
        self.assertNotEqual(e.config_v(self.b), antes)
        self.assertEqual(e.config_v(None), e.config_v(e.AndarPrincipal(self.srv)))

    def test_pedidos_recusados(self):
        q = f"?andar={self.b.id}"
        for ruim in ({"clima": None}, {"clima": {**LISBOA, "fuso": "../x"}}, {"clima": {**LISBOA, "lat": 91}},
                     {"clima": LISBOA, "limpar": True}, {"limpar": False}, []):
            self.assertEqual(self.post("/api/clima/andar" + q, ruim)[0], 400, ruim)
        self.assertFalse(os.path.exists(self.b.arq_clima))
        st, corpo = self.post("/api/clima/andar", {"clima": LISBOA})   # o principal usa a cidade do prédio
        self.assertEqual((st, corpo["codigo"]), (404, "andar"))
        self.assertEqual(self.post("/api/clima/andar?andar=ffffffff", {"clima": LISBOA})[0], 404)
        cab = {**self.dono, "Origin": "https://outro.exemplo", "Content-Type": "application/json"}
        self.assertEqual(self.req("/api/clima/andar" + q, cab, json.dumps({"clima": LISBOA}).encode())[0], 403)

    def test_admin_da_empresa_so_no_andar_dele(self):
        bia = self.conta("bia", self.b, "admin")
        st, corpo = self.post(f"/api/clima/andar?andar={self.b.id}", {"clima": LISBOA}, bia)
        self.assertEqual((st, corpo["origem"]), (200, "andar"))
        self.assertEqual(self.post(f"/api/clima/andar?andar={self.c.id}", {"clima": LISBOA}, bia)[0], 404)
        self.assertFalse(os.path.exists(self.c.arq_clima))
        self.assertEqual(self.post("/api/clima", {"clima": LISBOA}, bia)[0], 403)   # a do prédio, não
        self.assertEqual(e.clima_vigente()[0], BH)
        # a busca: com o andar dela passa a guarda (q curto: 400 sem rede); com o andar de outra empresa, não
        self.assertEqual(self.get(f"/api/clima/busca?q=a&andar={self.b.id}", bia)[0], 400)
        self.assertIn(self.get(f"/api/clima/busca?q=a&andar={self.c.id}", bia)[0], (403, 404))
        # ela vê só o andar dela no elevador, com a cidade dele
        andares_bia = self.get("/api/config", bia)[1]["andares"]
        self.assertEqual([(a["id"], a["cidade"]) for a in andares_bia], [(self.b.id, "Lisboa")])

    def test_membro_nao_muda_a_cidade_e_nao_ve_a_dos_outros(self):
        self.post(f"/api/clima/andar?andar={self.c.id}", {"clima": LISBOA})   # a cidade de C
        ana = self.conta("ana", self.b)
        self.assertEqual(self.post(f"/api/clima/andar?andar={self.b.id}", {"clima": LISBOA}, ana)[0], 403)
        self.assertEqual(self.get(f"/api/clima/busca?q=a&andar={self.b.id}", ana)[0], 403)
        self.assertEqual(self.get(f"/api/config?andar={self.c.id}", ana)[0], 404)
        self.assertEqual(self.get(f"/api/estado?andar={self.c.id}", ana)[0], 404)
        cfg = self.get(f"/api/config?andar={self.b.id}", ana)[1]
        self.assertEqual(cfg["clima"], BH)
        self.assertNotIn("Lisboa", json.dumps(cfg))

    def test_mundo_e_recepcao_publicos_so_com_o_predio(self):
        self.post(f"/api/clima/andar?andar={self.b.id}", {"clima": LISBOA})
        for rota in ("/api/mundo/clima", "/api/visitas/recepcao"):
            st, corpo, _ = self.req(rota, {"Origin": self.base, "Content-Type": "application/json"}, b"{}")
            self.assertNotIn(b"Lisboa", corpo, rota)
            self.assertNotIn(b"38.72", corpo, rota)
            self.assertNotIn(b"chuva", corpo, rota)   # o tempo de Lisboa (chuva, no falso) não vaza


if __name__ == "__main__":
    unittest.main()
