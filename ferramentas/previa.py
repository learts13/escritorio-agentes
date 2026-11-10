"""Prévia local da página, sem OAuth: serve static/ e um /api/estado montado com a mesma
função resumir() do servidor, a partir de um arquivo com as respostas brutas do MCP.
O arquivo é relido quando muda e passa pelo mesmo diário de transições do servidor: para ver
os eventos, edite o status das tarefas (ou tire/ponha tarefas) com a prévia aberta.
Só para desenvolvimento; não vai para a VPS.
Uso: python ferramentas/previa.py dados_brutos.json [--resolvidos]  ->  http://127.0.0.1:7372 (outra porta: PREVIA_PORTA=7373)
--resolvidos: na subida, passa o diário por leituras no passado para mostrar pedidos "resolvidos hoje" (os 3 desfechos).
Página Conversas: a lista do dia sai da mesma memória do servidor (com --resolvidos, também as terminadas) e cada
conversa aberta é uma conversa fictícia, sempre a mesma, com horários relativos a agora (a última mensagem fica
depois do fim das terminadas, para o corte do fim da tarefa aparecer). Liga com "conversas": "ler" no times.json.
Vida social: o diretor do servidor (social.py) roda com a leitura deste arquivo, no expediente do Personalizar. Para
forçar uma briga na hora (dois agentes sem tarefa, dentro do expediente), o mesmo POST do "Mandar pro ringue":
  curl -H "Origin: http://127.0.0.1:7372" -H "Content-Type: application/json" -d '{"a": "<id>", "b": "<id>"}'
       http://127.0.0.1:7372/api/social/briga
--greve: força uma greve no primeiro passo do diretor (como se já houvesse 5 reclamações hoje), com os livres do arquivo,
dentro do expediente; para atender, o clique na plaquinha ou o POST /api/social/greve/atender {"id": "<cena.id>"}.
--conexao <estado>: o "conexao" do /api/estado, para ver cada faixa sem OAuth: conectado (o padrão), carregando,
sem_conexao, recusada (HTTP 403), pausa (429) ou falha. Os dois primeiros e o sem_conexao saem sem agentes, como no
servidor antes da primeira leitura; os outros mantêm a leitura do arquivo, como o servidor mantém a última. O "erro"
traz o mesmo texto do servidor. A prévia não tem conexão: o /oauth/conectar dela cai na página de erro e não sai daqui.
Configurações: o clima e as datas salvos pela tela vão para a pasta temporária; a busca de cidade chama o Open-Meteo
de verdade, com o mesmo limite do servidor. PREVIA_ESTATICO=<pasta static> serve as telas de outro floor.
--visitantes N (0 a 8): a prévia não tem sessão, então ninguém vira visitante; com N, o "visitantes" do /api/estado traz N
visitantes fixos, com id e cor pelo mesmo cálculo do servidor.
Jornal: o mesmo jornal.py do servidor conta as leituras deste arquivo (e as brigas e greves da vida social) e grava o
jornal.json na pasta temporária. --jornal: sobe com a semana atual (até hoje) e a anterior já preenchidas, com números
sorteados (semente fixa) para os agentes do arquivo, pela mesma validação do jornal.json.
--push: liga o aviso no celular com o mesmo avisos.py e a mesma chave VAPID (vapid.json na pasta temporária), mas todo
envio vai a um servidor de push falso, local (127.0.0.1, porta sorteada), que só responde 201 e escreve uma linha
"push falso: ..." sem o endpoint. Nada sai para a rede. Para disparar, ponha uma tarefa do arquivo em waiting_approval
ou waiting_input com a prévia aberta. Sem --push, as rotas do push respondem 404.
"""
import atexit, datetime, json, os, random, shutil, signal, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import tempfile
os.environ["ESCRITORIO_DADOS"] = tempfile.mkdtemp(prefix="escritorio-previa-")
# a pasta temporária sai junto com a prévia (Ctrl+C, SIGTERM, Ctrl+Break ou erro na subida); o Stop-Process do Windows, que
# encerra sem aviso, é o único que deixa a pasta para trás
atexit.register(shutil.rmtree, os.environ["ESCRITORIO_DADOS"], ignore_errors=True)
for sinal in (signal.SIGTERM, getattr(signal, "SIGBREAK", None)):   # SIGBREAK: o Ctrl+Break do Windows
    if sinal:
        signal.signal(sinal, lambda *_: sys.exit(0))
