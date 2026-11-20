// Céu pelo horário real (fuso de Brasília por padrão; o andar com cidade própria passa o fuso dela em definirFuso):
// cor do céu, quão escuro está o prédio e o desenho de cada janela (nuvens, sol, lua, estrelas e cidade acesa à noite).
"use strict";

const Ceu = (() => {
  const FUSO = "America/Sao_Paulo";
  // hora: [cor de cima, cor de baixo, escuro 0..1]
  const QUADROS = [
    [0, "#0b1030", "#1b2350", 1], [5, "#141a45", "#2a2f63", 0.95], [6, "#f08a5d", "#fbd38d", 0.5],
    [7.5, "#5aa7f0", "#bfe3ff", 0], [12, "#3d95ee", "#a9d8ff", 0], [16.5, "#5aa7f0", "#cfe9ff", 0],
    [18, "#f0784a", "#ffc27a", 0.35], [19.3, "#3b2a6b", "#7a4a8a", 0.75], [20.5, "#101538", "#222a5a", 1], [24, "#0b1030", "#1b2350", 1],
  ];
  const relogio = fuso => new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit", hour12: false });
  let fmt = relogio(FUSO), fuso = FUSO;
  // o fuso IANA da cidade do andar (o /api/config manda em clima.fuso); sem ele, ou um que o navegador não conhece, Brasília
  function definirFuso(f) {
    let novo = FUSO;
    if (typeof f === "string" && f.length <= 40) try { fmt = relogio(f); novo = f; } catch (e) { /* fuso desconhecido */ }
    if (novo === FUSO) fmt = relogio(FUSO);
    fuso = novo;
    return fuso;
  }

  function rgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function mistura(a, b, f) { const x = rgb(a), y = rgb(b); return `rgb(${x.map((v, i) => Math.round(v + (y[i] - v) * f)).join(",")})`; }

  // ?hora=21.5 na URL simula outro horário (para ver o escritório de noite sem esperar)
  const simulada = parseFloat(new URLSearchParams(location.search).get("hora"));

  // modo demonstração: o relógio corre das 8h às 22h e recomeça (segundos de verdade por hora do escritório);
  // com ?hora= na URL (simulação), a hora simulada vale e o relógio fica parado nela
  let rapido = null;
  function acelerar(inicio, segundosPorHora) { rapido = { inicio, s: segundosPorHora, t0: performance.now() }; }

  function agora() {
    const partes = fmt.formatToParts(new Date());
    let hh = +partes.find(p => p.type === "hour").value % 24, mm = +partes.find(p => p.type === "minute").value;
    if (simulada >= 0 && simulada < 24) { hh = Math.floor(simulada); mm = Math.round((simulada - hh) * 60) % 60; }
    let h = hh + mm / 60 + (simulada >= 0 ? 0 : new Date().getSeconds() / 3600);
    if (rapido && !(simulada >= 0 && simulada < 24)) { h = rapido.inicio + ((performance.now() - rapido.t0) / 1000 / rapido.s) % (22 - rapido.inicio); hh = Math.floor(h); mm = Math.floor((h - hh) * 60); }
    let i = 0; while (i < QUADROS.length - 2 && QUADROS[i + 1][0] <= h) i++;
    const [h0, c0, b0, e0] = QUADROS[i], [h1, c1, b1, e1] = QUADROS[i + 1];
    const f = (h - h0) / (h1 - h0);
    const periodo = h < 5 ? "madrugada" : h < 12 ? "manhã" : h < 18 ? "tarde" : "noite";
    return { h, cima: mistura(c0, c1, f), baixo: mistura(b0, b1, f), escuro: e0 + (e1 - e0) * f, periodo,
             hora: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
  }

  function semente(x, y) { let s = (x * 73856093) ^ (y * 19349663); return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

  // Janela com moldura; céu dentro conforme a hora.
  function janela(c, j, ceu, t) {
    const { x, y, w, h } = j;
    const moldura = ["#e9e6f0", "#8a5a3a", "#2b2b36"][(j.estilo || 0) % 3];
    c.fillStyle = "#23212f"; c.fillRect(x - 2, y - 2, w + 4, h + 4);
    c.fillStyle = moldura; c.fillRect(x - 1, y - 1, w + 2, h + 2);
    const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, ceu.cima); g.addColorStop(1, ceu.baixo);
    c.fillStyle = g; c.fillRect(x, y, w, h);
    c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
    const r = semente(x, y);
    const dia = 1 - ceu.escuro;
    // sol ou lua atravessando a janela ao longo do dia
    const fr = ((ceu.h - 6) / 12 + 1) % 1, astroX = x + 2 + fr * (w - 6), astroY = y + h * 0.55 - Math.sin(fr * Math.PI) * h * 0.4;
    if (ceu.h >= 6 && ceu.h <= 18.5) { c.fillStyle = ceu.h > 17 ? "#ffb347" : "#fff3b0"; c.fillRect(astroX, astroY, 4, 4); c.fillStyle = "rgba(255,240,170,.35)"; c.fillRect(astroX - 1, astroY - 1, 6, 6); }
    else { const lx = x + w * 0.7, ly = y + 4; c.fillStyle = "#f4f1de"; c.fillRect(lx, ly, 4, 4); c.fillStyle = ceu.cima; c.fillRect(lx + 2, ly, 2, 2); }
    if (ceu.escuro > 0.4) { // estrelas piscando
      for (let i = 0; i < Math.floor(w * h / 40); i++) {
        const sx = x + Math.floor(r() * w), sy = y + Math.floor(r() * h * 0.6), pisca = (Math.floor(t / 600 + i) % 5) !== 0;
        if (pisca) { c.fillStyle = `rgba(255,255,255,${0.5 * ceu.escuro})`; c.fillRect(sx, sy, 1, 1); }
      }
    }
    if (dia > 0.3) { // nuvens andando
      for (let i = 0; i < 2; i++) {
        const nx = x + ((t / (90 + i * 40) + r() * w) % (w + 16)) - 8, ny = y + 3 + i * 6 + Math.floor(r() * 3);
        c.fillStyle = `rgba(255,255,255,${0.85 * dia})`; c.fillRect(nx, ny + 1, 9, 2); c.fillRect(nx + 2, ny, 5, 1);
      }
    }
    // cidade ao fundo
    let bx = x;
    while (bx < x + w) {
      const bw = 3 + Math.floor(r() * 4), bh = 4 + Math.floor(r() * (h * 0.45));
      c.fillStyle = ceu.escuro > 0.5 ? "#141633" : mistura("#6f86a8", "#1a1d3a", ceu.escuro);
      c.fillRect(bx, y + h - bh, bw, bh);
      if (ceu.escuro > 0.45) for (let wy = y + h - bh + 2; wy < y + h - 1; wy += 2) for (let wx = bx + 1; wx < bx + bw - 1; wx += 2)
        if (r() < 0.45 && (Math.floor(t / 4000 + wx + wy) % 9)) { c.fillStyle = "rgba(255,214,120,.85)"; c.fillRect(wx, wy, 1, 1); }
      bx += bw + 1;
    }
    c.restore();
    const est = j.estilo || 0;
    c.fillStyle = moldura; // caixilho: cruz, só vertical ou só horizontal conforme o estilo
    if (est !== 2) c.fillRect(x + Math.floor(w / 2), y, 1, h);
    if (est !== 1 && est !== 3) c.fillRect(x, y + Math.floor(h / 2), w, 1);
    if (est === 3) { // persiana meio baixada (desce mais à noite), com cordinha balançando
      const desce = Math.round(h * (0.3 + 0.35 * ceu.escuro));
      for (let yy = y; yy < y + desce; yy += 2) { c.fillStyle = "#e8e4d8"; c.fillRect(x, yy, w, 1); c.fillStyle = "#b9b3a3"; c.fillRect(x, yy + 1, w, 1); }
      c.fillStyle = "#8f8878"; c.fillRect(x, y + desce, w, 1);
      const corda = t ? Math.round(Math.sin(t / 900 + x) * 0.8) : 0;
      c.fillRect(x + w - 3, y + desce, 1, 2); c.fillRect(x + w - 3 + corda, y + desce + 2, 1, 2); c.fillRect(x + w - 4 + corda, y + desce + 4, 3, 1);
    } else if (est === 4) { // cortinas nas laterais com a barra mexendo de leve (vento do ar-condicionado), com varão
      const pano = ["#b8454f", "#3f6e9e", "#5e8a52"][(x >> 4) % 3], dobra = "rgba(0,0,0,.22)", meio = Math.floor(h * 0.45);
      for (const [x0, dir] of [[x - 3, 1], [x + w - 3, -1]]) {
        const sopro = t ? Math.round(Math.sin(t / 1700 + x0 * 0.3) * 0.9) * dir : 0;
        c.fillStyle = pano; c.fillRect(x0, y - 1, 6, meio + 1); c.fillRect(x0 + sopro, y + meio, 6, h + 2 - meio);
        c.fillStyle = dobra; c.fillRect(x0 + 2, y - 1, 1, meio + 1); c.fillRect(x0 + 2 + sopro, y + meio, 1, h + 2 - meio); c.fillRect(x0 + (dir > 0 ? 5 : 0), y + meio, 1, 3);
      }
      c.fillStyle = "#4a3a2c"; c.fillRect(x - 5, y - 3, w + 10, 2);
    }
    c.fillStyle = "#cfcbdc"; c.fillRect(x - 2, y + h + 1, w + 4, 2); // peitoril
    // facho de sol entrando pela janela e caindo no chão (com listras se a persiana estiver baixada)
    if (dia > 0.3 && ceu.h >= 7 && ceu.h <= 17.5) {
      const inclina = Math.round(((ceu.h - 12) / 6) * -10), y0 = y + h + 3, alto = 30, forca = 0.07 * dia * (["limpo", ""].includes(Clima.tipo() || "") ? 1 : 0.35);
      c.save(); c.globalCompositeOperation = "lighter";
      for (let k = 0; k < alto; k += est === 3 ? 3 : 1) {
        const f = k / alto;
        c.fillStyle = `rgba(255,236,190,${forca * (1 - f)})`;
        c.fillRect(Math.round(x + inclina * f), y0 + k, w, est === 3 ? 2 : 1);
      }
      c.restore();
    }
  }

  return { agora, janela, acelerar, definirFuso, get fuso() { return fuso; } };
})();

window.Ceu = Ceu;
