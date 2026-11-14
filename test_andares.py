import json
import os
import shutil
import stat
import tempfile
import threading
import unittest
import urllib.error
import urllib.parse
import urllib.request

PASTA = tempfile.mkdtemp(prefix="escritorio-teste-andares-")
os.environ.setdefault("ESCRITORIO_DADOS", PASTA)   # rodando junto com o test_escritorio, vale a pasta dele
if "ESCRITORIO_TIMES" not in os.environ:
    os.environ["ESCRITORIO_TIMES"] = os.path.join(PASTA, "times.json")
    with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as _f:
        _f.write("{}")
os.environ.setdefault("AGENTES_ORG", "00000000-0000-4000-8000-000000000000")  # org fictícia
import andares  # noqa: E402
import escritorio as e  # noqa: E402
from acesso import Acesso  # noqa: E402

ORG_B = "11111111-1111-4111-8111-111111111111"
ORG_C = "22222222-2222-4222-8222-222222222222"


def tarefa(org, agente="b1"):
    return {"agent": {"id": agente}, "status": "running", "label": "x", "started_at": "2026-11-14T10:00:00Z",
            "url": f"https://app.agentes.chat/org/{org}/c/33333333-3333-4333-8333-333333333333"}


class Registro(unittest.TestCase):
    def setUp(self):
        self.dados = tempfile.mkdtemp(prefix="andares-reg-")
        self.addCleanup(shutil.rmtree, self.dados, ignore_errors=True)

    def test_sem_arquivo_nao_tem_andar_extra(self):
        self.assertEqual(andares.Andares(self.dados, e.ORG).lista, [])
        self.assertFalse(os.path.exists(os.path.join(self.dados, andares.ARQ)))

    def test_criar_renomear_remover_e_reler(self):
        r = andares.Andares(self.dados, e.ORG)
        a = r.criar(" Marketing ", ORG_B.upper())
        self.assertRegex(a["id"], r"^[0-9a-f]{8}$")
        self.assertEqual((a["nome"], a["org"]), ("Marketing", ORG_B))
        self.assertTrue(os.path.isdir(andares.pasta(self.dados, a["id"])))
        if os.name != "nt":   # o Windows não tem os bits de permissão do Unix
            modo = stat.S_IMODE(os.stat(os.path.join(self.dados, andares.ARQ)).st_mode)
            self.assertEqual(modo, 0o600)
        r.renomear(a["id"], "Vendas")
        self.assertEqual(andares.Andares(self.dados, e.ORG).lista, [{**a, "nome": "Vendas"}])
        r.remover(a["id"])
        self.assertEqual(andares.Andares(self.dados, e.ORG).lista, [])
        self.assertTrue(os.path.isdir(andares.pasta(self.dados, a["id"])))   # a pasta fica

    def test_recusas(self):
        r = andares.Andares(self.dados, e.ORG)
        for nome, org in (("", ORG_B), ("<b>", ORG_B), ("x" * 41, ORG_B), ("Ok", "nao-e-uuid"), ("Ok", e.ORG)):
            with self.assertRaises(ValueError, msg=(nome, org)):
                r.criar(nome, org)
        r.criar("B", ORG_B)
        with self.assertRaisesRegex(ValueError, "já é um andar"):
            r.criar("B de novo", ORG_B)
        with self.assertRaises(KeyError):
            r.renomear("ffffffff", "X")

    def test_teto_de_andares_extras(self):
        r = andares.Andares(self.dados, e.ORG)
        for i in range(andares.MAX_EXTRAS):
            r.criar(f"Andar {i}", f"{i + 1:08x}-0000-4000-8000-000000000000")
        with self.assertRaisesRegex(ValueError, "andares extras"):
            r.criar("Mais um", ORG_C)

    def test_arquivo_ilegivel_nao_sobe(self):
        for conteudo in ("{", json.dumps({"v": 1, "andares": [{"id": "../../x", "nome": "A", "org": ORG_B}]}),
                         json.dumps({"v": 1, "andares": [{"id": "aaaaaaaa", "nome": "A", "org": e.ORG}]}),
                         json.dumps({"v": 2, "andares": []})):
            with open(os.path.join(self.dados, andares.ARQ), "w", encoding="utf-8") as f:
                f.write(conteudo)
            with self.assertRaises(andares.AndaresIlegiveis, msg=conteudo):
                andares.Andares(self.dados, e.ORG)

    def test_pasta_so_sai_do_id(self):
        for ruim in ("../x", "AAAAAAAA", "aaaaaaa", "aaaaaaaa/..", None):
            with self.assertRaises(ValueError):
                andares.pasta(self.dados, ruim)


