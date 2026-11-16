import io
import os
import shutil
import struct
import tempfile
import time
import tracemalloc
import unittest
import zipfile
import zlib
from unittest import mock

import anexos


def _arquivo(dados):
    pasta = tempfile.mkdtemp(prefix="anexos-")
    caminho = os.path.join(pasta, "a")
    with open(caminho, "wb") as f:
        f.write(dados)
    return pasta, caminho


def _ler(caminho):
    with open(caminho, "rb") as f:
        return f.read()


GPS = b"GPSLatitude-23.5505GPSLongitude-46.6333"


def jpeg(cauda=b""):
    exif = b"Exif\x00\x00MM\x00*" + GPS
    xmp = b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta>" + GPS + b"</x:xmpmeta>"
    seg = lambda m, d: b"\xff" + bytes([m]) + struct.pack(">H", len(d) + 2) + d
    return (b"\xff\xd8" + seg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00") + seg(0xE1, exif) + seg(0xE1, xmp)
            + seg(0xED, b"Photoshop 3.0\x00" + GPS) + seg(0xFE, b"comentario " + GPS)
            + seg(0xE2, b"ICC_PROFILE\x00\x01\x01perfil") + seg(0xDB, b"\x00" + bytes(64))
            + seg(0xC0, b"\x08\x00\x01\x00\x01\x01\x01\x11\x00") + seg(0xC4, b"\x00" + bytes(16) + b"\x00")
            + seg(0xDA, b"\x01\x01\x00\x00\x3f\x00") + b"\x12\xff\x00\x34\xff\xd0\x56" + b"\xff\xd9" + cauda)


def _chunk(tipo, dados):
    return struct.pack(">I", len(dados)) + tipo + dados + struct.pack(">I", zlib.crc32(tipo + dados))


def png(cauda=b""):
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 0, 0, 0, 0))
            + _chunk(b"eXIf", b"MM\x00*" + GPS) + _chunk(b"tEXt", b"Comment\x00" + GPS)
            + _chunk(b"iTXt", b"XML:com.adobe.xmp\x00\x00\x00\x00\x00" + GPS) + _chunk(b"zTXt", b"c\x00\x00x")
            + _chunk(b"IDAT", zlib.compress(b"\x00\x00")) + _chunk(b"IEND", b"") + cauda)


def _riff(tipo, dados):
    return tipo + struct.pack("<I", len(dados)) + dados + (b"\x00" if len(dados) % 2 else b"")


def webp(cauda=b""):
    corpo = (b"WEBP" + _riff(b"VP8X", bytes([0x0C]) + bytes(9)) + _riff(b"VP8 ", b"\x00" * 11)
             + _riff(b"EXIF", b"MM\x00*" + GPS) + _riff(b"XMP ", b"<x>" + GPS + b"</x>"))
    return b"RIFF" + struct.pack("<I", len(corpo)) + corpo + cauda


def gif(cauda=b""):
    ext = lambda rot, d: b"\x21\xff\x0b" + rot + bytes([len(d)]) + d + b"\x00"
    return (b"GIF89a" + struct.pack("<HH", 1, 1) + b"\x80\x00\x00" + b"\x00\x00\x00\xff\xff\xff"
            + ext(b"NETSCAPE2.0", b"\x01\x00\x00") + ext(b"XMP DataXMP", GPS) + b"\x21\xfe" + bytes([len(GPS)]) + GPS
            + b"\x00" + b"\x2c" + struct.pack("<HHHH", 0, 0, 1, 1) + b"\x00" + b"\x02\x02\x44\x01\x00" + b"\x3b" + cauda)


def zip_de(entradas, **kw):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, **kw) as z:
        for nome, dados in entradas:
            z.writestr(nome, dados)
    return buf.getvalue()


def ooxml(tipo="wordprocessingml.document.main", extra=()):
    ct = (f'<?xml version="1.0"?><Types><Override PartName="/word/document.xml" ContentType="application/'
          f'vnd.openxmlformats-officedocument.{tipo}+xml"/></Types>').encode()
    return zip_de([("[Content_Types].xml", ct), ("word/document.xml", b"<w:document/>"), *extra])


