# Ponte do Firmópolis

Serviço local em Go (127.0.0.1:47820), vindo do Escritório Vivo. Lê os agentes (Claude Code, Codex, agy, OpenCode e MiniMax Code, com o Maestri como modo turbinado) e conversa por WebSocket com o jogo e com o Firmópolis aberto no navegador. Não gasta token: nada aqui chama modelo.

A pasta de config agora se chama `Firmopolis` (`%APPDATA%\Firmopolis`, `~/.config/Firmopolis`), e a marca das integrações é `firmopolis`. Quem vem do Escritório Vivo não precisa desfazer nada antes:
- a pasta `EscritorioVivo` é renomeada sozinha na primeira execução, com o token, o histórico, o clima e o manifesto;
- o `setup --aplicar` instala as entradas `firmopolis` e tira as `escritorio-vivo`: a entrada do agy e os plugins do OpenCode e do MiniMax, só quando o arquivo é o que a ponte pôs (pelo manifesto ou pelo hash do plugin antigo). Um arquivo antigo editado fica, com aviso, porque com os dois cada evento iria em dobro. No Claude Code e no Codex, a marca é o próprio comando (`ponte hook ...`), que é trocado no lugar;
- no Windows, o `--aplicar` tira o autostart antigo (`EscritorioVivo` na chave Run), que subiria a ponte antiga na mesma porta. Compile a ponte nova no bin novo (passo 1) e rode o `--aplicar` com ele;
- o `--desfazer` tira as duas marcas, e os backups antigos (`.bak-escritorio-vivo-*`) também entram na lista do que sobrou.

## 1. Compilar no lugar definitivo
Os hooks do Claude Code, do agy, do Codex e do MiniMax Code guardam o caminho absoluto do `ponte.exe` que rodou o `setup`. Por isso, compile direto no lugar onde o executável vai ficar. É o mesmo lugar que o instalador da Fase 4 usa.

```powershell
cd ponte
$bin = "$env:LOCALAPPDATA\Firmopolis\bin"
go build -o "$bin\ponte.exe" ./cmd/ponte
go build -ldflags=-H=windowsgui -o "$bin\ponte-fundo.exe" ./cmd/ponte   # só para o autostart
```

O `ponte-fundo.exe` é o mesmo programa sem console: não abre janela e escreve o log em `%APPDATA%\Firmopolis\ponte-fundo.log` (recomeça ao passar de 1 MiB). Ele só serve para o autostart.

Os passos seguintes usam sempre o `ponte.exe` do bin, nunca o `go run`. O `--aplicar` recusa um binário temporário do `go run`.

## 2. Ligar as integrações
```powershell
$ponte = "$env:LOCALAPPDATA\Firmopolis\bin\ponte.exe"
& $ponte setup --plano      # mostra o que muda em cada arquivo; não escreve nada
& $ponte setup --aplicar    # instala, com backup <arquivo>.bak-firmopolis-<data>
& $ponte setup --desfazer   # tira tudo o que é firmopolis (e o que sobrou do escritorio-vivo), inclusive o autostart
```

