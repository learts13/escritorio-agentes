"""vapid.py: vetores do RFC 6979 (A.2.5), ida e volta, recusas, conferência independente com o crypto do Node
e o arquivo da chave. Sem mock: toda conta é a de verdade."""
import base64
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import unittest

import vapid

# RFC 6979, A.2.5: P-256 com SHA-256
D_RFC = 0xC9AFA9D845BA75166B5C215767B1D6934E50C3DB36E89B127B8A622B120F6721
UX = 0x60FED4BA255A9D31C961EB74C6356D68C049B8923B61FA6CE669622E60F29FB6
UY = 0x7903FE1008B8BC99A41AE9E95628BC64F2F1B20C2D7E9F5177A3C294D4462299
VETORES = {
    b"sample": (0xA6E3C57DD01ABE90086538398355DD4C3B17AA873382B0F24D6129493D8AAD60,
                0xEFD48B2AACB6A8FD1140DD9CD45E81D69D2C877B56AAF991C34D0EA84EAF3716,
                0xF7CB1C942D657C41D436C7A1B6E29F65F3E900DBB9AFF4064DC4AB2F843ACDA8),
    b"test": (0xD16B6AE827F17175E040871A1C7EC3500192C4C92677336EC2537ACAEE0008E0,
              0xF1ABB023518351CD71D881567B1EA663ED3EFCF6C5132B354F28D3B0B7D38367,
              0x019F4113742A2B14BD25926B49C649155F267E60D3814B4C0CC84250E46F0083),
}
N = vapid.N


def b64d(texto):
    return base64.urlsafe_b64decode(texto + "=" * (-len(texto) % 4))


def sig(r, s):
    return r.to_bytes(32, "big") + s.to_bytes(32, "big")


class Rfc6979(unittest.TestCase):
    def test_chave_publica(self):
        self.assertEqual(vapid.publica(D_RFC), b"\x04" + UX.to_bytes(32, "big") + UY.to_bytes(32, "big"))

    def test_k_r_s_exatos(self):
        for msg, (k, r, s) in VETORES.items():
            with self.subTest(msg=msg):
                self.assertEqual(next(vapid._nonces(D_RFC, hashlib.sha256(msg).digest())), k)
                self.assertEqual(vapid.assinar(D_RFC, msg), sig(r, s))

    def test_segundo_candidato_do_laco_de_rejeicao(self):
        # passo h.3, que nenhum vetor da P-256 exercita; valor conferido por um RFC 6979 independente (gate F2)
        g = vapid._nonces(D_RFC, hashlib.sha256(b"sample").digest())
        next(g)
        self.assertEqual(next(g), 0x8E83DC490BC5FC4D5992BD63CD87F254ADFFCB930F8A8011702A88870F638FDB)


class Escada(unittest.TestCase):
    def test_bordas(self):
        g = vapid.G
        self.assertIsNone(vapid._vezes(0, g))
        self.assertIsNone(vapid._vezes(N, g))
        self.assertEqual(vapid._vezes(N - 1, g), (g[0], vapid.P - g[1]))
        self.assertEqual(vapid._vezes(N - 2, g), (vapid._soma(g, g)[0], vapid.P - vapid._soma(g, g)[1]))
        soma = None
        for k in range(1, 9):   # k pequeno: o mesmo que somar o ponto k vezes
            soma = vapid._soma(soma, g)
            with self.subTest(k=k):
                self.assertEqual(vapid._vezes(k, g), soma)
        self.assertEqual(vapid._vezes(2 ** 255, g), vapid._vezes(2 ** 254, vapid._soma(g, g)))


