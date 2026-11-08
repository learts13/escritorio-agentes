// Efeitos que dão vida ao escritório: carros na rua, postes, animação de objetos (aquário,
// servidores, relógio, neon, telas), emotes, confete, poeira, robô aspirador, enfeites das
// datas comemorativas, chapéus dos agentes e o painel com o logo na sala comunal.
"use strict";

const Efeitos = (() => {
  let P = null, A = null, CFG = null, logoPx = null, aspirador = null;
  const part = [];                    // partículas: {x,y,vx,vy,vida,cor,tam}
  const fogos = [];
  const spr = (c, nome, x, y, espelho) => {
    const s = A.json.sprites[nome]; if (!s) return null;
    c.drawImage(A.img, s[0], s[1], s[2], s[3], Math.round(x), Math.round(y), s[2], s[3]);
    return s;
  };
  const tam = n => A.json.sprites[n];
  const calmo = matchMedia("(prefers-reduced-motion: reduce)");   // com menos movimento: sem poeira, confete nem piscadas

  function iniciar(predio, atlas, config, logoImg) {
    P = predio; A = atlas; CFG = config; aspirador = null;
    logoPx = null;
    if (logoImg && logoImg.width) { // logo em pixel art: reduz suavizando e amplia sem suavizar
      const alvoH = 26, alvoW = Math.min(64, Math.round(logoImg.width * alvoH / logoImg.height));
      const cv = document.createElement("canvas"); cv.width = alvoW; cv.height = alvoH;
      const c = cv.getContext("2d"); c.imageSmoothingEnabled = false;
      c.drawImage(logoImg, 0, 0, alvoW, alvoH);
      logoPx = cv;
    }
  }

  // ---------------- rua
  function exterior(c, dt, t, ceu) {
    const e = P.externos; if (!e) return;
    for (const car of e.carros) {
      const dir = car.faixa ? -1 : 1, nome = dir < 0 ? car.nome + "_esq" : car.nome, s = tam(nome) || tam(car.nome);
      if (!s) continue;
      car.x += dir * car.vel * dt;
      car.vel = car.faixa ? 26 : 34;   // cada faixa anda num ritmo só: ninguém atravessa o carro da frente
      if (dir > 0 && car.x > P.W + 40) car.x = -60 - Math.random() * 260;
      if (dir < 0 && car.x < -60) car.x = P.W + 40 + Math.random() * 260;
      const y = e.ruaY + (car.faixa ? e.ruaAlt / 2 - 2 : e.ruaAlt - 3) - s[3];   // cada faixa dentro do asfalto
      c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(car.x + 2, y + s[3] - 2, s[2] - 4, 3);
      spr(c, tam(nome) ? nome : car.nome, car.x, y);
      car.farol = { x: dir > 0 ? car.x + s[2] : car.x, y: y + s[3] - 6, dir };
    }
  }

  function luzesNoite(c, ceu) {
    const n = ceu.escuro; if (n < 0.15 || !P.externos) return;
    c.globalCompositeOperation = "lighter";
    for (const p of P.externos.postes) brilho(c, p.x, p.y + 2, 40, `rgba(255,214,140,${0.45 * n})`);
    for (const o of P.objetos) if (o.luz && o.nome === "placa_expediente") brilho(c, o.luz.x, o.luz.y, 14, hexA(o.luz.cor, 0.5 * n));   // luzinha da placa
    for (const car of P.externos.carros) if (car.farol) {
      const g = c.createLinearGradient(car.farol.x, 0, car.farol.x + car.farol.dir * 46, 0);
      g.addColorStop(0, `rgba(255,245,200,${0.45 * n})`); g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g; c.beginPath(); c.moveTo(car.farol.x, car.farol.y - 1); c.lineTo(car.farol.x + car.farol.dir * 46, car.farol.y - 7); c.lineTo(car.farol.x + car.farol.dir * 46, car.farol.y + 6); c.closePath(); c.fill();
    }
    c.globalCompositeOperation = "source-over";
  }

  function brilho(c, x, y, r, cor) {
    const g = c.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, cor); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  }

  // ---------------- telas: canais de TV, videogame e fliperama (t = 0 com menos movimento: tudo parado)
  const px = (c, x, y, w, h, cor) => { c.fillStyle = cor; c.fillRect(Math.round(x), Math.round(y), w, h); };
  const vaiVem = f => { f %= 2; return f < 1 ? f : 2 - f; };
  const CANAIS = 5, TROCA = 9000;

  function canal(c, x, y, w, h, t, n) {
    if (n === 0) { // futebol
      px(c, x, y, w, h, "#3c8a37"); for (let i = 0; i < w; i += 6) px(c, x + i, y, 3, h, "#46983f");
      px(c, x + Math.floor(w / 2), y, 1, h, "rgba(255,255,255,.7)"); px(c, x, y + h / 2 - 3, 1, 6, "#fff"); px(c, x + w - 1, y + h / 2 - 3, 1, 6, "#fff");
      for (let k = 0; k < 6; k++) px(c, x + 2 + vaiVem(t / (2600 + k * 370) + k * 0.37) * (w - 5), y + 2 + vaiVem(t / (1900 + k * 290) + k * 0.21) * (h - 5), 1, 2, k % 2 ? "#e8473c" : "#3a6ee8");
      px(c, x + 1 + vaiVem(t / 1700) * (w - 3), y + 1 + vaiVem(t / 1300 + 0.3) * (h - 3), 1, 1, "#ffffff");
      px(c, x + 1, y + 1, 7, 3, "rgba(0,0,0,.6)"); px(c, x + 2, y + 2, 1, 1, "#fff"); px(c, x + 5, y + 2, 1, 1, "#ffd23f");
    } else if (n === 1) { // jornal: âncora, mapa ao fundo e letreiro passando
      px(c, x, y, w, h, "#1d3570"); px(c, x, y, w, 1, "#2c4a92");
      px(c, x + w - 10, y + 2, 8, 6, "#5fa8d3"); px(c, x + w - 9, y + 3, 3, 2, "#3f8f3a"); px(c, x + w - 5, y + 5, 2, 2, "#3f8f3a");
      const ax = x + Math.round(w * 0.35);
      px(c, ax - 3, y + 7, 7, h - 9, "#2b2b36"); px(c, ax, y + 7, 1, 2, "#e8e8f0");
      px(c, ax - 1, y + 3, 3, 4, "#e0b48a"); px(c, ax - 1, y + 2, 3, 1, "#3b2a1e");
      if (Math.floor(t / 180) % 2) px(c, ax, y + 6, 1, 1, "#7a3b2e");
      px(c, x, y + h - 6, w, 2, "#c9a777"); px(c, x, y + h - 3, w, 3, "#c8102e");
      const off = Math.floor(t / 60) % 8;
      for (let i = -8; i < w; i += 8) if (i - off + 8 >= 0 && i - off + 12 <= w) px(c, x + i - off + 8, y + h - 2, 4, 1, "#ffffff");
    } else if (n === 2) { // previsão do tempo
      px(c, x, y, w, h, "#5aa0dc");
      px(c, x + 2, y + 4, 6, 4, "#4f9a45"); px(c, x + 8, y + 6, 8, 5, "#4f9a45"); px(c, x + w - 11, y + h - 8, 8, 5, "#4f9a45");
      px(c, x + 3, y + 2, 3, 3, Math.floor(t / 600) % 2 ? "#ffd23f" : "#ffe680");
      const nx = x - 6 + ((t / 120) % (w + 8));
      if (nx >= x && nx + 6 <= x + w) { px(c, nx, y + h / 2, 6, 2, "#ffffff"); px(c, nx + 1, y + h / 2 - 1, 3, 1, "#ffffff"); }
      px(c, x + w - 7, y + 2, 5, 3, "rgba(0,0,0,.35)"); px(c, x + w - 6, y + 3, 1, 1, "#fff"); px(c, x + w - 4, y + 3, 1, 1, "#fff");
    } else if (n === 3) { // desenho animado: bichinho pulando
      px(c, x, y, w, h, "#7fd0ff"); px(c, x, y + h - 3, w, 3, "#5cc25a"); px(c, x, y + h - 3, w, 1, "#7ee07a");
      px(c, x + 3 + vaiVem(t / 7000) * (w - 10), y + 2, 6, 2, "#ffffff");
      const pulo = Math.round(Math.abs(Math.sin(t / 420)) * (h - 8)), hx = x + 2 + vaiVem(t / 3000) * (w - 6);
      px(c, hx, y + h - 6 - pulo, 3, 3, "#ffd23f"); px(c, hx + 2, y + h - 5 - pulo, 1, 1, "#1b1b22");
    } else { // clipe de música: equalizador
      px(c, x, y, w, h, "#2a1446");
      for (let i = 0; i + 2 <= w; i += 3) { const bh = 1 + Math.floor(Math.abs(Math.sin(t / 190 + i * 1.7)) * (h - 3)); px(c, x + i, y + h - bh, 2, bh, `hsl(${(i * 12 + t / 20) % 360},80%,65%)`); }
    }
  }

  function jogo(c, x, y, w, h, t, tipo) {
    px(c, x, y, w, h, "#07070f");
    if (tipo === 0) { // labirinto: comilão de bolinhas com fantasma atrás
      px(c, x, y + 1, w, 1, "#2f4bd8"); px(c, x, y + h - 2, w, 1, "#2f4bd8");
      const f = vaiVem(t / 2600), ida = (t / 2600) % 2 < 1, cx = x + 1 + f * (w - 3), cy = y + Math.floor(h / 2) - 1;
      for (let i = x + 1; i < x + w - 1; i += 2) if (ida ? i > cx + 1 : i < cx) px(c, i, cy + 1, 1, 1, "#ffd9a8");
      px(c, cx, cy, 2, 2, "#ffd23f"); if (Math.floor(t / 150) % 2) px(c, ida ? cx + 1 : cx, cy + 1, 1, 1, "#07070f");
      px(c, Math.max(x, Math.min(x + w - 2, cx + (ida ? -5 : 5))), cy, 2, 2, "#ff4d6d");
    } else if (tipo === 1) { // invasores
      const ox = vaiVem(t / 1500) * Math.max(0, w - 12), desce = Math.floor(t / 1500) % 2;
      for (let k = 0; k < 4; k++) { px(c, x + 1 + ox + k * 3, y + 1 + desce, 2, 1, "#8affc1"); px(c, x + 1 + ox + k * 3, y + 3 + desce, 2, 1, "#c4a0ff"); }
      const sx = x + 1 + vaiVem(t / 1100) * (w - 4); px(c, sx, y + h - 2, 3, 1, "#7cc4ff"); px(c, sx + 1, y + h - 3, 1, 1, "#ffffff");
      px(c, sx + 1, y + h - 4 - ((t / 40) % Math.max(1, h - 5)), 1, 1, "#ffd36b");
    } else { // quebra-blocos
      ["#ff5d8f", "#ffd23f", "#3ec1d3"].forEach((k, i) => px(c, x + 1, y + 1 + i, w - 2, 1, k));
      const bx = x + 1 + vaiVem(t / 900) * (w - 3), by = y + 4 + vaiVem(t / 700) * (h - 7);
      px(c, bx, by, 1, 1, "#ffffff"); px(c, Math.max(x, Math.min(x + w - 4, bx - 1)), y + h - 2, 4, 1, "#c4a0ff");
    }
    px(c, x, y, w, 1, "rgba(255,255,255,.08)");
  }

  // a.canal: canal escolhido (o passo 3 troca no toque); sem isso, troca sozinho a cada 9 s
  function tela(c, a, t, modo) {
    const { x, y, w, h } = a; if (!w) return;
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    if (modo === "jogo") jogo(c, x, y, w, h, t, 1 + ((x >> 4) % 2));
    else {
      const n = (Math.floor(t / TROCA) + (a.canal || 0) + (x >> 3)) % CANAIS;
      if ((t && t % TROCA < 220) || (a.trocou && performance.now() - a.trocou < 260)) for (let i = 0; i < (w * h) / 3; i++) px(c, x + Math.random() * w, y + Math.random() * h, 1, 1, Math.random() < 0.5 ? "#d4d4dc" : "#3a3a46"); // chuvisco na troca
      else canal(c, x, y, w, h, t, n);
    }
    if (modo === "fraca") px(c, x, y, w, h, "rgba(8,8,16,.45)");
    px(c, x + 1, y + 1, Math.max(1, Math.floor(w / 3)), 1, "rgba(255,255,255,.12)");   // reflexo no vidro
    c.restore();
  }

  // ---------------- objetos desenhados em código ou com movimento no próprio sprite (true = já desenhou)
  const BALANCA = /^(planta|arvore|arbusto|palmeira)/;
  function objeto(c, o, t) {
    const n = o.nome || "";
    if (n === "ventilador") { ventilador(c, o, t); return true; }
    if (n === "hidrante") { // hidrante vermelho da calçada
      px(c, o.x + 1, o.y + 9, 5, 1, "rgba(0,0,0,.25)"); px(c, o.x + 1, o.y + 3, 5, 6, "#c81e3a"); px(c, o.x + 2, o.y + 1, 3, 2, "#e0314f");
      px(c, o.x, o.y + 4, 7, 2, "#a3162d"); px(c, o.x + 2, o.y + 3, 1, 6, "#f0546c"); px(c, o.x + 3, o.y, 1, 1, "#e0314f");
      return true;
    }
    if (n === "ring_light") { ringLight(c, o); return true; }
    if (n === "placa_expediente") { placaExpediente(c, o); return true; }
    const pc = PECAS[n];
    if (pc) { peca(c, o, pc[0], pc[1]); return true; }
    if (!BALANCA.test(n) || !t) return false;
    const s = tam(n); if (!s) return false;
    // planta balançando de leve: só a copa anda 1 px para os lados; o vaso (ou o tronco) fica
    const forte = o.agita && performance.now() - o.agita < 1400;   // clicada (brincar.js): balança mais e mais rápido
    const d = Math.round(Math.sin(t / (forte ? 110 : 1500) + o.x * 0.37) * (forte ? 2 : 0.8)); if (!d) return false;
    const corte = Math.round(s[3] * (/^planta/.test(n) ? 0.5 : 0.6));
    c.drawImage(A.img, s[0], s[1], s[2], corte, o.x + d, o.y, s[2], corte);
    c.drawImage(A.img, s[0], s[1] + corte, s[2], s[3] - corte, o.x, o.y + corte, s[2], s[3] - corte);
    return true;
  }

  // peças estáticas desenhadas em código: cada variação (nome, cor, largura) é desenhada uma vez e depois só copiada.
  // A variação de cor sai da posição, então duas peças iguais na mesma sala raramente têm a mesma cor.
  const cachePecas = new Map();
  function peca(c, o, margem, desenho) {
    const v = o.variante ?? (o.variante = ((o.x * 31 + o.y * 17) >>> 0) % 4), chave = `${o.nome}|${v}|${o.w}|${o.cor || ""}`;
    let cv = cachePecas.get(chave);
    if (!cv) {
      cv = document.createElement("canvas"); cv.width = o.w; cv.height = o.h + margem;
      desenho(cv.getContext("2d"), { ...o, x: 0, y: margem }, v); cachePecas.set(chave, cv);
    }
    c.drawImage(cv, o.x, o.y - margem);
  }
  const MADEIRAS = ["#9a6a44", "#e8e4dc", "#3a3a46", "#b07a4f"], LOMBADAS = ["#c2410c", "#0f766e", "#7c3aed", "#b45309", "#be185d", "#1d4ed8", "#e8e4dc", "#3f7a4e"];
  const escuro = (k, f = 0.35) => Mapa.mistura(k, "#000000", f), claro = (k, f = 0.25) => Mapa.mistura(k, "#ffffff", f);
  function lixeiras(c, o) { // recicláveis: papel, plástico, vidro e metal
    px(c, o.x + 1, o.y + 15, 24, 1, "rgba(0,0,0,.2)");
    ["#2f6fd6", "#d23c3c", "#2f9a4a", "#e0a91c"].forEach((k, i) => {
      const x = o.x + 1 + i * 6;
      px(c, x, o.y + 4, 6, 11, k); px(c, x, o.y + 2, 6, 2, escuro(k, 0.3)); px(c, x + 1, o.y + 4, 1, 10, claro(k, 0.3));
      px(c, x + 2, o.y + 8, 2, 2, "#ffffff"); px(c, x + 2, o.y + 1, 2, 1, "#3a3a46");
    });
  }
  function jardineira(c, o) { // jardineira baixa entre as fileiras de mesas
    const { x, y, w } = o;
    px(c, x + 1, y + 9, w - 1, 1, "rgba(0,0,0,.18)"); px(c, x, y + 4, w, 5, "#8a5a3a"); px(c, x, y + 4, w, 1, "#a06c46"); px(c, x, y + 8, w, 1, "#5e3c24");
    for (let i = 1; i < w - 3; i += 3) {
      const a = (i * 7) % 4, alto = a % 2;
      px(c, x + i, y + 1 + alto, 3, 4 - alto, alto ? "#2f8a45" : "#3fae5a"); px(c, x + i + 1, y + 1 + alto, 1, 1, "#5fd07a");
      if (a === 3) px(c, x + i + 1, y + alto, 1, 1, i % 2 ? "#ff9ec4" : "#fff6a8");
    }
  }
  function divisoria(c, o) { // divisória baixa de tecido na cor do time
    const { x, y, w } = o, cor = o.cor || "#3b82f6";
    px(c, x + 1, y + 9, w - 1, 1, "rgba(0,0,0,.18)"); px(c, x + 2, y + 7, 1, 2, "#5b5b68"); px(c, x + w - 3, y + 7, 1, 2, "#5b5b68");
    px(c, x, y + 1, w, 6, Mapa.mistura(cor, "#ece6da", 0.3)); px(c, x, y, w, 1, "#e9ecf2"); px(c, x, y + 1, w, 1, "#8a909c"); px(c, x, y + 6, w, 1, Mapa.mistura(cor, "#16121c", 0.6));
    for (let i = 3; i < w - 1; i += 4) px(c, x + i, y + 2, 1, 4, Mapa.mistura(cor, "#ece6da", 0.12));
  }
  function estanteLivros(c, o, v) { // estante alta com livros, de madeira, branca ou preta
    const { x, y } = o, mad = MADEIRAS[v];
    px(c, x, y, 30, 42, escuro(mad)); px(c, x + 2, y + 2, 26, 38, escuro(mad, 0.6));
    let k = v * 97 + 13; const sorte = () => (k = (k * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (const sy of [3, 16, 29]) {
      let bx = x + 3;
      while (bx < x + 26) {
        if (sorte() < 0.12) { px(c, bx + 1, y + sy + 6, 4, 4, "#c98f3c"); px(c, bx, y + sy + 3, 6, 3, "#3fae5a"); bx += 7; continue; }   // vasinho
        const w = 2 + Math.floor(sorte() * 2), h = 7 + Math.floor(sorte() * 4), cor = LOMBADAS[Math.floor(sorte() * LOMBADAS.length)];
        if (bx + w > x + 27) break;
        px(c, bx, y + sy + 10 - h, w, h, cor); px(c, bx, y + sy + 10 - h, 1, h, claro(cor, 0.2)); bx += w + (sorte() < 0.2 ? 1 : 0);
      }
    }
    for (const sy of [0, 13, 26, 39]) { px(c, x, y + sy, 30, 3, mad); px(c, x, y + sy, 30, 1, claro(mad)); }
    px(c, x, y, 2, 42, mad); px(c, x + 28, y, 2, 42, mad);
  }
  function luminariaArco(c, o, v) { // luminária de arco: base de mármore, haste curva e cúpula
    const { x, y } = o, cup = ["#2b2b36", "#e0a91c", "#e8e4dc", "#3f7a4e"][v];
    px(c, x + 1, y + 39, 9, 1, "rgba(0,0,0,.2)"); px(c, x + 1, y + 35, 9, 4, "#e8e4dc"); px(c, x + 1, y + 38, 9, 1, "#b9b2a2"); px(c, x + 2, y + 35, 3, 1, "#ffffff");
    px(c, x + 5, y + 14, 1, 21, "#8a909c");
    for (const [a, b] of [[5, 13], [5, 12], [6, 11], [6, 10], [7, 9], [8, 8], [9, 7], [10, 6], [11, 5], [12, 5], [13, 4], [14, 4], [15, 4], [16, 4], [17, 5], [18, 5], [19, 6]]) px(c, x + a, y + b, 1, 1, "#8a909c");
    px(c, x + 17, y + 7, 6, 1, escuro(cup, 0.2)); px(c, x + 16, y + 8, 8, 3, cup); px(c, x + 16, y + 8, 8, 1, claro(cup)); px(c, x + 18, y + 11, 4, 1, "#fff3c4");
  }
  function poltronaTecido(c, o, v) { // poltrona de tecido em quatro cores
    const { x, y } = o, cor = ["#d9a03a", "#3f7a4e", "#c2603a", "#3a6ea8"][v], esc = escuro(cor), cla = claro(cor);
    px(c, x + 2, y + 22, 18, 2, "rgba(0,0,0,.2)");
    px(c, x + 3, y + 1, 16, 10, esc); px(c, x + 4, y + 2, 14, 2, cor);
    px(c, x + 1, y + 8, 4, 12, esc); px(c, x + 17, y + 8, 4, 12, esc); px(c, x + 1, y + 8, 4, 1, cla); px(c, x + 17, y + 8, 4, 1, cla);
    px(c, x + 5, y + 10, 12, 8, cor); px(c, x + 5, y + 10, 12, 1, cla); px(c, x + 3, y + 18, 16, 3, esc);
    px(c, x + 3, y + 21, 2, 2, "#4a3020"); px(c, x + 17, y + 21, 2, 2, "#4a3020");
  }
  function aparadorBaixo(c, o, v) { // aparador baixo com vaso e livros em cima
    const { x, y } = o, mad = MADEIRAS[v], esc = escuro(mad);
    px(c, x + 1, y + 21, 32, 1, "rgba(0,0,0,.2)");
    px(c, x + 4, y + 4, 5, 5, "#e8e4dc"); px(c, x + 4, y + 4, 5, 1, "#ffffff"); px(c, x + 3, y, 7, 4, "#3fae5a"); px(c, x + 5, y, 2, 1, "#5fd07a");
    px(c, x + 22, y + 5, 8, 1, "#c2410c"); px(c, x + 23, y + 6, 7, 1, "#1d4ed8"); px(c, x + 22, y + 7, 8, 1, "#e0a91c");
    px(c, x, y + 8, 34, 3, claro(mad)); px(c, x, y + 11, 34, 8, mad); px(c, x, y + 11, 34, 1, esc);
    px(c, x + 11, y + 11, 1, 8, esc); px(c, x + 22, y + 11, 1, 8, esc); px(c, x + 9, y + 14, 1, 2, esc); px(c, x + 24, y + 14, 1, 2, esc);
    px(c, x + 2, y + 19, 2, 2, esc); px(c, x + 30, y + 19, 2, 2, esc);
  }
  // ringue da Sala comunal (o mapa.js pinta a lona): postes com o protetor do corner (vermelho à esquerda, azul à direita)
  // e três cordas, a de cima na cor da marca; na frente, a entrada fica no meio, entre dois postinhos
  function posteRingue(c, x, y, protetor) {
    px(c, x, y + 3, 3, 17, "#8a909c"); px(c, x, y + 3, 1, 17, "#c9ced8"); px(c, x + 2, y + 3, 1, 17, "#5b6170");
    px(c, x - 1, y, 5, 4, protetor); px(c, x - 1, y, 5, 1, claro(protetor)); px(c, x - 1, y + 3, 5, 1, escuro(protetor));
  }
  function cordasRingue(c, x0, x1, y, cor) {
    for (const [k, dy] of [[cor, 3], ["#f4f1ea", 8], ["#f4f1ea", 13]]) { px(c, x0, y + dy, x1 - x0, 1, k); px(c, x0, y + dy + 1, x1 - x0, 1, "rgba(0,0,0,.22)"); }
  }
  function ringueTras(c, o) {
    cordasRingue(c, o.x + 4, o.x + o.w - 4, o.y, o.cor);
    posteRingue(c, o.x + 1, o.y, "#d23c3c"); posteRingue(c, o.x + o.w - 4, o.y, "#3a6fd8");
  }
  function ringueFrente(c, o) {
    const meio = o.x + o.w / 2, a = o.abertura / 2;
    cordasRingue(c, o.x + 4, meio - a, o.y, o.cor); cordasRingue(c, meio + a, o.x + o.w - 4, o.y, o.cor);
    for (const ex of [meio - a - 1, meio + a - 1]) { px(c, ex, o.y + 5, 2, 15, "#8a909c"); px(c, ex, o.y + 5, 1, 15, "#c9ced8"); px(c, ex - 1, o.y + 3, 4, 2, "#e8e4dc"); }
    posteRingue(c, o.x + 1, o.y, "#d23c3c"); posteRingue(c, o.x + o.w - 4, o.y, "#3a6fd8");
  }
  const PECAS = { quadro_avisos: [0, quadroAvisos], lixeiras: [0, lixeiras], bancada: [3, bancada], jardineira: [0, jardineira], divisoria: [0, divisoria],
    estante_livros: [0, estanteLivros], luminaria_arco: [0, luminariaArco], poltrona_tecido: [0, poltronaTecido], aparador_baixo: [0, aparadorBaixo],
    ringue_tras: [0, ringueTras], ringue_frente: [0, ringueFrente] };
  const salaDe = o => o.sala !== undefined ? o.sala : (o.sala = [...P.salas, ...P.baixo].find(s => o.x + o.w / 2 >= s.px && o.x + o.w / 2 <= s.px + s.pw && o.y + o.h > s.py && o.y + o.h <= s.py + s.ph + 2) || null);
  const anel = {};   // o ring light é desenhado uma vez (aceso e apagado) e depois só copiado
  function desenharAnel(aceso) {
    const cv = document.createElement("canvas"); cv.width = 16; cv.height = 36;
    const c = cv.getContext("2d");
    px(c, 2, 35, 13, 1, "rgba(0,0,0,.2)");
    for (let k = 0; k < 7; k++) { px(c, 7 - Math.round(k * 0.7), 29 + k, 1, 1, "#2b2b36"); px(c, 8 + Math.round(k * 0.7), 29 + k, 1, 1, "#2b2b36"); }
    px(c, 7, 14, 2, 21, "#3a3a46"); px(c, 7, 14, 1, 21, "#5b5b68");
    for (let j = 0; j < 15; j++) for (let i = 0; i < 15; i++) {
      const d = Math.hypot(i - 7, j - 7);
      if (d > 4.6 && d <= 7.2) px(c, 1 + i, j, 1, 1, d > 6.2 ? "#2b2b36" : aceso ? (j < 7 ? "#fffbea" : "#ffe9b0") : "#c9c4b8");
    }
    px(c, 7, 5, 3, 5, "#1b1b22"); px(c, 8, 6, 1, 3, aceso ? "#3a92e6" : "#2a2a36");
    return cv;
  }
  function ringLight(c, o) { // ring light no tripé, com o celular no meio: acende com a sala
    const s = salaDe(o), aceso = !s || s.luz > 0.5;
    c.drawImage(anel[aceso] || (anel[aceso] = desenharAnel(aceso)), o.x, o.y);
  }
  function bancada(c, o) { // bancada da cozinha: armários brancos, tampo de granito escuro, pia, cooktop com forno e micro-ondas
    const { x, y, w } = o;
    px(c, x, y + 28, w, 2, "#4a4a55"); px(c, x, y + 13, w, 15, "#eef0f2");
    for (let i = 0; i < w; i += 16) { px(c, x + i, y + 13, 1, 15, "#b8bcc6"); px(c, x + i + 12, y + 17, 1, 4, "#8a909c"); }
    px(c, x, y + 13, w, 1, "rgba(0,0,0,.2)");
    px(c, x, y + 2, w, 10, "#2e2e36"); px(c, x, y + 2, w, 1, "#45454f"); px(c, x, y + 12, w, 1, "#5b5b68");
    for (let i = 1; i < w; i += 3) px(c, x + i, y + 3 + ((i * 5) % 8), 1, 1, "#6b6b78");   // granito
    const sx = x + o.pia;   // pia
    px(c, sx, y + 4, 16, 7, "#8a94a4"); px(c, sx + 1, y + 5, 14, 5, "#b8c0cc"); px(c, sx + 2, y + 6, 12, 1, "#9aa3b2"); px(c, sx + 7, y + 8, 2, 1, "#6b7484");
    px(c, sx + 7, y + 1, 2, 4, "#c9ced8"); px(c, sx + 7, y + 1, 1, 1, "#ffffff");
    const fx = x + o.fogao;  // cooktop e forno embaixo
    px(c, fx, y + 4, 20, 7, "#15151c");
    for (const [a, b] of [[2, 1], [13, 1], [2, 4], [13, 4]]) { px(c, fx + a, y + 4 + b, 4, 2, "#3a3a46"); px(c, fx + a + 1, y + 4 + b, 2, 1, "#5b5b68"); }
    px(c, fx, y + 14, 20, 13, "#2b2b36"); px(c, fx + 2, y + 16, 16, 1, "#8a909c"); px(c, fx + 3, y + 19, 14, 6, "#45454f"); px(c, fx + 4, y + 20, 4, 1, "#5b5b68");
    const mx = x + w - 22;  // micro-ondas no tampo
    px(c, mx, y - 3, 18, 10, "#d9dde4"); px(c, mx, y - 3, 18, 1, "#ffffff"); px(c, mx, y + 6, 18, 1, "#a9b0bb");
    px(c, mx + 1, y - 1, 11, 6, "#2b2b36"); px(c, mx + 2, y, 3, 1, "#45454f"); px(c, mx + 13, y - 1, 4, 6, "#a9b0bb"); px(c, mx + 14, y, 1, 1, "#4ade80");
  }
  function quadroAvisos(c, o) { // quadro de avisos de cortiça no cavalete
    const { x, y } = o, cor = Mapa.cor("destaque");
    px(c, x + 1, y + 23, 22, 1, "rgba(0,0,0,.2)");
    px(c, x + 3, y + 16, 2, 7, "#5a3d26"); px(c, x + 19, y + 16, 2, 7, "#5a3d26"); px(c, x + 1, y + 22, 6, 1, "#4a3020"); px(c, x + 17, y + 22, 6, 1, "#4a3020");
    px(c, x, y, 24, 17, "#6e4a2c"); px(c, x + 1, y + 1, 22, 15, "#c1925a");
    for (const [a, b] of [[3, 12], [9, 2], [14, 13], [20, 9], [6, 10], [17, 2]]) px(c, x + a, y + b, 1, 1, "#a87a45");
    px(c, x + 3, y + 3, 6, 8, "#f4f4f0"); px(c, x + 4, y + 5, 4, 1, "#9aa0ab"); px(c, x + 4, y + 7, 3, 1, "#9aa0ab"); px(c, x + 4, y + 9, 4, 1, "#9aa0ab");
    px(c, x + 11, y + 3, 5, 5, "#ffe066"); px(c, x + 12, y + 5, 3, 1, "rgba(0,0,0,.25)");
    px(c, x + 11, y + 9, 9, 5, "#e8eef8"); px(c, x + 11, y + 9, 9, 1, cor); px(c, x + 12, y + 11, 6, 1, "#9aa0ab");
    px(c, x + 17, y + 3, 4, 4, "#ff9ec4");
    px(c, x + 6, y + 2, 1, 1, "#d23c3c"); px(c, x + 13, y + 2, 1, 1, "#3a92e6"); px(c, x + 15, y + 8, 1, 1, "#d23c3c"); px(c, x + 19, y + 2, 1, 1, "#f2a93b");
  }

  function ventilador(c, o, t) { // ventilador de pé: hélice girando e cabeça indo e voltando
    const cx = o.x + 7 + (t ? Math.round(Math.sin(t / 2200) * 1.5) : 0), cy = o.y + 6;
    px(c, o.x + 2, o.y + 20, 10, 2, "#2b2b36"); px(c, o.x + 3, o.y + 19, 8, 1, "#4a4a58");
    px(c, o.x + 6, o.y + 11, 2, 9, "#5b5b68"); px(c, o.x + 6, o.y + 11, 1, 9, "#7a7a88");
    c.fillStyle = "#3a3a46"; c.beginPath(); c.arc(cx, cy, 6.5, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#cfd5de"; c.beginPath(); c.arc(cx, cy, 5.5, 0, Math.PI * 2); c.fill();
    const giro = Math.floor(t / 45) % 6;
    for (let k = 0; k < 3; k++) {
      const ang = (k * 2 * Math.PI) / 3 + (giro * Math.PI) / 9;
      for (let r = 2; r <= 4; r++) px(c, cx - 0.5 + Math.cos(ang) * r, cy - 0.5 + Math.sin(ang) * r, 2, 2, "#5aa7e6");
    }
    px(c, cx - 1, cy - 1, 2, 2, "#2b2b36");
    c.fillStyle = "rgba(60,64,80,.55)"; c.fillRect(Math.round(cx) - 6, cy, 12, 1); c.fillRect(Math.round(cx), cy - 6, 1, 12);   // grade
  }

  // animados presos na parede que não vêm do atlas (true = já desenhou)
  function animado(c, a, t) {
    if (a.tipo !== "ar") return false;
    const { x, y, w, h } = a, ligado = !a.sala || a.sala.luz > 0.5;
    px(c, x - 1, y - 1, w + 2, h + 2, "#23212f"); px(c, x, y, w, h, "#e9edf2"); px(c, x, y, w, 1, "#ffffff"); px(c, x, y + h - 1, w, 1, "#a9b0bb");
    px(c, x + 2, y + h - 3, w - 4, 1, "#5b6270");
    px(c, x + 2, y + h - 2 + (ligado && t ? Math.floor(t / 1400) % 2 : 0), w - 4, 1, "#cfd5de");   // aleta
    px(c, x + w - 3, y + 2, 1, 1, ligado ? "#4ade80" : "#b45309");
    if (ligado && t) for (let k = 0; k < 3; k++) { // vento frio descendo
      const f = (t / 1600 + k / 3) % 1;
      px(c, x + 4 + k * 6 + Math.round(Math.sin(f * 6 + k)), y + h + 1 + f * 9, 3, 1, `rgba(215,238,255,${0.4 * (1 - f)})`);
    }
    return true;
  }

  // ---------------- animação por cima dos objetos
  function depoisObjeto(c, o, t, mundo) {
    const n = o.nome || "";
    if (n === "aquario") { // peixinhos indo e voltando, algas e bolhas subindo
      for (const [ax, fase] of [[o.x + 8, 0], [o.x + 29, 2]]) for (let k = 0; k < 4; k++)
        px(c, ax + Math.round(Math.sin(t / 700 + fase + k * 0.8) * k * 0.4), o.y + 22 - k * 2, 1, 2, k % 2 ? "#3fae5a" : "#2f8a45");
      for (let i = 0; i < 4; i++) {
        const f = (t / (2200 + i * 500) + i * 0.3) % 2, ida = f < 1, x = o.x + 6 + (ida ? f : 2 - f) * (o.w - 14), y = o.y + 9 + i * 3.5 + Math.sin(t / 400 + i) * 1.5;
        c.fillStyle = ["#ff8c42", "#ffd23f", "#3ec1d3", "#ff5d8f"][i]; c.fillRect(Math.round(x), Math.round(y), 3, 2); c.fillRect(Math.round(ida ? x - 1 : x + 3), Math.round(y), 1, 2);
      }
      for (const [bx, fase] of [[o.x + 13, 0], [o.x + 24, 0.5]]) for (let k = 0; k < 3; k++) {
        const f = (t / 1500 + k / 3 + fase) % 1;
        px(c, bx + Math.round(Math.sin(f * 7 + k)), o.y + 21 - f * 12, f > 0.6 ? 2 : 1, 1, `rgba(225,248,255,${0.9 - f * 0.5})`);
      }
    } else if (n === "cafeteira" && t) { // café fumegando
      for (let k = 0; k < 3; k++) { const f = (t / 1300 + k / 3) % 1; px(c, o.x + o.w * 0.45 + Math.round(Math.sin(f * 6 + k)), o.y + 8 - f * 9, 1, 2, `rgba(255,255,255,${0.6 * (1 - f)})`); }
    } else if (n === "jukebox") { // luzes correndo no arco
      for (let k = 0; k < 6; k++) px(c, o.x + 6 + k * ((o.w - 12) / 5), o.y + 5 + Math.abs(2.5 - k), 2, 2, `hsla(${(k * 50 + t / 8) % 360},90%,65%,.75)`);
    } else if (n === "pipoqueira" && t) { // pipoca pulando dentro do vidro
      for (let k = 0; k < 6; k++) { const f = (t / 600 + k / 6) % 1; px(c, o.x + o.w * 0.25 + ((k * 5) % Math.max(1, o.w * 0.5)), o.y + o.h * 0.38 - Math.sin(f * Math.PI) * 5, 1, 1, k % 2 ? "#fff6d5" : "#ffe08a"); }
    } else if (n === "chafariz" && t) { // jato de água subindo e caindo
      const cx = o.x + o.w / 2, top = o.y + o.h * 0.35;
      for (let k = 0; k < 8; k++) { const f = (t / 900 + k / 8) % 1, lado = (k % 2 ? 1 : -1) * (1 + (k % 3)); px(c, cx + lado * f * 4, top - Math.sin(f * Math.PI) * 7, 1, 1, "rgba(200,235,255,.9)"); }
    } else if (n === "servidor" || n === "servidor2") { // LEDs piscando
      for (let i = 0; i < 10; i++) {
        const on = (Math.floor(t / (120 + i * 37)) + i) % 3 !== 0;
        if (on) { c.fillStyle = i % 3 ? "#4ade80" : "#60a5fa"; c.fillRect(o.x + 4 + (i % 2) * (o.w - 9), o.y + 6 + Math.floor(i / 2) * (o.h / 6), 1, 1); }
      }
    } else if (n === "relogio") { // ponteiros na hora certa
      const ceu = Ceu.agora(), cx = o.x + o.w / 2, cy = o.y + o.h / 2, h = ceu.h;
      const ang = (v, tot) => (v / tot) * Math.PI * 2 - Math.PI / 2;
      c.strokeStyle = "#1b1b22"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang(h % 12, 12)) * 3, cy + Math.sin(ang(h % 12, 12)) * 3); c.stroke();
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang((h % 1) * 60, 60)) * 5, cy + Math.sin(ang((h % 1) * 60, 60)) * 5); c.stroke();
      if (t) { const sg = new Date().getSeconds(); c.strokeStyle = "#e11d48"; c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(ang(sg, 60)) * 5, cy + Math.sin(ang(sg, 60)) * 5); c.stroke(); }
    } else if (/^neon/.test(n)) { // neon falhando de vez em quando
      if (t && Math.floor(t / 90) % 37 === 0) { c.fillStyle = "rgba(10,10,20,.55)"; c.fillRect(o.x, o.y, o.w, o.h); }
    } else if (/^arcade/.test(n)) { // fliperama: o jogo roda sozinho (modo demonstração) e acende quando alguém joga
      const r = Mapa.TELAS[n]; if (!r) return;
      let jogando = false;
      if (mundo) for (const b of mundo.bonecos.values()) if (b.lugar && b.lugar.vaga && b.lugar.vaga.tipo === "arcade" && !b.rota.length && Math.abs(b.x - (o.x + o.w / 2)) < 12) { jogando = true; break; }
      const x = o.x + r[0], y = o.y + r[1];
      c.save(); c.beginPath(); c.rect(x, y, r[2], r[3]); c.clip();
      jogo(c, x, y, r[2], r[3], t, +n.slice(-1) - 1);
      if (!jogando) { px(c, x, y, r[2], r[3], "rgba(8,8,16,.4)"); if (Math.floor(t / 600) % 2) px(c, x + 1, y + r[3] - 2, r[2] - 2, 1, "#ffd23f"); }   // "insira a ficha"
      c.restore();
    }
  }

  // ---------------- agentes: chapéu da festa, emote, poeira, confete
  function chapeu(c, b, x, y, festa) {
    if (!festa || !festa.chapeu) return;
    const cx = x + 11, topo = y + 8;
    const px = (a, bb, w, h, cor) => { c.fillStyle = cor; c.fillRect(cx + a, topo + bb, w, h); };
    switch (festa.chapeu) {
      case "noel": px(-5, -2, 10, 2, "#ffffff"); px(-4, -5, 8, 3, "#e11d48"); px(-2, -7, 5, 2, "#e11d48"); px(2, -8, 3, 2, "#e11d48"); px(4, -9, 2, 2, "#ffffff"); break;
      case "bruxa": px(-7, -1, 14, 1, "#1f1530"); px(-4, -4, 8, 3, "#2d1f45"); px(-2, -7, 5, 3, "#2d1f45"); px(0, -9, 3, 2, "#2d1f45"); px(-4, -2, 8, 1, "#f97316"); break;
      case "coelho": px(-4, -8, 2, 7, "#ffffff"); px(2, -8, 2, 7, "#ffffff"); px(-3, -7, 1, 5, "#f9a8d4"); px(3, -7, 1, 5, "#f9a8d4"); break;
      case "festa": px(-3, -2, 6, 2, "#a855f7"); px(-2, -4, 4, 2, "#facc15"); px(-1, -6, 2, 2, "#22d3ee"); px(-1, -8, 2, 2, "#f43f5e"); break;
      case "palha": px(-7, -1, 14, 2, "#e6b85c"); px(-4, -4, 8, 3, "#d4a043"); px(-4, -2, 8, 1, "#b5472f"); break;
    }
  }

  const EMOTES = {
    videogame: ["....##....", ".########.", "##.####.##", "#...##..##", "##.####.##", ".########."],
    arcade: ["....##....", ".########.", "##.####.##", "#...##..##", "##.####.##", ".########."],
    pc: ["....##....", ".########.", "##.####.##", "#...##..##", "##.####.##", ".########."],
    cafe: [".#.#..", "..#.#.", "#####.", "#...##", "#...##", ".###.."], lanche: [".#.#..", "..#.#.", "#####.", "#...##", "#...##", ".###.."],
    musica: ["...###", "...#.#", "...#.#", ".###.#", "####..", ".##..."], tv: ["#.....#", ".#...#.", "#######", "#.....#", "#.....#", "#######"],
    reuniao: ["#######", "#.....#", "#.###.#", "#.....#", "#######", "..#.#.."], papo: [".#####.", "#.....#", "#.#.#.#", "#.....#", ".####..", ".#....."],
    poltrona: ["###..", "..#..", ".#...", "###..", ".....", "....."], pufe: ["###..", "..#..", ".#...", "###..", ".....", "....."],
    sinuca: [".###.", "#####", "##.##", "#####", ".###."], pebolim: [".###.", "#####", "##.##", "#####", ".###."], pingpong: [".###.", "#####", "##.##", "#####", ".###."],
  };
  function emote(c, b, t, noite) {
    if (b.fala || b.rota.length || !b.lugar || b.lugar.tipo !== "vaga") return;
    if (Math.floor(t / 3000 + b.x) % 3 !== 0) return;
    let tipo = b.lugar.vaga.tipo;
    if (noite > 0.6 && ["poltrona", "pufe", "tv"].includes(tipo)) tipo = "poltrona"; // zZz
    const ic = EMOTES[tipo]; if (!ic) return;
    // acima do nome (b.etq, do app.js), para nunca cobrir o rótulo
    const x = b.etq ? Math.round(b.etq.x + b.etq.w / 2 - ic[0].length / 2) : b.x + 6, y = (b.etq ? Math.round(b.etq.y) - ic.length - 4 : b.y - 34) - (Math.floor(t / 400) % 2);
    c.fillStyle = "rgba(255,255,255,.92)"; c.fillRect(x - 2, y - 2, ic[0].length + 4, ic.length + 4);
    c.fillStyle = "#1b1b22";
    ic.forEach((l, iy) => [...l].forEach((ch, ix) => { if (ch === "#") c.fillRect(x + ix, y + iy, 1, 1); }));
  }

  // ---------------- vida social (vida.js decide, aqui só se desenha): na luta, a nuvem de poeira de desenho animado cobre os
  // dois lutadores (o app.js não os desenha), com luvas e tênis saindo dela e as onomatopeias; quem perdeu fica com
  // estrelinhas em volta da cabeça enquanto b.tonto durar. Sem sangue, sem arma, sem machucado. Com menos movimento, tudo parado.
  const bolaPx = (c, cx, cy, r, cor) => { c.fillStyle = cor; for (let dy = -r; dy <= r; dy++) { const w = Math.round(Math.sqrt(r * r - dy * dy)); c.fillRect(cx - w, cy + dy, 2 * w + 1, 1); } };
  const NUVEM = [[-20, 0, 8], [-9, -6, 10], [5, -8, 10], [18, -2, 9], [-14, 5, 8], [1, 4, 10], [15, 6, 8], [-26, 4, 5], [25, 4, 5]];
  const ONOMATOPEIAS = ["POW!", "TCHUM!", "PAF!", "BUM!"];
  const estrela = (c, x, y, cor) => { px(c, x, y - 2, 1, 5, cor); px(c, x - 2, y, 5, 1, cor); px(c, x - 1, y - 1, 3, 3, cor); };
  function cena(c, mundo, t) {
    const cs = mundo.cenaSocial, parado = calmo.matches, agora = performance.now() / 1000;
    if (cs && cs.fase === "luta") {
      const cx = Math.round(cs.x), cy = Math.round(cs.y) - 12, vez = parado ? 0 : Math.floor(t / 140);
      const mexe = k => (parado ? 0 : Math.round(Math.sin(t / 90 + k * 1.7)));
      NUVEM.forEach(([dx, dy, r], k) => bolaPx(c, cx + dx + mexe(k), cy + dy + mexe(k + 3), r + 1, "#6b6b78"));   // contorno
      NUVEM.forEach(([dx, dy, r], k) => bolaPx(c, cx + dx + mexe(k), cy + dy + mexe(k + 3), r, k % 3 ? "#e6e2d6" : "#d6d1c2"));
      NUVEM.slice(1, 4).forEach(([dx, dy, r], k) => bolaPx(c, cx + dx - 2 + mexe(k + 1), cy + dy - 3 + mexe(k + 4), Math.max(2, r - 5), "#ffffff"));   // brilho de cima
      // braços e pernas saindo da borda da nuvem: luvas vermelha e azul (as cores dos corners) e tênis; mudam de lugar a cada 140 ms
      for (let k = 0; k < 5; k++) {
        const h = ((vez + k * 7) * 2654435761) >>> 0, ang = (k / 5) * Math.PI * 2 + ((h % 100) / 100 - 0.5) * 1.1 + (parado ? 0.4 : 0);
        const ex = cx + Math.cos(ang) * 25, ey = cy + Math.sin(ang) * 11, fx = ex + Math.cos(ang) * 9, fy = ey + Math.sin(ang) * 6, perna = Math.sin(ang) > 0.35;
        for (let s = 0; s <= 8; s++) px(c, Math.round(ex + (fx - ex) * s / 8), Math.round(ey + (fy - ey) * s / 8), 2, 2, "#3a3a46");
        if (perna) { px(c, Math.round(fx) - 2, Math.round(fy), 5, 3, "#f4f1ea"); px(c, Math.round(fx) - 2, Math.round(fy) + 2, 5, 1, "#8a909c"); }
        else { const luva = k % 2 ? "#3a6fd8" : "#d23c3c"; px(c, Math.round(fx) - 2, Math.round(fy) - 2, 5, 5, luva); px(c, Math.round(fx) - 1, Math.round(fy) - 2, 2, 1, claro(luva, 0.4)); }
      }
      for (let k = 0; k < 6; k++) { const h = ((vez + k * 13) * 40503) >>> 0; px(c, cx - 30 + (h % 60), cy + 8 + ((h >> 6) % 6), 1, 1, "#b9b3a6"); }   // poeirinha embaixo
      // onomatopeia: uma de cada vez, pulando de um lado e do outro da nuvem (parada no movimento reduzido)
      const n = parado ? 0 : Math.floor(t / 520), h = (n * 2246822519) >>> 0, txt = ONOMATOPEIAS[h % ONOMATOPEIAS.length];
      const tx = cx + (parado ? 1 : (h >> 4) % 2 ? 1 : -1) * (40 + ((h >> 8) % 6)), ty = cy + 4 - ((h >> 12) % 8);   // dos lados: em cima ficam os nomes
      c.save(); c.font = "8px Silkscreen, monospace"; c.textAlign = "center"; c.textBaseline = "alphabetic";
      c.lineWidth = 3; c.lineJoin = "round"; c.strokeStyle = "#1b1622"; c.strokeText(txt, tx, ty); c.fillStyle = h % 2 ? "#ffd36b" : "#ff9a4d"; c.fillText(txt, tx, ty);
      c.restore();
      if (!parado && Math.floor(t / 260) % 2) { estrela(c, cx - 22, cy - 12, "#ffd36b"); estrela(c, cx + 24, cy - 9, "#ffffff"); }
    }
    for (const b of mundo.bonecos.values()) { // estrelinhas girando em volta da cabeça de quem perdeu
      if (!(b.tonto > agora) || b.x < -20) continue;
      for (let k = 0; k < 3; k++) {
        const a = (parado ? 0 : t / 260) + (k * Math.PI * 2) / 3;
        estrela(c, Math.round(b.x + Math.cos(a) * 8), Math.round(b.y - 18 + Math.sin(a) * 2.5), k === 1 ? "#ffffff" : "#ffd36b");
      }
    }
  }

  // plaquinhas da greve (o vida.js põe b.placa em quem está sentado no chão): papelão num cabo de madeira, logo acima da
  // cabeça, com o motivo em até duas linhas. A fileira é apertada (14 px): cada um pega a altura mais baixa (de duas) que não
  // tapa a placa do vizinho, e quem não acha lugar ergue uma plaquinha pequena com "!", como numa passeata. Balançam no ritmo
  // do protesto (paradas com menos movimento). Desenhadas antes dos nomes; devolve os retângulos, e os nomes e os balões desviam
  function quebra(c, txt, max) {
    const ps = txt.split(/\s+/).filter(Boolean), linhas = [];
    for (const p of ps) { const u = linhas.length - 1; if (u >= 0 && c.measureText(`${linhas[u]} ${p}`).width <= max) linhas[u] += ` ${p}`; else linhas.push(p); }
    return linhas.length > 2 ? [linhas[0], linhas.slice(1).join(" ")] : linhas;
  }
  function placas(c, mundo, t) {
    // o pedido do aviso (o motivo da cena) escolhe o lugar primeiro: ele nunca vira só um "!"
    const cs = mundo.cenaSocial, pedido = cs && cs.tipo === "greve" && window.Vida && Vida.textoGreve ? Vida.textoGreve(cs.motivo) : null;
    const com = [...mundo.bonecos.values()].filter(b => typeof b.placa === "string" && b.placa && b.x > -20)
      .sort((a, b) => (b.placa === pedido) - (a.placa === pedido) || a.y - b.y || a.x - b.x);
    if (!com.length) return [];
    const parado = calmo.matches, rets = [];
    const bate = (x, y, w, h) => rets.some(r => x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y);
    c.save(); c.font = "6px Silkscreen, monospace"; c.textAlign = "center"; c.textBaseline = "alphabetic";
    com.forEach((b, i) => {
      const linhas = quebra(c, b.placa.toUpperCase().slice(0, 24), 38), cabeca = Math.round(b.y - 19), mao = Math.round(b.y - 9);
      let w = Math.ceil(Math.max(...linhas.map(l => c.measureText(l).width))) + 6, h = linhas.length * 6 + 4, base = null;
      for (const sobe of [0, 18]) if (base === null && !bate(Math.round(b.x - w / 2) - 1, cabeca - sobe - h - 1, w + 2, h + 2)) base = cabeca - sobe;
      const mini = base === null;
      if (mini) { w = 7; h = 8; for (const sobe of [0, 9, 18, 27]) if (base === null && !bate(Math.round(b.x - w / 2) - 1, cabeca - sobe - h - 1, w + 2, h + 2)) base = cabeca - sobe; }
      if (base === null) return;   // sem lugar nem para a pequena: segue só no coro
      const x = Math.round(b.x - w / 2);
      rets.push({ x: x - 1, y: base - h - 1, w: w + 2, h: h + 2 });   // o lugar reservado não conta o balanço
      base -= parado ? 0 : (Math.floor(t / 450) + i) % 2;   // um sobe enquanto o vizinho desce
      const y = base - h;
      px(c, Math.round(b.x), base, 1, Math.max(1, mao - base), "#8a5a32");   // cabo, da mão até a placa
      px(c, x - 1, y - 1, w + 2, h + 2, "#3b2a1e"); px(c, x, y, w, h, "#f1e4c4"); px(c, x, y + h - 1, w, 1, "#d6c193");
      c.fillStyle = "#b3261e";
      if (mini) c.fillText("!", x + w / 2, y + 7); else linhas.forEach((l, k) => c.fillText(l, x + w / 2, y + 7 + k * 6));
    });
    c.restore();
    return rets;
  }

  // ---------------- entrega da greve atendida (o vida.js decide o caminho; aqui só o desenho, todo em pixel): o item nas mãos
  // do entregador, o item entregue no ponto, a faixa e a brisa do ar. Com menos movimento, nada pisca nem balança
  const CONTORNO = "#2a2230";
  const ITENS = {
    pizza(c, x, y, t, mao) { // na mão: três caixas fechadas; entregue: duas caixas abertas com pizza
      if (mao) { for (let k = 0; k < 3; k++) { const yy = y - 3 * k; px(c, x - 7, yy - 3, 14, 3, CONTORNO); px(c, x - 6, yy - 3, 12, 2, "#d8b27a"); px(c, x - 2, yy - 3, 4, 1, "#c8332b"); } return; }
      for (const dx of [-8, 8]) {
        px(c, x + dx - 7, y - 15, 14, 6, CONTORNO); px(c, x + dx - 6, y - 14, 12, 5, "#e6c894");   // tampa aberta, de pé
        px(c, x + dx - 3, y - 13, 6, 1, "#c8332b");
        px(c, x + dx - 7, y - 9, 14, 9, CONTORNO); px(c, x + dx - 6, y - 8, 12, 7, "#d8b27a");
        bolaPx(c, x + dx, y - 5, 4, "#d98c3a"); bolaPx(c, x + dx, y - 5, 3, "#f2c14e");
        for (const [a, b] of [[-1, -6], [2, -4], [-2, -3]]) px(c, x + dx + a, y + b, 1, 1, "#c8332b");   // pepperoni
        px(c, x + dx, y - 5, 1, 3, "#d98c3a");   // uma fatia já saiu
      }
    },
    cafe(c, x, y, t, mao) { // garrafa térmica de inox com tampa vermelha; entregue: duas garrafas e os copinhos
      const garrafa = (gx, gy) => { px(c, gx - 3, gy - 13, 7, 13, CONTORNO); px(c, gx - 2, gy - 12, 5, 11, "#c9ced8"); px(c, gx - 2, gy - 12, 1, 11, "#eef0f4"); px(c, gx - 3, gy - 15, 7, 3, "#c8332b"); px(c, gx + 4, gy - 10, 1, 5, CONTORNO); };
      if (mao) { garrafa(x, y + 2); return; }
      garrafa(x - 5, y); garrafa(x + 4, y);
      for (const dx of [10, 13]) { px(c, x + dx, y - 4, 3, 4, CONTORNO); px(c, x + dx, y - 4, 2, 3, "#f4f1ea"); }
      if (!calmo.matches) for (let k = 0; k < 2; k++) { const f = ((t / 900 + k / 2) % 1); px(c, x - 5 + k * 9, Math.round(y - 17 - f * 6), 1, 2, `rgba(255,255,255,${0.6 * (1 - f)})`); }   // vapor
    },
    bolo(c, x, y, t, mao) { // na mão: caixa branca com fita; entregue: bolo de dois andares com vela
      if (mao) { px(c, x - 6, y - 8, 12, 9, CONTORNO); px(c, x - 5, y - 7, 10, 7, "#f4f1ea"); px(c, x - 1, y - 7, 2, 7, "#d23c6e"); px(c, x - 5, y - 4, 10, 1, "#d23c6e"); return; }
      px(c, x - 9, y - 1, 18, 2, "#c9ced8");   // prato
      px(c, x - 7, y - 7, 14, 6, CONTORNO); px(c, x - 6, y - 6, 12, 5, "#8a5a32"); px(c, x - 6, y - 6, 12, 2, "#f7b6cf");
      px(c, x - 4, y - 11, 8, 4, CONTORNO); px(c, x - 3, y - 10, 6, 3, "#8a5a32"); px(c, x - 3, y - 10, 6, 1, "#f7b6cf");
      for (const dx of [-5, -1, 3]) px(c, x + dx, y - 5, 1, 1, "#ffffff");   // confeitos
      px(c, x, y - 14, 1, 3, "#3a6fd8");
      const chama = calmo.matches || Math.floor(t / 160) % 2 ? "#ffd36b" : "#ff9a4d"; px(c, x, y - 16, 1, 2, chama);
    },
    pufe(c, x, y, t, mao) { // pufe redondo de tecido laranja com o botão no meio
      const yy = mao ? y - 2 : y;
      px(c, x - 7, yy - 8, 14, 8, CONTORNO); px(c, x - 6, yy - 7, 12, 6, "#f08a3c"); px(c, x - 6, yy - 7, 12, 2, "#ffb067");
      px(c, x - 6, yy - 3, 12, 1, "#c96a22"); px(c, x, yy - 6, 1, 1, "#8a4a1a");
    },
    roteador(c, x, y, t, mao) { // roteador preto com duas antenas e leds; entregue: o sinal sai em arcos
      px(c, x - 6, y - 5, 12, 5, CONTORNO); px(c, x - 5, y - 4, 10, 3, "#3a3a46");
      px(c, x - 4, y - 11, 1, 6, CONTORNO); px(c, x + 3, y - 11, 1, 6, CONTORNO);
      const pisca = calmo.matches ? 1 : Math.floor(t / 300) % 3;
      for (let k = 0; k < 3; k++) px(c, x - 3 + k * 3, y - 3, 1, 1, k <= pisca ? "#5bd88a" : "#1f5a36");
      if (mao) return;
      const n = calmo.matches ? 3 : 1 + Math.floor(t / 400) % 3;   // as barrinhas do wi-fi enchendo
      px(c, x, y - 14, 1, 1, "#8affc1");
      for (let k = 1; k <= n; k++) { const r = k * 3; for (let a = -2.36; a <= -0.78; a += 0.5 / r) px(c, Math.round(x + Math.cos(a) * r), Math.round(y - 14 + Math.sin(a) * r), 1, 1, "#8affc1"); }   // arcos do sinal
    },
    travesseiro(c, x, y, t, mao) { // travesseiros fofos; entregue: a pilha e um "z" subindo
      const um = (tx, ty, cor) => { px(c, tx - 6, ty - 5, 12, 5, CONTORNO); px(c, tx - 5, ty - 4, 10, 3, cor); px(c, tx - 5, ty - 4, 10, 1, "#ffffff"); };
      if (mao) { um(x, y, "#dfe7f4"); return; }
      um(x - 3, y, "#dfe7f4"); um(x + 4, y - 1, "#f4e2ec"); um(x, y - 4, "#e4f1e2");
      if (!calmo.matches) { const f = (t / 1400) % 1; c.save(); c.font = "6px Silkscreen, monospace"; c.textAlign = "center"; c.fillStyle = `rgba(255,255,255,${1 - f})`; c.fillText("z", x + 6 + f * 4, y - 10 - f * 8); c.restore(); }
    },
    ar(c, x, y, t) { // ar portátil, com o 23 no visor e a brisa saindo em ondinhas
      px(c, x - 6, y - 20, 12, 20, CONTORNO); px(c, x - 5, y - 19, 10, 18, "#eef0f4"); px(c, x - 5, y - 19, 10, 1, "#ffffff");
      px(c, x - 4, y - 17, 8, 7, "#1b2a34"); for (let k = 0; k < 3; k++) px(c, x - 4, y - 8 + k * 2, 8, 1, "#b9c2cc");
      c.save(); c.font = "6px Silkscreen, monospace"; c.textAlign = "center"; c.fillStyle = "#8affc1"; c.fillText("23", x, y - 11); c.restore();
      const f = calmo.matches ? 0.3 : (t / 1200) % 1;
      for (let k = 0; k < 3; k++) { const d = ((f + k / 3) % 1), bx = x + 6 + Math.round(d * 18), a = 0.75 * (1 - d); for (let i = 0; i < 5; i++) px(c, bx + i, y - 14 + k * 4 + Math.round(Math.sin((bx + i) / 2)), 1, 1, `rgba(170,220,255,${a})`); }
    },
    faixa() {},   // a faixa vai no ar (entregaAr)
  };
  // item entregue, no chão do ponto (o app.js ordena pela chave y, como os móveis)
  function entrega(c, e, t) { const f = ITENS[e.item]; if (f && e.fase === "entregue") f(c, Math.round(e.x), Math.round(e.y), t, false); }
  // item nas mãos do entregador; x,y = canto do quadro 22x22 do Avatar.boneco
  function itemNaMao(c, item, x, y, t) { const f = ITENS[item]; if (f && item !== "ar" && item !== "faixa") f(c, x + 11, y + 17, t, true); }
  // o motoboy da pizza: capacete vermelho por cima do boné, com a viseira para o lado em que anda, e a bag térmica nas
  // costas: de costas, cobre o corpo; de lado, sai para trás do ombro; de frente, fica escondida. x,y = canto do quadro
  // 22x22 (depois do Avatar.boneco), como no itemNaMao
  function uniforme(c, item, x, y, olha) {
    if (item !== "pizza") return;
    const cx = x + 11, topo = y + 8;
    if (olha !== "baixo") {
      const [bx, bw] = olha === "cima" ? [cx - 5, 10] : olha === "esq" ? [cx + 5, 7] : [cx - 12, 7];
      px(c, bx, topo + 2, bw, 10, CONTORNO); px(c, bx + 1, topo + 3, bw - 2, 8, "#c8332b"); px(c, bx + 1, topo + 3, bw - 2, 1, "#e8574d");
      px(c, bx + Math.floor(bw / 2) - 2, topo + 6, 4, 2, "#f2c14e");   // a etiqueta da pizzaria
    }
    px(c, cx - 7, topo - 4, 14, 8, CONTORNO); px(c, cx - 6, topo - 3, 12, 6, "#d23c3c"); px(c, cx - 5, topo - 3, 6, 1, "#ff8a7a");
    if (olha === "baixo") px(c, cx - 5, topo + 1, 10, 2, "#1b2a34");
    else if (olha === "esq") px(c, cx - 7, topo, 5, 3, "#1b2a34");
    else if (olha === "dir") px(c, cx + 2, topo, 5, 3, "#1b2a34");
  }
  // a moto do motoboy, estacionada na calçada ao lado da porta enquanto ele entrega (e.item "pizza", com entregador)
  function moto(c, x, y) {
    x = Math.round(x); y = Math.round(y);
    for (const rx of [x - 9, x + 9]) { bolaPx(c, rx, y - 4, 4, CONTORNO); bolaPx(c, rx, y - 4, 2, "#6b6b78"); px(c, rx, y - 4, 1, 1, "#c9ced8"); }
    px(c, x - 8, y - 10, 15, 4, CONTORNO); px(c, x - 7, y - 9, 13, 2, "#d23c3c");   // tanque e banco
    px(c, x - 6, y - 12, 7, 2, "#2b2b34");
    px(c, x + 6, y - 16, 2, 8, CONTORNO); px(c, x + 5, y - 17, 5, 2, CONTORNO); px(c, x + 9, y - 13, 2, 2, "#ffd36b");   // guidão e farol
    px(c, x - 15, y - 17, 9, 8, CONTORNO); px(c, x - 14, y - 16, 7, 6, "#c8332b"); px(c, x - 12, y - 14, 3, 2, "#f2c14e");   // o baú da pizza
  }
  // faixa "<pedido> aprovado!" com bandeirinhas, acima do ponto, enquanto a entrega estiver em "entregue"; devolve o retângulo
  function entregaAr(c, e, t) {
    if (!e || e.fase !== "entregue" || !e.faixa) return null;
    c.save(); c.font = "8px Silkscreen, monospace"; c.textAlign = "center"; c.textBaseline = "alphabetic";
    const txt = String(e.faixa).toUpperCase().slice(0, 32), w = Math.ceil(c.measureText(txt).width) + 14, x = Math.round(e.x - w / 2);
    const y = Math.round(e.y) - 52 + (calmo.matches ? 0 : Math.round(Math.sin(t / 360)));
    px(c, x - 1, y - 1, w + 2, 14, CONTORNO); px(c, x, y, w, 12, "#5bd88a"); px(c, x, y, w, 1, "#b8f5cf"); px(c, x, y + 11, w, 1, "#2f9a5c");
    for (let k = 0; k * 8 < w; k++) { const cor = ["#ffd36b", "#d23c3c", "#3a6fd8"][k % 3]; px(c, x + k * 8 + 2, y + 13, 4, 2, cor); px(c, x + k * 8 + 3, y + 15, 2, 1, cor); }   // bandeirinhas
    c.fillStyle = "#123a24"; c.fillText(txt, e.x, y + 9);
    if (!calmo.matches) for (let k = 0; k < 16; k++) { // a festinha: confete caindo da faixa, cada papelzinho no seu ritmo
      const f = ((t / (1400 + (k % 5) * 170)) + k * 0.37) % 1, cx = x + ((k * 53) % w) + Math.round(Math.sin(t / 300 + k) * 2);
      px(c, cx, y + 16 + Math.round(f * 34), 2, 1 + (k % 2), ["#ffd36b", "#d23c3c", "#3a6fd8", "#5bd88a", "#f7b6cf"][k % 5]);
    }
    c.restore();
    return { x: x - 1, y: y - 1, w: w + 2, h: 18 };
  }

  // faixa "VENCEU: <nome>" acima do ringue, pelos 6 s do resultado: por cima dos nomes e dos emotes; os balões desviam dela.
  // O nome do vencedor só aparece aqui (UI), nunca num balão; com menos movimento, a faixa fica parada
  function faixaVencedor(c, mundo, t) {
    const cs = mundo.cenaSocial, parado = calmo.matches;
    if (cs && cs.fase === "resultado" && cs.vencedor) { // faixa "VENCEU: <nome>" acima do ringue, pelos 6 s do resultado (o nome só aqui, nunca no balão)
      const v = mundo.bonecos.get(cs.vencedor), nome = v ? (v.nome.length > 16 ? v.nome.slice(0, 15).trimEnd() + "…" : v.nome) : "";
      if (nome) {
        c.save(); c.font = "8px Silkscreen, monospace"; c.textAlign = "center"; c.textBaseline = "alphabetic";
        const txt = `VENCEU: ${nome.toUpperCase()}`, w = Math.ceil(c.measureText(txt).width) + 12, x = Math.round(cs.x - w / 2), y = Math.round(cs.y) - 50 + (parado ? 0 : Math.round(Math.sin(t / 320)));
        px(c, x - 5, y + 3, 6, 9, "#c98f2a"); px(c, x + w - 1, y + 3, 6, 9, "#c98f2a");                 // pontas da faixa
        px(c, x - 5, y + 11, 2, 2, "#c98f2a"); px(c, x + w + 3, y + 11, 2, 2, "#c98f2a");
        px(c, x - 1, y - 1, w + 2, 14, "#1b1622"); px(c, x, y, w, 12, "#ffd36b"); px(c, x, y, w, 1, "#fff3c4"); px(c, x, y + 11, w, 1, "#e0a93b");
        c.fillStyle = "#1b1622"; c.fillText(txt, cs.x, y + 9);
        c.restore();
        return { x: x - 5, y: y - 2, w: w + 10, h: 16 };   // o app.js tira os balões de cima da faixa
      }
    }
    return null;
  }

  // quadro do placar na parede do ringue (o mapa.js pinta a moldura): título, o top 3 da semana e o campeão da semana
  // passada; sem placar (modo sério, Simulação, servidor sem vida social), "FECHADO". Só quem está no escritório aparece
  function placar(c, q, pl, mundo) {
    c.save(); c.font = "8px Silkscreen, monospace"; c.textBaseline = "alphabetic";
    c.textAlign = "center"; c.fillStyle = Mapa.cor("destaque"); c.fillText("RINGUE", q.x + q.w / 2, q.y + 9);
    const corta = (txt, max) => { if (c.measureText(txt).width <= max) return txt; while (txt.length > 1 && c.measureText(txt + "…").width > max) txt = txt.slice(0, -1); return txt + "…"; };
    const nome = id => { const b = mundo.bonecos.get(id); return b ? b.nome.toUpperCase() : null; };
    if (!pl) { c.fillStyle = "#f08a80"; c.fillText("FECHADO", q.x + q.w / 2, q.y + 26); c.restore(); return; }
    const top = (Array.isArray(pl.top) ? pl.top : []).filter(r => r && nome(r.id)).slice(0, 3);
    if (!top.length) { c.fillStyle = "#a3a39e"; c.fillText("SEM LUTAS", q.x + q.w / 2, q.y + 22); c.fillText("AINDA", q.x + q.w / 2, q.y + 30); }
    top.forEach((r, i) => {
      const y = q.y + 18 + i * 6, v = String(Math.max(0, Math.min(999, Math.round(Number(r.v) || 0))));
      c.textAlign = "left"; c.fillStyle = ["#ffd36b", "#c9ced8", "#e0a95a"][i]; c.fillText(String(i + 1), q.x + 4, y);
      c.textAlign = "right"; c.fillStyle = "#8affc1"; c.fillText(v, q.x + q.w - 4, y);
      c.textAlign = "left"; c.fillStyle = "#efefec"; c.fillText(corta(nome(r.id), q.w - 22 - c.measureText(v).width), q.x + 11, y);
    });
    const ant = pl.anterior && nome(pl.anterior.id);
    if (ant) { // coroa de pixel na frente do campeão da semana passada
      const kx = q.x + 4, ky = q.y + 32;
      for (const dx of [0, 2, 4]) px(c, kx + dx, ky, 1, 1, "#ffd36b");
      px(c, kx, ky + 1, 5, 3, "#ffd36b"); px(c, kx, ky + 3, 5, 1, "#c98f2a"); px(c, kx + 2, ky + 2, 1, 1, "#d23c3c");
      c.textAlign = "left"; c.fillStyle = "#ffd36b"; c.fillText(corta(ant, q.w - 16), q.x + 11, q.y + 37); }
    c.restore();
  }

  // objetos arremessados pela vida.js (bolinha de papel, aviãozinho): arco curto de ~0,6 s; com menos movimento, já no destino
  const voos = [];
  function lancar(x0, y0, x1, y1, tipo) { voos.push({ x0, y0, x1, y1, tipo, ini: performance.now() }); }
  function desenharVoos(c) {
    for (let i = voos.length - 1; i >= 0; i--) {
      const v = voos[i], f = (performance.now() - v.ini) / 600; if (f >= 1) { voos.splice(i, 1); continue; }
      const g = calmo.matches ? 1 : f, alto = Math.min(26, Math.hypot(v.x1 - v.x0, v.y1 - v.y0) * 0.35);
      const x = v.x0 + (v.x1 - v.x0) * g, y = v.y0 + (v.y1 - v.y0) * g - Math.sin(g * Math.PI) * alto;
      if (v.tipo === "aviao") { const dir = v.x1 >= v.x0 ? 1 : -1; px(c, x - 2 * dir, y, 4, 1, "#f4f4f0"); px(c, x - dir, y + 1, 2, 1, "#c9ccd4"); px(c, x + 2 * dir, y - 1, 1, 1, "#f4f4f0"); }
      else { px(c, x, y, 2, 2, "#f4f4f0"); px(c, x + 1, y + 1, 1, 1, "#b8bcc6"); }
    }
  }
  function particulas(c, dt, mundo, t) {
    desenharVoos(c);
    for (const b of mundo.bonecos.values()) {
      if (calmo.matches) { b.confete = 0; continue; }
      if (b.rota.length && Math.random() < dt * 6) part.push({ x: b.x + (Math.random() - 0.5) * 6, y: b.y, vx: 0, vy: -4, vida: 0.5, cor: "rgba(200,190,170,.6)", tam: 1 });
      if (b.confete && performance.now() - b.confete < 120) {
        for (let i = 0; i < 40; i++) part.push({ x: b.x, y: b.y - 20, vx: (Math.random() - 0.5) * 70, vy: -40 - Math.random() * 50, vida: 1.6, cor: ["#f43f5e", "#facc15", "#22d3ee", "#a3e635", "#a855f7"][i % 5], tam: 2, gravidade: true });
        b.confete = 0;
      }
    }
    for (let i = part.length - 1; i >= 0; i--) {
      const p = part[i]; p.vida -= dt; if (p.vida <= 0) { part.splice(i, 1); continue; }
      if (p.gravidade) p.vy += 90 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      c.fillStyle = p.cor; c.globalAlpha = Math.min(1, p.vida * 2); c.fillRect(p.x, p.y, p.tam, p.tam); c.globalAlpha = 1;
    }
  }

  // ---------------- robô aspirador (à noite, na sala comunal)
  function robo(c, dt, t, ceu) {
    const s = P.lounge; if (!s) return;
    if (ceu.escuro < 0.5) { aspirador = null; return; }
    if (!aspirador) aspirador = { x: s.px + 40, y: s.chao + 60, vx: 22, vy: 14 };
    const a = aspirador, minY = s.chao + 50, maxY = s.py + s.ph - 10;
    a.x += a.vx * dt; a.y += a.vy * dt;
    if (a.x < s.px + 12 || a.x > s.px + s.pw - 12) { a.vx *= -1; a.vy = (Math.random() - 0.5) * 30; }
    if (a.y < minY || a.y > maxY) a.vy *= -1;
    c.fillStyle = "rgba(0,0,0,.25)"; c.beginPath(); c.ellipse(a.x, a.y + 2, 6, 2, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#2b2b36"; c.beginPath(); c.ellipse(a.x, a.y, 6, 4, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#51515f"; c.beginPath(); c.ellipse(a.x, a.y - 1, 4, 2.5, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = Math.floor(t / 400) % 2 ? "#4ade80" : "#16a34a"; c.fillRect(a.x - 0.5, a.y - 2, 1, 1);
  }

  // ---------------- painel com o logo (sala comunal)
  function painelLogo(c, t, ceu) {
    const rec = P.salas[0] && P.salas[0].placaLogo;
    if (rec && logoPx) { const k = Math.min((rec.w - 4) / logoPx.width, (rec.h - 4) / logoPx.height); const w = logoPx.width * k, h = logoPx.height * k; c.drawImage(logoPx, Math.round(rec.x + (rec.w - w) / 2), Math.round(rec.y + (rec.h - h) / 2), Math.round(w), Math.round(h)); }
    const L = P.lounge && P.lounge.logo; if (!L) return;
    const cor = Mapa.cor("destaque");
    c.fillStyle = "#1b1a26"; c.fillRect(L.x - 2, L.y - 2, L.w + 4, L.h + 4);
    c.fillStyle = "#0d1020"; c.fillRect(L.x, L.y, L.w, L.h);
    c.fillStyle = cor; c.fillRect(L.x, L.y, L.w, 1); c.fillRect(L.x, L.y + L.h - 1, L.w, 1);
    c.fillStyle = "#3a3f58"; c.fillRect(L.x + 3, L.y - 4, 1, 3); c.fillRect(L.x + L.w - 4, L.y - 4, 1, 3); // suportes
    if (logoPx) c.drawImage(logoPx, Math.round(L.x + (L.w - logoPx.width) / 2), L.y + 3);
    c.font = "5px Silkscreen, monospace"; c.textAlign = "center"; c.textBaseline = "alphabetic";
    c.fillStyle = "#ffffff"; c.fillText((CFG.empresa || "").toUpperCase(), L.x + L.w / 2, L.y + L.h - 3);
    if (ceu.escuro > 0.2 || calmo.matches || Math.floor(t / 4000) % 2) { // neon da moldura (fixo com menos movimento)
      c.globalCompositeOperation = "lighter";
      brilho(c, L.x + L.w / 2, L.y + L.h / 2, L.w * 0.7, hexA(cor, 0.12 + 0.25 * ceu.escuro));
      c.globalCompositeOperation = "source-over";
    }
  }
  // placa de loja na entrada: ABERTO com o horário e luz verde, ou FECHADO com a hora de abrir e luz vermelha (o âmbar é
  // só do "esperando você"). Segue a hora do mapa (?hora, Simulação, demonstração) e o expediente do Personalizar.
  function placaExpediente(c, o) {
    const E = window.Expediente, fechado = !!E && E.fora(Ceu.agora().h);
    const x = o.x + 2, y = o.y, w = o.w - 4, cor = fechado ? "#f87171" : "#4ade80";   // 2 px de folga de cada lado (mapa.js)
    const t1 = fechado ? "FECHADO" : "ABERTO", t2 = !E ? "07:00-20:00" : fechado ? `ABRE ${E.proximaAbertura()}` : `${E.abre}-${E.fecha}`;
    px(c, x + 5, y + 32, w - 10, 2, "rgba(0,0,0,.22)");                                     // sombra no gramado
    px(c, x + 9, y + 25, 2, 8, "#3a3f58"); px(c, x + w - 11, y + 25, 2, 8, "#3a3f58");      // pés
    px(c, x, y, w, 26, "#1b1a26"); px(c, x + 1, y + 1, w - 2, 24, "#0d1020");
    px(c, x + 1, y + 1, w - 2, 1, cor);                                                       // filete na cor do estado
    c.font = "8px Silkscreen, monospace"; c.textAlign = "left"; c.textBaseline = "alphabetic";
    const l1 = Math.ceil(c.measureText(t1).width), x1 = Math.round(x + (w - l1 - 6) / 2) + 6;
    o.luz = { x: x1 - 4, y: y + 8, cor };                                                     // para o brilho de noite
    px(c, x1 - 6, y + 6, 3, 3, cor); px(c, x1 - 6, y + 6, 1, 1, "#ffffff");                   // luzinha
    c.fillStyle = cor; c.fillText(t1, x1, y + 11);
    c.fillStyle = "#e5e7eb"; c.fillText(t2, Math.round(x + (w - c.measureText(t2).width) / 2), y + 21);
  }

  function hexA(h, a) { const n = parseInt(h.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

  // ---------------- datas comemorativas
  function festaChao(c, festa) { // objetos temáticos espalhados (sem depender de profundidade)
    if (!festa) return;
    const rec = P.salas[0], L = P.lounge, coz = P.baixo[2], k = festa.tema || festa.chave;   // data própria: as peças do tema dela
    const pontos = [[rec.px + rec.pw - 34, rec.py + rec.ph - 6], [L.px + L.pw - 30, L.chao + 26], [L.px + 30, L.chao + 26], [coz.px + 66, coz.py + coz.ph - 6]];
    const itens = { natal: ["arvore_natal", "presentes", "arvore_natal", "presentes"], halloween: ["abobora", "abobora2", "abobora", "abobora2"], pascoa: ["ovos", "coelho", "ovos", "coelho"],
      chines: ["lanterna", "lanterna", "lanterna", "lanterna"], junina: [null, "fogueira", null, null], anonovo: ["champanhe", "champanhe", "champanhe", null],
      carnaval: ["mascara", "mascara", null, null], diwali: ["diwali", "diwali", "diwali", "diwali"] }[k] || [];
    itens.forEach((n, i) => { const s = n && tam(n); if (s) spr(c, n, pontos[i][0] - s[2] / 2, pontos[i][1] - s[3]); });
    if (k === "junina") { const s = tam("fogueira"); if (s) spr(c, "fogueira", P.predioRet.x + 120, P.predioRet.y - 12 - s[3]); }
  }

  function festaAr(c, festa, t, dt, ceu) { // pisca-pisca, bandeirinhas, fogos, morcegos, confete, corações
    if (!festa) return;
    const en = new Set(festa.enfeites), cores = festa.cores;
    const todas = [...P.salas, ...P.baixo];
    if (en.has("pisca")) for (const s of todas) for (let x = s.px + 4; x < s.px + s.pw - 4; x += 6) {
      const on = (Math.floor(t / 500) + x / 6) % 2 < 1;
      c.fillStyle = on ? cores[(x / 6 | 0) % cores.length] : "#3a3a48"; c.fillRect(x, s.py + 1 + ((x / 6 | 0) % 2), 2, 2);
      if (on && ceu.escuro > 0.3) { c.globalCompositeOperation = "lighter"; brilho(c, x + 1, s.py + 2, 5, hexA(cores[(x / 6 | 0) % cores.length], 0.35)); c.globalCompositeOperation = "source-over"; }
    }
    if (en.has("bandeirinhas")) { // varal de bandeirinhas no corredor
      const y0 = P.corredorTopo + 3;
      c.strokeStyle = "#5b5b66"; c.lineWidth = 0.5; c.beginPath(); c.moveTo(P.predioRet.x + 16, y0); c.lineTo(P.predioRet.x + P.predioRet.w - 16, y0); c.stroke();
      for (let x = P.predioRet.x + 20, i = 0; x < P.predioRet.x + P.predioRet.w - 20; x += 8, i++) {
        c.fillStyle = cores[i % cores.length]; c.beginPath(); c.moveTo(x, y0); c.lineTo(x + 6, y0); c.lineTo(x + 3, y0 + 6 + Math.sin(t / 500 + i) * 0.6); c.closePath(); c.fill();
      }
    }
    if (en.has("lanternas")) { const s = tam("lanterna"); if (s) for (let x = P.predioRet.x + 30; x < P.predioRet.x + P.predioRet.w - 40; x += 90) spr(c, "lanterna", x + Math.sin(t / 900 + x) * 1, P.corredorTopo + 1); }
    if (en.has("confete")) {
      if (!calmo.matches && Math.random() < dt * 12) part.push({ x: P.lounge.px + Math.random() * P.lounge.pw, y: P.lounge.chao, vx: (Math.random() - 0.5) * 10, vy: 18 + Math.random() * 14, vida: 3, cor: cores[Math.floor(Math.random() * cores.length)], tam: 1.5 });
    }
    if (en.has("coracoes") || en.has("baloes")) for (let i = 0; i < 6; i++) {
      const x = P.lounge.px + 20 + i * (P.lounge.pw - 40) / 6, y = P.lounge.chao + 20 - ((t / 60 + i * 37) % 60);
      c.fillStyle = cores[i % cores.length];
      if (en.has("coracoes")) { c.fillRect(x, y, 2, 2); c.fillRect(x + 3, y, 2, 2); c.fillRect(x, y + 1, 5, 2); c.fillRect(x + 1, y + 3, 3, 1); c.fillRect(x + 2, y + 4, 1, 1); }
      else { c.beginPath(); c.ellipse(x, y, 3, 4, 0, 0, Math.PI * 2); c.fill(); c.fillStyle = "#9ca3af"; c.fillRect(x, y + 4, 0.5, 8); }
    }
    if (en.has("fogos") && ceu.escuro > 0.4) { // fogos sobre o jardim de cima
      if (Math.random() < dt * 0.9) fogos.push({ x: 30 + Math.random() * (P.W - 60), y: 10 + Math.random() * (P.predioRet.y - 30), r: 0, cor: cores[Math.floor(Math.random() * cores.length)] });
      c.globalCompositeOperation = "lighter";
      for (let i = fogos.length - 1; i >= 0; i--) {
        const f = fogos[i]; f.r += dt * 26; if (f.r > 22) { fogos.splice(i, 1); continue; }
        for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2; c.fillStyle = hexA(f.cor, 1 - f.r / 22); c.fillRect(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r + f.r * f.r * 0.01, 1.5, 1.5); }
      }
      c.globalCompositeOperation = "source-over";
    }
    if (en.has("morcegos") && ceu.escuro > 0.3) for (let i = 0; i < 5; i++) {
      const x = (t / 30 + i * 140) % P.W, y = 20 + Math.sin(t / 500 + i * 2) * 10 + i * 8, asa = Math.floor(t / 120 + i) % 2;
      c.fillStyle = "#1b1530"; c.fillRect(x, y, 2, 2); c.fillRect(x - 3, y - asa, 3, 1); c.fillRect(x + 2, y - asa, 3, 1);
    }
  }

  // H) onde está o robô aspirador agora (null de dia ou fora da sala comunal)
  const posAspirador = () => (aspirador ? { x: aspirador.x, y: aspirador.y } : null);

  return { lancar, aspirador: posAspirador, tela, objeto, animado, iniciar, exterior, luzesNoite, depoisObjeto, chapeu, emote, particulas, robo, painelLogo, festaChao, festaAr, cena, placas, entrega, itemNaMao, uniforme, moto, entregaAr, faixaVencedor, placar };
})();

window.Efeitos = Efeitos;