PORTA = int(os.environ.get("PREVIA_PORTA", "7372"))
# A checagem de origem dos POST compara com a BASE: a prévia declara a própria, antes do import.
os.environ["ESCRITORIO_BASE"] = f"http://127.0.0.1:{PORTA}"
import escritorio as e
import social
from jornal import CLIMAS as jornal_climas, segunda as jornal_segunda

# PREVIA_ESTATICO=<pasta static de outro floor>: as telas de um floor contra o servidor deste (sem cópia de arquivo)
if os.environ.get("PREVIA_ESTATICO"):
    e.ESTATICO = os.path.abspath(os.environ["PREVIA_ESTATICO"])

ARGS = sys.argv[1:]
CONEXAO = "conectado"
if "--conexao" in ARGS:   # --conexao <estado> (o valor sai da lista, para não virar o arquivo)
    i = ARGS.index("--conexao")
    CONEXAO = ARGS[i + 1] if i + 1 < len(ARGS) else ""
    del ARGS[i:i + 2]
CONEXAO = next((a.split("=", 1)[1] for a in ARGS if a.startswith("--conexao=")), CONEXAO)
if CONEXAO not in e.CONEXOES:
    sys.exit("--conexao: use " + ", ".join(e.CONEXOES))
VISITANTES = "0"
if "--visitantes" in ARGS:   # --visitantes N, como o --conexao
    i = ARGS.index("--visitantes")
    VISITANTES = ARGS[i + 1] if i + 1 < len(ARGS) else ""
    del ARGS[i:i + 2]
if VISITANTES not in [str(n) for n in range(9)]:
    sys.exit("--visitantes: use um número de 0 a 8")
VISITANTES = int(VISITANTES)
VAZIO = {"agentes": [], "trabalhos": [], "tarefas": [], "eventos": [], "resolvidos": [], "atualizado": None}

class Token:
    def token(self):
        return "previa"


class Falso:
    def __init__(self, arquivo):
        self.arquivo, self.marca = arquivo, None
        self.estado = {"agentes": [], "trabalhos": [], "tarefas": [], "eventos": [], "resolvidos": []}
        self.diario, self.trava, self.jornal = e.Diario(), threading.Lock(), None
        self.memoria, self.conversas, self.cred = e.ConversasDoDia(), {"por_id": {}, "mudou": {}}, Token()

    def _ler(self, bruto, tarefas, agora=None):
        """Uma "leitura": o Diario, o jornal e a memória da página Conversas, como no Leitor.ciclo()."""
        estado = self.diario.aplicar(e.resumir(bruto["agents"], tarefas), agora=agora)
        if self.jornal:
            self.jornal.ler(self.diario.novos, estado, time.time() if agora is None else agora)
        if getattr(self, "avisos", None):
            self.avisos.transicoes(self.diario.novos, estado, time.time() if agora is None else agora)
        self.conversas = self.memoria.atualizar(e.normalizar(bruto["agents"], tarefas)[1],
                                                {t["run_id"]: t.get("desde") for t in estado["tarefas"]}, True,
                                                time.time() if agora is None else agora)
        return estado

    def pausado(self, agora=None):
        return CONEXAO == "pausa"   # as rotas que chamam o MCP (a ficha da conversa) também veem a pausa

    def conversas_do_dia(self):
        self.foto()   # o arquivo pode ter mudado
        return self.conversas

    def semear_resolvidos(self):
        """--resolvidos: o Diario de verdade passa por 4 leituras no passado (sem lista inventada). Até 3 tarefas em
        andamento, de agentes diferentes, viram pedidos; uma vira outro pedido no meio; mais um pedido extra some no fim.
        A última leitura é o próprio arquivo, então a primeira foto não gera transição nova."""
        with open(self.arquivo, encoding="utf-8") as f:
            bruto = json.load(f)
        livres, vistos = [], set()
        for t in bruto["tasks"]:
            ag = (t.get("agent") or {}).get("id")
            if t.get("status") in ("running", "still_running") and ag not in vistos:
                vistos.add(ag); livres.append(t)
        livres = livres[:3]
        if not livres:
            return
        pedidos = [dict(t, status=s) for t, s in zip(livres, ("waiting_approval", "waiting_input", "waiting_approval"))]
        # o extra vai para um agente sem tarefa, para ter rótulo próprio (2 pedidos do mesmo agente: só 1 tem rótulo)
        sem_tarefa = [a["id"] for a in bruto["agents"] if a["id"] not in {(t.get("agent") or {}).get("id") for t in bruto["tasks"]}]
        extra = dict(livres[0], agent={"id": sem_tarefa[0]} if sem_tarefa else livres[0]["agent"], run_id="previa-resolvido",
                     status="waiting_input", label="Confirmar o horário da reunião")
        outros = [t for t in bruto["tasks"] if t not in livres]
        agora = time.time()
        leituras = ((40, bruto["tasks"]), (30, outros + pedidos + [extra]),   # minutos atrás
                    (15, outros + pedidos[:2] + [dict(pedidos[2], status="waiting_input")] + [extra]), (5, bruto["tasks"]))
        for minutos, tarefas in leituras:
            self._ler(bruto, tarefas, agora - minutos * 60)

    def foto(self):
        with self.trava:
            erro = None
            try:
                marca = os.stat(self.arquivo).st_mtime_ns
                if marca != self.marca:  # arquivo mudou: é uma "leitura" nova
                    with open(self.arquivo, encoding="utf-8") as f:
                        bruto = json.load(f)
                    self.estado = self._ler(bruto, bruto["tasks"])
                    self.marca = marca
            except (OSError, ValueError, KeyError, TypeError) as x:  # salvo pela metade, renomeado ou sem as listas
                erro = f"prévia: não consegui ler {os.path.basename(self.arquivo)} ({type(x).__name__}); mostrando a leitura anterior"
            agora = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
            if CONEXAO == "carregando":
                return {**VAZIO, "erro": "Carregando…", "conexao": CONEXAO}
            if CONEXAO == "sem_conexao":
                return {**VAZIO, "erro": e.SEM_CONEXAO, "conexao": CONEXAO}
            textos = {"recusada": e.texto_recusa(403), "pausa": e.PAUSA_429, "falha": e.FALHA_LEITURA}
            return {**self.estado, "atualizado": agora, "erro": textos.get(CONEXAO, erro), "conexao": CONEXAO}

