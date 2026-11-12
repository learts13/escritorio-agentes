"""agentes.chat de mentira, para testar o Conectar inteiro no navegador sem o agentes.chat real.

OAuth (registro dinâmico, consentimento com "Autorizar" e "Recusar", token com PKCE S256, renovação e revogação) e um
/mcp que responde ao initialize, à notificação e ao tools/call de list_agents e list_recent_tasks, com os dados
fictícios do previa.exemplo.json (relido a cada leitura: edite os status com tudo aberto). Só biblioteca padrão.
Escuta só em 127.0.0.1. Só para desenvolvimento: não vai na imagem nem na VPS, e nada daqui fala com a internet.

Uso: python -I -B ferramentas/agentes_falso.py [--modo ok] [--porta 7390] [--dados arquivo.json] [--escritorio]
                [--porta-escritorio 7381]
  --escritorio  sobe junto o escritório de verdade em http://127.0.0.1:7381 (ou na --porta-escritorio: cada um da
                equipe com a sua), já apontado para este servidor, com uma
                pasta de dados temporária (apagada ao sair), o times.exemplo.json e um AGENTES_ORG fictício. Mostra o
                código de primeiro acesso. Nunca usa a 7371 nem a pasta de dados dela.
  Sem o --escritorio, rode o escritório à mão com AGENTES_URL=http://127.0.0.1:7390 (como uma self-host),
  ESCRITORIO_BASE=http://127.0.0.1:7381, ESCRITORIO_PORTA=7381,
  ESCRITORIO_DADOS=<pasta temporária>, ESCRITORIO_TIMES=times.exemplo.json e um AGENTES_ORG fictício.

Modos (--modo, ou com tudo aberto: curl -d mcp_403 http://127.0.0.1:7390/_modo):
  ok              tudo funciona
  registro_falha  o registro do app cai sem resposta (como rede ou DNS fora)
  registro_4xx    o registro recusa o endereço de retorno (HTTP 400)
  recusa          o consentimento recusa até no "Autorizar" (error=access_denied, com um error_description hostil)
  token_recusado  a troca do código pelo token responde HTTP 400 (invalid_grant)
  escopo_a_mais   o token vem com "read write manage" (o escritório revoga e recusa)
  mcp_401 mcp_402 mcp_403 mcp_429   o /mcp responde esse status (o 429 com Retry-After: 60)
"""
import base64
import hashlib
import html
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PASTA = os.path.dirname(os.path.abspath(__file__))
PROJETO = os.path.dirname(PASTA)
MODOS = ("ok", "registro_falha", "registro_4xx", "recusa", "token_recusado", "escopo_a_mais",
         "mcp_401", "mcp_402", "mcp_403", "mcp_429")
VALIDADE = 600   # código e consentimento valem 10 min, como o state do escritório
# o que o agentes.chat de verdade poderia mandar de ruim: o escritório nunca pode repetir isto na tela
HOSTIL = '<script>alert(1)</script> entre em https://evil.example e digite a sua senha'
ORG_FICTICIA = "00000000-0000-4000-8000-000000000000"
PORTA_ESCRITORIO = 7381


def desafio(verificador):
    return base64.urlsafe_b64encode(hashlib.sha256(verificador.encode()).digest()).rstrip(b"=").decode()


def em_uso(porta):
    """Alguém já atende nessa porta? (no Windows, o SO_REUSEADDR deixaria dois servidores na mesma porta)"""
    try:
        socket.create_connection(("127.0.0.1", porta), timeout=0.5).close()
        return True
    except OSError:
        return False


class Falso(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, porta, modo, dados):
        super().__init__(("127.0.0.1", porta), Pagina)
        self.modo, self.dados, self.trava = modo, dados, threading.Lock()
        self.clientes = {}      # client_id -> {"redirect_uris", "nome", "escopo"}
        self.pedidos = {}       # id do consentimento -> os parâmetros do authorize
        self.codigos = {}       # código -> {"cliente", "redirect_uri", "desafio", "escopo", "resource", "em"}
        self.acessos, self.renovacoes, self.sessoes = {}, {}, set()   # token -> escopo; refresh -> (cliente, escopo)

    def emitir(self, cliente, escopo):
        acesso, renovacao = "falso-ac-" + secrets.token_urlsafe(16), "falso-rf-" + secrets.token_urlsafe(16)
        self.acessos[acesso] = escopo
        self.renovacoes[renovacao] = (cliente, escopo)
        concedido = "read write manage" if self.modo == "escopo_a_mais" else escopo
        return {"access_token": acesso, "refresh_token": renovacao, "token_type": "Bearer", "expires_in": 3600,
                "scope": concedido}

    def ler_dados(self):
        with open(self.dados, encoding="utf-8") as f:
            bruto = json.load(f)
        return bruto.get("agents", []), bruto.get("tasks", [])