- **Claude Code:** hooks em `~/.claude/settings.json`, chamando `ponte.exe hook claude` em segundo plano (`"async": true`) e sem shell no meio (`args`). O Claude não espera o hook, e o hook sai sempre com 0 e calado. O hook `http` das versões anteriores mostrava erro em toda ação com a ponte desligada; o `--aplicar` troca esse hook no lugar, e o `--desfazer` tira os dois.
- **OpenCode:** plugin em `~/.config/opencode/plugins/firmopolis.js`.
- **agy:** entrada `firmopolis` em `~/.gemini/config/hooks.json`, chamando `ponte.exe hook agy`.
- **Codex:** hooks em `~/.codex/hooks.json`, chamando `ponte.exe hook codex` em segundo plano (`"async": true`), menos no `SessionEnd`, que o Codex só roda síncrono. O Codex só roda hook aprovado: depois do `--aplicar`, abra o `codex`, rode `/hooks` e aprove. A ponte não grava o `trusted_hash`. O `command` (o do sh, fora do Windows) leva o caminho entre aspas simples; o `commandWindows` roda no PowerShell. Quem instalou antes, com o caminho entre aspas duplas, aprova de novo depois do próximo `--aplicar`.
- **MiniMax Code (`mcode`):** plugin local em `~/.minimax/plugins/firmopolis/.claude-plugin/plugin.json` (ou no `MINIMAX_DATA_DIR`, se houver; com `--home`, sempre `<home>/.minimax`). É um arquivo só, todo nosso: os hooks vão inline no campo `hooks` do manifesto, chamando `'<ponte.exe>' hook mcode` em 8 eventos (`SessionStart`, `UserPromptSubmit`, `PermissionRequest`, `PostToolUse`, `SubagentStart`, `SubagentStop`, `Stop` e `SessionEnd`). O caminho vai entre aspas simples, porque o Git Bash expandiria `$` e crase entre aspas duplas. Sem o `PreToolUse`: cada hook do mcode é síncrono e custa uns 330 ms, e o `PostToolUse` já dá a atividade e tira a espera. O mcode vigia a pasta `plugins` e carrega o plugin sozinho; não há comando de instalar nem aprovação. Sem backup: o `--desfazer` apaga o arquivo e as pastas que a instalação criou. O `--plano` mostra o manifesto inteiro, porque o comando muda com o lugar do `ponte.exe`. O `~/.minimax/config.yaml` não é tocado.

Só os agentes instalados entram. As sessões que já estavam abertas pegam os hooks depois de reiniciar. Para conferir numa cópia das configs, use `--home <pasta>`.

Se o `ponte.exe` mudar de lugar, rode o `setup --aplicar` de novo. Ele troca o caminho no lugar, e o Codex pede uma nova aprovação.

### Com a ponte desligada, travada ou lenta
Nenhum agente mostra erro. O `ponte hook` lê o token do arquivo da ponte, repassa o evento e sai com 0, sem escrever nada, em no máximo 0,9 s. O plugin do OpenCode manda sem esperar a resposta e engole a falha. Custo medido por evento no Windows (mediana, `ponte.exe` chamado direto):

| Situação | `ponte hook` | Claude Code | agy | Codex |
|---|---|---|---|---|
| ligada | ~80 ms | não espera (async) | ~155 ms (com o shell) | não espera (async); ~500 ms só no `SessionEnd` |
| desligada | ~90 ms | não espera (async) | igual | igual |
| travada | ~850 ms (prazo) | não espera (async) | ~850 ms + o shell | não espera; `SessionEnd`: ~850 ms + o PowerShell |

O agy e o mcode esperam o hook terminar. O mcode só aceita hook síncrono e roda o comando no Git Bash (`bash -c`): o `ponte hook mcode` custa de 315 a 340 ms por evento com o arranque do bash (medido na auditoria; ~220 ms na primeira medição, com a ponte desligada), a cada evento, inclusive depois de cada ferramenta. Por isso o plugin não assina o `PreToolUse`: com ele, eram uns 0,6 s por ferramenta. Com o hook saindo com 0 e calado, o `mcode exec` não mostra nada dele, nem no `--output-format stream-json` (conferido com a ponte desligada). O Codex abre um PowerShell para rodar o `commandWindows` (500 a 700 ms), mas só espera no `SessionEnd`; nos outros eventos, segue e não mostra nada do hook (com hook síncrono, o `codex exec` mostra `hook: SessionStart` e `Completed`).

