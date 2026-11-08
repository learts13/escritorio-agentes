"""Validadores das Configurações (ajustes.py): tudo ou nada, número de verdade, datas reais e os tetos.
Cada caso ruim é um mutante de um caso bom, para o teste não passar por um motivo diferente do que diz."""
import json
import os
import shutil
import tempfile
import unittest

import ajustes

CLIMA = {"cidade": "Belo Horizonte", "lat": -19.9167, "lon": -43.9345}
DATA = {"nome": "Aniversário da empresa", "data": "03-15", "dias": 2, "tema": "generico", "falas": ["Parabéns!"]}
FESTAS = {"rev": 0, "proprias": [DATA], "desligadas": ["halloween"]}


def com(base, **mudanca):
    return {**base, **mudanca}


class Clima(unittest.TestCase):
    def test_valido_com_duas_casas_e_sem_clima(self):
        self.assertEqual(ajustes.validar_clima(CLIMA), {"cidade": "Belo Horizonte", "lat": -19.92, "lon": -43.93})
        self.assertEqual(ajustes.validar_clima(com(CLIMA, lat=-90, lon=180, cidade="  São Paulo ")),
                         {"cidade": "São Paulo", "lat": -90, "lon": 180})   # int vale; as bordas valem
        self.assertIsNone(ajustes.validar_clima(None))

    def test_numero_de_verdade(self):
        for campo, valor in (("lat", True), ("lon", False), ("lat", float("nan")), ("lon", float("inf")), ("lat", 10 ** 400),
                             ("lon", -10 ** 400),
                             ("lat", float("-inf")), ("lat", "1"), ("lat", None), ("lat", [1]),
                             ("lat", 90.001), ("lat", -90.5), ("lon", 180.01), ("lon", -181)):
            with self.subTest(campo=campo, valor=valor), self.assertRaises(ValueError) as x:
                ajustes.validar_clima(com(CLIMA, **{campo: valor}))
            self.assertIn("Latitude" if campo == "lat" else "Longitude", str(x.exception))

    def test_json_recusa_nan_e_infinity_e_o_1e400_cai_no_numero(self):
        for cru in ('{"lat": NaN}', '{"lat": Infinity}', '{"lat": -Infinity}'):
            with self.subTest(cru=cru), self.assertRaises(ValueError):
                ajustes.json_estrito(cru)
        grande = ajustes.json_estrito('{"cidade": "X", "lat": 1e400, "lon": 1}')   # o json vira inf sem constante
        with self.assertRaises(ValueError):
            ajustes.validar_clima(grande)
        self.assertEqual(ajustes.json_estrito('{"lat": 1.5}'), {"lat": 1.5})   # controle

    def test_cidade(self):
        for cidade in ("", "   ", "x" * 61, "Belo\nHorizonte", 7, None, ["BH"]):
            with self.subTest(cidade=cidade), self.assertRaises(ValueError):
                ajustes.validar_clima(com(CLIMA, cidade=cidade))
        self.assertEqual(ajustes.validar_clima(com(CLIMA, cidade="x" * 60))["cidade"], "x" * 60)
        self.assertEqual(ajustes.validar_clima(com(CLIMA, cidade="Lu​z‮"))["cidade"], "Luz")   # invisíveis saem

    def test_campos_exatos(self):
        for c in ({"cidade": "X", "lat": 1}, {**CLIMA, "pais": "BR"}, [CLIMA], "BH"):
            with self.subTest(c=c), self.assertRaises(ValueError):
                ajustes.validar_clima(c)

    def test_arquivo(self):
        self.assertEqual(ajustes.validar_arquivo_clima({"v": 1, "clima": None}), {"clima": None})
        for d in ({"clima": CLIMA}, {"v": 2, "clima": CLIMA}, {"v": True, "clima": CLIMA}, {"v": 1, "clima": CLIMA, "x": 1}):
            with self.subTest(d=d), self.assertRaises(ValueError):
                ajustes.validar_arquivo_clima(d)
        bruto = ajustes.bytes_do_clima(ajustes.validar_clima(com(CLIMA, cidade="ç" * 60)))   # o maior que cabe no teto
        self.assertLessEqual(len(bruto), ajustes.CLIMA_BYTES)
        self.assertEqual(ajustes.validar_arquivo_clima(json.loads(bruto))["clima"]["cidade"], "ç" * 60)   # ida e volta


