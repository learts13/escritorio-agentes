import ast
import collections
import contextlib
import datetime
import hashlib
import io
import itertools
import json
import os
import random
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PASTA = tempfile.mkdtemp(prefix="escritorio-teste-")
os.environ["ESCRITORIO_DADOS"] = PASTA
# nunca o times.json de quem roda a suíte (o modo dele muda o custo do Leitor); vale também para os subprocessos
os.environ["ESCRITORIO_TIMES"] = os.path.join(PASTA, "times.json")
with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as _f:
    json.dump({"conversas": "ler"}, _f)
os.environ["AGENTES_ORG"] = "00000000-0000-4000-8000-000000000000"  # org fictícia
import acesso  # noqa: E402
import avisos  # noqa: E402
import escritorio as e  # noqa: E402
import social  # noqa: E402
from acesso import Acesso  # noqa: E402


def tearDownModule():   # a pasta de dados da suíte não fica para trás no %TEMP%
    shutil.rmtree(PASTA, ignore_errors=True)


AG =[{"id": "a1", "name": "Pixel", "handle": "pixel", "role": "Conteúdo"},
      {"id": "a2", "name": "Órbita", "handle": "agent-orbita-qa-acme", "role": "QA"}]  # agentes fictícios
ORG_URL = f"https://app.agentes.chat/org/{e.ORG}/c/11111111-2222-4333-8444-555555555555"
# arquivos da lista fechada que chegam com o land do floor das telas (uau-telas); até lá, o servidor responde 404
PWA = {"manifest.webmanifest", "sw.js", "icone-180.png", "icone-192.png", "icone-512.png", "icone-mascara-512.png"}
DO_FRONT = {"tv.js", "jornal.js", "timelapse.js", "avisar.js", "novidades.js"} | PWA


def servidos():
    return [n for n in e.ARQUIVOS if n not in DO_FRONT or os.path.isfile(os.path.join(e.ESTATICO, n))]


class Rotulo(unittest.TestCase):
    def test_resposta_de_agente_cortada(self):
        r = e.limpa_rotulo('agent-orbita-qa-acme: <external_data source="reply from agent-orb…',
                           {"agent-orbita-qa-acme": "Órbita"})
        self.assertEqual(r, "Lendo a resposta de Órbita")

    def test_tira_marcacao_e_limita(self):
        r = e.limpa_rotulo("<b>Post</b> do dia &amp; " + "x" * 300)
        self.assertTrue(r.startswith("Post do dia & x"))
        self.assertLessEqual(len(r), 111)
        self.assertNotIn("<", e.limpa_rotulo("texto <script"))


class Resumo(unittest.TestCase):
    def test_prioriza_o_que_pede_a_pessoa_e_filtra_url(self):
        tarefas = [
            {"agent": {"id": "a1"}, "status": "still_running", "label": "A", "started_at": "2026-11-04T10:00:00Z", "url": ORG_URL},
            {"agent": {"id": "a1"}, "status": "waiting_approval", "label": "B", "started_at": "2026-11-04T09:00:00Z",
             "url": "https://app.agentes.chat/api/oauth/authorize?client_id=x"},
            {"agent": {"id": "zz"}, "status": "still_running", "label": "de fora", "started_at": "x"},
        ]
        r = e.resumir(AG, tarefas)
        self.assertEqual(len(r["trabalhos"]), 1)
        t = r["trabalhos"][0]
        self.assertEqual((t["status"], t["rotulo"], t["url"]), ("waiting_approval", "B", ""))
        self.assertEqual(e.resumir(AG, tarefas[:1])["trabalhos"][0]["url"], ORG_URL)

    def test_repassa_run_id_e_todas_as_tarefas(self):
        tarefas = [
            {"run_id": "r1", "agent": {"id": "a1"}, "status": "still_running", "label": "A", "started_at": "2026-11-04T10:00:00Z"},
            {"run_id": "r2", "agent": {"id": "a1"}, "status": "waiting_input", "label": "B", "started_at": "2026-11-04T11:00:00Z"},
        ]
        r = e.resumir(AG, tarefas)
        self.assertEqual([(t["run_id"], t["status"], t["started_at"]) for t in r["tarefas"]],
                         [("r1", "still_running", "2026-11-04T10:00:00Z"), ("r2", "waiting_input", "2026-11-04T11:00:00Z")])
        self.assertEqual(r["trabalhos"][0]["run_id"], "r2")  # o front segue com uma por agente
        self.assertEqual(set(r["tarefas"][0]), {"agente_id", "run_id", "status", "started_at"})  # sem rótulo nem url


def tarefa(run_id, status, agente="a1"):
    return {"agente_id": agente, "run_id": run_id, "status": status, "rotulo": "conteúdo que não pode vazar"}


class Diario(unittest.TestCase):
    HANDLES = {"a1": "pixel", "a2": "agent-orbita-qa-acme"}

    def setUp(self):
        self.d = e.Diario()

    def ler(self, tarefas, agora):
        return self.d.registrar(tarefas, self.HANDLES, agora)

    def test_primeira_leitura_e_so_linha_de_base(self):
        lista = [tarefa("r1", "still_running"), tarefa("r2", "waiting_approval", "a2")]
        self.assertEqual(self.ler(lista, 1000), [])
        self.assertEqual({t["desde"] for t in lista}, {"1970-01-01T00:16:40Z"})

    def test_transicoes_geram_eventos_sem_conteudo(self):
        self.ler([tarefa("r1", "still_running")], 0)
        self.ler([tarefa("r1", "waiting_approval"), tarefa("r2", "running", "a2")], 60)
        self.ler([tarefa("r1", "still_running"), tarefa("r2", "waiting_input", "a2")], 120)
        ev = self.ler([tarefa("r2", "waiting_input", "a2")], 180)
        self.assertEqual([(x["tipo"], x["agente"], x["run_id"]) for x in ev], [
            ("terminou", "pixel", "r1"), ("pediu_resposta", "agent-orbita-qa-acme", "r2"), ("voltou_a_trabalhar", "pixel", "r1"),
            ("comecou", "agent-orbita-qa-acme", "r2"), ("pediu_aprovacao", "pixel", "r1")])  # do mais novo para o mais velho
        self.assertEqual(ev[0], {"em": "1970-01-01T00:03:00Z", "tipo": "terminou", "agente": "pixel", "run_id": "r1"})
        self.assertNotIn("conteúdo", json.dumps(ev, ensure_ascii=False))

    def test_tarefa_que_ja_nasce_esperando(self):
        self.ler([], 0)
        ev = self.ler([tarefa("r9", "waiting_approval")], 10)
        self.assertEqual([x["tipo"] for x in ev], ["pediu_aprovacao", "comecou"])

    def test_desde_fica_estavel_enquanto_o_status_nao_muda(self):
        self.ler([tarefa("r1", "running")], 0)
        for agora in (15, 30, 45):
            lista = [tarefa("r1", "still_running" if agora % 2 else "running")]  # as duas formas de "trabalhando"
            self.assertEqual(self.ler(lista, agora), [])
            self.assertEqual(lista[0]["desde"], "1970-01-01T00:00:00Z")
        lista = [tarefa("r1", "waiting_input")]
        self.ler(lista, 60)
        self.assertEqual(lista[0]["desde"], "1970-01-01T00:01:00Z")

    def test_run_que_some_sai_do_diario_e_a_lista_tem_limite(self):
        self.ler([tarefa("r0", "running")], 0)
        for i in range(1, 80):
            self.ler([tarefa(f"r{i}", "running")], i)  # cada leitura: um começa e o anterior termina
        self.assertEqual(list(self.d.runs), ["r79"])
        ev = self.ler([tarefa("r79", "running")], 100)
        self.assertEqual(len(ev), e.Diario.LIMITE)
        self.assertEqual([(x["tipo"], x["run_id"]) for x in ev[:2]], [("terminou", "r78"), ("comecou", "r79")])

    def test_leitura_incompleta_nao_termina_nem_apaga(self):
        self.ler([tarefa("r1", "running"), tarefa("r2", "running")], 0)
        self.assertEqual(self.d.registrar([tarefa("r1", "running")], self.HANDLES, 15, completa=False), [])
        self.assertEqual(set(self.d.runs), {"r1", "r2"})
        lista = [tarefa("r1", "running"), tarefa("r2", "running")]
        self.assertEqual(self.ler(lista, 30), [])  # voltou na leitura completa: sem "comecou" e com o mesmo desde
        self.assertEqual(lista[1]["desde"], "1970-01-01T00:00:00Z")
        self.assertEqual([x["tipo"] for x in self.ler([tarefa("r1", "running")], 45)], ["terminou"])

    def test_run_id_repetido_na_mesma_leitura_nao_oscila(self):
        self.ler([tarefa("r1", "running")], 0)
        dupla = [tarefa("r1", "waiting_approval"), tarefa("r1", "running")]
        self.assertEqual([x["tipo"] for x in self.ler(dupla, 15)], ["pediu_aprovacao"])
        self.assertEqual(self.ler([tarefa("r1", "waiting_approval"), tarefa("r1", "running")], 30)[0]["em"], "1970-01-01T00:00:15Z")

    def test_run_id_repetido_tambem_recebe_desde(self):
        self.ler([], 0)
        dupla = [tarefa("r1", "waiting_approval"), tarefa("r1", "running")]
        self.ler(dupla, 15)
        self.assertEqual([t.get("desde") for t in dupla], ["1970-01-01T00:00:15Z"] * 2)  # a cópia leva o "desde" do primeiro

    def test_aplicar_poe_desde_nos_trabalhos_e_os_eventos(self):
        r = e.resumir(AG, [{"run_id": "r1", "agent": {"id": "a1"}, "status": "running", "started_at": "x"}])
        self.d.aplicar(r, agora=60)
        self.assertEqual((r["trabalhos"][0]["desde"], r["tarefas"][0]["desde"], r["eventos"]), ("1970-01-01T00:01:00Z",) * 2 + ([],))

    # --- resolvidos hoje (fuso de Brasília). T = 04/11/2026 12:00 em Brasília (15:00Z)
    T = 1793804400

    def resolver(self, tarefas, agora, rotulos=None, completa=True):
        self.d.registrar(tarefas, self.HANDLES, agora, completa, rotulos or {})
        return self.d.resolvidos_hoje(agora)

    def test_pedido_que_voltou_a_trabalhar(self):
        T = self.T
        self.resolver([tarefa("r1", "running")], T)
        self.resolver([tarefa("r1", "waiting_approval")], T + 60, {"r1": "Publicar o post"})
        self.assertEqual(self.resolver([tarefa("r1", "still_running")], T + 660), [
            {"run_id": "r1", "agente": "pixel", "tipo": "aprovacao", "rotulo": "Publicar o post", "pediu_em": "2026-11-04T15:01:00Z",
             "resolvido_em": "2026-11-04T15:11:00Z", "desfecho": "voltou_a_trabalhar", "desde_inicio": False}])

    def test_pedido_que_sumiu_terminou(self):
        self.resolver([], self.T)
        self.resolver([tarefa("r1", "waiting_input")], self.T + 60, {"r1": "Qual cor?"})
        r = self.resolver([], self.T + 120)
        self.assertEqual([(x["desfecho"], x["tipo"], x["rotulo"]) for x in r], [("terminou", "pergunta", "Qual cor?")])

    def test_aprovacao_que_vira_pergunta_e_outro_pedido(self):
        self.resolver([], self.T)
        self.resolver([tarefa("r1", "waiting_approval")], self.T + 60, {"r1": "Aprovar"})
        agora = [tarefa("r1", "waiting_input")]
        r = self.resolver(agora, self.T + 120, {"r1": "Responder"})
        self.assertEqual([(x["desfecho"], x["tipo"], x["rotulo"]) for x in r], [("outro_pedido", "aprovacao", "Aprovar")])
        self.assertEqual((self.d.runs["r1"]["status"], agora[0]["desde"]), ("waiting_input", "2026-11-04T15:02:00Z"))   # segue esperando
        r = self.resolver([tarefa("r1", "running")], self.T + 300)
        self.assertEqual([(x["desfecho"], x["tipo"], x["rotulo"], x["pediu_em"]) for x in r][0],
                         ("voltou_a_trabalhar", "pergunta", "Responder", "2026-11-04T15:02:00Z"))

    def test_leitura_incompleta_nao_resolve(self):
        self.resolver([], self.T)
        self.resolver([tarefa("r1", "waiting_approval")], self.T + 60)
        self.assertEqual(self.resolver([], self.T + 120, completa=False), [])
        self.assertEqual([x["desfecho"] for x in self.resolver([], self.T + 180)], ["terminou"])

    def test_virada_do_dia_em_brasilia_limpa(self):
        meia_noite = 1793847600   # 05/11 03:00Z = 00:00 em Brasília
        self.resolver([], meia_noite - 120)
        self.resolver([tarefa("r1", "waiting_approval")], meia_noite - 90)
        self.assertEqual(len(self.resolver([], meia_noite - 60)), 1)   # 23:59 em Brasília, ainda "hoje"
        self.assertEqual(len(self.d.resolvidos_hoje(meia_noite - 1)), 1)
        self.assertEqual(self.d.resolvidos_hoje(meia_noite), [])

    def test_rotulo_limpo_com_teto_sem_url_e_sem_o_que_vem_das_tarefas(self):
        rotulo = "<b>Aprovar</b> &amp; publicar <a href='https://x.example/segredo'>o link</a> " + "palavra " * 30
        url = f"https://app.agentes.chat/org/{e.ORG}/c/11111111-2222-4333-8444-555555555555"
        bruta = {"run_id": "r1", "agent": {"id": "a1"}, "status": "waiting_approval", "started_at": "x", "label": rotulo, "url": url}
        self.d.aplicar(e.resumir(AG, []), agora=self.T)
        self.d.aplicar(e.resumir(AG, [bruta]), agora=self.T + 60)
        r = self.d.aplicar(e.resumir(AG, [dict(bruta, status="running")]), agora=self.T + 120)
        item = r["resolvidos"][0]
        self.assertTrue(item["rotulo"].startswith("Aprovar & publicar o link palavra"))   # texto puro, sem marcação
        self.assertLessEqual(len(item["rotulo"]), 111)
        self.assertNotIn("<", item["rotulo"])
        self.assertNotIn("http", json.dumps(r["resolvidos"]))
        self.assertEqual(set(r["tarefas"][0]), {"agente_id", "run_id", "status", "started_at", "desde"})   # tarefas segue sem rótulo
        self.resolver([tarefa("r2", "waiting_input")], self.T + 180)   # o rótulo de tarefa() nunca entra (só o dos trabalhos)
        self.assertNotIn("conteúdo que não pode vazar", json.dumps(self.resolver([], self.T + 240), ensure_ascii=False))

    def test_resolvidos_tem_teto(self):
        self.resolver([], self.T)
        for i in range(60):
            self.resolver([tarefa(f"r{i}", "waiting_input")], self.T + 10 * i)
            self.resolver([tarefa(f"r{i}", "running")], self.T + 10 * i + 5)
        r = self.d.resolvidos_hoje(self.T + 1000)
        self.assertEqual((len(r), r[0]["run_id"], r[-1]["run_id"]), (50, "r59", "r10"))   # do mais novo para o mais velho

    def test_desde_inicio_so_para_pedido_da_linha_de_base(self):
        self.resolver([tarefa("r1", "waiting_approval"), tarefa("r2", "running", "a2")], self.T)   # r1 já esperava ao subir
        self.resolver([tarefa("r1", "waiting_approval"), tarefa("r2", "waiting_input", "a2")], self.T + 60)
        r = self.resolver([tarefa("r1", "running"), tarefa("r2", "running", "a2")], self.T + 120)
        self.assertEqual({x["run_id"]: x["desde_inicio"] for x in r}, {"r1": True, "r2": False})


class Coleta(unittest.TestCase):
    """O leitor segue as páginas do MCP e recusa resposta sem lista (mantém a leitura anterior)."""
    def leitor(self, paginas):
        class Mcp:
            def ferramenta(self, nome, args, token):
                return paginas[nome][args.get("cursor") or ""]
        l = e.Leitor(None)
        l.mcp = Mcp()
        return l

    def test_pagina_as_tarefas_e_marca_leitura_completa(self):
        l = self.leitor({"list_agents": {"": {"agents": AG}},
                         "list_recent_tasks": {"": {"tasks": [{"run_id": "r1", "agent": {"id": "a1"}}], "next_cursor": "p2"},
                                               "p2": {"tasks": [{"run_id": "r2", "agent": {"id": "a2"}}]}}})
        r, completa, _ = l._coletar("t")
        self.assertEqual(([t["run_id"] for t in r["tarefas"]], completa), (["r1", "r2"], True))

    def test_teto_de_paginas_marca_leitura_incompleta(self):
        sem_fim = {"": {"tasks": [], "next_cursor": "p"}, "p": {"tasks": [], "next_cursor": "p"}}
        _, completa, _ = self.leitor({"list_agents": {"": {"agents": AG}}, "list_recent_tasks": sem_fim})._coletar("t")
        self.assertFalse(completa)

    def test_resposta_sem_lista_e_erro_e_lista_vazia_vale(self):
        with self.assertRaises(RuntimeError):
            self.leitor({"list_agents": {"": {"agents": AG}}, "list_recent_tasks": {"": {}}})._coletar("t")
        with self.assertRaises(RuntimeError):
            self.leitor({"list_agents": {"": {}}, "list_recent_tasks": {"": {"tasks": []}}})._coletar("t")
        r, completa, _ = self.leitor({"list_agents": {"": {"agents": AG}}, "list_recent_tasks": {"": {"tasks": []}}})._coletar("t")
        self.assertEqual((r["tarefas"], completa), ([], True))


class JsonRpcEClima(unittest.TestCase):
    def test_json_e_sse(self):
        self.assertEqual(e._resposta_jsonrpc(b'{"jsonrpc":"2.0","id":1,"result":{"ok":1}}')["result"]["ok"], 1)
        sse = b'event: message\ndata: {"jsonrpc":"2.0","method":"x"}\n\ndata: {"jsonrpc":"2.0","id":2,"result":{"v":2}}\n\n'
        self.assertEqual(e._resposta_jsonrpc(sse)["result"]["v"], 2)
        self.assertIsNone(e._resposta_jsonrpc(b""))

    def test_tipo_do_clima(self):
        self.assertEqual([e.tipo_do_clima(c, 0) for c in (95, 73, 63, 53, 45, 0)], ["tempestade", "neve", "chuva", "garoa", "neblina", "limpo"])
        self.assertEqual(e.tipo_do_clima(1, 80), "nublado")


def em_paralelo(funcao, vezes):
    """Dispara as tentativas juntas (o atraso fica fora da trava) e devolve as mensagens de recusa."""
    recusas = []

    def uma():
        try:
            funcao()
        except PermissionError as x:
            recusas.append(str(x))
    fios = [threading.Thread(target=uma) for _ in range(vezes)]
    for f in fios:
        f.start()
    for f in fios:
        f.join()
    return recusas


DEMAIS = "tentativas demais; espere alguns minutos"


