"""Andares do prédio: cada workspace (organização) do agentes.chat é um andar, com a sua conexão e os seus times.

O andar principal é implícito: id "principal", org = AGENTES_ORG, e os arquivos continuam onde sempre estiveram
(dados/oauth.json, times.json, dados/equipe.json...). Sem dados/andares.json, nada muda.

Os andares extras ficam em dados/andares.json ({"v": 1, "andares": [{"id", "nome", "org"}]}) e os dados de cada um
em dados/andares/<id>/. A pasta sai só do id (8 hex sorteados aqui), nunca do nome nem da org.
Este módulo não faz rede nem sobe threads: só lê, valida e grava a lista (gravação atômica, 0600)."""
import json
import os
import re
import secrets
import threading

from acesso import gravar
from ajustes import ROTULO_OK

PRINCIPAL = "principal"
ARQ = "andares.json"   # dentro da pasta de dados
MAX_EXTRAS = 6
BYTES_MAX = 8 * 1024
ID_OK = re.compile(r"[0-9a-f]{8}")
ORG_OK = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")   # o mesmo do AGENTES_ORG
NOME_MAX = 40
# os arquivos de cada andar extra, dentro de dados/andares/<id>/
OAUTH, TIMES, EQUIPE, PLANTA, PLACAR, JORNAL = ("oauth.json", "times.json", "equipe.json", "planta.json",
                                                "placar.json", "jornal.json")


class AndaresIlegiveis(ValueError):
    """dados/andares.json existe mas não dá para ler: o serviço não sobe (um andar não some calado)."""


def validar_nome(nome):
    nome = nome.strip() if isinstance(nome, str) else ""
    if not ROTULO_OK.fullmatch(nome) or len(nome) > NOME_MAX:
        raise ValueError(f"Nome do andar: de 1 a {NOME_MAX} letras, números, espaço, ponto, hífen ou &.")
    return nome


def validar_org(org):
    org = org.strip().lower() if isinstance(org, str) else ""
    if not ORG_OK.fullmatch(org):
        raise ValueError("Workspace: cole o id que vem depois de /org/ no endereço do agentes.chat.")
    return org


def _validar(bruto, org_principal):
    if not isinstance(bruto, dict) or bruto.get("v") != 1 or not isinstance(bruto.get("andares"), list) \
            or len(bruto["andares"]) > MAX_EXTRAS:
        raise ValueError("formato")
    lista, ids, orgs = [], set(), {org_principal}
    for a in bruto["andares"]:
        if not isinstance(a, dict) or set(a) != {"id", "nome", "org"} or not isinstance(a["id"], str) \
                or not ID_OK.fullmatch(a["id"]) or a["id"] in ids:
            raise ValueError("andar")
        org = validar_org(a["org"])
        if org in orgs:
            raise ValueError("org repetida")
        ids.add(a["id"])
        orgs.add(org)
        lista.append({"id": a["id"], "nome": validar_nome(a["nome"]), "org": org})
    return lista


def pasta(dados, id_andar):
    """A pasta de dados de um andar extra. O id já passou pelo ID_OK: aqui só confere de novo, sem confiar."""
    if not isinstance(id_andar, str) or not ID_OK.fullmatch(id_andar):
        raise ValueError("id de andar inválido")
    return os.path.join(dados, "andares", id_andar)


class Andares:
    """A lista de andares extras (sem o principal). self.lista é trocada inteira a cada mudança, nunca mexida no lugar."""

    def __init__(self, dados, org_principal):
        self.dados, self.org_principal = dados, org_principal
        self.arquivo = os.path.join(dados, ARQ)
        self.trava = threading.Lock()
        self.lista = self._ler()

    def _ler(self):
        try:
            with open(self.arquivo, "rb") as f:
                bruto = f.read(BYTES_MAX + 1)
        except FileNotFoundError:
            return []
        except OSError as x:
            raise AndaresIlegiveis(f"não consegui ler {self.arquivo} ({type(x).__name__})") from x
        try:
            if len(bruto) > BYTES_MAX:
                raise ValueError("grande demais")
            return _validar(json.loads(bruto), self.org_principal)
        except (ValueError, RecursionError) as x:
            raise AndaresIlegiveis(f"{self.arquivo} está fora do formato; corrija ou apague o arquivo") from x

    def _gravar(self, lista):
        gravar(self.arquivo, json.dumps({"v": 1, "andares": lista}, ensure_ascii=False).encode("utf-8"))
        self.lista = lista

    def achar(self, id_andar):
        return next((a for a in self.lista if a["id"] == id_andar), None)

    def criar(self, nome, org):
        """Devolve o andar novo ({"id", "nome", "org"}). ValueError com a mensagem para a tela; OSError do disco sobe."""
        nome, org = validar_nome(nome), validar_org(org)
        with self.trava:
            if len(self.lista) >= MAX_EXTRAS:
                raise ValueError(f"O prédio já tem {MAX_EXTRAS} andares extras.")
            if org == self.org_principal or any(a["org"] == org for a in self.lista):
                raise ValueError("Esse workspace já é um andar do prédio.")
            ids = {a["id"] for a in self.lista}
            id_andar = secrets.token_hex(4)
            while id_andar in ids:
                id_andar = secrets.token_hex(4)
            novo = {"id": id_andar, "nome": nome, "org": org}
            os.makedirs(pasta(self.dados, id_andar), mode=0o700, exist_ok=True)
            self._gravar([*self.lista, novo])
        return novo

    def renomear(self, id_andar, nome):
        nome = validar_nome(nome)
        with self.trava:
            if not self.achar(id_andar):
                raise KeyError(id_andar)
            self._gravar([{**a, "nome": nome} if a["id"] == id_andar else a for a in self.lista])

    def remover(self, id_andar):
        """Tira o andar da lista. A pasta de dados fica (o README diz como apagar)."""
        with self.trava:
            if not self.achar(id_andar):
                raise KeyError(id_andar)
            self._gravar([a for a in self.lista if a["id"] != id_andar])