class Pagina(BaseHTTPRequestHandler):
    server_version = "agentes-falso"
    sys_version = ""

    def log_message(self, *a):
        pass

    def _log(self, status):
        # só o método, o caminho e o status: a query do authorize e os corpos levam state, código e token
        print(f"agentes_falso {self.command} {urllib.parse.urlsplit(self.path).path} -> {status}", flush=True)

    def _envia(self, status, corpo=b"", tipo="application/json", extra=None):
        self._log(status)
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(corpo)

    def _json(self, status, obj, extra=None):
        return self._envia(status, json.dumps(obj, ensure_ascii=False).encode(), extra=extra)

    def _pagina(self, status, titulo, corpo_html):
        doc = (f'<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
               f'<title>{html.escape(titulo)}</title><body style="font-family:sans-serif;max-width:32rem;margin:3rem auto;'
               f'padding:0 1rem;line-height:1.5"><p style="color:#a00">agentes.chat FALSO (desenvolvimento)</p>'
               f'<h1>{html.escape(titulo)}</h1>{corpo_html}</body></html>')
        return self._envia(status, doc.encode(), "text/html; charset=utf-8")

    def _corpo(self):
        tam = self.headers.get("Content-Length", "0")
        return self.rfile.read(int(tam)) if tam.isdigit() and int(tam) <= 100_000 else b""

    def _form(self):
        return {k: v[0] for k, v in urllib.parse.parse_qs(self._corpo().decode("utf-8", "replace")).items()}

    # ------------------------------------------------------------ GET: a tela de consentimento

    def do_GET(self):
        partes = urllib.parse.urlsplit(self.path)
        if partes.path != "/api/oauth/authorize":
            return self._json(404, {"error": "not_found"})
        q = {k: v[0] for k, v in urllib.parse.parse_qs(partes.query).items()}
        srv = self.server
        cliente = srv.clientes.get(q.get("client_id", ""))
        # erro no cliente ou no retorno não volta ao redirect_uri (RFC 6749 §4.1.2.1): mostra aqui
        if not cliente or q.get("redirect_uri") not in cliente["redirect_uris"]:
            return self._pagina(400, "Pedido inválido", "<p>client_id desconhecido ou redirect_uri diferente do registrado.</p>")
        falta = [k for k in ("state", "code_challenge") if not q.get(k)]
        if q.get("response_type") != "code" or q.get("code_challenge_method") != "S256" or falta \
                or q.get("scope") not in ("read", "read write"):
            return self._pagina(400, "Pedido inválido", "<p>response_type, scope, state ou PKCE S256 fora do esperado.</p>")
        pedido = secrets.token_urlsafe(16)
        with srv.trava:
            agora = time.time()
            srv.pedidos = {k: v for k, v in srv.pedidos.items() if agora - v["em"] < VALIDADE}
            srv.pedidos[pedido] = {**q, "em": agora}
        aviso = "<p><b>Modo recusa:</b> os dois botões recusam.</p>" if srv.modo == "recusa" else ""
        return self._pagina(200, "Autorizar o acesso", (
            f"<p><b>{html.escape(cliente['nome'])}</b> quer acesso <b>{html.escape(q['scope'])}</b> à organização fictícia.</p>"
            f"{aviso}<form method=post action=/api/oauth/authorize>"
            f'<input type=hidden name=pedido value="{pedido}">'
            '<button name=decisao value=autorizar>Autorizar</button> '
            '<button name=decisao value=recusar>Recusar</button></form>'))

    # ------------------------------------------------------------ POST

    def do_POST(self):
        rota, srv = urllib.parse.urlsplit(self.path).path, self.server
        if rota == "/_modo":   # troca o modo com tudo aberto; do navegador (com Origin), nunca
            modo = self._corpo().decode("utf-8", "replace").strip()
            if self.headers.get("Origin") or modo not in MODOS:
                return self._envia(400, ("modos: " + " ".join(MODOS) + "\n").encode(), "text/plain; charset=utf-8")
            srv.modo = modo
            print(f"agentes_falso modo={modo}", flush=True)
            return self._envia(200, f"modo={modo}\n".encode(), "text/plain; charset=utf-8")
        if rota == "/api/oauth/register":
            return self._registrar()
        if rota == "/api/oauth/authorize":
            return self._decidir()
        if rota == "/api/oauth/token":
            return self._token()
        if rota == "/api/oauth/revoke":
            tok = self._form().get("token", "")
            with srv.trava:
                srv.acessos.pop(tok, None)
                srv.renovacoes.pop(tok, None)
            return self._json(200, {})
        if rota == "/mcp":
            return self._mcp()
        return self._json(404, {"error": "not_found"})

    def _registrar(self):
        srv = self.server
        if srv.modo == "registro_falha":   # fecha sem responder: do lado do escritório, é rede fora
            self._log("sem resposta")
            self.close_connection = True
            return self.connection.close()
        if srv.modo == "registro_4xx":
            return self._json(400, {"error": "invalid_redirect_uri", "error_description": HOSTIL})
        try:
            corpo = json.loads(self._corpo())
            uris = corpo["redirect_uris"]
            assert isinstance(uris, list) and uris and all(isinstance(u, str) for u in uris)
            assert corpo.get("token_endpoint_auth_method") == "none"
        except (ValueError, KeyError, TypeError, AssertionError):
            return self._json(400, {"error": "invalid_client_metadata"})
        cliente = "falso-cliente-" + secrets.token_urlsafe(8)
        with srv.trava:
            srv.clientes[cliente] = {"redirect_uris": uris, "nome": str(corpo.get("client_name", "app"))[:80],
                                     "escopo": str(corpo.get("scope", "read"))}
        return self._json(201, {"client_id": cliente, "redirect_uris": uris, "token_endpoint_auth_method": "none"})

    def _decidir(self):
        srv, f = self.server, self._form()
        with srv.trava:
            q = srv.pedidos.pop(f.get("pedido", ""), None)
        if not q or time.time() - q["em"] > VALIDADE:
            return self._pagina(400, "Pedido vencido", "<p>Esse consentimento venceu ou já foi usado.</p>")
        if f.get("decisao") == "autorizar" and srv.modo != "recusa":
            codigo = "falso-codigo-" + secrets.token_urlsafe(16)
            with srv.trava:
                srv.codigos[codigo] = {"cliente": q["client_id"], "redirect_uri": q["redirect_uri"], "em": time.time(),
                                       "desafio": q["code_challenge"], "escopo": q["scope"], "resource": q.get("resource")}
            volta = {"code": codigo, "state": q["state"]}
        else:
            volta = {"error": "access_denied", "error_description": HOSTIL, "state": q["state"]}
        destino = q["redirect_uri"] + ("&" if "?" in q["redirect_uri"] else "?") + urllib.parse.urlencode(volta)
        return self._envia(302, b"", extra={"Location": destino})

    def _token(self):
        srv, f = self.server, self._form()
        tipo = f.get("grant_type")
        if tipo == "authorization_code":
            if srv.modo == "token_recusado":
                return self._json(400, {"error": "invalid_grant", "error_description": HOSTIL})
            with srv.trava:
                c = srv.codigos.pop(f.get("code", ""), None)   # uso único, até quando a troca falha
            if not c or time.time() - c["em"] > VALIDADE or f.get("client_id") != c["cliente"] \
                    or f.get("redirect_uri") != c["redirect_uri"] \
                    or desafio(f.get("code_verifier", "")) != c["desafio"] \
                    or (c["resource"] and f.get("resource") != c["resource"]):
                return self._json(400, {"error": "invalid_grant"})
            with srv.trava:
                return self._json(200, srv.emitir(c["cliente"], c["escopo"]))
        if tipo == "refresh_token":
            with srv.trava:
                velho = srv.renovacoes.pop(f.get("refresh_token", ""), None)
                if not velho or velho[0] != f.get("client_id"):
                    return self._json(400, {"error": "invalid_grant"})
                return self._json(200, srv.emitir(*velho))
        return self._json(400, {"error": "unsupported_grant_type"})

    def _mcp(self):
        srv = self.server
        if srv.modo in ("mcp_401", "mcp_402", "mcp_403", "mcp_429"):
            st = int(srv.modo[4:])
            return self._json(st, {"error": HOSTIL}, {"Retry-After": "60"} if st == 429 else None)
        cab = self.headers.get("Authorization", "")
        if not cab.startswith("Bearer ") or cab[7:] not in srv.acessos:
            return self._json(401, {"error": "invalid_token"}, {"WWW-Authenticate": 'Bearer error="invalid_token"'})
        try:
            msg = json.loads(self._corpo())
            metodo = msg["method"]
        except (ValueError, KeyError, TypeError):
            return self._json(400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
        sessao = self.headers.get("Mcp-Session-Id")
        if metodo == "initialize":
            sid = secrets.token_urlsafe(12)
            with srv.trava:
                srv.sessoes.add(sid)
            return self._json(200, {"jsonrpc": "2.0", "id": msg.get("id"), "result": {
                "protocolVersion": "2025-06-18", "capabilities": {"tools": {}},
                "serverInfo": {"name": "agentes-falso", "version": "0"}}}, {"Mcp-Session-Id": sid})
        if sessao not in srv.sessoes:   # sessão vencida: o escritório faz o initialize de novo
            return self._json(404, {"error": "session not found"})
        if metodo.startswith("notifications/"):
            return self._envia(202)
        if metodo != "tools/call":
            return self._json(200, {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32601, "message": "method not found"}})
        nome = (msg.get("params") or {}).get("name")
        try:
            agentes, tarefas = srv.ler_dados()
        except (OSError, ValueError) as x:
            return self._json(500, {"error": type(x).__name__})
        if nome == "list_agents":
            dados = {"agents": agentes}
        elif nome == "list_recent_tasks":
            dados = {"tasks": tarefas}
        elif nome == "list_channels":
            dados = {"channels": []}
        else:
            return self._json(200, {"jsonrpc": "2.0", "id": msg.get("id"), "result": {
                "isError": True, "content": [{"type": "text", "text": f"{nome}: não existe no servidor falso"}]}})
        return self._json(200, {"jsonrpc": "2.0", "id": msg.get("id"), "result": {
            "structuredContent": dados, "content": [{"type": "text", "text": json.dumps(dados, ensure_ascii=False)}]}})


