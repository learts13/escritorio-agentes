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
import unicodedata

import ajustes

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
PAPEIS = ("admin", "membro")
ANDAR_PRINCIPAL = "principal"
ANDAR_OK = re.compile(r"[0-9a-f]{8}")   # o id de um andar extra (andares.py); a existência o escritório confere
NOME_MAX = 40
CONVITE_VALIDADE, CONVITES_MAX = 48 * 3600, 20


class TentativasDemais(PermissionError):
    """O balde de tentativas encheu: nem a senha certa entra até a janela passar."""


class UsuariosIlegiveis(Exception):
    """usuarios.json existe e não pode ser lido: o serviço não sobe (nunca vira "sem usuários")."""


class NaoGravou(Exception):
    """A gravação no disco falhou e nada mudou. Não herda de OSError: um PermissionError do disco não vira senha errada."""


class UltimoAdmin(PermissionError):
    """Não pode remover nem rebaixar o único admin do andar principal."""


class ContaExiste(ValueError):
    """Já existe uma conta com esse usuário."""


class ConviteInvalido(PermissionError):
    """O convite não existe, já foi usado, foi revogado ou venceu (a mesma resposta para todos)."""


class ConvitesDemais(ValueError):
    """Já há CONVITES_MAX convites esperando."""


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
        self.arq_convites = os.path.join(pasta, "convites.json")
        self.trava = threading.Lock()
        self.usuarios = ler_usuarios(self.arq_usuarios)   # antes de tudo: ilegível não cria nem apaga nada
        self.sessoes = {k: v for k, v in _ler(self.arq_sessoes, {}).items() if v.get("expira", 0) > time.time()}
        self.falhas = {}  # balde -> horários das tentativas que contam
        self.modos = {}   # sha256(token da sessão) -> {"cookie": sha256(token do modo), "inicio", "ate"}; nunca no disco
        convites = _ler(self.arq_convites, {})   # id -> {"sha", "nome", "andares", "criado", "expira"}; ilegível = nenhum
        self.convites = {k: c for k, c in convites.items() if isinstance(c, dict) and isinstance(c.get("sha"), str)
                         and isinstance(c.get("andares"), list)} if isinstance(convites, dict) else {}
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

    def _gravar_usuarios(self, novos):
        try:
            _gravar(self.arq_usuarios, novos)
        except OSError as x:
            raise NaoGravou(type(x).__name__) from x
        self.usuarios = novos

    def _gravar_sessoes(self, novas):
        try:
            _gravar(self.arq_sessoes, novas)
        except OSError as x:
            raise NaoGravou(type(x).__name__) from x
        self.sessoes = novas

    def _derrubar_sessoes(self, derrubadas):
        novas = {k: v for k, v in self.sessoes.items() if k not in derrubadas}
        self._gravar_sessoes(novas)
        self.modos = {k: v for k, v in self.modos.items() if k in novas}
        return len(derrubadas)

    def _derrubar_sessoes_de(self, nome_u):
        """Derruba as sessões (e modos resposta) com esse nome de usuário, chamar com a trava. Também serve para a conta
        nova de um nome que já existiu: o cookie de um aparelho perdido não volta a valer."""
        derrubadas = {k for k, v in self.sessoes.items() if v.get("usuario") == nome_u}
        return self._derrubar_sessoes(derrubadas) if derrubadas else 0

    def _exige_nao_ultimo_admin(self, usuario):
        if _papel_de(self.usuarios.get(usuario), ANDAR_PRINCIPAL) == "admin":
            admins = sum(1 for u in self.usuarios.values() if _papel_de(u, ANDAR_PRINCIPAL) == "admin")
            if admins <= 1:
                raise UltimoAdmin("o escritório precisa ter pelo menos um administrador")

    def _criar(self, usuario, senha):
        usuario = _normalizar_usuario(usuario)
        if not USUARIO_OK.fullmatch(usuario):
            raise ValueError("usuário: 3 a 32 caracteres, letras minúsculas, números, ponto, hífen ou sublinhado")
        _validar_senha(senha)
        self._derrubar_sessoes_de(usuario)
        sal = secrets.token_bytes(16)
        novos = {**self.usuarios, usuario: {
            "sal": sal.hex(), "hash": _hash(senha, sal).hex(), "n": N, "r": R, "p": P,
            "criado": int(time.time()), "andares": {ANDAR_PRINCIPAL: "admin"},
        }}
        self._gravar_usuarios(novos)

    # --- contas, papéis e perfil
    def papel(self, usuario, andar=ANDAR_PRINCIPAL):
        """Papel do usuário no andar ("admin", "membro" ou None). Falha fechada para papel desconhecido."""
        return _papel_de(self.usuarios.get(_normalizar_usuario(usuario)), andar)

    def perfil(self, usuario):
        """Perfil público da própria conta (nunca sal/hash)."""
        nome_u = _normalizar_usuario(usuario)
        u = self.usuarios.get(nome_u)
        if not u:
            raise KeyError(usuario)
        return {"usuario": nome_u, "nome": u.get("nome") or nome_u, "avatar": _avatar_se_valido(u.get("avatar")),
                "papel": _papel_de(u, ANDAR_PRINCIPAL)}

    def contas(self):
        """Lista das contas para a tela de administração, sem sal nem hash. "andares": os que a conta vê, o principal
        primeiro (quem administra o principal vê todos, sem precisar estar na lista)."""
        itens = sorted(self.usuarios.items(), key=lambda par: (par[1].get("criado", 0), par[0]))
        return [{"usuario": nome_u, "nome": u.get("nome") or nome_u, "papel": _papel_de(u, ANDAR_PRINCIPAL),
                 "andares": _andares_de(u), "criado": u.get("criado", 0)} for nome_u, u in itens]

    def mudar_papel(self, usuario, papel):
        """Altera o papel do usuário no andar principal (vale na hora). Protege o último admin."""
        if papel not in PAPEIS:
            raise ValueError("papel inválido (use admin ou membro)")
        nome_u = _normalizar_usuario(usuario)
        with self.trava:
            u = self.usuarios.get(nome_u)
            if not u:
                raise KeyError(usuario)
            if papel != "admin":
                self._exige_nao_ultimo_admin(nome_u)
            andares = dict(u["andares"]) if isinstance(u.get("andares"), dict) else {}
            andares[ANDAR_PRINCIPAL] = papel
            novos = {**self.usuarios, nome_u: {**u, "andares": andares}}
            self._gravar_usuarios(novos)

    def definir_andares(self, usuario, andares):
        """Os andares extras que a conta vê, como membro (o principal fica sempre, com o papel que já tinha). Vale no
        próximo pedido: o escritório confere o andar a cada pedido."""
        extras = _andares_validos(andares)
        nome_u = _normalizar_usuario(usuario)
        with self.trava:
            u = self.usuarios.get(nome_u)
            if not u:
                raise KeyError(usuario)
            principal = _papel_de(u, ANDAR_PRINCIPAL) or "membro"
            novos = {**self.usuarios, nome_u: {**u, "andares": {ANDAR_PRINCIPAL: principal, **{a: "membro" for a in extras}}}}
            self._gravar_usuarios(novos)

    def remover(self, usuario):
        """Remove a conta, suas sessões e modos resposta. Protege o último admin. Devolve o nome normalizado da conta.
        As sessões caem antes da conta sair do disco: se a gravação da conta falhar, nenhum cookie dela fica valendo."""
        nome_u = _normalizar_usuario(usuario)
        with self.trava:
            if nome_u not in self.usuarios:
                raise KeyError(usuario)
            self._exige_nao_ultimo_admin(nome_u)
            self._derrubar_sessoes_de(nome_u)
            self._gravar_usuarios({k: v for k, v in self.usuarios.items() if k != nome_u})
            self.falhas.pop(nome_u, None)
        return nome_u

    def salvar_perfil(self, usuario, nome, avatar):
        """Salva nome e avatar da conta e devolve o perfil atualizado."""
        nome_limpo = _validar_nome(nome)
        avatar_limpo = _validar_avatar(avatar)
        nome_u = _normalizar_usuario(usuario)
        with self.trava:
            u = self.usuarios.get(nome_u)
            if not u:
                raise KeyError(usuario)
            novos = {**self.usuarios, nome_u: {**u, "nome": nome_limpo, "avatar": avatar_limpo}}
            self._gravar_usuarios(novos)
        return self.perfil(nome_u)

    # --- convites: a conta de membro nasce de um link pessoal de uso único
    def _convites_vivos(self, agora):
        return {k: c for k, c in self.convites.items() if c.get("expira", 0) > agora}

    def convidar(self, nome, andares, agora=None):
        """Convite pessoal (papel membro) para o nome sugerido e os andares dados. Devolve (token, convite público):
        o token sai só aqui, uma vez; no disco fica só o sha256. Até CONVITES_MAX pendentes, cada um por 48 h."""
        agora = time.time() if agora is None else agora
        nome_limpo, extras = _validar_nome(nome), _andares_validos(andares)
        token = secrets.token_urlsafe(32)
        with self.trava:
            vivos = self._convites_vivos(agora)
            if len(vivos) >= CONVITES_MAX:
                raise ConvitesDemais(f"já há {CONVITES_MAX} convites esperando; revogue algum antes")
            id_convite = secrets.token_hex(4)
            convite = {"sha": _sha(token), "nome": nome_limpo, "andares": [ANDAR_PRINCIPAL, *extras],
                       "criado": int(agora), "expira": int(agora + CONVITE_VALIDADE)}
            self._gravar_convites({**vivos, id_convite: convite})
        return token, _convite_publico(id_convite, convite)

    def convites_pendentes(self, agora=None):
        """Os convites que ainda valem, sem o sha (a tela de administração)."""
        agora = time.time() if agora is None else agora
        with self.trava:
            vivos = self._convites_vivos(agora)
        return sorted((_convite_publico(k, c) for k, c in vivos.items()), key=lambda c: c["expira"])

    def revogar_convite(self, id_convite):
        with self.trava:
            if id_convite not in self.convites:
                raise KeyError(id_convite)
            self._gravar_convites({k: c for k, c in self.convites.items() if k != id_convite})

    def _achar_convite(self, token, agora):
        """(id, convite) do token, só se ainda vale; chamar com a trava."""
        sha = _sha(token) if isinstance(token, str) and 20 <= len(token) <= 64 else ""
        for k, c in self._convites_vivos(agora).items():
            if sha and hmac.compare_digest(c["sha"], sha):
                return k, c
        raise ConviteInvalido("esse convite não vale mais: peça um novo a quem administra o escritório")

    def ver_convite(self, token, agora=None):
        """O nome sugerido e a validade, para a página do convite preencher antes de pedir a senha."""
        agora = time.time() if agora is None else agora
        with self.trava:
            _, c = self._achar_convite(token, agora)
        return {"nome": c["nome"], "expira": _iso(c["expira"])}

    def aceitar_convite(self, token, usuario, senha, nome, avatar, agora=None):
        """Cria a conta de membro com a senha que a própria pessoa escolheu e devolve o token da sessão já aberta.
        O convite é gasto antes da conta ser gravada, sob a trava: dois aceites ao mesmo tempo criam uma conta só, e uma
        falha de disco no meio nunca deixa o convite valendo para uma segunda conta."""
        agora = time.time() if agora is None else agora
        nome_u = _normalizar_usuario(usuario)
        if not USUARIO_OK.fullmatch(nome_u):
            raise ValueError("usuário: 3 a 32 caracteres, letras minúsculas, números, ponto, hífen ou sublinhado")
        _validar_senha(senha)
        nome_limpo, avatar_limpo = _validar_nome(nome), _validar_avatar(avatar)
        with self.trava:   # convite inválido ou usuário tomado respondem antes do scrypt
            self._achar_convite(token, agora)
            if nome_u in self.usuarios:
                raise ContaExiste("esse usuário já existe; escolha outro")
        sal = secrets.token_bytes(16)
        h = _hash(senha, sal)
        with self.trava:
            id_convite, c = self._achar_convite(token, agora)
            if nome_u in self.usuarios:
                raise ContaExiste("esse usuário já existe; escolha outro")
            self._derrubar_sessoes_de(nome_u)   # sessões de uma conta antiga com o mesmo nome não passam para a nova
            self._gravar_convites({k: v for k, v in self.convites.items() if k != id_convite})
            self._gravar_usuarios({**self.usuarios, nome_u: {
                "sal": sal.hex(), "hash": h.hex(), "n": N, "r": R, "p": P, "criado": int(agora), "nome": nome_limpo,
                "avatar": avatar_limpo, "andares": {a: "membro" for a in c["andares"]}}})
            return self._nova_sessao(nome_u)

    def _gravar_convites(self, novos):
        try:
            _gravar(self.arq_convites, novos)
        except OSError as x:
            raise NaoGravou(type(x).__name__) from x
        self.convites = novos

    # --- login
    def conferir(self, usuario, senha):
        """Confere a senha no balde de tentativas do login, sem criar sessão. Devolve o nome normalizado ou levanta
        PermissionError (errar conta no mesmo balde: 8 erros travam também o login)."""
        nome = _normalizar_usuario(usuario)
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
        with self.trava:
            return self._nova_sessao(nome)

    def _nova_sessao(self, nome):
        """Abre uma sessão para a conta (chamar com a trava) e devolve o token do cookie."""
        token = secrets.token_urlsafe(32)
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
        """"Sair de todos os aparelhos": confere a senha do usuário da sessão no balde do login e derruba só as
        sessões e modos resposta desse usuário. Devolve quantas sessões saíram; senão levanta PermissionError (sessão ou
        senha) ou NaoGravou (disco)."""
        usuario = self.sessao(token)
        if not usuario:
            raise PermissionError("entre de novo")
        self.conferir(usuario, senha)
        with self.trava:   # grava antes de trocar a memória: se o disco falhar, nada muda
            derrubadas = {k for k, v in self.sessoes.items() if v.get("usuario") == usuario}
            return self._derrubar_sessoes(derrubadas)

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


