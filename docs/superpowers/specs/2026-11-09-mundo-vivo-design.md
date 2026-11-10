# Mundo vivo dos escritórios — desenho

Data: 09/11/2026. Status: aprovado em conversa pelo Helbert e aguardando a revisão desta especificação.

## Objetivo
Trocar o bairro de `/mundo.html` por um mundo vivo em pixel art, com cara de Google Earth e Google Maps:
- um globo girando na abertura;
- ao aproximar, o mapa plano do Brasil com as 27 capitais e Mateus Leme;
- abaixo dele, a cidade e o bairro.

Carros, aviões, dia e noite e o clima real de cada cidade dão a vida. O chalé deste escritório fica na cidade configurada e a porta dele leva à recepção, como hoje.

Sucesso: a página abre leve (inclusive no celular), parece um jogo caprichado, mostra o tempo de verdade de cada cidade e não registra nada de quem visita.

## Decisões tomadas (com o Helbert)
| Tema | Decisão |
|---|---|
| Chalés das outras empresas | **Cenário por enquanto (B).** Só o chalé deste escritório funciona. O diretório real de escritórios fica para outra fase, e o mapa já reserva o lugar para ele. |
| Escala | **Geografia real (A).** Brasil e estados com o contorno de verdade, e as cidades nas coordenadas reais. |
| Vista | **Globo na abertura e mapa plano ao aproximar (B).** |
| Arte | **PixelLab para o que tem personalidade, código para o resto (A).** |
| Cidades | **As 27 capitais e Mateus Leme.** Uns 10 marcos com arte própria; as outras capitais com um perfil de prédios genérico. |
| Tecnologia | **Canvas 2D, sem three.js.** Mantém o projeto sem dependências e com `script-src 'self'`, e o globo sai em pixel art de verdade. |

## Níveis de zoom
1. **Globo.** Uma tela de cerca de 160×160 pixels lógicos, ampliada sem suavização, em projeção ortográfica feita no navegador a partir de um mapa-múndi em pixel art (equiretangular). Gira devagar e mostra:
   - o terminador de dia e noite pela hora real (UTC);
   - as luzes das cidades no lado escuro;
   - nuvens numa camada própria e a lua.

   Clicar no Brasil, ou dar zoom, mergulha no nível 2.
2. **Brasil.** Mapa plano com os estados, o mar, os rios principais e o relevo em faixas. Mostra:
   - as 28 cidades como ícones (marco ou prédios);
   - aviões em rotas entre as capitais;
   - nuvens e precipitação sobre as cidades, conforme o clima real;
   - a noite como uma camada escura com as luzes acesas.

   Arrastar e dar zoom (roda, pinça e botões + e −) é contínuo dentro do nível.
3. **Cidade.** Vista de cima da cidade escolhida: marco, quadras, estradas com carros e chalés decorativos. O chalé deste escritório aparece com placa, na cidade dele. O clima da cidade usa o `Clima.desenhar` que já existe, com chuva, tempestade, raio, neve, neblina e vento.
4. **Bairro.** O `mundo.js` de hoje, que passa a ser o nível final: a porta do chalé leva à recepção ou à visita, e o cachorro e os pássaros continuam como são.

A navegação entre níveis tem transição de zoom com pixel art nítido em todos os passos. Um botão "voltar" e a tecla Esc sobem um nível. O endereço guarda o nível e a cidade (`#brasil`, `#cidade=bh`), para que o link leve direto a esse ponto.

## Arquitetura (caminho 1: mapa pré-montado e vida no navegador)
### Ferramenta de montagem (`ferramentas/montar_mundo.py`, só biblioteca padrão)
- **Entrada:**
  - contornos de domínio público do Natural Earth (países 1:110m e estados do Brasil 1:50m), guardados em `arte/mundo/fontes/` com a licença;
  - `arte/mundo/cidades.json`, com nome, UF, latitude, longitude e marco opcional das 28 cidades;
  - as artes do PixelLab em `arte/pixellab/mundo/`.
- **Saída** em `static/mundo/`:
  - `terra.png`, o mapa-múndi equiretangular em pixel art para o globo;
  - `brasil.png`, o mapa base do Brasil;
  - `atlas.png` e `atlas.json` com marcos, chalés, aviões e carros, e um número de `versao` para furar o cache, como em `montar_tema.py`;
  - `mundo.json` com as cidades, as rotas de avião e as caixas de cada nível.