class Base(unittest.TestCase):
    def validar(self, dados, nome="arquivo"):
        pasta, caminho = _arquivo(dados)
        self.addCleanup(shutil.rmtree, pasta, ignore_errors=True)
        tipo, final = anexos.validar(caminho, nome)
        return tipo, final, _ler(caminho)

    def recusa(self, dados, nome="arquivo"):
        pasta, caminho = _arquivo(dados)
        self.addCleanup(shutil.rmtree, pasta, ignore_errors=True)
        with self.assertRaises(anexos.Recusado):
            anexos.validar(caminho, nome)


class Imagens(Base):
    def test_jpeg_sem_exif_gps_xmp_iptc_nem_comentario_e_sem_cauda(self):
        poliglota = zip_de([("x.txt", b"escondido")])
        tipo, nome, saida = self.validar(jpeg(cauda=poliglota), "foto.jpg")
        self.assertEqual((tipo, nome), ("image/jpeg", "foto.jpg"))
        self.assertNotIn(b"GPS", saida)
        self.assertNotIn(b"Exif", saida)
        self.assertNotIn(b"PK", saida)   # o poliglota JPEG+ZIP sai sem o ZIP
        self.assertTrue(saida.endswith(b"\xff\xd9"))
        self.assertIn(b"ICC_PROFILE", saida)   # a cor fica
        self.assertIn(b"JFIF", saida)

    def test_png_sem_texto_nem_exif_e_sem_cauda(self):
        tipo, _, saida = self.validar(png(cauda=b"<html>"), "a.png")
        self.assertEqual(tipo, "image/png")
        self.assertNotIn(b"GPS", saida)
        for t in (b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"<html>"):
            self.assertNotIn(t, saida)
        self.assertTrue(saida.endswith(_chunk(b"IEND", b"")))

    def test_webp_sem_exif_xmp_flags_zerados_e_sem_cauda(self):
        tipo, _, saida = self.validar(webp(cauda=b"PK\x03\x04lixo"), "a.webp")
        self.assertEqual(tipo, "image/webp")
        self.assertNotIn(b"GPS", saida)
        self.assertNotIn(b"PK", saida)
        self.assertEqual(struct.unpack("<I", saida[4:8])[0], len(saida) - 8)
        self.assertEqual(saida[20] & 0x0C, 0)   # os bits de EXIF e XMP do VP8X

    def test_gif_sem_xmp_nem_comentario_e_sem_cauda(self):
        tipo, _, saida = self.validar(gif(cauda=b"PK\x03\x04"), "a.gif")
        self.assertEqual(tipo, "image/gif")
        self.assertNotIn(b"GPS", saida)
        self.assertIn(b"NETSCAPE2.0", saida)   # a animação continua
        self.assertTrue(saida.endswith(b"\x3b"))

    def test_imagem_quebrada_recusada(self):
        self.recusa(jpeg()[:40], "a.jpg")
        self.recusa(png()[:30], "a.png")
        self.recusa(b"RIFF\xff\xff\xff\xffWEBPVP8 ", "a.webp")

    def test_extensao_trocada_ganha_a_certa(self):
        self.assertEqual(self.validar(png(), "x.html")[1], "x.html.png")
        self.assertEqual(self.validar(png(), "x.PNG")[1], "x.PNG")
        self.assertEqual(self.validar(jpeg(), "x.jpeg")[1], "x.jpeg")


class Recusas(Base):
    def test_svg_e_html_recusados_mesmo_renomeados(self):
        for dados in (b'<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>',
                      b"\xef\xbb\xbf  <!DOCTYPE html><html><script>x</script>",
                      b'<?xml version="1.0"?><svg/>', b"texto\n<SCRIPT>alert(1)</SCRIPT>", b"<html>"):
            for nome in ("a.txt", "a.csv", "a.png", "a.pdf", "a.svg", "a.html"):
                self.recusa(dados, nome)

    def test_executavel_e_desconhecido_recusados(self):
        self.recusa(b"MZ\x90\x00" + bytes(100), "a.txt")
        self.recusa(b"\x7fELF" + bytes(100), "a.csv")
        self.recusa(bytes(100), "a.bin")

    def test_texto_so_utf8_sem_nul(self):
        self.recusa("ação".encode("latin-1"), "a.txt")
        self.recusa(b"abc\x00def", "a.txt")
        self.recusa(b"so texto", "a.doc")   # texto só com .txt ou .csv

    def test_texto_e_pdf_aceitos(self):
        self.assertEqual(self.validar("olá, mundo\n".encode(), "nota.txt")[:2], ("text/plain", "nota.txt"))
        self.assertEqual(self.validar(b"a;b\n1;2\n", "t.CSV")[0], "text/csv")
        self.assertEqual(self.validar(b"%PDF-1.7\n...", "r.pdf")[:2], ("application/pdf", "r.pdf"))


