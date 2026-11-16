# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""migracao_saguao.py: ida e volta com os arquivos do principal e os três tipos de conta, tudo ou nada, refazer sem
estragar, retomar depois de uma queda, "desfazer" recusado com dado novo, a trava do serviço e o subcomando."""
import contextlib
import io
import json
import os
import shutil
import tempfile
import time
import unittest
from unittest import mock

import andares
import conversas_equipe
import linha
import migracao_saguao as ms
from migracao_saguao import MigracaoRecusada, ServicoRodando

ORG = "11111111-2222-3333-4444-555555555555"
ORG_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
EXTRA = "abcd1234"
FORA = (ms.ARQ_DIARIO, ms.ARQ_TRAVA)   # o diário e a trava ficam depois de desfazer: o resto volta igual
SEGREDO = "token-secreto-do-oauth-9911"


def foto(*pastas):
    """Tudo o que existe nas pastas: caminho -> bytes (ou "pasta"), sem o diário e a trava."""
    tudo = {}
    for raiz in pastas:
        for atual, subpastas, arquivos in os.walk(raiz):
            for p in subpastas:
                tudo[os.path.relpath(os.path.join(atual, p), raiz) + "/"] = "pasta"
            for a in arquivos:
                rel = os.path.relpath(os.path.join(atual, a), raiz)
                if rel in FORA:
                    continue
                with open(os.path.join(atual, a), "rb") as f:
                    tudo[(raiz, rel)] = f.read()
    return tudo


class Base(unittest.TestCase):
    def setUp(self):
        self.raiz = tempfile.mkdtemp(prefix="esc-saguao-")
        self.addCleanup(shutil.rmtree, self.raiz, True)
        self.dados = os.path.join(self.raiz, "dados")
        self.codigo = os.path.join(self.raiz, "app")
        os.makedirs(self.dados)
        os.makedirs(self.codigo)
        self.times = os.path.join(self.codigo, "times.json")
        self.escreve(self.times, '{"conversas": "ler"}')
        for nome, conteudo in (("oauth.json", '{"access_token": "%s"}' % SEGREDO), ("equipe.json", '{"rev": 1}'),
                               ("planta.json", '{"rev": 2}'), ("placar.json", '{"semana": 1}'),
                               ("jornal.json", '{"dias": []}'), ("marca.json", '{"empresa": "Dev Maniac\'s", "cor": "#123456"}'),
                               ("push.json", "[]"), ("sessoes.json", "{}"), ("vapid.json", "{}")):
            self.escreve(os.path.join(self.dados, nome), conteudo)
        os.makedirs(os.path.join(self.dados, linha.PASTA))   # a linha do tempo dos agentes (1.6 Onda 2b): da empresa
        self.escreve(os.path.join(self.dados, linha.PASTA, "2026-11-16.jsonl"), '{"t": 1}\n')
        with open(os.path.join(self.dados, "logo.img"), "wb") as f:
            f.write(b"\x89PNG\r\n\x1a\nlogo")
        self.escreve(os.path.join(self.dados, "andares.json"),
                     json.dumps({"v": 1, "andares": [{"id": EXTRA, "nome": "Empresa B", "org": ORG_B}]}))
        os.makedirs(os.path.join(self.dados, "andares", EXTRA))
        self.escreve(os.path.join(self.dados, "andares", EXTRA, "times.json"), "{}")
        self.usuarios({
            "ana": {"andares": {"principal": "membro"}},                     # só o principal
            "chefe": {"andares": {"principal": "admin", EXTRA: "membro"}},   # admin do principal
            "velho": {"sal": "00"},                                          # conta antiga, sem "andares" = admin
            "misto": {"andares": {"principal": "membro", EXTRA: "membro"}},  # principal + extra: não ganha
            "bia": {"andares": {EXTRA: "admin"}},                            # só o extra
        })

    def escreve(self, caminho, texto):
        with open(caminho, "w", encoding="utf-8") as f:
            f.write(texto)

    def le(self, *partes):
        with open(os.path.join(self.dados, *partes), encoding="utf-8") as f:
            return json.load(f)

    def usuarios(self, contas):
        self.escreve(os.path.join(self.dados, "usuarios.json"), json.dumps(contas))

    def migrar(self, **k):
        return ms.migrar(self.dados, times=self.times, org=ORG, **k)


class IdaEVolta(Base):
    def test_ida_e_volta_com_os_arquivos_e_os_tres_tipos_de_conta(self):
        antes = foto(self.dados, self.codigo)
        rel = self.migrar()
        novo = rel["andar"]
        self.assertEqual(rel["resultado"], "migrado")
        self.assertRegex(novo, r"^[0-9a-f]{8}$")
        self.assertNotEqual(novo, EXTRA)
        self.assertEqual(self.le("andares.json"), {"v": 2, "terreo": "saguao", "andares": [
            {"id": novo, "nome": "Dev Maniac's", "org": ORG}, {"id": EXTRA, "nome": "Empresa B", "org": ORG_B}]})
        pasta = os.path.join(self.dados, "andares", novo)
        for nome in ms.MOVER[:5]:
            self.assertTrue(os.path.isfile(os.path.join(pasta, nome)), nome)
            self.assertFalse(os.path.exists(os.path.join(self.dados, nome)), nome)
        self.assertTrue(os.path.isfile(os.path.join(pasta, linha.PASTA, "2026-11-16.jsonl")))   # a linha vai inteira
        self.assertFalse(os.path.exists(os.path.join(self.dados, linha.PASTA)))
        for nome, origem in (("times.json", self.times), ("marca.json", os.path.join(self.dados, "marca.json")),
                             ("logo.img", os.path.join(self.dados, "logo.img"))):
            with open(origem, "rb") as a, open(os.path.join(pasta, nome), "rb") as b:
                self.assertEqual(a.read(), b.read(), nome)   # copiado: a raiz continua com o seu
        for nome in ("push.json", "sessoes.json", "vapid.json", "usuarios.json"):
            self.assertTrue(os.path.isfile(os.path.join(self.dados, nome)), nome)   # do prédio: ficam
        contas = self.le("usuarios.json")
        self.assertEqual(contas["ana"]["andares"], {"principal": "membro", novo: "membro"})
        self.assertEqual(contas["chefe"]["andares"], {"principal": "admin", EXTRA: "membro", novo: "admin"})
        self.assertEqual(contas["velho"]["andares"], {"principal": "admin", novo: "admin"})
        self.assertEqual(contas["misto"]["andares"], {"principal": "membro", EXTRA: "membro"})
        self.assertEqual(contas["bia"]["andares"], {EXTRA: "admin"})
        self.assertEqual(rel["pendentes"], ["misto"])
        self.assertEqual(rel["contas"], {"ana": "membro", "chefe": "admin", "velho": "admin"})
        diario = self.le(ms.ARQ_DIARIO)
        self.assertEqual((diario["estado"], ms.estado(self.dados)), ("feito", "feito"))
        self.assertNotIn("copia_de_antes", diario)   # terminada, a cópia sai (o backup do volume cobre)
        volta = self.migrar(desfazer=True)
        self.assertEqual(volta["resultado"], "desfeito")
        self.assertEqual(foto(self.dados, self.codigo), antes)
        self.assertNotIn("copia_de_antes", self.le(ms.ARQ_DIARIO))
        self.assertEqual(ms.estado(self.dados), "desfeito")
        self.assertEqual(andares.Andares(self.dados, ORG).lista, [{"id": EXTRA, "nome": "Empresa B", "org": ORG_B}])
        self.assertEqual(self.migrar(desfazer=True)["resultado"], "ja_desfeito")
        self.assertEqual(self.migrar()["resultado"], "migrado")   # e vai de novo depois de desfeita

    def test_sem_andares_json_e_times_no_volume(self):
        os.unlink(os.path.join(self.dados, "andares.json"))
        shutil.rmtree(os.path.join(self.dados, "andares"))
        self.times = os.path.join(self.dados, "times.json")   # o caso do Docker (ESCRITORIO_TIMES=/dados/times.json)
        self.escreve(self.times, '{"conversas": "responder"}')
        antes = foto(self.dados, self.codigo)
        novo = self.migrar()["andar"]
        self.assertEqual(self.le("andares.json")["andares"], [{"id": novo, "nome": "Dev Maniac's", "org": ORG}])
        self.assertTrue(os.path.isfile(self.times))
        self.assertEqual(self.le("andares", novo, "times.json"), {"conversas": "responder"})
        self.migrar(desfazer=True)
        self.assertEqual(foto(self.dados, self.codigo), antes)
        self.assertFalse(os.path.exists(os.path.join(self.dados, "andares.json")))   # v1 de antes = nenhum
        self.assertFalse(os.path.exists(os.path.join(self.dados, "andares")))

    def test_o_chat_da_empresa_nunca_vira_o_do_saguao(self):
        eq = conversas_equipe.Equipe(self.dados)
        eq.enviar("geral", "ana", "Ana", "conversa interna")
        eq.fechar()
        os.makedirs(os.path.join(self.dados, conversas_equipe.ANEXOS))
        self.escreve(os.path.join(self.dados, conversas_equipe.ANEXOS, "0" * 32), "x")
        antes = foto(self.dados, self.codigo)
        novo = self.migrar()["andar"]
        self.assertFalse(os.path.exists(os.path.join(self.dados, conversas_equipe.ARQ)))
        self.assertFalse(os.path.exists(os.path.join(self.dados, conversas_equipe.ANEXOS)))
        eq = conversas_equipe.Equipe(os.path.join(self.dados, "andares", novo))
        self.assertEqual([m["texto"] for m in eq.historico("ana", "geral")], ["conversa interna"])
        eq.fechar()
        self.migrar(desfazer=True)
        self.assertEqual(foto(self.dados, self.codigo), antes)

    def test_nome_fora_do_formato_vira_o_padrao(self):
        self.escreve(os.path.join(self.dados, "marca.json"), '{"empresa": "<b>x</b>"}')
        self.assertEqual(self.migrar()["nome"], ms.NOME_PADRAO)
        andares_v2 = self.le("andares.json")["andares"]
        self.assertEqual(andares_v2[0]["nome"], ms.NOME_PADRAO)


class Refazer(Base):
    def test_rodar_de_novo_nao_estraga(self):
        rel = self.migrar()
        depois = foto(self.dados, self.codigo)
        de_novo = self.migrar()
        self.assertEqual((de_novo["resultado"], de_novo["andar"]), ("ja_migrado", rel["andar"]))
        self.assertEqual(foto(self.dados, self.codigo), depois)

    def test_tudo_ou_nada(self):
        antes = foto(self.dados, self.codigo)
        real = os.replace
        for falha in range(1, 13):   # cada os.replace da ida: diário, cópias, mudanças, contas, andares
            with self.subTest(falha=falha):
                chamadas = [0]

                def troca(a, b):
                    chamadas[0] += 1
                    if chamadas[0] == falha:
                        raise OSError("disco")
                    return real(a, b)
                with mock.patch.object(ms.os, "replace", troca):
                    with self.assertRaises(OSError):
                        self.migrar()
                self.assertEqual(foto(self.dados, self.codigo), antes)
                self.assertFalse(os.path.exists(os.path.join(self.dados, ms.ARQ_DIARIO)))
        self.assertEqual(self.migrar()["resultado"], "migrado")

    def test_retoma_depois_de_uma_queda_no_meio(self):
        antes = foto(self.dados, self.codigo)
        real = os.replace
        chamadas = [0]

        def cai(a, b):
            chamadas[0] += 1
            if chamadas[0] == 4:
                raise KeyboardInterrupt   # o processo morreu: sem tempo de desfazer
            return real(a, b)
        with mock.patch.object(ms, "_reverter", side_effect=KeyboardInterrupt), mock.patch.object(ms.os, "replace", cai):
            with self.assertRaises(KeyboardInterrupt):
                self.migrar()
        diario = self.le(ms.ARQ_DIARIO)
        self.assertEqual((diario["estado"], ms.estado(self.dados)), ("em_andamento", "em_andamento"))
        for nome in ("usuarios.json", "andares.json"):   # no meio do caminho, a cópia de antes fica no diário (0600)
            self.assertEqual(diario["copia_de_antes"][nome], antes[(self.dados, nome)].decode("utf-8"))
        rel = self.migrar()
        self.assertEqual(rel["resultado"], "migrado")
        self.assertEqual(rel["andar"], self.le(ms.ARQ_DIARIO)["andar"])
        contas = self.le("usuarios.json")
        self.assertEqual(contas["ana"]["andares"], {"principal": "membro", rel["andar"]: "membro"})
        self.migrar(desfazer=True)
        self.assertEqual(foto(self.dados, self.codigo), antes)

    def test_desfazer_uma_migracao_que_caiu_no_meio(self):
        antes = foto(self.dados, self.codigo)
        real = os.replace
        chamadas = [0]

        def cai(a, b):
            chamadas[0] += 1
            if chamadas[0] == 3:
                raise KeyboardInterrupt
            return real(a, b)
        with mock.patch.object(ms, "_reverter", side_effect=KeyboardInterrupt), mock.patch.object(ms.os, "replace", cai):
            with self.assertRaises(KeyboardInterrupt):
                self.migrar()
        self.assertEqual(self.migrar(desfazer=True)["resultado"], "desfeito")
        self.assertEqual(foto(self.dados, self.codigo), antes)


class DesfazerComDadoNovo(Base):
    def recusa(self, preparar, trecho):
        rel = self.migrar()
        pasta = os.path.join(self.dados, "andares", rel["andar"])
        preparar(pasta, rel["andar"])
        antes = foto(self.dados, self.codigo)
        with self.assertRaises(MigracaoRecusada) as cx:
            self.migrar(desfazer=True)
        self.assertIn(trecho, str(cx.exception))
        self.assertEqual(foto(self.dados, self.codigo), antes)   # recusou sem mexer em nada
        self.assertEqual(self.le(ms.ARQ_DIARIO)["estado"], "feito")

    def test_historico_no_andar_novo(self):
        def conversa(pasta, _):
            eq = conversas_equipe.Equipe(pasta)
            eq.enviar("geral", "ana", "Ana", "nova")
            eq.fechar()
        self.recusa(conversa, conversas_equipe.ARQ)

    def test_anexo_no_andar_novo(self):
        def anexo(pasta, _):
            os.makedirs(os.path.join(pasta, conversas_equipe.ANEXOS))
            self.escreve(os.path.join(pasta, conversas_equipe.ANEXOS, "0" * 32), "x")
        self.recusa(anexo, conversas_equipe.ANEXOS)

    def test_aviso_no_saguao(self):
        def aviso(*_):
            eq = conversas_equipe.Equipe(self.dados, saguao=True)
            eq.fixar("geral", "bia", "Bia", "aviso do prédio")
            eq.fechar()
        self.recusa(aviso, "saguão")

    def test_conversa_no_saguao(self):
        def saguao(*_):
            eq = conversas_equipe.Equipe(self.dados, saguao=True)
            eq.enviar("geral", "bia", "Bia", "oi, prédio")
            eq.fechar()
        self.recusa(saguao, "saguão")

    def test_arquivo_que_voltou_para_a_raiz(self):
        self.recusa(lambda *_: self.escreve(os.path.join(self.dados, "oauth.json"), "{}"), "oauth.json")

    def test_marca_mudada_no_andar(self):
        self.recusa(lambda pasta, _: self.escreve(os.path.join(pasta, "marca.json"), '{"empresa": "Nova"}'), "marca.json")

    def test_conta_nova_no_andar(self):
        def conta(_, novo):
            contas = self.le("usuarios.json")
            contas["novata"] = {"andares": {novo: "membro"}}
            self.usuarios(contas)
        self.recusa(conta, "novata")

    def test_subiu_nao_escreveu_desfaz(self):
        """O serviço abriu as conversas do andar e do saguão (e um envio deixou anexos/ vazio), sem escrever: não é dado
        novo, e o desfazer apaga os bancos vazios. Com e sem o chat da empresa de antes."""
        for com_chat in (False, True):
            with self.subTest(com_chat=com_chat):
                if com_chat:
                    eq = conversas_equipe.Equipe(self.dados)
                    eq.enviar("geral", "ana", "Ana", "conversa interna")
                    eq.fechar()
                antes = foto(self.dados, self.codigo)
                novo = self.migrar()["andar"]
                pasta = os.path.join(self.dados, "andares", novo)
                andar = conversas_equipe.Equipe(pasta)
                saguao = conversas_equipe.Equipe(self.dados, saguao=True)
                self.assertEqual(saguao.historico("bia", "geral"), [])
                andar.liberar(andar.reservar("ana", 10))   # anexos/ criado, sem arquivo
                andar.fechar()
                saguao.fechar()
                self.assertEqual(self.migrar(desfazer=True)["resultado"], "desfeito")
                self.assertEqual(foto(self.dados, self.codigo), antes)
                os.unlink(os.path.join(self.dados, ms.ARQ_DIARIO))

    def test_mudanca_que_volta_junto_nao_recusa(self):
        rel = self.migrar()
        pasta = os.path.join(self.dados, "andares", rel["andar"])
        self.escreve(os.path.join(pasta, "planta.json"), '{"rev": 9}')   # movido: volta com a mudança
        contas = self.le("usuarios.json")
        contas["ana"]["andares"][rel["andar"]] = "admin"   # papel mudado no andar: só sai
        self.usuarios(contas)
        self.migrar(desfazer=True)
        self.assertEqual(self.le("planta.json"), {"rev": 9})
        self.assertEqual(self.le("usuarios.json")["ana"]["andares"], {"principal": "membro"})


class Recusas(Base):
    def test_servico_rodando(self):
        fd = ms.travar(self.dados)
        try:
            with self.assertRaises(ServicoRodando):
                self.migrar()
            with self.assertRaises(ServicoRodando):
                ms.travar(self.dados)
        finally:
            ms.soltar(fd)
        ms.soltar(ms.travar(self.dados))   # solta: o próximo pega

    def test_entradas_ruins(self):
        antes = foto(self.dados, self.codigo)
        casos = {
            "org": lambda: ms.migrar(self.dados, times=self.times, org="não-é-org"),
            "andares ilegível": lambda: (self.escreve(os.path.join(self.dados, "andares.json"), "{"), self.migrar()),
            "v2 sem diário": lambda: (self.escreve(os.path.join(self.dados, "andares.json"),
                                                   json.dumps({"v": 2, "terreo": "saguao", "andares": []})), self.migrar()),
            "usuarios ilegível": lambda: (self.escreve(os.path.join(self.dados, "usuarios.json"), "["), self.migrar()),
            "desfazer sem diário": lambda: self.migrar(desfazer=True),
        }
        for nome, rodar in casos.items():
            with self.subTest(caso=nome):
                with open(os.path.join(self.dados, "andares.json"), "rb") as f:
                    andares_json = f.read()
                with open(os.path.join(self.dados, "usuarios.json"), "rb") as f:
                    usuarios_json = f.read()
                with self.assertRaises(MigracaoRecusada):
                    rodar()
                with open(os.path.join(self.dados, "andares.json"), "wb") as f:
                    f.write(andares_json)
                with open(os.path.join(self.dados, "usuarios.json"), "wb") as f:
                    f.write(usuarios_json)
                self.assertEqual(foto(self.dados, self.codigo), antes)
                self.assertFalse(os.path.exists(os.path.join(self.dados, ms.ARQ_DIARIO)))

    def test_outro_usuario_que_nao_o_dono_dos_dados(self):
        """Rodar como root (sudo sem -u) deixaria arquivos que o serviço não grava mais."""
        dono = os.stat(self.dados).st_uid
        with mock.patch.object(ms.os, "geteuid", create=True, return_value=dono + 1):
            with self.assertRaises(MigracaoRecusada) as cx:
                self.migrar()
        self.assertIn("dono", str(cx.exception))
        self.assertFalse(os.path.exists(os.path.join(self.dados, ms.ARQ_TRAVA)))   # recusou antes de criar a trava
        with mock.patch.object(ms.os, "geteuid", create=True, return_value=dono):
            self.assertEqual(self.migrar()["resultado"], "migrado")

    def test_estado_para_o_servico(self):
        self.assertEqual(ms.estado(self.dados), "nenhum")
        self.migrar()
        diario = self.le(ms.ARQ_DIARIO)
        for estado in ("desfazendo", "em_andamento"):
            self.escreve(os.path.join(self.dados, ms.ARQ_DIARIO), json.dumps({**diario, "estado": estado}))
            self.assertEqual(ms.estado(self.dados), estado)
        for ruim in ("{", "[]", json.dumps({**diario, "estado": "outro"})):
            with self.subTest(diario=ruim):
                self.escreve(os.path.join(self.dados, ms.ARQ_DIARIO), ruim)
                with self.assertRaises(MigracaoRecusada):
                    ms.estado(self.dados)

    def test_predio_cheio(self):
        lista = [{"id": f"{i:08x}", "nome": f"E{i}", "org": f"{i:08x}-bbbb-cccc-dddd-eeeeeeeeeeee"}
                 for i in range(andares.MAX_EXTRAS)]
        self.escreve(os.path.join(self.dados, "andares.json"), json.dumps({"v": 1, "andares": lista}))
        with self.assertRaises(MigracaoRecusada):
            self.migrar()

    def test_sem_espaco(self):
        with mock.patch.object(ms.shutil, "disk_usage", return_value=mock.Mock(total=10, used=9, free=1)):
            with self.assertRaises(MigracaoRecusada):
                self.migrar()
        self.assertFalse(os.path.exists(os.path.join(self.dados, ms.ARQ_DIARIO)))


class Subcomando(Base):
    def roda(self, argv):
        saida, erro = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erro):
            codigo = ms.principal(argv, self.dados, self.times, ORG)
        return codigo, saida.getvalue(), erro.getvalue()

    def test_ida_volta_e_uso(self):
        agora = int(time.time())
        self.escreve(os.path.join(self.dados, "convites.json"), json.dumps({
            "c1": {"sha": "sha-secreto", "nome": "Convite da Duda", "andares": ["principal"], "expira": agora + 3600},
            "c2": {"sha": "sha-secreto", "nome": "Convite do Extra", "andares": [EXTRA], "expira": agora + 3600},
            "c3": {"sha": "sha-secreto", "nome": "Convite vencido", "andares": ["principal"], "expira": agora - 1}}))
        codigo, saida, erro = self.roda([])
        self.assertEqual((codigo, erro), (0, ""))
        self.assertIn("misto", saida)   # o login pendente aparece para o admin dar o andar pela tela
        self.assertIn("Convite da Duda", saida)   # o convite que dá o principal, só pelo nome
        self.assertNotIn("Convite do Extra", saida)
        self.assertNotIn("Convite vencido", saida)
        self.assertNotIn("sha-secreto", saida)
        self.assertNotIn(SEGREDO, saida)   # nunca o conteúdo dos arquivos
        self.assertEqual(self.roda(["--desfazer"])[0], 0)
        self.assertEqual(self.roda(["--qualquer"])[0], 2)
        self.assertEqual(self.roda(["--desfazer", "x"])[0], 2)
        codigo, _, erro = self.roda(["--desfazer"])
        self.assertEqual(codigo, 0)
        fd = ms.travar(self.dados)
        try:
            codigo, saida, erro = self.roda([])
        finally:
            ms.soltar(fd)
        self.assertEqual((codigo, saida), (1, ""))
        self.assertIn("parado", erro)


if __name__ == "__main__":
    unittest.main()
