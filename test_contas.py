# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Testes de unidade de contas, papéis, perfil e sessões por pessoa em acesso.py."""
import hashlib
import json
import os
import secrets
import shutil
import tempfile
import threading
import time
import unittest

import acesso
from acesso import (
    ANDAR_PRINCIPAL,
    Acesso,
    ContaExiste,
    ConviteInvalido,
    ConvitesDemais,
    NaoGravou,
    UltimoAdmin,
)

AVATAR = {"color": "teal", "eyes": "happy", "accessory": ""}
SENHA = "senha-da-pessoa-1"


def em_paralelo(chamadas):
    """Executa uma lista de callables ao mesmo tempo e devolve [(indice, ok, valor_ou_erro)]."""
    resultados = [None] * len(chamadas)

    def rodar(i, fn):
        try:
            resultados[i] = (i, True, fn())
        except Exception as err:
            resultados[i] = (i, False, err)

    fios = [threading.Thread(target=rodar, args=(i, fn)) for i, fn in enumerate(chamadas)]
    for f in fios:
        f.start()
    for f in fios:
        f.join()
    return resultados


class ContasUnidade(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="contas-")
        self.addCleanup(shutil.rmtree, self.pasta, ignore_errors=True)
        self.a = Acesso(self.pasta)

    def codigo(self):
        with open(os.path.join(self.pasta, "codigo-primeiro-acesso.txt"), encoding="utf-8") as f:
            return f.read().strip()

    def criar_dono(self):
        self.a.criar_primeiro(self.codigo(), "dono", "senha-bem-grande")

    def conta(self, usuario, nome="Pessoa", andares=()):
        """Conta de membro pelo caminho de verdade: convite e aceite. Devolve o token da sessão aberta no aceite."""
        token, _ = self.a.convidar(nome, list(andares))
        return self.a.aceitar_convite(token, usuario, SENHA, nome, AVATAR)

    def test_t1_retrocompativel_sem_andares_sobe_como_admin_e_mantem_sessao(self):
        pasta_legado = tempfile.mkdtemp(prefix="legado-")
        self.addCleanup(shutil.rmtree, pasta_legado, ignore_errors=True)
        sal = secrets.token_bytes(16)
        h = acesso._hash("senha-legada-123", sal)
        with open(os.path.join(pasta_legado, "usuarios.json"), "w", encoding="utf-8") as f:
            json.dump({
                "dono": {
                    "sal": sal.hex(),
                    "hash": h.hex(),
                    "n": acesso.N,
                    "r": acesso.R,
                    "p": acesso.P,
                    "criado": 1700000000,
                }
            }, f)
        token = "token-antigo-do-navegador"
        sha = hashlib.sha256(token.encode()).hexdigest()
        with open(os.path.join(pasta_legado, "sessoes.json"), "w", encoding="utf-8") as f:
            json.dump({sha: {"usuario": "dono", "expira": time.time() + 3600}}, f)

        acc = Acesso(pasta_legado)
        self.assertEqual(acc.sessao(token), "dono")
        self.assertEqual(acc.papel("dono"), "admin")
        self.assertEqual(acc.papel("dono", "segundo-andar"), None)
        self.assertEqual(acc.perfil("dono"), {
            "usuario": "dono",
            "nome": "dono",
            "avatar": None,
            "papel": "admin",
        })

    def test_t2_primeiro_acesso_grava_andares_principal_admin(self):
        self.criar_dono()
        self.assertEqual(self.a.papel("dono"), "admin")
        with open(os.path.join(self.pasta, "usuarios.json"), encoding="utf-8") as f:
            dados = json.load(f)
        self.assertEqual(dados["dono"]["andares"], {ANDAR_PRINCIPAL: "admin"})

    def test_convite_vira_conta_de_membro_e_lista_sem_segredos(self):
        self.criar_dono()
        token, publico = self.a.convidar("  Maria Silva ", ["a1b2c3d4", "principal", "a1b2c3d4"], agora=1000)
        self.assertEqual(len(token), 43)
        self.assertEqual(publico["andares"], ["principal", "a1b2c3d4"])   # o principal sempre, sem repetir
        self.assertEqual(self.a.ver_convite(token, agora=1001), {"nome": "Maria Silva", "expira": "1970-01-03T00:16:40Z"})
        with open(os.path.join(self.pasta, "convites.json"), encoding="utf-8") as f:
            disco = f.read()
        self.assertNotIn(token, disco)   # só o sha256
        self.assertIn(hashlib.sha256(token.encode()).hexdigest(), disco)

        sessao = self.a.aceitar_convite(token, "Maria.Silva", SENHA, "Maria", AVATAR, agora=1002)
        self.assertEqual(self.a.sessao(sessao), "maria.silva")   # já entra
        self.assertEqual(self.a.papel("maria.silva"), "membro")
        self.assertEqual(self.a.papel("maria.silva", "a1b2c3d4"), "membro")
        self.assertIsNone(self.a.papel("maria.silva", "ffffffff"))
        self.assertEqual(self.a.perfil("maria.silva"), {"usuario": "maria.silva", "nome": "Maria", "avatar": AVATAR,
                                                        "papel": "membro"})
        self.assertEqual(self.a.sessao(self.a.entrar("maria.silva", SENHA)), "maria.silva")   # a senha é a que ela escolheu
        self.assertEqual(self.a.convites_pendentes(agora=1003), [])   # uso único

        lista = self.a.contas()
        self.assertEqual(sorted((c["usuario"], c["papel"], c["andares"]) for c in lista),
                         [("dono", "admin", ["principal"]), ("maria.silva", "membro", ["principal", "a1b2c3d4"])])
        for c in lista:
            self.assertEqual(set(c), {"usuario", "nome", "papel", "andares", "criado"})

    def test_convite_usado_vencido_revogado_ou_estranho_nao_vale(self):
        self.criar_dono()
        usado, _ = self.a.convidar("Ana", [], agora=1000)
        self.a.aceitar_convite(usado, "ana", SENHA, "Ana", AVATAR, agora=1001)
        vencido, _ = self.a.convidar("Bia", [], agora=1000)
        revogado, pub = self.a.convidar("Caio", [], agora=1000)
        self.a.revogar_convite(pub["id"])
        depois = 1000 + acesso.CONVITE_VALIDADE
        for token, agora in ((usado, 1002), (vencido, depois), (revogado, 1002), ("x" * 43, 1002), ("", 1002), (None, 1002)):
            with self.subTest(token=str(token)[:6], agora=agora):
                with self.assertRaises(ConviteInvalido):
                    self.a.ver_convite(token, agora=agora)
                with self.assertRaises(ConviteInvalido):
                    self.a.aceitar_convite(token, "nova.conta", SENHA, "Nova", AVATAR, agora=agora)
        self.assertNotIn("nova.conta", self.a.usuarios)
        with self.assertRaises(KeyError):
            self.a.revogar_convite("naoexiste")

    def test_convite_valida_campos_e_usuario_tomado(self):
        self.criar_dono()
        token, _ = self.a.convidar("Ana", [])
        for usuario, senha, nome, avatar in (("ab", SENHA, "Ana", AVATAR), ("ana", "curta", "Ana", AVATAR),
                                             ("ana", SENHA, "", AVATAR), ("ana", SENHA, "Ana", {"color": "ouro"})):
            with self.subTest(usuario=usuario, senha=senha, nome=nome):
                with self.assertRaises(ValueError):
                    self.a.aceitar_convite(token, usuario, senha, nome, avatar)
        with self.assertRaises(ContaExiste):
            self.a.aceitar_convite(token, "dono", SENHA, "Ana", AVATAR)
        self.assertEqual(len(self.a.convites_pendentes()), 1)   # um erro não gasta o convite
        for nome, andares in (("", []), ("Ana", ["../x"]), ("Ana", "a1b2c3d4"), ("Ana", [1])):
            with self.subTest(nome=nome, andares=andares):
                with self.assertRaises(ValueError):
                    self.a.convidar(nome, andares)

    def test_no_maximo_20_convites_esperando(self):
        self.criar_dono()
        for i in range(acesso.CONVITES_MAX):
            self.a.convidar(f"Pessoa {i}", [], agora=1000)
        with self.assertRaises(ConvitesDemais):
            self.a.convidar("Mais uma", [], agora=1000)
        self.a.convidar("Depois que venceram", [], agora=1000 + acesso.CONVITE_VALIDADE)   # vencidos não contam
        self.assertEqual(len(self.a.convites_pendentes(agora=1000 + acesso.CONVITE_VALIDADE)), 1)

    def test_definir_andares_mantem_o_principal_e_o_papel(self):
        self.criar_dono()
        self.conta("ana", andares=["a1b2c3d4"])
        self.a.definir_andares("ana", ["b1b2c3d4"])
        self.assertEqual({c["usuario"]: c["andares"] for c in self.a.contas()}["ana"], ["principal", "b1b2c3d4"])
        self.assertEqual(self.a.papel("ana"), "membro")
        self.a.definir_andares("dono", [])
        self.assertEqual(self.a.papel("dono"), "admin")
        with self.assertRaises(ValueError):
            self.a.definir_andares("ana", ["../../etc"])
        with self.assertRaises(KeyError):
            self.a.definir_andares("ninguem", [])

    def test_t6_ultimo_admin_protegido_no_rebaixamento_e_remocao(self):
        self.criar_dono()
        self.conta("ana")
        arq = os.path.join(self.pasta, "usuarios.json")
        with open(arq, "rb") as f:
            antes = f.read()

        with self.assertRaises(UltimoAdmin):
            self.a.mudar_papel("dono", "membro")
        with self.assertRaises(UltimoAdmin):
            self.a.remover("dono")
        with open(arq, "rb") as f:
            self.assertEqual(f.read(), antes)

        # Com dois admins, rebaixar um passa e o segundo fica protegido
        self.a.mudar_papel("ana", "admin")
        self.assertEqual(self.a.papel("ana"), "admin")
        self.a.mudar_papel("dono", "membro")
        self.assertEqual(self.a.papel("dono"), "membro")

        with self.assertRaises(UltimoAdmin):
            self.a.mudar_papel("ana", "membro")
        with self.assertRaises(UltimoAdmin):
            self.a.remover("ana")

        # Membro pode ser removido normalmente
        self.a.remover("dono")
        self.assertEqual([c["usuario"] for c in self.a.contas()], ["ana"])

    def test_t10_validacao_perfil_nome_e_avatar(self):
        self.criar_dono()
        avatar_ok = {"color": "teal", "eyes": "happy", "accessory": "crown"}
        perfil = self.a.salvar_perfil("dono", "  Helbert Moura  ", avatar_ok)
        self.assertEqual(perfil["nome"], "Helbert Moura")
        self.assertEqual(perfil["avatar"], avatar_ok)
        self.assertEqual(Acesso(self.pasta).perfil("dono")["nome"], "Helbert Moura")
        self.assertEqual(Acesso(self.pasta).perfil("dono")["avatar"], avatar_ok)

        # Limite exato de 40 caracteres passa; 41, vazio ou controle falham
        self.a.salvar_perfil("dono", "a" * 40, {"color": "sky", "eyes": "dots", "accessory": ""})
        for ruim in ("", "   ", "a" * 41, "ana\x00", "ana\n", "ana\r", "ana\u200b", 123, None):
            with self.subTest(nome=ruim):
                with self.assertRaises(ValueError):
                    self.a.salvar_perfil("dono", ruim, avatar_ok)

        for av_ruim in (
            None,
            "teal",
            {"color": "dourado", "eyes": "happy", "accessory": ""},
            {"color": "teal", "eyes": "laser", "accessory": ""},
            {"color": "teal", "eyes": "happy", "accessory": "espada"},
            {"color": "teal", "eyes": "happy"},
            {"color": "teal", "eyes": "happy", "accessory": "", "extra": 1},
        ):
            with self.subTest(avatar=av_ruim):
                with self.assertRaises(ValueError):
                    self.a.salvar_perfil("dono", "Ana", av_ruim)

    def test_papel_invalido_falha_fechada(self):
        self.criar_dono()
        arq = os.path.join(self.pasta, "usuarios.json")
        with open(arq, encoding="utf-8") as f:
            dados = json.load(f)
        dados["estranho"] = {**dados["dono"], "andares": {"principal": "superadmin"}}
        dados["sem_andar"] = {**dados["dono"], "andares": {}}
        with open(arq, "w", encoding="utf-8") as f:
            json.dump(dados, f)

        acc = Acesso(self.pasta)
        self.assertIsNone(acc.papel("estranho"))
        self.assertIsNone(acc.papel("sem_andar"))
        self.assertEqual(acc.papel("dono"), "admin")

    def test_remover_e_sair_todos_por_pessoa(self):
        self.criar_dono()
        tok_dono = self.a.entrar("dono", "senha-bem-grande")
        modo_dono = self.a.abrir_modo(tok_dono, "senha-bem-grande", agora=1000)
        tok_ana1 = self.conta("ana")
        tok_ana2 = self.a.entrar("ana", SENHA)

        # sair_todos da Ana derruba só as sessões dela
        n = self.a.sair_todos(tok_ana1, SENHA)
        self.assertEqual(n, 2)
        self.assertIsNone(self.a.sessao(tok_ana1))
        self.assertIsNone(self.a.sessao(tok_ana2))
        self.assertEqual(self.a.sessao(tok_dono), "dono")
        self.assertIsNotNone(self.a.modo(tok_dono, modo_dono, agora=1010))

        # remover derruba sessões da Ana na hora e preserva o dono
        tok_ana3 = self.a.entrar("ana", SENHA)
        self.a.remover("ana")
        self.assertIsNone(self.a.sessao(tok_ana3))
        self.assertEqual(self.a.sessao(tok_dono), "dono")
        with self.assertRaises(KeyError):
            self.a.remover("nao_existe")

    def test_remover_derruba_as_sessoes_antes_de_gravar_a_conta(self):
        """Se a gravação da conta falhar no remover, o cookie dela já não vale (falha fechada)."""
        self.criar_dono()
        tok_ana = self.conta("ana")
        antes = acesso._gravar

        def falha_nos_usuarios(caminho, dados):
            if caminho == self.a.arq_usuarios:
                raise OSError("disco cheio")
            antes(caminho, dados)

        acesso._gravar = falha_nos_usuarios
        self.addCleanup(setattr, acesso, "_gravar", antes)
        with self.assertRaises(NaoGravou):
            self.a.remover("ana")
        self.assertIn("ana", self.a.usuarios)
        self.assertIsNone(self.a.sessao(tok_ana))

    def test_conta_nova_com_o_nome_de_uma_antiga_nao_herda_sessoes(self):
        """Convidada de novo com o mesmo usuário, a pessoa não ganha de volta o cookie de um aparelho perdido."""
        self.criar_dono()
        tok_velho = self.conta("ana")
        self.a.remover("ana")
        # uma sessão velha que sobrou (sessoes.json restaurado de backup, por exemplo)
        self.a.sessoes[acesso._sha(tok_velho)] = {"usuario": "ana", "expira": time.time() + 3600}
        tok_novo = self.conta("ana")
        self.assertIsNone(self.a.sessao(tok_velho))
        self.assertEqual(self.a.sessao(tok_novo), "ana")
        self.assertIsNone(Acesso(self.pasta).sessao(tok_velho))   # nem no disco

    def test_falha_no_disco_nao_altera_memoria(self):
        self.criar_dono()
        antes = acesso._gravar

        def falha(*_):
            raise OSError("disco cheio")

        acesso._gravar = falha
        self.addCleanup(setattr, acesso, "_gravar", antes)

        with self.assertRaises(NaoGravou):
            self.a.convidar("Ana", [])
        self.assertEqual(self.a.convites, {})

        with self.assertRaises(NaoGravou):
            self.a.salvar_perfil("dono", "Outro Nome", {"color": "rose", "eyes": "wide", "accessory": ""})
        self.assertEqual(self.a.perfil("dono")["nome"], "dono")

    def test_t15_aceites_em_paralelo(self):
        self.criar_dono()
        convites = [self.a.convidar(f"Pessoa {i:02d}", [])[0] for i in range(20)]
        res = em_paralelo([(lambda i=i: self.a.aceitar_convite(convites[i], f"pessoa{i:02d}", SENHA, f"Pessoa {i:02d}", AVATAR))
                           for i in range(20)])
        self.assertEqual([r for r in res if not r[1]], [])
        esperados = {"dono"} | {f"pessoa{i:02d}" for i in range(20)}
        self.assertEqual(set(self.a.usuarios), esperados)
        self.assertEqual(set(Acesso(self.pasta).usuarios), esperados)   # nada se perdeu no disco

        # o mesmo convite aceito 5 vezes ao mesmo tempo, com usuários diferentes: só 1 conta nasce
        token, _ = self.a.convidar("Dup", [])
        corrida = em_paralelo([(lambda i=i: self.a.aceitar_convite(token, f"dup{i}", SENHA, "Dup", AVATAR)) for i in range(5)])
        self.assertEqual(len([r for r in corrida if r[1]]), 1)
        self.assertTrue(all(isinstance(r[2], ConviteInvalido) for r in corrida if not r[1]))
        self.assertEqual(len([u for u in self.a.usuarios if u.startswith("dup")]), 1)


if __name__ == "__main__":
    unittest.main()