class Assinatura(unittest.TestCase):
    def setUp(self):
        self.d = vapid.gerar_chave()
        self.pub = vapid.publica(self.d)
        self.msg = b"ida e volta"
        self.sig = vapid.assinar(self.d, self.msg)

    def test_ida_e_volta(self):
        self.assertTrue(1 <= self.d < N)
        self.assertEqual(len(self.pub), 65)
        self.assertEqual(len(self.sig), 64)
        self.assertTrue(vapid.verificar(self.pub, self.msg, self.sig))
        self.assertEqual(vapid.assinar(self.d, self.msg), self.sig)   # determinística

    def test_recusas(self):
        r, s = int.from_bytes(self.sig[:32], "big"), int.from_bytes(self.sig[32:], "big")
        adulterada = bytearray(self.sig)
        adulterada[10] ^= 1
        outra = vapid.publica(vapid.gerar_chave())
        casos = {
            "assinatura adulterada": (self.pub, self.msg, bytes(adulterada)),
            "mensagem trocada": (self.pub, b"ida e voltA", self.sig),
            "outra chave": (outra, self.msg, self.sig),
            "r = 0": (self.pub, self.msg, sig(0, s)),
            "s = 0": (self.pub, self.msg, sig(r, 0)),
            "r = n": (self.pub, self.msg, sig(N, s)),
            "s = n": (self.pub, self.msg, sig(r, N)),
            "assinatura curta": (self.pub, self.msg, self.sig[:63]),
            "não é bytes": (self.pub, self.msg, self.sig.hex()),
            "chave comprimida": (b"\x02" + self.pub[1:], self.msg, self.sig),
            "chave curta": (self.pub[:33], self.msg, self.sig),
            "ponto no infinito (0, 0)": (b"\x04" + bytes(64), self.msg, self.sig),
            "fora da curva": (self.pub[:64] + bytes([self.pub[64] ^ 1]), self.msg, self.sig),
            "x >= p": (b"\x04" + (int.from_bytes(self.pub[1:33], "big") + vapid.P).to_bytes(33, "big")[1:]
                       + self.pub[33:], self.msg, self.sig),
        }
        for nome, args in casos.items():
            with self.subTest(nome):
                self.assertFalse(vapid.verificar(*args))

    def test_chave_privada_fora_do_intervalo(self):
        for d in (0, N, -1, True, 1.0, "1"):
            with self.subTest(d=d):
                with self.assertRaises(ValueError) as erro:
                    vapid.assinar(d, b"x")
                self.assertNotIn(str(d), str(erro.exception).replace("[1, n-1]", ""))


class Cabecalho(unittest.TestCase):
    def test_formato_aud_exp_e_assinatura(self):
        d = vapid.gerar_chave()
        valor = vapid.cabecalho(d, "https://FCM.googleapis.com:8443/fcm/send/abc?x=1", "mailto:ops@exemplo.com", agora=1700000000.7)
        self.assertTrue(valor.startswith("vapid t="))
        t, k = valor[len("vapid t="):].split(", k=")
        self.assertEqual(k, vapid.publica_b64url(d))
        cab, corpo, assinatura = t.split(".")
        self.assertEqual(json.loads(b64d(cab)), {"typ": "JWT", "alg": "ES256"})
        self.assertEqual(json.loads(b64d(corpo)),
                         {"aud": "https://fcm.googleapis.com:8443", "exp": 1700000000 + 12 * 3600, "sub": "mailto:ops@exemplo.com"})
        self.assertTrue(vapid.verificar(b64d(k), f"{cab}.{corpo}".encode(), b64d(assinatura)))
        self.assertNotIn("=", t + k)
        sem_porta = vapid.cabecalho(d, "https://web.push.apple.com/QGx", "https://exemplo.com", agora=0)
        self.assertEqual(json.loads(b64d(sem_porta.split(".")[1]))["aud"], "https://web.push.apple.com")
        com_443 = vapid.cabecalho(d, "https://web.push.apple.com:443/QGx", "https://exemplo.com", agora=0)
        self.assertEqual(json.loads(b64d(com_443.split(".")[1]))["aud"], "https://web.push.apple.com")

    def test_recusas(self):
        d = vapid.gerar_chave()
        for endpoint, sub in (("http://fcm.googleapis.com/x", "mailto:a@b.c"), ("https:///x", "mailto:a@b.c"),
                              ("fcm.googleapis.com/x", "mailto:a@b.c"), ("https://fcm.googleapis.com/x", "ops@b.c")):
            with self.subTest(endpoint=endpoint, sub=sub):
                with self.assertRaises(ValueError):
                    vapid.cabecalho(d, endpoint, sub)


NODE = """
const c = require('crypto');
const {jwk, jwt} = JSON.parse(require('fs').readFileSync(0, 'utf8'));
const chave = c.createPublicKey({key: jwk, format: 'jwk'});
const confere = t => {
  const i = t.lastIndexOf('.');
  return c.verify('sha256', Buffer.from(t.slice(0, i)), {key: chave, dsaEncoding: 'ieee-p1363'},
                  Buffer.from(t.slice(i + 1), 'base64url'));
};
const adulterado = jwt.slice(0, -2) + (jwt.slice(-2, -1) === 'A' ? 'B' : 'A') + jwt.slice(-1);
const par = c.generateKeyPairSync('ec', {namedCurve: 'P-256'});
const msg = 'assinado pelo node';
const sig = c.sign('sha256', Buffer.from(msg), {key: par.privateKey, dsaEncoding: 'ieee-p1363'});
const pub = par.publicKey.export({format: 'jwk'});
console.log(JSON.stringify({ok: confere(jwt), adulterado: confere(adulterado), x: pub.x, y: pub.y, msg,
                            sig: sig.toString('base64url')}));
"""


