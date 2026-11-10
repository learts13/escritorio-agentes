# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Teste local com dados fictícios: python3 -B ferramentas/checar_visitas.py [captura.png]."""
import os
import subprocess
import sys
import threading
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RAIZ)
import escritorio as e
class Acesso:
    def sessao(self, token): return None
    def precisa_configurar(self): return False
servidor = e.Servidor(('127.0.0.1', 0), e.Pagina)
servidor.acesso = Acesso()
e.BASE = 'http://127.0.0.1:' + str(servidor.server_port)
convite = servidor.salas_visitas.criar()
thread = threading.Thread(target=servidor.serve_forever, daemon=True)
thread.start()
try:
    resultado = subprocess.run(['node', os.path.join(RAIZ, 'ferramentas', 'checar_visitas.mjs'), e.BASE, convite, *sys.argv[1:2]], timeout=60)
    sys.exit(resultado.returncode)
finally:
    servidor.shutdown()
    servidor.server_close()
    thread.join()
