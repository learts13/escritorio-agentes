# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""presenca.py: TTL, limites, isolamento por sala e por andar, entrou_seq e nada fora da memória."""
import ast
import os
import unittest

import presenca
from presenca import Limite, Presenca

AP = {"color": "teal", "eyes": "happy", "accessory": ""}


class Relogio:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


class Unidade(unittest.TestCase):
    def setUp(self):
        self.r = Relogio()
        self.p = Presenca(self.r, lambda: 1_700_000_000)

    def entra(self, usuario, sala="lounge", andar="principal", x=10, y=20):
        self.r.t += 1   # longe dos baldes: cada teste mede o seu limite de propósito
        return self.p.marcar(andar, usuario, usuario.title(), AP, x, y, None, sala, "baixo")

    def test_quem_esta_e_quem_saiu_pelo_ttl(self):
        self.entra("ana")
        self.entra("bia", x=50, y=60)
        vivo = self.p.ao_vivo("principal", "ana", 0)
        self.assertEqual([(q["usuario"], q["x"], q["y"]) for q in vivo["pessoas"]], [("bia", 50, 60)])   # sem a própria
        self.assertEqual(set(vivo["pessoas"][0]), {"usuario", "nome", "aparencia", "x", "y", "destino", "sala", "olha"})
        self.r.t += presenca.PRESENCA_TTL - 1
        self.p.ao_vivo("principal", "ana", 0)   # a ana renova lendo; a bia não pede nada
        self.r.t += 2
        self.assertEqual(self.p.ao_vivo("principal", "ana", 0)["pessoas"], [])
        self.assertEqual([q["usuario"] for q in self.p.ao_vivo("principal", "bia", 0)["pessoas"]], ["ana"])

    def test_a_tv_le_sem_renovar(self):
        self.entra("tv")
        self.r.t += presenca.PRESENCA_TTL - 1
        self.p.ao_vivo("principal", "tv", 0, renovar=False)
        self.r.t += 2
        self.assertEqual([q["usuario"] for q in self.p.ao_vivo("principal", "outra", 0)["pessoas"]], [])

    def test_chat_vai_para_a_sala_do_autor_no_servidor(self):
        self.entra("ana", "lounge")
        self.entra("bia", "lounge")
        self.entra("caio", "cozinha")
        self.p.enviar("principal", "ana", "  Bom dia!‮\x07  ")
        msgs = self.p.ao_vivo("principal", "bia", 0)["mensagens"]
        self.assertEqual([(m["usuario"], m["nome"], m["texto"]) for m in msgs], [("ana", "Ana", "Bom dia!")])
        self.assertEqual(set(msgs[0]), {"seq", "usuario", "nome", "texto", "em"})
        self.assertEqual(self.p.ao_vivo("principal", "caio", 0)["mensagens"], [])   # outra sala
        self.assertEqual(self.p.ao_vivo("outro-andar", "bia", 0)["mensagens"], [])   # outro andar
        self.assertEqual(self.p.ao_vivo("principal", "ninguem", 0)["mensagens"], [])   # sem presença, nada

    def test_quem_chega_nao_le_o_que_foi_dito_antes(self):
        self.entra("ana", "lounge")
        self.p.enviar("principal", "ana", "antes")
        self.entra("bia", "lounge")
        self.r.t += 1
        self.p.enviar("principal", "ana", "depois")
        self.assertEqual([m["texto"] for m in self.p.ao_vivo("principal", "bia", 0)["mensagens"]], ["depois"])
        # sair da sala e voltar zera de novo; o "desde" corta o que o cliente já viu
        self.entra("bia", "cozinha")
        self.entra("bia", "lounge")
        self.assertEqual(self.p.ao_vivo("principal", "bia", 0)["mensagens"], [])
        seq = self.p.ao_vivo("principal", "ana", 0)["seq"]
        self.r.t += 1
        self.p.enviar("principal", "ana", "nova")
        self.assertEqual([m["texto"] for m in self.p.ao_vivo("principal", "ana", seq)["mensagens"]], ["nova"])

    def test_mensagens_vencem_e_o_anel_tem_teto(self):
        self.entra("ana")
        for i in range(presenca.ANEL + 5):
            self.r.t += 1
            self.p.enviar("principal", "ana", f"m{i}")
            if i % 20 == 0:
                self.entra("ana")   # continua presente
        msgs = self.p.ao_vivo("principal", "ana", 0)["mensagens"]
        self.assertEqual(len(msgs), presenca.ANEL)
        self.assertEqual(msgs[0]["texto"], "m5")
        self.r.t += presenca.MENSAGEM_VIDA
        self.entra("ana")
        self.assertEqual(self.p.ao_vivo("principal", "ana", 0)["mensagens"], [])

    def test_limites_por_pessoa(self):
        self.entra("ana")
        enviados = 0
        with self.assertRaises(Limite):
            for _ in range(10):   # rajada de 5 no mesmo instante
                self.p.enviar("principal", "ana", "oi")
                enviados += 1
        self.assertEqual(enviados, presenca.LIMITES["chat"][1])
        self.r.t += 1
        self.p.enviar("principal", "ana", "de novo")   # 1 por segundo volta
        with self.assertRaises(Limite):
            for _ in range(20):
                self.p.ao_vivo("principal", "ana", 0)
        self.p.ao_vivo("principal", "bia", 0)   # o balde é de cada um

    def test_andar_cheio(self):
        for i in range(presenca.PESSOAS_MAX):
            self.p.marcar("principal", f"p{i}", "P", AP, 1, 1, None, "", "baixo")
        with self.assertRaises(Limite):
            self.p.marcar("principal", "mais", "P", AP, 1, 1, None, "", "baixo")
        self.p.marcar("outro", "mais", "P", AP, 1, 1, None, "", "baixo")   # o teto é por andar

    def test_valida_posicao_destino_direcao_e_texto(self):
        for x, y, destino, olha in ((-1, 0, None, "baixo"), (0, presenca.COORD_MAX + 1, None, "baixo"),
                                    (float("nan"), 0, None, "baixo"), (True, 0, None, "baixo"), ("1", 0, None, "baixo"),
                                    (1, 1, [1], "baixo"), (1, 1, [1, -5], "baixo"), (1, 1, None, "norte")):
            with self.subTest(x=x, y=y, destino=destino, olha=olha):
                with self.assertRaises(ValueError):
                    self.p.marcar("principal", "ana", "Ana", AP, x, y, destino, "lounge", olha)
        self.entra("ana", sala="")
        with self.assertRaises(ValueError):   # no corredor não há com quem falar
            self.p.enviar("principal", "ana", "oi")
        self.entra("ana")
        for ruim in ("", "   ", "​", "x" * (presenca.TEXTO_MAX + 1), None, 5):
            with self.subTest(texto=str(ruim)[:10]):
                with self.assertRaises(ValueError):
                    self.p.enviar("principal", "ana", ruim)
        self.assertEqual(presenca.limpar_texto("linha 1\r\nlinha 2"), "linha 1\nlinha 2")

    def test_sair_some_na_hora(self):
        self.entra("ana")
        self.entra("bia")
        self.p.sair("ana")
        self.assertEqual(self.p.ao_vivo("principal", "bia", 0)["pessoas"], [])

    def test_so_memoria(self):
        """Nada de disco, rede, log ou print no módulo: o texto do chat e a posição nunca saem da memória."""
        arvore = ast.parse(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "presenca.py"), encoding="utf-8").read())
        nomes = {n.id for n in ast.walk(arvore) if isinstance(n, ast.Name)} | \
                {n.attr for n in ast.walk(arvore) if isinstance(n, ast.Attribute)}
        importados = {a.name for n in ast.walk(arvore) if isinstance(n, (ast.Import, ast.ImportFrom)) for a in n.names}
        self.assertFalse({"open", "print", "log", "write"} & nomes)
        self.assertEqual(importados, {"collections", "math", "threading", "time", "unicodedata"})


if __name__ == "__main__":
    unittest.main()
