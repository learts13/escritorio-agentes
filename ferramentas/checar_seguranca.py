"""Confere no servidor de verdade (rotas reais, sem rede) as regras de login, origem, cookie e limite de tentativas.
Uso: python -B ferramentas/checar_seguranca.py <pasta do projeto>   (sai com 1 se algo falhar)
"""
import hashlib, json, os, shutil, sys, tempfile, threading, time, urllib.parse, urllib.request, urllib.error
PROJ = sys.argv[1]
os.environ["ESCRITORIO_DADOS"] = tempfile.mkdtemp(prefix="esc-verif-")
os.environ["ESCRITORIO_TIMES"] = os.path.join(os.environ["ESCRITORIO_DADOS"], "times.json")  # nunca o times.json real
with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as f:
    f.write('{"conversas": "ler"}')
sys.path.insert(0, PROJ)
import escritorio as e
from acesso import Acesso, LIMITE
import novidades
from http.server import ThreadingHTTPServer

class L:
    def foto(self): return {"agentes": [], "trabalhos": [], "atualizado": None, "erro": None}
srv = ThreadingHTTPServer(("127.0.0.1", 0), e.Pagina)
srv.leitor, srv.acesso = L(), Acesso(os.environ["ESCRITORIO_DADOS"])
srv.cred = e.Credenciais(os.path.join(os.environ["ESCRITORIO_DADOS"], "oauth.json"))  # sem conexao; o state e conferido antes da rede
threading.Thread(target=srv.serve_forever, daemon=True).start()
base = "http://127.0.0.1:%d" % srv.server_address[1]; e.BASE = base
cod = open(os.path.join(os.environ["ESCRITORIO_DADOS"], "codigo-primeiro-acesso.txt")).read().strip()
srv.acesso.criar_primeiro(cod, "dono", "senha-bem-grande")