class AcessoUnidade(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="acesso-")
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)
        self.a = Acesso(self.pasta)

    def codigo(self):
        with open(os.path.join(self.pasta, "codigo-primeiro-acesso.txt")) as f:
            return f.read().strip()

    def test_primeiro_acesso_exige_codigo_e_some_depois(self):
        self.assertTrue(self.a.precisa_configurar())
        with self.assertRaises(PermissionError):
            self.a.criar_primeiro("errado", "dono", "senha-bem-grande")
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        self.assertFalse(os.path.exists(os.path.join(self.pasta, "codigo-primeiro-acesso.txt")))
        with self.assertRaises(PermissionError):
            self.a.criar_primeiro("qualquer", "outro", "senha-bem-grande")

    def test_senha_curta_e_usuario_invalido(self):
        with self.assertRaises(ValueError):
            self.a.criar_primeiro(self.codigo(), "dono", "curta")
        with self.assertRaises(ValueError):
            self.a.criar_primeiro(self.codigo(), "Dono Com Espaco", "senha-bem-grande")

    def test_login_sessao_e_sair(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        with self.assertRaises(PermissionError):
            self.a.entrar("dono", "senha-errada!!")
        tok = self.a.entrar("Dono", "senha-bem-grande")
        self.assertEqual(self.a.sessao(tok), "dono")
        with open(os.path.join(self.pasta, "sessoes.json")) as f:
            self.assertNotIn(tok, f.read())  # no disco só vai o hash do token
        self.a.sair(tok)
        self.assertIsNone(self.a.sessao(tok))

    def test_senha_com_surrogate_sozinho_e_senha_errada(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        with self.assertRaises(PermissionError):   # e não UnicodeEncodeError
            self.a.conferir("dono", "\ud800")

    def test_hash_de_senha_no_disco(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        with open(os.path.join(self.pasta, "usuarios.json")) as f:
            self.assertNotIn("senha-bem-grande", f.read())

    def test_inexistentes_nao_trancam_o_dono_nem_o_primeiro_acesso(self):
        recusas = em_paralelo(lambda: self.a.entrar("fulano", "errada-errada"), acesso.LIMITE + 2)
        self.assertEqual(recusas.count(DEMAIS), 2)  # o balde dos inexistentes encheu, mesmo em paralelo
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        self.assertEqual(self.a.sessao(self.a.entrar("dono", "senha-bem-grande")), "dono")

    def test_primeiro_acesso_tem_balde_proprio(self):
        recusas = em_paralelo(lambda: self.a.criar_primeiro("errado", "dono", "senha-bem-grande"), acesso.LIMITE)
        self.assertEqual(recusas, ["código de primeiro acesso incorreto"] * acesso.LIMITE)
        with self.assertRaisesRegex(PermissionError, DEMAIS):
            self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        self.a._criar("dono", "senha-bem-grande")  # com o dono existindo, o balde cheio do primeiro acesso não o tranca
        self.assertEqual(self.a.sessao(self.a.entrar("dono", "senha-bem-grande")), "dono")

    def test_erros_num_usuario_trancam_so_ele(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        self.a._criar("outro", "outra-senha-grande")
        em_paralelo(lambda: self.a.entrar("dono", "errada-errada"), acesso.LIMITE)
        with self.assertRaisesRegex(PermissionError, DEMAIS):
            self.a.entrar("dono", "senha-bem-grande")
        self.assertEqual(self.a.sessao(self.a.entrar("outro", "outra-senha-grande")), "outro")
        with self.assertRaisesRegex(PermissionError, "incorretos"):
            self.a.entrar("fulano", "errada-errada")

    def test_sessao_cai_quando_o_usuario_some(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        tok = self.a.entrar("dono", "senha-bem-grande")
        os.unlink(os.path.join(self.pasta, "usuarios.json"))  # dono apagou os usuários para recuperar o acesso
        self.assertIsNone(Acesso(self.pasta).sessao(tok))

    def test_sessao_antiga_cai_quando_o_mesmo_nome_e_recriado(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        roubado = self.a.entrar("dono", "senha-bem-grande")
        os.unlink(os.path.join(self.pasta, "usuarios.json"))  # recomeçar do zero, com o mesmo nome
        novo = Acesso(self.pasta)
        novo.criar_primeiro(self.codigo(), "dono", "outra-senha-grande")
        self.assertIsNone(novo.sessao(roubado))
        self.assertIsNone(Acesso(self.pasta).sessao(roubado))  # e continua sem valer depois de reiniciar

    def test_codigo_vazio_nunca_vale(self):
        open(os.path.join(self.pasta, "codigo-primeiro-acesso.txt"), "w").close()  # gravação que falhou no meio
        with self.assertRaisesRegex(PermissionError, "não encontrado"):
            self.a.criar_primeiro("", "dono", "senha-bem-grande")
        self.assertTrue(self.a.precisa_configurar())
        novo = Acesso(self.pasta)  # ao subir, o servidor troca o arquivo inválido por um código novo
        self.assertEqual(len(self.codigo()), 16)
        with self.assertRaises(PermissionError):
            novo.criar_primeiro("", "dono", "senha-bem-grande")
        novo.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        self.assertFalse(novo.precisa_configurar())

    def test_scrypt_grava_parametros_e_recusa_hash_sem_eles(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")
        u = self.a.usuarios["dono"]
        self.assertEqual((u["n"], u["r"], u["p"]), (2 ** 15, 8, 1))
        sal = os.urandom(16)
        antigo = hashlib.scrypt(b"senha-antiga-ok", salt=sal, n=2 ** 14, r=8, p=1, maxmem=64 * 1024 * 1024, dklen=32)
        self.a.usuarios["velho"] = {"sal": sal.hex(), "hash": antigo.hex(), "criado": 0}  # gravado sem n, r e p
        with self.assertRaisesRegex(PermissionError, "incorretos"):
            self.a.entrar("velho", "senha-antiga-ok")


class Http(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Leitor:
            def foto(self):
                return {**e.resumir(AG, []), "atualizado": None, "erro": None}
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor, cls.srv.cred, cls.srv.acesso = Leitor(), None, Acesso(PASTA)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        e.BASE = cls.base
        with open(os.path.join(PASTA, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()

    def req(self, rota, cab=None, dados=None, metodo=None):
        r = urllib.request.Request(self.base + rota, headers=cab or {}, data=dados, method=metodo)

        class SemRedirecionar(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *a, **k):
                return None
        op = urllib.request.build_opener(SemRedirecionar)
        try:
            with op.open(r) as resp:
                return resp.status, resp.read(), resp.headers
        except urllib.error.HTTPError as err:
            return err.code, err.read(), err.headers

    def entrar(self):
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
        st, _, h = self.req("/entrar", {"Origin": self.base, "Content-Type": "application/x-www-form-urlencoded"}, corpo)
        self.assertEqual(st, 303)
        ck = h["Set-Cookie"]
        self.assertIn("HttpOnly", ck); self.assertIn("SameSite=Lax", ck)
        return {"Cookie": ck.split(";")[0]}

    def test_sem_login_vai_para_entrar(self):
        self.assertEqual(self.req("/")[0], 302)
        self.assertEqual(self.req("/api/estado")[0], 401)
        self.assertEqual(self.req("/oauth/conectar")[0], 302)
        self.assertEqual(self.req("/entrar")[0], 200)
        self.assertEqual(self.req("/logo.png")[0], 200)

    def test_estado_com_rotulo_cortado_no_meio_do_emoji_responde_200(self):
        antes = self.srv.leitor

        class Leitor:   # "\ud83d" sozinho é JSON válido e passa pelo resumir(): derrubava o _json com UnicodeEncodeError
            def foto(self):
                tarefas = [{"run_id": "r1", "agent": {"id": "a1"}, "status": "running", "label": "Lendo \ud83d"}]
                return {**e.resumir(AG, tarefas), "atualizado": None, "erro": None}
        self.srv.leitor = Leitor()
        try:
            st, corpo, _ = self.req("/api/estado", self.entrar())
        finally:
            self.srv.leitor = antes
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(corpo)["trabalhos"][0]["rotulo"], "Lendo ?")

    def test_conversa_sem_sessao_desligada_e_ligada(self):
        class Mcp:
            chamadas = []
            sessao = "s"

            def ferramenta(self, nome, args, token):
                self.chamadas.append(args)
                return CONVERSA

        class Cred:
            def token(self):
                return "t"
        l = e.Leitor(Cred())
        l.mcp = Mcp()
        l.estado = {**l.estado, **e.resumir(AG, [{"run_id": "r1", "agent": {"id": "a1"}, "status": "waiting_input", "url": ORG_URL}])}
        antes = self.srv.leitor, getattr(self.srv, "conversas", None), e.TIMES
        pasta = tempfile.mkdtemp(prefix="escritorio-conversa-")
        self.srv.conversas, e.TIMES = e.Conversas(l), os.path.join(pasta, "times.json")
        try:
            self.assertEqual(self.req("/api/conversa?agente=a1")[0], 401)
            cab = self.entrar()
            for times in ({}, {"conversas": "sim"}, {"conversas": "Responder"}):   # só "ler" e "responder" ligam
                with open(e.TIMES, "w", encoding="utf-8") as f:
                    json.dump(times, f)
                self.assertEqual(self.req("/api/conversa?agente=a1", cab)[0], 404, times)
                self.assertEqual(json.loads(self.req("/api/config", cab)[1])["conversas"], "desligado")
            self.assertEqual(l.mcp.chamadas, [])   # desligado: nenhuma chamada ao agentes.chat
            with open(e.TIMES, "w", encoding="utf-8") as f:
                json.dump({"conversas": "ler"}, f)
            self.assertEqual(json.loads(self.req("/api/config", cab)[1])["conversas"], "ler")
            outro = "99999999-8888-4777-8666-555555555555"
            st, corpo, h = self.req(f"/api/conversa?agente=a1&channel_id={outro}&thread_id={outro}", cab)
            self.assertEqual((st, h["Cache-Control"]), (200, "no-store"))
            self.assertEqual(len(json.loads(corpo)["mensagens"]), 2)
            self.assertEqual(l.mcp.chamadas, [{"channel_id": CANAL, "limit": 20}])   # canal e thread da query: ignorados
        finally:
            self.srv.leitor, self.srv.conversas, e.TIMES = antes
            shutil.rmtree(pasta, ignore_errors=True)

    def test_pagina_conversas_no_estado_sem_canal_e_so_com_o_modo(self):
        # contrato P, A4: o /api/estado não leva o canal de uma terminada nem o de uma viva que não é o trabalho atual
        atual, outra, fim = (f"{n}1111111-2222-4333-8444-555555555555" for n in "abc")
        url = lambda canal: f"https://app.agentes.chat/org/{e.ORG}/c/{canal}"
        tarefas = [{"run_id": "r1", "agent": {"id": "a1"}, "status": "waiting_approval", "url": url(atual), "started_at": "2026-01-15T10:00:00Z"},
                   {"run_id": "r2", "agent": {"id": "a1"}, "status": "running", "url": url(outra), "started_at": "2026-01-15T11:00:00Z"},
                   {"run_id": "r3", "agent": {"id": "a2"}, "status": "running", "url": url(fim), "label": "Relatório"}]
        l, agora = e.Leitor(None), time.time()
        l.memoria.atualizar(e.normalizar(AG, tarefas)[1], {}, True, agora)
        l.conversas = l.memoria.atualizar(e.normalizar(AG, tarefas[:2])[1], {}, True, agora)   # a r3 terminou
        l.estado = {**l.estado, **e.resumir(AG, tarefas[:2])}
        antes = self.srv.leitor, getattr(self.srv, "conversas", None), e.TIMES
        pasta = tempfile.mkdtemp(prefix="escritorio-pagina-")
        self.srv.leitor, self.srv.conversas, e.TIMES = l, e.Conversas(l), os.path.join(pasta, "times.json")
        try:
            cab = self.entrar()
            with open(e.TIMES, "w", encoding="utf-8") as f:
                json.dump({"conversas": "ler"}, f)
            st, corpo, _ = self.req("/api/estado", cab)
            lista = json.loads(corpo)["conversas"]
            self.assertEqual(st, 200)
            self.assertEqual(sorted((c["run_id"], c["status"]) for c in lista), [("r1", "waiting_approval"), ("r2", "running"), ("r3", "terminou")])
            for c in lista:
                self.assertEqual(set(c), {"id", "agente_id", "run_id", "status", "rotulo", "desde", "terminou_em", "responder"})
                self.assertIs(c["responder"], False)   # modo "ler": nenhum item recebe envio
            self.assertNotIn(outra, corpo.decode()); self.assertNotIn(fim, corpo.decode())
            self.assertIn(atual, corpo.decode())   # o trabalho atual já saía antes (trabalhos.url)
            with open(e.TIMES, "w", encoding="utf-8") as f:   # A7: modo desligado com a memória cheia
                json.dump({}, f)
            self.assertEqual(json.loads(self.req("/api/estado", cab)[1])["conversas"], [])
            self.assertEqual(self.req(f"/api/conversa?id={lista[0]['id']}", cab)[0], 404)
        finally:
            self.srv.leitor, self.srv.conversas, e.TIMES = antes
            shutil.rmtree(pasta, ignore_errors=True)

    def test_id_vazio_e_conta_nova_no_oauth(self):
        class Mcp:
            sessao, chamadas = "s", []

            def ferramenta(self, nome, args, token):
                self.chamadas.append(nome)
                return CONVERSA

        class Cred:
            def token(self):
                return "t"

            def concluir(self, code, state):
                pass
        l = e.Leitor(Cred())
        l.mcp = Mcp()
        l.estado = {**l.estado, **e.resumir(AG, [{"run_id": "r1", "agent": {"id": "a1"}, "status": "waiting_input", "url": ORG_URL}])}
        l.conversas = l.memoria.atualizar(e.normalizar(AG, [{"run_id": "r1", "agent": {"id": "a1"}, "status": "waiting_input",
                                                             "url": ORG_URL}])[1], {}, True, time.time())
        antes = self.srv.leitor, getattr(self.srv, "conversas", None), self.srv.cred, e.TIMES
        pasta = tempfile.mkdtemp(prefix="escritorio-oauth-")
        self.srv.leitor, self.srv.conversas, self.srv.cred, e.TIMES = l, e.Conversas(l), Cred(), os.path.join(pasta, "times.json")
        try:
            cab = self.entrar()
            with open(e.TIMES, "w", encoding="utf-8") as f:
                json.dump({"conversas": "ler"}, f)
            for q in ("id=", "id", "id=&agente=a1"):   # o "?id=" vazio é id inválido da página, não a ficha
                st, corpo, _ = self.req(f"/api/conversa?{q}", cab)
                self.assertEqual((st, json.loads(corpo)), (404, {"erro": "essa conversa não está mais na lista de hoje"}), q)
            self.assertEqual(l.mcp.chamadas, [])
            self.assertEqual(self.req("/api/conversa?agente=a1", cab)[0], 200)   # a ficha enche o cache
            self.assertEqual(len(self.srv.conversas.cache), 1)
            self.assertEqual(self.req("/oauth/retorno?code=c&state=s", cab)[0], 302)   # conta nova: memória e cache zerados
            self.assertEqual((self.srv.conversas.cache, l.conversas_do_dia()["por_id"]), ({}, {}))
            self.assertEqual(json.loads(self.req("/api/estado", cab)[1])["conversas"], [])
        finally:
            self.srv.leitor, self.srv.conversas, self.srv.cred, e.TIMES = antes
            shutil.rmtree(pasta, ignore_errors=True)

    def test_login_errado_nao_cria_sessao(self):
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "errada-errada"}).encode()
        st, html, h = self.req("/entrar", {"Origin": self.base}, corpo)
        self.assertEqual(st, 200); self.assertIsNone(h.get("Set-Cookie")); self.assertIn("incorretos", html.decode())

    def test_post_de_outra_origem_e_recusado(self):
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
        self.assertEqual(self.req("/entrar", {"Origin": "https://malicioso.example"}, corpo)[0], 403)
        self.assertEqual(self.req("/entrar", {}, corpo)[0], 403)

    def test_origin_null_e_recusado_mesmo_com_referer(self):
        self.assertEqual(self.req("/entrar")[2]["Referrer-Policy"], "same-origin")  # o navegador manda o Origin real
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande", "codigo": "x"}).encode()
        for rota in ("/entrar", "/primeiro-acesso", "/sair"):
            self.assertEqual(self.req(rota, {"Origin": "null"}, corpo)[0], 403, rota)
            self.assertEqual(self.req(rota, {"Origin": "null", "Referer": self.base + "/entrar"}, corpo)[0], 403, rota)

    def test_em_https_o_cookie_e_host_e_so_ele_vale(self):
        antes, e.BASE = e.BASE, "https://escritorio.exemplo.ts.net"
        try:
            corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
            st, _, h = self.req("/entrar", {"Origin": e.BASE}, corpo)
            ck = h["Set-Cookie"]
            self.assertTrue(ck.startswith("__Host-esc_sessao="), ck[:20])
            self.assertIn("; Path=/;", ck); self.assertIn("; Secure", ck); self.assertNotIn("Domain", ck)
            tok = ck.split(";")[0].partition("=")[2]
            self.assertEqual(self.req("/api/estado", {"Cookie": "esc_sessao=" + tok})[0], 401)
            self.assertEqual(self.req("/api/estado", {"Cookie": "__Host-esc_sessao=" + tok})[0], 200)
        finally:
            e.BASE = antes

    def test_com_login_ve_tudo_e_estaticos_fechados(self):
        cab = self.entrar()
        st, corpo, h = self.req("/api/estado", cab)
        self.assertEqual(st, 200)
        self.assertEqual(json.loads(corpo)["agentes"][0]["nome"], "Pixel")
        self.assertIn("frame-ancestors 'none'", h["Content-Security-Policy"])
        self.assertEqual(self.req("/", cab)[0], 200)
        for rota in ("/escritorio.py", "/../escritorio.py", "/static/app.js", "/dados/oauth.json", "/entrar.html", "/acesso.py"):
            self.assertEqual(self.req(rota, cab)[0], 404, rota)

    def test_visitantes_no_estado(self):
        """Cada sessão vê as outras como visitantes anônimos, nunca a si mesma; ?invisivel=1 não marca presença."""
        antes, self.srv.visitantes = getattr(self.srv, "visitantes", None), e.Visitantes()
        try:
            um, dois, tv = self.entrar(), self.entrar(), self.entrar()
            ver = lambda cab, q="": json.loads(self.req("/api/estado" + q, cab)[1])["visitantes"]
            self.assertEqual(ver(um), [])   # sozinho
            outro = ver(dois)   # o "dois" vê o "um"
            self.assertEqual(len(outro), 1)
            self.assertRegex(outro[0]["id"], r"\A[0-9a-f]{8}\Z")
            self.assertIn(outro[0]["cor"], e.CORES_VISITANTE)
            self.assertEqual(set(outro[0]), {"id", "cor"})   # sem usuário, aparelho nem nada da sessão
            sessao_um = um["Cookie"].partition("=")[2]
            self.assertNotIn(outro[0]["id"], sessao_um + hashlib.sha256(sessao_um.encode()).hexdigest())   # nem pedaço
            self.assertEqual(len(ver(tv, "?invisivel=1")), 2)   # a TV vê os dois...
            self.assertEqual(ver(um), [v for v in ver(tv, "?invisivel=1") if v != outro[0]])   # ...e ninguém vê a TV
        finally:
            self.srv.visitantes = antes

    def test_marca_e_logo(self):
        cab = {**self.entrar(), "Origin": self.base}
        st, corpo, _ = self.req("/api/marca", {**cab, "Content-Type": "application/json"}, json.dumps({"empresa": "Acme", "cor": "#112233"}).encode())
        self.assertEqual(st, 200); self.assertEqual(json.loads(corpo)["empresa"], "Acme")
        self.assertEqual(self.req("/api/marca", cab, json.dumps({"empresa": "<script>", "cor": "#112233"}).encode())[0], 400)
        self.assertEqual(self.req("/api/logo", {**cab, "Content-Type": "image/png"}, b"nao e imagem")[0], 400)
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 64
        self.assertEqual(self.req("/api/logo", {**cab, "Content-Type": "image/png"}, png)[0], 200)
        st, dados, h = self.req("/logo", cab)
        self.assertEqual((st, h["Content-Type"]), (200, "image/png")); self.assertTrue(dados.startswith(b"\x89PNG"))
        self.assertEqual(self.req("/api/logo", {"Origin": self.base, "Content-Type": "image/png"}, png)[0], 401)  # sem sessão

    def test_expediente_pelo_personalizar(self):
        cab = {**self.entrar(), "Origin": self.base, "Content-Type": "application/json"}
        salvar = lambda **campos: self.req("/api/marca", cab, json.dumps({"empresa": "Acme", "cor": "#112233", **campos}).encode())
        st, corpo, _ = salvar(expediente={"abre": "22:00", "fecha": "6:00"})
        self.assertEqual((st, json.loads(corpo)["expediente"]), (200, {"abre": "22:00", "fecha": "06:00"}))
        for exp, erro in (({"abre": "08:00", "fecha": "08:00"}, "o expediente precisa abrir e fechar em horários diferentes"),
                          ({"abre": "25:00", "fecha": "08:00"}, "expediente: horário no formato HH:MM, de 00:00 a 23:59"),
                          ({"abre": "07:0٥", "fecha": "20:00"}, "expediente: horário no formato HH:MM, de 00:00 a 23:59"),   # dígito arábico
                          ("22:00-06:00", "expediente: horário no formato HH:MM, de 00:00 a 23:59")):
            with self.subTest(exp=exp):
                st, corpo, _ = salvar(expediente=exp)
                self.assertEqual((st, json.loads(corpo)), (400, {"erro": erro}))
        # recusado não grava nada; o Salvar sem o campo (a tela antiga) mantém o expediente salvo e troca o resto
        st, corpo, _ = salvar(cor="#445566")
        self.assertEqual((st, json.loads(corpo)["cor"], json.loads(corpo)["expediente"]), (200, "#445566", {"abre": "22:00", "fecha": "06:00"}))
        cfg = json.loads(self.req("/api/config", self.entrar())[1])
        self.assertEqual(cfg["expediente"], {"abre": "22:00", "fecha": "06:00"})

    def test_versao_do_logo_muda_a_cada_troca(self):
        cab = {**self.entrar(), "Origin": self.base, "Content-Type": "image/png"}
        logo = lambda dados: json.loads(self.req("/api/logo", cab, b"\x89PNG\r\n\x1a\n" + dados)[1])["logo"]
        a, b = logo(b"1" * 64), logo(b"2" * 64)   # seguidas, no mesmo segundo
        self.assertNotEqual(a, b)
        self.assertTrue(a.startswith("/logo?v=") and b.startswith("/logo?v="))
        self.assertEqual(logo(b"1" * 64), a)   # o mesmo conteúdo mantém a URL (e o cache)
        st, corpo, _ = self.req("/api/logo/remover", {**cab, "Content-Type": "application/json"}, b"{}")
        with open(os.path.join(e.ESTATICO, "logo.png"), "rb") as f:   # sem logo enviado: a versão do logo padrão
            padrao = hashlib.sha256(f.read()).hexdigest()[:16]
        self.assertEqual((st, json.loads(corpo)["logo"]), (200, f"/logo?v={padrao}"))

    def test_fontes_publicas_com_tipo_e_cache(self):
        for nome, tipo in (("fontes/source-sans-3.woff2", "font/woff2"), ("fontes/doto.woff2", "font/woff2"), ("fontes/figtree.ttf", "font/ttf")):
            st, corpo, h = self.req("/" + nome)   # sem sessão: a tela de entrar usa
            self.assertEqual((st, h["Content-Type"], h["Cache-Control"]), (200, tipo, "public, max-age=3600"), nome)
            with open(os.path.join(e.ESTATICO, nome), "rb") as f:
                self.assertEqual(corpo, f.read(), nome)
        self.assertEqual(self.req("/fontes/OFL-source-sans-3-doto.txt")[0], 302)   # fora da lista fechada: vai para /entrar

    def test_logo_publico_so_como_imagem(self):
        # a tela de entrar mostra o logo personalizado: sem sessão, só PNG/JPEG/WEBP pelos bytes; o resto vira o padrão
        with open(os.path.join(e.ESTATICO, "logo.png"), "rb") as f:
            padrao = f.read()
        try:
            for dados, tipo in ((b"\xff\xd8\xff\xe0" + b"j" * 64, "image/jpeg"), (b"RIFF\0\0\0\0WEBP" + b"w" * 64, "image/webp"),
                                (b"<script>alert(1)</script>", None), (b"<svg xmlns='http://www.w3.org/2000/svg'/>", None),
                                (b"\x89PNG\r\n\x1a\n" + b"p" * e.LOGO_MAX, None)):   # maior que o limite
                with open(e.ARQ_LOGO, "wb") as f:
                    f.write(dados)
                st, corpo, h = self.req("/logo?v=qualquer")
                self.assertEqual(st, 200)
                self.assertEqual((h["Content-Type"], corpo), (tipo, dados) if tipo else ("image/png", padrao))
                self.assertEqual(h["X-Content-Type-Options"], "nosniff")
                self.assertIsNone(h["Access-Control-Allow-Origin"])
        finally:
            os.unlink(e.ARQ_LOGO)
        self.assertEqual(self.req("/logo")[1], padrao)   # sem logo enviado
        self.assertEqual(self.req("/api/config")[0], 401)
        self.assertEqual(self.req("/api/logo", {"Origin": self.base, "Content-Type": "image/png"}, b"\x89PNG\r\n\x1a\n")[0], 401)

    def test_previa_so_na_previa(self):
        # a faixa "Prévia de desenvolvimento" nunca pode aparecer no servidor de verdade
        cab = self.entrar()
        st, corpo, _ = self.req("/api/config", cab)
        self.assertEqual(st, 200); self.assertNotIn("previa", json.loads(corpo))
        self.srv.previa_sem_login = True
        try:
            self.assertIs(json.loads(self.req("/api/config")[1])["previa"], True)
        finally:
            del self.srv.previa_sem_login

    def test_scripts_com_login_tipo_e_cache(self):
        cab = self.entrar()
        for nome in servidos():
            if not nome.endswith(".js"):
                continue
            st, corpo, h = self.req("/" + nome, cab)
            self.assertEqual((st, h["Content-Type"]), (200, "text/javascript; charset=utf-8"), nome)
            self.assertEqual(h["Cache-Control"], "no-cache", nome)
            with open(os.path.join(e.ESTATICO, nome), "rb") as f:
                self.assertEqual(corpo, f.read(), nome)   # inteiro, mesmo com a escrita em blocos
        for rota in ("/fontes/OFL-figtree-silkscreen.txt", "/tema/", "/tema/../app.js"):   # fora da lista fechada
            self.assertEqual(self.req(rota, cab)[0], 404, rota)
        for nome in set(e.ARQUIVOS) - set(servidos()):   # da lista e ainda fora da pasta: 404, sem derrubar a conexão
            self.assertEqual(self.req("/" + nome, cab)[0], 404, nome)

    def test_pwa_sem_login(self):
        """O manifesto, o sw.js e os ícones são públicos (o navegador busca o manifesto sem cookie), com o tipo certo."""
        self.assertLessEqual(PWA, e.PUBLICOS)
        for nome in PWA:
            st, _, h = self.req("/" + nome)
            if nome in servidos():
                self.assertEqual((st, h["Content-Type"]), (200, e.ARQUIVOS[nome]), nome)
            else:
                self.assertEqual(st, 404, nome)   # antes do land das telas: 404, e não o /entrar

    def test_scripts_sem_login_vao_para_entrar(self):
        for nome in e.ARQUIVOS:
            if nome.endswith(".js") and nome not in e.PUBLICOS:
                st, _, h = self.req("/" + nome)
                self.assertEqual((st, h["Location"]), (302, "/entrar"), nome)

    def test_csp_so_scripts_da_propria_origem(self):
        h = self.req("/entrar")[2]["Content-Security-Policy"]
        diretivas = {d.split()[0]: d.split()[1:] for d in h.split(";") if d.strip()}
        self.assertEqual(diretivas["script-src"], ["'self'"])
        self.assertNotIn("unsafe-eval", h); self.assertNotIn("unsafe-inline", h)

    def test_retorno_do_oauth_nao_repete_texto_de_fora(self):
        erro = urllib.parse.quote("acesso negado, entre em evil.example")
        st, corpo, _ = self.req("/oauth/retorno?error=" + erro, self.entrar())
        self.assertEqual(st, 400)
        self.assertNotIn(b"evil.example", corpo)

    def test_sair_encerra_sessao(self):
        cab = self.entrar()
        self.assertEqual(self.req("/sair", {**cab, "Origin": self.base}, b"", "POST")[0], 303)
        self.assertEqual(self.req("/api/estado", cab)[0], 401)


class Estaticos(unittest.TestCase):
    def test_scripts_classicos_sem_modulos_nem_workers(self):
        # as páginas carregam só <script src> clássico: import/export ou Worker trariam código que os testes daqui não leem
        for nome in servidos():
            if nome.endswith(".js"):
                with open(os.path.join(e.ESTATICO, nome), encoding="utf-8") as f:
                    self.assertNotRegex(f.read(), r"\bimport\s*[({'\"*]|\bexport\s|\bWorker\b|importScripts", nome)

    def test_scripts_sem_atalhos_perigosos(self):
        # texto virando código; o CSP sem unsafe-eval já barra no navegador, isto barra antes, no código
        proibidos = (r"\beval\s*\(", r"\bnew\s+Function\b", r"\bdocument\.write", r"\bset(?:Timeout|Interval)\s*\(\s*['\"`]")
        for rx, exemplo in zip(proibidos, ("eval (x)", "new Function('a')", "document.writeln(x)", "setTimeout( `go()`, 9)")):
            self.assertRegex(exemplo, rx)
        for nome in servidos():
            if nome.endswith(".js"):
                with open(os.path.join(e.ESTATICO, nome), encoding="utf-8") as f:
                    js = f.read()
                for rx in proibidos:
                    self.assertNotRegex(js, rx, nome)

    def test_paginas_so_carregam_o_que_o_servidor_serve(self):
        # todo <script src>, <link href> e <img src> local das páginas tem que estar em ARQUIVOS e existir no disco;
        # o que a tela de login carrega tem que ser público (sem sessão, o resto vira redirecionamento para /entrar)
        ref = re.compile(r"<(?:script|link|img)\b[^>]*?\b(?:src|href)\s*=\s*[\"']([^\"']+)[\"']", re.I)
        for pagina, publico in (("index.html", False), ("entrar.html", True), ("construir.html", False), ("aviso.html", True)):
            with open(os.path.join(e.ESTATICO, pagina), encoding="utf-8") as f:
                html = f.read()
            if pagina == "entrar.html":
                html = e.pagina_login().decode()   # o que o navegador recebe, com os {{...}} preenchidos
            locais = [u for u in ref.findall(html) if not re.match(r"[a-z][a-z0-9+.-]*:|//|#", u, re.I)]
            self.assertTrue(locais, pagina)
            if pagina == "aviso.html":   # servida em /oauth/conectar e /oauth/retorno: caminho relativo viraria /oauth/...
                self.assertEqual([u for u in locais if not u.startswith("/")], [], pagina)
            versoes = set()
            for u in locais:
                nome = u.split("?")[0].lstrip("/")
                if nome == "logo":   # rota pública do logo (test_logo_publico_so_como_imagem); o ?v= dela é o hash do logo
                    continue
                self.assertIn(nome, e.ARQUIVOS, f"{pagina} carrega {u}, que o servidor não serve (404)")
                self.assertTrue(os.path.isfile(os.path.join(e.ESTATICO, nome)), f"{pagina}: {nome} não existe")
                if publico:
                    self.assertIn(nome, e.PUBLICOS, f"{pagina} carrega {u}, que exige login")
                if "?v=" in u:
                    versoes.add(u.split("?v=")[1])
            self.assertLessEqual(len(versoes), 1, f"{pagina} com ?v= diferentes: {sorted(versoes)}")

    def test_css_so_carrega_o_que_o_servidor_serve(self):
        # as fontes entram pelo @font-face, url(...), que o teste das páginas não lê; o que o entrar.css usa tem que ser público
        for folha, publico in (("estilo.css", False), ("entrar.css", True)):
            with open(os.path.join(e.ESTATICO, folha), encoding="utf-8") as f:
                css = f.read()
            locais = [u for u in re.findall(r"url\(\s*[\"']?([^\"')]+?)[\"']?\s*\)", css) if not re.match(r"[a-z][a-z0-9+.-]*:|//|#", u, re.I)]
            self.assertTrue(locais, folha)
            for u in locais:
                nome = u.split("?")[0].lstrip("/")
                self.assertIn(nome, e.ARQUIVOS, f"{folha} carrega {u}, que o servidor não serve (404)")
                self.assertTrue(os.path.isfile(os.path.join(e.ESTATICO, nome)), f"{folha}: {nome} não existe")
                if publico:
                    self.assertIn(nome, e.PUBLICOS, f"{folha} carrega {u}, que exige login")

class Visitantes(unittest.TestCase):
    """A presença fica só na memória, com teto, validade de 45 s e um id que não leva de volta à sessão."""
    def test_validade_teto_e_chave_da_subida(self):
        v = e.Visitantes()
        v.ver("a", 1000)
        self.assertEqual(len(v.ver("b", 1000)), 1)
        self.assertEqual(len(v.ver("c", 1000 + e.VISITANTE_VALIDADE - 1)), 2)   # a e b ainda valem
        self.assertEqual(len(v.ver("c", 1000 + e.VISITANTE_VALIDADE)), 0)   # venceram: só o próprio c
        self.assertEqual(len(v.ver("c", 1000 + e.VISITANTE_VALIDADE)), 0)   # a mesma sessão é uma marca só
        v.ver("d", 2000, marcar=False)
        self.assertEqual(len(v.ver("c", 2000)), 0)   # invisível não marca
        self.assertEqual(len(v.ver(None, 2000)), 1)   # sem sessão (a prévia) só olha
        for i in range(e.VISITANTES_MAX + 10):
            v.ver(f"s{i}", 3000)
        self.assertEqual(len(v.visto), e.VISITANTES_MAX)   # lotado: sessão nova não entra
        self.assertEqual(len(v.ver("s0", 3000)), e.VISITANTES_MAX - 1)   # quem já estava continua
        um, outro = e.Visitantes(), e.Visitantes()
        um.ver("a", 0); outro.ver("a", 0)
        self.assertNotEqual(um.ver(None, 0), outro.ver(None, 0))   # a mesma sessão, outra subida: outro id


class Envio(unittest.TestCase):
    class Saida:   # o socket do navegador: aceita os cabeçalhos e o 1º bloco, depois falha
        def __init__(self, erro):
            self.erro, self.escritas = erro, 0

        def write(self, dados):
            self.escritas += 1
            if self.escritas > 2:
                raise self.erro

    def manipulador(self, erro):
        h = e.Pagina.__new__(e.Pagina)
        h.request_version, h.command, h.requestline, h.client_address = "HTTP/1.1", "GET", "GET /x HTTP/1.1", ("127.0.0.1", 0)
        h.close_connection, h.wfile = False, self.Saida(erro)
        return h

    def test_aba_fechada_no_meio_do_envio_encerra_em_silencio(self):
        for erro in (BrokenPipeError(), ConnectionResetError(), ConnectionAbortedError()):
            h = self.manipulador(erro)
            h._envia(200, b"x" * 300_000, "text/javascript; charset=utf-8")
            self.assertTrue(h.close_connection, type(erro).__name__)
            self.assertEqual(h.wfile.escritas, 3)   # parou no bloco que falhou

    def test_aba_fechada_antes_do_corpo_tambem(self):
        h = self.manipulador(BrokenPipeError())
        h.wfile.escritas = 2   # a próxima escrita (a dos cabeçalhos) já falha
        h._envia(200, b"x" * 10)
        self.assertTrue(h.close_connection)

    def test_outro_erro_de_escrita_continua_subindo(self):
        with self.assertRaises(OSError):
            self.manipulador(OSError("disco cheio"))._envia(200, b"x" * 300_000)


class PrimeiroAcessoFechado(unittest.TestCase):
    """usuarios.json ilegível nunca vira "sem usuários", e o `escritorio.py codigo` só lê."""
    CODIGO = "0123456789abcdef"
    ILEGIVEIS = {"json cortado": b'{"segredo-123"', "vazio": b"", "lista": b"[]", "utf-8 inválido": b"\xff", "pasta": None}

    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="primeiro-acesso-")
        self.usuarios, self.arq_codigo = os.path.join(self.pasta, "usuarios.json"), os.path.join(self.pasta, "codigo-primeiro-acesso.txt")

    def tearDown(self):
        shutil.rmtree(self.pasta, ignore_errors=True)

    def plantar(self, usuarios, codigo=True):
        if usuarios is None:
            os.mkdir(self.usuarios)   # IsADirectoryError no Linux, PermissionError no Windows: o ramo OSError
        else:
            with open(self.usuarios, "wb") as f:
                f.write(usuarios)
        if codigo:
            with open(self.arq_codigo, "w") as f:
                f.write(self.CODIGO + "\n")

    def foto(self):   # o que há na pasta, com o conteúdo de cada arquivo
        r = {}
        for n in sorted(os.listdir(self.pasta)):
            c = os.path.join(self.pasta, n)
            r[n] = None if os.path.isdir(c) else open(c, "rb").read()
        return r

    def codigo_cli(self, pasta=None, base="http://127.0.0.1:7999"):
        caminho = os.path.join(os.path.dirname(os.path.abspath(__file__)), "escritorio.py")
        return subprocess.run([sys.executable, "-I", caminho, "codigo"], capture_output=True, text=True, errors="replace", timeout=60,
                              env={**os.environ, "ESCRITORIO_DADOS": pasta or self.pasta, "ESCRITORIO_BASE": base})

    def test_acesso_nao_sobe_com_usuarios_ilegivel(self):
        for nome, conteudo in self.ILEGIVEIS.items():
            for com_codigo in (False, True):
                with self.subTest(nome, com_codigo=com_codigo):
                    self.tearDown(); self.setUp()
                    self.plantar(conteudo, com_codigo)
                    antes = self.foto()
                    with self.assertRaises(acesso.UsuariosIlegiveis) as c:
                        Acesso(self.pasta)
                    self.assertEqual(self.foto(), antes)   # nem código novo, nem arquivo apagado ou trocado
                    self.assertIn("usuarios.json", str(c.exception))
                    self.assertNotIn("segredo-123", str(c.exception))
        self.tearDown(); self.setUp()   # controle: sem o arquivo é o primeiro acesso de sempre
        a = Acesso(self.pasta)
        self.assertTrue(a.precisa_configurar())
        self.assertEqual(len(acesso.ler_codigo(self.arq_codigo)), 16)

    def test_main_para_antes_de_ler_e_de_abrir_a_porta(self):
        self.plantar(b"{", codigo=False)
        antes = e.DADOS, e.BASE, e.Credenciais, e.Leitor, e.Servidor
        def proibido(*a, **k):
            self.fail("o main() montou leitor/servidor com usuarios.json ilegível")
        e.DADOS, e.BASE, e.Credenciais, e.Leitor, e.Servidor = self.pasta, "http://127.0.0.1:7371", proibido, proibido, proibido
        try:
            with self.assertRaises(SystemExit) as c:
                e.main()
        finally:
            e.DADOS, e.BASE, e.Credenciais, e.Leitor, e.Servidor = antes
        self.assertIn("usuarios.json", str(c.exception.code))
        self.assertFalse(os.path.exists(self.arq_codigo))

    def test_codigo_mostrado_vale_e_depois_some(self):
        Acesso(self.pasta)   # o serviço subindo cria o código
        r = self.codigo_cli()
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("http://127.0.0.1:7999/entrar", r.stdout)
        self.assertEqual(r.stderr, "")
        mostrado = re.findall(r"\b[0-9a-f]{16}\b", r.stdout)
        self.assertEqual(mostrado, [acesso.ler_codigo(self.arq_codigo)])
        self.assertTrue(r.stdout.startswith("+---"))   # quadro em ASCII: no Windows, com pipe, a saída é cp1252 (o -I ignora PYTHONIOENCODING)
        Acesso(self.pasta).criar_primeiro(mostrado[0], "dono", "senha-bem-grande")
        with open(self.arq_codigo, "w") as f:   # um código que sobrou (unlink que falhou) também não aparece
            f.write(mostrado[0] + "\n")
        r = self.codigo_cli()
        self.assertEqual(r.returncode, 1)
        self.assertIn("foi feito", r.stderr)   # trecho ASCII: o filho escreve no encoding do sistema
        self.assertNotIn(mostrado[0], r.stdout + r.stderr)

    def test_codigo_so_le(self):
        nova = os.path.join(self.pasta, "nao-existe")
        r = self.codigo_cli(nova)
        self.assertEqual(r.returncode, 1)
        self.assertIn("systemctl status escritorio", r.stderr)
        self.assertFalse(os.path.exists(nova))
        r = self.codigo_cli()
        self.assertEqual((r.returncode, os.listdir(self.pasta)), (1, []))

    def test_codigo_recusa_usuarios_ilegivel(self):
        self.plantar(b'{"segredo-123"')
        r = self.codigo_cli()
        self.assertEqual(r.returncode, 1)
        self.assertIn("usuarios.json", r.stderr)
        self.assertNotIn(self.CODIGO, r.stdout + r.stderr)
        self.assertNotIn("segredo-123", r.stdout + r.stderr)


class MarcaNoLogin(unittest.TestCase):
    def setUp(self):
        self.antes, self.pasta = (e.ESTATICO, e.TIMES, e.ARQ_MARCA, e.ARQ_LOGO), tempfile.mkdtemp(prefix="escritorio-login-")
        e.ESTATICO, e.TIMES, e.ARQ_MARCA, e.ARQ_LOGO = (self.pasta, os.path.join(self.pasta, "times.json"),
                                                        os.path.join(self.pasta, "marca.json"), os.path.join(self.pasta, "logo.img"))
        with open(os.path.join(self.pasta, "entrar.html"), "w", encoding="utf-8") as f:
            f.write("{{empresa}}|{{cor}}|{{logo}}|{{erro}}|{{nada}}")

    def tearDown(self):
        e.ESTATICO, e.TIMES, e.ARQ_MARCA, e.ARQ_LOGO = self.antes
        shutil.rmtree(self.pasta)

    def times(self, conteudo):
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump(conteudo, f)

    def test_marca_escapada_e_cor_validada(self):
        # & e ' passam no rótulo e precisam sair escapados (o entrar.html usa a empresa em atributo e texto)
        self.times({"empresa": "Café & Cia's", "cor": "red"})
        self.assertEqual(e.pagina_login("a<b").decode(), "Café &amp; Cia&#x27;s|#f5b83d|/logo?v=0|a&lt;b|{{nada}}")
        self.times({"empresa": "Acme", "cor": "#12abEF"})
        self.assertEqual(e.pagina_login().decode(), "Acme|#12abEF|/logo?v=0||{{nada}}")

    def test_logo_versionado_pelo_conteudo(self):
        self.times({"empresa": "Acme"})
        padrao = b"\x89PNG\r\n\x1a\n" + b"padrao"
        with open(os.path.join(e.ESTATICO, "logo.png"), "wb") as f:   # o logo padrão novo fura o cache de 1 h
            f.write(padrao)
        self.assertEqual(e.config_publica()["logo"], f"/logo?v={hashlib.sha256(padrao).hexdigest()[:16]}")
        png = b"\x89PNG\r\n\x1a\n" + b"1" * 64   # o do Personalizar vem antes
        with open(e.ARQ_LOGO, "wb") as f:
            f.write(png)
        self.assertEqual(e.pagina_login().decode(), f"Acme|#f5b83d|/logo?v={hashlib.sha256(png).hexdigest()[:16]}||{{{{nada}}}}")

    def test_times_quebrado_nao_derruba_o_login(self):
        self.times(["não é um objeto"])
        self.assertEqual(e.pagina_login().decode(), f"{e.EMPRESA_PADRAO}|#f5b83d|/logo?v=0||{{{{nada}}}}")

    def test_times_fora_do_formato_vale_como_vazio(self):
        # /api/config estourava (o app recarregava a cada 10 s): agora vale o padrão, com um evento no log.
        # O padrão tem os mesmos campos do válido: sem app_url os links "No agentes.chat" viravam "undefined/agents"
        vazio = {"empresa": e.EMPRESA_PADRAO, "times": [], "aparencia": {}, "cor": "#f5b83d",
                 "app_url": f"https://app.agentes.chat/org/{e.ORG}", "clima": None, "expediente": {"abre": "07:00", "fecha": "20:00"},
                 "conversas": "desligado"}
        self.assertEqual(e.carregar_times(os.path.join(self.pasta, "nao-existe.json")), vazio)
        for bruto in (["lista"], {"times": ["Dev"]}, {"times": {"Dev": 1}}, {"times": [{"nome": "Dev", "parede": "x"}]},
                      {"aparencia": ["x"]}):
            with self.subTest(bruto=bruto):
                self.times(bruto)
                self.assertEqual(e.carregar_times(), vazio)
                self.assertEqual(e.config_publica()["times"], [])
        self.times({"empresa": "Acme", "times": [{"nome": "Dev", "parede": 2, "agentes": ["pixel"]}]})   # o válido segue igual
        self.assertEqual([(t["nome"], t["parede"], t["agentes"]) for t in e.carregar_times()["times"]], [("Dev", 2, ["pixel"])])

    def test_expediente_do_times_e_do_personalizar(self):
        # sem a chave: 07:00-20:00, o de antes. Valor ruim vale o padrão com um evento no log, sem derrubar o resto do times.json
        self.assertEqual(e.carregar_times()["expediente"], {"abre": "07:00", "fecha": "20:00"})
        for exp, esperado in (({"abre": "8:30", "fecha": "18:00"}, ("08:30", "18:00")),   # normaliza a hora de 1 dígito
                              ({"abre": "22:00", "fecha": "06:00"}, ("22:00", "06:00")),   # turno que vira a meia-noite
                              ({"abre": "00:00", "fecha": "23:59", "x": 1}, ("00:00", "23:59"))):
            with self.subTest(exp=exp):
                self.times({"empresa": "Acme", "expediente": exp})
                self.assertEqual(e.carregar_times()["expediente"], dict(zip(("abre", "fecha"), esperado)))
        for exp in ({"abre": "09:00", "fecha": "09:00"}, {"abre": "9:00", "fecha": "09:00"}, {"abre": "24:00", "fecha": "06:00"},
                    {"abre": "07:60", "fecha": "20:00"}, {"abre": "7h", "fecha": "20h"}, {"abre": 7, "fecha": 20}, {"abre": "07:00"},
                    {"abre": " 07:00", "fecha": "20:00"}, {"abre": "07:00\n", "fecha": "20:00"}, {"abre": "0٧:00", "fecha": "20:00"}, ["07:00", "20:00"], "07:00-20:00", None):
            with self.subTest(exp=exp):
                self.times({"empresa": "Acme", "expediente": exp})
                saida = io.StringIO()
                with contextlib.redirect_stdout(saida):
                    cfg = e.carregar_times()
                self.assertEqual((cfg["empresa"], cfg["expediente"]), ("Acme", {"abre": "07:00", "fecha": "20:00"}))
                self.assertIn('"resultado": "expediente_invalido"', saida.getvalue())
        # Personalizar > times.json > padrão; um marca.json com expediente estragado cai no do times.json
        self.times({"expediente": {"abre": "06:00", "fecha": "14:00"}})
        for marca, esperado in (({"expediente": {"abre": "14:00", "fecha": "22:00"}}, "14:00"), ({"expediente": {"abre": "1", "fecha": "2"}}, "06:00"),
                                ({"empresa": "Acme"}, "06:00")):
            with self.subTest(marca=marca):
                with open(e.ARQ_MARCA, "w", encoding="utf-8") as f:
                    json.dump(marca, f)
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(e.config_publica()["expediente"]["abre"], esperado)

    def test_times_e_marca_absurdos_valem_como_padrao(self):
        # "parede": 1e400 (int(inf) dá OverflowError) e JSON aninhado demais (RecursionError): /api/config sem 500
        self.times({"empresa": "Acme", "times": [{"nome": "Dev", "parede": 1e400}]})
        self.assertEqual(e.config_publica()["empresa"], e.EMPRESA_PADRAO)
        with open(e.TIMES, "w", encoding="utf-8") as f:
            f.write("[" * 100_000 + "]" * 100_000)
        self.assertEqual(e.config_publica()["times"], [])
        self.times({"empresa": "Acme"})
        for marca in ("[]", "null", '"texto"', "[" * 100_000):   # marca.json que não é objeto vale como vazio
            with self.subTest(marca=marca[:10]):
                with open(e.ARQ_MARCA, "w", encoding="utf-8") as f:
                    f.write(marca)
                self.assertEqual(e.config_publica()["empresa"], "Acme")

    def test_fonte_do_codigo_validada(self):
        # AGPL §13: link "Código-fonte". O .env é lido pelo shell como root (escritorio-codigo): nada que ele interprete
        for valor in ("https://git.example.com/acme/escritorio", "https://code.example.com:8443/a/esc_v2~x%20"):
            self.assertEqual(e.fonte_codigo(valor), valor)
        for valor in (None, "", "http://x.example", "https://", "https://x.example/a b", 'https://x.example/"', "https://x.example/'",
                      "https://x.example/$(id)", "https://x.example/a;b", "https://x.example/`id`", "javascript:alert(1)",
                      "https://x.example/a?b=1", " https://x.example", "https://x.example/" + "a" * 190):
            self.assertEqual(e.fonte_codigo(valor), e.FONTE_PADRAO, valor)
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "instalar.sh"), encoding="utf-8") as f:
            self.assertIn(f"=~ ^{e.FONTE_OK.pattern}$ ]]", f.read())   # o instalador valida com a mesma regra
        antes = e.FONTE
        e.FONTE = "https://git.example.com/a-b"
        try:
            self.assertEqual(e.config_publica()["fonte"], "https://git.example.com/a-b")
            with open(os.path.join(self.pasta, "entrar.html"), "w", encoding="utf-8") as f:
                f.write("<a href='{{fonte}}'>")
            self.assertEqual(e.pagina_login().decode(), "<a href='https://git.example.com/a-b'>")
        finally:
            e.FONTE = antes

    def test_etiqueta_exemplo_so_no_nome_padrao(self):
        with open(os.path.join(self.pasta, "entrar.html"), "w", encoding="utf-8") as f:
            f.write("{{empresa}}|{{oculto_exemplo}}")
        casos = (({}, None, True), ({"empresa": "Acme"}, None, False), ({}, {"empresa": "Café Aurora"}, False),
                 ({"empresa": "Acme"}, {"empresa": "Café Aurora"}, False))   # Personalizar > times.json > padrão
        for times, marca, exemplo in casos:
            with self.subTest(times=times, marca=marca):
                self.times(times)
                if marca:
                    with open(e.ARQ_MARCA, "w", encoding="utf-8") as f:
                        json.dump(marca, f)
                elif os.path.exists(e.ARQ_MARCA):
                    os.unlink(e.ARQ_MARCA)
                self.assertIs(e.config_publica()["marca_exemplo"], exemplo)
                self.assertTrue(e.pagina_login().decode().endswith("|" if exemplo else "|hidden"))
        # a instalação nova copia o times.exemplo.json: ele não pode trazer empresa, senão o nome fictício sai sem a etiqueta
        exemplo = os.path.join(os.path.dirname(os.path.abspath(__file__)), "times.exemplo.json")
        self.assertEqual(e.carregar_times(exemplo)["empresa"], e.EMPRESA_PADRAO)


class Configuracao(unittest.TestCase):
    def setUp(self):
        self.antes = e.BASE, e.PORTA, e.ORG
        e.PORTA = 0  # numa regressão, o main() sobe numa porta livre em vez de disputar a 7371

    def tearDown(self):
        e.BASE, e.PORTA, e.ORG = self.antes

    def test_sem_org_o_servidor_nao_sobe(self):
        e.ORG = ""
        with self.assertRaises(SystemExit) as c:
            e.main()
        self.assertIn("AGENTES_ORG", str(c.exception.code))

    def test_https_exige_porta_privilegiada(self):
        e.BASE, e.PORTA, e.ORG = "https://escritorio.exemplo.ts.net", 7371, ""  # sem org: nunca chega a subir
        with self.assertRaises(SystemExit) as c:
            e.main()
        self.assertIn("1024", str(c.exception.code))
        e.PORTA = 737  # porta baixa passa e para só na falta da org
        with self.assertRaises(SystemExit) as c:
            e.main()
        self.assertIn("AGENTES_ORG", str(c.exception.code))


class Orcamento(unittest.TestCase):
    """Contrato O: a leitura de fundo cabe em 3.000 pedidos/dia dos 5.000 que o agentes.chat dá por conexão."""
    class Mcp:   # MCP falso que conta os pedidos como o ClienteMCP (1 por página)
        def __init__(self, agentes, tarefas):
            self.agentes, self.tarefas, self.chamadas, self.pedidos, self.sessao, self.falha = agentes, tarefas, [], 0, "s", None
            self.paginas = 1

        def iniciar(self, token):
            self.sessao = "s"

        def ferramenta(self, nome, args, token):
            self.pedidos += 1
            self.chamadas.append(nome)
            if self.falha:
                raise self.falha
            if nome == "list_agents":
                return {"agents": self.agentes}
            pagina = int(args.get("cursor") or 1)
            return {"tasks": self.tarefas, **({"next_cursor": str(pagina + 1)} if pagina < self.paginas else {})}

    def leitor(self, tarefas=()):
        class Cred:
            def token(self):
                return "t"
        l = e.Leitor(Cred())
        l.mcp = self.Mcp(AG, list(tarefas))
        return l

    def test_intervalo_tem_piso_de_30(self):
        cod = "import escritorio; print(escritorio.INTERVALO)"
        amb = {**os.environ, "ESCRITORIO_INTERVALO": "15"}
        r = subprocess.run([sys.executable, "-c", cod], cwd=os.path.dirname(os.path.abspath(e.__file__)),
                           env=amb, capture_output=True, text=True, timeout=60)
        self.assertEqual(r.stdout.strip(), "30", r.stderr)

    def test_esperas(self):
        self.assertEqual(e.espera_429("120", 1), 120)
        self.assertEqual((e.espera_429("5", 1), e.espera_429("999999", 1)), (60, 3600))   # entre 60 s e 1 h
        daqui_10min = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime(time.time() + 600))
        self.assertAlmostEqual(e.espera_429(daqui_10min, 1), 600, delta=5)
        self.assertEqual([e.espera_429(None, n) for n in (1, 2, 3, 4, 5, 40)], [300, 600, 1200, 2400, 3600, 3600])
        self.assertEqual(e.espera_429("lixo", 2), 600)
        self.assertEqual([e.espera_erro(n) for n in (1, 2, 3, 4, 5, 40)], [30, 60, 120, 240, 300, 300])

    def test_429_levanta_limitado_sem_zerar_a_sessao(self):
        antes = e._abrir
        e._abrir = lambda req: (429, {"Retry-After": "120"}, b"")
        try:
            c = e.ClienteMCP(None)
            c.sessao = "sessao-viva"
            with self.assertRaises(e.Limitado) as x:
                c._post({"jsonrpc": "2.0", "id": 1, "method": "tools/call"}, "t")
        finally:
            e._abrir = antes
        self.assertEqual((x.exception.retry_after, c.sessao, c.pedidos), ("120", "sessao-viva", 1))

    def test_agentes_a_cada_10_min_e_ciclo_dorme_conforme_o_custo(self):
        l = self.leitor([{"run_id": "r1", "agent": {"id": "a1"}, "status": "running"}])
        t0 = 1_000_000.0
        self.assertAlmostEqual(l.ciclo(t0), 2 * 86400 / 3000)            # 1ª leitura: agentes + tarefas
        self.assertEqual(l.ciclo(t0 + 60), e.INTERVALO)                  # só tarefas: 28,8 s vira o piso de 30
        self.assertEqual(l.mcp.chamadas, ["list_agents", "list_recent_tasks", "list_recent_tasks"])
        l.ciclo(t0 + 599)
        self.assertEqual(l.mcp.chamadas.count("list_agents"), 1)
        l.ciclo(t0 + 600)
        self.assertEqual(l.mcp.chamadas.count("list_agents"), 2)
        self.assertEqual(l.foto()["agentes"][0]["id"], "a1")   # entre as recargas, a lista anterior vale

    def test_um_dia_simulado_cabe_no_orcamento(self):
        for paginas in (1, 2, 5):   # mais tarefas que uma página: o intervalo cresce e o teto continua valendo
            l = self.leitor([{"run_id": "r1", "agent": {"id": "a1"}, "status": "running"}])
            l.mcp.paginas = paginas
            agora = 1_000_000.0
            while agora < 1_000_000.0 + 86400:
                agora += l.ciclo(agora)
            # tolerância de um ciclo: o último começa antes do fim do dia e termina depois
            self.assertLessEqual(l.mcp.pedidos, e.ORCAMENTO_DIA + paginas + 1, paginas)
            self.assertLessEqual(l.mcp.chamadas.count("list_agents"), 144)   # no máximo 1 a cada 10 min
        self.assertGreater(l.mcp.pedidos, 2900)   # e não fica parado: usa o orçamento

    def test_ciclo_de_3_pedidos_dorme_86_s(self):
        l = self.leitor()
        orig = l.mcp.ferramenta

        def com_initialize(nome, args, token):
            if nome == "list_agents":
                l.mcp.pedidos += 1   # a sessão foi renovada antes: initialize + notificação viram 1 a mais aqui
            return orig(nome, args, token)
        l.mcp.ferramenta = com_initialize
        self.assertAlmostEqual(l.ciclo(1_000_000.0), 86.4)

    def test_agente_desconhecido_recarrega_a_lista_no_maximo_a_cada_2_min(self):
        l = self.leitor([{"run_id": "r1", "agent": {"id": "a1"}, "status": "running"}])
        t0 = 1_000_000.0
        l.ciclo(t0)
        novo = {"id": "a3", "name": "Nova", "handle": "nova", "role": ""}
        l.mcp.agentes = AG + [novo]
        l.mcp.tarefas.append({"run_id": "r3", "agent": {"id": "a3"}, "status": "waiting_input"})
        l.ciclo(t0 + 60)   # menos de 2 min da última lista: espera
        self.assertEqual(l.mcp.chamadas.count("list_agents"), 1)
        self.assertNotIn("a3", [t["agente_id"] for t in l.foto()["trabalhos"]])
        l.ciclo(t0 + 120)  # 2 min: recarrega no mesmo ciclo e o pedido aparece
        self.assertEqual(l.mcp.chamadas.count("list_agents"), 2)
        self.assertIn("a3", [t["agente_id"] for t in l.foto()["trabalhos"]])
        l.mcp.tarefas.append({"run_id": "r4", "agent": {"id": "fantasma"}, "status": "running"})
        l.ciclo(t0 + 180)  # outro desconhecido 1 min depois: não recarrega de novo
        self.assertEqual(l.mcp.chamadas.count("list_agents"), 2)

    def test_429_pausa_mantem_a_ultima_leitura_e_registra_uma_linha(self):
        l = self.leitor([{"run_id": "r1", "agent": {"id": "a1"}, "status": "running"}])
        l.ciclo(1_000_000.0)
        l.mcp.falha = e.Limitado(None)
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            esperas = [l.ciclo(1_000_100.0), l.ciclo(1_000_500.0)]
        self.assertEqual(esperas, [300, 600])
        self.assertEqual(l.mcp.sessao, "s")   # 429 não zera a sessão MCP
        self.assertEqual(saida.getvalue().count('"limitado"'), 1)   # uma linha por episódio
        foto = l.foto()
        self.assertEqual((foto["erro"], len(foto["trabalhos"])), (e.PAUSA_429, 1))
        self.assertTrue(l.pausado(1_000_500.0 + 599))
        self.assertFalse(l.pausado(1_000_500.0 + 601))
        l.mcp.falha = None
        self.assertEqual(l.ciclo(1_000_590.0), 510)   # ainda na pausa: espera o resto sem chamar o MCP
        self.assertAlmostEqual(l.ciclo(1_001_100.0), 2 * 86400 / 3000)   # acabou: lê de novo (agentes + tarefas)
        self.assertIsNone(l.foto()["erro"])
        l.mcp.falha = e.Limitado("90")
        with contextlib.redirect_stdout(saida):
            self.assertEqual(l.ciclo(1_001_300.0), 90)   # novo episódio: nova linha
        self.assertEqual(saida.getvalue().count('"limitado"'), 2)

    def test_outros_erros_esperam_dobrando_e_zeram_a_sessao(self):
        l = self.leitor()
        l.mcp.falha = RuntimeError("MCP respondeu HTTP 502")
        with contextlib.redirect_stdout(io.StringIO()):
            esperas = [l.ciclo(1_000_000.0 + i) for i in range(6)]
        self.assertEqual(esperas, [30, 60, 120, 240, 300, 300])
        self.assertIsNone(l.mcp.sessao)
        l.mcp.falha = None
        self.assertAlmostEqual(l.ciclo(1_000_100.0), 2 * 86400 / 3000)   # sucesso volta ao ritmo normal
        l.mcp.falha = RuntimeError("de novo")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(l.ciclo(1_000_200.0), 30)


CANAL = "11111111-2222-4333-8444-555555555555"   # o de ORG_URL, fictício
CONVERSA = {"notice": "Text inside untrusted_text fields was written in agentes.chat by agents or people.",
            "channel_id": CANAL, "thread_id": None, "messages": [
                {"id": "aaaaaaaa-0000-4000-8000-000000000001", "author": {"kind": "person", "name": "Maria Exemplo"},
                 "sent_at": "2026-01-15T13:00:00.000Z", "untrusted_text": "Oi\r\nPode ver?", "truncated": False,
                 "attachments": [{"name": "contrato.pdf", "url": "https://arquivos.exemplo/contrato.pdf"}]},
                {"id": "aaaaaaaa-0000-4000-8000-000000000002", "author": {"kind": "agent", "name": "Pixel‮"},
                 "sent_at": "2026-01-15T13:01:00Z", "untrusted_text": "<img src=x onerror=alert(1)> a‮b​c \ud83d fim",
                 "truncated": True, "attachments": []}]}   # fictícia


class Conversa(unittest.TestCase):
    """Contrato L: a conversa da tarefa atual, só a pedido, limpa, com cache e tetos."""
    class Mcp:
        def __init__(self, resposta):
            self.resposta, self.chamadas, self.sessao, self.falha, self.pedidos = resposta, [], "s", None, 0

        def iniciar(self, token):
            self.sessao = "s"

        def ferramenta(self, nome, args, token):
            self.chamadas.append((nome, dict(args)))
            if self.falha:
                raise self.falha
            return self.resposta

    def conversas(self, resposta=CONVERSA, trabalhos=None, token="t"):
        class Cred:
            def token(self):
                return token
        l = e.Leitor(Cred())
        l.mcp = self.Mcp(resposta)
        if trabalhos is None:
            trabalhos = e.resumir(AG, [{"run_id": "r1", "agent": {"id": "a1"}, "status": "waiting_input", "url": ORG_URL}])["trabalhos"]
        l.estado = {**l.estado, "agentes": e.resumir(AG, [])["agentes"], "trabalhos": trabalhos}
        return e.Conversas(l), l.mcp

    def test_sem_destino_valido_e_404_sem_chamar(self):
        url_ruim = f"https://app.agentes.chat/org/{e.ORG}/c/" + "-" * 36   # passa no URL_APP, não é UUID
        trabalhos = [{"agente_id": "a1", "url": url_ruim}, {"agente_id": "a2", "url": ""}]
        c, mcp = self.conversas(trabalhos=trabalhos)
        for agente in ("a1", "a2", "a9", "", "a" * 101, None):   # id ruim, sem url, desconhecido, vazio, longo demais
            self.assertEqual(c.ler(agente)[0], 404, agente)
        c, mcp2 = self.conversas(trabalhos=[])   # agente conhecido, sem trabalho
        self.assertEqual(c.ler("a1")[0], 404)
        self.assertEqual(mcp.chamadas + mcp2.chamadas, [])

    def test_le_o_canal_do_trabalho_limpa_e_nao_vaza_nada(self):
        c, mcp = self.conversas()
        st, r = c.ler("a1", agora=1_000_000.0)
        self.assertEqual(st, 200)
        self.assertEqual(mcp.chamadas, [("read_conversation", {"channel_id": CANAL, "limit": 20})])
        pessoa, agente = r["mensagens"]   # da mais antiga para a mais nova, como vem do MCP
        self.assertEqual(pessoa, {"autor": "pessoa", "hora": "2026-01-15T13:00:00.000Z", "texto": "Oi\nPode ver?",
                                  "cortado": False, "anexos": 1})   # sem nome de pessoa; anexo só como contagem
        self.assertEqual(agente, {"autor": "agente", "nome": "Pixel", "hora": "2026-01-15T13:01:00Z",
                                  "texto": "<img src=x onerror=alert(1)> abc  fim", "cortado": True, "anexos": 0})
        self.assertEqual((r["url"], r["atualizado"]), (ORG_URL, e._iso(1_000_000.0)))
        corpo = json.dumps(r, ensure_ascii=False)
        for vazou in ("aaaaaaaa", "notice", "untrusted", CANAL, "Maria", "contrato", "arquivos.exemplo", "‮", "​", "\r"):
            self.assertNotIn(vazou, corpo.replace(ORG_URL, ""), vazou)

    def test_limpeza_por_categoria_e_corte(self):
        self.assertEqual(e.limpa_texto("a‮b⁦c​d﻿e‏f\x00g\x1bh\ud83di\r\nj\tk\n", 100),
                         ("abcdefghi\njk\n", False))   # Cf, Cc (o \t também) e Cs saem; o \n fica
        self.assertEqual(e.limpa_texto("x" * 1501, 1500), ("x" * 1500, True))
        longa = {"messages": [{"author": {"kind": "agent", "name": "Pixel"}, "untrusted_text": "x" * 5000}]}
        m = e.resumir_conversa(longa, ORG_URL, 0)["mensagens"][0]
        self.assertEqual((len(m["texto"]), m["cortado"], m["hora"]), (1500, True, None))

    def test_resposta_tem_teto_de_30_kb_e_guarda_as_mais_novas(self):
        msgs = [{"author": {"kind": "agent", "name": "Pixel"}, "untrusted_text": str(i) + "😀" * 1500} for i in range(20)]
        r = e.resumir_conversa({"messages": msgs}, ORG_URL, 0)
        self.assertLessEqual(len(json.dumps(r, ensure_ascii=False).encode()), 30_000)
        self.assertTrue(r["mensagens"][-1]["texto"].startswith("19"))   # a mais nova ficou
        self.assertLess(len(r["mensagens"]), 20)

    def test_cache_de_60_s(self):
        c, mcp = self.conversas()
        c.ler("a1", agora=1_000_000.0)
        c.ler("a1", agora=1_000_059.0)
        self.assertEqual(len(mcp.chamadas), 1)
        c.ler("a1", agora=1_000_060.0)
        self.assertEqual(len(mcp.chamadas), 2)

    def test_tetos_por_minuto_e_por_dia_sem_chamar(self):
        c, mcp = self.conversas()
        t0 = 1_000_000.0
        for i in range(20):
            c.cache.clear()   # cada leitura vai ao MCP
            self.assertEqual(c.ler("a1", agora=t0 + i)[0], 200)
        c.cache.clear()
        self.assertEqual(c.ler("a1", agora=t0 + 30)[0], 429)   # a 21ª no minuto
        self.assertEqual(len(mcp.chamadas), 20)
        self.assertEqual(c.ler("a1", agora=t0 + 61)[0], 200)   # a janela andou
        c, mcp = self.conversas()
        c.chamadas.extend(t0 - 86000 + i * 400 for i in range(200))   # 200 no último dia, nenhuma no último minuto
        self.assertEqual(c.ler("a1", agora=t0)[0], 429)   # a 201ª no dia
        self.assertEqual(mcp.chamadas, [])

    def test_pausa_do_429_da_503_sem_chamar(self):
        c, mcp = self.conversas()
        c.leitor.pausa_ate = 1_000_100.0
        self.assertEqual(c.ler("a1", agora=1_000_000.0)[0], 503)
        self.assertEqual(mcp.chamadas, [])

    def test_429_do_agentes_chat_pausa_tambem_o_leitor(self):
        c, mcp = self.conversas()
        mcp.falha = e.Limitado("120")
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(c.ler("a1", agora=1_000_000.0)[0], 503)
        self.assertTrue(c.leitor.pausado(1_000_119.0))
        leitor_mcp = Orcamento.Mcp(AG, [])   # o leitor de fundo respeita a pausa: não chama o MCP até ela acabar
        c.leitor.mcp = leitor_mcp
        self.assertEqual(c.leitor.ciclo(1_000_030.0), 90)
        self.assertEqual((leitor_mcp.chamadas, c.leitor.foto()["erro"]), ([], e.PAUSA_429))
        self.assertAlmostEqual(c.leitor.ciclo(1_000_120.0), 2 * 86400 / 3000)   # acabou: lê de novo
        self.assertEqual(leitor_mcp.chamadas, ["list_agents", "list_recent_tasks"])

    def test_sem_token_e_erro_do_mcp(self):
        c, mcp = self.conversas(token=None)
        self.assertEqual(c.ler("a1")[0], 503)
        self.assertEqual(mcp.chamadas, [])
        for resposta in ({"sem": "messages"}, {"messages": ["texto solto"]}):   # formato inesperado
            c, mcp = self.conversas(resposta=resposta)
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(c.ler("a1")[0], 502)

    def test_log_nunca_leva_texto_da_conversa(self):
        c, mcp = self.conversas()
        mcp.falha = RuntimeError("read_conversation: Maria Exemplo disse o segredo")
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            self.assertEqual(c.ler("a1")[0], 502)
        self.assertIn('"conversa"', saida.getvalue())
        self.assertNotIn("segredo", saida.getvalue())
        self.assertNotIn("Maria", saida.getvalue())

    def test_cliente_mcp_faz_uma_chamada_por_vez(self):
        dentro, maximo, trava = [0], [0], threading.Lock()

        def abrir(req):
            with trava:
                dentro[0] += 1
                maximo[0] = max(maximo[0], dentro[0])
            time.sleep(0.02)
            with trava:
                dentro[0] -= 1
            return 200, {}, b'{"jsonrpc":"2.0","id":1,"result":{}}'
        antes, e._abrir = e._abrir, abrir
        try:
            c = e.ClienteMCP(None)
            fios = [threading.Thread(target=c._rpc, args=("tools/list", {}, "t")) for _ in range(6)]
            fios += [threading.Thread(target=c.iniciar, args=("t",)) for _ in range(2)]
            for f in fios:
                f.start()
            for f in fios:
                f.join()
        finally:
            e._abrir = antes
        self.assertEqual((maximo[0], c.pedidos), (1, 10))


class PaginaConversas(unittest.TestCase):
    """Contrato P: a lista do dia sai da memória do servidor; a conversa, pelo id, com o corte do fim (A1)."""
    T = 1768482000.0   # 2026-01-15T13:00:00Z (10:00 em Brasília)
    OUTRO = "99999999-8888-4777-8666-555555555555"
    MSGS = {"messages": [{"author": {"kind": "person", "name": "X"}, "sent_at": "2026-01-15T13:00:00.000Z", "untrusted_text": "antes"},
                         {"author": {"kind": "agent", "name": "Pixel"}, "sent_at": "2026-01-15T13:01:29.999999999Z", "untrusted_text": "quase"},
                         {"author": {"kind": "agent", "name": "Pixel"}, "sent_at": "2026-01-15T10:01:30-03:00", "untrusted_text": "no limite"},
                         {"author": {"kind": "person", "name": "X"}, "sent_at": "2026-01-15T13:01:31Z", "untrusted_text": "depois"},
                         {"author": {"kind": "person", "name": "X"}, "untrusted_text": "sem hora"},
                         {"author": {"kind": "person", "name": "X"}, "sent_at": "٢٠٢٦-01-15T13:00:00Z", "untrusted_text": "hora árabe"}]}

    @staticmethod
    def tarefa(rid, status, ag="a1", canal=CANAL, inicio="2026-01-15T12:00:00Z"):
        return {"run_id": rid, "agent": {"id": ag}, "status": status, "url": f"https://app.agentes.chat/org/{e.ORG}/c/{canal}",
                "started_at": inicio, "label": "Post do dia"}

    @staticmethod
    def leitura(mem, tarefas, agora, completa=True):
        return mem.atualizar(e.normalizar(AG, tarefas)[1], {}, completa, agora)

    def conversas(self, foto, resposta=None):
        class Cred:
            def token(self):
                return "t"
        l = e.Leitor(Cred())
        l.mcp, l.conversas = Conversa.Mcp(resposta or self.MSGS), foto
        return e.Conversas(l), l.mcp

    def id_de(self, foto, agente):
        return next(it["id"] for it in foto["por_id"].values() if it["agente_id"] == agente)

    def test_a1_terminada_so_ate_o_fim_e_viva_do_mesmo_canal_tudo(self):
        mem = e.ConversasDoDia()
        self.leitura(mem, [self.tarefa("r1", "running"), self.tarefa("r2", "running", "a2")], self.T)
        foto = self.leitura(mem, [self.tarefa("r2", "running", "a2")], self.T + 30)   # a r1 terminou às 13:00:30
        c, mcp = self.conversas(foto)
        st, r = c.ler_id(self.id_de(foto, "a1"), agora=self.T + 100)
        self.assertEqual((st, [m["texto"] for m in r["mensagens"]], r["ate"]),
                         (200, ["antes", "quase", "no limite"], "2026-01-15T13:01:30Z"))
        st, r = c.ler_id(self.id_de(foto, "a2"), agora=self.T + 101)   # viva, mesmo canal: tudo, do mesmo cache
        self.assertEqual((st, len(r["mensagens"]), r["ate"]), (200, 6, None))
        self.assertEqual(len(mcp.chamadas), 1)
        self.assertIsNone(e.HORA_OK.fullmatch("٢٠٢٦-01-15T13:00:00Z"))   # A9: dígito de outra escrita não é hora

    class McpPorDestino(Conversa.Mcp):
        """Uma resposta para a thread e outra para o canal, como no agentes.chat."""
        def ferramenta(self, nome, args, token):
            self.chamadas.append((nome, dict(args)))
            return self.resposta["thread_id" if "thread_id" in args else "channel_id"]

    def item_com_thread(self, terminou):
        url = f"https://app.agentes.chat/org/{e.ORG}/c/{CANAL}?m={M}"
        mem = e.ConversasDoDia()
        foto = mem.atualizar(e.normalizar(AG, [{**self.tarefa("r1", "running"), "url": url}])[1], {}, True, self.T)
        if terminou:
            foto = mem.atualizar([], {}, True, self.T + 30)
        return foto, self.id_de(foto, "a1")

    def msg(self, autor, seg, texto):
        return {"author": {"kind": autor, "name": "Pixel" if autor == "agent" else "X"}, "sent_at": e._iso(self.T + seg),
                "untrusted_text": texto}

    def test_r0_le_pela_thread_do_run_com_a1_e_m2(self):
        # o R0 mostrou que o envio cai na thread do run (?m=) e o agente responde nela: a leitura do canal não via
        foto, item = self.item_com_thread(terminou=True)   # terminou em T + 30: o A1 corta em T + 90
        thread = {"messages": [self.msg("agent", 0, "raiz"), self.msg("person", 300, "enviada"), self.msg("agent", 304, "resposta")]}
        c, _ = self.conversas(foto)
        c.leitor.mcp = mcp = self.McpPorDestino({"thread_id": thread, "channel_id": self.MSGS})
        st, r = c.ler_id(item, agora=self.T + 400)
        self.assertEqual((st, [m["texto"] for m in r["mensagens"]]), (200, ["raiz"]))   # terminada sem envio: A1
        self.assertEqual(mcp.chamadas, [("read_conversation", {"thread_id": M, "limit": 20})])   # só a thread
        c.leitor.marcar_respondido(item, self.T + 400)   # M2: o escritório mandou nela
        self.assertEqual([m["texto"] for m in c.ler_id(item, agora=self.T + 401)[1]["mensagens"]], ["raiz", "enviada", "resposta"])
        self.assertEqual(len(mcp.chamadas), 1)   # do cache
        self.assertNotIn(M, json.dumps(r).replace(r["url"], ""))   # a thread só sai dentro da url do item

    def test_r0_thread_so_com_a_raiz_le_o_canal_se_couber_no_teto(self):
        # conversa direta sem envio pelo escritório: tudo solto no canal, e a thread do run só tem a raiz
        foto, item = self.item_com_thread(terminou=False)
        respostas = {"thread_id": {"messages": [self.msg("agent", 0, "raiz")]}, "channel_id": self.MSGS}
        c, _ = self.conversas(foto)
        c.leitor.mcp = mcp = self.McpPorDestino(respostas)
        st, r = c.ler_id(item, agora=self.T + 100)
        self.assertEqual((st, len(r["mensagens"]), r["mensagens"][0]["texto"]), (200, 6, "antes"))
        self.assertEqual([list(a)[0] for _, a in mcp.chamadas], ["thread_id", "channel_id"])
        self.assertEqual(len(c.chamadas), 2)   # as duas contam nos tetos
        c.cache.clear(); c.chamadas.clear(); mcp.chamadas.clear()
        c.chamadas.extend([self.T + 100] * 19)   # a thread é a 20ª do minuto: o canal não cabe
        st, r = c.ler_id(item, agora=self.T + 101)
        self.assertEqual((st, [m["texto"] for m in r["mensagens"]]), (200, ["raiz"]))
        self.assertEqual([list(a)[0] for _, a in mcp.chamadas], ["thread_id"])
        for vazia in ([], ["só a raiz"]):   # sem nenhuma mensagem também vai ao canal
            c, _ = self.conversas(foto)
            c.leitor.mcp = mcp = self.McpPorDestino({**respostas, "thread_id": {"messages": [self.msg("agent", 0, t) for t in vazia]}})
            self.assertEqual(len(c.ler_id(item, agora=self.T + 200)[1]["mensagens"]), 6)
            self.assertEqual(len(mcp.chamadas), 2)

    def test_instante_no_python_310(self):
        # o README pede Python 3.10+, cujo fromisoformat recusa "Z" e fração que não tenha 3 ou 6 dígitos: emulado aqui
        class Estrito310(e.datetime.datetime):
            @classmethod
            def fromisoformat(cls, txt):
                if not re.fullmatch(r"[0-9-]{10}T[0-9:]{8}(\.([0-9]{3}|[0-9]{6}))?([+-][0-9]{2}:[0-9]{2})?", txt):
                    raise ValueError(f"Invalid isoformat string: {txt!r}")
                return super().fromisoformat(txt)
        antes = e.datetime
        e.datetime = type("datetime310", (), {"datetime": Estrito310, "timezone": antes.timezone, "timedelta": antes.timedelta})
        try:
            for hora, esperado in (("2026-01-15T13:00:00Z", self.T), ("2026-01-15T13:00:00.000Z", self.T),
                                   ("2026-01-15T13:00:00.123456789Z", self.T + 0.123456), ("2026-01-15T13:00:00.5Z", self.T + 0.5),
                                   ("2026-01-15T10:00:00-03:00", self.T), ("2026-01-15T13:00:00.250000+00:00", self.T + 0.25)):
                self.assertAlmostEqual(e.instante(hora), esperado, places=5, msg=hora)
            for ruim in ("2026-01-15 13:00:00Z", "2026-01-15T13:00:00", "٢٠٢٦-01-15T13:00:00Z"):
                with self.assertRaises(ValueError):
                    e.instante(ruim)
        finally:
            e.datetime = antes

    def test_mudanca_vale_a_partir_da_publicacao_e_foto_nao_muda_depois(self):
        tarefas = [self.tarefa("r1", "running")]

        class Mcp:
            sessao, pedidos = "s", 0

            def ferramenta(self, nome, args, token):
                self.pedidos += 1
                return {"agents": AG} if nome == "list_agents" else {"tasks": list(tarefas)}

        class Cred:
            def token(self):
                return "t"
        l = e.Leitor(Cred())
        l.mcp = Mcp()
        relogio = iter([100.0, 107.0])   # o ciclo levou 7 s entre o começo e a publicação
        l.relogio = lambda: next(relogio)
        l.ciclo(self.T)
        l.relogio = time.monotonic
        self.assertEqual(l.conversas_do_dia()["mudou"][CANAL], self.T + 7)   # BAIXO 1: o instante da publicação
        c, mcp = e.Conversas(l), Conversa.Mcp(self.MSGS)
        l.mcp, item = mcp, self.id_de(l.conversas_do_dia(), "a1")
        c.ler_id(item, agora=self.T + 3)   # lida durante o ciclo: pode ser de antes da mudança
        c.ler_id(item, agora=self.T + 20)
        self.assertEqual(len(mcp.chamadas), 2)
        foto = l.conversas_do_dia()
        copia = json.dumps(foto, sort_keys=True)
        l.mcp = Mcp()   # A6: os ciclos seguintes publicam fotos novas, sem tocar na que já saiu
        for leitura in ([self.tarefa("r1", "waiting_input")], [], [self.tarefa("r2", "running", "a2")]):
            tarefas[:] = leitura
            l.ciclo(self.T + 30)
        self.assertEqual(json.dumps(foto, sort_keys=True), copia)
        self.assertIsNot(l.conversas_do_dia(), foto)

    def test_a2_um_item_por_canal_e_agente_com_a_regra_de_peso(self):
        foto = self.leitura(e.ConversasDoDia(), [self.tarefa("r1", "waiting_input", inicio="2026-01-15T10:00:00Z"),
                                                 self.tarefa("r2", "running", "a2", inicio="2026-01-15T11:00:00Z")], self.T)
        lista = e.conversas_publicas(foto, self.T)
        self.assertEqual([(c["agente_id"], c["status"]) for c in lista], [("a1", "waiting_input"), ("a2", "running")])
        foto = self.leitura(e.ConversasDoDia(), [self.tarefa("r1", "waiting_input", inicio="2026-01-15T10:00:00Z"),
                                                 self.tarefa("r2", "running", inicio="2026-01-15T11:00:00Z")], self.T)
        self.assertEqual([(c["run_id"], c["status"]) for c in e.conversas_publicas(foto, self.T)], [("r1", "waiting_input")])

    def test_a3_id_estavel_aleatorio_e_404_sem_chamar(self):
        mem = e.ConversasDoDia()
        ids = [self.id_de(self.leitura(mem, tarefas, self.T + i * 30), "a1")
               for i, tarefas in enumerate(([self.tarefa("r1", "running")], [self.tarefa("r2", "running")], []))]
        foto = self.leitura(mem, [self.tarefa("r3", "waiting_input")], self.T + 90)   # a terminada volta a viva
        ids.append(self.id_de(foto, "a1"))
        self.assertEqual(len(set(ids)), 1)
        self.assertTrue(e.ID_CONVERSA.fullmatch(ids[0]))
        self.assertEqual([(c["run_id"], c["status"], c["terminou_em"]) for c in e.conversas_publicas(foto, self.T + 90)],
                         [("r3", "waiting_input", None)])
        reinicio = self.leitura(e.ConversasDoDia(), [self.tarefa("r3", "waiting_input")], self.T + 120)   # Leitor novo
        c, mcp = self.conversas(reinicio)
        for ruim in (ids[0], "curto", "a" * 11 + "!", "../../etc/pa", "A" * 12, "", None, 12, ["x"]):
            self.assertEqual(c.ler_id(ruim, agora=self.T + 130)[0], 404, ruim)
        self.assertEqual(mcp.chamadas, [])
        self.assertEqual(c.ler_id(self.id_de(reinicio, "a1"), agora=self.T + 130)[0], 200)

    def test_a5_cache_vale_so_se_mais_novo_que_a_mudanca_no_canal(self):
        mem = e.ConversasDoDia()
        tarefas = [self.tarefa("r1", "running"), self.tarefa("r2", "running", "a2", self.OUTRO)]
        foto = self.leitura(mem, tarefas, self.T)
        c, mcp = self.conversas(foto)
        um, dois = self.id_de(foto, "a1"), self.id_de(foto, "a2")
        c.ler_id(um, agora=self.T + 100); c.ler_id(dois, agora=self.T + 100)
        c.leitor.conversas = self.leitura(mem, [self.tarefa("r1", "waiting_input"), tarefas[1]], self.T + 110)   # mudou o canal 1
        c.ler_id(um, agora=self.T + 120)    # cache de antes da mudança: lê de novo
        c.ler_id(dois, agora=self.T + 120)  # o outro canal não mudou: cache
        c.ler_id(um, agora=self.T + 125)    # sem mudança nova: cache
        self.assertEqual([a["channel_id"] for _, a in mcp.chamadas], [CANAL, self.OUTRO, CANAL])

    def test_a7_virada_do_dia_conferida_no_pedido(self):
        fim = 1768531800.0   # 2026-01-15 23:50 em Brasília
        mem = e.ConversasDoDia()
        self.leitura(mem, [self.tarefa("r1", "running")], fim - 60)
        foto = self.leitura(mem, [], fim)   # e o Leitor para (pausa): nenhum ciclo depois
        c, mcp = self.conversas(foto)
        self.assertEqual(len(e.conversas_publicas(foto, fim + 300)), 1)   # 23:55
        self.assertEqual(e.conversas_publicas(foto, fim + 900), [])        # 00:05
        self.assertEqual(c.ler_id(self.id_de(foto, "a1"), agora=fim + 900)[0], 404)
        self.assertEqual(mcp.chamadas, [])

    def test_a8_teto_so_nas_terminadas_e_leitura_incompleta(self):
        canal = lambda i: f"{i:08x}-2222-4333-8444-555555555555"
        mem = e.ConversasDoDia()
        for i in range(51):
            self.leitura(mem, [self.tarefa(f"r{i}", "running", canal=canal(i))], self.T + i * 2)
            foto = self.leitura(mem, [], self.T + i * 2 + 1)
        self.assertEqual(sorted(it["run_id"] for it in foto["por_id"].values()), sorted(f"r{i}" for i in range(1, 51)))   # saiu a r0
        mem = e.ConversasDoDia()
        vivas = [self.tarefa(f"r{i}", "running", canal=canal(i)) for i in range(60)]
        self.leitura(mem, vivas, self.T)
        foto = self.leitura(mem, [], self.T + 30, completa=False)   # parou no teto de páginas: ninguém termina
        self.assertEqual([it["terminou_em"] for it in foto["por_id"].values()], [None] * 60)
        foto = self.leitura(mem, [self.tarefa("r9", "running", canal="x" * 36)], self.T + 60, completa=False)   # canal fora do UUID
        self.assertEqual(len(foto["por_id"]), 60)

    def test_a9_teto_do_dia_vai_ao_log_uma_vez_por_episodio(self):
        foto = self.leitura(e.ConversasDoDia(), [self.tarefa("r1", "running")], self.T)
        c, mcp = self.conversas(foto)
        item, saida = self.id_de(foto, "a1"), io.StringIO()
        with contextlib.redirect_stdout(saida):
            c.chamadas.extend(self.T - 86000 + i * 400 for i in range(200))
            r1, r2 = c.ler_id(item, agora=self.T), c.ler_id(item, agora=self.T + 1)
            self.assertEqual(c.ler_id(item, agora=self.T + 86400)[0], 200)   # a janela andou: o episódio acabou
            c.cache.clear()
            c.chamadas.extend([self.T + 86401] * 199)
            r3 = c.ler_id(item, agora=self.T + 86402)
        self.assertEqual([r1[0], r2[0], r3[0]], [429, 429, 429])
        self.assertEqual(r1[1], {"erro": "acabou o limite de leituras de conversa de hoje; ele volta aos poucos"})
        self.assertEqual(saida.getvalue().count('"resultado": "teto_dia"'), 2)
        self.assertNotIn("Post", saida.getvalue())

    def test_um_dia_de_pagina_aberta_cabe_no_orcamento(self):
        # das 9h às 19h, uma tarefa por hora no mesmo canal (começa, pergunta, volta, termina); a página fica aberta
        # nela, relê a cada mudança vista no /api/estado (10 s) e a pessoa clica em "Atualizar" a cada 5 min
        T0 = 1768446000.0   # 2026-01-15 00:00 em Brasília
        sim = self

        class Mcp:
            sessao, pedidos, por_nome = "s", 0, collections.Counter()

            def iniciar(self, token):
                pass

            def ferramenta(self, nome, args, token):
                self.pedidos += 1; self.por_nome[nome] += 1
                if nome == "list_agents":
                    return {"agents": AG}
                if nome == "read_conversation":
                    return sim.MSGS
                h, m = divmod(int(agora - T0) // 60, 60)
                status = "running" if m < 20 or 35 <= m < 50 else "waiting_input" if m < 35 else None
                return {"tasks": [sim.tarefa(f"r{h}", status)] if 9 <= h < 19 and status else []}

        class Cred:
            def token(self):
                return "t"
        l = e.Leitor(Cred())
        l.mcp, c = Mcp(), e.Conversas(l)
        visto, aberto, proximo, respostas = None, None, T0, collections.Counter()
        with contextlib.redirect_stdout(io.StringIO()):
            for passo in range(8640):
                agora = T0 + passo * 10
                if agora >= proximo:
                    proximo = agora + l.ciclo(agora)
                lista = e.conversas_publicas(l.conversas_do_dia(), agora)
                if lista and 9 * 3600 <= agora - T0 < 19 * 3600:
                    aberto = aberto or lista[0]["id"]
                    item = next(x for x in lista if x["id"] == aberto)
                    agora_visto = (item["run_id"], item["status"])
                    if agora_visto != visto or passo % 30 == 7:   # releitura na mudança ou "Atualizar" (5 min, fora do compasso)
                        respostas[c.ler_id(aberto, agora=agora)[0]] += 1
                        visto = agora_visto
        self.assertEqual(set(respostas), {200})   # nenhum 429 num dia normal
        self.assertLessEqual(l.mcp.por_nome["read_conversation"], 200)
        self.assertLessEqual(l.mcp.por_nome["list_recent_tasks"] + l.mcp.por_nome["list_agents"], e.ORCAMENTO_DIA)


class Surrogate(unittest.TestCase):
    """Um rótulo cortado no meio de um emoji ("\\ud83d") é JSON válido e não pode derrubar a página nem o log."""
    def test_log_com_surrogate_nao_quebra(self):
        saida = io.TextIOWrapper(io.BytesIO(), encoding="utf-8")   # como o stdout do serviço: UTF-8 estrito
        with contextlib.redirect_stdout(saida):
            e.log(evento="leitura", resultado="erro", detalhe="Lendo \ud83d")
        saida.flush()
        self.assertIn(b'"Lendo ?"', saida.buffer.getvalue())


class Credenciais(unittest.TestCase):
    def test_estado_desconhecido_e_recusado(self):
        with tempfile.TemporaryDirectory() as d:
            c = e.Credenciais(os.path.join(d, "oauth.json"))
            c.dados = {"client_id": "c"}
            with self.assertRaises(ValueError):
                c.concluir("codigo", "estado-que-nao-existe")

    def test_escopo_aceito_pelo_pedido(self):   # R1-b
        ok = [("read", "read", "read"), ("read", "read write", "read"), ("read write", "read write", "read write"),
              ("write read", "read write", "read write"), (None, "read", "read"), ("", "read write", "read write")]
        for concedido, pedido, esperado in ok:   # sem escopo na resposta, vale o pedido (RFC 6749 §5.1)
            tok = {} if concedido is None else {"scope": concedido}
            self.assertEqual(e.escopo_aceito(tok, pedido), esperado, (concedido, pedido))
        for concedido, pedido in (("read write", "read"), ("read manage", "read write"), ("read write manage", "read write"),
                                  ("read admin", "read"), ("write", "read write"), ("manage", "read")):
            with self.assertRaises(e.EscopoRecusado, msg=(concedido, pedido)):
                e.escopo_aceito({"scope": concedido}, pedido)


class OAuthFalso(ThreadingHTTPServer):
    """Login do agentes.chat de mentira: registro, token e revogação, com respostas configuráveis."""
    daemon_threads = True

    def __init__(self):
        super().__init__(("127.0.0.1", 0), PaginaOAuth)
        self.registros, self.trocas, self.revogados = [], [], []
        self.token = (200, {"access_token": "AC-novo", "refresh_token": "RF-novo", "expires_in": 3600, "scope": "read write"})
        self.revoga = 200
        self.registro = 201   # 400: o registro recusa o endereço de retorno


class PaginaOAuth(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        corpo = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        srv = self.server
        if self.path == "/api/oauth/register":
            srv.registros.append(json.loads(corpo))
            st, obj = srv.registro, {"client_id": f"cliente-{len(srv.registros)}"}
            if st >= 300:
                obj = {"error": "invalid_redirect_uri", "error_description": "<script>x</script> evil.example"}
        elif self.path == "/api/oauth/token":
            srv.trocas.append({k: v[0] for k, v in urllib.parse.parse_qs(corpo.decode()).items()})
            st, obj = srv.token
        elif self.path == "/api/oauth/revoke":
            f = {k: v[0] for k, v in urllib.parse.parse_qs(corpo.decode()).items()}
            srv.revogados.append((f.get("token"), f.get("token_type_hint"), f.get("client_id")))
            st, obj = srv.revoga, {}
        else:
            st, obj = 404, {}
        dados = json.dumps(obj).encode()
        self.send_response(st)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)


class R1(unittest.TestCase):
    """R1: escopo pelo modo, cliente pendente, rebaixamento (R1-c), renovação (R1-d) e revogação, contra um OAuth falso."""
    LEITURA = {"client_id": "cliente-leitura", "redirect_uri": None, "access_token": "AC-leitura", "refresh_token": "RF-leitura",
               "expira": 0, "escopo": "read"}

    def setUp(self):
        self.oauth = OAuthFalso()
        threading.Thread(target=self.oauth.serve_forever, daemon=True).start()
        self.antes = e.EMISSOR, e.TIMES
        self.pasta = tempfile.mkdtemp(prefix="escritorio-r1-")
        e.EMISSOR, e.TIMES = "http://127.0.0.1:%d" % self.oauth.server_address[1], os.path.join(self.pasta, "times.json")
        self.saida = io.StringIO()
        self.log = contextlib.redirect_stdout(self.saida)
        self.log.__enter__()

    def tearDown(self):
        self.log.__exit__(None, None, None)
        for segredo in ("AC-", "RF-", "codigo-secreto"):   # o log nunca leva token nem código
            self.assertNotIn(segredo, self.saida.getvalue())
        e.EMISSOR, e.TIMES = self.antes
        self.oauth.shutdown()
        shutil.rmtree(self.pasta, ignore_errors=True)

    def times(self, conteudo):
        with open(e.TIMES, "w", encoding="utf-8") as f:
            f.write(conteudo if isinstance(conteudo, str) else json.dumps(conteudo))

    def cred(self, dados=None, vence_em=3600):
        c = e.Credenciais(os.path.join(self.pasta, "oauth.json"))
        if dados is not None:
            c.dados = {**dados, "redirect_uri": c.redirect_uri(), "expira": time.time() + vence_em}
        return c

    def estado_de(self, url):
        q = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        return q["state"][0], q["client_id"][0], q["scope"][0]

    def test_registro_e_url_pelo_modo(self):
        self.times({"conversas": "responder"})
        estado, cliente, escopo = self.estado_de(self.cred().url_autorizacao())
        self.assertEqual((escopo, self.oauth.registros[0]["scope"], self.oauth.registros[0]["client_name"]),
                         ("read write", "read write", "Escritório dos agentes"))   # sem "(leitura)" na tela de consentimento
        self.times({"conversas": "ler"})
        c = self.cred()
        self.assertEqual(self.estado_de(c.url_autorizacao())[2], "read")
        self.assertEqual((self.oauth.registros[1]["scope"], self.oauth.registros[1]["client_name"]),
                         ("read", "Escritório dos agentes (leitura)"))
        self.times({"conversas": "responder"})   # o escopo mudou: registro novo
        c.url_autorizacao()
        self.assertEqual(len(self.oauth.registros), 3)

    def test_pendente_nao_mexe_na_leitura_e_reaproveita_o_cliente(self):   # R1-a
        self.times({"conversas": "responder"})
        c = self.cred(self.LEITURA)
        e1, cliente1, _ = self.estado_de(c.url_autorizacao())
        e2, cliente2, _ = self.estado_de(c.url_autorizacao())   # dois /oauth/conectar em 10 min: um registro só
        self.assertEqual((len(self.oauth.registros), cliente1, cliente2), (1, "cliente-1", "cliente-1"))
        self.assertEqual((c.token(), c.dados["client_id"]), ("AC-leitura", "cliente-leitura"))   # a leitura continua
        c.pendentes[e1]["em"] -= 601   # consentimento abandonado: o state venceu
        with self.assertRaises(ValueError):
            c.concluir("codigo-secreto", e1)
        self.assertEqual((c.token(), self.oauth.trocas), ("AC-leitura", []))

    def test_manage_concedido_revoga_os_recebidos_e_mantem_a_leitura(self):
        self.times({"conversas": "responder"})
        c = self.cred(self.LEITURA)
        estado, cliente, _ = self.estado_de(c.url_autorizacao())
        self.oauth.token = (200, {"access_token": "AC-demais", "refresh_token": "RF-demais", "scope": "read write manage"})
        with self.assertRaises(e.EscopoRecusado):
            c.concluir("codigo-secreto", estado)
        self.assertEqual(sorted(self.oauth.revogados), [("AC-demais", "access_token", cliente), ("RF-demais", "refresh_token", cliente)])
        self.assertEqual((c.token(), c.escopo()), ("AC-leitura", "read"))
        self.assertEqual(self.oauth.trocas[0]["client_id"], cliente)   # a troca usa o cliente do state, não o gravado

    def test_troca_certa_substitui_tudo_e_revoga_o_refresh_antigo(self):
        self.times({"conversas": "responder"})
        for revoga in (200, 503):   # uma falha na revogação não desfaz a conexão nova
            with self.subTest(revoga=revoga):
                self.oauth.revoga, self.oauth.revogados = revoga, []
                c = self.cred(self.LEITURA)
                estado, cliente, _ = self.estado_de(c.url_autorizacao())
                c.concluir("codigo-secreto", estado)
                self.assertEqual((c.dados["client_id"], c.dados["escopo_cliente"], c.escopo(), c.token()),
                                 (cliente, "read write", "read write", "AC-novo"))
                self.assertEqual(self.oauth.revogados, [("RF-leitura", "refresh_token", "cliente-leitura")])
                self.assertTrue(c.tem_escrita())
                with open(c.caminho, encoding="utf-8") as f:
                    self.assertEqual(json.load(f)["escopo"], "read write")

    def test_resposta_sem_token_nao_derruba_a_leitura(self):
        self.times({"conversas": "responder"})
        c = self.cred(self.LEITURA)
        estado, _, _ = self.estado_de(c.url_autorizacao())
        self.oauth.token = (200, {"scope": "read write"})
        with self.assertRaises(ValueError):
            c.concluir("codigo-secreto", estado)
        self.assertEqual(c.token(), "AC-leitura")
        estado, cliente, _ = self.estado_de(c.url_autorizacao())   # B3: tokens válidos numa resposta que não dá para gravar
        self.oauth.token = (200, {"access_token": "AC-ruim", "refresh_token": "RF-ruim", "expires_in": None, "scope": "read write"})
        with self.assertRaises(ValueError):
            c.concluir("codigo-secreto", estado)
        self.assertEqual(sorted(self.oauth.revogados), [("AC-ruim", "access_token", cliente), ("RF-ruim", "refresh_token", cliente)])
        self.assertEqual(c.token(), "AC-leitura")
        self.oauth.revogados = []   # na renovação: revoga o que veio e o erro é passageiro
        self.oauth.token = (200, {"access_token": "AC-ruim", "refresh_token": "RF-ruim", "expires_in": None, "scope": "read"})
        c = self.cred(self.LEITURA, vence_em=0)
        with self.assertRaises(RuntimeError):
            c.token()
        self.assertEqual(sorted(t for t, _, _ in self.oauth.revogados), ["AC-ruim", "RF-ruim"])
        self.assertEqual(c.dados["refresh_token"], "RF-leitura")

    def test_rebaixamento_so_com_o_modo_lido_sem_erro(self):   # R1-c
        escrita = {**self.LEITURA, "access_token": "AC-escrita", "refresh_token": "RF-escrita", "escopo": "read write"}
        for conteudo in (None, "{", '{"conversas": "ler"', "[]", '{"conversas": "sim"}', '{"times": 3}'):
            with self.subTest(times=conteudo):
                if os.path.exists(e.TIMES):
                    os.unlink(e.TIMES)
                if conteudo is not None:
                    self.times(conteudo)
                c = self.cred(escrita)
                self.assertEqual((c.token(), self.oauth.revogados), ("AC-escrita", []))   # ausente, inválido ou truncado
                self.assertFalse(e.carregar_times()["conversas"] == "responder")   # e o envio fica barrado de qualquer forma
        for modo in ({"conversas": "ler"}, {"conversas": "desligado"}, {}, {"times": []}):   # B2: válido sem a chave
            with self.subTest(modo=modo):
                self.oauth.revogados = []
                self.times(modo)
                c = self.cred(escrita)
                self.assertIsNone(c.token())
                self.assertEqual(sorted(self.oauth.revogados), [("AC-escrita", "access_token", "cliente-leitura"),
                                                                ("RF-escrita", "refresh_token", "cliente-leitura")])
                self.assertNotIn("access_token", c.dados)
        self.assertEqual(self.saida.getvalue().count('"resultado": "rebaixado"'), 4)
        self.times({"conversas": "responder"})
        self.assertEqual(self.cred(escrita).token(), "AC-escrita")

    def test_renovacao_so_400_ou_401_desconecta(self):   # R1-d
        self.times({"conversas": "ler"})
        for st in (400, 401):
            with self.subTest(http=st):
                self.oauth.token = (st, {"error": "invalid_grant"})
                c = self.cred(self.LEITURA, vence_em=0)
                self.assertIsNone(c.token())
                self.assertNotIn("refresh_token", c.dados)
        for st in (429, 500, 503):
            with self.subTest(http=st):
                self.oauth.token = (st, {})
                c = self.cred(self.LEITURA, vence_em=0)
                with self.assertRaises(RuntimeError):
                    c.token()
                self.assertEqual(c.dados["refresh_token"], "RF-leitura")   # passageiro: os tokens ficam
        c = self.cred(self.LEITURA, vence_em=0)
        e.EMISSOR = "http://127.0.0.1:%d" % porta_livre()   # erro de rede
        with self.assertRaises(OSError):
            c.token()
        self.assertEqual(c.dados["refresh_token"], "RF-leitura")

    def test_renovacao_nunca_amplia(self):
        self.times({"conversas": "responder"})
        self.oauth.token = (200, {"access_token": "AC-maior", "refresh_token": "RF-maior", "scope": "read write"})
        c = self.cred(self.LEITURA, vence_em=0)   # gravado: só leitura
        self.assertIsNone(c.token())
        self.assertEqual(sorted(t for t, _, _ in self.oauth.revogados), ["AC-maior", "RF-maior"])
        self.assertNotIn("access_token", c.dados)
        self.oauth.token = (200, {"access_token": "AC-igual", "expires_in": 3600})   # sem escopo: vale o gravado
        c = self.cred(self.LEITURA, vence_em=0)
        self.assertEqual((c.token(), c.escopo(), c.dados["refresh_token"]), ("AC-igual", "read", "RF-leitura"))


def porta_livre():
    with socket.socket() as k:
        k.bind(("127.0.0.1", 0))
        return k.getsockname()[1]


HOSTIL = "<script>alert(1)</script> entre em evil.example"   # o que o agentes.chat poderia mandar de ruim


class ConexaoLeitor(unittest.TestCase):
    """C1.1 a C1.3: o "conexao" do /api/estado sai do resultado da leitura; 401, 402 e 403 viram "recusada", com o
    código e a mensagem nossa, e esperam como as falhas; o acordar() tira a leitura da espera."""
    def leitor(self, token="t"):
        class Cred:
            def token(self):
                return token
        l = e.Leitor(Cred())
        l.mcp = Orcamento.Mcp(AG, [])
        return l

    def test_cada_resultado_da_leitura_vira_um_estado(self):
        l = self.leitor(None)
        self.assertEqual(l.foto()["conexao"], "carregando")   # antes da primeira leitura
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(l.ciclo(1_000_000.0), e.INTERVALO)   # sem token: nada sai para o agentes.chat
        self.assertEqual((l.foto()["conexao"], l.foto()["erro"]), ("sem_conexao", e.SEM_CONEXAO))
        l = self.leitor()
        l.ciclo(1_000_000.0)
        self.assertEqual((l.foto()["conexao"], l.foto()["erro"], len(l.foto()["agentes"])), ("conectado", None, 2))
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            l.mcp.falha = e.PermissaoNegada(e.texto_recusa(403), 403)
            esperas = [l.ciclo(1_000_100.0 + i) for i in range(4)]
            self.assertEqual(esperas, [30, 60, 120, 240])   # recusada: espera crescente, e não os 30 s de sempre
            self.assertEqual((l.foto()["conexao"], len(l.foto()["agentes"])), ("recusada", 2))   # a última leitura fica
            self.assertIn("HTTP 403", l.foto()["erro"])
            self.assertIsNone(l.mcp.sessao)   # a próxima tentativa começa uma sessão nova
            l.mcp.falha = e.Limitado("60")
            l.ciclo(1_000_200.0)
            self.assertEqual(l.foto()["conexao"], "pausa")
            self.assertEqual(l.ciclo(1_000_210.0), 50)   # a pausa continua valendo, sem chamar o MCP
            l.pausa_ate, l.mcp.falha = 0, OSError("rede")
            l.ciclo(1_000_300.0)
            self.assertEqual((l.foto()["conexao"], l.foto()["erro"]), ("falha", e.FALHA_LEITURA))
            l.mcp.falha = None
            l.ciclo(1_000_400.0)
        self.assertEqual(l.foto()["conexao"], "conectado")
        self.assertIn('"resultado": "recusada", "http": 403', saida.getvalue())

    def test_mcp_401_402_403_com_codigo_e_sem_o_corpo_de_fora(self):
        antes = e._abrir
        try:
            for st in (401, 402, 403):
                e._abrir = lambda req, st=st: (st, {}, HOSTIL.encode())
                with self.assertRaises(e.PermissaoNegada) as x:
                    e.ClienteMCP(None)._post({"jsonrpc": "2.0", "id": 1, "method": "tools/call"}, "t")
                self.assertEqual(x.exception.http, st)
                self.assertIn(f"HTTP {st}", str(x.exception))
                self.assertNotIn("evil", str(x.exception))
            for st in (500, 400):   # controle: o resto continua falha de rede ou de MCP, e não recusa
                e._abrir = lambda req, st=st: (st, {}, b"")
                with self.assertRaises(RuntimeError) as x:
                    e.ClienteMCP(None)._post({"jsonrpc": "2.0", "id": 1, "method": "tools/call"}, "t")
                self.assertNotIsInstance(x.exception, e.PermissaoNegada)
        finally:
            e._abrir = antes

    def test_acordar_tira_a_leitura_da_espera(self):
        class Leitor(e.Leitor):
            def ciclo(self, agora=None):
                self.voltas.append(time.monotonic())
                return 3600
        l = Leitor(None)
        l.voltas = []
        l.start()

        def espera(n, segundos):   # até a n-ésima leitura, ou o tempo acabar
            fim = time.monotonic() + segundos
            while len(l.voltas) < n and time.monotonic() < fim:
                time.sleep(0.01)
        espera(1, 5)
        espera(2, 0.3)
        self.assertEqual(len(l.voltas), 1)   # controle: sem o acordar(), a segunda leitura espera a hora inteira
        l.acordar()
        espera(2, 5)
        self.assertEqual(len(l.voltas), 2)
        espera(3, 0.3)
        self.assertEqual(len(l.voltas), 2)   # um acordar() vale uma leitura só


class Conectar(unittest.TestCase):
    """C1.5 e C1.6: o /oauth/conectar e o /oauth/retorno de verdade contra o OAuth falso. Cada erro vira a página
    aviso.html com texto nosso, sem o error_description nem o corpo que veio; a volta certa acorda o leitor."""
    @classmethod
    def setUpClass(cls):
        class Leitor:
            acordou = 0

            def foto(self):
                return {**e.resumir(AG, []), "atualizado": None, "erro": None, "conexao": "sem_conexao"}

            def acordar(self):
                self.acordou += 1
        cls.pasta = tempfile.mkdtemp(prefix="escritorio-conectar-")
        cls.oauth = OAuthFalso()
        threading.Thread(target=cls.oauth.serve_forever, daemon=True).start()
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor, cls.srv.acesso = Leitor(), Acesso(cls.pasta)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        with open(os.path.join(cls.pasta, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.oauth.shutdown()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    def setUp(self):
        self.antes = e.BASE, e.EMISSOR, e.TIMES
        e.BASE, e.EMISSOR = self.base, "http://127.0.0.1:%d" % self.oauth.server_address[1]
        e.TIMES = os.path.join(self.pasta, "times.json")
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"conversas": "ler"}, f)
        self.srv.cred = e.Credenciais(os.path.join(self.pasta, "oauth.json"))
        self.oauth.registro, self.oauth.token = 201, (200, {"access_token": "AC-novo", "refresh_token": "RF-novo", "scope": "read"})
        self.saida = io.StringIO()
        self.log = contextlib.redirect_stdout(self.saida)
        self.log.__enter__()
        self.cab = Http.entrar(self)

    def tearDown(self):
        self.log.__exit__(None, None, None)
        for segredo in ("AC-", "RF-", "evil"):   # o log nunca leva token nem o texto que veio de fora
            self.assertNotIn(segredo, self.saida.getvalue())
        e.BASE, e.EMISSOR, e.TIMES = self.antes

    req = Http.req

    def pagina(self, rota, status):
        st, corpo, h = self.req(rota, self.cab)
        self.assertEqual((st, h["Content-Type"]), (status, "text/html; charset=utf-8"), rota)
        texto = corpo.decode()
        self.assertNotIn("evil", texto); self.assertNotIn("<script", texto)
        self.assertIn('href="/oauth/conectar"', texto); self.assertIn('href="/"', texto)
        return texto

    def conectar(self):
        st, _, h = self.req("/oauth/conectar", self.cab)
        self.assertEqual(st, 302)
        return urllib.parse.parse_qs(urllib.parse.urlsplit(h["Location"]).query)["state"][0]

    def test_volta_certa_conecta_e_acorda_o_leitor(self):
        antes = self.srv.leitor.acordou
        self.srv.jornal = e.Jornal(e.log, e.FUSO)   # com uma contagem da conta anterior
        self.addCleanup(delattr, self.srv, "jornal")
        self.srv.jornal.ler([("terminou", "agente-velho")], {"tarefas": []}, time.time())
        self.srv.avisos = avisos.Avisos("CHAVE", lambda endpoint, agora: "", e.log, e.FUSO)   # e um aviso da conta anterior
        self.addCleanup(delattr, self.srv, "avisos")
        self.srv.avisos.transicoes([("pediu_aprovacao", "agente-velho", "r-velho")], {"agentes": []}, time.time())
        estado = self.conectar()
        st, _, h = self.req(f"/oauth/retorno?code=codigo-secreto&state={estado}", self.cab)
        self.assertEqual((st, h["Location"]), (302, "/"))
        self.assertEqual(self.srv.jornal.publico(time.time(), {"agente-velho"})["semana"]["agentes"], [])   # zerado
        self.assertEqual(self.srv.avisos.publico(), {"aviso": None})
        self.assertEqual((self.srv.cred.token(), self.srv.leitor.acordou), ("AC-novo", antes + 1))
        texto = self.pagina(f"/oauth/retorno?code=codigo-secreto&state={estado}", 400)   # o mesmo state de novo
        self.assertIn("venceu (vale 10 minutos) ou já foi usado", texto)
        self.assertEqual(self.srv.leitor.acordou, antes + 1)   # a volta que falhou não acorda

    def test_registro_recusado_e_sem_rede(self):
        self.oauth.registro = 400
        texto = self.pagina("/oauth/conectar", 502)
        self.assertIn(f"recusou o endereço de retorno {self.base}/oauth/retorno", texto)
        for st, esperado in ((401, "recusou o registro do app (HTTP 401)"), (403, "(HTTP 403)"), (429, "pediu uma pausa")):
            self.oauth.registro = st   # outro 4xx não é o endereço: a página não pode apontar a causa errada
            texto = self.pagina("/oauth/conectar", 502)
            self.assertIn(esperado, texto, st)
            self.assertNotIn("endereço de retorno", texto, st)
        e.EMISSOR = "http://127.0.0.1:9"   # porta fechada: rede fora
        self.assertIn("alcança https://app.agentes.chat", self.pagina("/oauth/conectar", 502))
        self.srv.cred = None   # a prévia (sem credenciais) cai na mesma página
        self.assertIn("alcança https://app.agentes.chat", self.pagina("/oauth/conectar", 502))

    def test_troca_recusada_e_escopo_a_mais(self):
        for st in (400, 401):
            self.oauth.token = (st, {"error": "invalid_grant", "error_description": HOSTIL})
            texto = self.pagina(f"/oauth/retorno?code=codigo-secreto&state={self.conectar()}", 400)
            self.assertIn("não aceitou a autorização", texto)
        self.oauth.token = (500, {"error_description": HOSTIL})
        self.assertIn("(HTTP 500)", self.pagina(f"/oauth/retorno?code=codigo-secreto&state={self.conectar()}", 400))
        self.oauth.token = (200, {"access_token": "AC-demais", "refresh_token": "RF-demais", "scope": "read write manage"})
        texto = self.pagina(f"/oauth/retorno?code=codigo-secreto&state={self.conectar()}", 400)
        self.assertIn("acesso diferente do pedido", texto)
        self.assertIsNone(self.srv.cred.token())

    def test_error_do_consentimento_sem_a_descricao(self):
        desc = urllib.parse.quote(HOSTIL)
        texto = self.pagina(f"/oauth/retorno?error=access_denied&error_description={desc}&state=s", 400)
        self.assertIn("A autorização foi recusada.", texto)
        self.assertIn("(código: algo_novo)", self.pagina("/oauth/retorno?error=algo_novo", 400))
        for codigo in (urllib.parse.quote(HOSTIL), "Maiusculo", "x" * 41):   # fora de [a-z_]{1,40}: sem código
            texto = self.pagina(f"/oauth/retorno?error={codigo}", 400)
            self.assertIn("O agentes.chat recusou a conexão. Tente de novo.", texto)
            self.assertNotIn("código:", texto)
        self.assertIn('"codigo": "outro"', self.saida.getvalue())

    def test_entrar_por_outro_endereco_mostra_o_certo_sem_ecoar_o_origin(self):
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
        for rota in ("/entrar", "/primeiro-acesso"):
            st, html, h = self.req(rota, {"Origin": "https://outro-endereco.example"}, corpo)
            self.assertEqual((st, h["Content-Type"], h.get("Set-Cookie")), (403, "text/html; charset=utf-8", None), rota)
            self.assertIn(f"Abra pelo endereço configurado: {self.base}", html.decode())
            self.assertNotIn("outro-endereco", html.decode())
        self.assertEqual(self.req("/sair", {"Origin": "https://outro-endereco.example"}, b"")[1], "Origem não permitida.".encode())


class Rede(unittest.TestCase):
    """C1.7 e o ESCRITORIO_BIND: a BASE é só origem; 0.0.0.0 só com a BASE definida, e aí a porta é a do container."""
    def test_base_so_origem(self):
        for base in ("https://escritorio.exemplo.com", "https://escritorio.exemplo.com:8443", "http://127.0.0.1:7381"):
            self.assertIsNone(e.erro_rede(base, "127.0.0.1", 737, True), base)
        for base in ("https://escritorio.exemplo.com/", "https://escritorio.exemplo.com/app", "https://Escritorio.exemplo.com",
                     "HTTPS://escritorio.exemplo.com", "https://escritorio.exemplo.com:443", "http://127.0.0.1:80",
                     "https://escritorio.exemplo.com?x=1", "https://escritorio.exemplo.com#x", "https://eu@escritorio.exemplo.com",
                     "https://escritorio.exemplo.com:99999", "https://escritorio.exemplo.com:x", "ftp://escritorio.exemplo.com",
                     "escritorio.exemplo.com", "https://"):
            self.assertIn("só a origem", e.erro_rede(base, "127.0.0.1", 737, True) or "", base)
        self.assertIn("precisa ser https", e.erro_rede("http://escritorio.exemplo.com", "127.0.0.1", 737, True))

    def test_bind(self):
        self.assertIn("ESCRITORIO_BIND", e.erro_rede("https://escritorio.exemplo.com", "::", 737, True))
        self.assertIn("ESCRITORIO_BIND", e.erro_rede("https://escritorio.exemplo.com", "192.168.0.10", 737, True))
        self.assertIn("1024", e.erro_rede("https://escritorio.exemplo.com", "127.0.0.1", 7371, True))   # fora do container
        self.assertIsNone(e.erro_rede("https://escritorio.exemplo.com", "0.0.0.0", 7371, True))   # a porta é do container
        self.assertIsNone(e.erro_rede("http://127.0.0.1:7381", "0.0.0.0", 7371, True))   # teste local do container
        self.assertIn("defina ESCRITORIO_BASE", e.erro_rede("http://127.0.0.1:7371", "0.0.0.0", 7371, False))

    def test_main_recusa_antes_de_subir(self):
        antes = e.BASE, e.BIND, e.ORG
        try:
            for base, bind in (("https://escritorio.exemplo.com/", "127.0.0.1"), ("https://escritorio.exemplo.com", "0.0.0.1")):
                e.BASE, e.BIND, e.ORG = base, bind, ""   # sem org: numa regressão, para na org em vez de subir
                with self.assertRaises(SystemExit) as c:
                    e.main()
                self.assertNotIn("AGENTES_ORG", str(c.exception.code), base)
        finally:
            e.BASE, e.BIND, e.ORG = antes


class Configuracoes(unittest.TestCase):
    """P1.1: POST /api/clima e /api/festas no molde do /api/planta (Origin estrito, sessão, JSON, teto, tudo ou nada,
    rev) e a junção no /api/config: tela > times.json > padrão."""
    @classmethod
    def setUpClass(cls):
        class Clima:
            acordou = 0

            def acordar(self):
                self.acordou += 1

            def foto(self):
                return None
        cls.pasta = tempfile.mkdtemp(prefix="escritorio-config-")
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)

        class Leitor:
            def foto(self):
                return {**e.resumir(AG, []), "atualizado": None, "erro": None}
        cls.srv.leitor, cls.srv.cred, cls.srv.acesso, cls.srv.clima = Leitor(), None, Acesso(cls.pasta), Clima()
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        with open(os.path.join(cls.pasta, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    def setUp(self):
        self.antes = e.BASE, e.TIMES, e.ARQ_CLIMA, e.ARQ_FESTAS, e.ARQ_EQUIPE
        e.BASE, e.TIMES = self.base, os.path.join(self.pasta, "times.json")
        e.ARQ_CLIMA, e.ARQ_FESTAS = os.path.join(self.pasta, "clima.json"), os.path.join(self.pasta, "festas.json")
        e.ARQ_EQUIPE = os.path.join(self.pasta, "equipe.json")
        for arq in (e.ARQ_CLIMA, e.ARQ_FESTAS, e.ARQ_EQUIPE, e.TIMES):
            if os.path.exists(arq):
                os.unlink(arq)
        self.saida = io.StringIO()
        self.log = contextlib.redirect_stdout(self.saida)
        self.log.__enter__()
        self.cab = Http.entrar(self)
        self.js = {**self.cab, "Origin": self.base, "Content-Type": "application/json"}

    def tearDown(self):
        self.log.__exit__(None, None, None)
        self.assertNotIn("Recife", self.saida.getvalue())   # o log nunca leva a cidade
        e.BASE, e.TIMES, e.ARQ_CLIMA, e.ARQ_FESTAS, e.ARQ_EQUIPE = self.antes

    req = Http.req

    def post(self, rota, corpo, cab=None):
        dados = corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode()
        st, resp, _ = self.req(rota, self.js if cab is None else cab, dados)
        return st, json.loads(resp) if resp else None

    def config(self):
        return json.loads(self.req("/api/config", self.cab)[1])

    def test_barreiras_das_duas_rotas(self):
        for rota, bom in (("/api/clima", {"clima": None}), ("/api/festas", {"rev": 0, "proprias": [], "desligadas": []}),
                          ("/api/equipe", {"rev": 0, "times": [], "aparencia": {}})):
            with self.subTest(rota=rota):
                dados = json.dumps(bom).encode()
                self.assertEqual(self.req(rota, {**self.js, "Origin": "https://outro.exemplo"}, dados)[0], 403)
                self.assertEqual(self.req(rota, {**self.js, "Origin": "null"}, dados)[0], 403)
                sem_origin = {k: v for k, v in self.js.items() if k != "Origin"}
                self.assertEqual(self.req(rota, {**sem_origin, "Referer": self.base + "/"}, dados)[0], 403)   # sem Referer
                self.assertEqual(self.req(rota, {**self.js, "Content-Type": "text/plain"}, dados)[0], 415)
                self.assertEqual(self.req(rota, {"Origin": self.base, "Content-Type": "application/json"}, dados)[0], 401)
                teto = {"/api/clima": e.CLIMA_BYTES, "/api/festas": e.FESTAS_BYTES, "/api/equipe": e.EQUIPE_BYTES}[rota]
                grande = dados[:-1] + b" " * teto + b"}"   # JSON válido, acima do teto
                self.assertEqual(self.req(rota, self.js, grande)[0], 400)
                arquivo = {"/api/clima": e.ARQ_CLIMA, "/api/festas": e.ARQ_FESTAS, "/api/equipe": e.ARQ_EQUIPE}[rota]
                self.assertFalse(os.path.exists(arquivo))
                self.assertEqual(self.req(rota, self.js, dados)[0], 200)   # controle: o mesmo pedido, com tudo certo

    def test_clima_tela_arquivo_e_nenhum(self):
        acordou = self.srv.clima.acordou
        cfg = self.config()
        self.assertEqual((cfg["clima"], cfg["ajustes"]["clima"], cfg["ajustes"]["clima_arquivo"]), (None, "nenhum", False))
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"clima": {"cidade": "Natal", "lat": -5.79, "lon": -35.21}}, f)
        cfg = self.config()
        self.assertEqual((cfg["clima"]["cidade"], cfg["ajustes"]["clima"], cfg["ajustes"]["clima_arquivo"]), ("Natal", "arquivo", True))
        st, r = self.post("/api/clima", {"clima": {"cidade": "Recife", "lat": -8.0476, "lon": -34.877}})
        self.assertEqual((st, r), (200, {"clima": {"cidade": "Recife", "lat": -8.05, "lon": -34.88}, "origem": "tela"}))
        self.assertEqual((self.config()["clima"]["cidade"], self.srv.clima.acordou), ("Recife", acordou + 1))
        st, r = self.post("/api/clima", {"clima": None})   # "sem clima" pela tela vale mais que o times.json
        self.assertEqual((st, r), (200, {"clima": None, "origem": "tela"}))
        self.assertEqual((self.config()["clima"], self.config()["ajustes"]["clima_arquivo"]), (None, True))
        st, r = self.post("/api/clima", {"limpar": True})   # volta ao times.json
        self.assertEqual((st, r["origem"], r["clima"]["cidade"]), (200, "arquivo", "Natal"))
        self.assertFalse(os.path.exists(e.ARQ_CLIMA))
        self.assertEqual(self.srv.clima.acordou, acordou + 3)

    def test_config_v_no_estado_muda_com_a_configuracao(self):
        """Modo TV: o config_v muda quando um arquivo de configuração aparece, some ou muda (mtime ou tamanho)."""
        v = lambda: json.loads(self.req("/api/estado", self.cab)[1])["config_v"]
        v0 = v()
        self.assertRegex(v0, r"\A[0-9a-f]{12}\Z")
        self.assertEqual(v(), v0)   # nada mudou, o mesmo valor
        self.assertEqual(self.post("/api/clima", {"clima": {"cidade": "Recife", "lat": -8.05, "lon": -34.88}})[0], 200)
        v1 = v()
        self.assertNotEqual(v1, v0)
        st = os.stat(e.ARQ_CLIMA)   # o mesmo tamanho com outro mtime (o conteúdo não é lido)
        os.utime(e.ARQ_CLIMA, ns=(st.st_atime_ns, st.st_mtime_ns + 10**9))
        self.assertNotIn(v(), (v0, v1))
        self.assertEqual(self.post("/api/clima", {"limpar": True})[0], 200)   # apagou o clima.json: volta ao de antes
        self.assertEqual(v(), v0)
        with open(e.TIMES, "w", encoding="utf-8") as f:   # o times.json editado à mão também conta
            f.write("{}")
        self.assertNotEqual(v(), v0)

    def test_config_v_cobre_os_sete_arquivos(self):
        """Cada um dos 7 arquivos muda o config_v: aparecer, mudar só o mtime e sumir (volta ao valor de antes)."""
        v = lambda: json.loads(self.req("/api/estado", self.cab)[1])["config_v"]
        for arq in (e.TIMES, e.ARQ_MARCA, e.ARQ_LOGO, e.ARQ_PLANTA, e.ARQ_CLIMA, e.ARQ_FESTAS, e.ARQ_EQUIPE):
            with self.subTest(arq=os.path.basename(arq)):
                antes, existia = v(), os.path.exists(arq)
                if existia:
                    st = os.stat(arq)
                    os.utime(arq, ns=(st.st_atime_ns, st.st_mtime_ns + 10**9))
                else:
                    open(arq, "wb").close()
                self.assertNotEqual(v(), antes)
                if not existia:
                    os.remove(arq)
                    self.assertEqual(v(), antes)

    def test_clima_recusa_sem_ecoar_e_sem_gravar(self):
        acordou = self.srv.clima.acordou
        cidade = {"cidade": "Recife", "lat": -8.05, "lon": -34.88}
        crus = [b'{"clima": {"cidade": "Recife", "lat": NaN, "lon": 1}}', b'{"clima": {"cidade": "Recife", "lat": Infinity, "lon": 1}}',
                b'{"clima": {"cidade": "Recife", "lat": -Infinity, "lon": 1}}', b'{"clima": {"cidade": "Recife", "lat": 1e400, "lon": 1}}']
        corpos = [{"clima": {**cidade, "lat": True}}, {"clima": {**cidade, "lon": 181}}, {"clima": {**cidade, "lat": "1"}},
                  {"clima": {**cidade, "cidade": "<b>Recife</b>" * 6}}, {"clima": cidade, "limpar": True}, {"limpar": False},
                  {"limpar": 1}, {"clima": [cidade]}, {}, ["clima"]]
        for corpo in crus + corpos:
            with self.subTest(corpo=corpo):
                st, r = self.post("/api/clima", corpo)
                self.assertEqual(st, 400)
                self.assertNotIn("Recife", json.dumps(r)); self.assertIn("mensagem", r)
        self.assertFalse(os.path.exists(e.ARQ_CLIMA))
        self.assertEqual(self.srv.clima.acordou, acordou)   # recusa não acorda o clima
        self.assertEqual(self.post("/api/clima", {"clima": cidade})[0], 200)   # controle

    def test_festas_rev_e_conteudo(self):
        data = {"nome": "Aniversário", "data": "02-29", "dias": 2, "tema": "generico", "falas": ["Parabéns!"]}
        st, r = self.post("/api/festas", {"rev": 0, "proprias": [data], "desligadas": ["halloween"]})
        self.assertEqual((st, r["rev"]), (200, 1))
        cfg = self.config()
        self.assertEqual((cfg["festas"], cfg["ajustes"]["rev"]["festas"]),
                         ({"proprias": [data], "desligadas": ["halloween"]}, 1))
        st, r = self.post("/api/festas", {"rev": 0, "proprias": [], "desligadas": []})   # outra tela salvou antes
        self.assertEqual((st, r["erro"], r["rev"]), (409, "rev", 1))
        self.assertEqual(self.config()["festas"]["desligadas"], ["halloween"])
        st, r = self.post("/api/festas", {"rev": 1, "proprias": [data, {**data, "nome": "Recife", "data": "02-30"}], "desligadas": []})
        self.assertEqual((st, r["mensagem"][:23]), (400, "Data 2: data inválida ("))
        self.assertNotIn("Recife", r["mensagem"])
        st, r = self.post("/api/festas", b'{"rev": 1, "proprias": [], "desligadas": [], "x": NaN}')
        self.assertEqual(st, 400)
        self.assertEqual(self.post("/api/festas", {"rev": 1, "proprias": [], "desligadas": []})[0], 200)
        self.assertEqual(self.config()["ajustes"]["rev"]["festas"], 2)
        self.assertIn('"resultado": "salvas"', self.saida.getvalue())

    def test_festas_ilegivel_vale_como_vazio_com_uma_linha_de_log(self):
        with open(e.ARQ_FESTAS, "w", encoding="utf-8") as f:
            f.write('{"v": 1, "rev": 3, "proprias": [{"nome": "X"}], "desligadas": []}')
        for _ in range(3):
            cfg = self.config()
            self.assertEqual((cfg["festas"], cfg["ajustes"]["rev"]["festas"]), ({"proprias": [], "desligadas": []}, 0))
        self.assertEqual(self.saida.getvalue().count('"evento": "festas", "resultado": "arquivo_invalido"'), 1)
        self.assertEqual(self.post("/api/festas", {"rev": 0, "proprias": [], "desligadas": []})[0], 200)   # regrava

    def test_busca_sem_sessao(self):
        self.assertEqual(self.req("/api/clima/busca?q=Recife")[0], 401)

    def test_equipe_substitui_o_times_json_e_volta(self):
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"times": [{"nome": "Antigo", "agentes": ["pixel"]}], "aparencia": {"pixel": {"color": "rose", "eyes": "dots"}}}, f)
        cfg = self.config()
        self.assertEqual(([t["nome"] for t in cfg["times"]], cfg["ajustes"]["equipe"], cfg["ajustes"]["rev"]["equipe"]),
                         (["Antigo"], "arquivo", 0))
        time_ = {"nome": "Dev", "tipo": "mesas", "cor": None, "icone": "codigo", "parede": 1, "piso": 3,
                 "agentes": ["agent-orbita-qa-acme"]}
        visual = {"agent-orbita-qa-acme": {"color": "teal", "eyes": "happy", "accessory": "crown"}}
        st, r = self.post("/api/equipe", {"rev": 0, "times": [time_], "aparencia": visual})
        self.assertEqual((st, r), (200, {"rev": 1, "origem": "tela"}))
        cfg = self.config()   # substitui inteiros: o time e a aparência do times.json saem
        self.assertEqual((cfg["times"], cfg["aparencia"], cfg["ajustes"]["equipe"], cfg["ajustes"]["rev"]["equipe"]),
                         ([time_], visual, "tela", 1))
        self.assertEqual(e.config_publica()["times"], [time_])   # a vida social e o prédio veem pela mesma junção
        st, r = self.post("/api/equipe", {"rev": 0, "times": [], "aparencia": {}})
        self.assertEqual((st, r["erro"], r["rev"]), (409, "rev", 1))
        st, r = self.post("/api/equipe", {"rev": 1, "times": [time_, {**time_, "nome": "dev", "agentes": []}], "aparencia": {}})
        self.assertEqual((st, r["mensagem"]), (400, "Time 2: já existe um time com esse nome."))
        st, r = self.post("/api/equipe", {"rev": 1, "times": [], "aparencia": {}, "conversas": "responder"})
        self.assertEqual(st, 400)   # o modo de conversas (escopo OAuth) fica no servidor
        for ruim in ({"rev": 1, "limpar": False}, {"rev": True, "limpar": True}, {"rev": 1, "limpar": True, "times": []}):
            self.assertEqual(self.post("/api/equipe", ruim)[0], 400, ruim)
        self.assertEqual(self.post("/api/equipe", {"rev": 0, "limpar": True})[0], 409)
        st, r = self.post("/api/equipe", {"rev": 1, "limpar": True})   # Voltar ao times.json
        self.assertEqual((st, r), (200, {"rev": 0, "origem": "arquivo"}))
        self.assertFalse(os.path.exists(e.ARQ_EQUIPE))
        self.assertEqual([t["nome"] for t in self.config()["times"]], ["Antigo"])
        self.assertIn('"resultado": "salva"', self.saida.getvalue())
        self.assertNotIn("orbita", self.saida.getvalue())   # o log guarda contagens, não os handles

    def test_equipe_no_teto_de_32_kb(self):
        """O teto da rota é 32 KB (não o de 16 KB das festas), e o arquivo ganha o "v":1, (6 bytes): um corpo compacto de
        32.763 a 32.768 bytes passa na rota, mas o arquivo passaria do teto, então recebe 400 e nada é gravado."""
        def corpo(tamanho):
            agentes = [f"t{i:02d}-".ljust(41, "y") for i in range(24)]
            tams = [41] * 300
            montar = lambda: json.dumps({"rev": 0, "times": [{"nome": "Dev", "tipo": "mesas", "cor": None, "icone": None,
                                                               "parede": 0, "piso": 0, "agentes": agentes}],
                                         "aparencia": {f"a{i:03d}-".ljust(t, "x"): {"color": "graphite", "eyes": "sleepy",
                                                                                  "accessory": "headphones"}
                                                       for i, t in enumerate(tams)}}, separators=(",", ":")).encode()
            for i in range(len(montar()) - tamanho):   # cada byte a menos sai de um handle
                tams[i % 300] -= 1
            dados = montar()
            self.assertEqual(len(dados), tamanho)
            return dados
        for tamanho in range(e.EQUIPE_BYTES - 5, e.EQUIPE_BYTES + 1):
            st, r = self.post("/api/equipe", corpo(tamanho))
            self.assertEqual((st, r["mensagem"]), (400, "Os times ficaram grandes demais para salvar."), tamanho)
            self.assertFalse(os.path.exists(e.ARQ_EQUIPE))
        self.assertEqual(self.post("/api/equipe", corpo(e.EQUIPE_BYTES - 6)), (200, {"rev": 1, "origem": "tela"}))
        self.assertEqual(os.path.getsize(e.ARQ_EQUIPE), e.EQUIPE_BYTES)   # o arquivo no teto exato
        self.assertEqual(len(self.config()["aparencia"]), 300)


class SairDeTodos(unittest.TestCase):
    """4.1: "Sair de todos os aparelhos" pede a senha de novo (no balde do login), zera todas as sessões e modos e
    apaga os dois cookies deste navegador."""
    def setUp(self):
        class Leitor:
            def foto(self):
                return {**e.resumir(AG, []), "atualizado": None, "erro": None}
        self.pasta = tempfile.mkdtemp(prefix="escritorio-sair-")
        self.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        self.srv.leitor, self.srv.cred, self.srv.acesso = Leitor(), None, Acesso(self.pasta)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]
        self.antes, e.BASE = e.BASE, self.base
        with open(os.path.join(self.pasta, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        self.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")
        self.saida = io.StringIO()
        self.log = contextlib.redirect_stdout(self.saida)
        self.log.__enter__()

    def tearDown(self):
        self.log.__exit__(None, None, None)
        self.assertNotIn("senha-bem-grande", self.saida.getvalue())
        e.BASE = self.antes
        self.srv.shutdown()
        shutil.rmtree(self.pasta, ignore_errors=True)

    req = Http.req
    entrar = Http.entrar

    def sair(self, cab, senha="senha-bem-grande", **extra):
        corpo = json.dumps({"senha": senha}).encode()
        return self.req("/api/sair-todos", {**cab, "Origin": self.base, "Content-Type": "application/json", **extra}, corpo)

    def test_zera_todas_as_sessoes_e_apaga_os_cookies(self):
        celular, computador = self.entrar(), self.entrar()
        self.srv.acesso.modos["x"] = {"cookie": "y", "inicio": 0, "ate": 0}   # um modo resposta aberto
        self.srv.avisos = avisos.Avisos("CHAVE", lambda endpoint, agora: "", e.log, e.FUSO)   # e um celular com aviso
        self.srv.avisos.assinar("https://fcm.googleapis.com/fcm/send/celular", time.time())
        st, corpo, h = self.sair(celular, senha="errada-errada")
        self.assertEqual(len(self.srv.avisos.assinaturas), 1)   # a senha errada não mexe no aviso
        self.assertEqual((st, json.loads(corpo)["erro"]), (403, "senha_incorreta"))
        self.assertEqual(self.req("/api/estado", computador)[0], 200)   # senha errada não derruba ninguém
        st, corpo, h = self.sair(celular)
        self.assertEqual((st, json.loads(corpo)), (200, {"ok": True}))
        cookies = h.get_all("Set-Cookie")
        self.assertEqual(len(cookies), 2)
        self.assertTrue(all("Max-Age=0" in c for c in cookies))
        for cab in (celular, computador):
            self.assertEqual(self.req("/api/estado", cab)[0], 401)
        self.assertEqual((self.srv.acesso.sessoes, self.srv.acesso.modos, self.srv.avisos.assinaturas), ({}, {}, []))
        self.assertEqual(Acesso(self.pasta).sessoes, {})   # gravado: um reinício não traz as sessões de volta
        self.assertIn('"resultado": "sair_todos", "usuario": "dono", "sessoes": 2', self.saida.getvalue())
        self.entrar()   # a senha continua valendo para entrar de novo

    def test_barreiras(self):
        cab = self.entrar()
        corpo = json.dumps({"senha": "senha-bem-grande"}).encode()
        sem_origin = {**cab, "Content-Type": "application/json"}
        self.assertEqual(self.req("/api/sair-todos", {**sem_origin, "Referer": self.base + "/"}, corpo)[0], 403)
        self.assertEqual(self.req("/api/sair-todos", {**sem_origin, "Origin": "https://outro.exemplo"}, corpo)[0], 403)
        self.assertEqual(self.req("/api/sair-todos", {**cab, "Origin": self.base, "Content-Type": "text/plain"}, corpo)[0], 415)
        self.assertEqual(self.req("/api/sair-todos", {"Origin": self.base, "Content-Type": "application/json"}, corpo)[0], 401)
        for ruim in (b'{"senha": 12345678901}', b'{"senha": "senha-bem-grande", "x": 1}', b'{"senha": ""}', b"[]",
                     json.dumps({"senha": "x" * 1100}).encode()):
            self.assertEqual(self.req("/api/sair-todos", {**sem_origin, "Origin": self.base}, ruim)[0], 400, ruim[:30])
        self.assertEqual(self.req("/api/estado", cab)[0], 200)   # nada disso encerrou a sessão
        self.srv.previa_sem_login = True
        try:
            self.assertEqual(self.sair(cab)[0], 403)   # a prévia não tem sessões de verdade para encerrar
        finally:
            del self.srv.previa_sem_login

    def test_erros_contam_no_balde_do_login(self):
        cab = self.entrar()
        for _ in range(acesso.LIMITE):
            self.assertEqual(self.sair(cab, senha="errada-errada")[0], 403)
        self.assertEqual(self.sair(cab)[0], 429)   # nem a senha certa passa até a janela vencer
        corpo = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
        self.assertEqual(self.req("/entrar", {"Origin": self.base}, corpo)[0], 200)   # o login também trava (volta à tela)
        self.assertEqual(self.req("/api/estado", cab)[0], 200)   # e a sessão aberta continua

    def test_senha_com_surrogate_sozinho_e_senha_errada(self):
        cab = self.entrar()
        st, corpo, _ = self.req("/api/sair-todos", {**cab, "Origin": self.base, "Content-Type": "application/json"},
                                b'{"senha": "\\ud800"}')   # JSON válido, mas não vira UTF-8: responde, não derruba a conexão
        self.assertEqual((st, json.loads(corpo)["erro"]), (403, "senha_incorreta"))
        self.assertEqual(self.req("/api/estado", cab)[0], 200)

    def test_disco_falhando_nao_encerra_nada(self):
        celular, computador = self.entrar(), self.entrar()
        # PermissionError (EACCES, arquivo travado no Windows) também é OSError: é o disco, não a senha errada
        for falha_do_disco in (OSError("disco cheio"), PermissionError(13, "sem permissão")):
            with self.subTest(falha=type(falha_do_disco).__name__):
                def falha(*_):
                    raise falha_do_disco
                antes, acesso._gravar = acesso._gravar, falha
                try:
                    st, corpo, _ = self.sair(celular)
                finally:
                    acesso._gravar = antes
                self.assertEqual((st, json.loads(corpo)),
                                 (500, {"erro": "gravar", "mensagem": "Não deu para encerrar as sessões agora."}))
                self.assertEqual((len(self.srv.acesso.sessoes), len(Acesso(self.pasta).sessoes)), (2, 2))   # memória e disco
                for cab in (celular, computador):
                    self.assertEqual(self.req("/api/estado", cab)[0], 200)
                self.assertIn('"resultado": "sair_todos_nao_gravou", "detalhe": "%s"' % type(falha_do_disco).__name__,
                              self.saida.getvalue())
        self.assertNotIn("sair_todos_recusado", self.saida.getvalue())   # nenhuma vira senha errada


class ClimaVivo(unittest.TestCase):
    """2.1: o Clima relê o lugar a cada volta, zera o estado ao trocar, espera sem lugar e consulta no máximo 1 vez
    por minuto (e a cada 900 s no mesmo lugar)."""
    def clima(self, lugares):
        c = e.Clima(lambda: lugares[0])
        c.agora, c.consultas = 1000.0, []
        c.relogio = lambda: c.agora

        def consultar(lat, lon):
            c.consultas.append((lat, lon))
            return {"weather_code": 61, "temperature_2m": 21.5}
        c._consultar = consultar
        return c

    def test_troca_espera_e_minimo_por_minuto(self):
        lugares = [None]
        c = self.clima(lugares)
        self.assertEqual((c.ciclo(), c.consultas, c.foto()), (900, [], None))   # sem lugar: não consulta
        lugares[0] = {"cidade": "Recife", "lat": -8.05, "lon": -34.88}
        self.assertEqual(c.ciclo(), 900)
        self.assertEqual((c.consultas, c.foto()["cidade"], c.foto()["tipo"]), ([(-8.05, -34.88)], "Recife", "chuva"))
        c.agora += 10
        self.assertEqual((c.ciclo(), len(c.consultas)), (890, 1))   # acordou sem troca: não repete a consulta
        lugares[0] = {"cidade": "Natal", "lat": -5.79, "lon": -35.21}
        self.assertEqual(c.ciclo(), 50)   # trocou 10 s depois: espera o minuto...
        self.assertIsNone(c.foto())   # ...mas o tempo de Recife já saiu, para não aparecer com o nome de Natal
        self.assertEqual(len(c.consultas), 1)
        c.agora += 50
        self.assertEqual((c.ciclo(), c.consultas[-1], c.foto()["cidade"]), (900, (-5.79, -35.21), "Natal"))
        c.agora += 900
        c.ciclo()
        self.assertEqual(len(c.consultas), 3)   # no mesmo lugar, de 15 em 15 min
        lugares[0] = None
        self.assertEqual((c.ciclo(), c.foto(), len(c.consultas)), (900, None, 3))

    def test_falha_nao_derruba(self):
        c = self.clima([{"cidade": "Recife", "lat": -8.05, "lon": -34.88}])

        def sem_rede(lat, lon):
            raise OSError("rede")
        c._consultar = sem_rede
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual((c.ciclo(), c.foto()), (900, None))

    def test_acordar(self):
        c = self.clima([None])
        voltas = []
        c.ciclo = lambda: voltas.append(1) or 3600
        c.start()
        fim = time.monotonic() + 5
        while not voltas and time.monotonic() < fim:
            time.sleep(0.01)
        c.acordar()
        fim = time.monotonic() + 5
        while len(voltas) < 2 and time.monotonic() < fim:
            time.sleep(0.01)
        self.assertEqual(len(voltas), 2)


class Busca(unittest.TestCase):
    """2.1: a busca de cidade pelo servidor, com host fixo, sem redirecionamento, limite global e resposta reduzida."""
    BOM = {"results": [{"name": "Recife", "admin1": "Pernambuco", "country": "Brasil", "latitude": -8.0539, "longitude": -34.8811}]}

    def busca(self, resposta):
        b = e.BuscaCidades()
        b.urls = []

        def abrir(url):
            b.urls.append(url)
            if isinstance(resposta, Exception):
                raise resposta
            return resposta if isinstance(resposta, bytes) else json.dumps(resposta).encode()
        b._abrir = abrir
        return b

    def test_resposta_reduzida_e_limpa(self):
        ruins = [{"name": "Sem lat", "longitude": 1}, {"name": "Bool", "latitude": True, "longitude": 1},
                 {"name": "Fora", "latitude": 91, "longitude": 1}, {"name": "", "latitude": 1, "longitude": 1},
                 {"name": "n" * 61, "latitude": 1, "longitude": 1}, "texto", None]
        estranho = {"name": "Olinda‮", "admin1": "Pernam\nbuco" + "x" * 80, "country": 7, "latitude": -8, "longitude": -34.85,
                    "population": 390000, "timezone": "America/Recife"}
        b = self.busca({"results": [estranho] + self.BOM["results"] + ruins})   # só as 8 primeiras contam
        st, r = b.buscar("  Recife ")
        self.assertEqual(st, 200)
        self.assertEqual(r["resultados"][1], {"nome": "Recife", "regiao": "Pernambuco", "pais": "Brasil", "lat": -8.05, "lon": -34.88})
        self.assertEqual(r["resultados"][0], {"nome": "Olinda", "regiao": ("Pernam buco" + "x" * 80)[:60].strip(), "pais": "",
                                              "lat": -8, "lon": -34.85})
        self.assertEqual(len(r["resultados"]), 2)
        url = urllib.parse.urlsplit(b.urls[0])
        self.assertEqual((url.scheme, url.netloc, url.path), ("https", "geocoding-api.open-meteo.com", "/v1/search"))
        self.assertEqual(urllib.parse.parse_qs(url.query), {"name": ["Recife"], "count": ["8"], "language": ["pt"], "format": ["json"]})
        self.assertEqual(len(self.busca({"results": self.BOM["results"] * 20}).buscar("Recife")[1]["resultados"]), 8)
        self.assertEqual(self.busca({}).buscar("Lugarnenhum"), (200, {"resultados": []}))   # sem "results": nenhum

    def test_q_invalido_nao_chama(self):
        b = self.busca(self.BOM)
        for q in ("", "R", " R ", "x" * 61, "Re\ncife", "​​"):
            self.assertEqual(b.buscar(q)[0], 400, q)
        self.assertEqual(b.urls, [])

    def test_limite_por_minuto_e_por_dia(self):
        b = self.busca(self.BOM)
        t0 = 1_000_000.0
        self.assertEqual([b.buscar("Recife", t0 + i)[0] for i in range(11)], [200] * 10 + [429])
        self.assertEqual(b.buscar("Recife", t0 + 10)[1]["mensagem"], "Muitas buscas; espere um minuto.")
        self.assertEqual(b.buscar("Recife", t0 + 61)[0], 200)   # o minuto passou
        dia = self.busca(self.BOM)
        respostas = [dia.buscar("Recife", t0 + 7 * i)[0] for i in range(201)]   # 7 s entre elas: nunca 10 no minuto
        self.assertEqual((respostas[:200].count(200), respostas[200]), (200, 429))
        self.assertEqual(dia.buscar("Recife", t0 + 86400 + 1)[0], 200)   # a primeira do dia saiu da janela

    def test_falha_vira_502_sem_repassar(self):
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            for resposta in (OSError("rede"), b"<html>evil.example</html>", b'{"results": NaN}', b'{"results": {"a": 1}}',
                             b"x" * 200_001, urllib.error.HTTPError("u", 500, "evil.example", {}, None)):
                st, r = self.busca(resposta).buscar("Recife")
                self.assertEqual((st, r["mensagem"]), (502, "A busca de cidades não respondeu agora."))
        self.assertNotIn("Recife", saida.getvalue()); self.assertNotIn("evil", saida.getvalue())

    def test_nao_segue_redirecionamento_e_le_ate_o_teto(self):
        class Pagina(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                if self.path.startswith("/longe"):
                    self.server.seguiu = True
                corpo = json.dumps(Busca.BOM).encode()
                self.send_response(302 if self.path.startswith("/v1/search") else 200)
                self.send_header("Location", "/longe")
                self.send_header("Content-Length", str(len(corpo)))
                self.end_headers()
                self.wfile.write(corpo)
        srv = ThreadingHTTPServer(("127.0.0.1", 0), Pagina)
        srv.seguiu = False
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            b = e.BuscaCidades()
            b.URL = "http://127.0.0.1:%d/v1/search" % srv.server_address[1]
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(b.buscar("Recife")[0], 502)
            self.assertFalse(srv.seguiu)
            b.URL = "http://127.0.0.1:%d/longe" % srv.server_address[1]   # controle: sem o 302, a mesma rota responde
            self.assertEqual(b.buscar("Recife")[1]["resultados"][0]["nome"], "Recife")
        finally:
            srv.shutdown()


class Docker(unittest.TestCase):
    def test_copy_leva_todo_modulo_local_que_o_servidor_importa(self):
        # um módulo novo importado pelo escritorio.py e fora do COPY sobe no PC e cai no container (e, fora do instalar.sh,
        # na VPS: o ajustes.py ficou de fora do install e do py_compile até a Fase 2)
        raiz = os.path.dirname(os.path.abspath(e.__file__))
        with open(os.path.join(raiz, "Dockerfile"), encoding="utf-8") as f:
            copiados = {p for linha in f if linha.startswith("COPY ") for p in linha.split()[1:-1] if p.endswith(".py")}
        with open(os.path.join(raiz, ".dockerignore"), encoding="utf-8") as f:
            liberados = {linha.strip()[1:] for linha in f if linha.startswith("!")}
        locais, pendentes = set(), ["escritorio"]
        while pendentes:
            nome = pendentes.pop()
            if nome in locais:
                continue
            locais.add(nome)
            with open(os.path.join(raiz, nome + ".py"), encoding="utf-8") as f:
                arvore = ast.parse(f.read())
            for no in ast.walk(arvore):
                nomes = [a.name for a in no.names] if isinstance(no, ast.Import) else \
                    [no.module] if isinstance(no, ast.ImportFrom) and no.module else []
                pendentes += [n for n in nomes if os.path.isfile(os.path.join(raiz, n + ".py"))]
        esperados = {n + ".py" for n in locais}
        self.assertEqual(esperados, {"escritorio.py", "acesso.py", "social.py", "planta.py", "ajustes.py", "jornal.py",
                                     "avisos.py", "vapid.py", "novidades.py"})
        self.assertLessEqual(esperados, copiados)
        self.assertLessEqual(esperados, liberados)
        with open(os.path.join(raiz, "instalar.sh"), encoding="utf-8") as f:
            linhas = f.read().replace("\\\n", " ").splitlines()   # junta as linhas continuadas com \
        instalados = {p for linha in linhas if linha.startswith("install ") and linha.rstrip().endswith(" /opt/escritorio/")
                      for p in linha.split() if p.endswith(".py")}
        compilados = {os.path.basename(p) for linha in linhas if "py_compile" in linha for p in linha.split() if p.endswith(".py")}
        self.assertEqual((instalados, compilados), (esperados, esperados))

    def test_changelog_vai_junto_para_a_pagina_novidades(self):
        # o /api/novidades lê o CHANGELOG.pt-BR.md ao lado do escritorio.py: fora da imagem ou do instalar.sh, a página fica vazia
        raiz = os.path.dirname(os.path.abspath(e.__file__))
        self.assertEqual(os.path.dirname(e.NOVIDADES.caminho), raiz)
        nome = os.path.basename(e.NOVIDADES.caminho)
        with open(os.path.join(raiz, "Dockerfile"), encoding="utf-8") as f:
            self.assertIn(f"COPY {nome} ./\n", f.read())
        with open(os.path.join(raiz, ".dockerignore"), encoding="utf-8") as f:
            self.assertIn("!" + nome, f.read().splitlines())
        with open(os.path.join(raiz, "instalar.sh"), encoding="utf-8") as f:
            linhas = f.read().replace("\\\n", " ").splitlines()
        self.assertTrue(any(linha.startswith("install ") and linha.rstrip().endswith(f" {nome} /opt/escritorio/") for linha in linhas))


class ModoResposta(unittest.TestCase):
    """R2a no acesso.py: por sessão e navegador, 1 h renovada por envio, teto de 8 h, só na memória (relógio falso)."""
    T = 1_800_000_000.0

    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="escritorio-modo-")
        self.a = Acesso(self.pasta)
        with open(os.path.join(self.pasta, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        self.a.criar_primeiro(codigo, "dono", "senha-bem-grande")
        self.sessao = self.a.entrar("dono", "senha-bem-grande")

    def tearDown(self):
        shutil.rmtree(self.pasta, ignore_errors=True)

    def test_abrir_conferir_inatividade_e_renovar(self):
        cookie = self.a.abrir_modo(self.sessao, "senha-bem-grande", agora=self.T)
        self.assertEqual(self.a.modo(self.sessao, cookie, self.T), (3600, 8 * 3600))
        self.assertNotIn(cookie, json.dumps(self.a.modos))   # no servidor, só o hash
        self.assertNotIn(self.sessao, json.dumps(self.a.modos))
        self.assertIsNotNone(self.a.modo(self.sessao, cookie, self.T + 59 * 60))
        self.assertEqual(self.a.renovar_modo(self.sessao, self.T + 59 * 60)[0], 3600)   # envio que deu certo: mais 1 h
        self.assertIsNotNone(self.a.modo(self.sessao, cookie, self.T + 59 * 60 + 3599))
        self.assertIsNone(self.a.modo(self.sessao, cookie, self.T + 59 * 60 + 61 * 60))   # 61 min depois do último envio
        self.assertEqual(self.a.modos, {})   # vencido sai na consulta
        self.assertIsNone(self.a.renovar_modo(self.sessao, self.T))   # sem modo, nada a renovar

    def test_teto_de_8_horas(self):
        cookie = self.a.abrir_modo(self.sessao, "senha-bem-grande", agora=self.T)
        for minuto in range(50, 8 * 60, 50):   # um envio a cada 50 min
            resta, teto = self.a.renovar_modo(self.sessao, self.T + minuto * 60)
            self.assertLessEqual(self.T + minuto * 60 + resta, self.T + 8 * 3600)
            self.assertEqual(teto, 8 * 3600 - minuto * 60)
        self.assertIsNotNone(self.a.modo(self.sessao, cookie, self.T + 8 * 3600 - 1))
        self.assertIsNone(self.a.modo(self.sessao, cookie, self.T + 8 * 3600 + 1))   # mesmo com envio recente
        novo = self.a.abrir_modo(self.sessao, "senha-bem-grande", agora=self.T + 8 * 3600 + 2)   # só a senha passa das 8 h
        self.assertEqual(self.a.modo(self.sessao, novo, self.T + 8 * 3600 + 2), (3600, 8 * 3600))

    def test_por_sessao_e_por_navegador(self):
        cookie = self.a.abrir_modo(self.sessao, "senha-bem-grande", agora=self.T)
        outra = self.a.entrar("dono", "senha-bem-grande")   # outro navegador, mesmo usuário: não herda
        self.assertIsNone(self.a.modo(outra, cookie, self.T))   # o cookie do modo copiado para outra sessão não vale
        self.assertIsNone(self.a.modo(self.sessao, None, self.T))   # a sessão sem o cookie do modo
        self.assertIsNone(self.a.modo(self.sessao, ("y" if cookie[0] == "x" else "x") + cookie[1:], self.T))   # sempre outro 1º caractere
        self.assertIsNone(self.a.modo("sessao-que-nao-existe", cookie, self.T))
        self.assertIsNone(Acesso(self.pasta).modo(self.sessao, cookie, self.T))   # reinício: começa sem modo nenhum
        segundo = self.a.abrir_modo(self.sessao, "senha-bem-grande", agora=self.T + 10)   # de novo: registro novo
        self.assertIsNone(self.a.modo(self.sessao, cookie, self.T + 10))
        self.assertIsNotNone(self.a.modo(self.sessao, segundo, self.T + 10))

    def test_fechar_e_sair_apagam(self):
        cookie = self.a.abrir_modo(self.sessao, "senha-bem-grande", agora=self.T)
        self.assertTrue(self.a.fechar_modo(self.sessao))
        self.assertIsNone(self.a.modo(self.sessao, cookie, self.T))
        self.assertFalse(self.a.fechar_modo(self.sessao))
        cookie = self.a.abrir_modo(self.sessao, "senha-bem-grande", agora=self.T)
        self.a.sair(self.sessao)
        self.assertEqual(self.a.modos, {})

    def test_senha_errada_conta_no_balde_do_login(self):
        antes, acesso.ATRASO = acesso.ATRASO, 0
        try:
            for _ in range(acesso.LIMITE):
                with self.assertRaises(PermissionError):
                    self.a.abrir_modo(self.sessao, "senha-errada-errada")
            with self.assertRaises(acesso.TentativasDemais):   # o 9º trava o modo, mesmo com a senha certa...
                self.a.abrir_modo(self.sessao, "senha-bem-grande")
            with self.assertRaises(acesso.TentativasDemais):   # ...e o login
                self.a.entrar("dono", "senha-bem-grande")
        finally:
            acesso.ATRASO = antes
        self.assertEqual(self.a.modos, {})
        with self.assertRaises(PermissionError):
            self.a.abrir_modo("sem-sessao", "senha-bem-grande")


M = "77777777-6666-4555-8444-333333333333"   # ?m= da thread
DM, DM2 = "12345678-1234-4234-8234-123456789012", "22345678-1234-4234-8234-123456789012"   # conversas diretas (fora do list_channels)
CHAVE = "0b9c5c55-3b3a-4c7e-9a1e-2f6d1c8b7a10"


class Responder(unittest.TestCase):
    """R2 de ponta a ponta pelo HTTP: modo resposta, conferências e envio (só conversa direta, T1), com MCP e
    credenciais falsos. CANAL está no list_channels; DM e DM2 são conversas diretas."""
    @staticmethod
    def tarefa(rid, status, ag="a1", canal=DM, m=M):
        url = f"https://app.agentes.chat/org/{e.ORG}/c/{canal}" + (f"?m={m}" if m else "")
        return {"run_id": rid, "agent": {"id": ag}, "status": status, "url": url, "started_at": "2026-01-15T12:00:00Z",
                "label": "Post"}

    class Mcp:
        def __init__(self):
            self.chamadas, self.sessao, self.falha, self.falha_canais = [], "s", None, None
            self.canais = [{"id": CANAL, "is_member": True}]
            self.leitura = {"messages": []}

        def iniciar(self, token):
            self.sessao = "s"

        def ferramenta(self, nome, args, token):
            self.chamadas.append((nome, dict(args)))
            if nome == "read_conversation":
                return self.leitura
            if nome == "list_channels":
                if self.falha_canais:
                    raise self.falha_canais
                return {"channels": self.canais, "next_cursor": None}
            if self.falha:
                raise self.falha
            return {"status": "still_running", "task_id": "tarefa-nova", "reply": "TEXTO-DO-AGENTE"}

    class Cred:
        escrita = True

        def tem_escrita(self):
            return self.escrita

        def token(self):
            return "t"

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix="escritorio-responder-")
        cls.acesso = Acesso(cls.pasta)
        with open(os.path.join(cls.pasta, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    def setUp(self):
        self.antes = e.BASE, e.TIMES
        e.BASE, e.TIMES = self.base, os.path.join(self.pasta, "times.json")
        self.modo_times("responder")
        self.cred = self.Cred()
        self.leitor = e.Leitor(self.cred)
        self.leitor.mcp = self.Mcp()
        self.leitor.estado = {**self.leitor.estado, **e.resumir(AG, [])}
        self.leitor.canais = ({CANAL}, True, time.time())   # o que o Leitor guardou do list_channels
        self.foto([self.tarefa("r1", "waiting_input"), self.tarefa("r2", "waiting_approval", "a2"),
                   self.tarefa("r3", "running", "a1", CANAL), self.tarefa("r4", "waiting_input", "a2", DM2, None),
                   self.tarefa("r8", "waiting_input", "a2", CANAL)])
        self.srv.leitor, self.srv.cred, self.srv.acesso = self.leitor, self.cred, self.acesso
        self.srv.conversas = e.Conversas(self.leitor)
        self.srv.respostas = e.Respostas(self.leitor, self.srv.conversas)
        self.acesso.modos, self.acesso.falhas = {}, {}

    def tearDown(self):
        e.BASE, e.TIMES = self.antes
        self.srv.previa_sem_login = False

    def modo_times(self, modo):
        with open(e.TIMES, "w", encoding="utf-8") as f:
            json.dump({"conversas": modo}, f)

    def foto(self, tarefas, mem=None, agora=None):
        mem = mem or e.ConversasDoDia()
        self.leitor.memoria = mem
        self.leitor.conversas = mem.atualizar(e.normalizar(AG, tarefas)[1], {}, True, agora or time.time())

    def item(self, agente, canal=DM):
        return next(it for it in self.leitor.conversas["por_id"].values() if it["agente_id"] == agente and it["canal"] == canal)

    def req(self, rota, cab=None, dados=None, metodo=None):
        return Http.req(self, rota, cab, dados, metodo)

    def entrar(self):
        return {"Cookie": "esc_sessao=" + self.acesso.entrar("dono", "senha-bem-grande")}

    def post(self, rota, obj, cab, tipo="application/json", origem=True):
        corpo = obj if isinstance(obj, bytes) else json.dumps(obj).encode()
        h = {**cab, "Content-Type": tipo, **({"Origin": self.base} if origem is True else {"Origin": origem} if origem else {})}
        st, resp, headers = self.req(rota, h, corpo, "POST")
        return st, json.loads(resp) if resp else None, headers

    def abrir(self, cab=None):
        cab = cab or self.entrar()
        st, corpo, h = self.post("/api/conversa/modo", {"senha": "senha-bem-grande"}, cab)
        self.assertEqual(st, 200, corpo)
        return {"Cookie": cab["Cookie"] + "; " + h["Set-Cookie"].split(";")[0]}, h["Set-Cookie"], corpo

    def envio(self, agente="a1", canal=DM, **mudar):
        it = self.item(agente, canal)
        return {"id": it["id"], "run_id": it["run_id"], "texto": "Leve, por favor.", "chave": CHAVE, **mudar}

    def enviados(self):
        return [a for n, a in self.leitor.mcp.chamadas if n == "send_to_agent"]

    def flags(self, cab):
        return {c["run_id"]: c["responder"] for c in json.loads(self.req("/api/estado", cab)[1])["conversas"]}

    def test_origem_obrigatoria_e_exata(self):
        cab = self.entrar()
        for rota, corpo in (("/api/conversa/modo", {"senha": "senha-bem-grande"}), ("/api/conversa/responder", self.envio()),
                            ("/api/conversa/modo/fechar", {})):
            with self.subTest(rota=rota):
                self.assertEqual(self.post(rota, corpo, {**cab, "Referer": self.base + "/"}, origem=False)[:2],
                                 (403, {"erro": "origem", "mensagem": "Origem não permitida."}))   # sem Origin, mesmo com Referer bom
                self.assertEqual(self.post(rota, corpo, cab, origem="http://outro.exemplo")[0], 403)
                self.assertEqual(self.post(rota, corpo, cab, origem="null")[0], 403)
        self.assertEqual(self.acesso.modos, {})
        self.assertEqual(self.leitor.mcp.chamadas, [])

    def test_formato(self):
        cab, _, _ = self.abrir()
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab, tipo="text/plain")[0], 415)
        self.assertEqual(self.post("/api/conversa/modo", {"senha": "x"}, cab, tipo="application/x-www-form-urlencoded")[0], 415)
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab, tipo="application/json; charset=utf-8")[0], 200)
        ruins = [b"{", b"[]", json.dumps({**self.envio(), "texto": "x" * 8200}).encode(),   # JSON inválido e corpo acima de 8 KB
                 json.dumps({**self.envio(), "chave": "nao-e-uuid"}).encode(),
                 json.dumps({**self.envio(), "chave": CHAVE.upper()}).encode(),
                 json.dumps({**self.envio(), "agente": "a2"}).encode(),   # o cliente não escolhe agente
                 json.dumps({k: v for k, v in self.envio().items() if k != "run_id"}).encode(),
                 json.dumps({**self.envio(), "texto": 3}).encode()]
        for corpo in ruins:
            with self.subTest(corpo=corpo[:60]):
                self.assertEqual(self.post("/api/conversa/responder", corpo, cab)[:2],
                                 (400, {"erro": "pedido", "mensagem": "Pedido inválido."}))
        self.assertEqual(self.post("/api/conversa/modo", b'{"senha": ""}', cab)[0], 400)
        self.assertEqual(self.post("/api/conversa/modo", json.dumps({"senha": "x" * 2000}).encode(), cab)[0], 400)   # > 1 KB
        self.assertEqual(len(self.enviados()), 1)

    def test_desligado_sem_escrita_ou_previa_da_403(self):
        cab, _, _ = self.abrir()
        for caso in ("ler", "desligado", "sem_escrita", "previa"):
            with self.subTest(caso=caso):
                self.modo_times(caso if caso in ("ler", "desligado") else "responder")
                self.cred.escrita = caso != "sem_escrita"
                self.srv.previa_sem_login = caso == "previa"
                for rota, corpo in (("/api/conversa/modo", {"senha": "senha-bem-grande"}), ("/api/conversa/responder", self.envio())):
                    self.assertEqual(self.post(rota, corpo, cab)[:2][1]["erro"], "responder_desligado", rota)
                self.assertIs(json.loads(self.req("/api/config", cab)[1])["pode_responder"], False)
                estado = json.loads(self.req("/api/estado", cab)[1])
                self.assertIsNone(estado["modo_resposta"])
                self.assertFalse(any(c["responder"] for c in estado["conversas"]))
        self.srv.previa_sem_login, self.cred.escrita = False, True
        self.modo_times("responder")
        self.assertIs(json.loads(self.req("/api/config", cab)[1])["pode_responder"], True)
        self.assertEqual(self.leitor.mcp.chamadas, [])

    def test_abrir_certo_cookie_e_estado(self):
        cab, ck, corpo = self.abrir()
        self.assertEqual(corpo, {"resta_s": 3600, "teto_s": 28800})
        self.assertIn("HttpOnly", ck); self.assertIn("SameSite=Strict", ck)
        self.assertNotIn("Max-Age", ck); self.assertNotIn("Expires", ck)   # cookie de sessão do navegador
        self.assertTrue(ck.startswith("esc_resposta="))
        self.assertNotIn(ck.split(";")[0].split("=")[1], json.dumps(self.acesso.modos))   # no servidor, só o hash
        self.assertEqual(json.loads(self.req("/api/estado", cab)[1])["modo_resposta"], {"resta_s": 3600, "teto_s": 28800})
        outra = self.entrar()   # outra sessão (outro navegador) vê null, mesmo com o cookie do modo copiado
        copiado = {"Cookie": outra["Cookie"] + "; " + ck.split(";")[0]}
        self.assertIsNone(json.loads(self.req("/api/estado", copiado)[1])["modo_resposta"])
        h = e.Pagina.__new__(e.Pagina)
        antes, e.BASE = e.BASE, "https://escritorio.exemplo.ts.net"
        try:
            seguro = h._cookie_modo("abc")
        finally:
            e.BASE = antes
        self.assertTrue(seguro.startswith("__Host-esc_resposta=abc; Path=/;"))
        self.assertIn("; Secure", seguro); self.assertNotIn("Max-Age", seguro)

    def test_senha_errada_403_e_trava_com_o_login(self):
        antes, acesso.ATRASO = acesso.ATRASO, 0
        cab = self.entrar()
        try:
            for _ in range(acesso.LIMITE):
                st, corpo, h = self.post("/api/conversa/modo", {"senha": "senha-errada-errada"}, cab)
                self.assertEqual((st, corpo["erro"], h["Set-Cookie"]), (403, "senha_incorreta", None))
            self.assertEqual(self.post("/api/conversa/modo", {"senha": "senha-bem-grande"}, cab)[:2],
                             (429, {"erro": "tentativas_demais", "mensagem": "Tentativas demais; espere alguns minutos."}))
            with self.assertRaises(acesso.TentativasDemais):
                self.acesso.entrar("dono", "senha-bem-grande")
        finally:
            acesso.ATRASO = antes
            self.acesso.falhas = {}

    def test_envio_sem_modo_nao_chama_o_mcp(self):
        cab = self.entrar()
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[:2][1]["erro"], "modo_fechado")
        aberto, ck, _ = self.abrir()
        outra = self.entrar()   # outro navegador com o cookie do modo copiado
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), {"Cookie": outra["Cookie"] + "; " + ck.split(";")[0]})[0], 403)
        sem_cookie = {"Cookie": aberto["Cookie"].split(";")[0]}   # a sessão que abriu, sem o cookie do modo
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), sem_cookie)[:2][1]["erro"], "modo_fechado")
        self.assertEqual(self.leitor.mcp.chamadas, [])
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), {})[0], 401)

    def test_inatividade_e_teto_pelo_http(self):
        cab, _, _ = self.abrir()
        m = next(iter(self.acesso.modos.values()))
        m["ate"] = time.time() + 60   # 59 min depois de abrir: passa e renova
        st, corpo, _ = self.post("/api/conversa/responder", self.envio(), cab)
        self.assertEqual((st, corpo["resta_s"] >= 3599), (200, True))
        m["ate"] = time.time() - 1   # 61 min sem envio
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[:2][1]["erro"], "modo_fechado")
        cab, _, _ = self.abrir(self.entrar())
        m = next(iter(self.acesso.modos.values()))
        m["inicio"] = time.time() - 8 * 3600 - 1   # teto: 8 h e 1 s desde a senha, mesmo com o ate no futuro
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[:2][1]["erro"], "modo_fechado")
        self.assertEqual(len(self.enviados()), 1)

    def test_fechar_agora_e_sair(self):
        cab, _, _ = self.abrir()
        st, corpo, h = self.post("/api/conversa/modo/fechar", {}, cab)
        self.assertEqual((st, corpo), (200, {"ok": True}))
        self.assertIn("esc_resposta=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0", h["Set-Cookie"])
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[:2][1]["erro"], "modo_fechado")
        cab, _, _ = self.abrir()
        st, _, h = self.req("/sair", {**cab, "Origin": self.base}, b"", "POST")
        self.assertEqual(st, 303)
        cookies = h.get_all("Set-Cookie")
        self.assertEqual(sorted(c.split("=")[0] for c in cookies), ["esc_resposta", "esc_sessao"])
        self.assertTrue(all("Max-Age=0" in c for c in cookies))
        self.assertEqual(self.acesso.modos, {})
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[0], 401)
        self.assertEqual(self.enviados(), [])

    def test_estado_do_item_sem_chamar_o_mcp(self):
        cab, _, _ = self.abrir()
        casos = ((self.envio("a2"), 409, "aprovacao"), (self.envio("a1", CANAL), 409, "trabalhando"),
                 (self.envio(run_id="r-velho"), 409, "mudou"), (self.envio("a2", DM2), 409, "sem_thread"),
                 ({**self.envio(), "id": "naoexiste123"}, 404, "sem_conversa"), ({**self.envio(), "id": "x"}, 404, "sem_conversa"),
                 (self.envio(texto="​‮ \n"), 400, "texto"), (self.envio(texto="x" * 2001), 400, "texto"))
        for corpo, st, codigo in casos:
            with self.subTest(codigo=codigo, corpo=corpo):
                obtido = self.post("/api/conversa/responder", corpo, cab)[:2]
                self.assertEqual((obtido[0], obtido[1]["erro"]), (st, codigo))
                self.assertTrue(obtido[1]["mensagem"])
        self.assertEqual(self.leitor.mcp.chamadas, [])   # nenhuma recusa chama o agentes.chat
        self.assertEqual(self.post("/api/conversa/responder", self.envio(texto="x" * 2000), cab)[0], 200)

    def test_flags_da_lista_e_terminada_hoje(self):
        cab, _, _ = self.abrir()
        self.assertEqual(self.flags(cab), {"r1": True, "r2": False, "r3": False, "r4": False, "r8": False})   # r8: canal (T1)
        mem, agora = e.ConversasDoDia(), time.time()
        self.foto([self.tarefa("r1", "running"), self.tarefa("r5", "running", "a2", DM2)], mem, agora)
        self.foto([self.tarefa("r5", "running", "a2", DM2)], mem, agora + 30)   # r1 terminou
        self.assertEqual(self.flags(cab), {"r1": True, "r5": False})
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[0], 200)
        self.leitor.canais = None   # sem a lista de canais guardada, nada vira "responder"
        self.assertEqual(self.flags(cab), {"r1": False, "r5": False})
        self.leitor.canais = ({CANAL}, True, time.time() - e.CANAIS_CACHE)   # nem com a lista vencida
        self.assertEqual(self.flags(cab), {"r1": False, "r5": False})
        self.leitor.canais = ({CANAL}, False, time.time())   # lista incompleta não decide
        self.assertEqual(self.flags(cab), {"r1": False, "r5": False})

    def test_envio_certo_destino_e_auditoria(self):
        cab, _, _ = self.abrir()
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida):
            st, corpo, _ = self.post("/api/conversa/responder", self.envio(texto="  Leve‮, por​ favor.\r\n"), cab)
            st2, corpo2, _ = self.post("/api/conversa/responder", self.envio(), cab)
        self.assertEqual((st, st2), (200, 200))
        self.assertEqual((corpo["status"], corpo["resta_s"], corpo["teto_s"] <= 28800), ("still_running", 3600, True))
        for enviado in self.enviados():   # conversa direta: sem channel_id, na thread do ?m=, sem prefixo
            self.assertEqual(enviado, {"agent": "a1", "message": "Leve, por favor.", "thread_id": M,
                                       "idempotency_key": CHAVE, "wait_seconds": 0})
        nomes = [n for n, _ in self.leitor.mcp.chamadas]
        self.assertEqual(nomes, ["list_channels", "send_to_agent"] * 2)   # T1: lista de canais fresca a cada envio
        linhas = [json.loads(l) for l in saida.getvalue().splitlines() if '"conversa_envio"' in l]
        self.assertEqual([(l["resultado"], l["usuario"], l["agente_id"], l["run_id"], l["task_id"], l["tamanho"], l["tipo"])
                          for l in linhas], [("ok", "dono", "a1", "r1", "tarefa-nova", 16, "dm")] * 2)
        self.assertEqual(set(linhas[0]), {"evento", "resultado", "usuario", "agente_id", "run_id", "task_id", "tamanho", "tipo", "hora"})
        for vazou in ("Leve", DM, M, "TEXTO-DO-AGENTE"):   # T4: nem texto, nem canal, nem thread
            self.assertNotIn(vazou, saida.getvalue())
        self.assertNotIn("TEXTO-DO-AGENTE", json.dumps([corpo, corpo2]))

    def test_canal_e_classificacao_que_falha_dao_409_sem_enviar(self):   # T1
        cab, _, _ = self.abrir()
        self.assertEqual(self.post("/api/conversa/responder", self.envio("a2", CANAL), cab)[:2],
                         (409, {"erro": "tipo_nao_liberado", "mensagem": "Em canal, por enquanto, responda no agentes.chat."}))
        self.leitor.canais = None   # a lista guardada não vale para o envio: a fresca acha o canal mesmo assim
        self.assertEqual(self.post("/api/conversa/responder", self.envio("a2", CANAL), cab)[0], 409)
        guardada = lambda: ({CANAL}, True, time.time())   # o que o Leitor guardou: a conversa do r1 é direta
        self.leitor.canais, self.leitor.mcp.canais = guardada(), [{"id": DM}]   # só a lista fresca, do envio, vê que é canal
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[1]["erro"], "tipo_nao_liberado")
        self.leitor.mcp.canais = [{"id": CANAL}]
        with contextlib.redirect_stdout(io.StringIO()):
            self.leitor.canais, self.leitor.mcp.falha_canais = guardada(), RuntimeError("fora do ar")   # falha fechada:
            self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[:2][1]["erro"], "tipo_nao_liberado")   # nem a guardada vale
            self.leitor.mcp.falha_canais = None
            self.leitor.canais = guardada()
            self.leitor.mcp.ferramenta = lambda nome, args, token: {"channels": [], "next_cursor": "mais"}   # 10 páginas sem fim
            self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[:2][1]["erro"], "tipo_nao_liberado")
        self.assertEqual(self.enviados(), [])

    def test_m2_depois_do_envio_a_terminada_mostra_a_mensagem_e_a_resposta(self):
        t, mem = time.time(), e.ConversasDoDia()
        self.foto([self.tarefa("r1", "running"), self.tarefa("r5", "running", "a2", DM2)], mem, t - 100)
        self.foto([], mem, t - 70)   # as duas terminaram há 70 s: o A1 corta em t - 10
        hora = lambda s: e._iso(t + s)
        self.leitor.mcp.leitura = {"messages": [
            {"author": {"kind": "agent", "name": "Pixel"}, "sent_at": hora(-100), "untrusted_text": "pergunta"},
            {"author": {"kind": "person"}, "sent_at": hora(-5), "untrusted_text": "enviada"},
            {"author": {"kind": "agent", "name": "Pixel"}, "sent_at": hora(-2), "untrusted_text": "resposta"}]}
        c, um, outro = self.srv.conversas, self.item("a1")["id"], self.item("a2", DM2)["id"]
        textos = lambda id_conversa: [m["texto"] for m in c.ler_id(id_conversa, agora=time.time())[1]["mensagens"]]
        self.assertEqual(textos(um), ["pergunta"])   # antes do envio: o A1 vale
        cab, _, _ = self.abrir()
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[0], 200)
        self.assertEqual(textos(um), ["pergunta", "enviada", "resposta"])   # o que o escritório mandou não some
        st, corpo, _ = self.req(f"/api/conversa?id={um}", cab)
        self.assertEqual((st, json.loads(corpo)["ate"], len(json.loads(corpo)["mensagens"])), (200, None, 3))
        self.assertEqual(textos(outro), ["pergunta"])   # outra terminada continua limitada
        self.assertFalse(self.leitor.respondido(um, t + 2 * 86400))   # a marca vale só até a meia-noite
        self.leitor.zerar_memoria()   # conta nova no OAuth: a marca sai junto
        self.assertFalse(self.leitor.respondido(um, time.time()))

    def test_b4_modo_que_venceu_no_mesmo_instante_nao_da_500(self):
        cab = self.entrar()
        self.acesso.modo = lambda *a, **k: None   # a sessão venceu entre abrir e ler o tempo
        try:
            st, corpo, _ = self.post("/api/conversa/modo", {"senha": "senha-bem-grande"}, cab)
        finally:
            del self.acesso.modo
        self.assertEqual((st, corpo), (200, {"resta_s": 0, "teto_s": 0}))

    def test_envio_invalida_o_cache_da_conversa(self):
        cab, _, _ = self.abrir()
        conv = self.srv.conversas
        conv.cache[(DM, M)] = conv.cache[(DM, None)] = conv.cache[(DM2, M)] = (time.time(), {"mensagens": []})
        self.assertEqual(self.post("/api/conversa/responder", self.envio(), cab)[0], 200)
        self.assertEqual(list(conv.cache), [(DM2, M)])   # a thread e o canal da conversa saem; os outros ficam

    def test_tetos_e_pausas(self):
        r, it = self.srv.respostas, self.item("a1")
        enviar = lambda agora: r.enviar("dono", it["id"], it["run_id"], "oi", CHAVE, agora)
        t = time.time()
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual([enviar(t + i)[0] for i in range(6)], [200] * 5 + [429])   # o 6º no minuto
            for hora in range(1, 10):   # 50 no dia (janela móvel)
                for i in range(5):
                    enviar(t + hora * 120 + i)
            self.assertEqual(len(self.enviados()), 50)
            chamadas = len(self.leitor.mcp.chamadas)
            self.assertEqual(enviar(t + 20 * 120)[1]["erro"], "limite")   # o 51º no dia, sem chamar o MCP
            self.assertEqual(len(self.leitor.mcp.chamadas), chamadas)
            r.chamadas.clear()
            self.leitor.mcp.falha = e.Limitado("120")   # 429 no envio: pausa só os envios
            self.assertEqual(enviar(t + 90_000)[1]["erro"], "pausa")
            self.assertFalse(self.leitor.pausado(t + 90_000))
            self.leitor.mcp.falha = None
            chamadas = len(self.leitor.mcp.chamadas)
            self.assertEqual(enviar(t + 90_100)[1]["erro"], "pausa")   # ainda na pausa: sem chamar nada
            self.assertEqual(len(self.leitor.mcp.chamadas), chamadas)
            self.assertEqual(enviar(t + 90_200)[0], 200)
            self.leitor.pausa_ate = t + 100_000   # pausa do Leitor (O4): 503 sem chamar
            chamadas = len(self.leitor.mcp.chamadas)
            self.assertEqual(enviar(t + 99_000)[1]["erro"], "pausa")
            self.assertEqual(len(self.leitor.mcp.chamadas), chamadas)
            self.leitor.pausa_ate = 0
            self.leitor.mcp.falha = RuntimeError("send_to_agent: texto vindo de fora")
            self.assertEqual(enviar(t + 100_100)[1], {"erro": "erro_agentes", "mensagem": "O agentes.chat não confirmou o envio; ela pode ter saído: confira a conversa antes de mandar de novo."})
            self.leitor.mcp.falha = None
            self.cred.token = lambda: None
            self.assertEqual(enviar(t + 100_200)[1]["erro"], "sem_conexao")

    def test_leitor_guarda_os_canais_so_no_modo_responder(self):
        class Mcp:
            sessao, pedidos, nomes, falha = "s", 0, [], False

            def ferramenta(self, nome, args, token):
                self.pedidos += 1
                self.nomes.append(nome)
                if nome == "list_channels" and self.falha:
                    raise RuntimeError("fora do ar")
                return {"agents": AG} if nome == "list_agents" else {"channels": [{"id": CANAL.upper()}]} \
                    if nome == "list_channels" else {"tasks": []}
        l = e.Leitor(self.cred)
        l.mcp = Mcp()
        t = 1_800_000_000.0
        with contextlib.redirect_stdout(io.StringIO()):
            self.modo_times("ler")
            l.ciclo(t)
            self.assertEqual((l.canais, l.mcp.nomes.count("list_channels")), (None, 0))
            self.modo_times("responder")
            l.ciclo(t + 30); l.ciclo(t + 60)   # uma vez por hora
            self.assertEqual((l.canais, l.mcp.nomes.count("list_channels")), (({CANAL}, True, t + 30), 1))
            l.ciclo(t + 30 + 3600)
            self.assertEqual(l.mcp.nomes.count("list_channels"), 2)
            l.mcp.falha = True   # erro: a leitura segue, a lista fica sem envio e tenta de novo em 5 min
            l.ciclo(t + 30 + 7200)
            self.assertIsNone(l.estado["erro"])
            self.assertEqual((l.canais[0], l.canais[1]), (set(), False))
            l.ciclo(t + 30 + 7200 + 60)
            self.assertEqual(l.mcp.nomes.count("list_channels"), 3)
            l.mcp.falha = False
            l.ciclo(t + 30 + 7200 + 301)
            self.assertEqual((l.canais[0], l.mcp.nomes.count("list_channels")), ({CANAL}, 4))