- **Rasterização:** um preenchimento de polígonos por varredura, escrito no script. Mar, terra, estados (borda de 1 pixel), relevo em 3 faixas de cor e rios principais saem numa paleta fixa e pequena. O resultado é determinístico, e o mesmo dado gera sempre o mesmo PNG.
- **Uso:** roda só quando muda arte ou cidade. Os PNG gerados entram no git, e o servidor não precisa do script.

### Navegador (`static/mundo.html`, sem bibliotecas)
- `mundo.js` passa a orquestrar os níveis, a câmera e a entrada. O desenho de cada nível fica num arquivo separado:
  - `mundo_globo.js`
  - `mundo_mapa.js`
  - `mundo_cidade.js`
  - `mundo_bairro.js` (o bairro de hoje)
- Reaproveita `ceu.js`, `clima.js` e `som.js`.
- O globo é desenhado num buffer pequeno, pixel a pixel: para cada pixel, latitude e longitude pela projeção ortográfica e a cor de `terra.png`. Isso cabe com folga a 30 quadros por segundo.
- A vida (aviões, carros, nuvens e precipitação) usa sprites do atlas e passos com tempo fixo, como em `efeitos.js`.
- **Desempenho:**
  - limite de partículas por nível;
  - a animação pausa com a aba escondida;
  - `prefers-reduced-motion` desliga a rotação automática e as partículas.

### Servidor (`escritorio.py`)
- **Rota pública nova:** `GET /api/mundo/clima`, sem cookie. Devolve `{"cidades": {"<id>": {"tipo": ..., "vento": 0..1, "noite": bool}}, "versao": n}`.
  - `tipo` sai de uma lista fechada (limpo, nublado, garoa, chuva, tempestade, neve, neblina).
  - Não devolve temperatura, coordenadas nem a cidade deste escritório além do que já está no `mundo.json` público.
- **Cache:** uma chamada só ao Open-Meteo, com as coordenadas das 28 cidades num pedido, a cada 15 minutos, guardada na memória. Reaproveita `tipo_do_clima`.
  - Se o Open-Meteo falhar, a rota devolve o último valor bom, ou "limpo" para todas as cidades, e registra só o tipo do erro.
- **Limite:** usa o limite por IP que as rotas públicas já têm. Nada de quem visita vai para log nem para o disco.
- **Cidade deste escritório:** vem da configuração de clima que já existe (times.json). O chalé aparece na cidade da lista mais próxima das coordenadas configuradas. Se a configuração não tiver cidade, o chalé fica em Mateus Leme, como na instalação da Dev Maniac's. Em outras instalações, sem cidade, o chalé não aparece.
- **Cabeçalhos:** a CSP e as rotas estáticas ganham `static/mundo/*` na lista do que o servidor serve. O teste `Estaticos` cobre isso.

## Arte no PixelLab
- **Saldo:** só a assinatura, cerca de 300 gerações até 15/11, sem nunca usar o crédito avulso. Parar e avisar se chegar perto do fim.
- **Amostra primeiro:** 1 marco, 1 chalé e 1 avião, para o Helbert aprovar o estilo antes do lote.
- **Lote:** cerca de 10 marcos (Cristo/RJ, Pampulha/BH, Paulista/SP, Congresso/DF, Pelourinho/Salvador, Teatro Amazonas/Manaus, Ver-o-Peso/Belém, Ponte Hercílio Luz/Florianópolis, Mercado Público/Porto Alegre, Igreja Matriz/Mateus Leme), 2 perfis de prédios genéricos, 4 variações de chalé, 2 aviões e 4 carros vistos de cima, e 3 árvores para a escala de cidade. Estimativa: 40 a 80 gerações.
- **Padrão de pedido do projeto:** "pixel art, <descrição>", vista de cima, alto detalhe. Conferir direção e sentido antes de usar; carros e aviões precisam de sentido conhecido para girar no código.
- **O código desenha:** mar, terra, estados, rios, estradas, quadras, nuvens, precipitação, noite, luzes e a lua.

