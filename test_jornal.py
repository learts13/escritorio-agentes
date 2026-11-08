"""Jornal do escritório: jornal.py (validação, contagens, semanas e gravação), os ganchos no Diario, no Leitor e no
social.py e a rota GET /api/jornal.
Uso: python -B -m unittest test_escritorio test_jornal
"""
import atexit
import datetime
import json
import os
import random
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request

PASTA = tempfile.mkdtemp(prefix="escritorio-teste-jornal-")
os.environ.setdefault("ESCRITORIO_DADOS", PASTA)   # rodando junto com o test_escritorio, vale a pasta dele
if "ESCRITORIO_TIMES" not in os.environ:
    os.environ["ESCRITORIO_TIMES"] = os.path.join(PASTA, "times.json")
    with open(os.environ["ESCRITORIO_TIMES"], "w", encoding="utf-8") as _f:
        json.dump({"conversas": "ler"}, _f)
os.environ.setdefault("AGENTES_ORG", "00000000-0000-4000-8000-000000000000")  # org fictícia
import escritorio as e  # noqa: E402
import jornal  # noqa: E402
import social  # noqa: E402
from acesso import Acesso  # noqa: E402

SEG = datetime.date(2026, 11, 9)   # uma segunda-feira


# até o fim do processo, e não no tearDownModule: no discover, o escritorio pode ter sido importado com esta pasta, e os
# módulos de teste seguintes ainda gravam nela
atexit.register(shutil.rmtree, PASTA, ignore_errors=True)


def t(dia, hhmm="10:00", s=0):
    """Instante no fuso de Brasília, "dia" dias depois da SEG."""
    h, m = (int(x) for x in hhmm.split(":"))
    return datetime.datetime.combine(SEG + datetime.timedelta(days=dia), datetime.time(h, m), e.FUSO).timestamp() + s


class Logs(list):
    def __call__(self, **campos):
        self.append(campos)


def novo(guardar=None, clima=None, semanas=None):
    logs = Logs()
    return jornal.Jornal(logs, e.FUSO, guardar, semanas, clima), logs


def resumo(*trabalhando, esperando=()):
    return {"tarefas": [{"agente_id": a, "run_id": "r-" + a, "status": "running"} for a in trabalhando] +
                       [{"agente_id": a, "run_id": "w-" + a, "status": "waiting_approval"} for a in esperando]}


def numeros(j, agora, presentes=("a1", "a2", "a3")):
    return {x["id"]: [x[c] for c in jornal.CAMPOS] for x in j.publico(agora, set(presentes))["semana"]["agentes"]}


class Contagem(unittest.TestCase):
    def test_transicoes_do_diario_contam_por_id(self):
        d, (j, _) = e.Diario(), novo()

        def ler(agora, *tarefas):
            lista = [{"agente_id": a, "run_id": r, "status": s} for a, r, s in tarefas]
            d.registrar(lista, {"a1": "pixel", "a2": "orbita"}, agora)
            j.ler(d.novos, {"tarefas": lista}, agora)
        ler(t(0), ("a1", "r1", "running"))   # a primeira leitura é só a base
        self.assertEqual(numeros(j, t(0)), {})
        ler(t(0, s=30), ("a1", "r1", "waiting_approval"), ("a2", "r2", "waiting_input"))
        ler(t(0, s=60), ("a1", "r1", "running"))   # o r2 sumiu: terminou
        ler(t(0, s=90))   # o r1 também
        self.assertEqual(numeros(j, t(0)), {"a1": [1, 1, 0, 0], "a2": [1, 0, 1, 0]})
        self.assertEqual(set(d.eventos[0]), {"em", "tipo", "agente", "run_id"})   # o evento público segue sem o id

    def test_minutos_aproximados_pelas_leituras(self):
        j, _ = novo()
        for n in range(5):   # a primeira não credita; as outras 4, 30 s cada
            j.ler([], resumo("a1", esperando=["a2"]), t(0, s=30 * n))
        self.assertEqual(numeros(j, t(0)), {"a1": [0, 0, 0, 2]})   # esperando a pessoa não conta como trabalho
        j.ler([], resumo("a1"), t(1))   # um buraco de um dia credita no máximo 2 minutos
        self.assertEqual(numeros(j, t(1))["a1"], [0, 0, 0, 4])
        j.ler([], resumo("a1"), t(1, s=30))   # 30 s de sobra...
        j.ler([], resumo(), t(1, s=60))   # ...que se perdem quando ele para
        j.ler([], resumo("a1"), t(1, s=90))
        self.assertEqual(numeros(j, t(1))["a1"], [0, 0, 0, 4])

    def test_teto_de_agentes_e_id_fora_do_formato(self):
        j, _ = novo()
        j.ler([("terminou", f"ag-{n}") for n in range(jornal.JORNAL_MAX + 5)] + [("terminou", "a b"), ("terminou", None),
                                                                                   ("comecou", "a1")], resumo(), t(0))
        sem = j.semanas[SEG.isoformat()]["agentes"]
        self.assertEqual(len(sem), jornal.JORNAL_MAX)
        self.assertNotIn("a b", sem); self.assertNotIn("a1", sem)   # "comecou" não conta

    def test_erro_na_conta_nao_levanta_e_loga_uma_vez(self):
        j, logs = novo()
        for _ in range(3):
            j.ler([], {"tarefas": [{"sem": "campos"}]}, t(0))
        self.assertEqual(logs, [{"evento": "jornal", "resultado": "erro", "detalhe": "KeyError"}])