class Festas(unittest.TestCase):
    def test_valido_e_padroes(self):
        f = ajustes.validar_festas(FESTAS)
        self.assertEqual(f, {"rev": 0, "proprias": [DATA], "desligadas": ["halloween"]})
        curta = {"nome": "Dia X", "data": "2026-12-31", "tema": "natal"}   # sem dias nem falas: 1 dia, falas do tema
        self.assertEqual(ajustes.validar_festas(com(FESTAS, proprias=[curta]))["proprias"],
                         [{**curta, "dias": 1, "falas": []}])
        self.assertIsNot(f["proprias"][0], DATA)   # cópia nova

    def test_datas_reais(self):
        for data in ("02-29", "12-31", "01-01", "2028-02-29", "2000-01-01", "2100-12-31"):
            ajustes.validar_festas(com(FESTAS, proprias=[com(DATA, data=data)]))
        for data in ("02-30", "13-01", "00-10", "04-31", "2026-02-29", "1999-12-31", "2101-01-01", "2-3", "03-15 ",
                     "2026-3-15", "٠٣-١٥", "03/15", 315, None):
            with self.subTest(data=data), self.assertRaises(ValueError) as x:
                ajustes.validar_festas(com(FESTAS, proprias=[DATA, com(DATA, data=data)]))
            self.assertTrue(str(x.exception).startswith("Data 2: data inválida"))

    def test_campos_de_cada_data(self):
        mutantes = [com(DATA, dias=0), com(DATA, dias=15), com(DATA, dias=True), com(DATA, dias=1.0), com(DATA, dias="2"),
                    com(DATA, tema="Natal"), com(DATA, tema="t" * 21), com(DATA, tema=""), com(DATA, tema=None),
                    com(DATA, nome=""), com(DATA, nome="n" * 41), com(DATA, nome="a\nb"),
                    com(DATA, falas=["a", "b", "c", "d"]), com(DATA, falas=[""]), com(DATA, falas=["f" * 81]),
                    com(DATA, falas=["a\nb"]), com(DATA, falas="Parabéns"), com(DATA, falas=[1]), com(DATA, cor="#fff"),
                    {k: v for k, v in DATA.items() if k != "tema"}, "03-15"]
        for m in mutantes:
            with self.subTest(m=m), self.assertRaises(ValueError) as x:
                ajustes.validar_festas(com(FESTAS, proprias=[m]))
            self.assertTrue(str(x.exception).startswith("Data 1"), str(x.exception))
        ajustes.validar_festas(com(FESTAS, proprias=[com(DATA, dias=14, falas=["f" * 80] * 3, nome="n" * 40, tema="t" * 20)]))

    def test_mensagem_sem_o_valor(self):
        with self.assertRaises(ValueError) as x:
            ajustes.validar_festas(com(FESTAS, proprias=[com(DATA, nome="<script>alert(1)</script>" * 3)]))
        self.assertNotIn("script", str(x.exception))

    def test_tetos_e_desligadas(self):
        ajustes.validar_festas(com(FESTAS, proprias=[DATA] * 24, desligadas=[c * 3 for c in "abcdefghijklmnopqrst"]))
        for d in (com(FESTAS, proprias=[DATA] * 25), com(FESTAS, desligadas=[c * 3 for c in "abcdefghijklmnopqrstu"]),
                  com(FESTAS, desligadas=["natal", "natal"]), com(FESTAS, desligadas=["Natal"]),
                  com(FESTAS, desligadas=["dia_x"]), com(FESTAS, desligadas=[""]), com(FESTAS, desligadas="natal"),
                  com(FESTAS, proprias={"0": DATA})):
            with self.subTest(d=d), self.assertRaises(ValueError):
                ajustes.validar_festas(d)

    def test_raiz_e_rev(self):
        for d in ({"proprias": [], "desligadas": []}, com(FESTAS, extra=1), com(FESTAS, rev=-1), com(FESTAS, rev=True),
                  com(FESTAS, rev=1.0), com(FESTAS, rev=10 ** 9 + 1), [FESTAS]):
            with self.subTest(d=d), self.assertRaises(ValueError):
                ajustes.validar_festas(d)

    def test_arquivo_pede_a_versao(self):
        self.assertEqual(ajustes.validar_festas({**FESTAS, "v": 1}, arquivo=True)["rev"], 0)
        for d in (FESTAS, {**FESTAS, "v": 2}, {**FESTAS, "v": True}):
            with self.subTest(d=d), self.assertRaises(ValueError):
                ajustes.validar_festas(d, arquivo=True)
        with self.assertRaises(ValueError):   # o corpo do POST não leva o "v"
            ajustes.validar_festas({**FESTAS, "v": 1})
        f = ajustes.validar_festas(FESTAS)
        self.assertEqual(ajustes.validar_festas(json.loads(ajustes.bytes_das_festas(f)), arquivo=True), f)   # ida e volta


