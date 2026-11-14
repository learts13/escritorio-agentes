# Plano: andares (vários workspaces) e equipe estilo Gather

Estado em 13/11/2026. Pedidos do Helbert e da equipe: (A) puxar os times dos setores do agentes.chat; (B) pessoas da equipe entram e conversam pelo escritório, estilo Gather; (C) vários workspaces, cada um num andar novo.

## Situação
- **A: pronto no escritório** (botão "Puxar os setores do agentes.chat" em Configurações › Times; CHANGELOG "Não lançado"). Depende do agentes.chat mandar `department` e `appearance` no `list_agents`: PR https://github.com/agentes-chat/agentes-chat/pull/406 (commit f1b39c8c3, 27 testes OK), aguardando os mantenedores. Sem o servidor novo, a tela avisa para atualizar.
- **C: implementado** (andares.py, elevador, aba Andares; README "Andares" e CHANGELOG "Não lançado").
- **B1: implementado** (contas de membro por convite, guarda de papéis, aba Membros, Meu perfil; commits d49d94e e 08f19c4).
- **B2: back pronto** (presenca.py, `/api/presenca`, `/api/ao-vivo`, `/api/sala/enviar`; commit 08f19c4). **Front em andamento** (Tron: mapa; Flynn: painel do chat). Doc de privacidade em docs/visitas-privadas-plano.md, seção "Equipe: presença no mapa e chat por sala"; README "Equipe" e CHANGELOG "Não lançado" descrevem o contrato.
- Atualizado em 14/11/2026.

## Decisões do Helbert (13/11)
- B: convite pessoal que vira conta fixa, com nome e boneco próprios; presença no mapa e chat de texto por sala. Voz e vídeo na fase 2.
- C: cada workspace do agentes.chat é um andar do mesmo prédio, com a sua conexão e os seus times.
- Decisão 1 (resolvida): o membro **não** lê as conversas dos agentes (`/api/estado` sem conversas e sem modo resposta; `GET /api/conversa` barrado pela guarda).

## Pendente de decisão do Helbert
1. ~~O membro da equipe pode ler as conversas dos agentes?~~ Resolvida: não (ver acima).
2. De qual agentes.chat o Escritório lê, agora que a self-host foi removida (13/11): nuvem oficial ou self-host reinstalada?
3. Onde o Escritório volta a ficar no ar (o /opt/escritorio também saiu da VPS em 13/11): VPS ou só local por enquanto.

## Próximos passos
1. Onda 1, em 3 floors a partir da `integracao`: C-back (Neo), C-front (Tron), B1-front (Flynn).
2. Onda 2: B1-back (contas, convite, perfil e guarda de papéis), aba Membros e UI de admin escondida para membro. Revisão de segurança antes do merge.
3. Onda 3: B2 (presença, posição e chat por sala), com a doc de privacidade.
4. Auditor em cada onda; verificar com conta real o consentimento OAuth por workspace.

---

PARECER GANDALF — Andares (C) + Membros estilo Gather (B), fase 1. Somente leitura; não autoriza commit nem deploy. (13/11/2026)

VEREDITO: APPROVED (desenho abaixo), com 3 condições obrigatórias:
 (1) a árvore suja (escritorio.py, static/ajustes.js, static/index.html, test_escritorio.py modificados) é fechada e integrada ANTES de abrir floors;
 (2) o guarda de papel com lista de permissões (negar por padrão) entra no mesmo pacote que cria a primeira conta de membro, nunca depois;
 (3) sem andares.json, o comportamento fica idêntico ao de hoje (a suíte atual passa sem mudar asserts).
ORDEM: C → B1 (contas/convite/perfil/papéis) → B2 (presença + chat). Presença e chat são por andar, então o andar vem antes.