def _normalizar_usuario(usuario):
    return usuario.strip().lower() if isinstance(usuario, str) else ""


def _validar_senha(senha):
    if not isinstance(senha, str) or len(senha) < SENHA_MIN or len(senha) > 256:
        raise ValueError(f"a senha precisa ter pelo menos {SENHA_MIN} caracteres")


def _validar_nome(nome):
    if not isinstance(nome, str):
        raise ValueError("nome inválido")
    if any(unicodedata.category(c) in ("Cc", "Cf", "Cs") for c in nome):
        raise ValueError("nome não pode conter caractere de controle")
    limpo, cortado = ajustes.limpa_texto(nome, NOME_MAX)
    limpo = limpo.strip()
    if cortado or not limpo:
        raise ValueError(f"nome: de 1 a {NOME_MAX} caracteres")
    return limpo


def _validar_avatar(avatar):
    if not isinstance(avatar, dict) or set(avatar) != {"color", "eyes", "accessory"} \
            or not all(isinstance(v, str) for v in avatar.values()) \
            or avatar["color"] not in ajustes.CORES \
            or avatar["eyes"] not in ajustes.OLHOS \
            or avatar["accessory"] not in ajustes.ACESSORIOS:
        raise ValueError("avatar: escolha cor, olhos e acessório da lista")
    return {"color": avatar["color"], "eyes": avatar["eyes"], "accessory": avatar["accessory"]}