@unittest.skipUnless(shutil.which("node"), "node não encontrado")
class NodeCrypto(unittest.TestCase):
    def test_node_confere_o_vapid_e_o_vapid_confere_o_node(self):
        d = vapid.gerar_chave()
        pub = vapid.publica(d)
        jwk = {"kty": "EC", "crv": "P-256", "x": vapid._b64(pub[1:33]), "y": vapid._b64(pub[33:])}
        t = vapid.jwt(d, "https://fcm.googleapis.com", "mailto:ops@exemplo.com", 1700043200)
        saida = subprocess.run([shutil.which("node"), "-e", NODE], input=json.dumps({"jwk": jwk, "jwt": t}),
                               capture_output=True, text=True, timeout=60, check=True)
        r = json.loads(saida.stdout)
        self.assertIs(r["ok"], True)
        self.assertIs(r["adulterado"], False)
        pub_node = b"\x04" + b64d(r["x"]) + b64d(r["y"])
        self.assertTrue(vapid.verificar(pub_node, r["msg"].encode(), b64d(r["sig"])))
        self.assertFalse(vapid.verificar(pub_node, r["msg"].encode() + b".", b64d(r["sig"])))


class Arquivo(unittest.TestCase):
    def setUp(self):
        self.pasta = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.pasta)
        self.arq = os.path.join(self.pasta, "dados", "vapid.json")

    def test_cria_0600_e_rele_a_mesma(self):
        d = vapid.carregar_ou_criar(self.arq)
        self.assertTrue(1 <= d < N)
        self.assertEqual(os.listdir(os.path.dirname(self.arq)), ["vapid.json"])   # nenhum temporário sobrando
        if os.name == "posix":
            self.assertEqual(os.stat(self.arq).st_mode & 0o777, 0o600)
            self.assertEqual(os.stat(os.path.dirname(self.arq)).st_mode & 0o777, 0o700)
        with open(self.arq, encoding="ascii") as f:
            dados = json.load(f)
        self.assertEqual(set(dados), {"v", "d"})
        self.assertEqual(int.from_bytes(b64d(dados["d"]), "big"), d)
        self.assertEqual(vapid.carregar_ou_criar(self.arq), d)

    def test_recusa_arquivo_ruim_sem_trocar_a_chave(self):
        boa = vapid._b64(D_RFC.to_bytes(32, "big"))
        ruins = {
            "vazio": b"",
            "json cortado": b'{"v": 1, "d": "' + boa.encode(),
            "lista": b"[]",
            "utf-8 inválido": b"\xff\xfe",
            "versão": json.dumps({"v": 2, "d": boa}).encode(),
            "versão booleana": json.dumps({"v": True, "d": boa}).encode(),
            "chave a mais": json.dumps({"v": 1, "d": boa, "x": 1}).encode(),
            "d curto": json.dumps({"v": 1, "d": boa[:-1]}).encode(),
            "d com padding": json.dumps({"v": 1, "d": boa + "="}).encode(),
            "d não canônico": json.dumps({"v": 1, "d": boa[:-1] + "B"}).encode(),
            "d número": json.dumps({"v": 1, "d": D_RFC}).encode(),
            "d zero": json.dumps({"v": 1, "d": vapid._b64(bytes(32))}).encode(),
            "d = n": json.dumps({"v": 1, "d": vapid._b64(N.to_bytes(32, "big"))}).encode(),
            "grande demais": json.dumps({"v": 1, "d": boa}).encode() + b" " * 2000,
            "aninhado": b"[" * 1000,
        }
        os.makedirs(os.path.dirname(self.arq))
        for nome, bruto in ruins.items():
            with self.subTest(nome):
                with open(self.arq, "wb") as f:
                    f.write(bruto)
                with self.assertRaises(ValueError) as erro:
                    vapid.carregar_ou_criar(self.arq)
                self.assertIn(self.arq, str(erro.exception))
                self.assertNotIn(boa, str(erro.exception))
                with open(self.arq, "rb") as f:
                    self.assertEqual(f.read(), bruto)

    def test_le_a_chave_do_rfc_e_deixa_o_oserror_passar(self):
        os.makedirs(os.path.dirname(self.arq))
        with open(self.arq, "w", encoding="ascii") as f:
            json.dump({"v": 1, "d": vapid._b64(D_RFC.to_bytes(32, "big"))}, f)
        self.assertEqual(vapid.carregar_ou_criar(self.arq), D_RFC)
        os.unlink(self.arq)
        os.mkdir(self.arq)   # pasta no lugar do arquivo: erro do disco, não arquivo inválido
        with self.assertRaises(OSError):
            vapid.carregar_ou_criar(self.arq)


if __name__ == "__main__":
    unittest.main()