class Semanas(unittest.TestCase):
    def test_virada_de_semana_e_so_presentes(self):
        j, _ = novo()
        j.ler([("terminou", "a1"), ("terminou", "a2")], resumo(), t(6, "23:59"))   # domingo
        j.contar("briga", t(6, "23:59"))
        j.ler([("pediu_resposta", "a1")], resumo(), t(7, "00:00"))   # segunda: semana nova
        pub = j.publico(t(7), {"a1"})
        self.assertEqual(pub["semana"], {"inicio": "2026-11-16", "dias": [],
                                         "agentes": [{"id": "a1", "tarefas": 0, "aprovacoes": 0, "respostas": 1, "minutos": 0}]})
        self.assertEqual(pub["anterior"], {"inicio": "2026-11-09", "dias": [{"dia": "2026-11-15", "clima": None, "greves": 0,
                                                                              "brigas": 1}],
                                           "agentes": [{"id": "a1", "tarefas": 1, "aprovacoes": 0, "respostas": 0, "minutos": 0}]})
        j.ler([], resumo(), t(21))   # duas semanas depois: as duas saem
        self.assertEqual(list(j.semanas), ["2026-11-30"])
        self.assertEqual(j.publico(t(21), {"a1"})["anterior"]["agentes"], [])

    def test_clima_do_meio_dia(self):
        agora = {"tipo": None}
        j, _ = novo(clima=lambda: agora["tipo"])
        agora["tipo"] = "chuva"
        j.ler([], resumo(), t(0, "11:59"))   # antes do meio-dia, não anota
        self.assertEqual(j.publico(t(0), set())["semana"]["dias"], [])
        agora["tipo"] = None
        j.ler([], resumo(), t(0, "12:00"))   # sem clima ainda: tenta na próxima
        agora["tipo"] = "sol"
        j.ler([], resumo(), t(0, "12:01"))   # fora da lista: não anota
        agora["tipo"] = "chuva"
        j.ler([], resumo(), t(0, "12:30"))
        agora["tipo"] = "limpo"
        j.ler([], resumo(), t(0, "17:00"))   # o da tarde não troca o do meio-dia
        self.assertEqual(j.publico(t(0), set())["semana"]["dias"], [{"dia": "2026-11-09", "clima": "chuva", "greves": 0,
                                                                      "brigas": 0}])

    def test_ganchos_do_social(self):
        contados = []
        s = social.Social(None, None, e.log, e.FUSO, random.Random(3), contar_jornal=lambda tipo, quando: contados.append((tipo, quando)))
        cfg = {"serio": False, "expediente": {"abre": "07:00", "fecha": "20:00"}, "times": []}
        ids = ["ag-a", "ag-b", "ag-c", "ag-d"]
        leitura = {"agentes": [{"id": i, "handle": i} for i in ids], "trabalhos": [], "erro": None}
        inicio = t(0)
        st, corpo = s.ordenar("ag-a", "ag-b", inicio, leitura, cfg)
        self.assertEqual(st, 200)
        fim = inicio + social.AVISO + social.LUTA
        s.passo(fim + social.VISIVEL + 1, leitura, cfg)   # a briga acabou: conta uma vez, no instante do fim
        s.passo(fim + social.VISIVEL + 61, leitura, cfg)
        self.assertEqual(contados[:1], [("briga", fim)])
        s.reclamaram_hoje = ["ag-c"] * social.GREVE_RECLAMACOES   # a greve começa no passo seguinte
        agora = fim + 3 * social.FOLGA_CENA
        s.passo(agora, leitura, cfg)
        self.assertEqual(s.cena["tipo"], "greve")
        self.assertEqual(contados, [("briga", fim), ("greve", agora)])
        j, _ = novo()
        for tipo, quando in contados:
            j.contar(tipo, quando)
        self.assertEqual(j.publico(t(0), set())["semana"]["dias"], [{"dia": "2026-11-09", "clima": None, "greves": 1, "brigas": 1}])