def _avatar_se_valido(avatar):
    try:
        return _validar_avatar(avatar)
    except ValueError:
        return None


def _andares_validos(andares):
    """Os ids de andares extras de uma lista (o principal sai: ele é sempre de todos), sem repetição e em ordem."""
    if not isinstance(andares, list) or len(andares) > 16 or not all(isinstance(a, str) for a in andares):
        raise ValueError("andares inválidos")
    extras = [a for a in dict.fromkeys(andares) if a != ANDAR_PRINCIPAL]
    if not all(ANDAR_OK.fullmatch(a) for a in extras):
        raise ValueError("andares inválidos")
    return extras


def _andares_de(u):
    andares = u.get("andares") if isinstance(u.get("andares"), dict) else {ANDAR_PRINCIPAL: "admin"} if "andares" not in u else {}
    vistos = [a for a, p in andares.items() if p in PAPEIS]
    return sorted(vistos, key=lambda a: (a != ANDAR_PRINCIPAL, a))


def _convite_publico(id_convite, c):
    return {"id": id_convite, "nome": c["nome"], "andares": list(c["andares"]), "expira": _iso(c["expira"])}


def _iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _papel_de(u, andar=ANDAR_PRINCIPAL):
    if not u:
        return None
    if "andares" not in u:
        return "admin" if andar == ANDAR_PRINCIPAL else None
    andares = u["andares"]
    if not isinstance(andares, dict):
        return None
    p = andares.get(andar)
    return p if p in PAPEIS else None


def _segundos(x):
    """Segundos que faltam, arredondados para cima (a tela mostra "fecha em"; quem decide é o servidor)."""
    return -int(-x // 1)


def _sha(token):
    return hashlib.sha256(token.encode()).hexdigest()
