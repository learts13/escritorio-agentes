# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Conversas da equipe que ficam no disco: um banco SQLite por andar (dados/andares/<id>/equipe.db; o principal, ou o
saguão no modo saguão, em dados/equipe.db), em WAL, com uma conexão só, sob uma trava, e permissão 0600.

Só stdlib, sem HTTP, sem rede e sem log: o escritorio.py confere sessão, papel e andar antes e passa quem pediu (login
e nome saem da conta, nunca do cliente). Aqui ficam os limites, as fronteiras de DM e o que vai para o disco.

- Canal: "geral" do andar, "sala:<chave>" (uma sala do mapa) ou "dm:<n>" (mensagem direta, aberta por abrir_dm). A sala
  não é fronteira entre pessoas do andar (quem tem papel no andar lê canal e geral); a DM é: só os dois leem e escrevem.
  DM que não existe ou não é da pessoa levanta SemAcesso, a mesma resposta para os dois casos (404 na rota).
- Apagar apaga de verdade: o texto some da tabela e do índice da busca (FTS5), com secure_delete, o índice otimizado e o
  WAL zerado, para o texto não ficar em página livre nem no diário. A mensagem fica como "apagada", sem texto.
- Retenção por empresa (padrão 1 ano; o admin pode baixar para 90 ou 30 dias) e teto do banco (200 MB por andar: passou,
  saem as mais antigas e uso() avisa). O registro de acesso às DMs vence em 1 ano.
- Conta que saiu do andar: as mensagens ficam como "ex-membro", as reações e leituras saem, e a DM perde a ponta dela (o
  mesmo login, se voltar, não herda a conversa).
- Auditoria de DM (o admin da empresa lê com registro): o registro guarda quem leu, o par, quando e quantas mensagens,
  nunca o texto; ler pela auditoria não marca como lida; os dois participantes veem as datas.
- Anexos: só os metadados ficam no banco; o arquivo fica em anexos/<token> (token_hex(16), sem o nome do cliente). A cota
  da empresa é reservada antes de ler o corpo (reservar), e o envio confirma (anexar) ou devolve (liberar).
- Reuniões (Onda 3): o link fixo de cada sala (só https, host numa lista fechada, sem credencial no endereço) e a
  agenda do andar (título, sala, início, duração, convidados). O aviso 5 min antes sai uma vez por reunião (mudar o
  horário rearma). A agenda segue a retenção do andar.