TIME = {"nome": "Dev", "tipo": "mesas", "cor": "#3b82f6", "icone": "codigo", "parede": 0, "piso": 2, "agentes": ["cora", "duda"]}
VISUAL = {"color": "teal", "eyes": "happy", "accessory": ""}
EQUIPE = {"rev": 0, "times": [TIME], "aparencia": {"cora": VISUAL}}


class Equipe(unittest.TestCase):
    def test_valido(self):
        e = ajustes.validar_equipe(EQUIPE)
        self.assertEqual(e, EQUIPE)
        self.assertIsNot(e["times"][0], TIME)
        sem_cor = com(TIME, nome="Ops & Infra", tipo="ops", cor=None, icone=None, parede=5, piso=9, agentes=[])
        self.assertEqual(ajustes.validar_equipe(com(EQUIPE, times=[TIME, sem_cor]))["times"][1], sem_cor)
        self.assertEqual(ajustes.validar_equipe(com(EQUIPE, times=[], aparencia={}))["times"], [])   # vazio também vale

    def test_cada_campo_do_time(self):
        mutantes = [com(TIME, nome=""), com(TIME, nome="a" * 41), com(TIME, nome="Dev|1"), com(TIME, nome="Dev\n"),
                    com(TIME, nome=7), com(TIME, tipo="sala"), com(TIME, tipo=None), com(TIME, cor="azul"),
                    com(TIME, cor="#3b82f"), com(TIME, cor=["#3b82f6"]), com(TIME, icone="foguete"), com(TIME, icone=["codigo"]),
                    com(TIME, parede=6), com(TIME, parede=-1), com(TIME, parede=True), com(TIME, parede=1.0),
                    com(TIME, piso=10), com(TIME, piso="2"), com(TIME, agentes="cora"), com(TIME, agentes=["Cora"]),
                    com(TIME, agentes=["-cora"]), com(TIME, agentes=[7]), com(TIME, agentes=["cora", "cora"]),
                    com(TIME, agentes=[f"a{i}" for i in range(25)]), com(TIME, conversas="responder"),
                    {k: v for k, v in TIME.items() if k != "icone"}, "Dev"]
        for m in mutantes:
            with self.subTest(m=m), self.assertRaises(ValueError) as x:
                ajustes.validar_equipe(com(EQUIPE, times=[m]))
            self.assertTrue(str(x.exception).startswith("Time 1"), str(x.exception))
        ajustes.validar_equipe(com(EQUIPE, times=[com(TIME, nome="a" * 40, agentes=[f"a{i}" for i in range(24)])]))

    def test_nome_unico_e_agente_em_um_time_so(self):
        for outro, msg in ((com(TIME, nome="DEV", agentes=[]), "já existe um time com esse nome"),
                           (com(TIME, nome="Ops", agentes=["duda"]), "um agente já está em outro time")):
            with self.assertRaises(ValueError) as x:
                ajustes.validar_equipe(com(EQUIPE, times=[TIME, outro]))
            self.assertTrue(str(x.exception).startswith("Time 2:") and msg in str(x.exception))
        ajustes.validar_equipe(com(EQUIPE, times=[TIME, com(TIME, nome="Ops", agentes=["eco"])]))   # controle

    def test_tetos(self):
        times = [com(TIME, nome=f"T{i}", agentes=[]) for i in range(12)]
        visual = {f"a{i}": VISUAL for i in range(300)}
        ajustes.validar_equipe(com(EQUIPE, times=times, aparencia=visual))
        for d in (com(EQUIPE, times=times + [com(TIME, nome="T12", agentes=[])]), com(EQUIPE, aparencia={**visual, "b": VISUAL})):
            with self.subTest(n=len(d["times"])), self.assertRaises(ValueError):
                ajustes.validar_equipe(d)

    def test_aparencia(self):
        for a in ({"Cora": VISUAL}, {"cora": com(VISUAL, color="pink")}, {"cora": com(VISUAL, eyes="x")},
                  {"cora": com(VISUAL, accessory="cape")}, {"cora": com(VISUAL, accessory=None)}, {"cora": com(VISUAL, color=["teal"])},
                  {"cora": {"color": "teal", "eyes": "happy"}}, {"cora": com(VISUAL, cor="x")}, {"cora": "teal"}, ["cora"]):
            with self.subTest(a=a), self.assertRaises(ValueError):
                ajustes.validar_equipe(com(EQUIPE, aparencia=a))
        self.assertEqual(ajustes.validar_equipe(com(EQUIPE, aparencia={"cora": com(VISUAL, accessory="crown")}))["aparencia"],
                         {"cora": com(VISUAL, accessory="crown")})

    def test_raiz_sem_campo_a_mais(self):
        for d in (com(EQUIPE, conversas="responder"), com(EQUIPE, clima=None), com(EQUIPE, empresa="Acme"),
                  {"rev": 0, "times": []}, com(EQUIPE, rev=True), com(EQUIPE, rev=-1), com(EQUIPE, times={"Dev": TIME})):
            with self.subTest(d=d), self.assertRaises(ValueError):
                ajustes.validar_equipe(d)

    def test_arquivo_e_ida_e_volta(self):
        e = ajustes.validar_equipe(EQUIPE)
        self.assertEqual(ajustes.validar_equipe(json.loads(ajustes.bytes_da_equipe(e)), arquivo=True), e)
        for d in (EQUIPE, {**EQUIPE, "v": 2}):
            with self.subTest(d=d), self.assertRaises(ValueError):
                ajustes.validar_equipe(d, arquivo=True)

    def test_mensagem_sem_o_valor(self):
        with self.assertRaises(ValueError) as x:
            ajustes.validar_equipe(com(EQUIPE, times=[com(TIME, nome="<script>x</script>")]))
        self.assertNotIn("script", str(x.exception))


