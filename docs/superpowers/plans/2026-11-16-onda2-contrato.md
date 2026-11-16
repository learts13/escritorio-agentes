# Contrato da Onda 2 (1.6): back (Neo) ↔ painel (Tron) e mapa (Flynn)

Dono: Neo (floor onda2-back). Só o Neo muda este arquivo, e só avisando o Maestro.
Base: andares @ 3cf4eb8. Vale o plano 2026-11-15-escritorio-da-equipe.md (B, ONDA 2 reemitida, E.3, E.4, E.5, D3 1 ano,
D4 b, D5 b, D6 b, D8 a, D10 a, D12 a) e o contrato da Onda 1 (perfis, `?andar=`, 404 de andar).

## 0. Regras comuns

- **Store ligado** (ajuste do Maestro, 16/11): as conversas persistentes (histórico, DM, mural, status, anexo) ligam
  quando o escritório tem **pelo menos 1 conta** no sistema de contas **ou** um `dados/andares.json` (v1 ou v2). Vale
  também para quem roda com uma empresa só. Sem nenhum dos dois (a instalação antes do primeiro acesso, ou a prévia),
  tudo fica igual a hoje: `config.equipe` sai `null`, as rotas desta onda dão 404
  `{"erro": "desligado", "mensagem": "As conversas da equipe estão desligadas neste escritório."}` e o `/api/ao-vivo` não
  ganha nenhum campo novo. Com o store ligado, as respostas antigas não mudam: só ganham campos novos.
- Toda rota leva `?andar=` (ausente = o principal/saguão, como na Onda 1). Andar alheio ou inexistente: o 404 de andar.
- **POST**: `Origin` igual à BASE (senão 403 `origem`), sessão, `Content-Type: application/json` (senão 415 `formato`),
  objeto JSON com as chaves exatas (senão 400 `pedido`). A exceção é o envio de anexo (corpo cru, item 8).
- **Erros** sempre `{"erro": <código>, "mensagem": <texto para a tela>}`. Os de toda rota:
  `400 pedido`, `401` (sem sessão), `403 origem`, `403 papel`, `404 andar`, `404 nao_existe`, `429 limite`, `415 formato`.
- **404 nao_existe**: mensagem, DM, anexo ou aviso do mural que não existe **ou não é seu** dão a mesma resposta
  `{"erro": "nao_existe", "mensagem": "Isso não existe mais."}` (sem dizer qual dos dois).
- **Canal** (`canal`): `"geral"`, `"sala:<chave>"` (só as salas do mapa do andar, sem o corredor: `recepcao`, `reuniao`,
  `cozinha`, `lounge`, `time:<nome>`) ou `"dm:<n>"`. Sala fora do mapa do andar: 400 `pedido`.
- **Mensagem** (o formato do `historico()` do store), igual em toda rota:
  ```
  {"id": 123, "canal": "geral", "usuario": "ana", "nome": "Ana", "texto": "oi" | null, "apagada": false,
   "em": "2026-11-16T12:00:00Z", "reacoes": [{"emoji": "👍", "n": 2, "eu": true}],
   "anexo": {"id": 7, "nome": "foto.jpg", "tipo": "image/jpeg", "tamanho": 12345} | null}
  ```
  `usuario` `null` com `nome` `"ex-membro"`: a conta saiu do andar (D8 a). `apagada: true` vem com `texto: null`.
  `id` é o do SQLite (persistente; não é o `seq` da presença).
- **Saguão** (modo saguão, andar `principal`): só o canal `"geral"` no chat persistente; mural no `"geral"` e nas salas;
  **sem DM, sem anexo, sem @menção, sem auditoria, sem push**. No saguão, os GET de DM, anexo, pessoas e auditoria dão
  o 404 de andar; os POST de DM e anexo dão o 403 `papel` da guarda (a matriz da Onda 1 pede isso) e, para o admin do
  prédio, o 404 de andar. Onde aparece gente (mensagens, mural, acenos), `usuario` é o **id opaco** `p_<16 hex>` (o mesmo do
  `eu` e das `pessoas` do `/api/ao-vivo`, M2), nunca o login; quem não tem nome próprio sai `"Pessoa"`.