class OutroWorkspace(unittest.TestCase):
    def test_tarefa_de_outra_org(self):
        self.assertFalse(e.outra_org([tarefa(ORG_B)], ORG_B))
        self.assertTrue(e.outra_org([tarefa(ORG_B), tarefa(ORG_C)], ORG_B))
        self.assertFalse(e.outra_org([{"url": ""}, {}], ORG_B))

    def test_leitor_do_andar_marca_outra_org_e_nao_publica(self):
        class Cred:
            def token(self):
                return "t"
        l = e.Leitor(Cred(), e.url_app(e.AGENTES, ORG_B), os.path.join(PASTA, "nao-existe.json"), org=ORG_B)
        l.mcp.sessao = "s"
        l._coletar = lambda token, agora=None: (_ for _ in ()).throw(e.OutraOrg())
        l.ciclo(1_000_000)
        foto = l.foto()
        self.assertEqual((foto["conexao"], foto["agentes"], foto["tarefas"]), ("outra_org", [], []))

    def test_principal_continua_sem_conferir_org(self):
        l = e.Leitor(None)
        self.assertIsNone(l.org)


class Http(unittest.TestCase):
    """Dois andares no mesmo servidor: o principal (os arquivos de sempre) e um extra, com leitores falsos."""

    @classmethod
    def setUpClass(cls):
        cls.dados = tempfile.mkdtemp(prefix="andares-http-")
        cls.antes = e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE

        class Leitor:
            def __init__(self, agentes):
                self.agentes = agentes

            def foto(self):
                return {**e.resumir(self.agentes, []), "atualizado": None, "erro": None, "conexao": "conectado"}

        class Conversas:   # só conhece os ids do próprio andar
            def __init__(self, ids):
                self.ids = ids

            def esquecer(self):
                pass

            def ler_id(self, id_):
                return (200, {"id": id_}) if id_ in self.ids else (404, {"erro": "não achei"})

        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor = Leitor([{"id": "a1", "name": "Pixel", "handle": "pixel"}])
        cls.srv.cred, cls.srv.acesso = None, Acesso(os.path.join(cls.dados, "contas"))
        cls.srv.conversas = Conversas({"idDoPrincipa"})
        cls.srv.planta = e.Planta(os.path.join(cls.dados, "planta.json"), e.log,
                                  lambda d: e.gravar(os.path.join(cls.dados, "planta.json"), d))
        e.TIMES, e.ARQ_PLANTA = os.path.join(cls.dados, "times.json"), os.path.join(cls.dados, "planta.json")
        e.ARQ_EQUIPE = os.path.join(cls.dados, "equipe.json")
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"conversas": "ler", "times": [{"nome": "Térreo time", "agentes": ["pixel"]}]}, f)
        cls.srv.registro_andares = andares.Andares(cls.dados, e.ORG)
        reg = cls.srv.registro_andares.criar("Marketing", ORG_B)
        extra = e.Andar(reg, cls.dados)
        extra.leitor = Leitor([{"id": "b1", "name": "Bolt", "handle": "bolt"}])
        extra.conversas = Conversas({"idDoExtra123"})
        with open(extra.times, "w", encoding="utf-8") as f:
            json.dump({"conversas": "ler", "times": [{"nome": "Time B", "agentes": ["bolt"]}], "empresa": "Ignorada"}, f)
        cls.extra = extra
        cls.srv.andares = {reg["id"]: extra}
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        e.BASE = cls.base
        with open(os.path.join(cls.dados, "contas", "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")   # com o arquivo fechado (unlink no Windows)
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
        st, _, h = cls.req("/entrar", {"Origin": cls.base, "Content-Type": "application/x-www-form-urlencoded"}, corpo)
        assert st == 303, st
        cls.cookie = {"Cookie": h["Set-Cookie"].split(";")[0]}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE = cls.antes
        shutil.rmtree(cls.dados, ignore_errors=True)

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

    def get(self, rota):
        st, corpo, _ = self.req(rota, self.cookie)
        return st, json.loads(corpo) if corpo else None

    def post(self, rota, dados):
        cab = {**self.cookie, "Origin": self.base, "Content-Type": "application/json"}
        st, corpo, _ = self.req(rota, cab, json.dumps(dados).encode())
        return st, json.loads(corpo) if corpo else None

    def test_sem_andar_e_o_principal_de_sempre(self):
        st, cfg = self.get("/api/config")
        self.assertEqual(st, 200)
        self.assertEqual(cfg["andar"], "principal")
        self.assertEqual([a["id"] for a in cfg["andares"]], ["principal", self.extra.id])
        self.assertEqual([t["nome"] for t in cfg["times"]], ["Térreo time"])
        self.assertEqual(self.get("/api/estado")[1]["agentes"][0]["id"], "a1")

    def test_estado_e_config_do_andar_extra(self):
        q = f"?andar={self.extra.id}"
        st, estado = self.get("/api/estado" + q)
        self.assertEqual((st, [a["id"] for a in estado["agentes"]]), (200, ["b1"]))
        st, cfg = self.get("/api/config" + q)
        self.assertEqual(cfg["andar"], self.extra.id)
        self.assertEqual([t["nome"] for t in cfg["times"]], ["Time B"])
        self.assertNotEqual(cfg["empresa"], "Ignorada")   # a marca é do prédio
        self.assertIn(f"/org/{ORG_B}", cfg["app_url"])

    def test_andar_inexistente_da_404_igual(self):
        for q in ("?andar=ffffffff", "?andar=../x", "?andar=PRINCIPAL"):
            for rota in ("/api/estado", "/api/config", "/api/jornal", "/api/conversa", "/oauth/conectar"):
                st, corpo = self.get(rota + q)
                self.assertEqual((st, corpo["codigo"]), (404, "andar"), rota + q)
        st, corpo = self.post("/api/planta?andar=ffffffff", {})
        self.assertEqual((st, corpo["codigo"]), (404, "andar"))

    def test_conversa_de_um_andar_nao_abre_no_outro(self):
        self.assertEqual(self.get("/api/conversa?id=idDoExtra123")[0], 404)
        self.assertEqual(self.get(f"/api/conversa?id=idDoExtra123&andar={self.extra.id}")[0], 200)
        self.assertEqual(self.get(f"/api/conversa?id=idDoPrincipa&andar={self.extra.id}")[0], 404)

    def test_planta_e_equipe_gravam_no_andar_certo(self):
        q = f"?andar={self.extra.id}"
        rev = self.get("/api/config" + q)[1]["planta"]["rev"]
        st, _ = self.post("/api/planta" + q, {"rev": rev, "salas": {}, "moveis": {}, "novos": []})
        self.assertEqual(st, 200)
        self.assertTrue(os.path.exists(self.extra.arq_planta))
        self.assertFalse(os.path.exists(e.ARQ_PLANTA))
        st, _ = self.post("/api/equipe" + q, {"rev": 0, "aparencia": {}, "times": [
            {"nome": "Só B", "tipo": "mesas", "cor": None, "icone": None, "parede": 0, "piso": 0, "agentes": []}]})
        self.assertEqual(st, 200)
        self.assertTrue(os.path.exists(self.extra.arq_equipe))
        self.assertFalse(os.path.exists(e.ARQ_EQUIPE))
        self.assertEqual([t["nome"] for t in self.get("/api/config" + q)[1]["times"]], ["Só B"])
        self.assertEqual([t["nome"] for t in self.get("/api/config")[1]["times"]], ["Térreo time"])

    def test_retorno_do_oauth_vai_para_o_andar_dono_do_state(self):
        chamados = []

        class Cred:
            def __init__(self, nome, estados):
                self.nome, self.estados = nome, estados

            def tem_estado(self, s):
                return s in self.estados

            def concluir(self, codigo, s):
                chamados.append((self.nome, s))

        antes_extra, antes_srv = self.extra.cred, self.srv.cred
        self.extra.cred, self.srv.cred = Cred("extra", {"st-extra"}), Cred("principal", set())
        try:
            st, _, h = self.req("/oauth/retorno?code=c&state=st-extra", self.cookie)
            self.assertEqual((st, h["Location"]), (302, f"/#andar={self.extra.id}"))
            st, _, h = self.req("/oauth/retorno?code=c&state=outro", self.cookie)
            self.assertEqual((st, h["Location"]), (302, "/"))
        finally:
            self.extra.cred, self.srv.cred = antes_extra, antes_srv
        self.assertEqual(chamados, [("extra", "st-extra"), ("principal", "outro")])

    def test_membro_so_ve_os_andares_dele(self):
        papeis = {("dono", "principal"): "membro"}
        self.srv.acesso.papel = lambda u, andar="principal": papeis.get((u, andar))
        try:
            self.assertEqual(self.get(f"/api/estado?andar={self.extra.id}")[0], 404)
            self.assertEqual([a["id"] for a in self.get("/api/config")[1]["andares"]], ["principal"])
            self.assertEqual(self.get("/api/andares")[0], 403)
            papeis[("dono", self.extra.id)] = "membro"
            self.assertEqual(self.get(f"/api/estado?andar={self.extra.id}")[0], 200)
        finally:
            del self.srv.acesso.papel

    def test_gestao_pede_senha_e_formato_exato(self):
        self.assertEqual(self.post("/api/andares", {"acao": "criar", "nome": "X", "org": ORG_C})[0], 400)
        st, corpo = self.post("/api/andares", {"acao": "criar", "nome": "X", "org": ORG_C, "senha": "errada-errada"})
        self.assertEqual((st, corpo["codigo"]), (403, "senha_incorreta"))
        st, corpo = self.post("/api/andares", {"acao": "renomear", "id": "ffffffff", "nome": "Y"})
        self.assertEqual((st, corpo["codigo"]), (404, "andar"))
        cab = {**self.cookie, "Origin": "https://outro.exemplo", "Content-Type": "application/json"}
        self.assertEqual(self.req("/api/andares", cab, b'{"acao":"renomear","id":"x","nome":"y"}')[0], 403)

    def test_criar_renomear_e_remover_de_verdade(self):
        st, corpo = self.post("/api/andares", {"acao": "criar", "nome": "Suporte", "org": ORG_C,
                                               "senha": "senha-bem-grande"})
        self.assertEqual(st, 200, corpo)
        novo = corpo["andar"]["id"]
        andar = self.srv.andares[novo]
        try:
            self.assertEqual(self.get("/api/andares")[1]["andares"][-1]["org"], ORG_C)
            self.assertEqual(self.post("/api/andares", {"acao": "renomear", "id": novo, "nome": "Help"})[0], 200)
            self.assertEqual(andar.nome, "Help")
            self.assertEqual(self.post("/api/andares", {"acao": "remover", "id": novo, "senha": "senha-bem-grande"})[0], 200)
            self.assertNotIn(novo, self.srv.andares)
            self.assertTrue(andar.leitor.parado and andar.social.parado)
            self.assertEqual(self.get(f"/api/estado?andar={novo}")[0], 404)
        finally:
            andar.parar()


if __name__ == "__main__":
    unittest.main()
