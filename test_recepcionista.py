# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Recepcionista da sala de visitas salvo pela tela: arquivo, limite do servidor, prioridade sobre as variáveis, a rota
de admin e o que a ponte confere a cada passo."""
import http.client
import io
import json
import os
import tempfile
import threading
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

import ajustes
import escritorio as e

CANAL = '01a1bda0-9c52-74b8-8f93-79ac3cc91d90'
OUTRO = '01a1bda0-9c52-74b8-8f93-79ac3cc91d91'
SEM_NOME = '01a1bda0-9c52-74b8-8f93-79ac3cc91d92'


class Arquivo(unittest.TestCase):
    def test_valida_tudo_ou_nada(self):
        ok = {'v': 1, 'anfitriao': 'recepcao', 'canal': CANAL}
        self.assertEqual(ajustes.validar_arquivo_recepcao(ok), {'anfitriao': 'recepcao', 'canal': CANAL})
        self.assertEqual(json.loads(ajustes.bytes_da_recepcao({'anfitriao': 'recepcao', 'canal': CANAL})), ok)
        for ruim in ({**ok, 'v': 2}, {**ok, 'v': True}, {**ok, 'extra': 1}, {**ok, 'anfitriao': '@recepcao'},
                     {**ok, 'anfitriao': 'Recepcao'}, {**ok, 'canal': 'canal'}, {**ok, 'canal': CANAL.upper()}, [], None):
            with self.assertRaises(ValueError):
                ajustes.validar_arquivo_recepcao(ruim)

    def test_tela_vale_mais_que_as_variaveis_dentro_do_limite(self):
        with tempfile.TemporaryDirectory() as pasta:
            arq = os.path.join(pasta, 'recepcao.json')

            def salvar(handle):
                with open(arq, 'wb') as f:
                    f.write(ajustes.bytes_da_recepcao({'anfitriao': handle, 'canal': CANAL}))
            with patch.object(e, 'ARQ_RECEPCAO', arq), patch.object(e, 'ANFITRIOES_VISITAS', set()), \
                    patch.object(e, 'CANAL_VISITAS', ''), patch.object(e, 'TELA_VISITAS', False):
                self.assertEqual(e.recepcao_vigente(), (set(), '', 'nenhum'))
                salvar('recepcao')   # tela fechada no servidor: o arquivo não vale
                self.assertEqual((e.tela_recepcao(), e.recepcao_vigente()), ('fechada', (set(), '', 'nenhum')))
                with patch.object(e, 'TELA_VISITAS', True):
                    self.assertEqual((e.tela_recepcao(), e.recepcao_vigente()), ('livre', ({'recepcao'}, CANAL, 'tela')))
            with patch.object(e, 'ARQ_RECEPCAO', arq), patch.object(e, 'ANFITRIOES_VISITAS', {'a', 'b'}), \
                    patch.object(e, 'CANAL_VISITAS', OUTRO), patch.object(e, 'TELA_VISITAS', True):
                self.assertEqual(e.tela_recepcao(), 'limite', 'a lista vale mais que TELA=1')
                self.assertEqual(e.recepcao_vigente(), ({'a', 'b'}, OUTRO, 'variaveis'), 'recepcao fora da lista')
                salvar('a')
                self.assertEqual(e.recepcao_vigente(), ({'a', 'b'}, OUTRO, 'variaveis'), 'canal fora da variável')
                with patch.object(e, 'CANAL_VISITAS', CANAL):
                    self.assertEqual(e.recepcao_vigente(), ({'a'}, CANAL, 'tela'))
                with open(arq, 'w') as f:   # ilegível: volta às variáveis, com 1 log
                    f.write('{')
                with redirect_stdout(io.StringIO()):
                    self.assertEqual(e.recepcao_vigente()[2], 'variaveis')

    def test_ponte_so_recebe_com_responder_e_escrita(self):
        com, sem = SimpleNamespace(tem_escrita=lambda: True), SimpleNamespace(tem_escrita=lambda: False)
        vigente = ({'recepcao'}, CANAL, 'tela')
        with patch.object(e, 'recepcao_vigente', lambda: vigente):
            with patch.object(e, 'carregar_times', lambda: {'conversas': 'responder'}):
                self.assertEqual(e.recepcao_da_ponte(com), vigente)
                self.assertEqual(e.recepcao_da_ponte(sem), (set(), '', 'desligada'))
            with patch.object(e, 'carregar_times', lambda: {'conversas': 'ler'}):
                self.assertEqual(e.recepcao_da_ponte(com), (set(), '', 'desligada'))


class AcessoFalso:
    def sessao(self, token):
        return 'equipe' if token == 'admin-teste' else None


class Rota(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.TemporaryDirectory()
        self.arq = os.path.join(self.pasta.name, 'recepcao.json')
        self.chamadas = []

        def ferramenta(nome, args, token):
            self.chamadas.append(nome)
            return {'channels': [{'id': CANAL, 'name': 'visitas‮\nescritório'}, {'id': SEM_NOME}]}
        leitor = SimpleNamespace(
            foto=lambda: {'agentes': [{'id': 'ag-1', 'nome': 'Recepção', 'handle': 'recepcao'},
                                      {'id': 'ag-2', 'nome': 'Interno', 'handle': 'interno'}]},
            pausado=lambda agora=None: False, pausa_ate=0, cred=SimpleNamespace(token=lambda: 'tok'),
            mcp=SimpleNamespace(sessao='s', iniciar=lambda token: None, ferramenta=ferramenta))
        self.servidor = e.Servidor(('127.0.0.1', 0), e.Pagina)
        self.servidor.acesso, self.servidor.leitor = AcessoFalso(), leitor
        self.servidor.respostas = e.Respostas(leitor, None)
        self.servidor.cred = SimpleNamespace(tem_escrita=lambda: True)
        self.travas = [patch.object(e, 'ARQ_RECEPCAO', self.arq), patch.object(e, 'ANFITRIOES_VISITAS', set()),
                       patch.object(e, 'CANAL_VISITAS', ''), patch.object(e, 'TELA_VISITAS', True),
                       patch.object(e.Pagina, '_pode_responder', lambda s: True),
                       patch.object(e, 'carregar_times', lambda: {'conversas': 'responder'})]
        for t in self.travas:
            t.start()
        self.modo = patch.object(e.Pagina, '_modo_resposta', lambda s: (3600, 28800))
        self.modo.start()
        self.thread = threading.Thread(target=self.servidor.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.servidor.shutdown()
        self.servidor.server_close()
        self.thread.join()
        self.modo.stop()
        for t in self.travas:
            t.stop()
        self.pasta.cleanup()

    def pedir(self, acao, dados, admin=True):
        conexao = http.client.HTTPConnection(*self.servidor.server_address, timeout=3)
        cabecalhos = {'Origin': e.BASE, 'Content-Type': 'application/json'}
        if admin:
            cabecalhos['Cookie'] = e.nome_cookie() + '=admin-teste'
        try:
            with redirect_stdout(io.StringIO()):
                conexao.request('POST', '/api/visitas/' + acao, json.dumps(dados), cabecalhos)
                resposta = conexao.getresponse()
                return resposta.status, json.loads(resposta.read())
        finally:
            conexao.close()

    def test_salva_confere_e_liga_o_anfitriao(self):
        self.assertEqual(self.pedir('recepcionista', {}, admin=False)[0], 401)
        st, estado = self.pedir('recepcionista', {})
        self.assertEqual((st, estado['origem'], estado['tela'], estado['faltam']),
                         (200, 'nenhum', 'livre', ['Escolha o recepcionista e o canal das visitas.']))
        self.assertEqual(self.pedir('anfitrioes', {})[1], {'agentes': []})
        link = f'https://app.agentes.chat/org/{e.ORG}/c/{CANAL}'
        st, conferido = self.pedir('recepcionista', {'anfitriao': '@recepcao', 'canal': link, 'conferir': True})
        self.assertEqual((st, conferido), (200, {'anfitriao': 'recepcao', 'canal': CANAL, 'nome': 'Recepção',
                                                 'canal_nome': 'visitas escritório'}))
        self.assertFalse(os.path.exists(self.arq), 'conferir não salva')
        self.assertEqual(self.pedir('recepcionista', {'anfitriao': 'recepcao', 'canal': SEM_NOME, 'conferir': True})[1]
                         ['canal_nome'], '', 'canal sem nome')
        del self.chamadas[:]
        st, estado = self.pedir('recepcionista', {'anfitriao': ' @Recepcao ', 'canal': link})
        self.assertEqual((st, estado['origem'], estado['anfitrioes'], estado['canal'], estado['nomes'], estado['faltam']),
                         (200, 'tela', ['recepcao'], CANAL, ['Recepção'], []))
        self.assertEqual(self.chamadas, ['list_channels'])
        with open(self.arq, 'rb') as f:
            self.assertEqual(json.loads(f.read()), {'v': 1, 'anfitriao': 'recepcao', 'canal': CANAL})
        self.assertEqual(self.pedir('anfitrioes', {})[1], {'agentes': [{'id': 'ag-1', 'nome': 'Recepção'}]})
        self.assertEqual(self.pedir('criar', {'agente': 'ag-2'})[0], 400, 'outro agente segue de fora')
        st, estado = self.pedir('recepcionista', {'limpar': True})
        self.assertEqual((st, estado['origem']), (200, 'nenhum'))
        self.assertFalse(os.path.exists(self.arq))

    def test_recusa_agente_canal_e_pedido_invalidos(self):
        casos = [({'anfitriao': '@nao-existe', 'canal': CANAL}, 400, 'não aparece na leitura'),
                 ({'anfitriao': 'recepcao', 'canal': OUTRO}, 400, 'não aparece para a conta'),
                 ({'anfitriao': 'recepcao', 'canal': 'https://outro.example/c/' + CANAL}, 400, 'link do canal'),
                 ({'anfitriao': 'a b', 'canal': CANAL}, 400, '@ do agente'),
                 ({'anfitriao': 'recepcao', 'canal': CANAL, 'extra': 1}, 400, 'Pedido inválido'),
                 ({'limpar': False}, 400, 'Pedido inválido'),
                 ({'anfitriao': 'recepcao', 'canal': CANAL, 'conferir': 1}, 400, 'Pedido inválido'),
                 ({'limpar': True, 'conferir': True}, 400, 'Pedido inválido'),
                 ({'anfitriao': 7, 'canal': CANAL}, 400, '@ do agente')]
        for dados, st, trecho in casos:
            status, corpo = self.pedir('recepcionista', dados)
            self.assertEqual(status, st, dados)
            self.assertIn(trecho, corpo['erro'])
        self.assertFalse(os.path.exists(self.arq))

    def test_salvar_pede_o_modo_resposta(self):
        self.modo.stop()
        try:
            with patch.object(e.Pagina, '_modo_resposta', lambda s: None):
                for dados in ({'anfitriao': 'recepcao', 'canal': CANAL}, {'limpar': True},
                              {'anfitriao': 'recepcao', 'canal': CANAL, 'conferir': True}):
                    status, corpo = self.pedir('recepcionista', dados)
                    self.assertEqual(status, 403)
                    self.assertIn('modo resposta', corpo['erro'])
                    self.assertEqual(corpo['codigo'], 'modo_fechado', 'a tela pede a senha ali mesmo')
                self.assertEqual(self.pedir('recepcionista', {})[0], 200, 'ler como está não precisa')
        finally:
            self.modo.start()
        self.assertEqual(self.chamadas, [])

    def test_sem_responder_nao_pede_senha(self):
        """A revisão do be8df31: com o modo "ler" ou sem escrita, a senha não resolve, então não vem "codigo"."""
        with patch.object(e.Pagina, '_pode_responder', lambda s: False):
            for dados in ({'anfitriao': 'recepcao', 'canal': CANAL}, {'limpar': True},
                          {'anfitriao': 'recepcao', 'canal': CANAL, 'conferir': True}):
                status, corpo = self.pedir('recepcionista', dados)
                self.assertEqual(status, 403)
                self.assertIn('não está ligado', corpo['erro'])
                self.assertNotIn('codigo', corpo)
        self.assertEqual(self.chamadas, [])
        self.assertFalse(os.path.exists(self.arq))

    def test_lista_do_servidor_limita_a_tela(self):
        """A revisão do #2: com ESCRITORIO_VISITAS_ANFITRIOES só com recepcao, a tela não põe outro agente na sala."""
        with patch.object(e, 'ANFITRIOES_VISITAS', {'recepcao'}), patch.object(e, 'CANAL_VISITAS', CANAL), \
                patch.object(e, 'TELA_VISITAS', False):
            for dados in ({'anfitriao': '@interno', 'canal': CANAL},
                          {'anfitriao': 'interno', 'canal': CANAL, 'conferir': True}):
                status, corpo = self.pedir('recepcionista', dados)
                self.assertEqual(status, 400)
                self.assertIn('liberados no servidor', corpo['erro'])
            self.assertEqual(self.chamadas, [], 'recusa antes de chamar o agentes.chat')
            self.assertFalse(os.path.exists(self.arq))
            self.assertEqual(self.pedir('anfitrioes', {})[1], {'agentes': [{'id': 'ag-1', 'nome': 'Recepção'}]})
            self.assertEqual(self.pedir('criar', {'agente': 'ag-2'})[0], 400)
            st, estado = self.pedir('recepcionista', {'anfitriao': 'recepcao', 'canal': CANAL})
            self.assertEqual((st, estado['origem'], estado['tela'], estado['liberados'], estado['canal']),
                             (200, 'tela', 'limite', ['recepcao'], CANAL))
            with open(self.arq, 'wb') as f:   # arquivo antigo com um agente que saiu da lista: não vale
                f.write(ajustes.bytes_da_recepcao({'anfitriao': 'interno', 'canal': CANAL}))
            self.assertEqual(self.pedir('recepcionista', {})[1]['origem'], 'variaveis')
            self.assertEqual(self.pedir('criar', {'agente': 'ag-2'})[0], 400)

    def test_canal_da_variavel_limita_a_tela(self):
        """A revisão do bcbc634: com a lista definida, a tela não troca o ESCRITORIO_VISITAS_CANAL por outro canal."""
        with patch.object(e, 'ANFITRIOES_VISITAS', {'recepcao'}), patch.object(e, 'CANAL_VISITAS', OUTRO), \
                patch.object(e, 'TELA_VISITAS', True):
            for dados in ({'anfitriao': 'recepcao', 'canal': CANAL},
                          {'anfitriao': 'recepcao', 'canal': CANAL, 'conferir': True}):
                status, corpo = self.pedir('recepcionista', dados)
                self.assertEqual(status, 400)
                self.assertIn('ESCRITORIO_VISITAS_CANAL', corpo['erro'])
            self.assertEqual(self.chamadas, [], 'recusa antes de chamar o agentes.chat')
            self.assertFalse(os.path.exists(self.arq))
            with open(self.arq, 'wb') as f:   # arquivo antigo com outro canal: não vale
                f.write(ajustes.bytes_da_recepcao({'anfitriao': 'recepcao', 'canal': CANAL}))
            estado = self.pedir('recepcionista', {})[1]
            self.assertEqual((estado['origem'], estado['canal']), ('variaveis', OUTRO))

    def test_tela_fechada_sem_lista_nem_permissao(self):
        with open(self.arq, 'wb') as f:
            f.write(ajustes.bytes_da_recepcao({'anfitriao': 'interno', 'canal': CANAL}))
        with patch.object(e, 'TELA_VISITAS', False):
            st, estado = self.pedir('recepcionista', {})
            self.assertEqual((st, estado['origem'], estado['tela']), (200, 'nenhum', 'fechada'))
            self.assertIn('ESCRITORIO_VISITAS_TELA=1', estado['faltam'][0])
            for dados in ({'anfitriao': 'recepcao', 'canal': CANAL},
                          {'anfitriao': 'recepcao', 'canal': CANAL, 'conferir': True}):
                status, corpo = self.pedir('recepcionista', dados)
                self.assertEqual(status, 403)
                self.assertIn('desligada neste servidor', corpo['erro'])
            self.assertEqual(self.pedir('anfitrioes', {})[1], {'agentes': []}, 'o arquivo antigo não vale')
            self.assertEqual(self.pedir('recepcionista', {'limpar': True})[0], 200, 'tirar o arquivo antigo pode')
        self.assertEqual(self.chamadas, [])
        self.assertFalse(os.path.exists(self.arq))

    def test_mostra_o_que_falta(self):
        with patch.object(e, 'carregar_times', lambda: {'conversas': 'ler'}):
            self.servidor.cred = SimpleNamespace(tem_escrita=lambda: False)
            faltam = self.pedir('recepcionista', {})[1]['faltam']
        self.assertEqual(len(faltam), 3)
        self.assertIn('"conversas": "responder"', faltam[1])
        self.assertIn('mandar tarefas', faltam[2])