class Gravacao(unittest.TestCase):
    def test_no_maximo_uma_vez_por_minuto_e_le_de_volta(self):
        gravados = []
        j, _ = novo(guardar=gravados.append)
        for n in range(5):   # 0, 30, 60, 90 e 120 s: grava no 0, no 60 e no 120
            j.ler([("terminou", "a1")], resumo("a2"), t(0, s=30 * n))
        self.assertEqual(len(gravados), 3)
        semanas = jornal.validar(json.loads(gravados[-1]))
        self.assertEqual(semanas, {SEG.isoformat(): {"agentes": {"a1": [5, 0, 0, 0], "a2": [0, 0, 0, 2]}, "dias": {}}})
        relido, _ = novo(semanas=semanas)
        self.assertEqual(relido.publico(t(0), {"a1", "a2"}), j.publico(t(0), {"a1", "a2"}))
        j.ler([], resumo(), t(0, s=200))   # nada mudou: não grava
        self.assertEqual(len(gravados), 3)
        j.zerar()   # troca de conta: a leitura seguinte grava o vazio, sem as tarefas da conta velha que "terminaram"
        j.ler([("terminou", "a1")], resumo(), t(0, s=210))
        self.assertEqual(jornal.validar(json.loads(gravados[-1])), {SEG.isoformat(): {"agentes": {}, "dias": {}}})

    def test_falha_ao_gravar_tenta_de_novo_e_loga_uma_vez(self):
        tentativas, falhar = [], [True]

        def guardar(dados):
            tentativas.append(dados)
            if falhar[0]:
                raise OSError("disco cheio")
        j, logs = novo(guardar=guardar)
        for n in range(4):
            j.ler([("terminou", "a1")], resumo(), t(0, s=30 * n))
        self.assertEqual((len(tentativas), logs), (2, [{"evento": "jornal", "resultado": "nao_gravou", "detalhe": "OSError"}]))
        falhar[0] = False
        j.ler([], resumo(), t(0, s=120))
        self.assertEqual(json.loads(tentativas[-1])["semanas"][SEG.isoformat()]["agentes"]["a1"], [4, 0, 0, 0])
        self.assertEqual(len(logs), 1)

    def test_cabe_em_64_kb_tirando_os_menos_ativos_da_semana_mais_velha(self):
        grande = lambda n: f"{n:0>60}"   # uma semana cheia cabe; as duas, não
        semanas = {(SEG - datetime.timedelta(days=7 * k)).isoformat(): {
            "agentes": {grande(n): [n, jornal.JORNAL_TETO, jornal.JORNAL_TETO, jornal.JORNAL_TETO] for n in range(jornal.JORNAL_MAX)},
            "dias": {}} for k in (0, 1)}
        j, _ = novo(semanas=semanas)
        dados = j._serializar()
        self.assertLessEqual(len(dados), jornal.JORNAL_BYTES)
        lido = jornal.validar(json.loads(dados))
        self.assertEqual(len(lido[SEG.isoformat()]["agentes"]), jornal.JORNAL_MAX)   # a semana atual fica inteira
        velha = lido[(SEG - datetime.timedelta(days=7)).isoformat()]["agentes"]
        self.assertNotIn(grande(0), velha); self.assertIn(grande(jornal.JORNAL_MAX - 1), velha)


