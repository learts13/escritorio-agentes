# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Linha do tempo dos agentes (linha.py): as transições de estado gravadas por dia, a virada do dia, os 14 dias, o
teto, o resumo "enquanto você esteve fora" e as rotas GET /api/linha e /api/fora (só o andar da pessoa; nada no
saguão). Relógio injetado em tudo."""
import datetime
import json
import os
import shutil
import tempfile
import unittest

import escritorio as e
from linha import Linha
import test_membros


FUSO = e.FUSO


def instante(texto):
    """'2026-11-16 09:00' no fuso de Brasília, em segundos."""
    return datetime.datetime.strptime(texto, "%Y-%m-%d %H:%M").replace(tzinfo=FUSO).timestamp()


class Registro(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="linha-")
        self.linha = Linha(self.pasta, FUSO)

    def tearDown(self):
        shutil.rmtree(self.pasta, ignore_errors=True)

    def arquivos(self):
        return sorted(os.listdir(os.path.join(self.pasta, "linha")))

    def test_grava_so_as_transicoes_do_agente_sem_texto(self):
        t = instante("2026-11-16 09:00")
        self.linha.gravar([("a1", "livre", "trabalhando"), ("b2", "livre", "aprovacao")], t)
        self.linha.gravar([("a1", "trabalhando", "livre")], t + 600)
        self.assertEqual(self.linha.do_dia("a1", "2026-11-16"), [{"de": "livre", "para": "trabalhando", "em": int(t)},
                                                                 {"de": "trabalhando", "para": "livre", "em": int(t) + 600}])
        self.assertEqual(self.linha.do_dia("b2", "2026-11-16"), [{"de": "livre", "para": "aprovacao", "em": int(t)}])
        self.assertEqual(self.linha.do_dia("zz", "2026-11-16"), [])
        self.assertEqual(self.linha.do_dia("a1", "2026-11-15"), [])
        with open(os.path.join(self.pasta, "linha", "2026-11-16.jsonl"), encoding="utf-8") as f:
            linhas = [json.loads(x) for x in f]
        self.assertEqual(set(linhas[0]), {"agente", "de", "para", "em"})

    def test_nada_a_gravar_nao_cria_arquivo(self):
        self.linha.gravar([], instante("2026-11-16 09:00"))
        self.assertFalse(os.path.exists(os.path.join(self.pasta, "linha")))

    def test_recusa_estado_ou_agente_fora_do_formato(self):
        t = instante("2026-11-16 09:00")
        self.linha.gravar([("a1", "livre", "dormindo"), ("../x", "livre", "trabalhando"), ("a1", "livre", "trabalhando")], t)
        self.assertEqual(len(self.linha.do_dia("a1", "2026-11-16")), 1)

    def test_virada_do_dia_no_fuso_de_brasilia(self):
        self.linha.gravar([("a1", "livre", "trabalhando")], instante("2026-11-16 23:59"))
        self.linha.gravar([("a1", "trabalhando", "livre")], instante("2026-11-17 00:01"))
        self.assertEqual(self.arquivos(), ["2026-11-16.jsonl", "2026-11-17.jsonl"])
        self.assertEqual([x["para"] for x in self.linha.do_dia("a1", "2026-11-17")], ["livre"])

    def test_guarda_14_dias(self):
        for d in range(20):
            self.linha.gravar([("a1", "livre", "trabalhando")], instante("2026-11-01 10:00") + d * 86400)
        self.assertEqual(self.arquivos()[0], "2026-11-07.jsonl")   # o dia 20 e os 13 antes dele
        self.assertEqual(len(self.arquivos()), 14)
        self.assertEqual(self.linha.do_dia("a1", "2026-11-06"), [])

    def test_apaga_so_os_arquivos_do_formato(self):
        os.makedirs(os.path.join(self.pasta, "linha"))
        for nome in ("2026-01-01.jsonl", "leia-me.txt"):
            open(os.path.join(self.pasta, "linha", nome), "w").close()
        self.linha.gravar([("a1", "livre", "trabalhando")], instante("2026-11-16 10:00"))
        self.assertEqual(self.arquivos(), ["2026-11-16.jsonl", "leia-me.txt"])

    def test_limpar_sem_gravacao_nova(self):
        """A varredura diária tira os dias velhos do andar parado; sem a pasta, não levanta."""
        self.linha.limpar(instante("2026-11-16 10:00"))
        os.makedirs(os.path.join(self.pasta, "linha"))
        for nome in ("2026-11-02.jsonl", "2026-11-03.jsonl", "2026-11-16.jsonl"):
            open(os.path.join(self.pasta, "linha", nome), "w").close()
        self.linha.limpar(instante("2026-11-16 10:00"))
        self.assertEqual(self.arquivos(), ["2026-11-03.jsonl", "2026-11-16.jsonl"])   # hoje e os 13 antes

    def test_dia_ok_so_os_14_dias(self):
        agora, dia = instante("2026-11-16 10:00"), datetime.date.fromisoformat
        self.assertEqual([self.linha.dia_ok(dia(d), agora) for d in ("2026-11-02", "2026-11-03", "2026-11-16", "2026-11-17")],
                         [False, True, True, False])

    def test_teto_de_linhas_por_dia(self):
        linha = Linha(self.pasta, FUSO, teto=3)
        t = instante("2026-11-16 10:00")
        linha.gravar([("a1", "livre", "trabalhando")] * 2, t)
        linha.gravar([("a1", "trabalhando", "livre")] * 2, t + 60)
        self.assertEqual(len(linha.do_dia("a1", "2026-11-16")), 3)
        Linha(self.pasta, FUSO, teto=3).gravar([("a1", "livre", "trabalhando")], t + 120)   # reiniciou: conta o disco
        self.assertEqual(len(linha.do_dia("a1", "2026-11-16")), 3)
        linha.gravar([("a1", "livre", "trabalhando")], t + 86400)   # no dia seguinte, recomeça
        self.assertEqual(len(linha.do_dia("a1", "2026-11-17")), 1)

    def test_linha_corrompida_e_ignorada(self):
        t = instante("2026-11-16 10:00")
        self.linha.gravar([("a1", "livre", "trabalhando")], t)
        with open(os.path.join(self.pasta, "linha", "2026-11-16.jsonl"), "a", encoding="utf-8") as f:
            f.write('{"agente": "a1", "de": "livre"\n[1,2]\n{"agente": "a1", "de": "x", "para": "livre", "em": 1}\n')
        self.assertEqual(len(self.linha.do_dia("a1", "2026-11-16")), 1)

    def test_falha_de_disco_nao_levanta(self):
        open(os.path.join(self.pasta, "linha"), "w").close()   # um arquivo no lugar da pasta
        self.linha.gravar([("a1", "livre", "trabalhando")], instante("2026-11-16 10:00"))


class Fora(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="linha-fora-")
        self.linha = Linha(self.pasta, FUSO)

    def tearDown(self):
        shutil.rmtree(self.pasta, ignore_errors=True)

    def test_resumo_com_espera_resolvida_e_nao_resolvida(self):
        g, t = self.linha.gravar, instante("2026-11-15 18:00")
        g([("bento", "livre", "trabalhando"), ("lia", "livre", "trabalhando")], t + 60)
        g([("bento", "trabalhando", "aprovacao")], t + 600)
        g([("bento", "aprovacao", "trabalhando")], t + 600 + 40 * 60)   # esperou 40 min, resolvido
        g([("bento", "trabalhando", "livre"), ("lia", "trabalhando", "livre")], t + 3600 * 3)
        g([("lia", "livre", "trabalhando")], t + 3600 * 4)
        g([("lia", "trabalhando", "livre")], t + 3600 * 5)
        g([("lia", "livre", "resposta")], t + 3600 * 6)   # ainda esperando
        agora = instante("2026-11-16 08:00")
        r = self.linha.fora(t, agora)
        self.assertEqual((r["desde"], r["ate"]), (int(t), int(agora)))
        por = {a["agente"]: a for a in r["agentes"]}
        self.assertEqual((por["bento"]["tarefas"], por["lia"]["tarefas"]), (1, 2))
        self.assertEqual(por["bento"]["esperas"], [{"tipo": "aprovacao", "inicio": int(t) + 600, "fim": int(t) + 3000,
                                                    "duracao_s": 2400, "resolvida": True}])
        self.assertEqual(por["lia"]["esperas"], [{"tipo": "resposta", "inicio": int(t) + 3600 * 6, "fim": None,
                                                  "duracao_s": int(agora - t) - 3600 * 6, "resolvida": False}])

    def test_so_o_que_aconteceu_desde(self):
        g, t = self.linha.gravar, instante("2026-11-15 17:00")
        g([("bento", "livre", "trabalhando")], t)
        g([("bento", "trabalhando", "livre")], t + 600)   # antes do "desde": não conta
        g([("bento", "trabalhando", "aprovacao")], t + 1800)   # começou antes, resolveu depois: conta
        g([("bento", "aprovacao", "trabalhando")], t + 7200)
        g([("rui", "livre", "trabalhando")], t + 7300)   # começou e nada terminou: sem nada a contar
        r = self.linha.fora(t + 3600, t + 9000)
        self.assertEqual(r["agentes"], [{"agente": "bento", "tarefas": 0, "esperas": [
            {"tipo": "aprovacao", "inicio": int(t) + 1800, "fim": int(t) + 7200, "duracao_s": 5400, "resolvida": True}]}])

    def test_teto_de_7_dias(self):
        g, agora = self.linha.gravar, instante("2026-11-16 08:00")
        g([("a1", "trabalhando", "livre")], agora - 10 * 86400)
        g([("a1", "trabalhando", "livre")], agora - 3 * 86400)
        r = self.linha.fora(0, agora)
        self.assertEqual(r["desde"], int(agora) - 7 * 86400)
        self.assertEqual(r["agentes"][0]["tarefas"], 1)

    def test_desde_no_futuro_sai_vazio(self):
        agora = instante("2026-11-16 08:00")
        self.assertEqual(self.linha.fora(agora + 60, agora)["agentes"], [])


class Transicoes(unittest.TestCase):
    """O Diario entrega as transições de cada leitura (agente, de, para), sem a linha de base."""

    def leitura(self, d, *tarefas, completa=True):
        d.registrar([{"agente_id": a, "run_id": r, "status": s} for a, r, s in tarefas], {"a1": "pixel"}, 1000, completa)
        return d.transicoes

    def test_estados_do_diario(self):
        d = e.Diario()
        self.assertEqual(self.leitura(d, ("a1", "r0", "running")), [])   # a linha de base não vira transição
        self.assertEqual(self.leitura(d, ("a1", "r0", "still_running"), ("a1", "r1", "waiting_approval")),
                         [("a1", "livre", "aprovacao")])
        self.assertEqual(self.leitura(d, ("a1", "r1", "running")), [("a1", "aprovacao", "trabalhando"),
                                                                    ("a1", "trabalhando", "livre")])

    def test_terminou_e_pergunta(self):
        d = e.Diario()
        self.leitura(d, ("a1", "r1", "running"))
        self.assertEqual(self.leitura(d, ("a1", "r1", "waiting_input")), [("a1", "trabalhando", "resposta")])
        self.assertEqual(self.leitura(d), [("a1", "resposta", "livre")])
        self.assertEqual(self.leitura(d, ("a1", "r2", "running"), completa=False), [("a1", "livre", "trabalhando")])
        self.assertEqual(self.leitura(d, completa=False), [])   # leitura incompleta não termina ninguém


class LeitorGrava(unittest.TestCase):
    def test_ciclo_grava_as_transicoes_na_linha(self):
        class Linha:
            def __init__(self):
                self.chamadas = []

            def gravar(self, transicoes, agora):
                self.chamadas.append((list(transicoes), agora))

        leitor = e.Leitor(cred=None)
        respostas = iter([[{"run_id": "r1", "status": "running"}], []])
        leitor.ler = lambda agora=None: (lambda t: (e.resumir([{"id": "a1", "name": "Pixel", "handle": "pixel"}],
                                                                [{**x, "agent": {"id": "a1"}} for x in t]), True,
                                                     []))(next(respostas))
        leitor.linha = Linha()
        leitor.ciclo(1000)
        leitor.ciclo(1030)
        self.assertEqual(leitor.linha.chamadas, [([], 1000), ([("a1", "trabalhando", "livre")], 1030)])


class Estaticos(unittest.TestCase):
    def test_arquivos_do_front_sao_servidos(self):
        self.assertEqual((e.ARQUIVOS.get("linha_tempo.js"), e.ARQUIVOS.get("linha_tempo.css")),
                         ("text/javascript; charset=utf-8", "text/css; charset=utf-8"))
        for nome in ("linha_tempo.js", "linha_tempo.css"):
            self.assertTrue(os.path.isfile(os.path.join(e.ESTATICO, nome)), nome)


class Rotas(unittest.TestCase):
    """/api/linha e /api/fora: o membro do andar lê; outra empresa e o saguão dão o 404 de andar. O mesmo prédio do
    test_membros (A e B em andares próprios, o térreo é o saguão)."""
    Base = test_membros.EmpresasNoSaguao
    A, B, PNG = Base.A, Base.B, Base.PNG
    req = classmethod(test_membros.Membros.req.__func__)
    get = test_membros.Membros.get

    @classmethod
    def setUpClass(cls):
        cls.Base.setUpClass.__func__(cls)
        andar = cls.srv.andares[cls.B]
        andar.linha = Linha(andar.pasta, FUSO)
        cls.hoje = datetime.datetime.now(FUSO).date().isoformat()
        agora = datetime.datetime.now().timestamp()
        andar.linha.gravar([("b1", "livre", "aprovacao")], agora - 3600)
        andar.linha.gravar([("b1", "aprovacao", "livre")], agora - 1800)

    def test_membro_le_a_linha_e_o_resumo_do_andar(self):
        q = f"?andar={self.B}"
        st, r = self.get(f"/api/linha{q}&agente=b1", self.cab["membrob"])
        self.assertEqual((st, r["agente"], r["dia"], [x["para"] for x in r["itens"]]), (200, "b1", self.hoje,
                                                                                         ["aprovacao", "livre"]))
        st, r = self.get(f"/api/linha{q}&agente=b1&dia={self.hoje}", self.cab["adminb"])
        self.assertEqual((st, len(r["itens"])), (200, 2))
        desde = int(datetime.datetime.now().timestamp()) - 7200
        st, r = self.get(f"/api/fora{q}&desde={desde}", self.cab["membrob"])
        self.assertEqual((st, r["agentes"][0]["agente"], r["agentes"][0]["tarefas"]), (200, "b1", 1))
        self.assertTrue(r["agentes"][0]["esperas"][0]["resolvida"])

    def test_pedido_invalido(self):
        q = f"?andar={self.B}"
        for rota in ("/api/linha" + q, f"/api/linha{q}&agente=../x", f"/api/linha{q}&agente=b1&dia=ontem",
                     f"/api/linha{q}&agente=b1&dia=2026-02-30", "/api/fora" + q, f"/api/fora{q}&desde=abc",
                     f"/api/fora{q}&desde=-5"):
            with self.subTest(rota=rota):
                self.assertEqual(self.get(rota, self.cab["membrob"])[0], 400)

    def test_dia_fora_dos_14_dias(self):
        q, hoje = f"?andar={self.B}&agente=b1", datetime.datetime.now(FUSO).date()
        for d, st in ((hoje - datetime.timedelta(days=14), 400), (hoje + datetime.timedelta(days=1), 400),
                      (hoje - datetime.timedelta(days=13), 200)):
            with self.subTest(dia=d):
                self.assertEqual(self.get(f"/api/linha{q}&dia={d.isoformat()}", self.cab["membrob"])[0], st)

    def setUp(self):   # cada teste com o balde da linha cheio
        baldes = self.srv.baldes
        baldes.baldes = {k: v for k, v in baldes.baldes.items() if k[0] != "linha"}

    def test_balde_por_conta(self):
        sts = [self.get(f"/api/fora?andar={self.B}&desde=0", self.cab["adminb"])[0] for _ in range(20)]
        self.assertEqual(sts[:10], [200] * 10, sts)
        self.assertIn(429, sts)
        self.assertEqual(self.get(f"/api/fora?andar={self.B}&desde=0", self.cab["membrob"])[0], 200)   # outra conta

    def test_varredura_diaria_limpa_a_linha(self):
        pasta = os.path.join(self.srv.andares[self.B].pasta, "linha")
        velho = (datetime.datetime.now(FUSO).date() - datetime.timedelta(days=20)).isoformat() + ".jsonl"
        open(os.path.join(pasta, velho), "w").close()
        self.srv.varrer_equipes()
        self.assertNotIn(velho, os.listdir(pasta))
        self.assertIn(self.hoje + ".jsonl", os.listdir(pasta))

    def test_outra_empresa_404(self):
        for rota in (f"/api/linha?andar={self.B}&agente=b1", f"/api/fora?andar={self.B}&desde=0"):
            with self.subTest(rota=rota):
                st, r = self.get(rota, self.cab["membroa"])
                self.assertEqual((st, r["codigo"]), (404, "andar"))

    def test_saguao_404(self):
        for rota in ("/api/linha?agente=b1", "/api/fora?desde=0"):
            with self.subTest(rota=rota):
                for quem in ("dono", "membrob"):   # o admin do prédio e a pessoa do prédio
                    st, r = self.get(rota, self.cab[quem])
                    self.assertEqual((st, r["codigo"]), (404, "andar"), quem)

    @classmethod
    def tearDownClass(cls):
        cls.Base.tearDownClass.__func__(cls)


if __name__ == "__main__":
    unittest.main()
