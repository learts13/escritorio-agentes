# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Testes HTTP locais, sem proxy ou serviços externos."""
import http.client
import json
import threading
import unittest
from unittest.mock import patch

import escritorio as e


class AcessoFalso:
    def sessao(self, token):
        return 'equipe' if token == 'admin-teste' else None


class VisitasHTTP(unittest.TestCase):
    def setUp(self):
        self.servidor = e.Servidor(('127.0.0.1', 0), e.Pagina)
        self.servidor.acesso = AcessoFalso()
        self.thread = threading.Thread(target=self.servidor.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.servidor.shutdown()
        self.servidor.server_close()
        self.thread.join()

    def pedir(self, acao, dados, admin=False, origem=None, headers=None):
        conexao = http.client.HTTPConnection(*self.servidor.server_address, timeout=3)
        cabecalhos = {'Origin': e.BASE if origem is None else origem, 'Content-Type': 'application/json'}
        if admin:
            cabecalhos['Cookie'] = e.nome_cookie() + '=admin-teste'
        cabecalhos.update(headers or {})
        try:
            conexao.request('POST', '/api/visitas/' + acao, json.dumps(dados), cabecalhos)
            resposta = conexao.getresponse()
            return resposta.status, dict(resposta.getheaders()), json.loads(resposta.read())
        finally:
            conexao.close()

    def test_isolamento_revogacao_e_cache(self):
        self.assertEqual(self.pedir('criar', {})[0], 401)
        self.assertEqual(self.pedir('criar', {}, admin=True, origem='https://outro.example')[0], 403)
        status, headers, resultado = self.pedir('criar', {}, admin=True)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        convite = resultado['convite']
        outro = self.pedir('criar', {}, admin=True)[2]['convite']
        a = self.pedir('entrar', {'convite': convite})[2]['sessao']
        b = self.pedir('entrar', {'convite': convite})[2]['sessao']
        c = self.pedir('entrar', {'convite': outro})[2]['sessao']
        conexao = http.client.HTTPConnection(*self.servidor.server_address, timeout=3)
        try:
            conexao.request('GET', '/api/estado', headers={'Cookie': e.nome_cookie() + '=' + a})
            resposta = conexao.getresponse()
            self.assertEqual(resposta.status, 401)
            self.assertEqual(resposta.getheader('Cache-Control'), 'no-store')
            resposta.read()
        finally:
            conexao.close()
        self.assertEqual(self.pedir('enviar', {'sessao': a, 'texto': 'privado'})[0], 200)
        self.assertEqual(self.pedir('receber', {'sessao': b})[2]['mensagens'], ['privado'])
        self.assertEqual(self.pedir('receber', {'sessao': c})[2]['mensagens'], [])
        self.assertEqual(self.pedir('revogar', {'convite': convite})[0], 401)
        self.assertTrue(self.pedir('revogar', {'convite': convite}, admin=True)[2]['ok'])
        self.assertEqual(self.pedir('receber', {'sessao': a})[0], 403)
        self.assertEqual(self.pedir('entrar', {'convite': convite})[0], 403)

    def test_cabecalho_forjado_nao_contorna_limite_de_sessoes(self):
        convite = self.pedir('criar', {}, admin=True)[2]['convite']
        for numero in range(4):
            self.assertEqual(self.pedir('entrar', {'convite': convite},
                                        headers={'X-Forwarded-For': '192.0.2.' + str(numero + 1)})[0], 200)
        self.assertEqual(self.pedir('entrar', {'convite': convite},
                                    headers={'X-Forwarded-For': '192.0.2.200'})[0], 400)

    def test_tentativas_invalidas_tem_limite(self):
        for _ in range(120):
            self.assertEqual(self.pedir('entrar', {'convite': 'invalido'})[0], 403)
        self.assertEqual(self.pedir('entrar', {'convite': 'invalido'})[0], 429)

    def test_endereco_atual_quando_configuracao_muda(self):
        with patch.object(e, 'BASE', 'https://escritorio.example'):
            self.assertEqual(self.pedir('criar', {}, admin=True)[0], 200)

    def test_proxy_explicito_separa_origens_e_exige_cabecalho(self):
        self.servidor.proxy_visitas = e.proxy_visitas('127.0.0.1')
        convite = self.pedir('criar', {}, admin=True)[2]['convite']
        self.assertEqual(self.pedir('entrar', {'convite': convite})[0], 400)
        for _ in range(4):
            self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'X-Real-IP': '192.0.2.1'})[0], 200)
        self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'X-Real-IP': '192.0.2.1'})[0], 400)
        self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'X-Real-IP': '192.0.2.2'})[0], 200)
        self.servidor.proxy_visitas = e.proxy_visitas('192.0.2.10')
        self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'X-Real-IP': '192.0.2.3'})[0], 400)

    def test_convite_com_agente_so_aceita_anfitriao_autorizado(self):
        class Leitor:
            def foto(self):
                return {'agentes': [{'id': 'ag-1', 'nome': 'Senku', 'handle': 'senku'},
                                    {'id': 'ag-2', 'nome': 'Interno', 'handle': 'interno'}]}
        self.servidor.leitor = Leitor()
        canal = '01a1bda0-9c52-74b8-8f93-79ac3cc91d90'
        # desligado por padrão: sem lista, sem canal ou sem o modo "responder", nenhum anfitrião
        for anfitrioes, canal_cfg, responder in (({'senku'}, '', True), (set(), canal, True), ({'senku'}, canal, False)):
            with patch.object(e, 'ANFITRIOES_VISITAS', anfitrioes), patch.object(e, 'CANAL_VISITAS', canal_cfg), \
                    patch.object(e.Pagina, '_pode_responder', lambda self, r=responder: r):
                self.assertEqual(self.pedir('anfitrioes', {}, admin=True)[2], {'agentes': []})
                self.assertEqual(self.pedir('criar', {'agente': 'ag-1'}, admin=True)[0], 400)
        with patch.object(e, 'ANFITRIOES_VISITAS', {'senku'}), patch.object(e, 'CANAL_VISITAS', canal), \
                patch.object(e.Pagina, '_pode_responder', lambda self: True):
            # sem o modo resposta aberto com a senha, como no envio pela tela Conversas, não cria sala com agente
            with patch.object(e.Pagina, '_modo_resposta', lambda self: None):
                status, _, dados = self.pedir('criar', {'agente': 'ag-1'}, admin=True)
                self.assertEqual(status, 403)
                self.assertIn('modo resposta', dados['erro'])
                self.assertEqual(dados['codigo'], 'modo_fechado', 'a tela pede a senha ali mesmo')
                self.assertEqual(self.pedir('criar', {}, admin=True)[0], 200, 'sala só de pessoas não precisa')
            with patch.object(e.Pagina, '_modo_resposta', lambda self: (3600, 28800)):
                self._agente_autorizado()

    def _agente_autorizado(self):
        self.assertEqual(self.pedir('anfitrioes', {})[0], 401)
        self.assertEqual(self.pedir('anfitrioes', {}, admin=True)[2], {'agentes': [{'id': 'ag-1', 'nome': 'Senku'}]})
        self.assertEqual(self.pedir('criar', {'agente': 'ag-2'}, admin=True)[0], 400, 'agente fora da lista')
        self.assertEqual(self.pedir('criar', {'agente': 'ag-x'}, admin=True)[0], 400)
        self.assertEqual(self.pedir('criar', {'agente': 'ag-1'})[0], 401)
        self.assertEqual(self.pedir('criar', {'agente': 'ag-1', 'extra': 1}, admin=True)[0], 400)
        convite = self.pedir('criar', {'agente': 'ag-1'}, admin=True)[2]['convite']
        status, _, dados = self.pedir('entrar', {'convite': convite})
        self.assertEqual((status, dados['agente']), (200, 'Senku'))
        self.assertNotIn('ag-1', json.dumps(dados))
        sem = self.pedir('criar', {}, admin=True)[2]['convite']
        self.assertIsNone(self.pedir('entrar', {'convite': sem})[2]['agente'])

    def test_tunel_cloudflare_usa_cf_connecting_ip(self):
        self.servidor.proxy_visitas = e.proxy_visitas('127.0.0.1')
        self.servidor.cabecalho_visitas = 'CF-Connecting-IP'
        convite = self.pedir('criar', {}, admin=True)[2]['convite']
        # com o túnel, o X-Real-IP não vale: vem do visitante, não do proxy
        self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'X-Real-IP': '192.0.2.1'})[0], 400)
        for _ in range(4):
            self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'CF-Connecting-IP': '192.0.2.1'})[0], 200)
        self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'CF-Connecting-IP': '192.0.2.1'})[0], 400)
        self.assertEqual(self.pedir('entrar', {'convite': convite}, headers={'CF-Connecting-IP': '2001:db8::1'})[0], 200)
        from email.message import Message
        headers = Message()
        headers.add_header('CF-Connecting-IP', '192.0.2.1')
        with self.assertRaises(ValueError):
            e.origem_visita('127.0.0.1', headers, e.proxy_visitas('127.0.0.1'), 'X-Forwarded-For')

    def test_ipv6_conta_pelo_bloco_64(self):
        from email.message import Message
        from visitas_sala import MAX_ORIGEM_ATIVA, Salas
        proxy = e.proxy_visitas('127.0.0.1')
        def origem(ip):
            headers = Message()
            headers.add_header('CF-Connecting-IP', ip)
            return e.origem_visita('127.0.0.1', headers, proxy, 'CF-Connecting-IP')
        self.assertEqual(origem('2001:db8:1:2::1'), origem('2001:db8:1:2:ffff:ffff:ffff:ffff'))
        self.assertNotEqual(origem('2001:db8:1:2::1'), origem('2001:db8:1:3::1'))
        self.assertEqual(origem('::ffff:192.0.2.7'), '192.0.2.7')
        self.assertEqual(origem('192.0.2.7'), '192.0.2.7')
        self.assertEqual(e.origem_visita('2001:db8:9::5', Message(), None), '2001:db8:9::/64')
        # um único /64 não abre a sala inteira: o limite por origem vale para o bloco
        salas = Salas()
        convite = salas.criar()
        for n in range(MAX_ORIGEM_ATIVA):
            salas.entrar(convite, origem=origem(f'2001:db8:1:2::{n + 1:x}'))
        with self.assertRaises(ValueError):
            salas.entrar(convite, origem=origem('2001:db8:1:2::abcd'))
        salas.entrar(convite, origem=origem('2001:db8:7:7::1'))
        # e 1.025 endereços do mesmo /64 ocupam uma vaga só na tabela de origens
        enderecos = {origem(f'2001:db8:1:2::{n + 1:x}') for n in range(1025)}
        self.assertEqual(enderecos, {'2001:db8:1:2::/64'})

    def test_proxy_rejeita_cabecalho_multiplo_e_lista(self):
        from email.message import Message
        headers = Message()
        headers.add_header('X-Real-IP', '192.0.2.1')
        headers.add_header('X-Real-IP', '192.0.2.2')
        with self.assertRaises(ValueError):
            e.origem_visita('127.0.0.1', headers, e.proxy_visitas('127.0.0.1'))
        del headers['X-Real-IP']
        headers.add_header('X-Real-IP', '192.0.2.1, 192.0.2.2')
        with self.assertRaises(ValueError):
            e.origem_visita('127.0.0.1', headers, e.proxy_visitas('127.0.0.1'))
        with self.assertRaises(ValueError):
            e.proxy_visitas('127.0.0.0/8')

    def test_mapa_exige_sessao_e_nao_divulga_dados_internos(self):
        class Leitor:
            def foto(self):
                return {'agentes': [{'handle': '@secreto', 'nome': 'Pessoa privada'}],
                        'trabalhos': [{'conteudo': 'Mensagem privada'}]}
        class Planta:
            def publica(self):
                return {'salas': {'reuniao': {'piso': 2}, 'time:Segredo': {'piso': 3}},
                        'moveis': {'time:Segredo|segredo|0': {'fora': True},
                                   'time:Segredo|sofa_cinza|0': {'fora': True}},
                        'novos': [{'sala': 'time:Segredo', 'nome': 'planta_g1', 'x': 10, 'y': 20, 'e': False}]}
        self.servidor.leitor, self.servidor.planta = Leitor(), Planta()
        config = {'times': [{'nome': 'Segredo', 'tipo': 'mesas', 'parede': 1, 'piso': 2,
                             'cor': None, 'icone': None, 'agentes': ['@secreto']}],
                  'empresa': 'Empresa privada', 'conversas': 'Mensagem privada'}
        convite = self.pedir('criar', {}, admin=True)[2]['convite']
        sessao = self.pedir('entrar', {'convite': convite})[2]['sessao']
        with patch.object(e, 'config_publica', return_value=config):
            self.assertEqual(self.pedir('mapa', {'sessao': 'invalida'})[0], 403)
            status, headers, mapa = self.pedir('mapa', {'sessao': sessao})
            self.assertEqual(status, 200)
            self.assertEqual(headers['Cache-Control'], 'no-store')
            self.assertEqual(mapa['grupos'][0]['nome'], 'Equipe 1')
            self.assertEqual(mapa['planta']['salas'], {'reuniao': {'piso': 2}, 'time:Equipe 1': {'piso': 3}})
            self.assertEqual(mapa['planta']['moveis'], {'time:Equipe 1|sofa_cinza|0': {'fora': True}})
            self.assertEqual(mapa['planta']['novos'][0]['sala'], 'time:Equipe 1')
            for dado in ('Segredo', '@secreto', 'Pessoa privada', 'Mensagem privada', 'Empresa privada'):
                self.assertNotIn(dado, json.dumps(mapa))
            self.pedir('revogar', {'convite': convite}, admin=True)
            self.assertEqual(self.pedir('mapa', {'sessao': sessao})[0], 403)


if __name__ == '__main__':
    unittest.main()
