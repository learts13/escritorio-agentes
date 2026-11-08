# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Assinatura VAPID (RFC 8292) para o push sem conteúdo: ES256 em Python puro, só biblioteca padrão.

- Curva P-256 em coordenadas afins, com escada de Montgomery sobre o escalar em 257 bits fixos (k + n ou k + 2n):
  a mesma sequência de operações para todo bit e o mesmo trabalho para qualquer tamanho de k. O s usa o inverso
  de Fermat (expoente fixo). O Python não garante tempo constante nos inteiros grandes: a chave fica só nesta
  máquina e o único tempo visível de fora é o do envio do push, com a rede no meio.
- Nonce determinístico pelo RFC 6979 (HMAC-SHA256): não depende do gerador aleatório na hora de assinar.
- Assinatura em r||s de 64 bytes (formato JWS). Nada de normalizar o s: os vetores do RFC batem exatamente.
- verificar() recusa chave pública fora da curva ou mal codificada e r ou s fora de [1, n-1].
- Chave em dados/vapid.json, 0600, gravada de forma atômica:  {"v": 1, "d": "<32 bytes em base64url>"}
  Ausente: gera uma nova. Ilegível ou fora do formato: ValueError, nunca uma chave nova por cima (trocar a chave
  obriga todo aparelho a assinar de novo). A chave privada nunca vai para mensagem de erro nem para o log.
"""
import base64
import hashlib
import hmac
import json
import re
import secrets
import functools
import time
import urllib.parse

from acesso import gravar

P = 2 ** 256 - 2 ** 224 + 2 ** 192 + 2 ** 96 - 1
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
     0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)
VALIDADE = 12 * 3600    # exp do JWT; o teto do RFC 8292 é 24 h
TETO_ARQUIVO = 1024
D_OK = re.compile(r"[A-Za-z0-9_-]{43}")


# ---------------------------------------------------------------- curva

def _soma(p1, p2):
    """Soma de pontos afins; None é o ponto no infinito."""
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    (x1, y1), (x2, y2) = p1, p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        lam = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        lam = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    return x3, (lam * (x1 - x3) - y1) % P


def _vezes(k, ponto):
    """k * ponto (0 <= k <= n) pela escada de Montgomery, com o escalar em 257 bits fixos (k + n ou k + 2n): a escada
    não começa no infinito e o trabalho não depende do tamanho de k. n * ponto é o infinito, então o resultado é o mesmo."""
    k += N
    if k.bit_length() <= 256:
        k += N
    r0, r1 = ponto, _soma(ponto, ponto)   # o bit 256, sempre 1
    for i in reversed(range(256)):
        if (k >> i) & 1:
            r0, r1 = _soma(r0, r1), _soma(r1, r1)
        else:
            r0, r1 = _soma(r0, r0), _soma(r0, r1)
    return r0


def _na_curva(x, y):
    return 0 <= x < P and 0 <= y < P and (y * y - (x * x * x + A * x + B)) % P == 0


def _confere_d(d):
    if type(d) is not int or not 1 <= d < N:
        raise ValueError("chave privada VAPID fora do intervalo [1, n-1]")


# ---------------------------------------------------------------- chave

def _b64(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")


def gerar_chave():
    """Chave privada nova: inteiro aleatório em [1, n-1]."""
    return secrets.randbelow(N - 1) + 1


def publica(d):
    """Chave pública não comprimida: 0x04 || X || Y, 65 bytes. Calculada uma vez por chave."""
    _confere_d(d)
    return _publica(d)


@functools.lru_cache(maxsize=4)
def _publica(d):
    x, y = _vezes(d, G)
    return b"\x04" + x.to_bytes(32, "big") + y.to_bytes(32, "big")


def publica_b64url(d):
    return _b64(publica(d))


# ---------------------------------------------------------------- ECDSA

def _nonces(d, h):
    """Candidatos a k pelo RFC 6979, seção 3.2, com HMAC-SHA256 (qlen = hlen = 256)."""
    x = d.to_bytes(32, "big")
    z = int.from_bytes(h, "big")
    h1 = (z - N if z >= N else z).to_bytes(32, "big")   # bits2octets
    v, k = b"\x01" * 32, b"\x00" * 32
    k = hmac.digest(k, v + b"\x00" + x + h1, "sha256")
    v = hmac.digest(k, v, "sha256")
    k = hmac.digest(k, v + b"\x01" + x + h1, "sha256")
    v = hmac.digest(k, v, "sha256")
    while True:
        v = hmac.digest(k, v, "sha256")
        candidato = int.from_bytes(v, "big")
        if 1 <= candidato < N:
            yield candidato
        k = hmac.digest(k, v + b"\x00", "sha256")
        v = hmac.digest(k, v, "sha256")


def assinar(d, msg):
    """Assinatura ES256 de msg (bytes): r || s, 64 bytes."""
    _confere_d(d)
    if not isinstance(msg, (bytes, bytearray)):
        raise TypeError("msg precisa ser bytes")
    h = hashlib.sha256(msg).digest()
    e = int.from_bytes(h, "big")
    for k in _nonces(d, h):
        r = _vezes(k, G)[0] % N
        s = pow(k, N - 2, N) * (e + r * d) % N   # inverso de Fermat: expoente fixo
        if r and s:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def verificar(pub65, msg, sig64):
    """True só se sig64 (r || s) for uma assinatura ES256 válida de msg pela chave pub65 (0x04 || X || Y)."""
    if not all(isinstance(b, (bytes, bytearray)) for b in (pub65, msg, sig64)):
        return False
    if len(pub65) != 65 or pub65[0] != 4 or len(sig64) != 64:
        return False
    x, y = int.from_bytes(pub65[1:33], "big"), int.from_bytes(pub65[33:], "big")
    r, s = int.from_bytes(sig64[:32], "big"), int.from_bytes(sig64[32:], "big")
    if not _na_curva(x, y) or not (1 <= r < N and 1 <= s < N):   # cofator 1: na curva é estar no grupo
        return False
    e = int.from_bytes(hashlib.sha256(msg).digest(), "big")
    w = pow(s, -1, N)
    ponto = _soma(_vezes(e * w % N, G), _vezes(r * w % N, (x, y)))
    return ponto is not None and ponto[0] % N == r


# ---------------------------------------------------------------- VAPID

def jwt(d, aud, sub, exp):
    """JWT ES256 compacto com aud, exp e sub."""
    cab = _b64(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode("ascii"))
    corpo = _b64(json.dumps({"aud": aud, "exp": exp, "sub": sub}, separators=(",", ":")).encode("utf-8"))
    entrada = f"{cab}.{corpo}"
    return f"{entrada}.{_b64(assinar(d, entrada.encode('ascii')))}"


def cabecalho(d, endpoint, sub, agora=None):
    """Valor do cabeçalho Authorization: "vapid t=<jwt>, k=<chave pública em base64url>".
    aud = https://host[:porta] do endpoint; exp = agora + 12 h."""
    partes = urllib.parse.urlsplit(endpoint)
    if partes.scheme != "https" or not partes.hostname:
        raise ValueError("endpoint de push precisa ser https com host")
    aud = f"https://{partes.hostname}" + (f":{partes.port}" if partes.port not in (None, 443) else "")   # a origem omite a 443
    if not sub.startswith(("mailto:", "https://")):
        raise ValueError("sub do VAPID precisa ser mailto: ou https://")
    exp = int(time.time() if agora is None else agora) + VALIDADE
    return f"vapid t={jwt(d, aud, sub, exp)}, k={publica_b64url(d)}"