def subir_escritorio(porta_falso, porta):
    """O escritório de verdade, contra este servidor: só variáveis apontando para o 127.0.0.1 e uma pasta nova."""
    pasta = tempfile.mkdtemp(prefix="escritorio-falso-")
    env = {k: v for k, v in os.environ.items() if not k.startswith(("AGENTES_", "ESCRITORIO_"))}
    env.update(AGENTES_URL=f"http://127.0.0.1:{porta_falso}",   # como uma self-host: o MCP e o login saem dela
               AGENTES_ORG=ORG_FICTICIA, ESCRITORIO_BASE=f"http://127.0.0.1:{porta}",
               ESCRITORIO_PORTA=str(porta), ESCRITORIO_DADOS=pasta,
               ESCRITORIO_TIMES=os.path.join(PROJETO, "times.exemplo.json"))
    assert all(env[k].startswith("http://127.0.0.1:") for k in ("AGENTES_URL", "ESCRITORIO_BASE"))
    proc = subprocess.Popen([sys.executable, "-I", "-B", os.path.join(PROJETO, "escritorio.py")], env=env)
    arq = os.path.join(pasta, "codigo-primeiro-acesso.txt")
    for _ in range(100):
        if os.path.exists(arq) or proc.poll() is not None:
            break
        time.sleep(0.1)
    if os.path.exists(arq):
        with open(arq, encoding="utf-8") as f:
            print(f"\nescritório: http://127.0.0.1:{porta}/entrar  código de primeiro acesso: {f.read().strip()}"
                  f"\ndados temporários: {pasta} (apagados ao sair)\n", flush=True)
    return proc, pasta


