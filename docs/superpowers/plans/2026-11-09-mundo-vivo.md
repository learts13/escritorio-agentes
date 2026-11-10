# Mundo vivo — plano de implementação

> **Para quem executa (agente):** use a sub-skill superpowers:subagent-driven-development (recomendada) ou superpowers:executing-plans para seguir este plano tarefa por tarefa. Os passos usam caixas de seleção (`- [ ]`) para acompanhar o andamento.

**Objetivo:** trocar o bairro de `/mundo.html` por um mundo vivo em pixel art, com os níveis Globo → Brasil → Cidade → Bairro, clima real de 28 cidades, aviões, carros e dia e noite.

**Arquitetura:**
- Uma ferramenta (`ferramentas/montar_mundo.py`) rasteriza contornos do Natural Earth em PNGs de pixel art e grava `static/mundo/mundo.json`.
- O navegador monta os níveis em canvas 2D e desenha a vida por cima.
- O servidor ganha uma rota pública que devolve o tipo de tempo das 28 cidades, com cache de 15 minutos.

**Tecnologia:**
- Servidor: Python só com a biblioteca padrão.
- Ferramentas: Python com Pillow, como `montar_tema.py`.
- Navegador: JS puro com canvas 2D.
- Testes: `unittest` e scripts Node (`node test_*.js`).

**Especificação:** `docs/superpowers/specs/2026-11-09-mundo-vivo-design.md`

## Restrições globais
- Nenhuma dependência no navegador nem no servidor. As páginas seguem com `script-src 'self'`, e nada externo carrega no navegador.
- Pillow só nas ferramentas de montagem, nunca no servidor.
- `/mundo.html` continua pública, sem cookie e sem dados do agentes.chat.
- A rota de clima devolve só `tipo` (de `TIPOS_CLIMA`), `vento` (0..1) e `noite` (bool) por cidade, sem temperatura, coordenadas ou IP.
- Cada página tem uma só versão `?v=` nas referências (teste `Estaticos`). Depois de mudar JS ou CSS, suba o `?v=`.
- PixelLab: só a assinatura e nunca o crédito avulso. Amostra aprovada pelo Helbert antes do lote. Pedido: "pixel art, <descrição>", vista de cima, alto detalhe.
- Commit, push, merge e deploy só com ordem expressa do Helbert. Branch `mundo-vivo` a partir de `integracao`.
- Testes do servidor: `python -B -I -m unittest discover -p "test_*.py"`. Testes JS: `node <arquivo>`.

## Ajustes à especificação decididos aqui
- A rota é `POST /api/mundo/clima` com corpo vazio, igual a `/api/visitas/recepcao`. Assim ela reaproveita `salas.limitar_origem(..., publica=True)` e o bloco de rotas públicas.
- `montar_mundo.py` usa Pillow, seguindo o padrão de `montar_tema.py`. O preenchimento de polígono continua escrito no script, para dar pixel exato e teste determinístico.

## Pontos de atenção na revisão
1. **Open-Meteo fora do ar ou devolvendo menos cidades que as 28.** A página mostra "limpo" nas cidades que faltam e não quebra. Teste em `test_mundo_clima.py` (Tarefa 3).
2. **Celular fraco ou aba em segundo plano.** A animação pausa com `document.hidden`, e com `prefers-reduced-motion` o globo não gira e não há partículas. Teste em `test_mundo_navegacao.js` (Tarefa 4).
3. **Fragmento inválido no endereço** (`#cidade=xyz` ou um convite colado). A página cai no nível Brasil, e o convite continua indo só para a porta do chalé, como hoje. Teste em `test_mundo_navegacao.js` (Tarefa 4).
4. **Instalação sem cidade configurada.** Não aparece chalé com placa e o mapa funciona normal. Teste em `test_mundo_clima.py` (Tarefa 3).
5. **Zoom e arraste fora dos limites,** como pinça exagerada ou arrastar até o mar. A câmera fica presa à caixa do nível. Teste em `test_mundo_navegacao.js` (Tarefa 4).

---

### Tarefa 1: Dados das cidades e contornos

**Arquivos:**
- Criar: `arte/mundo/cidades.json`, `arte/mundo/fontes/LICENCA.md`
- Criar (baixar, com OK do Helbert): `arte/mundo/fontes/ne_110m_admin_0_countries.geojson` e `arte/mundo/fontes/ne_50m_admin_1_states_provinces_lakes.geojson`, filtrado para `adm0_a3 == "BRA"`.
- Teste: `test_montar_mundo.py`

