# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Espelho da ponte no servidor (ponte_espelho.py e as rotas /api/ponte*): a chave, a validação e o corte, o frescor de
90 s e quem lê (membro do andar sim; saguão, visita e anônimo não). Servidor de verdade, com os setups do test_membros."""
import json
import os
import shutil
import tempfile
import unittest

import escritorio as e
import ponte_espelho as pe
import test_membros as tm
from acesso import Acesso

CHAVE = "c0" * 32


def morador(i, **extra):
    return {"id": f"m{i}", "nome": "Ada", "provedor": "codex", "estado": "ocupado", "projeto": "loja",
            "atividade": {"ferramenta": "Edit", "alvo": "/segredo/arquivo.go", "desde": "2026-11-20T10:00:00Z"}, **extra}


def corpo(**extra):
    return {"v": 1, "moradores": [morador(1)], "workspaces": [{"id": "w1", "nome": "Loja", "bands": [{"id": "b1", "nome": "Front"}]}],
            "dia": [{"ts": "2026-11-20T10:00:00.123456789-03:00", "morador_id": "m1", "estado": "ocupado", "ferramenta": "Edit",
                     "alvo": "rm -rf /"}], **extra}


class Validacao(unittest.TestCase):
    def test_corta_e_tira_o_que_nao_e_da_tela(self):
        v = pe.validar(corpo(moradores=[morador(1, nome="x" * 300, provedor="outro", ajudantes=500, papel="\u0007Maestro",
                                                desde="ontem", segredo="não passa"),
                                        morador(2, estado="dormindo"), {"id": "", "estado": "ocupado"}, None, morador(1)]))
        self.assertEqual(len(v["moradores"]), 1, "inválidos e repetidos saem")
        m = v["moradores"][0]
        self.assertEqual((len(m["nome"]), m["provedor"], m["ajudantes"], m["papel"], m["desde"]), (40, "", 99, "Maestro", ""))
        self.assertEqual(m["atividade"], {"ferramenta": "Edit"}, "o alvo nunca fica")
        self.assertNotIn("segredo", m)
        self.assertNotIn("alvo", json.dumps(v))
        self.assertEqual(v["dia"][0]["ferramenta"], "Edit")

    def test_tetos(self):
        v = pe.validar(corpo(moradores=[morador(i) for i in range(60)],
                             workspaces=[{"id": f"w{i}", "nome": "W", "bands": [{"id": f"b{j}"} for j in range(40)]} for i in range(40)],
                             dia=[{"ts": f"2026-11-20T10:{i // 60:02d}:{i % 60:02d}Z", "morador_id": "m1", "estado": "ocioso",
                                   "ferramenta": str(i)} for i in range(250)] +
                                 [{"ts": "2026-11-20T10:00:00Z", "morador_id": f"x{i}", "estado": "erro"} for i in range(250)]))
        self.assertEqual(len(v["moradores"]), 48)
        self.assertEqual(len(v["workspaces"]), 32)
        self.assertEqual(len(v["workspaces"][0]["bands"]), 32)
        m1 = [d for d in v["dia"] if d["morador_id"] == "m1"]
        self.assertEqual((len(m1), m1[-1]["ferramenta"]), (200, "249"), "os 200 mais novos")
        self.assertLessEqual(len({d["morador_id"] for d in v["dia"]}), 200)

    def test_formato_errado(self):
        for ruim in (None, [], {"v": 3, "moradores": []}, {"v": 1}, {"v": 1, "moradores": {}}):
            with self.assertRaises(ValueError):
                pe.validar(ruim)

    def test_frescor_limite_e_teste(self):
        agora = [1000.0]
        esp = pe.Espelho(CHAVE, relogio=lambda: agora[0])
        self.assertEqual(esp.ler(), {"ativo": False})
        esp.receber(corpo(teste=True))
        self.assertEqual(esp.ler(), {"ativo": False}, "o teste do ponte conectar não guarda nada")
        esp.receber(corpo())
        self.assertTrue(esp.ler()["ativo"])
        with self.assertRaises(pe.Limite):
            esp.receber(corpo())
        agora[0] += 89
        self.assertEqual(esp.ler()["idade_s"], 89)
        agora[0] += 1
        self.assertEqual(esp.ler(), {"ativo": False}, "90 s sem envio: desligado")

    def test_chave(self):
        esp = pe.Espelho(CHAVE)
        self.assertTrue(esp.autorizado("Bearer " + CHAVE))
        for ruim in (None, "", CHAVE, "Bearer " + "c1" * 32, "bearer " + CHAVE, "Bearer " + CHAVE + " "):
            self.assertFalse(esp.autorizado(ruim))
        self.assertFalse(pe.Espelho("curta").ligado())
        self.assertEqual(pe.Espelho(CHAVE).origem(), "variavel")
        with self.assertRaises(ValueError):
            pe.Espelho(CHAVE).gerar()

    def test_chave_da_tela(self):
        pasta = tempfile.mkdtemp(prefix="espelho-")
        self.addCleanup(shutil.rmtree, pasta, True)
        arq = os.path.join(pasta, "ponte-espelho.chave")
        esp = pe.Espelho(None, arq)
        self.assertEqual((esp.ligado(), esp.origem()), (False, ""))
        chave = esp.gerar()
        self.assertEqual(oct(os.stat(arq).st_mode & 0o777), "0o600")
        self.assertTrue(esp.autorizado("Bearer " + chave))
        self.assertEqual(pe.Espelho(None, arq).origem(), "tela", "sobrevive ao reinício")
        nova = esp.gerar()
        self.assertFalse(esp.autorizado("Bearer " + chave), "a antiga para de valer")
        self.assertTrue(esp.autorizado("Bearer " + nova))
        esp.desligar()
        self.assertFalse(os.path.exists(arq))
        self.assertFalse(esp.autorizado("Bearer " + nova))


class Http(unittest.TestCase):
    """Modo clássico: o espelho é do andar principal."""
    setUpClass = classmethod(tm.Membros.setUpClass.__func__)
    tearDownClass = classmethod(tm.Membros.tearDownClass.__func__)
    req, post, cookie = classmethod(tm.Membros.req.__func__), tm.Membros.post, staticmethod(tm.Membros.cookie)
    membro = tm.Membros.membro

    def setUp(self):
        self.agora = [5000.0]
        self.srv.espelho_ponte = pe.Espelho(CHAVE, relogio=lambda: self.agora[0])
        self.dono = self.cookie(self.srv.acesso.entrar("dono", tm.SENHA_DONO))

    def enviar(self, obj, chave=CHAVE, tipo="application/json"):
        cab = {"Content-Type": tipo, **({"Authorization": "Bearer " + chave} if chave else {})}
        st, bruto, _ = self.req("/api/ponte/espelho", cab, json.dumps(obj).encode(), "POST")
        return st, bruto

    def ler(self, cab, andar=""):
        st, bruto, h = self.req("/api/ponte" + (f"?andar={andar}" if andar else ""), cab)
        return st, (json.loads(bruto) if bruto.startswith(b"{") else bruto), h

    def test_sem_a_chave_404_e_chave_errada_401(self):
        self.srv.espelho_ponte = pe.Espelho(None)
        self.assertEqual(self.enviar(corpo())[0], 404)
        self.srv.espelho_ponte = pe.Espelho(CHAVE, relogio=lambda: self.agora[0])
        st, bruto = self.enviar(corpo(), chave="c1" * 32)
        self.assertEqual(st, 401)
        self.assertNotIn(CHAVE.encode(), bruto)
        self.assertEqual(self.enviar(corpo(), chave="")[0], 401)
        self.assertEqual(self.enviar(corpo(), tipo="text/plain")[0], 415)
        self.assertEqual(self.enviar({"v": 1})[0], 400)
        st, _, _ = self.req("/api/ponte/espelho", {"Content-Type": "application/json", "Authorization": "Bearer " + CHAVE,
                                                   "Content-Length": str(pe.CORPO_MAX + 1)}, b"{}", "POST")
        self.assertIn(st, (413, 400))

    def test_membro_le_fresco_e_sem_cache(self):
        self.assertEqual(self.enviar(corpo())[0], 204)
        self.assertEqual(self.enviar(corpo())[0], 429, "um envio por segundo")
        ana = self.membro("anaponte")
        st, d, h = self.ler(ana)
        self.assertEqual((st, d["ativo"], d["moradores"][0]["id"]), (200, True, "m1"))
        self.assertIn("no-store", h["Cache-Control"])
        self.assertNotIn("alvo", json.dumps(d))
        self.assertNotIn("espelho", d, "membro não vê de onde vem a chave")
        self.assertNotIn(CHAVE, json.dumps(d))
        self.agora[0] += 90
        self.assertEqual(self.ler(ana)[1], {"ativo": False})

    def test_anonimo_visita_e_outro_andar(self):
        self.enviar(corpo())
        self.assertEqual(self.ler({})[0], 401)
        convite = self.srv.salas_visitas.criar()
        visita = self.srv.salas_visitas.entrar(convite)
        self.assertEqual(self.ler(self.cookie(visita))[0], 401, "a credencial da visita não é sessão")
        self.assertEqual(self.ler({"Cookie": "esc_sessao=" + convite})[0], 401)
        acesso = self.srv.acesso
        if "soextra" in acesso.usuarios:
            acesso.remover("soextra")
        token, _ = acesso.convidar("Soextra", [self.extra], principal=False)
        so_extra = self.cookie(acesso.aceitar_convite(token, "soextra", tm.SENHA, "Soextra", tm.AVATAR))
        st, d, _ = self.ler(so_extra, self.extra)
        self.assertEqual((st, d), (200, {"ativo": False}), "o espelho é do principal, não de outro andar")
        self.assertEqual(self.ler(so_extra, e.ANDAR_PRINCIPAL)[0], 404)

    def test_admin_gera_a_chave_pela_tela(self):
        pasta = tempfile.mkdtemp(prefix="espelho-http-")
        self.addCleanup(shutil.rmtree, pasta, True)
        self.srv.espelho_ponte = pe.Espelho(None, os.path.join(pasta, "ponte-espelho.chave"))
        self.assertEqual(self.ler(self.dono)[1], {"ativo": False, "espelho": "", "decidir": True})
        ana = self.membro("anachave")
        self.assertEqual(self.post("/api/ponte/chave", {"acao": "gerar"}, ana)[0], 403, "só o admin do prédio")
        self.assertEqual(self.post("/api/ponte/chave", {"acao": "gerar"}, self.dono, origem="https://outro.exemplo")[0], 403)
        self.assertEqual(self.post("/api/ponte/chave", {"acao": "gerar"}, {})[0], 401)
        st, d, _ = self.post("/api/ponte/chave", {"acao": "gerar"}, self.dono)
        self.assertEqual(st, 200)
        chave = d["chave"]
        self.assertEqual(d["comando"], f"ponte conectar {e.BASE}")   # a chave não vai no comando (histórico do shell)
        self.assertRegex(chave, r"^[0-9a-f]{64}$")
        self.assertEqual(self.ler(self.dono)[1]["espelho"], "tela")
        self.assertEqual(self.enviar(corpo(), chave=chave)[0], 204)
        self.assertTrue(self.ler(ana)[1]["ativo"])
        self.assertEqual(self.post("/api/ponte/chave", {"acao": "desligar"}, self.dono)[0], 200)
        self.assertEqual(self.enviar(corpo(), chave=chave)[0], 404)
        self.srv.espelho_ponte = pe.Espelho(CHAVE)
        self.assertEqual(self.post("/api/ponte/chave", {"acao": "gerar"}, self.dono)[0], 409, "a variável manda")


class NoSaguao(unittest.TestCase):
    """Modo saguão: o saguão nunca recebe o espelho; ele só aparece no andar do ESCRITORIO_PONTE_ANDAR."""
    setUpClass = classmethod(tm.EmpresasNoSaguao.setUpClass.__func__)
    tearDownClass = classmethod(tm.EmpresasNoSaguao.tearDownClass.__func__)
    req = classmethod(tm.Membros.req.__func__)
    A, B, PNG = tm.EmpresasNoSaguao.A, tm.EmpresasNoSaguao.B, tm.EmpresasNoSaguao.PNG

    def setUp(self):
        self.srv.espelho_ponte = pe.Espelho(CHAVE)
        self.antes = e.PONTE_ANDAR
        self.addCleanup(setattr, e, "PONTE_ANDAR", self.antes)
        st, _, _ = self.req("/api/ponte/espelho", {"Content-Type": "application/json", "Authorization": "Bearer " + CHAVE},
                            json.dumps(corpo()).encode(), "POST")
        self.assertEqual(st, 204)

    def ler(self, quem, andar=""):
        st, bruto, _ = self.req("/api/ponte" + (f"?andar={andar}" if andar else ""), self.cab[quem])
        return st, (json.loads(bruto) if bruto.startswith(b"{") else None)

    def test_saguao_nao_recebe(self):
        e.PONTE_ANDAR = ""
        self.assertEqual(self.ler("membrob")[0], 404, "a pessoa no saguão: a rota não existe")
        self.assertEqual(self.ler("membroa", self.A), (200, {"ativo": False}), "sem andar configurado, nenhum")
        self.assertEqual(self.ler("dono", e.ANDAR_PRINCIPAL)[1], {"ativo": False, "espelho": "variavel"})

    def test_so_o_andar_configurado(self):
        e.PONTE_ANDAR = self.A
        st, d = self.ler("membroa", self.A)
        self.assertEqual((st, d["ativo"]), (200, True))
        self.assertEqual(self.ler("membrob", self.B), (200, {"ativo": False}))
        self.assertEqual(self.ler("membrob", self.A)[0], 404, "andar alheio")


if __name__ == "__main__":
    unittest.main()
