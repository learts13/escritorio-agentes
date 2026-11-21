> [🇺🇸 English](./CHANGELOG.md) | 🇧🇷 Português (Brasil)

# Histórico de mudanças

As mudanças que importam neste projeto ficam aqui, da mais nova para a mais antiga. O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/). Desde a 1.1.0, as versões seguem o [SemVer](https://semver.org/lang/pt-BR/); as entradas mais antigas são marcos com data.

## 2.2.0 · 2026-11-20 · Responder do escritório

Release [`v2.2.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v2.2.0). Commits: [`v2.1.0...v2.2.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v2.1.0...v2.2.0).

### Adicionado
- **Permitir ou Negar pelo escritório:** os pedidos de permissão do Claude Code, do Codex e do OpenCode ganham os botões **Permitir** e **Negar** no cartão do terminal e no aviso "Esperando você", com a ferramenta, um resumo e o tempo que falta, no navegador deste PC e no celular (pelo espelho). Quem decide é o admin do prédio (e quem estiver em `ESCRITORIO_PONTE_DECISORES`); membro só vê. O diálogo do terminal continua: quem responder primeiro leva, e sem ninguém com o mapa aberto o terminal não espera nada. Pelo celular é opcional: ligue na máquina dos terminais com `ponte conectar ... --decidir-remoto`. Resumo incompleto (cortado ou com arquivo fora do projeto) só pode ser negado de longe. No Codex, aprove de novo os hooks em `/hooks`. Veja [Responder pelo escritório](./README.pt-BR.md#responder-pelo-escritório-permitir-ou-negar-de-qualquer-lugar).
- **Responder uma pergunta pelo escritório:** quando um terminal espera a sua resposta (o "?"), o cartão dele ganha um campo e o botão **Responder**, para as mesmas pessoas que decidem as permissões. Nos terminais do Maestri, a ponte digita o texto e aperta Enter (`maestri ask --raw`, sem shell); no OpenCode, o plugin responde pela API de perguntas. Só quando a espera aceita texto escrito, nunca em diálogos de opções (como o "Teammate setup" ou o link do MCP), em que o Enter confirmaria a opção padrão. Fora do Maestri e do OpenCode não há botão, e o agy solto só mostra o estado. Rode `ponte setup --aplicar` para atualizar o plugin do OpenCode. Veja [Responder uma pergunta](./README.pt-BR.md#responder-uma-pergunta).

### Mudado
- **Um mapa que se lê de relance:** no máximo 6 salas por fileira. Os times a mais e as salas automáticas do Maestri descem para blocos mais abaixo, cada um com o seu corredor, e o prédio fica perto de 3:2 em vez de uma faixa comprida. As salas automáticas ficam juntas, sob a placa "Projetos", e sem o contador "0/0". Um piso e uma parede para o prédio todo; cada time fica com a sua cor no tapete sob as mesas e num filete no alto da parede. As placas usam o nome curto (até 14 letras), a rua ficou mais fina e o ringue e o placar só aparecem durante a briga.
- **Nomes sem embolar e zoom nítido:** na vista geral (zoom abaixo de 2x), só os bonecos e os selos "!"/"?" de quem espera você; de 2x para cima, o nome curto ("Maestro", e não "Maestro · Opus High · Claude Code"), e o nome completo fica no cartão. Nome nunca encavala, e quem está fora da tela e espera você ganha uma setinha na borda. O zoom anda em degraus inteiros (1x, 2x, 3x...), e a pixel art fica nítida.
- **Terminais com cara própria:** a cor do terminalzinho diz o programa (Claude Code laranja, Codex prata, OpenCode verde, agy azul, MiniMax rosa, outros lilás), e o papel, lido do nome do Maestri ("Papel · Modelo") ou do papel da ponte, ganha um acessório: coroa no Maestro, óculos e lupa no Auditor, capacete no Braçal e no Implementador. A miniatura do painel usa a mesma cara.
- **Móveis na mesma vista:** a mesa de reunião, as sinucas e as mesas da cozinha agora são vistas de frente, como as mesas de trabalho. Bonecos, terminais, gente e móveis soltos ganharam uma sombra no chão, e a Sala comunal, um tapete na arena, estante, vasos e jardineira.
- **Luzes e portas com sentido:** a sala acende com trabalho de verdade (agente na mesa ou terminal ocupado), e à noite quem trabalha acende a luminária da mesa. As salas acesas têm uma luz quente e forte, e as vazias ficam escuras, mas legíveis. Só o "!" e o "?" pulsam. As portas abrem também para terminal, gente e equipe do prédio, e abajur, protetor de tela, fliperama e TV seguem a luz da sala.
- **Moldura mais enxuta:** a faixa "AO VIVO" virou uma pílula com a hora, o ícone do tempo e a temperatura. A barra da câmera mostra só −, o zoom de agora, + e "Ver tudo"; tela cheia, foto, TV, rádio, time-lapse e o modo apresentação foram para o menu "⋯". "Toque num agente" some depois do primeiro toque no mapa.
- **Celular:** o mapa sobe para logo abaixo do título, com mais de 450 px de altura e a barra da câmera embaixo à esquerda; filtros, "Só você está olhando" e "Aparecer no escritório" vêm depois dele.
- **Banheiro de verdade:** a porta WC na parede do corredor virou uma sala inteira na fileira de baixo, ao lado da cozinha, com pastilhas, três cabines com o trinco de vago/ocupado, bancada com duas cubas e espelho. A fila continua no corredor, e o da frente vai a uma cabine vaga. A sujeira aparece no chão, o banheiro interditado ganha o cone e a placa "Interditado" na porta, e a faxineira entra para passar o rodo. Na lateral, o banheiro mostra "livre", as cabines ocupadas ou "interditado". Ele só existe nesta tela: não é canal de conversa e fica fora do modo construção.

### Corrigido
- **Nomes empilhados no celular:** no celular, as etiquetas dos terminais se empilhavam sobre o mapa. Agora o terminal mostra só o nome, sem o programa, a pilha é curta e o nome sem lugar some.

### Segurança
- **Responder pelo escritório:** a ponte nunca abre porta (só faz pedidos de dentro para fora) e segue ouvindo só em `127.0.0.1`. O hook confere por HMAC que a resposta veio da ponte, sem mandar o token. Pelo servidor, só com o `--decidir-remoto` e para quem decide: a ferramenta e um resumo mascarado (tokens, senhas e chaves viram `***`) de até 300 caracteres, guardados só na memória. De longe, escrita de arquivo e ferramenta de MCP só podem ser negadas. Cada pedido vale uma decisão, vence no prazo e tem limite de 20 por minuto por pessoa.
- **Resposta escrita:** uma linha só, até 1000 caracteres, sem começar com hífen, sem barra invertida e sem caracteres invisíveis (recusados, nunca trocados), conferida no navegador, no servidor e na ponte. Só é digitada com o terminal na mesma pergunta na hora, uma vez por pergunta, e nunca num terminal na aprovação. O log guarda só o tamanho do texto.

## 2.1.0 · 2026-11-20 · A firma ganha vida

Release [`v2.1.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v2.1.0). Commits: [`v2.0.0...v2.1.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v2.0.0...v2.1.0).

### Adicionado
- **Rádio da firma:** um rádio na parede da Sala comunal (ou o botão de rádio na barra da câmera) abre o controle: ligar, estação e volume. A Rádio Firmópolis é composta na hora pelo navegador, sem arquivo de áudio e sem direito autoral, em três estações: Lo-fi da firma, Chiptune do fliperama e Jazz da cafeteria. Cada pessoa liga o próprio rádio, com um clique; o modo TV e o modo apresentação não tocam nada. Com o rádio ligado, quem está livre por perto dança de vez em quando. Em **Personalizar**, o admin pode pôr também uma rádio da internet (só `https`); os direitos de tocar são de quem a configura. Veja [Rádio da firma](./README.pt-BR.md#rádio-da-firma).
- **Zeladoria:** o banheiro suja a cada uso; sujo, ganha moscas, fedor e o balão "eca", e acima de 90 fica interditado, com a fila esperando ou desistindo. A faxineira limpa o banheiro e os copos e migalhas da cozinha, o zelador conserta a cafeteira e a luminária que quebram, e o porteiro (à noite, o vigia de lanterna) cuida da entrada e cumprimenta quem chega. Clique em alguém da equipe para ver o que está fazendo. Roda só no navegador. Veja [Zeladoria](./README.pt-BR.md#zeladoria).
- **Escritórios por cidade:** cada andar extra pode ficar numa cidade, com o tempo e a hora local dela: céu, dia e noite, chuva, expediente, ringue e hora extra seguem o fuso do andar. Quem administra o andar escolhe em **Personalizar › Clima deste andar**; sem cidade própria, vale a do prédio. O elevador mostra a cidade de cada andar, só para quem tem acesso a ele; o saguão, as visitas e o Mundo seguem só com a cidade do prédio. Veja [Andares](./README.pt-BR.md#andares-vários-workspaces-no-mesmo-prédio).
- **Espelho da ponte:** os terminais de outra máquina (uma VM, por exemplo) aparecem no mapa de qualquer navegador, sem túnel. O admin do prédio gera a chave em **Personalizar › Ponte local**, e um comando só na máquina dos terminais, `ponte conectar <endereço>`, testa a chave, instala os hooks, liga o espelho e, no Linux com `--servico`, cria o serviço. Vem desligado. Veja [Espelho](./README.pt-BR.md#espelho-os-terminais-de-outra-máquina-sem-túnel).
- **Salas automáticas do Maestri:** com a ponte ligada, cada workspace do Maestri em uso ganha sozinho uma sala no prédio, com o nome do workspace ("Purple Ribbon", e não o da band, como "Banda #2"), cor e ícone, e os terminais dele trabalham lá. É uma sala por workspace, só desta tela (não vai ao servidor nem ao modo construção); workspace novo ganha sala em até 1 minuto, e o que fica sem terminal perde a sala depois de 5.
- **Página Novidades no site:** [firmopolis.devmaniacs.com.br/novidades.html](https://firmopolis.devmaniacs.com.br/novidades.html) mostra este histórico, gerado do mesmo arquivo que o app lê.

### Mudado
- **Montar os times automaticamente** (no lugar de "Puxar os setores do agentes.chat", que já não fazia nada): em **Personalizar › Times e aparência**, cada agente ganha o time da primeira fonte que der um: uma lista colada (`handle, time`), o setor do agentes.chat, o que vem depois de " · ", " - " ou " | " no nome ("Gandalf · Maestro") ou o papel. Uma prévia mostra os times e quem ficou sem time, e deixa renomear, tirar um agente e juntar dois times antes de salvar; passou de 12, os menores vão para "Outros". A prévia também oferece transformar as salas automáticas do Maestri em times de verdade. Nada vale antes do **Salvar times**.
- **A identidade do site no app inteiro:** a tela de entrar, o primeiro acesso, o convite, a visita, o Mundo e o app por dentro usam a marca de [firmopolis.devmaniacs.com.br](https://firmopolis.devmaniacs.com.br): Figtree no texto, Pixeloid nos títulos, a paleta noite, grafite, creme, âmbar e índigo, e botões em bisel. As telas de fora ganharam o céu noturno com a janela acesa do escritório, com um terminalzinho e gente na cena. O mapa e a arte pixel não mudaram. As fontes Source Sans 3 e Doto saíram; a Pixeloid Sans (OFL) entrou em `static/fontes/`.
- **Rodapé novo:** a tela de entrar e o app trazem a marca Firmópolis e o selo "Código aberto · AGPL", e o texto diz que o Firmópolis é feito para quem trabalha com agentes de IA, não só no agentes.chat.

### Corrigido
- **Porta do banheiro sumida:** quando a parede de cima do corredor fica cheia de portas e placas dos times, a porta WC vai para o fim do corredor, em vez de desaparecer.
- **Leitura do agentes.chat recusada:** a Cloudflare do agentes.chat passou a barrar o cliente padrão do Python. O escritório agora se apresenta com um User-Agent próprio (`Firmopolis/<versão>`), e a leitura volta a passar.

### Segurança
- **Espelho:** a ponte só manda por `https`, não segue redirecionamento e nunca envia o alvo da atividade (arquivo ou comando). A chave não vai na linha de comando (o `ponte conectar` pede a chave), fica em arquivos que só o dono lê e nunca vai ao log. O servidor confere cada envio com os limites do app e recusa tipos estranhos.
- **Rádio da internet:** o servidor aceita só `https`, um host, sem usuário e senha e sem IP ou host numérico, e o CSP da página libera no `media-src` só esse host.

## 2.0.0 · 2026-11-20 · Firmópolis

Release [`v2.0.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v2.0.0). Commits: [`v1.6.0...v2.0.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.6.0...v2.0.0).

### Adicionado
- **Novo nome: Firmópolis.** O Escritório de agentes se juntou ao Escritório Vivo. A aba, o app instalável, o convite e o modo construção trazem o nome e os ícones novos, e uma abertura curta roda uma vez por sessão (pode ser pulada, e não roda no modo TV).
- **Ponte local:** a ponte em Go do Escritório Vivo veio para `ponte/`. O navegador a lê direto em `127.0.0.1`, e os terminais deste computador (Claude Code, Codex, agy, OpenCode, MiniMax e Maestri) aparecem no mapa como terminaizinhos, sem passar pelo servidor. Veja [Ponte local](./README.pt-BR.md#ponte-local-os-terminais-deste-computador).
- **Três espécies no mapa:** os bichinhos de feltro são os agentes do agentes.chat, os terminaizinhos são os terminais locais e a gente são você e as visitas.
- **Café e conversa dos terminais:** livres, os terminaizinhos vão à cafeteira ou conversam no corredor, conforme as necessidades que caem enquanto trabalham.
- **Seletor da gente:** no perfil e no convite, você escolhe a blusa, o cabelo e a pele de como aparece no mapa.
- **A vida dos terminais:** além de café e conversa, os terminaizinhos jogam sozinhos ou em dupla, comem, cochilam e vão ao banheiro, cada um pela necessidade que apertou. Eles ficam na sala do time deles (pela band do Maestri), o Maestro vai à sala de reunião com uma coroa, e quem se encontra ganha afinidade.
- **Banheiro com fila:** uma porta WC no fim do corredor, com fila que anda. Quem está muito apertado fura a fila e perde afinidade com quem passou.
- **Cartão do terminal:** clicar num terminaizinho mostra o programa, o estado, o time, há quanto tempo está aberto, as necessidades, as maiores afinidades e o dia dele.
- **Terminais nos contadores:** os widgets e o painel contam os terminais da ponte junto com os agentes: quem trabalha, quem espera você e quem está livre.
- **O prédio visto de frente:** embaixo do mapa, a fachada com porta, janelas, arandelas que acendem à noite e floreiras, em arte nova do PixelLab.
- **O Bairro novo:** a vista da rua na página Mundo foi refeita com arte nova do PixelLab (chalés, árvores, postes, banco, carros e pessoas), de dia e de noite.

### Mudado
- **Integrações da ponte:** a marca dos hooks passou de `escritorio-vivo` para `firmopolis`. O `ponte setup --aplicar` migra quem vem do Escritório Vivo, com a config, o token e o histórico, e só apaga um plugin antigo quando confirma que foi a ponte que o instalou.
- **Avatar da conta:** aceita `hair` e `skin`, opcionais. Os avatares já salvos continuam valendo.

## 1.6.0 · 2026-11-16 · Escritório da equipe

Release [`v1.6.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.6.0). Commits: [`v1.5.2...v1.6.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.5.2...v1.6.0).

### Adicionado
- **Cada andar é uma empresa:** cada andar tem a sua marca, logo, expediente, times, planta, membros e convites, e quem administra a empresa cuida só do andar dela. São quatro perfis: admin do prédio, admin da empresa, membro e pessoa do prédio (que só entra no saguão).
- **Saguão:** o térreo pode virar um saguão sem agentes, aberto a todas as pessoas do prédio, e a empresa da `AGENTES_ORG` sobe para um andar próprio, como as outras. A troca é um comando, nunca automática (veja **Mudado** e [Saguão](./README.pt-BR.md#saguão-o-térreo-de-todas-as-empresas)).
- **Conversas da equipe:** chat geral e por sala, mensagens diretas (DM), menções com `@login`, reações, anexos de até 25 MB (ZIP incluído; 5 GB por empresa) e busca no geral, nas salas e nas suas DMs, com histórico de 1 ano. Veja [Equipe](./README.pt-BR.md#equipe).
- **Mural, status e lista do andar:** cada sala tem um mural na parede (até 10 avisos). Cada pessoa escolhe um status (disponível, ocupado, em reunião, ausente) com um recado curto, que aparece no boneco. A lista do andar mostra quem está e onde, com **Ir até**, **Acenar**, **Bater na porta** e **Mensagem direta**. Quem está ocupado não recebe aceno.
- **Aviso no celular para a pessoa:** menção, DM e reunião avisam só a conta certa, com o começo da mensagem. Tocar no aviso com o escritório aberto troca de andar e abre a conversa.
- **Enquanto você esteve fora:** quem volta a um andar depois de mais de 1 hora vê no topo o que os agentes fizeram (tarefas concluídas e esperas de aprovação ou resposta, com quanto duraram), e cada item leva ao agente. O cartão do agente mostra a linha do tempo de hoje.
- **Reuniões:** cada sala pode ter um link fixo de Meet, Zoom, Jitsi, Teams ou Whereby, colado por quem administra a empresa (só https e sem senha no endereço). A agenda do andar marca reuniões com título, sala, horário e convidados, avisa 5 minutos antes e baixa o `.ics` para a sua agenda. A voz e o vídeo ficam no serviço do link.
- **Reunião geral e "em reunião":** quem administra a empresa chama a equipe para uma sala; cada pessoa do andar recebe o aviso, e o mapa leva o boneco até lá. Quem está na sala de uma reunião em andamento e não pôs status aparece "em reunião", e a porta ganha a placa.
- **Modo apresentação:** para mostrar a tela a um cliente ou postar um print. O botão da barra da câmera ou `Alt+Shift+P` troca os nomes por "Agente 1" e "Pessoa 2" e esconde balões, tarefas, conversas, mural, recados, reuniões e links das salas. É só tela, não controle de acesso. Veja [Modo apresentação](./README.pt-BR.md#modo-apresentação).
- **Variáveis novas:** `ESCRITORIO_JITSI=<host>` aceita o Jitsi da sua instalação no link das salas (um host exato, além da lista fechada), e `ESCRITORIO_PISO_DISCO_MB=<MB>` define quanto disco livre os anexos nunca usam (sem ela, o maior entre 2 GB e 10% do volume). Veja [Instalar](./README.pt-BR.md#instalar).

### Mudado
- **Privacidade: as conversas da equipe agora ficam no disco.** Com pelo menos 1 conta, o chat geral e das salas, as DMs, o mural, o status, os anexos e a agenda ficam guardados por **1 ano** (a empresa pode baixar para 90 ou 30 dias), num arquivo por empresa. Antes da 1.6, nada disso ia ao disco. Sem nenhuma conta, o chat segue só na memória, como antes.
- **O chat da sala fica guardado e é lido pelo andar:** não some mais em 10 minutos, e toda pessoa do andar lê o que foi dito, inclusive antes de ela chegar.
- **A DM pode ser lida pela administração da empresa**, por uma tela de auditoria. Cada leitura fica registrada (sem o texto), e as duas pessoas da conversa veem a data. Toda DM avisa isso no topo, e a pessoa confirma com **Entendi** antes da primeira.
- **O aviso no celular mostra o começo da mensagem** (até 60 caracteres) na menção e na DM, e ele pode aparecer na tela bloqueada. O serviço de push continua recebendo a mensagem vazia: o começo vem do escritório quando o app acorda. Dá para desligar em **Meu perfil** ("Mostrar o começo") ou no ajuste de notificações do celular.
- **Migração para o saguão, explícita:** só pelo comando `escritorio.py saguao`, com o serviço parado e rodando como o usuário do serviço (o dono da pasta de dados; como outro usuário, ela recusa). Faça backup antes. É tudo ou nada, com diário: se cair no meio, o serviço não sobe até o mesmo comando terminar. O `saguao --desfazer` volta ao térreo de antes enquanto ninguém usou o modo novo; depois disso, a volta é pelo backup. Sem rodar a migração, o escritório segue no modo de sempre.
- **Linha do tempo no disco:** o id do agente, o estado e a hora de cada mudança ficam 14 dias em `dados/linha/` (até 5.000 linhas por dia), sem rótulo de tarefa nem conversa. O resto do diário de transições segue só na memória.

### Segurança
- **Anexos conferidos no servidor:** o tipo sai do conteúdo, a foto perde o EXIF (inclusive a localização) e o ZIP é conferido só pelos metadados, sem ser aberto. O envio tem prazo e limite por conta e no servidor, e um piso de disco livre. Não há antivírus.
- **Cada perfil só no seu andar:** andar que não existe e andar sem acesso dão a mesma resposta. O admin do prédio lê o geral, as salas, o mural e os anexos de toda empresa, sem escrever neles, e não lê DM. Moderar e mudar a retenção é de quem administra cada empresa. Menção e convite de reunião só acham contas do próprio andar.
- **O banco não é cifrado:** quem opera o servidor lê tudo. Onde fica cada dado, quem lê e por quanto tempo está em [para onde vai cada dado](./docs/visitas-privadas-plano.md#conversas-da-equipe-no-disco-16).

## 1.5.2 · 2026-11-15 · Jornal por andar e hora extra

Release [`v1.5.2`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.5.2). Commits: [`v1.5.1...v1.5.2`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.5.1...v1.5.2).

### Adicionado
- **Resposta rápida:** na conversa aberta, com o modo resposta ligado, botões prontos ("Pode seguir", "Sim", "Não", "Pare", "Resuma o que fez") preenchem a caixa de resposta. Quem envia é você, pelo Enviar de sempre, depois de conferir.
- **Não perturbe:** em **Configurações › Meu perfil**, cada conta escolhe quando o aviso no celular toca nos aparelhos em que ela o ligou: sempre, só no expediente ou com silêncio num horário. O que chegar no silêncio não vira aviso depois: fica em **Esperando você**.
- **Hora extra no mapa:** fora do expediente, quem está trabalhando fica na mesa com a luminária acesa, e a ficha mostra "Hora extra". Esperar a sua aprovação ou resposta não conta.
- **Hora extra no jornal:** o jornal conta o tempo trabalhando fora do expediente do andar e diz quem mais ficou.

### Mudado
- **Modo econômico:** o mapa desenha menos quadros quando nada se mexe. Medido em 1280 px por 60 s: parado, de 154% para 49% de CPU; com chuva, de 166% para 119%; com agentes andando, de 128% para 100%.

### Corrigido
- **Jornal por andar:** a edição leva o nome da empresa e do andar, e avisa quando o andar está sem conexão, ligado a outro workspace, com a leitura atrasada ou ainda sem atividade. O Morpheus achou o nome errado no 2º andar (tarefa #14 do quadro) e mandou a primeira correção no PR [#30](https://github.com/HelbertMoura/escritorio-agentes/pull/30), juntada a esta.
- **Reconectar a mesma conta:** conectar de novo a mesma conta do agentes.chat não zera mais o jornal nem os avisos; só uma conta diferente zera. Se o serviço reiniciar antes da primeira leitura que confere a conta, esse zerar se perde.
- **Aviso de conta removida:** remover uma conta desliga o aviso no celular dos aparelhos que ela ligou, e o **Sair de todos os aparelhos** de um membro desliga o aviso só nos aparelhos dele.

## 1.5.1 · 2026-11-14 · Chat à direita e ajustes

Release [`v1.5.1`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.5.1). Commits: [`v1.5.0...v1.5.1`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.5.0...v1.5.1).

### Mudado
- **Chat da sala à direita:** no computador, a pílula e o painel do chat ficam no canto de baixo à direita do mapa, longe da ficha do agente, da conversa e da greve. O "Toque num agente" sobe para cima da pílula. No celular, o chat continua à esquerda.
- **Elevador no celular:** a barra de cima mostra a luz da conexão e o andar abreviado, e o nome da empresa volta a caber. A lista aberta traz o nome inteiro e o estado de cada andar.
- **Estado do andar:** embaixo do elevador da lateral, o estado só aparece quando há problema, como "Este andar: sem conexão".
- **Trocar de tela começa no topo:** voltar do Personalizar ao Escritório mostra o mapa, e não o fim da página.
- **Membro sem atalhos de admin:** quem é membro não vê mais "Nome e logo de exemplo" nem "Mudar o horário", que levavam a ajustes que só o admin tem.
- **Membros:** o "Remover" da própria conta fica desabilitado. Para sair, peça a outro admin.

### Corrigido
- **Agentes no primeiro carregamento:** quem abria o escritório num andar extra logo depois de reiniciar o servidor via o mapa vazio por uns 20 s. Agora a primeira leitura do andar vem na hora, e a tela relê a cada 1 s até ela chegar (por no máximo 1 minuto).

## 1.5.0 · 2026-11-14 · Andares e equipe

Release [`v1.5.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.5.0), com o vídeo das novidades anexado. Commits: [`v1.4.0...v1.5.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.4.0...v1.5.0).

### Adicionado
- **Andares:** cada workspace do agentes.chat pode virar um andar do prédio, com a sua conexão, os seus times, a sua planta, a sua vida social e o seu jornal. Configurações › Andares cria, renomeia e remove (até 6 extras, com a senha da conta), e o elevador da barra troca de andar sem recarregar. Sem andares extras, tudo fica como antes. Veja [Andares](./README.pt-BR.md#andares-vários-workspaces-no-mesmo-prédio).
- **Equipe:** quem administra convida pessoas da equipe por um link pessoal, de uso único e válido por 48 horas, em Configurações › Membros, que também muda o papel (admin ou membro) e os andares de cada conta. A pessoa cria a conta com nome e boneco e os muda depois em **Meu perfil**. O membro vê o escritório dos andares liberados, mas não lê as conversas dos agentes nem mexe nas configurações. Veja [Equipe](./README.pt-BR.md#equipe).
- **Pessoas no mapa:** cada pessoa conectada aparece no andar com o próprio nome e boneco, entra pela rua e anda até onde clicar. A linha "N pessoas olhando" conta quem está no andar, e a lateral mostra quantas pessoas há em cada sala sem mesa.
- **Chat da sala:** cada sala tem um chat de texto para quem está nela. Fica só na memória do servidor (as últimas 50 mensagens por até 10 minutos), quem chega não lê o que foi dito antes, e reiniciar o escritório apaga tudo.
- **Puxar os setores do agentes.chat:** um botão em Configurações › Times copia cada setor do agentes.chat como um time (nome, cor e ícone) e a aparência de cada agente. Exige um agentes.chat cujo `list_agents` mande o `department`. Time de mesmo nome mantém o tipo, a parede e o piso, e nada vale antes do **Salvar times**.

### Mudado
- O crachá de **Visitante** anônimo saiu do mapa: quem está com o escritório aberto aparece com o nome e o boneco da própria conta. A caixa **Aparecer no escritório** e a TV seguem como antes (olham sem aparecer). Veja [Visitantes](./README.pt-BR.md#visitantes).
- **Sair de todos os aparelhos** encerra só as sessões de quem pediu. Só quem administra desliga também o aviso no celular de todos os aparelhos.

### Corrigido
- **Resposta em outro aparelho:** respondeu a pergunta de um agente pelo celular com o escritório aberto no PC? O agente sai de **Esperando você** nas duas telas sem esperar a próxima leitura do agentes.chat (no aparelho que respondeu, na hora; no outro, em até 10 s), e o pedido já respondido não aceita a mesma resposta de novo. A aba que volta do segundo plano relê o estado na hora.
- **Testes no Windows:** os testes das contas e dos membros passam no Windows (o arquivo do código de primeiro acesso é fechado antes de ser apagado, e a permissão 0600 só é conferida fora do Windows).

### Segurança
- **Membro só vê o que pode:** o servidor nega por padrão. Toda rota com sessão confere o papel antes de responder, e o membro não lê conversas, não abre o modo resposta nem muda configurações, marca, planta, times, andares, membros ou visitas.
- **Convite:** o link aparece uma vez só, e o servidor guarda apenas uma impressão dele (sha256), nunca o link. Usado, vencido ou revogado, não vale mais; dois aceites ao mesmo tempo com o mesmo link criam uma conta só. A página do convite tem limite de pedidos por origem.
- **Mudar papel ou andares pede a senha** de quem administra, como convidar e remover. O escritório nunca fica sem um admin.
- **Remover uma conta** derruba as sessões da pessoa antes de gravar a mudança, e o boneco dela sai do mapa na hora. Uma conta nova com o nome de uma antiga não herda as sessões velhas.
- **Andares isolados:** cada andar lê o agentes.chat com o seu próprio token. Um andar que não existe e um andar sem acesso dão a mesma resposta (404), e um andar conectado a uma conta de outro workspace avisa e não mostra nada dele.
- **Presença e chat só na memória:** quem está em cada andar e as mensagens das salas não vão ao disco nem ao log, têm limite por pessoa, e o servidor só aceita mensagem na sala onde o autor está. Visitantes de fora não veem a equipe. Veja [para onde vai cada dado](./docs/visitas-privadas-plano.md#equipe-presença-no-mapa-e-chat-por-sala).

## 1.4.0 · 2026-11-12 · Self-host e mundo maior

Release [`v1.4.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.4.0), com o vídeo das novidades anexado. Commits: [`v1.3.0...v1.4.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.3.0...v1.4.0).

### Adicionado
- **agentes.chat self-host:** a variável `AGENTES_URL` aponta o escritório para a sua instalação (o `PUBLIC_URL` dela). O login, o MCP e os botões "Responder" e "Revisar" passam a ir para lá. O instalador libera na rede do serviço só o IP dessa instalação, inclusive na tailnet. Sem a variável, tudo segue na nuvem. Veja [Com o agentes.chat self-host](./README.pt-BR.md#com-o-agenteschat-self-host).
- **Mundo no menu:** o item **Mundo** abre o `/mundo.html`.
- **Mundo no Modo TV:** sem notícia, a TV mostra o mundo por 45 segundos a cada 5 minutos, descendo do globo à cidade e ao bairro do escritório. Um toque no mapa fecha o mundo. Sozinho, `/mundo.html?tv=1` faz o mesmo passeio em tela cheia, para uma tela da sala.
- **Cidades de outros países:** 12 cidades no globo (Lisboa, Luanda, Maputo, Buenos Aires, Montevidéu, Santiago, Cidade do México, Nova York, Londres, Paris, Madri e Tóquio), cada uma um ponto dourado. Clicar desce direto à cidade, com o tempo de agora. Lisboa, Nova York, Londres e Paris ganharam marco novo (Torre de Belém, Estátua da Liberdade, Big Ben e Torre Eiffel), e Buenos Aires usa o Obelisco. O escritório que fica a até 300 km de uma delas ganha o chalé lá.
- **Cidades médias:** as 50 cidades que aparecem com o zoom do mapa (Campinas, Santos, Juiz de Fora...) também abrem, com porte pela população e orla nas de praia. O tempo é o da capital mais perto.
- **Ônibus e bicicletas:** circulam pelas ruas junto com os carros, cada um no seu ritmo, de faróis acesos à noite.
- **Chapéu de festa:** nas datas comemorativas, três em cada cinco pedestres da cidade usam o chapéu da festa, como os agentes do escritório.

### Mudado
- A página `/mundo.html` pode abrir dentro do próprio escritório (o Modo TV), e só dele: `frame-ancestors 'self'`. As outras páginas seguem sem moldura.
- O token do agentes.chat fica preso à instalação que o emitiu: trocar a `AGENTES_URL` descarta o token guardado sem enviá-lo a lugar nenhum, e o escritório pede para conectar de novo.
- O servidor busca o tempo de 40 cidades (as 28 do Brasil e as 12 de fora) na mesma consulta ao Open-Meteo, a cada 15 minutos.

## 1.3.0 · 2026-11-10 · Mundo e visitas por convite

Release [`v1.3.0`](https://github.com/HelbertMoura/escritorio-agentes/releases/tag/v1.3.0), com o vídeo das novidades anexado. Commits: [`v1.2.0...v1.3.0`](https://github.com/HelbertMoura/escritorio-agentes/compare/v1.2.0...v1.3.0).

### Adicionado
- **Mundo:** `/mundo.html`, uma página pública e sem cookie que desce do globo ao Brasil, à cidade e à porta da recepção, toda em pixel art. Veja [Mundo](./README.pt-BR.md#mundo).
- **Globo:** gira com a noite de agora, com nuvens, a lua na fase do dia e as luzes das cidades. O Brasil fica contornado, e clicar nele desce ao mapa.
- **Mapa do Brasil:** biomas, rios, serras e as 27 capitais mais Mateus Leme, cada uma com a miniatura do seu ponto turístico e o tempo de agora. Com zoom aparecem rodovias, rios menores, nomes dos estados e cidades médias; no zoom máximo sobre uma capital, aproximar de novo entra nela.
- **Cidade:** o marco no centro, praça, prédios e casas conforme o porte, ruas com carros e pedestres, e orla nas capitais de praia. O chalé com a placa só existe na cidade do escritório e leva à recepção.
- **Ao vivo:** o tempo real das 28 cidades pelo Open-Meteo (uma consulta do servidor a cada 15 minutos), dia e noite pelo relógio e as datas comemorativas do calendário, que enfeitam a cidade.
- **Privacidade do mundo:** a página não mostra nada do agentes.chat. A rota `POST /api/mundo/clima` devolve só o tipo de tempo, o vento e se é noite por cidade, a cidade do escritório, a versão do mapa e as datas do calendário desligadas. As datas próprias da empresa nunca saem. Veja [Segurança](./README.pt-BR.md#segurança).
- **Visitas por convite:** pelo menu, **Convidar para uma visita** cria um link que vale 1 hora. Quem recebe entra sem senha, vê a sala de reunião num mapa simplificado (sem nomes de agentes nem de equipes) e conversa com quem estiver na sala. Encerrar o convite derruba as sessões. Veja [Visitas por convite](./README.pt-BR.md#visitas-por-convite).
- **Recepção pública:** `/visita.html` sem convite mostra só a recepção; as outras salas ficam apagadas, com o aviso "Com convite", e a conversa fica travada.
- **Recepcionista (opcional):** a equipe pode pôr um agente do agentes.chat para responder na sala. Nesse caso o texto da visita vai ao canal de visitas do agentes.chat e fica guardado lá.
- **Privacidade das visitas:** sem recepcionista, convite, sessão e mensagens ficam só na memória do processo e somem ao sair, ao vencer ou ao reiniciar; nada da visita vai para o disco nem para o log. Para onde vai cada dado e o que conferir no proxy antes de abrir na internet está em [`docs/visitas-privadas-plano.md`](./docs/visitas-privadas-plano.md).
- **Clima mais vivo:** vento com rajadas, raio desenhado na tempestade e árvores balançando, no escritório e no bairro.
- **`ferramentas/montar_mundo.py`:** gera os arquivos de `static/mundo/` a partir de `arte/mundo/` e `arte/pixellab/mundo/`. Só quem quer trocar cidades ou arte precisa rodar (pede o Pillow); os arquivos gerados vêm no repositório.

### Mudado
- O parâmetro `?data=AAAA-MM-DD` também vale no mundo: muda a data comemorativa e, no globo, o sol e a lua.

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
