"""Página Novidades: novidades.py (o parser do changelog e a memória pelo mtime) e a rota GET /api/novidades.
Uso: python -B -m unittest test_novidades
"""
import atexit
import json
import os
import re
import shutil
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

PASTA = tempfile.mkdtemp(prefix="escritorio-teste-novidades-")
os.environ.setdefault("ESCRITORIO_DADOS", PASTA)   # rodando junto com o test_escritorio, vale a pasta dele
if "ESCRITORIO_TIMES" not in os.environ:
    os.environ["ESCRITORIO_TIMES"] = os.path.join(PASTA, "times.json")
    with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as _f:
        json.dump({"conversas": "ler"}, _f)
os.environ.setdefault("AGENTES_ORG", "00000000-0000-4000-8000-000000000000")  # org fictícia
import escritorio as e  # noqa: E402
import novidades  # noqa: E402
from acesso import Acesso  # noqa: E402
from novidades import REPO, analisar  # noqa: E402

# até o fim do processo, e não no tearDownModule: no discover, o escritorio pode ter sido importado com esta pasta
atexit.register(shutil.rmtree, PASTA, ignore_errors=True)
RAIZ = os.path.dirname(os.path.abspath(__file__))


def links(texto):
    return [m.group(2) for m in novidades.LINK.finditer(texto)]


class Logs(list):
    def __call__(self, **campos):
        self.append(campos)


class ChangelogReal(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(RAIZ, "CHANGELOG.pt-BR.md"), encoding="utf-8") as f:
            self.entradas = analisar(f.read())

    def test_entradas_titulos_e_secoes(self):
        primeira = self.entradas[0]
        self.assertEqual((primeira["titulo"], primeira["versao"], primeira["data"]),
                         ("Mundo e visitas por convite", e.VERSAO, "2026-11-10"))   # o changelog do repositório é o desta versão
        self.assertEqual([s["nome"] for s in primeira["secoes"]], ["Adicionado", "Mudado"])
        self.assertEqual([(x["titulo"], x["versao"], x["data"]) for x in self.entradas[1:4]],
                         [("Novidades", "1.2.0", "2026-11-08"),
                          ("Conectar, Configurações, modo TV, jornal e aviso no celular", "1.1.0", "2026-11-08"),
                          ("Modo construção v1", None, "2026-11-06")])
        self.assertEqual([s["nome"] for s in self.entradas[1]["secoes"]], ["Adicionado", "Mudado", "Segurança"])
        self.assertEqual([s["nome"] for s in self.entradas[2]["secoes"]], ["Adicionado", "Mudado", "Segurança", "Corrigido"])
        self.assertEqual(self.entradas[-1]["titulo"], "Primeira versão pública")
        self.assertLessEqual(len(self.entradas), novidades.ENTRADAS_MAX)
        datas = [ent["data"] for ent in self.entradas]
        self.assertEqual(datas, sorted(datas, reverse=True))
        for ent in self.entradas:
            self.assertEqual(set(ent), {"titulo", "versao", "data", "secoes"})
            for sec in ent["secoes"]:
                self.assertTrue(sec["itens"])
                self.assertTrue(all(isinstance(i, str) and 0 < len(i) <= novidades.ITEM_MAX for i in sec["itens"]))

    def test_itens_em_markdown_cru_e_links_so_do_repositorio(self):
        itens = [i for ent in self.entradas for sec in ent["secoes"] for i in sec["itens"]]
        self.assertTrue(itens[0].startswith("**Mundo:** `/mundo.html`, uma página pública"))
        self.assertFalse(any("] (" in i for i in itens))   # nenhum "](" do changelog real foi desarmado
        todos = [u for i in itens for u in links(i)]
        self.assertTrue(todos)
        self.assertTrue(all(u.startswith(REPO) for u in todos), todos)
        self.assertIn(REPO + "blob/main/README.pt-BR.md#conectar-ao-agenteschat", todos)   # o relativo ./README…
        self.assertIn(REPO + "blob/main/README.pt-BR.md#modo-construção", todos)   # âncora com acento
        self.assertFalse(any("./" in u for u in todos))