class Arquivo(unittest.TestCase):
    """O dados/jornal.json: tudo ou nada, e ilegível ou inválido sobe vazio (falha aberta, como o placar)."""
    BOM = {"v": 1, "semanas": {"2026-11-09": {"agentes": {"a1": [1, 2, 3, 4]},
                                              "dias": {"2026-11-15": {"clima": "neve", "greves": 1, "brigas": 0}}}}}

    def setUp(self):
        self.antes, e.ARQ_JORNAL = e.ARQ_JORNAL, os.path.join(tempfile.mkdtemp(prefix="jornal-"), "jornal.json")

    def tearDown(self):
        shutil.rmtree(os.path.dirname(e.ARQ_JORNAL), ignore_errors=True)
        e.ARQ_JORNAL = self.antes

    def gravar(self, bruto):
        with open(e.ARQ_JORNAL, "wb") as f:
            f.write(bruto if isinstance(bruto, bytes) else json.dumps(bruto).encode())

    def com(self, caminho, valor):
        d = json.loads(json.dumps(self.BOM))
        alvo = d
        for k in caminho[:-1]:
            alvo = alvo[k]
        if valor is None:
            del alvo[caminho[-1]]
        else:
            alvo[caminho[-1]] = valor
        return d

    def test_tudo_ou_nada(self):
        self.assertIsNone(e.ler_jornal())   # ausente
        self.gravar(self.BOM)
        self.assertEqual(e.ler_jornal(), self.BOM["semanas"])
        sem, dia = ("semanas", "2026-11-09"), ("semanas", "2026-11-09", "dias", "2026-11-15")
        ruins = [
            b'{"v": 1, "semanas": {"2026-11-09": {"agentes": {"a1": [1, 2, NaN, 4]}, "dias": {}}}}',
            b'{"v": 1, "semanas": {"2026-11-09": {"agentes": {"a1": [1, 2, Infinity, 4]}, "dias": {}}}}',
            b'\xff\xfe', b'[]', b" " * (jornal.JORNAL_BYTES + 1),
            self.com(("v",), 2), self.com(("extra",), 1), self.com(sem + ("agentes", "a1"), [1, 2, True, 4]),
            self.com(sem + ("agentes", "a1"), [1, 2, 3.0, 4]), self.com(sem + ("agentes", "a1"), [1, 2, -1, 4]),
            self.com(sem + ("agentes", "a1"), [1, 2, 3]), self.com(sem + ("agentes", "a1"), [1, 2, 3, jornal.JORNAL_TETO + 1]),
            self.com(sem + ("agentes", "a b"), [0, 0, 0, 0]), self.com(sem + ("rotulo",), "x"),
            self.com(dia + ("clima",), "sol"), self.com(dia + ("brigas",), None), self.com(dia + ("greves",), False),
            self.com(("semanas", "2026-11-09", "dias", "2026-11-16"), {"clima": None, "greves": 0, "brigas": 0}),   # outra semana
            self.com(("semanas", "2026-11-10"), {"agentes": {}, "dias": {}}),   # terça
            self.com(sem + ("agentes",), {f"a{n}": [0, 0, 0, 0] for n in range(jornal.JORNAL_MAX + 1)}),   # acima do teto
            self.com(dia + ("clima",), ["chuva"]),
        ]
        tres = self.com(("semanas", "2026-11-02"), {"agentes": {}, "dias": {}})
        tres["semanas"]["2026-10-26"] = {"agentes": {}, "dias": {}}
        for bruto in ruins + [tres]:   # o último com três semanas
            with self.subTest(bruto=str(bruto)[:80]):
                self.gravar(bruto)
                self.assertIsNone(e.ler_jornal())


class LeituraDoLeitor(unittest.TestCase):
    """O Leitor passa cada leitura que deu certo ao jornal, e um jornal com erro não vira falha de leitura."""
    def test_ciclo_conta_e_nao_cai(self):
        class Mcp:
            sessao, pedidos, tarefas = "s", 0, []

            def iniciar(self, token):
                pass

            def ferramenta(self, nome, args, token):
                self.pedidos += 1
                if nome == "list_agents":
                    return {"agents": [{"id": "a1", "name": "Pixel", "handle": "pixel"}]}
                return {"tasks": self.tarefas}

        class Cred:
            def token(self):
                return "t"
        gravados = []
        leitor = e.Leitor(Cred())
        leitor.mcp, leitor.jornal = Mcp(), novo(guardar=gravados.append)[0]
        leitor.ciclo(t(0))
        leitor.mcp.tarefas = [{"run_id": "r1", "agent": {"id": "a1"}, "status": "running"}]
        leitor.ciclo(t(0, s=30))
        leitor.mcp.tarefas = []
        leitor.ciclo(t(0, s=60))
        self.assertEqual(numeros(leitor.jornal, t(0)), {"a1": [1, 0, 0, 0]})
        leitor.jornal.guardar = lambda dados: 1 / 0   # gravação com erro: a leitura segue conectada
        leitor.mcp.tarefas = [{"run_id": "r2", "agent": {"id": "a1"}, "status": "running"}]
        leitor.ciclo(t(0, s=200))
        self.assertEqual((leitor.foto()["conexao"], leitor.foto()["erro"]), ("conectado", None))


