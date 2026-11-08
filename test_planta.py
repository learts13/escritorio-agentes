"""Modo construção: planta.py (validação, leitura e gravação) e a rota POST /api/planta.
Uso: python -B -m unittest test_escritorio test_planta
"""
import atexit
import json
import os
import shutil
import socket
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

PASTA = tempfile.mkdtemp(prefix="escritorio-teste-planta-")
os.environ.setdefault("ESCRITORIO_DADOS", PASTA)   # rodando junto com o test_escritorio, vale a pasta dele
if "ESCRITORIO_TIMES" not in os.environ:
    os.environ["ESCRITORIO_TIMES"] = os.path.join(PASTA, "times.json")
    with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as _f:
        json.dump({"conversas": "ler"}, _f)
os.environ.setdefault("AGENTES_ORG", "00000000-0000-4000-8000-000000000000")  # org fictícia
import escritorio as e  # noqa: E402
import planta  # noqa: E402
from acesso import Acesso, gravar  # noqa: E402

# até o fim do processo, e não no tearDownModule: no discover, o escritorio pode ter sido importado com esta pasta, e os
# módulos de teste seguintes ainda gravam nela
atexit.register(shutil.rmtree, PASTA, ignore_errors=True)

OK = {"rev": 0, "salas": {"lounge": {"parede": 2, "piso": 5}, "time:Dev": {"piso": 3}, "time:Café & Cia": {"parede": 6}},
      "moveis": {"lounge|sofa_cinza|0": {"x": 120, "y": 70, "e": True}, "time:Dev|planta_alta|1": {"fora": True},
                 "cozinha|mesa_redonda|99": {"e": False}, "time:Novos|caixas|0": {"x": 0, "y": 4095}},
      "novos": [{"nome": "planta_g1", "sala": "cozinha", "x": 40, "y": 30, "e": False}]}


def com(**mudar):
    """O OK com chaves trocadas (valor None tira a chave)."""
    d = json.loads(json.dumps(OK))
    for k, v in mudar.items():
        if v is None:
            del d[k]
        else:
            d[k] = v
    return d


