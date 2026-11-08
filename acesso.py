# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Login do escritório: usuários com senha (scrypt), sessões por cookie e primeiro acesso.

- Senha guardada só como hash scrypt com sal próprio e os parâmetros (n, r, p) ao lado;
  comparação em tempo constante. No máximo 2 cálculos de scrypt ao mesmo tempo (memória).
- Sessão: token aleatório no cookie (HttpOnly, SameSite=Lax, Secure e nome __Host- em https); no disco
  fica só o SHA-256 do token. Expira em 30 dias e só vale enquanto o usuário existir.
- Primeiro acesso: sem nenhum usuário, o servidor grava um código de uso único em
  <dados>/codigo-primeiro-acesso.txt (0600). Quem cria o primeiro usuário precisa desse código,
  que só quem tem acesso de root à máquina consegue ler (sudo escritorio-codigo). Arquivo vazio ou cortado
  nunca vale: o servidor o troca por um novo ao subir. Criar o primeiro usuário apaga o código e derruba
  todas as sessões de antes. O código não expira.
- Falha fechada: usuarios.json ausente é o primeiro acesso; existente e ilegível (ou que não seja um objeto
  JSON) é erro, e o serviço não sobe. Assim um arquivo corrompido nunca reabre o primeiro acesso.
- Tentativas erradas: no máximo 8 a cada 15 minutos por balde (cada usuário existente tem o seu;
  todos os inexistentes dividem um; o primeiro acesso tem outro), com atraso de 1 s em cada erro.
  O contador fica só na memória: reiniciar o serviço o zera.
- Modo resposta (fase R): a senha confirmada de novo numa sessão libera os envios naquela sessão e naquele
  navegador (2º cookie, de sessão do navegador) por 1 h, renovada a cada envio que deu certo, com teto de 8 h
  desde a senha. Fica só na memória (sha256 da sessão -> sha256 do cookie do modo): reiniciar fecha todos.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time

DURACAO = 30 * 86400
USUARIO_OK = re.compile(r"[a-z0-9][a-z0-9._-]{2,31}")
SENHA_MIN = 10
N, R, P = 2 ** 15, 8, 1
TAM_CODIGO = 16                 # código de primeiro acesso: 8 bytes em hexadecimal
LIMITE, JANELA, ATRASO = 8, 900, 1
MODO_INATIVO, MODO_TETO = 3600, 8 * 3600   # modo resposta: 1 h sem envio que deu certo fecha; 8 h desde a senha fecha sempre
INEXISTENTES, PRIMEIRO = "*inexistentes", "*primeiro-acesso"  # baldes que não colidem com nome válido
CALCULOS = threading.BoundedSemaphore(2)  # scrypt usa 32 MiB; dois juntos cabem folgados no MemoryMax
ARQ_USUARIOS, ARQ_CODIGO = "usuarios.json", "codigo-primeiro-acesso.txt"   # dentro da pasta de dados


class TentativasDemais(PermissionError):
    """O balde de tentativas encheu: nem a senha certa entra até a janela passar."""


class UsuariosIlegiveis(Exception):
    """usuarios.json existe e não pode ser lido: o serviço não sobe (nunca vira "sem usuários")."""


class NaoGravou(Exception):
    """A gravação no disco falhou e nada mudou. Não herda de OSError: um PermissionError do disco não vira senha errada."""


def _hash(senha, sal, n=N, r=R, p=P):
    with CALCULOS:
        return hashlib.scrypt(senha.encode("utf-8", "surrogatepass"), salt=sal, n=n, r=r, p=p, maxmem=64 * 1024 * 1024, dklen=32)


def gravar(caminho, conteudo):
    """Grava bytes de forma atômica: arquivo temporário único (0600) na mesma pasta e os.replace."""
    pasta = os.path.dirname(caminho)
    os.makedirs(pasta, mode=0o700, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=pasta, prefix=".grava-")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(conteudo)
        os.replace(tmp, caminho)
    except BaseException:
        os.unlink(tmp)
        raise


def _gravar(caminho, dados):
    gravar(caminho, json.dumps(dados).encode("utf-8"))