## 1. Config (`GET /api/config?andar=`)

Campo novo `equipe` (`null` com o store desligado):
```
"equipe": {"retencao": 365, "pode_moderar": false, "cota": null, "dm": true, "anexo": true, "mencao": true,
           "emojis": ["👍", "❤️", "😂", "🎉", "😮", "😢", "🙏", "👀"], "anexo_max": 26214400,
           "aviso_dm": "As mensagens diretas da <empresa> podem ser lidas pela administração da empresa.",
           "aviso_dm_entendido": false, "auditoria": false, "mural": true, "pode_escrever": true,
           "status": ["disponivel", "ocupado", "reuniao", "ausente"]}
```
- `retencao`: os dias (365, 90 ou 30) da empresa (item 10). `pode_moderar`: apaga mensagem alheia em canal e tira aviso
  do mural: só quem tem papel `admin` **neste** andar; no saguão, o admin do prédio. O admin do prédio lê os andares
  das empresas, mas sai `false` neles.
- `cota`: `{"usado": <bytes, com as reservas em curso>, "total": 5368709120}` dos anexos da empresa, só para quem
  `pode_moderar` fora do saguão (o resto: `null`). O cartão do prazo mostra a linha e, a partir de 90%, o aviso.
- `dm`, `anexo`, `mencao`: `false` no saguão. `auditoria`: `true` só para quem tem papel `admin` **neste** andar (o
  admin do prédio que não é admin do andar sai `false`).
- `aviso_dm` (o texto fixo do topo de toda DM, E.3) e `aviso_dm_entendido` (o "Entendi" desta conta neste andar, item 6).
- `mural: true` quando o store está ligado (Flynn: sem store, sem mural).
- `pode_escrever`: `false` só para o admin do prédio sem papel no andar de uma empresa (decisão do Maestro na auditoria
  final): ele lê o Geral, as salas e o mural, mas enviar, reagir, anexar e fixar dão 403 `papel`. O painel fica sem a
  caixa de escrever, sem reagir e sem Diretas, e o mural sem o campo de fixar. No saguão e no andar dele, `true`.
- Retenção: `POST /api/canal/retencao?andar=` `{"dias": 30|90|365}` → `{"retencao": dias}`. Só o admin da empresa (no
  saguão, o do prédio); a empresa só baixa de 1 ano (D3). Membro e admin do prédio no andar de uma empresa: 403 `papel`.

## 2. `/api/ao-vivo` (deltas; tudo o que já existia continua igual)

Pedido: `GET /api/ao-vivo?andar=&desde=<seq>[&canal=<canal aberto>&depois=<id>][&invisivel=1]`.
- `canal` e `depois`: o canal que o painel tem aberto e o maior `id` de mensagem que ele já mostra. Sem `canal`, sem
  `aberto`. Canal que a pessoa não lê: `aberto` sai `null` (sem erro).

Campos novos (só com o store ligado):
```
"pessoas": [{..., "status": "disponivel", "status_texto": "almoço"}],   // em cada pessoa (sem status = "disponivel", "")
"meu_status": {"status": "disponivel", "texto": ""},
"acenos": [{"de": "ana" | "p_…", "nome": "Ana", "tipo": "aceno" | "porta", "seq": 812}],   // para mim, seq > desde
"mural_v": {"geral": 1203, "sala:cozinha": 4501},   // muda quando o mural do canal muda; canal sem aviso não aparece
"nao_lidas": {"geral": 3, "sala:reuniao": 1, "dm:4": 2},   // só os canais com > 0 (DMs incluídas), até 100 por canal
"mencoes": {"geral": 1},                                   // menções a mim ainda não lidas, por canal (> 0, até 100)
"aberto": {"canal": "geral", "novas": [<mensagem>, ...], "v": 98123}   // até 50 mensagens com id > depois, em ordem
"no_predio": 12                                             // só no saguão: total de pessoas em qualquer andar, sem nome (D12 a)
```
- `aberto.v` muda quando alguma mensagem do canal é apagada ou ganha/perde reação: mudou, o painel relê o histórico.
- Uma DM nova aparece como chave `dm:<n>` em `nao_lidas`; o painel relê `GET /api/dm` para o nome.
- O `seq` dos acenos é o mesmo `seq` da presença do andar (o `desde` de sempre). Aceno vive 60 s.
- A mensagem do mapa **continua** em `POST /api/sala/enviar` (o balão, só na memória, como hoje). Com o store ligado,
  ela **também** entra no canal `sala:<sala do autor>` (o servidor sabe a sala) e a resposta ganha `"id"`. O painel
  envia por `/api/canal/enviar` (item 3), que **não** vira balão.