INVALIDOS = {   # rótulo: corpo do POST (sem o "v")
    "chave a mais": com(extra=1), "sem novos": com(novos=None), "sem rev": com(rev=None),
    "rev True": com(rev=True), "rev negativo": com(rev=-1), "rev grande": com(rev=10 ** 9 + 1), "rev fracionário": com(rev=1.5),
    "rev texto": com(rev="0"), "corpo lista": [OK],
    "salas lista": com(salas=[]), "pintura vazia": com(salas={"lounge": {}}), "pintura chave a mais": com(salas={"lounge": {"cor": 1}}),
    "piso True": com(salas={"lounge": {"piso": True}}), "parede 7": com(salas={"lounge": {"parede": 7}}),
    "piso 10": com(salas={"lounge": {"piso": 10}}), "piso negativo": com(salas={"lounge": {"piso": -1}}),
    "piso fracionário": com(salas={"lounge": {"piso": 2.0}}), "pintura lista": com(salas={"lounge": [1]}),
    "sala que não existe": com(salas={"sotao": {"piso": 1}}), "time vazio": com(salas={"time:": {"piso": 1}}),
    "time com barra": com(salas={"time:a|b": {"piso": 1}}), "time grande": com(salas={"time:" + "a" * 41: {"piso": 1}}),
    "__proto__": com(salas={"__proto__": {"piso": 1}}), "constructor": com(moveis={"constructor": {"fora": True}}),
    "id com 2 partes": com(moveis={"lounge|sofa": {"fora": True}}), "id com 4 partes": com(moveis={"lounge|sofa|0|1": {"fora": True}}),
    "peça maiúscula": com(moveis={"lounge|Sofa|0": {"fora": True}}), "ocorrência 100": com(moveis={"lounge|sofa|100": {"fora": True}}),
    "ocorrência negativa": com(moveis={"lounge|sofa|-1": {"fora": True}}), "sala do id": com(moveis={"sotao|sofa|0": {"fora": True}}),
    "fora com x": com(moveis={"lounge|sofa|0": {"fora": True, "x": 1, "y": 1}}), "fora false": com(moveis={"lounge|sofa|0": {"fora": False}}),
    "fora 1": com(moveis={"lounge|sofa|0": {"fora": 1}}), "x sem y": com(moveis={"lounge|sofa|0": {"x": 1}}),
    "y sem x": com(moveis={"lounge|sofa|0": {"y": 1}}), "móvel vazio": com(moveis={"lounge|sofa|0": {}}),
    "x grande": com(moveis={"lounge|sofa|0": {"x": 4096, "y": 0}}), "x True": com(moveis={"lounge|sofa|0": {"x": True, "y": 0}}),
    "x negativo": com(moveis={"lounge|sofa|0": {"x": -1, "y": 0}}), "e 1": com(moveis={"lounge|sofa|0": {"e": 1}}),
    "e texto": com(moveis={"lounge|sofa|0": {"e": "true"}}), "móvel lista": com(moveis={"lounge|sofa|0": [1]}),
    "novos dict": com(novos={}), "novo sem e": com(novos=[{"nome": "a", "sala": "lounge", "x": 1, "y": 1}]),
    "novo chave a mais": com(novos=[{"nome": "a", "sala": "lounge", "x": 1, "y": 1, "e": False, "k": 0}]),
    "novo nome": com(novos=[{"nome": "Sofa", "sala": "lounge", "x": 1, "y": 1, "e": False}]),
    "novo sala": com(novos=[{"nome": "a", "sala": "sotao", "x": 1, "y": 1, "e": False}]),
    "novo x negativo": com(novos=[{"nome": "a", "sala": "lounge", "x": -1, "y": 1, "e": False}]),
    "novo e null": com(novos=[{"nome": "a", "sala": "lounge", "x": 1, "y": 1, "e": None}]),
    "novo e 0": com(novos=[{"nome": "a", "sala": "lounge", "x": 1, "y": 1, "e": 0}]),
    "65 salas": com(salas={f"time:T{i}": {"piso": 1} for i in range(65)}),
    "401 móveis": com(moveis={f"lounge|p{i}|0": {"fora": True} for i in range(401)}),
    "201 novos": com(novos=[{"nome": "a", "sala": "lounge", "x": 1, "y": 1, "e": False}] * 201),
}
NOS_LIMITES = com(salas={f"time:T{i}": {"piso": 1} for i in range(64)},
                  moveis={f"lounge|p{i}|0": {"x": 4095, "y": 4095, "e": True} for i in range(400)},
                  novos=[{"nome": "a", "sala": "lounge", "x": 1, "y": 1, "e": False}] * 200)


def arquivo(d, **mudar):
    return {"v": 1, **d, **mudar}


class Logs(list):
    def __call__(self, **campos):
        self.append(campos)


class Validacao(unittest.TestCase):
    def test_rotulo_igual_ao_dos_times(self):
        self.assertEqual(planta.ROTULO_OK.pattern, e.ROTULO_OK.pattern)

    def test_aceita_o_formato_e_os_limites(self):
        self.assertEqual(planta.validar_planta(OK), OK)
        self.assertEqual(planta.validar_planta(arquivo(OK), arquivo=True), OK)
        self.assertEqual(planta.validar_planta(NOS_LIMITES), NOS_LIMITES)
        self.assertEqual(planta.validar_planta(com(rev=10 ** 9)), com(rev=10 ** 9))
        self.assertEqual(planta.validar_planta(planta.vazia()), planta.vazia())

    def test_devolve_copia_sem_nada_a_mais(self):
        d = com()
        limpo = planta.validar_planta(d)
        d["salas"]["lounge"]["piso"] = 9
        self.assertEqual(limpo["salas"]["lounge"]["piso"], 5)

    def test_recusa_tudo_ou_nada(self):
        for rotulo, d in INVALIDOS.items():
            with self.subTest(rotulo):
                with self.assertRaises(ValueError):
                    planta.validar_planta(d)
                if isinstance(d, dict):
                    with self.assertRaises(ValueError):
                        planta.validar_planta(arquivo(d), arquivo=True)

    def test_v_so_no_arquivo(self):
        with self.assertRaises(ValueError):
            planta.validar_planta(arquivo(OK))   # o POST não manda o "v"
        for v in (None, 2, True, "1", 1.0):
            with self.subTest(v=v), self.assertRaises(ValueError):
                planta.validar_planta({**OK, **({"v": v} if v is not None else {})}, arquivo=True)


