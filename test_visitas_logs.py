# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Verifica o log da aplicação, sem presumir a configuração de proxy ou CDN."""
import contextlib
import io
import json
import socket
import struct
import time
import unittest

import test_visitas_http as suporte_http


class PrivacidadeLogs(unittest.TestCase):
    setUp = suporte_http.VisitasHTTP.setUp
    tearDown = suporte_http.VisitasHTTP.tearDown
    pedir = suporte_http.VisitasHTTP.pedir

    def test_credenciais_e_mensagens_fora_dos_logs_http(self):
        saida, erros = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erros):
            status, _, resposta = self.pedir('criar', {}, admin=True)
            self.assertEqual(status, 200)
            convite = resposta['convite']
            status, _, resposta = self.pedir('entrar', {'convite': convite})
            self.assertEqual(status, 200)
            sessao = resposta['sessao']
            mensagem = 'conteúdo privado de teste'
            self.assertEqual(self.pedir('enviar', {'sessao': sessao, 'texto': mensagem})[0], 200)
            self.assertEqual(self.pedir('receber', {'sessao': sessao})[2]['mensagens'], [mensagem])
            self.assertEqual(self.pedir('sair', {'sessao': sessao})[0], 200)
        log = saida.getvalue() + erros.getvalue()
        for valor in (convite, sessao, mensagem):
            self.assertNotIn(valor, log)

    def test_erro_inesperado_registra_so_o_tipo(self):
        saida, erros = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erros):
            try:
                raise ValueError('texto privado 203.0.113.9')
            except ValueError:
                self.servidor.handle_error(None, ('203.0.113.9', 51234))
        log = saida.getvalue() + erros.getvalue()
        self.assertNotIn('203.0.113.9', log)
        self.assertNotIn('texto privado', log)
        self.assertNotIn('Traceback', log)
        self.assertEqual(json.loads(log)['erro'], 'ValueError')

    def test_conexao_cortada_no_meio_do_corpo_fica_fora_do_log(self):
        saida, erros = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(erros):
            cliente = socket.create_connection(self.servidor.server_address, timeout=3)
            cliente.sendall(b'POST /api/visitas/entrar HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\n'
                            b'Content-Length: 500\r\n\r\n{"convite": "')
            # fecha com RST (SO_LINGER 0): a leitura do corpo no servidor cai com ConnectionResetError
            cliente.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
            cliente.close()
            for _ in range(250):
                if saida.getvalue() or erros.getvalue():
                    break
                time.sleep(0.02)
        log = saida.getvalue() + erros.getvalue()
        # o caminho de erro rodou (log vazio passaria sem provar nada) e registrou só o tipo
        self.assertEqual(json.loads(log.splitlines()[0])['evento'], 'http', log)
        self.assertIn('ConnectionResetError', log)
        self.assertNotIn(self.servidor.server_address[0], log)
        self.assertNotIn('Exception occurred', log)


if __name__ == '__main__':
    unittest.main()