class PonteTroca(unittest.TestCase):
    def test_anfitriao_trocado_deixa_de_receber(self):
        from visitas_sala import Salas
        tempo = [1000.0]
        salas = Salas(lambda: tempo[0])
        chamadas = []
        leitor = SimpleNamespace(
            foto=lambda: {'agentes': [{'id': 'ag-1', 'handle': 'recepcao'}, {'id': 'ag-2', 'handle': 'nova'}]},
            pausado=lambda agora=None: False, pausa_ate=0, cred=SimpleNamespace(token=lambda: 'tok'),
            mcp=SimpleNamespace(sessao='s', iniciar=lambda t: None,
                                ferramenta=lambda nome, args, token: chamadas.append(nome) or {}))
        recepcao = [({'nova'}, CANAL, 'tela')]
        ponte = e.PonteVisitas(salas, leitor, lambda: recepcao[0], relogio=lambda: tempo[0])
        visita = salas.entrar(salas.criar({'id': 'ag-1', 'nome': 'Recepção'}))
        salas.enviar(visita, 'oi')
        salas.receber(visita)
        with redirect_stdout(io.StringIO()):
            ponte.passo()
        self.assertEqual(chamadas, [])
        self.assertIn('não está disponível', ' '.join(salas.receber(visita)))


if __name__ == '__main__':
    unittest.main()