def main():
    args = sys.argv[1:]
    valor = lambda nome, padrao: args[args.index(nome) + 1] if nome in args and args.index(nome) + 1 < len(args) else padrao
    modo, porta = valor("--modo", "ok"), int(valor("--porta", "7390"))
    porta_escritorio = int(valor("--porta-escritorio", str(PORTA_ESCRITORIO)))
    dados = valor("--dados", os.path.join(PASTA, "previa.exemplo.json"))
    if modo not in MODOS:
        sys.exit("--modo: use " + ", ".join(MODOS))
    for nome, p in (("--porta", porta), ("--porta-escritorio", porta_escritorio)):
        if p == 7371 or not 1024 <= p <= 65535:
            sys.exit(f"{nome}: uma porta alta livre, fora da 7371 (a do escritório de verdade)")
    if porta == porta_escritorio:
        sys.exit("--porta e --porta-escritorio precisam ser diferentes")
    for p in (porta, porta_escritorio) if "--escritorio" in args else (porta,):
        if em_uso(p):
            sys.exit(f"a porta {p} já está em uso: feche a outra cópia antes")
    srv = Falso(porta, modo, dados)
    print(f"agentes_falso em http://127.0.0.1:{porta} (modo={modo}, dados={dados})", flush=True)
    proc = pasta = None
    if "--escritorio" in args:
        proc, pasta = subir_escritorio(porta, porta_escritorio)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        if proc:
            proc.terminate()
            proc.wait(10)
            shutil.rmtree(pasta, ignore_errors=True)


if __name__ == "__main__":
    main()