O `timeout` dos hooks é de 10 s no Claude Code, no agy, no Codex e no mcode (o máximo do mcode). No Codex, o `SessionEnd` e o `Interrupt` ficam em 3 s, porque ele não aceita mais que isso nesses dois eventos. Esse prazo não muda a espera normal, porque o `ponte hook` sai sozinho em 0,9 s. Mas o agente conta o prazo desde que abre o processo do hook (no Codex, o PowerShell), mesmo nos hooks em segundo plano, e, quando ele estoura, mata o processo.
- No primeiro uso de um `ponte.exe` novo (depois de compilar ou atualizar), o Windows leva de 1,2 a 2,5 s para arrancar o exe (até 4 s com a máquina carregada), enquanto o antivírus examina o binário. Nos usos seguintes, leva de 0,1 a 0,25 s. O agy, que espera o hook, sente o arranque (1,2 a 4 s); os 10 s são só o teto.
- Com o antigo prazo de 2 s, o `SessionStart` e o `UserPromptSubmit` da primeira sessão do Codex morriam antes do POST, e o Claude e o agy corriam o mesmo risco.
- No `SessionEnd` do Codex, o único síncrono, os 3 s contam a abertura do PowerShell. Com a máquina carregada, o PowerShell e o `ponte hook` podem não caber nesse prazo, e o evento se perde. Nesse caso, a ponte encerra a sessão quando o processo do Codex morre.

Fora de ordem, os eventos do Claude e do Codex se acertam pela hora em que o agente criou o processo do hook (`X-Ponte-Hora`).

### Quem aparece no prédio
Só quem tem processo vivo. A cada passo (3 s), a ponte relê `~/.claude/sessions` e confere os agentes resolvidos pelos hooks:

- **Processo morto sai**, com ou sem `SessionEnd`. Um `/exit` cujo hook não chegou a sair some no passo seguinte, porque o arquivo da sessão some e o processo morreu.
- **PID reaproveitado conta como morto.** O Windows reusa PIDs depressa. A ponte compara a hora em que o processo nasceu com o `procStart` do arquivo da sessão (no Claude) ou com a hora guardada quando resolveu o agente do hook. Essa hora fica com a sessão (e com o morador), não com o PID: um agente novo que herde o PID não mantém o morador velho. Se o PID já é de outro processo, a sessão sai.
- **"dialog open" só é esperando você no meio do turno.** No fim do turno, o Claude abre um diálogo opcional (a pesquisa "How is Claude doing this session?", a oferta de compactar...) e grava `waiting`/`dialog open` no arquivo, uns 16 ms depois do `Stop`: quem já está ocioso segue ocioso. O mesmo `dialog open` também cobre diálogos que pedem ação ("Session paused", para tentar de novo no modelo de reserva depois de uma recusa da API, o ultraplan, as managed settings); nesses, o terminal ainda estava ocupado e passa a esperando você. O `input needed` (ou permissão) é sempre espera e também dispara o hook `Notification`.
- **Solto** é uma sessão viva que ainda não mandou hook a esta ponte, então a ponte não sabe o terminal dela. Depois de reiniciar a ponte, os terminais parados aparecem soltos até o primeiro evento, quando voltam ao terminal.

### MiniMax Code: identidade e limites
O mcode passa ao hook só uma lista fixa de variáveis: o `MAESTRI_TERMINAL_ID` não chega ao `ponte hook`. A ponte acha o terminal assim:

1. **Agente:** a subida pelos pais a partir do hook, a mesma dos outros, para no primeiro processo que não é shell. No mcode, é o `node.exe` do `@minimax-ai\code\cli.js`. Cadeia medida: `ponte.exe` ← `bash` ← `bash -c` ← `node.exe` (mcode) ← `cmd.exe` (`mcode.cmd`) ← shell do terminal. O PID e a hora em que ele nasceu servem para a vida e a morte, como nos outros.
2. **Terminal:** a ponte lê o `MAESTRI_TERMINAL_ID` do ambiente desse `node.exe`, pela PEB (`processo.TerminalMaestri`). O dono do processo precisa ter o mesmo SID do usuário da ponte (pelo token dele); senão, nada é lido. A ponte procura só essa variável (o nome sem caixa, como no Windows), direto no bloco de ambiente, sem decodificar as outras, e zera o bloco lido no fim. Um bloco acima de 1 MiB, ou lido pela metade, não vale. O valor só vale com letras, dígitos, `.`, `_` e `-` (até 128). A leitura é feita uma vez por sessão. Se o hook trouxer o `X-Maestri-Terminal-Id`, vale o do header. Fora do Windows, a ponte lê o `/proc/<pid>/environ` no Linux; nos demais sistemas, e na ponte de 32 bits, o mcode fica solto.
3. **Sem o terminal no ambiente** (o mcode fora do Maestri): solto, como os outros.

O `provedor` no contrato é `minimax_code`. Os estados seguem as regras do Claude, mais o `PostToolUse` (ocupado), porque o mcode não tem `Notification`: é a ferramenta terminando que tira o "esperando permissão" (o hook é síncrono, então um `PostToolUse` não chega depois do `Stop`). A atividade também vem do `PostToolUse`, a ferramenta que acabou de rodar; um `PostToolUse` sem ferramenta não mexe na atividade. As ferramentas vêm em minúsculas (`bash`, `read`, `edit`...) e vão assim no `atividade.ferramenta`, como as do OpenCode.

Subagentes, pelo código do mcode 0.7.7 (ele não tem `StopFailure`): o `SubagentStart` (`agent_id`, `agent_type`) e o `SubagentStop` (mais `stop_hook_active`, `agent_transcript_path` e `last_assistant_message`) vêm com o `session_id` do pai e contam como ajudante, como no Claude. Os outros eventos de dentro do subagente vêm com o `agent_id` e o `session_id` do próprio subagente, e a ponte os ignora: o `PostToolUse` do subagente não tira a espera do pai, e o `PermissionRequest` do subagente não vira espera (no Claude, vira espera do pai; no mcode, não há como achar o pai).

Visto em execução (mcode 0.7.7):
- **Vistos:** o `SessionStart` (com `source: "startup"`), o `UserPromptSubmit`, o vínculo com o terminal pelo ambiente, o projeto pelo `cwd` e a saída do morador quando o processo morre.
- **Sem `SessionEnd` no fim do `mcode exec`,** nem no fim por timeout ou por kill: quem tira o morador é a varredura, quando o processo morre.
- **Ainda não vistos:** o `PostToolUse`, o `PermissionRequest`, o `SubagentStart`, o `SubagentStop`, o `Stop` e o `SessionEnd` do TUI. A chamada ao modelo não respondeu nesta máquina (`llm_request_failed`, `kind: network`). Esses eventos seguem o formato do Claude, segundo o recon, e estão cobertos por testes com esse formato.
- **Prompt barrado:** um prompt barrado por outro hook (exit 2 no `UserPromptSubmit`) deixa o morador ocupado até o próximo evento ou até o processo morrer. O `ponte hook` nunca barra.

### Projeto
Cada morador e cada workspace levam o campo `projeto`, o nome legível do projeto em que trabalham (por exemplo, `EscritorioVivo`, `dm-erp`, `purple-ribbon`). A ponte só manda o campo; o texto do crachá (`<projeto> · <4 letras>` no solto) é do jogo.