class TrocaDeConta(unittest.TestCase):
    """A leitura da conta velha ainda no ar quando a volta do OAuth zera tudo: a leitura seguinte, da conta nova, recomeça
    o Diario e não conta os "terminou" da conta velha nem os pedidos da nova como novos."""
    def test_corrida_com_a_volta_do_oauth(self):
        contas = {"velha": ([{"id": "velho-1", "name": "A", "handle": "a"}, {"id": "velho-2", "name": "B", "handle": "b"}],
                            [{"run_id": "r-v1", "agent": {"id": "velho-1"}, "status": "running"},
                             {"run_id": "r-v2", "agent": {"id": "velho-2"}, "status": "waiting_input"}]),
                  "nova": ([{"id": "novo-1", "name": "C", "handle": "c"}],
                           [{"run_id": "r-n1", "agent": {"id": "novo-1"}, "status": "waiting_approval"}])}

        class Mcp:
            sessao, pedidos, conta, no_meio = "s", 0, "velha", None

            def iniciar(self, token):
                pass

            def ferramenta(self, nome, args, token):
                self.pedidos += 1
                agentes, tarefas = contas[self.conta]
                if nome == "list_agents":
                    return {"agents": agentes}
                if self.no_meio:   # a volta do OAuth chega enquanto esta leitura está no ar
                    self.no_meio, chamar = None, self.no_meio
                    chamar()
                return {"tasks": tarefas}

        class Cred:
            def token(self):
                return "t"
        leitor = e.Leitor(Cred())
        leitor.mcp, leitor.jornal = Mcp(), novo()[0]

        def volta_do_oauth():   # o que o /oauth/retorno faz
            leitor.zerar_memoria()
            leitor.jornal.zerar()
        leitor.ciclo(t(0))   # conta velha: a base
        leitor.mcp.no_meio = volta_do_oauth
        leitor.ciclo(t(0, s=30))   # conta velha, com a volta no meio: gasta o "pular" do jornal
        leitor.mcp.conta = "nova"
        leitor.ciclo(t(0, s=30 + e.AGENTES_A_CADA))   # conta nova (a lista de agentes recarrega)
        self.assertEqual(numeros(leitor.jornal, t(0), {"velho-1", "velho-2", "novo-1"}), {})
        self.assertEqual([ev for ev in leitor.foto()["eventos"] if ev["tipo"] == "terminou"], [])
        contas["nova"][1].clear()   # daqui em diante, a conta nova conta normalmente: o r-n1 terminou
        leitor.ciclo(t(0, s=60 + e.AGENTES_A_CADA))
        self.assertEqual(numeros(leitor.jornal, t(0), {"novo-1"}), {"novo-1": [1, 0, 0, 0]})


class Rota(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Leitor:
            def foto(self):
                return {"agentes": [{"id": "a1"}], "trabalhos": [], "atualizado": None, "erro": None}
        cls.dados = tempfile.mkdtemp(prefix="jornal-rota-")
        cls.srv = e.Servidor(("127.0.0.1", 0), e.Pagina)
        cls.srv.leitor, cls.srv.cred, cls.srv.acesso = Leitor(), None, Acesso(cls.dados)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        with open(os.path.join(cls.dados, "codigo-primeiro-acesso.txt")) as f:
            codigo = f.read().strip()
        cls.srv.acesso.criar_primeiro(codigo, "dono", "senha-bem-grande")
        cls.sessao = {"Cookie": "%s=%s" % (e.nome_cookie(), cls.srv.acesso.entrar("dono", "senha-bem-grande"))}

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        shutil.rmtree(cls.dados, ignore_errors=True)

    def req(self, cab=None):
        try:
            with urllib.request.urlopen(urllib.request.Request(self.base + "/api/jornal", headers=cab or {})) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as err:
            with err:
                return err.code, json.loads(err.read())

    def test_so_com_sessao_e_so_presentes(self):
        self.srv.jornal = novo()[0]
        hoje = datetime.datetime.now(e.FUSO).timestamp()
        self.srv.jornal.ler([("terminou", "a1"), ("pediu_aprovacao", "a2")], resumo(), hoje)
        self.assertEqual(self.req()[0], 401)
        st, corpo = self.req(self.sessao)
        self.assertEqual((st, corpo["v"], set(corpo)), (200, 1, {"v", "semana", "anterior"}))
        self.assertEqual(corpo["semana"]["agentes"], [{"id": "a1", "tarefas": 1, "aprovacoes": 0, "respostas": 0, "minutos": 0}])
        self.srv.jornal = None
        self.assertEqual(self.req(self.sessao)[0], 404)


if __name__ == "__main__":
    unittest.main()