**Interfaces:**
- Produz: `cidades.json` = lista de `{"id", "nome", "uf", "lat", "lon", "marco"}`, em que `marco` é o nome da arte ou `null`.

- [ ] **Passo 1:** escrever `test_cidades_validas` em `test_montar_mundo.py`. Ele confere:
  - 28 itens, com `id` único em `[a-z-]+`;
  - `lat` entre -34 e 6 e `lon` entre -74 e -34;
  - todas as 27 UFs presentes, e `mateus-leme` com `uf == "MG"`;
  - `marco` não nulo em exatamente 10 cidades: `rio-de-janeiro`, `belo-horizonte`, `sao-paulo`, `brasilia`, `salvador`, `manaus`, `belem`, `florianopolis`, `porto-alegre` e `mateus-leme`.
- [ ] **Passo 2:** rodar `python -B -I -m unittest discover -p "test_montar_mundo.py"`. Resultado esperado: FALHA, porque o arquivo ainda não existe.
- [ ] **Passo 3:** criar `cidades.json` com estas coordenadas (lat, lon):
  - rio-branco AC -9.97,-67.81; maceio AL -9.67,-35.74; macapa AP 0.03,-51.07; manaus AM -3.12,-60.02;
  - salvador BA -12.97,-38.50; fortaleza CE -3.73,-38.53; brasilia DF -15.79,-47.88; vitoria ES -20.32,-40.34;
  - goiania GO -16.69,-49.26; sao-luis MA -2.53,-44.30; cuiaba MT -15.60,-56.10; campo-grande MS -20.47,-54.62;
  - belo-horizonte MG -19.92,-43.94; belem PA -1.46,-48.50; joao-pessoa PB -7.12,-34.86; curitiba PR -25.43,-49.27;
  - recife PE -8.05,-34.88; teresina PI -5.09,-42.80; rio-de-janeiro RJ -22.91,-43.17; natal RN -5.79,-35.21;
  - porto-alegre RS -30.03,-51.23; porto-velho RO -8.76,-63.90; boa-vista RR 2.82,-60.67; florianopolis SC -27.59,-48.55;
  - sao-paulo SP -23.55,-46.63; aracaju SE -10.91,-37.07; palmas TO -10.18,-48.33; mateus-leme MG -19.98,-44.43.

  Marcos: `cristo`, `pampulha`, `paulista`, `congresso`, `pelourinho`, `teatro-amazonas`, `ver-o-peso`, `hercilio-luz`, `mercado-publico` e `matriz-mateus-leme`.
- [ ] **Passo 4:** com o OK do Helbert, baixar os dois GeoJSON do repositório oficial do Natural Earth (domínio público) para `arte/mundo/fontes/`. Registrar a origem e a licença em `LICENCA.md`.
- [ ] **Passo 5:** rodar o teste. Resultado esperado: PASSA.
- [ ] **Passo 6:** fazer o commit (`Mundo: cidades e contornos do Natural Earth`).

### Tarefa 2: Ferramenta de montagem

**Arquivos:**
- Criar: `ferramentas/montar_mundo.py`
- Criar (gerados e versionados): `static/mundo/terra.png`, `static/mundo/brasil.png`, `static/mundo/mundo.json`
- Teste: `test_montar_mundo.py`

**Interfaces:**
- Consome: a Tarefa 1.
- Produz:
  - `preencher(poligono: list[tuple[float, float]], w: int, h: int) -> set[tuple[int, int]]`, com varredura par-ímpar e o pixel marcado pelo centro;
  - `para_pixel(lat: float, lon: float, caixa: tuple[float, float, float, float], w: int, h: int) -> tuple[int, int]`, com `caixa = (lon_min, lat_min, lon_max, lat_max)`;
  - `montar(fontes: str, saida: str) -> dict`, que devolve o `mundo.json`.
- Constantes:
  - `CAIXA_BRASIL = (-74.0, -34.0, -34.0, 6.0)` com `brasil.png` de 400×400;
  - `terra.png` de 360×180 (1° por pixel);
  - `PALETA = {"mar": "#1d3b5c", "mar_raso": "#2a5a7c", "terra": "#5a8a3c", "terra_alta": "#7a9a4a", "serra": "#8a7a5a", "borda_uf": "#3e5e2a", "rio": "#3a7ab0"}`.