- **Do cwd da sessão:** o nome da raiz git (sobe até achar o `.git`). Um worktree conta como o repositório de origem: o `gitdir` do arquivo `.git` aponta para `<repo>/.git/worktrees/...` (`<repo>.git/worktrees/...` no repo bare, `<repo>/.git/modules/<sub>/worktrees/...` no submódulo, que dá o `<sub>`). Um arquivo `.git` sem `gitdir:` (vazio ou estragado) conta como a raiz. Sem git, o nome da pasta. A busca para antes da home e da raiz do disco.
- **Floor do Maestri** (`<pasta>\.maestri\floors\<repo>--<floor>`): a busca não sai do floor, mesmo com um `.git` acima dele. O floor é worktree, e vale o repositório de origem. Sem `.git` no floor, vale o `<repo>` do nome da pasta, que o Maestri grava em minúsculas; com a caixa da pasta de mesmo nome em `<pasta>`, se houver (`escritoriovivo` vira `EscritorioVivo`), para não dividir o projeto.
- **Pasta do papel:** o Maestri abre os terminais em `<pasta do workspace>\.maestri\roles\<papel>`. Esse cwd conta como a pasta do workspace.
- **Pasta genérica** (a home, a raiz do disco): o cwd não dá projeto. O terminal do Maestri fica com o projeto dele no `workspace.json`: o da pasta do terminal, senão o do floor, senão o do workspace. O solto fica com o projeto do workspace dessa pasta quando todos os workspaces dessa pasta têm o mesmo projeto (um ou vários); com projetos diferentes, `null`.
- **Caminho de rede** (`\\servidor\pasta\...`): a ponte não lê o disco, para não travar com o servidor fora do ar. Vale o nome da pasta; o `\\servidor\pasta` é genérico.
- **cwd relativo** (`.`, `dev\loja`, `C:dev`): sem projeto.
- **Junction e symlink:** a ponte não resolve o link; o projeto é o nome do link (ou o da raiz git acima dele).
- **Workspace:** o projeto da pasta dele (`workingDirectory`). Na home, o mais comum entre os floors e as pastas dos terminais (no empate, o primeiro em ordem alfabética). Sem nenhum, o nome do canvas. Nunca vai vazio.
- **Custo:** o projeto de cada cwd é lido do disco uma vez e fica em cache enquanto a ponte roda. Um `git init` depois disso só aparece quando a ponte reiniciar.

Se um terminal "desligado" segue no prédio, o processo dele ainda está vivo. Confira com `Get-Process -Id <pid>`, usando o `pid` do `~/.claude/sessions/<pid>.json`. Um `/exit` enviado com o diálogo de fim de turno aberto pode ser engolido pelo diálogo, e o Claude continua rodando.

### Clima e datas do dia
A ponte manda ao jogo o tempo de agora na cidade configurada e as datas festivas do dia. É a única saída de rede da ponte.

```powershell
& $ponte setup --plano --cidade "Nome da cidade"                 # procura no Open-Meteo e lista; não grava
& $ponte setup --aplicar --cidade "Nome da cidade" --escolha 2   # grava a 2ª da lista (com uma só, não precisa)
& $ponte setup --aplicar --sem-cidade                            # desliga: clima null, nada sai da máquina
```