class Previa(unittest.TestCase):
    """A ferramentas/previa.py sobe de verdade e lê uma conversa pelo caminho do servidor (thread e canal): uma
    mudança no Conversas que a quebre aparece aqui, e não só quando alguém abre a prévia. Cada prévia sobe com uma
    pasta temporária própria e para com o sinal de sair: a pasta de dados dela tem de sumir junto."""
    RAIZ = os.path.dirname(os.path.abspath(e.__file__))

    def subir(self, *args):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            porta = s.getsockname()[1]
        tmp = tempfile.mkdtemp(prefix="escritorio-previa-teste-tmp-")
        grupo = {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {}
        p = subprocess.Popen([sys.executable, "-B", os.path.join("ferramentas", "previa.py"), *args], cwd=self.RAIZ,
                             env={**os.environ, "PREVIA_PORTA": str(porta), "PYTHONUTF8": "1", "TEMP": tmp, "TMP": tmp,
                                  "TMPDIR": tmp}, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                             encoding="utf-8", **grupo)
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        self.addCleanup(self.parar, p, tmp)
        self.assertEqual(p.stdout.readline().strip(), f"http://127.0.0.1:{porta}")   # o servidor já escuta
        self.assertEqual(len(os.listdir(tmp)), 1)   # a pasta de dados da prévia
        rotulo, _, pasta = p.stdout.readline().strip().partition(": ")   # e o caminho dela, na subida
        self.assertEqual(rotulo, "dados temporários")
        self.assertTrue(os.path.samefile(pasta, os.path.join(tmp, os.listdir(tmp)[0])))
        return f"http://127.0.0.1:{porta}"

    def parar(self, p, tmp):
        if p.poll() is None:
            p.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGTERM)
            p.communicate(timeout=15)
            self.assertEqual(os.listdir(tmp), [])   # a prévia apagou a própria pasta ao sair

    def test_previa_le_conversa_pela_thread_e_pelo_canal(self):
        pasta = tempfile.mkdtemp(prefix="escritorio-previa-teste-")
        self.addCleanup(shutil.rmtree, pasta, ignore_errors=True)
        bruto = os.path.join(pasta, "bruto.json")
        url = f"https://app.agentes.chat/org/{e.ORG}/c/"
        with open(bruto, "w", encoding="utf-8") as f:
            json.dump({"agents": AG, "tasks": [
                {"run_id": "r1", "agent": {"id": "a1"}, "status": "running", "url": f"{url}{CANAL}?m={M}", "label": "Post"},
                {"run_id": "r2", "agent": {"id": "a2"}, "status": "waiting_input", "url": url + DM, "label": "QA"}]}, f)
        base = self.subir(bruto)
        ler = lambda rota: json.loads(urllib.request.urlopen(base + rota, timeout=10).read())
        itens = {c["agente_id"]: c["id"] for c in ler("/api/estado")["conversas"]}
        self.assertEqual(set(itens), {"a1", "a2"})
        for agente in ("a1", "a2"):   # a1 tem ?m= (thread), a2 não (canal)
            r = ler(f"/api/conversa?id={itens[agente]}")   # erro na leitura (o TypeError de antes) vira HTTP 502
            self.assertEqual({m["autor"] for m in r["mensagens"]}, {"pessoa", "agente"}, agente)

    def test_previa_com_visitantes(self):
        exemplo = os.path.join("ferramentas", "previa.exemplo.json")
        base = self.subir("--visitantes", "3", exemplo)
        visitantes = json.loads(urllib.request.urlopen(base + "/api/estado", timeout=10).read())["visitantes"]
        self.assertEqual((len(visitantes), visitantes), (3, sorted(visitantes, key=lambda x: x["id"])))
        tmp = tempfile.mkdtemp(prefix="escritorio-previa-teste-tmp-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        r = subprocess.run([sys.executable, "-B", os.path.join("ferramentas", "previa.py"), "--visitantes", "9", exemplo],
                           cwd=self.RAIZ, capture_output=True, text=True, timeout=60,
                           env={**os.environ, "TEMP": tmp, "TMP": tmp, "TMPDIR": tmp})
        self.assertEqual((r.returncode, os.listdir(tmp)), (1, []))
        self.assertIn("--visitantes", r.stderr)

    def test_previa_com_push_falso(self):
        """--push: a chave sai, o endpoint da lista é aceito (o de fora, não) e um pedido novo do arquivo vira aviso."""
        pasta = tempfile.mkdtemp(prefix="escritorio-previa-push-")
        self.addCleanup(shutil.rmtree, pasta, ignore_errors=True)
        bruto = os.path.join(pasta, "bruto.json")
        tarefa = {"run_id": "r1", "agent": {"id": "a1"}, "status": "running", "label": "Post"}
        with open(bruto, "w", encoding="utf-8") as f:
            json.dump({"agents": AG, "tasks": [tarefa]}, f)
        base = self.subir("--push", bruto)

        def req(rota, dados=None):
            cab = {"Origin": base, "Content-Type": "application/json"} if dados else {}
            pedido = urllib.request.Request(base + rota, headers=cab, data=json.dumps(dados).encode() if dados else None)
            try:
                with urllib.request.urlopen(pedido, timeout=10) as r:
                    return r.status, json.loads(r.read())
            except urllib.error.HTTPError as err:
                with err:
                    return err.code, json.loads(err.read())
        st, corpo = req("/api/push/chave")
        self.assertEqual((st, len(corpo["chave"])), (200, 87))
        self.assertEqual(req("/api/push/assinar", {"endpoint": "https://fcm.googleapis.com/fcm/send/x"}), (200, {"ok": True}))
        self.assertEqual(req("/api/push/assinar", {"endpoint": "http://127.0.0.1:9/push"})[1]["erro"], "endpoint_invalido")
        req("/api/estado")   # a base do diário
        with open(bruto, "w", encoding="utf-8") as f:
            json.dump({"agents": AG, "tasks": [{**tarefa, "status": "waiting_approval"}]}, f)
        req("/api/estado")
        self.assertEqual(req("/api/avisos")[1]["aviso"]["agente"], "a1")
        self.assertEqual(req("/api/avisos")[1]["aviso"]["tipo"], "pediu_aprovacao")

    def test_previa_com_jornal_semeado(self):
        base = self.subir("--jornal", os.path.join("ferramentas", "previa.exemplo.json"))
        j = json.loads(urllib.request.urlopen(base + "/api/jornal", timeout=10).read())
        self.assertEqual((len(j["semana"]["agentes"]), len(j["anterior"]["agentes"]), len(j["anterior"]["dias"])), (7, 7, 7))
        self.assertEqual(set(j["semana"]["agentes"][0]), {"id", "tarefas", "aprovacoes", "respostas", "minutos"})

    def test_previa_com_cada_estado_de_conexao(self):
        exemplo = os.path.join("ferramentas", "previa.exemplo.json")
        for conexao, agentes, erro in (("sem_conexao", 0, e.SEM_CONEXAO), ("recusada", 7, e.texto_recusa(403)),
                                       ("conectado", 7, None)):
            base = self.subir("--conexao", conexao, exemplo)
            estado = json.loads(urllib.request.urlopen(base + "/api/estado", timeout=10).read())
            self.assertEqual((estado["conexao"], len(estado["agentes"]), estado["erro"]), (conexao, agentes, erro))
        tmp = tempfile.mkdtemp(prefix="escritorio-previa-teste-tmp-")
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        r = subprocess.run([sys.executable, "-B", os.path.join("ferramentas", "previa.py"), "--conexao", "outro", exemplo],
                           cwd=self.RAIZ, capture_output=True, text=True, timeout=60,
                           env={**os.environ, "TEMP": tmp, "TMP": tmp, "TMPDIR": tmp})
        self.assertEqual((r.returncode, os.listdir(tmp)), (1, []))   # o erro na subida também apaga a pasta
        self.assertIn("sem_conexao", r.stderr)


