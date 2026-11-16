# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""O que um anexo da equipe pode ser (E.5), só stdlib, sem rede e sem log: o escritorio.py grava o corpo num temporário
e chama validar(caminho, nome) antes de confirmar o envio.

- O tipo sai dos bytes mágicos, nunca do nome nem do cliente: PNG, JPEG, WEBP, GIF, PDF e ZIP (com o OOXML dentro dele).
  TXT e CSV não têm assinatura: valem só com a extensão .txt/.csv, em UTF-8, sem NUL e sem cara de marcação. SVG, HTML,
  XML, executável e o resto ficam de fora, com qualquer nome.
- Imagem: sai sem metadado (EXIF, GPS, XMP, IPTC, texto e comentário) e sem nada depois do fim (o poliglota JPEG+ZIP
  vira só o JPEG). O arquivo é reescrito no lugar.
- ZIP: validado só pelos metadados e NUNCA extraído. O fim do diretório central é lido à mão (struct) antes do zipfile,
  com tetos de entradas e de tamanho; o diretório tem que bater com o começo e com o fim do arquivo (sem prefixo de
  autoextraível nem cauda). Do conteúdo, só o [Content_Types].xml do OOXML é descomprimido, com teto de 64 KB.
- O nome que fica ganha a extensão do tipo de verdade quando a do cliente não bate ("x.html" que é PNG vira
  "x.html.png"): baixado, o arquivo não abre como outra coisa.