- **Onde fica:** `clima.json` na pasta da ponte (`%APPDATA%\Firmopolis`), com `cidade`, `lat`, `lon`, `fuso`, `pais` e `consentimento`. O setup do clima não toca as configs dos agentes. A ponte lê a cidade ao subir, então reinicie a ponte depois de mudar.
- **Privacidade:** gravar a cidade com `--aplicar` é o consentimento. A busca da cidade manda só o nome, uma vez. Depois, a cada consulta, saem só a latitude e a longitude (com 2 casas, cerca de 1 km) e o fuso. Sem cidade, nada sai.
- **Busca:** o Open-Meteo (`weather_code`, `temperature_2m`, `wind_speed_10m`, `wind_gusts_10m`, `precipitation`, `is_day`, `sunrise` e `sunset`) a cada 15 min. Se falhar (sem rede, 5xx, resposta acima de 64 KiB), a ponte tenta de novo em 1, 2, 4 e 8 min, e depois a cada 15, por mais longa que seja a queda. O último clima bom vale por 2 h e fica em `clima-cache.json`; uma ponte reiniciada não busca de novo antes da hora. Um cache com a hora de chegada no futuro (relógio adiantado quando gravou) é ignorado. Passadas as 2 h sem resposta, o clima vira `null`.
- **Largada:** a ponte manda as datas do dia (e o clima do cache, se ainda vale) assim que sobe, sem esperar a 1ª busca na rede. Depois, só manda a mensagem `clima` quando algo muda: um clima novo, o clima vencido ou o dia novo.
- **Céu**, pelo código WMO: `limpo` (0, 1), `nublado` (2, 3 e código desconhecido), `neblina` (45, 48), `garoa` (51 a 57), `chuva` (61 a 67, 80 a 82), `neve` (71 a 77, 85, 86), `tempestade` (95) e `granizo` (96, 99).
- **Vento**, pela rajada (ou pelo vento médio, se for maior): `calmo`, `ventania` a partir de 75 km/h e `furacao` a partir de 118 km/h.
- **Hoje:** com cidade, o dia vira à meia-noite do fuso dela (o `fuso` do `clima.json`); sem cidade, ou com um fuso que a ponte não conhece, à meia-noite do PC. Contrato: para a decoração do dia, o jogo usa as `datas_hoje` da ponte, e não a data do PC; assim os dois concordam mesmo com a cidade em outro fuso.
- **Datas** (`datas_hoje`), no dia acima, no país da cidade (BR sem cidade; `br` minúsculo também vale):
  - no BR: Ano Novo, Carnaval (do sábado à terça), Sexta-feira Santa, Páscoa, Tiradentes, Dia do Trabalho, Corpus Christi, Festa Junina (o mês de junho), Independência, Dia do Programador (256º dia do ano), Nossa Senhora Aparecida, Dia das Crianças, Halloween, Finados, Proclamação da República, Consciência Negra, Véspera de Natal, Natal e Réveillon;
  - em outro país, só as universais (Ano Novo, Páscoa, Dia do Programador, Halloween, Véspera de Natal, Natal e Réveillon), com feriado só no Ano Novo e no Natal;
  - Páscoa pelo algoritmo de Meeus/Jones/Butcher, e Carnaval e Corpus Christi contados a partir dela.

### Autostart (opcional)
A ponte precisa estar ligada quando a sessão abre; senão, o vínculo com o terminal do Maestri se perde. Com `--autostart`, ela sobe sozinha no login do Windows, sem janela:

```powershell
& $ponte setup --plano --autostart     # mostra o valor que seria gravado
& $ponte setup --aplicar --autostart   # grava
```

O setup grava o valor `Firmopolis` em `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` com `"<bin>\ponte-fundo.exe"`, entre aspas. Não precisa de admin.

- O `--autostart` só funciona com o `ponte.exe` do bin instalado (`%LOCALAPPDATA%\Firmopolis\bin`), com o `ponte-fundo.exe` ao lado e compilado com `-H=windowsgui`. Se faltar alguma dessas coisas, o setup recusa e não grava nada. Assim, um `go run`, o `%TEMP%` ou um fundo com console nunca vão para o login.
- O `--desfazer` tira o valor, mas só quando ele termina em `\ponte-fundo.exe"`. Um valor `Firmopolis` (ou `EscritorioVivo`) de outro programa fica onde está.
- O `--autostart` não combina com `--home`: o registro é sempre o do usuário de verdade.
- Uma segunda ponte de fundo na mesma porta sai sem janela, com código 1, e anota no log que a porta estava ocupada.
- Para achar (ou parar) a ponte real, filtre pelo caminho, nunca só pelo nome: `Get-Process ponte-fundo | ? Path -eq "$env:LOCALAPPDATA\Firmopolis\bin\ponte-fundo.exe"`. O `go test ./cmd/ponte` sobe, por uns segundos, um `ponte-fundo.exe` de teste (`%TEMP%\ponte-teste-*`, `--demo`, porta livre, log na pasta do teste). Parar esse processo pelo nome derruba o teste de quem estiver rodando.

