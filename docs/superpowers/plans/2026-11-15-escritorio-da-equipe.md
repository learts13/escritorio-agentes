PARECER GANDALF · 1.6 "Escritório da equipe" (14/11/2026). Somente leitura, sem commit. Base: andares @ 9f4e6ca. Não autoriza commit nem deploy.

VEREDITO: APPROVED do desenho abaixo, com 4 condições obrigatórias:
 (1) a Onda 1 (empresa por andar) fecha os 4 vazamentos achados no código (A.3) ANTES de qualquer histórico, DM ou anexo ir para o disco;
 (2) a guarda passa a decidir por (papel NO ANDAR do pedido, método, rota), negando por padrão, com a matriz de rotas refeita para 3 perfis (admin do prédio, admin da empresa, membro);
 (3) sem andares.json e sem conta de membro, tudo fica igual a hoje (a suíte atual passa sem mudar asserts);
 (4) persistir o chat inverte a promessa da doc ("nada de texto no disco"). Doc de privacidade, README e um aviso no próprio painel mudam no mesmo pacote que grava a primeira mensagem, e a retenção vem da decisão D3.

=== A. ANDARES = EMPRESAS ===
O modelo de dados já ajuda: usuarios.json guarda "andares": {id: papel} por conta (acesso.py `_criar`, `aceitar_convite`). O que falta é aplicar isso.

A.1 Passa a ser POR ANDAR (por empresa):
- Marca: nome da empresa, cor, logo, modo sério e expediente. Hoje são globais: ARQ_MARCA/ARQ_LOGO em config_publica (escritorio.py:2155-2170), salvar_marca (:2380), config_v (:2276) e modo_serio() no /api/estado (:3098). Ficam em dados/andares/<id>/{marca.json, logo}; no principal, os arquivos de sempre.
- Push: assinaturas com dono (usuario + andar) e um Leitor por andar mandando avisos. Hoje só o Leitor do principal tem avisos (escritorio.py:3920) e a lista de aparelhos não tem dono (comentário em :3679).
- GET /api/avisos: o último aviso do andar pedido.
- Membros e convites: o admin da empresa convida e administra só o próprio andar.
- Recepção/visitas: o desenho vale por andar, mas na 1.6 ficam só no térreo (D7). A PonteVisitas usa o cred do principal e não tem como falar por outro workspace sem mexer nela.
- Times, planta, equipe, social, jornal, conversas dos agentes, presença e chat já eram por andar.
A.2 Continua DO PRÉDIO: clima e cidade (o prédio fica num lugar só), festas do calendário, novidades, ClimaMundo e /mundo.html, contas e sessões (um login serve para várias empresas), VAPID (uma chave; a lista de aparelhos ganha dono), BASE/OAuth client e o logo da tela de entrar (/logo sem andar = o do prédio).
A.3 VAZAMENTOS QUE EXISTEM HOJE e quebram o modelo de empresas (evidência):
 a) Todo membro é membro do principal à força. acesso.py `convidar` grava "andares": [ANDAR_PRINCIPAL, *extras]; `definir_andares` mantém sempre o principal; `_andares_validos` tira o principal da lista. Resultado: quem é da empresa B vê a empresa A (térreo). Correção: o principal vira opcional; a conta precisa de pelo menos 1 andar.
 b) O papel só sai do principal: `_papel()`, `_admin_do_predio()` e `_permitido()` (escritorio.py:2860-2885). Não existe admin de empresa. Correção: o papel sai do andar do pedido. "Admin do prédio" = admin do principal (como hoje) e vê tudo. "Admin da empresa" = papel admin no andar X, só em X.
 c) A classe Visitantes é do prédio inteiro e entra no /api/estado de qualquer andar (escritorio.py:3092-3094, :3934). Ela mostra ids anônimos e a contagem de sessões abertas de todas as empresas. Correção: tirar (o B2 já previa tirar; a presença por andar faz esse papel) ou separar por andar.
 d) Push e /api/avisos: um membro da empresa B que assina o push recebe "agente X esperando você" do principal, com o nome do agente (avisos.py transicoes/publico). Correção: o item A.1 (dono e andar).
A.4 Migração: nenhuma. Sem marca.json no andar extra, vale o padrão do andar (o nome do andar como empresa, a cor padrão e o logo padrão), não a marca do prédio. Assim a empresa B nunca aparece com o logo da A. Conta sem "andares" = admin do principal (_papel_de, como hoje).
A.5 Papéis por empresa: admin da empresa X NÃO administra Y. Pode: marca, logo, times/equipe, planta, membros e convites de X (só convida para X). Não pode: /api/andares, OAuth (recomendado em D2), clima/festas do prédio, visitas, contas de outras empresas. GET /api/membros?andar=X lista só as contas com papel em X: hoje `contas()` devolve todas, com os andares de cada uma. Remover conta: o admin da empresa só tira o andar X da conta; apagar a conta inteira fica com o admin do prédio, e só quando ela não tem outros andares. Último admin: protegido por andar, e o do prédio continua protegido.
A.6 Riscos de isolamento e testes obrigatórios: IDOR de ?andar= em toda rota nova (logo, marca, membros, histórico, anexo, DM), com a mesma resposta 404 para inexistente e sem acesso; logo de andar só com sessão e _pode_andar (/logo?andar=B pedido por membro de A = 404); nome de usuário é global, então o convite de B não pode revelar que o login "joao" existe em A (ContaExiste é um oráculo já aceito para o próprio cadastro, e fica assim); push direcionado (B não recebe nada de A); matriz membro/admin-empresa/admin-prédio × todas as rotas × andar próprio/alheio.

=== B. COMUNICAÇÃO DA EQUIPE ===
Base recomendada: um store por andar em SQLite (sqlite3 é da stdlib; FTS5 conferido aqui, SQLite 3.50.4) em dados/andares/<id>/equipe.db (o principal em dados/equipe.db), modo WAL, uma conexão sob trava (pouco volume) e permissão 0600. Um módulo novo conversas_equipe.py, no molde do presenca.py: sem HTTP, relógio injetável e nada de texto no log. O presenca.py continua dono só da posição.

