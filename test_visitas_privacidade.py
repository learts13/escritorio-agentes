# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Verificações da camada transitória, independentes da camada HTTP e do proxy."""
import unittest
from unittest import mock

import visitas_sala as v


class PrivacidadeSala(unittest.TestCase):
    def test_operacoes_nao_gravam_arquivos_ou_logs(self):
        tempo = [10]
        salas = v.Salas(lambda: tempo[0])
        with mock.patch('builtins.open', side_effect=AssertionError('acesso ao disco')), \
             mock.patch('builtins.print', side_effect=AssertionError('registro em log')):
            convite = salas.criar()
            visitante = salas.entrar(convite)
            equipe = salas.entrar(convite)
            salas.enviar(visitante, 'mensagem privada')
            self.assertEqual(salas.receber(equipe), ['mensagem privada'])
            self.assertTrue(salas.sair(visitante))
            self.assertTrue(salas.revogar(convite))

    def test_fila_limitada_e_sem_historico_para_novo_participante(self):
        tempo = [10]
        salas = v.Salas(lambda: tempo[0])
        convite = salas.criar()
        emissor = salas.entrar(convite)
        receptor = salas.entrar(convite)
        for i in range(v.MAX_FILA + 2):
            salas.enviar(emissor, str(i))
            tempo[0] += v.INTERVALO_MENSAGEM
        novo = salas.entrar(convite)
        self.assertEqual(salas.receber(novo), [])
        self.assertEqual(salas.receber(receptor), [str(i) for i in range(2, v.MAX_FILA + 2)])
        self.assertEqual(salas.receber(receptor), [])

    def test_limpeza_descarta_fila_sem_novo_pedido_do_visitante(self):
        tempo = [10]
        salas = v.Salas(lambda: tempo[0])
        convite = salas.criar()
        emissor = salas.entrar(convite)
        receptor = salas.entrar(convite)
        salas.enviar(emissor, 'mensagem privada')
        tempo[0] += v.INATIVIDADE
        salas.limpar()
        self.assertFalse(salas._sessoes)
        with self.assertRaises(PermissionError):
            salas.receber(receptor)

    def test_convite_e_credencial_nao_sao_chaves_em_texto_claro(self):
        salas = v.Salas()
        convite = salas.criar()
        token = salas.entrar(convite)
        self.assertNotIn(convite, salas._salas)
        self.assertNotIn(token, salas._sessoes)


if __name__ == '__main__':
    unittest.main()