class Leitura(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="planta-ler-")
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)
        self.arq = os.path.join(self.pasta, "planta.json")
        self.logs = Logs()

    def plantar(self, dados):
        with open(self.arq, "wb") as f:
            f.write(dados if isinstance(dados, bytes) else json.dumps(dados).encode())

    def test_ausente_vazia_sem_log(self):
        self.assertEqual(planta.ler_planta(self.arq, self.logs), planta.vazia())
        self.assertEqual(self.logs, [])

    def test_invalida_sobe_vazia_com_um_log(self):
        casos = {r: arquivo(d) for r, d in INVALIDOS.items() if isinstance(d, dict)}
        casos.update({"sem v": OK, "v 2": arquivo(OK, v=2), "JSON quebrado": b'{"v": 1, ', "UTF-8 ruim": b"\xff\xfe",
                      "fundo demais": b"[" * 100000, "lista": [arquivo(OK)]})
        for rotulo, d in casos.items():
            with self.subTest(rotulo):
                self.plantar(d)
                self.logs.clear()
                self.assertEqual(planta.ler_planta(self.arq, self.logs), planta.vazia())
                self.assertEqual(len(self.logs), 1)
                self.assertEqual({k: self.logs[0][k] for k in ("evento", "resultado")}, {"evento": "planta", "resultado": "planta_invalida"})
                self.assertEqual(set(self.logs[0]), {"evento", "resultado", "detalhe"})   # só o tipo do erro, nunca o conteúdo
                self.assertIn(self.logs[0]["detalhe"], {"ValueError", "TypeError", "JSONDecodeError", "UnicodeDecodeError",
                                                        "RecursionError"})

    def test_teto_de_64_kb_discrimina(self):
        texto = json.dumps(arquivo(OK)).encode()
        self.plantar(texto[:-1] + b" " * (planta.PLANTA_BYTES - len(texto)) + b"}")   # JSON válido de exatamente 64 KB
        self.assertEqual(os.path.getsize(self.arq), planta.PLANTA_BYTES)
        self.assertEqual(planta.ler_planta(self.arq, self.logs), OK)
        self.plantar(texto[:-1] + b" " * (planta.PLANTA_BYTES + 1 - len(texto)) + b"}")   # 1 byte a mais
        self.assertEqual(planta.ler_planta(self.arq, self.logs), planta.vazia())
        self.assertEqual(len(self.logs), 1)

    def test_ida_e_volta(self):
        p = planta.Planta(self.arq, self.logs, lambda dados: gravar(self.arq, dados))
        self.assertEqual(p.salvar(planta.validar_planta(OK), "dono"), (200, {"rev": 1}))
        self.assertEqual(planta.ler_planta(self.arq, self.logs), {**OK, "rev": 1})
        self.assertEqual(planta.Planta(self.arq, self.logs, None).publica(), {**OK, "rev": 1})
        with open(self.arq, "rb") as f:
            self.assertEqual(json.loads(f.read())["v"], 1)
        if os.name == "posix":
            self.assertEqual(os.stat(self.arq).st_mode & 0o777, 0o600)

    def test_salvar_nao_grava_arquivo_acima_do_teto(self):
        # o corpo cabe nos limites, mas o arquivo (com o "v" e o rev novo) passaria de 64 KB: nunca grava ilegível
        nome = "time:" + "Ã" * 40
        grande = com(moveis={f"{nome}|{'p' * 37}{i:03d}|99": {"x": 4095, "y": 4095, "e": False} for i in range(400)},
                     salas={f"time:{i:02d}" + "Ã" * 38: {"parede": 6, "piso": 9} for i in range(64)},
                     novos=[{"nome": "p" * 40, "sala": nome, "x": 4095, "y": 4095, "e": False}] * 10)
        grande = planta.validar_planta(grande)
        self.assertGreater(len(planta.bytes_da_planta({**grande, "rev": 1})), planta.PLANTA_BYTES)
        chamadas = []
        p = planta.Planta(self.arq, self.logs, chamadas.append)
        self.assertEqual(p.salvar(grande, "dono")[0], 400)
        self.assertEqual((chamadas, p.publica()), ([], planta.vazia()))


