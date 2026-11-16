# Contrato da Onda 1 (1.6): back (Neo) ↔ front (Tron)

Dono: Neo (floor onda1-back). Só o Neo muda este arquivo, e só avisando o Maestro.
Base: andares @ 9080bab. Vale o plano 2026-11-15-escritorio-da-equipe.md (ONDA 1 reemitida, E.1, E.2).

## 0. Modos e termos

- **Modo clássico**: sem `dados/andares.json` ou com o v1. O térreo é o andar principal (id `"principal"`, nome
  `"Térreo"`), com agentes, como hoje. Tudo igual a hoje para quem não tem andar extra.
- **Modo saguão**: `andares.json` v2 (`"terreo": "saguao"`), gravado só pela migração. O id `"principal"` passa a ser
  o **Saguão** (nome `"Saguão"`): sem agentes, sem conexão OAuth, sem vida social nem jornal. A Dev Maniac's vira um
  andar extra como as outras empresas.
- **Perfis** (por andar do pedido):
  - `admin do prédio`: papel `admin` no `principal`. Pode tudo em todos os andares e no prédio.
  - `admin da empresa`: papel `admin` no andar X. Só em X: marca, logo, expediente, modo sério, times, planta, membros
    e convites de X, Conectar/Desconectar o OAuth de X, conversas e modo resposta de X.
  - `membro`: papel `membro` no andar X. O que o membro já fazia hoje, só em X.
  - `pessoa do prédio` (só no modo saguão): qualquer conta com pelo menos 1 andar. Só no Saguão.
- O andar do pedido é sempre o `?andar=` da URL (ausente = `principal`). **Andar que não existe e andar sem acesso dão a
  mesma resposta**: `404 {"erro": "andar", "codigo": "andar", "mensagem": "Esse andar não existe."}`. Tem acesso ao
  andar, mas o papel não deixa: `403 {"erro": "papel", "mensagem": "Só quem administra o escritório faz isso."}` (o de
  hoje).
- Sem `?andar=`, para quem não tem acesso ao principal (só no modo clássico, conta só de andar extra): o servidor
  responde pelo **primeiro andar da pessoa**. O front lê `config.andar` e passa a mandar `?andar=` daí em diante.

## 1. Marca por andar (itens 1 e 2 do Tron)

- `POST /api/marca?andar=X` `{empresa, cor, expediente?, serio?}` (o corpo de hoje) → `200` com o `/api/config` do
  andar X. Sem `?andar` = o principal (no saguão: a marca do prédio, que é a da tela de entrar).
- `POST /api/logo?andar=X` (corpo cru, PNG/JPEG/WEBP até 600 KB, como hoje) → `200` com o config do andar.
- `POST /api/logo/remover?andar=X` → `200` com o config do andar.
- Quem pode: admin do prédio (qualquer andar) e admin da empresa (só o próprio). No saguão, só o admin do prédio.
- `GET /api/config?andar=X` já traz a marca do andar: `empresa`, `cor`, `logo`, `serio`, `expediente`,
  `marca_exemplo`. Andar extra sem marca salva: `empresa` = nome do andar, `cor` = a padrão, logo = o padrão (nunca a
  marca de outro andar nem a do prédio). Clima e datas (`clima`, `festas`) continuam do prédio.
- `logo`: no principal, `"/logo?v=<hash>"` (como hoje, público); no andar extra, `"/logo?andar=X&v=<hash>"`, que só
  abre com sessão e acesso ao andar (sem acesso: 404). Use a URL que vem no config, sem montar.
- O `config_v` do `/api/estado` muda quando muda a marca ou o logo do andar.

## 2. Elevador e saguão (item 3)

- `GET /api/config` traz:
  - `terreo`: `"classico"` ou `"saguao"`.
  - `andar`: o id do andar desta resposta.
  - `andares`: `[{id, nome, conexao}]`, **já filtrado pelo servidor** (só o que a pessoa pode abrir), o principal
    primeiro.
    - Clássico: `{id: "principal", nome: "Térreo", conexao}` só para quem tem papel no principal (ou é admin do
      prédio); depois os andares da conta (admin do prédio vê todos).
    - Saguão: `{id: "principal", nome: "Saguão", conexao: null}` sempre, para toda conta com pelo menos 1 andar; depois
      os andares em que a conta tem papel (admin do prédio vê todos).
  - `conexao` de cada andar: `carregando`, `conectado`, `sem_conexao`, `recusada`, `pausa`, `falha`, `outra_org` e o
    novo `conferindo` (conectado, conferindo o workspace: E.2 item 5; o andar fica sem agentes até confirmar). No
    saguão, `null`.
- No saguão, o `/api/config` sai sem times (`times: []`, `aparencia: {}`), sem `app_url` e com `pode_responder: false`;
  o `/api/estado` sai com `agentes`, `trabalhos`, `tarefas` e `conversas` vazios e sem as chaves `social` e
  `visitantes`. `/api/social`, `/api/social/placar`, `/api/jornal`, `/api/conversa` e `/oauth/conectar` dão 404 no
  saguão.
- A lista `visitantes` do `/api/estado` só existe no principal do modo clássico (como hoje). Nos andares extras e no
  saguão a chave não vem.

## 3. Perfis no config (item 4)

- `config.papel`: o papel da pessoa **no andar desta resposta**: `"admin"`, `"membro"` ou `"pessoa"` (pessoa do
  prédio, só no saguão). O admin do prédio sai `"admin"` em qualquer andar.
- `config.admin_predio`: `true` só para o admin do prédio. É o que libera Andares, Clima, Datas, Visitas e a lista de
  todas as contas. O admin da empresa sai com `papel: "admin"` no andar dele e `admin_predio: false`.
