> [🇺🇸 English](./CHANGELOG.md) | 🇧🇷 Português (Brasil)

# Histórico de mudanças

As mudanças que importam neste projeto ficam aqui, da mais nova para a mais antiga. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Desde a 1.1.0, as versões seguem o [SemVer](https://semver.org/lang/pt-BR/); as entradas mais antigas são marcos com data.

## 1.2.0 · 2026-11-08 · Novidades

Commits: [`v1.1.0...v1.2.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.1.0...v1.2.0).

### Adicionado
- **Novidades:** página no menu com este histórico de mudanças, o da versão instalada, das mais novas para as mais antigas (até 10). O selo **Novo** aparece no menu quando a versão do escritório é diferente da última vista neste navegador, e some ao abrir a página. Os dados vêm do `GET /api/novidades` (com sessão), que lê o `CHANGELOG.pt-BR.md` do disco, sem chamada ao agentes.chat. Veja [Segurança](./README.pt-BR.md#segurança).

### Mudado
- O `CHANGELOG.pt-BR.md` agora vai na imagem Docker e no `instalar.sh`, ao lado do código: é ele que a página Novidades mostra. O teste da lista confere os dois caminhos.

### Segurança
- Os itens chegam ao navegador em markdown inline cru (negrito, código e links) e são desenhados só com `textContent`. Os links saem só para este repositório (os relativos viram o endereço dele no GitHub, e nenhum caminho com `..` passa); qualquer outro vira texto, no servidor e de novo no navegador.
- O changelog fica na memória até o arquivo mudar, inclusive quando é ilegível. Ausente, ilegível ou acima de 1 MB, a lista sai vazia, com uma linha no log.

## 1.1.0 · 2026-11-08 · Conectar, Configurações, modo TV, jornal e aviso no celular

Release [`v1.1.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.1.0). Commits: [`v2026.11.06...v1.1.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v2026.11.06...v1.1.0).

### Adicionado
- **Conectar pela tela:** botão na faixa de conexão, páginas de erro do OAuth com o motivo e o `conexao` no `/api/estado` (`carregando`, `conectado`, `sem_conexao`, `recusada`, `pausa` ou `falha`). Na volta da autorização, a primeira leitura sai na hora. Veja [Conectar ao agentes.chat](./README.pt-BR.md#conectar-ao-agenteschat).
- **Assistente de primeira instalação**, no lugar das boas-vindas, que retoma no Conectar depois de uma autorização recusada.
- **Configurações pela tela:** a cidade do clima (busca pelo nome, pelo servidor; trocar não pede reinício), as datas comemorativas (desligar as 13 embutidas e criar até 24 próprias) e os times e a aparência de cada agente, em `dados/clima.json`, `dados/festas.json` e `dados/equipe.json`. **Voltar ao times.json** apaga o ajuste.
- **Sair de todos os aparelhos:** com a senha de novo, encerra todas as sessões e desliga o aviso no celular em todos os aparelhos.
- **Docker e Coolify:** `Dockerfile`, `.dockerignore` (lista de permissão) e `docker-compose.yml` sem portas publicadas, com a variável nova `ESCRITORIO_BIND`. Veja [Docker e Coolify](./README.pt-BR.md#docker-e-coolify).
- **Modo TV** (`/?tv=1` ou botão): tela cheia, tela sempre acesa e um diretor de câmera que mostra os pedidos, as brigas e as greves. A TV recarrega sozinha quando a configuração muda (`config_v` no `/api/estado`). Veja [Modo TV](./README.pt-BR.md#modo-tv).
- **App instalável (PWA):** manifesto, ícones e um `sw.js` sem cache, que só serve para instalar e para o aviso no celular. Veja [App instalável](./README.pt-BR.md#app-instalável-pwa).
- **Visitantes:** quem mais está com o escritório aberto aparece como visitante anônimo, com "N pessoas olhando" e a opção **Aparecer no escritório**. A TV não aparece. Veja [Visitantes](./README.pt-BR.md#visitantes).
- **Jornal da semana:** página com as notas da semana atual e da anterior (destaque da semana, quem mais pediu a sua aprovação, campeão do ringue, semana de chuva), montadas no navegador a partir do `GET /api/jornal`, que guarda só ids e números em `dados/jornal.json`. Veja [Jornal](./README.pt-BR.md#jornal).
- **Time-lapse do dia:** um quadro do prédio a cada 2 minutos do expediente, só no navegador (IndexedDB), e um vídeo de uns 30 s em MP4 ou WebM para baixar, com aviso de privacidade antes. Veja [Time-lapse](./README.pt-BR.md#time-lapse).
- **Aviso no celular:** push nativo sem conteúdo, assinado com VAPID (`vapid.py`, ES256 em Python puro), quando um agente pede a sua aprovação ou uma resposta. **Avisar no celular** fica na página Aprovações. Só funciona com a `ESCRITORIO_BASE` em https; no iPhone, só com o app na tela de início (iOS 16.4+). Veja [Avisar no celular](./README.pt-BR.md#avisar-no-celular) e [Segurança](./README.pt-BR.md#segurança).
- Para desenvolver: `ferramentas/agentes_falso.py` (um agentes.chat de mentira, só em `127.0.0.1`) e, na prévia, `--conexao`, `--visitantes`, `--jornal` e `--push` (com um serviço de push falso e local).

### Mudado
- HTTP 402 e 403 na leitura viram `recusada`, como o 401, e não mais queda de rede. Enquanto a recusa continuar, a leitura espera de 30 s até 5 min.
- Entrar por um endereço diferente da `ESCRITORIO_BASE` mostra o endereço certo na tela de entrar.
- Trocar a conta no agentes.chat recomeça a lista de eventos, os resolvidos do dia, o jornal e o último aviso: nada da conta anterior fica à vista.
- **Ao atualizar:** a `ESCRITORIO_BASE` precisa ser só a origem (sem caminho nem barra no fim, host em minúsculas). Fora disso, o serviço não sobe e diz o porquê.

### Segurança
- Toda gravação nova (clima, datas, times, Sair de todos e push) segue o molde do modo construção: `Origin` igual ao endereço, sessão, só JSON, teto de corpo, validação tudo ou nada (sem `NaN`, `Infinity` nem `true` no lugar de número) e gravação atômica sob trava.
- O CSP não mudou: o navegador continua falando só com o próprio servidor. A busca de cidade e o push saem pelo servidor, para hosts fixos, sem seguir redirecionamento.
- O `error_description` e o corpo das respostas do agentes.chat nunca chegam à tela, e o log guarda só o código do erro.
- O aviso no celular vai vazio. Os serviços de push (Google, Mozilla, Apple, Microsoft) recebem a mensagem vazia, a hora e a assinatura VAPID: um JWT com o endereço do escritório (`ESCRITORIO_BASE`) como contato (`sub`) e a chave pública. Nada disso vai para o agentes.chat.
- Os visitantes saem só da memória: um id anônimo (HMAC com chave sorteada a cada subida), sem nada no disco nem no log.
- Com `ESCRITORIO_BIND=0.0.0.0`, a `ESCRITORIO_BASE` é obrigatória. A imagem roda com usuário próprio e sem shell, e o compose roda só de leitura. O README ganhou o que muda com um [endereço público](./README.pt-BR.md#endereço-público).

### Corrigido
- O `instalar.sh` instala e compila todos os módulos que o serviço importa: desde as Configurações, o serviço instalado por ele caía ao subir por falta do `ajustes.py`. Também copia o manifesto do app. Um teste confere a lista contra os imports.
- Olhos e acessório do avatar vinham vazios para alguns handles: o hash passou a usar `>>>`.

## 2026-11-06 · Modo construção v1

Release [`v2026.11.06`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v2026.11.06), com o vídeo de lançamento (narração em português do Brasil, com legenda). Commits [`4860c88`](https://github.com/HelbertMoura/escritorio-agentes/commit/4860c88) e [`26192a6`](https://github.com/HelbertMoura/escritorio-agentes/commit/26192a6).

### Adicionado
- **Modo construção** (`construir.html`, aberto pelo **Personalizar**): pintar a parede e o piso de cada sala; mover, espelhar, tirar e pôr móveis de um catálogo de 53 enfeites (peça nova é só enfeite: ninguém senta nela). Veja [Modo construção](./README.pt-BR.md#modo-construção).
- Desfazer e refazer (até 100 passos), **Descartar**, **Voltar ao automático** (com diálogo de confirmação) e **Salvar**, que fica bloqueado enquanto um assento estiver sem passagem e marca esse assento no mapa.
- Tudo funciona sem arrastar e pelo teclado: Tab e Enter escolhem a peça, as setas movem (8 px; Shift: 1 px), `E` espelha e `Delete` tira. As mudanças são anunciadas ao leitor de tela.
- A planta fica salva no servidor, em `dados/planta.json`, pelo `POST /api/planta`, e a mesma planta chega a todas as telas ao recarregar. Ela é aplicada por cima do prédio automático: com a planta vazia, o prédio fica idêntico ao de antes.
- `construir.html?demo=1`: uma demonstração do editor com exemplo próprio, em que nada é salvo.
- Testes no `test_planta.py` e conferências da rota nova no `ferramentas/checar_seguranca.py`; o `ferramentas/checar_planta_mapa.mjs` compara o prédio com e sem planta.

### Mudado
- A mesa de pingue-pongue fica 12 px mais acima, para o jogador de baixo ter passagem. Isso muda o prédio automático de todos os escritórios, mesmo sem planta.

### Segurança
- `POST /api/planta`: o `Origin` precisa ser o endereço do servidor (sem cair para o `Referer`), exige sessão, só aceita JSON (senão, 415), corpo de até 64 KB, validação tudo ou nada (a mesma na leitura e no salvar) e o `rev` atual (409 quando outra tela salvou antes). A gravação é feita sob uma trava, com a gravação atômica em 0600; o log guarda contagens, nunca o conteúdo.
- Um `planta.json` ilegível ou inválido volta ao prédio automático, com uma linha no log; uma planta ruim nunca derruba a página.
- Todo `POST` lê o corpo (até 128 KB) antes de responder, para a recusa chegar ao cliente em vez de a conexão cair; cada rota mantém o seu teto de tamanho.
- O ringue, o quadro do placar, o painel do logo e as placas não se editam, e nada movido ou posto pode cobri-los.

## 2026-11-06 · Vida social, fatia 2: greve, reclamações, fofoca e entregas

Commit [`5dbdc73`](https://github.com/HelbertMoura/escritorio-agentes/commit/5dbdc73).

### Adicionado
- **Reclamações e sugestões** em balões, e **fofoca** no bebedouro ("Psiu…"), sem nome no balão. Elas mexem nas amizades.
- **Greve** na Sala comunal, no máximo uma por dia: os livres sentam no chão na frente do ringue com plaquinhas de papelão, com um aviso em cima do mapa e o botão **Atender o pedido**. Clicar numa plaquinha faz o mesmo.
- **Entregas**, uma por pedido: o motoboy da pizza chega de moto, o entregador traz o café, um bolo com vela, um pufe novo, um roteador, travesseiros, o ar no 23 ou a faixa "Sexta livre aprovada!" com festinha. Iguais em todas as telas, desenhadas em pixel art e com sons próprios.
- `POST /api/social/greve/atender`, com as mesmas regras das outras rotas da vida social.
- Testes T-G1 a T-G5 e acessibilidade do aviso da greve.

### Mudado
- O **modo sério** pausa também a greve e as entregas. Quem trabalha ou espera você nunca sai da mesa.

## 2026-11-06 · Vida social, fatia 1: amizades, Ringue e placar semanal

Commit [`81ba7b5`](https://github.com/HelbertMoura/escritorio-agentes/commit/81ba7b5).

### Adicionado
- **Amizades e rivalidades** de cada dupla de agentes, decididas pelo servidor (`social.py`) e iguais em todas as telas.
- **Ringue** na Sala comunal: brigas automáticas e **Mandar pro ringue** pela ficha do agente, com gongo, plateia, nuvem de poeira de desenho animado, sons, a faixa do vencedor e as pazes depois. Só entram os livres.
- **Placar semanal** (segunda a domingo, no horário de Brasília), com o top 3 num quadro na parede do ringue, o ranking completo ao clicar nele e o campeão da semana passada. Gravado em `dados/placar.json`.
- **Modo sério** no **Personalizar**, que pausa a vida social inteira.

## 2026-11-05 · Conversas, modo resposta e expediente

Commits [`0d13e25`](https://github.com/HelbertMoura/escritorio-agentes/commit/0d13e25) e [`cdec3b7`](https://github.com/HelbertMoura/escritorio-agentes/commit/cdec3b7).

### Adicionado
- Página **Conversas** (`"conversas": "ler"`, desligada por padrão): a lista do dia (esperando você, trabalhando, terminadas hoje) e a conversa de cada tarefa, lida pela thread dela, dentro do orçamento diário do agentes.chat.
- **Modo resposta** opcional (`"conversas": "responder"`, desligado por padrão): mandar mensagens nas conversas diretas do dia, com a permissão "ler e mandar tarefas", senha uma vez, modo de 1 hora (teto de 8 horas) por navegador, limites, registro sem conteúdo e proteção contra envio duplicado.
- **Expediente** no **Personalizar**, com faixa e placa no mapa, inclusive turno que vira a meia-noite.
- Demonstração animada no topo dos READMEs, com imagem parada para quem prefere menos movimento.

### Mudado
- O mapa em tela cheia passa a começar abaixo da faixa do topo, para os controles não ficarem cobertos.
- Testes isolados dos arquivos locais; prints da documentação refeitos.

### Removido
- A maquete 3D e o three.js.

## 2026-11-04 · Primeira versão pública

Commit [`54c329b`](https://github.com/HelbertMoura/escritorio-agentes/commit/54c329b).

### Adicionado
- Escritório em pixel art, ao vivo, para os agentes do agentes.chat: mapa procedural de 1 a 20 times, vida e sons dos agentes, aprovações com o histórico do dia, personalização da marca, simulação de data, hora e clima, maquete 3D, modo foto e modo demonstração.
- Servidor em Python (só a biblioteca padrão), alcançável só pela tailnet, com código de primeiro acesso de uso único e falha fechada quando o arquivo de usuários não pode ser lido.
- Licença AGPL-3.0-or-later.