class Zip(Base):
    def test_zip_comum_e_ooxml(self):
        self.assertEqual(self.validar(zip_de([("a/b.txt", b"oi"), ("c.png", b"x")]), "p.zip")[:2],
                         ("application/zip", "p.zip"))
        self.assertEqual(self.validar(ooxml(), "d.docx")[0], anexos.TIPOS_OOXML["docx"])
        self.assertEqual(self.validar(ooxml("spreadsheetml.sheet.main"), "p.xlsx")[0], anexos.TIPOS_OOXML["xlsx"])
        self.assertEqual(self.validar(ooxml("presentationml.presentation.main"), "s.pptx")[0], anexos.TIPOS_OOXML["pptx"])

    def test_ooxml_com_macro_recusado(self):
        self.recusa(ooxml(extra=[("word/vbaProject.bin", b"macro")]), "d.docx")
        self.recusa(ooxml("wordprocessingml.document.macroEnabled.main"), "d.docm")

    def test_bomba_recusada(self):
        self.recusa(zip_de([("zeros.txt", bytes(5 * 1024 * 1024))]), "b.zip")

    def test_mais_de_1000_entradas_recusado_sem_chamar_o_zipfile(self):
        dados = zip_de([(f"{i}.txt", b"") for i in range(1001)], compresslevel=1)
        with mock.patch.object(anexos.zipfile, "ZipFile", side_effect=AssertionError("chamou o zipfile")):
            self.recusa(dados, "m.zip")

    def test_nomes_perigosos_recusados(self):
        for nome in ("../x", "a/../../x", "C:x", "/etc/x", "a\u202eexe.txt", "a\x01b", "x" * 256):
            self.recusa(zip_de([(nome, b"x")]), "n.zip")
        # o zipfile do Windows troca "\" por "/" ao gravar: a barra invertida entra trocando os bytes do nome
        for falso, nome in ((b"a_b", b"a\\b"), (b"C__x", b"C:\\x")):
            self.recusa(zip_de([(falso.decode(), b"x")]).replace(falso, nome), "n.zip")

    def test_nomes_repetidos_recusados(self):
        self.recusa(zip_de([("A.txt", b"1"), ("a.TXT", b"2")]), "r.zip")

    def test_aninhado_e_executavel_dentro_recusados(self):
        for nome in ("x.zip", "x.RAR", "x.7z", "x.tar.gz", "x.exe", "x.pdf.exe", "x.exe.txt", "x.js", "x.svg",
                     "x.html", "x.ps1", "x.lnk", "x.jar"):
            self.recusa(zip_de([(nome, b"x")]), "a.zip")

    def test_cifrado_recusado(self):
        dados = bytearray(zip_de([("a.txt", b"segredo")]))
        for assinatura in (b"PK\x03\x04", b"PK\x01\x02"):
            i = dados.find(assinatura)
            pos = i + (6 if assinatura == b"PK\x03\x04" else 8)
            dados[pos] |= 1
        self.recusa(bytes(dados), "c.zip")

    def test_zip_com_prefixo_ou_cauda_recusado(self):
        z = zip_de([("a.txt", b"oi")])
        self.recusa(b"MZ" + bytes(50) + z, "a.zip")   # autoextraível
        self.recusa(z + b"lixo", "a.zip")

    def test_diretorio_central_grande_recusado(self):
        with mock.patch.object(anexos, "ZIP_CENTRAL_MAX", 100):
            self.recusa(zip_de([(f"{i:03d}-nome-comprido.txt", b"") for i in range(10)]), "a.zip")


MB25 = 25 * 1024 * 1024


