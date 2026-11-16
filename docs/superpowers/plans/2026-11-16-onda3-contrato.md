# Contrato da Onda 3 (1.6): back (Neo) ↔ reuniões (Tron) e mapa (Flynn)

Dono: Neo (floor onda3-back). Só o Neo muda este arquivo, e só avisando o Maestro.
Base: andares @ 5f40d85. Vale o plano 2026-11-15-escritorio-da-equipe.md (B4, ONDA 3 reemitida, D9 a: link externo
fixo por sala + agenda; WebRTC fica para depois) e o contrato da Onda 2 (regras comuns, erros, `?andar=`, store ligado).

## 0. Regras comuns

- Tudo o que a Onda 2 diz no item 0 vale aqui: `?andar=` em toda rota (andar alheio ou inexistente = o 404 de andar),
  POST com `Origin` igual à BASE (403 `origem`), `Content-Type: application/json` (415 `formato`), JSON com as chaves
  exatas (400 `pedido`), erros `{"erro", "mensagem"}`, store desligado = 404 `desligado` e nenhum campo novo.
- **Nada disto existe no saguão** (agenda, link, convocação, status automático): os GET dão o 404 de andar; os POST dão
  o 403 `papel` da guarda (e, para o admin do prédio, o 404 de andar), como a DM na Onda 2. No saguão,
  `config.equipe.reunioes` sai `null` e o `/api/ao-vivo` não ganha os campos desta onda.
- **Sala** (`sala`): a chave do mapa **sem** o prefixo `sala:`, a mesma do `sala` da presença: `recepcao`, `reuniao`,
  `cozinha`, `lounge` ou `time:<nome>` (só as salas do mapa do andar; o corredor `""` não vale). Fora disso: 400 `pedido`.
- **Escrever exige papel no andar**: o admin do prédio sem papel no andar de uma empresa lê a agenda e os links, mas
  marcar, editar, cancelar, gravar link e convocar dão 403 `papel` (o `pode_escrever` da Onda 2 continua valendo).
- Horários em **epoch em segundos (UTC, inteiro)**; a tela converte para a hora local. Duração em **minutos**.
- Estáticos novos liberados no `ARQUIVOS` do servidor: `reunioes.js`, `reunioes.css` (Tron) e `apresentacao.js`
  (Flynn). Sem isso eles dão 404.

## 1. Config (`GET /api/config?andar=`)

Campo novo dentro de `equipe` (`null` no saguão e com o store desligado):
```
"reunioes": {"hosts": ["meet.google.com", "*.zoom.us", "meet.jit.si", "teams.microsoft.com", "whereby.com"],
             "pode_marcar": true, "pode_link": false, "pode_convocar": false,
             "duracao_min": 5, "duracao_max": 480, "titulo_max": 80, "convidados_max": 50, "aviso_min": 5}
```
- `hosts`: a lista que o servidor aceita, na ordem acima, mais o Jitsi próprio (`ESCRITORIO_JITSI`, um host exato, ex.
  `jitsi.minhaempresa.com.br`) no fim quando a instalação configurar. `*.zoom.us` = `zoom.us` e qualquer subdomínio
  (`us02web.zoom.us`). Os outros são o host exato. A tela valida igual (abaixo), mas quem decide é o servidor.
- `pode_marcar`: `false` só para o admin do prédio sem papel no andar. `pode_link` e `pode_convocar`: só quem tem
  papel `admin` **neste** andar.