=== C. ANDARES ===
Config: dados/andares.json {"v":1,"andares":[{"id":"<8 hex>","nome":"…","org":"<uuid>"}]}, até 6 andares extras, gravação atômica, 0600.
- O andar principal é implícito: id "principal", org = AGENTES_ORG (continua obrigatória), e os arquivos ficam ONDE ESTÃO (dados/oauth.json, TIMES, dados/planta.json, equipe.json, placar.json, jornal.json). Migração = nenhuma.
- Andar extra: dados/andares/<id>/{oauth.json, times.json, equipe.json, planta.json, placar.json, jornal.json}. O id é secrets.token_hex(4), validado por [0-9a-f]{8}; a pasta sai SÓ do id, nunca do org nem do nome (sem path traversal).
- Novo andares.py (sem I/O de rede): ler/validar andares.json e classe Andar {id, nome, org, url_app (regex), caminhos, cred, leitor, conversas, respostas, planta, social, jornal}. No escritorio.py, as constantes ORG/URL_APP/TIMES/ARQ_TOKEN/ARQ_PLANTA/ARQ_EQUIPE/ARQ_PLACAR/ARQ_JORNAL viram atributos do Andar (31 refs + 11 carregar_times + normalizar:582, canal_da_url:705, thread_da_url:1145, config_v:2175). srv.andares = {id: Andar}; main() monta o principal e os extras.
- OAuth: um redirect_uri só (BASE/oauth/retorno; não muda o cliente registrado). /oauth/conectar?andar=<id> (só admin). No retorno, o state (que já é sorteado) acha o Credenciais dono procurando em cred.pendentes de cada andar; state desconhecido = 400. O zerar_memoria/esquecer/zerar do retorno (escritorio.py:2918-2929) passa a valer SÓ para aquele andar.
- Workspace errado: o consentimento do agentes.chat é que escolhe o workspace, e o escritório não força. Na 1ª leitura, se as URLs das tarefas forem /org/<outro uuid>/, o Leitor marca conexao="outra_org", não publica nada e a tela pede para reconectar. NÃO VERIFICADO: se o consentimento deixa escolher o workspace; conferir com conta real.
- Orçamento: cada Andar tem o seu Leitor, ORCAMENTO_DIA e pausa de 429 (o limite é do token). Os Leitores começam escalonados (INTERVALO/n). A PonteVisitas e o recepcionista usam o Leitor e o cred do principal.
- POR ANDAR: times (times, aparência, modo de conversas), equipe.json, planta, Social + placar, Jornal, Conversas/Respostas/Diario, presença e chat (B2).
- GLOBAL (o prédio): marca/logo/expediente/modo sério, clima, festas, novidades, ClimaMundo, visitas/recepção/PonteVisitas (o térreo é o lobby), contas e sessões, push. O push tem um VAPID e uma lista de aparelhos, alimentada por todos os Leitores (no corpo, só o nome do andar; o rótulo da tarefa continua sem sair). Campos empresa/cor/clima/expediente no times.json de andar extra são ignorados.
- Rotas: o andar vai na query ?andar=<id> em GET e POST (ausente = principal). self._andar() devolve o Andar ou 404 {"codigo":"andar"}, a mesma resposta para inexistente e para sem acesso. Recebem andar: /api/estado, /api/config (+ "andares":[{id,nome,conexao}] só os permitidos), /api/conversa*, /api/social*, /api/jornal, /api/planta, /api/equipe, /oauth/conectar. Gestão: POST /api/andares {acao:"criar",nome,org} | {acao:"renomear",id,nome} | {acao:"remover",id}. Só admin, com o modo resposta aberto (senha), como o recepcionista, porque mexe em OAuth. Remover desconecta e tira do json; a pasta fica e o README explica como apagá-la.
- UI: um seletor "elevador" na barra (Tron). O andarAtual fica em #andar=<id> e no localStorage (com try/catch), e todo fetch leva ?andar. O mapa.js NÃO muda de contrato: o montarPredio desenha um andar por vez com o config e a planta daquele andar. O limite de 12 times vale por andar. Construção e planta.js:226 mandam ?andar. Ajustes: aba "Andares" (admin) com criar/renomear e o link "Conectar" de cada andar.

