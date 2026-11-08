# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Ajustes salvos pela tela de Configurações, que valem mais que o times.json: a cidade do clima, as datas
comemorativas e os times com a aparência dos agentes. Validação tudo ou nada, a mesma no salvar e na leitura; quem grava é o escritorio.py, sob trava.

dados/clima.json, até 512 B:
  {"v": 1, "clima": {"cidade": "Belo Horizonte", "lat": -19.92, "lon": -43.94}}   ou {"v": 1, "clima": null} (sem clima)
dados/festas.json, até 16 KB:
  {"v": 1, "rev": 2,
   "proprias": [{"nome": "Aniversário da empresa", "data": "03-15", "dias": 1, "tema": "generico", "falas": ["Parabéns!"]}],
   "desligadas": ["halloween"]}
A data é "MM-DD" (todo ano) ou "AAAA-MM-DD" (uma vez só). O tema e as chaves desligadas são conferidos só no
formato: o catálogo é fechado no navegador (static/festas.js).
dados/equipe.json, até 32 KB (substitui inteiros os "times" e a "aparencia" do times.json):
  {"v": 1, "rev": 4,
   "times": [{"nome": "Dev", "tipo": "mesas", "cor": "#3b82f6", "icone": "codigo", "parede": 0, "piso": 2,
              "agentes": ["cora", "duda"]}],
   "aparencia": {"cora": {"color": "teal", "eyes": "happy", "accessory": ""}}}