def carregar_ou_criar(caminho):
    """Chave privada do arquivo; ausente, gera e grava uma nova (0600, atômica). Ilegível ou fora do formato
    levanta ValueError, com o caminho e o motivo, nunca com o conteúdo. Outro OSError (permissão) passa adiante."""
    try:
        with open(caminho, "rb") as f:
            bruto = f.read(TETO_ARQUIVO + 1)
    except FileNotFoundError:
        d = gerar_chave()
        gravar(caminho, json.dumps({"v": 1, "d": _b64(d.to_bytes(32, "big"))}).encode("ascii"))
        return d
    try:
        if len(bruto) > TETO_ARQUIVO:
            raise ValueError("grande demais")
        dados = json.loads(bruto.decode("utf-8"))
        if not isinstance(dados, dict) or set(dados) != {"v", "d"} or dados["v"] != 1 or type(dados["v"]) is not int:
            raise ValueError("fora do formato")
        texto = dados["d"]
        if not isinstance(texto, str) or not D_OK.fullmatch(texto):
            raise ValueError("chave mal codificada")
        cru = base64.urlsafe_b64decode(texto + "=")
        if _b64(cru) != texto:
            raise ValueError("chave mal codificada")
        d = int.from_bytes(cru, "big")
        if not 1 <= d < N:
            raise ValueError("chave fora do intervalo")
    except (ValueError, RecursionError) as x:   # UTF-8, JSON e formato
        motivo = str(x) if type(x) is ValueError else type(x).__name__
        raise ValueError(f"{caminho} não pode ser lido ({motivo}): restaure o backup; para trocar de chave, apague o "
                         "arquivo (todo aparelho terá de ativar os avisos de novo)") from None
    return d