## 3. Rodar
```powershell
& $ponte            # ponte de verdade
& $ponte --demo     # 10 moradores de mentira; não lê nem grava nada real
```

O `ponte.exe` só sobe a ponte num terminal (ou com o stdin no NUL). Com o stdin num pipe ou num arquivo, ele sai com 1 e não sobe nada, porque é assim que um agente chama um hook. Um Claude Code antigo, que ignore o `args` do hook, rodaria o `ponte.exe` puro a cada evento; sem essa trava, subiria uma ponte por evento. Para rodar sem terminal, use o `ponte-fundo.exe`.

## 4. Ver os terminais no Firmópolis (navegador)
O Firmópolis no navegador lê a ponte direto do seu computador; nada vai para o servidor do escritório.

```powershell
& $ponte setup --aplicar --origem https://escritorio.exemplo.com   # o endereço em que você abre o Firmópolis
```

O comando grava o endereço em `origens.txt` (na pasta da ponte) e mostra o token. No Firmópolis, abra Personalizar > Ponte local e cole o token; ele fica só naquele navegador. Vale na hora, sem reiniciar a ponte. Para tirar: `--sem-origem <endereço>`. O `--plano` mostra o que mudaria, sem gravar.

- A guarda segue recusando qualquer pedido com Origin, menos o GET /ws de um endereço da lista. Vale https em qualquer endereço e http só no próprio PC (`http://localhost:<porta>`, para desenvolvimento).
- O navegador não manda `Authorization` no WebSocket. Por isso, o token vai como subprotocolo: o app pede `firmopolis.v1` e `token.<hex>`, e a ponte responde só com `firmopolis.v1`.
- O navegador recebe só o que a tela usa: sem o alvo da atividade e sem o histórico do dia.
- Liberar um endereço é confiar em tudo o que esse endereço serve: libere só o do seu Firmópolis. O mesmo token vale para os hooks; se desconfiar que vazou, apague o arquivo `token` da pasta da ponte e rode o `setup --aplicar` de novo.
- No Chrome, a primeira conexão de um site da internet para 127.0.0.1 pode pedir a permissão de acesso à rede local.

## 5. Espelho: ver os terminais desta máquina de outro navegador (opcional)
Para quem roda os terminais numa máquina (uma VM, por exemplo) e abre o Firmópolis em outra, sem túnel. Vem desligado. No Firmópolis, o admin do prédio gera a chave em Personalizar > Ponte local, e a tela mostra o comando pronto. Rode na máquina dos terminais:

```bash
ponte conectar https://escritorio.exemplo.com             # pede a chave, testa, instala os hooks e grava o espelho
ponte conectar https://escritorio.exemplo.com --servico   # no Linux, também cria e liga o serviço systemd do usuário
```

O `conectar` testa a chave antes de mudar qualquer coisa (o teste não troca o que o servidor mostra), roda o `setup --aplicar`, grava `espelho.json` na pasta da ponte (0600) e diz o próximo passo. O `--servico` cria `~/.config/systemd/user/firmopolis-ponte.service` e roda `systemctl --user enable --now`; se a unit já existe, fica como está.

Só o espelho, sem mexer nos hooks: `setup --aplicar --espelho <endereço> --chave-espelho <chave>`; para desligar, `setup --aplicar --sem-espelho`. Vale na hora, sem reiniciar a ponte: o `espelho.json` é relido a cada envio.

- Vai ao servidor a mesma versão reduzida do navegador (moradores sem o alvo, workspaces e bands só com os nomes, o dia sem alvo), num `POST <endereço>/api/ponte/espelho` com `Authorization: Bearer <chave>` e `User-Agent: Firmopolis-ponte/<versão>`. **Os nomes dos terminais e dos projetos passam a ir ao servidor.**
- Envia uns 2 s depois de uma mudança (juntando as que vierem nesse meio-tempo) e, sem mudança, a cada 30 s. Na falha, espera de 5 s a 5 min, sem travar a ponte. O log diz só quando para e quando volta, nunca a chave.
- Corpo de até 200 KiB: passou, o dia perde os eventos mais velhos. Timeout de 10 s. Só https, ou http no próprio PC para desenvolvimento.