- `mundo.json`:
  - `{"versao": int, "cidades": [{"id", "nome", "uf", "lat", "lon", "x", "y", "marco"}], "rotas": [[id_a, id_b], ...], "niveis": {"brasil": {"w": 400, "h": 400, "caixa": [...]}}}`;
  - as rotas ligam pares de capitais a menos de 1.500 km, até 40 rotas;
  - `x` e `y` são pixels de `brasil.png`.

- [ ] **Passo 1:** escrever os testes:
  - `test_preencher_quadrado`: o quadrado (1,1)-(4,4) em 6×6 marca 9 pixels, de (1,1) a (3,3);
  - `test_preencher_concavo`: um "U" deixa vazio o pixel do meio da abertura;
  - `test_para_pixel`: `(-19.92, -43.94)` → `(300, 259)` em 400×400 com `CAIXA_BRASIL`;
  - `test_deterministico`: duas montagens dão o mesmo sha256 em `brasil.png`;
  - `test_rotas`: no máximo 40 rotas, sem rota de uma cidade para ela mesma.
- [ ] **Passo 2:** rodar os testes. Resultado esperado: FALHA (módulo ausente).
- [ ] **Passo 3:** implementar.
  - O relevo vem de 3 faixas por distância à costa (0–3, 4–20 e 21+ pixels), com `serra` nas UFs MG, ES, RJ, SP, PR, SC e RS a partir de 21 pixels.
  - A borda de UF é o pixel cujo vizinho pertence a outra UF.
  - Os rios ficam para depois: o Natural Earth 110m não traz rios, então eles não entram agora (YAGNI).
- [ ] **Passo 4:** rodar `python ferramentas/montar_mundo.py` e depois os testes. Resultado esperado: PASSA, e os três arquivos gerados.
- [ ] **Passo 5:** olhar `brasil.png` ampliado 3× e conferir que o contorno e as UFs estão certos.
- [ ] **Passo 6:** fazer o commit.

### Tarefa 3: Rota de clima das cidades

**Arquivos:**
- Modificar: `escritorio.py`:
  - classe nova `ClimaMundo(threading.Thread)` perto de `class Clima` (linha ~1478);
  - a rota no bloco público ao lado de `/api/visitas/recepcao` (linha ~2471);
  - `PUBLICOS` (linha ~2082) recebe os arquivos novos.
- Teste: `test_mundo_clima.py`

**Interfaces:**
- Consome: `static/mundo/mundo.json` (`id`, `lat` e `lon` de cada cidade), `tipo_do_clima(codigo, nuvens)` e `clima_vigente()`.
- Produz:
  - `ClimaMundo.foto() -> dict[str, dict]` (`{id: {"tipo", "vento", "noite"}}`);
  - `cidade_do_escritorio(clima: dict | None, cidades: list) -> str | None`: devolve a cidade mais próxima das coordenadas configuradas, ou `None` se a configuração não tiver coordenadas;
  - a resposta da rota: `{"cidades": {...}, "casa": id | None, "versao": int}`.
- Valores: `A_CADA = 900`. Uma única consulta ao Open-Meteo, com `latitude=a,b,...&longitude=...&current=weather_code,is_day,cloud_cover,wind_speed_10m`. `vento = min(1, wind_speed_10m / 50)`.

- [ ] **Passo 1:** escrever os testes, com `_consultar` substituído por um falso:
  - `test_resposta_so_campos_fechados`: chaves exatas e `tipo in TIPOS_CLIMA`;
  - `test_cache_15_min`: duas chamadas em menos de 900 s fazem uma consulta só;
  - `test_falha_usa_ultimo_bom` e `test_falha_sem_historico_e_limpo`;
  - `test_cidade_faltando_vira_limpo` (o Open-Meteo devolve 27 de 28);
  - `test_sem_cidade_configurada_casa_none`;
  - `test_log_sem_ip_nem_cidade`;
  - `test_rota_publica_sem_cookie`: `POST /api/mundo/clima` dá 200 sem sessão e 400 com corpo não vazio.
- [ ] **Passo 2:** rodar os testes. Resultado esperado: FALHA.
- [ ] **Passo 3:** implementar.
  - A thread nasce junto com `Clima` no `main`.
  - Se `mundo.json` estiver ausente, a rota devolve `{"cidades": {}, "casa": null}`.
  - Acrescentar a `PUBLICOS`: `mundo/terra.png`, `mundo/brasil.png`, `mundo/mundo.json`, `mundo/atlas.png`, `mundo/atlas.json`, `mundo_globo.js`, `mundo_mapa.js`, `mundo_cidade.js` e `mundo_bairro.js`.