B1. Histórico do chat · custo M · risco M (privacidade)
 Opção 1: JSONL por sala e por dia, com retenção por apagar arquivo. É simples de gravar, mas busca, DM, apagar mensagem e não lidas precisam de índice feito à mão.
 Opção 2 (RECOMENDO): SQLite com as tabelas canal, mensagem, leitura, reacao e anexo, e FTS5 para a busca.
 Contrato: canal = uma sala do mapa ("sala:<chave>"), "geral" do andar ou "dm:<u1>:<u2>". Quem lê: qualquer pessoa com papel no andar lê canal de sala e geral (a sala não é fronteira, como hoje); DM só os dois. A mensagem do mapa continua indo para a sala do autor no servidor. O histórico vem paginado: GET /api/canal/historico?andar=&canal=&antes=<id>&limite=50. Retenção por empresa (D3; padrão 90 dias), aplicada por uma varredura diária no service_actions, com teto de disco por andar (200 MB no banco; passou do teto, saem as mais antigas e a tela avisa o admin). Apagar: o autor apaga a própria mensagem (o texto some de verdade e fica "mensagem apagada"); o admin da empresa apaga qualquer uma em canal; DM só o autor. Conta removida: as mensagens ficam com "ex-membro" (D8). Busca: FTS5 restrita aos canais que a pessoa lê, ≤ 1 por segundo. LGPD: a empresa é a controladora; a doc diz o que fica, por quanto tempo, quem lê e que quem opera o servidor pode ler o disco (sem cifra em repouso). Exportar os próprios dados fica para depois (NÃO no escopo).
B2. DM e menção · custo M · risco M
 Opção 1: DM só na memória, como o chat de hoje (some em 10 min).
 Opção 2 (RECOMENDO): DM persistente no mesmo store, só entre pessoas do MESMO andar. Uma conta que está em duas empresas tem DMs separadas por andar.
 Menção: @usuario no texto, resolvida no servidor contra quem tem papel no andar (sem enumerar ninguém de fora). Vira contagem de não lidas e de menções no /api/ao-vivo e push direcionado ("Fulano te mencionou", SEM o texto, D5). Status "ocupado" segura o push. O admin da empresa NÃO lê DM (D4).
B3. Anexos · custo M/G · risco ALTO (conteúdo de usuário servido na mesma origem)
 Opção 1: só imagens (PNG/JPEG/WEBP), 5 MB.
 Opção 2 (RECOMENDO): imagens PNG/JPEG/WEBP/GIF mais PDF, TXT/CSV e DOCX/XLSX/PPTX, 10 MB por arquivo, 1 GB por empresa (D6).
 Proibidos: SVG, HTML/XML, JS, executáveis e ZIP/RAR (o ZIP fica em D6, desligado por padrão).
 Envio: POST /api/anexo?andar=&canal= com o corpo cru (application/octet-stream) e o nome no cabeçalho X-Nome (≤120, ROTULO-like), lido em blocos até o teto. NÃO usar multipart (o módulo cgi saiu no Python 3.13). Hoje o do_POST lê só até CORPO_ANTES = 128 KB (escritorio.py:2065), então a rota de anexo lê o próprio corpo como o /api/logo. Limite de 10 anexos por minuto por pessoa.
 Validação: o tipo sai dos bytes mágicos (como o tipo_imagem), nunca do cliente; o OOXML sai do ZIP com [Content_Types].xml e sem vbaProject.bin. Nas imagens, o servidor tira EXIF/GPS (JPEG APP1/APP13, PNG eXIf/tEXt/iTXt, WEBP EXIF/XMP) com parser stdlib e testes.
 Guarda: dados/andares/<id>/anexos/<token_hex(16)>, sem nome nem extensão do cliente no caminho; o nome original fica só no banco.
 Servir: GET /api/anexo?andar=&id= com sessão, papel no andar e leitura do canal (IDOR = 404). Content-Type só da lista; X-Content-Type-Options nosniff; Content-Disposition: attachment com filename* RFC 5987, e inline só para PNG/JPEG/WEBP/GIF mostrados em <img>; na resposta do anexo, CSP "default-src 'none'; sandbox"; Cache-Control private, no-store.
 Antivírus: o ClamAV não é stdlib e pesa na operação. Recomendo NÃO ter na 1.6; a defesa é a lista fechada, o download forçado e o sandbox. O gancho opcional (clamd por socket, por env) fica para depois.
 Apagar a mensagem apaga o arquivo; a retenção e a cota contam os anexos.
B4. Reuniões · risco M
 Opção 1 (RECOMENDO para a 1.6, custo P): link externo fixo por sala. O admin da empresa cola o link permanente da sala (Google Meet, Jitsi, Zoom, Teams), aceito só com https e host numa lista fechada (meet.google.com, meet.jit.si, *.zoom.us, teams.microsoft.com, mais um host de Jitsi próprio por env). O botão "Entrar na reunião" na sala do mapa abre em aba nova (rel=noopener): CSP e Permissions-Policy não mudam. A presença mostra "em reunião" (status B5).
 Agenda (custo M, Onda 3): reunião marcada por andar {título, sala, início, duração, convidados do andar}, no store; placa na porta da sala; aviso 5 min antes (in-app e push); .ics para baixar. Sem integração com Google Calendar.
 Opção 2 (custo G, fase posterior): voz WebRTC própria por proximidade/sala, com mesh P2P de até 6 pessoas (só áudio; vídeo em mesh pesa a partir de 4). Sinalização pelo tipo "sinal" já reservado (≤8 KB, destino = usuario), com ICE sem trickle para o polling de 1,5 s (subindo para 0,5 s durante a negociação). STUN público basta dentro da tailnet (NÃO VERIFICADO: os candidatos do IP 100.x com o mDNS do Chrome). Pela Cloudflare e em rede corporativa, precisa de TURN: coturn próprio (mais um serviço para operar) ou TURN pago. Exige Permissions-Policy microphone=(self) e uma doc de privacidade própria. Só se o Helbert quiser depois do link externo (D9).
B5. Interações baratas (as 5 de melhor valor por custo, cada uma P, risco baixo):
 1) Status: disponível, ocupado, em reunião ou ausente, mais um texto de até 40 caracteres, no boneco e na lista; "ocupado" segura push e acenar. Fica na conta, por andar.
 2) Reações em mensagem: lista fechada de 8 emojis, uma por pessoa por emoji.
 3) Acenar / bater na porta: um toque numa pessoa vira um aviso para ela (in-app; push se a aba estiver escondida), 1 a cada 30 s por par.
 4) Mural da sala: até 10 avisos fixos por sala ou geral, persistentes, que qualquer membro cria e o autor ou o admin da empresa tiram.
 5) Lista de quem está no andar com "ir até": clicar no nome leva o boneco até a pessoa, pelo pathfinding que já existe.
