# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A recepção pública não deve divulgar nenhuma informação interna."""
import json
import unittest
from unittest.mock import patch
import test_visitas_http as suporte_http


class RecepcaoPublica(unittest.TestCase):
    setUp = suporte_http.VisitasHTTP.setUp
    tearDown = suporte_http.VisitasHTTP.tearDown
    pedir = suporte_http.VisitasHTTP.pedir

    def test_fila_publica_nao_ocupa_limites_de_convidados(self):
        from visitas_sala import MAX_ORIGENS, LimiteRequisicoes
        salas = self.servidor.salas_visitas
        for numero in range(MAX_ORIGENS):
            salas.limitar_origem(str(numero), publica=True)
        with self.assertRaises(LimiteRequisicoes):
            salas.limitar_origem('mais-uma', publica=True)
        convite = self.pedir('criar', {}, admin=True)[2]['convite']
        self.assertEqual(self.pedir('entrar', {'convite': convite})[0], 200)

    def test_recepcao_tem_limite_independente(self):
        with patch('visitas_sala.MAX_REQUISICOES_ORIGEM', 2):
            self.assertEqual(self.pedir('recepcao', {})[0], 200)
            self.assertEqual(self.pedir('recepcao', {})[0], 200)
            self.assertEqual(self.pedir('recepcao', {})[0], 429)
            convite = self.pedir('criar', {}, admin=True)[2]['convite']
            self.assertEqual(self.pedir('entrar', {'convite': convite})[0], 200)

    def test_recepcao_aberta_sem_expor_salas_privadas(self):
        class Planta:
            def publica(self):
                return {'salas': {'recepcao': {'piso': 2}, 'time:Segredo': {'piso': 3}},
                        'moveis': {'time:Segredo|sofa_cinza|0': {'fora': True}, 'recepcaoX|sofa_cinza|0': {'fora': True}, 'recepcao|sofa_cinza|0': {'fora': True, 'dado_privado': 'segredo'}, 'recepcao|inexistente|0': {'fora': True}},
                        'novos': [{'sala': 'time:Segredo', 'nome': 'planta_g1', 'x': 10, 'y': 20, 'e': False}, {'sala': 'recepcao', 'nome': 'planta_g1', 'x': 4, 'y': 5, 'e': False, 'dado_privado': 'segredo'}]}
        class Leitor:
            def foto(self):
                raise AssertionError('A recepção não deve consultar agentes nem tarefas')
        self.servidor.planta = Planta()
        self.servidor.leitor = Leitor()
        status, headers, resultado = self.pedir('recepcao', {})
        self.assertEqual(status, 200)
        self.assertEqual(headers['Cache-Control'], 'no-store')
        self.assertEqual(resultado['grupos'], [])
        self.assertEqual(resultado['planta']['salas'], {'recepcao': {'piso': 2}})
        self.assertEqual(resultado['planta']['moveis'], {'recepcao|sofa_cinza|0': {'fora': True}})
        self.assertEqual(resultado['planta']['novos'], [{'sala': 'recepcao', 'nome': 'planta_g1', 'x': 4, 'y': 5, 'e': False}])
        self.assertNotIn('Set-Cookie', headers)
        self.assertEqual(self.pedir('recepcao', {'extra': True})[0], 400)
        self.assertNotIn('Segredo', json.dumps(resultado))
        self.assertEqual(self.pedir('mapa', {'sessao': 'sem-convite'})[0], 403)
        self.assertEqual(self.pedir('recepcao', {}, origem='https://outro.example')[0], 403)

    def test_recepcao_entrega_so_o_tipo_de_tempo(self):
        class Clima:
            estado = {'tipo': 'neve', 'cidade': 'Cidade Secreta', 'temperatura': -2, 'lat': -19.9, 'lon': -44.1}
            def foto(self):
                return self.estado
        self.servidor.clima = Clima()
        resultado = self.pedir('recepcao', {})[2]
        self.assertEqual(resultado['clima'], 'neve')
        texto = json.dumps(resultado)
        for proibido in ('Cidade Secreta', 'temperatura', '-19.9', 'lat'):
            self.assertNotIn(proibido, texto)
        Clima.estado = {'tipo': '<script>'}
        self.assertEqual(self.pedir('recepcao', {})[2]['clima'], 'limpo')
        Clima.estado = None
        self.assertEqual(self.pedir('recepcao', {})[2]['clima'], 'limpo')
        self.assertEqual(self.pedir('recepcao', {})[2]['vento'], 0)

    def test_recepcao_entrega_o_vento_arredondado(self):
        class Clima:
            estado = {'tipo': 'tempestade', 'vento': 37.4, 'cidade': 'Cidade Secreta'}
            def foto(self):
                return self.estado
        self.servidor.clima = Clima()
        resultado = self.pedir('recepcao', {})[2]
        self.assertEqual(resultado['vento'], 40)
        self.assertNotIn('37.4', json.dumps(resultado))
        for bruto, publico in ((None, 0), ('forte', 0), (True, 0), (-5, 0), (float('nan'), 0), (float('inf'), 0),
                               (4, 0), (5, 0), (16, 20), (300, 120)):
            self.assertEqual(suporte_http.e.vento_publico(bruto), publico, bruto)

    def test_bairro_publico_sem_cookie_e_sem_cache_da_pagina(self):
        import http.client
        for nome, cache in (('mundo.html', 'no-store'), ('mundo.js', 'no-cache'), ('ceu.js', 'no-cache'), ('clima.js', 'no-cache'),
                            ('som.js', 'no-cache')):
            conexao = http.client.HTTPConnection(*self.servidor.server_address, timeout=3)
            try:
                conexao.request('GET', '/' + nome)
                resposta = conexao.getresponse()
                corpo = resposta.read()
                self.assertEqual(resposta.status, 200, nome)
                self.assertEqual(resposta.getheader('Cache-Control'), cache, nome)
                self.assertIsNone(resposta.getheader('Set-Cookie'), nome)
                self.assertTrue(corpo)
            finally:
                conexao.close()
        # o restante do escritório continua fechado para quem não entrou
        conexao = http.client.HTTPConnection(*self.servidor.server_address, timeout=3)
        try:
            conexao.request('GET', '/vida.js')
            self.assertNotEqual(conexao.getresponse().status, 200)
        finally:
            conexao.close()


if __name__ == '__main__':
    unittest.main()