- [ ] **Passo 4:** rodar os testes novos e a suíte inteira. Resultado esperado: PASSA, com os 411 testes anteriores mais os novos.
- [ ] **Passo 5:** fazer o commit.

### Tarefa 4: Orquestrador e nível Brasil

**Arquivos:**
- Criar:
  - `static/mundo_bairro.js`: o conteúdo de desenho do `mundo.js` atual, com a mesma API `criar(canvas, destino)`;
  - `static/mundo_mapa.js`.
- Modificar: `static/mundo.js` (passa a orquestrar), `static/mundo.html` (scripts e `?v=` iguais), `test_visita_mundo.js` (passa a carregar `mundo_bairro.js`).
- Teste: `test_mundo_navegacao.js` e `test_visita_mundo.js` (que já existe e deve continuar passando).

**Interfaces:**
- Consome: `mundo.json` da Tarefa 2, a resposta da Tarefa 3, `Ceu.agora()` e `Clima.desenhar(ctx, opcoes, dt, t, som)`.
- Produz:
  - cada nível é `{entrar(params), sair(), quadro(ctx, dt, t), clique(x, y) -> acao | null, camera}`;
  - as ações são `{"ir": "globo" | "brasil" | "cidade" | "bairro", "cidade"?: id}`;
  - `Mundo.ir(nivel, params)` atualiza `location.hash` (`#brasil`, `#cidade=<id>`, `#bairro`);
  - o convite no fragmento continua sendo tratado como hoje, e é removido da barra pelo nível bairro;
  - `Camera.limitar(caixa)` prende o arraste e o zoom (de 1× a 4× dentro do nível).
- No nível Brasil:
  - desenha `brasil.png`;
  - as cidades como pontos ou ícones, e a da `casa` com placa;
  - nuvens e precipitação por cidade, conforme `tipo`;
  - uma camada de noite (`Ceu.agora().escuro`) com luzes nas cidades;
  - até 6 aviões ao mesmo tempo, percorrendo `rotas`.

- [ ] **Passo 1:** escrever os testes em `test_mundo_navegacao.js`, com o mesmo arnês de VM de `test_visita_mundo.js`:
  - `#cidade=xyz` cai em `brasil`;
  - Esc no bairro sobe para cidade e Esc na cidade sobe para brasil;
  - um clique numa cidade leva a `#cidade=<id>`;
  - a câmera não sai da caixa com 50 arrastes para o mesmo lado;
  - com `document.hidden = true` nenhum quadro novo é pedido;
  - com `matchMedia("(prefers-reduced-motion: reduce)").matches = true` não há aviões nem partículas;
  - uma resposta de clima vazia não quebra o quadro.
- [ ] **Passo 2:** rodar `node test_mundo_navegacao.js`. Resultado esperado: FALHA.
- [ ] **Passo 3:** mover o bairro para `mundo_bairro.js` sem mudar o comportamento. Rodar `node test_visita_mundo.js`. Resultado esperado: PASSA.
- [ ] **Passo 4:** implementar o orquestrador e o nível Brasil. Enquanto a Tarefa 6 não chega, o nível Cidade é um placeholder com o bairro.
- [ ] **Passo 5:** rodar os testes JS e a suíte Python (`Estaticos`). Resultado esperado: PASSA.
- [ ] **Passo 6:** no navegador real (`python ferramentas/previa.py`, abrindo `/mundo.html`), fazer capturas do Brasil de dia, de noite (`?hora=22`), com chuva e com neve (`?clima=`), no desktop e no celular. Medir os quadros por segundo (acima de 50 no desktop).
- [ ] **Passo 7:** fazer o commit.

### Tarefa 5: Globo de abertura

**Arquivos:**
- Criar: `static/mundo_globo.js`
- Modificar: `static/mundo.js` (o nível inicial passa a ser `globo` quando não há fragmento), `static/mundo.html`
- Teste: `test_mundo_globo.js`

**Interfaces:**
- Produz:
  - `Globo.projetar(lat, lon, lon0, lat0, raio) -> {x, y, visivel}` (ortográfica);
  - `Globo.terminador(dataUTC) -> {latSol, lonSol}`;
  - o nível segue o contrato da Tarefa 4.
