# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""1.6 Onda 3 pelo HTTP: o link fixo por sala (lista fechada de hosts), a agenda do andar com o .ics, o aviso 5 min
antes (relógio injetado), a reunião geral (convocação com limite), o status automático "em reunião" e nada disso no
saguão. Servidor de verdade em 127.0.0.1 (o mesmo prédio dos testes da Onda 2)."""
import time
import unittest
from unittest import mock

import escritorio as e
import test_conversas_http as base

MEET = "https://meet.google.com/abc-defg-hij"


class Reunioes(base.Predio):
    def marca(self, quem, andar=None, **campos):
        corpo = {"titulo": "Planejamento", "sala": "reuniao", "inicio": int(time.time()) + 3600, "duracao": 30,
                 "convidados": [], **campos}
        time.sleep(0.3)   # o balde da agenda (2 por segundo, rajada de 5)
        return self.post(f"/api/reunioes/marcar?andar={andar or self.B}", quem, corpo)

    def avisos_de(self, quem):
        return self.get("/api/avisos", quem)[1]["aviso"]


class Links(Reunioes):
    def test_admin_do_andar_grava_membro_le(self):
        rota = f"/api/reunioes/link?andar={self.B}"
        self.assertEqual(self.post(rota, "beto", {"sala": "reuniao", "url": MEET}), (200, {"links": {"reuniao": MEET}}))
        self.assertEqual(self.get(f"/api/reunioes/links?andar={self.B}", "ana"), (200, {"links": {"reuniao": MEET}}))
        self.assertEqual(self.get(f"/api/reunioes/links?andar={self.B}", "dono")[0], 200)   # o admin do prédio lê
        for quem in ("ana", "dono"):   # o membro e o admin do prédio sem papel no andar não gravam
            st, r = self.post(rota, quem, {"sala": "reuniao", "url": ""})
            self.assertEqual((st, r["erro"]), (403, "papel"), quem)
        self.assertEqual(self.post(rota, "cida", {"sala": "reuniao", "url": ""})[0], 404)   # admin de outra empresa
        self.assertEqual(self.get(f"/api/reunioes/links?andar={self.B}", "carlos")[0], 404)
        self.assertEqual(self.get(f"/api/reunioes/links?andar={self.C}", "cida"), (200, {"links": {}}))   # C não vê B

    def test_url_fora_da_lista_recusada(self):
        rota = f"/api/reunioes/link?andar={self.B}"
        for url in ("http://meet.google.com/x", "https://evil.com/x", "https://user:senha@meet.google.com/x",
                    "https://meet.google.com.evil.com/x", "javascript:alert(1)", "https://meet.google.com:444/x"):
            time.sleep(0.35)   # o balde do link
            st, r = self.post(rota, "beto", {"sala": "cozinha", "url": url})
            self.assertEqual((st, r["erro"]), (400, "link"), url)
        time.sleep(0.35)
        self.assertEqual(self.post(rota, "beto", {"sala": "corredor", "url": MEET})[1]["erro"], "pedido")
        self.assertEqual(self.post(rota, "beto", {"sala": "", "url": MEET})[1]["erro"], "pedido")
        self.assertNotIn("cozinha", self.get(f"/api/reunioes/links?andar={self.B}", "ana")[1]["links"])

    def test_jitsi_proprio_por_env_e_config(self):
        cfg = self.get(f"/api/config?andar={self.B}", "beto")[1]["equipe"]["reunioes"]
        self.assertEqual(cfg["hosts"], ["meet.google.com", "*.zoom.us", "meet.jit.si", "teams.microsoft.com", "whereby.com"])
        self.assertEqual((cfg["pode_marcar"], cfg["pode_link"], cfg["pode_convocar"]), (True, True, True))
        cfg = self.get(f"/api/config?andar={self.B}", "ana")[1]["equipe"]["reunioes"]
        self.assertEqual((cfg["pode_marcar"], cfg["pode_link"], cfg["pode_convocar"]), (True, False, False))
        cfg = self.get(f"/api/config?andar={self.B}", "dono")[1]["equipe"]["reunioes"]
        self.assertEqual((cfg["pode_marcar"], cfg["pode_link"], cfg["pode_convocar"]), (False, False, False))
        with mock.patch.object(e, "JITSI_REUNIAO", "jitsi.minha.com"):
            self.assertEqual(self.get(f"/api/config?andar={self.B}", "ana")[1]["equipe"]["reunioes"]["hosts"][-1],
                             "jitsi.minha.com")
            time.sleep(0.35)
            st, r = self.post(f"/api/reunioes/link?andar={self.B}", "beto", {"sala": "lounge", "url": "https://jitsi.minha.com/x"})
            self.assertEqual(st, 200, r)


class Agenda(Reunioes):
    def test_marcar_listar_editar_cancelar(self):
        st, r = self.marca("ana", convidados=["bia"], sala="cozinha")
        self.assertEqual(st, 200, r)
        reuniao = r["reuniao"]
        self.assertEqual((reuniao["titulo"], reuniao["usuario"], reuniao["nome"], reuniao["meu"], reuniao["pode_mudar"]),
                         ("Planejamento", "ana", "Ana", True, True))
        self.assertEqual(reuniao["convidados"], [{"usuario": "bia", "nome": "Bia"}])
        st, lista = self.get(f"/api/reunioes?andar={self.B}", "bia")
        achada = next(x for x in lista["reunioes"] if x["id"] == reuniao["id"])
        self.assertEqual((achada["meu"], achada["pode_mudar"], achada["agora"]), (False, False, False))
        self.assertIsInstance(lista["v"], int)
        self.assertEqual(self.get(f"/api/reunioes?andar={self.B}", "carlos")[0], 404)   # outra empresa
        self.assertNotIn(reuniao["id"], [x["id"] for x in self.get(f"/api/reunioes?andar={self.C}", "cida")[1]["reunioes"]])
        edita = {"id": reuniao["id"], "titulo": "Novo", "sala": "cozinha", "inicio": reuniao["inicio"], "duracao": 45,
                 "convidados": ["bia", "beto"]}
        self.assertEqual(self.post(f"/api/reunioes/editar?andar={self.B}", "bia", edita)[1]["erro"], "nao_existe")
        self.assertEqual(self.post(f"/api/reunioes/editar?andar={self.C}", "cida", {**edita, "convidados": []})[0], 404)
        st, r = self.post(f"/api/reunioes/editar?andar={self.B}", "beto", edita)   # o admin do andar muda
        self.assertEqual((st, r["reuniao"]["titulo"], r["reuniao"]["duracao"]), (200, "Novo", 45))
        self.assertNotEqual(self.get(f"/api/reunioes?andar={self.B}", "bia")[1]["v"], lista["v"])
        time.sleep(0.25)
        self.assertEqual(self.post(f"/api/reunioes/cancelar?andar={self.B}", "bia", {"id": reuniao["id"]})[0], 404)
        self.assertEqual(self.post(f"/api/reunioes/cancelar?andar={self.B}", "ana", {"id": reuniao["id"]}), (200, {"ok": True}))
        self.assertEqual(self.post(f"/api/reunioes/cancelar?andar={self.B}", "ana", {"id": reuniao["id"]})[0], 404)

    def test_recusas(self):
        inicio = int(time.time()) + 7200
        st, r = self.marca("ana", convidados=["carlos"], inicio=inicio)   # de outra empresa
        self.assertEqual((st, r["erro"]), (400, "convidado"))
        st, r2 = self.marca("ana", convidados=["ninguem"], inicio=inicio)   # não existe: a mesma resposta
        self.assertEqual((st, r2), (400, r))
        self.assertEqual(self.marca("ana", sala="time:nenhum", inicio=inicio)[1]["erro"], "pedido")
        self.assertEqual(self.marca("ana", duracao=2, inicio=inicio)[1]["erro"], "pedido")
        self.assertEqual(self.marca("ana", inicio=int(time.time()) - 600)[1]["erro"], "pedido")
        st, r = self.marca("dono", inicio=inicio)   # o admin do prédio sem papel no andar só lê
        self.assertEqual((st, r["erro"]), (403, "papel"))
        time.sleep(1)
        self.assertEqual(self.marca("ana", sala="lounge", inicio=inicio)[0], 200)
        st, r = self.marca("bia", sala="lounge", inicio=inicio + 600)
        self.assertEqual((st, r["erro"]), (409, "sala_ocupada"))

    def test_ics_so_deste_andar(self):
        self.post(f"/api/reunioes/link?andar={self.B}", "beto", {"sala": "reuniao", "url": MEET})
        st, r = self.marca("ana", convidados=["bia"], titulo="Café; com, vírgula", inicio=int(time.time()) + 90000)
        self.assertEqual(st, 200, r)
        rota = f"/api/reunioes/ics?andar={self.B}&id={r['reuniao']['id']}"
        st, corpo, cab = self.req(rota, self.cab["bia"])
        self.assertEqual(st, 200)
        self.assertTrue(cab["Content-Type"].startswith("text/calendar"))
        self.assertTrue(cab["Content-Disposition"].startswith("attachment"))
        self.assertEqual((cab["X-Content-Type-Options"], cab["Cache-Control"]), ("nosniff", "private, no-store"))
        texto = corpo.decode("utf-8")
        self.assertIn("BEGIN:VEVENT\r\n", texto)
        self.assertIn("SUMMARY:Café\\; com\\, vírgula\r\n", texto)
        self.assertIn("LOCATION:Sala de reunião\r\n", texto)
        self.assertIn("URL:" + MEET, texto)
        self.assertIn("Bia", texto)
        for alheio in ("Carlos", "Cida", "Vendas", self.C):
            self.assertNotIn(alheio, texto)
        self.assertEqual(self.req(rota, self.cab["carlos"])[0], 404)   # outra empresa
        st, c = self.post(f"/api/reunioes/marcar?andar={self.C}", "cida", {
            "titulo": "Só de C", "sala": "reuniao", "inicio": int(time.time()) + 3600, "duracao": 30, "convidados": ["carlos"]})
        self.assertEqual(st, 200, c)
        # cada andar tem o seu banco: pelo andar B, o mesmo id é só a reunião de B (ou nada), nunca a de C
        st, corpo, _ = self.req(f"/api/reunioes/ics?andar={self.B}&id={c['reuniao']['id']}", self.cab["ana"])
        self.assertNotIn("Só de C".encode(), corpo)
        self.assertEqual(self.get(f"/api/reunioes/ics?andar={self.B}&id=999999", "ana")[1]["erro"], "nao_existe")


class Aviso(Reunioes):
    def test_aviso_5_min_antes_com_relogio_injetado(self):
        a = self.srv.avisos
        a.assinar("https://fcm.googleapis.com/fcm/send/bia-reuniao", time.time(), "bia")
        while not a.fila.empty():
            a.fila.get_nowait()
        inicio = int(time.time()) + 3 * 3600
        st, r = self.marca("ana", convidados=["bia"], titulo="Retro", inicio=inicio)
        self.assertEqual(st, 200, r)
        self.srv.avisar_reunioes(agora=inicio - 301)
        self.assertIsNone(self.avisos_de("bia"))
        self.srv.avisar_reunioes(agora=inicio - 299)
        aviso = self.avisos_de("bia")
        self.assertEqual((aviso["tipo"], aviso["titulo"], aviso["corpo"], aviso["sala"], aviso["reuniao"]),
                         ("reuniao", "Reunião em 5 min · Retro", "Sala de reunião", "reuniao", r["reuniao"]["id"]))
        self.assertEqual(self.avisos_de("ana")["tipo"], "reuniao")   # quem marcou também
        self.assertIsNone(self.avisos_de("carlos"))
        self.assertIsNone(self.avisos_de("beto"))   # não convidado
        self.assertEqual(a.fila.get_nowait()[3], "bia")   # push só para a conta dela
        self.srv.avisar_reunioes(agora=inicio - 200)   # uma vez só
        self.assertTrue(a.fila.empty())
        # tirada da lista depois do aviso (o início não muda, o aviso não rearma): não vê mais nem o título
        editar = {"id": r["reuniao"]["id"], "titulo": "Retro", "sala": "reuniao", "inicio": inicio, "duracao": 30}
        self.assertEqual(self.post(f"/api/reunioes/editar?andar={self.B}", "ana", {**editar, "convidados": []})[0], 200)
        self.assertIsNone(self.avisos_de("bia"))
        self.assertEqual(self.avisos_de("ana")["tipo"], "reuniao")
        self.assertEqual(self.post(f"/api/reunioes/editar?andar={self.B}", "ana", {**editar, "convidados": ["bia"]})[0], 200)
        self.assertEqual(self.avisos_de("bia")["titulo"], "Reunião em 5 min · Retro")
        # o "Não perturbe" segura o envio (o push vazio nunca sai para o aparelho dela)
        self.post("/api/perfil", "bia", {"avisos": {"modo": "silencio", "de": "00:00", "ate": "23:59"}})
        antes = len(self.enviados)
        a.disparar(time.time(), self.B, "bia")
        self.assertEqual(len(self.enviados), antes)
        self.post("/api/perfil", "bia", {"avisos": {"modo": "sempre"}})
        # cancelada antes do GET: o aviso some
        self.post(f"/api/reunioes/cancelar?andar={self.B}", "ana", {"id": r["reuniao"]["id"]})
        self.assertIsNone(self.avisos_de("bia"))
        # sem o começo: o título genérico e o corpo vazio
        st, r = self.marca("ana", convidados=["bia"], titulo="Segredo", inicio=inicio + 3600)
        self.post("/api/perfil", "bia", {"avisos": {"modo": "sempre", "comeco": False}})
        self.srv.avisar_reunioes(agora=inicio + 3600 - 100)
        self.assertEqual((self.avisos_de("bia")["titulo"], self.avisos_de("bia")["corpo"]), ("Reunião em 5 min", ""))
        self.post("/api/perfil", "bia", {"avisos": {"modo": "sempre"}})


class Convocacao(Reunioes):
    def test_convoca_avisa_e_entra_no_ao_vivo_com_limite(self):
        self.entrar_no_mapa("ana", self.B)
        seq = self.get(f"/api/ao-vivo?andar={self.B}", "ana")[1]["seq"]
        for quem in ("ana", "dono"):
            st, r = self.post(f"/api/reunioes/convocar?andar={self.B}", quem, {"sala": "reuniao"})
            self.assertEqual((st, r["erro"]), (403, "papel"), quem)
        self.assertEqual(self.post(f"/api/reunioes/convocar?andar={self.B}", "beto", {"sala": "nenhuma"})[1]["erro"], "pedido")
        st, r = self.post(f"/api/reunioes/convocar?andar={self.B}", "beto", {"sala": "reuniao"})
        self.assertEqual(st, 200, r)
        vivo = self.get(f"/api/ao-vivo?andar={self.B}&desde={seq}", "ana")[1]
        self.assertEqual(vivo["convocacao"], {"sala": "reuniao", "de": "beto", "nome": "Beto", "seq": r["seq"]})
        self.assertNotIn("convocacao", self.get(f"/api/ao-vivo?andar={self.B}&desde={r['seq']}", "ana")[1])
        self.assertNotIn("convocacao", self.get(f"/api/ao-vivo?andar={self.C}", "cida")[1])
        aviso = self.avisos_de("bia")
        self.assertEqual((aviso["tipo"], aviso["titulo"], aviso["corpo"]),
                         ("convocacao", "Beto chamou a equipe", "Reunião geral agora · Sala de reunião"))
        self.assertIsNone(self.avisos_de("carlos"))
        st, r = self.post(f"/api/reunioes/convocar?andar={self.B}", "beto", {"sala": "lounge"})
        self.assertEqual((st, r["erro"]), (429, "limite"))


class StatusAuto(Reunioes):
    def test_em_reuniao_enquanto_esta_na_sala(self):
        st, r = self.marca("bia", sala="time:nenhum")
        self.assertEqual(st, 400)
        st, r = self.marca("bia", sala="cozinha", inicio=int(time.time()), duracao=30)
        self.assertEqual(st, 200, r)
        self.entrar_no_mapa("ana", self.B, sala="cozinha")
        self.entrar_no_mapa("bia", self.B, sala="lounge")
        vivo = self.get(f"/api/ao-vivo?andar={self.B}", "bia")[1]
        ana = next(p for p in vivo["pessoas"] if p["usuario"] == "ana")
        self.assertEqual((ana["status"], ana["status_auto"]), ("reuniao", True))
        self.assertIsInstance(vivo["reunioes_v"], int)
        self.assertEqual(vivo["meu_status"], {"status": "disponivel", "texto": "", "em_reuniao": False})
        meu = self.get(f"/api/ao-vivo?andar={self.B}", "ana")[1]["meu_status"]
        self.assertEqual(meu, {"status": "disponivel", "texto": "", "em_reuniao": True})
        self.post(f"/api/status?andar={self.B}", "ana", {"status": "disponivel", "texto": "no café"})   # pôs o dela
        time.sleep(0.6)
        ana = next(p for p in self.get(f"/api/ao-vivo?andar={self.B}", "bia")[1]["pessoas"] if p["usuario"] == "ana")
        self.assertEqual((ana["status"], ana["status_texto"], ana["status_auto"]), ("disponivel", "no café", False))
        time.sleep(1)
        self.post(f"/api/status?andar={self.B}", "ana", {"status": "disponivel", "texto": ""})


class CorrecoesOnda2(Reunioes):
    def test_admin_do_predio_sem_papel_nao_acena(self):
        self.entrar_no_mapa("ana", self.B)
        self.entrar_no_mapa("dono", self.B)
        st, r = self.post(f"/api/aceno?andar={self.B}", "dono", {"para": "ana", "tipo": "aceno"})
        self.assertEqual((st, r["erro"]), (403, "papel"))
        st, r = self.post(f"/api/aceno?andar={self.B}", "dono", {"para": "ana", "tipo": "porta"})
        self.assertEqual((st, r["erro"]), (403, "papel"))
        self.assertEqual(self.post(f"/api/status?andar={self.B}", "dono", {"status": "ausente", "texto": ""})[0], 200)

    def test_teto_da_previa_so_para_imagem(self):
        st, r = self.anexo(f"/api/anexo?andar={self.B}&canal=geral", "beto", b"texto puro", "nota.txt")
        self.assertEqual(st, 200, r)
        rota = f"/api/anexo?andar={self.B}&id={r['mensagem']['anexo']['id']}"
        self.srv.downloads["bia"] = e.DOWNLOADS_MAX
        try:   # o texto sem &baixar=1 não é prévia: conta no teto dos downloads
            self.assertEqual(self.req(rota, self.cab["bia"])[0], 429)
        finally:
            del self.srv.downloads["bia"]
        self.srv.downloads[("previa", "bia")] = e.PREVIAS_MAX
        try:
            self.assertEqual(self.req(rota, self.cab["bia"])[0], 200)
        finally:
            del self.srv.downloads[("previa", "bia")]


class SaguaoSemReuniao(base.Http):
    setUpClass = classmethod(base.Saguao.setUpClass.__func__)
    tearDownClass = classmethod(base.Saguao.tearDownClass.__func__)

    def test_nada_de_reuniao_no_saguao(self):
        for rota in ("/api/reunioes", "/api/reunioes/links", "/api/reunioes/ics?id=1"):
            for quem in ("bia", "dono"):
                self.assertEqual(self.get(rota, quem)[0], 404, (rota, quem))
        corpos = {"/api/reunioes/marcar": {"titulo": "x", "sala": "reuniao", "inicio": int(time.time()) + 600,
                                           "duracao": 30, "convidados": []},
                  "/api/reunioes/editar": {"id": 1, "titulo": "x", "sala": "reuniao", "inicio": int(time.time()) + 600,
                                           "duracao": 30, "convidados": []},
                  "/api/reunioes/cancelar": {"id": 1}, "/api/reunioes/link": {"sala": "reuniao", "url": MEET},
                  "/api/reunioes/convocar": {"sala": "reuniao"}}
        for rota, corpo in corpos.items():
            st, r = self.post(rota, "bia", corpo)
            self.assertEqual((st, r["erro"]), (403, "papel"), rota)
            self.assertEqual(self.post(rota, "dono", corpo)[0], 404, rota)
        self.assertIsNone(self.get("/api/config", "bia")[1]["equipe"]["reunioes"])
        self.entrar_no_mapa("bia", e.ANDAR_PRINCIPAL)
        vivo = self.get("/api/ao-vivo", "bia")[1]
        self.assertNotIn("reunioes_v", vivo)
        self.assertNotIn("status_auto", vivo["pessoas"][0] if vivo["pessoas"] else {})


class Estaticos(unittest.TestCase):
    def test_arquivos_novos_da_onda_3(self):
        for nome in ("reunioes.js", "reunioes.css", "apresentacao.js"):
            self.assertIn(nome, e.ARQUIVOS)


if __name__ == "__main__":
    unittest.main()
