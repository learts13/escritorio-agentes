# Firmópolis: plano da fusão

Este plano junta o Escritório de agentes (este repositório, web e AGPL, com arte PixelLab) e o Escritório Vivo (feito em Godot, com uma ponte em Go e arte LimeZu). O resultado se chama Firmópolis. A base é a web. Da Vivo, a ponte em Go entra como segunda fonte de dados, e as mecânicas "Sims" são reescritas no canvas. O Godot e a arte LimeZu ficam de fora, porque a licença da LimeZu proíbe redistribuir e o projeto é aberto.

Branch: `firmopolis`. O deploy em produção (o app e o site firmopolis.devmaniacs.com.br) só sai com o GO do Helbert.

## O site no ar
O site (`site/`) está em https://firmopolis.devmaniacs.com.br desde 19/11/2026. A config do nginx fica em `docs/firmopolis/site-nginx.conf` (CSP, gzip e cache): o HTML não fica em cache; CSS e JS ficam em cache longo, renovado pelo `?v=`; imagens e fontes ficam em cache por uma semana. Para atualizar, suba o `?v=` do arquivo que mudou, copie `site/` resolvendo os links simbólicos (`rsync -aL`) e confira com Playwright.

## Onda 1: nome, ícones e abertura (feita)
- A aba, o PWA, o convite, o modo construção e o nome do app OAuth agora dizem "Firmópolis". A aba fica `<empresa> · Firmópolis`. A palavra "Escritório" continua como nome da página do mapa, porque o escritório é um lugar dentro de Firmópolis.
- Os ícones do PWA saíram do kit (`arte/marca/kit/`). O `logo.png` padrão passou a ser o mascote, em 32 px ampliado 6× sem suavizar.
- A abertura (`static/abertura.js`) roda por cima do carregamento, uma vez por sessão, e não roda no modo TV. Ela entrou na lista fechada de estáticos.
- Instalações já conectadas continuam com o nome antigo do app no agentes.chat até reconectar em `/oauth/conectar`.

## Onda 2: a ponte local como segunda fonte
Objetivo: o mapa mostrar também os terminais da máquina (Claude Code, Codex, agy, OpenCode, MiniMax e o Maestri), lidos pela ponte da Vivo.

**2a (feita, 19/11/2026), opção A:** o navegador lê a ponte direto, e os terminais locais não saem do computador.
- A ponte veio para `ponte/` (módulo `firmopolis/ponte`). A pasta de config virou `Firmopolis`; a `EscritorioVivo` antiga é renomeada sozinha na primeira execução (se uma ponte antiga ainda a segura no Windows, segue na antiga).
- `ponte setup --aplicar --origem https://<endereço do Firmópolis>` grava a origem em `origens.txt` e mostra o token. A guarda segue recusando qualquer Origin, menos um GET /ws de uma origem da lista; o token vai no subprotocolo (`firmopolis.v1` e `token.<hex>`), porque o navegador não manda Authorization no WebSocket. A lista é relida a cada pedido (não precisa reiniciar).
- No app, `static/ponte.js` liga só depois de a pessoa colar o token em Personalizar > Ponte local (fica no localStorage daquele navegador). A CSP ganhou `ws://127.0.0.1:47820` no `connect-src`.
- No mapa (`vida.js` e `app.js`), os terminaizinhos (`static/sprites.js`, o mesmo do site, que agora é symlink) são figurantes como as pessoas: ocupado trabalha na sala do primeiro time, esperando você vai para a recepção com o "!" ou o "?", e livre fica na sala comunal ou na cozinha. A carinha e o selo mudam na hora; a sala muda depois de o estado durar 4 s. A etiqueta leva o programa ("Ada · Codex").
- Com a ponte desligada, o app tenta de novo com espera crescente até 1 minuto. O próprio navegador escreve no console a falha de conexão do WebSocket; o app não mostra erro.
- No Chrome, a primeira conexão de um site público para 127.0.0.1 pode pedir a permissão "acesso à rede local". O Safari pode recusar `ws://` vindo de página https.

**2b (feita, 19/11/2026):** a marca das integrações virou `firmopolis` (entrada do agy, plugins do OpenCode e do MiniMax, backups, o bin `%LOCALAPPDATA%\Firmopolis\bin` e o autostart `Firmopolis`). O `setup --aplicar` migra quem vem do Escritório Vivo: tira a entrada `escritorio-vivo` do agy, apaga os plugins antigos só quando o sha é o nosso (manifesto ou modelo antigo) e tira o autostart `EscritorioVivo`. O plugin do OpenCode lê o token da pasta nova e, se faltar, da antiga. O `--desfazer` tira as duas marcas.

## Onda 3: as três espécies no app (feita)
- Os **bichinhos de feltro** já existem (`avatar.js`) e representam os agentes do agentes.chat.
- Os **terminaizinhos** têm um monitor CRT como cabeça, um cursor como boca e a cor da moldura conforme o programa. O desenho já existe em `site/sprites.js` e vai para o mapa em escala de jogo.
- A **gente** é você e as visitas. As visitas já têm presença; a espécie só troca o boneco. Feito: `desenharGente` (app.js) usa `Sprites.gente`, com a blusa na cor do perfil e cabelo, pele e calça pela semente da pessoa. Olhos e acessório do perfil continuam valendo só para o bichinho (convite, perfil).

## Onda 4: mecânicas "Sims" (feita)
Necessidades e rotinas da Vivo (café, pausa, conversa no corredor), reescritas sobre o `vida.js`. O GDScript não é portado linha a linha. O gatilho continua sendo o estado real do agente, e nada é inventado.

Feita nos terminaizinhos (`vida.js`, `viverTerminal`). Cada um tem duas necessidades, café e conversa, que caem com o tempo: 20 minutos ocupado esvaziam o café, e parado leva uma hora. Livre e parado na sala, depois de uma pausa de 5 a 20 s, ele cuida da mais baixa (abaixo de 60). Vai à cafeteira, ou chama o terminal livre mais perto para um papo no corredor, com os balõezinhos de xícara e de "Hi!". Deixou de estar livre, larga o que fazia, e o parceiro volta à sala. Os bichinhos do agentes.chat já tinham a vida social deles e não mudaram.

## Onda 5: acabamento
- Revisão visual com capturas no desktop e no celular.
- Os READMEs e o CHANGELOG com o nome novo.
- O vídeo narrado da versão nova entra no lugar do chiado da TV do site.
- Feito: o seletor do perfil e do convite escolhe a gente do mapa (blusa, cabelo e pele), com prévia. Cabelo e pele vão no avatar da conta como `hair` e `skin`, opcionais; olhos e acessório, do bichinho do agentes.chat, ficam como estavam.
