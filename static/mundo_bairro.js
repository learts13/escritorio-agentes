// Bairro dos escritórios, o nível final do mundo: um bairro em pixel art com o chalé deste escritório.
// A porta leva à recepção pública (ou à visita, quando o link trouxe convite). Os chalés vizinhos são
// cenário: a descoberta de outros escritórios ainda não existe, e nada aqui vem de outro servidor.
// Céu pelo horário (Ceu) e clima (Clima), com vento; ?hora=, ?clima= e ?vento= simulam, como no escritório.
// cena(destino) desenha um quadro em 320x180 no ctx recebido (o mundo.js usa assim); criar(canvas, destino) é o
// bairro sozinho num canvas, com o próprio laço de quadros.
"use strict";
const MundoBairro = (() => {
  const W = 320, H = 180, RUA = 150, CALCADA = 138;
  const CHALES = [
    { x: 34, w: 64, h: 40, parede: "#b9784a", telhado: "#7a2f2a", vizinho: true },
    { x: 128, w: 72, h: 46, parede: "#e4c48e", telhado: "#2f5a8a", vizinho: false },
    { x: 226, w: 62, h: 38, parede: "#8fae7a", telhado: "#5a3a6a", vizinho: true },
  ];
  const ARVORES = [12, 108, 214, 302];
  function porta(c) { return { x: c.x + c.w / 2 - 6, y: CALCADA - 18, w: 12, h: 18 }; }
  function dentro(p, x, y) { return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h; }

  // reduzido (prefers-reduced-motion): sem as partículas de chuva e neve e sem o clarão do raio; o céu fechado fica
  function cena(destino, { reduzido = false } = {}) {
    let ctx = null;
    const estado = {
      carro: { x: -30, v: 34 }, pessoas: [{ x: 60, v: 9, cor: "#d0453b" }, { x: 250, v: -7, cor: "#3b7bd0" }],
      cao: { x: 170, pulo: 0 }, aviao: { x: -40, espera: 2 }, passaros: [], nuvens: [{ x: 40, y: 24 }, { x: 190, y: 14 }, { x: 280, y: 34 }],
    };
    const principal = CHALES.find(c => !c.vizinho), alvo = porta(principal);

    function janela(x, y, acesa) {
      ctx.fillStyle = acesa ? "#ffd977" : "#9fc4e0"; ctx.fillRect(x, y, 8, 7);
      ctx.fillStyle = "#4a3426"; ctx.fillRect(x + 3, y, 1, 7); ctx.fillRect(x, y + 3, 8, 1);
    }
    function chale(c, noite, neve) {
      const base = CALCADA, topo = base - c.h;
      ctx.fillStyle = c.parede; ctx.fillRect(c.x, topo, c.w, c.h);
      ctx.fillStyle = "rgba(0,0,0,.12)"; for (let y = topo + 3; y < base; y += 4) ctx.fillRect(c.x, y, c.w, 1); // tábuas
      ctx.fillStyle = c.telhado; ctx.beginPath();
      ctx.moveTo(c.x - 6, topo + 1); ctx.lineTo(c.x + c.w / 2, topo - 24); ctx.lineTo(c.x + c.w + 6, topo + 1); ctx.fill();
      if (neve) { ctx.fillStyle = "#f4f7ff"; ctx.beginPath(); ctx.moveTo(c.x - 4, topo - 1); ctx.lineTo(c.x + c.w / 2, topo - 24); ctx.lineTo(c.x + c.w + 4, topo - 1); ctx.lineTo(c.x + c.w / 2, topo - 18); ctx.fill(); }
      ctx.fillStyle = "#6b4a3a"; ctx.fillRect(c.x + c.w - 16, topo - 20, 7, 12); // chaminé
      janela(c.x + 7, topo + 10, noite); janela(c.x + c.w - 15, topo + 10, noite && !c.vizinho);
      const p = porta(c);
      ctx.fillStyle = c.vizinho ? "#5b4636" : "#8a4b2a"; ctx.fillRect(p.x, p.y, p.w, p.h);
      ctx.fillStyle = "#f5b83d"; ctx.fillRect(p.x + 9, p.y + 9, 2, 2);
      if (!c.vizinho) { // placa e luz da varanda
        ctx.fillStyle = "#2a1d14"; ctx.fillRect(c.x + c.w / 2 - 18, topo - 6, 36, 9);
        ctx.fillStyle = "#f2e6c8"; ctx.font = "7px monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("RECEPÇÃO", c.x + c.w / 2, topo - 1.5);
        if (noite) { ctx.fillStyle = "rgba(255,217,119,.25)"; ctx.beginPath(); ctx.arc(p.x + 6, p.y - 2, 16, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    function arvore(x, neve) { // a copa balança com o vento (o tronco fica)
      const d = Math.round(Clima.balanco ? Clima.balanco(x * 0.37) : 0);
      ctx.fillStyle = "#5a3a22"; ctx.fillRect(x - 2, CALCADA - 14, 4, 14);
      ctx.fillStyle = neve ? "#dfe8ee" : "#3f8a3c"; ctx.beginPath(); ctx.arc(x + d, CALCADA - 20, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = neve ? "#ffffff" : "#5aa64f"; ctx.beginPath(); ctx.arc(x - 3 + d, CALCADA - 23, 5, 0, Math.PI * 2); ctx.fill();
    }
    function pessoa(x, cor, t) {
      const passo = Math.floor(t / 180) % 2;
      ctx.fillStyle = "#f0c8a0"; ctx.fillRect(x, CALCADA - 11, 3, 3);
      ctx.fillStyle = cor; ctx.fillRect(x - 1, CALCADA - 8, 5, 5);
      ctx.fillStyle = "#2b2b3a"; ctx.fillRect(x + (passo ? 0 : 1), CALCADA - 3, 1, 3); ctx.fillRect(x + (passo ? 3 : 2), CALCADA - 3, 1, 3);
    }

    function quadro(c, dt, t) {
      ctx = c;
      const ceu = Ceu.agora(), noite = ceu.escuro > 0.5, neve = Clima.tipo() === "neve";
      const g = ctx.createLinearGradient(0, 0, 0, RUA); g.addColorStop(0, ceu.cima); g.addColorStop(1, ceu.baixo);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      const fechado = { nublado: 0.18, neblina: 0.25, garoa: 0.3, chuva: 0.4, tempestade: 0.6, neve: 0.3 }[Clima.tipo()] || 0;   // céu carregado
      const encoberto = fechado >= 0.3;   // com chuva, nem sol, nem lua, nem estrelas
      if (fechado) { ctx.fillStyle = `rgba(62,68,86,${fechado})`; ctx.fillRect(0, 0, W, RUA); }
      if (noite && !encoberto) { ctx.fillStyle = "#fff"; for (let i = 0; i < 40; i++) ctx.fillRect((i * 97) % W, (i * 41) % 70, 1, 1); }
      if (!encoberto) { ctx.fillStyle = noite ? "#f2f0e0" : "#ffe27a"; ctx.beginPath(); ctx.arc(noite ? 270 : 50, 26, 9, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = encoberto ? "rgba(120,126,142,.9)" : noite ? "rgba(200,205,230,.35)" : "rgba(255,255,255,.85)";
      const sopro = 4 + (Clima.vento || 0) * 30;   // as nuvens correm com o vento (para a esquerda, como a chuva)
      for (const n of estado.nuvens) { n.x -= dt * sopro; if (n.x < -10) n.x += W + 40; ctx.fillRect(n.x - 30, n.y, 26, 6); ctx.fillRect(n.x - 24, n.y - 4, 14, 4); }
      const a = estado.aviao; // avião passa de vez em quando, com luz piscando
      if (a.espera > 0) a.espera -= dt; else {
        a.x += dt * 26; ctx.fillStyle = "#e8ecf2"; ctx.fillRect(a.x, 46, 14, 3); ctx.fillRect(a.x + 4, 43, 4, 9); ctx.fillRect(a.x, 42, 2, 4);
        if (Math.floor(t / 400) % 2) { ctx.fillStyle = "#ff4a4a"; ctx.fillRect(a.x + 14, 46, 1, 1); }
        if (a.x > W + 20) { a.x = -40; a.espera = 12 + Math.random() * 10; }
      }
      ctx.fillStyle = neve ? "#e9eef5" : "#5c9a4a"; ctx.fillRect(0, 96, W, CALCADA - 96);           // colina e grama
      ctx.fillStyle = neve ? "#d8e0ea" : "#4b8a3e"; ctx.beginPath(); ctx.ellipse(250, 100, 120, 18, 0, Math.PI, 0); ctx.fill();
      for (const x of ARVORES) arvore(x, neve);
      for (const c of CHALES) chale(c, noite, neve);
      ctx.fillStyle = "#b9b4a6"; ctx.fillRect(0, CALCADA, W, RUA - CALCADA);                     // calçada
      ctx.fillStyle = "#3a3a42"; ctx.fillRect(0, RUA, W, H - RUA);                               // rua
      ctx.fillStyle = "#e9e3c9"; for (let x = 4; x < W; x += 24) ctx.fillRect(x, RUA + 14, 12, 2);
      for (const p of estado.pessoas) { p.x += p.v * dt; if (p.x > W + 6) p.x = -6; if (p.x < -6) p.x = W + 6; pessoa(p.x, p.cor, t); }
      const cao = estado.cao; cao.pulo = Math.max(0, cao.pulo - dt * 3);                         // cachorro: clique e ele pula
      const cy = CALCADA - 4 - Math.round(Math.sin(cao.pulo * Math.PI) * 8);
      ctx.fillStyle = "#8a5a32"; ctx.fillRect(cao.x, cy, 8, 4); ctx.fillRect(cao.x + 7, cy - 3, 4, 4); ctx.fillRect(cao.x, cy + 4, 1, 2); ctx.fillRect(cao.x + 6, cy + 4, 1, 2);
      ctx.fillRect(cao.x - 2, cy - 1 - (Math.floor(t / 150) % 2), 2, 1);
      const car = estado.carro; car.x += car.v * dt; if (car.x > W + 30) car.x = -40;
      ctx.fillStyle = "#d94a3a"; ctx.fillRect(car.x, RUA + 4, 26, 7); ctx.fillRect(car.x + 5, RUA, 14, 5);
      ctx.fillStyle = "#9fc4e0"; ctx.fillRect(car.x + 7, RUA + 1, 4, 3); ctx.fillRect(car.x + 13, RUA + 1, 4, 3);
      ctx.fillStyle = "#1c1c22"; ctx.fillRect(car.x + 3, RUA + 10, 5, 3); ctx.fillRect(car.x + 18, RUA + 10, 5, 3);
      if (noite) { ctx.fillStyle = "rgba(255,240,170,.35)"; ctx.beginPath(); ctx.moveTo(car.x + 26, RUA + 6); ctx.lineTo(car.x + 56, RUA + 1); ctx.lineTo(car.x + 56, RUA + 13); ctx.fill(); }
      for (const p of estado.passaros) { p.x += p.vx * dt; p.y += p.vy * dt; ctx.fillStyle = "#2a2a30"; ctx.fillRect(p.x, p.y, 2, 1); ctx.fillRect(p.x + 2, p.y - (Math.floor(t / 120) % 2), 1, 1); }
      estado.passaros = estado.passaros.filter(p => p.y > -5 && p.x < W + 5);
      if (ceu.escuro > 0) { ctx.fillStyle = `rgba(10,14,40,${ceu.escuro * 0.45})`; ctx.fillRect(0, 0, W, H); }
      if (noite) { // luzes acesas por cima do escuro
        ctx.fillStyle = "rgba(255,217,119,.55)";
        for (const c of CHALES) { const topo = CALCADA - c.h; ctx.fillRect(c.x + 7, topo + 10, 8, 7); if (!c.vizinho) ctx.fillRect(c.x + c.w - 15, topo + 10, 8, 7); }
      }
      // o bairro tem céu (o raio aparece nele); som só se a pessoa já ligou o som no escritório (mesma config)
      const som = window.Som && Som.ligado ? Som : null;
      if (!reduzido) Clima.desenhar(ctx, { W, H, predioRet: { x: -10, y: -10, w: 0, h: 0 }, ceu: true }, dt, t, som);
    }

    // clique em coordenadas do bairro: a porta chama o destino; o cachorro pula; a árvore solta passarinhos
    function clique(x, y) {
      if (dentro(alvo, x, y)) { destino(); return true; }
      if (Math.abs(x - estado.cao.x - 5) < 10 && y > CALCADA - 16 && y < CALCADA + 2) { estado.cao.pulo = 1; return true; }
      for (const ax of ARVORES) if (Math.abs(x - ax) < 11 && y > CALCADA - 32 && y < CALCADA) { // árvore: passarinhos voam
        for (let i = 0; i < 4; i++) estado.passaros.push({ x: ax + i * 3, y: CALCADA - 24, vx: 20 + i * 6, vy: -18 - i * 5 });
        return true;
      }
      return false;
    }
    return { quadro, clique, sobre: (x, y) => dentro(alvo, x, y), porta: alvo };
  }

  function criar(canvas, destino) {
    const ctx = canvas.getContext("2d"), c = cena(destino);
    ctx.imageSmoothingEnabled = false;
    let anterior = performance.now(), parado = false;
    function quadro(t) {
      if (parado) return;
      const dt = Math.min(0.1, (t - anterior) / 1000); anterior = t;
      c.quadro(ctx, dt, t);
      requestAnimationFrame(quadro);
    }
    function ponto(ev) {
      const r = canvas.getBoundingClientRect();
      return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height];
    }
    canvas.addEventListener("click", ev => { c.clique(...ponto(ev)); });
    canvas.addEventListener("mousemove", ev => { canvas.style.cursor = c.sobre(...ponto(ev)) ? "pointer" : "default"; });
    requestAnimationFrame(quadro);
    return { parar() { parado = true; }, porta: c.porta, W, H };
  }
  return { criar, cena, CHALES, porta, W, H };
})();
window.MundoBairro = MundoBairro;