## Testes
```powershell
go test ./...
go vet ./...
node --test integracoes/modelos/opencode-firmopolis.test.js
```

Um `fork/exec ...\<pacote>.test.exe: The process cannot access the file because it is being used by another process` solto, que some na rodada seguinte, é o antivírus (nesta máquina, o Kaspersky) examinando o `.test.exe` que o `go test` acabou de gerar. Nenhum teste abre os `.test.exe`. Se atrapalhar, exclua a pasta temporária do Go da varredura ou rode com `-p 1`.

Pelo mesmo motivo, de vez em quando (cerca de 1 em 300 testes que gravam arquivo) um teste passa e falha só na limpeza: `TempDir RemoveAll cleanup: ... The directory is not empty`. O antivírus ainda segura o arquivo recém-gravado (o `clima.json`, por exemplo), e o Windows não apaga a pasta. Um teste mínimo, só com a biblioteca padrão do Go (gravar e renomear um arquivo no `t.TempDir()`), falha na mesma proporção, então não é a ponte. Por isso, os testes do `cmd/ponte` e do `clima` gravam numa `pastaTemp`, cuja limpeza tenta de novo por até 2 s (medido: 5 falhas em 1000 com o `TempDir`, nenhuma com a `pastaTemp`). Se aparecer em outro pacote, rode de novo.

Os testes de prazo do hook (`TestHookNuncaPassaDeUmSegundo` e `TestHookSemPonteSemTokenOuRotaRuim`) medem o processo inteiro, inclusive a criação dele. Com a máquina carregada, a criação às vezes passa de meio segundo. Por isso, cada caso vale pela mais rápida de até 3 rodadas.

Os testes com os agentes de verdade ficam desligados por padrão. Nenhum deles chama modelo nem toca as configs reais:

```powershell
$env:PONTE_TESTE_REGISTRO = "1" # autostart numa chave de teste do HKCU (Software\FirmopolisTeste, apagada no fim), nunca na Run
go test ./cmd/ponte -run Autostart
$env:PONTE_TESTE_CLAUDE = "1"   # claude -p isolado (--setting-sources project); um hook do teste barra o prompt
$env:PONTE_TESTE_CODEX = "1"    # hooks/list e codex exec com um CODEX_HOME temporário, sem login (a chamada ao modelo volta 401)
go test ./internal/integracoes -run Real
```

O mcode não tem teste automático com o agente de verdade. Numa `MINIMAX_DATA_DIR` vazia, ele não tem login: o `exec` falha antes de qualquer hook. A validação foi feita à mão, no data dir real:
- um plugin de teste em `~/.minimax/plugins/firmopolis-teste`, apontando para uma ponte de teste na porta 47921, com um `APPDATA` temporário;
- o prompt barrado com exit 2, que não gasta crédito;
- a pasta do plugin apagada logo depois.

O mcode copia os plugins com hooks para `<dados>/v2/plugin-hook-cache/sha256-tree-v1-<hash>`, e essas cópias ficam. O `--desfazer` não mexe nessa pasta, que é do mcode. Do recon ficaram lá 3 cópias do plugin de teste `ev-teste`; elas foram apagadas em 16/11/2026, uma a uma, depois de conferir o `plugin.json` de cada uma.

A cadeia do mcode com o Git Bash de verdade (`bash -c` e o bash lançador) é testada no `servidor` (`TestMiniMaxCadeiaComBash`), e não no `processo`: o Kaspersky barra o `processo.test.exe` com esse teste (`open ...processo.test.exe: Access is denied` em toda rodada), e o binário do `servidor` passa.
