# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
import unittest
from concurrent.futures import ThreadPoolExecutor
from visitas_sala import (Salas, INATIVIDADE, VALIDADE_CONVITE, JANELA_REQUISICOES,
                         MAX_REQUISICOES_ORIGEM, MAX_REQUISICOES_SALA, MAX_REQUISICOES_SESSAO, MAX_ORIGENS, LimiteRequisicoes)


class SalasTest(unittest.TestCase):
    def setUp(self):
        self.tempo = 1
        self.salas = Salas(lambda: self.tempo)

    def test_isolamento_e_desconexao(self):
        a, b = self.salas.criar(), self.salas.criar()
        pessoa, equipe = self.salas.entrar(a), self.salas.entrar(a)
        outra = self.salas.entrar(b)
        self.salas.enviar(pessoa, 'olá')
        self.assertEqual(self.salas.receber(equipe), ['olá'])
        self.assertEqual(self.salas.receber(outra), [])
        self.assertTrue(self.salas.sair(pessoa))
        with self.assertRaises(PermissionError):
            self.salas.enviar(pessoa, 'não')

    def test_agente_recebe_so_a_propria_sala_e_responde_nela(self):
        com = self.salas.criar({'id': 'ag-1', 'nome': 'Senku'})
        sem = self.salas.criar()
        visita, equipe = self.salas.entrar(com), self.salas.entrar(com)
        outra = self.salas.entrar(sem)
        self.assertEqual(self.salas.agente(visita), 'Senku')
        self.assertIsNone(self.salas.agente(outra))
        self.salas.enviar(visita, 'oi, agente')
        self.salas.enviar(outra, 'conversa só de pessoas')
        pendentes = self.salas.pendencias()
        self.assertEqual(len(pendentes), 1)
        chave, agente, ponte, textos = pendentes[0]
        self.assertEqual((agente['id'], textos), ('ag-1', ['oi, agente']))
        self.assertEqual(self.salas.pendencias(), [], 'cada mensagem vai ao agente uma vez')
        self.assertTrue(self.salas.publicar(chave, 'Senku: olá!'))
        self.assertEqual(self.salas.receber(equipe), ['oi, agente', 'Senku: olá!'])
        self.assertEqual(self.salas.receber(outra), ['conversa só de pessoas'])
        ponte['thread'] = 't-1'   # com a conversa aberta, a sala segue na lista para ler respostas
        self.assertEqual(len(self.salas.pendencias()), 1)
        self.assertTrue(self.salas.revogar(com))
        self.assertFalse(self.salas.publicar(chave, 'depois do fim'))
        self.assertEqual(self.salas.pendencias(), [])

    def test_convite_expira_e_revogacao_encerra_sessoes(self):
        convite = self.salas.criar()
        pessoa = self.salas.entrar(convite)
        self.assertTrue(self.salas.revogar(convite))
        with self.assertRaises(PermissionError):
            self.salas.receber(pessoa)
        convite = self.salas.criar()
        self.tempo += VALIDADE_CONVITE
        with self.assertRaises(PermissionError):
            self.salas.entrar(convite)

    def test_inatividade_e_entrada_invalida(self):
        convite = self.salas.criar()
        pessoa = self.salas.entrar(convite)
        with self.assertRaises(ValueError):
            self.salas.enviar(pessoa, 'x' * 1001)
        self.tempo += INATIVIDADE
        with self.assertRaises(PermissionError):
            self.salas.receber(pessoa)
        with self.assertRaises(PermissionError):
            self.salas.entrar('inválido')

    def test_limite_de_envio_e_credencial_malformada(self):
        convite = self.salas.criar()
        emissor, receptor = self.salas.entrar(convite), self.salas.entrar(convite)
        self.salas.enviar(emissor, 'primeira')
        with self.assertRaises(ValueError):
            self.salas.enviar(emissor, 'rápida demais')
        self.tempo += 1
        self.salas.enviar(emissor, 'segunda')
        self.assertEqual(self.salas.receber(receptor), ['primeira', 'segunda'])
        with self.assertRaises(PermissionError):
            self.salas.entrar('\ud800')

    def test_limites_por_origem_e_convite(self):
        convite = self.salas.criar()
        pessoas = [self.salas.entrar(convite, origem='origem-a') for _ in range(4)]
        with self.assertRaises(ValueError):
            self.salas.entrar(convite, origem='origem-a')
        outras = [self.salas.entrar(convite, origem='origem-b') for _ in range(2)]
        for pessoa in pessoas + outras[:1]:
            self.salas.enviar(pessoa, 'mensagem')
        with self.assertRaises(ValueError):
            self.salas.enviar(outras[1], 'excesso')

    def test_limites_de_requisicoes_e_limpeza(self):
        convite = self.salas.criar()
        sessao = self.salas.entrar(convite, origem='a')
        for _ in range(MAX_REQUISICOES_ORIGEM):
            self.salas.limitar_origem('a')
        with self.assertRaises(ValueError):
            self.salas.limitar_origem('a')
        self.salas.limitar_origem('b')
        for _ in range(MAX_REQUISICOES_SESSAO):
            self.salas.limitar_sala(sessao)
        with self.assertRaises(ValueError):
            self.salas.limitar_sala(sessao)
        self.tempo += JANELA_REQUISICOES
        self.salas.limpar()
        self.assertEqual(self.salas._origens, {})
        self.salas.limitar_origem('a')
        self.salas.limitar_sala(sessao)

    def test_saturacao_de_entradas_nao_bloqueia_participantes(self):
        convite = self.salas.criar()
        sessoes = [self.salas.entrar(convite, origem=str(i)) for i in range(4)]
        for _ in range(MAX_REQUISICOES_SALA):
            self.salas.limitar_sala(convite, convite=True)
        with self.assertRaises(ValueError):
            self.salas.limitar_sala(convite, convite=True)
        def receber(sessao):
            self.salas.limitar_sala(sessao)
            return self.salas.receber(sessao)
        with ThreadPoolExecutor(max_workers=4) as executor:
            self.assertEqual(list(executor.map(receber, sessoes)), [[], [], [], []])

    def test_origens_limitadas_fecham_sem_descartar_janelas_ativas(self):
        for numero in range(MAX_ORIGENS):
            self.salas.limitar_origem(str(numero))
        with self.assertRaises(LimiteRequisicoes):
            self.salas.limitar_origem('outra')
        self.assertEqual(len(self.salas._origens), MAX_ORIGENS)
        self.tempo += JANELA_REQUISICOES
        self.salas.limitar_origem('outra')
        self.assertEqual(len(self.salas._origens), 1)

    def test_tabela_cheia_retorna_429_na_camada_http(self):
        from types import SimpleNamespace
        import escritorio
        for numero in range(MAX_ORIGENS):
            self.salas.limitar_origem(str(numero))
        handler = SimpleNamespace(
            headers={'Origin': escritorio.BASE, 'Content-Type': 'application/json'},
            server=SimpleNamespace(salas_visitas=self.salas, proxy_visitas=None),
            client_address=('127.0.0.1', 12345),
            _json=lambda status, corpo: (status, corpo))
        status, _ = escritorio.Pagina._post_visitas(handler, '/api/visitas/receber')
        self.assertEqual(status, 429)
        self.tempo += JANELA_REQUISICOES
        self.salas.limitar_origem('127.0.0.1')

    def test_limpeza_sem_novos_pedidos_descarta_sessoes_e_mensagens(self):
        convite = self.salas.criar()
        emissor, receptor = self.salas.entrar(convite), self.salas.entrar(convite)
        self.salas.enviar(emissor, 'transitória')
        self.tempo += VALIDADE_CONVITE
        self.salas.limpar()
        self.assertEqual(self.salas._salas, {})
        self.assertEqual(self.salas._sessoes, {})
        with self.assertRaises(PermissionError):
            self.salas.receber(receptor)


if __name__ == '__main__':
    unittest.main()