## 3. Mensagens

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /api/canal/enviar` | `{"canal", "texto"}` (1 a 500 caracteres) | `{"mensagem": <mensagem>}` |
| `GET /api/canal/historico?canal=&antes=<id>&limite=50` | — | `{"mensagens": [...], "mais": bool, "v": int}` (em ordem; `mais`: há mais antigas; `v`: a versão do canal lida antes das mensagens, a mesma do `aberto.v`: o painel parte dela e só pede o canal no `/api/ao-vivo` depois do histórico) |
| `POST /api/canal/lida` | `{"canal", "ate": <id>}` | `{"ok": true}` |
| `POST /api/canal/apagar` | `{"id"}` | `{"ok": true}` |
| `POST /api/canal/reagir` | `{"id", "emoji", "ligar": bool}` | `{"mensagem": <mensagem>}` |
| `GET /api/canal/busca?q=&limite=20` | — | `{"mensagens": [...]}` (as mais novas primeiro) |

- `limite` de 1 a 200 (padrão 50; busca, 20). `antes` ausente = as mais novas.
- Histórico de DM vem com dois campos a mais: `"aviso": <aviso_dm>` e `"acessos": ["2026-11-16T12:00:00Z", ...]` (as
  datas em que a administração abriu esta DM, D10 a, para as duas pontas).
- Apagar: o autor apaga a própria; `pode_moderar` apaga qualquer uma em canal; DM, só o autor. O texto e o anexo somem
  de verdade; a mensagem fica `apagada`. Os outros: 404 `nao_existe`.
- `@login` no texto vira menção (não no saguão nem em DM), resolvida no servidor só contra quem tem papel no andar:
  login de fora do andar não é achado e não muda nada (nem erro). Na tela, o texto continua literal.
- Busca: `q` até 100 caracteres, em geral, salas e nas DMs da própria pessoa; 1 por segundo (429 `limite`).
- Limites: enviar 1/s com rajada de 5; reagir 4/s com rajada de 8. Estourou: 429 `limite`.
- Erros próprios: `409 outro_saiu` (DM em que a outra pessoa não está mais no andar).

## 4. Pessoas do andar e DMs (não existem no saguão)

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/pessoas` | — | `{"pessoas": [{"usuario", "nome"}]}` (quem tem papel no andar, menos você) |
| `GET /api/dm` | — | `{"dms": [{"canal": "dm:4", "outro": {"usuario", "nome"} \| null, "ultima": iso \| null, "nao_lidas": n}]}` |
| `POST /api/dm/abrir` | `{"com": "<login>"}` | `{"canal": "dm:4"}` (cria na primeira vez) |
| `POST /api/dm/entendi` | `{}` | `{"ok": true}` (o "Entendi" desta conta neste andar) |

- `GET /api/pessoas` é a lista para autocompletar a @menção, escolher a DM e resolver o nome dos logins (DM e auditoria).
- `outro: null`: a outra ponta saiu do andar (mostre "ex-membro"); a DM fica só para ler.
- `abrir` com quem não tem papel no andar, com você mesmo ou login inexistente: 404 `nao_existe`.
- Antes da 1ª DM: `config.equipe.aviso_dm_entendido == false` → a tela mostra o aviso com "Entendi" e grava com
  `POST /api/dm/entendi`. O servidor **não** bloqueia a DM sem o "Entendi" (o aviso é da tela).

