"""Mundo vivo: dados de entrada (arte/mundo/cidades.json) e a montagem (ferramentas/montar_mundo.py).
Uso: python -B -I -m unittest discover -p "test_montar_mundo.py"
"""
import hashlib
from collections import Counter
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

RAIZ = os.path.dirname(os.path.abspath(__file__))
CIDADES = os.path.join(RAIZ, "arte", "mundo", "cidades.json")
sys.path.insert(0, os.path.join(RAIZ, "ferramentas"))  # com -I a pasta não entra sozinha no sys.path

UFS = {"AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
       "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"}
ARTE = os.path.join(RAIZ, "arte", "pixellab", "mundo")
MARCOS = {"rio-de-janeiro": "cristo", "belo-horizonte": "pampulha", "sao-paulo": "paulista", "brasilia": "congresso",
          "salvador": "pelourinho", "manaus": "teatro-amazonas", "belem": "ver-o-peso", "florianopolis": "hercilio-luz",
          "porto-alegre": "mercado-publico", "mateus-leme": "matriz-mateus-leme",
          "rio-branco": "palacio-rio-branco", "maceio": "jangada", "macapa": "fortaleza-macapa",
          "fortaleza": "catedral-fortaleza", "vitoria": "convento-penha", "goiania": "tres-racas",
          "sao-luis": "casarao-azulejos", "cuiaba": "igreja-rosario", "campo-grande": "obelisco",
          "joao-pessoa": "farol-cabo-branco", "curitiba": "jardim-botanico", "recife": "recife-antigo",
          "teresina": "ponte-estaiada", "natal": "forte-reis-magos", "porto-velho": "tres-caixas-dagua",
          "boa-vista": "garimpeiro", "aracaju": "arcos-atalaia", "palmas": "palacio-araguaia"}
# as peças que toda cidade pode usar; carros e mobiliário entram no atlas já na metade do desenho
GENERICOS = ({f"predios-{i}" for i in range(1, 15)} | {f"chale-{i}" for i in range(1, 9)} | {f"casa-{i}" for i in range(1, 7)}
             | {f"arvore-{i}" for i in range(1, 8)} | {f"carro-{i}" for i in range(1, 6)} | {"aviao-1", "aviao-2"}
             | {"praca-1", "banca-1", "ponto-onibus-1", "carrinho-1", "banco-poste-1"}
             | {f"lazer-{i}" for i in range(1, 7)} | {f"praia-{i}" for i in range(1, 5)} | {f"rua-{i}" for i in range(1, 5)}
             | {"canteiro-1", "canteiro-2"})
# peças de festa que podem faltar na arte: entram no atlas quando existem, na metade como o mobiliário
OPCIONAIS = {"festa-arvore-natal", "festa-fogueira", "festa-barraca-junina", "festa-abobora", "festa-ovo-pascoa",
             "festa-carro-alegorico", "festa-palco-anonovo"}
METADE = ({"carro-1", "carro-2", "carro-3", "carro-4", "carro-5", "banca-1", "ponto-onibus-1", "carrinho-1", "banco-poste-1",
           "rua-1", "rua-2", "rua-3", "rua-4", "canteiro-1", "canteiro-2", "praia-1", "praia-2"} | OPCIONAIS)
# o porte de cada cidade (pela população da capital) e as capitais de praia (Belém e Macapá ficam no rio)
PORTES = {"metropole", "grande", "media", "pequena"}
LITORAL = {"rio-de-janeiro", "salvador", "recife", "fortaleza", "natal", "joao-pessoa", "maceio", "aracaju", "vitoria",
           "florianopolis", "sao-luis"}
# as miniaturas do mapa do Brasil: uma por marco e as dos dois aviões
MINIS = {"mini-" + m for m in MARCOS.values()} | {"mini-aviao-1", "mini-aviao-2"}
BIOMAS = {"amazonia", "cerrado", "caatinga", "pantanal", "mata-atlantica", "pampa"}
# um ponto bem dentro de cada bioma (lat, lon): ali o desenho tem de ser o do bioma
NO_BIOMA = {"amazonia": (-5.0, -64.0), "cerrado": (-13.0, -46.5), "caatinga": (-6.5, -39.8),
            "pantanal": (-18.5, -56.8), "mata-atlantica": (-22.8, -51.0), "pampa": (-31.0, -54.0)}
SERRAS = {"serra-do-mar", "mantiqueira", "espinhaco", "chapada-diamantina", "serra-geral", "guianas", "andes"}
FONTES = os.path.join(RAIZ, "arte", "mundo", "fontes")
# a camada de perto (o mapa a partir de 2x): 4x4 azulejos de 200 px, o dobro da resolução do brasil.png
PERTO = {"escala": 2, "azulejo": 200, "n": 4}
RECORTES_PERTO = ("ne_10m_rivers_lake_centerlines.geojson", "ne_10m_roads.geojson", "ne_10m_populated_places.geojson")
# o teto de peso do que a camada de perto acrescenta: cada recorte do Natural Earth e os 16 azulejos juntos
TETO_RECORTE, TETO_AZULEJOS = 150_000, 900_000
TETO_4X = 700_000   # o terceiro nível (4x), todos os azulejos gerados juntos
AZULEJOS = tuple(f"perto/{i}-{j}.png" for j in range(PERTO["n"]) for i in range(PERTO["n"]))


class Cidades(unittest.TestCase):
    def test_cidades_validas(self):
        with open(CIDADES, encoding="utf-8") as f:
            cidades = json.load(f)
        self.assertEqual(len(cidades), 28)

        ids = [c["id"] for c in cidades]
        self.assertEqual(len(set(ids)), 28)
        for c in cidades:
            self.assertEqual(set(c), {"id", "nome", "uf", "lat", "lon", "marco", "marco_nome", "porte", "litoral"}, c["id"])
            self.assertIn(c["porte"], PORTES, c["id"])
            self.assertIs(type(c["litoral"]), bool, c["id"])
            self.assertTrue(isinstance(c["marco_nome"], str) and 3 <= len(c["marco_nome"].strip()) <= 34, c["id"])
            self.assertRegex(c["id"], r"^[a-z-]+$")
            self.assertTrue(c["nome"].strip(), c["id"])
            self.assertTrue(-34 <= c["lat"] <= 6, c["id"])
            self.assertTrue(-74 <= c["lon"] <= -34, c["id"])
            self.assertRegex(c["marco"], r"^[a-z-]+$")   # as 28 têm marco

        por_id = {c["id"]: c for c in cidades}
        self.assertEqual({c["uf"] for c in cidades}, UFS)
        self.assertEqual(por_id["mateus-leme"]["uf"], "MG")
        self.assertEqual({c["id"]: c["marco"] for c in cidades}, MARCOS)
        self.assertEqual({c["id"] for c in cidades if c["litoral"]}, LITORAL)
        self.assertEqual({c["id"] for c in cidades if c["porte"] == "metropole"}, {"sao-paulo", "rio-de-janeiro"})
        self.assertEqual({c["id"] for c in cidades if c["porte"] == "pequena"}, {"mateus-leme"})
        self.assertEqual(por_id["manaus"]["porte"], "grande")
        self.assertEqual(por_id["palmas"]["porte"], "media")

    def test_todo_marco_tem_arte(self):
        for cid, marco in MARCOS.items():
            self.assertTrue(os.path.isfile(os.path.join(ARTE, f"marco-{marco}.png")), cid)

    def test_biomas_e_serras_validos(self):
        """biomas.json: os seis biomas, cada um com um polígono em (lon, lat) perto da caixa do mapa; serras.json: as
        serras pedidas, cada uma uma linha de dois pontos ou mais, com a neve só nos Andes."""
        dentro = lambda lon, lat: -80 <= lon <= -28 and -40 <= lat <= 12
        with open(os.path.join(RAIZ, "arte", "mundo", "biomas.json"), encoding="utf-8") as f:
            biomas = json.load(f)
        self.assertEqual({b["id"] for b in biomas["biomas"]}, BIOMAS)
        for b in biomas["biomas"] + list(biomas["extras"].values()):
            pontos = b["poligono"]
            self.assertGreaterEqual(len(pontos), 3)
            self.assertTrue(all(len(p) == 2 and dentro(*p) for p in pontos), b.get("id"))
        self.assertIn("araucarias", biomas["extras"])
        with open(os.path.join(RAIZ, "arte", "mundo", "serras.json"), encoding="utf-8") as f:
            serras = json.load(f)
        self.assertEqual({s["id"] for s in serras}, SERRAS)
        for s in serras:
            self.assertTrue(s["nome"].strip())
            self.assertIn(s["tipo"], {"verde", "rocha", "neve"})
            for linha in s["linhas"]:
                self.assertGreaterEqual(len(linha), 2, s["id"])
                self.assertTrue(all(len(p) == 2 and dentro(*p) for p in linha), s["id"])
        self.assertEqual({s["id"] for s in serras if s["tipo"] == "neve"}, {"andes"})
        self.assertTrue(any(p.get("nome") == "Pico da Neblina" for s in serras for p in s.get("picos", [])))

    def test_rios_recortados(self):
        """O recorte dos rios do Natural Earth: só linhas na caixa do mapa (com 1° de folga), com os três rios largos."""
        with open(os.path.join(RAIZ, "arte", "mundo", "fontes", "ne_50m_rivers_lake_centerlines.geojson"),
                  encoding="utf-8") as f:
            rios = json.load(f)["features"]
        nomes = set()
        for r in rios:
            g = r["geometry"]
            self.assertEqual(g["type"], "MultiLineString")
            for linha in g["coordinates"]:
                self.assertGreaterEqual(len(linha), 2)
                self.assertTrue(all(-75 <= lon <= -33 and -35 <= lat <= 7 for lon, lat in linha))
            nomes.add(" ".join(r["properties"]["name"].split()))
        self.assertTrue({"Amazonas", "Paraná", "São Francisco", "Tocantins", "Negro"} <= nomes, nomes)

    def test_recortes_de_perto_validos_e_registrados(self):
        """Os recortes 1:10m da camada de perto: rios menores e rodovias em linhas dentro da caixa (com 1° de folga),
        cidades em pontos no Brasil; cada um pequeno e registrado em LICENCA.md com a origem e o SHA-256 do original."""
        caixa = lambda lon, lat: -75 <= lon <= -33 and -35 <= lat <= 7
        with open(os.path.join(FONTES, "LICENCA.md"), encoding="utf-8") as f:
            licenca = f.read()
        for nome in RECORTES_PERTO:
            caminho = os.path.join(FONTES, nome)
            self.assertLessEqual(os.path.getsize(caminho), TETO_RECORTE, nome)
            self.assertIn(f"`{nome}`", licenca)
            linha = next(l for l in licenca.splitlines() if l.startswith(f"| `{nome}`"))
            self.assertRegex(linha, r"SHA-256 do original `[0-9a-f]{64}`", nome)
            with open(caminho, encoding="utf-8") as f:
                feicoes = json.load(f)["features"]
            self.assertTrue(feicoes, nome)
            for ft in feicoes:
                g = ft["geometry"]
                if nome == "ne_10m_populated_places.geojson":
                    self.assertEqual(g["type"], "Point")
                    self.assertTrue(-34 <= g["coordinates"][1] <= 6 and -74 <= g["coordinates"][0] <= -34, ft["properties"])
                    self.assertTrue(ft["properties"]["NAME"] and ft["properties"]["POP_MAX"] > 0)
                    continue
                self.assertEqual(g["type"], "MultiLineString", nome)
                for linha_ in g["coordinates"]:
                    self.assertGreaterEqual(len(linha_), 2)
                    self.assertTrue(all(caixa(lon, lat) for lon, lat in linha_), nome)
        with open(os.path.join(FONTES, "ne_10m_roads.geojson"), encoding="utf-8") as f:
            tipos = {ft["properties"]["type"] for ft in json.load(f)["features"]}
        self.assertLessEqual(tipos, {"Major Highway", "Road"})