class Rota(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Leitor:
            def foto(self):
                return {"agentes": [], "trabalhos": [], "atualizado": None, "erro": None}
        cls.dados = tempfile.mkdtemp(prefix="planta-rota-")
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
        self.arq = os.path.join(tempfile.mkdtemp(prefix="planta-"), "planta.json")
        self.addCleanup(shutil.rmtree, os.path.dirname(self.arq), ignore_errors=True)
        self.logs, self.falhar, self.espera = Logs(), False, 0

        def guardar(dados):
            time.sleep(self.espera)
            if self.falhar:
                raise OSError("disco cheio")
            gravar(self.arq, dados)
        self.srv.planta = planta.Planta(self.arq, self.logs, guardar)

    def tearDown(self):
        e.BASE = self.antes
        self.srv.previa_sem_login = False

    def req(self, rota, cab=None, dados=None, metodo=None):
        r = urllib.request.Request(self.base + rota, headers=cab or {}, data=dados, method=metodo)

        class SemRedirecionar(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        try:
            with urllib.request.build_opener(SemRedirecionar).open(r) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            with err:
                return err.code, err.read(), err.headers

    def post(self, corpo, cab=None, sessao=True):
        dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode()
        cab = {"Origin": self.base, "Content-Type": "application/json", **(self.sessao if sessao else {}), **(cab or {})}
        st, resp, _ = self.req("/api/planta", {k: v for k, v in cab.items() if v is not None}, dados, "POST")
        return st, json.loads(resp) if resp else None

    def test_salva_e_o_config_traz(self):
        self.assertEqual(self.post(OK), (200, {"rev": 1}))
        st, corpo, _ = self.req("/api/config", self.sessao)
        self.assertEqual((st, json.loads(corpo)["planta"]), (200, {**OK, "rev": 1}))
        self.assertEqual(planta.ler_planta(self.arq, Logs()), {**OK, "rev": 1})
        salvo = [l for l in self.logs if l["resultado"] == "salva"]
        self.assertEqual(salvo, [{"evento": "planta", "resultado": "salva", "usuario": "dono", "rev": 1, "salas": 3, "moveis": 4, "novos": 1}])
        self.assertNotIn("planta", e.config_publica())   # o diretor social não carrega a planta a cada minuto

    def test_voltar_ao_automatico(self):
        self.assertEqual(self.post(OK)[0], 200)
        self.assertEqual(self.post(planta.vazia(1)), (200, {"rev": 2}))
        self.assertEqual(self.srv.planta.publica(), planta.vazia(2))

    def test_get_config_nao_grava(self):
        pasta = os.path.dirname(self.arq)
        st, corpo, _ = self.req("/api/config", self.sessao)
        self.assertEqual((st, json.loads(corpo)["planta"]), (200, planta.vazia()))
        self.assertEqual(os.listdir(pasta), [])
        del self.srv.planta
        try:
            self.assertNotIn("planta", json.loads(self.req("/api/config", self.sessao)[1]))
            self.assertEqual(self.post(OK)[0], 404)
        finally:
            self.setUp()

    def test_origem_estrita(self):
        for cab in ({"Origin": None}, {"Origin": None, "Referer": self.base + "/construir.html"}, {"Origin": "null"},
                    {"Origin": "https://outro.exemplo"}, {"Origin": self.base + "/"}):
            with self.subTest(cab):
                self.assertEqual(self.post(OK, cab), (403, {"erro": "origem", "mensagem": "Origem não permitida."}))
        self.assertEqual(self.srv.planta.publica(), planta.vazia())

    def test_recusa_chega_com_corpo_grande_lento(self):
        # o navegador manda o cabeçalho e o corpo em pedaços: a recusa só sai depois de o corpo ser lido (do_POST), senão
        # o servidor fecha com reset e a resposta nunca chega (o 401 que leva o editor para /entrar virava "Sem conexão").
        # A planta sem sessão (401) e o caminho comum dos outros POST, com outra origem (403)
        corpo = json.dumps(OK).encode().ljust(40 * 1024)
        host, porta = self.srv.server_address[:2]
        for rota, origem, esperado in (("/api/planta", self.base, b"401"), ("/entrar", "https://outro.exemplo", b"403")):
            with self.subTest(rota), socket.create_connection((host, porta), timeout=5) as s:
                cab = [f"POST {rota} HTTP/1.1", f"Host: {host}:{porta}", f"Origin: {origem}", "Content-Type: application/json",
                       f"Content-Length: {len(corpo)}", "", ""]
                s.sendall("\r\n".join(cab).encode())
                time.sleep(0.2)
                s.sendall(corpo)
                resposta = b""
                while b"\r\n\r\n" not in resposta and (pedaco := s.recv(4096)):
                    resposta += pedaco
                self.assertEqual(resposta.split(b"\r\n", 1)[0].split(b" ")[1], esperado)
        self.assertEqual(self.srv.planta.publica(), planta.vazia())

    def test_sessao_formato_e_previa(self):
        self.assertEqual(self.post(OK, sessao=False), (401, {"erro": "entre de novo"}))
        self.assertEqual(self.post(OK, {"Cookie": e.nome_cookie() + "=falso"}, sessao=False)[0], 401)
        self.assertEqual(self.post(OK, {"Content-Type": "text/plain"})[0], 415)
        self.assertEqual(self.srv.planta.publica(), planta.vazia())
        self.srv.previa_sem_login = True
        self.assertEqual(self.post(OK, sessao=False), (200, {"rev": 1}))

    def test_pedido_invalido_400_sem_ecoar(self):
        for rotulo, d in INVALIDOS.items():
            with self.subTest(rotulo):
                st, corpo = self.post(d)
                self.assertEqual(st, 400)
                self.assertEqual(corpo["erro"], "pedido")
                self.assertNotIn("sotao", json.dumps(corpo))
        for bruto in (b"{", b"\xff", b"[" * 5000 + b"]" * 5000, b""):
            self.assertEqual(self.post(bruto)[0], 400)
        self.assertEqual(self.srv.planta.publica(), planta.vazia())

    def test_teto_de_64_kb_no_post(self):
        texto = json.dumps(OK).encode()
        no_teto = texto[:-1] + b" " * (planta.PLANTA_BYTES - len(texto)) + b"}"
        self.assertEqual(len(no_teto), planta.PLANTA_BYTES)
        self.assertEqual(self.post(no_teto[:-1] + b" }")[0], 400)   # JSON válido com 64 KB + 1
        self.assertEqual(self.post(no_teto), (200, {"rev": 1}))
        self.assertEqual(self.post(com(rev=1, **{k: NOS_LIMITES[k] for k in ("salas", "moveis", "novos")})), (200, {"rev": 2}))

    def test_rev_velho_409_com_o_atual(self):
        self.assertEqual(self.post(OK)[0], 200)
        for rev in (0, 2):
            self.assertEqual(self.post(com(rev=rev)), (409, {"erro": "rev", "mensagem": planta.MSG_REV, "rev": 1}))
        self.assertEqual(self.post(com(rev=1)), (200, {"rev": 2}))

    def test_dois_ao_mesmo_tempo_um_ganha(self):
        self.espera = 0.3   # o primeiro segura a trava enquanto grava
        resultados = []
        fios = [threading.Thread(target=lambda: resultados.append(self.post(OK)[0])) for _ in range(2)]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual(sorted(resultados), [200, 409])
        self.assertEqual(self.srv.planta.publica()["rev"], 1)

    def test_gravar_falhando(self):
        self.assertEqual(self.post(OK)[0], 200)
        self.falhar = True
        self.assertEqual(self.post(planta.vazia(1)), (500, {"erro": "gravar", "mensagem": planta.MSG_GRAVAR}))
        self.assertEqual(self.srv.planta.publica(), {**OK, "rev": 1})   # memória intacta
        self.assertEqual([l["resultado"] for l in self.logs if l["resultado"] != "salva"], ["planta_nao_gravou"])
        self.falhar = False
        self.assertEqual(self.post(planta.vazia(1)), (200, {"rev": 2}))

    def test_estaticos_do_editor_exigem_sessao(self):
        for nome in ("planta.js", "construir.html", "construir.js", "construir.css"):
            self.assertIn(nome, e.ARQUIVOS)
            self.assertNotIn(nome, e.PUBLICOS)
            st, _, h = self.req("/" + nome)
            self.assertEqual((st, h["Location"]), (302, "/entrar"), nome)


if __name__ == "__main__":
    unittest.main()