# ---------------------------------------------------------------- vida social (contrato S, fatia 1)

EXP_DIA = {"abre": "07:00", "fecha": "20:00"}
CFG_SOCIAL = {"serio": False, "expediente": EXP_DIA, "times": []}
CFG_SOZINHOS = {**CFG_SOCIAL, "times": [{"nome": i, "agentes": [i]} for i in ("ag-a", "ag-b", "ag-c", "ag-d")]}   # sem colegas


def em_bsb(hhmm, dia=9):
    """Instante de novembro de 2026 no fuso de Brasília ("HH:MM" ou "HH:MM:SS")."""
    partes = [int(x) for x in hhmm.split(":")] + [0]
    return datetime.datetime(2026, 11, dia, partes[0], partes[1], partes[2], tzinfo=e.FUSO).timestamp()


def leitura(ids, ocupados=(), erro=None):
    return {"agentes": [{"id": i, "nome": "Bot", "handle": i} for i in ids],
            "trabalhos": [{"agente_id": i, "run_id": f"r-{i}", "status": "running"} for i in ocupados], "erro": erro}


def diretor(semente=1):
    return social.Social(None, None, e.log, e.FUSO, random.Random(semente))


def com_valor(s, a, b, valor):
    """Põe o par no valor pedido (pelo delta, como um evento faria)."""
    s.deltas[social._par(a, b)] = valor - social.base(a, b)