- Valores:
  - buffer de 160×160 com raio de 72;
  - rotação de 6° por segundo;
  - centro inicial em lat −15, lon −50;
  - um clique ou zoom sobre o Brasil emite `{"ir": "brasil"}`.

- [ ] **Passo 1:** escrever os testes:
  - `projetar(-15, -50, -50, -15, 72)` dá o centro (80, 80) e é visível;
  - um ponto do lado oposto dá `visivel = false`;
  - `terminador` em 21/06 às 12:00 UTC dá `latSol ≈ 23.4` (±0.5) e `lonSol ≈ 0` (±2);
  - em 21/12 às 18:00 UTC dá `latSol ≈ −23.4` e `lonSol ≈ −90`.
- [ ] **Passo 2:** rodar os testes. Resultado esperado: FALHA.
- [ ] **Passo 3:** implementar.
  - Desenha pixel a pixel no buffer, buscando a cor em `terra.png` (um `ImageData` lido uma vez).
  - O lado noturno é escurecido em 3 faixas, com luzes nas cidades de `mundo.json`.
  - Uma camada de nuvens procedural gira um pouco mais rápido.
  - A lua é um sprite simples feito por código.
- [ ] **Passo 4:** rodar os testes JS e conferir no navegador real o giro, a transição para o Brasil e a medida de quadros por segundo no celular.
- [ ] **Passo 5:** fazer o commit.

### Tarefa 6: Arte do PixelLab e nível Cidade

**Arquivos:**
- Criar:
  - `arte/pixellab/mundo/*.png`;
  - `static/mundo_cidade.js`;
  - `static/mundo/atlas.png` e `static/mundo/atlas.json` (gerados pela `montar_mundo.py`, que ganha `montar_atlas()`).
- Modificar: `ferramentas/montar_mundo.py`, `static/mundo.js`
- Teste: `test_montar_mundo.py` e `test_mundo_navegacao.js`

**Interfaces:**
- Produz:
  - `atlas.json` = `{"versao", "quadros": {nome: [x, y, w, h]}}`, com os nomes `marco-<id>`, `predios-1`, `predios-2`, `chale-1..4`, `aviao-1..2`, `carro-1..4` e `arvore-1..3`;
  - o nível Cidade segue o contrato da Tarefa 4.
- O nível Cidade:
  - quadras e estradas por código, a partir de uma semente com o `id` da cidade;
  - marco ao centro, ou `predios-1`/`predios-2` quando a cidade não tem marco;
  - de 6 a 10 chalés decorativos, e o chalé da `casa` com placa e porta que emite `{"ir": "bairro"}`;
  - carros nas estradas;
  - o clima da cidade com `Clima.desenhar`.

- [ ] **Passo 1:** gerar a amostra (`marco-pampulha`, `chale-1` e `aviao-1`), mostrar ao Helbert e **parar até a aprovação do estilo**.
- [ ] **Passo 2:** com a aprovação, gerar o lote. Conferir o sentido dos carros e aviões e anotar o contador de gerações. Parar e avisar se passar de 100.
- [ ] **Passo 3:** escrever os testes:
  - `test_atlas_sem_marco_usa_generico`;
  - `test_atlas_deterministico`;
  - no JS, o clique na porta da `casa` leva a `#bairro` e uma cidade sem marco desenha os prédios sem erro.
- [ ] **Passo 4:** implementar `montar_atlas()` e `mundo_cidade.js`. Rodar a montagem e os testes. Resultado esperado: PASSA.
- [ ] **Passo 5:** no navegador real, fazer capturas de 3 cidades (com marco, sem marco e a casa) de dia, de noite, com chuva e com neve.
- [ ] **Passo 6:** fazer o commit.

### Tarefa 7: Documentação e fechamento

**Arquivos:**
- Modificar: `README.pt-BR.md` (seção do mundo), `docs/visitas-privadas-plano.md` (seção "Evolução para mundo de escritórios") e `CHANGELOG.pt-BR.md`.

- [ ] **Passo 1:** documentar:
  - os níveis;
  - a rota `/api/mundo/clima` e o que ela não guarda;
  - como rodar `montar_mundo.py`;
  - como uma instalação escolhe a cidade.
- [ ] **Passo 2:** rodar a suíte inteira (Python e todos os `node test_*.js`). Resultado esperado: tudo OK.
- [ ] **Passo 3:** fazer o commit e abrir um PR `mundo-vivo` → `integracao`, só com ordem do Helbert.