def semear_jornal(jornal, arquivo):
    """--jornal: números sorteados para a semana atual (até hoje) e a anterior, com os agentes do arquivo."""
    with open(arquivo, encoding="utf-8") as f:
        agentes = [a["id"] for a in json.load(f)["agents"]]
    rng, hoje = random.Random(7), datetime.datetime.now(e.FUSO).date()
    semanas = {}
    for inicio in (jornal_segunda(hoje) - datetime.timedelta(days=7), jornal_segunda(hoje)):
        dias = [inicio + datetime.timedelta(days=n) for n in range(7) if inicio + datetime.timedelta(days=n) <= hoje]
        semanas[inicio.isoformat()] = {
            "agentes": {a: [rng.randint(0, 30), rng.randint(0, 8), rng.randint(0, 8), rng.randint(0, 900)] for a in agentes},
            "dias": {d.isoformat(): {"clima": rng.choice(sorted(jornal_climas)), "greves": int(rng.random() < 0.2),
                                     "brigas": rng.randint(0, 3)} for d in dias}}
    with jornal.trava:
        jornal.semanas, jornal.sujo = e.validar_jornal({"v": 1, "semanas": semanas}), True


class PushFalso(BaseHTTPRequestHandler):
    """--push: o serviço de push de mentira. Responde 201, como o FCM, e diz só o que chegou (nunca o endpoint)."""
    def do_POST(self):
        vazio = self.headers.get("Content-Length", "0") == "0"
        vapid = (self.headers.get("Authorization") or "").startswith("vapid t=")
        print(f"push falso: aviso recebido (vapid: {vapid}, vazio: {vazio}, TTL: {self.headers.get('TTL')}, "
              f"Urgency: {self.headers.get('Urgency')})", flush=True)
        self.send_response(201)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *a):
        pass


class VisitantesDaPrevia(e.Visitantes):
    """--visitantes N: N marcas fixas, renovadas a cada pedido, no lugar das sessões que a prévia não tem."""
    def ver(self, token, agora, marcar=True):
        with self.trava:
            self.visto.update({f"previa-{n}": agora for n in range(VISITANTES)})
        return super().ver(token, agora, marcar)