class SocialDiretor(unittest.TestCase):
    IDS = ["ag-a", "ag-b", "ag-c", "ag-d"]

    def test_base_simetrica_de_25_a_90_e_igual_em_duas_instancias(self):
        ids = [f"{n:08x}-0000-4000-8000-{n:012x}" for n in range(40)]
        um, outro, vistos = diretor(1), diretor(2), set()
        for a in ids:
            for b in ids:
                if a != b:
                    v = social.base(a, b)
                    self.assertEqual(v, social.base(b, a))
                    self.assertTrue(25 <= v <= 90, v)
                    self.assertEqual(um.valor(a, b), outro.valor(b, a))   # duas instâncias: o mesmo que um reinício
                    vistos.add(v)
        self.assertGreater(len(vistos), 40)   # espalhada pela faixa
        self.assertEqual((social.base("a1", "a2"), social.base("pixel", "orbita")), (86, 47))   # fixa entre instalações

    def test_expediente_igual_ao_expediente_js(self):
        casos = [("07:00", "20:00", h, dentro) for h, dentro in (("06:59:59", False), ("07:00", True), ("12:00", True),
                                                                  ("19:59:59", True), ("20:00", False), ("00:00", False))]
        casos += [("22:00", "06:00", h, dentro) for h, dentro in (("21:59:59", False), ("22:00", True), ("23:59:59", True),
                                                                   ("00:00", True), ("05:59:59", True), ("06:00", False), ("12:00", False))]
        for abre, fecha, h, dentro in casos:
            with self.subTest(turno=f"{abre}-{fecha}", h=h):
                fim = social.fechamento(em_bsb(h), {"abre": abre, "fecha": fecha}, e.FUSO)
                self.assertEqual(fim is not None, dentro)
        self.assertEqual(social.fechamento(em_bsb("12:00"), EXP_DIA, e.FUSO), em_bsb("20:00"))
        noite = {"abre": "22:00", "fecha": "06:00"}
        self.assertEqual(social.fechamento(em_bsb("23:00"), noite, e.FUSO), em_bsb("06:00", dia=10))   # vira a meia-noite
        self.assertEqual(social.fechamento(em_bsb("01:00"), noite, e.FUSO), em_bsb("06:00"))
        if shutil.which("node"):   # a tabela acima é a do expediente.js de verdade
            with open(os.path.join(e.ESTATICO, "expediente.js"), encoding="utf-8") as f:
                fonte = f.read()
            horas = [[a, b, sum(int(x) / 60 ** i for i, x in enumerate(h.split(":")))] for a, b, h, _ in casos]
            js = ("const E = new Function('window', require('fs').readFileSync(0, 'utf8') + '\\nreturn Expediente;')({});"
                  f"console.log(JSON.stringify({json.dumps(horas)}.map(([a, f, h]) => !E.fora(h, a, f))));")
            saida = subprocess.run(["node", "-e", js], input=fonte, capture_output=True, text=True, encoding="utf-8", timeout=30)
            self.assertEqual(json.loads(saida.stdout), [c[3] for c in casos], saida.stderr)

    def dia_simulado(self, n):
        """20 dias de 07:00 às 20:00 com n agentes e tarefas sorteadas, passos de 60 s. Confere os invariantes a cada passo e
        devolve (brigas automáticas por dia, tipos de evento vistos, fração das automáticas depois das 13 h, greves por dia)."""
        ids = [f"{n:08x}-0000-4000-8000-{n:012x}" for n in range(n)]
        cfg = {"serio": False, "expediente": EXP_DIA,
               "times": [{"nome": f"Time {t}", "agentes": ids[t * 6:t * 6 + 6]} for t in range(10)]}
        autos_por_dia, tipos, tarde, greves = [], set(), 0, []
        for semente in range(20):
            s, tarefas, ocupados = diretor(semente), random.Random(1000 + semente), set()
            vistas, eventos_vistos, inicios, pares, greve = set(), set(), [], [], 0
            for minuto in range(24 * 60):
                agora = em_bsb("00:00") + minuto * 60
                for i in ids:   # tarefas sorteadas: ~27% do time ocupado
                    if i in ocupados and tarefas.random() < 0.08:
                        ocupados.discard(i)
                    elif i not in ocupados and tarefas.random() < 0.03:
                        ocupados.add(i)
                livres = set(ids) - ocupados
                s.passo(agora, leitura(ids, sorted(ocupados)), cfg)
                for par, d in s.deltas.items():
                    self.assertTrue(0 <= social.base(*par) + d <= 100)
                self.assertLessEqual(len(s.deltas), social.DELTAS_MAX)
                fecha = social.fechamento(agora, EXP_DIA, e.FUSO)
                for ev in s.eventos:
                    if ev["id"] not in eventos_vistos:
                        eventos_vistos.add(ev["id"]); tipos.add(ev["tipo"])
                        self.assertTrue({ev["a"], ev.get("b", ev["a"])} <= livres, ev)   # só entre livres presentes
                        self.assertIn(ev.get("sobre", ev["a"]), ids)   # o assunto da fofoca só precisa estar presente
                        self.assertIsNotNone(fecha)
                c = s.cena
                if c and c["tipo"] == "greve":
                    self.assertTrue(set(c["participantes"]) <= livres, c)   # só livres; quem pegou tarefa já saiu
                    if c["id"] not in vistas:
                        vistas.add(c["id"]); greve += 1
                        self.assertTrue(social.GREVE_MIN <= len(c["participantes"]) <= social.GREVE_MAX, c)
                        self.assertIsNotNone(fecha)
                        self.assertLessEqual(c["ate"], fecha - social.MARGEM_FECHA)
                elif c and c["id"] not in vistas:
                    vistas.add(c["id"])
                    self.assertEqual(c["origem"], "auto")
                    self.assertTrue({c["a"], c["b"]} <= livres, c)   # ninguém ocupado no agendamento
                    self.assertIsNotNone(fecha)
                    self.assertLessEqual(c["fim"], fecha - social.MARGEM_FECHA)
                    self.assertLess(s.valor(c["a"], c["b"]), social.LIMIAR_BRIGA)
                    inicios.append(c["inicio"]); pares.append(social._par(c["a"], c["b"]))
            self.assertLessEqual(len(inicios), social.BRIGAS_AUTO_DIA)
            self.assertEqual(len(set(pares)), len(pares), pares)   # o par que brigou hoje não volta ao ringue automático
            tarde += sum(i >= em_bsb("13:00") for i in inicios)
            self.assertTrue(all(b - a >= social.ENTRE_AUTO for a, b in zip(inicios, inicios[1:])), inicios)
            autos_por_dia.append(len(inicios))
            self.assertLessEqual(greve, social.GREVES_DIA)
            greves.append(greve)
        return autos_por_dia, tipos, tarde / max(1, sum(autos_por_dia)), greves

    def test_dia_simulado_67_agentes_20_sementes(self):
        autos, tipos, tarde, greves = self.dia_simulado(67)
        self.assertTrue(1 <= sum(autos) / len(autos) <= 4, autos)   # sem nenhuma, a função morre; com mais, vira ruído
        self.assertGreaterEqual(tarde, 0.35, autos)   # espalhadas pelo dia, e não só de manhã
        self.assertEqual(tipos, {"cafe", "papo", "esbarrao", "grampeador", "pazes", "reclamacao", "sugestao", "fofoca"})
        self.assertTrue(1 <= sum(greves) <= 17, greves)   # greve às vezes: nem nunca, nem todo dia

    def test_dia_simulado_9_agentes_20_sementes(self):   # o escritório pequeno, como o da prévia
        autos, _, tarde, greves = self.dia_simulado(9)
        self.assertTrue(1 <= sum(autos) / len(autos) <= 4, autos)
        self.assertGreaterEqual(tarde, 0.35, autos)
        self.assertTrue(1 <= sum(greves) <= 17, greves)   # greve às vezes: nem nunca, nem todo dia

    def test_briga_automatica_respeita_a_margem_do_fechamento(self):
        for hora, marca in (("19:57:10", True), ("19:57:20", False)):   # o fim cairia às 19:57:55 e às 19:58:05 (fecha às 20:00)
            with self.subTest(hora=hora):
                s = diretor()
                com_valor(s, "ag-a", "ag-b", 5)
                s.passo(em_bsb(hora), leitura(["ag-a", "ag-b"]), CFG_SOZINHOS)
                self.assertEqual(s.cena is not None and s.cena["origem"] == "auto", marca)

    def test_teto_de_pares_tira_os_mais_perto_de_zero(self):
        s = diretor()
        s.deltas = {(f"a{n:02d}", f"b{n:02d}"): (n + 1) * (-1) ** n for n in range(social.DELTAS_MAX + 3)}
        s._podar()
        self.assertEqual(len(s.deltas), social.DELTAS_MAX)
        self.assertNotIn(("a00", "b00"), s.deltas)   # |1|, |2| e |3| saem
        self.assertNotIn(("a02", "b02"), s.deltas)
        self.assertIn(("a03", "b03"), s.deltas)

    def test_reconciliacao_com_o_tempo(self):
        s, t = diretor(), em_bsb("21:00")   # fora do expediente: só o decaimento
        com_valor(s, "ag-a", "ag-b", social.base("ag-a", "ag-b") - 3)
        com_valor(s, "ag-c", "ag-d", social.base("ag-c", "ag-d") + 2)
        s.passo(t, leitura(self.IDS), CFG_SOCIAL)
        for minutos in (10, 20, 30, 60):
            s.passo(t + minutos * 60, leitura(self.IDS), CFG_SOCIAL)
        self.assertEqual(s.deltas, {})   # −3 subiu 1 a cada 10 min; +2 desceu 1 a cada 30 min; o 0 sai do dicionário

    def test_modo_serio_sem_eventos_nem_cena(self):
        s, t, serio = diretor(), em_bsb("10:00"), {**CFG_SOCIAL, "serio": True}
        com_valor(s, "ag-a", "ag-b", 5)
        self.assertEqual(s.ordenar("ag-c", "ag-d", t, leitura(self.IDS), CFG_SOCIAL)[0], 200)
        s.passo(t + 1, leitura(self.IDS), serio)   # o passo no modo sério tira a cena em curso
        self.assertIsNone(s.cena)
        for minuto in range(1, 300):
            s.passo(t + minuto * 60, leitura(self.IDS), serio)
        self.assertEqual((s.cena, list(s.eventos)), (None, []))
        self.assertGreater(s.valor("ag-a", "ag-b"), 5)   # só a reconciliação continua
        self.assertEqual(s.ordenar("ag-a", "ag-b", t, leitura(self.IDS), serio), (409, {
            "erro": "modo_serio", "mensagem": "O modo sério está ligado: o ringue está fechado."}))
        self.assertEqual(s.foto(t, True)["cena"], None)
        s._evento(t, "cafe", "ag-a", "ag-b")   # evento que já existia não sai no modo sério
        self.assertEqual((len(s.foto(t, False)["eventos"]), s.foto(t, True)["eventos"]), (1, []))

    def test_leitura_com_erro_nao_cria_nada(self):
        s, t = diretor(), em_bsb("10:00")
        com_valor(s, "ag-a", "ag-b", 5)
        for minuto in range(120):
            s.passo(t + minuto * 60, leitura(self.IDS, erro="agentes.chat não respondeu"), CFG_SOCIAL)
        self.assertEqual((s.cena, list(s.eventos)), (None, []))

    def test_validacoes_do_ringue_e_teto_do_dia(self):
        s, t, lt = diretor(), em_bsb("09:00"), leitura(self.IDS, ocupados=["ag-d"])
        casos = ((("ag-a", "ag-a", t, lt), 409, "mesmo_agente"), (("ag-a", "zz", t, lt), 404, "agente"),
                 (("ag-a", "ag-d", t, lt), 409, "trabalhando"), (("ag-a", "ag-b", em_bsb("21:00"), lt), 409, "fora_do_expediente"),
                 (("ag-a", "ag-b", em_bsb("06:59"), lt), 409, "fora_do_expediente"),
                 (("ag-a", "ag-b", em_bsb("19:57:20"), lt), 409, "fora_do_expediente"))   # o fim passaria de 19:58
        for args, status, codigo in casos:
            with self.subTest(codigo=codigo, args=args[:2]):
                st, corpo = s.ordenar(*args, CFG_SOCIAL)
                self.assertEqual((st, corpo["erro"]), (status, codigo))
        self.assertEqual(s.ordenar("ag-a", "ag-b", em_bsb("19:57:10"), lt, CFG_SOCIAL)[0], 200)   # o fim cai às 19:57:55
        s = diretor()
        st, corpo = s.ordenar("ag-a", "ag-b", t, lt, CFG_SOCIAL)
        self.assertEqual((st, set(corpo["cena"])), (200, {"id", "tipo", "a", "b", "vencedor", "inicio", "fim", "origem"}))
        st, ocupado = s.ordenar("ag-b", "ag-c", t + 5, lt, CFG_SOCIAL)
        self.assertEqual((st, ocupado["erro"], ocupado["cena"]), (409, "ocupado", corpo["cena"]))   # com a cena no corpo
        self.assertEqual(s.ordenar("ag-b", "ag-c", t + 45 + 59, lt, CFG_SOCIAL)[1], {   # 60 s depois do fim, sem cena à vista
            "erro": "ocupado", "mensagem": "Acabou de ter briga; espere um minuto.", "cena": None})
        pares = [("ag-a", "ag-b"), ("ag-a", "ag-c"), ("ag-b", "ag-c")]
        for n in range(1, social.ORDENS_DIA):
            self.assertEqual(s.ordenar(*pares[n % 3], t + n * 120, lt, CFG_SOCIAL)[0], 200, n)
        st, corpo = s.ordenar("ag-a", "ag-b", t + 21 * 120, lt, CFG_SOCIAL)   # a 21ª do dia
        self.assertEqual((st, corpo["erro"]), (429, "teto_dia"))
        self.assertEqual(len(s.brigas_hoje), social.ORDENS_DIA)   # cada briga assentada no fim

    def test_resultado_da_briga_e_pazes(self):
        s, t = diretor(), em_bsb("10:00")
        antes = s.valor("ag-a", "ag-b")
        cena = s.ordenar("ag-a", "ag-b", t, leitura(self.IDS), CFG_SOCIAL)[1]["cena"]
        s.passo(t + 30, leitura(self.IDS, ocupados=["ag-a"]), CFG_SOCIAL)   # pegou tarefa depois do início: vale o resultado
        self.assertIsNotNone(s.foto(t + 30, False)["cena"])
        self.assertEqual(s.foto(t + 54, False)["cena"]["id"], cena["id"])   # à vista até o fim + 10 s
        self.assertIsNone(s.foto(t + 55, False)["cena"])
        s.passo(t + 60, leitura(self.IDS, ocupados=["ag-a"]), CFG_SOCIAL)
        self.assertEqual((s.valor("ag-a", "ag-b"), s.cena), (antes - social.PERDE_BRIGA, None))
        self.assertIn(("ag-a", "ag-b"), s.pares_hoje)
        ficha = s.amizades("ag-a", set(self.IDS))
        self.assertEqual(ficha["ultima_briga"], {"contra": "ag-b", "venceu": cena["vencedor"] == "ag-a", "em": cena["fim"]})
        s.brigas_hoje[0]["pazes"] = t + 3700   # o horário sorteado das pazes
        s.passo(t + 3700, leitura(self.IDS), CFG_SOCIAL)
        pazes = [ev for ev in s.eventos if ev["tipo"] == "pazes"]
        self.assertEqual([(ev["a"], ev["b"]) for ev in pazes], [("ag-a", "ag-b")])
        s.passo(t + 3760, leitura(self.IDS), CFG_SOCIAL)
        self.assertEqual(len([ev for ev in s.eventos if ev["tipo"] == "pazes"]), 1)   # uma vez por par por dia

    def test_agente_que_some_cancela_a_cena_e_volta_com_o_mesmo_valor(self):
        s, t = diretor(), em_bsb("10:00")
        com_valor(s, "ag-a", "ag-b", 30)   # sem colegas de time e com no máximo 1 livre: nenhum sorteio mexe no par
        self.assertEqual(s.ordenar("ag-a", "ag-b", t, leitura(self.IDS), CFG_SOZINHOS)[0], 200)
        s.passo(t + 5, leitura(["ag-b", "ag-c", "ag-d"], ocupados=["ag-c", "ag-d"]), CFG_SOZINHOS)   # sumiu antes do início
        self.assertIsNone(s.cena)
        self.assertEqual(s.valor("ag-a", "ag-b"), 30)   # cancelada sem efeito
        self.assertNotIn("ag-b", [r["id"] for r in s.amizades("ag-a", {"ag-a", "ag-c"})["rivais"]])   # quem sumiu sai da ficha
        self.assertEqual(s.ordenar("ag-c", "ag-d", t + 10, leitura(self.IDS), CFG_SOZINHOS)[0], 200)
        s.passo(t + 12, leitura(self.IDS, ocupados=["ag-a", "ag-b", "ag-d"]), CFG_SOZINHOS)   # pegou tarefa antes do início
        self.assertIsNone(s.cena)
        s.passo(t + 120, leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)   # voltou no mesmo dia
        self.assertEqual(s.valor("ag-a", "ag-b"), 30)
        self.assertEqual(s.amizades("ag-a", set(self.IDS))["rivais"][0], {"id": "ag-b", "valor": 30})

    def test_virada_da_meia_noite_de_brasilia_zera_os_tetos(self):
        s, lt = diretor(), leitura(self.IDS, ocupados=self.IDS)
        s.passo(em_bsb("19:00"), lt, CFG_SOCIAL)
        s.ordens_hoje, s.autos_hoje, s.pares_hoje = social.ORDENS_DIA, social.BRIGAS_AUTO_DIA, {("ag-a", "ag-b")}
        s.passo(em_bsb("21:30"), lt, CFG_SOCIAL)   # já é o dia seguinte em UTC, ainda não em Brasília
        self.assertEqual((s.ordens_hoje, s.autos_hoje), (social.ORDENS_DIA, social.BRIGAS_AUTO_DIA))
        self.assertEqual(s.ordenar("ag-a", "ag-b", em_bsb("21:31"), leitura(self.IDS), CFG_SOCIAL)[1]["erro"], "fora_do_expediente")
        s.passo(em_bsb("00:01", dia=10), lt, CFG_SOCIAL)
        self.assertEqual((s.ordens_hoje, s.autos_hoje, s.pares_hoje), (0, 0, set()))
        s.ordens_hoje = social.ORDENS_DIA
        self.assertEqual(s.ordenar("ag-a", "ag-b", em_bsb("09:00", dia=11), leitura(self.IDS), CFG_SOCIAL)[0], 200)   # sem passo

    def test_ficha_amigos_rivais_e_media(self):
        s = diretor()
        for b, v in (("ag-b", 95), ("ag-c", 10), ("ag-d", 61)):
            com_valor(s, "ag-a", b, v)
        com_valor(s, "ag-a", "ag-e", 2)   # ausente: não entra
        f = s.amizades("ag-a", set(self.IDS))
        self.assertEqual(f, {"agente": "ag-a", "media": 55, "amigos": [{"id": "ag-b", "valor": 95}, {"id": "ag-d", "valor": 61}],
                             "rivais": [{"id": "ag-c", "valor": 10}], "ultima_briga": None})
        self.assertEqual(s.amizades("ag-a", {"ag-a"})["media"], None)