def _ler(caminho, padrao):
    try:
        with open(caminho, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


def ler_usuarios(caminho):
    """Usuários do arquivo. Ausente = {} (primeiro acesso). Ilegível, inválido ou fora do formato levanta
    UsuariosIlegiveis, com o caminho e o tipo do erro, nunca com o conteúdo do arquivo."""
    try:
        with open(caminho, encoding="utf-8") as f:
            dados = json.load(f)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as x:   # permissão, pasta no lugar do arquivo, vazio, JSON ou UTF-8 inválido
        motivo = type(x).__name__
    else:
        if isinstance(dados, dict):
            return dados
        motivo = "não é um objeto JSON"
    raise UsuariosIlegiveis(f"{caminho} não pode ser lido ({motivo}): conserte o dono e a permissão (usuário do "
                            "serviço, 0600) ou restaure o backup; para recomeçar do zero, apague o arquivo") from None


def ler_codigo(caminho):
    """Código de primeiro acesso do arquivo, ou None se faltar ou não tiver o tamanho exato."""
    try:
        with open(caminho, encoding="utf-8") as f:
            codigo = f.read().strip()
    except (OSError, ValueError):
        return None
    return codigo if len(codigo) == TAM_CODIGO else None


class Acesso:
    def __init__(self, pasta):
        self.pasta = pasta
        self.arq_usuarios = os.path.join(pasta, ARQ_USUARIOS)
        self.arq_sessoes = os.path.join(pasta, "sessoes.json")
        self.arq_codigo = os.path.join(pasta, ARQ_CODIGO)
        self.trava = threading.Lock()
        self.usuarios = ler_usuarios(self.arq_usuarios)   # antes de tudo: ilegível não cria nem apaga nada
        self.sessoes = {k: v for k, v in _ler(self.arq_sessoes, {}).items() if v.get("expira", 0) > time.time()}
        self.falhas = {}  # balde -> horários das tentativas que contam
        self.modos = {}   # sha256(token da sessão) -> {"cookie": sha256(token do modo), "inicio", "ate"}; nunca no disco
        if not self.usuarios and self._codigo_gravado() is None:
            if os.path.exists(self.arq_codigo):
                os.unlink(self.arq_codigo)  # vazio ou cortado (gravação que falhou): troca por um novo
            os.makedirs(pasta, mode=0o700, exist_ok=True)
            fd = os.open(self.arq_codigo, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w") as f:
                f.write(secrets.token_hex(TAM_CODIGO // 2) + "\n")

    def _codigo_gravado(self):
        return ler_codigo(self.arq_codigo)

    # --- limite de tentativas (chamar com a trava)
    def _reservar(self, balde):
        """Conta a tentativa antes de conferir, para pedidos em paralelo não passarem do limite.
        Devolve a marca, que sai da conta se a tentativa der certo."""
        agora = time.time()
        vivas = [t for t in self.falhas.get(balde, []) if agora - t < JANELA]
        self.falhas[balde] = vivas
        if len(vivas) >= LIMITE:
            raise TentativasDemais("tentativas demais; espere alguns minutos")
        vivas.append(agora)
        return agora

    def _devolver(self, balde, marca):
        if marca in self.falhas.get(balde, []):
            self.falhas[balde].remove(marca)

    # --- primeiro acesso
    def precisa_configurar(self):
        return not self.usuarios

    def criar_primeiro(self, codigo, usuario, senha):
        with self.trava:
            if self.usuarios:
                raise PermissionError("o primeiro usuário já foi criado")
            marca = self._reservar(PRIMEIRO)
            certo = self._codigo_gravado()
            if certo is None:  # falha fechada: arquivo vazio nunca vira código certo
                self._devolver(PRIMEIRO, marca)
                raise PermissionError("código de primeiro acesso não encontrado no servidor; "
                                      "peça a quem administra o servidor para reiniciar o serviço")
            errou = not hmac.compare_digest(codigo.strip().encode(), certo.encode())
            if not errou:
                self._devolver(PRIMEIRO, marca)
                # recomeço do zero: nenhuma sessão de antes vale para o usuário novo (zera antes de criar,
                # para uma falha no meio nunca deixar usuário novo com sessão velha)
                self.sessoes, self.modos = {}, {}
                _gravar(self.arq_sessoes, self.sessoes)
                self._criar(usuario, senha)
                os.unlink(self.arq_codigo)
        if errou:
            time.sleep(ATRASO)  # fora da trava: não segura login nem saída de ninguém
            raise PermissionError("código de primeiro acesso incorreto")

    def _criar(self, usuario, senha):
        usuario = usuario.strip().lower()
        if not USUARIO_OK.fullmatch(usuario):
            raise ValueError("usuário: 3 a 32 caracteres, letras minúsculas, números, ponto, hífen ou sublinhado")
        if len(senha) < SENHA_MIN or len(senha) > 256:
            raise ValueError(f"a senha precisa ter pelo menos {SENHA_MIN} caracteres")
        sal = secrets.token_bytes(16)
        self.usuarios[usuario] = {"sal": sal.hex(), "hash": _hash(senha, sal).hex(), "n": N, "r": R, "p": P,
                                  "criado": int(time.time())}
        _gravar(self.arq_usuarios, self.usuarios)

    # --- login
    def conferir(self, usuario, senha):
        """Confere a senha no balde de tentativas do login, sem criar sessão. Devolve o nome normalizado ou levanta
        PermissionError (errar conta no mesmo balde: 8 erros travam também o login)."""
        nome = (usuario or "").strip().lower()
        with self.trava:
            u = self.usuarios.get(nome)
            balde = nome if u else INEXISTENTES
            marca = self._reservar(balde)
        valido = u and all(k in u for k in ("n", "r", "p"))  # hash sem os parâmetros gravados não vale
        if valido:
            calculado = _hash(senha or "", bytes.fromhex(u["sal"]), u["n"], u["r"], u["p"])
        else:
            _hash(senha or "", secrets.token_bytes(16))  # mesmo custo sem usuário (tempo parecido)
        if not valido or not hmac.compare_digest(calculado, bytes.fromhex(u["hash"])):
            time.sleep(ATRASO)
            raise PermissionError("usuário ou senha incorretos")
        with self.trava:
            self._devolver(balde, marca)
        return nome

    def entrar(self, usuario, senha):
        """Devolve o token da sessão ou levanta PermissionError."""
        nome = self.conferir(usuario, senha)
        token = secrets.token_urlsafe(32)
        with self.trava:
            self.sessoes[_sha(token)] = {"usuario": nome, "expira": time.time() + DURACAO}
            _gravar(self.arq_sessoes, self.sessoes)
        return token

    def sessao(self, token):
        if not token or len(token) > 100:
            return None
        s = self.sessoes.get(_sha(token))
        if not s or s["expira"] < time.time() or s["usuario"] not in self.usuarios:
            return None
        return s["usuario"]

    def sair_todos(self, token, senha):
        """"Sair de todos os aparelhos": confere a senha do usuário da sessão no balde do login e zera todas as sessões
        e modos resposta (só existe uma conta). Devolve quantas sessões saíram; senão levanta PermissionError (sessão ou
        senha) ou NaoGravou (disco)."""
        usuario = self.sessao(token)
        if not usuario:
            raise PermissionError("entre de novo")
        self.conferir(usuario, senha)
        with self.trava:   # grava antes de trocar a memória: se o disco falhar, nada muda
            n = len(self.sessoes)
            try:
                _gravar(self.arq_sessoes, {})
            except OSError as x:
                raise NaoGravou(type(x).__name__) from x
            self.sessoes, self.modos = {}, {}
        return n

    def sair(self, token):
        with self.trava:
            if token:
                self.modos.pop(_sha(token), None)
            if token and self.sessoes.pop(_sha(token), None):
                _gravar(self.arq_sessoes, self.sessoes)

    # --- modo resposta (fase R): por sessão e por navegador, só na memória
    def abrir_modo(self, token, senha, agora=None):
        """Confere a senha do usuário da sessão e abre um modo novo (inicio e ate zerados). Devolve o token do cookie
        do modo; no servidor fica só o hash. Sem sessão ou com a senha errada, levanta PermissionError."""
        usuario = self.sessao(token)
        if not usuario:
            raise PermissionError("entre de novo")
        self.conferir(usuario, senha)
        agora = time.time() if agora is None else agora
        cookie = secrets.token_urlsafe(32)
        with self.trava:
            self.modos[_sha(token)] = {"cookie": _sha(cookie), "inicio": agora, "ate": agora + MODO_INATIVO}
        return cookie

    def modo(self, token, cookie, agora=None):
        """(resta_s, teto_s) do modo aberto nesta sessão com este cookie, ou None. Vencido sai na consulta."""
        if not token or not cookie or len(cookie) > 100 or not self.sessao(token):
            return None
        agora = time.time() if agora is None else agora
        with self.trava:
            m = self.modos.get(_sha(token))
            if m and agora >= min(m["ate"], m["inicio"] + MODO_TETO):
                del self.modos[_sha(token)]
                return None
            if not m or not hmac.compare_digest(m["cookie"], _sha(cookie)):
                return None
            return _segundos(m["ate"] - agora), _segundos(m["inicio"] + MODO_TETO - agora)

    def renovar_modo(self, token, agora=None):
        """Depois de um envio que deu certo: mais 1 h, nunca além de inicio + 8 h. Devolve (resta_s, teto_s) ou None."""
        agora = time.time() if agora is None else agora
        with self.trava:
            m = self.modos.get(_sha(token)) if token else None
            if not m:
                return None
            m["ate"] = min(agora + MODO_INATIVO, m["inicio"] + MODO_TETO)
            return _segundos(m["ate"] - agora), _segundos(m["inicio"] + MODO_TETO - agora)

    def fechar_modo(self, token):
        with self.trava:
            return bool(token) and self.modos.pop(_sha(token), None) is not None


def _segundos(x):
    """Segundos que faltam, arredondados para cima (a tela mostra "fecha em"; quem decide é o servidor)."""
    return -int(-x // 1)


def _sha(token):
    return hashlib.sha256(token.encode()).hexdigest()