## 5. Mural

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/mural?canal=` | — | `{"avisos": [{"id", "texto", "nome", "usuario", "em", "meu": bool}], "v": n}` |
| `POST /api/mural/fixar` | `{"canal", "texto"}` (até 280) | `{"avisos": [...], "v": n}` |
| `POST /api/mural/tirar` | `{"id"}` | `{"avisos": [...], "v": n}` do canal do aviso |

- Canal do mural: `"geral"` ou `"sala:<chave>"` (Flynn: a recepção mostra o `geral`; no saguão, o mural do prédio).
- Até 10 por canal (11º: 409 `mural_cheio`). Tira: o autor, ou quem `pode_moderar`; os outros, 404 `nao_existe`.

## 6. Status, aceno e bater na porta (Flynn)

- `POST /api/status` `{"status": "disponivel"|"ocupado"|"reuniao"|"ausente", "texto": "<até 40>"}` →
  `{"status", "texto"}`. Fica na conta, por andar (e no saguão), no disco do andar. 1/s com rajada de 3.
- `POST /api/aceno` `{"para": "<usuario ou id opaco>", "tipo": "aceno"|"porta"}` → `{"ok": true}`. `para` precisa
  estar no andar agora (na presença); senão 404 `nao_existe`. Quem está `ocupado` não recebe: 409 `ocupado`. 1 a cada 30 s
  por par (429 `limite`). Para você mesmo: 400 `pedido`. Chega no `/api/ao-vivo` de quem recebe (`acenos`) e no aviso
  da tela (`GET /api/avisos`, fora do saguão); push, nunca: quem recebe está na presença, com o escritório aberto.

## 7. Anexo (E.5; não existe no saguão)

Envio: `POST /api/anexo?andar=&canal=` com o corpo cru (o arquivo inteiro, `Content-Type: application/octet-stream`).
- `Content-Length` obrigatório, de 1 B a 25 MiB (26.214.400). Sem ele, ou chunked: 411 `tamanho`.
- `X-Nome`: o nome do arquivo em **UTF-8 percent-encoded** (`encodeURIComponent`), até 120 caracteres depois de
  decodificado, sem `/ \ :` nem controles. `X-Texto` (opcional): um texto junto, também percent-encoded, até 500.
- Resposta: `{"mensagem": <mensagem>}` (com `anexo`). O `nome` pode ganhar a extensão certa no fim (`x.html` que é
  PNG vira `x.html.png`).
- Erros (todos com `{erro, mensagem}`): `413 grande` (passou de 25 MiB), `411 tamanho`, `415 tipo` (tipo fora da lista,
  SVG, HTML, XML, executável, ZIP recusado, documento com macro), `429 limite` (10 por minuto por pessoa, 1 envio por vez
  por pessoa, 4 no servidor), `507 cota` (a cota de 5 GB da empresa), `507 disco` (o disco do prédio está no piso),
  `408 prazo` (passou de 120 s), `400 pedido`, `404 nao_existe` (DM que não é sua), `409 outro_saiu`.
- Aceitos: PNG, JPEG, WEBP, GIF (sem EXIF/GPS e sem nada depois do fim), PDF, TXT e CSV (UTF-8), DOCX, XLSX, PPTX
  (sem macro) e ZIP (validado só pelos metadados, nunca extraído).

Download: `GET /api/anexo?andar=&id=<anexo.id>[&baixar=1]`
- Sempre `Content-Disposition: attachment; filename*=UTF-8''…`, menos imagem sem `baixar=1` (vai `inline`, para o
  `<img src>`). O botão "baixar" da imagem usa `&baixar=1`.
- `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  `Cache-Control: private, no-store`. Sem Range. Anexo que não existe ou de DM alheia: 404 `nao_existe`.
- 4 downloads (`baixar=1`) ao mesmo tempo por pessoa (o 5º: 429 `limite`); a prévia inline conta à parte, até 12. O
  `<img>` tenta de novo uma vez no erro.
