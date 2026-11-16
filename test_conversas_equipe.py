# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""conversas_equipe.py: isolamento por andar e por DM, apagar de verdade (inclusive do FTS), retenção e teto com relógio
injetado, ex-membro, auditoria de DM sem texto, cota com reserva e trava com 20 threads."""
import ast
import glob
import os
import shutil
import sqlite3
import tempfile
import threading
import unittest
import unittest.mock

import conversas_equipe as ce
from conversas_equipe import Equipe, SemAcesso
from presenca import Limite

DIA = 86400


class Relogio:
    def __init__(self):
        self.t = 1_800_000_000.0

    def __call__(self):
        return self.t


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = tempfile.mkdtemp(prefix="esc-equipe-")
        self.addCleanup(shutil.rmtree, self.raiz, True)
        self.r = Relogio()
        self.eq = self.abrir("a")

    def abrir(self, nome, **k):
        eq = Equipe(os.path.join(self.raiz, nome), relogio=self.r, **k)
        self.addCleanup(eq.fechar)
        return eq

    def manda(self, eq, canal, autor, texto):
        self.r.t += 1   # longe dos baldes
        return eq.enviar(canal, autor, autor.title(), texto)

    def bytes_no_disco(self, pasta):
        tudo = b""
        for arq in glob.glob(os.path.join(pasta, ce.ARQ + "*")):
            with open(arq, "rb") as f:
                tudo += f.read()
        return tudo


class Canais(Base):
    def test_envia_e_le_o_historico_paginado(self):
        ids = [self.manda(self.eq, "geral", "ana", f"mensagem {i}")["id"] for i in range(7)]
        pag = self.eq.historico("bia", "geral", limite=3)
        self.assertEqual([m["id"] for m in pag], ids[-3:])   # as mais novas, em ordem
        antes = self.eq.historico("bia", "geral", antes=ids[-3], limite=3)
        self.assertEqual([m["id"] for m in antes], ids[-6:-3])
        m = pag[-1]
        self.assertEqual((m["usuario"], m["nome"], m["texto"], m["apagada"]), ("ana", "Ana", "mensagem 6", False))
        self.assertEqual(set(m), {"id", "canal", "usuario", "nome", "texto", "apagada", "em", "reacoes", "anexo"})
        self.assertTrue(m["em"].endswith("Z"))

    def test_canal_de_sala_e_geral_sao_separados(self):
        self.manda(self.eq, "sala:lounge", "ana", "no lounge")
        self.manda(self.eq, "sala:time:Dev", "ana", "no time")
        self.assertEqual([m["texto"] for m in self.eq.historico("bia", "sala:lounge")], ["no lounge"])
        self.assertEqual([m["texto"] for m in self.eq.historico("bia", "sala:time:Dev")], ["no time"])
        self.assertEqual(self.eq.historico("bia", "geral"), [])

    def test_valida_canal_texto_e_limite(self):
        for ruim in ("", "sala:", "dm:", "dm:abc", "outro", "sala:" + "x" * 81, "sala:a‮b", None, 5):
            with self.subTest(canal=ruim):
                with self.assertRaises(ValueError):
                    self.eq.enviar(ruim, "ana", "Ana", "oi")
        for ruim in ("", "   ", "​", "x" * 501, None):
            with self.subTest(texto=str(ruim)[:5]):
                with self.assertRaises(ValueError):
                    self.eq.enviar("geral", "ana", "Ana", ruim)
        with self.assertRaises(ValueError):
            self.eq.historico("ana", "geral", limite=0)
        self.assertEqual(self.eq.enviar("geral", "ana", "Ana", " oi‮\x07 ")["texto"], "oi")

    def test_isolamento_por_andar_um_arquivo_por_andar(self):
        outro = self.abrir("b")
        self.manda(self.eq, "geral", "ana", "segredo de A")
        self.assertEqual(outro.historico("ana", "geral"), [])
        self.assertEqual(outro.buscar("ana", "segredo", ["geral"]), [])
        self.assertTrue(os.path.isfile(os.path.join(self.raiz, "a", ce.ARQ)))
        self.assertTrue(os.path.isfile(os.path.join(self.raiz, "b", ce.ARQ)))
        self.assertNotIn(b"segredo", self.bytes_no_disco(os.path.join(self.raiz, "b")))

    def test_permissao_do_arquivo(self):
        if os.name == "nt":
            self.skipTest("permissões POSIX")
        self.assertEqual(os.stat(os.path.join(self.raiz, "a", ce.ARQ)).st_mode & 0o777, 0o600)
        self.assertEqual(os.stat(os.path.join(self.raiz, "a")).st_mode & 0o777, 0o700)

    def test_modo_wal_e_fts5(self):
        con = sqlite3.connect(os.path.join(self.raiz, "a", ce.ARQ))
        self.addCleanup(con.close)
        self.assertEqual(con.execute("PRAGMA journal_mode").fetchone()[0], "wal")
        self.assertIn("fts", {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")})


class Leitura(Base):
    def test_nao_lidas_e_marcar_lida(self):
        self.manda(self.eq, "geral", "ana", "um")
        ultima = self.manda(self.eq, "geral", "ana", "dois")["id"]
        self.manda(self.eq, "sala:lounge", "bia", "minha")   # a própria não conta
        self.assertEqual(self.eq.nao_lidas("bia", ["geral", "sala:lounge"]), {"geral": 2, "sala:lounge": 0})
        self.eq.marcar_lida("bia", "geral", ultima)
        self.assertEqual(self.eq.nao_lidas("bia", ["geral"]), {"geral": 0})
        self.eq.marcar_lida("bia", "geral", 1)   # nunca volta para trás
        self.assertEqual(self.eq.nao_lidas("bia", ["geral"]), {"geral": 0})


class Reacoes(Base):
    def test_lista_fechada_uma_por_pessoa_por_emoji(self):
        m = self.manda(self.eq, "geral", "ana", "oi")["id"]
        emoji = ce.EMOJIS[0]
        self.eq.reagir("bia", m, emoji, True)
        self.eq.reagir("bia", m, emoji, True)
        self.eq.reagir("caio", m, emoji, True)
        reac = self.eq.historico("bia", "geral")[0]["reacoes"]
        self.assertEqual(reac, [{"emoji": emoji, "n": 2, "eu": True}])
        self.eq.reagir("bia", m, emoji, False)
        self.assertEqual(self.eq.historico("bia", "geral")[0]["reacoes"], [{"emoji": emoji, "n": 1, "eu": False}])
        self.assertEqual(len(ce.EMOJIS), 8)
        with self.assertRaises(ValueError):
            self.eq.reagir("bia", m, "💩", True)
        with self.assertRaises(SemAcesso):
            self.eq.reagir("bia", 999, emoji, True)


class Mural(Base):
    def test_ate_10_por_canal_e_quem_tira(self):
        ids = [self.eq.fixar("geral", "ana", "Ana", f"aviso {i}")["id"] for i in range(ce.MURAL_MAX)]
        with self.assertRaises(ValueError):
            self.eq.fixar("geral", "ana", "Ana", "um a mais")
        self.eq.fixar("sala:lounge", "ana", "Ana", "o teto é por canal")
        with self.assertRaises(SemAcesso):
            self.eq.desafixar(ids[0], "bia")   # nem autora nem moderadora
        self.eq.desafixar(ids[0], "bia", moderador=True)
        self.assertEqual(self.eq.desafixar(ids[1], "ana"), "geral")   # devolve o canal do aviso
        self.assertEqual([a["texto"] for a in self.eq.mural("geral")], [f"aviso {i}" for i in range(2, ce.MURAL_MAX)])
        with self.assertRaises(ValueError):
            self.eq.fixar("geral", "ana", "Ana", "x" * (ce.MURAL_TEXTO_MAX + 1))


class DM(Base):
    def test_so_os_dois_leem_e_cada_par_tem_o_seu(self):
        dm = self.eq.abrir_dm("ana", "bia")
        self.assertEqual(self.eq.abrir_dm("bia", "ana"), dm)   # o mesmo canal dos dois lados
        self.assertNotEqual(self.eq.abrir_dm("ana", "caio"), dm)
        self.manda(self.eq, dm, "ana", "só para a bia")
        self.assertEqual([m["texto"] for m in self.eq.historico("bia", dm)], ["só para a bia"])
        for estranho in ("caio", "admin"):
            with self.subTest(estranho=estranho):
                with self.assertRaises(SemAcesso):
                    self.eq.historico(estranho, dm)
                with self.assertRaises(SemAcesso):
                    self.eq.enviar(dm, estranho, "X", "entrando")
                with self.assertRaises(SemAcesso):
                    self.eq.marcar_lida(estranho, dm, 99)
        with self.assertRaises(SemAcesso):
            self.eq.historico("ana", "dm:9999")   # inexistente = a mesma resposta
        self.assertEqual(self.eq.buscar("caio", "bia", ["geral"]), [])
        with self.assertRaises(ValueError):
            self.eq.abrir_dm("ana", "ana")

    def test_lista_de_dms_da_pessoa(self):
        dm = self.eq.abrir_dm("ana", "bia")
        self.manda(self.eq, dm, "ana", "oi")
        self.eq.abrir_dm("caio", "duda")
        lista = self.eq.dms("bia")
        self.assertEqual([(d["canal"], d["outro"], d["nao_lidas"]) for d in lista], [(dm, "ana", 1)])
        self.assertEqual(self.eq.nao_lidas("bia", [dm]), {dm: 1})

    def test_saguao_sem_dm_e_sem_anexo(self):
        saguao = self.abrir("saguao", saguao=True)
        with self.assertRaises(SemAcesso):
            saguao.abrir_dm("ana", "bia")
        with self.assertRaises(SemAcesso):
            saguao.reservar("ana", 10)
        self.manda(saguao, "geral", "ana", "o geral do prédio funciona")


class Apagar(Base):
    def test_apagar_some_do_disco_e_do_fts(self):
        m = self.manda(self.eq, "geral", "ana", "palavraunica7731 no meio")["id"]
        self.manda(self.eq, "geral", "bia", "fica")
        self.assertEqual([x["id"] for x in self.eq.buscar("bia", "palavraunica7731", ["geral"])], [m])
        self.eq.apagar(m, "ana")
        self.r.t += 1
        h = self.eq.historico("bia", "geral")
        self.assertEqual((h[0]["texto"], h[0]["apagada"], h[0]["usuario"]), (None, True, "ana"))
        self.assertEqual(self.eq.buscar("bia", "palavraunica7731", ["geral"]), [])
        self.assertNotIn(b"palavraunica7731", self.bytes_no_disco(os.path.join(self.raiz, "a")))

    def test_quem_apaga(self):
        m = self.manda(self.eq, "geral", "ana", "de canal")["id"]
        with self.assertRaises(SemAcesso):
            self.eq.apagar(m, "bia")
        self.eq.apagar(m, "bia", moderador=True)   # o admin da empresa apaga em canal
        dm = self.eq.abrir_dm("ana", "bia")
        d = self.manda(self.eq, dm, "ana", "da dm")["id"]
        with self.assertRaises(SemAcesso):
            self.eq.apagar(d, "bia", moderador=True)   # DM: só o autor
        with self.assertRaises(SemAcesso):
            self.eq.apagar(d, "admin", moderador=True)
        self.eq.apagar(d, "ana")
        with self.assertRaises(SemAcesso):
            self.eq.apagar(12345, "ana")


class Busca(Base):
    def test_restrita_aos_canais_que_a_pessoa_le_e_sem_injecao(self):
        self.manda(self.eq, "geral", "ana", "Reunião às 10h")
        self.manda(self.eq, "sala:lounge", "ana", "reuniao no lounge")
        dm = self.eq.abrir_dm("ana", "bia")
        self.manda(self.eq, dm, "ana", "reunião secreta")
        self.r.t += 2
        self.assertEqual(len(self.eq.buscar("bia", "reuniao", ["geral"])), 2)   # o geral e a própria DM, sem acento
        self.r.t += 2
        self.assertEqual(len(self.eq.buscar("caio", "reunião", ["geral", "sala:lounge"])), 2)   # sem a DM dos outros
        for termo in ('"', "a OR b", "NEAR(", "*", "col:x", "-x", "^"):
            with self.subTest(termo=termo):
                self.r.t += 2
                self.assertIsInstance(self.eq.buscar("bia", termo, ["geral"]), list)
        self.r.t += 2
        resultado = self.eq.buscar("bia", "reun", ["geral"])[0]   # prefixo
        self.assertEqual(set(resultado), {"id", "canal", "usuario", "nome", "texto", "apagada", "em", "reacoes", "anexo"})

    def test_uma_por_segundo(self):
        self.eq.buscar("bia", "x", ["geral"])
        with self.assertRaises(Limite):
            self.eq.buscar("bia", "x", ["geral"])
        self.eq.buscar("caio", "x", ["geral"])   # o balde é de cada um
        self.r.t += 1
        self.eq.buscar("bia", "x", ["geral"])


class Retencao(Base):
    def test_padrao_um_ano_e_ajuste_por_empresa(self):
        self.assertEqual(self.eq.retencao(), 365)
        for ruim in (0, 366, 400, True, "90", 45):
            with self.subTest(dias=ruim):
                with self.assertRaises(ValueError):
                    self.eq.definir_retencao(ruim)
        self.eq.definir_retencao(30)
        self.assertEqual(self.abrir("a").retencao(), 30)   # fica no banco

    def test_varredura_apaga_o_que_passou_do_prazo(self):
        velha = self.manda(self.eq, "geral", "ana", "velhaunica42")["id"]
        self.r.t += 200 * DIA
        nova = self.manda(self.eq, "geral", "ana", "nova")["id"]
        self.r.t += 170 * DIA
        rel = self.eq.varrer()
        self.assertEqual(rel["por_prazo"], 1)
        self.assertEqual([m["id"] for m in self.eq.historico("bia", "geral")], [nova])
        self.assertEqual(self.eq.buscar("bia", "velhaunica42", ["geral"]), [])
        self.assertNotIn(b"velhaunica42", self.bytes_no_disco(os.path.join(self.raiz, "a")))
        self.eq.definir_retencao(90)
        self.r.t += 1
        self.assertEqual(self.eq.varrer()["por_prazo"], 1)
        self.assertEqual(self.eq.historico("bia", "geral"), [])
        self.assertNotEqual(velha, nova)

    def test_mural_e_dm_vazia_saem_na_varredura(self):
        self.eq.fixar("geral", "ana", "Ana", "aviso velho")
        dm_velha = self.eq.abrir_dm("ana", "bia")
        self.manda(self.eq, dm_velha, "ana", "vai vencer")
        vazia = self.eq.abrir_dm("ana", "caio")
        self.eq.marcar_lida("ana", vazia, 1)
        self.r.t += 200 * DIA
        self.eq.fixar("geral", "bia", "Bia", "aviso novo")
        ultima = self.eq.abrir_dm("bia", "caio")   # a de id mais alto fica, mesmo vazia
        self.r.t += 170 * DIA
        rel = self.eq.varrer()
        self.assertEqual((rel["avisos"], rel["dms_vazias"]), (1, 2))
        self.assertEqual([a["texto"] for a in self.eq.mural("geral")], ["aviso novo"])
        sobram = self.eq.con.execute("SELECT u1, u2 FROM canal WHERE dm = 1").fetchall()
        self.assertEqual(sobram, [("bia", "caio")])
        self.assertEqual(self.eq.con.execute("SELECT COUNT(*) FROM leitura").fetchone()[0], 0)
        nova = self.eq.abrir_dm("ana", "bia")   # o par volta com outro id, nunca com um que já saiu
        self.assertGreater(int(nova[3:]), int(ultima[3:]))
        self.assertNotIn(nova, (dm_velha, vazia))

    def test_dm_vazia_com_acesso_da_auditoria_fica(self):
        """A DM que a administração abriu não perde a linha quando a retenção leva as mensagens: as pontas continuam
        vendo as datas do registro (D10), que dura 1 ano."""
        dm = self.eq.abrir_dm("ana", "bia")
        self.manda(self.eq, dm, "ana", "vai vencer")
        self.eq.auditar_dm("beto", dm)
        self.eq.abrir_dm("bia", "caio")   # a de id mais alto fica sempre: não pode ser ela a do teste
        self.r.t += 370 * DIA
        self.eq.auditar_dm("beto", dm)    # o registro mais novo ainda vale
        self.r.t += 2 * DIA
        rel = self.eq.varrer()
        self.assertEqual((rel["por_prazo"], rel["dms_vazias"]), (1, 0))
        self.assertEqual(self.eq.abrir_dm("ana", "bia"), dm)
        self.assertEqual(len(self.eq.acessos_da_dm("ana", dm)), 1)

    def test_teto_do_banco_tira_as_mais_antigas_e_avisa(self):
        eq = self.abrir("teto", teto_banco=256 * 1024)
        ids = [self.manda(eq, "geral", "ana", f"m{i} " + "texto comprido " * 30)["id"] for i in range(600)]
        uso = eq.uso()
        self.assertLessEqual(uso["banco"], uso["teto_banco"])
        restantes = [m["id"] for m in eq.historico("bia", "geral", limite=ce.LIMITE_MAX)]
        self.assertNotIn(ids[0], restantes)   # saíram as mais antigas
        self.assertIn(ids[-1], restantes)
        self.assertEqual(restantes, sorted(restantes))
        self.assertTrue(eq.uso()["alerta_banco"] or eq.uso()["banco"] < 0.9 * uso["teto_banco"])
        self.assertGreater(eq.uso()["cortadas_por_teto"], 0)


class ExMembro(Base):
    def test_conta_removida_vira_ex_membro_e_o_login_novo_nao_herda(self):
        self.manda(self.eq, "geral", "joao", "fica no histórico")
        dm = self.eq.abrir_dm("joao", "bia")
        self.manda(self.eq, dm, "joao", "dm antiga")
        self.eq.reagir("joao", self.eq.historico("bia", "geral")[0]["id"], ce.EMOJIS[1], True)
        self.eq.fixar("geral", "joao", "João", "aviso do joão")
        self.eq.remover_conta("joao")
        m = self.eq.historico("bia", "geral")[0]
        self.assertEqual((m["usuario"], m["nome"], m["texto"], m["reacoes"]), (None, ce.EX_MEMBRO, "fica no histórico", []))
        self.assertEqual(self.eq.mural("geral")[0]["nome"], ce.EX_MEMBRO)
        self.assertEqual([x["texto"] for x in self.eq.historico("bia", dm)], ["dm antiga"])   # a bia continua lendo
        self.assertEqual(self.eq.dms("bia")[0]["outro"], None)
        with self.assertRaises(SemAcesso):
            self.eq.historico("joao", dm)   # o joão novo (mesmo login) não herda
        with self.assertRaises(ValueError):
            self.eq.enviar(dm, "bia", "Bia", "ninguém lê")
        self.assertNotEqual(self.eq.abrir_dm("joao", "bia"), dm)
        for chamada in (lambda: self.eq.historico(None, dm), lambda: self.eq.acessos_da_dm(None, dm),
                        lambda: self.eq.marcar_lida(None, dm, 1)):   # a ponta que saiu ficou None: None não é ponta
            with self.assertRaises(ValueError):
                chamada()


class AuditoriaDM(Base):
    def test_le_sem_marcar_lida_registra_sem_texto_e_os_dois_veem(self):
        dm = self.eq.abrir_dm("ana", "bia")
        self.manda(self.eq, dm, "ana", "textosigiloso991")
        apagada = self.manda(self.eq, dm, "ana", "vai sumir")["id"]
        self.eq.apagar(apagada, "ana")
        self.assertEqual(self.eq.pares_dm(), [{"canal": dm, "u1": "ana", "u2": "bia", "mensagens": 1, "ultima": unittest.mock.ANY}])
        lidas = self.eq.auditar_dm("chefe", dm)
        self.assertEqual([m["texto"] for m in lidas], ["textosigiloso991"])   # a apagada não aparece
        self.assertEqual(self.eq.nao_lidas("bia", [dm]), {dm: 1})   # ler pela auditoria não marca como lida
        reg = self.eq.registro_acessos_dm()
        self.assertEqual([(x["canal"], x["admin"], x["u1"], x["u2"], x["quantas"]) for x in reg], [(dm, "chefe", "ana", "bia", 1)])
        self.assertEqual(len(self.eq.acessos_da_dm("bia", dm)), 1)
        with self.assertRaises(SemAcesso):
            self.eq.acessos_da_dm("caio", dm)
        con = sqlite3.connect(os.path.join(self.raiz, "a", ce.ARQ))
        self.addCleanup(con.close)
        linha = con.execute("SELECT * FROM acesso_dm").fetchall()
        self.assertNotIn("textosigiloso991", repr(linha))
        self.r.t += 0.5
        with self.assertRaises(Limite):
            self.eq.auditar_dm("chefe", dm)   # 1 por segundo
        with self.assertRaises(SemAcesso):
            self.eq.auditar_dm("chefe2", "dm:9999")
        with self.assertRaises(ValueError):
            self.eq.auditar_dm("chefe2", "geral")

    def test_registro_vence_em_um_ano(self):
        self.eq.auditar_dm("chefe", self.eq.abrir_dm("ana", "bia"))
        self.r.t += 366 * DIA
        self.eq.varrer()
        self.assertEqual(self.eq.registro_acessos_dm(), [])


class Anexos(Base):
    def escreve(self, eq, token, conteudo):
        with open(eq.temporario(token), "wb") as f:
            f.write(conteudo)

    def test_reserva_confirma_serve_e_apaga_junto(self):
        token = self.eq.reservar("ana", 5)
        self.escreve(self.eq, token, b"12345")
        m = self.eq.anexar(token, "ana", "Ana", "geral", "relatório.pdf", "application/pdf", 5, "ab" * 32, texto="segue")
        self.assertEqual((m["texto"], m["anexo"]["nome"], m["anexo"]["tamanho"], m["anexo"]["tipo"]),
                         ("segue", "relatório.pdf", 5, "application/pdf"))
        self.assertNotIn("token", m["anexo"])
        arq = self.eq.arquivo_do_anexo("bia", m["anexo"]["id"])
        with open(arq["caminho"], "rb") as f:
            self.assertEqual(f.read(), b"12345")
        self.assertEqual(self.eq.uso()["anexos"], 5)
        self.eq.apagar(m["id"], "ana")
        self.assertFalse(os.path.exists(arq["caminho"]))
        self.assertEqual(self.eq.uso()["anexos"], 0)
        with self.assertRaises(SemAcesso):
            self.eq.arquivo_do_anexo("bia", m["anexo"]["id"])

    def test_cota_com_reserva_duas_threads_nao_passam(self):
        eq = self.abrir("cota", cota_anexos=100)
        resultados = []
        barreira = threading.Barrier(2)

        def tenta(usuario):
            barreira.wait()
            try:
                resultados.append(eq.reservar(usuario, 60))
            except ce.CotaCheia:
                resultados.append(None)
        fios = [threading.Thread(target=tenta, args=(u,)) for u in ("ana", "bia")]
        for f in fios:
            f.start()
        for f in fios:
            f.join(5)
        self.assertEqual(sorted(r is None for r in resultados), [False, True])
        token = next(r for r in resultados if r)
        eq.liberar(token)
        eq.reservar("caio", 100)   # liberou, cabe de novo

    def test_limites_e_dono_da_reserva(self):
        for ruim in (0, -1, ce.ANEXO_MAX + 1, True, 1.5):
            with self.subTest(tamanho=ruim):
                with self.assertRaises(ValueError):
                    self.eq.reservar("ana", ruim)
        self.eq.reservar("ana", ce.ANEXO_MAX)
        token = self.eq.reservar("ana", 3)
        self.escreve(self.eq, token, b"abc")
        with self.assertRaises(SemAcesso):
            self.eq.anexar(token, "bia", "Bia", "geral", "x.txt", "text/plain", 3, "00" * 32)   # a reserva é da ana
        with self.assertRaises(ValueError):
            self.eq.anexar(token, "ana", "Ana", "geral", "x.txt", "text/plain", 4, "00" * 32)   # passou do reservado
        for nome in ("../x", "a/b", "a\\b", "x‮txt", "", "x" * 121):
            with self.subTest(nome=nome):
                with self.assertRaises(ValueError):
                    self.eq.anexar(token, "ana", "Ana", "geral", nome, "text/plain", 3, "00" * 32)
        self.eq.liberar(token)
        self.assertFalse(os.path.exists(self.eq.temporario(token)))

    def test_canal_recusado_nao_perde_o_arquivo(self):
        dm = self.eq.abrir_dm("bia", "caio")
        token = self.eq.reservar("ana", 2)
        self.escreve(self.eq, token, b"ok")
        with self.assertRaises(SemAcesso):
            self.eq.anexar(token, "ana", "Ana", dm, "x.txt", "text/plain", 2, "00" * 32)   # a DM não é da ana
        self.assertTrue(os.path.exists(self.eq.temporario(token)))
        self.assertFalse(os.path.exists(os.path.join(self.eq.pasta_anexos, token)))
        self.assertEqual(self.eq.anexar(token, "ana", "Ana", "geral", "x.txt", "text/plain", 2, "00" * 32)["anexo"]["tamanho"], 2)

    def test_reserva_vence(self):
        eq = self.abrir("vence", cota_anexos=10)
        eq.reservar("ana", 10)
        self.r.t += ce.RESERVA_VIDA + 1
        eq.reservar("bia", 10)

    def test_varrer_tira_o_temporario_sem_reserva_viva(self):
        vencida, orfao = self.eq.reservar("ana", 2), "e" * 32   # o órfão é de antes de reiniciar: sem reserva
        self.r.t += ce.RESERVA_VIDA + 1
        viva, recente = self.eq.reservar("ana", 2), "f" * 32   # o recente, sem reserva, pode ser um envio entrando
        velho = self.r.t - ce.RESERVA_VIDA - 1
        for token, quando in ((vencida, velho), (orfao, velho), (viva, velho), (recente, self.r.t)):
            self.escreve(self.eq, token, b"ok")
            os.utime(self.eq.temporario(token), (quando, quando))
        self.eq.varrer()
        self.assertEqual({t: os.path.exists(self.eq.temporario(t)) for t in (vencida, orfao, viva, recente)},
                         {vencida: False, orfao: False, viva: True, recente: True})

    def test_sem_acesso_tem_uma_mensagem_so(self):
        """Inexistente ou de outro: a mesma mensagem, para não virar oráculo de existência."""
        dm = self.eq.abrir_dm("ana", "bia")
        token = self.eq.reservar("ana", 2)
        self.escreve(self.eq, token, b"ok")
        anexo = self.eq.anexar(token, "ana", "Ana", dm, "a.txt", "text/plain", 2, "00" * 32)
        mensagens = set()
        for chamada in (lambda: self.eq.arquivo_do_anexo("caio", anexo["anexo"]["id"]),
                        lambda: self.eq.arquivo_do_anexo("caio", 999),
                        lambda: self.eq.reagir("caio", anexo["id"], ce.EMOJIS[0], True),
                        lambda: self.eq.reagir("caio", 999, ce.EMOJIS[0], True),
                        lambda: self.eq.historico("caio", dm), lambda: self.eq.historico("caio", "dm:999"),
                        lambda: self.eq.apagar(anexo["id"], "caio"), lambda: self.eq.apagar(999, "caio"),
                        lambda: self.eq.desafixar(999, "caio")):
            with self.assertRaises(SemAcesso) as cx:
                chamada()
            mensagens.add(str(cx.exception))
        self.assertEqual(len(mensagens), 1)

    def test_anexo_de_dm_so_para_os_dois_e_retencao_apaga_o_arquivo(self):
        dm = self.eq.abrir_dm("ana", "bia")
        token = self.eq.reservar("ana", 2)
        self.escreve(self.eq, token, b"ok")
        m = self.eq.anexar(token, "ana", "Ana", dm, "foto.png", "image/png", 2, "cd" * 32)
        self.eq.arquivo_do_anexo("bia", m["anexo"]["id"])
        with self.assertRaises(SemAcesso):
            self.eq.arquivo_do_anexo("caio", m["anexo"]["id"])
        caminho = self.eq.arquivo_do_anexo("ana", m["anexo"]["id"])["caminho"]
        self.r.t += 366 * DIA
        self.eq.varrer()
        self.assertFalse(os.path.exists(caminho))
        self.assertEqual(self.eq.uso()["anexos"], 0)


class Concorrencia(Base):
    def test_vinte_threads_sem_deadlock(self):
        dm = self.eq.abrir_dm("ana", "bia")
        erros, feitos = [], []
        r = self.r

        def trabalho(i):
            try:
                usuario = f"p{i:02d}"
                for j in range(15):
                    r.t += 1
                    m = self.eq.enviar("geral" if j % 2 else f"sala:s{i % 3}", usuario, "P", f"t {i} {j}")
                    self.eq.historico(usuario, "geral", limite=10)
                    self.eq.nao_lidas(usuario, ["geral", "sala:s0"])
                    self.eq.marcar_lida(usuario, "geral", m["id"])
                    self.eq.reagir(usuario, m["id"], ce.EMOJIS[j % 8], True)
                    try:
                        self.eq.buscar(usuario, "t", ["geral"])
                    except Limite:
                        pass
                    if i % 5 == 0:
                        self.eq.varrer()
                    if i == 1:
                        self.eq.enviar(dm, "ana", "Ana", f"dm {j}")
                feitos.append(i)
            except Exception as x:   # o teste falha abaixo com o erro de cada fio
                erros.append(repr(x))
        fios = [threading.Thread(target=trabalho, args=(i,), daemon=True) for i in range(20)]
        for f in fios:
            f.start()
        for f in fios:
            f.join(60)
        self.assertFalse([f for f in fios if f.is_alive()], "deadlock: fios presos")
        self.assertEqual(erros, [])
        self.assertEqual(len(feitos), 20)


class Onda2(Base):
    """O que as rotas da Onda 2 pedem ao store: menções, contadores do ao-vivo, mensagens novas do canal aberto, versão
    do canal e do mural, status por conta e o "Entendi" da DM."""

    def test_mencao_conta_ate_ler_e_contadores_com_dm(self):
        self.r.t += 1
        m = self.eq.enviar("geral", "ana", "Ana", "oi @bia", mencoes=["bia"])
        self.manda(self.eq, "sala:cozinha", "ana", "café")
        dm = self.eq.abrir_dm("ana", "bia")
        self.manda(self.eq, dm, "ana", "particular")
        nao_lidas, mencoes = self.eq.contadores("bia")
        self.assertEqual(nao_lidas, {"geral": 1, "sala:cozinha": 1, dm: 1})
        self.assertEqual(mencoes, {"geral": 1})
        self.assertEqual(self.eq.contadores("cid")[0], {"geral": 1, "sala:cozinha": 1})   # DM alheia não entra
        self.eq.marcar_lida("bia", "geral", m["id"])
        self.assertEqual(self.eq.contadores("bia"), ({"sala:cozinha": 1, dm: 1}, {}))
        self.assertEqual(self.eq.contadores("ana"), ({}, {}))   # as próprias não contam

    def test_contadores_com_teto_e_relidos_a_cada_escrita(self):
        with unittest.mock.patch.object(ce, "CONTAGEM_MAX", 3):
            for i in range(5):
                self.r.t += 1
                self.eq.enviar("geral", "ana", "Ana", f"@bia {i}", mencoes=["bia"])
            self.assertEqual(self.eq.contadores("bia"), ({"geral": 3}, {"geral": 3}))
            antes = self.eq.con.total_changes
            self.assertEqual(self.eq.contadores("bia"), ({"geral": 3}, {"geral": 3}))   # do cache: o banco não mudou
            self.assertEqual(self.eq.con.total_changes, antes)
            self.eq.marcar_lida("bia", "geral", self.eq.historico("bia", "geral")[-2]["id"])
            self.assertEqual(self.eq.contadores("bia"), ({"geral": 1}, {"geral": 1}))   # a escrita invalida
            self.eq.contadores("bia")[0]["geral"] = 99   # quem chama pode mexer no que recebe sem sujar o cache
            self.assertEqual(self.eq.contadores("bia"), ({"geral": 1}, {"geral": 1}))

    def test_mencao_some_ao_apagar(self):
        self.r.t += 1
        m = self.eq.enviar("geral", "ana", "Ana", "@bia olha", mencoes=["bia"])
        self.eq.apagar(m["id"], "ana")
        self.assertEqual(self.eq.contadores("bia"), ({}, {}))
        self.assertEqual(self.eq.con.execute("SELECT COUNT(*) FROM mencao").fetchone()[0], 0)

    def test_novas_depois_do_id_e_versao_do_canal(self):
        a = self.manda(self.eq, "geral", "ana", "um")
        b = self.manda(self.eq, "geral", "ana", "dois")
        self.assertEqual([x["id"] for x in self.eq.novas("bia", "geral", a["id"])], [b["id"]])
        self.assertEqual(self.eq.novas("bia", "sala:vazia", 0), [])
        v = self.eq.versao("geral")
        self.eq.reagir("bia", a["id"], "👍", True)
        v2 = self.eq.versao("geral")
        self.assertNotEqual(v, v2)
        self.eq.apagar(a["id"], "ana")
        self.assertNotEqual(self.eq.versao("geral"), v2)
        dm = self.eq.abrir_dm("ana", "bia")
        with self.assertRaises(SemAcesso):
            self.eq.novas("cid", dm, 0)

    def test_versao_do_mural_muda_a_cada_mudanca(self):
        self.assertEqual(self.eq.versoes_mural(), {})
        a = self.eq.fixar("geral", "ana", "Ana", "aviso 1")
        v1 = self.eq.versoes_mural()["geral"]
        self.eq.fixar("geral", "ana", "Ana", "aviso 2")
        v2 = self.eq.versoes_mural()["geral"]
        self.eq.desafixar(a["id"], "ana")
        v3 = self.eq.versoes_mural()["geral"]
        self.assertEqual(len({v1, v2, v3}), 3)

    def test_status_por_conta_valida_e_sai_com_a_conta(self):
        self.assertEqual(self.eq.status_de("ana"), {"status": "disponivel", "texto": ""})
        self.eq.definir_status("ana", "ocupado", " foco ")
        self.assertEqual(self.eq.status_de("ana"), {"status": "ocupado", "texto": "foco"})
        self.assertEqual(self.abrir("a2").status_de("ana")["status"], "disponivel")   # outro andar, outro arquivo
        for st, txt in (("dormindo", ""), ("ocupado", "x" * 41), ("ocupado", "a\u202eb"), ("ocupado", 3)):
            with self.assertRaises(ValueError):
                self.eq.definir_status("ana", st, txt)
        self.eq.remover_conta("ana")
        self.assertEqual(self.eq.status_de("ana")["status"], "disponivel")

    def test_status_sobrevive_a_reabrir(self):
        self.eq.definir_status("ana", "reuniao", "")
        self.eq.fechar()
        self.assertEqual(Equipe(os.path.join(self.raiz, "a"), relogio=self.r).status_de("ana")["status"], "reuniao")

    def test_entendi_da_dm_por_conta_e_sai_com_a_conta(self):
        self.assertFalse(self.eq.entendeu_dm("ana"))
        self.eq.marcar_entendeu_dm("ana")
        self.assertTrue(self.eq.entendeu_dm("ana"))
        self.assertFalse(self.eq.entendeu_dm("bia"))
        self.eq.remover_conta("ana")
        self.assertFalse(self.eq.entendeu_dm("ana"))

    def test_pode_escrever_sem_criar_canal(self):
        self.eq.pode_escrever("sala:nova", "ana")
        self.assertEqual(self.eq.con.execute("SELECT COUNT(*) FROM canal").fetchone()[0], 0)
        dm = self.eq.abrir_dm("ana", "bia")
        with self.assertRaises(SemAcesso):
            self.eq.pode_escrever(dm, "cid")
        self.eq.remover_conta("bia")
        with self.assertRaises(ValueError):
            self.eq.pode_escrever(dm, "ana")

    def test_aviso_da_mensagem_para_o_push(self):
        self.r.t += 1
        m = self.eq.enviar("geral", "ana", "Ana", "linha 1\nlinha 2")
        self.assertEqual(self.eq.para_aviso(m["id"]), {"nome": "Ana", "canal": "geral", "texto": "linha 1\nlinha 2",
                                                        "anexo": False})
        self.eq.apagar(m["id"], "ana")
        self.assertEqual(self.eq.para_aviso(m["id"])["texto"], None)
        self.assertIsNone(self.eq.para_aviso(999))


class Reunioes(Base):
    """Onda 3: o link fixo por sala (lista fechada de hosts), a agenda do andar e o aviso 5 min antes."""

    def marca(self, eq=None, autor="ana", sala="reuniao", inicio=None, duracao=30, convidados=("bia",), titulo="Plan"):
        inicio = self.r.t + 3600 if inicio is None else inicio
        return (eq or self.eq).marcar(autor, autor.title(), titulo, sala, int(inicio), duracao, list(convidados))

    def test_link_so_https_na_lista_sem_credencial(self):
        bons = ["https://meet.google.com/abc-defg-hij", "https://us02web.zoom.us/j/123?pwd=x", "https://zoom.us/j/1",
                "https://meet.jit.si/SalaDaEquipe", "https://teams.microsoft.com/l/meetup-join/19%3a",
                "https://whereby.com/equipe", "https://MEET.google.com/abc"]
        for url in bons:
            self.assertEqual(ce.validar_link(url), url, url)
        ruins = ["http://meet.google.com/abc", "https://evil.com/meet.google.com", "https://meet.google.com.evil.com/x",
                 "https://user:senha@meet.google.com/x", "https://a@meet.google.com/x", "https://meet.google.com:8443/x",
                 "javascript:alert(1)", "https://evilzoom.us/j/1", "https://meet.google.com/a b",
                 "https://meet.google.com/a\b", "https://meet.google.com/‮", "https://meet.google.com/" + "a" * 500,
                 "", "https://jitsi.minha.com/x", None, 7, "https://meet.google.com/<script>"]
        for url in ruins:
            with self.assertRaises(ValueError, msg=repr(url)):
                ce.validar_link(url)
        self.assertEqual(ce.validar_link("https://jitsi.minha.com/x", "jitsi.minha.com"), "https://jitsi.minha.com/x")
        # o K de kelvin (U+212A) vira "k" no lower(); e cada rótulo do host tem só letra, número e hífen no meio
        for url in ["https://meet.jit.si/K", "https://Koom.us/j/1", "https://-x.zoom.us/j/1",
                    "https://x-.zoom.us/j/1", "https://a..zoom.us/j/1", "https://a_b.zoom.us/j/1", "https://.zoom.us/j/1",
                    "https://a%2e.zoom.us/j/1", "https://a!b.zoom.us/j/1"]:
            with self.assertRaises(ValueError, msg=repr(url)):
                ce.validar_link(url)
        self.assertEqual(ce.validar_link("https://us-02web.zoom.us/j/1"), "https://us-02web.zoom.us/j/1")
        self.assertEqual(ce.hosts_reuniao("jitsi.minha.com")[-1], "jitsi.minha.com")
        self.assertEqual(ce.hosts_reuniao(None), list(ce.HOSTS_REUNIAO))

    def test_links_por_sala_e_por_andar(self):
        self.eq.definir_link("reuniao", "https://meet.google.com/abc-defg-hij")
        self.eq.definir_link("lounge", "https://meet.jit.si/x")
        self.assertEqual(self.eq.links(), {"reuniao": "https://meet.google.com/abc-defg-hij", "lounge": "https://meet.jit.si/x"})
        self.eq.definir_link("lounge", "")
        self.assertEqual(list(self.eq.links()), ["reuniao"])
        self.assertEqual(self.abrir("b").links(), {})   # outro andar, outro arquivo
        with self.assertRaises(ValueError):
            self.eq.definir_link("reuniao", "https://evil.com/x")

    def test_marcar_listar_editar_cancelar(self):
        r = self.marca(convidados=["bia", "beto"])
        self.assertEqual((r["titulo"], r["sala"], r["duracao"], r["fim"] - r["inicio"]), ("Plan", "reuniao", 30, 1800))
        self.assertEqual((r["usuario"], r["nome"], r["convidados"]), ("ana", "Ana", ["beto", "bia"]))
        self.assertEqual([x["id"] for x in self.eq.reunioes(self.r.t, self.r.t + 7 * DIA)], [r["id"]])
        self.assertEqual(self.eq.reunioes(self.r.t + 2 * 3600, self.r.t + DIA), [])
        v = self.eq.versao_reunioes()
        with self.assertRaises(SemAcesso):   # nem quem marcou nem admin
            self.eq.editar(r["id"], "bia", False, "x", "reuniao", r["inicio"], 30, [])
        e = self.eq.editar(r["id"], "bia", True, "Novo", "lounge", r["inicio"] + 60, 45, ["bia"])
        self.assertEqual((e["titulo"], e["sala"], e["duracao"], e["convidados"], e["usuario"]),
                         ("Novo", "lounge", 45, ["bia"], "ana"))
        self.assertNotEqual(self.eq.versao_reunioes(), v)
        with self.assertRaises(SemAcesso):
            self.eq.cancelar(r["id"], "bia", False)
        self.eq.cancelar(r["id"], "ana", False)
        self.assertIsNone(self.eq.reuniao(r["id"]))
        with self.assertRaises(SemAcesso):
            self.eq.cancelar(r["id"], "ana", True)

    def test_validacao(self):
        agora = self.r.t
        for k in ({"titulo": ""}, {"titulo": "x" * 81}, {"titulo": "a‮b"}, {"duracao": 4}, {"duracao": 481},
                  {"duracao": True}, {"inicio": agora - 120}, {"inicio": agora + 367 * DIA},
                  {"convidados": ["bia", "bia"]}, {"convidados": ["Nao Login"]}, {"convidados": ["u%d" % i for i in range(51)]}):
            with self.assertRaises(ValueError, msg=k):
                self.marca(**k)
        self.marca(inicio=agora - 30)   # a tolerância de 60 s

    def test_editar_reuniao_em_andamento(self):
        """Sem mudar o início, a janela de início não vale: dá para estender ou corrigir o título já começada."""
        r = self.marca(inicio=self.r.t, duracao=30)
        self.r.t += 20 * 60
        e = self.eq.editar(r["id"], "ana", False, "Plan certo", "reuniao", r["inicio"], 60, ["bia"])
        self.assertEqual((e["titulo"], e["duracao"], e["inicio"]), ("Plan certo", 60, r["inicio"]))
        for inicio in (r["inicio"] + 60, float(r["inicio"])):   # mudar o início (ou mandá-lo como float) confere de novo
            with self.assertRaises(ValueError, msg=inicio):
                self.eq.editar(r["id"], "ana", False, "Plan", "reuniao", inicio, 60, [])

    def test_sala_ocupada_e_agenda_cheia(self):
        r = self.marca(inicio=self.r.t + 3600, duracao=60)
        with self.assertRaises(ce.SalaOcupada):
            self.marca(inicio=self.r.t + 3600 + 1800)
        self.marca(sala="lounge", inicio=self.r.t + 3600 + 1800)   # outra sala
        self.marca(inicio=self.r.t + 3600 + 3600)   # logo depois
        self.eq.editar(r["id"], "ana", False, "Plan", "reuniao", r["inicio"], 60, [])   # a própria não conflita
        with unittest.mock.patch.object(ce, "REUNIOES_MAX", 3):
            with self.assertRaises(ce.AgendaCheia):
                self.marca(sala="cozinha")

    def test_aviso_5_min_antes_uma_vez_e_rearma_ao_mudar_o_horario(self):
        r = self.marca(inicio=self.r.t + 600, convidados=["bia"])
        self.assertEqual(self.eq.a_avisar(self.r.t + 299), [])   # ainda faltam mais de 5 min
        devidas = self.eq.a_avisar(r["inicio"] - 300)
        self.assertEqual([(x["id"], x["usuario"], x["convidados"]) for x in devidas], [(r["id"], "ana", ["bia"])])
        self.assertEqual(self.eq.a_avisar(r["inicio"] - 200), [])   # uma vez só
        self.eq.editar(r["id"], "ana", False, "Plan", "reuniao", r["inicio"] + 600, 30, ["bia"])
        self.assertEqual(self.eq.a_avisar(r["inicio"] - 200), [])
        self.assertEqual(len(self.eq.a_avisar(r["inicio"] + 600 - 120)), 1)
        self.assertEqual(self.eq.a_avisar(r["inicio"] + 600 + 1), [])   # já começou: não avisa mais

    def test_salas_em_reuniao(self):
        r = self.marca(inicio=self.r.t + 60, duracao=30)
        self.assertEqual(self.eq.salas_em_reuniao(self.r.t), set())
        self.assertEqual(self.eq.salas_em_reuniao(r["inicio"]), {"reuniao"})
        self.assertEqual(self.eq.salas_em_reuniao(r["fim"]), set())

    def test_ex_membro_e_retencao(self):
        r = self.marca(convidados=["bia", "beto"])
        self.eq.remover_conta("ana")
        self.eq.remover_conta("bia")
        x = self.eq.reuniao(r["id"])
        self.assertEqual((x["usuario"], x["nome"], x["convidados"]), (None, ce.EX_MEMBRO, ["beto"]))
        with self.assertRaises(SemAcesso):   # o login de volta não herda
            self.eq.cancelar(r["id"], "ana", False)
        self.r.t = r["fim"] + 365 * DIA + 1
        self.eq.varrer()
        self.assertIsNone(self.eq.reuniao(r["id"]))


class SemTextoNoLog(unittest.TestCase):
    def test_modulo_nao_imprime_nem_loga(self):
        """O texto das conversas só vai para o banco: nada de print, log nem logging no módulo."""
        caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "conversas_equipe.py")
        with open(caminho, encoding="utf-8") as f:
            arvore = ast.parse(f.read())
        nomes = {n.id for n in ast.walk(arvore) if isinstance(n, ast.Name)} | \
                {n.attr for n in ast.walk(arvore) if isinstance(n, ast.Attribute)}
        importados = {a.name for n in ast.walk(arvore) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
        self.assertFalse({"print", "log", "logging", "stdout", "stderr"} & (nomes | importados))

    def test_erro_nao_carrega_o_texto(self):
        with tempfile.TemporaryDirectory() as raiz:
            eq = Equipe(os.path.join(raiz, "x"))
            try:
                with self.assertRaises(ValueError) as cx:
                    eq.enviar("geral", "ana", "Ana", "segredo " * 100)
                self.assertNotIn("segredo", str(cx.exception))
            finally:
                eq.fechar()


if __name__ == "__main__":
    unittest.main()