class Preencher(unittest.TestCase):
    def test_preencher_quadrado(self):
        import montar_mundo
        feitos = montar_mundo.preencher([(1, 1), (4, 1), (4, 4), (1, 4)], 6, 6)
        self.assertEqual(feitos, {(x, y) for x in range(1, 4) for y in range(1, 4)})

    def test_preencher_concavo(self):
        import montar_mundo
        # "U" aberto para cima: hastes em x 1..2 e 4..5, fundo em y 4..5
        u = [(1, 1), (2, 1), (2, 4), (4, 4), (4, 1), (5, 1), (5, 5), (1, 5)]
        feitos = montar_mundo.preencher(u, 6, 6)
        self.assertNotIn((2, 2), feitos)
        self.assertNotIn((3, 2), feitos)  # meio da abertura
        self.assertIn((1, 2), feitos)
        self.assertIn((4, 2), feitos)
        self.assertIn((3, 4), feitos)  # fundo do U
        self.assertEqual(len(feitos), 3 + 3 + 4)

    def test_para_pixel(self):
        import montar_mundo
        self.assertEqual(montar_mundo.para_pixel(-19.92, -43.94, montar_mundo.CAIXA_BRASIL, 400, 400), (300, 259))


class Rodovia(unittest.TestCase):
    def test_rodovia_discreta_e_igual_nos_dois_niveis(self):
        """A rodovia: a linha de 2x e a pista de 4x no mesmo cinza médio de asfalto (a troca 4x -> 3x não pula), mais
        discreto que o rio (cinza, sem a cor dele); a 4x, a pista tem 3 px, com a faixa clara no meio e sem acostamento."""
        import mundo_terreno as mt
        lum = lambda h: sum(k * int(h[i:i + 2], 16) for k, i in ((0.3, 1), (0.59, 3), (0.11, 5)))
        rgb = lambda h: [int(h[i:i + 2], 16) for i in (1, 3, 5)]
        self.assertEqual(mt.CORES["estrada"], mt.CORES["asfalto"])
        self.assertTrue(100 <= lum(mt.CORES["asfalto"]) <= 160, lum(mt.CORES["asfalto"]))
        self.assertLess(max(rgb(mt.CORES["asfalto"])) - min(rgb(mt.CORES["asfalto"])), 24, "cinza")
        self.assertGreater(lum(mt.CORES["faixa"]), lum(mt.CORES["asfalto"]) + 40)
        w = h = 24
        ind = {n: k for k, n in enumerate(mt.CORES)}
        objetos = {"chao": ["ce_chao"] * (w * h), "carimbos": [], "estradas": [[[(2, 12.2), (22, 12.2)]]]}
        cor = mt.refinar([ind["ce_chao"]] * (w * h), w, h, (), objetos)
        nomes = list(mt.CORES)
        for x in range(10, 38):
            coluna = [nomes[cor[y * 2 * w + x]] for y in range(2 * h)]
            self.assertEqual(sum(n in ("asfalto", "faixa") for n in coluna), 3, coluna)
            self.assertNotIn("estrada", coluna, "sem acostamento")
        self.assertIn("faixa", [nomes[c] for c in cor])