class CasosRuins(unittest.TestCase):
    def test_vazio_e_sem_entradas(self):
        self.assertEqual(analisar(""), [])
        self.assertEqual(analisar("# Histórico\n\nNada ainda.\n- solto\n### Adicionado\n- sem entrada\n"), [])

    def test_sem_secoes_e_secao_vazia(self):
        self.assertEqual(analisar("## 2026-01-02 · Só o título\n\nUm parágrafo.\n- item sem seção\n### Vazia\n\n### \n- x\n"),
                         [{"titulo": "Só o título", "versao": None, "data": "2026-01-02", "secoes": []}])

    def test_item_gigante_e_continuacao(self):
        ent = analisar("## 2026-01-02 · X\n### Adicionado\n- " + "a" * 5000 + "\n- primeira linha\n  continua aqui\n\n  fora\n")
        itens = ent[0]["secoes"][0]["itens"]
        self.assertEqual((len(itens[0]), itens[0][-1]), (novidades.ITEM_MAX, "…"))
        self.assertEqual(itens[1], "primeira linha continua aqui")
        self.assertEqual(len(itens), 2)

    def test_titulos_estranhos(self):
        texto = "\n".join([
            "## [Não lançado]", "### Adicionado", "- sem data: fica de fora",
            "## 1.2.0", "### Adicionado", "- sem data também",
            "## 1.2.0 · 2026-13-40 · Data impossível", "### Adicionado", "- fora",
            "## 2.0.0 · 2026-03-01", "### Adicionado", "- só versão e data",
            "## 2026-02-01", "### Adicionado", "- só a data",
            "## 2026-01-01 · 3.0.0 · <img src=x onerror=alert(1)> · " + "t" * 300, "### Adicionado", "- título cru",
        ])
        ents = analisar(texto)
        self.assertEqual([(x["titulo"], x["versao"], x["data"]) for x in ents[:2]],
                         [("2.0.0", "2.0.0", "2026-03-01"), ("2026-02-01", None, "2026-02-01")])
        estranho = ents[2]
        self.assertEqual((estranho["versao"], estranho["data"]), (None, "2026-01-01"))   # versão só vale no começo
        self.assertTrue(estranho["titulo"].startswith("3.0.0 · <img src=x onerror=alert(1)> · t"))   # cru: o navegador usa textContent
        self.assertEqual((len(estranho["titulo"]), estranho["titulo"][-1]), (novidades.TITULO_MAX, "…"))
        self.assertEqual(len(ents), 3)

    def test_links_fora_do_repositorio_viram_texto(self):
        item = ("[a](https://keepachangelog.com/pt-BR/1.1.0/) [b](javascript:alert(1)) [c](./../segredo) "
                "[d](https://github.com/HelbertMoura/escritorio-agentes.evil/x) [`e`](https://github.com/HelbertMoura/escritorio-agentes/"
                "releases/tag/v1.1.0) [f](./CONTRIBUTING.md) [g](#ancora) [h](http://github.com/HelbertMoura/escritorio-agentes/)")
        saida = analisar("## 2026-01-01 · X\n### Adicionado\n- " + item)[0]["secoes"][0]["itens"][0]
        self.assertEqual(saida, "a b) c d [`e`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.1.0) "
                                "[f](https://github.com/HelbertMoura/escritorio-agentes/blob/main/CONTRIBUTING.md) g h")
        self.assertNotIn("javascript", saida)

    def test_link_aninhado_e_ponto_ponto_viram_texto(self):
        # B1 do QA: o re.sub de uma volta só deixava sair [b](javascript:y), e o ".." passava depois do REPO
        casos = {
            "[[b](javascript:x)](javascript:y)": "[b] (javascript:y)",
            "[[[c](javascript:x)](https://evil.example/)](javascript:z)": "[[c] (https://evil.example/)] (javascript:z)",
            "[[d](./README.md)](javascript:y)": "[[d](https://github.com/HelbertMoura/escritorio-agentes/blob/main/README.md)] (javascript:y)",
            "[b](javascript:x[)": "[b] (javascript:x[)",
            "[b](javascript:x](y)": "b",
            "[e](https://github.com/HelbertMoura/escritorio-agentes/../../evil)": "e",
            "[f](https://github.com/HelbertMoura/escritorio-agentes/blob/main/%2E%2e/x)": "f",
            "[g](https://github.com/HelbertMoura/escritorio-agentes/./x)": "g",
            "[h](./docs/../../x)": "h",
            "[`i`](https://github.com/HelbertMoura/escritorio-agentes/compare/v2026.11.06...v1.1.0)":
                "[`i`](https://github.com/HelbertMoura/escritorio-agentes/compare/v2026.11.06...v1.1.0)",
            "[j](https://github.com/HelbertMoura/escritorio-agentes/blob/main/README.md#x..y)":
                "[j](https://github.com/HelbertMoura/escritorio-agentes/blob/main/README.md#x..y)",
            "[a[k](javascript:x)": "[ak",
        }
        # o mesmo regex do novidades.js: todo link que o navegador achar no que sai daqui aponta para o REPO
        navegador = re.compile(r"\[([^\]]+)\]\(([^)\s]+)\)")
        for item, esperado in casos.items():
            saida = analisar("## 2026-01-01 · X\n### Adicionado\n- " + item)[0]["secoes"][0]["itens"][0]
            self.assertEqual(saida, esperado, item)
            self.assertTrue(all(novidades.do_repo(m.group(2)) for m in navegador.finditer(saida)), item)

    def test_milhares_de_colchetes_em_tempo_linear(self):
        # B2 do QA: 16 mil "[" num item levavam 2,5 s; agora o item é cortado antes da regex e o texto do link para no "["
        # um item enorme de cada, e mais um changelog de ~1 MB (o teto do arquivo) só com itens hostis de 4 mil caracteres
        hostis = ["[" * 300_000, "[a](" * 75_000, "[[x](y)" * 40_000, "[" * 2000 + "x](y)" * 400, "](" * 150_000]
        hostis += [h[:4000] for h in hostis] * 50
        texto = "## 2026-01-01 · X\n### Adicionado\n" + "".join(f"- {h}\n" for h in hostis)
        inicio = time.perf_counter()
        itens = analisar(texto)[0]["secoes"][0]["itens"]
        self.assertLess(time.perf_counter() - inicio, 1.0)
        self.assertTrue(all(len(i) <= novidades.ITEM_MAX for i in itens))
        self.assertEqual(len(itens), 255)

    def test_no_maximo_dez_das_mais_novas_e_o_mesmo_dia_na_ordem_do_arquivo(self):
        texto = "".join(f"## 2026-01-{d:02d} · E{d}\n### Adicionado\n- i\n" for d in range(1, 13))
        texto += "## 2026-01-12 · Mesmo dia, depois\n### Adicionado\n- i\n"
        self.assertEqual([x["titulo"] for x in analisar(texto)],
                         ["E12", "Mesmo dia, depois", "E11", "E10", "E9", "E8", "E7", "E6", "E5", "E4"])