## Privacidade e segurança
- A página continua pública, sem cookie e sem dados do agentes.chat.
- A rota de clima só tem dado público (o tempo de 28 cidades).
- Nenhuma origem externa no navegador. Todas as chamadas ao Open-Meteo saem do servidor.
- Os PNG e o JSON gerados não têm nada da instalação além da lista pública de cidades.

## Testes
- **`test_montar_mundo.py`:**
  - o preenchimento de polígono marca os pixels certos num quadrado e num polígono côncavo;
  - a cidade cai no pixel esperado no `brasil.png`;
  - a montagem é determinística (duas rodadas, mesmo hash);
  - um atlas sem a arte de um marco usa o genérico em vez de quebrar.
- **`test_mundo_clima.py`:**
  - a resposta tem só os campos e tipos da lista fechada;
  - o cache evita uma segunda chamada em menos de 15 minutos;
  - a falha do Open-Meteo devolve o último valor ou "limpo", sem 500;
  - nada de IP nem de cidade no log.
- **`test_mundo_globo.js`** (Node): a projeção ortográfica leva lat/lon conhecidos ao pixel esperado e o terminador bate com a hora UTC em dois horários.
- **`test_mundo_navegacao.js`:** a transição entre níveis, o Esc e o voltar, e o fragmento `#cidade=` abrindo a cidade certa.
- **Navegador real:** capturas de cada nível de dia, de noite, com chuva e com neve, no desktop e no celular, e a medida de quadros por segundo no globo e no Brasil.

## Entregas (cada uma revisada e testada antes da seguinte)
1. Ferramenta de montagem, `brasil.png` e `terra.png` desenhados só por código, e a rota de clima.
2. Mapa do Brasil navegável, com cidades, clima real, noite, aviões e o bairro de hoje como nível final.
3. Globo de abertura, com a transição para o Brasil.
4. Amostra do PixelLab aprovada, o lote de arte e o nível Cidade com marcos, chalés e carros.

## Fora deste desenho
- Diretório real de escritórios de outras empresas (opção A da descoberta).
- Cidades além das 28, e marcos para as outras capitais.
- Conversar ou visitar pelo mapa além da porta do próprio chalé.

## Adendo de 09 e 10/11/2026: o que mudou depois deste desenho

O Helbert pediu ampliações durante a execução. O que vale hoje é o código e o [README](../../../README.pt-BR.md#mundo); este adendo registra as decisões.

- **Canvas 2D, sem three.js.** Confirmado: nenhuma dependência no navegador.
- **Cidade ampliada.** As 28 cidades ganharam ponto turístico. A cidade tem zonas (centro, casas, parque, esporte), porte (`porte` em `cidades.json`), orla nas capitais de praia (`litoral`), chão trabalhado, sombras, pedestres e etiquetas nas construções.
- **Pedestres genéricos.** São os bonecos do escritório com semente local, sem nome nem aparência dos agentes reais: a página é pública.
- **Datas comemorativas no mundo.** Só o calendário embutido. As datas próprias da empresa nunca vão para a página nem para a rota pública; a rota ganhou `festas_desligadas`, só com chaves do catálogo.
- **Mapa do Brasil ilustrado.** Biomas, rios e rodovias do Natural Earth e serras. O desenho previa rios; eles entraram. As serras de perto são peças pintadas do PixelLab, depois de três tentativas por código reprovadas na revisão.
- **Três níveis de detalhe no mapa.** 400x400 de longe, 800x800 a partir de 2x e 1600x1600 no zoom máximo, em azulejos baixados só com zoom. O zoom máximo fica entre 3,2x e 4,8x em qualquer tela.
- **Globo refeito.** Mais resolução, nuvens em campo guardado, luzes de cidades do mundo, lua com fase.
- **Aviões do mapa.** Usam o desenho do PixelLab reduzido; a versão por código saiu.
- **PixelLab.** O desenho dizia "só a assinatura, nunca o crédito avulso". O Helbert autorizou depois o crédito de US$ 10; ele não chegou a ser usado. A arte foi gerada pelo site e, depois, pela API.
- **Fora do que foi feito.** Ônibus circulando (o modelo não desenha ônibus visto de cima), chapéu de festa nos pedestres, cidades fora do Brasil, diretório de outros escritórios e link para o mundo no menu do escritório.
