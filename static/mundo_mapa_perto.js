// Os níveis de detalhe do mapa do Brasil (mundo_mapa.js). Dois níveis por cima do brasil.png, cada um o mesmo mapa numa
// resolução maior, em azulejos pedidos conforme a vista: o de 2x (rodovias e rios menores) e o de 4x (o de 2x dobrado e
// refinado: copas, serras, margens, lavoura, pontes; só os azulejos que tocam o Brasil existem). Um nível vale quando o
// pixel dele fica do tamanho do pixel do mapa a 1x; enquanto um azulejo não chega vale o nível de baixo ampliado, e ele
// entra numa transição curta (sem transição com movimento reduzido); o que falha é pedido de novo depois de ESPERA s.
// As UFs: o mapa delas (o de longe no mundo.json; o de 2x, perto/ufs.json, pedido com o primeiro azulejo), o realce sob
// o cursor (contorno claro e escuro, que segue a divisa do nível em uso, e um leve clareamento) e, a partir de 2x, o
// nome no meio de cada uma. As cidades médias (marcador e nome a partir de 3x) e os nomes dos vizinhos. Nenhum nome
// cobre outro (com folga), um ícone, um nome de capital ou os botões, nem sai cortado da tela: quem não cabe, some.
// Textos, realces e o arranjo dos nomes são feitos uma vez (por vista) e guardados; por quadro, só cópias.
"use strict";
const MapaPerto = (() => {
  const Z_PERTO = 2 - 1e-6, Z_MEDIAS = 2.7, TROCA = 0.25, ESPERA = 8;   // degraus do zoom; TROCA e ESPERA em segundos
  const FOLGA = 4;   // o respiro entre dois nomes, de lado (em unidades de T; em cima e embaixo, 1)
  const LETRAS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const cruza = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const numero = v => Number.isFinite(v);
  // o mapa das UFs em texto corrido (a letra da UF na ordem da lista e quantos pixels) num Uint8Array de índice + 1
  function decodificar(linhas, w, h, total) {
    const mapa = new Uint8Array(w * h);
    (Array.isArray(linhas) ? linhas : []).slice(0, h).forEach((linha, y) => {
      let x = 0;
      for (const [, letra, n] of String(linha).matchAll(/([.a-zA-Z])(\d+)/g)) {
        const k = letra === "." ? 0 : LETRAS.indexOf(letra) + 1, fim = Math.min(w, x + +n);
        if (k && k <= total) mapa.fill(k, y * w + x, y * w + fim);
        x = fim;
      }
    });
    return mapa;
  }
  // as beiradas da região k num mapa w×h, em trechos [vertical, x, y, comprimento, lado]: horizontais (entre a linha y−1
  // e y) e verticais (entre a coluna x−1 e x); lado 1 se a região fica depois da beirada (embaixo, à direita), −1 se antes
  function bordas(mapa, w, h, k) {
    const dentro = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mapa[y * w + x] === k, saida = [];
    for (let y = 0; y <= h; y++) {
      let ini = -1, lado = 0;
      for (let x = 0; x <= w; x++) {
        const l = x < w ? (dentro(x, y) && !dentro(x, y - 1) ? 1 : !dentro(x, y) && dentro(x, y - 1) ? -1 : 0) : 0;
        if (l !== lado) { if (lado) saida.push([false, ini, y, x - ini, lado]); ini = x; lado = l; }
      }
    }
    for (let x = 0; x <= w; x++) {
      let ini = -1, lado = 0;
      for (let y = 0; y <= h; y++) {
        const l = y < h ? (dentro(x, y) && !dentro(x - 1, y) ? 1 : !dentro(x, y) && dentro(x - 1, y) ? -1 : 0) : 0;
        if (l !== lado) { if (lado) saida.push([true, x, ini, y - ini, lado]); ini = y; lado = l; }
      }
    }
    return saida;
  }

  function criar({ dados, reduzido }) {
    const { tela, nitido } = MapaArte;
    const nivel = (dados.niveis && dados.niveis.brasil) || {}, W = nivel.w || 400, H = nivel.h || 400;
    const versao = Number.isInteger(dados.versao) ? dados.versao : 0;

    // --- os níveis de perto, em azulejos ------------------------------------------------------------------------------
    function camada(c, pasta) {   // escala sobre o mapa de longe, n×n azulejos e a máscara dos que existem
      if (!c || !Number.isInteger(c.n) || !numero(c.escala) || !numero(c.azulejo)) return null;
      const mascara = typeof c.azulejos === "string" && c.azulejos.length === c.n * c.n ? c.azulejos : null;
      return { pasta, F: c.escala, N: c.n, LADO: c.azulejo / c.escala, existe: k => !mascara || mascara[k] === "1",
        azulejos: new Array(c.n * c.n).fill(null), pedidos: 0, desenhados: 0 };
    }
    const camadas = [camada(nivel.perto, "perto"), camada(nivel.perto4x, "perto4x")].filter(Boolean);
    let relogio = 0;
    // o nível vale na escala P quando o pixel dele (P/F) chega ao do mapa a 1x arredondado (2 px no desktop, 3 no celular);
    // o de cima (4x), no teto do zoom (o teto do Brasil é escolhido para ele)
    const vale = (c, P, cam) => (c === camadas[camadas.length - 1] && camadas.length > 1
      ? P >= cam.base * (cam.maximo ? cam.maximo() : 4) - 1e-6 : P / c.F >= Math.max(1, Math.round(cam.base)) - 1e-6);
    function pedir(c, k) {
      const img = new Image(), a = { img, pronto: false, alfa: 0, erro: 0 };
      img.addEventListener("load", () => { a.pronto = true; });
      img.addEventListener("error", () => { a.erro = relogio || 1e-6; });
      img.src = `/mundo/${c.pasta}/${k % c.N}-${Math.floor(k / c.N)}.png?v=${versao}`;
      c.pedidos++;
      if (c.pasta === "perto") pedirUfs();
      return (c.azulejos[k] = a);
    }
    // de novo ao voltar ao mapa, o azulejo que falhou (na mesma visita, ele já volta depois de ESPERA s)
    function tentarDeNovo() { for (const c of camadas) c.azulejos.forEach((a, k) => { if (a && a.erro) c.azulejos[k] = null; }); }
    // os azulejos da camada num retângulo do mundo (com um quarto de azulejo de folga), chamando f(k, i, j)
    function cada(c, x0, y0, x1, y1, f) {
      const M = 0.25, L = c.LADO, i0 = Math.max(0, Math.floor(x0 / L - M)), i1 = Math.min(c.N - 1, Math.floor(x1 / L + M));
      const j0 = Math.max(0, Math.floor(y0 / L - M)), j1 = Math.min(c.N - 1, Math.floor(y1 / L + M));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (c.existe(j * c.N + i)) f(j * c.N + i, i, j);
    }
    // os azulejos pedidos: os da vista parada em que o nível vale e, enquanto o zoom anda, só os da vista de chegada (se o
    // nível valer nela; o centro dela sai da âncora do zoom, ou do voo). A 1x, nenhum
    function pedirVista(c, cam) {
      const quer = k => {
        const a = c.azulejos[k];
        if (!a || (a.erro && relogio - a.erro > ESPERA)) pedir(c, k);
      };
      if (cam.alvoZ === cam.z && !cam.voo) {   // (no voo, como no zoom, só a vista de chegada)
        if (vale(c, cam.P, cam)) cada(c, ...cam.mundo(0, 0), ...cam.mundo(cam.W, cam.H), quer);
        return;
      }
      const P = cam.base * cam.alvoZ;
      if (!vale(c, P, cam)) return;
      const a = cam.ancora, v = cam.voo, mw = cam.W / 2 / P, mh = cam.H / 2 / P;
      const x = a ? a.wx - (a.sx - cam.W / 2) / P : v ? v.x : cam.x, y = a ? a.wy - (a.sy - cam.H / 2) / P : v ? v.y : cam.y;
      cada(c, x - mw, y - mh, x + mw, y + mh, quer);
    }
    // o azulejo k da camada já chegou e está inteiro (sem transição) e a camada vale neste quadro: o que fica embaixo dele
    // não precisa ser desenhado (os alfas já foram atualizados por atualizar, antes de qualquer desenho do quadro)
    let valeAgora = [];
    const opaco = (c, k) => { const a = c.azulejos[k]; return !!(a && a.pronto && a.alfa >= 1 && valeAgora[camadas.indexOf(c)]); };
    // a parte à vista do azulejo (i, j) da camada de índice n está coberta pelas camadas de cima, inteiras e opacas
    // (vista: [x0, y0, x1, y1] do mundo; o pedaço do azulejo fora dela não conta)
    function coberto(n, i, j, vista) {
      const c = camadas[n], acima = camadas[n + 1];
      if (!acima) return false;
      const r = c.LADO / acima.LADO, L = acima.LADO;   // quantos azulejos de cima cabem no lado de um de baixo
      for (let b = 0; b < r; b++) for (let a = 0; a < r; a++) {
        const ia = i * r + a, jb = j * r + b, k = jb * acima.N + ia;
        if ((ia + 1) * L <= vista[0] || ia * L >= vista[2] || (jb + 1) * L <= vista[1] || jb * L >= vista[3]) continue;
        if (!acima.existe(k) || (!opaco(acima, k) && !coberto(n + 1, ia, jb, vista))) return false;
      }
      return true;
    }
    const vistaDe = cam => [...cam.mundo(0, 0), ...cam.mundo(cam.W, cam.H)];
    // a vista inteira coberta pelos níveis de perto (então o brasil.png por baixo não é desenhado)
    let cobertaAgora = false;
    function cobre(cam) {
      cobertaAgora = false;
      const c = camadas[0];
      if (!c) return false;
      let tudo = true;
      const vista = vistaDe(cam);
      cada(c, ...vista, (k, i, j) => { if (!opaco(c, k) && !coberto(0, i, j, vista)) tudo = false; });
      const [x0, y0] = cam.mundo(0, 0), [x1, y1] = cam.mundo(cam.W, cam.H);   // a vista toda dentro do mapa (fora dele, mar)
      return (cobertaAgora = tudo && x0 >= 0 && y0 >= 0 && x1 <= W && y1 <= H);
    }
    // o começo do quadro, antes de qualquer desenho: os pedidos e os alfas de todas as camadas (cada nível entrando e saindo
    // numa transição de TROCA segundos), para cobre e coberto olharem o quadro de agora (nunca um buraco na troca)
    function atualizar(cam, dt, pode = true) {   // pode: pedir azulejos novos (não durante a saída do nível)
      relogio += dt;
      valeAgora = camadas.map(c => vale(c, cam.P, cam));
      camadas.forEach((c, n) => {
        if (pode) pedirVista(c, cam);
        const alvo = valeAgora[n] ? 1 : 0;
        cada(c, ...vistaDe(cam), k => {
          const a = c.azulejos[k];
          if (a && a.pronto) a.alfa = reduzido ? alvo : alvo > a.alfa ? Math.min(alvo, a.alfa + dt / TROCA) : Math.max(alvo, a.alfa - dt / TROCA);
        });
      });
    }
    // os azulejos da vista, de baixo para cima, sobre a camada de longe (o ctx já está na escala do mundo); o azulejo coberto
    // pelos de cima (inteiros) não é desenhado
    function terreno(ctx, cam) {
      const vista = vistaDe(cam);
      camadas.forEach((c, n) => {
        c.desenhados = 0;
        cada(c, ...vista, (k, i, j) => {
          const a = c.azulejos[k];
          if (!a || !a.pronto || a.alfa <= 0 || coberto(n, i, j, vista)) return;
          ctx.globalAlpha = a.alfa;
          ctx.drawImage(a.img, i * c.LADO, j * c.LADO, c.LADO, c.LADO);
          c.desenhados++;
        });
      });
      ctx.globalAlpha = 1;
    }

    // --- as UFs: lista, mapas (índice + 1 por pixel) e realce -------------------------------------------------------------
    const dadosUfs = nivel.ufs && typeof nivel.ufs === "object" ? nivel.ufs : {};
    const lista = (Array.isArray(dadosUfs.lista) ? dadosUfs.lista : [])
      .filter(u => u && typeof u.uf === "string" && numero(u.x) && numero(u.y))
      .map(u => ({ uf: u.uf, nome: String(u.nome || u.uf), capital: String(u.capital || ""),
        // onde o nome pode ir: o ponto mais fundo da UF e os de reserva, cada um com a profundidade (x, y, r)
        pontos: [[u.x, u.y, u.r || 1], ...(Array.isArray(u.outros) ? u.outros : [])]
          .filter(p => Array.isArray(p) && p.length === 3 && p.every(numero)).map(([x, y, r]) => [x + 0.5, y + 0.5, r]) }));
    // a grade de longe (400) e, quando chegar, a de 2x (800): o realce usa a do nível em uso, que é a da divisa desenhada
    // (decodificada no primeiro uso: o cursor, o toque ou o foco num estado)
    let longe_ = null;
    const longe = () => longe_ || (longe_ = { w: W, h: H, esc: 1, mapa: decodificar(dadosUfs.mapa, W, H, lista.length) });
    let grade2 = null, pediuUfs = false;
    function pedirUfs() {
      if (pediuUfs) return;
      pediuUfs = true;
      fetch(`/mundo/perto/ufs.json?v=${versao}`, { credentials: "omit", cache: "no-cache" })
        .then(r => (r.ok ? r.json() : null)).catch(() => null)
        .then(d => {
          if (!d || !Number.isInteger(d.w) || !Number.isInteger(d.h) || !Array.isArray(d.mapa)) { pediuUfs = false; return; }
          grade2 = { w: d.w, h: d.h, esc: W / d.w, mapa: decodificar(d.mapa, d.w, d.h, lista.length) };
        });
    }
    const porSigla = new Map(lista.map(u => [u.uf, u]));
    // a UF no ponto (x, y) do mundo, ou null, na mesma grade do contorno desenhado nesta vista (gradeDa)
    const gradeDa = cam => (grade2 && cam && cam.P / cam.base >= Z_PERTO ? grade2 : longe());
    function ufEm(x, y, cam) {
      if (!(x >= 0 && y >= 0 && x < W && y < H)) return null;
      const g = gradeDa(cam), k = g.mapa[Math.floor(y / g.esc) * g.w + Math.floor(x / g.esc)];
      return k ? lista[k - 1] : null;
    }
    // o realce de uma UF numa grade: o preenchimento (um canvas da caixa da UF, copiado na escala do mundo) e as
    // beiradas em trechos, para o contorno ter a mesma espessura em qualquer zoom; feito uma vez por UF e grade
    const realces = new Map();
    function montarRealce(u, g) {
      const k = lista.indexOf(u) + 1;
      let x0 = g.w, y0 = g.h, x1 = -1, y1 = -1;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.mapa[y * g.w + x] === k) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      const c = tela(Math.max(1, x1 - x0 + 1), Math.max(1, y1 - y0 + 1)), ctx = c.getContext("2d");
      ctx.fillStyle = "#fff8e6";
      for (let y = y0; y <= y1; y++) {
        let ini = -1;
        for (let x = x0; x <= x1 + 1; x++) {
          const d = x <= x1 && g.mapa[y * g.w + x] === k;
          if (d && ini < 0) ini = x;
          if (!d && ini >= 0) { ctx.fillRect(ini - x0, y - y0, x - ini, 1); ini = -1; }
        }
      }
      const r = { preenchido: c, x0, y0, bordas: bordas(g.mapa, g.w, g.h, k) };
      realces.set(u.uf + "|" + g.w, r);
      return r;
    }
    // o realce na tela (o ctx em pixels da tela): o leve clareamento e o contorno, claro por dentro e escuro por fora, na
    // grade de 2x a partir de 2x (quando ela já chegou), senão na de longe
    function realce(ctx, cam, u, U) {
      if (!u) return;
      const g = gradeDa(cam);
      const r = realces.get(u.uf + "|" + g.w) || montarRealce(u, g), [ox, oy] = cam.origem(), P = cam.P * g.esc;
      ctx.setTransform(P, 0, 0, P, ox, oy);
      ctx.globalAlpha = 0.2; ctx.drawImage(r.preenchido, r.x0, r.y0); ctx.globalAlpha = 1;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const passo of [0, 1]) {   // o escuro por fora, depois o claro por dentro
        ctx.fillStyle = passo ? "#fff4dc" : "rgba(18,14,22,.8)";
        for (const [vertical, x, y, n, lado] of r.bordas) {   // (x, y): onde o trecho começa, em pixels da grade
          const s = passo ? (lado > 0 ? 0 : -U) : (lado > 0 ? -U : 0);
          if (vertical) ctx.fillRect(Math.round(ox + x * P) + s, Math.round(oy + y * P), U, Math.round(n * P));
          else ctx.fillRect(Math.round(ox + x * P), Math.round(oy + y * P) + s, Math.round(n * P), U);
        }
      }
    }

    // --- nomes: estados (2x), vizinhos (sempre) e cidades médias (3x) --------------------------------------------------
    const medias = (Array.isArray(nivel.medias) ? nivel.medias : [])
      .filter(m => m && typeof m.nome === "string" && numero(m.x) && numero(m.y))
      .map(m => ({ nome: m.nome, uf: String(m.uf || ""), x: m.x + 0.5, y: m.y + 0.5 }));
    const paises = (Array.isArray(nivel.paises) ? nivel.paises : [])
      .filter(p => p && typeof p.nome === "string" && numero(p.x) && numero(p.y))
      .map(p => ({ nome: p.nome, x: p.x + 0.5, y: p.y + 0.5 }));
    const textos = new Map();
    // um texto em Silkscreen (8 px de CSS vezes T) com espaço entre as letras e contorno escuro, guardado
    function texto(s, T, cor, espaco) {
      const chave = s + "|" + T + "|" + cor + "|" + espaco;
      let c = textos.get(chave);
      if (c) return c;
      const fonte = `${8 * T}px Silkscreen, monospace`, medir = tela(1, 1).getContext("2d");
      medir.font = fonte;
      const largura = ch => ((medir.measureText(ch) || {}).width || 6 * T) + espaco * T;
      const w = Math.ceil([...s].reduce((t, ch) => t + largura(ch), -espaco * T)) + 2 * T;
      c = tela(w, 10 * T);
      const g = c.getContext("2d");
      g.font = fonte; g.textBaseline = "top";
      for (const [cor_, desvios] of [["#120e16", [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]]], [cor, [[0, 0]]]]) {
        g.fillStyle = cor_;
        for (const [dx, dy] of desvios) {
          let x = T;
          for (const ch of s) { g.fillText(ch, x + dx * T, T + dy * T); x += largura(ch); }
        }
      }
      textos.set(chave, nitido(c));
      return c;
    }
    let arranjo = { chave: "", lista: [] };
    // onde cada nome cabe nesta vista (refeito só quando a vista ou o que já ocupa a tela mudam): os estados no meio da UF
    // (o nome inteiro se couber nela, senão a sigla), os vizinhos no miolo deles, as cidades médias com o marcador no
    // ponto e o nome à direita (ou à esquerda)
    function arranjar(cam, ocupar, chaveOcupados, T, U) {
      const z = cam.P / cam.base, [ox, oy] = cam.origem();
      const chave = ox + "," + oy + "," + cam.P + "," + cam.W + "," + cam.H + "," + T + "," + chaveOcupados;
      if (chave === arranjo.chave) return arranjo.lista;
      const ocupados = ocupar(), postos = [], tx = x => Math.round(ox + x * cam.P), ty = y => Math.round(oy + y * cam.P);
      // livre: inteiro na tela, a 2·T da borda (a margem dos nomes das capitais) e longe dos outros (FOLGA·T de respiro,
      // para dois nomes vizinhos não se lerem como um)
      const fx = FOLGA * T, solto = r => ({ x: r.x - fx, y: r.y - T, w: r.w + 2 * fx, h: r.h + 2 * T });
      const M = 2 * T, livre = r => r.x >= M && r.y >= M && r.x + r.w <= cam.W - M && r.y + r.h <= cam.H - M &&
        !ocupados.some(o => cruza(o, solto(r))) && !postos.some(o => cruza(o, solto(r)));
      const centrado = (tipo, id, c, x, y) => ({ tipo, id, c, x: tx(x) - (c.width >> 1), y: ty(y) - (c.height >> 1), w: c.width, h: c.height });
      if (z >= Z_PERTO) for (const u of lista) {   // no primeiro ponto livre da UF, o nome se couber na largura dela ali
        const inteiro = texto(u.nome.toUpperCase(), T, "#fff1d6", 2), sigla = texto(u.uf, T, "#fff1d6", 2);
        for (const [x, y, fundo] of u.pontos) {
          const r = centrado("estado", u.uf, inteiro.width <= 2.4 * fundo * cam.P ? inteiro : sigla, x, y);
          if (livre(r)) { postos.push(r); break; }
        }
      }
      for (const p of paises) {
        const r = centrado("pais", p.nome, texto(p.nome.toUpperCase(), T, "#e6dcc4", 3), p.x, p.y);
        if (livre(r)) postos.push(r);
      }
      if (z >= Z_MEDIAS) for (const m of medias) {
        const c = texto(m.nome, T, "#f6eed8", 0), M = 3 * U, mx = tx(m.x) - (M >> 1), my = ty(m.y) - (M >> 1);
        const marca = { tipo: "marca", id: m.nome, x: mx, y: my, w: M, h: M };
        if (!livre(marca)) continue;
        const lados = [mx + M + U, mx - U - c.width].map(x => ({ tipo: "media", id: m.nome, c, x, y: my + (M >> 1) - (c.height >> 1),
          w: c.width, h: c.height, marca }));
        const r = lados.find(l => livre(l));
        if (r) postos.push(marca, r);
      }
      arranjo = { chave, lista: postos };
      return postos;
    }
    // os nomes desta vista; devolve as caixas postas (os marcadores das médias entram como "marca"). ocupar(): as caixas
    // já ocupadas (ícones e nomes das capitais), pedidas só quando a chave delas muda
    function rotulos(ctx, cam, ocupar, chaveOcupados, { T, U, noite }) {
      const postos = arranjar(cam, ocupar, chaveOcupados, T, U);
      for (const r of postos) {
        if (r.tipo === "marca") {   // o marcador da cidade média: um quadradinho escuro com o miolo claro (aceso à noite)
          ctx.fillStyle = "#1d1712"; ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = noite ? "#ffd977" : "#f3e7c4"; ctx.fillRect(r.x + U, r.y + U, r.w - 2 * U, r.h - 2 * U);
          continue;
        }
        ctx.globalAlpha = r.tipo === "estado" ? 0.85 : r.tipo === "pais" ? 0.6 : 1;
        ctx.drawImage(r.c, r.x, r.y);
      }
      ctx.globalAlpha = 1;
      return postos;
    }

    return { atualizar, terreno, cobre, tentarDeNovo, ufEm, realce, rotulos, porSigla, get estados() { return lista; },
      get info() {   // por nível: quantos azulejos pedidos e quantos desenhados no último quadro
        const soma = k => camadas.reduce((t, c) => t + c[k], 0);
        return { pedidos: soma("pedidos"), desenhados: soma("desenhados"), longe: !cobertaAgora,
          niveis: Object.fromEntries(camadas.map(c => [c.pasta, { pedidos: c.pedidos, desenhados: c.desenhados }])) };
      }, get grade() { return grade2 ? grade2.w : W; } };

  }
  return { criar, Z_PERTO, Z_MEDIAS, FOLGA, bordas, decodificar };
})();
window.MapaPerto = MapaPerto;