- O saguão não tem DM, anexo nem reunião.
"""
import os
import re
import secrets
import sqlite3
import threading
import time
import unicodedata
import urllib.parse

from acesso import USUARIO_OK
from presenca import Limite, limpar_texto

ARQ = "equipe.db"
ANEXOS = "anexos"
DIA = 86400
RETENCAO_PADRAO, RETENCOES = 365, (30, 90, 365)   # D3: 1 ano; a empresa só baixa
REGISTRO_DIAS = 365   # o registro de acesso às DMs
TETO_BANCO = 200 * 1024 * 1024
COTA_ANEXOS = 5 * 1024 ** 3   # D6 b: 5 GB por empresa
ANEXO_MAX = 25 * 1024 * 1024   # D6 b: 25 MiB por arquivo
RESERVA_VIDA = 300   # a reserva de cota de um envio que não confirmou nem devolveu
LIMITE_PADRAO, LIMITE_MAX = 50, 200
MURAL_MAX, MURAL_TEXTO_MAX = 10, 280
NOME_ARQUIVO_MAX = 120
EMOJIS = ("👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "👀")
EX_MEMBRO = "ex-membro"
SALA_MAX = 80
BUSCA_MAX, BUSCA_TERMOS = 100, 8
STATUS, STATUS_PADRAO, STATUS_TEXTO_MAX = ("disponivel", "ocupado", "reuniao", "ausente"), "disponivel", 40
NOVAS_MAX = 50   # as mensagens novas do canal aberto que vão no /api/ao-vivo
CONTAGEM_MAX = 100   # não lidas e menções contam até aqui por canal (a tela mostra "9+"): o poll não varre o ano todo
TOKEN_OK = re.compile(r"[0-9a-f]{32}")
SHA_OK = re.compile(r"[0-9a-f]{64}")
TIPO_OK = re.compile(r"[a-z]+/[a-z0-9.+-]{1,80}")
DM_OK = re.compile(r"dm:([1-9][0-9]{0,17})")
PALAVRA = re.compile(r"\w+")
# Onda 3 (B4, D9 a): o link externo fixo por sala e a agenda
HOSTS_REUNIAO = ("meet.google.com", "*.zoom.us", "meet.jit.si", "teams.microsoft.com", "whereby.com")
LINK_MAX = 500
LINK_OK = re.compile(r"[!#-;=?-\[\]_a-z~]+")   # ASCII visível (minúsculo) sem espaço, aspas, < > \ ^ crase { | }
ROTULO_OK = re.compile(r"[a-z0-9]([a-z0-9-]*[a-z0-9])?")   # cada pedaço do host entre os pontos
TITULO_MAX, DURACAO_MIN, DURACAO_MAX, CONVIDADOS_MAX = 80, 5, 480, 50
REUNIOES_MAX = 500   # reuniões por vir, por andar
AVISO_ANTES = 300    # o aviso pessoal sai 5 min antes

ESQUEMA = """
CREATE TABLE IF NOT EXISTS ajuste (chave TEXT PRIMARY KEY, valor INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS canal (id INTEGER PRIMARY KEY, chave TEXT UNIQUE, dm INTEGER NOT NULL DEFAULT 0, u1 TEXT, u2 TEXT);
CREATE TABLE IF NOT EXISTS mensagem (id INTEGER PRIMARY KEY AUTOINCREMENT, canal INTEGER NOT NULL, autor TEXT, nome TEXT,
                                     texto TEXT, em REAL NOT NULL);
CREATE INDEX IF NOT EXISTS mensagem_canal ON mensagem (canal, id);
CREATE INDEX IF NOT EXISTS mensagem_em ON mensagem (em);
CREATE TABLE IF NOT EXISTS leitura (canal INTEGER NOT NULL, usuario TEXT NOT NULL, ultima INTEGER NOT NULL,
                                    PRIMARY KEY (canal, usuario));
CREATE TABLE IF NOT EXISTS reacao (mensagem INTEGER NOT NULL, usuario TEXT NOT NULL, emoji TEXT NOT NULL,
                                   PRIMARY KEY (mensagem, usuario, emoji));
CREATE TABLE IF NOT EXISTS mural (id INTEGER PRIMARY KEY AUTOINCREMENT, canal INTEGER NOT NULL, autor TEXT, nome TEXT,
                                  texto TEXT NOT NULL, em REAL NOT NULL);
CREATE TABLE IF NOT EXISTS anexo (id INTEGER PRIMARY KEY AUTOINCREMENT, mensagem INTEGER NOT NULL UNIQUE,
                                  token TEXT NOT NULL UNIQUE, nome TEXT NOT NULL, tipo TEXT NOT NULL,
                                  tamanho INTEGER NOT NULL, sha256 TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS acesso_dm (id INTEGER PRIMARY KEY, canal INTEGER NOT NULL, admin TEXT NOT NULL, u1 TEXT,
                                      u2 TEXT, quando REAL NOT NULL, quantas INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mencao (mensagem INTEGER NOT NULL, usuario TEXT NOT NULL, PRIMARY KEY (mensagem, usuario));
CREATE INDEX IF NOT EXISTS mencao_usuario ON mencao (usuario, mensagem);
CREATE TABLE IF NOT EXISTS status (usuario TEXT PRIMARY KEY, status TEXT NOT NULL, texto TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sala_link (sala TEXT PRIMARY KEY, url TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS reuniao (id INTEGER PRIMARY KEY AUTOINCREMENT, titulo TEXT NOT NULL, sala TEXT NOT NULL,
                                    inicio INTEGER NOT NULL, duracao INTEGER NOT NULL, autor TEXT, nome TEXT,
                                    avisada INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS reuniao_inicio ON reuniao (inicio);
CREATE TABLE IF NOT EXISTS convidado (reuniao INTEGER NOT NULL, usuario TEXT NOT NULL, PRIMARY KEY (reuniao, usuario));
CREATE INDEX IF NOT EXISTS convidado_usuario ON convidado (usuario);
CREATE VIRTUAL TABLE IF NOT EXISTS fts USING fts5(texto, content='mensagem', content_rowid='id',
                                                  tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS fts_novo AFTER INSERT ON mensagem WHEN new.texto IS NOT NULL BEGIN
  INSERT INTO fts (rowid, texto) VALUES (new.id, new.texto); END;
CREATE TRIGGER IF NOT EXISTS fts_fora AFTER DELETE ON mensagem WHEN old.texto IS NOT NULL BEGIN
  INSERT INTO fts (fts, rowid, texto) VALUES ('delete', old.id, old.texto); END;
CREATE TRIGGER IF NOT EXISTS fts_trocou AFTER UPDATE OF texto ON mensagem BEGIN
  INSERT INTO fts (fts, rowid, texto) SELECT 'delete', old.id, old.texto WHERE old.texto IS NOT NULL;
  INSERT INTO fts (rowid, texto) SELECT new.id, new.texto WHERE new.texto IS NOT NULL; END;
"""


class SemAcesso(LookupError):
    """Não existe ou não é de quem pediu (a mesma resposta para os dois: 404 na rota). A mensagem é uma só em todos os
    casos, para não dizer o que existe."""

    def __init__(self):
        super().__init__("não encontrado")


class CotaCheia(Exception):
    """A cota de anexos da empresa não comporta o envio."""


class SalaOcupada(Exception):
    """Outra reunião cruza o mesmo horário na mesma sala."""


class AgendaCheia(Exception):
    """O andar já tem REUNIOES_MAX reuniões por vir."""


def _iso(t):
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _usuario(u):
    if not isinstance(u, str) or not USUARIO_OK.fullmatch(u):
        raise ValueError("usuário inválido")
    return u


def _inteiro(x, minimo, maximo, msg):
    if type(x) is not int or not minimo <= x <= maximo:   # type(): o True não vale como 1
        raise ValueError(msg)
    return x


def _nome(nome):
    if not isinstance(nome, str) or not 1 <= len(nome) <= 80:
        raise ValueError("nome inválido")
    return nome


def _visivel(s):
    """Sem controle, invisível nem bidi (U+202A-202E, U+2066-2069 são Cf)."""
    return all(unicodedata.category(c) not in ("Cc", "Cf", "Cs", "Co", "Cn") for c in s)


def _canal(ref):
    """("chave", None) para geral e sala, (None, id) para DM. Fora do formato: ValueError."""
    if ref == "geral":
        return "geral", None
    if isinstance(ref, str) and ref.startswith("sala:") and 1 <= len(ref) - 5 <= SALA_MAX and _visivel(ref):
        return ref, None
    m = DM_OK.fullmatch(ref) if isinstance(ref, str) else None
    if m:
        return None, int(m.group(1))
    raise ValueError("canal inválido")


def _nome_arquivo(nome):
    if not isinstance(nome, str) or not 1 <= len(nome) <= NOME_ARQUIVO_MAX or nome in (".", "..") \
            or any(c in nome for c in "/\\:") or not _visivel(nome):
        raise ValueError("nome de arquivo inválido")
    return nome


def hosts_reuniao(extra=None):
    """Os hosts aceitos no link da sala: a lista fechada e, no fim, o Jitsi próprio da instalação (um host exato)."""
    return [*HOSTS_REUNIAO, *([extra] if extra else [])]


def validar_link(url, extra=None):
    """O link fixo da sala: https, host da lista (o *.zoom.us vale para zoom.us e os subdomínios), sem usuário nem senha
    no endereço, sem porta e só ASCII visível. Devolve a URL como veio; fora disso, ValueError."""
    if not isinstance(url, str) or not 1 <= len(url) <= LINK_MAX or not url.isascii():
        raise ValueError("link")   # isascii antes do lower: o K de kelvin (U+212A) vira "k"
    if not LINK_OK.fullmatch(url.lower()):
        raise ValueError("link")
    partes = urllib.parse.urlsplit(url)
    if partes.scheme.lower() != "https" or "@" in partes.netloc or ":" in partes.netloc:
        raise ValueError("link")
    host = partes.netloc.lower()
    if not all(ROTULO_OK.fullmatch(rotulo) for rotulo in host.split(".")):
        raise ValueError("link")
    for aceito in hosts_reuniao(extra):
        if host == aceito or (aceito.startswith("*.") and (host == aceito[2:] or host.endswith(aceito[1:]))):
            return url
    raise ValueError("link")


def _titulo(titulo):
    if not isinstance(titulo, str):
        raise ValueError("título inválido")
    titulo = titulo.strip()
    if not 1 <= len(titulo) <= TITULO_MAX or not _visivel(titulo):
        raise ValueError(f"O título vai de 1 a {TITULO_MAX} caracteres, sem símbolos invisíveis.")
    return titulo


def _convidados(lista):
    if not isinstance(lista, list) or len(lista) > CONVIDADOS_MAX or len(set(map(str, lista))) != len(lista):
        raise ValueError(f"Até {CONVIDADOS_MAX} convidados, sem repetir.")
    return sorted(_usuario(u) for u in lista)


class Equipe:
    def __init__(self, pasta, relogio=time.time, teto_banco=TETO_BANCO, cota_anexos=COTA_ANEXOS, saguao=False):
        self.relogio, self.teto_banco, self.cota_anexos, self.saguao = relogio, teto_banco, cota_anexos, saguao
        self.pasta_anexos = os.path.join(pasta, ANEXOS)
        self.trava = threading.Lock()
        self.reservas = {}   # token -> (usuario, tamanho, instante); só na memória: reiniciar devolve tudo
        self.dms_abertas = {}   # id da DM -> quando foi aberta: a varredura não tira a DM vazia de quem acabou de abrir
        self.vezes = {}      # (tipo, usuario) -> instante do último pedido limitado (busca, auditoria)
        self.contados = (None, {})   # (total_changes do banco, {usuario: contadores}): o poll sem escrita no meio não relê
        os.makedirs(pasta, mode=0o700, exist_ok=True)
        caminho = os.path.join(pasta, ARQ)
        os.close(os.open(caminho, os.O_CREAT | os.O_RDWR, 0o600))   # o -wal e o -shm herdam a permissão
        self.con = sqlite3.connect(caminho, check_same_thread=False)
        try:
            self.con.execute("PRAGMA journal_mode=WAL")
            self.con.execute("PRAGMA secure_delete=ON")
            self.con.executescript(ESQUEMA)
        except sqlite3.OperationalError as x:
            self.con.close()
            if "fts5" in str(x):
                raise RuntimeError("o SQLite deste Python não tem FTS5") from None
            raise
        try:   # SQLite 3.42+: o FTS5 tira a entrada do índice na hora; antes disso, o índice é otimizado a cada apagar
            if self.con.execute("SELECT v FROM fts_config WHERE k = 'secure-delete'").fetchone() != (1,):
                with self.con:   # só na primeira vez: abrir para ler não muda o arquivo
                    self.con.execute("INSERT INTO fts (fts, rank) VALUES ('secure-delete', 1)")
            self.otimizar = False
        except sqlite3.OperationalError:
            self.otimizar = True
        # o status de cada conta fica na memória também: o /api/ao-vivo lê o de todo mundo a cada pedido
        self.status = {u: {"status": s, "texto": t} for u, s, t in self.con.execute("SELECT usuario, status, texto FROM status")}
        # a versão de cada canal (muda ao apagar e ao reagir): só na memória, com uma base sorteada para não repetir um
        # valor de antes de reiniciar
        self.base_versao, self.versoes = secrets.randbelow(2 ** 40), {}
        self.versao_agenda = 0   # muda a cada marcar, editar ou cancelar (o reunioes_v do /api/ao-vivo)

    def fechar(self):
        with self.trava:
            self.con.close()

    # --- por dentro (chamar com a trava)
    def _ajuste(self, chave, padrao):
        linha = self.con.execute("SELECT valor FROM ajuste WHERE chave=?", (chave,)).fetchone()
        return linha[0] if linha else padrao

    def _por_vez(self, tipo, usuario, agora):
        """1 pedido por segundo por pessoa (busca e auditoria)."""
        antes = self.vezes.get((tipo, usuario))
        if antes is not None and agora - antes < 1:
            raise Limite("Devagar: pedidos demais em pouco tempo.")
        if len(self.vezes) > 1000:
            self.vezes = {k: v for k, v in self.vezes.items() if agora - v < 60}
        self.vezes[(tipo, usuario)] = agora

    def _dm(self, id_canal, usuario):
        """A DM, só para quem é uma das pontas (a ponta que saiu fica None: None nunca é ponta)."""
        usuario = _usuario(usuario)
        linha = self.con.execute("SELECT u1, u2 FROM canal WHERE id=? AND dm=1", (id_canal,)).fetchone()
        if linha is None or usuario not in linha:
            raise SemAcesso()
        return linha

    def _ler_canal(self, ref, usuario):
        """O id do canal para ler (None: canal de sala ou geral que ainda não tem mensagem)."""
        chave, id_dm = _canal(ref)
        if id_dm is not None:
            self._dm(id_dm, usuario)
            return id_dm
        linha = self.con.execute("SELECT id FROM canal WHERE chave=? AND dm=0", (chave,)).fetchone()
        return linha[0] if linha else None

    def _escrever_canal(self, ref, usuario):
        chave, id_dm = _canal(ref)
        if id_dm is not None:
            if None in self._dm(id_dm, usuario):
                raise ValueError("A outra pessoa não está mais no andar.")
            return id_dm
        self.con.execute("INSERT OR IGNORE INTO canal (chave) VALUES (?)", (chave,))
        return self.con.execute("SELECT id FROM canal WHERE chave=? AND dm=0", (chave,)).fetchone()[0]

    def _mensagens(self, onde, params, usuario):
        linhas = self.con.execute(
            "SELECT m.id, m.canal, c.dm, c.chave, m.autor, m.nome, m.texto, m.em, a.id, a.nome, a.tipo, a.tamanho "
            "FROM mensagem m JOIN canal c ON c.id = m.canal LEFT JOIN anexo a ON a.mensagem = m.id "
            f"WHERE {onde}", params).fetchall()
        reacoes = {}
        if linhas:
            marcas = ",".join("?" * len(linhas))
            for msg, emoji, n, eu in self.con.execute(
                    f"SELECT mensagem, emoji, COUNT(*), SUM(usuario = ?) FROM reacao WHERE mensagem IN ({marcas}) "
                    "GROUP BY mensagem, emoji", (usuario, *(r[0] for r in linhas))):
                reacoes.setdefault(msg, {})[emoji] = {"emoji": emoji, "n": n, "eu": bool(eu)}
        saida = []
        for id_m, id_c, dm, chave, autor, nome, texto, em, id_a, nome_a, tipo, tamanho in linhas:
            por_emoji = reacoes.get(id_m, {})
            saida.append({"id": id_m, "canal": f"dm:{id_c}" if dm else chave, "usuario": autor,
                          "nome": nome if autor is not None else EX_MEMBRO, "texto": texto, "apagada": texto is None,
                          "em": _iso(em), "reacoes": [por_emoji[e] for e in EMOJIS if e in por_emoji],
                          "anexo": {"id": id_a, "nome": nome_a, "tipo": tipo, "tamanho": tamanho} if id_a else None})
        return saida

    def _apagar_linhas(self, ids):
        """Tira as mensagens (e os seus anexos e reações) do banco. Devolve os tokens dos arquivos para apagar."""
        tokens = []
        for i in range(0, len(ids), 500):
            lote = ids[i:i + 500]
            marcas = ",".join("?" * len(lote))
            tokens += [t for (t,) in self.con.execute(f"SELECT token FROM anexo WHERE mensagem IN ({marcas})", lote)]
            self.con.execute(f"DELETE FROM anexo WHERE mensagem IN ({marcas})", lote)
            self.con.execute(f"DELETE FROM reacao WHERE mensagem IN ({marcas})", lote)
            self.con.execute(f"DELETE FROM mencao WHERE mensagem IN ({marcas})", lote)
            self.con.execute(f"DELETE FROM mensagem WHERE id IN ({marcas})", lote)
        return tokens

    def _apagar_arquivos(self, tokens):
        for token in tokens:
            try:
                os.unlink(os.path.join(self.pasta_anexos, token))
            except FileNotFoundError:
                pass

    def _limpar_disco(self):
        """Depois de apagar: o índice da busca sem as entradas velhas e o WAL zerado (o texto não fica no diário)."""
        if self.otimizar:
            with self.con:
                self.con.execute("INSERT INTO fts (fts) VALUES ('optimize')")
        self.con.execute("PRAGMA wal_checkpoint(TRUNCATE)")

    def _uso_banco(self):
        paginas = self.con.execute("PRAGMA page_count").fetchone()[0] - self.con.execute("PRAGMA freelist_count").fetchone()[0]
        return paginas * self.con.execute("PRAGMA page_size").fetchone()[0]

    def _cortar_pelo_teto(self):
        """Passou do teto: saem as mais antigas até 80% dele (a folga evita cortar a cada mensagem)."""
        cortadas = 0
        while self._uso_banco() > 0.8 * self.teto_banco:
            total = self.con.execute("SELECT COUNT(*) FROM mensagem").fetchone()[0]
            if not total:
                break
            with self.con:
                ids = [i for (i,) in self.con.execute("SELECT id FROM mensagem ORDER BY id LIMIT ?", (max(10, total // 10),))]
                self._apagar_arquivos(self._apagar_linhas(ids))
            cortadas += len(ids)
            self._limpar_disco()
        if cortadas:
            with self.con:
                self.con.execute("INSERT INTO ajuste (chave, valor) VALUES ('cortadas_teto', ?) ON CONFLICT (chave) "
                                 "DO UPDATE SET valor = valor + excluded.valor", (cortadas,))
        return cortadas

    def _reservado(self, agora):
        self.reservas = {t: r for t, r in self.reservas.items() if agora - r[2] < RESERVA_VIDA}
        return sum(r[1] for r in self.reservas.values())

    def _limpar_temporarios(self, agora):
        """Os .tmp-<token> sem reserva viva e com mais de RESERVA_VIDA: o envio que caiu ou o de antes de reiniciar."""
        try:
            nomes = os.listdir(self.pasta_anexos)
        except FileNotFoundError:
            return
        for nome in nomes:
            if nome.startswith(".tmp-") and nome[5:] not in self.reservas:
                caminho = os.path.join(self.pasta_anexos, nome)
                try:
                    if agora - os.path.getmtime(caminho) > RESERVA_VIDA:
                        os.unlink(caminho)
                except OSError:   # sumiu ou está aberto (Windows): fica para a próxima varredura
                    pass

    def _inserir(self, id_canal, autor, nome, texto, agora):
        cur = self.con.execute("INSERT INTO mensagem (canal, autor, nome, texto, em) VALUES (?, ?, ?, ?, ?)",
                               (id_canal, autor, nome, texto, agora))
        return cur.lastrowid

    def _mudou(self, ref):
        self.versoes[ref] = self.versoes.get(ref, 0) + 1

    # --- mensagens
    def enviar(self, canal, usuario, nome, texto, mencoes=()):
        """Uma mensagem no canal. mencoes: os logins citados com @, já conferidos pelo escritorio.py contra quem tem papel
        no andar (em DM não contam: a DM já avisa). Devolve a mensagem como o histórico a mostra."""
        usuario, nome, limpo = _usuario(usuario), _nome(nome), limpar_texto(texto)
        citados = {_usuario(u) for u in mencoes} - {usuario}
        with self.trava:
            agora = self.relogio()
            with self.con:
                id_m = self._inserir(self._escrever_canal(canal, usuario), usuario, nome, limpo, agora)
                if _canal(canal)[1] is None:
                    self.con.executemany("INSERT INTO mencao (mensagem, usuario) VALUES (?, ?)",
                                         [(id_m, u) for u in sorted(citados)])
            msg = self._mensagens("m.id = ?", (id_m,), usuario)[0]
            if self._uso_banco() > self.teto_banco:
                self._cortar_pelo_teto()
            return msg

    def historico(self, usuario, canal, antes=None, limite=LIMITE_PADRAO, com_versao=False):
        """As mensagens mais novas do canal (antes do id dado), em ordem. com_versao: (mensagens, versão), a versão lida
        antes do SELECT e sob a mesma trava (o painel parte dela para o /api/ao-vivo)."""
        _inteiro(limite, 1, LIMITE_MAX, "limite inválido")
        if antes is not None:
            _inteiro(antes, 1, 2 ** 62, "antes inválido")
        with self.trava:
            v = self.base_versao + self.versoes.get(canal, 0)
            id_c = self._ler_canal(canal, usuario)
            onde = "m.canal = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?"
            msgs = [] if id_c is None else self._mensagens(onde, (id_c, antes or 2 ** 62, limite), usuario)[::-1]
        return (msgs, v) if com_versao else msgs

    def apagar(self, id_mensagem, usuario, moderador=False):
        """O autor apaga a própria; o moderador (admin da empresa no andar, do prédio no saguão) apaga qualquer uma em
        canal, nunca em DM. O texto e o anexo somem de verdade."""
        with self.trava:
            linha = self.con.execute("SELECT m.autor, c.dm, c.id, c.chave FROM mensagem m JOIN canal c ON c.id = m.canal "
                                     "WHERE m.id = ? AND m.texto IS NOT NULL", (id_mensagem,)).fetchone()
            if linha is None or not (linha[0] == usuario or moderador and not linha[1]):
                raise SemAcesso()
            with self.con:
                tokens = [t for (t,) in self.con.execute("SELECT token FROM anexo WHERE mensagem=?", (id_mensagem,))]
                self.con.execute("DELETE FROM anexo WHERE mensagem=?", (id_mensagem,))
                self.con.execute("DELETE FROM reacao WHERE mensagem=?", (id_mensagem,))
                self.con.execute("DELETE FROM mencao WHERE mensagem=?", (id_mensagem,))
                self.con.execute("UPDATE mensagem SET texto = NULL WHERE id=?", (id_mensagem,))
            self._mudou(f"dm:{linha[2]}" if linha[1] else linha[3])
            self._apagar_arquivos(tokens)
            self._limpar_disco()

    # --- leitura, reações e mural
    def marcar_lida(self, usuario, canal, ate):
        _inteiro(ate, 0, 2 ** 62, "id inválido")
        with self.trava:
            id_c = self._ler_canal(canal, usuario)
            if id_c is None:
                return
            with self.con:
                self.con.execute("INSERT INTO leitura (canal, usuario, ultima) VALUES (?, ?, ?) ON CONFLICT (canal, usuario) "
                                 "DO UPDATE SET ultima = MAX(ultima, excluded.ultima)", (id_c, usuario, ate))

    def nao_lidas(self, usuario, canais):
        """{canal: quantas} das mensagens dos outros depois da última lida."""
        with self.trava:
            saida = {}
            for ref in canais:
                id_c = self._ler_canal(ref, usuario)
                saida[ref] = 0 if id_c is None else self.con.execute(
                    "SELECT COUNT(*) FROM mensagem WHERE canal = ? AND texto IS NOT NULL AND (autor IS NULL OR autor <> ?) "
                    "AND id > COALESCE((SELECT ultima FROM leitura WHERE canal = ? AND usuario = ?), 0)",
                    (id_c, usuario, id_c, usuario)).fetchone()[0]
            return saida

    def reagir(self, usuario, id_mensagem, emoji, ligar):
        """Liga ou desliga a reação (uma por pessoa por emoji, da lista fechada)."""
        if emoji not in EMOJIS or type(ligar) is not bool:
            raise ValueError("reação inválida")
        with self.trava:
            linha = self.con.execute("SELECT c.id, c.dm, c.chave FROM mensagem m JOIN canal c ON c.id = m.canal "
                                     "WHERE m.id = ? AND m.texto IS NOT NULL", (id_mensagem,)).fetchone()
            if linha is None:
                raise SemAcesso()
            if linha[1]:
                self._dm(linha[0], usuario)
            with self.con:
                if ligar:
                    self.con.execute("INSERT OR IGNORE INTO reacao (mensagem, usuario, emoji) VALUES (?, ?, ?)",
                                     (id_mensagem, usuario, emoji))
                else:
                    self.con.execute("DELETE FROM reacao WHERE mensagem=? AND usuario=? AND emoji=?",
                                     (id_mensagem, usuario, emoji))
            self._mudou(f"dm:{linha[0]}" if linha[1] else linha[2])
            return self._mensagens("m.id = ?", (id_mensagem,), usuario)[0]

    def mural(self, canal):
        """Os avisos fixos do canal (geral ou sala), do mais antigo ao mais novo."""
        chave, id_dm = _canal(canal)
        if id_dm is not None:
            raise ValueError("canal inválido")
        with self.trava:
            linhas = self.con.execute("SELECT m.id, m.autor, m.nome, m.texto, m.em FROM mural m JOIN canal c ON c.id = m.canal "
                                      "WHERE c.chave = ? AND c.dm = 0 ORDER BY m.id", (chave,)).fetchall()
        return [{"id": i, "usuario": autor, "nome": nome if autor is not None else EX_MEMBRO, "texto": texto,
                 "em": _iso(em)} for i, autor, nome, texto, em in linhas]

    def fixar(self, canal, usuario, nome, texto):
        usuario, nome, limpo = _usuario(usuario), _nome(nome), limpar_texto(texto)
        if len(limpo) > MURAL_TEXTO_MAX:
            raise ValueError(f"O aviso passa de {MURAL_TEXTO_MAX} caracteres.")
        if _canal(canal)[1] is not None:
            raise ValueError("canal inválido")
        with self.trava:
            agora = self.relogio()
            with self.con:
                id_c = self._escrever_canal(canal, usuario)
                if self.con.execute("SELECT COUNT(*) FROM mural WHERE canal=?", (id_c,)).fetchone()[0] >= MURAL_MAX:
                    raise ValueError(f"O mural já tem {MURAL_MAX} avisos.")
                cur = self.con.execute("INSERT INTO mural (canal, autor, nome, texto, em) VALUES (?, ?, ?, ?, ?)",
                                       (id_c, usuario, nome, limpo, agora))
        return {"id": cur.lastrowid, "usuario": usuario, "nome": nome, "texto": limpo, "em": _iso(agora)}

    def desafixar(self, id_aviso, usuario, moderador=False):
        """Tira o aviso (o autor, ou o moderador). Devolve o canal dele."""
        with self.trava:
            linha = self.con.execute("SELECT m.autor, c.chave FROM mural m JOIN canal c ON c.id = m.canal WHERE m.id=?",
                                     (id_aviso,)).fetchone()
            if linha is None or not (linha[0] == usuario or moderador):
                raise SemAcesso()
            with self.con:
                self.con.execute("DELETE FROM mural WHERE id=?", (id_aviso,))
            return linha[1]

    # --- DM
    def abrir_dm(self, usuario, outro):
        """O canal da DM entre os dois ("dm:<n>"), criado na primeira vez. O escritorio.py confere que os dois têm papel
        no andar."""
        if self.saguao:
            raise SemAcesso()
        usuario, outro = _usuario(usuario), _usuario(outro)
        if usuario == outro:
            raise ValueError("DM com você mesmo")
        u1, u2 = sorted((usuario, outro))
        chave = f"dm:{u1}:{u2}"
        with self.trava:
            with self.con:
                self.con.execute("INSERT OR IGNORE INTO canal (chave, dm, u1, u2) VALUES (?, 1, ?, ?)", (chave, u1, u2))
                id_dm = self.con.execute("SELECT id FROM canal WHERE chave=?", (chave,)).fetchone()[0]
            self.dms_abertas[id_dm] = self.relogio()
            return f"dm:{id_dm}"

    def dms(self, usuario):
        """As DMs da pessoa, da mais recente para a mais antiga. "outro" None: a outra ponta saiu (ex-membro)."""
        with self.trava:
            linhas = self.con.execute(
                "SELECT c.id, c.u1, c.u2, (SELECT MAX(em) FROM mensagem WHERE canal = c.id), "
                "(SELECT COUNT(*) FROM mensagem WHERE canal = c.id AND texto IS NOT NULL AND (autor IS NULL OR autor <> ?) "
                " AND id > COALESCE((SELECT ultima FROM leitura WHERE canal = c.id AND usuario = ?), 0)) "
                "FROM canal c WHERE c.dm = 1 AND (c.u1 = ? OR c.u2 = ?)", (usuario,) * 4).fetchall()
        linhas.sort(key=lambda r: (r[3] or 0, r[0]), reverse=True)
        return [{"canal": f"dm:{i}", "outro": u2 if u1 == usuario else u1, "ultima": _iso(ultima) if ultima else None,
                 "nao_lidas": n} for i, u1, u2, ultima, n in linhas]

    # --- busca
    def buscar(self, usuario, termo, canais, limite=20):
        """Busca nos canais dados (os que a pessoa lê: geral e salas) e nas DMs dela. 1 por segundo por pessoa."""
        _inteiro(limite, 1, LIMITE_MAX, "limite inválido")
        if not isinstance(termo, str) or len(termo) > BUSCA_MAX:
            raise ValueError("busca inválida")
        chaves = []
        for ref in canais:
            chave, id_dm = _canal(ref)
            if id_dm is not None:
                raise ValueError("canal inválido")   # a DM entra sozinha, só as da própria pessoa
            chaves.append(chave)
        palavras = PALAVRA.findall(termo)[:BUSCA_TERMOS]
        with self.trava:
            self._por_vez("busca", usuario, self.relogio())
            if not palavras:
                return []
            ids = [i for (i,) in self.con.execute(
                f"SELECT id FROM canal WHERE (dm = 0 AND chave IN ({','.join('?' * len(chaves)) or 'NULL'})) "
                "OR (dm = 1 AND (u1 = ? OR u2 = ?))", (*chaves, usuario, usuario))]
            if not ids:
                return []
            consulta = " ".join(f'"{p}"*' for p in palavras)   # \w+ não tem aspas: cada palavra é um termo literal
            return self._mensagens(f"m.id IN (SELECT rowid FROM fts WHERE fts MATCH ?) AND m.canal IN "
                                   f"({','.join('?' * len(ids))}) AND m.texto IS NOT NULL ORDER BY m.id DESC LIMIT ?",
                                   (consulta, *ids, limite), usuario)

    # --- o que o /api/ao-vivo e o push leem (Onda 2)
    def contadores(self, usuario):
        """({canal: não lidas}, {canal: menções não lidas}) da pessoa: geral, salas e as DMs dela, só os maiores que 0 e
        até CONTAGEM_MAX. As mensagens dela mesma não contam. Roda a cada poll, então nada varre o histórico: as não
        lidas leem o índice (canal, id) depois da última leitura, com teto; as menções, o índice (usuario, mensagem)."""
        nao_lidas, mencoes = {}, {}
        with self.trava:
            if self.contados[0] != self.con.total_changes:   # qualquer escrita no banco (só esta conexão escreve) zera
                self.contados = (self.con.total_changes, {})
            if usuario in self.contados[1]:
                return tuple(dict(d) for d in self.contados[1][usuario])
            canais = {i: (f"dm:{i}" if dm else chave, ultima) for i, dm, chave, ultima in self.con.execute(
                "SELECT c.id, c.dm, c.chave, COALESCE(l.ultima, 0) FROM canal c "
                "LEFT JOIN leitura l ON l.canal = c.id AND l.usuario = ? WHERE c.dm = 0 OR c.u1 = ? OR c.u2 = ?",
                (usuario, usuario, usuario))}
            for i, (ref, ultima) in canais.items():
                n = self.con.execute(
                    "SELECT COUNT(*) FROM (SELECT 1 FROM mensagem WHERE canal = ? AND id > ? AND texto IS NOT NULL "
                    "AND (autor IS NULL OR autor <> ?) LIMIT ?)", (i, ultima, usuario, CONTAGEM_MAX)).fetchone()[0]
                if n:
                    nao_lidas[ref] = n
            if nao_lidas:   # CROSS JOIN: a menção por fora, pelo índice da pessoa, a partir da leitura mais antiga
                for i, id_m in self.con.execute(
                        "SELECT m.canal, m.id FROM mencao x CROSS JOIN mensagem m ON m.id = x.mensagem "
                        "WHERE x.usuario = ? AND x.mensagem > ? AND m.texto IS NOT NULL",
                        (usuario, min(ultima for _, ultima in canais.values()))):
                    ref, ultima = canais.get(i, (None, 0))
                    if ref is not None and id_m > ultima:
                        mencoes[ref] = min(mencoes.get(ref, 0) + 1, CONTAGEM_MAX)
            self.contados[1][usuario] = (dict(nao_lidas), dict(mencoes))
        return nao_lidas, mencoes

    def novas(self, usuario, canal, depois, limite=NOVAS_MAX):
        """As mensagens do canal com id maior que depois (o canal aberto no painel), em ordem."""
        _inteiro(depois, 0, 2 ** 62, "id inválido")
        with self.trava:
            id_c = self._ler_canal(canal, usuario)
            if id_c is None:
                return []
            return self._mensagens("m.canal = ? AND m.id > ? ORDER BY m.id LIMIT ?", (id_c, depois, limite), usuario)

    def versao(self, canal):
        """Muda quando uma mensagem do canal é apagada ou ganha ou perde reação (o painel relê o histórico)."""
        with self.trava:
            return self.base_versao + self.versoes.get(canal, 0)

    def versoes_mural(self):
        """{canal: versão} dos murais com aviso. Fixar sobe o maior id; tirar baixa a contagem: o par nunca se repete."""
        with self.trava:
            return {chave: maior * 100 + n for chave, maior, n in self.con.execute(
                "SELECT c.chave, MAX(m.id), COUNT(*) FROM mural m JOIN canal c ON c.id = m.canal GROUP BY c.id")}

    def pode_escrever(self, canal, usuario):
        """Confere, sem criar nada, que a pessoa pode escrever no canal (antes de ler o corpo de um anexo): DM alheia é
        SemAcesso; DM com a outra ponta fora do andar, ValueError."""
        chave, id_dm = _canal(canal)
        if id_dm is not None:
            with self.trava:
                if None in self._dm(id_dm, usuario):
                    raise ValueError("A outra pessoa não está mais no andar.")

    def para_aviso(self, id_mensagem):
        """O que o aviso no celular mostra, lido na hora do GET /api/avisos (o aviso não guarda cópia do texto): o nome
        de quem mandou, o canal, o texto (None se foi apagada) e se tem anexo. Mensagem que não existe mais: None."""
        with self.trava:
            linha = self.con.execute("SELECT m.autor, m.nome, c.id, c.dm, c.chave, m.texto, a.id FROM mensagem m "
                                     "JOIN canal c ON c.id = m.canal LEFT JOIN anexo a ON a.mensagem = m.id WHERE m.id = ?",
                                     (id_mensagem,)).fetchone()
        if linha is None:
            return None
        autor, nome, id_c, dm, chave, texto, id_a = linha
        return {"nome": nome if autor is not None else EX_MEMBRO, "canal": f"dm:{id_c}" if dm else chave,
                "texto": texto, "anexo": id_a is not None}

    # --- status da conta neste andar e o "Entendi" da DM
    def status_de(self, usuario):
        with self.trava:
            return dict(self.status.get(usuario) or {"status": STATUS_PADRAO, "texto": ""})

    def definir_status(self, usuario, status, texto):
        usuario = _usuario(usuario)
        if status not in STATUS or not isinstance(texto, str):
            raise ValueError("status inválido")
        texto = texto.strip()
        if len(texto) > STATUS_TEXTO_MAX or not _visivel(texto):
            raise ValueError(f"O recado do status vai até {STATUS_TEXTO_MAX} caracteres, sem símbolos invisíveis.")
        with self.trava:
            with self.con:
                if status == STATUS_PADRAO and not texto:
                    self.con.execute("DELETE FROM status WHERE usuario = ?", (usuario,))
                else:
                    self.con.execute("INSERT INTO status (usuario, status, texto) VALUES (?, ?, ?) ON CONFLICT (usuario) "
                                     "DO UPDATE SET status = excluded.status, texto = excluded.texto", (usuario, status, texto))
            if status == STATUS_PADRAO and not texto:
                self.status.pop(usuario, None)
            else:
                self.status[usuario] = {"status": status, "texto": texto}
        return {"status": status, "texto": texto}

    def entendeu_dm(self, usuario):
        with self.trava:
            return self._ajuste("dm_aviso:" + _usuario(usuario), 0) == 1

    def marcar_entendeu_dm(self, usuario):
        with self.trava:
            with self.con:
                self.con.execute("INSERT OR REPLACE INTO ajuste (chave, valor) VALUES (?, 1)", ("dm_aviso:" + _usuario(usuario),))

    # --- retenção, teto e contas
    def retencao(self):
        with self.trava:
            return self._ajuste("retencao", RETENCAO_PADRAO)

    def definir_retencao(self, dias):
        if type(dias) is not int or dias not in RETENCOES:
            raise ValueError("A retenção é de 30, 90 ou 365 dias.")
        with self.trava:
            with self.con:
                self.con.execute("INSERT INTO ajuste (chave, valor) VALUES ('retencao', ?) ON CONFLICT (chave) "
                                 "DO UPDATE SET valor = excluded.valor", (dias,))

    def varrer(self):
        """A varredura diária: tira o que passou da retenção (as mensagens com os anexos, e os avisos do mural), o
        registro de acesso com mais de 1 ano e, se ainda passar do teto, as mais antigas. Os temporários de envio sem
        reserva viva também saem, e a DM sem nenhuma mensagem (e não aberta no último dia nem com acesso da auditoria
        no registro) perde a linha, com as leituras: o par deixa de constar no banco. A DM de id mais alto fica sempre,
        para o id de uma DM que saiu nunca voltar noutro par (o SQLite reusa o maior rowid apagado, e o registro de
        acesso aponta para o id)."""
        with self.trava:
            agora = self.relogio()
            prazo = agora - self._ajuste("retencao", RETENCAO_PADRAO) * DIA
            with self.con:
                ids = [i for (i,) in self.con.execute("SELECT id FROM mensagem WHERE em < ?", (prazo,))]
                tokens = self._apagar_linhas(ids)
                avisos = self.con.execute("DELETE FROM mural WHERE em < ?", (prazo,)).rowcount
                self.con.execute("DELETE FROM convidado WHERE reuniao IN "
                                 "(SELECT id FROM reuniao WHERE inicio + duracao * 60 < ?)", (prazo,))
                self.con.execute("DELETE FROM reuniao WHERE inicio + duracao * 60 < ?", (prazo,))
                registros = self.con.execute("DELETE FROM acesso_dm WHERE quando < ?", (agora - REGISTRO_DIAS * DIA,)).rowcount
                self.dms_abertas = {i: q for i, q in self.dms_abertas.items() if q >= agora - DIA}
                vazias = [i for (i,) in self.con.execute(
                    "SELECT id FROM canal c WHERE dm = 1 AND id < (SELECT MAX(id) FROM canal) "
                    "AND NOT EXISTS (SELECT 1 FROM mensagem m WHERE m.canal = c.id) "
                    "AND NOT EXISTS (SELECT 1 FROM acesso_dm a WHERE a.canal = c.id)") if i not in self.dms_abertas]
                for i in vazias:
                    self.con.execute("DELETE FROM leitura WHERE canal = ?", (i,))
                    self.con.execute("DELETE FROM canal WHERE id = ?", (i,))
            self._apagar_arquivos(tokens)
            self._reservado(agora)
            self._limpar_temporarios(agora)
            if ids or avisos or vazias or registros:
                self._limpar_disco()
            return {"por_prazo": len(ids), "por_teto": self._cortar_pelo_teto(), "registros": registros,
                    "avisos": avisos, "dms_vazias": len(vazias)}

    def uso(self):
        """O que a tela do admin mostra: o banco perto do teto e os anexos perto da cota (alerta em 90%)."""
        with self.trava:
            banco, anexos = self._uso_banco(), self.con.execute("SELECT COALESCE(SUM(tamanho), 0) FROM anexo").fetchone()[0]
            reservado = self._reservado(self.relogio())
            return {"banco": banco, "teto_banco": self.teto_banco, "alerta_banco": banco >= 0.9 * self.teto_banco,
                    "cortadas_por_teto": self._ajuste("cortadas_teto", 0), "anexos": anexos, "reservado": reservado,
                    "cota_anexos": self.cota_anexos, "alerta_anexos": anexos + reservado >= 0.9 * self.cota_anexos}

    def remover_conta(self, usuario):
        """A conta saiu do andar (ou foi apagada): mensagens e avisos ficam como ex-membro; reações, leituras e
        reservas saem; a DM perde a ponta dela e deixa de ser achada pelo par (o login de volta não herda)."""
        with self.trava:
            with self.con:
                self.con.execute("UPDATE mensagem SET autor = NULL, nome = NULL WHERE autor = ?", (usuario,))
                self.con.execute("UPDATE mural SET autor = NULL, nome = NULL WHERE autor = ?", (usuario,))
                self.con.execute("DELETE FROM reacao WHERE usuario = ?", (usuario,))
                self.con.execute("DELETE FROM leitura WHERE usuario = ?", (usuario,))
                self.con.execute("DELETE FROM mencao WHERE usuario = ?", (usuario,))
                self.con.execute("DELETE FROM status WHERE usuario = ?", (usuario,))
                self.con.execute("UPDATE reuniao SET autor = NULL, nome = NULL WHERE autor = ?", (usuario,))
                self.con.execute("DELETE FROM convidado WHERE usuario = ?", (usuario,))
                self.con.execute("DELETE FROM ajuste WHERE chave = ?", ("dm_aviso:" + usuario,))
                self.con.execute("UPDATE canal SET u1 = NULL, chave = NULL WHERE dm = 1 AND u1 = ?", (usuario,))
                self.con.execute("UPDATE canal SET u2 = NULL, chave = NULL WHERE dm = 1 AND u2 = ?", (usuario,))
            self.status.pop(usuario, None)
            self.reservas = {t: r for t, r in self.reservas.items() if r[0] != usuario}

    # --- reuniões (Onda 3): o link fixo por sala e a agenda do andar
    def links(self):
        """{sala: url} das salas com link."""
        with self.trava:
            return dict(self.con.execute("SELECT sala, url FROM sala_link ORDER BY sala"))

    def definir_link(self, sala, url, extra=None):
        """Grava o link da sala (a sala já vem conferida contra o mapa); url "" tira."""
        if not isinstance(sala, str) or not 1 <= len(sala) <= SALA_MAX:
            raise ValueError("sala inválida")
        if url != "":
            url = validar_link(url, extra)
        with self.trava:
            with self.con:
                if url == "":
                    self.con.execute("DELETE FROM sala_link WHERE sala = ?", (sala,))
                else:
                    self.con.execute("INSERT INTO sala_link (sala, url) VALUES (?, ?) ON CONFLICT (sala) "
                                     "DO UPDATE SET url = excluded.url", (sala, url))

    def _reunioes(self, onde, params):
        linhas = self.con.execute("SELECT id, titulo, sala, inicio, duracao, autor, nome FROM reuniao "
                                  f"WHERE {onde} ORDER BY inicio, id", params).fetchall()
        convidados = {}
        if linhas:
            marcas = ",".join("?" * len(linhas))
            for r, u in self.con.execute(f"SELECT reuniao, usuario FROM convidado WHERE reuniao IN ({marcas}) "
                                         "ORDER BY usuario", [linha[0] for linha in linhas]):
                convidados.setdefault(r, []).append(u)
        return [{"id": i, "titulo": t, "sala": sala, "inicio": ini, "duracao": d, "fim": ini + d * 60, "usuario": autor,
                 "nome": nome if autor is not None else EX_MEMBRO, "convidados": convidados.get(i, [])}
                for i, t, sala, ini, d, autor, nome in linhas]

    def _conferir_reuniao(self, titulo, sala, inicio, duracao, convidados, agora, inicio_antes=None):
        """inicio_antes: na edição, o início gravado; se não mudou, a janela de início não vale (dá para estender ou
        corrigir o título da reunião em andamento)."""
        titulo, convidados = _titulo(titulo), _convidados(convidados)
        if not isinstance(sala, str) or not 1 <= len(sala) <= SALA_MAX:
            raise ValueError("sala inválida")
        _inteiro(duracao, DURACAO_MIN, DURACAO_MAX, f"A duração vai de {DURACAO_MIN} a {DURACAO_MAX} minutos.")
        if type(inicio) is not int or inicio != inicio_antes:   # type(): o 3600.0 não passa por igual
            _inteiro(inicio, int(agora) - 60, int(agora) + 366 * DIA, "O início vai de agora até um ano à frente.")
        return titulo, convidados

    def _sem_choque(self, sala, inicio, duracao, menos=None):
        if self.con.execute("SELECT 1 FROM reuniao WHERE sala = ? AND inicio < ? AND inicio + duracao * 60 > ? "
                            "AND id IS NOT ?", (sala, inicio + duracao * 60, inicio, menos)).fetchone():
            raise SalaOcupada()

    def marcar(self, usuario, nome, titulo, sala, inicio, duracao, convidados):
        """Uma reunião do andar. Sala e convidados já vêm conferidos pelo escritorio.py (o mapa e quem tem papel no
        andar)."""
        usuario, nome = _usuario(usuario), _nome(nome)
        with self.trava:
            agora = self.relogio()
            titulo, convidados = self._conferir_reuniao(titulo, sala, inicio, duracao, convidados, agora)
            if self.con.execute("SELECT COUNT(*) FROM reuniao WHERE inicio + duracao * 60 > ?",
                                (agora,)).fetchone()[0] >= REUNIOES_MAX:
                raise AgendaCheia()
            self._sem_choque(sala, inicio, duracao)
            with self.con:
                id_r = self.con.execute("INSERT INTO reuniao (titulo, sala, inicio, duracao, autor, nome) VALUES "
                                        "(?, ?, ?, ?, ?, ?)", (titulo, sala, inicio, duracao, usuario, nome)).lastrowid
                self.con.executemany("INSERT INTO convidado (reuniao, usuario) VALUES (?, ?)",
                                     [(id_r, u) for u in convidados])
            self.versao_agenda += 1
            return self._reunioes("id = ?", (id_r,))[0]

    def _minha(self, id_reuniao, usuario, moderador):
        """A reunião, para quem marcou ou o moderador; os outros (e a que não existe): SemAcesso."""
        linha = self.con.execute("SELECT autor FROM reuniao WHERE id = ?", (id_reuniao,)).fetchone()
        if linha is None or not (moderador or (linha[0] is not None and linha[0] == usuario)):
            raise SemAcesso()

    def editar(self, id_reuniao, usuario, moderador, titulo, sala, inicio, duracao, convidados):
        """Quem marcou ou o moderador (o admin do andar). Mudar o início rearma o aviso de 5 min."""
        with self.trava:
            agora = self.relogio()
            self._minha(id_reuniao, usuario, moderador)
            antes = self.con.execute("SELECT inicio FROM reuniao WHERE id = ?", (id_reuniao,)).fetchone()[0]
            titulo, convidados = self._conferir_reuniao(titulo, sala, inicio, duracao, convidados, agora, antes)
            self._sem_choque(sala, inicio, duracao, menos=id_reuniao)
            with self.con:
                self.con.execute("UPDATE reuniao SET titulo = ?, sala = ?, duracao = ?, "
                                 "avisada = CASE WHEN inicio = ? THEN avisada ELSE 0 END, inicio = ? WHERE id = ?",
                                 (titulo, sala, duracao, inicio, inicio, id_reuniao))
                self.con.execute("DELETE FROM convidado WHERE reuniao = ?", (id_reuniao,))
                self.con.executemany("INSERT INTO convidado (reuniao, usuario) VALUES (?, ?)",
                                     [(id_reuniao, u) for u in convidados])
            self.versao_agenda += 1
            return self._reunioes("id = ?", (id_reuniao,))[0]

    def cancelar(self, id_reuniao, usuario, moderador):
        with self.trava:
            self._minha(id_reuniao, usuario, moderador)
            with self.con:
                self.con.execute("DELETE FROM convidado WHERE reuniao = ?", (id_reuniao,))
                self.con.execute("DELETE FROM reuniao WHERE id = ?", (id_reuniao,))
            self.versao_agenda += 1

    def reuniao(self, id_reuniao):
        with self.trava:
            achadas = self._reunioes("id = ?", (id_reuniao,))
        return achadas[0] if achadas else None

    def reunioes(self, de, ate):
        """As reuniões que cruzam [de, ate), por início."""
        with self.trava:
            return self._reunioes("inicio < ? AND inicio + duracao * 60 > ?", (ate, de))

    def versao_reunioes(self):
        with self.trava:
            return self.base_versao + self.versao_agenda

    def a_avisar(self, agora):
        """As reuniões que começam nos próximos 5 min e ainda não avisaram, já marcadas como avisadas (uma vez só)."""
        with self.trava:
            devidas = self._reunioes("avisada = 0 AND inicio > ? AND inicio <= ?", (agora, agora + AVISO_ANTES))
            if devidas:
                with self.con:
                    self.con.executemany("UPDATE reuniao SET avisada = 1 WHERE id = ?", [(r["id"],) for r in devidas])
            return devidas

    def salas_em_reuniao(self, agora):
        """As salas com reunião em andamento agora (o status automático "em reunião")."""
        with self.trava:
            return {sala for (sala,) in self.con.execute(
                "SELECT sala FROM reuniao WHERE inicio <= ? AND inicio > ? AND inicio + duracao * 60 > ?",
                (agora, agora - DURACAO_MAX * 60, agora))}

    # --- auditoria de DM (D4 b, D10 a): o escritorio.py só chama para o admin da empresa no andar
    def pares_dm(self):
        """As DMs do andar com mensagem: o canal, o par, quantas e a data da última (sem texto)."""
        with self.trava:
            linhas = self.con.execute("SELECT c.id, c.u1, c.u2, COUNT(m.id), MAX(m.em) FROM canal c JOIN mensagem m "
                                      "ON m.canal = c.id AND m.texto IS NOT NULL WHERE c.dm = 1 GROUP BY c.id "
                                      "ORDER BY MAX(m.em) DESC").fetchall()
        return [{"canal": f"dm:{i}", "u1": u1, "u2": u2, "mensagens": n, "ultima": _iso(ultima)}
                for i, u1, u2, n, ultima in linhas]

    def auditar_dm(self, admin, canal, antes=None, limite=LIMITE_PADRAO):
        """O admin lê a DM: sem as apagadas, sem marcar como lida, e com o registro (sem texto) na mesma transação."""
        _inteiro(limite, 1, LIMITE_MAX, "limite inválido")
        if antes is not None:
            _inteiro(antes, 1, 2 ** 62, "antes inválido")
        id_dm = _canal(canal)[1]
        if id_dm is None:
            raise ValueError("canal inválido")
        with self.trava:
            agora = self.relogio()
            par = self.con.execute("SELECT u1, u2 FROM canal WHERE id=? AND dm=1", (id_dm,)).fetchone()
            if par is None:
                raise SemAcesso()
            self._por_vez("auditoria", admin, agora)
            msgs = self._mensagens("m.canal = ? AND m.id < ? AND m.texto IS NOT NULL ORDER BY m.id DESC LIMIT ?",
                                   (id_dm, antes or 2 ** 62, limite), admin)[::-1]
            with self.con:
                self.con.execute("INSERT INTO acesso_dm (canal, admin, u1, u2, quando, quantas) VALUES (?, ?, ?, ?, ?, ?)",
                                 (id_dm, admin, *par, agora, len(msgs)))
            return msgs

    def registro_acessos_dm(self):
        """O registro para os admins: quem leu qual par, quando e quantas mensagens."""
        with self.trava:
            linhas = self.con.execute("SELECT canal, admin, u1, u2, quando, quantas FROM acesso_dm "
                                      "ORDER BY quando DESC, id DESC").fetchall()
        return [{"canal": f"dm:{c}", "admin": a, "u1": u1, "u2": u2, "quando": _iso(q), "quantas": n}
                for c, a, u1, u2, q, n in linhas]

    def acessos_da_dm(self, usuario, canal):
        """As datas em que a administração abriu esta DM, para as duas pontas verem."""
        id_dm = _canal(canal)[1]
        if id_dm is None:
            raise ValueError("canal inválido")
        with self.trava:
            self._dm(id_dm, usuario)
            return [_iso(q) for (q,) in self.con.execute("SELECT quando FROM acesso_dm WHERE canal=? ORDER BY quando",
                                                          (id_dm,))]

    # --- anexos (os bytes são da Onda 2: aqui só cota, metadados e o lugar do arquivo)
    def reservar(self, usuario, tamanho):
        """Reserva o tamanho na cota da empresa antes de ler o corpo. Devolve o token do envio."""
        if self.saguao:
            raise SemAcesso()
        usuario = _usuario(usuario)
        _inteiro(tamanho, 1, ANEXO_MAX, "tamanho inválido")
        with self.trava:
            agora = self.relogio()
            usado = self.con.execute("SELECT COALESCE(SUM(tamanho), 0) FROM anexo").fetchone()[0] + self._reservado(agora)
            if usado + tamanho > self.cota_anexos:
                raise CotaCheia("cota")
            token = secrets.token_hex(16)
            self.reservas[token] = (usuario, tamanho, agora)
        os.makedirs(self.pasta_anexos, mode=0o700, exist_ok=True)
        return token

    def temporario(self, token):
        """Onde o envio grava o corpo (0600) enquanto lê; o anexar o põe no lugar."""
        if not isinstance(token, str) or not TOKEN_OK.fullmatch(token):
            raise ValueError("token inválido")
        return os.path.join(self.pasta_anexos, ".tmp-" + token)

    def liberar(self, token):
        """O envio falhou ou desistiu: devolve a cota e apaga o temporário."""
        caminho = self.temporario(token)
        with self.trava:
            self.reservas.pop(token, None)
        try:
            os.unlink(caminho)
        except FileNotFoundError:
            pass

    def anexar(self, token, usuario, nome, canal, arquivo, tipo, tamanho, sha256, texto="", mencoes=()):
        """Confirma o envio: o temporário vai para anexos/<token> e vira uma mensagem com o anexo (as menções do texto
        entram como no enviar)."""
        temporario = self.temporario(token)
        usuario, nome, arquivo = _usuario(usuario), _nome(nome), _nome_arquivo(arquivo)
        if not isinstance(tipo, str) or not TIPO_OK.fullmatch(tipo) or not isinstance(sha256, str) \
                or not SHA_OK.fullmatch(sha256):
            raise ValueError("anexo inválido")
        limpo = limpar_texto(texto) if texto else ""
        citados = {_usuario(u) for u in mencoes} - {usuario}
        with self.trava:
            agora = self.relogio()
            self._reservado(agora)
            reserva = self.reservas.get(token)
            if reserva is None or reserva[0] != usuario:
                raise SemAcesso()
            _inteiro(tamanho, 1, reserva[1], "tamanho inválido")
            if os.path.getsize(temporario) != tamanho:
                raise ValueError("tamanho inválido")
            final = os.path.join(self.pasta_anexos, token)
            try:
                with self.con:   # o arquivo vai para o lugar por último: canal recusado ou banco com erro não o perdem
                    id_m = self._inserir(self._escrever_canal(canal, usuario), usuario, nome, limpo, agora)
                    self.con.execute("INSERT INTO anexo (mensagem, token, nome, tipo, tamanho, sha256) VALUES (?, ?, ?, ?, ?, ?)",
                                     (id_m, token, arquivo, tipo, tamanho, sha256))
                    if _canal(canal)[1] is None:
                        self.con.executemany("INSERT INTO mencao (mensagem, usuario) VALUES (?, ?)",
                                             [(id_m, u) for u in sorted(citados)])
                    os.replace(temporario, final)
            except BaseException:
                if os.path.exists(final):   # o commit falhou depois de mover: sem linha, sem arquivo
                    os.unlink(final)
                raise
            del self.reservas[token]
            return self._mensagens("m.id = ?", (id_m,), usuario)[0]

    def tipo_do_anexo(self, id_anexo):
        """Só o tipo gravado (None se não existe), para o escritorio.py escolher o teto antes de servir; o acesso é
        conferido depois, no arquivo_do_anexo."""
        with self.trava:
            linha = self.con.execute("SELECT tipo FROM anexo WHERE id = ?", (id_anexo,)).fetchone()
        return linha[0] if linha else None

    def arquivo_do_anexo(self, usuario, id_anexo, auditoria=False):
        """Para servir: o caminho no disco e os metadados. Anexo de DM só para as duas pontas, ou para o admin pela
        auditoria (auditoria=True; o escritorio.py só passa para o admin da empresa no andar): aí o download entra no
        registro de acesso da DM, como a leitura (1 mensagem), e "auditoria" volta True."""
        with self.trava:
            linha = self.con.execute("SELECT a.token, a.nome, a.tipo, a.tamanho, c.id, c.dm, c.chave, c.u1, c.u2 "
                                     "FROM anexo a JOIN mensagem m ON m.id = a.mensagem JOIN canal c ON c.id = m.canal "
                                     "WHERE a.id = ?", (id_anexo,)).fetchone()
            if linha is None:
                raise SemAcesso()
            token, arquivo, tipo, tamanho, id_c, dm, chave, u1, u2 = linha
            auditou = bool(dm and auditoria)
            if auditou:
                with self.con:
                    self.con.execute("INSERT INTO acesso_dm (canal, admin, u1, u2, quando, quantas) VALUES "
                                     "(?, ?, ?, ?, ?, 1)", (id_c, _usuario(usuario), u1, u2, self.relogio()))
            elif dm:
                self._dm(id_c, usuario)
        return {"caminho": os.path.join(self.pasta_anexos, token), "nome": arquivo, "tipo": tipo, "tamanho": tamanho,
                "canal": f"dm:{id_c}" if dm else chave, "auditoria": auditou}