class Memoria(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="novidades-")
        self.arq = os.path.join(self.pasta, "CHANGELOG.pt-BR.md")
        self.logs = Logs()
        self.n = novidades.Novidades(self.arq, self.logs)

    def tearDown(self):
        shutil.rmtree(self.pasta, ignore_errors=True)

    def grava(self, conteudo, mtime):
        with open(self.arq, "wb") as f:
            f.write(conteudo)
        os.utime(self.arq, (mtime, mtime))

    def test_ausente_ilegivel_e_de_volta_com_um_log_por_estado(self):
        self.assertEqual((self.n.publico(), self.n.publico()), ([], []))
        self.assertEqual(self.logs, [{"evento": "novidades", "resultado": "ilegivel", "detalhe": "FileNotFoundError"}])
        self.grava(b"## 2026-01-01 \xff\n", 1_000)
        self.assertEqual((self.n.publico(), self.n.publico()), ([], []))
        self.assertEqual(self.logs[-1]["detalhe"], "UnicodeDecodeError")
        self.grava(b"## 2026-01-01 \xc3\xa9\n" + b"x" * novidades.ARQUIVO_MAX, 2_000)
        self.assertEqual(self.n.publico(), [])
        self.assertEqual((len(self.logs), self.logs[-1]["detalhe"]), (3, "ValueError"))
        self.grava("﻿## 2026-01-01 · Volta\n### Adicionado\n- ok\n".encode(), 3_000)   # com BOM
        self.assertEqual(self.n.publico()[0]["secoes"], [{"nome": "Adicionado", "itens": ["ok"]}])
        self.assertEqual(len(self.logs), 3)

    def test_relido_so_quando_o_arquivo_muda(self):
        self.grava(b"## 2026-01-01 \xc2\xb7 A\n", 1_000)
        self.assertEqual(self.n.publico()[0]["titulo"], "A")
        self.grava(b"## 2026-01-01 \xc2\xb7 B\n", 1_000)   # mesmo mtime e tamanho: fica a memória
        self.assertEqual(self.n.publico()[0]["titulo"], "A")
        os.utime(self.arq, (2_000, 2_000))
        self.assertEqual(self.n.publico()[0]["titulo"], "B")

    def test_resultado_ruim_tambem_fica_na_memoria(self):
        # B3 do QA: o UTF-8 inválido era relido e decodificado a cada GET
        self.grava(b"## 2026-01-01 \xff A\n", 1_000)
        self.assertEqual(self.n.publico(), [])
        self.grava(b"## 2026-01-01 \xc2\xb7A\n", 1_000)   # mesmo mtime e tamanho, agora legível: não é relido
        self.assertEqual((self.n.publico(), len(self.logs)), ([], 1))
        os.utime(self.arq, (2_000, 2_000))
        self.assertEqual((self.n.publico()[0]["titulo"], len(self.logs)), ("A", 1))