=== B1. CONTAS DE MEMBRO ===
- usuarios.json: cada usuário ganha "papel": "admin"|"membro", "nome" (ROTULO_OK, ≤40), "aparencia" (as listas fechadas de color/eyes/accessory já validadas no ajustes.py) e "andares": [ids] (só para membro). Sem o campo papel = admin (compatível).
- Convite pessoal: POST /api/membros/convidar {nome, andares} (admin + modo aberto). Devolve UMA vez o link BASE/convite#<token_urlsafe(32)>. Em dados/convites.json (0600) ficam só o sha256, a expiração (48 h), o papel ("membro") e os andares. Uso único; revogar por POST /api/membros/revogar {id}; lista de pendentes sem token.
- Aceitar: /convite (página pública, entra no PUBLICOS e no ARQUIVOS) lê o fragmento e manda POST /convite/aceitar {convite, usuario, senha, nome, aparencia}, com mesma origem, balde de tentativas do login e limite por origem (reaproveitar o origem_visita/limitar_origem). Consome o convite e cria a conta sob a mesma trava do Acesso (sem corrida de duplo uso). Mesmas regras do login (USUARIO_OK, SENHA_MIN 10, scrypt). Abre a sessão e redireciona para /.
- Admin: GET /api/membros (usuario, nome, papel, andares; nunca hash) e POST /api/membros {acao:"papel"|"andares"|"remover", usuario}. Não dá para remover nem rebaixar o último admin. Remover derruba as sessões na hora (sessao() já confere usuario in usuarios).
- Perfil: GET/POST /api/perfil {nome, aparencia}; só o próprio, qualquer papel.
- GUARDA (central, num lugar só, antes de despachar a rota): permitido(papel, método, rota), NEGAR POR PADRÃO. Hoje todo logado é admin de fato: /oauth/conectar, /api/marca, /api/logo, /api/planta, /api/equipe, a ponte e as visitas não conferem papel.
  Membro PODE: estáticos, GET /api/estado|config|social|social/placar|jornal|novidades|avisos|push/chave, push assinar/sair (o próprio aparelho), /api/perfil, /api/ao-vivo, /api/presenca, /api/sala/enviar, /sair.
  Membro NÃO PODE: /oauth/*, /api/andares, /api/membros*, /api/marca, /api/logo*, POST /api/planta|equipe|clima|festas, /api/conversa/modo|responder (fala como a conta OAuth), admin das visitas e recepção, /api/social/briga|greve/atender, GET /api/conversa (conteúdo das conversas dos agentes). Para membro, o /api/estado sai com conversas:[] e sem modo_resposta.
  DECISÃO DO HELBERT (padrão proposto = não): o membro lê as conversas dos agentes?
- /api/sair-todos hoje zera TODAS as sessões ("só existe uma conta", acesso.py:230). Muda: admin continua zerando tudo; membro zera só as próprias.

=== B2. PRESENÇA E CHAT POR SALA ===
- Novo presenca.py no molde do visitas_sala.py: sem I/O e sem log, testável com relógio injetado. Por andar: {usuario: {nome, aparencia, x, y, destino, sala, olha, visto, entrou_seq}}. TTL de 30 s sem pedido; no máximo 64 pessoas no escritório.
- Posição: o cliente manda o DESTINO do clique, não cada passo: POST /api/presenca?andar= {x,y,destino:[x,y],sala,olha}, no máximo 2/s. Os outros animam com o pathfinding que já existe no vida.js. O servidor limita x,y ao tamanho do mapa e confere a sala contra as salas da planta/times do andar. A sala NÃO é fronteira de segurança entre membros; a fronteira é o andar.
- Transporte: POLLING, não SSE. GET /api/ao-vivo?andar=&desde=<seq> a cada 1,5 s com a aba visível, 10 s escondida e backoff em 429/erro. Resposta {seq, pessoas:[{usuario,nome,aparencia,x,y,destino,sala,olha}], mensagens:[{seq,usuario,nome,texto,em}]}. Motivo: ThreadingHTTPServer prenderia uma thread por stream; Tailscale serve e Cloudflare bufferizam/cortam stream longo; o contrato com seq deixa trocar por SSE/WebSocket depois. A TV (?invisivel=1) lê sem marcar presença.
- Chat: POST /api/sala/enviar?andar= {texto}, vai para a sala atual do autor no servidor (o cliente não escolhe). Texto ≤500, sem caracteres de controle, 1 msg/s com rajada de 5. SÓ NA MEMÓRIA: anel de 50 por sala, cada mensagem vive 10 min, nada em disco nem no log, o reinício apaga. Cada pessoa só recebe mensagens com seq ≥ entrou_seq da sala atual. Somar a docs/visitas-privadas-plano.md uma tabela "para onde vai cada dado" do chat de membros.
- Anônimos: a classe Visitantes e os figurantes anônimos (vida.js:1405) saem e dão lugar às pessoas do /api/ao-vivo, com nome e boneco.
- Visitantes de fora (visitas_sala, recepção pública, /mundo.html): na fase 1 NÃO veem membros. A conversa com visitante continua pelo fluxo de visitas.
- Porta para a fase 2: reservar tipo:"sinal" no mesmo canal (destino = usuario, ≤8 KB, para SDP/ICE), grupo de chamada = sala. STUN/TURN e Permissions-Policy ficam para a fase 2.

=== RISCOS E MITIGAÇÃO ===
1. Membro virar admin: guarda com lista de permissões + teste em matriz que percorre TODAS as rotas do do_GET/do_POST como membro e espera 403 fora da lista.
2. IDOR entre andares: andar conferido contra usuario.andares em toda rota. Id de conversa do andar A pedido com andar=B dá 404; cada andar usa o próprio cred e url_app; Social e Jornal só com os presentes daquele Leitor.
3. Mistura de state no OAuth: o state de A grava só o oauth.json de A (teste). Detecção de workspace errado.
4. Convite: 256 bits, no fragmento, só o sha256 em disco, uso único sob trava, 48 h, revogável, limite de tentativas e por origem, nunca no log.
5. CSRF: toda POST nova passa pelo _mesma_origem e exige JSON; cookie Lax, modo Strict.
6. XSS: nome, aparência e chat só com textContent; nome pela ROTULO_OK; aparência por lista fechada. CSP script-src 'self'.
7. Abuso: limites por sessão (ao-vivo/presença 4 req/s, chat 1/s), 64 presentes, corpo ≤1 KB, convites pendentes ≤20.
8. Privacidade: nada de texto do chat nem de posição no disco ou no log; o log só leva evento/resultado (padrão do test_visitas_logs).

=== PACOTES (arquivos sem sobreposição; no máximo 3 floors) ===
ONDA 1 (paralelo, 3 floors):
- C-back · Neo: andares.py (novo), escritorio.py, test_andares.py (novo), test_escritorio.py, README.md e README.pt-BR.md. Aceite: suíte atual verde sem mexer nos asserts; teste de compatibilidade sem andares.json; isolamento A/B no /api/estado, /api/conversa?id e /api/planta; state do OAuth no andar certo; outra_org; andar inválido ou sem acesso dá 404 igual; checar_seguranca.py limpo.
- C-front · Tron: app.js, index.html, estilo.css, planta.js, construir.js, construir.html, ajustes.js (aba Andares). Aceite: sem andares extras, a tela fica igual; o elevador troca de andar sem recarregar; ?andar em todo fetch; node --check; checar_planta_mapa.mjs; QA em 390 px.
- B1-front · Flynn (contra o contrato acima): convite.html, convite.js e convite.css (novos), perfil em personalizar.js (reusando avatar.js). Aceite: o fragmento sai da barra ao abrir (como na visita); os erros do servidor aparecem; só textContent.
ONDA 2: B1-back · Neo: acesso.py, escritorio.py (guarda, rotas membros/convite/perfil, sair-todos, ARQUIVOS/PUBLICOS com os arquivos novos de B1 e B2: convite.*, chat_sala.js, chat_sala.css), test_membros.py (matriz de rotas, convite usado/vencido/revogado/corrida, último admin, remoção derruba sessão). Tron: app.js esconde a UI de admin quando /api/config.papel = membro. Flynn: ajustes.js (aba Membros: convidar, listar, papel, remover).
ONDA 3: B2-back · Neo: presenca.py (novo), escritorio.py (rotas ao-vivo/presenca/sala), test_presenca.py (TTL, limites, isolamento por sala e andar, entrou_seq, open e print proibidos), doc de privacidade. Tron: vida.js e mapa.js (o meu boneco anda pelo clique, as pessoas com nome, os figurantes anônimos saem). Flynn: chat_sala.js e chat_sala.css (painel da sala, 390 px, foco e teclado).
Revisão de segurança (Opus alto) no diff do B1 antes do merge (sessão, papéis, convite) e Auditor em cada onda.

NÃO VERIFICADO: o consentimento do agentes.chat por workspace; se o limite de 429 é por token ou por usuário; a carga real do polling atrás do Tailscale serve e do Coolify; o comportamento do vida.js com mais de 30 bonecos no celular.