class NR(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
op = urllib.request.build_opener(NR)
def req(rota, cab=None, dados=None, metodo=None):
    r = urllib.request.Request(base + rota, headers=cab or {}, data=dados, method=metodo)
    try:
        with op.open(r) as x: return x.status, x.headers
    except urllib.error.HTTPError as err: return err.code, err.headers

falhas = []
def confere(rotulo, obtido, esperado):
    ok = obtido == esperado
    if not ok: falhas.append(rotulo)
    print("%s %s -> %s%s" % ("ok   " if ok else "FALHA", rotulo, obtido, "" if ok else " (esperado %s)" % (esperado,)))

form = urllib.parse.urlencode({"usuario": "dono", "senha": "senha-bem-grande"}).encode()
print("== Achado 2: formularios de entrar, primeiro acesso e sair")
confere("GET /entrar Referrer-Policy (o navegador passa a mandar o Origin real no POST)", req("/entrar")[1]["Referrer-Policy"], "same-origin")
for rota in ("/entrar", "/primeiro-acesso", "/sair"):
    confere("POST %s com Origin: null continua recusado" % rota, req(rota, {"Origin": "null"}, form)[0], 403)
confere("POST /entrar com Origin: null e Referer valido (Referer so conta sem Origin)", req("/entrar", {"Origin": "null", "Referer": base + "/entrar"}, form)[0], 403)
confere("POST /entrar sem Origin e sem Referer", req("/entrar", {}, form)[0], 403)
st, h = req("/entrar", {"Origin": base}, form)
confere("POST /entrar com o Origin que o navegador manda agora", st, 303)
ck = h.get("Set-Cookie") or ""

print("== Achado 3: volta do OAuth (navegacao vinda do agentes.chat)")
confere("cookie da sessao com SameSite=Lax (vai junto numa navegacao GET de outro site)", "SameSite=Lax" in ck, True)
confere("cookie da sessao sem SameSite=Strict", "SameSite=Strict" in ck, False)
st, h = req("/oauth/retorno?code=abc&state=xyz")
confere("GET /oauth/retorno sem cookie (outro site, sem sessao) cai no login", (st, h.get("Location")), (302, "/entrar"))
st, _ = req("/oauth/retorno?code=abc&state=xyz", {"Cookie": ck.split(";")[0]})
confere("GET /oauth/retorno com o cookie Lax chega ao OAuth (state falso -> 400, nao 302 /entrar)", st, 400)

print("== Conectar (C1): paginas de erro do OAuth, endereco errado e bind")
def req_corpo(rota, cab=None, dados=None):
    r = urllib.request.Request(base + rota, headers=cab or {}, data=dados)
    try:
        with op.open(r) as x: return x.status, x.headers, x.read().decode()
    except urllib.error.HTTPError as err: return err.code, err.headers, err.read().decode()
st, h, pag = req_corpo("/entrar", {"Origin": "https://outro.exemplo"}, form)
confere("POST /entrar de outro endereco: 403 com a pagina de entrar, sem cookie", (st, h.get("Set-Cookie")), (403, None))
confere("... mostra o endereco configurado e nao ecoa o Origin", (base in pag, "outro.exemplo" in pag), (True, False))
sessao = {"Cookie": ck.split(";")[0]}
hostil = urllib.parse.quote("<script>alert(1)</script> evil.example")
st, h, pag = req_corpo("/oauth/retorno?error=access_denied&error_description=" + hostil, sessao)
confere("GET /oauth/retorno com error_description hostil: 400 em HTML, sem repetir o texto",
        (st, h.get("Content-Type"), "evil" in pag, "<script" in pag), (400, "text/html; charset=utf-8", False, False))
st, _, pag = req_corpo("/oauth/retorno?error=" + hostil, sessao)
confere("GET /oauth/retorno com error hostil: o codigo fora de [a-z_] nao aparece", (st, "evil" in pag, "<script" in pag), (400, False, False))
emissor, e.EMISSOR = e.EMISSOR, "http://127.0.0.1:9"   # porta fechada: nada sai para o agentes.chat
st, h, pag = req_corpo("/oauth/conectar", sessao)
confere("GET /oauth/conectar sem rede: 502 com a pagina de aviso", (st, h.get("Content-Type"), 'href="/oauth/conectar"' in pag),
        (502, "text/html; charset=utf-8", True))
e.EMISSOR = emissor
confere("ESCRITORIO_BIND=0.0.0.0 sem ESCRITORIO_BASE definida nao sobe", e.erro_rede(base, "0.0.0.0", 7371, False) is None, False)
confere("ESCRITORIO_BIND fora de 127.0.0.1 e 0.0.0.0 nao sobe", e.erro_rede(base, "::", 7371, True) is None, False)
confere("ESCRITORIO_BASE com caminho ou barra no fim nao sobe", [e.erro_rede(base + x, "127.0.0.1", 7371, True) is None for x in ("/", "/app")], [False, False])

print("== Achado 4: limite de tentativas por usuario")
ruim = urllib.parse.urlencode({"usuario": "qualquer", "senha": "errada-errada"}).encode()
t0 = time.time()
fios = [threading.Thread(target=req, args=("/entrar", {"Origin": base}, ruim)) for _ in range(LIMITE)]
for f in fios: f.start()
for f in fios: f.join()
print("      %d falhas em paralelo com usuario inexistente levaram %.1fs (o atraso fica fora da trava)" % (LIMITE, time.time() - t0))
try:
    srv.acesso.entrar("dono", "senha-bem-grande"); r = "entrou"
except PermissionError as x:
    r = str(x)
confere("dono com a senha certa depois disso", r, "entrou")
a2 = Acesso(tempfile.mkdtemp(prefix="esc-verif2-"))
for _ in range(LIMITE):
    try: a2.entrar("qualquer", "errada-errada")
    except PermissionError: pass
try:
    c2 = open(os.path.join(a2.pasta, "codigo-primeiro-acesso.txt")).read().strip()
    a2.criar_primeiro(c2, "dono", "senha-bem-grande"); r = "criado"
except PermissionError as x:
    r = str(x)
confere("primeiro acesso com o codigo certo depois de %d falhas de inexistente" % LIMITE, r, "criado")

print("== Fase R: modo resposta e envio (Origin obrigatorio, JSON exato, senha)")
class CredEscrita:  # conexao com escrita de mentira: nada sai para o agentes.chat
    def tem_escrita(self): return True
    def token(self): return None
e.TIMES = os.path.join(os.environ["ESCRITORIO_DADOS"], "times.json")
with open(e.TIMES, "w", encoding="utf-8") as f:
    f.write('{"conversas": "responder"}')
srv.cred, srv.respostas = CredEscrita(), e.Respostas(srv.leitor, None)
sessao = {"Cookie": ck.split(";")[0]}
js = lambda senha: json.dumps({"senha": senha}).encode()
for rota in ("/api/conversa/modo", "/api/conversa/responder", "/api/conversa/modo/fechar"):
    confere("POST %s sem Origin, com Referer valido (aqui o Referer nao conta)" % rota,
            req(rota, {**sessao, "Referer": base + "/", "Content-Type": "application/json"}, js("x"))[0], 403)
    confere("POST %s com Origin: null" % rota, req(rota, {**sessao, "Origin": "null", "Content-Type": "application/json"}, js("x"))[0], 403)
confere("POST /api/conversa/modo em text/plain (formulario de outro site)", req("/api/conversa/modo", {**sessao, "Origin": base, "Content-Type": "text/plain"}, js("senha-bem-grande"))[0], 415)
confere("POST /api/conversa/modo sem sessao", req("/api/conversa/modo", {"Origin": base, "Content-Type": "application/json"}, js("senha-bem-grande"))[0], 401)
confere("POST /api/conversa/modo com a senha errada", req("/api/conversa/modo", {**sessao, "Origin": base, "Content-Type": "application/json"}, js("errada-errada"))[0], 403)
st, h = req("/api/conversa/modo", {**sessao, "Origin": base, "Content-Type": "application/json"}, js("senha-bem-grande"))
modo = h.get("Set-Cookie") or ""
confere("POST /api/conversa/modo com a senha certa", st, 200)
confere("cookie do modo SameSite=Strict, HttpOnly e sem Max-Age/Expires (some ao fechar o navegador)",
        ("SameSite=Strict" in modo, "HttpOnly" in modo, "Max-Age" in modo or "Expires" in modo), (True, True, False))
envio = json.dumps({"id": "abcdefghijkl", "run_id": "r1", "texto": "oi", "chave": "0b9c5c55-3b3a-4c7e-9a1e-2f6d1c8b7a10"}).encode()
st, _ = req("/api/conversa/responder", {**sessao, "Origin": base, "Content-Type": "application/json"}, envio)
confere("envio da mesma sessao sem o cookie do modo (outro navegador)", st, 403)

print("== Modo construcao: salvar a planta (Origin obrigatorio, JSON exato, rev)")
srv.planta = e.Planta(e.ARQ_PLANTA, e.log, lambda dados: e.gravar(e.ARQ_PLANTA, dados))
pl = lambda rev, **x: json.dumps({"rev": rev, "salas": {}, "moveis": {}, "novos": [], **x}).encode()
jp = {**sessao, "Origin": base, "Content-Type": "application/json"}
confere("POST /api/planta sem Origin, com Referer valido (aqui o Referer nao conta)",
        req("/api/planta", {**sessao, "Referer": base + "/", "Content-Type": "application/json"}, pl(0))[0], 403)
confere("POST /api/planta com Origin: null", req("/api/planta", {**sessao, "Origin": "null", "Content-Type": "application/json"}, pl(0))[0], 403)
confere("POST /api/planta com Origin de outro site", req("/api/planta", {**jp, "Origin": "https://outro.exemplo"}, pl(0))[0], 403)
confere("POST /api/planta em text/plain (formulario de outro site)", req("/api/planta", {**jp, "Content-Type": "text/plain"}, pl(0))[0], 415)
confere("POST /api/planta sem sessao", req("/api/planta", {"Origin": base, "Content-Type": "application/json"}, pl(0))[0], 401)
confere("POST /api/planta com True no lugar de numero", req("/api/planta", jp, pl(0, salas={"lounge": {"piso": True}}))[0], 400)
grande = pl(0)[:-1] + b" " * 65536 + b"}"
confere("POST /api/planta com JSON valido de mais de 64 KB", req("/api/planta", jp, grande)[0], 400)
confere("POST /api/planta com rev certo", req("/api/planta", jp, pl(0, salas={"lounge": {"piso": 3}}))[0], 200)
confere("POST /api/planta com rev velho", req("/api/planta", jp, pl(0))[0], 409)
st, h = req("/construir.html")
confere("GET /construir.html sem sessao cai no login", (st, h.get("Location")), (302, "/entrar"))

print("== Configuracoes: clima e datas (Origin obrigatorio, JSON exato, numero de verdade, teto, rev)")
e.ARQ_CLIMA = os.path.join(os.environ["ESCRITORIO_DADOS"], "clima.json")
e.ARQ_FESTAS = os.path.join(os.environ["ESCRITORIO_DADOS"], "festas.json")
e.ARQ_EQUIPE = os.path.join(os.environ["ESCRITORIO_DADOS"], "equipe.json")
eq = lambda rev, **x: json.dumps({"rev": rev, "times": [], "aparencia": {}, **x}).encode()
cl = lambda **x: json.dumps({"clima": {"cidade": "Cidade de teste", "lat": -8.05, "lon": -34.88, **x}}).encode()
fe = lambda rev: json.dumps({"rev": rev, "proprias": [], "desligadas": []}).encode()
for rota, bom in (("/api/clima", cl()), ("/api/festas", fe(0)), ("/api/equipe", eq(0))):
    confere("POST %s sem Origin, com Referer valido (aqui o Referer nao conta)" % rota,
            req(rota, {**sessao, "Referer": base + "/", "Content-Type": "application/json"}, bom)[0], 403)
    confere("POST %s com Origin: null" % rota, req(rota, {**sessao, "Origin": "null", "Content-Type": "application/json"}, bom)[0], 403)
    confere("POST %s com Origin de outro site" % rota, req(rota, {**jp, "Origin": "https://outro.exemplo"}, bom)[0], 403)
    confere("POST %s em text/plain (formulario de outro site)" % rota, req(rota, {**jp, "Content-Type": "text/plain"}, bom)[0], 415)
    confere("POST %s sem sessao" % rota, req(rota, {"Origin": base, "Content-Type": "application/json"}, bom)[0], 401)
    teto = {"/api/clima": e.CLIMA_BYTES, "/api/festas": e.FESTAS_BYTES, "/api/equipe": e.EQUIPE_BYTES}[rota]
    confere("POST %s com JSON valido acima do teto (%d B)" % (rota, teto), req(rota, jp, bom[:-1] + b" " * teto + b"}")[0], 400)
for rotulo, corpo in (("NaN", b'{"clima": {"cidade": "X", "lat": NaN, "lon": 1}}'), ("Infinity", b'{"clima": {"cidade": "X", "lat": Infinity, "lon": 1}}'),
                      ("1e400", b'{"clima": {"cidade": "X", "lat": 1e400, "lon": 1}}'),
                      ("um inteiro de 400 digitos", b'{"clima": {"cidade": "X", "lat": 1' + b"0" * 399 + b', "lon": 1}}'), ("true", cl(lat=True)), ("fora da faixa", cl(lon=181))):
    confere("POST /api/clima com %s no lugar de numero" % rotulo, req("/api/clima", jp, corpo)[0], 400)
confere("POST /api/clima certo", req("/api/clima", jp, cl())[0], 200)
confere("POST /api/festas com dias=true", req("/api/festas", jp, json.dumps({"rev": 0, "proprias": [{"nome": "X", "data": "01-01", "dias": True, "tema": "natal"}], "desligadas": []}).encode())[0], 400)
confere("POST /api/festas com rev certo", req("/api/festas", jp, fe(0))[0], 200)
confere("POST /api/festas com rev velho", req("/api/festas", jp, fe(0))[0], 409)
time_ = {"nome": "Dev", "tipo": "mesas", "cor": None, "icone": None, "parede": 9, "piso": 0, "agentes": []}
confere("POST /api/equipe com parede fora da faixa", req("/api/equipe", jp, eq(0, times=[time_]))[0], 400)
confere("POST /api/equipe com parede=true", req("/api/equipe", jp, eq(0, times=[{**time_, "parede": True}]))[0], 400)
confere("POST /api/equipe com o modo de conversas (fica no servidor)", req("/api/equipe", jp, eq(0, conversas="responder"))[0], 400)
confere("POST /api/equipe com rev certo", req("/api/equipe", jp, eq(0, times=[{**time_, "parede": 5}]))[0], 200)
confere("POST /api/equipe com rev velho", req("/api/equipe", jp, eq(0))[0], 409)
confere("GET /api/clima/busca sem sessao", req("/api/clima/busca?q=Recife")[0], 401)
confere("GET /api/clima/busca com 1 letra (recusa antes de qualquer rede)", req("/api/clima/busca?q=R", sessao)[0], 400)

print("== Vida social: mandar pro ringue (Origin obrigatorio, JSON exato)")
briga = json.dumps({"a": "a1", "b": "a2"}).encode()
confere("POST /api/social/briga sem Origin, com Referer valido (aqui o Referer nao conta)",
        req("/api/social/briga", {**sessao, "Referer": base + "/", "Content-Type": "application/json"}, briga)[0], 403)
confere("POST /api/social/briga com Origin: null", req("/api/social/briga", {**sessao, "Origin": "null", "Content-Type": "application/json"}, briga)[0], 403)
confere("POST /api/social/briga em text/plain (formulario de outro site)",
        req("/api/social/briga", {**sessao, "Origin": base, "Content-Type": "text/plain"}, briga)[0], 415)
confere("GET /api/social/placar sem sessao", req("/api/social/placar")[0], 401)
greve = json.dumps({"id": "abc"}).encode()   # atender a greve: as mesmas barreiras do ringue
confere("POST /api/social/greve/atender sem Origin, com Referer valido",
        req("/api/social/greve/atender", {**sessao, "Referer": base + "/", "Content-Type": "application/json"}, greve)[0], 403)
confere("POST /api/social/greve/atender com Origin: null",
        req("/api/social/greve/atender", {**sessao, "Origin": "null", "Content-Type": "application/json"}, greve)[0], 403)
confere("POST /api/social/greve/atender em text/plain",
        req("/api/social/greve/atender", {**sessao, "Origin": base, "Content-Type": "text/plain"}, greve)[0], 415)
confere("POST /api/social/greve/atender sem sessao", req("/api/social/greve/atender", {"Origin": base, "Content-Type": "application/json"}, greve)[0], 401)
print("== Visitantes (presenca so na memoria, id anonimo, nunca a propria sessao)")
srv.visitantes = e.Visitantes()
outra = {"Cookie": req("/entrar", {"Origin": base}, form)[1]["Set-Cookie"].split(";")[0]}
vis = lambda cab, q="": json.loads(req_corpo("/api/estado" + q, cab)[2])["visitantes"]
vis(sessao)
v = vis(outra)
tok = sessao["Cookie"].partition("=")[2]
confere("GET /api/estado: a outra sessao aparece so com id e cor", [sorted(x) for x in v], [["cor", "id"]])
confere("... o id nao sai do token nem do sha da sessao", v[0]["id"] in tok + hashlib.sha256(tok.encode()).hexdigest(), False)
confere("... a propria sessao nao se ve (so a outra)", [x["id"] == v[0]["id"] for x in vis(sessao)], [False])
tv = {"Cookie": req("/entrar", {"Origin": base}, form)[1]["Set-Cookie"].split(";")[0]}
confere("... com ?invisivel=1 uma sessao nova olha sem aparecer", (len(vis(tv, "?invisivel=1")), len(vis(sessao))), (2, 1))
print("== Jornal (GET com sessao, so ids de presentes e numeros)")
srv.jornal = e.Jornal(e.log, e.FUSO)
srv.jornal.ler([("terminou", "agente-1")], {"tarefas": []}, time.time())
confere("GET /api/jornal sem sessao", req("/api/jornal")[0], 401)
st, _, corpo = req_corpo("/api/jornal", sessao)
confere("GET /api/jornal com sessao, sem o agente que nao esta na leitura", (st, json.loads(corpo)["semana"]["agentes"]), (200, []))
print("== Novidades (GET com sessao, o changelog do disco, links so do repositorio)")
confere("GET /api/novidades sem sessao", req("/api/novidades")[0], 401)
st, _, corpo = req_corpo("/api/novidades", sessao)
nov = json.loads(corpo)
confere("GET /api/novidades com sessao, da versao instalada", (st, nov["versao"], nov["entradas"][0]["versao"]), (200, e.VERSAO, e.VERSAO))
urls = [m.group(2) for x in nov["entradas"] for s in x["secoes"] for i in s["itens"] for m in novidades.LINK.finditer(i)]
confere("... todo link do changelog sai para o repositorio (nenhum relativo, nenhum de fora)",
        (bool(urls), [u for u in urls if not u.startswith(novidades.REPO)]), (True, []))
confere("POST /api/novidades com sessao e Origin certo (so GET)",
        req("/api/novidades", {**sessao, "Origin": base, "Content-Type": "application/json"}, b"{}")[0], 404)
print("== Aviso no celular (push): sessao, Origin estrito, so JSON, 2 KB e lista fechada de hosts")
srv.avisos = e.Avisos("CHAVE", lambda endpoint, agora: "vapid t=x, k=y", e.log, e.FUSO)
pj = {**sessao, "Origin": base, "Content-Type": "application/json"}
fcm = json.dumps({"endpoint": "https://fcm.googleapis.com/fcm/send/x"}).encode()
for rota in ("/api/push/chave", "/api/avisos"):
    confere("GET %s sem sessao" % rota, req(rota)[0], 401)
for rota in ("/api/push/assinar", "/api/push/sair"):
    confere("POST %s sem sessao" % rota, req(rota, {"Origin": base, "Content-Type": "application/json"}, fcm)[0], 401)
    confere("POST %s de outra origem" % rota, req(rota, {**pj, "Origin": "https://outro.exemplo"}, fcm)[0], 403)
    confere("POST %s sem Origin, com Referer valido" % rota,
            req(rota, {**sessao, "Referer": base + "/", "Content-Type": "application/json"}, fcm)[0], 403)
    confere("POST %s em text/plain" % rota, req(rota, {**pj, "Content-Type": "text/plain"}, fcm)[0], 415)
    confere("POST %s acima de 2 KB" % rota, req(rota, pj, fcm[:-1] + b" " * 2048 + b"}")[0], 400)
for fora in ("https://evil.example/push", "http://127.0.0.1:9/push", "https://fcm.googleapis.com.evil.example/x"):
    st, _, corpo = req_corpo("/api/push/assinar", pj, json.dumps({"endpoint": fora}).encode())
    confere("POST /api/push/assinar com host fora da lista (%s)" % fora.split("/")[2], (st, json.loads(corpo)["erro"]),
            (400, "endpoint_invalido"))
confere("POST /api/push/assinar com o FCM e tudo certo", req("/api/push/assinar", pj, fcm)[0], 200)
print("== Sair de todos os aparelhos (Origin obrigatorio, JSON exato, senha no balde do login)")
sj = lambda senha: json.dumps({"senha": senha}).encode()
confere("POST /api/sair-todos sem Origin, com Referer valido (aqui o Referer nao conta)",
        req("/api/sair-todos", {**sessao, "Referer": base + "/", "Content-Type": "application/json"}, sj("senha-bem-grande"))[0], 403)
confere("POST /api/sair-todos com Origin: null", req("/api/sair-todos", {**sessao, "Origin": "null", "Content-Type": "application/json"}, sj("senha-bem-grande"))[0], 403)
confere("POST /api/sair-todos em text/plain", req("/api/sair-todos", {**jp, "Content-Type": "text/plain"}, sj("senha-bem-grande"))[0], 415)
confere("POST /api/sair-todos sem sessao", req("/api/sair-todos", {"Origin": base, "Content-Type": "application/json"}, sj("senha-bem-grande"))[0], 401)
confere("POST /api/sair-todos com a senha errada", req("/api/sair-todos", jp, sj("errada-errada"))[0], 403)
confere("... a sessao continua depois da senha errada", req("/api/estado", sessao)[0], 200)
st, h = req("/api/sair-todos", jp, sj("senha-bem-grande"))
confere("POST /api/sair-todos com a senha certa apaga os dois cookies", (st, len(h.get_all("Set-Cookie") or [])), (200, 2))
confere("... e a sessao deixa de valer", req("/api/estado", sessao)[0], 401)
srv.shutdown()
for pasta in (os.environ["ESCRITORIO_DADOS"], a2.pasta):   # as pastas temporárias não ficam no %TEMP%
    shutil.rmtree(pasta, ignore_errors=True)
print("RESULTADO:", "tudo certo" if not falhas else "%d falha(s)" % len(falhas))
sys.exit(1 if falhas else 0)