TRANSPORTE: o polling aguenta, com estas regras. O /api/ao-vivo continua levando só deltas: posição, mensagens novas dos canais abertos, contadores de não lidas e de menções, status e acenos. Histórico, busca e anexos vão em rotas próprias e sob demanda, nunca no polling. O id persistente da mensagem é o do SQLite, não o seq da memória, que zera no reinício (o vida.js já adota o seq do servidor: static/vida.js, vivo.seq = d.seq). A conta: 64 pessoas × 0,67 pedido/s ≈ 43 pedidos/s por andar cheio, leitura de memória, e cabe no ThreadingHTTPServer. Trocar por SSE só se a medição mostrar mais de ~150 clientes ao mesmo tempo, ou se a voz WebRTC pedir menos de 1 s. O que o SSE exige: protocolo HTTP/1.1 no handler, uma thread presa por stream (fora do timeout = 15 de escritorio.py:2672), heartbeat a cada 15 s (a Cloudflare corta a conexão parada em ~100 s), Content-Type text/event-stream sem compressão, e o polling como volta automática. WebSocket NÃO: na stdlib seria implementar a RFC 6455 à mão. NÃO VERIFICADO: o Tailscale serve repassar stream sem buffer.

=== C. ONDAS (no máximo 3 floors; o escritorio.py tem um dono por onda) ===
ONDA 1: empresa por andar e o store.
 - A-back · Neo: acesso.py (principal opcional, papel por andar, contas por andar, último admin por andar), escritorio.py (guarda por andar, marca/logo/expediente/sério por andar, /logo?andar com sessão, config_v, Visitantes fora ou por andar, /api/avisos e push por andar), avisos.py (assinatura com usuario+andar, envio direcionado), test_membros.py, test_andares.py e test_avisos.py.
   Aceite: suíte atual verde; matriz 3 perfis × rotas × andar próprio/alheio; empresa B sem nada de A (estado, config, logo, avisos, push, membros, visitantes); convite só para o próprio andar; checar_seguranca limpo.
 - Store · Trinity: conversas_equipe.py (novo, só stdlib: canais, mensagens, DM, leitura, reações, mural, busca FTS5, retenção, teto de disco, metadados de anexo) e test_conversas_equipe.py.
   Aceite: isolamento por andar (um arquivo por andar) e por DM; apagar apaga mesmo (inclusive do FTS); retenção e teto com relógio injetado; nada de texto no log nem no print; trava sem deadlock com 20 threads.
 - A-front · Tron: ajustes.js (Personalizar e Membros por andar, admin da empresa), app.js (marca do andar na barra, o elevador só com as empresas da pessoa), personalizar.js.
   Aceite: sem andares extras, a tela fica igual; o admin da empresa não vê o que é do prédio; QA em 390 px.
ONDA 2: histórico, DM, menção, anexos e as 5 interações. Revisão do sentinela no diff de anexos e DM antes do merge.
 - B-back · Neo: escritorio.py (rotas canal/historico, busca, DM, apagar, anexo de envio e de leitura, status, reação, aceno, mural; deltas no /api/ao-vivo; push de menção), anexos.py (novo: bytes mágicos, tirar EXIF, OOXML sem macro), test_anexos.py, e a doc de privacidade com README (a condição 4).
 - Tron: chat_sala.js/css → painel com histórico, canais, DM, menções, reações, anexos e o aviso de retenção.
 - Flynn: vida.js/mapa.js (status no boneco, acenar, "ir até", mural na sala, lista do andar).
 Aceite: IDOR de anexo e de DM = 404; SVG/HTML recusados mesmo renomeados; resposta do anexo com nosniff, attachment e sandbox; EXIF some (teste com GPS); cota; menção não acha quem é de fora do andar; push sem texto.
ONDA 3: reuniões.
 - Neo: o link por sala (allowlist) e a agenda no store e nas rotas.
 - Tron: o botão "Entrar na reunião", a agenda e o .ics.
 - Flynn: a placa na porta e o "em reunião" no mapa.
 WebRTC só depois, num pacote próprio com gate (D9).
Auditor (Spock) em cada onda; o sentinela no diff da Onda 1 (papéis e isolamento) e da Onda 2 (anexos e DM).