- `config.pode_responder` continua como hoje (admin do andar com o modo "responder" e escrita).

## 4. Membros (item 5)

### Visão do andar: `?andar=X` (admin da empresa de X, ou admin do prédio olhando X)

- `GET /api/membros?andar=X` → `{"contas": [{usuario, nome, papel, criado}], "convites": [{id, nome, andares: [X],
  expira}]}`. Só as contas com papel em X (`papel` = o papel em X) e só os convites para X. Nada dos outros andares da
  conta.
- `POST /api/membros?andar=X`, JSON:
  - `{"acao": "convidar", "nome", "senha"}` → `{link, convite}`. Convite de membro **só para X** (sem o principal,
    sem caixas de andar).
  - `{"acao": "revogar", "id"}` → só convite de X (outro: 404 `nao_existe`).
  - `{"acao": "papel", "usuario", "papel", "senha"}` → `papel` (`admin`/`membro`) **em X**.
  - `{"acao": "remover", "usuario", "senha"}` → **tira só o andar X** da conta (a conta continua com os outros
    andares; quem apaga a conta inteira é o admin do prédio, na visão do prédio).
  - Resposta das quatro: `{contas, convites}` do andar X.
  - Erros: `403 senha_incorreta`, `429 tentativas_demais`, `404 nao_existe` (conta sem papel em X tem a mesma resposta
    de conta que não existe), `409 ultimo_admin` (o último admin de X não sai nem é rebaixado), `400 pedido`.

### Visão do prédio: sem `?andar` (só o admin do prédio)

- Como hoje: `GET /api/membros` → `{contas: [{usuario, nome, papel, andares, criado}], convites}` com todas as contas;
  `papel` é o papel no principal.
- `POST /api/membros` com as ações de hoje (`convidar {nome, andares, senha}`, `revogar`, `papel`, `andares`,
  `remover`).
  - Clássico: o principal continua **sempre** na conta e no convite (como hoje).
  - Saguão: o principal **não** é caixa de andar (o saguão é de todos). `convidar` e `andares` pedem pelo menos 1
    andar extra (`400 pedido` sem nenhum). `papel` sem `?andar` = o papel no prédio (`admin` = admin do prédio).
  - `andares` mantém o papel que a conta já tinha nos andares que ficam (o admin da empresa não é rebaixado); andar
    novo entra como membro.

## 5. Conectar e Desconectar o andar (item 6)

- Conectar: `GET /oauth/conectar?andar=X` (navegação, como hoje) → `302` para o agentes.chat. Admin de X e admin do
  prédio. Membro de X: 403. Andar alheio ou inexistente: 404. No saguão: 404.
- A volta (`/oauth/retorno`) só vale na sessão de quem começou e com o papel de admin em X ainda valendo; senão 400.
  Depois volta para `/#andar=X`.
- Desconectar: `POST /oauth/desconectar?andar=X`, `Origin` igual à BASE, JSON `{"senha"}` (a senha da conta, balde do
  login) → `200 {"ok": true}`. Revoga o token e apaga a conexão do andar. Erros: `403 senha_incorreta`,
  `429 tentativas_demais`, `400 pedido`, 404 (andar alheio, inexistente ou saguão), 403 `papel` (membro).
- A conexão do andar atual: `config.andares.find(a => a.id === config.andar).conexao`.
- O admin da empresa nunca vê o `org` (o `/api/andares` continua só do admin do prédio).

## 6. Push (para saber; a tela não muda na Onda 1)

- `POST /api/push/assinar` e `/api/push/sair`: sem mudança (a assinatura já guarda a conta). O aviso de um agente do
  andar X só vai para os aparelhos de contas com papel em X, conferido na hora do envio (perdeu o papel, parou de
  receber).
- `GET /api/avisos` (o sw.js, sem `?andar`): o aviso mais recente **destinado a esta conta**, de qualquer andar em que
  ela tem papel: `{"aviso": {agente, nome, tipo, quando}}` (o formato de hoje) ou `{"aviso": null}`. No saguão não há
  avisos de agente.

## 7. Com a migração (Trinity, migracao_saguao.py)

- Despacho: `escritorio.py saguao [--desfazer]` chama `migracao_saguao.principal(argv, dados, times, org) -> int`, com
  `argv` = os argumentos depois de `saguao`; o código de saída é o que ela devolve (0 deu certo, 1 recusada, 2 uso).
- Trava do serviço: o `main()` chama `migracao_saguao.travar(DADOS)` depois de ler contas e andares e antes de abrir a
  porta, e guarda o retorno pela vida do processo; `ServicoRodando` encerra a subida com a mensagem.
- Diário pela metade: logo depois da trava, o `main()` recusa subir se o diário estiver `em_andamento` ou `desfazendo`
  (`motivo_da_migracao`). PROVISÓRIO: chama `migracao_saguao.estado(dados)`, que devolve o estado em texto; o nome e o
  retorno trocam quando a Trinity exportar a função dela.
- O v2 gravado: `{"v": 2, "terreo": "saguao", "andares": [...]}`, a Dev Maniac's primeiro, com `org` = AGENTES_ORG.
- No andar: `oauth.json`, `equipe.json`, `planta.json`, `placar.json`, `jornal.json` (movidos) e `times.json`,
  `marca.json`, `logo.img` (copiados, com o nome da raiz). O escritório lê a marca, o logo e os times do andar com esses
  nomes.
- Recepção no v2: o andar que atende é o de `org` = AGENTES_ORG (o `recepcao.json` não muda). Clássico: o principal.

## Pendências do back (não mudam este contrato)

- O sinal que confirma a org (E.2 item 5) é o link de uma tarefa com `/org/<org>/`. Sem tarefa com link, o andar
  conectado por um admin fica em `conferindo`.
