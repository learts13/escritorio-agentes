# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""O tempo das cidades do mapa do mundo (POST /api/mundo/clima). Nenhum teste chama o Open-Meteo de verdade."""
import contextlib
import http.client
import io
import json
import os
import re
import tempfile
import threading
import unittest
from unittest.mock import patch

import escritorio as e

RECIFE = {"cidade": "Recife", "lat": -8.05, "lon": -34.88}
CHUVA_NOITE = {"weather_code": 61, "is_day": 0, "cloud_cover": 90, "wind_speed_10m": 25, "temperature_2m": 27.3}


def mundo_falso(resposta=None):
    """ClimaMundo com as cidades reais do mundo.json, relógio na mão e _consultar falso."""
    versao, cidades = e.ler_mundo()
    c = e.ClimaMundo(versao, cidades)
    c.agora, c.consultas = 1000.0, []
    c.relogio = lambda: c.agora
    c.resposta = resposta or (lambda coords: [dict(CHUVA_NOITE) for _ in coords])

    def consultar(coords):
        c.consultas.append(coords)
        return c.resposta(coords)
    c._consultar = consultar
    return c


def sem_rede(coords):
    raise OSError("https://api.open-meteo.com/v1/forecast?latitude=-8.05&longitude=-34.88 Recife 127.0.0.1")


class AcessoFalso:
    def sessao(self, token):
        return None


class Cidades(unittest.TestCase):
    def test_resposta_so_campos_fechados(self):
        c = mundo_falso()
        c.ciclo()
        foto = c.foto()
        ids = [cidade["id"] for cidade in c.cidades]
        self.assertEqual((len(ids), sorted(foto)), (28, sorted(ids)))
        for cid, tempo in foto.items():
            self.assertEqual(set(tempo), {"tipo", "vento", "noite"}, cid)
            self.assertIn(tempo["tipo"], e.TIPOS_CLIMA)
            self.assertIs(tempo["noite"], True)
            self.assertEqual(tempo["vento"], 0.5)   # 25 km/h / 50
        self.assertNotIn("27.3", json.dumps(foto))   # nada de temperatura
        # vento forte, valores estranhos e dia: vento preso em 0..1, tipo sempre da lista fechada
        estranhos = [{"weather_code": 95, "is_day": 1, "wind_speed_10m": 400},
                     {"weather_code": "x", "cloud_cover": "muito", "wind_speed_10m": float("nan")},
                     {"weather_code": 3, "wind_speed_10m": True},
                     "nem um objeto"]
        c.resposta = lambda coords: estranhos
        c.agora += 900
        with contextlib.redirect_stdout(io.StringIO()):
            c.ciclo()
        foto = c.foto()
        self.assertEqual(foto["rio-branco"], {"tipo": "tempestade", "vento": 1, "noite": False})
        self.assertEqual(foto["maceio"], {"tipo": "limpo", "vento": 0, "noite": False})
        self.assertEqual(foto["macapa"], {"tipo": "nublado", "vento": 0, "noite": False})
        self.assertEqual(foto["manaus"], {"tipo": "limpo", "vento": 0, "noite": False})

    def test_cache_15_min(self):
        c = mundo_falso()
        self.assertEqual(c.ciclo(), 900)
        self.assertEqual(c.consultas, [[(cidade["lat"], cidade["lon"]) for cidade in c.cidades]])   # uma consulta, na ordem
        c.agora += 899
        self.assertEqual(c.ciclo(), 1)
        self.assertEqual(len(c.consultas), 1)
        c.agora += 1
        c.ciclo()
        self.assertEqual(len(c.consultas), 2)

    def test_consulta_unica_ao_open_meteo(self):
        """O _consultar de verdade, com o urlopen falso: uma URL só com as 28 coordenadas, e a resposta de uma cidade só
        (objeto em vez de lista) também vale."""
        pedidos = []

        class Resposta:
            def __init__(self, corpo):
                self.corpo = corpo

            def read(self, n):
                return self.corpo[:n]

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

        def urlopen(req, timeout):
            pedidos.append((req.full_url, timeout))
            return Resposta(json.dumps({"current": CHUVA_NOITE}).encode())
        versao, cidades = e.ler_mundo()
        c = e.ClimaMundo(versao, cidades)
        with patch.object(e.urllib.request, "urlopen", urlopen):
            c.ciclo()
        self.assertEqual(len(pedidos), 1)
        url, timeout = pedidos[0]
        self.assertEqual(timeout, e.TIMEOUT)
        self.assertTrue(url.startswith("https://api.open-meteo.com/v1/forecast?"))
        q = dict(p.split("=", 1) for p in url.split("?", 1)[1].split("&"))
        self.assertEqual(e.urllib.parse.unquote(q["latitude"]).split(","), [str(x["lat"]) for x in cidades])
        self.assertEqual(e.urllib.parse.unquote(q["longitude"]).split(","), [str(x["lon"]) for x in cidades])
        self.assertEqual(e.urllib.parse.unquote(q["current"]), "weather_code,is_day,cloud_cover,wind_speed_10m")
        foto = c.foto()
        self.assertEqual(foto["rio-branco"], {"tipo": "chuva", "vento": 0.5, "noite": True})
        self.assertEqual(foto["maceio"], {"tipo": "limpo", "vento": 0, "noite": False})

    def test_falha_usa_ultimo_bom(self):
        c = mundo_falso()
        c.ciclo()
        bom = c.foto()
        c.resposta = sem_rede
        c.agora += 900
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(c.ciclo(), 900)
        self.assertEqual((len(c.consultas), c.foto()), (2, bom))

    def test_falha_sem_historico_e_limpo(self):
        c = mundo_falso(sem_rede)
        with contextlib.redirect_stdout(io.StringIO()):
            c.ciclo()
        foto = c.foto()
        self.assertEqual(len(foto), 28)
        self.assertEqual(set(json.dumps(v, sort_keys=True) for v in foto.values()),
                         {json.dumps({"tipo": "limpo", "vento": 0, "noite": False}, sort_keys=True)})

    def test_cidade_faltando_vira_limpo(self):
        c = mundo_falso(lambda coords: [dict(CHUVA_NOITE) for _ in coords[:-1]])   # 27 de 28
        c.ciclo()
        foto = c.foto()
        ultima = c.cidades[-1]["id"]
        self.assertEqual(foto[ultima], {"tipo": "limpo", "vento": 0, "noite": False})
        self.assertEqual(sum(1 for v in foto.values() if v["tipo"] == "chuva"), 27)
        c.resposta = lambda coords: [dict(CHUVA_NOITE)]   # uma só
        c.agora += 900
        c.ciclo()
        self.assertEqual(sum(1 for v in c.foto().values() if v["tipo"] == "chuva"), 1)


