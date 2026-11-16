# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""1.6 Onda 2 pelo HTTP: conversas da equipe (canal, histórico, DM, menção, mural, status, aceno), a auditoria de DM
(E.3), o push com o começo da mensagem (E.4) e o anexo (E.5). Servidor de verdade em 127.0.0.1, leitores falsos."""
import contextlib
import hashlib
import http.client
import io
import json
import os
import shutil
import socket
import struct
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
import zlib
from unittest import mock

import andares
import avisos
import conversas_equipe
import escritorio as e
from acesso import Acesso

SENHA, SENHA_DONO = "senha-da-pessoa-1", "senha-bem-grande"
AVATAR = {"color": "rose", "eyes": "round", "accessory": "cap"}
ORG_B, ORG_C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
GPS = b"GPSLatitude-23.5505GPSLongitude-46.6333"
PAINEL = {"X-Escritorio": "1"}   # o cabeçalho do painel nas rotas da auditoria


def _chunk(tipo, dados):
    return struct.pack(">I", len(dados)) + tipo + dados + struct.pack(">I", zlib.crc32(tipo + dados))


PNG_GPS = (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
           + _chunk(b"eXIf", b"MM\x00*" + GPS) + _chunk(b"IDAT", zlib.compress(b"\x00\x00")) + _chunk(b"IEND", b""))
JPEG_GPS = (b"\xff\xd8" + b"\xff\xe1" + struct.pack(">H", len(GPS) + 8) + b"Exif\x00\x00" + GPS
            + b"\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00" + b"\x12\x34" + b"\xff\xd9")


class Leitor:
    def foto(self):
        return {**e.resumir([], []), "atualizado": None, "erro": None, "conexao": "conectado"}

    def conversas_do_dia(self):
        return {"por_id": {}, "mudou": {}}


class Http(unittest.TestCase):
    """O cliente HTTP dos testes (sessão por cookie, Origin igual à BASE)."""

    @classmethod
    def req(cls, rota, cab=None, dados=None, metodo=None):
        r = urllib.request.Request(cls.base + rota, headers=cab or {}, data=dados, method=metodo)
        try:
            with urllib.request.urlopen(r) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers

    @classmethod
    def get(cls, rota, quem, extra=None):
        st, corpo, _ = cls.req(rota, {**cls.cab[quem], **(extra or {})})
        try:
            return st, json.loads(corpo)
        except ValueError:
            return st, corpo

    @classmethod
    def post(cls, rota, quem, obj):
        h = {**cls.cab[quem], "Content-Type": "application/json", "Origin": cls.base}
        st, corpo, _ = cls.req(rota, h, json.dumps(obj).encode(), "POST")
        return st, json.loads(corpo) if corpo else None

    @classmethod
    def anexo(cls, rota, quem, dados, nome, texto=None):
        h = {**cls.cab[quem], "Content-Type": "application/octet-stream", "Origin": cls.base,
             "X-Nome": urllib.parse.quote(nome, safe="")}
        if texto is not None:
            h["X-Texto"] = urllib.parse.quote(texto, safe="")
        st, corpo, _ = cls.req(rota, h, dados, "POST")
        return st, json.loads(corpo) if corpo else None

    @classmethod
    def entrar_no_mapa(cls, quem, andar, sala="lounge"):
        time.sleep(0.6)   # o balde da presença (2 por segundo)
        st, r = cls.post(f"/api/presenca?andar={andar}", quem, {"x": 10, "y": 10, "destino": None, "sala": sala,
                                                                 "olha": "baixo"})
        assert st == 200, (st, r)


class Predio(Http):
    """Modo clássico com dois andares extras: B (ana, bia, beto admin) e C (carlos). O dono administra o prédio."""

    @classmethod
    def setUpClass(cls):
        cls.dados = tempfile.mkdtemp(prefix="conversas-http-")
        cls.antes = e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE
        junta = lambda nome: os.path.join(cls.dados, nome)
        e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE = junta("times.json"), junta("planta.json"), junta("equipe.json")
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"conversas": "ler", "times": []}, f)
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.dados = cls.dados
        cls.srv.leitor, cls.srv.cred = Leitor(), None
        cls.srv.acesso = Acesso(junta("contas"))
        cls.srv.registro_andares = andares.Andares(cls.dados, e.ORG)
        cls.srv.andares = {}
        for nome, org in (("Marketing", ORG_B), ("Vendas", ORG_C)):
            reg = cls.srv.registro_andares.criar(nome, org)
            andar = e.Andar(reg, cls.dados)
            andar.leitor = Leitor()
            cls.srv.andares[reg["id"]] = andar
        cls.B, cls.C = list(cls.srv.andares)
        cls.enviados = []
        cls.srv.avisos = avisos.Avisos("CHAVE", lambda endpoint, agora: "vapid", lambda **k: None, e.FUSO,
                                       enviar=cls.enviados.append, preferencia=cls.srv.acesso.avisos_de,
                                       pode=lambda conta, andar: e.recebe_avisos(cls.srv, conta, andar))
        cls.srv.avisos.resolver = e.resolver_de_avisos(cls.srv)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        e.BASE = cls.base
        acesso = cls.srv.acesso
        with open(os.path.join(cls.dados, "contas", "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        acesso.criar_primeiro(codigo, "dono", SENHA_DONO)
        cls.cab = {"dono": {"Cookie": "esc_sessao=" + acesso.entrar("dono", SENHA_DONO)}}
        for usuario, nome, andar, papel in (("ana", "Ana", cls.B, "membro"), ("bia", "Bia", cls.B, "membro"),
                                            ("beto", "Beto", cls.B, "admin"), ("carlos", "Carlos", cls.C, "membro"),
                                            ("cida", "Cida", cls.C, "admin")):
            token, _ = acesso.convidar(nome, [andar], principal=False)
            cls.cab[usuario] = {"Cookie": "esc_sessao=" + acesso.aceitar_convite(token, usuario, SENHA, nome, AVATAR)}
            if papel == "admin":
                acesso.mudar_papel(usuario, "admin", andar)

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        for eq in cls.srv.equipes.values():
            eq.fechar()
        e.BASE, e.TIMES, e.ARQ_PLANTA, e.ARQ_EQUIPE = cls.antes
        shutil.rmtree(cls.dados, ignore_errors=True)

    def eq(self, andar):
        return self.srv.equipe_de(self.srv.andares[andar])

    def envia(self, quem, canal, texto, andar=None):
        time.sleep(0.25)   # o balde do envio (1 por segundo, rajada de 5)
        st, r = self.post(f"/api/canal/enviar?andar={andar or self.B}", quem, {"canal": canal, "texto": texto})
        self.assertEqual(st, 200, r)
        return r["mensagem"]

    def dm(self, quem, com):
        st, r = self.post(f"/api/dm/abrir?andar={self.B}", quem, {"com": com})
        self.assertEqual(st, 200, r)
        return r["canal"]


class Ligado(unittest.TestCase):
    def test_liga_com_conta_ou_andares_json(self):
        class Srv:
            registro_andares = None
            acesso = type("A", (), {"usuarios": {}})()
        srv = Srv()
        self.assertFalse(e.equipe_ligada(srv))
        srv.acesso.usuarios = {"ana": {}}
        self.assertTrue(e.equipe_ligada(srv))
        srv.acesso.usuarios = {}
        pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, pasta, True)
        srv.registro_andares = andares.Andares(pasta, e.ORG)
        self.assertFalse(e.equipe_ligada(srv))
        srv.registro_andares.criar("B", ORG_B)
        self.assertTrue(e.equipe_ligada(srv))


class AcessoSemContas:
    """O escritório de antes da 1.6: login sem contas nem papéis (todo logado é admin)."""
    def sessao(self, token):
        return "equipe" if token == "sessao-antiga" else None


class Desligado(Http):
    """Condição (3): sem conta e sem andares.json, as rotas novas dão 404 e o config e o ao-vivo ficam como antes."""

    @classmethod
    def setUpClass(cls):
        cls.dados = tempfile.mkdtemp(prefix="conversas-desligado-")
        cls.antes = e.BASE, e.TIMES
        e.TIMES = os.path.join(cls.dados, "times.json")
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"conversas": "ler", "times": []}, f)
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.dados = cls.dados
        cls.srv.leitor, cls.srv.cred, cls.srv.acesso = Leitor(), None, AcessoSemContas()
        cls.srv.registro_andares = andares.Andares(cls.dados, e.ORG)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = e.BASE = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        cls.cab = {"equipe": {"Cookie": e.nome_cookie() + "=sessao-antiga", **PAINEL}}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        e.BASE, e.TIMES = cls.antes
        shutil.rmtree(cls.dados, ignore_errors=True)

    def test_rotas_novas_404_config_e_ao_vivo_como_antes(self):
        self.assertFalse(e.equipe_ligada(self.srv))
        for rota in sorted(e.EQUIPE_GET | e.AUDITORIA_GET):
            st, r = self.get(rota + "?canal=geral&id=1", "equipe")
            self.assertEqual((st, r["erro"]), (404, "desligado"), rota)
        for rota in sorted(e.EQUIPE_POST - {"/api/anexo"}) + ["/api/canal/retencao"]:
            self.assertEqual(self.post(rota, "equipe", {})[0], 404, rota)
        self.assertEqual(self.anexo("/api/anexo?canal=geral", "equipe", b"oi", "x.txt")[0], 404)
        st, cfg = self.get("/api/config", "equipe")
        self.assertEqual(st, 200)
        self.assertIsNone(cfg["equipe"])
        st, vivo = self.get("/api/ao-vivo?canal=geral&depois=0", "equipe")
        self.assertEqual(st, 200)
        self.assertFalse(set(vivo) & {"meu_status", "acenos", "mural_v", "nao_lidas", "mencoes", "aberto", "no_predio"})
        self.assertFalse(any("status" in p for p in vivo["pessoas"]))
        self.assertEqual(self.srv.equipes, {})
        self.assertFalse(os.path.exists(os.path.join(self.dados, "equipe.db")))


class Canais(Predio):
    def test_config_traz_equipe(self):
        st, cfg = self.get(f"/api/config?andar={self.B}", "ana")
        eq = cfg["equipe"]
        self.assertEqual((eq["retencao"], eq["dm"], eq["anexo"], eq["auditoria"], eq["pode_moderar"]),
                         (365, True, True, False, False))
        self.assertIn("Marketing", eq["aviso_dm"])
        self.assertTrue(self.get(f"/api/config?andar={self.B}", "beto")[1]["equipe"]["auditoria"])
        self.assertFalse(self.get(f"/api/config?andar={self.B}", "dono")[1]["equipe"]["auditoria"])   # não é admin de B

    def test_cota_de_anexos_so_para_quem_cuida_do_prazo(self):
        cota = self.get(f"/api/config?andar={self.B}", "beto")[1]["equipe"]["cota"]
        self.assertEqual(cota["total"], 5 * 1024 ** 3)
        self.assertIsInstance(cota["usado"], int)
        self.assertIsNone(self.get(f"/api/config?andar={self.B}", "ana")[1]["equipe"]["cota"])    # membro
        self.assertIsNone(self.get(f"/api/config?andar={self.B}", "dono")[1]["equipe"]["cota"])   # o admin do prédio só lê

    def test_enviar_historico_lida_e_deltas_do_ao_vivo(self):
        m1 = self.envia("ana", "geral", "bom dia")
        m2 = self.envia("ana", "geral", "tudo bem?")
        self.assertEqual((m1["usuario"], m1["nome"], m1["texto"]), ("ana", "Ana", "bom dia"))
        st, h = self.get(f"/api/canal/historico?andar={self.B}&canal=geral&limite=1", "bia")
        self.assertEqual((st, [m["id"] for m in h["mensagens"]], h["mais"]), (200, [m2["id"]], True))
        st, h = self.get(f"/api/canal/historico?andar={self.B}&canal=geral&antes={m2['id']}", "bia")
        self.assertEqual([m["id"] for m in h["mensagens"]][-1], m1["id"])   # os outros testes também escrevem no geral
        st, vivo = self.get(f"/api/ao-vivo?andar={self.B}&canal=geral&depois={m1['id']}", "bia")
        self.assertGreaterEqual(vivo["nao_lidas"]["geral"], 2)
        self.assertEqual([m["id"] for m in vivo["aberto"]["novas"]], [m2["id"]])
        self.assertEqual(self.post(f"/api/canal/lida?andar={self.B}", "bia", {"canal": "geral", "ate": m2["id"]})[0], 200)
        time.sleep(0.3)
        self.assertNotIn("geral", self.get(f"/api/ao-vivo?andar={self.B}", "bia")[1]["nao_lidas"])

    def test_outro_andar_nao_le(self):
        self.envia("ana", "geral", "só de B")
        self.assertEqual(self.get(f"/api/canal/historico?andar={self.B}&canal=geral", "carlos")[0], 404)
        st, h = self.get(f"/api/canal/historico?andar={self.C}&canal=geral", "carlos")
        self.assertNotIn("só de B", json.dumps(h))

    def test_sala_so_do_mapa_do_andar(self):
        self.envia("ana", "sala:cozinha", "café")
        for canal in ("sala:inventada", "sala:", "sala:time:Nada", "dm:x", "outro"):
            st, r = self.post(f"/api/canal/enviar?andar={self.B}", "ana", {"canal": canal, "texto": "x"})
            self.assertEqual((st, r["erro"]), (400, "pedido"), canal)

    def test_apagar_reagir_e_versao(self):
        m = self.envia("ana", "geral", "apaga-me")
        v = self.get(f"/api/ao-vivo?andar={self.B}&canal=geral&depois=0", "bia")[1]["aberto"]["v"]
        st, r = self.post(f"/api/canal/reagir?andar={self.B}", "bia", {"id": m["id"], "emoji": "👍", "ligar": True})
        self.assertEqual((st, r["mensagem"]["reacoes"]), (200, [{"emoji": "👍", "n": 1, "eu": True}]))
        time.sleep(0.3)
        self.assertNotEqual(self.get(f"/api/ao-vivo?andar={self.B}&canal=geral&depois=0", "bia")[1]["aberto"]["v"], v)
        self.assertEqual(self.post(f"/api/canal/apagar?andar={self.B}", "bia", {"id": m["id"]}),
                         (404, {"erro": "nao_existe", "mensagem": "Isso não existe mais."}))
        self.assertEqual(self.post(f"/api/canal/apagar?andar={self.B}", "beto", {"id": m["id"]})[0], 200)   # modera
        h = self.get(f"/api/canal/historico?andar={self.B}&canal=geral", "bia")[1]["mensagens"]
        self.assertTrue(next(x for x in h if x["id"] == m["id"])["apagada"])

    def test_admin_do_predio_le_mas_nao_modera_a_empresa(self):
        m = self.envia("ana", "geral", "do dono não")
        st, r = self.post(f"/api/mural/fixar?andar={self.B}", "ana", {"canal": "geral", "texto": "aviso da ana"})
        aviso = next(a for a in r["avisos"] if a["texto"] == "aviso da ana")
        self.assertFalse(self.get(f"/api/config?andar={self.B}", "dono")[1]["equipe"]["pode_moderar"])
        self.assertTrue(self.get(f"/api/config?andar={self.B}", "beto")[1]["equipe"]["pode_moderar"])
        st, h = self.get(f"/api/canal/historico?andar={self.B}&canal=geral", "dono")
        self.assertIn("do dono não", [x["texto"] for x in h["mensagens"]])   # lê
        self.assertEqual(self.post(f"/api/canal/apagar?andar={self.B}", "dono", {"id": m["id"]})[0], 404)
        self.assertEqual(self.post(f"/api/mural/tirar?andar={self.B}", "dono", {"id": aviso["id"]})[0], 404)
        self.assertEqual(self.post(f"/api/canal/retencao?andar={self.B}", "dono", {"dias": 30})[0], 403)
        self.assertEqual(self.eq(self.B).retencao(), 365)
        self.assertEqual(self.post(f"/api/canal/retencao?andar={self.B}", "beto", {"dias": 365}), (200, {"retencao": 365}))
        self.assertEqual(self.post(f"/api/canal/retencao?andar={self.B}", "cida", {"dias": 30})[0], 404)   # de C
        self.assertEqual(self.post(f"/api/mural/tirar?andar={self.B}", "beto", {"id": aviso["id"]})[0], 200)

    def test_admin_do_predio_so_le_a_empresa(self):
        """Decisão do Maestro (auditoria final da Onda 2): no andar de uma empresa o admin do prédio lê o Geral, as salas
        e o mural; escrever (enviar, reagir, anexar, fixar) exige papel no andar. No andar dele escreve."""
        m = self.envia("ana", "geral", "o dono só lê")
        self.assertFalse(self.get(f"/api/config?andar={self.B}", "dono")[1]["equipe"]["pode_escrever"])
        self.assertTrue(self.get(f"/api/config?andar={self.B}", "ana")[1]["equipe"]["pode_escrever"])
        self.assertTrue(self.get("/api/config", "dono")[1]["equipe"]["pode_escrever"])
        for rota, corpo in (("/api/canal/enviar", {"canal": "geral", "texto": "do dono"}),
                            ("/api/canal/enviar", {"canal": "sala:cozinha", "texto": "do dono"}),
                            ("/api/canal/reagir", {"id": m["id"], "emoji": "👍", "ligar": True}),
                            ("/api/mural/fixar", {"canal": "geral", "texto": "do dono"})):
            st, r = self.post(f"{rota}?andar={self.B}", "dono", corpo)
            self.assertEqual((st, r["erro"]), (403, "papel"), rota)
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "dono", b"oi", "x.txt")
        self.assertEqual((st, r["erro"]), (403, "papel"))
        h = self.get(f"/api/canal/historico?andar={self.B}&canal=geral", "dono")[1]["mensagens"]
        self.assertEqual(next(x for x in h if x["id"] == m["id"])["reacoes"], [])
        self.assertNotIn("do dono", [x["texto"] for x in h])
        self.assertNotIn("do dono", [a["texto"] for a in self.get(f"/api/mural?andar={self.B}&canal=geral", "dono")[1]["avisos"]])
        self.assertEqual(self.post(f"/api/canal/lida?andar={self.B}", "dono", {"canal": "geral", "ate": m["id"]})[0], 200)
        time.sleep(0.25)
        st, r = self.post("/api/canal/enviar", "dono", {"canal": "geral", "texto": "no andar dele"})
        self.assertEqual(st, 200, r)

    def test_historico_traz_a_versao_do_ao_vivo(self):
        """O painel guarda a versão do canal a partir do histórico (lida antes do SELECT, sob a mesma trava): a reação que
        cai entre o histórico e o 1º /api/ao-vivo muda a versão e o painel relê."""
        m = self.envia("ana", "sala:cozinha", "versão no histórico")
        rota = f"/api/canal/historico?andar={self.B}&canal=sala:cozinha"
        h = self.get(rota, "bia")[1]
        vivo = lambda: self.get(f"/api/ao-vivo?andar={self.B}&canal=sala:cozinha&depois={m['id']}", "bia")[1]["aberto"]["v"]
        self.assertIsInstance(h["v"], int)
        self.assertEqual(h["v"], vivo())
        self.assertEqual(self.post(f"/api/canal/reagir?andar={self.B}", "ana", {"id": m["id"], "emoji": "🎉", "ligar": True})[0], 200)
        time.sleep(0.3)
        self.assertNotEqual(vivo(), h["v"])
        self.assertEqual(self.get(rota, "bia")[1]["v"], vivo())

    def test_busca(self):
        self.envia("ana", "sala:reuniao", "orçamento trimestral")
        time.sleep(1.1)
        st, r = self.get(f"/api/canal/busca?andar={self.B}&q=orcamento", "bia")
        self.assertEqual((st, [m["texto"] for m in r["mensagens"]][:1]), (200, ["orçamento trimestral"]))
        self.assertEqual(self.get(f"/api/canal/busca?andar={self.C}&q=orcamento", "carlos")[1]["mensagens"], [])

    def test_mencao_so_de_quem_e_do_andar(self):
        m = self.envia("ana", "geral", "@bia e @carlos e @ninguem, vejam")
        time.sleep(0.3)
        self.assertEqual(self.get(f"/api/ao-vivo?andar={self.B}", "bia")[1]["mencoes"].get("geral", 0) >= 1, True)
        linhas = self.eq(self.B).con.execute("SELECT usuario FROM mencao WHERE mensagem = ?", (m["id"],)).fetchall()
        self.assertEqual(linhas, [("bia",)])   # carlos é de C, ninguem não existe

    def test_mural_e_versao_no_ao_vivo(self):
        st, r = self.post(f"/api/mural/fixar?andar={self.B}", "ana", {"canal": "sala:cozinha", "texto": "limpem a pia"})
        self.assertEqual((st, [a["texto"] for a in r["avisos"]], r["avisos"][0]["meu"]), (200, ["limpem a pia"], True))
        st, m = self.get(f"/api/mural?andar={self.B}&canal=sala:cozinha", "bia")
        self.assertFalse(m["avisos"][0]["meu"])
        time.sleep(0.3)
        self.assertEqual(self.get(f"/api/ao-vivo?andar={self.B}", "bia")[1]["mural_v"]["sala:cozinha"], m["v"])
        self.assertEqual(self.post(f"/api/mural/tirar?andar={self.B}", "bia", {"id": m["avisos"][0]["id"]})[0], 404)
        self.assertEqual(self.post(f"/api/mural/tirar?andar={self.B}", "beto", {"id": m["avisos"][0]["id"]})[0], 200)

    def test_status_e_aceno(self):
        self.assertEqual(self.post(f"/api/status?andar={self.B}", "bia", {"status": "reuniao", "texto": "1:1"}),
                         (200, {"status": "reuniao", "texto": "1:1"}))
        self.entrar_no_mapa("ana", self.B)
        self.entrar_no_mapa("bia", self.B)
        time.sleep(0.3)
        vivo = self.get(f"/api/ao-vivo?andar={self.B}", "ana")[1]
        bia = next(p for p in vivo["pessoas"] if p["usuario"] == "bia")
        self.assertEqual((bia["status"], bia["status_texto"]), ("reuniao", "1:1"))
        self.assertEqual(vivo["meu_status"], {"status": "disponivel", "texto": "", "em_reuniao": False})   # Onda 3: em_reuniao
        seq = vivo["seq"]
        self.assertEqual(self.post(f"/api/aceno?andar={self.B}", "ana", {"para": "bia", "tipo": "porta"}), (200, {"ok": True}))
        self.assertEqual(self.post(f"/api/aceno?andar={self.B}", "ana", {"para": "bia", "tipo": "aceno"})[0], 429)
        time.sleep(0.3)
        acenos = self.get(f"/api/ao-vivo?andar={self.B}&desde={seq}", "bia")[1]["acenos"]
        self.assertEqual([(a["de"], a["nome"], a["tipo"]) for a in acenos], [("ana", "Ana", "porta")])
        self.assertEqual(self.post(f"/api/aceno?andar={self.B}", "ana", {"para": "carlos", "tipo": "aceno"})[0], 404)
        self.post(f"/api/status?andar={self.B}", "beto", {"status": "ocupado", "texto": ""})
        self.entrar_no_mapa("beto", self.B)
        self.assertEqual(self.post(f"/api/aceno?andar={self.B}", "ana", {"para": "beto", "tipo": "aceno"})[1]["erro"],
                         "ocupado")


class DMs(Predio):
    def test_dm_so_entre_os_dois_e_so_do_andar(self):
        canal = self.dm("ana", "beto")   # o par ana-bia é o da auditoria
        self.assertEqual(self.dm("beto", "ana"), canal)
        self.envia("ana", canal, "segredo")
        self.assertEqual(self.get(f"/api/canal/historico?andar={self.B}&canal={canal}", "bia")[0], 404)   # IDOR
        self.assertEqual(self.post(f"/api/canal/enviar?andar={self.B}", "bia", {"canal": canal, "texto": "x"})[0], 404)
        self.assertEqual(self.post(f"/api/dm/abrir?andar={self.B}", "ana", {"com": "carlos"})[0], 404)   # de C
        self.assertEqual(self.post(f"/api/dm/abrir?andar={self.B}", "ana", {"com": "ana"})[0], 404)
        st, h = self.get(f"/api/canal/historico?andar={self.B}&canal={canal}", "beto")
        self.assertEqual((st, h["mensagens"][-1]["texto"], h["acessos"]), (200, "segredo", []))
        self.assertIn("administração", h["aviso"])
        dms = self.get(f"/api/dm?andar={self.B}", "beto")[1]["dms"]
        self.assertIn((canal, {"usuario": "ana", "nome": "Ana"}), [(d["canal"], d["outro"]) for d in dms])
        pessoas = self.get(f"/api/pessoas?andar={self.B}", "ana")[1]["pessoas"]
        self.assertEqual(sorted(p["usuario"] for p in pessoas), ["beto", "bia"])   # sem ela, sem C, sem o dono

    def test_entendi(self):
        self.assertFalse(self.get(f"/api/config?andar={self.B}", "bia")[1]["equipe"]["aviso_dm_entendido"])
        self.assertEqual(self.post(f"/api/dm/entendi?andar={self.B}", "bia", {}), (200, {"ok": True}))
        self.assertTrue(self.get(f"/api/config?andar={self.B}", "bia")[1]["equipe"]["aviso_dm_entendido"])
        self.assertFalse(self.get(f"/api/config?andar={self.C}", "cida")[1]["equipe"]["aviso_dm_entendido"])

    def test_auditoria_e3(self):
        canal = self.dm("ana", "bia")
        m = self.envia("ana", canal, "texto da dm")
        apagada = self.envia("bia", canal, "vou apagar")
        self.post(f"/api/canal/apagar?andar={self.B}", "bia", {"id": apagada["id"]})
        lidas_antes = self.eq(self.B).con.execute("SELECT * FROM leitura ORDER BY 1, 2").fetchall()
        self.assertEqual(self.get(f"/api/dm/auditoria/pares?andar={self.B}", "ana")[0], 403)   # membro
        self.assertEqual(self.get(f"/api/dm/auditoria/pares?andar={self.B}", "cida")[0], 404)  # admin de C
        self.assertEqual(self.get(f"/api/dm/auditoria?andar={self.B}&canal={canal}", "dono")[0], 404)   # do prédio
        for cab in ({}, {"Sec-Fetch-Site": "cross-site"}, {"X-Escritorio": "0"}):   # só pelo painel (<img> de fora não)
            for rota in (f"/api/dm/auditoria?andar={self.B}&canal={canal}", f"/api/dm/auditoria/pares?andar={self.B}"):
                self.assertEqual(self.get(rota, "beto", cab), (403, {"erro": "origem", "mensagem":
                                                                     "Abra pelo painel do escritório."}), (rota, cab))
        self.assertEqual(self.eq(self.B).con.execute("SELECT COUNT(*) FROM acesso_dm").fetchone()[0], 0)
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            st, pares = self.get(f"/api/dm/auditoria/pares?andar={self.B}", "beto", {"Sec-Fetch-Site": "same-origin"})
            st2, lido = self.get(f"/api/dm/auditoria?andar={self.B}&canal={canal}", "beto", PAINEL)
        self.assertEqual((st, st2), (200, 200))
        self.assertEqual([(p["canal"], p["u1"], p["u2"]) for p in pares["pares"]], [(canal, "ana", "bia")])
        self.assertEqual([x["texto"] for x in lido["mensagens"]], ["texto da dm"])   # sem a apagada
        self.assertIn("registrado", lido["lembrete"])
        self.assertNotIn("texto da dm", saida.getvalue())
        self.assertNotIn("ana", saida.getvalue())   # o log não leva os participantes
        self.assertEqual(self.eq(self.B).con.execute("SELECT * FROM leitura ORDER BY 1, 2").fetchall(), lidas_antes)
        registro = self.eq(self.B).con.execute("SELECT * FROM acesso_dm").fetchall()
        self.assertNotIn("texto da dm", json.dumps(registro))
        self.assertEqual(len(self.get(f"/api/canal/historico?andar={self.B}&canal={canal}", "ana")[1]["acessos"]), 1)
        self.assertEqual(len(self.get(f"/api/dm/auditoria/registro?andar={self.B}", "dono", PAINEL)[1]["registro"]), 1)
        self.assertEqual(self.get(f"/api/dm/auditoria/registro?andar={self.B}", "ana")[0], 403)
        self.assertNotEqual(m["id"], 0)


class Varredura(Predio):
    def test_varre_o_andar_que_ninguem_abriu_desde_o_boot(self):
        andar = self.srv.andares[self.C]
        velho = conversas_equipe.Equipe(andar.pasta, relogio=lambda: time.time() - 400 * 86400)
        velho.enviar("geral", "carlos", "Carlos", "de 400 dias atrás")
        velho.fechar()
        self.assertNotIn(self.C, self.srv.equipes)
        self.srv.varrer_equipes()
        self.assertEqual(self.eq(self.C).historico("carlos", "geral"), [])
        self.assertNotIn(self.B, self.srv.equipes)   # B não tem equipe.db: não ganha um


class Push(Predio):
    def avisos_de(self, quem):
        return self.get("/api/avisos", quem)[1]["aviso"]

    def test_mencao_e_dm_com_o_comeco_ate_60(self):
        texto = "@bia " + "começo de uma mensagem bem comprida para passar dos sessenta caracteres"
        self.envia("ana", "geral", texto)
        aviso = self.avisos_de("bia")
        self.assertEqual((aviso["tipo"], aviso["titulo"]), ("mencao", "Ana · #geral"))   # bia só está em B: sem empresa
        self.assertLessEqual(len(aviso["corpo"]), 60)
        self.assertTrue(aviso["corpo"].endswith("…") and aviso["corpo"].startswith("@bia começo"))
        self.assertIsNone(self.avisos_de("beto"))   # outra conta não vê
        canal = self.dm("beto", "ana")
        m = self.envia("beto", canal, "oi‮ ana")
        self.assertEqual((self.avisos_de("ana")["titulo"], self.avisos_de("ana")["corpo"]), ("Beto · mensagem direta", "oi ana"))
        self.post(f"/api/canal/apagar?andar={self.B}", "beto", {"id": m["id"]})
        self.assertEqual(self.avisos_de("ana")["corpo"], "Beto te mandou uma mensagem")   # apagada antes do GET

    def test_ocupado_ou_aberto_nao_vira_push(self):
        a = self.srv.avisos
        a.assinar("https://fcm.googleapis.com/fcm/send/bia", time.time(), "bia")
        while not a.fila.empty():
            a.fila.get_nowait()
        self.post(f"/api/status?andar={self.B}", "bia", {"status": "ocupado", "texto": ""})
        self.envia("ana", "geral", "@bia urgente")
        self.assertTrue(a.fila.empty())
        self.assertEqual(self.avisos_de("bia")["tipo"], "mencao")   # a tela mostra mesmo assim
        self.post(f"/api/status?andar={self.B}", "bia", {"status": "disponivel", "texto": ""})
        self.envia("ana", "geral", "@bia agora vai")
        self.assertEqual(a.fila.get_nowait()[3], "bia")
        self.entrar_no_mapa("bia", self.B)   # com o escritório aberto, só a tela
        self.envia("ana", "geral", "@bia de novo")
        self.assertTrue(a.fila.empty())

    def test_preferencia_comeco_desligada(self):
        self.assertEqual(self.post("/api/perfil", "carlos", {"avisos": {"modo": "sempre", "comeco": False}})[0], 200)
        self.assertFalse(self.get("/api/perfil", "carlos")[1]["avisos"]["comeco"])
        time.sleep(0.3)
        st, r = self.post(f"/api/canal/enviar?andar={self.C}", "cida", {"canal": "geral", "texto": "@carlos privado"})
        self.assertEqual(st, 200, r)
        self.assertEqual(self.avisos_de("carlos")["corpo"], "")


class Anexos(Predio):
    def test_imagem_sem_gps_e_resposta_com_attachment_nosniff_sandbox(self):
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "ana", PNG_GPS, "foto.png", "olha a foto")
        self.assertEqual(st, 200, r)
        a = r["mensagem"]["anexo"]
        self.assertEqual((a["nome"], a["tipo"], r["mensagem"]["texto"]), ("foto.png", "image/png", "olha a foto"))
        st, corpo, h = self.req(f"/api/anexo?andar={self.B}&id={a['id']}", self.cab["bia"])
        self.assertEqual(st, 200)
        self.assertNotIn(GPS, corpo)
        self.assertEqual(h["X-Content-Type-Options"], "nosniff")
        self.assertEqual(h["Content-Security-Policy"], "default-src 'none'; sandbox")
        self.assertEqual(h["Cache-Control"], "private, no-store")
        self.assertTrue(h["Content-Disposition"].startswith("inline"))
        st, _, h = self.req(f"/api/anexo?andar={self.B}&id={a['id']}&baixar=1", self.cab["bia"])
        self.assertTrue(h["Content-Disposition"].startswith("attachment"))
        self.assertIn("filename*=UTF-8''foto.png", h["Content-Disposition"])
        self.assertEqual(self.req(f"/api/anexo?andar={self.C}&id={a['id']}", self.cab["carlos"])[0], 404)

    def test_jpeg_com_gps(self):
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "ana", JPEG_GPS, "Relatório é.jpg")
        self.assertEqual((st, r["mensagem"]["anexo"]["nome"]), (200, "Relatório é.jpg"))
        _, corpo, _ = self.req(f"/api/anexo?andar={self.B}&id={r['mensagem']['anexo']['id']}", self.cab["ana"])
        self.assertNotIn(b"GPS", corpo)

    def test_svg_e_html_recusados_mesmo_renomeados(self):
        for dados, nome in ((b'<svg xmlns="http://www.w3.org/2000/svg"/>', "a.png"), (b"<html><script>", "a.txt"),
                            (b"<svg/>", "a.svg")):
            st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "ana", dados, nome)
            self.assertEqual((st, r["erro"]), (415, "tipo"), nome)

    def test_texto_e_pdf_vao_como_attachment(self):
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "ana", b"a;b\n", "t.csv")
        st, _, h = self.req(f"/api/anexo?andar={self.B}&id={r['mensagem']['anexo']['id']}", self.cab["ana"])
        self.assertTrue(h["Content-Disposition"].startswith("attachment"))
        self.assertEqual(h["Content-Type"], "text/csv; charset=utf-8")

    def test_dm_idor_404(self):
        canal = self.dm("ana", "bia")
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal={canal}", "ana", b"oi", "x.txt")
        self.assertEqual(st, 200, r)
        self.assertEqual(self.req(f"/api/anexo?andar={self.B}&id={r['mensagem']['anexo']['id']}", self.cab["beto"])[0], 404)
        self.assertEqual(self.anexo(f"/api/anexo?andar={self.B}&canal={canal}", "beto", b"oi", "x.txt")[0], 404)

    def test_auditor_baixa_o_anexo_da_dm_com_registro(self):
        canal = self.dm("ana", "bia")
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal={canal}", "bia", b"contrato", "c.txt")   # ana já gastou o balde
        rota = f"/api/anexo?andar={self.B}&id={r['mensagem']['anexo']['id']}&auditoria=1"
        registro = lambda: self.eq(self.B).con.execute("SELECT admin, u1, u2, quantas FROM acesso_dm").fetchall()
        self.assertEqual(self.req(rota, self.cab["dono"])[0], 404)   # o admin do prédio não lê DM
        self.assertEqual(self.req(rota, {**self.cab["dono"], **PAINEL})[0], 404)
        self.assertEqual(self.req(rota, self.cab["beto"])[0], 403)   # sem o cabeçalho do painel
        self.assertEqual(registro(), [])
        st, corpo, h = self.req(rota, {**self.cab["beto"], **PAINEL})
        self.assertEqual((st, corpo), (200, b"contrato"))
        self.assertEqual(registro(), [("beto", "ana", "bia", 1)])
        self.assertEqual(len(self.get(f"/api/canal/historico?andar={self.B}&canal={canal}", "bia")[1]["acessos"]), 1)

    def test_previa_fora_do_teto_dos_downloads(self):
        """A prévia inline (o <img> do painel) tem teto próprio, maior: 5 imagens na tela não esbarram nos 4 downloads."""
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "beto", PNG_GPS, "previa.png")
        self.assertEqual(st, 200, r)
        rota = f"/api/anexo?andar={self.B}&id={r['mensagem']['anexo']['id']}"
        self.srv.downloads["bia"] = e.DOWNLOADS_MAX
        try:
            self.assertEqual(self.req(rota, self.cab["bia"])[0], 200)
            self.assertEqual(self.req(rota + "&baixar=1", self.cab["bia"])[0], 429)
        finally:
            del self.srv.downloads["bia"]
        self.assertGreater(e.PREVIAS_MAX, e.DOWNLOADS_MAX)
        self.srv.downloads[("previa", "bia")] = e.PREVIAS_MAX
        try:
            self.assertEqual(self.req(rota, self.cab["bia"])[0], 429)
            self.assertEqual(self.req(rota + "&baixar=1", self.cab["bia"])[0], 200)
        finally:
            del self.srv.downloads[("previa", "bia")]

    def test_mencao_no_texto_do_anexo_grava(self):
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "bia", b"oi", "x.txt", "@ana e @carlos, vejam")
        self.assertEqual(st, 200, r)
        linhas = self.eq(self.B).con.execute("SELECT usuario FROM mencao WHERE mensagem = ?",
                                             (r["mensagem"]["id"],)).fetchall()
        self.assertEqual(linhas, [("ana",)])

    def test_grande_demais_413_e_sem_tamanho_411(self):
        conexao = http.client.HTTPConnection("127.0.0.1", self.srv.server_address[1], timeout=10)
        conexao.putrequest("POST", f"/api/anexo?andar={self.B}&canal=geral")
        for k, v in {**self.cab["ana"], "Origin": self.base, "X-Nome": "x.txt",
                     "Content-Length": str(e.ANEXO_MAX + 1)}.items():
            conexao.putheader(k, v)
        conexao.endheaders()   # o corpo nunca vai: o servidor recusa pelo cabeçalho
        resp = conexao.getresponse()
        self.assertEqual((resp.status, json.loads(resp.read())["erro"]), (413, "grande"))
        conexao.close()

    def test_cota_e_piso_de_disco(self):
        eq = self.eq(self.B)
        with mock.patch.object(eq, "cota_anexos", 10):
            st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "ana", b"x" * 20, "x.txt")
            self.assertEqual((st, r["erro"]), (507, "cota"))
        with mock.patch.object(e, "PISO_DISCO", 10 ** 18):
            time.sleep(0.2)
            st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "ana", b"x", "x.txt")
            self.assertEqual((st, r["erro"]), (507, "disco"))

    def test_envio_lento_cortado_pelo_prazo(self):
        with mock.patch.object(e, "PRAZO_ANEXO", 1.5):
            s = socket.create_connection(("127.0.0.1", self.srv.server_address[1]), timeout=10)
            cab = (f"POST /api/anexo?andar={self.B}&canal=geral HTTP/1.1\r\nHost: x\r\nOrigin: {self.base}\r\n"
                   f"Cookie: {self.cab['bia']['Cookie']}\r\nX-Nome: lento.txt\r\n"
                   f"Content-Length: {CORPO_ANTES_MAIS}\r\n\r\n")
            s.sendall(cab.encode())
            inicio = time.monotonic()
            resposta = b""
            try:
                while time.monotonic() - inicio < 8:
                    s.sendall(b"a" * 10)
                    time.sleep(0.3)
                    s.settimeout(0.01)
                    try:
                        pedaco = s.recv(4096)
                        if pedaco:
                            resposta += pedaco
                            break
                    except socket.timeout:
                        pass
                    s.settimeout(10)
            except OSError:   # o servidor fechou a conexão
                pass
            s.close()
        self.assertLess(time.monotonic() - inicio, 6)
        self.assertIn(b" 408 ", resposta.split(b"\r\n")[0] + b" ")
        self.assertEqual([n for n in os.listdir(self.eq(self.B).pasta_anexos) if n.startswith(".tmp-")], [])

    def test_25_mb_de_verdade_sobe_e_desce_em_blocos(self):
        dados = (b"linha de texto do arquivo grande\n" * (e.ANEXO_MAX // 33 + 1))[:e.ANEXO_MAX]
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "bia", dados, "grande.txt")
        self.assertEqual(st, 200, r)
        self.assertEqual(r["mensagem"]["anexo"]["tamanho"], e.ANEXO_MAX)
        st, corpo, h = self.req(f"/api/anexo?andar={self.B}&id={r['mensagem']['anexo']['id']}", self.cab["ana"])
        self.assertEqual((st, int(h["Content-Length"])), (200, e.ANEXO_MAX))
        self.assertEqual(hashlib.sha256(corpo).hexdigest(), hashlib.sha256(dados).hexdigest())


CORPO_ANTES_MAIS = e.CORPO_ANTES + 1000   # acima do que o do_POST lê antes: a rota lê em blocos


class Saguao(Http):
    """Modo saguão: só o geral, sem DM, sem anexo, sem menção e sem push; quem aparece sai pelo id opaco."""

    @classmethod
    def setUpClass(cls):
        cls.dados = tempfile.mkdtemp(prefix="conversas-saguao-")
        cls.antes = e.BASE, e.TIMES, e.ORG
        e.TIMES = os.path.join(cls.dados, "times.json")
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"conversas": "ler", "times": []}, f)
        with open(os.path.join(cls.dados, andares.ARQ), "w", encoding="utf-8") as f:
            json.dump({"v": 2, "terreo": "saguao", "andares": [{"id": "bbbbbbbb", "nome": "Empresa B", "org": ORG_B}]}, f)
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.dados = cls.dados
        cls.srv.leitor = cls.srv.cred = None
        cls.srv.acesso = Acesso(os.path.join(cls.dados, "contas"))
        cls.srv.registro_andares = andares.Andares(cls.dados, e.ORG)
        andar = e.Andar(cls.srv.registro_andares.lista[0], cls.dados)
        andar.leitor = Leitor()
        cls.srv.andares = {"bbbbbbbb": andar}
        cls.srv.id_pessoa = e.IdPessoa(os.path.join(cls.dados, "pessoa.chave"))
        cls.srv.avisos = avisos.Avisos("CHAVE", lambda endpoint, agora: "vapid", lambda **k: None, e.FUSO,
                                       pode=lambda conta, a: e.recebe_avisos(cls.srv, conta, a))
        cls.srv.avisos.resolver = e.resolver_de_avisos(cls.srv)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        e.BASE = cls.base
        acesso = cls.srv.acesso
        with open(os.path.join(cls.dados, "contas", "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        acesso.criar_primeiro(codigo, "dono", SENHA_DONO)
        cls.cab = {"dono": {"Cookie": "esc_sessao=" + acesso.entrar("dono", SENHA_DONO)}}
        for usuario, nome in (("ana", "ana"), ("bia", "Bia")):
            token, _ = acesso.convidar(nome, ["bbbbbbbb"], principal=False)
            cls.cab[usuario] = {"Cookie": "esc_sessao=" + acesso.aceitar_convite(token, usuario, SENHA, nome, AVATAR)}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        for eq in cls.srv.equipes.values():
            eq.fechar()
        e.BASE, e.TIMES, e.ORG = cls.antes
        shutil.rmtree(cls.dados, ignore_errors=True)

    def test_so_o_geral_com_id_opaco_e_sem_mencao(self):
        st, r = self.post("/api/canal/enviar", "ana", {"canal": "geral", "texto": "oi @bia"})
        self.assertEqual(st, 200, r)
        self.assertEqual((r["mensagem"]["usuario"], r["mensagem"]["nome"]), (self.srv.id_pessoa("ana"), "Pessoa"))
        st, h = self.get("/api/canal/historico?canal=geral", "bia")
        self.assertNotIn('"ana"', json.dumps(h))
        self.assertEqual(self.get("/api/avisos", "bia")[1]["aviso"], None)
        self.assertEqual(self.srv.equipe_de(e.AndarPrincipal(self.srv)).con.execute("SELECT COUNT(*) FROM mencao")
                         .fetchone()[0], 0)
        time.sleep(0.3)
        self.assertEqual(self.post("/api/canal/enviar", "ana", {"canal": "sala:cozinha", "texto": "x"})[0], 400)

    def test_sem_dm_anexo_pessoas_nem_auditoria(self):
        for rota in ("/api/dm", "/api/pessoas", "/api/anexo?id=1", "/api/dm/auditoria/pares"):
            self.assertEqual(self.get(rota, "bia")[1].get("codigo"), "andar", rota)
            self.assertEqual(self.get(rota, "dono")[0], 404, rota)
        self.assertEqual(self.post("/api/dm/abrir", "dono", {"com": "bia"})[0], 404)
        self.assertEqual(self.anexo("/api/anexo?canal=geral", "dono", b"oi", "x.txt")[0], 404)
        # o membro: os POST de DM e anexo param na guarda (403 papel, a matriz da Onda 1), sem dizer que o saguão existe
        for st, r in (self.post("/api/dm/abrir", "bia", {"com": "ana"}), self.post("/api/dm/entendi", "bia", {}),
                      self.anexo("/api/anexo?canal=geral", "bia", b"oi", "x.txt")):
            self.assertEqual((st, r["erro"]), (403, "papel"))
        cfg = self.get("/api/config", "bia")[1]["equipe"]
        self.assertEqual((cfg["dm"], cfg["anexo"], cfg["mencao"], cfg["auditoria"], cfg["cota"]),
                         (False, False, False, False, None))
        self.assertIsNone(self.get("/api/config", "dono")[1]["equipe"]["cota"])   # o saguão não tem anexo

    def test_admin_do_predio_modera_o_saguao(self):
        self.assertTrue(self.get("/api/config", "dono")[1]["equipe"]["pode_moderar"])
        self.assertFalse(self.get("/api/config", "bia")[1]["equipe"]["pode_moderar"])
        time.sleep(0.3)
        st, r = self.post("/api/canal/enviar", "bia", {"canal": "geral", "texto": "modere-me"})
        self.assertEqual(self.post("/api/canal/apagar", "ana", {"id": r["mensagem"]["id"]})[0], 404)
        self.assertEqual(self.post("/api/canal/apagar", "dono", {"id": r["mensagem"]["id"]})[0], 200)
        self.assertEqual(self.post("/api/canal/retencao", "bia", {"dias": 90})[0], 403)

    def test_mural_status_aceno_e_no_predio(self):
        st, r = self.post("/api/mural/fixar", "bia", {"canal": "geral", "texto": "bem-vindos"})
        self.assertEqual((st, r["avisos"][0]["usuario"]), (200, self.srv.id_pessoa("bia")))
        self.entrar_no_mapa("ana", e.ANDAR_PRINCIPAL)
        self.entrar_no_mapa("bia", e.ANDAR_PRINCIPAL)
        self.entrar_no_mapa("ana", "bbbbbbbb")
        st, r = self.post("/api/aceno", "bia", {"para": self.srv.id_pessoa("ana"), "tipo": "aceno"})
        self.assertEqual(st, 200, r)
        self.assertEqual(self.post("/api/aceno", "bia", {"para": "ana", "tipo": "aceno"})[0], 404)   # o login não serve
        time.sleep(0.3)
        vivo = self.get("/api/ao-vivo", "ana")[1]
        self.assertEqual([a["de"] for a in vivo["acenos"]], [self.srv.id_pessoa("bia")])
        self.assertEqual(vivo["no_predio"], 2)
        self.assertIn("geral", vivo["mural_v"])
        self.assertNotIn("no_predio", self.get("/api/ao-vivo?andar=bbbbbbbb", "ana")[1])


if __name__ == "__main__":
    unittest.main()
