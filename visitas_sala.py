# Copyright (C) 2026 Dev Maniac's
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Salas efêmeras: não executa I/O e não armazena credenciais em texto puro.

A camada HTTP deve autenticar a equipe, conferir a origem, limitar requisições e
não registrar corpos ou cabeçalhos. Cada instância representa um escritório.
"""
import collections
import hashlib
import hmac
import secrets
import threading
import time

MAX_SALAS = 32
MAX_PARTICIPANTES = 32
MAX_FILA = 50
MAX_TEXTO = 1000
VALIDADE_CONVITE = 3600
VALIDADE_SESSAO = 3600
INATIVIDADE = 60
INTERVALO_MENSAGEM = 1
MAX_ORIGEM_ATIVA = 4
MAX_ENVIO_SALA = 5
JANELA_ENVIO = 1
JANELA_REQUISICOES = 10
MAX_REQUISICOES_ORIGEM = 120
MAX_ORIGENS = 1024
MAX_REQUISICOES_SALA = 300
MAX_REQUISICOES_SESSAO = 30
MAX_PENDENTES_AGENTE = 20
MAX_TEXTO_AGENTE = 2000


class LimiteRequisicoes(ValueError):
    """Limitação temporária de uma janela de requisições."""


def _hash(token):
    if not isinstance(token, str) or len(token) > 128:
        return None
    try:
        return hashlib.sha256(token.encode('utf-8')).digest()
    except UnicodeEncodeError:
        return None


class Salas:
    def __init__(self, relogio=time.monotonic):
        self._agora = relogio
        self._trava = threading.Lock()
        self._chave_origem = secrets.token_bytes(32)
        self._salas = {}  # hash do convite -> sala, nunca gravado em disco
        self._sessoes = {}  # hash da credencial -> (sala, participante)
        self._origens = {}  # HMAC temporário -> janela limitada de requisições
        self._origens_publicas = {}  # orçamento independente para a recepção pública

    def _limpar(self, agora):
        for tabela in (self._origens, self._origens_publicas):
            for origem, pedidos in list(tabela.items()):
                if agora - pedidos[-1] >= JANELA_REQUISICOES:
                    del tabela[origem]
        for chave, (sala, pessoa) in list(self._sessoes.items()):
            if agora >= pessoa['expira'] or agora - pessoa['vista'] >= INATIVIDADE or sala['expira'] <= agora:
                sala['pessoas'].discard(chave)
                del self._sessoes[chave]
        for chave, sala in list(self._salas.items()):
            if sala['expira'] <= agora:
                del self._salas[chave]

    def limpar(self):
        """Descarta convites e sessões vencidos mesmo sem novos pedidos."""
        with self._trava:
            self._limpar(self._agora())

    def criar(self, agente=None):
        """agente: {'id', 'nome'} do anfitrião que recebe as mensagens da sala pelo agentes.chat, ou None (só pessoas)."""
        with self._trava:
            agora = self._agora()
            self._limpar(agora)
            if len(self._salas) >= MAX_SALAS:
                raise ValueError('Limite de salas atingido.')
            convite = secrets.token_urlsafe(32)
            self._salas[_hash(convite)] = {'expira': agora + VALIDADE_CONVITE, 'pessoas': set(), 'envios': collections.deque(),
                                           'entradas': collections.deque(), 'agente': agente,
                                           'para_agente': collections.deque(maxlen=MAX_PENDENTES_AGENTE), 'ponte': {}}
            return convite

    def agente(self, token):
        """Nome do agente anfitrião da sala desta sessão, para o aviso ao visitante, ou None."""
        with self._trava:
            sala, _ = self._pessoa(token)
            return sala['agente']['nome'] if sala['agente'] else None

    def pendencias(self):
        """Retira as mensagens a levar aos agentes: [(chave da sala, agente, estado da ponte, [textos])]. O estado da
        ponte (thread, último lido) fica na sala e some com ela."""
        with self._trava:
            self._limpar(self._agora())
            saida = []
            for chave, sala in self._salas.items():
                if sala['agente'] and (sala['para_agente'] or sala['ponte'].get('thread') or sala['ponte'].get('atrasadas')):
                    saida.append((chave, sala['agente'], sala['ponte'], list(sala['para_agente'])))
                    sala['para_agente'].clear()
            return saida

    def publicar(self, chave, texto):
        """Entrega a resposta do agente a quem está na sala; sala encerrada descarta."""
        if not isinstance(texto, str) or not texto.strip():
            return False
        with self._trava:
            sala = self._salas.get(chave)
            if not sala:
                return False
            for sessao in sala['pessoas']:
                self._sessoes[sessao][1]['fila'].append(texto[:MAX_TEXTO_AGENTE])
            return True

    def limitar_origem(self, origem, publica=False):
        """Limita também tentativas inválidas; não usa cabeçalhos fornecidos pelo cliente."""
        if not isinstance(origem, str) or not origem or len(origem) > 128:
            raise ValueError('Origem inválida.')
        chave = hmac.digest(self._chave_origem, origem.encode('utf-8'), 'sha256')
        with self._trava:
            agora = self._agora()
            self._limpar(agora)
            tabela = self._origens_publicas if publica else self._origens
            pedidos = tabela.get(chave)
            if pedidos is None:
                if len(tabela) >= MAX_ORIGENS:
                    raise LimiteRequisicoes('Limite de origens atingido.')
                pedidos = tabela[chave] = collections.deque()
            self._limitar_janela(pedidos, agora, MAX_REQUISICOES_ORIGEM)

    @staticmethod
    def _limitar_janela(pedidos, agora, limite):
        while pedidos and agora - pedidos[0] >= JANELA_REQUISICOES:
            pedidos.popleft()
        if len(pedidos) >= limite:
            raise LimiteRequisicoes('Limite de requisições atingido.')
        pedidos.append(agora)

    def limitar_sala(self, credencial, convite=False):
        with self._trava:
            agora = self._agora()
            self._limpar(agora)
            if convite:
                sala = self._salas.get(_hash(credencial))
                pedidos = sala['entradas'] if sala else None
                limite = MAX_REQUISICOES_SALA
            else:
                item = self._sessoes.get(_hash(credencial))
                sala = item[0] if item else None
                pedidos = item[1]['pedidos'] if item else None
                limite = MAX_REQUISICOES_SESSAO
            if not sala:
                raise PermissionError('Convite ou sessão inválida.')
            self._limitar_janela(pedidos, agora, limite)

    def entrar(self, convite, origem=None):
        with self._trava:
            agora = self._agora()
            self._limpar(agora)
            sala = self._salas.get(_hash(convite))
            if not sala:
                raise PermissionError('Convite inválido ou expirado.')
            origem_hash = hmac.digest(self._chave_origem, origem.encode('utf-8'), 'sha256') if isinstance(origem, str) and len(origem) <= 128 else None
            if origem is not None and origem_hash is None:
                raise ValueError('Origem inválida.')
            if origem_hash is not None and sum(self._sessoes[chave][1]['origem'] == origem_hash for chave in sala['pessoas']) >= MAX_ORIGEM_ATIVA:
                raise ValueError('Limite de sessões atingido.')
            if len(sala['pessoas']) >= MAX_PARTICIPANTES:
                raise ValueError('Sala lotada.')
            token = secrets.token_urlsafe(32)
            chave = _hash(token)
            pessoa = {'expira': min(agora + VALIDADE_SESSAO, sala['expira']), 'vista': agora,
                      'fila': collections.deque(maxlen=MAX_FILA), 'ultima_mensagem': None, 'origem': origem_hash,
                      'pedidos': collections.deque()}
            self._sessoes[chave] = sala, pessoa
            sala['pessoas'].add(chave)
            return token

    def revogar(self, convite):
        with self._trava:
            chave = _hash(convite)
            sala = self._salas.pop(chave, None)
            if not sala:
                return False
            for sessao in sala['pessoas']:
                self._sessoes.pop(sessao, None)
            return True

    def sair(self, token):
        with self._trava:
            item = self._sessoes.pop(_hash(token), None)
            if item:
                item[0]['pessoas'].discard(_hash(token))
            return bool(item)

    def _pessoa(self, token):
        agora = self._agora()
        self._limpar(agora)
        item = self._sessoes.get(_hash(token))
        if not item:
            raise PermissionError('Sessão inválida ou expirada.')
        item[1]['vista'] = agora
        return item

    def enviar(self, token, texto):
        if not isinstance(texto, str) or not texto.strip() or len(texto) > MAX_TEXTO:
            raise ValueError('Mensagem inválida.')
        with self._trava:
            sala, pessoa = self._pessoa(token)
            agora = self._agora()
            anterior = pessoa['ultima_mensagem']
            if anterior is not None and agora - anterior < INTERVALO_MENSAGEM:
                raise ValueError('Aguarde antes de enviar outra mensagem.')
            envios = sala['envios']
            while envios and agora - envios[0] >= JANELA_ENVIO:
                envios.popleft()
            if len(envios) >= MAX_ENVIO_SALA:
                raise ValueError('Limite de mensagens da sala atingido.')
            envios.append(agora)
            pessoa['ultima_mensagem'] = agora
            for chave in sala['pessoas']:
                self._sessoes[chave][1]['fila'].append(texto)
            if sala['agente']:
                sala['para_agente'].append(texto)

    def receber(self, token):
        with self._trava:
            _, pessoa = self._pessoa(token)
            mensagens = list(pessoa['fila'])
            pessoa['fila'].clear()
            return mensagens