class Casa(unittest.TestCase):
    def test_sem_cidade_configurada_casa_none(self):
        _, cidades = e.ler_mundo()
        self.assertIsNone(e.cidade_do_escritorio(None, cidades))
        self.assertIsNone(e.cidade_do_escritorio({"cidade": "Recife"}, cidades))
        self.assertIsNone(e.cidade_do_escritorio(RECIFE, []))
        self.assertEqual(e.cidade_do_escritorio(RECIFE, cidades), "recife")
        self.assertEqual(e.cidade_do_escritorio({"cidade": "Mateus Leme", "lat": -19.98, "lon": -44.43}, cidades),
                         "mateus-leme")
        self.assertEqual(e.cidade_do_escritorio({"cidade": "Campinas", "lat": -22.91, "lon": -47.06}, cidades), "sao-paulo")
        # mais de 300 km da cidade mais perto do mapa: sem casa
        self.assertIsNone(e.cidade_do_escritorio({"cidade": "Lisboa", "lat": 38.72, "lon": -9.14}, cidades))
        self.assertAlmostEqual(e.distancia_km(-23.55, -46.63, -22.91, -47.06), 83.6, delta=1)

    def test_mundo_ausente(self):
        with tempfile.TemporaryDirectory() as pasta:
            self.assertEqual(e.ler_mundo(os.path.join(pasta, "mundo.json")), (0, []))
            ruim = os.path.join(pasta, "ruim.json")
            with open(ruim, "w", encoding="utf-8") as f:
                f.write('{"versao": 1, "cidades": [{"id": "x"}]}')
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(e.ler_mundo(ruim), (0, []))