- Na tela de auditoria, o anexo da DM baixa com `&auditoria=1` e o cabeçalho do painel (item 8): só o admin **deste**
  andar (os outros: 404 de andar), e cada download entra no registro como uma leitura (`quantas: 1`). Por isso a
  auditoria mostra só o "Baixar", sem `<img>` automático.

## 8. Auditoria de DM (E.3; só o admin **deste** andar; não existe no saguão)

| Rota | Resposta |
|---|---|
| `GET /api/dm/auditoria/pares` | `{"pares": [{"canal": "dm:4", "u1", "u2", "mensagens": n, "ultima": iso}], "lembrete": "<texto>"}` |
| `GET /api/dm/auditoria?canal=dm:4&antes=&limite=50` | `{"mensagens": [...], "mais": bool, "lembrete": "<texto>"}` |
| `GET /api/dm/auditoria/registro` | `{"registro": [{"canal", "admin", "u1", "u2", "quando", "quantas"}]}` |

- Leitura por `canal=dm:<n>` (o que vem em `pares`). `u1`/`u2` são logins (`null` = ex-membro); os nomes saem do
  `GET /api/pessoas`.
- `lembrete`: "O acesso a esta conversa fica registrado e as duas pessoas veem a data." — mostre ao abrir.
- Pares e leitura: só quem tem papel `admin` no andar. Membro: 403 `papel`. Admin de outro andar e admin do prédio sem
  papel admin no andar: 404. Ler não marca como lida e grava o registro (sem texto). 1 leitura por segundo (429).
- **Toda rota da auditoria** (as três acima e o anexo com `&auditoria=1`) manda o cabeçalho `X-Escritorio: 1` (no
  `fetch`; o `<img src>` da mesma origem já vai com `Sec-Fetch-Site: same-origin`, que também vale). Sem nenhum dos
  dois: 403 `origem` ("Abra pelo painel do escritório.") e nada é registrado.
- Registro: os admins do andar e o admin do prédio.

## 9. Push (E.4) e `GET /api/avisos`

- O `GET /api/avisos` (sem `?andar`) passa a devolver também os avisos pessoais (menção, DM, aceno), o mais recente de
  todos:
  ```
  {"aviso": {"tipo": "mencao"|"dm"|"aceno"|"porta"|"pediu_aprovacao"|"pediu_resposta", "quando": <epoch s>,
             "titulo": "Ana · #geral", "corpo": "começo da mensagem…", "andar": "<id>", "canal": "geral"}}
  ```
  Os de agente continuam com os campos de hoje (`agente`, `nome`, `tipo`, `quando`) **sem** `titulo`/`corpo`.
- `titulo` e `corpo` já vêm prontos e limpos (texto puro, até 60 caracteres com "…", sem quebra, controle nem bidi):
  - menção: `"Ana · #geral"` / `"Ana · #cozinha"`; DM: `"Ana · mensagem direta"`; com o nome da empresa no fim
    (`" · Marketing"`) para quem está em mais de uma; aceno: `"Ana acenou para você"`, porta: `"Ana bateu na porta"`.
  - anexo: corpo `"Ana enviou um arquivo"` (sem o nome do arquivo). Mensagem apagada antes do GET: corpo genérico
    `"Ana te mandou uma mensagem"`. Rajada: `"Ana e mais 3 mensagens"`.
  - `corpo` sai `""` quando a conta desligou "mostrar o começo".
- Preferência "Mostrar o começo da mensagem no aviso" (padrão ligado): no `POST /api/perfil {"avisos": {...}}` de
  hoje, campo opcional `"comeco": false`; o `GET /api/perfil` devolve `avisos.comeco` (ausente = `true`).
- Não há push: com status `ocupado` no andar, com a pessoa com o escritório aberto (na presença), pelo "Não perturbe",
  para quem não tem papel no andar e no saguão. O aviso fica 5 min na memória (até 20 por conta), nunca no disco.
