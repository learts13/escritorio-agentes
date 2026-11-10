// Os desenhos por código do mapa do Brasil (mundo_mapa.js): os sprites em texto (ícones genéricos, o chalé da casa, o
// avião sem o atlas e o barco), as nuvens em pixel, o brilho quente da noite e a rosa dos ventos, cada um pintado uma
// vez num canvas pequeno e guardado (depois só copiado). Sem estado do mapa: só formas e cores.
"use strict";
const MapaArte = (() => {
  // sprites em texto: cada letra é uma cor da paleta, "." é vazio. A base do ícone fica no ponto da cidade.
  const PEQUENA = ["...kkkk", "...kaak", "...kjjk", "kkkkaak", "kjakjjk", "kajkaak", "kjakjjk", "kkkkkkk"];
  const GRANDE = [".....k.....", "...kkkkk...", "...kajak...", "...kaaakkkk", "...kajakajk", "kkkkaaakaak",
    "kjjkajakajk", "kaakaaakaak", "kjjkajakajk", "kaakaaakaak", "kkkkkkkkkkk"];
  // a casa deste escritório: um chalé de telhado vermelho, chaminé e porta, maior que os ícones genéricos
  const CHALE = [".......k.....", "......kRk.kk.", ".....kRRrkkck", "....kRRRrrkck", "...kRRRRrrrk.", "..kRRRRRrrrrk",
    ".kRRRRRRrrrrk", "kkkkkkkkkkkkk", ".kaaaaaaaaak.", ".kajjakdkajk.", ".kajjakdkajk.", ".kaaaakdkaak.", "kkkkkkkkkkkkk"];
  const AVIAO = ["....g......", "....gg.....", "t...ggg....", "twwwwwwwwwc", "t...ggg....", "....gg.....", "....g......"];   // para o leste
  const BARCO = ["...m...", "..wmv..", ".wwmvv.", "hhhhhhh", ".hhhhh."];   // vela para a esquerda (o barco anda para a esquerda)
  // o barco de perto (3x): vela grande com a sombra dela, a flâmula no mastro, casco com a faixa escura e a linha d'água
  const BARCO_G = ["....mt...", "...wm....", "..wwmv...", ".wwwmvv..", "wwwwmvvv.", "....m....", "hhhhhhhhh", ".hHHHHHh.", "..HHHHH.."];
  const DIA = { k: "#25301f", a: "#e6e0cc", j: "#7d9bbb", r: "#a8402c", R: "#d0583a", d: "#5a3a26", o: "#f5c84d", w: "#f2f5f8",
    g: "#b8c4d2", c: "#28374f", t: "#d8473a", m: "#5a3a26", v: "#c9c4b6", h: "#8a4a2a", H: "#4e2a19" };
  const NOITE = { k: "#0c1120", a: "#454b62", j: "#ffd977", r: "#4a2a2a", R: "#5e3434", d: "#ffd977", o: "#f5c84d", w: "#a4adc0",
    g: "#6c768a", c: "#ffe9a8", t: "#7a3a3a", m: "#2a2030", v: "#7a7a88", h: "#3a2a2a", H: "#241818" };
  const CORES_NUVEM = { branca: ["#ffffff", "#eef2f6", "#c4ccd8"], cinza: ["#d8dde4", "#aab2be", "#7c8594"],
    escura: ["#8a93a2", "#5f6776", "#3e4452"] };

  function rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mistura(a, b, f) { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(",")})`; }
  function semente(s) { return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

  const tela = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  // o alfa binário (pixel nítido) num canvas pintado com texto ou rotação; sem getImageData (teste), fica como está
  function nitido(c) {
    try {
      const g = c.getContext("2d"), d = g.getImageData(0, 0, c.width, c.height);
      if (!d || !d.data) return c;
      for (let i = 3; i < d.data.length; i += 4) d.data[i] = d.data[i] >= 110 ? 255 : 0;
      g.putImageData(d, 0, 0);
    } catch (e) { /* fica como está */ }
    return c;
  }

  // telas pequenas guardadas: o sprite é pintado uma vez por cor e escala, e depois só copiado
  const telas = new Map();
  function sprite(chave, linhas, cores, U) {
    const k = chave + "|" + U;
    let c = telas.get(k);
    if (c) return c;
    c = tela(linhas[0].length * U, linhas.length * U);
    const g = c.getContext("2d");
    linhas.forEach((linha, y) => {
      for (let x = 0; x < linha.length; x++) {
        const cor = linha[x] === "." ? null : typeof cores === "string" ? cores : cores[linha[x]];
        if (cor) { g.fillStyle = cor; g.fillRect(x * U, y * U, U, U); }
      }
    });
    telas.set(k, c);
    return c;
  }
  // o avião desenhado por código (sem o atlas), girado em 16 direções pelo vizinho mais próximo
  const giros = [];
  function girado(i) {
    if (giros[i]) return giros[i];
    const th = i * Math.PI / 8, co = Math.cos(th), si = Math.sin(th), cx = (AVIAO[0].length - 1) / 2, cy = (AVIAO.length - 1) / 2, linhas = [];
    for (let dy = -7; dy <= 7; dy++) {
      let s = "";
      for (let dx = -7; dx <= 7; dx++) {
        const sx = Math.round(co * dx + si * dy + cx), sy = Math.round(-si * dx + co * dy + cy);
        s += (AVIAO[sy] && AVIAO[sy][sx]) || ".";
      }
      linhas.push(s);
    }
    return (giros[i] = linhas);
  }
  // nuvem em pixel: bolas achatadas; a beira de baixo mais escura e a de cima mais clara
  function formaNuvem(n, r) {
    const rnd = semente(n * 7919 + 13), bolas = [[0, 0, r]];
    for (let i = 0, q = 2 + Math.floor(rnd() * 3); i < q; i++) {
      bolas.push([(rnd() - 0.5) * r * 2.4, (rnd() - 0.3) * r * 0.6, r * (0.45 + rnd() * 0.45)]);
    }
    const den = (x, y) => bolas.some(([bx, by, br]) => (x - bx) ** 2 + ((y - by) * 1.4) ** 2 <= br * br);
    const x0 = Math.floor(Math.min(...bolas.map(b => b[0] - b[2]))), x1 = Math.ceil(Math.max(...bolas.map(b => b[0] + b[2])));
    const y0 = Math.floor(Math.min(...bolas.map(b => b[1] - b[2]))), y1 = Math.ceil(Math.max(...bolas.map(b => b[1] + b[2])));
    const linhas = [];
    for (let y = y0; y <= y1; y++) {
      let s = "";
      for (let x = x0; x <= x1; x++) s += !den(x + 0.5, y + 0.5) ? "." : !den(x + 0.5, y + 2) ? "b" : !den(x + 0.5, y - 1) ? "l" : "m";
      linhas.push(s);
    }
    return { linhas, ox: x0, oy: y0, id: "n" + n + "_" + r };
  }
  const coresNuvem = new Map();   // as três cores da nuvem por tipo e degrau da noite, misturadas uma vez
  function telaNuvem(f, tipo, escuro) {
    const passo = Math.round(escuro * 4), chave = tipo + passo;
    let cores = coresNuvem.get(chave);
    if (!cores) {
      const [l, m, b] = CORES_NUVEM[tipo].map(c => mistura(c, "#141a34", passo / 4 * 0.72));
      coresNuvem.set(chave, (cores = { l, m, b }));
    }
    return sprite(f.id + chave, f.linhas, cores, 1);
  }
  // o brilho quente da noite: um degradê por raio, pintado uma vez e depois só copiado
  const brilhos = new Map();
  function brilho(r) {
    let c = brilhos.get(r);
    if (c) return c;
    c = tela(2 * r, 2 * r);
    const g = c.getContext("2d"), d = g.createRadialGradient(r, r, 0, r, r, r);
    d.addColorStop(0, "rgba(255,196,110,.5)"); d.addColorStop(0.45, "rgba(255,160,70,.16)"); d.addColorStop(1, "rgba(255,150,60,0)");
    g.fillStyle = d; g.fillRect(0, 0, 2 * r, 2 * r);
    brilhos.set(r, c);
    return c;
  }
  // a rosa dos ventos em pixels do mapa: quatro pontas longas e quatro curtas, metade clara e metade escura, e o N
  function fazerRosa() {
    const R = 12, L = 2 * R + 1, px = new Map(), por = (x, y, cor) => px.set(x + "," + y, [x, y, cor]);
    for (const [dx, dy, longa] of [[0, -1, 1], [1, 0, 1], [0, 1, 1], [-1, 0, 1], [1, -1, 0], [1, 1, 0], [-1, 1, 0], [-1, -1, 0]]) {
      const n = Math.hypot(dx, dy), ux = dx / n, uy = dy / n, max = longa ? 10 : 6;
      for (let t = 0; t <= max; t++) {
        const larg = Math.max(0, (longa ? 2 : 1) - Math.floor(t / (longa ? 4 : 3)));
        for (let s = -larg; s <= larg; s++) por(R + Math.round(ux * t - uy * s), R + Math.round(uy * t + ux * s), s <= 0 ? "#efe3c4" : "#9a8458");
      }
    }
    for (let a = 0; a < 32; a += 2) por(R + Math.round(Math.cos(a * Math.PI / 16) * 7), R + Math.round(Math.sin(a * Math.PI / 16) * 7), "#c8b88e");
    por(R, R, "#c0563a");
    const c = tela(L + 2, L + 9), g = c.getContext("2d");
    const N = ["x..x", "xx.x", "x.xx", "x..x", "x..x"];
    N.forEach((l, y) => { for (let x = 0; x < 4; x++) if (l[x] === "x") por(R - 1 + x - 1, y - 7, "#efe3c4"); });
    const todos = [...px.values()];
    g.fillStyle = "rgba(10,22,38,.75)";   // o contorno escuro, para ler sobre o mar
    for (const [x, y] of todos) for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!px.has((x + a) + "," + (y + b))) g.fillRect(x + a + 1, y + b + 8, 1, 1);
    }
    for (const [x, y, cor] of todos) { g.fillStyle = cor; g.fillRect(x + 1, y + 8, 1, 1); }
    return c;
  }
  // o disco de chão (neve ou chuva) em volta da cidade, 13x11
  const DISCO = [];
  for (let y = -5; y <= 5; y++) {
    let s = "";
    for (let x = -6; x <= 6; x++) s += x * x + y * y * 1.5 <= 36 && (x * x + y * y * 1.5 <= 16 || (x + y) % 2 === 0) ? "x" : ".";
    DISCO.push(s);
  }
  // o mar de fora da imagem: um ladrilho de 44x28 px do mapa no tom do alto-mar, com as ondas do brasil.png
  function ladrilhoMar() {
    const c = tela(44, 28), g = c.getContext("2d"), ONDA = [".ww..", "w..ww"];
    g.fillStyle = "#1a3452"; g.fillRect(0, 0, 44, 28);
    g.fillStyle = "#26496d";
    for (const [x, y] of [[3, 4], [27, 9], [14, 19], [36, 23]]) {
      ONDA.forEach((l, j) => { for (let i = 0; i < 5; i++) if (l[i] === "w") g.fillRect(x + i, y + j, 1, 1); });
    }
    return c;
  }
  return { PEQUENA, GRANDE, CHALE, BARCO, BARCO_G, DIA, NOITE, DISCO, semente, mistura, tela, nitido, sprite, girado, formaNuvem,
    telaNuvem, brilho, fazerRosa, ladrilhoMar };
})();
window.MapaArte = MapaArte;