class ConversasFicticias(e.Conversas):
    """O Conversas do servidor (cache, tetos, corte do fim), com a conversa vinda daqui em vez do agentes.chat."""
    FALAS = ((40, "person", "Bom dia! Consegue revisar o rascunho de hoje e me dizer o que falta?", 0),
             (38, "agent", "Bom dia! Revisei: faltam a conclusão e duas fontes. Quer que eu complete?", 0),
             (12, "person", "Pode completar, por favor. Mandei a planilha de apoio.", 1),
             (11, "agent", "Feito. Deixei as fontes no fim e marquei o que mudou.", 0),
             (1, "person", "Obrigado! Depois vejo com calma.", 0))   # minutos atrás; texto fictício

    def _buscar(self, destino, token, agora):   # a mesma assinatura do servidor: thread ou canal, conta nos tetos
        self.chamadas.append(agora)
        return {"messages": [{"author": {"kind": quem, "name": "Agente da prévia" if quem == "agent" else "Pessoa fictícia"},
                              "sent_at": e._iso(agora - minutos * 60), "untrusted_text": texto,
                              "attachments": [{"name": "anexo"}] * anexos} for minutos, quem, texto, anexos in self.FALAS]}


srv = e.Servidor(("127.0.0.1", PORTA), e.Pagina)
srv.leitor, srv.cred = Falso([a for a in ARGS if not a.startswith("--")][0]), None
srv.conversas = ConversasFicticias(srv.leitor)
# clima vivo, como no servidor: a cidade salva pela tela vai para o clima.json da pasta temporária (sobe mais abaixo)
srv.clima = e.Clima(lambda: e.clima_vigente()[0])
# o tempo das cidades do mapa do mundo: um exemplo fixo, sem Open-Meteo, com cada tipo em alguma cidade (a noite vem do
# horário na página). ?clima= e ?hora= no /mundo.html sobrepõem, para ver cada caso.
srv.clima_mundo = e.ClimaMundo(*e.ler_mundo())
srv.clima_mundo.estado = {c["id"]: {"tipo": e.TIPOS_CLIMA[i % len(e.TIPOS_CLIMA)], "vento": round(i % 5 / 4, 2), "noite": False}
                          for i, c in enumerate(srv.clima_mundo.cidades)}
# o jornal da semana, como no servidor: o jornal.json vai para a pasta temporária; o clima do meio-dia sai do clima vivo
srv.jornal = srv.leitor.jornal = e.Jornal(e.log, e.FUSO, lambda dados: e.gravar(e.ARQ_JORNAL, dados), e.ler_jornal(),
                                          lambda: (srv.clima.foto() or {}).get("tipo"))
if "--push" in ARGS:   # o aviso no celular, com o servidor de push falso no lugar do serviço de verdade
    falso = ThreadingHTTPServer(("127.0.0.1", 0), PushFalso)
    threading.Thread(target=falso.serve_forever, daemon=True).start()
    destino = "http://127.0.0.1:%d/push" % falso.server_address[1]
    # a BASE da prévia é http, que o VAPID não aceita como sub: um mailto: de domínio reservado, só daqui
    srv.avisos = srv.leitor.avisos = e.criar_avisos(destino=lambda endpoint: destino, sub="mailto:previa@example.com")
    srv.avisos.start()   # a chave da prévia nasce agora, na pasta temporária: nunca é ilegível
if "--jornal" in ARGS:
    semear_jornal(srv.jornal, [a for a in ARGS if not a.startswith("--")][0])
if "--resolvidos" in ARGS:
    srv.leitor.semear_resolvidos()
srv.acesso = e.Acesso(os.environ["ESCRITORIO_DADOS"])
srv.previa_sem_login = True  # prévia local, só em 127.0.0.1
srv.visitantes = VisitantesDaPrevia()
# o mesmo diretor do servidor, com a leitura do arquivo; o placar semanal vai para o placar.json da pasta temporária
srv.social = e.Social(srv.leitor, e.config_publica, e.log, e.FUSO, guardar=lambda dados: e.gravar(e.ARQ_PLACAR, dados),
                      placar=e.ler_placar(), contar_jornal=srv.jornal.contar)
if "--greve" in ARGS:   # o dia já começa com as reclamações; a greve sai no primeiro passo (com 3 livres ou mais)
    srv.social.dia = e.datetime.datetime.now(e.FUSO).date()
    srv.social.reclamaram_hoje = ["previa"] * social.GREVE_RECLAMACOES
srv.social.start()
# modo construção: a planta salva vai para o planta.json da pasta temporária (some ao fechar a prévia)
srv.planta = e.Planta(e.ARQ_PLANTA, e.log, lambda dados: e.gravar(e.ARQ_PLANTA, dados))
srv.clima.start()
print(e.BASE, flush=True)
print("dados temporários:", os.environ["ESCRITORIO_DADOS"], flush=True)   # somem ao sair
try:
    srv.serve_forever()
except KeyboardInterrupt:   # Ctrl+C: sai sem traceback, e o atexit apaga a pasta
    pass