class Rota(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Leitor:
            def foto(self):
                return {"agentes": [], "trabalhos": [], "atualizado": None, "erro": None}
        cls.dados = tempfile.mkdtemp(prefix="novidades-rota-")
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

    def req(self, cab=None, dados=None):
        r = urllib.request.Request(self.base + "/api/novidades", headers=cab or {}, data=dados)
        try:
            with urllib.request.urlopen(r) as x:
                return x.status, json.loads(x.read())
        except urllib.error.HTTPError as err:
            with err:
                return err.code, err.read()

    def test_so_com_sessao_e_so_get(self):
        self.assertEqual(self.req(), (401, '{"erro": "entre de novo"}'.encode()))
        st, corpo = self.req(self.sessao)
        self.assertEqual((st, set(corpo), corpo["versao"]), (200, {"versao", "entradas"}, e.VERSAO))
        self.assertEqual(corpo["entradas"][0]["versao"], e.VERSAO)   # o changelog do repositório é o desta versão
        antes, e.BASE = e.BASE, self.base   # com a origem certa, para o POST chegar à rota
        try:
            post = {**self.sessao, "Origin": self.base, "Content-Type": "application/json"}
            self.assertEqual(self.req(post, b"{}")[0], 404)
        finally:
            e.BASE = antes

    def test_changelog_ausente_responde_vazio(self):
        antes = e.NOVIDADES
        e.NOVIDADES = novidades.Novidades(os.path.join(self.dados, "nao-existe.md"), Logs())
        try:
            self.assertEqual(self.req(self.sessao), (200, {"versao": e.VERSAO, "entradas": []}))
            self.assertEqual(len(e.NOVIDADES.log), 1)
        finally:
            e.NOVIDADES = antes


if __name__ == "__main__":
    unittest.main()