=== D. DECISÕES DO HELBERT (recomendação marcada com *) ===
D1. O térreo é: (a)* a empresa principal (Dev Maniac's), que membros de outras empresas não veem; (b) um saguão neutro que todo mundo vê.
D2. Admin da empresa: (a)* administra marca, times, planta e membros do próprio andar, sem mexer na conexão OAuth nem nos andares; (b) também conecta o OAuth do andar; (c) não existe: só o admin do prédio.
D3. Retenção do histórico: (a) 30 dias; (b)* 90 dias, ajustável por empresa; (c) 1 ano; (d) para sempre.
D4. O admin da empresa lê as DMs? (a)* não; (b) sim, com aviso no painel.
D5. O push de menção e de DM mostra: (a)* só "Fulano te mencionou"; (b) as primeiras palavras.
D6. Anexos: (a)* 10 MB por arquivo, 1 GB por empresa, sem ZIP; (b) 25 MB e 5 GB, com ZIP; (c) só imagens.
D7. Recepção e visitas: (a)* só no térreo na 1.6; (b) cada empresa com a sua já agora (custo G: PonteVisitas por andar).
D8. Conta removida: (a)* as mensagens ficam como "ex-membro"; (b) as mensagens são apagadas junto.
D9. Reunião: (a)* link externo fixo por sala (Meet, Jitsi ou Zoom) mais a agenda; (b) voz própria no navegador (WebRTC, precisa de TURN).

RISCOS RESIDUAIS: dado de usuário servido na mesma origem (mitigado, não eliminado: não existe uma origem separada para conteúdo); o banco sem cifra em repouso; quem opera o servidor lê tudo; proxy e CDN podem registrar corpos.
NÃO VERIFICADO: o Tailscale serve com SSE; o mDNS e os candidatos 100.x no WebRTC; a regra atual do meet.jit.si para criar sala (login exigido?); se o vida.js e os fetch do chat_sala.js levam ?andar em todas as chamadas (vi o Andar.url em expediente.js:45, mas não segui cada fetch); a carga real do polling com mais de 1 andar cheio; o FTS5 no Python do container Docker (aqui conferi o local).

---
DECISÕES DO HELBERT (Maestri Chat, 14/11/2026): D1 b (térreo = saguão neutro que todo mundo vê; detalhe pendente: Dev Maniac's sobe para andar próprio?), D2 b (admin da empresa também conecta o OAuth do andar), D3 1 ano, D4 b (admin da empresa lê DMs, com aviso), D5 b (push com as primeiras palavras), D6 b (25 MB por arquivo, 5 GB por empresa, com ZIP), D7 a, D8 a, D9 a.
D1 detalhe (Helbert, 14/11): A — a Dev Maniac's sobe para um andar próprio como as outras empresas; o térreo vira só saguão (recepção, visitas, chat geral, mural, quem está no prédio), sem agentes de ninguém.

=== ADENDO pós-decisões · Gandalf · 14/11/2026 ===
Somente leitura, sem commit. Base: andares @ 9f4e6ca. Revisa só o que D1-A, D2-b, D3 1 ano, D4-b, D5-b e D6-b mudam. Não autoriza commit, deploy nem a migração em produção.

VEREDITO (reemitido): APPROVED do desenho com as mudanças abaixo, agora com 8 condições obrigatórias:
 (1) mantida: a Onda 1 fecha os 4 vazamentos (A.3) ANTES de qualquer histórico, DM ou anexo ir para o disco;
 (2) atualizada: a guarda decide por (papel NO ANDAR do pedido, método, rota), negando por padrão, com 4 perfis: admin do prédio, admin da empresa, membro e "pessoa do prédio" (qualquer conta com pelo menos 1 andar, só no saguão);
 (3) mantida e ampliada: sem andares.json, ou com andares.json v1, tudo fica igual a hoje (a suíte atual passa sem mudar asserts). O saguão só existe com o v2 que a migração grava;
 (4) ampliada: a doc de privacidade, o README e o aviso no painel mudam no mesmo pacote que grava a primeira mensagem e dizem: 1 ano de retenção, DM legível pela administração da empresa, o registro desse acesso, o começo da mensagem no aviso do celular e o ZIP liberado;
 (5) nova: a migração para o saguão é explícita, feita com o serviço parado, com backup do volume, diário e "desfazer" testado nos dois sentidos. Rodar em produção é ação sobre dados de produção e exige GO expresso do Helbert;
 (6) nova: o OAuth pelo admin da empresa amarra o state à conta e ao andar e confere tudo na volta; o andar só mostra agentes depois de confirmar a org;
 (7) nova: o anexo é lido em blocos direto para o disco, com prazo total, reserva de cota e piso de disco do prédio. O ZIP NUNCA é extraído no servidor e é validado só pelos metadados, com tetos. O download vai sempre como attachment (a exceção é a imagem dentro de <img>), enviado em blocos;
 (8) nova: a leitura de DM pelo admin tem rota própria, registro de acesso sem texto e um aviso que a pessoa vê antes da primeira DM.

=== E. O QUE AS DECISÕES MUDAM ===

E.1 D1-A · o térreo vira saguão, e a Dev Maniac's sobe para um andar próprio · custo M · risco ALTO (migração de dados de produção)
Evidência: o principal é implícito e usa os arquivos da raiz (andares.py:1-4; AndarPrincipal em escritorio.py:2581-2599 liga srv.cred, srv.leitor, TIMES, ARQ_EQUIPE, ARQ_PLANTA). O AGENTES_ORG é obrigatório no main (escritorio.py:95). O andares.py recusa um extra com a org do principal (`_validar` começa com orgs={org_principal}; `criar` faz a mesma recusa). Os avisos estão presos ao Leitor do principal (`leitor.avisos = criar_avisos()`, escritorio.py:3920). A ponte das visitas usa o Leitor e o cred do principal: `PonteVisitas(srv.salas_visitas, leitor, lambda: recepcao_da_ponte(cred))` (:3950). O `recepcao_da_ponte` lê o times.json global (`carregar_times()`, :2250). O `Credenciais.salvar()` regrava o oauth.json no caminho fixo a cada renovação (:248-249). No Docker, o times.json fica no código, que é só leitura (docker-compose.yml:22 read_only: true; TIMES ao lado do script, escritorio.py:96).
 Como migrar: por um comando explícito, nunca automático, rodado pelo admin do prédio com o serviço PARADO: `python3 -I escritorio.py saguao` (no Docker: `docker compose run --rm <serviço> python3 -I escritorio.py saguao`), no molde do subcomando `codigo`. Não recomendo uma ação na tela. Mover arquivos com o Leitor rodando faz o salvar() ressuscitar o oauth.json na raiz na renovação seguinte, e a troca pede reinício de qualquer forma.
 O comando faz tudo ou nada, aceita rodar de novo e grava um diário:
  1. confere que o serviço está parado (trava em dados/), que o andares.json é legível, que cabe mais um andar (MAX_EXTRAS) e que há espaço livre;
  2. sorteia o id e cria dados/andares/<id>/ (0700). MOVE com os.replace (mesmo volume) o oauth.json, equipe.json, planta.json, placar.json e jornal.json. COPIA o times.json, porque no Docker ele está no código só leitura, e COPIA o marca.json e o logo.img: a marca do prédio e a da tela de entrar continuam as da raiz, e a empresa ganha a sua cópia;
  3. grava o andares.json v2: {"v": 2, "terreo": "saguao", "andares": [{"id", "nome": o nome da marca, "org": AGENTES_ORG}, ...]}. O v1 continua sendo lido como hoje. Um código antigo que encontra o v2 cai em AndaresIlegiveis e não sobe. Isso é bom: voltar de versão não mostra um térreo vazio nem reconecta errado. No v2, o `_validar` deixa de começar com a org do principal (o saguão não tem org);
  4. os papéis. A conta que só tem o principal, e todo admin do principal, ganham o andar novo com o mesmo papel. A conta que tem o principal e outros andares NÃO ganha: o principal dela pode ser o forçado do A.3a, e não há como saber. O comando lista esses logins (só o login) para o admin dar o andar pela tela de Membros. A falha é fechada: ninguém da empresa B cai na Dev Maniac's;
  5. o papel no principal passa a ser o papel no prédio. Admin do principal = admin do prédio, como hoje (`_admin_do_predio`, :2883-2888). Os demais veem o saguão e os próprios andares;
  6. grava o diário dados/migracao-saguao.json com cada arquivo e papel que mudou. `escritorio.py saguao --desfazer` devolve tudo, e recusa se o andar novo já tiver dado que não existia antes (histórico ou anexo). O deploy faz backup do volume antes.
 Sobre a condição 3: continua valendo. O modo saguão só existe com o v2, e toda instalação open source nova segue no modo clássico.
 O que muda no código no modo saguão:
  - main(): o principal fica sem Credenciais, Leitor, Social, Jornal, Conversas e Respostas. O AGENTES_ORG deixa de ser obrigatório só nesse modo.
  - AndarPrincipal → Saguão, com nome "Saguão" e leitor None. Nas rotas por andar (:3076-3078), no saguão, o /api/estado sai sem agentes, conversas, social nem visitantes. O /api/social, /api/social/placar, /api/jornal, /api/conversa e /oauth/conectar dão 404.
  - Avisos: saem do Leitor do principal. Cada Andar tem as suas transições, e o Avisos do prédio fica um só (uma fila e a VAPID), recebendo (andar, destinatários). Já estava no A.1.
  - O elevador: todas as contas veem o Saguão; os andares, só os seus.
 O que o saguão mostra e quem lê:
  - Recepção e visitas, como hoje (D7a).
  - Chat geral do prédio: o canal "geral" do saguão, persistente no store da raiz (dados/equipe.db). No v2 esse arquivo é do saguão; no modo clássico, do principal. A retenção do saguão fica com o admin do prédio (padrão 1 ano, como o D3).
  - Mural do prédio, com os mesmos 10 avisos: qualquer conta cria, e o autor ou o admin do prédio tiram.
  - Quem está no prédio: RECOMENDO mostrar com nome e boneco só quem está NO saguão, e no máximo um total sem nome ("12 pessoas no prédio"). Listar quem está online nos andares de outras empresas é dado pessoal sem necessidade (D12).
  - No saguão, na 1.6: sem DM (a DM entre empresas cruza duas controladoras e, com o D4-b, não há um admin certo para ler), sem anexo, sem @menção (a menção revelaria se o login "joao" existe em outra empresa) e sem agentes. A classe Visitantes (A.3c) sai: a presença do saguão faz esse papel.
  - Quem lê: toda conta com pelo menos 1 andar. Quem modera: o admin do prédio. O admin da empresa NÃO modera o saguão. A guarda tem listas próprias para o saguão (GET/POST da "pessoa do prédio").
 A ponte das visitas e o recepcionista: o recepcao.json ganha o campo "andar", que diz qual andar atende a recepção pela própria conexão. Depois da migração, o padrão é o andar da Dev Maniac's. A cada passo, a ponte resolve srv.andares[andar] e pega (leitor, cred, times). O `recepcao_da_ponte` passa a ler o times do andar, não o global. Andar removido, sem conexão ou sem escrita fica "desligada", e as mensagens esperam na fila com teto, como hoje. O /api/visitas/recepcionista (:2748) e o "o que falta" (:2840) leem o Leitor desse andar. Quem escolhe o andar é só o admin do prédio, e só entre os andares em que ele também é admin (D11): os agentes e o token são da empresa, e ela precisa concordar. O aviso de entrada da visita passa a dizer o nome da empresa que atende, porque o texto do visitante vai para o workspace dela. As telas de visitas-admin continuam do admin do prédio.
 Testes: a migração ida e volta numa pasta de teste com os 7 arquivos e com usuarios.json de três tipos de conta (só principal, admin, principal + extras). v1 = hoje. v2 com o saguão: o /api/estado do saguão sem as chaves de agente, social, jornal, conversas e visitantes; um membro de B no saguão não vê nada de A além do que A escreveu no saguão; a ponte pelo andar da recepção; andar da recepção removido = desligada sem erro. O código de antes com o v2 não sobe (fica documentado).

E.2 D2-b · o admin da empresa conecta o OAuth do próprio andar · custo P/M · risco ALTO (autenticação)
Evidência: o /oauth/conectar é por andar e usa andar.cred (escritorio.py:3076-3078, :3183-3188). Hoje só o admin do principal passa: /oauth/* não está no MEMBRO_GET (:2468-2469) e o `_papel()` lê o principal (:2860-2867). O /oauth/retorno acha o andar pelo state e, sem achar, cai no principal (:3195-3199). O pendente NÃO guarda quem começou o login: pendentes[estado] = {verificador, em, client_id, escopo, redirect_uri} (:288-291). O org do andar só muda pelo /api/andares, que exige `_admin_do_predio` (:3138, :3417). O OutraOrg só percebe outra org quando há tarefa trabalhando com link (`outra_org`, :437-443; :879).
 Contrato:
  1. /oauth/conectar?andar=X: passa para o admin de X e para o admin do prédio. Membro de X: 403. Andar alheio ou inexistente: 404 (a mesma resposta). No modo saguão, sem ?andar (é o saguão): 404.
  2. O pendente guarda "usuario". No /oauth/retorno, o andar sai do state (como hoje), e o servidor exige a sessão do MESMO usuario que começou, com papel admin em X conferido DE NOVO na volta (o papel pode ter caído dentro do prazo do pendente). State de outra pessoa = o mesmo 400 do state inválido, e o pendente é consumido. Isso fecha o login CSRF: alguém manda para outro admin o link de volta com o code da própria conta.
  3. A guarda do /oauth/retorno não tem ?andar para decidir. Passa qualquer conta que seja admin de algum andar, e quem decide de fato é o item 2. No modo saguão não existe "cai no principal": state desconhecido = 400 explícito (hoje cairia em AndarPrincipal.cred = None).
  4. O org não sai do OAuth. Continua fixo no andares.json, que só o admin do prédio edita. O admin da empresa não troca o org, não cria, não renomeia nem remove andar, e não vê o org de outro andar. A tela dele mostra só "Conectado" ou "Desconectado" e o botão.
  5. Confirmar a org antes de mostrar: hoje uma conexão consentida para outra org passa despercebida enquanto não houver tarefa com link. Com o D2-b, quem conecta deixa de ser só quem opera o servidor. Caso concreto: o admin de B, que também é membro da org A no agentes.chat, consente para A, e os agentes de A aparecem para os membros de B. O Leitor do andar só publica agentes depois de uma leitura confirmar a org por um sinal determinístico (o link de um agente ou de uma tarefa, ou uma ferramenta do MCP que diga a org). Sem esse sinal, a tela fica em "conectado, conferindo o workspace". NÃO VERIFICADO: qual sinal o MCP do agentes.chat oferece.
  6. Desconectar: o admin da empresa ganha "Desconectar" do próprio andar, que revoga como já se faz ao remover um andar (`saiu.cred.desconectar`, :3461). Hoje essa rota não existe. Se ficar fora da 1.6, a doc diz.
  7. Escopo: segue o modo do times.json do andar (`escopo_do_modo`, :282). O admin da empresa já mexe nos times do próprio andar (A.5), então ligar o "responder" (escrita) fica com ele. É o workspace dele.
  8. Log como hoje (evento=oauth, andar, usuario; :3216), sem code nem state.
 Testes: admin de B: conectar?andar=B dá 302; ?andar=A dá 404; sem andar no saguão dá 404. Membro de B dá 403. Retorno com o state de B numa sessão de outra conta: 400, e o pendente some. Retorno depois de o papel em B cair: 400. O admin do prédio conecta qualquer andar. Um state de B não serve na cred de A (já é assim: cada cred tem o seu dicionário). Org errada: nenhum agente publicado.

E.3 D4-b · o admin da empresa lê DMs, com aviso · custo P/M · risco M (privacidade e LGPD)
 Contrato:
  - Nada de ler "por cima do ombro" no painel normal. Rota própria GET /api/dm/auditoria?andar=X&par=<u1>:<u2>&antes=&limite=50, e a lista de pares em GET /api/dm/auditoria/pares?andar=X (só os pares, a contagem e a data da última). Só para papel admin em X. O admin do prédio que não é admin de X NÃO lê: 404, porque a controladora é a empresa. Ler não marca como lida para os participantes. O admin da empresa lê, mas não apaga DM alheia. Paginada, no máximo 1 leitura por segundo.
  - Aviso em três lugares: (1) uma linha fixa no topo de toda DM: "As mensagens diretas da <empresa> podem ser lidas pela administração da empresa."; (2) antes da primeira DM de cada conta em cada andar, um aviso com "Entendi", guardado na conta; (3) na tela do admin, ao abrir a auditoria, o lembrete de que o acesso fica registrado.
  - Registro de acesso: a tabela acesso_dm no store do andar guarda {admin, u1, u2, quando, quantas mensagens}, sem texto e sem os ids das mensagens, com a retenção de 1 ano. Quem vê: os admins de X e o admin do prédio. RECOMENDO que os dois participantes também vejam na DM "a administração abriu esta conversa em <data>": é transparência e inibe abuso (D10). No log do serviço (stdout) vai só evento=dm_auditoria, andar e resultado, sem os participantes, porque o log pode sair da máquina.
  - Doc e README: a DM não é privada em relação à empresa. Quem lê: os dois participantes, os admins da empresa e quem opera o servidor (pelo disco). Fica 1 ano. Existe o registro de acesso. A DM apagada pelo autor some também da auditoria.
 Testes: membro na auditoria: 403. Admin de A na DM de B: 404. Admin do prédio sem papel admin em X: 404. A linha do registro sem texto (assert sobre o conteúdo gravado). Ler pela auditoria não muda a tabela leitura. DM apagada não aparece na auditoria.

E.4 D5-b · o push mostra as primeiras palavras · custo P · risco M
Evidência: o push sai VAZIO, sem payload nem a cifra do RFC 8291. O envio leva só VAPID, TTL e Urgency (avisos.py:3-5, :266-271). O sw.js busca o GET /api/avisos com o cookie e mostra (static/sw.js:4, :22-24). O texto, então, nunca passa pelo FCM, pela Mozilla nem pela Apple: só pelo próprio servidor, com sessão. Manter assim.
 Contrato:
  - O /api/avisos devolve o aviso mais recente DESTINADO à conta da sessão. Sai de uma fila em memória por conta, de até 20 itens, válidos por 5 min (o TTL de 300 s). Nada disso vai ao disco.
  - O texto é lido do store NA HORA do GET, pelo id da mensagem; o aviso não guarda cópia. Mensagem ou anexo apagado antes disso: o aviso sai genérico ("Fulano te mandou uma mensagem").
  - Corpo: até 60 caracteres. O corte é no último espaço depois do 40º caractere, com "…". Saem quebras de linha, controles e bidi (U+202A-202E, U+2066-2069), pelo limpa_texto. É texto puro, sem markup.
  - Título: "Fulano · #sala" na menção, "Fulano · mensagem direta" na DM, e com o nome da empresa para quem está em mais de uma.
  - Anexo: "Fulano enviou um arquivo", sem o nome do arquivo.
  - DM: entra com as primeiras palavras, como decidido. "Ocupado" segura o push, e não há push com a aba aberta e visível.
  - Tela bloqueada: o navegador não sabe se a tela do celular está bloqueada, e o corpo aparece nela conforme o ajuste do aparelho. Mitigação: a preferência por conta "Mostrar o começo da mensagem no aviso" (padrão ligado, pelo D5-b), e a doc ensina o ajuste do sistema (Android: ocultar conteúdo sensível; iPhone: pré-visualizações só desbloqueado).
  - Aparelho compartilhado: o aviso sai do cookie de quem está logado agora. Outra conta no aparelho vê os próprios avisos, nunca os do dono da assinatura. O /sair desassocia a assinatura daquele navegador (pela rota /api/push/sair, que já existe).
  - Os avisos de agente (pediu_aprovacao e pediu_resposta) continuam sem o rótulo da tarefa (sw.js:4).
  - Os tetos do avisos.py ficam (1 por minuto e 50 por dia por aparelho). Uma rajada vira "Fulano e mais 3 mensagens".
 Testes: corpo com até 60 caracteres mais "…"; bidi e controles limpos; mensagem apagada antes do GET dá o texto genérico; sessão de outra conta não recebe nada do dono; ocupado não envia; o log sem texto.

E.5 D6-b · 25 MB por arquivo, 5 GB por empresa, com ZIP · custo M/G · risco ALTO
Evidência: o do_POST só lê corpo de até CORPO_ANTES = 128 KB (escritorio.py:2065, :3690). O `_corpo` aceita Content-Length de até 7 dígitos, abaixo de 10 MB (:2936), e lê tudo de uma vez para a memória (:2939). O `_envia` monta a resposta inteira na memória (:2689-2692). O `timeout = 15` vale por operação de socket, não pelo pedido inteiro (:2672). O Servidor é um ThreadingHTTPServer com daemon_threads e sem teto de threads (:3779-3781). O Python do container é o 3.12.16 (Dockerfile:3).
 Envio:
  - Rota própria. Content-Length obrigatório (sem chunked), de 1 B a 25 MiB (26.214.400 B), conferido antes de ler. Leitura em blocos de 64 KB direto para anexos/.tmp-<token> (0600), somando o tamanho e o sha256. Passou do teto: 413, e o temporário é apagado.
  - Prazo total: o timeout de 15 s vale por bloco. Um cliente que manda 1 byte a cada 14 s segura a thread por dias (slowloris). Por isso, 120 s por envio (cerca de 220 KB/s para 25 MB), conferidos a cada bloco; venceu, fecha e apaga. No máximo 4 envios ao mesmo tempo no servidor e 1 por conta (semáforo), além dos 10 por minuto da Onda 2.
  - Cota: a reserva do Content-Length na cota da empresa (5 GB) acontece ANTES de ler, sob a trava do store; se falhar, libera, e confirma no fim. Dois envios ao mesmo tempo não passam da cota.
  - Piso de disco do prédio: 6 andares extras × 5 GB (o saguão não tem anexo) dão 30 GB possíveis. Recusar envio se o espaço livre do volume (shutil.disk_usage) ficar abaixo de max(2 GB, 10%), configurável por env. O SQLite, o token e as sessões não podem ficar sem disco por causa de anexo. A tela do admin do prédio mostra o uso por andar.
  - A cota de 200 MB do banco (texto) continua. Com retenção de 1 ano, o aviso de 90% ao admin passa a importar.
  - Atrás da Cloudflare: o plano grátis aceita corpo de até 100 MB (25 MB cabe) e espera a resposta da origem por cerca de 100 s (erro 524). NÃO VERIFICADO se ela guarda o corpo antes de repassar no plano do Helbert. Tailscale serve: NÃO VERIFICADO se há teto de corpo ou buffer. No aceite: subir 25 MB pelos dois caminhos.
 Validação (o servidor NUNCA extrai o ZIP nem descomprime nada além do [Content_Types].xml):
  - O tipo sai dos bytes mágicos. ZIP é PK\x03\x04 logo no começo. Fica recusado o ZIP com prefixo (autoextraível): o diretório central tem que bater com o início.
  - Antes do zipfile: ler à mão (struct) o fim do diretório central (EOCD e Zip64), nos últimos 64 KB. Recusar se houver mais de 1000 entradas ou se o diretório central passar de 1 MB. O zipfile carrega a lista inteira na memória, e 25 MB de entradas vazias dão uns 500 mil ZipInfo.
  - No zipfile, só os metadados (infolist), sem ler conteúdo. Recusar:
    · soma dos tamanhos descompactados acima de 1 GiB, ou razão descompactado/compactado acima de 100 (bomba para quem baixa e extrai);
    · entrada cifrada (bit 0 da flag: ninguém consegue olhar o que tem dentro);
    · nome que começa com "/", contém "\" ou ":" (letra de drive), tem um componente "..", tem controle ou bidi, ou passa de 255;
    · nomes repetidos depois de normalizar e passar para minúsculas;
    · pacote dentro de pacote (.zip .rar .7z .gz .tgz .tar .iso .img .cab .jar .apk): a bomba recursiva depende de aninhar;
    · executáveis e scripts (.exe .dll .scr .com .bat .cmd .ps1 .vbs .js .jse .wsf .hta .msi .msix .lnk .url .reg .sh .appimage .dmg .pkg) e .svg/.html/.htm dentro, comparando sem caixa, pela última extensão e pela dupla (".pdf.exe").
  - OOXML pela regra de antes: ZIP com [Content_Types].xml é DOCX/XLSX/PPTX. Esse arquivo é lido com teto de 64 KB, o único descomprimido. Sem vbaProject.bin e sem .docm/.xlsm/.pptm. O resto é ZIP genérico, com as regras acima.
  - Path traversal: nome de entrada nunca vira caminho no servidor. O anexo vai inteiro para anexos/<token_hex(16)>. Se um dia houver prévia com extração, será um pacote próprio com gate.
  - Imagem: o tirador de EXIF também corta o que vem depois do fim (no JPEG, depois do EOI; no PNG, depois do IEND; no WEBP, além do tamanho do RIFF). Isso fecha o poliglota JPEG+ZIP servido inline.
 Download:
  - ZIP, OOXML, PDF, TXT e CSV vão SEMPRE como Content-Disposition: attachment (filename* RFC 5987), com o Content-Type fixo da lista (application/zip e os demais), nosniff, CSP "default-src 'none'; sandbox" e Cache-Control private, no-store. Inline só a imagem dentro de <img>. O "baixar" da imagem também vai como attachment (?baixar=1).
  - Envio em blocos de 64 KB a partir do arquivo (shutil.copyfileobj), com o Content-Length do disco. Nada de 25 MB na memória; o timeout de 15 s por bloco atende. Sem Range na 1.6. No máximo 4 downloads ao mesmo tempo por conta.
 Cota: 5 GB por empresa, contando os anexos. A retenção de 1 ano apaga o anexo junto com a mensagem. Em 90% e em 100%, o admin da empresa é avisado e ganha a lista de anexos por tamanho para apagar.
 Antivírus: com o ZIP liberado, a falta do ClamAV pesa mais. Mantenho fora da 1.6, mas o gancho do clamd (por env) passa a ser RECOMENDADO antes de abrir o prédio para empresas de fora (risco residual).
 Testes: bomba (razão alta) recusada; 1001 entradas recusadas sem chamar o zipfile; "../x", "C:\x" e "/etc/x" recusados; cifrado, aninhado e .exe dentro recusados; docx com macro recusado; o poliglota JPEG+ZIP sai sem o ZIP; 25 MiB + 1 dá 413; envio lento (1 bloco a cada 14 s) cortado em 120 s; duas threads perto da cota não passam dela; download de 25 MB com a memória estável; a resposta com attachment, nosniff e sandbox.

E.6 D3 · 1 ano: a varredura diária e o aviso de teto ficam. O admin da empresa pode BAIXAR a retenção (30 ou 90 dias), mas não subir acima de 1 ano. A doc diz 1 ano.

=== C. ONDAS (reemitidas; no máximo 3 floors; o escritorio.py tem um dono por onda) ===
ONDA 1: empresa por andar, saguão e store. Sentinela no diff (papéis, isolamento, OAuth e migração) antes do merge.
 - A-back · Neo: acesso.py (principal opcional, papel por andar, contas por andar, último admin por andar, "pessoa do prédio" derivada); escritorio.py (guarda com 4 perfis; marca, logo, expediente e modo sério por andar; /logo?andar com sessão; config_v; Visitantes fora; /api/avisos e push por andar e por conta; modo saguão no main e no AndarPrincipal; OAuth do admin da empresa, E.2; a ponte das visitas pelo andar da recepção, E.1; o despacho do subcomando `saguao`); avisos.py (assinatura com usuario e andar, envio direcionado, o Avisos do prédio sem o Leitor do principal); test_membros.py, test_andares.py, test_avisos.py e test_visitas_ponte.py.
   Aceite: suíte atual verde; matriz de 4 perfis × rotas × andar próprio/alheio/saguão; a empresa B sem nada de A (estado, config, logo, avisos, push, membros, visitantes); convite só para o próprio andar; os testes de OAuth do E.2; checar_seguranca limpo.
 - Store e migração · Trinity: conversas_equipe.py (como antes, mais a tabela acesso_dm e a cota com reserva); migracao_saguao.py (novo, sem HTTP: o E.1 itens 1 a 6, com diário e "desfazer"); test_conversas_equipe.py e test_migracao_saguao.py.
   Aceite: os do store de antes; migração ida e volta com os 7 arquivos e os 3 tipos de conta; refaz sem estragar; "desfazer" recusado quando houver dado novo; v1 = hoje.
 - A-front · Tron: ajustes.js (Personalizar e Membros por andar, admin da empresa, o botão Conectar/Desconectar do andar), app.js (a marca do andar na barra; o elevador com o Saguão mais as empresas da pessoa), personalizar.js.
   Aceite: no modo clássico, a tela fica igual; o admin da empresa não vê o que é do prédio nem o org; QA em 390 px.
ONDA 2: histórico, DM com auditoria, menção, anexos com ZIP e as 5 interações. Sentinela no diff de anexos, DM e auditoria antes do merge.
 - B-back · Neo: escritorio.py (as rotas de antes; a auditoria de DM, E.3; o /api/avisos com o começo da mensagem, E.4; o anexo em blocos com prazo, semáforo, cota e piso de disco, e o download em blocos, E.5); anexos.py (bytes mágicos, EXIF e cauda, OOXML sem macro, a validação do ZIP só por metadados); test_anexos.py; a doc de privacidade e o README (condição 4).
 - Tron: chat_sala.js/css → o painel com histórico, canais, DM com o aviso fixo e o "Entendi", menções, reações, anexos, o aviso de retenção e a tela de auditoria do admin; sw.js com o corpo vindo do /api/avisos e a preferência "mostrar o começo".
 - Flynn: vida.js/mapa.js (status no boneco, acenar, "ir até", mural, lista do andar) e o saguão no mapa (sem agentes; recepção, mural do prédio, quem está no saguão).
 Aceite: os de antes, mais os testes do E.3, do E.4 e do E.5; subir 25 MB pela Cloudflare e pelo Tailscale.
ONDA 3: reuniões, sem mudança (o link por sala com a lista de hosts, a agenda e o .ics; WebRTC só depois, com gate, pelo D9).
Auditor (Spock) em cada onda. A migração em produção sai depois da Onda 1 com PASS, com backup do volume e GO expresso do Helbert.

=== D. DECISÕES NOVAS (pequenas; recomendação com *) ===
D10. Os participantes veem que a administração abriu a DM deles? (a)* sim, com a data; (b) não, só os admins veem o registro.
D11. O andar que atende a recepção: (a)* só um em que o admin do prédio também é admin (na prática, a Dev Maniac's); (b) qualquer andar conectado.
D12. "Quem está no prédio" no saguão: (a)* só quem está no saguão, com nome, mais um total sem nome; (b) a lista de todos os online, com a empresa de cada um.

RISCOS RESIDUAIS (somam-se aos de antes): o ZIP sem antivírus continua sendo o vetor clássico de malware entre empresas (mitigado pela lista de recusa, pelo attachment e pelo aviso; não eliminado); a DM é legível pela empresa e pelo operador; o começo da mensagem aparece na tela bloqueada conforme o ajuste do celular; a migração é a primeira mudança de lugar de dados de produção do projeto (há backup e "desfazer", mas há janela de serviço parado); o saguão é o primeiro espaço compartilhado entre empresas.
NÃO VERIFICADO: qual sinal do MCP do agentes.chat confirma a org (E.2 item 5); o teto de corpo e o buffer da Cloudflare no plano do Helbert e do Tailscale serve para 25 MB; o comportamento do zipfile do 3.12.16 com o diretório central malicioso além dos tetos acima (conferir no teste); se o subcomando consegue detectar com segurança o serviço parado no Docker (trava de arquivo no volume é o caminho proposto); os itens do NÃO VERIFICADO original continuam.

=== DECISÕES DO HELBERT (finais) ===
14/11/2026: D1 b com detalhe A (a Dev Maniac's sobe para um andar próprio; o térreo vira saguão sem agentes), D2 b, D3 1 ano, D4 b, D5 b, D6 b, D7 a, D8 a, D9 a.
15/11/2026: D10 a (os participantes veem que a administração abriu a DM, com a data), D11 a (só atende a recepção um andar em que o admin do prédio também é admin), D12 a (no saguão, nome e boneco só de quem está no saguão, mais um total sem nome).
Próximo passo: Onda 1. A migração em produção para o saguão só sai com GO expresso do Helbert.