class Montagem(unittest.TestCase):
    """Roda ferramentas/montar_mundo.py como processo, igual ao uso real. Com -I o teste não vê o Pillow
    do site-packages do usuário; o processo filho (sem -I) vê."""
    SCRIPT = os.path.join(RAIZ, "ferramentas", "montar_mundo.py")
    ENTRADA = os.path.join(RAIZ, "arte", "mundo")

    @classmethod
    def setUpClass(cls):
        if subprocess.run([sys.executable, "-c", "import PIL"], capture_output=True).returncode:
            raise unittest.SkipTest("Pillow ausente: a montagem do mundo precisa dele (pip install pillow)")
        cls.pastas = [tempfile.mkdtemp() for _ in range(3)]
        cls.montar(cls.pastas[0])
        with open(os.path.join(cls.pastas[0], "mundo.json"), encoding="utf-8") as f:
            cls.mundo = json.load(f)

    @classmethod
    def tearDownClass(cls):
        for p in cls.pastas:
            shutil.rmtree(p, ignore_errors=True)

    @classmethod
    def cores(cls, pontos, nome="brasil.png"):
        """Cor '#rrggbb' de cada (x, y) do PNG montado (brasil.png ou terra.png), lida pelo Pillow no processo filho."""
        ler = ("import json, sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert('RGB')\n"
               "print(json.dumps(['#%02x%02x%02x' % im.getpixel(tuple(p)) for p in json.loads(sys.stdin.read())]))")
        r = subprocess.run([sys.executable, "-c", ler, os.path.join(cls.pastas[0], nome)], input=json.dumps(pontos),
                           capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        return json.loads(r.stdout)

    @classmethod
    def cores_perto(cls, pontos, pasta=None):
        """Cor '#rrggbb' de cada (x, y) da camada de perto (pixels de 800x800), lida dos azulejos no processo filho."""
        ler = ("import json, os, sys\nfrom PIL import Image\nA = int(sys.argv[2])\nabertos = {}\nsaida = []\n"
               "for x, y in json.loads(sys.stdin.read()):\n"
               "    k = (x // A, y // A)\n"
               "    if k not in abertos:\n"
               "        abertos[k] = Image.open(os.path.join(sys.argv[1], 'perto', '%d-%d.png' % k)).convert('RGB')\n"
               "    saida.append('#%02x%02x%02x' % abertos[k].getpixel((x % A, y % A)))\n"
               "print(json.dumps(saida))")
        r = subprocess.run([sys.executable, "-c", ler, pasta or cls.pastas[0], str(PERTO["azulejo"])], input=json.dumps(pontos),
                           capture_output=True, text=True, timeout=120)
        if r.returncode:
            raise AssertionError(r.stderr)
        return json.loads(r.stdout)

    @classmethod
    def montar(cls, pasta):
        r = subprocess.run([sys.executable, "-B", cls.SCRIPT, cls.ENTRADA, pasta], capture_output=True, text=True,
                           encoding="utf-8", errors="replace", timeout=300)
        if r.returncode:
            raise AssertionError(r.stderr)

    def sha(self, pasta, nome):
        with open(os.path.join(pasta, nome), "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()

    def gerados(self):
        """Todos os arquivos que a montagem escreve (os três níveis, o mapa das UFs de 2x e o atlas)."""
        mascara = self.mundo["niveis"]["brasil"]["perto4x"]["azulejos"]
        return ("brasil.png", "terra.png", "mundo.json", "atlas.png", "atlas.json", "perto/ufs.json") + AZULEJOS + tuple(
            f"perto4x/{k % 8}-{k // 8}.png" for k, c in enumerate(mascara) if c == "1")

    def test_deterministico(self):
        """A montagem desta execução sai igual, byte a byte, à que foi versionada em static/mundo/ (outra execução, em
        outro momento): o mesmo dado dá sempre os mesmos arquivos. Uma montagem só por execução do teste (os três níveis
        levam ~1 min); os arquivos que sobram em static/mundo/perto4x/ (de uma máscara antiga) também contam."""
        for nome in self.gerados():
            self.assertEqual(self.sha(os.path.join(RAIZ, "static", "mundo"), nome), self.sha(self.pastas[0], nome), nome)
        quatro = {n[8:] for n in self.gerados() if n.startswith("perto4x/")}
        sobra = set(os.listdir(os.path.join(RAIZ, "static", "mundo", "perto4x"))) - quatro
        self.assertEqual(sobra, set(), "azulejos de 4x que a montagem não gera mais")

    def atlas(self, arte, pasta):
        """Roda só montar_atlas() com a arte de `arte`, grava em `pasta` e devolve o atlas.json."""
        montar = ("import json, sys\nsys.path.insert(0, sys.argv[1])\nimport montar_mundo as mm\n"
                  "mm.montar_atlas(sys.argv[2], mm.ler(sys.argv[3]), sys.argv[4])")
        r = subprocess.run([sys.executable, "-B", "-c", montar, os.path.join(RAIZ, "ferramentas"), arte, CIDADES, pasta],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120)
        if r.returncode:
            raise AssertionError(r.stderr)
        with open(os.path.join(pasta, "atlas.json"), encoding="utf-8") as f:
            return json.load(f)

    def test_atlas_deterministico(self):
        """O atlas sai igual a cada montagem, com as peças pedidas, cada uma dentro da imagem e sem sobrepor outra."""
        pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, pasta, True)
        atlas = self.atlas(ARTE, pasta)
        for nome in ("atlas.png", "atlas.json"):
            self.assertEqual(self.sha(self.pastas[0], nome), self.sha(pasta, nome), nome)
        marcos = {"marco-" + m for m in MARCOS.values()}   # as 28 cidades: todo marco tem quadro no atlas
        self.assertEqual(len(marcos), 28)
        self.assertEqual(set(atlas), {"versao", "quadros", "janelas"})
        self.assertIsInstance(atlas["versao"], int)
        presentes = {n for n in OPCIONAIS if os.path.exists(os.path.join(ARTE, n + ".png"))}
        self.assertEqual(set(atlas["quadros"]), marcos | GENERICOS | presentes | MINIS)
        self.assertFalse(any(n.startswith("bicho-") for n in atlas["quadros"]), "os bichos ficam fora")
        self.assertFalse(any(n.startswith("bicho-") for n in os.listdir(ARTE)), "os bichos nem entram na arte")
        with open(os.path.join(pasta, "atlas.png"), "rb") as f:
            cabeca = f.read(24)
        largura, altura = int.from_bytes(cabeca[16:20], "big"), int.from_bytes(cabeca[20:24], "big")
        caixas = list(atlas["quadros"].values())
        for x, y, w, h in caixas:
            self.assertTrue(w > 0 and h > 0 and x >= 0 and y >= 0 and x + w <= largura and y + h <= altura, (x, y, w, h))
        for i, (x, y, w, h) in enumerate(caixas):
            for a, b, c, d in caixas[i + 1:]:
                self.assertFalse(x < a + c and a < x + w and y < b + d and b < y + h, ((x, y, w, h), (a, b, c, d)))

    def test_janelas_das_construcoes(self):
        """As janelas de cada construção (para acender à noite): retângulos pequenos [x, y, w, h] dentro do recorte,
        fora da base do desenho, no máximo JANELAS_MAX por peça; casas, chalés e prédios têm, árvores e carros não."""
        with open(os.path.join(self.pastas[0], "atlas.json"), encoding="utf-8") as f:
            atlas = json.load(f)
        janelas, quadros = atlas["janelas"], atlas["quadros"]
        self.assertTrue({"chale-1", "casa-3", "predios-1", "predios-12", "marco-paulista"} <= set(janelas), sorted(janelas))
        self.assertFalse(any(n.startswith(("arvore-", "carro-", "mini-", "praia-", "lazer-")) for n in janelas))
        for nome, lista in janelas.items():
            self.assertEqual(len(lista) % 4, 0, nome)
            self.assertTrue(0 < len(lista) // 4 <= 48, nome)
            w, h = quadros[nome][2:]
            for i in range(0, len(lista), 4):
                x, y, jw, jh = lista[i:i + 4]
                self.assertTrue(x >= 0 and y >= 0 and x + jw <= w and y + jh <= h * 0.88 and 0 < jw <= 10 and 0 < jh <= 12,
                                (nome, lista[i:i + 4]))

    def test_predio_11_sem_sombra_solta(self):
        """A sombra cinza solta do predios-11 (#404040, ligada ao fundo) sai no atlas."""
        with open(os.path.join(self.pastas[0], "atlas.json"), encoding="utf-8") as f:
            x, y, w, h = json.load(f)["quadros"]["predios-11"]
        ler = ("import json, sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert('RGBA')\n"
               "x, y, w, h = json.loads(sys.argv[2])\npx = im.load()\n"
               "fora = lambda i, j: not (x <= i < x + w and y <= j < y + h) or px[i, j][3] == 0\n"
               "print(sum(1 for j in range(y, y + h) for i in range(x, x + w) if px[i, j] == (64, 64, 64, 255)\n"
               "          and any(fora(i + a, j + b) for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))))")
        r = subprocess.run([sys.executable, "-c", ler, os.path.join(self.pastas[0], "atlas.png"), json.dumps([x, y, w, h])],
                           capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        self.assertEqual(int(r.stdout), 0, "nenhum #404040 na borda do desenho (a mancha do canto)")
        self.assertLessEqual(w, 104, "sem a sombra, o recorte fica mais estreito")

    def pixels_do_atlas(self, nome):
        """Os pixels opacos (r, g, b) da peça `nome` no atlas.png montado, lidos pelo Pillow no processo filho."""
        with open(os.path.join(self.pastas[0], "atlas.json"), encoding="utf-8") as f:
            x, y, w, h = json.load(f)["quadros"][nome]
        ler = ("import json, sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert('RGBA')\n"
               "x, y, w, h = json.loads(sys.argv[2])\npx = im.load()\n"
               "print(json.dumps([px[i, j][:3] for j in range(y, y + h) for i in range(x, x + w) if px[i, j][3]]))")
        r = subprocess.run([sys.executable, "-c", ler, os.path.join(self.pastas[0], "atlas.png"), json.dumps([x, y, w, h])],
                           capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        return [tuple(c) for c in json.loads(r.stdout)]

    def test_pier_sem_a_propria_agua(self):
        """O píer (praia-4) entra no atlas sem o bloco de água e a borda de terra do desenho: só o deque, os postes e o
        barco, para pousar no mar da cidade e se fundir a ele."""
        agua = [c for c in self.pixels_do_atlas("praia-4") if c[2] > c[0] + 12 and c[2] >= c[1] - 30]
        self.assertEqual(agua, [])
        madeira = [c for c in self.pixels_do_atlas("praia-4") if c[0] > c[2] + 30]
        self.assertGreater(len(madeira), 300, "o deque e os postes ficam")

    def test_coreto_em_tres_quartos(self):
        """O coreto em 3/4, com pixel nítido: só cores que já existem no desenho original (nenhuma mistura nova)."""
        ler = ("import json, sys\nfrom PIL import Image\nim = Image.open(sys.argv[1]).convert('RGBA')\n"
               "print(json.dumps(sorted({p[:3] for p in im.getdata() if p[3] == 255})))")   # no filho: com -I o teste não vê o Pillow
        r = subprocess.run([sys.executable, "-c", ler, os.path.join(ARTE, "lazer-4.png")], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        originais = {tuple(c) for c in json.loads(r.stdout)}
        self.assertLessEqual(set(self.pixels_do_atlas("lazer-4")), originais)

    def test_atlas_sem_marco_usa_generico(self):
        """Marco sem arte não derruba a montagem: ele fica fora do atlas, e a cidade usa os prédios genéricos."""
        arte, pasta = tempfile.mkdtemp(), tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, arte, True)
        self.addCleanup(shutil.rmtree, pasta, True)
        origem = os.path.join(RAIZ, "arte", "pixellab", "mundo")
        for nome in os.listdir(origem):
            if nome != "marco-cristo.png":
                shutil.copy(os.path.join(origem, nome), arte)
        quadros = self.atlas(arte, pasta)["quadros"]
        self.assertNotIn("marco-cristo", quadros)
        self.assertNotIn("mini-cristo", quadros)   # sem a arte, o mapa usa o ícone genérico
        self.assertIn("marco-pampulha", quadros)
        self.assertIn("mini-pampulha", quadros)
        self.assertTrue(GENERICOS <= set(quadros))
        # sem uma peça genérica (que toda cidade usa), a montagem para com erro
        os.remove(os.path.join(arte, "predios-2.png"))
        with self.assertRaises(AssertionError) as erro:
            self.atlas(arte, pasta)
        self.assertIn("predios-2", str(erro.exception))

    def test_atlas_com_e_sem_pecas_opcionais(self):
        """As peças de festa são opcionais: com a arte, entram no atlas (na metade, test_atlas_na_escala_final); sem
        nenhuma, ou só com uma, a montagem segue sem erro e o resto do atlas não muda."""
        with open(os.path.join(self.pastas[0], "atlas.json"), encoding="utf-8") as f:
            completo = json.load(f)["quadros"]
        self.assertTrue(OPCIONAIS <= set(completo), "a arte das festas está em arte/pixellab/mundo")
        self.assertNotIn("onibus-1", completo)   # o ônibus saiu da cidade (fica só o ponto)
        arte, pasta = tempfile.mkdtemp(), tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, arte, True)
        self.addCleanup(shutil.rmtree, pasta, True)
        for nome in os.listdir(ARTE):
            if nome[:-4] not in OPCIONAIS or nome == "festa-fogueira.png":
                shutil.copy(os.path.join(ARTE, nome), arte)
        quadros = self.atlas(arte, pasta)["quadros"]
        self.assertEqual(set(quadros) & OPCIONAIS, {"festa-fogueira"})
        os.remove(os.path.join(arte, "festa-fogueira.png"))
        quadros = self.atlas(arte, pasta)["quadros"]
        self.assertEqual(set(quadros), set(completo) - OPCIONAIS)

    def test_atlas_na_escala_final(self):
        """Carros e mobiliário entram no atlas na metade da arte (o navegador desenha 1:1); o resto, inteiro. O alfa
        do atlas inteiro fica binário (pixel nítido, sem borda translúcida)."""
        with open(os.path.join(self.pastas[0], "atlas.json"), encoding="utf-8") as f:
            quadros = json.load(f)["quadros"]
        medir = ("import json, os, sys\nfrom PIL import Image\nat = Image.open(sys.argv[1]).convert('RGBA')\n"
                 "alfa = sorted(set(at.getchannel('A').tobytes()))\ntam = {}\n"
                 "for nome in json.loads(sys.argv[3]):\n"
                 "    im = Image.open(os.path.join(sys.argv[2], nome + '.png')).convert('RGBA')\n"
                 "    x0, y0, x1, y1 = im.getchannel('A').getbbox()\n    tam[nome] = [x1 - x0, y1 - y0]\n"
                 "print(json.dumps([alfa, tam]))")
        presentes = {n for n in OPCIONAIS if os.path.exists(os.path.join(ARTE, n + ".png"))}
        r = subprocess.run([sys.executable, "-c", medir, os.path.join(self.pastas[0], "atlas.png"), ARTE,
                            json.dumps(sorted(GENERICOS | presentes))], capture_output=True, text=True, timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        alfa, tam = json.loads(r.stdout)
        self.assertEqual(alfa, [0, 255])
        for nome in MINIS:   # as miniaturas do mapa: 28 a 36 px de tela a 1x (1 px da arte por px de CSS)
            w, h = quadros[nome][2:]
            if nome.startswith("mini-aviao"):
                self.assertTrue(18 <= max(w, h) <= 24, (nome, w, h))
            else:
                self.assertTrue(26 <= max(w, h) <= 36 and min(w, h) >= 14, (nome, w, h))
        for nome, (w, h) in tam.items():
            qw, qh = quadros[nome][2:]
            if nome in METADE:   # metade arredondada para cima; o recorte do alfa pode tirar uma linha da borda
                self.assertTrue((w + 1) // 2 - 1 <= qw <= (w + 1) // 2 and (h + 1) // 2 - 1 <= qh <= (h + 1) // 2,
                                (nome, w, h, qw, qh))
            elif nome == "lazer-4":   # o coreto em 3/4 (menor que o marco, maior que uma casa)
                self.assertTrue(abs(qw - round(w * 3 / 4)) <= 1 and abs(qh - round(h * 3 / 4)) <= 1, (nome, w, h, qw, qh))
            elif nome in ("predios-11", "praia-4"):   # sem a mancha solta / sem a água do píer: mais estreitos
                self.assertTrue(qw < w and qh <= h, (nome, w, h, qw, qh))
            else:
                self.assertEqual([qw, qh], [w, h], nome)

    def test_rotas(self):
        rotas = self.mundo["rotas"]
        ids = {c["id"] for c in self.mundo["cidades"]}
        self.assertTrue(0 < len(rotas) <= 40)
        for a, b in rotas:
            self.assertNotEqual(a, b)
            self.assertIn(a, ids)
            self.assertIn(b, ids)
        self.assertEqual(len({frozenset(r) for r in rotas}), len(rotas))  # sem rota repetida

    def test_mundo_json(self):
        self.assertIsInstance(self.mundo["versao"], int)
        brasil = self.mundo["niveis"]["brasil"]
        self.assertEqual(set(self.mundo["niveis"]), {"brasil"})
        self.assertEqual({k: brasil[k] for k in ("w", "h", "caixa")}, {"w": 400, "h": 400, "caixa": [-74.0, -34.0, -34.0, 6.0]})
        # as células de 0,5° do Brasil, para o globo (80 linhas de 80, de lat 6 para baixo e de lon −74 para a direita)
        celulas = brasil["celulas"]
        self.assertEqual(set(brasil), {"w", "h", "caixa", "celulas", "perto", "perto4x", "ufs", "medias", "paises"})
        self.assertEqual(brasil["perto"], PERTO)
        self.assertEqual(len(celulas), 80)
        self.assertTrue(all(len(l) == 80 and set(l) <= {"0", "1"} for l in celulas))
        celula = lambda lat, lon: celulas[int((6 - lat) * 2)][int((lon + 74) * 2)]
        self.assertEqual(celula(-15.8, -47.9), "1")   # Brasília
        self.assertEqual(celula(-3.1, -60.0), "1")    # Manaus
        self.assertEqual(celula(-23.0, -58.0), "0")   # Paraguai
        self.assertEqual(celula(-20.0, -36.0), "0")   # mar
        self.assertEqual(celula(-12.0, -70.0), "0")   # Peru, logo ao sul do Acre
        self.assertTrue(2600 <= "".join(celulas).count("1") <= 3200, "".join(celulas).count("1"))
        self.assertEqual(len(self.mundo["cidades"]), 28)
        bh = next(c for c in self.mundo["cidades"] if c["id"] == "belo-horizonte")
        self.assertEqual((bh["x"], bh["y"]), (300, 259))
        for c in self.mundo["cidades"]:
            self.assertEqual(set(c), {"id", "nome", "uf", "lat", "lon", "x", "y", "marco", "marco_nome", "porte", "litoral"})
        for nome, tamanho in (("brasil.png", (400, 400)), ("terra.png", (720, 360))):
            with open(os.path.join(self.pastas[0], nome), "rb") as f:
                cabeca = f.read(24)
            self.assertEqual(cabeca[1:4], b"PNG", nome)
            self.assertEqual((int.from_bytes(cabeca[16:20], "big"), int.from_bytes(cabeca[20:24], "big")), tamanho, nome)

    def test_cidades_em_terra(self):
        import montar_mundo as mm
        import mundo_terreno as mt
        # em terra: nenhuma cor de mar (o rio pode passar no ponto da cidade, como em Manaus: a miniatura fica por cima)
        agua = {mt.CORES[n] for n in mt.AGUA if not n.startswith("rio")}
        cidades = self.mundo["cidades"]
        for c, cor in zip(cidades, self.cores([[c["x"], c["y"]] for c in cidades])):
            self.assertIn(cor, set(mt.CORES.values()) - agua, c["id"])
            x0, y0 = mm.para_pixel(c["lat"], c["lon"], mm.CAIXA_BRASIL, 400, 400)
            self.assertLessEqual((c["x"] - x0) ** 2 + (c["y"] - y0) ** 2, 36, c["id"])
        movidas = {c["id"] for c in cidades
                   if (c["x"], c["y"]) != mm.para_pixel(c["lat"], c["lon"], mm.CAIXA_BRASIL, 400, 400)}
        self.assertTrue({"belem", "recife", "rio-de-janeiro", "florianopolis"} <= movidas, movidas)

    def janela(self, lat, lon, r):
        """As cores da janela (2r+1)² em volta de (lat, lon) no brasil.png."""
        import montar_mundo as mm
        x, y = mm.para_pixel(lat, lon, mm.CAIXA_BRASIL, 400, 400)
        return self.cores([[i, j] for j in range(y - r, y + r + 1) for i in range(x - r, x + r + 1)
                           if 0 <= i < 400 and 0 <= j < 400])

    def test_vizinhos_apagados(self):
        """Os vizinhos usam a mesma linguagem do Brasil em tons apagados; o Brasil, os tons cheios."""
        import mundo_terreno as mt
        apagadas, cheias = mt.cores_apagadas(), set(mt.CORES.values()) - mt.cores_apagadas()
        for lat, lon in ((-23.0, -58.0), (-3.0, -72.0), (-31.5, -56.5), (4.0, -58.5)):   # Paraguai, Peru, Uruguai, Guiana
            cores = self.janela(lat, lon, 3)
            self.assertGreaterEqual(sum(c in apagadas for c in cores) / len(cores), 0.9, (lat, lon))
        cores = self.janela(-13.0, -56.0, 3)   # Mato Grosso
        self.assertGreaterEqual(sum(c in cheias for c in cores) / len(cores), 0.9)

    def test_cada_bioma_no_seu_lugar(self):
        """No meio de cada bioma, a maior parte dos pixels é das cores dele (os seis aparecem, cada um no seu canto)."""
        import mundo_terreno as mt
        for bioma, (lat, lon) in NO_BIOMA.items():
            cores, dele = self.janela(lat, lon, 5), mt.cores_do_bioma(bioma)
            self.assertGreaterEqual(sum(c in dele for c in cores) / len(cores), 0.5, bioma)
            for outro in BIOMAS - {bioma}:   # as paletas não se confundem
                self.assertFalse(dele & mt.cores_do_bioma(outro), (bioma, outro))

    def test_rios_e_mar(self):
        """Há rios (o Amazonas com 2 px perto de Óbidos), areia na costa e um mar com textura, não liso."""
        import mundo_terreno as mt
        rio = mt.CORES["rio"]
        self.assertGreaterEqual(sum(c == rio for c in self.janela(-1.95, -55.5, 3)), 6, "Amazonas largo")
        tudo = self.janela(-14.0, -54.0, 200)
        self.assertGreater(sum(c == rio for c in tudo), 1500)
        self.assertGreater(sum(c == mt.CORES["areia"] for c in tudo), 300)
        alto_mar = self.janela(-22.0, -37.0, 12)
        self.assertGreaterEqual(len(set(alto_mar)), 2, "o mar fundo tem textura")
        self.assertTrue(set(alto_mar) <= {mt.CORES[n] for n in mt.AGUA}, set(alto_mar))

    def test_borda_irregular(self):
        """A borda da caixa não é moldura: os 2 px de fora são do mar de fora da imagem (a cor que o navegador pinta além
        dela) e a terra some a uma distância que varia ao longo da borda (ruído), não numa linha reta."""
        import mundo_terreno as mt
        fora = mt.CORES[mt.FORA]
        with open(os.path.join(RAIZ, "static", "mundo_mapa.js"), encoding="utf-8") as f:
            self.assertIn(f'MAR = "{fora}"', f.read())
        borda = [[x, y] for y in range(400) for x in (0, 1, 398, 399)] + [[x, y] for x in range(400) for y in (0, 1, 398, 399)]
        self.assertEqual(set(self.cores(borda)), {fora})
        agua = {mt.CORES[n] for n in mt.AGUA}
        for linhas in ((range(60, 340), lambda j, i: [i, j]), (range(30, 160), lambda j, i: [j, i])):   # borda oeste e norte
            fundo = []
            for j in linhas[0][::4]:
                cores = self.cores([linhas[1](j, i) for i in range(0, 40)])
                fundo.append(next((i for i, c in enumerate(cores) if c not in agua), 40))
            terra = [d for d in fundo if d < 40]
            self.assertGreater(len(terra), 10)
            self.assertGreaterEqual(max(terra) - min(terra), 6, terra)

    def test_barcos_rosa_e_oceano_no_mar(self):
        """As rotas dos barcos, a rosa dos ventos e o nome do oceano (pixels fixos em mundo_mapa.js) caem no mar."""
        import re
        import mundo_terreno as mt
        with open(os.path.join(RAIZ, "static", "mundo_mapa.js"), encoding="utf-8") as f:
            js = f.read()
        barcos = json.loads(re.search(r"const BARCOS = (\[\[.*?\]\]);", js).group(1))
        rosa, oceano = (json.loads(re.search(nome + r" = (\[\d+, \d+\])", js).group(1)) for nome in ("ROSA", "OCEANO"))
        agua = {mt.CORES[n] for n in mt.AGUA}
        pontos = [[round(x0 + (x1 - x0) * k / 20), round(y0 + (y1 - y0) * k / 20)] for x0, y0, x1, y1 in barcos for k in range(21)]
        pontos += [[rosa[0] + dx, rosa[1] + dy] for dx in range(-13, 14) for dy in range(-13, 14)]
        pontos += [[oceano[0] + dx, oceano[1] + dy] for dx in range(-46, 47) for dy in range(-12, 12)]
        fora = [p for p, c in zip(pontos, self.cores(pontos)) if c not in agua]
        self.assertEqual(fora, [])

    def test_divisa_le_na_floresta(self):
        """A divisa de UF é o tom do chão local: mais escuro, salvo na Amazônia, onde as copas já são escuras e a divisa é
        um verde claro, para ler sobre elas."""
        import mundo_terreno as mt
        lum = lambda h: sum(k * int(h[i:i + 2], 16) for k, i in ((0.3, 1), (0.59, 3), (0.11, 5)))
        for nome, cor in mt.BASE.items():
            if nome in mt.AGUA_BASE or nome == "am_divisa" or nome in mt.SO_4X:   # as do 4x não levam divisa
                continue
            divisa = mt.CORES[nome + "~"]
            if nome.startswith("am_"):
                self.assertGreaterEqual(lum(divisa) - lum(cor), 30, nome)
            else:
                self.assertLessEqual(lum(divisa), lum(cor) * 0.8, nome)

    def test_agua_e_terra_pela_cor(self):
        """O navegador separa água de terra pelo azul: água com B > G, terra com G >= B (todas as cores)."""
        import mundo_terreno as mt
        import mundo_planeta as mp
        for cores, agua in ((mt.CORES, mt.AGUA), (mp.PALETA, mp.AGUA)):   # o mapa e o terra.png (o globo)
            for nome, cor in cores.items():
                r, g, b = (int(cor[i:i + 2], 16) for i in (1, 3, 5))
                self.assertEqual(b > g, nome in agua, nome)

    def janela_terra(self, lat, lon, r):
        """As cores da janela (2r+1)² em volta de (lat, lon) no terra.png (0,5° por pixel, a longitude dá a volta)."""
        x, y = int((lon + 180) * 2), int((90 - lat) * 2)
        return self.cores([[(i + 720) % 720, j] for j in range(y - r, y + r + 1) for i in range(x - r, x + r + 1)
                           if 0 <= j < 360], "terra.png")

    def test_planeta_com_biomas(self):
        """O terra.png fala a língua do mapa: cada bioma do mundo no seu lugar (a maior parte da janela nas cores dele),
        montanhas com rocha e neve, gelo nos polos e no mar do Ártico, e água rasa mais clara junto da costa."""
        import mundo_planeta as mp
        lugares = {"deserto": [(25.0, 10.0), (21.0, 47.0), (-25.0, 128.0)], "floresta": [(-4.0, -63.0), (0.0, 22.0), (0.5, 114.0)],
                   "taiga": [(60.0, 100.0), (55.0, -110.0)], "tundra": [(70.0, 150.0)], "gelo": [(75.0, -40.0), (-80.0, 30.0), (86.0, 0.0)],
                   "cerrado": [(-13.0, -46.5)], "savana": [(-12.0, 25.0)], "mata": [(-22.8, -51.0), (49.0, 10.0)],
                   "estepe": [(48.0, 68.0)], "caatinga": [(-6.5, -39.8)]}
        for classe, pontos in lugares.items():
            dela = mp.cores_da_classe(classe)
            for lat, lon in pontos:
                cores = self.janela_terra(lat, lon, 2)
                self.assertGreaterEqual(sum(c in dela for c in cores) / len(cores), 0.5, (classe, lat, lon, cores))
        himalaia = set(self.janela_terra(28.5, 86.0, 3))
        self.assertTrue(himalaia & mp.cores_da_classe("neve") and himalaia & mp.cores_da_classe("rocha"), himalaia)
        agua = {mp.PALETA[n] for n in mp.AGUA}
        alto_mar = self.janela_terra(-30.0, -20.0, 4)
        self.assertTrue(set(alto_mar) <= agua - {mp.PALETA["raso_claro"]}, set(alto_mar))
        costa = self.janela_terra(-8.0, -34.6, 3)   # Recife: terra, a faixa clara e o raso
        self.assertIn(mp.PALETA["raso_claro"], costa)
        self.assertIn(mp.PALETA["raso"], costa)

    def test_neve_em_trechos(self):
        """A neve dos Andes e das Rochosas fica em trechos: ao longo da serra há linhas de latitude com neve e linhas sem
        (não uma linha branca contínua); o Himalaia segue nevado (test_planeta_com_biomas)."""
        import mundo_planeta as mp
        neve = mp.cores_da_classe("neve")
        for nome, (y0, y1), (x0, x1) in (("andes", (204, 260), (208, 228)), ("rochosas", (60, 104), (104, 152))):
            pontos = [[x, y] for y in range(y0, y1) for x in range(x0, x1)]
            cores = self.cores(pontos, "terra.png")
            linhas = [any(c in neve for c in cores[k * (x1 - x0):(k + 1) * (x1 - x0)]) for k in range(y1 - y0)]
            self.assertTrue(0.15 <= sum(linhas) / len(linhas) <= 0.6, (nome, sum(linhas), len(linhas)))

    def test_versao_muda_com_a_paleta(self):
        """Os mesmos índices de pixel com uma cor da paleta trocada dão outra versão (cache do navegador); os mesmos
        índices e dados, a mesma. É a função que a montagem usa (sem montar de novo)."""
        import montar_mundo as mm
        import mundo_terreno as mt
        pixels, dados = bytes(range(256)) * 4, {"cidades": [1, 2]}
        paleta = dict(mm.PALETA)
        antes = mm.versao(pixels, [paleta, mt.CORES, dados])
        self.assertEqual(antes, mm.versao(pixels, [dict(paleta), dict(mt.CORES), dados]))
        paleta["mar"] = "#010203"
        self.assertNotEqual(antes, mm.versao(pixels, [paleta, mt.CORES, dados]))
        # e a montagem passa à versão os arquivos que gravou (os PNG levam a paleta deles) e os dados do mundo.json
        dados = {k: v for k, v in self.mundo.items() if k != "versao"}
        self.assertEqual(self.mundo["versao"], mm.versao_dos_arquivos(self.pastas[0], dados))

    # --- a camada de perto (Tarefa 6g) -------------------------------------------------------------------------------
    def ufs(self):
        """O mapa das UFs do mundo.json decodificado: linhas de 400 siglas (None fora do Brasil)."""
        ufs = self.mundo["niveis"]["brasil"]["ufs"]
        import re
        import string
        siglas, linhas = [u["uf"] for u in ufs["lista"]], []
        for texto in ufs["mapa"]:
            linha = []
            for letra, n in re.findall(r"([.a-zA-Z])(\d+)", texto):
                linha += [None if letra == "." else siglas[string.ascii_letters.index(letra)]] * int(n)
            linhas.append(linha)
        return linhas

    def test_azulejos_de_perto(self):
        """A camada de perto: 16 azulejos PNG de 200x200 (o mapa em 800x800), dentro do teto de peso declarado."""
        total = 0
        for nome in AZULEJOS:
            caminho = os.path.join(self.pastas[0], nome)
            with open(caminho, "rb") as f:
                cabeca = f.read(24)
            self.assertEqual(cabeca[1:4], b"PNG", nome)
            self.assertEqual((int.from_bytes(cabeca[16:20], "big"), int.from_bytes(cabeca[20:24], "big")), (200, 200), nome)
            total += os.path.getsize(caminho)
        self.assertLessEqual(total, TETO_AZULEJOS, f"azulejos: {total} bytes")

    def test_perto_coerente_com_longe(self):
        """A camada de perto é o mesmo mapa com mais detalhe: amostrando uma grade, a água fica onde é água e o bioma
        no meio de cada bioma é o mesmo (o bloco 2x2 de perto nas cores do bioma do pixel de longe)."""
        import mundo_terreno as mt
        agua = {mt.CORES[n] for n in mt.AGUA}
        pontos = [[x, y] for y in range(24, 376, 8) for x in range(24, 376, 8)]
        longe = self.cores(pontos)
        perto = self.cores_perto([[2 * x + dx, 2 * y + dy] for x, y in pontos for dy in (0, 1) for dx in (0, 1)])
        blocos = [perto[k * 4:k * 4 + 4] for k in range(len(pontos))]
        mesma_agua = sum((c in agua) == (sum(b in agua for b in bloco) >= 2) for c, bloco in zip(longe, blocos))
        self.assertGreaterEqual(mesma_agua / len(pontos), 0.96, f"água: {mesma_agua} de {len(pontos)}")
        import montar_mundo as mm
        for bioma, (lat, lon) in NO_BIOMA.items():
            x, y = mm.para_pixel(lat, lon, mm.CAIXA_BRASIL, 400, 400)
            janela = [[2 * x + dx, 2 * y + dy] for dy in range(-10, 11) for dx in range(-10, 11)]
            dele = mt.cores_do_bioma(bioma)
            cores = self.cores_perto(janela)
            self.assertGreaterEqual(sum(c in dele for c in cores) / len(cores), 0.5, bioma)

    def test_perto_tem_mais_geografia(self):
        """De perto aparecem rodovias e rios menores: na mesma amostra da área do mapa (uma grade de 200x200 pontos nas
        duas camadas), o rio cobre bem mais área de perto (os rios de longe têm a mesma largura no mapa; os menores
        somam) e há centenas de pontos de rodovia; de longe, nenhuma rodovia."""
        import mundo_terreno as mt
        rio, estradas = mt.CORES["rio"], {mt.CORES[n] for n in mt.CORES if n.split("_ap")[0].rstrip("~") in mt.ESTRADA}
        longe = self.cores([[x, y] for y in range(0, 400, 2) for x in range(0, 400, 2)])
        perto = self.cores_perto([[x, y] for y in range(0, 800, 4) for x in range(0, 800, 4)])
        self.assertGreater(sum(c == rio for c in perto), 1.2 * sum(c == rio for c in longe))
        self.assertGreater(sum(c in estradas for c in perto), 300)
        self.assertEqual(sum(c in estradas for c in longe), 0)

    def test_estados(self):
        """As 27 UFs no mundo.json: nome, capital e o ponto do nome dentro da própria UF; o mapa delas em linhas de 400
        (a UF de cada pixel, pelo mesmo contorno do desenho), para o realce sob o cursor."""
        ufs = self.mundo["niveis"]["brasil"]["ufs"]
        lista, mapa = ufs["lista"], self.ufs()
        self.assertEqual({u["uf"] for u in lista}, UFS)
        self.assertEqual(len(mapa), 400)
        self.assertTrue(all(len(l) == 400 for l in mapa))
        capitais = {c["uf"]: c["id"] for c in self.mundo["cidades"] if c["id"] != "mateus-leme"}
        for u in lista:   # o ponto do nome e até 3 de reserva (para quando uma miniatura cai em cima), todos na UF
            self.assertEqual(set(u), {"uf", "nome", "capital", "x", "y", "r", "outros"})
            self.assertEqual(u["capital"], capitais[u["uf"]])
            self.assertEqual(mapa[u["y"]][u["x"]], u["uf"], u["uf"])
            self.assertGreaterEqual(u["r"], 1)
            self.assertLessEqual(len(u["outros"]), 3)
            for x, y, r in u["outros"]:
                self.assertEqual(mapa[y][x], u["uf"], u["uf"])
                self.assertTrue(1 <= r <= u["r"])
        self.assertGreaterEqual(len(next(u for u in lista if u["uf"] == "MG")["outros"]), 2)
        nomes = {u["uf"]: u["nome"] for u in lista}
        self.assertEqual((nomes["MG"], nomes["SP"], nomes["DF"]), ("Minas Gerais", "São Paulo", "Distrito Federal"))
        for c in self.mundo["cidades"]:
            self.assertEqual(mapa[c["y"]][c["x"]], c["uf"], c["id"])
        self.assertIsNone(mapa[200][390])   # mar
        self.assertIsNone(mapa[280][150])   # Paraguai

    def test_cidades_medias(self):
        """As cidades médias (3x): as maiores do Brasil que não são capitais, de 40 a 60, em terra brasileira, cada uma com
        a UF do pixel, longe das capitais (o subúrbio fica sob a miniatura) e da média maior vizinha."""
        import mundo_terreno as mt
        medias, mapa = self.mundo["niveis"]["brasil"]["medias"], self.ufs()
        self.assertTrue(40 <= len(medias) <= 60, len(medias))
        self.assertEqual(len({m["nome"] for m in medias}), len(medias))
        for m in medias:
            self.assertEqual(set(m), {"nome", "uf", "x", "y", "pop"})
            self.assertEqual(mapa[m["y"]][m["x"]], m["uf"], m["nome"])
            for c in self.mundo["cidades"]:   # a mais de 3 px (uns 35 km) de toda capital e de Mateus Leme
                self.assertGreater((m["x"] - c["x"]) ** 2 + (m["y"] - c["y"]) ** 2, 9, (m, c["id"]))
        self.assertEqual([m["pop"] for m in medias], sorted((m["pop"] for m in medias), reverse=True))
        self.assertTrue({"Campinas", "Uberlândia", "Feira de Santana", "Juiz de Fora"} <= {m["nome"] for m in medias})
        agua = {mt.CORES[n] for n in mt.AGUA if not n.startswith("rio")} | mt.cores_apagadas()
        for m, cor in zip(medias, self.cores([[m["x"], m["y"]] for m in medias])):
            self.assertNotIn(cor, agua, m["nome"])

    def test_paises_vizinhos(self):
        """Os nomes dos vizinhos (o sudoeste e a borda deixam de ser só terra apagada): o ponto de cada um na terra dele."""
        paises = self.mundo["niveis"]["brasil"]["paises"]
        self.assertTrue({"Paraguai", "Bolívia", "Argentina", "Peru", "Uruguai", "Venezuela"} <= {p["nome"] for p in paises})
        import mundo_terreno as mt
        for p, cor in zip(paises, self.cores([[p["x"], p["y"]] for p in paises])):
            self.assertEqual(set(p), {"nome", "x", "y"})
            self.assertIn(cor, mt.cores_apagadas(), p["nome"])

    def test_chaco_com_desenho_proprio(self):
        """O chaco (oeste do Paraguai, sudeste da Bolívia) tem paleta e glifos próprios, apagados como todo vizinho."""
        import mundo_terreno as mt
        dele = {mt.CORES[n] for n in mt.CORES if n.startswith("ch_") and "_ap" in n}
        cores = self.janela(-22.5, -60.5, 5)
        self.assertGreaterEqual(sum(c in dele for c in cores) / len(cores), 0.5)
        self.assertGreaterEqual(len(set(cores)), 5)

    def test_misiones_sem_beira_reta(self):
        """O planalto das araucárias (chão claro do pampa) fica só no Brasil: em Misiones (Argentina), dos dois lados da
        lon -54 (a beira do polígono), a terra é a mesma, sem uma faixa clara de beira reta (achado da rodada 4)."""
        import montar_mundo as mm
        import mundo_terreno as mt
        pampa = {mt.CORES[n] for n in mt.CORES if n.startswith("pp_") and "_ap" in n}
        apagadas = mt.cores_apagadas()
        for lado in ((-54.35, -54.02), (-53.98, -53.6)):
            pontos = [list(map(int, mm.em_pixels(lon / 10, lat / 10, 800, 800))) for lat in range(-276, -255)
                      for lon in range(int(lado[0] * 100) // 10, int(lado[1] * 100) // 10 + 1)]
            cores = [c for c in self.cores_perto(pontos) if c in apagadas]
            self.assertGreater(len(cores), 10, lado)
            self.assertLess(sum(c in pampa for c in cores) / len(cores), 0.1, f"Misiones, lon {lado}: chão do planalto")

    def test_borda_some_em_nevoa(self):
        """A borda da caixa esmaece em névoa: nenhum pixel de terra encosta no mar de fora (FORA), sempre há névoa ou
        mar entre os dois, e a névoa aparece nas bordas com terra (oeste, sul e norte)."""
        import mundo_terreno as mt
        fora, nevoa = mt.CORES[mt.FORA], {mt.CORES[n] for n in mt.NEVOA}
        agua = {mt.CORES[n] for n in mt.AGUA}
        pontos = [[x, y] for y in range(400) for x in range(0, 30)] + [[x, y] for y in range(370, 400) for x in range(400)]
        pontos += [[x, y] for y in range(0, 30) for x in range(400)]
        cor = dict(zip(map(tuple, pontos), self.cores(pontos)))
        colados = [(x, y) for (x, y), c in cor.items() if c not in agua
                   and any(cor.get((x + a, y + b)) == fora for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))]
        self.assertEqual(colados, [])
        self.assertGreater(sum(c in nevoa for c in cor.values()), 1500)

    # --- o terceiro nível (4x) e o mapa das UFs de 2x (rodada 1 da 6g) -----------------------------------------------------
    def cores_4x(self, pontos):
        """Cor '#rrggbb' de cada (x, y) do nível de 4x (pixels de 1600x1600); fora dos azulejos gerados, None."""
        ler = ("import json, os, sys\nfrom PIL import Image\nabertos = {}\nsaida = []\n"
               "for x, y in json.loads(sys.stdin.read()):\n"
               "    k = (x // 200, y // 200)\n    p = os.path.join(sys.argv[1], 'perto4x', '%d-%d.png' % k)\n"
               "    if k not in abertos:\n        abertos[k] = Image.open(p).convert('RGB') if os.path.exists(p) else None\n"
               "    saida.append(abertos[k] and '#%02x%02x%02x' % abertos[k].getpixel((x % 200, y % 200)))\n"
               "print(json.dumps(saida))")
        r = subprocess.run([sys.executable, "-c", ler, self.pastas[0]], input=json.dumps(pontos), capture_output=True,
                           text=True, timeout=120)
        if r.returncode:
            raise AssertionError(r.stderr)
        return json.loads(r.stdout)

    def test_terceiro_nivel(self):
        """O nível de 4x: 8x8 azulejos de 200 px, só os que tocam o Brasil (a máscara do mundo.json diz quais), dentro do
        teto de peso declarado; todo azulejo com uma cidade existe, e o canto de mar aberto não."""
        cfg = self.mundo["niveis"]["brasil"]["perto4x"]
        self.assertEqual({k: cfg[k] for k in ("escala", "azulejo", "n")}, {"escala": 4, "azulejo": 200, "n": 8})
        self.assertRegex(cfg["azulejos"], r"^[01]{64}$")
        total, gerados = 0, [f"perto4x/{k % 8}-{k // 8}.png" for k, c in enumerate(cfg["azulejos"]) if c == "1"]
        for nome in gerados:
            with open(os.path.join(self.pastas[0], nome), "rb") as f:
                cabeca = f.read(24)
            self.assertEqual((int.from_bytes(cabeca[16:20], "big"), int.from_bytes(cabeca[20:24], "big")), (200, 200), nome)
            total += os.path.getsize(os.path.join(self.pastas[0], nome))
        self.assertLessEqual(total, TETO_4X, f"nível de 4x: {total} bytes")
        self.assertTrue(20 <= len(gerados) < 64, len(gerados))
        for c in self.mundo["cidades"] + self.mundo["niveis"]["brasil"]["medias"]:
            self.assertEqual(cfg["azulejos"][(c["y"] // 50) * 8 + c["x"] // 50], "1", c.get("id", c.get("nome")))
        self.assertEqual(cfg["azulejos"][0 * 8 + 7], "0", "o canto nordeste é mar aberto")

    def test_terceiro_nivel_mesmas_formas(self):
        """A troca de 2x para 4x não pula: amostrando uma grade, o bloco 2x2 de 4x sobre cada pixel de 2x é água onde ele é
        água e, na terra, é da mesma família de cores (o mesmo bioma, a mesma serra): as árvores, as serras e as rodovias
        são redesenhadas na escala nova, nos mesmos lugares e na mesma paleta."""
        import mundo_terreno as mt
        agua = {mt.CORES[n] for n in mt.AGUA}
        nome = {}
        for n, h in mt.CORES.items():
            nome.setdefault(h, n)
        familia = lambda h: "agua" if h in agua else nome.get(h, "")[:3] if nome.get(h, "")[2:3] == "_" else "outra"
        pontos = [[x, y] for y in range(60, 760, 14) for x in range(60, 760, 14)]
        dois = self.cores_perto(pontos)
        quatro = self.cores_4x([[2 * x + a, 2 * y + b] for x, y in pontos for b in (0, 1) for a in (0, 1)])
        pares = [(c, quatro[k * 4:k * 4 + 4]) for k, c in enumerate(dois) if quatro[k * 4] is not None]
        self.assertGreater(len(pares), 1200)
        mesma_agua = sum((c in agua) == (sum(b in agua for b in bloco) >= 2) for c, bloco in pares)
        terra = [(c, bloco) for c, bloco in pares if c not in agua]
        mesma_familia = sum(familia(c) in {familia(b) for b in bloco} for c, bloco in terra)
        self.assertGreaterEqual(mesma_agua / len(pares), 0.97, f"água {mesma_agua}/{len(pares)}")
        self.assertGreaterEqual(mesma_familia / len(terra), 0.85, f"família {mesma_familia}/{len(terra)}")

    def test_terceiro_nivel_tem_detalhe_novo(self):
        """A 4x há o que não há a 2x, sem virar padrão: lavoura e pasto só num anel junto das cidades do Centro-Sul (pouca área,
        nada em volta de Manaus), pontes e o asfalto com a faixa das rodovias, o meio-tom das serras."""
        import mundo_terreno as mt
        lavoura = {mt.CORES[n] for n in mt.LAVOURAS}
        amostra = [[x, y] for y in range(0, 1600, 3) for x in range(0, 1600, 3)]
        quatro = [c for c in self.cores_4x(amostra) if c]
        dois = self.cores_perto([[x // 2, y // 2] for x, y in amostra[::4]])
        terra = [c for c in quatro if c not in {mt.CORES[n] for n in mt.AGUA}]
        campos = sum(c in lavoura for c in quatro)
        self.assertGreater(campos, 100)
        self.assertLess(campos / len(terra), 0.02, f"lavoura em {campos} de {len(terra)} pontos de terra")
        self.assertEqual(sum(c in lavoura for c in dois), 0)
        for nome in ("ponte", "asfalto", "faixa"):
            self.assertGreater(sum(c == mt.CORES[nome] for c in quatro), 5, nome)
        perto = lambda cid, r: self.cores_4x([[cid["x"] * 4 + a, cid["y"] * 4 + b] for a in range(-r, r + 1, 2) for b in range(-r, r + 1, 2)])
        bh = next(c for c in self.mundo["cidades"] if c["id"] == "belo-horizonte")
        manaus = next(c for c in self.mundo["cidades"] if c["id"] == "manaus")
        self.assertGreater(sum(c in lavoura for c in perto(bh, 40)), 10, "lavoura em volta de BH")
        self.assertEqual(sum(c in lavoura for c in perto(manaus, 60)), 0, "nada de lavoura na Amazônia")
    def cores_do_relevo(self):
        """As cores de cada família de peças de relevo (mundo_terreno.RELEVO), cheias e apagadas, como a montagem as usa
        (montar_mundo.pecas_do_relevo, com o Pillow, no processo filho)."""
        ler = ("import json, sys\nsys.path.insert(0, sys.argv[1])\nimport montar_mundo as mm, mundo_terreno as mt\n"
               "pecas = mm.pecas_do_relevo()\nsaida = {}\n"
               "for fam, filas in mt.RELEVO.items():\n"
               "    cores = {c for fila in filas for n in fila for c in pecas[n.split('/')[0]][2] if c}\n"
               "    saida[fam] = sorted(cores | {mt.apagada(c) for c in cores})\n"
               "print(json.dumps(saida))")
        r = subprocess.run([sys.executable, "-B", "-c", ler, os.path.join(RAIZ, "ferramentas")], capture_output=True, text=True,
                           timeout=60)
        if r.returncode:
            raise AssertionError(r.stderr)
        return {f: set(c) for f, c in json.loads(r.stdout).items()}

    def test_serras_com_pecas_de_relevo(self):
        """As serras são peças pintadas (PixelLab) carimbadas ao longo das linhas do serras.json, da família certa (mata na
        Serra do Mar, na Mantiqueira, na Serra Geral e nas Guianas; rocha no Espinhaço; chapada na Chapada Diamantina; neve
        nos Andes): acima de quase todo ponto da linha (longe da névoa da borda) há peça da família, a 4x onde o azulejo
        existe e a 2x em todo lugar, e quase nenhuma de outra família (só onde duas serras se emendam, como o Espinhaço e a
        Mantiqueira no Quadrilátero). E nos mesmos lugares nos dois níveis: o bloco 2x2 de
        4x sobre cada pixel de 2x tem peça quando ele tem (e não tem quando ele não tem) quase sempre."""
        familias = self.cores_do_relevo()
        todas = set().union(*familias.values())
        so_dela = {f: c - set().union(*(o for g, o in familias.items() if g != f)) for f, c in familias.items()}
        with open(os.path.join(RAIZ, "arte", "mundo", "serras.json"), encoding="utf-8") as f:
            serras = {s["id"]: s for s in json.load(f)}
        esperado = {"mantiqueira": "verde", "serra-do-mar": "verde", "serra-geral": "verde", "guianas": "verde",
                    "espinhaco": "rocha", "chapada-diamantina": "mesa", "andes": "neve"}
        px = lambda lon, lat: ((lon + 74) * 40, (6 - lat) * 40)   # pixels de 4x
        margem = 130   # a névoa da borda (até ~1,6·VINHETA px de longe)
        for sid, fam in esperado.items():
            pontos = []
            for linha in serras[sid]["linhas"]:
                for (a, b), (c, d) in zip(linha, linha[1:]):
                    passos = max(1, round(((c - a) ** 2 + (b - d) ** 2) ** 0.5 * 40 / 8))
                    for k in range(passos):
                        x, y = px(a + (c - a) * k / passos, b + (d - b) * k / passos)
                        if margem <= x < 1600 - margem and margem <= y < 1600 - margem:
                            pontos.append((round(x), round(y)))
            self.assertGreater(len(pontos), 8, sid)
            for nivel in (4, 2):
                janelas = [[(x + a) * nivel // 4, (y + b) * nivel // 4] for x, y in pontos for a in range(-12, 13, 4)
                           for b in range(-28, 5, 4)]
                cores = self.cores_4x(janelas) if nivel == 4 else self.cores_perto(janelas)
                n = len(janelas) // len(pontos)
                blocos = [cores[k * n:k * n + n] for k in range(len(pontos))]
                # a 4x só existem os azulejos que tocam o Brasil: vale a janela com pelo menos metade dos pontos num deles
                blocos = [[c for c in b if c is not None] for b in blocos]
                blocos = [b for b in blocos if len(b) >= n // 2]
                if nivel == 4 and sid == "andes" and not blocos:
                    continue   # os Andes ficam fora do Brasil: a 4x, só onde um azulejo da fronteira os alcança
                self.assertTrue(blocos, f"{sid} a {nivel}x: nenhum ponto da linha num azulejo")
                com = sum(any(c in familias[fam] for c in b) for b in blocos)
                self.assertGreaterEqual(com / len(blocos), 0.85, f"{sid} a {nivel}x: peça em {com} de {len(blocos)} pontos da linha")
                pecas = [c for b in blocos for c in b if c in todas]
                outras = [c for c in pecas if c not in familias[fam] and any(c in so_dela[g] for g in so_dela if g != fam)]
                self.assertLess(len(outras), 0.1 * len(pecas), f"{sid} a {nivel}x: peça de outra família (só na emenda de duas serras)")
        # os mesmos lugares a 2x e a 4x: Minas, Rio e São Paulo (Mantiqueira, Serra do Mar e o Espinhaço)
        pontos = [[x, y] for y in range(500, 660, 3) for x in range(560, 700, 3)]
        dois = self.cores_perto(pontos)
        quatro = self.cores_4x([[2 * x + a, 2 * y + b] for x, y in pontos for b in (0, 1) for a in (0, 1)])
        pares = [(c in todas, any(q in todas for q in quatro[k * 4:k * 4 + 4])) for k, c in enumerate(dois)]
        com_peca = [p for p in pares if p[0] or p[1]]
        self.assertGreater(len(com_peca), 300)
        iguais = sum(a == b for a, b in com_peca)
        self.assertGreaterEqual(iguais / len(com_peca), 0.8, f"mesmos lugares: {iguais} de {len(com_peca)}")

    def test_glifos_de_4x(self):
        """Os glifos de 4x: o mandacaru sem pixel solto (tudo ligado ao tronco), a araucária nunca mais larga que a copa da
        Mata Atlântica e de tamanhos variados, e a rodovia de asfalto escuro com a faixa clara."""
        import mundo_terreno as mt
        for s in range(400):
            g = mt.mandacaru4(10 + s % 9, 14 + s % 13, s)
            cheios = {(x, y) for y, f in enumerate(g) for x, ch in enumerate(f) if ch != "."}
            visto, fila = set(), [next(iter(cheios))]
            while fila:
                p = fila.pop()
                if p in visto or p not in cheios:
                    continue
                visto.add(p)
                fila += [(p[0] + 1, p[1]), (p[0] - 1, p[1]), (p[0], p[1] + 1), (p[0], p[1] - 1)]
            self.assertEqual(visto, cheios, f"mandacaru {s}: pixel solto")
        mata = max(mt.tamanho4("copa", len(mt.COPA_MATA[0]) * 2, len(mt.COPA_MATA) * 2, s)[0] for s in range(200))
        arau = [mt.tamanho4("araucaria", len(mt.ARAUCARIA[0]) * 2, len(mt.ARAUCARIA) * 2, s) for s in range(200)]
        self.assertLessEqual(max(w for w, h in arau), mata)
        self.assertGreaterEqual(len({(w, h) for w, h in arau}), 6, "tamanhos variados")

    def test_mapa_das_ufs_de_perto(self):
        """O mapa das UFs na grade de 2x (perto/ufs.json, para o contorno do realce seguir a divisa desenhada): 800 linhas
        de 800, e a UF de cada cidade em volta do pixel dela vezes 2 (a costa de 2x é a do contorno na resolução nova: a
        cidade do litoral pode cair a 1 ou 2 px do mar)."""
        import re
        import string
        with open(os.path.join(self.pastas[0], "perto", "ufs.json"), encoding="utf-8") as f:
            dados = json.load(f)
        self.assertEqual((dados["w"], dados["h"], len(dados["mapa"])), (800, 800, 800))
        siglas = sorted(UFS)

        def linha(y):
            saida = []
            for letra, n in re.findall(r"([.a-zA-Z])(\d+)", dados["mapa"][y]):
                saida += [None if letra == "." else siglas[string.ascii_letters.index(letra)]] * int(n)
            return saida
        self.assertTrue(all(len(linha(y)) == 800 for y in range(0, 800, 37)))
        for c in self.mundo["cidades"]:
            perto = {linha(2 * c["y"] + b)[2 * c["x"] + a] for a in range(-2, 4) for b in range(-2, 4)}
            self.assertIn(c["uf"], perto, c["id"])

if __name__ == "__main__":
    unittest.main()