class SocialGreve(unittest.TestCase):
    """Fatia 2: reclamação, sugestão, fofoca e a greve (gatilho, teto do dia, quem pega tarefa sai, atender, modo sério)."""
    IDS = ["g0", "g1", "g2", "g3", "g4", "g5"]

    def insatisfeitos(self, s, quem=("g0", "g1", "g2", "g3")):
        for i, a in enumerate(quem):
            for b in quem[i + 1:]:
                com_valor(s, a, b, 25)   # abaixo dos 30 da greve e acima dos 20 da briga automática

    def com_greve(self, t, ocupados=()):
        s = diretor()
        self.assertIsNone(s._insatisfeitos(set(self.IDS)))   # a base sozinha não faz greve
        self.insatisfeitos(s)
        s.passo(t, leitura(self.IDS, ocupados=list(ocupados)), CFG_SOCIAL)
        self.assertEqual(s.cena["tipo"], "greve")
        return s

    def test_cinco_reclamacoes_disparam_a_greve_so_com_livres(self):
        s, t, lt = diretor(), em_bsb("10:00"), leitura(self.IDS, ocupados=["g5"])
        self.assertIsNone(s._insatisfeitos(set(self.IDS) - {"g5"}))
        s.passo(t, lt, CFG_SOCIAL)
        for _ in range(social.GREVE_RECLAMACOES - 1):
            s._evento_fatia2(t, 0.0, ["g4"], set(self.IDS))   # sorte 0: reclamação
        s.passo(t + 60, lt, CFG_SOCIAL)
        self.assertIsNone(s.cena)   # 4 reclamações: ainda não
        s._evento_fatia2(t + 60, 0.0, ["g4"], set(self.IDS))
        self.assertEqual(s.foto(t + 60, False)["eventos"][0], {"id": s.eventos[-1]["id"], "tipo": "reclamacao", "a": "g4",
                                                                  "em": social._iso(t + 60)})
        s.passo(t + 120, lt, CFG_SOCIAL)
        c = s.cena
        self.assertEqual((c["tipo"], c["participantes"][0], c["ate"]), ("greve", "g4", t + 120 + social.GREVE_DURA))   # quem reclamou vem primeiro
        self.assertTrue(set(c["participantes"]) <= set(self.IDS) - {"g5"} and len(c["participantes"]) == 5, c)   # só livres
        self.assertEqual(set(s.foto(t + 120, False)["cena"]), {"id", "tipo", "participantes", "motivo", "inicio", "ate", "origem"})

    def test_grupo_insatisfeito_dispara_e_so_uma_por_dia(self):
        t = em_bsb("10:00")
        s = self.com_greve(t)
        self.assertTrue({"g0", "g1", "g2", "g3"} <= set(s.cena["participantes"]))
        s.passo(t + social.GREVE_DURA, leitura(self.IDS), CFG_SOCIAL)   # acaba sozinha no "ate"
        self.assertIsNone(s.cena)
        for minuto in range(1, 120):   # o grupo segue insatisfeito, mas é uma por dia
            s.passo(t + social.GREVE_DURA + minuto * 60, leitura(self.IDS), CFG_SOCIAL)
            self.assertFalse(s.cena and s.cena["tipo"] == "greve")
        s.passo(em_bsb("09:59", dia=10), leitura(self.IDS), CFG_SOCIAL)   # a noite reconcilia; o grupo se desentende de novo
        self.insatisfeitos(s)
        s.passo(em_bsb("10:00", dia=10), leitura(self.IDS), CFG_SOCIAL)   # no dia seguinte, pode de novo
        self.assertEqual(s.cena["tipo"], "greve")

    def test_quem_pega_tarefa_sai_e_com_menos_de_dois_acaba(self):
        t = em_bsb("10:00")
        s = self.com_greve(t)
        todos = list(s.cena["participantes"])
        s.passo(t + 60, leitura(self.IDS, ocupados=[todos[0]]), CFG_SOCIAL)   # o trabalho real manda
        self.assertEqual(s.cena["participantes"], todos[1:])
        self.assertEqual(s.foto(t + 60, False)["cena"]["participantes"], todos[1:])
        s.passo(t + 120, leitura(self.IDS, ocupados=todos[:-1]), CFG_SOCIAL)
        self.assertIsNone(s.cena)
        s = self.com_greve(t)
        s.passo(t + 60, leitura([i for i in self.IDS if i != s.cena["participantes"][0]]), CFG_SOCIAL)   # quem some também sai
        self.assertEqual(len(s.cena["participantes"]), len(todos) - 1)

    def test_nao_dispara_no_serio_fora_do_expediente_perto_do_fechamento_nem_com_outra_cena(self):
        for hora, cfg, nasce in (("10:00", {**CFG_SOCIAL, "serio": True}, False), ("06:30", CFG_SOCIAL, False),
                                 ("19:54", CFG_SOCIAL, False), ("19:52", CFG_SOCIAL, True)):   # 19:52: 6 min até 19:58
            with self.subTest(hora=hora, serio=cfg["serio"]):
                s = diretor()
                self.insatisfeitos(s)
                s.passo(em_bsb(hora), leitura(self.IDS), cfg)
                self.assertEqual(s.cena is not None and s.cena["tipo"] == "greve", nasce)
                if nasce:
                    self.assertEqual(s.cena["ate"], em_bsb("19:58"))
        s, t = diretor(), em_bsb("10:00")
        self.insatisfeitos(s)
        self.assertEqual(s.ordenar("g4", "g5", t, leitura(self.IDS), CFG_SOCIAL)[0], 200)
        s.passo(t + 1, leitura(self.IDS), CFG_SOCIAL)
        self.assertEqual(s.cena["tipo"], "briga")   # uma cena por vez
        s = self.com_greve(t)
        s.passo(t + 60, leitura(self.IDS), {**CFG_SOCIAL, "serio": True})   # o modo sério pausa a greve
        self.assertIsNone(s.cena)
        s = self.com_greve(t)
        s.cancelar(t + 60)   # e o /api/marca também
        self.assertIsNone(s.cena)

    def test_atender(self):
        t = em_bsb("10:00")
        s = self.com_greve(t)
        c, antes = s.cena, {p: s.valor(*p) for p in itertools.combinations(s.cena["participantes"], 2)}
        st, corpo = s.ordenar("g4", "g5", t + 10, leitura(self.IDS), CFG_SOCIAL)
        self.assertEqual((st, corpo["erro"], corpo["mensagem"], corpo["cena"]["id"]),
                         (409, "ocupado", "Tem uma greve no escritório; atenda o pedido primeiro.", c["id"]))
        self.assertEqual(s.atender("outro", t + 10, CFG_SOCIAL), (404, {"erro": "greve", "mensagem": "Essa greve já acabou."}))
        self.assertEqual(s.atender(c["id"], t + 10, {**CFG_SOCIAL, "serio": True})[1]["erro"], "modo_serio")
        self.assertIs(s.cena, c)
        self.assertEqual(s.atender(c["id"], t + 20, CFG_SOCIAL), (200, {"cena": None}))
        self.assertIsNone(s.cena)
        self.assertEqual({p: s.valor(*p) for p in antes}, {p: min(100, v + social.ATENDIDA) for p, v in antes.items()})
        self.assertEqual(s.foto(t + 20, False)["eventos"][0], {"id": s.eventos[-1]["id"], "tipo": "atendida", "greve": c["id"],
                                                                  "motivo": c["motivo"], "participantes": c["participantes"],
                                                                  "em": social._iso(t + 20)})
        self.assertEqual(s.atender(c["id"], t + 30, CFG_SOCIAL)[0], 404)   # já atendida
        self.assertEqual(s.ordenar("g4", "g5", t + 30, leitura(self.IDS), CFG_SOCIAL)[1]["erro"], "ocupado")   # a folga de 60 s vale

    def test_grupo_insatisfeito_so_com_livres(self):
        s, t = diretor(), em_bsb("10:00")
        self.insatisfeitos(s, ("g0", "g1", "g2", "g3", "g4"))
        s.passo(t, leitura(self.IDS, ocupados=["g0"]), CFG_SOCIAL)   # o g0 também está insatisfeito, mas trabalha
        self.assertEqual(sorted(s.cena["participantes"]), ["g1", "g2", "g3", "g4"])

    def test_reclamacoes_de_ontem_nao_contam(self):
        s, lt, t, amanha = diretor(), leitura(self.IDS), em_bsb("10:00"), em_bsb("10:00", dia=10)
        s.passo(t, lt, CFG_SOCIAL)
        for _ in range(social.GREVE_RECLAMACOES - 1):
            s._evento_fatia2(t, 0.0, ["g4"], set(self.IDS))   # sorte 0: reclamação
        s.passo(amanha, lt, CFG_SOCIAL)   # vira o dia
        s._evento_fatia2(amanha, 0.0, ["g4"], set(self.IDS))
        s.passo(amanha + 60, lt, CFG_SOCIAL)
        self.assertLess(len(s.reclamaram_hoje), social.GREVE_RECLAMACOES)
        self.assertIsNone(s.cena)   # 4 de ontem e 1 de hoje: sem greve

    def test_atender_depois_do_ate_da_404(self):
        t = em_bsb("10:00")
        s = self.com_greve(t)
        c = s.cena
        antes = {p: s.valor(*p) for p in itertools.combinations(c["participantes"], 2)}
        self.assertEqual(s.atender(c["id"], c["ate"], CFG_SOCIAL), (404, {"erro": "greve", "mensagem": "Essa greve já acabou."}))   # antes do passo
        self.assertEqual({p: s.valor(*p) for p in antes}, antes)
        self.assertFalse(any(ev["tipo"] == "atendida" for ev in s.eventos))

    def test_quem_some_sai_so_do_participantes_do_atendida(self):
        t = em_bsb("10:00")
        s = self.com_greve(t)
        c, ps = s.cena, list(s.cena["participantes"])
        self.assertEqual(s.atender(c["id"], t + 10, CFG_SOCIAL)[0], 200)
        s.passo(t + 60, leitura([i for i in self.IDS if i != ps[0]]), CFG_SOCIAL)   # um grevista sumiu: o evento fica sem ele
        ev = next(ev for ev in s.foto(t + 60, False)["eventos"] if ev["tipo"] == "atendida")
        self.assertEqual((ev["greve"], ev["motivo"], ev["participantes"]), (c["id"], c["motivo"], ps[1:]))
        s.passo(t + 120, leitura([i for i in self.IDS if i not in ps]), CFG_SOCIAL)   # sumiram todos: o evento sai
        self.assertFalse(any(ev["tipo"] == "atendida" for ev in s.eventos))

    def test_quem_some_tira_o_evento_de_par(self):
        s, t = diretor(), em_bsb("10:00")
        s.passo(t, leitura(self.IDS), CFG_SOCIAL)
        s._evento(t, "cafe", "g0", "g1")
        cafe = s.eventos[-1]["id"]
        s._evento(t, "papo", "g2", "g3")
        papo = s.eventos[-1]["id"]
        ids = lambda: {ev["id"] for ev in s.eventos}
        s.passo(t + 60, leitura([i for i in self.IDS if i != "g1"]), CFG_SOCIAL)   # o b sumiu: o café sai, o papo fica
        self.assertEqual((cafe in ids(), papo in ids()), (False, True))
        s.passo(t + 120, leitura([i for i in self.IDS if i not in ("g1", "g2")]), CFG_SOCIAL)   # o a sumiu: o papo sai
        self.assertNotIn(papo, ids())

    def test_fofoca_e_sugestao(self):
        s, t = diretor(), em_bsb("10:00")
        s._evento_fatia2(t, social.CHANCE_RECLAMA, ["g0", "g1"], {"g0", "g1", "g2"})
        self.assertEqual((s.eventos[-1]["tipo"], s.reclamaram_hoje), ("sugestao", []))   # sugestão não conta para a greve
        s._evento_fatia2(t, social.CHANCE_RECLAMA + social.CHANCE_SUGERE, ["g0", "g1"], {"g0", "g1", "g2"})
        ev = s.eventos[-1]
        self.assertEqual((ev["tipo"], {ev["a"], ev["b"]}, ev["sobre"]), ("fofoca", {"g0", "g1"}, "g2"))
        a, b = ev["a"], ev["b"]
        self.assertEqual((s.deltas.get(social._par(a, b)), s.deltas.get(social._par(a, "g2")), s.deltas.get(social._par(b, "g2"))),
                         (social.FOFOCA_AB, social.FOFOCA_A, social.FOFOCA_B))
        s._evento_fatia2(t, social.CHANCE_RECLAMA + social.CHANCE_SUGERE, ["g0", "g1"], {"g0", "g1"})   # sem assunto presente, nada
        self.assertEqual(len(s.eventos), 2)
        s.passo(t + 1, leitura(["g0", "g1", "g3"]), CFG_SOCIAL)   # o assunto sumiu: a fofoca sai dos eventos
        self.assertNotIn(ev["id"], [x["id"] for x in s.eventos])