## 2. Link fixo por sala

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/reunioes/links` | — | `{"links": {"reuniao": "https://meet.google.com/abc-defg-hij", ...}}` (só as salas com link) |
| `POST /api/reunioes/link` | `{"sala", "url"}` (`url: ""` tira o link) | `{"links": {...}}` (todos, depois da mudança) |

- Ler: todo mundo com papel no andar (e o admin do prédio). Gravar: só o admin **deste** andar; membro e admin do prédio
  sem papel: 403 `papel`.
- URL aceita (senão 400 `link` "Use um link https de Meet, Zoom, Jitsi, Teams ou Whereby, sem senha no endereço."):
  `https://` apenas; host (minúsculo) na lista de `hosts`; **sem** usuário/senha (`@` no host), sem porta, até 500
  caracteres, só ASCII visível (sem espaço, `\`, `"`, `<`, `>`, `` ` ``, `{`, `}`, `|`, `^`). A senha **no caminho ou na
  query** (ex. `?pwd=` do Zoom) é do serviço e é aceita: quem tem papel no andar vê o link.
- O botão "Entrar na reunião" abre em aba nova com `rel="noopener noreferrer"`; CSP e Permissions-Policy não mudam.

## 3. Agenda (B4)

| Rota | Corpo | Resposta |
|---|---|---|
| `GET /api/reunioes?de=<epoch>&dias=7` | — | `{"reunioes": [<reunião>, ...], "v": n}` (as que cruzam `[de, de + dias)`, por `inicio`) |
| `POST /api/reunioes/marcar` | `{"titulo", "sala", "inicio", "duracao", "convidados"}` | `{"reuniao": <reunião>}` |
| `POST /api/reunioes/editar` | `{"id", "titulo", "sala", "inicio", "duracao", "convidados"}` | `{"reuniao": <reunião>}` |
| `POST /api/reunioes/cancelar` | `{"id"}` | `{"ok": true}` |
| `GET /api/reunioes/ics?id=<id>` | — | o arquivo `.ics` (abaixo) |

Reunião:
```
{"id": 12, "titulo": "Planejamento", "sala": "reuniao", "inicio": 1763301600, "duracao": 30, "fim": 1763303400,
 "usuario": "ana" | null, "nome": "Ana" | "ex-membro", "convidados": [{"usuario": "bia", "nome": "Bia"}],
 "meu": true, "pode_mudar": true, "link": "https://meet.google.com/..." | null, "agora": false}
```
- `de` ausente = agora; `dias` de 1 a 31 (padrão 7). `v` muda a cada marcar, editar ou cancelar (o mesmo do `reunioes_v`
  do `/api/ao-vivo`). `link`: o link fixo da sala, se houver. `agora`: `inicio <= agora < fim`.
- `titulo`: 1 a 80 caracteres, sem controle nem símbolo invisível. `duracao`: 5 a 480. `inicio`: inteiro, de agora
  (tolerância de 60 s) até 1 ano à frente. `convidados`: lista de logins **com papel no andar**, até 50, sem repetir
  (quem marca não precisa estar; vale como convidado de qualquer jeito). Login de fora do andar ou inexistente: 400
  `convidado` "Só dá para convidar quem é do andar." (a mesma resposta para os dois).
- Sala ocupada no mesmo horário (outra reunião cruzando): 409 `sala_ocupada` "Já tem reunião nessa sala nesse horário."
- Editar e cancelar: quem marcou ou o admin **deste** andar; os outros (e reunião que não existe ou já saiu): 404
  `nao_existe`. Mudar o `inicio` rearma o aviso de 5 min.
- Até 500 reuniões futuras por andar (409 `agenda_cheia`). Marcar/editar/cancelar: 2/s com rajada de 5 por pessoa (429); gravar link, igual.
- A agenda segue a retenção do andar: reunião que terminou antes do prazo sai na varredura diária. Conta que sai do
  andar: some dos convidados; as que ela marcou ficam como "ex-membro" (só o admin muda).
- `.ics`: `Content-Type: text/calendar; charset=utf-8`, sempre `Content-Disposition: attachment; filename="reuniao.ics"`,
  `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: private, no-store`. Um VEVENT
  com UID, DTSTART/DTEND em UTC, SUMMARY (título), LOCATION (nome da sala), URL (o link, se houver) e DESCRIPTION
  (convidados que ainda são do andar + link). Gerado pelo servidor só com dados deste andar. Use `<a href download>`
  (a mesma origem leva o cookie).

## 4. Aviso 5 min antes (push pessoal da Onda 2)

- Entre 5 min e o início, o servidor manda um aviso pessoal a quem marcou e a cada convidado que ainda tem papel no
  andar (uma vez por reunião; mudar o horário rearma). Vale o de sempre: o "Não perturbe" e o papel seguram o push; o
  `ocupado` e o escritório aberto também (fica só a tela). Reunião cancelada antes do GET: o aviso some.
- `GET /api/avisos` ganha dois tipos:
  ```
  {"tipo": "reuniao", "titulo": "Reunião em 5 min · Planejamento", "corpo": "Sala de reunião", "andar": "<id>",
   "canal": null, "sala": "reuniao", "reuniao": 12, "quando": <epoch s>}
  {"tipo": "convocacao", "titulo": "Beto chamou a equipe", "corpo": "Reunião geral agora · Sala de reunião",
   "andar": "<id>", "canal": null, "sala": "reuniao", "quando": <epoch s>}
  ```
  Com "mostrar o começo" desligado: título `"Reunião em 5 min"` e corpo `""` (a convocação mantém o título e perde o
  corpo). Nomes das salas: Recepção, Sala de reunião, Cozinha, Lounge e o nome do time. Mais de uma empresa: `" · <empresa>"`
  no fim do título, como na Onda 2.

## 5. Reunião geral (convocação)

`POST /api/reunioes/convocar` `{"sala"}` → `{"ok": true, "seq": n}`.
- Só o admin **deste** andar (membro e admin do prédio sem papel: 403 `papel`). 1 por minuto por andar (429 `limite`).
- Vai um aviso pessoal (`convocacao`) a cada conta com papel no andar, menos quem convocou (mesmas regras de push).
- No `/api/ao-vivo` de todo mundo no andar: `"convocacao": {"sala": "reuniao", "de": "beto", "nome": "Beto", "seq": 812}`
  enquanto `seq > desde` e por até 2 min. O mapa leva o boneco até a sala (quem convocou também recebe; a tela decide).

## 6. `/api/ao-vivo` (só fora do saguão, store ligado)

```
"pessoas": [{..., "status": "reuniao", "status_texto": "", "status_auto": true}],
"meu_status": {"status": "disponivel", "texto": "", "em_reuniao": true},
"reunioes_v": 98123,
"convocacao": {"sala", "de", "nome", "seq"}        // só quando há (item 5)
```
- **Status automático**: quem está na sala de uma reunião em andamento (`inicio <= agora < fim`) e **não pôs** status
  (o padrão: disponível sem recado) sai `status: "reuniao"` com `status_auto: true`. Pôs qualquer outro (até
  "disponível" com recado), vale o dele e `status_auto: false`.
- `meu_status` continua sendo o que a pessoa escolheu; `em_reuniao: true` diz que o mapa a mostra "em reunião" agora.
- `reunioes_v`: muda a cada marcar, editar ou cancelar: mudou, a tela relê `GET /api/reunioes` (placa na porta e agenda).

## 7. Correções da reconferência da Onda 2 (Spock)

- `POST /api/aceno` do admin do prédio sem papel no andar de uma empresa: 403 `papel` (como enviar e fixar). O status
  dele lá continua livre.
- `GET /api/anexo`: o teto da prévia (12) vale só para **imagem** sem `&baixar=1`; qualquer outro tipo, com ou sem
  `&baixar=1`, conta no teto de downloads (4).
