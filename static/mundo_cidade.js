// Cidade, o nível 3 do mundo: a cidade vista de cima, em três quartos, com a arte do PixelLab (static/mundo/atlas.png), a
// planta de mundo_cidade_planta.js e o chão de mundo_cidade_chao.js. Aqui ficam as peças e a vida da rua:
// - as peças pela profundidade (quem está mais abaixo desenha por cima): o marco no centro (ou um prédio genérico, quando
//   a arte dele falta), prédios, casas, chalés, o lazer, a praia, árvores (a copa balança com o vento do Clima), o
//   mobiliário, postes e pedestres;
// - carros, ônibus e bicicletas pela mão direita, girando o desenho (feito para o leste) conforme o sentido, e dando a
//   volta fora da vista.
//   No cruzamento cabe um veículo por vez: quem chega espera do lado de fora enquanto houver outro lá dentro, e quem vai
//   atrás na mesma faixa não encosta no da frente;
// - pedestres (os bonecos do escritório, avatar.js, em 1:1) andando pela rede de calçadas e faixas da planta; na festa do
//   dia, três em cada cinco com o chapéu dela;
// - fumaça nas chaminés de alguns chalés, passarinhos cruzando de vez em quando e, à noite, janelas acesas (as do atlas,
//   umas sim e outras não, mudando com a hora), postes, faróis e a casa;
// - a partir de 2x (perto): placas com o nome das ruas nas esquinas, pombos na praça, sombra dos pedestres e os detalhes
//   do chão; a 1x a cena fica limpa;
// - a etiqueta com o nome das construções notáveis (marco, igreja, hospital, mercado, campo, praça, coreto...), no clique,
//   no toque, no foco do teclado ou sob o mouse;
// - os enfeites da festa do dia (mundo_festa.js), cada um na camada dele.
// Só a cidade da casa tem o chalé com a placa, e só ele desce ao bairro ({ir: "bairro"}); placa e porta aparecem quando
// o desenho do chalé chega. O tempo vem pelo Clima (o mundo.js o define); a noite, pelo Ceu. Com movimento reduzido,
// carros, pedestres, copas, mar e pombos parados, e nada de partículas, fumaça ou passarinhos. O atlas é pedido na primeira
// entrada numa cidade (e de novo se falhar). Nada é alocado por quadro: listas, vista e opções são reaproveitadas.
"use strict";
const MundoCidade = (() => {
  const { W, H, E, C } = CidadePlanta, FAIXA = 8, B = E / 2 + C, PLACA_H = 12, POSTE = 28, FOLGA = 4;
  const QUADRA = [192, 160];   // o zoom máximo ainda mostra uma quadra inteira
  const PERTO = 1.8;           // a partir daqui (z), os detalhes de perto
  const ALTO_MAX = 130;        // a altura do maior desenho do atlas (os marcos chegam a 125)
  const LUZ = [255, 214, 130];   // a cor dos postes, janelas e faróis à noite
  const FECHADO = { nublado: 0.18, neblina: 0.25, garoa: 0.3, chuva: 0.4, tempestade: 0.6, neve: 0.15 };
  // a boca da chaminé de cada chalé, no recorte do atlas (o chalé 6 já tem a fumaça desenhada)
  const CHAMINES = { "chale-1": [20, 1], "chale-2": [43, 6], "chale-3": [41, 1], "chale-4": [34, 2], "chale-5": [37, 5],
                     "chale-7": [19, 1], "chale-8": [36, 1] };
  const PORTES = { metropole: "uma metrópole", grande: "uma cidade grande", media: "uma cidade média", pequena: "uma cidade do interior" };

  // carro pela mão direita: para o leste na faixa de baixo, para o sul na da esquerda
  const giro = c => c.eixo === "h" ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  const olhar = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "dir" : "esq") : (dy > 0 ? "baixo" : "cima");
  const hash = (a, b, c) => CidadeChao.hash(Math.round(a), Math.round(b), c);

  function criar({ dados, Camera, reduzido, mapa, clima, avisar, festa }) {
    const camera = Camera([0, 0, W, H]);
    camera.teto = () => Math.min(camera.W / QUADRA[0], camera.H / QUADRA[1]) / camera.base;
    const todas = Array.isArray(dados && dados.cidades) ? dados.cidades : [];
    const cidades = new Map(todas.filter(c => c && typeof c.id === "string").map(c => [c.id, c]));
    const info = id => cidades.get(id) || (mapa && mapa.porId.get(id)) || {};   // a média vem do mapa (porte, praia e UF)
    let id = null, p = CidadePlanta.planta(""), carros = [], pedestres = [], pecas = [], postes = [], rua = Math.random;
    let atlas = null, quadros = {}, janelas = {}, pedido = false, escolhido = null, notaveis = [], rascunho = null, placaCasa = null;
    let placas = [];   // as plaquinhas de cada cruzamento (com os letreiros guardados), entram na ordem de profundidade
    const lista = [], vista = [0, 0, W, H], brilhos = new Map();
    const vida = { fumaca: 0, passaros: 0, balanco: 0, janelas: 0, janelasCobertas: 0, recortes: 0, pombos: 0, placas: 0,
                   depoisDaPlaca: 0, etiqueta: null, perto: false };
    const opChao = { neve: false, ceu: null, tipo: "limpo", casa: false, t: 0, perto: false, desvio: 0 };
    const opClima = { W: 0, H: 0, predioRet: { x: -10, y: -10, w: 0, h: 0 }, ceu: false };
    const enfeites = MundoFesta.criar({ reduzido, alto: POSTE, recorte: nome => recorte(nome), atlas: () => atlas });
    const chao = CidadeChao.criar({ recorte: nome => recorte(nome), atlas: () => atlas });
    const letreiros = CidadeLetreiro.criar();

    function carregar() {   // o atlas, uma vez; se o json ou a imagem falharem, a próxima entrada tenta de novo
      if (pedido) return;
      pedido = true;
      fetch("/mundo/atlas.json", { credentials: "omit", cache: "no-cache" })
        .then(r => r.ok ? r.json() : null).catch(() => null)
        .then(d => {
          if (!d || !d.quadros || typeof d.quadros !== "object") { pedido = false; return; }
          const img = new Image();
          img.addEventListener("load", () => {
            quadros = d.quadros; janelas = d.janelas && typeof d.janelas === "object" ? d.janelas : {}; atlas = img; recortes.clear();
            preparar(); if (avisar) avisar();
          });
          img.addEventListener("error", () => { pedido = false; });
          img.src = "/mundo/atlas.png?v=" + (Number.isInteger(d.versao) ? d.versao : 0);
        });
    }
    const recortes = new Map();   // o recorte validado de cada nome, guardado (o atlas chega uma vez)
    const recorte = nome => {
      if (!atlas) return null;
      let r = recortes.get(nome);
      if (r === undefined) {
        r = Object.prototype.hasOwnProperty.call(quadros, nome) ? quadros[nome] : null;
        r = Array.isArray(r) && r.length === 4 && r.every(Number.isFinite) ? r : null;
        recortes.set(nome, r);
      }
      return r;
    };
    function peca(ctx, nome, x, y) {   // o pé do recorte em (x, y)
      const r = recorte(nome);
      if (r) ctx.drawImage(atlas, r[0], r[1], r[2], r[3], Math.round(x - r[2] / 2), Math.round(y - r[3]), r[2], r[3]);
    }
    const ehCasa = () => !!id && mapa.casa === id;
    const portaPronta = () => ehCasa() && !!recorte(p.casa.peca);   // placa e porta só com o desenho do chalé
    const marco = () => info(id).marco;
    const temMarco = () => typeof marco() === "string" && !!recorte("marco-" + marco());
    // o desenho de uma peça: a vaga da casa tem o chalé só na casa (fora dela, uma árvore); o centro, o marco
    const nomeDe = s => s === p.casa ? (portaPronta() ? p.casa.peca : p.casa.arvore) : s === p.centro && temMarco() ? "marco-" + marco() : s.peca;
    function caixaCasa() {   // o chalé e a placa em cima dele: a área da porta
      const [, , w, h] = recorte(p.casa.peca) || [0, 0, 60, 57];
      return [p.casa.x - w / 2, p.casa.y - h - PLACA_H - 1, w, h + PLACA_H + 1];
    }
    function naCasa(x, y) { const [cx, cy, w, h] = caixaCasa(); return portaPronta() && x >= cx && x <= cx + w && y >= cy && y <= cy + h; }
    function alvoPorta() {
      const c = mapa.porId.get(id), [, , , h] = caixaCasa();
      return { id: "porta", x: p.casa.x, y: p.casa.y, alto: h * camera.P / camera.dpr, titulo: "Recepção",
               texto: "Chalé do escritório · descer ao bairro",
               rotulo: `Chalé com a placa, o escritório em ${c ? c.nome : "esta cidade"}: descer ao bairro`,
               acao: { ir: "bairro", cidade: id } };
    }
    // as construções notáveis da parte da cidade que aparece a 1x, com o nome do tipo (o marco, com o do ponto turístico)
    function montarNotaveis() {
      const l = [];
      if (temMarco()) l.push({ s: p.centro, nome: info(id).marco_nome || "Marco da cidade" });
      for (const s of p.notaveis) if (s.x > -20 && s.x < W + 20 && s.y > -20 && s.y < H + 70) l.push({ s, nome: CidadePlanta.NOMES[s.peca] });
      notaveis = l.filter(n => recorte(nomeDe(n.s))).map((n, i) => ({ ...n, id: "notavel-" + i, maiusculo: n.nome.toUpperCase(), e: null, k: 0 }));
    }
    function alvoNotavel(n) {
      const [, , , h] = recorte(nomeDe(n.s)) || [0, 0, 0, 40];
      return { id: n.id, x: n.s.x, y: n.s.y - Math.round(h / 3), alto: h * camera.P / camera.dpr / 2, titulo: n.nome, texto: "",
               rotulo: `${n.nome}: mostrar o nome`, etiqueta: true };
    }
    function notavelEm(x, y) {   // a construção notável sob o ponto (a da frente, se duas se cobrem)
      let achado = null;
      for (const n of notaveis) {
        const r = recorte(nomeDe(n.s));
        if (!r || x < n.s.x - r[2] / 2 || x > n.s.x + r[2] / 2 || y < n.s.y - r[3] || y > n.s.y) continue;
        if (!achado || n.s.y > achado.s.y) achado = n;
      }
      return achado;
    }
    function preparar() {   // o atlas chegou ou a cidade mudou: o chão e as notáveis
      chao.preparar(p, pecas, s => (s.poste ? null : nomeDe(s)), s => (s === p.praca ? s.x + enfeites.desvio : s.x));
      montarNotaveis();
    }
    function escolher(n) {   // mostra a etiqueta da notável por 5 s e devolve o anúncio para o status
      escolhido = { id: n.id, ate: performance.now() + 5000 };
      const c = mapa.porId.get(id);
      return { anuncio: `${n.nome}${c ? ", em " + c.nome : ""}.` };
    }

    function medirVista() {   // a parte do mundo na tela, [x0, y0, x1, y1] (as contas de camera.mundo, sem array novo)
      const P = camera.P, ox = Math.round(camera.W / 2 - camera.x * P), oy = Math.round(camera.H / 2 - camera.y * P);
      vista[0] = -ox / P; vista[1] = -oy / P; vista[2] = (camera.W - ox) / P; vista[3] = (camera.H - oy) / P;
    }
    // o carro no eixo dele: metade do comprimento; cobre(s, m, k): o trecho [s - m, s + m] cruza o miolo do cruzamento k
    const meio = c => { const r = recorte(c.peca); return r ? r[2] / 2 : 13; };
    const cobre = (s, m, k) => s - m < k + E / 2 && k - E / 2 < s + m;
    const dentro = (o, X, Y) => o.eixo === "h" ? o.rua === Y && cobre(o.s, meio(o), X) : o.rua === X && cobre(o.s, meio(o), Y);
    function andar(c, dt) {
      const h = c.eixo === "h", m = meio(c), fora = Math.max(16, m + 2);   // a volta, com o desenho todo fora da vista
      const lo = Math.min(0, vista[h ? 0 : 1]) - fora, hi = Math.max(h ? W : H, vista[h ? 2 : 3]) + fora;
      let s = c.s + c.dir * c.v * dt;
      if (s > hi || s < lo) s = s > hi ? lo : hi;   // a volta acontece fora da caixa e da vista, com o carro inteiro escondido
      else for (let i = 0; i < p.cruzamentos.length; i++) {   // não entra num cruzamento com outro veículo dentro
        const X = p.cruzamentos[i][0], Y = p.cruzamentos[i][1], k = h ? X : Y;
        if (c.rua !== (h ? Y : X) || !cobre(s, m, k) || cobre(c.s, m, k)) continue;
        for (let j = 0; j < carros.length; j++) if (carros[j] !== c && dentro(carros[j], X, Y)) return;
      }
      // o da mesma faixa (na frente, ou no lugar da volta) segura quem vem atrás
      for (let j = 0; j < carros.length; j++) {
        const o = carros[j];
        if (o !== c && o.eixo === c.eixo && o.rua === c.rua && o.dir === c.dir && Math.abs(s - o.s) < m + meio(o) + FOLGA) return;
      }
      c.s = s;
    }
    function mover(dt) {
      if (!reduzido && dt > 0) for (let i = 0; i < carros.length; i++) andar(carros[i], dt);
      for (let i = 0; i < carros.length; i++) {
        const c = carros[i];
        if (c.eixo === "h") { c.x = c.s; c.y = c.rua + c.dir * FAIXA; } else { c.x = c.rua - c.dir * FAIXA; c.y = c.s; }
      }
      const { nos, viz, peso } = p.rede;
      for (let i = 0; i < pedestres.length; i++) {   // de canto em canto; no canto, segue por outra calçada ou atravessa na faixa
        const a = pedestres[i];
        if (!reduzido) a.s += a.v * dt;
        let L = Math.hypot(nos[a.para][0] - nos[a.de][0], nos[a.para][1] - nos[a.de][1]);
        while (a.s >= L) {
          a.s -= L;
          const opcoes = viz[a.para];   // os vizinhos do canto, menos o de onde veio, pelo peso de cada um
          let total = 0, prox = a.de;
          for (let j = 0; j < opcoes.length; j++) if (opcoes[j] !== a.de) total += peso[opcoes[j]];
          let sorte = rua() * total;
          for (let j = 0; j < opcoes.length; j++) {
            const n = opcoes[j];
            if (n === a.de) continue;
            prox = n;
            if ((sorte -= peso[n]) < 0) break;
          }
          a.de = a.para; a.para = prox;
          L = Math.hypot(nos[a.para][0] - nos[a.de][0], nos[a.para][1] - nos[a.de][1]);
        }
        const x0 = nos[a.de][0], y0 = nos[a.de][1], x1 = nos[a.para][0], y1 = nos[a.para][1], k = a.s / L;
        a.x = x0 + (x1 - x0) * k; a.y = y0 + (y1 - y0) * k;
        a.b.x = Math.round(a.x); a.b.y = Math.round(a.y); a.b.olha = olhar(x1 - x0, y1 - y0);
      }
    }
    const naVista = (x0, y0, x1, y1) => x1 >= vista[0] && x0 <= vista[2] && y1 >= vista[1] && y0 <= vista[3];
    // o brilho de uma luz à noite: o degradê pintado uma vez por cor, raio e escala (com pixels de sobra para o zoom) e
    // depois só copiado; a força vem do globalAlpha. A chave é o número da cor (RGB), não o array: a mesma cor de outra
    // festa ou cidade reaproveita o sprite, e o guardado não cresce a cada troca
    // base: o y do pé de quem acende (o poste, o carro): as peças com o pé mais abaixo ficam na frente e apagam o brilho
    // onde o desenho delas cobre (o sprite do brilho é copiado para uma tela de rascunho e recortado lá). Sem base (as
    // luzes das festas), o brilho vai inteiro
    function brilho(ctx, x, y, r, a, cor = LUZ, base = null) {
      const k = Math.max(1, Math.min(8, Math.ceil(camera.P))), chave = ((cor[0] << 16 | cor[1] << 8 | cor[2]) * 64 + r) * 16 + k;
      let tela = brilhos.get(chave);
      if (!tela) {
        const d = r * k * 2;
        tela = document.createElement("canvas"); tela.width = tela.height = d;
        const g = tela.getContext("2d"), gr = g.createRadialGradient(d / 2, d / 2, 0, d / 2, d / 2, d / 2);
        gr.addColorStop(0, `rgba(${cor},1)`); gr.addColorStop(1, `rgba(${cor},0)`);
        g.fillStyle = gr; g.fillRect(0, 0, d, d);
        brilhos.set(chave, tela);
      }
      const d = r * k * 2, frente = base === null ? null : recortar(tela, x, y, r, k, base);
      ctx.globalAlpha = Math.min(1, a);
      if (frente) ctx.drawImage(frente, 0, 0, d, d, x - r, y - r, r * 2, r * 2); else ctx.drawImage(tela, x - r, y - r, r * 2, r * 2);
      ctx.globalAlpha = 1;
    }
    // o brilho na tela de rascunho, sem os pixels das peças da frente que o cobrem; null se nenhuma cobre
    function recortar(tela, x, y, r, k, base) {
      let g = null;
      for (let i = lista.length - 1; i >= 0 && lista[i].y > base; i--) {
        const s = lista[i], nome = !s.ped && !s.poste && !s.enfeite && !s.placa ? nomeDe(s) : null, q = nome && recorte(nome);
        if (!q) continue;
        const sx = Math.round(s.x - q[2] / 2), sy = Math.round(s.y - q[3]);
        if (sx > x + r || sx + q[2] < x - r || sy > y + r || sy + q[3] < y - r) continue;
        if (!g) {
          const d = r * k * 2;
          if (!rascunho || rascunho.width < d) {   // do tamanho do maior brilho pedido até agora
            rascunho = document.createElement("canvas"); rascunho.width = rascunho.height = Math.max(64, d);
          }
          g = rascunho.getContext("2d");
          g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.imageSmoothingEnabled = false;
          g.clearRect(0, 0, d, d); g.drawImage(tela, 0, 0, d, d);
          g.globalCompositeOperation = "destination-out";
        }
        g.drawImage(atlas, q[0], q[1], q[2], q[3], (sx - x + r) * k, (sy - y + r) * k, q[2] * k, q[3] * k);
      }
      if (!g) return null;
      g.globalCompositeOperation = "source-over";
      vida.recortes++;
      return rascunho;
    }
    // a janela (o pixel do meio dela) está coberta por uma peça da frente? A lista vai pela profundidade: depois da peça
    // cujo pé passa ALTO_MAX abaixo da janela, nenhum desenho chega até ela
    function coberta(i0, jx, jy) {
      for (let i = i0 + 1; i < lista.length; i++) {
        if (lista[i].y - ALTO_MAX > jy) break;
        const s = lista[i], nome = !s.ped && !s.poste && !s.enfeite && !s.placa ? nomeDe(s) : null, q = nome && recorte(nome);
        if (!q || s.y <= lista[i0].y) continue;
        const lx = jx - Math.round(s.x - q[2] / 2), ly = jy - Math.round(s.y - q[3]);
        if (lx >= 0 && ly >= 0 && lx < q[2] && ly < q[3] && chao.opaco(nome, lx, ly)) return true;
      }
      return false;
    }
    // a árvore: o tronco parado e a copa (os 60% de cima) deslocada pelo vento do Clima
    function arvore(ctx, nome, s, x, y) {
      const r = recorte(nome);
      if (!r) return;
      const dx = reduzido || !Clima.balanco ? 0 : Math.max(-2, Math.min(2, Math.round(Clima.balanco(s.x * 0.05 + s.y * 0.03) * 0.6)));
      const x0 = Math.round(x - r[2] / 2), y0 = Math.round(y - r[3]);
      if (!dx) { ctx.drawImage(atlas, r[0], r[1], r[2], r[3], x0, y0, r[2], r[3]); return; }
      const copa = Math.round(r[3] * 0.6);
      ctx.drawImage(atlas, r[0], r[1] + copa, r[2], r[3] - copa, x0, y0 + copa, r[2], r[3] - copa);
      ctx.drawImage(atlas, r[0], r[1], r[2], copa, x0 + dx, y0, r[2], copa);
      vida.balanco++;
    }
    function pombos(ctx, t) {   // pombos ciscando na grama dos dois lados da fonte (de perto): cinza, asa clara, pescoço verde
      const x0 = p.praca.x + enfeites.desvio, y0 = p.praca.y - 3;
      for (let i = 0; i < 6; i++) {
        const lado = i % 2 ? 1 : -1, x = Math.round(x0 + lado * (50 + hash(i, 1, 51) * 24)), y = Math.round(y0 - hash(i, 2, 52) * 14);
        const bica = !reduzido && Math.floor(t / 420 + i * 1.7) % 3 === 0, cabeca = x + (hash(i, 3, 53) < 0.5 ? 4 : -1);
        ctx.fillStyle = "#8f96a3"; ctx.fillRect(x, y, 4, 2);
        ctx.fillStyle = "#5c6370"; ctx.fillRect(cabeca, y + (bica ? 1 : -1), 1, 2);
        ctx.fillStyle = "#d3d8e0"; ctx.fillRect(x + 1, y, 2, 1);
        ctx.fillStyle = "#4f8f72"; ctx.fillRect(cabeca, y + (bica ? 2 : 0), 1, 1);
        ctx.fillStyle = "#c46a4a"; ctx.fillRect(x + 1, y + 2, 1, 1); ctx.fillRect(x + 3, y + 2, 1, 1);
        vida.pombos++;
      }
    }
    function desenhar(ctx, s, t, casa, escuro) {
      if (s.ped) {
        if (vida.perto) {   // de perto, a sombra no chão
          ctx.globalAlpha = 0.25; ctx.fillStyle = "#16202a"; ctx.fillRect(Math.round(s.x) - 3, Math.round(s.y) - 1, 7, 2); ctx.globalAlpha = 1;
        }
        if (!window.Avatar) return;
        const q = Avatar.boneco(ctx, s.b, t, 1), f = s.festeiro && festa ? festa() : null;
        if (f) Avatar.chapeu(ctx, q.x, q.y, f);   // na festa do dia, três em cada cinco de chapéu
        return;
      }
      if (s.enfeite) return enfeites.desenhar(ctx, s);
      if (s.placa) return placa(ctx, s);
      if (s.poste) {   // o poste: base, haste com um filete de luz e o braço com a luminária sobre a rua
        const x = s.x, y = s.y, l = s.lado;
        ctx.fillStyle = "#24242b"; ctx.fillRect(x - 1, y - 2, 3, 2); ctx.fillRect(x, y - POSTE, 1, POSTE);
        ctx.fillRect(Math.min(x, x + 3 * l), y - POSTE - 1, 4, 1); ctx.fillRect(x + 3 * l - (l < 0 ? 1 : 0), y - POSTE, 2, 1);
        ctx.fillStyle = "#6b6b78"; ctx.fillRect(x + (l < 0 ? 1 : -1), y - POSTE + 1, 1, POSTE - 3);
        ctx.fillStyle = "#f2e2b0"; ctx.fillRect(x + 3 * l - (l < 0 ? 1 : 0), y - POSTE + 1, 2, 1);
        return enfeites.poste(ctx, s);
      }
      if (vida.placas) vida.depoisDaPlaca++;
      const nome = nomeDe(s), x = s === p.praca ? s.x + enfeites.desvio : s.x;   // a fonte abre espaço para a peça da festa
      if (nome.startsWith("arvore-")) arvore(ctx, nome, s, x, s.y); else peca(ctx, nome, x, s.y);
      if (s === p.praca && vida.perto && nome === "praca-1") pombos(ctx, t);
      if (nome.startsWith("chale-") || nome.startsWith("casa-")) enfeites.telhado(ctx, nome, s.x, s.y, escuro, t);
    }
    // a fumaça de alguns chalés: bolinhas que sobem, crescem e somem, puxadas pelo vento
    function fumaca(ctx, t) {
      const v = Math.min(1.5, Math.abs(Clima.vento || 0)), lado = (Clima.vento || 0) < 0 ? -1 : 1;
      for (let i = 0; i < lista.length; i++) {
        const s = lista[i], ch = s.peca && CHAMINES[s.peca];
        if (!ch || s === p.casa || hash(s.x, s.y, 61) > 0.55) continue;
        const r = recorte(s.peca);
        if (!r) continue;
        const bx = Math.round(s.x - r[2] / 2) + ch[0], by = Math.round(s.y - r[3]) + ch[1];
        for (let k = 0; k < 4; k++) {
          const u = (t / 3200 + k / 4 + hash(s.x, s.y, 62)) % 1;
          ctx.globalAlpha = 0.55 * (1 - u);
          ctx.fillStyle = u < 0.5 ? "#e4e6ea" : "#c9ccd3";
          const tam = u < 0.3 ? 1 : 2;
          ctx.fillRect(Math.round(bx + lado * u * (3 + v * 8) + Math.sin(u * 6 + k) * 0.8), Math.round(by - 2 - u * 14), tam, tam);
        }
        vida.fumaca++;
      }
      ctx.globalAlpha = 1;
    }
    // um bando de passarinhos atravessa a vista a cada 25 s (9 s de travessia), batendo as asas
    function passaros(ctx, t) {
      const ciclo = t / 1000 / 25, n = Math.floor(ciclo), u = (ciclo - n) * 25 / 9;
      if (u >= 1) return;
      const w = vista[2] - vista[0], h = vista[3] - vista[1], ida = n % 2 ? -1 : 1;
      const x0 = ida > 0 ? vista[0] - 20 + u * (w + 40) : vista[2] + 20 - u * (w + 40), y0 = vista[1] + h * (0.15 + 0.25 * hash(n, 0, 63));
      ctx.fillStyle = "#2b2a33";
      for (let i = 0; i < 5; i++) {
        const x = Math.round(x0 - ida * (i % 3) * 7 - i * 3), y = Math.round(y0 + (i % 2) * 5 + i * 2 + Math.sin(t / 300 + i) * 1.5);
        const asa = Math.floor(t / 140 + i) % 2;
        ctx.fillRect(x, y, 1, 1); ctx.fillRect(x - 2, y - 1 + asa, 2, 1); ctx.fillRect(x + 1, y - 1 + asa, 2, 1);
        vida.passaros++;
      }
    }
    // à noite: as janelas acesas de cada construção, umas sim e outras não, trocando com a hora
    function acender(ctx, escuro, hora) {
      const parte = hora >= 18 && hora < 22 ? 0.62 : hora >= 22 ? 0.4 : hora < 5 ? 0.16 : hora < 7 ? 0.35 : 0.5, hr = Math.floor(hora);
      ctx.globalAlpha = Math.min(1, (escuro - 0.25) * 2);
      for (let i = 0; i < lista.length; i++) {
        const s = lista[i];
        if ((!s.peca && s !== p.centro) || s.placa || s.enfeite) continue;
        const nome = nomeDe(s), js = nome && janelas[nome], r = js && recorte(nome);
        if (!r || !Array.isArray(js)) continue;
        const x0 = Math.round(s.x - r[2] / 2), y0 = Math.round(s.y - r[3]);
        for (let j = 0; j + 3 < js.length; j += 4) {
          if (hash(s.x + j, s.y, hr * 7 + 3) >= parte) continue;
          // a janela que uma peça da frente cobre não acende por cima dela
          if (coberta(i, x0 + js[j] + (js[j + 2] >> 1), y0 + js[j + 1] + (js[j + 3] >> 1))) { vida.janelasCobertas++; continue; }
          ctx.fillStyle = (j / 4) % 3 ? "#ffd98a" : "#ffe9b5";
          ctx.fillRect(x0 + js[j], y0 + js[j + 1], js[j + 2], js[j + 3]);
          vida.janelas++;
        }
      }
      ctx.globalAlpha = 1;
    }
    // a placa de uma esquina (de perto, na ordem de profundidade: o que fica na frente a cobre): o poste na quina e as duas
    // plaquinhas azuis na escala da tela; os letreiros ficam guardados na placa (refeitos só se a escala mudar)
    function placa(ctx, s) {
      const P = camera.P, ox = Math.round(camera.W / 2 - camera.x * P), oy = Math.round(camera.H / 2 - camera.y * P);
      const k = Math.max(1, Math.round(camera.dpr * (P / camera.dpr >= 4 ? 2 : 1)));   // bem de perto, o dobro
      ctx.fillStyle = "#3a3d46"; ctx.fillRect(s.x, s.y - 10, 1, 10);
      if (s.k !== k || !s.a || !s.b) {
        s.a = letreiros.letreiro(p.nomeRua.v[s.rv] || "", "rua", k); s.b = letreiros.letreiro(p.nomeRua.h[s.rh] || "", "rua", k);
        s.k = s.a && s.b ? k : 0;
      }
      if (!s.a || !s.b) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const sx = Math.round(ox + (s.x + 1) * P), sy = Math.round(oy + (s.y - 10) * P);   // as plaquinhas à direita do poste
      ctx.drawImage(s.a, sx, sy - s.a.height * 2 - k); ctx.drawImage(s.b, sx, sy - s.b.height);
      ctx.setTransform(P, 0, 0, P, ox, oy);
      vida.placas++;
    }
    // a etiqueta do nome sobre a construção escolhida (clique ou toque) ou em destaque (foco ou mouse)
    function etiqueta(ctx, t) {
      const alvo = cidade.destaque && cidade.destaque.startsWith("notavel-") ? cidade.destaque
        : escolhido && performance.now() < escolhido.ate ? escolhido.id : null;
      vida.etiqueta = null;
      let n = null;
      if (alvo) for (let i = 0; i < notaveis.length; i++) if (notaveis[i].id === alvo) n = notaveis[i];
      const r = n && recorte(nomeDe(n.s));
      if (!r) return;
      const k = Math.max(2, Math.round(camera.dpr * 2));   // 16 px de CSS
      if (n.k !== k || !n.e) { n.e = letreiros.letreiro(n.maiusculo, "etiqueta", k); n.k = n.e ? k : 0; }
      const e = n.e;
      vida.etiqueta = n.nome;
      if (!e) return;
      const P = camera.P, ox = Math.round(camera.W / 2 - camera.x * P), oy = Math.round(camera.H / 2 - camera.y * P);
      const sx = Math.round(ox + n.s.x * P - e.width / 2), sy = Math.max(2 * k, Math.round(oy + (n.s.y - r[3] - 2) * P) - e.height - 4 * k);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(e, sx, sy);
      ctx.fillStyle = "#2a1d14"; ctx.fillRect(sx + Math.round(e.width / 2) - 2 * k, sy + e.height, 4 * k, 2 * k);
      ctx.fillRect(sx + Math.round(e.width / 2) - k, sy + e.height + 2 * k, 2 * k, k);
      ctx.setTransform(P, 0, 0, P, ox, oy);
    }

    function quadro(ctx, dt, t) {
      const ceu = Ceu.agora(), escuro = Math.max(0, Math.min(1, ceu.escuro || 0)), tipo = Clima.tipo(), casa = portaPronta();
      const tt = reduzido ? 0 : t;   // com movimento reduzido, o tempo das animações para
      medirVista();
      mover(dt);
      vida.fumaca = vida.passaros = vida.balanco = vida.janelas = vida.janelasCobertas = vida.recortes = vida.pombos = 0;
      vida.placas = vida.depoisDaPlaca = 0;
      vida.perto = camera.z >= PERTO;
      enfeites.comecar(atlas && festa ? festa() : null, p, id, postes);
      opChao.neve = tipo === "neve"; opChao.ceu = ceu; opChao.tipo = tipo; opChao.casa = casa; opChao.t = tt; opChao.perto = vida.perto && !!atlas;
      opChao.desvio = enfeites.desvio;
      chao.desenhar(ctx, vista, opChao);
      enfeites.chao(ctx, escuro, t);
      if (atlas) {
        ctx.globalAlpha = 0.3 * chao.estado.forca; ctx.fillStyle = "#16202a";
        for (let i = 0; i < carros.length; i++) {   // a sombra dos carros, de dia
          const c = carros[i], r = recorte(c.peca);
          if (!r || !chao.estado.forca) continue;
          const w = c.eixo === "h" ? r[2] : r[3], h = c.eixo === "h" ? r[3] : r[2];
          ctx.fillRect(Math.round(c.x - w / 2) + 1, Math.round(c.y - h / 2) + 2, w - 1, h - 1);
        }
        ctx.globalAlpha = 1;
        for (let i = 0; i < carros.length; i++) {   // os carros no chão, por baixo das construções (o atlas já os traz na escala)
          const c = carros[i], r = recorte(c.peca);
          const m = r ? r[2] / 2 + 2 : 0;
          if (!r || !naVista(c.x - m, c.y - m, c.x + m, c.y + m)) continue;
          ctx.save(); ctx.translate(Math.round(c.x), Math.round(c.y)); ctx.rotate(giro(c));
          ctx.drawImage(atlas, r[0], r[1], r[2], r[3], -Math.round(r[2] / 2), -Math.round(r[3] / 2), r[2], r[3]);
          ctx.restore();
        }
      }
      lista.length = 0;   // as peças na tela (os desenhos sobem até ~130 acima do pé), pela profundidade
      for (let i = 0; i < pecas.length; i++) { const s = pecas[i]; if (naVista(s.x - 70, s.y - 130, s.x + 70, s.y + 4)) lista.push(s); }
      const itens = enfeites.itens;
      for (let i = 0; i < itens.length; i++) { const s = itens[i]; if (naVista(s.x - 120, s.y - 80, s.x + 120, s.y + 4)) lista.push(s); }
      if (atlas && vida.perto) for (let i = 0; i < placas.length; i++) {
        const s = placas[i];
        if (naVista(s.x - 2, s.y - 60, s.x + 60, s.y + 2)) lista.push(s);
      }
      if (atlas) for (let i = 0; i < pedestres.length; i++) {
        const a = pedestres[i];
        if (naVista(a.x - 12, a.y - 24, a.x + 12, a.y + 3)) lista.push(a);
      }
      ordenar(lista);
      if (atlas) {
        for (let i = 0; i < lista.length; i++) desenhar(ctx, lista[i], t, casa, escuro);
        if (!reduzido) { fumaca(ctx, t); if (escuro < 0.4) passaros(ctx, t); }   // passarinhos só de dia
      }
      const x0 = Math.floor(vista[0]), y0 = Math.floor(vista[1]), w = Math.ceil(vista[2] - vista[0]) + 1, h = Math.ceil(vista[3] - vista[1]) + 1;
      if (FECHADO[tipo]) { ctx.globalAlpha = FECHADO[tipo] * 0.6; ctx.fillStyle = "#3e4456"; ctx.fillRect(x0, y0, w, h); }
      ctx.globalAlpha = 0.1; ctx.fillStyle = ceu.cima; ctx.fillRect(x0, y0, w, h);   // o tom do céu
      if (escuro > 0) { ctx.globalAlpha = escuro * 0.62; ctx.fillStyle = "#060a22"; ctx.fillRect(x0, y0, w, h); }
      ctx.globalAlpha = 1;
      const cx = p.casa.x, cy = p.casa.y - (recorte(p.casa.peca) || [0, 0, 60, 57])[3] - PLACA_H - 1;
      if (casa) {   // a placa do escritório, por cima da noite (acesa)
        if (!placaCasa) placaCasa = letreiros.letreiro("RECEPÇÃO", "placa", 1);
        if (placaCasa) ctx.drawImage(placaCasa, Math.round(cx - placaCasa.width / 2), Math.round(cy));
      }
      if (escuro > 0.05 && atlas) {   // à noite: janelas, postes, faróis e a casa acesos
        if (escuro > 0.3) acender(ctx, escuro, Number.isFinite(ceu.h) ? ceu.h : 22);
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < lista.length; i++) {
          const s = lista[i];
          if (s.poste) {   // a luminária e a luz no chão embaixo dela
            brilho(ctx, s.x + 3 * s.lado + 0.5, s.y - POSTE + 1.5, 16, 0.5 * escuro, LUZ, s.y);
            brilho(ctx, s.x + 3 * s.lado, s.y, 14, 0.3 * escuro, LUZ, s.y);
          }
          else if (s.peca && (s.peca.startsWith("chale-") || s.peca.startsWith("casa-")) && s !== p.casa) {
            brilho(ctx, s.x, s.y - 18, 12, 0.3 * escuro, LUZ, s.y);
          }
          else if (s.peca === "banco-poste-1") brilho(ctx, s.x - 6, s.y - 22, 12, 0.45 * escuro, LUZ, s.y);   // o lampião do banco
        }
        if (casa) brilho(ctx, p.casa.x, p.casa.y - 18, 22, 0.55 * escuro, LUZ, p.casa.y);
        for (let i = 0; i < carros.length; i++) {   // os faróis (a bicicleta, uma luz pequena)
          const c = carros[i], a = giro(c), m = meio(c) + 1, bici = c.peca.startsWith("bici-");
          brilho(ctx, c.x + Math.cos(a) * m, c.y + Math.sin(a) * m, bici ? 5 : 9, (bici ? 0.35 : 0.5) * escuro, LUZ, c.y);
        }
        ctx.globalCompositeOperation = "source-over";
      }
      enfeites.noite(ctx, escuro, brilho, vista);   // o pisca, a fogueira e as lanternas acesos por cima do escuro
      enfeites.ar(ctx, dt, t, vista, escuro, brilho);   // fogos, confete, serpentina e morcegos
      enfeites.terminar(escuro);
      if (!reduzido) {   // chuva, neve, neblina e raio do Clima, sobre a parte da cidade que está na tela
        const som = window.Som && Som.ligado ? Som : null;
        opClima.W = w; opClima.H = h;
        ctx.save(); ctx.translate(x0, y0);
        Clima.desenhar(ctx, opClima, dt, t, som);
        ctx.restore();
      }
      if (casa && cidade.destaque === "porta") {   // destaque: quatro cantos que respiram em volta do chalé
        const [bx, by, bw, bh] = caixaCasa(), d = reduzido ? 0 : Math.round((Math.sin(t / 180) + 1) / 2);
        const a0 = bx - 3 - d, b0 = by - 3 - d, a1 = bx + bw + 2 + d, b1 = by + bh + 2 + d;
        ctx.fillStyle = "#ffe08a";
        ctx.fillRect(a0, b0, 4, 1); ctx.fillRect(a0, b0, 1, 4); ctx.fillRect(a1 - 3, b0, 4, 1); ctx.fillRect(a1, b0, 1, 4);
        ctx.fillRect(a0, b1, 4, 1); ctx.fillRect(a0, b1 - 3, 1, 4); ctx.fillRect(a1 - 3, b1, 4, 1); ctx.fillRect(a1, b1 - 3, 1, 4);
      }
      if (atlas) etiqueta(ctx, t);
    }
    // pela profundidade (y, depois x), por inserção: a lista quase não muda de um quadro para o outro, e o sort do
    // navegador montaria uma cópia a cada quadro
    function ordenar(l) {
      for (let i = 1; i < l.length; i++) {
        const s = l[i];
        let j = i - 1;
        while (j >= 0 && (l[j].y > s.y || (l[j].y === s.y && l[j].x > s.x))) { l[j + 1] = l[j]; j--; }
        l[j + 1] = s;
      }
    }

    function resumo() {   // o que a cidade tem, para o rótulo
      const tem = n => p.pecas.some(s => s.peca === n && s.x > -40 && s.x < W + 40);
      const l = [`${PORTES[p.porte]}`];
      l.push(`um parque com ${p.praca.peca === "lazer-3" ? "lago" : "fonte"}${tem("lazer-4") ? " e coreto" : tem("lazer-5") ? " e feira" : ""}`);
      if (tem("lazer-1")) l.push("campo de futebol");
      if (p.orla) l.push("praia com calçadão, quiosques e mar");
      l.push(p.porte === "metropole" || p.porte === "grande" ? "prédios altos e casas" : "casas com quintal e poucos prédios");
      return l.join(", ");
    }

    const cidade = {
      nome: "cidade", camera, destaque: null,
      entrar(params) {
        id = params.cidade; p = CidadePlanta.planta(id, info(id)); rua = CidadePlanta.sorteio(id + ":rua");
        carros = p.carros.map(c => ({ ...c, x: 0, y: 0 }));
        pedestres = p.pedestres.map((a, i) => {   // b: o boneco do avatar.js, com a aparência da semente local
          const ap = window.Avatar ? Avatar.padrao(a.semente) : null;
          return { ...a, ped: true, festeiro: i % 5 < 3, x: 0, y: 0, b: { x: 0, y: 0, ap, pose: reduzido ? "parado" : "andando", olha: "baixo", semente: i * 7 } };
        });
        // o lado do braço de cada poste: para a rua vertical do cruzamento dele
        postes = p.postes.map(([x, y]) => ({ x, y, poste: true, lado: p.cruzamentos.some(([X]) => X > x && X - x < E) ? 1 : -1 }));
        pecas = [p.centro, p.casa, ...p.pecas, ...postes].sort((a, b) => a.y - b.y || a.x - b.x);   // já na profundidade
        placas = [];   // na quina de cima à direita de cada cruzamento, na frente da quadra de cima
        for (const x of p.ruas.v) for (const y of p.ruas.h) {
          placas.push({ placa: true, x: x + E / 2 + 2, y: y - E / 2 - 2, rv: x, rh: y, a: null, b: null, k: 0 });
        }
        escolhido = null;
        preparar();
        camera.vx = camera.vy = 0; camera.voo = camera.ancora = null;
        if (params.nivel === "bairro" && ehCasa() && !reduzido) {   // voltando do bairro, a câmera sai de perto da casa
          camera.x = p.casa.x; camera.y = p.casa.y - 28; camera.z = 4; camera.zoomPara(1);
        } else { camera.x = W / 2; camera.y = H / 2; camera.z = camera.alvoZ = 1; }
        camera.limitar();
        medirVista(); mover(0); carregar(); clima(); letreiros.pedir();
      },
      sair() { cidade.destaque = null; escolhido = null; },
      quadro,
      clique(x, y) {
        if (naCasa(x, y)) return alvoPorta().acao;
        const n = notavelEm(x, y);
        if (n) return escolher(n);
        escolhido = null;
        return null;
      },
      // o Enter no botão de uma notável: a etiqueta dela, sem procurar pelo ponto
      escolher(alvo) { const n = notaveis.find(m => m.id === alvo); return n ? escolher(n) : null; },
      sobre(x, y) {
        if (naCasa(x, y)) return alvoPorta();
        const n = notavelEm(x, y);
        return n ? alvoNotavel(n) : null;
      },
      alvos() { return [...(portaPronta() ? [alvoPorta()] : []), ...notaveis.map(alvoNotavel)]; },
      mergulho() { return ehCasa() ? [p.casa.x, p.casa.y - 28] : [W / 2, H / 2]; },
      rotulo() {
        const c = mapa.porId.get(id), f = festa ? festa() : null, m = temMarco() ? info(id).marco_nome : "";
        const centro = temMarco() ? `No centro, o marco da cidade${m ? ", " + m : ""}` : "No centro, prédios";
        return `${c ? c.nome : "Cidade"} vista de cima em pixel art: ${resumo()}. ${centro}; ` +
          `pedestres nas calçadas, carros nas ruas e o tempo de agora` +
          (portaPronta() ? ", e o chalé do escritório com a placa" : "") + (f ? `. Hoje é ${f.nome}: a cidade está enfeitada` : "");
      },
      get planta() { return p; },
      get carros() { return carros.map(c => [c.x, c.y]); },
      // cada veículo como [x, y, largura, altura] na tela do mundo (o desenho já girado)
      get veiculos() {
        return carros.map(c => {
          const [, , w, h] = recorte(c.peca) || [0, 0, 26, 14];
          return c.eixo === "h" ? [c.x, c.y, w, h] : [c.x, c.y, h, w];
        });
      },
      get pedestres() { return pedestres.map(a => [a.x, a.y]); },
      get enfeites() { return enfeites.estado; },
      get vida() {
        const e = chao.estado;
        return { ...vida, sombras: e.sombras, forca: e.forca, detalhes: e.detalhes, novos: e.novos, faltam: e.faltam };
      },
    };
    return cidade;
  }
  return { criar, planta: CidadePlanta.planta, W, H };
})();
window.MundoCidade = MundoCidade;
