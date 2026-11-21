# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Responder pelo escritório (ponte_espelho.py e as rotas /api/ponte/decidir e /api/ponte/decisoes): os pedidos de
permissão do espelho v2, a decisão de uso único (410 na repetida, na vencida e na desconhecida), a fila que a ponte busca
uma vez só, quem decide (admin do prédio e ESCRITORIO_PONTE_DECISORES, só no andar da ponte), a origem, o formato e os
limites. Servidor de verdade, com os setups do test_membros."""
import json
import threading
import time
import unittest
from datetime import datetime, timedelta, timezone

import escritorio as e
import ponte_espelho as pe
import test_membros as tm
from test_ponte_espelho import CHAVE, corpo

ID1, ID2 = "A" * 21 + "1", "B" * 21 + "2"


def iso(segundos):
    return (datetime.now(timezone.utc) + timedelta(seconds=segundos)).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def pendente(id_=ID1, segundos=60, **extra):
    return {"id": id_, "morador_id": "m1", "tipo": "permissao", "ferramenta": "Bash", "resumo": "git push",
            "completo": True, "expira_em": iso(segundos), **extra}


def v2(*pendentes, **extra):
    return corpo(v=2, pendentes=list(pendentes), **extra)


def pergunta(id_=ID1, **extra):
    return {"id": id_, "morador_id": "m1", "tipo": "pergunta", "ferramenta": "", "resumo": "", "completo": False,
            "via": "maestri", "expira_em": iso(60), **extra}


def morador_ponte(estado):
    return {"id": "m1", "nome": "Ada", "provedor": "claude_code", "estado": {"pergunta": "esperando_resposta",
                                                                             "aprovacao": "esperando_permissao"}[estado]}


class Espelho(unittest.TestCase):
    def setUp(self):
        self.agora = [1000.0]
        self.esp = pe.Espelho(CHAVE, relogio=lambda: self.agora[0])

    def test_valida_e_corta_os_pedidos(self):
        ruins = [pendente("curto"), pendente(ID2, tipo="pergunta"), pendente(ID2, segundos=-1), pendente(ID2, segundos=3600),
                 pendente(ID2, morador_id=""), {"id": ID2}, None]
        self.esp.receber(v2(pendente(resumo="x" * 400, ferramenta="F" * 80, tool_input={"command": "rm"}), pendente(), *ruins))
        d = self.esp.ler(decide=True)
        self.assertEqual(len(d["pendentes"]), 1, "inválidos, repetidos e vencidos saem")
        p = d["pendentes"][0]
        self.assertEqual((len(p["resumo"]), len(p["ferramenta"]), p["completo"]), (300, 80, False), "cortado aqui: incompleto")
        self.assertNotIn("tool_input", p)
        self.assertTrue(55 <= p["resta_s"] <= 60)
        self.assertNotIn("pendentes", self.esp.ler(), "quem não decide não vê os pedidos")
        self.agora[0] += 2
        self.esp.receber(corpo(pendentes=[pendente()]))   # v1 (ponte antiga): sem pedidos
        self.assertEqual(self.esp.ler(decide=True)["pendentes"], [], "v1 não traz pedidos")

    def test_uso_unico_e_entrega_uma_vez(self):
        self.esp.receber(v2(pendente(), pendente(ID2)))
        self.assertEqual(self.esp.decidir(ID1, "permitir")["ferramenta"], "Bash")
        with self.assertRaises(pe.Encerrado):
            self.esp.decidir(ID1, "negar")
        with self.assertRaises(pe.Encerrado):
            self.esp.decidir("C" * 22, "negar")
        with self.assertRaises(ValueError):
            self.esp.decidir(ID2, "talvez")
        self.assertEqual([p["id"] for p in self.esp.ler(decide=True)["pendentes"]], [ID2], "o decidido sai da lista")
        self.agora[0] += 2
        self.esp.receber(v2(pendente(), pendente(ID2)))   # a ponte ainda não soube: o decidido segue fora
        with self.assertRaises(pe.Encerrado):
            self.esp.decidir(ID1, "permitir")
        decisoes, _ = self.esp.esperar_decisoes(0)
        self.assertEqual(decisoes, [{"id": ID1, "acao": "permitir"}])
        self.assertEqual(self.esp.esperar_decisoes(0)[0], [], "cada decisão sai uma vez só")

    def test_vencido_e_espelho_parado(self):
        utc = [datetime.now(timezone.utc)]
        esp = pe.Espelho(CHAVE, relogio=lambda: self.agora[0], utc=lambda: utc[0])
        esp.receber(v2(pendente(segundos=30)))
        utc[0] += timedelta(seconds=31)
        with self.assertRaises(pe.Encerrado):
            esp.decidir(ID1, "permitir")
        esp2 = pe.Espelho(CHAVE, relogio=lambda: self.agora[0])
        esp2.receber(v2(pendente()))
        self.agora[0] += pe.FRESCOR_S
        with self.assertRaises(pe.Encerrado):
            esp2.decidir(ID1, "permitir")

    def test_long_poll_acorda_na_decisao_e_no_atender(self):
        esp = pe.Espelho(CHAVE)
        esp.receber(v2(pendente()))
        threading.Timer(0.2, esp.decidir, (ID1, "negar")).start()
        inicio = time.monotonic()
        decisoes, atendendo = esp.esperar_decisoes(5)
        self.assertLess(time.monotonic() - inicio, 2)
        self.assertEqual((decisoes, atendendo), ([{"id": ID1, "acao": "negar"}], False))
        threading.Timer(0.2, esp.ler, (True,)).start()
        inicio = time.monotonic()
        self.assertEqual(esp.esperar_decisoes(5), ([], True), "quem decide abriu o mapa: a ponte fica sabendo já")
        self.assertLess(time.monotonic() - inicio, 2)

    def test_caracteres_enganosos_e_incompleto(self):
        self.esp.receber(v2(pendente(resumo="rm -rf \u202e/ \u200bx\u0085y\x1b"), pendente(ID2, completo=False)))
        ps = {p["id"]: p for p in self.esp.ler(decide=True)["pendentes"]}
        self.assertEqual(ps[ID1]["resumo"], "rm -rf ‹U+202E›/ ‹U+200B›x‹U+0085›y‹U+001B›")
        self.assertFalse(ps[ID1]["completo"], "o texto mudou aqui: incompleto")
        self.assertFalse(ps[ID2]["completo"])
        with self.assertRaises(pe.Incompleto):
            self.esp.decidir(ID2, "permitir")
        self.assertEqual(self.esp.decidir(ID2, "negar")["ferramenta"], "Bash", "negar vale")

    def test_limite_por_pessoa(self):
        for _ in range(pe.DECISOES_POR_MIN):
            self.assertTrue(self.esp.limite_decisao("ana"))
        self.assertFalse(self.esp.limite_decisao("ana"))
        self.assertTrue(self.esp.limite_decisao("bia"), "o limite é por pessoa")
        self.agora[0] += 60
        self.assertTrue(self.esp.limite_decisao("ana"))


class Respostas(unittest.TestCase):
    def test_texto_resposta_recusa_cada_classe(self):
        for ruim in ("", "   ", "a\nb", "a\rb", "a\tb", "\x1b[A", "a\x00b", "a\x7fb", "a\u0085b", "a\u009bb", "a\\nb",
                     "a\u202eb", "a\u2066b", "a\u200bb", "a\u200db", "\ufeffa", "a\u2028b", "a\u2029b", "a\ue000b",
                     "a\U000E0041b", "a\ud800b", "é" * 1001, None, 5, "-x", "  --raw x"):
            self.assertIsNone(pe.texto_resposta(ruim), repr(ruim))
        for bom, limpo in (("  sim  ", "sim"), ("é" * 1000, "é" * 1000), ("👍🏽 日本語 ✓", "👍🏽 日本語 ✓"),
                           ('"aspas" $(x) ; | -x', '"aspas" $(x) ; | -x'), ("a\u00a0b", "a\u00a0b")):
            self.assertEqual(pe.texto_resposta(bom), limpo)

    def test_pergunta_no_espelho(self):
        esp = pe.Espelho(CHAVE, relogio=lambda: 1000.0)
        esp.receber(v2(pergunta(resumo="Qual\u202e banco?", ferramenta="X", completo=True), pergunta(ID2, via="tmux"),
                       moradores=[morador_ponte("pergunta")]))
        ps = esp.ler(decide=True)["pendentes"]
        self.assertEqual(len(ps), 1, "via desconhecida sai")
        self.assertEqual((ps[0]["resumo"], ps[0]["ferramenta"], ps[0]["completo"], ps[0]["via"]),
                         ("Qual‹U+202E› banco?", "", False, "maestri"))
        with self.assertRaises(ValueError):
            esp.decidir(ID1, "responder", "a\nb")
        with self.assertRaises(pe.TipoErrado):
            esp.decidir(ID1, "negar")
        self.assertEqual(esp.decidir(ID1, "responder", " ok ")["tipo"], "pergunta")
        self.assertEqual(esp.esperar_decisoes(0)[0], [{"id": ID1, "acao": "responder", "texto": "ok"}])


class Http(unittest.TestCase):
    """Modo clássico: o andar da ponte é o principal."""
    setUpClass = classmethod(tm.Membros.setUpClass.__func__)
    tearDownClass = classmethod(tm.Membros.tearDownClass.__func__)
    req, post, cookie = classmethod(tm.Membros.req.__func__), tm.Membros.post, staticmethod(tm.Membros.cookie)
    membro = tm.Membros.membro

    def setUp(self):
        self.agora = [5000.0]
        self.srv.espelho_ponte = pe.Espelho(CHAVE, relogio=lambda: self.agora[0])
        self.dono = self.cookie(self.srv.acesso.entrar("dono", tm.SENHA_DONO))
        self.antes = e.PONTE_DECISORES
        self.addCleanup(setattr, e, "PONTE_DECISORES", self.antes)
        st, _, _ = self.req("/api/ponte/espelho", {"Content-Type": "application/json", "Authorization": "Bearer " + CHAVE},
                            json.dumps(v2(pendente(), pendente(ID2))).encode(), "POST")
        self.assertEqual(st, 204)

    def decidir(self, cab, id_=ID1, acao="permitir", **kw):
        return self.post("/api/ponte/decidir", {"id": id_, "acao": acao}, cab, **kw)

    def buscar(self, chave=CHAVE, espera=0):
        return self.req(f"/api/ponte/decisoes?espera={espera}", {"Authorization": "Bearer " + chave} if chave else {})

    def test_admin_decide_uma_vez_e_a_ponte_busca_uma_vez(self):
        st, d, _ = self.req("/api/ponte", self.dono)
        d = json.loads(d)
        self.assertTrue(d["decidir"])
        self.assertEqual([p["id"] for p in d["pendentes"]], [ID1, ID2])
        st, _, h = self.buscar()
        self.assertEqual((st, h["X-Ponte-Atendendo"]), (204, "1"), "o admin com o mapa aberto: atendendo")
        self.assertEqual(self.decidir(self.dono)[:2], (200, {"ok": True}))
        st, _, _ = self.decidir(self.dono, acao="negar")
        self.assertEqual(st, 410, "a decisão repetida")
        self.assertEqual(self.decidir(self.dono, "C" * 22)[0], 410, "id que não existe")
        st, bruto, _ = self.buscar()
        self.assertEqual((st, json.loads(bruto)["decisoes"]), (200, [{"id": ID1, "acao": "permitir"}]))
        self.assertEqual(self.buscar()[0], 204, "entregue uma vez só")

    def test_quem_decide(self):
        ana = self.membro("anadecide")
        st, d, _ = self.decidir(ana)
        self.assertEqual((st, d["erro"]), (403, "decisor"), "membro comum só vê")
        st, d, _ = self.req("/api/ponte", ana)
        d = json.loads(d)
        self.assertNotIn("pendentes", d)
        self.assertNotIn("decidir", d)
        e.PONTE_DECISORES = frozenset({"anadecide"})
        self.assertEqual(self.decidir(ana)[0], 200, "quem está na ESCRITORIO_PONTE_DECISORES decide")
        self.assertEqual(self.post(f"/api/ponte/decidir?andar={self.extra}", {"id": ID2, "acao": "negar"}, self.dono)[0], 403,
                         "fora do andar da ponte, ninguém decide")
        self.assertEqual(self.decidir({}, ID2)[0], 401)

    def test_origem_formato_e_limites(self):
        self.assertEqual(self.decidir(self.dono, origem="https://outro.exemplo")[0], 403)
        for ruim in ({"id": ID1, "acao": "permitir", "extra": 1}, {"id": ID1}, {"id": ID1, "acao": "sim"},
                     {"id": "curto", "acao": "negar"}, {"id": 5, "acao": "negar"}):
            self.assertEqual(self.post("/api/ponte/decidir", ruim, self.dono)[0], 400, ruim)
        st, _, _ = self.req("/api/ponte/decidir", {**self.dono, "Origin": self.base, "Content-Type": "text/plain"},
                            json.dumps({"id": ID1, "acao": "negar"}).encode(), "POST")
        self.assertEqual(st, 415)
        st, _, _ = self.req("/api/ponte/decidir", {**self.dono, "Origin": self.base, "Content-Type": "application/json"},
                            json.dumps({"id": ID1, "acao": "negar", "x": "a" * 9000}).encode(), "POST")
        self.assertEqual(st, 413)
        for _ in range(pe.DECISOES_POR_MIN - 7):   # as 7 de cima já contaram
            self.decidir(self.dono, "C" * 22)
        self.assertEqual(self.decidir(self.dono)[0], 429)
        self.agora[0] += 61
        self.assertEqual(self.decidir(self.dono)[0], 200)

    def test_incompleto_so_nega_de_longe(self):
        self.agora[0] += 2
        st, _, _ = self.req("/api/ponte/espelho", {"Content-Type": "application/json", "Authorization": "Bearer " + CHAVE},
                            json.dumps(v2(pendente(completo=False))).encode(), "POST")
        self.assertEqual(st, 204)
        st, d, _ = self.decidir(self.dono)
        self.assertEqual((st, d["erro"]), (409, "incompleto"))
        self.assertEqual(self.decidir(self.dono, acao="negar")[0], 200)

    def test_responder_pergunta(self):
        self.agora[0] += 2
        st, _, _ = self.req("/api/ponte/espelho", {"Content-Type": "application/json", "Authorization": "Bearer " + CHAVE},
                            json.dumps(v2(pergunta(), pendente(ID2), moradores=[morador_ponte("pergunta")])).encode(), "POST")
        self.assertEqual(st, 204)
        st, d, _ = self.req("/api/ponte", self.dono)
        p = json.loads(d)["pendentes"][0]
        self.assertEqual((p["tipo"], p["via"], p["completo"]), ("pergunta", "maestri", False))

        def responder(id_=ID1, texto="sim, pode"):
            return self.post("/api/ponte/decidir", {"id": id_, "acao": "responder", "texto": texto}, self.dono)
        for ruim in ("linha\noutra", "a\\nb", "\x1b[A", "a\u202eb", "", 5):
            st, d, _ = responder(texto=ruim)
            self.assertEqual((st, d["erro"]), (400, "texto"), ruim)
        self.assertEqual(self.post("/api/ponte/decidir", {"id": ID1, "acao": "responder"}, self.dono)[0], 400, "sem o texto")
        self.assertEqual(self.post("/api/ponte/decidir", {"id": ID1, "acao": "permitir", "texto": "x"}, self.dono)[0], 400)
        self.assertEqual(responder(ID2)[1]["erro"], "tipo", "permissão não recebe texto")
        self.assertEqual(self.decidir(self.dono, ID1, "permitir")[1]["erro"], "tipo", "pergunta não recebe permitir")
        self.assertEqual(responder(texto="  sim, pode  ")[:2], (200, {"ok": True}))
        self.assertEqual(responder()[0], 410, "uso único")
        st, bruto, _ = self.buscar()
        self.assertEqual(json.loads(bruto)["decisoes"], [{"id": ID1, "acao": "responder", "texto": "sim, pode"}])
        st, _, _ = self.req("/api/ponte/decidir", {**self.dono, "Origin": self.base, "Content-Type": "application/json"},
                            json.dumps({"id": ID1, "acao": "responder", "texto": "é" * 1000}, ensure_ascii=False).encode(), "POST")
        self.assertNotEqual(st, 413, "mil caracteres cabem no corpo")

    def test_pergunta_fora_do_estado_e_so_quem_decide(self):
        self.agora[0] += 2
        self.req("/api/ponte/espelho", {"Content-Type": "application/json", "Authorization": "Bearer " + CHAVE},
                 json.dumps(v2(pergunta(), moradores=[morador_ponte("aprovacao")])).encode(), "POST")
        st, d, _ = self.post("/api/ponte/decidir", {"id": ID1, "acao": "responder", "texto": "1"}, self.dono)
        self.assertEqual((st, d["erro"]), (409, "estado"), "na aprovação, nunca")
        ana = self.membro("anaresponde")
        self.assertEqual(self.post("/api/ponte/decidir", {"id": ID1, "acao": "responder", "texto": "1"}, ana)[0], 403)

    def test_long_poll_so_com_a_chave(self):
        self.assertEqual(self.buscar(chave="c1" * 32)[0], 401)
        self.assertEqual(self.buscar(chave="")[0], 401)
        self.assertEqual(self.req("/api/ponte/decisoes", self.dono)[0], 401, "o cookie não serve: só o Bearer da ponte")
        self.srv.espelho_ponte = pe.Espelho(None)
        self.assertEqual(self.buscar()[0], 404)
        self.assertEqual(self.decidir(self.dono)[0], 404)


if __name__ == "__main__":
    unittest.main()