class SocialHttp(unittest.TestCase):
    """As rotas da vida social no servidor de verdade: /api/estado, /api/social, /api/social/briga e o modo sério."""
    req, entrar = Http.req, Http.entrar
    IDS = ["s1", "s2", "s3", "s4"]

    @classmethod
    def setUpClass(cls):
        cls.pasta = tempfile.mkdtemp(prefix="escritorio-social-")

        class Leitor:
            def __init__(self):
                self.ids, self.ocupados = list(SocialHttp.IDS), set()

            def foto(self):
                agentes = [{"id": i, "name": f"Bot {i}", "handle": f"bot-{i}"} for i in self.ids]
                tarefas = [{"run_id": f"r-{i}", "agent": {"id": i}, "status": "running"} for i in sorted(self.ocupados)]
                return {**e.resumir(agentes, tarefas), "atualizado": None, "erro": None}
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor, cls.srv.cred, cls.srv.acesso = Leitor(), None, Acesso(cls.pasta)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        with open(os.path.join(cls.pasta, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        shutil.rmtree(cls.pasta, ignore_errors=True)

    def setUp(self):
        self.antes = e.BASE, e.ARQ_MARCA
        e.BASE, e.ARQ_MARCA = self.base, os.path.join(self.pasta, "marca.json")
        agora = datetime.datetime.now(e.FUSO)   # expediente em volta de agora: o teste vale a qualquer hora
        self.expediente({"abre": (agora - datetime.timedelta(hours=1)).strftime("%H:%M"),
                         "fecha": (agora + datetime.timedelta(hours=2)).strftime("%H:%M")})
        self.srv.leitor.ids, self.srv.leitor.ocupados = list(self.IDS), set()
        self.srv.social = social.Social(self.srv.leitor, e.config_publica, e.log, e.FUSO, random.Random(7))
        self.sessao = None
        self.saida = io.StringIO()
        self.log = contextlib.redirect_stdout(self.saida)
        self.log.__enter__()

    def tearDown(self):
        self.log.__exit__(None, None, None)
        e.BASE, e.ARQ_MARCA = self.antes
        if os.path.exists(os.path.join(self.pasta, "marca.json")):
            os.unlink(os.path.join(self.pasta, "marca.json"))

    def expediente(self, exp, serio=None):
        with open(os.path.join(self.pasta, "marca.json"), "w", encoding="utf-8") as f:
            json.dump({"empresa": "Acme", "cor": "#112233", "expediente": exp, **({} if serio is None else {"serio": serio})}, f)

    def briga(self, corpo, cab=None, sessao=True):
        if sessao and not self.sessao:
            self.sessao = self.entrar()
        cab = {"Origin": self.base, "Content-Type": "application/json", **(self.sessao if sessao else {}), **(cab or {})}
        st, dados, _ = self.req("/api/social/briga", {k: v for k, v in cab.items() if v is not None},
                                corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode())
        return st, json.loads(dados)

    def social_do_estado(self, cab):
        st, corpo, _ = self.req("/api/estado", cab)
        self.assertEqual(st, 200)
        return json.loads(corpo).get("social", "ausente")

    def test_barreiras_do_post(self):
        par = {"a": "s1", "b": "s2"}
        for cab, sessao, status in (({"Origin": None}, True, 403), ({"Origin": "https://outro.example"}, True, 403),
                                    ({"Origin": None, "Referer": self.base + "/"}, True, 403),   # o Referer não substitui o Origin
                                    ({"Origin": "null"}, True, 403), ({}, False, 401),
                                    ({"Content-Type": "text/plain"}, True, 415)):
            with self.subTest(cab=cab, sessao=sessao):
                self.assertEqual(self.briga(par, cab, sessao)[0], status)
        self.assertIn('"resultado": "origem_recusada"', self.saida.getvalue())
        grande = json.dumps(par).encode() + b" " * 300   # JSON válido, acima de 256 B
        for corpo in (grande, {**par, "c": "x"}, {"a": "s1"}, {"a": "s1", "b": 2}, {"a": "", "b": "s2"}, {"a": "x" * 101, "b": "s2"},
                      b"[]", b"{nao e json"):
            with self.subTest(corpo=str(corpo)[:40]):
                self.assertEqual(self.briga(corpo), (400, {"erro": "pedido", "mensagem": "Pedido inválido."}))
        self.assertEqual(self.briga({"a": "s1", "b": "zz"})[1]["erro"], "agente")
        antes, self.srv.social = self.srv.social, None
        try:
            self.assertEqual(self.briga(par), (404, {"erro": "social_desligado",
                                                     "mensagem": "A vida social está desligada neste escritório."}))
        finally:
            self.srv.social = antes
        self.assertIsNone(self.srv.social.cena)
        self.assertNotIn("briga_ordem", self.saida.getvalue())   # recusa não loga, fora a de origem

    def test_ordem_aceita_aparece_no_estado_de_outra_sessao(self):
        st, corpo = self.briga({"a": "s1", "b": "s2"})
        self.assertEqual((st, corpo["cena"]["origem"], {corpo["cena"]["a"], corpo["cena"]["b"]}), (200, "ordem", {"s1", "s2"}))
        self.assertIn('"resultado": "briga_ordem", "usuario": "dono"', self.saida.getvalue())
        outra = self.entrar()   # outra sessão (outra tela): a mesma cena, igual para todos
        self.assertEqual(self.social_do_estado(outra)["cena"], corpo["cena"])
        st, ocupado = self.briga({"a": "s3", "b": "s4"})
        self.assertEqual((st, ocupado["erro"], ocupado["cena"]), (409, "ocupado", corpo["cena"]))
        self.srv.leitor.ocupados = {"s3"}   # a tarefa vem antes da cena na ordem das recusas
        self.assertEqual(self.briga({"a": "s3", "b": "s4"}), (409, {"erro": "trabalhando",
                                                                    "mensagem": "Um dos dois está trabalhando agora."}))
        self.assertEqual(self.briga({"a": "s1", "b": "s1"})[1]["erro"], "mesmo_agente")
        self.srv.social.cena = self.srv.social.fim_ultima = None
        self.srv.social.dia, self.srv.social.ordens_hoje = datetime.datetime.now(e.FUSO).date(), social.ORDENS_DIA
        st, corpo = self.briga({"a": "s1", "b": "s2"})
        self.assertEqual((st, corpo["erro"]), (429, "teto_dia"))

    def test_fora_do_expediente(self):
        agora = datetime.datetime.now(e.FUSO)
        self.expediente({"abre": (agora + datetime.timedelta(hours=1)).strftime("%H:%M"),
                         "fecha": (agora + datetime.timedelta(hours=2)).strftime("%H:%M")})
        st, corpo = self.briga({"a": "s1", "b": "s2"})
        self.assertEqual((st, corpo["erro"]), (409, "fora_do_expediente"))

    def test_modo_serio_pelo_personalizar(self):
        cab = {**self.entrar(), "Origin": self.base, "Content-Type": "application/json"}
        self.assertEqual(self.briga({"a": "s1", "b": "s2"})[0], 200)
        self.assertFalse(self.social_do_estado(cab)["serio"])
        marca = lambda **campos: self.req("/api/marca", cab, json.dumps({"empresa": "Acme", "cor": "#112233", **campos}).encode())
        st, corpo, _ = marca(serio=True)
        self.assertEqual((st, json.loads(corpo)["serio"]), (200, True))
        self.assertIsNone(self.srv.social.cena)   # a cena em curso sai na hora
        bloco = self.social_do_estado(cab)
        self.assertEqual(bloco, {"v": 1, "agora": bloco["agora"], "serio": True, "cena": None, "eventos": [], "placar": None})
        self.assertEqual(self.briga({"a": "s1", "b": "s2"})[1]["erro"], "modo_serio")
        self.assertEqual(marca(serio=False)[0], 200)
        self.assertFalse(self.social_do_estado(cab)["serio"])   # a outra tela vê na leitura seguinte

    def test_serio_no_marca_json(self):
        cab = {**self.entrar(), "Origin": self.base, "Content-Type": "application/json"}
        marca = lambda **campos: self.req("/api/marca", cab, json.dumps({"empresa": "Acme", "cor": "#112233", **campos}).encode())

        def salvo():
            with open(e.ARQ_MARCA, encoding="utf-8") as f:
                return json.load(f).get("serio", "sem")
        for valor in (True, False, True):
            self.assertEqual(marca(serio=valor)[0], 200)
            self.assertEqual(salvo(), valor)
        for ruim in ("true", 1, "false", [], {}):
            with self.subTest(ruim=ruim):
                st, corpo, _ = marca(serio=ruim)
                self.assertEqual((st, json.loads(corpo)), (400, {"erro": "modo sério: true ou false"}))
                self.assertIs(salvo(), True)   # recusado não grava nada
        self.assertEqual(marca(expediente={"abre": "08:00", "fecha": "18:00"})[0], 200)   # sem o campo, o valor salvo fica
        self.assertIs(salvo(), True)
        st, _, _ = self.req("/api/marca", cab, json.dumps({"empresa": "Acme", "cor": "#445566"}).encode())   # boas-vindas
        self.assertEqual((st, salvo()), (200, True))
        self.assertTrue(json.loads(self.req("/api/config", cab)[1])["serio"])
        os.unlink(e.ARQ_MARCA)
        self.assertFalse(e.config_publica()["serio"])   # o padrão é desligado

    def test_estado_com_campos_exatos_e_ate_4_kb(self):
        ids = [f"{n:08x}-0000-4000-8000-{n:012x}" for n in range(67)]
        self.srv.leitor.ids = ids
        s, agora = self.srv.social, time.time()
        s.ordenar(ids[0], ids[1], agora, self.srv.leitor.foto(), e.config_publica())
        for n in range(social.HISTORICO):   # o histórico cheio, com os tipos de nome mais longo
            s._evento(agora - n, "grampeador", ids[n % 67], ids[(n + 1) % 67])
        maximo = {"v": social.PLACAR_TETO, "d": social.PLACAR_TETO, "seq": -social.PLACAR_TETO}   # o placar com os maiores números
        s.placar, s.anterior = {i: dict(maximo) for i in ids}, {"id": ids[5], "v": social.PLACAR_TETO, "d": social.PLACAR_TETO}
        cab = self.entrar()
        bloco = self.social_do_estado(cab)
        self.assertEqual(set(bloco), {"v", "agora", "serio", "cena", "eventos", "placar"})
        self.assertEqual((set(bloco["placar"]), len(bloco["placar"]["top"])), ({"semana", "top", "anterior"}, 3))
        self.assertEqual(set(bloco["cena"]), {"id", "tipo", "a", "b", "vencedor", "inicio", "fim", "origem"})
        self.assertEqual(len(bloco["eventos"]), social.EVENTOS_NO_ESTADO)
        self.assertTrue(all(set(ev) == {"id", "tipo", "a", "b", "em"} for ev in bloco["eventos"]))
        self.assertLessEqual(len(json.dumps(bloco, ensure_ascii=False).encode()), 4096)
        self.assertRegex(bloco["agora"], r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
        antes = s.foto
        s.foto = lambda *a: 1 / 0   # a vida social nunca derruba o /api/estado
        try:
            self.assertEqual((self.social_do_estado(cab), self.social_do_estado(cab)), ("ausente", "ausente"))
            self.assertEqual(self.saida.getvalue().count('"evento": "social", "resultado": "erro", "detalhe": "ZeroDivisionError"'), 1)   # 1 por tipo
        finally:
            s.foto = antes
        self.srv.social = None
        self.assertEqual(self.social_do_estado(cab), "ausente")   # sem o diretor no servidor, a chave não vai

    def test_ficha_social(self):
        self.assertEqual(self.req("/api/social?agente=s1")[0], 401)
        cab = self.entrar()
        com_valor(self.srv.social, "s1", "s2", 99)
        st, corpo, _ = self.req("/api/social?agente=s1", cab)
        self.assertEqual((st, json.loads(corpo)["amigos"][0]), (200, {"id": "s2", "valor": 99}))
        for q, status, codigo in (("agente=", 400, "pedido"), ("", 400, "pedido"), ("agente=" + "x" * 101, 400, "pedido"),
                                  ("agente=zz", 404, "agente")):
            with self.subTest(q=q):
                st, corpo, _ = self.req(f"/api/social?{q}", cab)
                self.assertEqual((st, json.loads(corpo)["erro"]), (status, codigo))
        self.srv.social = None
        st, corpo, _ = self.req("/api/social?agente=s1", cab)
        self.assertEqual((st, json.loads(corpo)["erro"]), (404, "social_desligado"))

    def test_placar_do_ringue(self):
        self.assertEqual(self.req("/api/social/placar")[0], 401)
        cab = self.entrar()
        s = self.srv.social
        s.placar = {"s1": {"v": 3, "d": 0, "seq": 3}, "s2": {"v": 1, "d": 2, "seq": -1}, "fora": {"v": 9, "d": 0, "seq": 9}}
        s.anterior = {"id": "s3", "v": 4, "d": 1}
        st, corpo, _ = self.req("/api/social/placar", cab)
        dados = json.loads(corpo)
        self.assertEqual((st, set(dados), dados["anterior"]), (200, {"semana", "ranking", "anterior"}, {"id": "s3", "v": 4, "d": 1}))
        self.assertEqual([r["id"] for r in dados["ranking"]], ["s1", "s2"])   # quem não está na leitura não sai
        self.assertEqual([r["id"] for r in self.social_do_estado(cab)["placar"]["top"]], ["s1", "s2"])
        self.srv.social = None
        st, corpo, _ = self.req("/api/social/placar", cab)
        self.assertEqual((st, json.loads(corpo)["erro"]), (404, "social_desligado"))

    def atender(self, corpo, cab=None, sessao=True):
        if sessao and not self.sessao:
            self.sessao = self.entrar()
        cab = {"Origin": self.base, "Content-Type": "application/json", **(self.sessao if sessao else {}), **(cab or {})}
        st, dados, _ = self.req("/api/social/greve/atender", {k: v for k, v in cab.items() if v is not None},
                                corpo if isinstance(corpo, bytes) else json.dumps(corpo).encode())
        return st, json.loads(dados)

    def greve(self):
        """Uma greve de verdade, pelo passo do diretor: os quatro de valor baixo entre si e livres."""
        s = self.srv.social
        for a, b in itertools.combinations(self.IDS, 2):
            com_valor(s, a, b, 25)
        s.passo(time.time(), self.srv.leitor.foto(), e.config_publica())
        self.assertEqual(s.cena["tipo"], "greve")
        return s.cena["id"]

    def test_atender_greve_barreiras_serio_e_outra_sessao(self):
        for cab, sessao, status in (({"Origin": None}, True, 403), ({"Origin": None, "Referer": self.base + "/"}, True, 403),
                                    ({"Origin": "null"}, True, 403), ({}, False, 401), ({"Content-Type": "text/plain"}, True, 415)):
            with self.subTest(cab=cab, sessao=sessao):
                self.assertEqual(self.atender({"id": "abc"}, cab, sessao)[0], status)
        for corpo in ({"id": "abc", "a": "s1"}, {"a": "s1", "b": "s2"}, {"id": 3}, {"id": ""}, {"id": "x" * 101},
                      json.dumps({"id": "abc"}).encode() + b" " * 300):
            with self.subTest(corpo=str(corpo)[:40]):
                self.assertEqual(self.atender(corpo), (400, {"erro": "pedido", "mensagem": "Pedido inválido."}))
        self.assertEqual(self.atender({"id": "abc"}), (404, {"erro": "greve", "mensagem": "Essa greve já acabou."}))
        ident = self.greve()
        outra = self.entrar()   # a greve é igual para todos
        cena = self.social_do_estado(outra)["cena"]
        self.assertEqual((cena["id"], cena["tipo"], sorted(cena["participantes"])), (ident, "greve", self.IDS))
        st, _ = self.briga({"a": "s1", "b": "s2"})   # uma cena por vez
        self.assertEqual(st, 409)
        agora = datetime.datetime.now(e.FUSO)
        exp = {"abre": (agora - datetime.timedelta(hours=1)).strftime("%H:%M"), "fecha": (agora + datetime.timedelta(hours=2)).strftime("%H:%M")}
        self.expediente(exp, serio=True)
        self.assertEqual(self.atender({"id": ident})[1]["erro"], "modo_serio")
        self.assertIsNone(self.social_do_estado(outra)["cena"])   # o modo sério esconde a greve
        self.expediente(exp, serio=False)
        self.assertNotIn("greve_atendida", self.saida.getvalue())   # recusa não loga
        self.assertEqual(self.atender({"id": ident}), (200, {"cena": None}))
        self.assertIn('"resultado": "greve_atendida", "usuario": "dono"', self.saida.getvalue())
        bloco = self.social_do_estado(outra)
        self.assertIsNone(bloco["cena"])
        self.assertEqual((bloco["eventos"][0]["tipo"], bloco["eventos"][0]["greve"], bloco["eventos"][0]["motivo"]), ("atendida", ident, cena["motivo"]))
        self.assertEqual(self.atender({"id": ident})[0], 404)
        antes, self.srv.social = self.srv.social, None
        try:
            self.assertEqual(self.atender({"id": ident})[1]["erro"], "social_desligado")
        finally:
            self.srv.social = antes

    def test_estado_com_greve_ate_4_kb(self):
        ids = [f"{n:08x}-0000-4000-8000-{n:012x}" for n in range(67)]
        self.srv.leitor.ids = ids
        s, agora = self.srv.social, time.time()
        s.cena = {"id": "Qk3_x9Zt", "tipo": "greve", "participantes": ids[:social.GREVE_MAX], "motivo": 999, "inicio": agora,
                  "ate": agora + social.GREVE_DURA, "origem": "auto"}   # o pior caso: 8 grevistas, 9 fofocas e 1 atendida
        for n in range(social.EVENTOS_NO_ESTADO - 1):
            s._evento(agora - n, "fofoca", ids[n], ids[n + 1], sobre=ids[n + 2])
        s._evento(agora - 9, "atendida", greve="Qk3_x9Zt", motivo=999, participantes=ids[:social.GREVE_MAX])
        maximo = {"v": social.PLACAR_TETO, "d": social.PLACAR_TETO, "seq": -social.PLACAR_TETO}
        s.placar, s.anterior = {i: dict(maximo) for i in ids}, {"id": ids[5], "v": social.PLACAR_TETO, "d": social.PLACAR_TETO}
        bloco = self.social_do_estado(self.entrar())
        self.assertEqual(len(bloco["eventos"]), social.EVENTOS_NO_ESTADO)
        self.assertEqual({ev["tipo"]: set(ev) for ev in bloco["eventos"]}, {"fofoca": {"id", "tipo", "a", "b", "sobre", "em"},
                                                                   "atendida": {"id", "tipo", "greve", "motivo", "participantes", "em"}})
        self.assertLessEqual(len(json.dumps(bloco, ensure_ascii=False).encode()), 4096)

    def test_troca_de_conta_no_oauth_zera_o_social(self):
        class Cred:
            def concluir(self, code, state):
                pass
        com_valor(self.srv.social, "s1", "s2", 5)
        self.srv.social.ordenar("s3", "s4", time.time(), self.srv.leitor.foto(), e.config_publica())
        self.srv.cred = Cred()
        try:
            self.assertEqual(self.req("/oauth/retorno?code=c&state=s", self.entrar())[0], 302)
        finally:
            self.srv.cred = None
        self.assertEqual((self.srv.social.deltas, self.srv.social.cena, self.srv.social.ordens_hoje), ({}, None, 0))


def placar_valido(**muda):
    return {"v": 1, "semana": "2026-11-09", "placar": {"ag-a": {"v": 2, "d": 1, "seq": 1}, "ag-b": {"v": 1, "d": 2, "seq": -2}},
            "anterior": {"id": "ag-c", "v": 7, "d": 2}, **muda}


class SocialPlacar(unittest.TestCase):
    """Fatia 1c: placar semanal do ringue, com o campeão da semana passada, gravado em dados/placar.json."""
    IDS = ["ag-a", "ag-b", "ag-c", "ag-d"]

    def setUp(self):
        self.gravados, self.saida = [], io.StringIO()
        self.log = contextlib.redirect_stdout(self.saida)
        self.log.__enter__()

    def tearDown(self):
        self.log.__exit__(None, None, None)

    def diretor(self, placar=None, guardar=None):
        return social.Social(None, None, e.log, e.FUSO, random.Random(3), guardar=guardar or self.gravados.append, placar=placar)

    def briga(self, s, a, b, vencedor, t):
        """Uma briga mandada e assentada no passo seguinte (ninguém ocupado, sem colegas: nenhum sorteio mexe no resto)."""
        self.assertEqual(s.ordenar(a, b, t, leitura(self.IDS), CFG_SOZINHOS)[0], 200)
        s.cena["vencedor"] = vencedor
        s.passo(t + 60, leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)

    def test_conta_ranking_e_sequencia(self):
        s, t = self.diretor(), em_bsb("09:00")
        self.briga(s, "ag-a", "ag-b", "ag-a", t)
        self.briga(s, "ag-a", "ag-c", "ag-a", t + 120)
        self.briga(s, "ag-b", "ag-c", "ag-b", t + 240)
        self.assertEqual(s.placar, {"ag-a": {"v": 2, "d": 0, "seq": 2}, "ag-b": {"v": 1, "d": 1, "seq": 1},
                                    "ag-c": {"v": 0, "d": 2, "seq": -2}})
        r = s.ranking(t, {"ag-a", "ag-c", "ag-d"})   # só presentes, e só quem lutou
        self.assertEqual(r, {"semana": "2026-11-09", "anterior": None,
                             "ranking": [{"id": "ag-a", "v": 2, "d": 0, "seq": 2}, {"id": "ag-c", "v": 0, "d": 2, "seq": -2}]})
        self.assertEqual(s.foto(t, False, set(self.IDS))["placar"]["top"][1], {"id": "ag-b", "v": 1, "d": 1, "seq": 1})
        self.assertIsNone(s.foto(t, True, set(self.IDS))["placar"])   # modo sério: placar null, nada muda no guardado
        self.assertEqual(len(s.placar), 3)

    def test_cena_cancelada_nao_conta(self):
        s, t = self.diretor(), em_bsb("09:00")
        s.ordenar("ag-a", "ag-b", t, leitura(self.IDS), CFG_SOZINHOS)
        s.passo(t + 5, leitura(self.IDS, ocupados=["ag-a", "ag-c", "ag-d"]), CFG_SOZINHOS)   # pegou tarefa antes do início
        s.ordenar("ag-c", "ag-d", t + 10, leitura(self.IDS), CFG_SOZINHOS)
        s.cancelar(t + 30)   # modo sério no meio da luta
        s.passo(t + 120, leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)
        self.assertEqual((s.placar, self.gravados), ({}, []))

    def test_virada_da_semana_na_segunda_de_brasilia(self):
        s, domingo = self.diretor(), em_bsb("10:00", dia=15)
        self.briga(s, "ag-a", "ag-b", "ag-b", domingo)
        self.briga(s, "ag-c", "ag-d", "ag-c", domingo + 120)
        self.briga(s, "ag-b", "ag-c", "ag-b", domingo + 240)
        gravados = len(self.gravados)
        s.passo(em_bsb("22:30", dia=15), leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)   # já é segunda em UTC
        self.assertEqual((s.semana.isoformat(), len(s.placar), len(self.gravados)), ("2026-11-09", 4, gravados))
        s.passo(em_bsb("00:00", dia=16), leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)
        self.assertEqual((s.semana.isoformat(), s.placar, s.anterior), ("2026-11-16", {}, {"id": "ag-b", "v": 2, "d": 0}))
        self.assertEqual(json.loads(self.gravados[-1]), {"v": 1, "semana": "2026-11-16", "placar": {}, "anterior": {"id": "ag-b", "v": 2, "d": 0}})
        s.passo(em_bsb("00:00", dia=23), leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)
        self.assertIsNone(s.anterior)   # semana sem luta: ninguém é campeão
        self.assertEqual(social.campeao({"b": {"v": 1, "d": 0, "seq": 1}, "a": {"v": 1, "d": 0, "seq": 1}, "c": {"v": 1, "d": 1, "seq": 1}}),
                         {"id": "a", "v": 1, "d": 0})   # empate: menos derrotas, depois o menor id

    def test_teto_de_500_entradas(self):
        s, t = self.diretor(), em_bsb("09:00")
        s.passo(t - 60, leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)
        s.placar = {f"x{n:03d}": {"v": 2, "d": 0, "seq": 2} for n in range(social.PLACAR_MAX - 2)}
        s.placar.update({"a000": {"v": 1, "d": 0, "seq": 1}, "a001": {"v": 0, "d": 1, "seq": -1}})
        self.briga(s, "ag-a", "ag-b", "ag-a", t)   # 502 entradas: saem as 2 de menos lutas, com empate pelo id
        self.assertEqual(len(s.placar), social.PLACAR_MAX)
        self.assertEqual({"a000", "a001"} & set(s.placar), set())
        self.assertTrue({"ag-a", "ag-b"} <= set(s.placar))

    def test_so_grava_quando_o_placar_muda_e_tenta_de_novo_na_falha(self):
        s, t, lt = self.diretor(), em_bsb("09:00"), leitura(self.IDS, ocupados=self.IDS)
        for minuto in range(5):
            s.passo(t + minuto * 60, lt, CFG_SOZINHOS)
        self.assertEqual(self.gravados, [])   # nada mudou: não grava
        self.briga(s, "ag-a", "ag-b", "ag-a", t + 600)
        self.assertEqual(len(self.gravados), 1)
        self.assertEqual(json.loads(self.gravados[0])["placar"]["ag-a"], {"v": 1, "d": 0, "seq": 1})
        s.passo(t + 720, lt, CFG_SOZINHOS)
        self.assertEqual(len(self.gravados), 1)   # placar limpo: o passo seguinte não grava de novo
        tentativas = []

        def falha(dados):
            tentativas.append(dados)
            if len(tentativas) < 3:
                raise OSError("disco cheio")
            self.gravados.append(dados)
        s.guardar = falha
        self.briga(s, "ag-c", "ag-d", "ag-d", t + 900)
        s.passo(t + 1020, lt, CFG_SOZINHOS)
        s.passo(t + 1080, lt, CFG_SOZINHOS)
        self.assertEqual((len(tentativas), len(self.gravados)), (3, 2))   # tentou de novo a cada passo até gravar
        self.assertEqual(self.saida.getvalue().count('"resultado": "placar_nao_gravou"'), 1)   # 1 linha por episódio
        s.guardar = self.gravados.append
        s.zerar()   # troca de conta: o passo seguinte grava o vazio
        s.passo(t + 1140, lt, CFG_SOZINHOS)
        self.assertEqual(json.loads(self.gravados[-1]), {"v": 1, "semana": "2026-11-09", "placar": {}, "anterior": None})

    def test_get_e_post_nunca_gravam_so_o_passo(self):
        s, t, lt = self.diretor(), em_bsb("09:00"), leitura(self.IDS, ocupados=self.IDS)
        s.passo(t - 60, lt, CFG_SOZINHOS)   # semana alinhada e nada sujo
        self.assertEqual(s.ordenar("ag-a", "ag-b", t, leitura(self.IDS), CFG_SOZINHOS)[0], 200)
        s.cancelar(t + social.AVISO + social.LUTA)   # depois do fim: a briga conta fora do passo e o placar fica sujo
        self.assertEqual((s.sujo, sorted(s.placar)), (True, ["ag-a", "ag-b"]))
        for agora in (t + 50, t + 120):   # com o placar sujo, GET e POST (409 da folga e 200) não gravam
            s.foto(agora, False, set(self.IDS))
            s.foto(agora, True, set(self.IDS))
            s.ranking(agora, set(self.IDS))
            s.ordenar("ag-c", "ag-d", agora, leitura(self.IDS), CFG_SOZINHOS)
        self.assertIsNotNone(s.cena)
        s.cancelar(t + 125)   # antes do fim: sai sem contar
        self.assertEqual((self.gravados, s.sujo), ([], True))
        s.passo(t + 180, lt, CFG_SOZINHOS)
        s.passo(t + 240, lt, CFG_SOZINHOS)
        self.assertEqual(len(self.gravados), 1)   # só o passo grava, e uma vez
        self.assertEqual(sorted(json.loads(self.gravados[0])["placar"]), ["ag-a", "ag-b"])

    def test_id_fora_do_padrao_nao_entra_no_placar(self):
        s, t, ids = self.diretor(), em_bsb("09:00"), self.IDS + ["id com espaço"]
        self.assertEqual(s.ordenar("ag-a", "id com espaço", t, leitura(ids), CFG_SOZINHOS)[0], 200)
        s.cena["vencedor"] = "id com espaço"
        s.passo(t + 60, leitura(ids, ocupados=ids), CFG_SOZINHOS)
        self.assertEqual(s.placar, {"ag-a": {"v": 0, "d": 1, "seq": -1}})   # o outro lado conta
        self.assertEqual(e.validar_placar(json.loads(self.gravados[-1]))["placar"], s.placar)   # o arquivo segue legível

    def test_alinhamento_ao_subir(self):
        t, lt = em_bsb("09:00", dia=16), leitura(self.IDS, ocupados=self.IDS)
        mesma = e.validar_placar(placar_valido(semana="2026-11-16"))
        s = self.diretor(mesma)
        s.passo(t, lt, CFG_SOZINHOS)
        self.assertEqual((s.placar["ag-a"], s.anterior, self.gravados), ({"v": 2, "d": 1, "seq": 1}, {"id": "ag-c", "v": 7, "d": 2}, []))
        s = self.diretor(e.validar_placar(placar_valido()))   # a semana passada vira o anterior e o placar começa vazio
        s.passo(t, lt, CFG_SOZINHOS)
        self.assertEqual((s.placar, s.anterior, len(self.gravados)), ({}, {"id": "ag-a", "v": 2, "d": 1}, 1))
        for semana in ("2026-11-02", "2026-11-23"):   # mais velha ou no futuro: vazio
            with self.subTest(semana=semana):
                s = self.diretor(e.validar_placar(placar_valido(semana=semana)))
                s.passo(t, lt, CFG_SOZINHOS)
                self.assertEqual((s.placar, s.anterior), ({}, None))

    def test_500_entradas_nos_maiores_numeros_cabem_em_64_kb(self):
        s = self.diretor()
        s.semana = datetime.date(2026, 11, 9)
        maximo = {"v": social.PLACAR_TETO, "d": social.PLACAR_TETO, "seq": -social.PLACAR_TETO}
        s.placar = {f"{n:08x}-0000-4000-8000-{n:012x}": dict(maximo) for n in range(social.PLACAR_MAX)}   # ids do agentes.chat
        s.anterior = {"id": "00000000-0000-4000-8000-000000000000", "v": social.PLACAR_TETO, "d": social.PLACAR_TETO}
        dados = s._serializar()
        self.assertLessEqual(len(dados), social.PLACAR_BYTES)
        self.assertEqual(len(e.validar_placar(json.loads(dados))["placar"]), social.PLACAR_MAX)
        s.placar = {f"{n:03d}" + "x" * 97: dict(maximo) for n in range(social.PLACAR_MAX)}   # ids de 100: corta até caber
        dados = s._serializar()
        self.assertLessEqual(len(dados), social.PLACAR_BYTES)
        e.validar_placar(json.loads(dados))

    def test_ler_placar_tudo_ou_nada(self):
        antes = e.ARQ_PLACAR
        pasta = tempfile.mkdtemp(prefix="escritorio-placar-")
        e.ARQ_PLACAR = os.path.join(pasta, "placar.json")
        try:
            self.assertIsNone(e.ler_placar())   # ausente: vazio, sem log
            self.assertNotIn("placar_invalido", self.saida.getvalue())
            s, t = self.diretor(guardar=lambda dados: e.gravar(e.ARQ_PLACAR, dados)), em_bsb("09:00")
            self.briga(s, "ag-a", "ag-b", "ag-b", t)
            lido = e.ler_placar()   # ida e volta pelo disco, como num reinício
            self.assertEqual(lido, {"semana": "2026-11-09", "anterior": None,
                                    "placar": {"ag-a": {"v": 0, "d": 1, "seq": -1}, "ag-b": {"v": 1, "d": 0, "seq": 1}}})
            outro = self.diretor(lido)
            outro.passo(t + 120, leitura(self.IDS, ocupados=self.IDS), CFG_SOZINHOS)
            self.assertEqual(outro.ranking(t, set(self.IDS)), s.ranking(t, set(self.IDS)))
            entrada = {"v": 1, "d": 0, "seq": 1}
            ruins = {"json quebrado": b'{"v": 1, ', "não é objeto": b"[]", "v 2": placar_valido(v=2), "v true": placar_valido(v=True),
                     "semana fora do formato": placar_valido(semana="2026-11-9"), "semana numa terça": placar_valido(semana="2026-11-10"),
                     "data que não existe": placar_valido(semana="2026-02-30"),
                     "booleano no número": placar_valido(placar={"ag-a": {"v": True, "d": 0, "seq": 1}}),
                     "negativo": placar_valido(placar={"ag-a": {"v": -1, "d": 0, "seq": 1}}),
                     "grande demais": placar_valido(placar={"ag-a": {"v": social.PLACAR_TETO + 1, "d": 0, "seq": 1}}),
                     "seq fora": placar_valido(placar={"ag-a": {"v": 1, "d": 0, "seq": -social.PLACAR_TETO - 1}}),
                     "fração": placar_valido(placar={"ag-a": {"v": 1.0, "d": 0, "seq": 1}}),
                     "chave a mais": {**placar_valido(), "x": 1}, "chave a menos": {k: v for k, v in placar_valido().items() if k != "anterior"},
                     "entrada com chave a mais": placar_valido(placar={"ag-a": {**entrada, "x": 1}}),
                     "entrada com chave a menos": placar_valido(placar={"ag-a": {"v": 1, "d": 0}}),
                     "id com controle": placar_valido(placar={"ag\x01a": entrada}), "id com quebra": placar_valido(placar={"ag-a\n": entrada}),
                     "id de 101": placar_valido(placar={"a" * 101: entrada}), "id vazio": placar_valido(placar={"": entrada}),
                     "501 entradas": placar_valido(placar={f"a{n}": entrada for n in range(social.PLACAR_MAX + 1)}),
                     "anterior sem d": placar_valido(anterior={"id": "ag-c", "v": 7}),
                     "anterior com id ruim": placar_valido(anterior={"id": "a b", "v": 7, "d": 2}),
                     "anterior texto": placar_valido(anterior="ag-c")}
            for nome, conteudo in ruins.items():
                with self.subTest(nome=nome):
                    with open(e.ARQ_PLACAR, "wb") as f:
                        f.write(conteudo if isinstance(conteudo, bytes) else json.dumps(conteudo).encode())
                    antes_log = self.saida.getvalue().count('"resultado": "placar_invalido"')
                    self.assertIsNone(e.ler_placar())
                    self.assertEqual(self.saida.getvalue().count('"resultado": "placar_invalido"'), antes_log + 1)
            with open(e.ARQ_PLACAR, "w", encoding="utf-8") as f:
                json.dump(placar_valido(), f)
            self.assertEqual(e.ler_placar()["anterior"], {"id": "ag-c", "v": 7, "d": 2})
            valido = json.dumps(placar_valido()).encode()   # o teto é do tamanho: o mesmo JSON válido, completado com espaços
            for tamanho, aceito in ((social.PLACAR_BYTES, True), (social.PLACAR_BYTES + 1, False)):
                with self.subTest(tamanho=tamanho):
                    with open(e.ARQ_PLACAR, "wb") as f:
                        f.write(valido + b" " * (tamanho - len(valido)))
                    antes_log = self.saida.getvalue().count('"resultado": "placar_invalido"')
                    self.assertEqual(e.ler_placar() is not None, aceito)
                    self.assertEqual(self.saida.getvalue().count('"resultado": "placar_invalido"'), antes_log + (not aceito))
        finally:
            e.ARQ_PLACAR = antes
            shutil.rmtree(pasta, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