class Leitura(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp(prefix="escritorio-ajustes-")
        self.arq, self.logs = os.path.join(self.pasta, "clima.json"), []
        self.ler = lambda: ajustes.ler(self.arq, ajustes.CLIMA_BYTES, ajustes.validar_arquivo_clima,
                                       lambda **c: self.logs.append(c), "clima")

    def tearDown(self):
        shutil.rmtree(self.pasta, ignore_errors=True)

    def grava(self, dados):
        with open(self.arq, "wb") as f:
            f.write(dados)

    def test_ausente_valido_e_invalido(self):
        self.assertIsNone(self.ler())
        self.grava(ajustes.bytes_do_clima(None))
        self.assertEqual(self.ler(), {"clima": None})   # "sem clima" pela tela não é o mesmo que ausente
        for ruim in (b"{", b'{"v": 1, "clima": {"cidade": "X", "lat": NaN, "lon": 1}}', b"\xff\xfe",
                     b'{"v": 1, "clima": null}' + b" " * ajustes.CLIMA_BYTES):
            with self.subTest(ruim=ruim[:30]):
                self.grava(ruim)
                self.assertIsNone(self.ler())
        self.assertEqual(len(self.logs), 2)   # um por tipo de erro (JSONDecodeError e ValueError), não um por leitura
        for _ in range(5):
            self.ler()
        self.assertEqual(len(self.logs), 2)
        self.assertNotIn("X", json.dumps(self.logs))


if __name__ == "__main__":
    unittest.main()