"""
import codecs
import mmap
import os
import re
import struct
import unicodedata
import urllib.parse
import zipfile

NOME_MAX = 120
BLOCO = 64 * 1024
ZIP_ENTRADAS_MAX = 1000
ZIP_CENTRAL_MAX = 1024 * 1024
ZIP_DESCOMPACTADO_MAX = 1024 ** 3
ZIP_RAZAO_MAX = 100
CONTENT_TYPES, CONTENT_TYPES_MAX = "[Content_Types].xml", 64 * 1024
TIPOS_OOXML = {"docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
               "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
               "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"}
# o tipo -> as extensões que ele aceita no nome (a primeira é a que se acrescenta)
EXTENSOES = {"image/png": ("png",), "image/jpeg": ("jpg", "jpeg", "jpe"), "image/webp": ("webp",),
             "image/gif": ("gif",), "application/pdf": ("pdf",), "text/plain": ("txt",), "text/csv": ("csv",),
             "application/zip": ("zip",), **{t: (ext,) for ext, t in TIPOS_OOXML.items()}}
IMAGENS = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif"})
# dentro do ZIP: pacote dentro de pacote (a bomba recursiva), executáveis, scripts e páginas
PROIBIDAS_DENTRO = frozenset("zip rar 7z gz tgz tar iso img cab jar apk exe dll scr com bat cmd ps1 vbs js jse wsf hta "
                             "msi msix lnk url reg sh appimage dmg pkg svg html htm".split())
MARCACAO = re.compile(rb"<\s*(?:!doctype|html|head|body|script|svg|\?xml|iframe|object|embed|meta|style|math)", re.I)


class Recusado(ValueError):
    """O arquivo não é de um tipo aceito, ou o pacote não passa nos tetos. A mensagem é para a tela."""


def _visivel(s):
    return all(unicodedata.category(c) not in ("Cc", "Cf", "Cs", "Co", "Cn") for c in s)


def nome_do_cabecalho(valor):
    """O X-Nome do envio: UTF-8 em percent-encoding (encodeURIComponent), de 1 a 120 caracteres, sem / \\ :, sem
    controle nem bidi, e nunca "." ou ".."."""
    try:
        if not isinstance(valor, str) or re.search(r"%(?![0-9A-Fa-f]{2})", valor):
            raise ValueError
        nome = urllib.parse.unquote_to_bytes(valor).decode("utf-8")
    except (ValueError, UnicodeDecodeError):
        raise Recusado("Nome de arquivo inválido.") from None
    if not 1 <= len(nome) <= NOME_MAX or nome in (".", "..") or any(c in nome for c in "/\\:") or not _visivel(nome):
        raise Recusado("Nome de arquivo inválido.")
    return nome


def nome_final(nome, tipo):
    """O nome com a extensão do tipo de verdade no fim (comparada sem caixa)."""
    ext = nome.rsplit(".", 1)[1].lower() if "." in nome else ""
    if ext in EXTENSOES[tipo]:
        return nome
    novo = f"{nome}.{EXTENSOES[tipo][0]}"
    return novo if len(novo) <= NOME_MAX else f"{nome[:NOME_MAX - len(EXTENSOES[tipo][0]) - 1]}.{EXTENSOES[tipo][0]}"


# ---------------------------------------------------------------- imagens: sem metadado e sem cauda
# O laço é Python puro: sem teto, 25 MB de segmentos vazios (ou de sub-blocos de 1 byte no GIF) custam segundos de CPU.
# Os tetos ficam longe do arquivo de verdade (o libpng grava IDAT de 8 KB: 25 MB dão ~3200 chunks), o fim do scan do
# JPEG sai de um regex sobre o mmap e a saída vai direto para o .limpo, por memoryview, sem juntar o arquivo numa lista.
SEGMENTOS_MAX = 8192          # segmentos do JPEG, chunks do PNG e do WEBP, blocos do GIF
JPEG_SCANS_MAX = 1024         # o progressivo do libjpeg usa ~10
GIF_SUBBLOCOS_MAX = 1 << 18   # 25 MB em sub-blocos de 255 bytes dão ~100 mil
_ENCHIMENTO = re.compile(rb"\xff+")
_FIM_DO_SCAN = re.compile(rb"\xff[^\x00\xd0-\xd7]")   # FF00 e RSTn são dados do scan


def _contar(contagem, chave, teto):
    contagem[chave] = contagem.get(chave, 0) + 1
    if contagem[chave] > teto:
        raise Recusado("Imagem com partes demais.")


def _jpeg(m, v, f):
    """Os segmentos que ficam: APP0 (JFIF), APP2 do perfil de cor, APP14 da Adobe e os que desenham. Sai o resto dos
    APPn (EXIF e XMP no APP1, IPTC no APP13) e os comentários, e tudo depois do EOI. RST e TEM só valem dentro do scan."""
    n, pos, contagem = len(m), 2, {}
    f.write(b"\xff\xd8")
    while True:
        _contar(contagem, "segmentos", SEGMENTOS_MAX)
        if pos + 2 > n or m[pos] != 0xFF:
            raise Recusado("Imagem JPEG quebrada.")
        pos = _ENCHIMENTO.match(m, pos).end() - 1   # bytes de enchimento entre marcadores
        if pos + 1 >= n:
            raise Recusado("Imagem JPEG quebrada.")
        marcador = m[pos + 1]
        if marcador == 0xD9:
            f.write(b"\xff\xd9")
            return
        if marcador == 0x01 or 0xD0 <= marcador <= 0xD7 or pos + 4 > n:
            raise Recusado("Imagem JPEG quebrada.")
        tamanho = struct.unpack(">H", m[pos + 2:pos + 4])[0]
        fim = pos + 2 + tamanho
        if tamanho < 2 or fim > n:
            raise Recusado("Imagem JPEG quebrada.")
        inicio = m[pos + 4:min(fim, pos + 16)]
        if not (0xE1 <= marcador <= 0xEF or marcador == 0xFE) or \
                (marcador == 0xE2 and inicio.startswith(b"ICC_PROFILE\x00")) or \
                (marcador == 0xEE and inicio.startswith(b"Adobe")):
            f.write(v[pos:fim])
        pos = fim
        if marcador == 0xDA:   # os dados da imagem vão até o próximo marcador de verdade
            _contar(contagem, "scans", JPEG_SCANS_MAX)
            achado = _FIM_DO_SCAN.search(m, pos)
            if not achado:
                raise Recusado("Imagem JPEG quebrada.")
            f.write(v[pos:achado.start()])
            pos = achado.start()


def _png(m, v, f):
    """Os chunks até o IEND, sem os de texto e de EXIF; nada depois do IEND."""
    n, pos, contagem = len(m), 8, {}
    f.write(v[:8])
    while pos + 12 <= n:
        _contar(contagem, "chunks", SEGMENTOS_MAX)
        tamanho, tipo = struct.unpack(">I4s", m[pos:pos + 8])
        fim = pos + 12 + tamanho
        if fim > n or (pos == 8 and tipo != b"IHDR"):
            break
        if tipo not in (b"eXIf", b"tEXt", b"iTXt", b"zTXt"):
            f.write(v[pos:fim])
        if tipo == b"IEND":
            return
        pos = fim
    raise Recusado("Imagem PNG quebrada.")


def _webp(m, v, f):
    """Os chunks do RIFF sem EXIF e XMP (e os bits deles no VP8X apagados); nada além do tamanho do RIFF. O tamanho
    novo do RIFF vai no fim, por cima do provisório."""
    n = len(m)
    fim = 8 + struct.unpack("<I", m[4:8])[0]
    if fim > n or fim < 20:
        raise Recusado("Imagem WEBP quebrada.")
    pos, contagem = 12, {}
    f.write(b"RIFF\x00\x00\x00\x00WEBP")
    while pos + 8 <= fim:
        _contar(contagem, "chunks", SEGMENTOS_MAX)
        tipo, tamanho = struct.unpack("<4sI", m[pos:pos + 8])
        prox = pos + 8 + tamanho + (tamanho & 1)
        if pos + 8 + tamanho > fim:
            raise Recusado("Imagem WEBP quebrada.")
        if pos == 12 and tipo not in (b"VP8 ", b"VP8L", b"VP8X"):
            raise Recusado("Imagem WEBP quebrada.")
        if tipo == b"VP8X" and tamanho >= 1:
            f.write(v[pos:pos + 8])
            f.write(bytes([m[pos + 8] & ~0x0C & 0xFF]))
            f.write(v[pos + 9:min(prox, fim)])
        elif tipo not in (b"EXIF", b"XMP "):
            f.write(v[pos:min(prox, fim)])
        pos = prox
    if pos == 12:
        raise Recusado("Imagem WEBP quebrada.")
    total = f.tell()
    f.seek(4)
    f.write(struct.pack("<I", total - 8))


def _gif(m, v, f):
    """Os blocos até o trailer, sem comentários e sem extensões de aplicativo (fica só a do laço da animação)."""
    n, contagem = len(m), {}

    def sub_blocos(i):
        while True:
            _contar(contagem, "sub-blocos", GIF_SUBBLOCOS_MAX)
            if i >= n:
                raise Recusado("Imagem GIF quebrada.")
            if m[i] == 0:
                return i + 1
            i += 1 + m[i]

    if n < 13:
        raise Recusado("Imagem GIF quebrada.")
    pos = 13 + (3 * 2 ** ((m[10] & 7) + 1) if m[10] & 0x80 else 0)
    f.write(v[:pos])
    while pos < n:
        _contar(contagem, "blocos", SEGMENTOS_MAX)
        b = m[pos]
        if b == 0x3B:
            f.write(b"\x3b")
            return
        if b == 0x2C:
            if pos + 10 > n:
                break
            fim = pos + 10 + (3 * 2 ** ((m[pos + 9] & 7) + 1) if m[pos + 9] & 0x80 else 0)
            fim = sub_blocos(fim + 1)   # o byte do tamanho mínimo do LZW e os dados
            f.write(v[pos:fim])
        elif b == 0x21 and pos + 2 < n:
            rotulo, fim = m[pos + 1], sub_blocos(pos + 2)
            app = m[pos + 3:pos + 14] if rotulo == 0xFF else b""
            if rotulo != 0xFE and (rotulo != 0xFF or app in (b"NETSCAPE2.0", b"ANIMEXTS1.0")):
                f.write(v[pos:fim])
        else:
            break
        pos = fim
    raise Recusado("Imagem GIF quebrada.")


def _limpar_imagem(caminho, limpar):
    """Reescreve a imagem limpa no lugar: grava no .limpo enquanto lê e só troca se a limpeza chegou ao fim."""
    temporario = caminho + ".limpo"
    try:
        with open(caminho, "rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as m, \
                open(temporario, "wb") as saida:
            v = memoryview(m)
            try:
                limpar(m, v, saida)
            except (struct.error, IndexError):
                raise Recusado("Imagem quebrada.") from None
            finally:
                v.release()
        os.replace(temporario, caminho)
    finally:
        if os.path.exists(temporario):
            os.remove(temporario)


# ---------------------------------------------------------------- ZIP: só metadados

def _nome_ruim(nome):
    partes = nome.split("/")
    return (not nome or len(nome) > 255 or nome.startswith("/") or "\\" in nome or ":" in nome or ".." in partes
            or not _visivel(nome))


def _fim_do_central(caminho, tamanho):
    """(entradas, tamanho do diretório, onde ele começa, onde ele termina), lidos à mão do EOCD (e do Zip64), sem o
    zipfile. Recusa vários discos, comentário que não fecha o arquivo e o Zip64 inconsistente."""
    if tamanho < 22:
        raise Recusado("ZIP quebrado.")
    with open(caminho, "rb") as f:
        inicio_cauda = max(0, tamanho - (65535 + 22))
        f.seek(inicio_cauda)
        cauda = f.read()
        i = cauda.rfind(b"PK\x05\x06")
        if i < 0 or i + 22 > len(cauda):
            raise Recusado("ZIP quebrado.")
        disco, disco_central, no_disco, total, tam_central, inicio, comentario = struct.unpack("<HHHHIIH", cauda[i + 4:i + 22])
        if i + 22 + comentario != len(cauda):   # sobra algo depois do fim: cauda grudada
            raise Recusado("ZIP com dados depois do fim.")
        pos_eocd = inicio_cauda + i
        fim_central = pos_eocd
        if 0xFFFF in (disco, disco_central, no_disco, total) or 0xFFFFFFFF in (tam_central, inicio):
            if pos_eocd < 20:
                raise Recusado("ZIP quebrado.")
            f.seek(pos_eocd - 20)
            loc = f.read(20)
            if loc[:4] != b"PK\x06\x07":
                raise Recusado("ZIP quebrado.")
            pos64 = struct.unpack("<Q", loc[8:16])[0]
            f.seek(pos64)
            reg = f.read(56)
            if len(reg) != 56 or reg[:4] != b"PK\x06\x06" or pos64 + 56 > pos_eocd - 20:
                raise Recusado("ZIP quebrado.")
            disco, disco_central, no_disco, total, tam_central, inicio = struct.unpack("<IIQQQQ", reg[16:56])
            fim_central = pos64
    if disco or disco_central or no_disco != total:
        raise Recusado("ZIP em vários volumes não é aceito.")
    return total, tam_central, inicio, fim_central


def _zip(caminho, tamanho):
    """O tipo (application/zip ou um OOXML), ou Recusado. Nunca extrai; descomprime só o [Content_Types].xml."""
    total, tam_central, inicio, fim_central = _fim_do_central(caminho, tamanho)
    if total > ZIP_ENTRADAS_MAX:
        raise Recusado(f"O ZIP passa de {ZIP_ENTRADAS_MAX} arquivos.")
    if tam_central > ZIP_CENTRAL_MAX:
        raise Recusado("O índice do ZIP é grande demais.")
    if inicio + tam_central != fim_central:   # o diretório não bate com o arquivo: prefixo (autoextraível) ou lixo
        raise Recusado("ZIP com dados antes do começo.")
    try:
        with zipfile.ZipFile(caminho) as z:
            infos = z.infolist()
            if len(infos) != total:
                raise Recusado("ZIP quebrado.")
            vistos, descompactado, compactado, ooxml = set(), 0, 0, None
            for info in infos:
                nome = info.orig_filename
                if info.flag_bits & 1:
                    raise Recusado("ZIP com senha não é aceito: ninguém consegue ver o que tem dentro.")
                if _nome_ruim(nome):
                    raise Recusado("O ZIP tem um nome de arquivo perigoso.")
                chave = unicodedata.normalize("NFC", nome).casefold()
                if chave in vistos:
                    raise Recusado("O ZIP tem nomes repetidos.")
                vistos.add(chave)
                base = nome.rstrip("/").rsplit("/", 1)[-1].lower()
                if not nome.endswith("/") and set(base.split(".")[1:][-2:]) & PROIBIDAS_DENTRO:
                    raise Recusado("O ZIP tem um executável, um script, uma página ou outro pacote dentro.")
                if base == "vbaproject.bin":
                    raise Recusado("Documento com macro não é aceito.")
                descompactado += info.file_size
                compactado += info.compress_size
                if nome == CONTENT_TYPES:
                    ooxml = info
            if descompactado > ZIP_DESCOMPACTADO_MAX or (descompactado and (
                    not compactado or descompactado / compactado > ZIP_RAZAO_MAX)):
                raise Recusado("O ZIP descompacta para um tamanho perigoso.")
            if ooxml is None:
                return "application/zip"
            if ooxml.file_size > CONTENT_TYPES_MAX:
                raise Recusado("Documento quebrado.")
            with z.open(ooxml) as f:
                tipos = f.read(CONTENT_TYPES_MAX + 1)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, NotImplementedError, RuntimeError, EOFError, OSError,
            ValueError) as x:
        if isinstance(x, Recusado):
            raise
        raise Recusado("ZIP quebrado.") from None
    if len(tipos) > CONTENT_TYPES_MAX:
        raise Recusado("Documento quebrado.")
    tipos = tipos.decode("utf-8", "replace").lower()
    if "macroenabled" in tipos:
        raise Recusado("Documento com macro não é aceito.")
    for ext, marca in (("docx", "wordprocessingml"), ("xlsx", "spreadsheetml"), ("pptx", "presentationml")):
        if marca in tipos:
            return TIPOS_OOXML[ext]
    return "application/zip"


# ---------------------------------------------------------------- texto

def _texto(caminho, ext):
    """TXT/CSV: UTF-8 de verdade, sem NUL e sem cara de página (o navegador não pode tratar como HTML)."""
    decodificador = codecs.getincrementaldecoder("utf-8")("strict")
    with open(caminho, "rb") as f:
        primeiro = True
        while True:
            bloco = f.read(BLOCO)
            if primeiro:
                cabeca = bloco[3:] if bloco.startswith(codecs.BOM_UTF8) else bloco
                if cabeca.lstrip()[:1] == b"<" or MARCACAO.search(cabeca[:4096]):
                    raise Recusado("Página, SVG ou XML não são aceitos, nem renomeados.")
                primeiro = False
            if b"\x00" in bloco:
                raise Recusado("Esse arquivo não é texto.")
            try:
                decodificador.decode(bloco, final=not bloco)
            except UnicodeDecodeError:
                raise Recusado("O texto precisa estar em UTF-8.") from None
            if not bloco:
                return "text/csv" if ext == "csv" else "text/plain"


def validar(caminho, nome):
    """(tipo, nome que fica) do anexo já gravado em caminho, ou Recusado. Imagem é reescrita no lugar."""
    tamanho = os.path.getsize(caminho)
    with open(caminho, "rb") as f:
        cabeca = f.read(16)
    ext = nome.rsplit(".", 1)[1].lower() if "." in nome else ""
    if cabeca.startswith(b"\x89PNG\r\n\x1a\n"):
        tipo, limpar = "image/png", _png
    elif cabeca.startswith(b"\xff\xd8\xff"):
        tipo, limpar = "image/jpeg", _jpeg
    elif cabeca[:4] == b"RIFF" and cabeca[8:12] == b"WEBP":
        tipo, limpar = "image/webp", _webp
    elif cabeca[:6] in (b"GIF87a", b"GIF89a"):
        tipo, limpar = "image/gif", _gif
    elif cabeca.startswith(b"%PDF-"):
        tipo, limpar = "application/pdf", None
    elif cabeca.startswith(b"PK\x03\x04"):
        tipo, limpar = _zip(caminho, tamanho), None
    elif ext in ("txt", "csv"):
        tipo, limpar = _texto(caminho, ext), None
    else:
        raise Recusado("Tipo de arquivo não aceito. Vale imagem (PNG, JPEG, WEBP, GIF), PDF, TXT, CSV, DOCX, XLSX, "
                       "PPTX ou ZIP.")
    if limpar:
        _limpar_imagem(caminho, limpar)
    return tipo, nome_final(nome, tipo)