Só biblioteca padrão do Python 3.
"""
import datetime
import json
import math
import re
import unicodedata

CLIMA_BYTES, FESTAS_BYTES, EQUIPE_BYTES = 512, 16384, 32768
MAX_PROPRIAS, MAX_DESLIGADAS, MAX_FALAS, MAX_DIAS = 24, 20, 3, 14
MAX_TIMES, MAX_AGENTES_TIME, MAX_APARENCIA = 12, 24, 300
# times e aparência: os mesmos conjuntos para o times.json (escritorio.carregar_times) e para a tela
ROTULO_OK = re.compile(r"[\w .'&À-ÿ\-]{1,40}")
HANDLE_OK = re.compile(r"[a-z0-9][a-z0-9\-]{0,40}")
COR_OK = re.compile(r"#[0-9a-fA-F]{6}")
CORES = {"sky", "indigo", "violet", "rose", "amber", "green", "teal", "graphite"}
OLHOS = {"happy", "sleepy", "round", "wide", "dots"}
ACESSORIOS = {"crown", "hat", "headphones", "headset", "flower", "antenna", "cap", "bow", ""}
ICONES_OK = {"codigo", "megafone", "servidor", "coroa", "sino", "controle", "xicara", "pessoas", "grafico", "pincel", "estrela"}
TIPOS = ("mesas", "ops", "gabinete")
CAMPOS_TIME = {"nome", "tipo", "cor", "icone", "parede", "piso", "agentes"}
REV_TETO = 10 ** 9
TEMA_OK = re.compile(r"[a-z_]{1,20}")
CHAVE_OK = re.compile(r"[a-z]{1,20}")
DIA_DO_ANO = re.compile(r"([0-9]{2})-([0-9]{2})")
DIA_UNICO = re.compile(r"([0-9]{4})-([0-9]{2})-([0-9]{2})")
CAMPOS_FESTAS = {"rev", "proprias", "desligadas"}
CAMPOS_DATA = {"nome", "data", "dias", "tema", "falas"}
_AVISADOS = set()   # (arquivo, motivo) já logados: a leitura é a cada pedido, e o log fica com 1 linha por problema


def limpa_texto(txt, maximo):
    """Texto de fora em texto puro: tira os caracteres de controle (menos o \\n), os de formato (bidi, zero-width, BOM)
    e o surrogate sozinho (emoji cortado). Devolve (texto, cortado)."""
    txt = str(txt).replace("\r\n", "\n")
    txt = "".join(c for c in txt if c == "\n" or unicodedata.category(c) not in ("Cc", "Cf", "Cs"))
    return txt[:maximo], len(txt) > maximo


def _sem_constante(nome):
    raise ValueError("número inválido")   # NaN, Infinity e -Infinity, que o json.loads aceitaria


def json_estrito(bruto):
    """json.loads que recusa NaN e Infinity (o 1e400 vira inf: quem confere o número é o numero())."""
    return json.loads(bruto, parse_constant=_sem_constante)


def texto(x, maximo, msg):
    """Texto limpo, de 1 a maximo caracteres, numa linha só; senão ValueError(msg), sem repetir o que veio."""
    if not isinstance(x, str):
        raise ValueError(msg)
    limpo, cortado = limpa_texto(x, maximo)
    limpo = limpo.strip()
    if cortado or not limpo or "\n" in limpo:
        raise ValueError(msg)
    return limpo


def numero(x, minimo, maximo, msg):
    """Número de verdade: int ou float, nunca bool, finito e dentro da faixa (sem grampear)."""
    # a faixa antes do isfinite: um int de centenas de dígitos (o json aceita) faria o isfinite levantar OverflowError
    if type(x) not in (int, float) or not minimo <= x <= maximo or not math.isfinite(x):
        raise ValueError(msg)
    return x


def inteiro(x, minimo, maximo, msg):
    if type(x) is not int or not minimo <= x <= maximo:   # type(): o True não vale como 1
        raise ValueError(msg)
    return x


# ---------------------------------------------------------------- clima

def validar_clima(c):
    """{"cidade", "lat", "lon"} exatos, ou None (sem clima). As coordenadas ficam com 2 casas: cerca de 1 km."""
    if c is None:
        return None
    if not isinstance(c, dict) or set(c) != {"cidade", "lat", "lon"}:
        raise ValueError("Clima: envie cidade, latitude e longitude.")
    return {"cidade": texto(c["cidade"], 60, "Cidade: de 1 a 60 caracteres, numa linha só."),
            "lat": round(numero(c["lat"], -90, 90, "Latitude: um número de -90 a 90."), 2),
            "lon": round(numero(c["lon"], -180, 180, "Longitude: um número de -180 a 180."), 2)}


def validar_arquivo_clima(d):
    """O clima.json: {"v": 1, "clima": {...} ou null}. Devolve {"clima": ...}, para separar "sem clima" de ausente."""
    if not isinstance(d, dict) or set(d) != {"v", "clima"} or type(d["v"]) is not int or d["v"] != 1:
        raise ValueError("formato")
    return {"clima": validar_clima(d["clima"])}


def bytes_do_clima(clima):
    return json.dumps({"v": 1, "clima": clima}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------------- datas comemorativas

def festas_vazias(rev=0):
    return {"rev": rev, "proprias": [], "desligadas": []}


def _data(x, msg):
    """"MM-DD" (conferida num ano bissexto: o 29/02 vale) ou "AAAA-MM-DD" de 2000 a 2100, sempre uma data real."""
    if isinstance(x, str):
        m = DIA_DO_ANO.fullmatch(x) or DIA_UNICO.fullmatch(x)
        if m:
            ano, mes, dia = (2000, *m.groups()) if len(m.groups()) == 2 else m.groups()
            try:
                if 2000 <= int(ano) <= 2100:
                    datetime.date(int(ano), int(mes), int(dia))
                    return x
            except ValueError:
                pass
    raise ValueError(msg)


def _propria(n, i):
    pos = f"Data {i}"
    if not isinstance(n, dict) or not {"nome", "data", "tema"} <= set(n) <= CAMPOS_DATA:
        raise ValueError(f"{pos}: envie nome, data e tema.")
    falas = n.get("falas", [])
    if not isinstance(falas, list) or len(falas) > MAX_FALAS:
        raise ValueError(f"{pos}: até {MAX_FALAS} falas.")
    tema = n["tema"]
    if not isinstance(tema, str) or not TEMA_OK.fullmatch(tema):
        raise ValueError(f"{pos}: tema inválido.")
    return {"nome": texto(n["nome"], 40, f"{pos}: nome de 1 a 40 caracteres, numa linha só."),
            "data": _data(n["data"], f"{pos}: data inválida (MM-DD, ou AAAA-MM-DD de 2000 a 2100)."),
            "dias": inteiro(n.get("dias", 1), 1, MAX_DIAS, f"{pos}: de 1 a {MAX_DIAS} dias."),
            "tema": tema,
            "falas": [texto(f, 80, f"{pos}: cada fala com 1 a 80 caracteres, numa linha só.") for f in falas]}


def validar_festas(d, arquivo=False):
    """Tudo ou nada: o corpo do POST /api/festas ({rev, proprias, desligadas}) ou, com arquivo=True, o festas.json
    (com "v": 1). Devolve uma cópia nova, com os 5 campos de cada data própria; senão ValueError com o motivo e a
    posição, sem repetir o valor."""
    if not isinstance(d, dict) or set(d) != (CAMPOS_FESTAS | {"v"} if arquivo else CAMPOS_FESTAS):
        raise ValueError("Envie rev, proprias e desligadas.")
    if arquivo and (type(d["v"]) is not int or d["v"] != 1):
        raise ValueError("versão")
    proprias, desligadas = d["proprias"], d["desligadas"]
    if not isinstance(proprias, list) or len(proprias) > MAX_PROPRIAS:
        raise ValueError(f"Até {MAX_PROPRIAS} datas próprias.")
    if not isinstance(desligadas, list) or len(desligadas) > MAX_DESLIGADAS:
        raise ValueError(f"Até {MAX_DESLIGADAS} datas desligadas.")
    for chave in desligadas:
        if not isinstance(chave, str) or not CHAVE_OK.fullmatch(chave):
            raise ValueError("Data desligada com nome inválido.")
    if len(set(desligadas)) != len(desligadas):
        raise ValueError("Data desligada repetida.")
    return {"rev": inteiro(d["rev"], 0, REV_TETO, "Revisão inválida."),
            "proprias": [_propria(n, i) for i, n in enumerate(proprias, 1)], "desligadas": list(desligadas)}


def bytes_das_festas(f):
    return json.dumps({"v": 1, **f}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------------- times e aparência

def _time(t, i, vistos):
    """Um time da tela, com as regras do times.json, mas recusando em vez de descartar. vistos: handle -> time."""
    pos = f"Time {i}"
    if not isinstance(t, dict) or set(t) != CAMPOS_TIME:
        raise ValueError(f"{pos}: envie nome, tipo, cor, ícone, parede, piso e agentes, e nada mais.")
    if not isinstance(t["nome"], str) or not ROTULO_OK.fullmatch(t["nome"]):
        raise ValueError(f"{pos}: nome de 1 a 40 caracteres, só com letras, números, espaço e . ' & -")
    if t["tipo"] not in TIPOS:
        raise ValueError(f"{pos}: tipo inválido (mesas, ops ou gabinete).")
    if t["cor"] is not None and not (isinstance(t["cor"], str) and COR_OK.fullmatch(t["cor"])):
        raise ValueError(f"{pos}: cor no formato #rrggbb.")
    if t["icone"] is not None and not (isinstance(t["icone"], str) and t["icone"] in ICONES_OK):
        raise ValueError(f"{pos}: ícone inválido.")
    agentes = t["agentes"]
    if not isinstance(agentes, list) or len(agentes) > MAX_AGENTES_TIME:
        raise ValueError(f"{pos}: até {MAX_AGENTES_TIME} agentes.")
    for h in agentes:
        if not isinstance(h, str) or not HANDLE_OK.fullmatch(h):
            raise ValueError(f"{pos}: agente com @handle inválido.")
        if h in vistos:
            raise ValueError(f"{pos}: um agente já está em outro time (cada agente fica em um time só).")
        vistos[h] = i
    return {"nome": t["nome"], "tipo": t["tipo"], "cor": t["cor"], "icone": t["icone"],
            "parede": inteiro(t["parede"], 0, 5, f"{pos}: parede de 0 a 5."),
            "piso": inteiro(t["piso"], 0, 9, f"{pos}: piso de 0 a 9."), "agentes": list(agentes)}


def validar_equipe(d, arquivo=False):
    """Tudo ou nada: o corpo do POST /api/equipe ({rev, times, aparencia}) ou, com arquivo=True, o equipe.json (com
    "v": 1). Nome de time único (sem diferenciar maiúsculas), cada agente num time só e nenhum campo a mais (nem
    conversas, clima ou empresa, que ficam no servidor). Devolve uma cópia nova; senão ValueError com o motivo e a
    posição, sem repetir o valor."""
    campos = {"rev", "times", "aparencia"}
    if not isinstance(d, dict) or set(d) != (campos | {"v"} if arquivo else campos):
        raise ValueError("Envie rev, times e aparencia, e nada mais.")
    if arquivo and (type(d["v"]) is not int or d["v"] != 1):
        raise ValueError("versão")
    times, aparencia = d["times"], d["aparencia"]
    if not isinstance(times, list) or len(times) > MAX_TIMES:
        raise ValueError(f"Até {MAX_TIMES} times.")
    if not isinstance(aparencia, dict) or len(aparencia) > MAX_APARENCIA:
        raise ValueError(f"Aparência de até {MAX_APARENCIA} agentes.")
    vistos, limpos, nomes = {}, [], set()
    for i, t in enumerate(times, 1):
        limpo = _time(t, i, vistos)
        if limpo["nome"].casefold() in nomes:
            raise ValueError(f"Time {i}: já existe um time com esse nome.")
        nomes.add(limpo["nome"].casefold())
        limpos.append(limpo)
    visual = {}
    for i, (h, a) in enumerate(aparencia.items(), 1):
        if not HANDLE_OK.fullmatch(h):
            raise ValueError(f"Aparência {i}: @handle inválido.")
        if not isinstance(a, dict) or set(a) != {"color", "eyes", "accessory"} \
                or not all(isinstance(v, str) for v in a.values()) or a["color"] not in CORES or a["eyes"] not in OLHOS \
                or a["accessory"] not in ACESSORIOS:
            raise ValueError(f"Aparência {i}: cor, olhos e acessório da lista.")
        visual[h] = {"color": a["color"], "eyes": a["eyes"], "accessory": a["accessory"]}
    return {"rev": inteiro(d["rev"], 0, REV_TETO, "Revisão inválida."), "times": limpos, "aparencia": visual}


def bytes_da_equipe(e):
    return json.dumps({"v": 1, **e}, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


# ---------------------------------------------------------------- leitura

def ler(arquivo, teto, validar, log, evento):
    """O arquivo validado, ou None se não existe. Ilegível, grande demais ou fora do formato também vale None (falha
    aberta: volta o times.json ou o padrão), com 1 linha de log por motivo. Nunca derruba o serviço."""
    try:
        with open(arquivo, "rb") as f:
            bruto = f.read(teto + 1)
        if len(bruto) > teto:
            raise ValueError("grande demais")
        return validar(json_estrito(bruto))
    except FileNotFoundError:
        return None
    except Exception as x:   # OSError, UTF-8, JSON, RecursionError, formato
        if (arquivo, type(x).__name__) not in _AVISADOS:
            _AVISADOS.add((arquivo, type(x).__name__))
            log(evento=evento, resultado="arquivo_invalido", detalhe=type(x).__name__)
        return None