class Custo(Base):
    """O DoS do gate: 25 MB feitos para o laço de Python. Cada um é recusado, ou aceito em menos de 1 s, e a limpeza
    não junta o arquivo na memória."""
    def medir(self, dados, nome):
        pasta, caminho = _arquivo(dados)
        self.addCleanup(shutil.rmtree, pasta, ignore_errors=True)
        tracemalloc.start()
        comeco = time.perf_counter()
        try:
            resultado = anexos.validar(caminho, nome)
        except anexos.Recusado:
            resultado = None
        finally:
            gasto = time.perf_counter() - comeco
            pico = tracemalloc.get_traced_memory()[1]
            tracemalloc.stop()
        self.assertLess(gasto, 1.0)
        self.assertLess(pico, 4 * 1024 * 1024)
        self.assertEqual(os.listdir(pasta), ["a"])   # o .limpo não sobra
        return resultado

    def test_jpeg_com_rst_fora_do_scan_recusado(self):
        cabeca = jpeg()[:jpeg().index(b"\xff\xda")]
        self.assertIsNone(self.medir(cabeca + b"\xff\xd0" * (MB25 // 2) + b"\xff\xd9", "a.jpg"))

    def test_jpeg_com_scan_de_ff00_aceito_rapido(self):
        cabeca = jpeg()[:jpeg().index(b"\x12\xff\x00")]
        tipo, _ = self.medir(cabeca + b"\xff\x00" * (MB25 // 2) + b"\xff\xd9", "a.jpg")
        self.assertEqual(tipo, "image/jpeg")

    def test_jpeg_com_segmentos_ou_scans_demais_recusado(self):
        corpo = jpeg()[:-2]
        self.assertIsNone(self.medir(corpo + b"\xff\xfe\x00\x02" * (MB25 // 4) + b"\xff\xd9", "a.jpg"))
        sos = b"\xff\xda\x00\x08\x01\x01\x00\x00\x3f\x00\x12"
        self.assertIsNone(self.medir(corpo + sos * (anexos.JPEG_SCANS_MAX + 1) + b"\xff\xd9", "a.jpg"))

    def test_png_com_chunks_vazios_demais_recusado(self):
        corpo = png()
        fim = corpo.index(_chunk(b"IEND", b""))
        vazio = _chunk(b"teXt", b"")
        self.assertIsNone(self.medir(corpo[:fim] + vazio * (MB25 // len(vazio)) + corpo[fim:], "a.png"))

    def test_gif_com_sub_blocos_de_1_byte_recusado(self):
        corpo = gif()
        imagem = b"\x2c" + struct.pack("<HHHH", 0, 0, 1, 1) + b"\x00\x02" + b"\x01\x00" * (MB25 // 2) + b"\x00"
        self.assertIsNone(self.medir(corpo[:-1] + imagem + b"\x3b", "a.gif"))

    def test_webp_com_chunks_vazios_demais_recusado(self):
        corpo = webp()[12:] + _riff(b"ALPH", b"") * (MB25 // 8)
        self.assertIsNone(self.medir(b"RIFF" + struct.pack("<I", len(corpo) + 4) + b"WEBP" + corpo, "a.webp"))

    def test_png_grande_de_verdade_aceito(self):
        corpo = png()
        fim = corpo.index(_chunk(b"IDAT", zlib.compress(b"\x00\x00")))
        idat = _chunk(b"IDAT", bytes(8192))   # o tamanho do libpng
        tipo, _ = self.medir(corpo[:fim] + idat * (MB25 // len(idat)) + corpo[fim:], "a.png")
        self.assertEqual(tipo, "image/png")


class NomeFinal(unittest.TestCase):
    def test_nome_do_cabecalho(self):
        self.assertEqual(anexos.nome_do_cabecalho("rel%C3%A1t%C3%B3rio%20final.pdf"), "relátório final.pdf")
        for ruim in ("", "a%2Fb", "..", "a%00b", "%E2%80%AEx", "a" * 121, "%ZZ", "a:b"):
            with self.assertRaises(anexos.Recusado, msg=ruim):
                anexos.nome_do_cabecalho(ruim)


if __name__ == "__main__":
    unittest.main()
