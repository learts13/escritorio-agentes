// O chão do nível Cidade (a planta vem de mundo_cidade_planta.js; as peças e a vida da rua, de mundo_cidade.js):
// - grama com manchas de tom e tufos (ruído pelo ponto do mundo, sem ladrilho repetido), asfalto com grão, calçada com
//   meio-fio e juntas, o piso de praça (marco e feira), o concreto das filas de prédios, os caminhos do parque, a cerca ou
//   a sebe de cada lote e o caminho de pedra até a porta, a faixa do meio, as faixas de pedestre, bueiros e setas;
// - no litoral, o calçadão de ondas em preto e branco, a areia e o mar (o mar anda: ondas com a linguagem do mapa e a
//   espuma na beira);
// - a sombra de cada peça no chão, para o lado oposto ao sol: mais longa no fim da tarde, mais fraca com céu fechado e
//   nenhuma à noite. A sombra é o desenho da peça projetado coluna a coluna a partir do pé dela, lido do atlas uma vez.
// Tudo o que não anda é pintado uma vez em ladrilhos de T×T px do mundo, guardados (e refeitos quando o sol muda de
// faixa, a neve chega ou a casa aparece); por quadro, só se copiam os ladrilhos da vista. A partir de 2x (perto), por
// cima: tampas de bueiro, as linhas do estacionamento e flores nos lotes.
"use strict";
const CidadeChao = (() => {
  // T: o lado do ladrilho; por quadro, até REFAZER ladrilhos velhos refeitos e NOVOS ladrilhos pintados pela primeira vez (o
  // resto fica no esboço liso até a vez dele); GUARDAR: quantos ladrilhos ficam guardados (os longe da vista saem antes)
  const T = 128, { E, C } = CidadePlanta, B = E / 2 + C, REFAZER = 3, NOVOS = 8, GUARDAR = 180;
  const FLORES = ["#f4d35e", "#ee6c8a", "#f5f1e6", "#b58cf0"];
  // as funções do Math em nomes locais: os laços por pixel não procuram o Math global a cada chamada
  const { imul, floor, round, abs, sin, max, min, ceil } = Math;
  const DIA = {
    grama: ["#4c873d", "#579446", "#63a14f"], tufo: "#3c7031", tufoClaro: "#79b45f",
    asfalto: ["#34343c", "#393941", "#3f3f48"], remendo: "#2f2f36", meiofio: "#8f8a7d", calcada: "#c9c3b3", junta: "#b9b3a3",
    faixa: "#e9e3c9", zebra: "#dcd8cc", praca: "#d2c39c", pracaJunta: "#c0b089", pracaBorda: "#a8946a",
    concreto: ["#c9c1ae", "#ada592"], concretoJunta: "#bcb4a1", quintal: "#8fca6c", caminho: "#c7b89c", caminhoJunta: "#a99a7e", terra: "#a98a5e",
    sebe: "#2f6a2c", sebeClara: "#4d8f40", cerca: "#e8e1cd", cercaSombra: "#7f7a6c", bueiro: "#202026", grelha: "#5c5c66",
  };
  const NEVE = { ...DIA, grama: ["#dfe7ef", "#e6edf4", "#eef3f8"], tufo: "#c9d4df", tufoClaro: "#f8fbfd", calcada: "#d6dde7",
    junta: "#c8d0db", meiofio: "#9aa3b0", praca: "#dfe5ee", pracaJunta: "#d0d8e3", concreto: ["#d8dee6", "#bfc7d1"],
    concretoJunta: "#cdd4dd", quintal: "#ffffff", remendo: "#41434c",
    asfalto: ["#44464f", "#4a4c56", "#50525c"], sebe: "#9fb2a2", sebeClara: "#e8eef2" };
  const ORLA = { areia: ["#dcc890", "#e3d29c", "#d4be84"], molhada: "#c4ad78", concha: "#f4ecd6", preto: "#2a2a30", branco: "#efede6" };
  // o mar da cidade fala a língua do mar do mapa (mundo_terreno.CORES): do raso claro na beira ao fundo com ondas
  const MAR = { raso_claro: "#3a7a99", raso: "#2a5a7c", mar: "#1d3b5c", fundo: "#1a3452", espuma: "#e8f3f6", brilho: "#9fd0e0" };
  const SOMBRA = [22, 30, 40];

  // ruído pelo ponto do mundo: hash inteiro, e o de valor (bilinear e suavizado) em células de cw×ch
  function hash(x, y, s) {
    let h = (imul(x, 374761393) + imul(y, 668265263) + imul(s, 1442695041)) | 0;
    h = imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  // o ruído de valor numa tabela de 256×256 que emenda nas bordas: os nós de uma grade de cw×ch sorteados uma vez e,
  // entre eles, a mistura suavizada
  function valor(cw, ch, s) {
    const nx = 256 / cw, ny = 256 / ch, no = new Float32Array(nx * ny), t = new Float32Array(65536);
    const X0 = new Uint8Array(256), X1 = new Uint8Array(256), FX = new Float32Array(256);   // por coluna, uma vez
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) no[j * nx + i] = hash(i, j, s);
    for (let x = 0; x < 256; x++) {
      const cx = floor(x / cw), f = x / cw - cx;
      X0[x] = cx; X1[x] = (cx + 1) % nx; FX[x] = f * f * (3 - 2 * f);
    }
    for (let y = 0; y < 256; y++) {
      const cy = floor(y / ch), y0 = cy * nx, y1 = ((cy + 1) % ny) * nx, g = y / ch - cy, fy = g * g * (3 - 2 * g), base = y * 256;
      for (let x = 0; x < 256; x++) {
        const fx = FX[x], a = no[y0 + X0[x]], b = no[y0 + X1[x]], c = no[y1 + X0[x]], d = no[y1 + X1[x]];
        t[base + x] = a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
      }
    }
    return t;
  }
  // o ruído em tabelas de 256×256 (o x e o y entram com & 255), feitas uma vez: FINA (manchas de 16×8), LARGA (de 64×32)
  // e GRAO (um sorteio por pixel). Delas sai, por paleta, a cor pronta de cada material
  let FINA = null, LARGA = null, GRAO = null;
  function tabelas() {
    if (FINA) return;
    FINA = valor(16, 8, 1); LARGA = valor(64, 32, 2); GRAO = new Float32Array(65536);
    for (let k = 0; k < 65536; k++) GRAO[k] = hash(k & 255, k >> 8, 3);
  }
  // as cores de grama (manchas de três tons, borda pontilhada e tufos de capim), asfalto (grão e remendos) e areia
  // (manchas e conchinhas) de uma paleta, pixel a pixel da tabela
  function texturas(cor) {
    if (cor.texturas) return cor.texturas;
    tabelas();
    const t = { grama: new Uint32Array(65536), asfalto: new Uint32Array(65536), areia: new Uint32Array(65536) };
    const grama = cor.grama.map(pack), asf = cor.asfalto.map(pack), remendo = pack(cor.remendo), areia = ORLA.areia.map(pack);
    const concha = pack(ORLA.concha), tufo = pack(cor.tufo), claro = pack(cor.tufoClaro);
    for (let k = 0; k < 65536; k++) {
      const n = GRAO[k], g = FINA[k] * 0.62 + LARGA[k] * 0.38 + (n - 0.5) * 0.3, a = LARGA[k] * 0.6 + FINA[k] * 0.4;
      t.grama[k] = grama[g < 0.4 ? 0 : g < 0.66 ? 1 : 2];
      t.asfalto[k] = LARGA[k] > 0.8 && FINA[k] > 0.55 && n < 0.85 ? remendo : asf[n < 0.07 ? 2 : n > 0.95 ? 0 : 1];
      t.areia[k] = n < 0.004 ? concha : areia[a < 0.36 ? 2 : a < 0.62 ? 0 : 1];
    }
    for (let k = 512; k < 65536; k++) {   // um "v" de capim aqui e ali
      if (GRAO[(k * 7 + 13) & 65535] >= 0.004) continue;
      t.grama[k] = claro; t.grama[k - 1] = tufo; t.grama[k - 258] = tufo;
    }
    return (cor.texturas = t);
  }
  const mod = (a, n) => ((a % n) + n) % n;
  const MARGEM = Int8Array.from({ length: 64 }, (_, j) => Math.round(2 * Math.sin(j * Math.PI / 32) + Math.sin(j * Math.PI / 8)));
  const rgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const pack = h => { const [r, g, b] = rgb(h); return (255 << 24 | b << 16 | g << 8 | r) >>> 0; };   // RGBA em little-endian
  // a linha d'água: ondula devagar ao longo da praia
  const beira = (o, y) => o.mar + round(2.5 * sin(y / 23) + 1.5 * sin(y / 9 + 1));

  function criar({ recorte, atlas }) {
    let p = null, pecas = [], nome = s => s.peca, telas = new Map(), alfa = null, alfaW = 0, sombras = new Map(), onda = null;
    const estado = { sombras: 0, ladrilhos: 0, refeitos: 0, novos: 0, faltam: 0, detalhes: 0, chave: "" };
    const prontos = [];   // os ladrilhos da vista neste quadro (reaproveitado)
    let xDe = s => s.x;   // o x em que a peça é desenhada (a fonte anda para o lado numa festa em praça estreita)

    // o planta nova (outra cidade): os ladrilhos velhos saem
    function preparar(planta, lista, nomeDe, xDaPeca) {
      p = planta; pecas = lista; nome = nomeDe; xDe = xDaPeca || xDe; telas.clear();
    }

    // o sol de agora em faixas (para não refazer o chão a cada minuto): direção x da sombra por altura e a força
    function sol(ceu, tipo) {
      const h = Number.isFinite(ceu.h) ? ceu.h : 12, escuro = max(0, min(1, ceu.escuro || 0));
      const fechado = { nublado: 0.6, neblina: 0.35, garoa: 0.55, chuva: 0.45, tempestade: 0.35, neve: 0.6 }[tipo] || 1;
      const forca = round(max(0, 1 - escuro / 0.5) * fechado * 4) / 4;   // à noite (escuro de 0,5 para cima), 0
      const k = max(-1, min(1, (h - 12) / 6)), sx = round(k * 0.85 / 0.15) * 0.15;
      return { sx: round(sx * 100) / 100, sy: round((0.14 + 0.1 * abs(k)) * 50) / 50, forca };
    }

    // o alfa do atlas, lido uma vez por imagem (sem getImageData, nenhuma sombra)
    let lido = null;
    function lerAlfa() {
      const img = atlas();
      if (alfa || !img || lido === img) return alfa;
      lido = img;
      try {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, w, h);
        if (w > 0 && h > 0 && d && d.data && d.data.length >= w * h * 4) {
          alfa = d.data; alfaW = w;   // RGBA: o alfa do pixel i fica em alfa[i * 4 + 3]
        }
      } catch (e) { alfa = null; }
      return alfa;
    }
    // a sombra de uma peça para um sol: cada pixel opaco sobe z acima do pé da coluna (o pixel opaco mais baixo dela) e
    // cai no chão a (z·sx, z·sy) do pé; mais o contorno da peça um pixel abaixo, para ela assentar
    function sombra(peca, sx, sy) {
      const chave = peca + "|" + sx + "|" + sy;
      if (sombras.has(chave)) return sombras.get(chave);
      const r = recorte(peca), a = lerAlfa();
      let s = null;
      if (r && a) {
        const [ax, ay, w, h] = r, esq = ceil(max(0, -sx) * h) + 1, larg = w + ceil(abs(sx) * h) + 2;
        const alto = h + ceil(sy * h) + 2, m = new Uint8Array(larg * alto);
        let cheios = 0;
        for (let x = 0; x < w; x++) {
          let pe = -1;
          for (let y = h - 1; y >= 0 && pe < 0; y--) if (a[((ay + y) * alfaW + ax + x) * 4 + 3]) pe = y;
          if (pe < 0) continue;
          for (let y = 0; y <= pe; y++) {
            if (!a[((ay + y) * alfaW + ax + x) * 4 + 3]) continue;
            const z = pe - y, X = esq + x + round(z * sx), Y = pe + 1 + round(z * sy);
            if (X >= 0 && X < larg && Y < alto) { m[Y * larg + X] = 1; cheios++; }
            if (y + 1 < alto) m[(y + 1) * larg + esq + x] = 1;
          }
        }
        if (!cheios) { sombras.set(chave, null); return null; }   // peça sem pixel opaco: sem sombra
        const c = document.createElement("canvas"); c.width = larg; c.height = alto;
        const g = c.getContext("2d"), d = g.getImageData(0, 0, larg, alto);
        if (d && d.data) {
          for (let i = 0; i < m.length; i++) {
            if (m[i]) { d.data[i * 4] = SOMBRA[0]; d.data[i * 4 + 1] = SOMBRA[1]; d.data[i * 4 + 2] = SOMBRA[2]; d.data[i * 4 + 3] = 255; }
          }
          g.putImageData(d, 0, 0);
        }
        s = { c, esq, w, h };
      }
      sombras.set(chave, s);
      return s;
    }

    // o material de um ponto: a distância (com sinal) ao eixo da rua vertical e da horizontal mais perto
    function eixo(u, ruas, d0, passo) {
      if (ruas.length < 2) return 1e9;
      const k = max(0, min(ruas.length - 1, round((u - d0) / passo)));
      return u - ruas[k];
    }
    // os pixels de base do ladrilho: grama, asfalto, calçada com meio-fio, areia, calçadão e o fundo do mar. A distância
    // ao eixo da rua vertical sai uma vez por coluna e a da horizontal uma vez por linha; as cores vão empacotadas
    const AX = new Float32Array(T);
    function pixels(g, X0, Y0, cor) {
      const d = g.getImageData(0, 0, T, T);
      if (!d || !d.data || d.data.length < T * T * 4) { g.fillStyle = cor.grama[1]; g.fillRect(0, 0, T, T); return; }
      const px = new Uint32Array(d.data.buffer, d.data.byteOffset, T * T), { v, h } = p.ruas, o = p.orla, tx = texturas(cor);
      const dv = v.length > 1 ? v[1] - v[0] : 1, dh = h[1] - h[0], grama = tx.grama, asfalto = tx.asfalto, areia = tx.areia;
      const calc = pack(cor.calcada), junta = pack(cor.junta), mf = pack(cor.meiofio), molhada = pack(ORLA.molhada);
      const preto = pack(ORLA.preto), branco = pack(ORLA.branco), fundo = pack(MAR.fundo), fimX = o ? o.x : Infinity;
      const rasoClaro = pack(MAR.raso_claro), raso = pack(MAR.raso), marC = pack(MAR.mar);
      for (let i = 0; i < T; i++) AX[i] = abs(eixo(X0 + i, v, v[0], dv) + 0.5);
      for (let j = 0; j < T; j++) {
        const y = Y0 + j, ay = abs(eixo(y, h, h[0], dh) + 0.5), noH = ay < E / 2, ladoH = ay < B, beiraH = floor(ay) === E / 2;
        const ry = (y & 255) << 8, b = o ? beira(o, y) : 0, base = j * T, tijolo = ((y >> 2) & 1) * 3, linha = (y & 3) === 0;
        for (let i = 0; i < T; i++) {
          const x = X0 + i, k = base + i, rx = x & 255;
          if (x >= fimX) {   // a orla: o calçadão de ondas pretas e brancas, a areia (molhada na beira) e o mar em faixas
            if (x < o.areia) px[k] = mod(x - o.x + round(2.2 * sin(y * 0.349)), 8) < 3 ? preto : branco;
            else if (x < b - 3) px[k] = areia[ry + rx];
            else if (x < b) px[k] = molhada;
            else {
              const u = x - b;
              px[k] = u < 9 + MARGEM[y & 63] ? rasoClaro : u < 20 + MARGEM[(y + 21) & 63] ? raso : u < 34 + MARGEM[(y + 42) & 63] ? marC : fundo;
            }
            continue;
          }
          const ax = AX[i];
          if (ax < E / 2 || noH) px[k] = asfalto[ry + rx];
          else if (ax < B || ladoH) {   // calçada: meio-fio junto da rua e juntas em tijolinho
            if ((ax < B && floor(ax) === E / 2) || (ladoH && beiraH)) px[k] = mf;
            else px[k] = linha || mod(x + tijolo, 6) === 0 ? junta : calc;
          } else px[k] = grama[ry + rx];
        }
      }
      g.putImageData(d, 0, 0);
    }

    // por cima dos pixels: pisos, cercas e caminhos, a pintura da rua, bueiros e setas (em coordenadas do mundo)
    function desenhos(g, X0, Y0, cor) {
      const x1 = X0 + T, y1 = Y0 + T, dentro = r => r[2] > X0 && r[0] < x1 && r[3] > Y0 && r[1] < y1, o = p.orla;
      const ret = (c, x, y, w, h) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
      for (const { r, piso } of p.pisos) {
        if (!dentro(r)) continue;
        const [a, b, c, d] = r, w = c - a, h = d - b;
        if (piso === "parque") {   // caminhos de terra batida em cruz, com borda de pedra
          const mx = round((a + c) / 2), my = round((b + d) / 2);
          ret(cor.caminhoJunta, mx - 3, b, 7, h); ret(cor.caminhoJunta, a, my - 3, w, 7);
          ret(cor.caminho, mx - 2, b, 5, h); ret(cor.caminho, a, my - 2, w, 5);
          continue;
        }
        if (piso === "praca") {   // pedra portuguesa: juntas em grade, a borda escura e um losango de pedra mais escura
          ret(cor.praca, a, b, w, h);
          g.fillStyle = cor.pracaJunta;
          for (let x = a + 3; x < c; x += 6) g.fillRect(x, b, 1, h);
          for (let y = b + 3; y < d; y += 6) g.fillRect(a, y, w, 1);
          g.fillStyle = cor.pracaBorda;
          g.fillRect(a + 2, b + 2, w - 4, 1); g.fillRect(a + 2, d - 3, w - 4, 1);
          g.fillRect(a + 2, b + 2, 1, h - 4); g.fillRect(c - 3, b + 2, 1, h - 4);
          continue;
        }
        // o piso das filas de prédios: lajotas claras de 16×12 com a junta discreta e a borda um tom abaixo
        ret(cor.concreto[0], a, b, w, h);
        g.fillStyle = cor.concretoJunta;
        for (let x = a + 8; x < c; x += 16) g.fillRect(x, b, 1, h);
        for (let y = b + 6; y < d; y += 12) g.fillRect(a, y, w, 1);
        g.fillStyle = cor.concreto[1];
        g.fillRect(a, b, w, 1); g.fillRect(a, d - 1, w, 1); g.fillRect(a, b, 1, h); g.fillRect(c - 1, b, 1, h);
      }
      for (const { r, tipo, porta } of p.cercas) {   // o quintal: grama aparada em faixas e a sebe baixa ou a cerca de ripas
        if (!dentro(r)) continue;
        const [a, b, c, d] = r, w = c - a - 2, h = d - b - 2, fx = a + 1, fy = b + 1, fim = d - 2, lado = round(h * 0.55);
        g.globalAlpha = 0.22; g.fillStyle = cor.quintal;
        for (let y = fy + 2; y < fim - 1; y += 8) g.fillRect(fx + 2, y, w - 4, min(4, fim - 1 - y));
        g.globalAlpha = 1;
        if (porta != null) {   // o caminho de pedras da calçada até a porta
          ret(cor.caminhoJunta, porta - 3, fim - 7, 6, 9);
          g.fillStyle = cor.caminho;
          for (let y = fim - 7; y < d; y += 3) { g.fillRect(porta - 3, y, 2, 2); g.fillRect(porta, y + 1, 3, 2); }
        }
        const gap = x => porta != null && abs(x - porta) <= 3;
        if (tipo === "sebe") {   // a sebe em volta do lote todo, com folhas claras em cima
          for (let x = fx; x < fx + w; x++) {
            ret(cor.sebe, x, fy, 1, 2);
            if (!gap(x)) { ret(cor.sebe, x, fim - 1, 1, 2); if (x % 2) ret(cor.sebeClara, x, fim - 1, 1, 1); }
          }
          ret(cor.sebe, fx, fy, 2, h); ret(cor.sebe, fx + w - 2, fy, 2, h);
          g.fillStyle = cor.sebeClara;
          for (let y = fy; y < fy + h; y += 2) { g.fillRect(fx, y, 1, 1); g.fillRect(fx + w - 2, y, 1, 1); }
        } else {   // a cerca de ripas na frente e meio lote de cada lado
          for (let x = fx; x < fx + w; x++) {
            if (gap(x)) continue;
            ret(cor.cercaSombra, x, fim + 1, 1, 1);
            ret(x % 3 ? cor.cerca : cor.cercaSombra, x, fim - (x % 3 ? 0 : 1), 1, x % 3 ? 1 : 2);
          }
          ret(cor.cerca, fx, fim - lado, 1, lado); ret(cor.cerca, fx + w - 1, fim - lado, 1, lado);
          ret(cor.cercaSombra, fx + 1, fim - lado, 1, lado); ret(cor.cercaSombra, fx + w, fim - lado, 1, lado);
        }
      }
      if (o && x1 > o.mar) {   // as ondas do alto-mar, as mesmas do mapa (MapaArte.ladrilhoMar), só na parte funda
        if (!onda && window.MapaArte) onda = MapaArte.ladrilhoMar();
        if (onda) {
          g.save(); g.beginPath(); g.moveTo(x1, Y0);
          for (let y = Y0; y <= y1; y++) g.lineTo(beira(o, y) + 34 + MARGEM[(y + 42) & 63] + 2, y);
          g.lineTo(x1, y1); g.closePath(); g.clip();
          for (let y = floor(Y0 / 28) * 28; y < y1; y += 28) for (let x = floor(X0 / 44) * 44; x < x1; x += 44) g.drawImage(onda, x, y);
          g.restore();
        }
      }
      const { v, h } = p.ruas, longe = (u, ruas) => ruas.every(r => abs(u - r) > B + 2), fimH = o ? o.x : x1;
      g.fillStyle = cor.faixa;   // o tracejado do meio para antes das faixas de pedestre
      for (const y of h) if (y > Y0 - E && y < y1 + E) {
        for (let x = floor(X0 / 16) * 16; x < min(x1, fimH - 8); x += 16) if (longe(x, v) && longe(x + 8, v)) g.fillRect(x, y - 1, 8, 2);
      }
      for (const x of v) if (x > X0 - E && x < x1 + E) {
        for (let y = floor(Y0 / 16) * 16; y < y1; y += 16) if (longe(y, h) && longe(y + 8, h)) g.fillRect(x - 1, y, 2, 8);
      }
      for (const x of v) for (const y of h) {   // faixas de pedestre, bueiros na sarjeta e setas em algumas pistas
        if (x - B - 30 > x1 || x + B + 30 < X0 || y - B - 30 > y1 || y + B + 30 < Y0) continue;
        const praia = o && x + E / 2 >= o.x;   // na avenida da praia, a rua horizontal acaba: sem faixa do lado do mar
        g.fillStyle = cor.zebra;
        for (let u = -E / 2 + 2; u < E / 2 - 1; u += 4) {
          g.fillRect(x + u, y - B + 1, 2, C - 2); g.fillRect(x + u, y + E / 2 + 1, 2, C - 2);
          g.fillRect(x - B + 1, y + u, C - 2, 2);
          if (!praia) g.fillRect(x + E / 2 + 1, y + u, C - 2, 2);
        }
        const n = hash(x, y, 21);
        for (const [bx, by, w, hh] of [[x - B - 6, y - E / 2, 4, 1], [x + B + 2, y + E / 2 - 1, 4, 1], [x - E / 2, y + B + 3, 1, 4]]) {
          if (praia && bx > x) continue;
          ret(cor.bueiro, bx, by, w, hh);
          g.fillStyle = cor.grelha;
          for (let q = 1; q < max(w, hh); q += 2) g.fillRect(w > 1 ? bx + q : bx, w > 1 ? by : by + q, 1, 1);
        }
        if (n < 0.5) {   // a seta na pista da mão, antes do cruzamento
          const sxp = x - B - 18, syp = y + 6;
          g.fillStyle = cor.faixa;
          g.fillRect(sxp, syp, 6, 1); g.fillRect(sxp + 5, syp - 1, 1, 3); g.fillRect(sxp + 6, syp, 1, 1);
        }
      }
    }
    // as sombras das peças que caem no ladrilho
    function sombrear(g, X0, Y0, s0) {
      if (!s0.forca) return 0;
      let n = 0;
      g.globalAlpha = 0.34 * s0.forca;
      for (const s of pecas) {
        const nm = nome(s), r = nm && recorte(nm);
        if (!r) continue;
        const w = r[2], h = r[3], x0 = round(xDe(s) - w / 2), y0 = round(s.y - h);
        const ex = abs(s0.sx) * h + 2;
        if (x0 - ex > X0 + T || x0 + w + ex < X0 || y0 > Y0 + T || s.y + s0.sy * h + 2 < Y0) continue;
        const sm = sombra(nm, s0.sx, s0.sy);
        if (sm) { g.drawImage(sm.c, x0 - sm.esq, y0); n++; }
      }
      g.globalAlpha = 1;
      return n;
    }
    // o ladrilho (tx, ty) pintado com a chave de agora, ou null se ainda não deu a vez dele (NOVOS por quadro)
    function ladrilho(tx, ty, chave, cor, s0) {
      let l = telas.get(tx * 100003 + ty);
      if (!l) {
        if (estado.novos >= NOVOS) return null;
        const c = document.createElement("canvas"); c.width = c.height = T;
        l = { c, chave: null, tx, ty };
        telas.set(tx * 100003 + ty, l);
      }
      if (l.chave === null && estado.novos++ >= NOVOS) return null;
      if (l.chave !== chave && (l.chave === null || estado.refeitos < REFAZER)) {
        const g = l.c.getContext("2d"), X0 = tx * T, Y0 = ty * T;
        g.setTransform(1, 0, 0, 1, 0, 0);
        pixels(g, X0, Y0, cor);
        g.setTransform(1, 0, 0, 1, -X0, -Y0);
        desenhos(g, X0, Y0, cor);
        estado.sombras += sombrear(g, X0, Y0, s0);
        g.setTransform(1, 0, 0, 1, 0, 0);
        if (l.chave !== null) estado.refeitos++;
        l.chave = chave;
      }
      return l.c;
    }

    // o mar que anda (o fundo e as faixas já estão no chão): a espuma que sobe e desce na areia, a crista da onda que vem
    // chegando no raso e os brilhos de sol, como os do mapa. Trechos de linhas iguais vão num retângulo só. Parado com
    // movimento reduzido (t fixo)
    function mar(ctx, vista, t) {
      const o = p.orla;
      if (!o || vista[2] < o.mar - 8) return;
      const y0 = floor(vista[1]) - 1, y1 = ceil(vista[3]) + 1, vai = sin(t / 1300), chega = floor(t / 140);
      for (let f = 0; f < 2; f++) {   // a espuma (f = 0) e a crista da onda (f = 1), em trechos de linhas iguais
        ctx.fillStyle = f ? MAR.brilho : MAR.espuma;
        let ini = y0, xa = null;
        for (let y = y0; y <= y1; y++) {
          const b = beira(o, y), x = y === y1 ? null
            : f ? b + 22 - ((chega + floor(y / 37) * 9) % 22) : b - 1 + round(1.5 + 1.5 * vai + sin(y / 11 + t / 1700));
          if (x === xa) continue;
          if (xa !== null) ctx.fillRect(xa, ini, f ? 1 : 2, y - ini);
          ini = y; xa = x;
        }
      }
      ctx.fillStyle = MAR.espuma;
      for (let y = y0; y < y1; y++) if (hash(y, floor(t / 700), 31) < 0.05) ctx.fillRect(beira(o, y) + 30 + floor(hash(y, 3, 32) * 160), y, 2, 1);
    }

    function tampa(ctx, tx, ty) {   // a tampa de bueiro, redonda, com dois furos claros
      ctx.fillStyle = "#26262c"; ctx.fillRect(tx - 1, ty, 3, 1); ctx.fillRect(tx - 2, ty + 1, 5, 2); ctx.fillRect(tx - 1, ty + 3, 3, 1);
      ctx.fillStyle = "#4a4a54"; ctx.fillRect(tx - 1, ty + 1, 1, 1); ctx.fillRect(tx + 1, ty + 2, 1, 1);
    }
    // a partir de 2x: tampas de bueiro no asfalto, as linhas do estacionamento junto ao meio-fio e flores nos lotes
    function detalhes(ctx, vista) {
      const { v, h } = p.ruas, [vx0, vy0, vx1, vy1] = vista;
      let n = 0;
      for (const x of v) for (const y of h) {
        if (x < vx0 - 120 || x > vx1 + 120 || y < vy0 - 120 || y > vy1 + 120) continue;
        const praia = p.orla && x >= p.orla.x - E;
        tampa(ctx, x - 60, y - 4); n++;   // as tampas, redondas, no meio da pista
        if (!praia) { tampa(ctx, x + 5, y - 64); n++; }
        ctx.fillStyle = "#d8d2bc";   // vagas de estacionamento: tracinhos junto ao meio-fio, na mão de baixo
        if (!praia) for (let u = x + B + 22; u < x + B + 110; u += 13) { ctx.fillRect(u, y + E / 2 - 6, 1, 5); n++; }
        for (let u = y + B + 20; u < y + B + 90; u += 13) { ctx.fillRect(x - E / 2 + 1, u, 5, 1); n++; }
      }
      for (const { r } of p.cercas) {   // canteirinhos de flor nos cantos de dentro de cada lote
        if (r[2] < vx0 || r[0] > vx1 || r[3] < vy0 || r[1] > vy1) continue;
        for (let i = 0; i < 4; i++) {
          const fx = r[0] + 4 + floor(hash(r[0], r[1], 40 + i) * (r[2] - r[0] - 8)), fy = r[3] - 5 - (i % 2) * floor((r[3] - r[1]) * 0.6);
          ctx.fillStyle = "#3c7031"; ctx.fillRect(fx - 1, fy + 1, 4, 1);
          ctx.fillStyle = FLORES[floor(hash(fx, fy, 41) * FLORES.length)]; ctx.fillRect(fx, fy, 1, 1); ctx.fillRect(fx + 2, fy, 1, 1);
          n++;
        }
      }
      return n;
    }

    // o chão da vista: ladrilhos (feitos ou refeitos aqui), o mar e, perto, os detalhes. ceu: Ceu.agora(); tipo: do Clima
    // antes do atlas (um instante, na primeira entrada): só a grama e as ruas lisas, sem pintar ladrilho nenhum
    function esboco(ctx, vista, cor) {
      const { v, h } = p.ruas, x0 = floor(vista[0]), y0 = floor(vista[1]), w = ceil(vista[2] - vista[0]) + 1, hh = ceil(vista[3] - vista[1]) + 1;
      ctx.fillStyle = cor.grama[1]; ctx.fillRect(x0, y0, w, hh);
      ctx.fillStyle = cor.calcada;
      for (const x of v) ctx.fillRect(x - B, y0, 2 * B, hh);
      for (const y of h) ctx.fillRect(x0, y - B, p.orla ? p.orla.x - x0 : w, 2 * B);
      ctx.fillStyle = cor.asfalto[1];
      for (const x of v) ctx.fillRect(x - E / 2, y0, E, hh);
      for (const y of h) ctx.fillRect(x0, y - E / 2, p.orla ? p.orla.x - x0 : w, E);
      if (p.orla) {
        ctx.fillStyle = ORLA.areia[0]; ctx.fillRect(p.orla.x, y0, p.orla.mar - p.orla.x, hh);
        ctx.fillStyle = MAR.raso; ctx.fillRect(p.orla.mar, y0, w, hh);
      }
    }
    // o sol de agora e a chave dos ladrilhos, refeitos só quando algo muda (nada montado por quadro)
    let s0 = null, chave = { texto: "", tipo: null }, antes = -1;
    function chaveDe(neve, ceu, tipo, casa, desvio) {
      const h = Number.isFinite(ceu.h) ? floor(ceu.h * 4) : 48, e = round((ceu.escuro || 0) * 20), a = !!lerAlfa();
      const k = (neve ? 1 : 0) + (casa ? 2 : 0) + (a ? 4 : 0) + h * 8 + e * 1000 + desvio * 100000;
      if (k !== antes || tipo !== chave.tipo) {
        const novo = sol(ceu, tipo), c = `${neve ? 1 : 0}|${casa ? 1 : 0}|${novo.sx}|${novo.sy}|${novo.forca}|${a}|${desvio}`;
        antes = k;
        if (!s0 || c !== chave.texto) { s0 = novo; chave = { texto: c, tipo }; } else chave.tipo = tipo;
      }
      return chave.texto;
    }
    function desenhar(ctx, vista, op) {
      if (!p) return;
      const cor = op.neve ? NEVE : DIA;
      if (!atlas()) { esboco(ctx, vista, cor); estado.forca = estado.detalhes = estado.novos = 0; estado.faltam = 1; return; }
      const k = chaveDe(op.neve, op.ceu, op.tipo, op.casa, op.desvio || 0);
      if (k !== estado.chave) { estado.chave = k; estado.sombras = 0; }
      estado.refeitos = estado.novos = 0;
      const tx0 = floor(vista[0] / T), tx1 = floor(vista[2] / T), ty0 = floor(vista[1] / T), ty1 = floor(vista[3] / T);
      if (telas.size > GUARDAR) for (const [chaveT, l] of telas) {   // os ladrilhos longe da vista saem
        if (l.tx < tx0 - 2 || l.tx > tx1 + 2 || l.ty < ty0 - 2 || l.ty > ty1 + 2) telas.delete(chaveT);
      }
      let n = 0, faltam = 0;
      prontos.length = 0;   // primeiro os ladrilhos (os que ainda não têm a vez ficam null), depois o desenho
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
        const c = ladrilho(tx, ty, k, cor, s0);
        prontos.push(c);
        if (!c) faltam++;
      }
      if (faltam) esboco(ctx, vista, cor);   // por baixo dos que faltam, o esboço liso
      let i = 0;
      for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++, i++) if (prontos[i]) { ctx.drawImage(prontos[i], tx * T, ty * T); n++; }
      estado.ladrilhos = n; estado.faltam = faltam;
      mar(ctx, vista, op.t);
      estado.detalhes = op.perto ? detalhes(ctx, vista) : 0;
      estado.forca = s0.forca;
    }

    // o pixel (lx, ly) do recorte da peça é opaco? (sem o alfa do atlas, não)
    function opaco(peca, lx, ly) {
      const r = recorte(peca), a = lerAlfa();
      if (!r || !a || lx < 0 || ly < 0 || lx >= r[2] || ly >= r[3]) return false;
      return a[((r[1] + ly) * alfaW + r[0] + lx) * 4 + 3] > 0;
    }

    return { preparar, desenhar, estado, sol, opaco };
  }
  return { criar, T, hash };
})();
window.CidadeChao = CidadeChao;