class Rota(unittest.TestCase):
    def setUp(self):
        self.servidor = e.Servidor(("127.0.0.1", 0), e.Pagina)
        self.servidor.acesso = AcessoFalso()
        self.thread = threading.Thread(target=self.servidor.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.servidor.shutdown()
        self.servidor.server_close()
        self.thread.join()

    def pedir(self, dados, origem=None, cookie=None):
        conexao = http.client.HTTPConnection(*self.servidor.server_address, timeout=3)
        cabecalhos = {"Origin": e.BASE if origem is None else origem, "Content-Type": "application/json"}
        if cookie:
            cabecalhos["Cookie"] = cookie
        try:
            conexao.request("POST", "/api/mundo/clima", json.dumps(dados), cabecalhos)
            resposta = conexao.getresponse()
            return resposta.status, dict(resposta.getheaders()), json.loads(resposta.read())
        finally:
            conexao.close()

    def test_rota_publica_sem_cookie(self):
        c = mundo_falso()
        c.ciclo()
        self.servidor.clima_mundo = c
        with patch.object(e, "clima_vigente", lambda: (RECIFE, "arquivo")):
            status, cab, dados = self.pedir({})
            self.assertEqual(self.pedir({"cidade": "recife"})[0], 400)
            self.assertEqual(self.pedir({}, origem="https://outro.example")[0], 403)
        self.assertEqual((status, cab["Cache-Control"]), (200, "no-store"))
        self.assertNotIn("Set-Cookie", cab)
        self.assertEqual(set(dados), {"cidades", "casa", "versao", "festas_desligadas"})
        self.assertEqual((dados["casa"], dados["versao"], len(dados["cidades"])), ("recife", c.versao, 28))
        self.assertEqual(dados["cidades"]["recife"], {"tipo": "chuva", "vento": 0.5, "noite": True})
        for dado in ("Recife", "-8.05", "lat", "27.3"):
            self.assertNotIn(dado, json.dumps(dados))
        with patch.object(e, "clima_vigente", lambda: (None, "nenhum")):
            self.assertIsNone(self.pedir({})[2]["casa"])

    def test_rota_sem_mundo(self):
        self.servidor.clima_mundo = e.ClimaMundo(0, [])
        vazio = {"cidades": {}, "casa": None, "versao": 0, "festas_desligadas": []}
        with patch.object(e, "clima_vigente", lambda: (RECIFE, "arquivo")), self.festas(None):
            self.assertEqual(self.pedir({})[2], vazio)
            del self.servidor.clima_mundo   # servidor sem a thread: mesma resposta
            self.assertEqual(self.pedir({})[2], vazio)

    @contextlib.contextmanager
    def festas(self, conteudo):
        """dados/festas.json numa pasta temporária, com `conteudo` (None: sem o arquivo)."""
        with tempfile.TemporaryDirectory() as pasta:
            arq = os.path.join(pasta, "festas.json")
            if conteudo is not None:
                with open(arq, "w", encoding="utf-8") as f:
                    f.write(conteudo if isinstance(conteudo, str) else json.dumps(conteudo))
            with patch.object(e, "ARQ_FESTAS", arq), contextlib.redirect_stdout(io.StringIO()):
                yield

    def test_festas_desligadas_so_do_catalogo(self):
        """Só as chaves do calendário embutido que a instalação desligou; nada das datas próprias (nome, data, falas)."""
        c = mundo_falso()
        c.ciclo()
        self.servidor.clima_mundo = c
        propria = {"nome": "Aniversario Sigiloso", "data": "2026-03-15", "dias": 2, "tema": "natal",
                   "falas": ["Fala reservada"]}
        salvo = {"v": 1, "rev": 3, "proprias": [propria], "desligadas": ["halloween", "naoexiste", "natal"]}
        with patch.object(e, "clima_vigente", lambda: (RECIFE, "arquivo")), self.festas(salvo):
            status, _, dados = self.pedir({})
        self.assertEqual(status, 200)
        self.assertEqual(dados["festas_desligadas"], ["halloween", "natal"])   # "naoexiste" fica de fora
        corpo = json.dumps(dados, ensure_ascii=False)
        for dado in ("Aniversario", "Sigiloso", "2026-03-15", "03-15", "Fala reservada", "proprias", "naoexiste"):
            self.assertNotIn(dado, corpo)
        # arquivo fora do formato (vale como ausente) e sem arquivo: lista vazia
        for conteudo in ('{"v": 1, "rev": 0, "proprias": [], "desligadas": "natal"}', "{nem json", None):
            with self.festas(conteudo):
                self.assertEqual(self.pedir({})[2]["festas_desligadas"], [], conteudo)

    def test_catalogo_de_festas_igual_ao_do_navegador(self):
        """As chaves aceitas pela rota são as do FESTAS de static/festas.js, nem mais nem menos."""
        with open(os.path.join(e.ESTATICO, "festas.js"), encoding="utf-8") as f:
            js = f.read()
        bloco = js[js.index("const FESTAS = {"):js.index("};", js.index("const FESTAS = {"))]
        chaves = set(re.findall(r"^\s+(\w+):\s*\{ nome:", bloco, re.M))
        self.assertEqual(len(chaves), 13)
        self.assertEqual(set(e.FESTAS_CATALOGO), chaves)

    def test_log_sem_ip_nem_cidade(self):
        saida = io.StringIO()
        c = mundo_falso(sem_rede)
        self.servidor.clima_mundo = c
        with contextlib.redirect_stdout(saida), patch.object(e, "clima_vigente", lambda: (RECIFE, "arquivo")):
            c.ciclo()
            self.assertEqual(self.pedir({})[0], 200)
        log = saida.getvalue()
        self.assertIn("OSError", log)
        for dado in ("127.0.0.1", "Recife", "recife", "-8.05", "-34.88", "latitude", "open-meteo"):
            self.assertNotIn(dado, log)

    def test_publicos_do_mundo(self):
        for nome in ("mundo/terra.png", "mundo/brasil.png", "mundo/mundo.json", "mundo/atlas.png", "mundo/atlas.json",
                     "mundo_globo.js", "mundo_mapa.js", "mundo_mapa_arte.js", "mundo_cidade.js", "mundo_cidade_planta.js", "mundo_bairro.js",
                     "avatar.js", "festas.js", "mundo_festa.js", "mundo_cidade_chao.js", "mundo_cidade_letreiro.js",
                     "mundo_mapa_perto.js", "mundo/perto/ufs.json") + tuple(f"mundo/perto/{i}-{j}.png" for i in range(4) for j in range(4)):
            self.assertIn(nome, e.PUBLICOS)
            self.assertIn(nome, e.ARQUIVOS)
            self.assertTrue(os.path.isfile(os.path.join(e.ESTATICO, nome)), nome)
        # o nível de 4x: os 64 nomes liberados; os que a máscara do mundo.json diz que existem, no disco
        with open(os.path.join(e.ESTATICO, "mundo", "mundo.json"), encoding="utf-8") as f:
            mascara = json.load(f)["niveis"]["brasil"]["perto4x"]["azulejos"]
        for k, c in enumerate(mascara):
            nome = f"mundo/perto4x/{k % 8}-{k // 8}.png"
            self.assertIn(nome, e.PUBLICOS)
            self.assertEqual(os.path.isfile(os.path.join(e.ESTATICO, nome)), c == "1", nome)

    def test_arquivos_do_mundo_sem_cookie(self):
        for nome, tipo in (("mundo/brasil.png", "image/png"), ("mundo/mundo.json", "application/json"),
                           ("mundo/perto/2-2.png", "image/png"), ("mundo/perto4x/6-5.png", "image/png"),
                           ("mundo/perto/ufs.json", "application/json"), ("mundo_mapa_perto.js", "text/javascript; charset=utf-8")):
            conexao = http.client.HTTPConnection(*self.servidor.server_address, timeout=3)
            try:
                conexao.request("GET", "/" + nome)
                resposta = conexao.getresponse()
                corpo = resposta.read()
                self.assertEqual((resposta.status, resposta.getheader("Content-Type")), (200, tipo), nome)
                with open(os.path.join(e.ESTATICO, nome), "rb") as f:
                    self.assertEqual(corpo, f.read(), nome)
            finally:
                conexao.close()


if __name__ == "__main__":
    unittest.main()
