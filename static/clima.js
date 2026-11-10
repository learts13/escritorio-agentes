// Clima lá fora (vem do servidor, que consulta o Open-Meteo para a cidade configurada):
// chuva, garoa, tempestade (raios e trovão), neve, neblina e nublado. Tudo só na área
// externa; dentro do prédio o clima aparece pelas janelas. ?clima=tempestade simula.
// O vento (km/h) inclina a chuva e a neve, vem em rajadas, balança as árvores de fora e,
// forte, leva folhas. ?vento=60 simula.
"use strict";

const Clima = (() => {
  const TIPOS = ["limpo", "nublado", "neblina", "garoa", "chuva", "tempestade", "neve"];
  const busca = new URLSearchParams(location.search), pedido = busca.get("clima");
  const simulado = TIPOS.includes(pedido) ? pedido : null;   // nada de texto livre da URL na tela
  const ventoPedido = /^\d{1,3}$/.test(busca.get("vento") || "") ? Math.min(120, +busca.get("vento")) : null;
  const VENTO_MINIMO = { tempestade: 0.45, chuva: 0.12, garoa: 0.05, neve: 0.1 };   // tempestade sempre venta
  let atual = { tipo: "limpo" }, gotas = [], flocos = [], respingos = [], folhas = [], neveAcumulada = 0, raio = 0, proxRaio = 6, nuvens = [];
  let vento = 0, perto = 1, faisca = null;   // vento de agora (0 a 1, com rajadas); o raio: quão perto e o desenho dele
  // o balanço das copas e o desvio da neve na janela andam quadro a quadro (somam dt): multiplicar o tempo
  // total por um vento que muda faria a fase pular de um quadro para o outro, e a copa tremeria
  let giro = 0, desvio = 0;

  function definir(c) {
    atual = simulado ? { tipo: simulado } : (c || { tipo: "limpo" });
    if (ventoPedido !== null) atual = { ...atual, vento: ventoPedido };
  }
  function tipo() { return atual.tipo || "limpo"; }
  // força do vento de 0 (calmo) a 1 (ventania, uns 50 km/h): a do tempo, nunca abaixo do mínimo do tipo
  function forca() {
    const kmh = typeof atual.vento === "number" && isFinite(atual.vento) ? atual.vento : 0;
    return Math.max(VENTO_MINIMO[tipo()] || 0, Math.min(1, Math.max(0, (kmh - 5) / 45)));
  }
  // rajadas: duas ondas lentas sobre a força, alcançadas aos poucos (sem tranco de um quadro para o outro)
  function soprar(dt, t) {
    const f = forca(), alvo = f * (0.7 + 0.3 * Math.sin(t / 2100) + 0.25 * Math.max(0, Math.sin(t / 650)));
    vento += (alvo - vento) * Math.min(1, dt * 2);
    // mais vento, balanço mais rápido; a rajada passa de 1 e, sem o teto, o divisor chegava a zero
    giro += dt * 1000 / (1500 - Math.min(1, vento) * 1100);
    desvio += dt * vento * 1000 / 60;
  }
  // desvio da copa de uma árvore lá fora, em px (negativo: o vento sopra para a esquerda)
  function balanco(fase) {
    return -vento * 2.5 + Math.sin(giro + fase) * (0.8 + vento * 1.6);
  }
  function chove() { return ["chuva", "garoa", "tempestade"].includes(tipo()); }
  function texto(curto) { // curto: só a temperatura (relógio do celular)
    if (curto) return atual.temperatura != null ? `${Math.round(atual.temperatura)}°C` : "";
    const nomes = { limpo: "céu limpo", nublado: "nublado", neblina: "neblina", garoa: "garoa", chuva: "chuva", tempestade: "tempestade", neve: "neve" };
    const t = atual.temperatura != null ? ` · ${Math.round(atual.temperatura)}°C` : "";
    return `${nomes[tipo()] || tipo()}${t}${atual.cidade ? " · " + atual.cidade : ""}`;
  }

  function fora(p, x, y) { const r = p.predioRet; return !(x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h); }

  // atualiza e desenha as partículas (coordenadas do mundo)
  function desenhar(ctx, p, dt, t, som) {
    const W = p.W, H = p.H, k = tipo();
    soprar(dt, t);
    // sombras de nuvem andando na grama (nublado e chuva), mais rápidas com vento
    if (k !== "limpo" && k !== "neve") {
      if (!nuvens.length) for (let i = 0; i < 4; i++) nuvens.push({ x: Math.random() * W, y: Math.random() * H, r: 30 + Math.random() * 40 });
      ctx.save(); clipFora(ctx, p);
      for (const n of nuvens) {
        n.x -= dt * (6 + vento * 30); if (n.x + n.r < 0) n.x = W + n.r;
        ctx.fillStyle = `rgba(20,24,40,${k === "nublado" ? 0.05 : 0.07})`;
        ctx.beginPath(); ctx.ellipse(n.x, n.y, n.r, n.r * 0.55, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    if (chove()) {
      const alvo = k === "garoa" ? 120 : k === "tempestade" ? 520 : 320, vel = k === "garoa" ? 160 : 300;
      while (gotas.length < alvo) gotas.push({ x: Math.random() * W, y: Math.random() * H, v: vel * (0.8 + Math.random() * 0.4) });
      gotas.length = Math.min(gotas.length, alvo);
      ctx.save(); clipFora(ctx, p);
      ctx.fillStyle = "rgba(30,40,70,.12)"; ctx.fillRect(0, 0, W, H);                // chão molhado
      // o traço tem pelo menos 1 px na tela: com o mapa afastado (escala < 1), a chuva sumia
      const tr = ctx.getTransform && ctx.getTransform(), escala = tr && tr.a > 0 ? tr.a : 1;
      ctx.strokeStyle = "rgba(190,210,255,.55)"; ctx.lineWidth = Math.max(1, 1 / escala); ctx.beginPath();
      const inclina = 0.18 + vento * 0.8;   // a chuva deita com o vento
      for (const g of gotas) {
        g.y += g.v * dt; g.x -= g.v * dt * inclina;
        if (g.y > H || g.x < 0) { if (fora(p, g.x, g.y) && Math.random() < 0.3) respingos.push({ x: g.x, y: Math.min(g.y, H - 2), v: 0 }); g.y = -4; g.x = Math.random() * (W + 40 + inclina * H); }
        ctx.moveTo(g.x, g.y); ctx.lineTo(g.x + 1.5 + (inclina - 0.18) * 5, g.y - 5);
      }
      ctx.stroke();
      for (const r of respingos) { r.v += dt; ctx.fillStyle = `rgba(200,220,255,${0.6 - r.v * 2})`; ctx.fillRect(r.x - 1 - r.v * 6, r.y, 1, 1); ctx.fillRect(r.x + 1 + r.v * 6, r.y, 1, 1); }
      respingos = respingos.filter(r => r.v < 0.3);
      ctx.restore();
      if (som) som.chuva(k === "garoa" ? 0.25 : k === "tempestade" ? 0.9 : 0.55);
    } else if (som) som.chuva(0);
    if (k === "tempestade") {
      proxRaio -= dt;
      if (proxRaio <= 0) { // quanto mais perto, mais forte o clarão e mais cedo (e mais alto) o trovão
        perto = Math.random(); raio = 0.45 + perto * 0.55; proxRaio = 5 + Math.random() * 12;
        faisca = perto > 0.3 ? zigue(W * (0.1 + Math.random() * 0.8), H * (0.35 + Math.random() * 0.3)) : null;
        if (som) { const forte = perto; setTimeout(() => som.trovao(0.4 + forte * 0.6), 200 + (1 - perto) * 2600); }
      }
    }
    if (raio > 0) {
      if (faisca && p.ceu && raio > 0.35) { // o raio no céu (só onde a tela tem céu, como o bairro)
        ctx.save(); ctx.strokeStyle = `rgba(240,244,255,${raio})`; ctx.lineWidth = 1;
        for (const linha of faisca) { ctx.beginPath(); linha.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke(); }
        ctx.restore();
      }
      ctx.fillStyle = `rgba(235,240,255,${raio * 0.55})`; ctx.fillRect(0, 0, W, H); raio = Math.max(0, raio - dt * 3.2);
    }
    if (vento > 0.35 && k !== "neve" && k !== "neblina") { // ventania: folhas voando lá fora
      while (folhas.length < Math.round(vento * 14)) folhas.push({ x: W + Math.random() * 40, y: Math.random() * H, v: 0.6 + Math.random() * 0.6, f: Math.random() * 6 });
      ctx.save(); clipFora(ctx, p);
      for (const fo of folhas) {
        fo.x -= (60 + vento * 120) * fo.v * dt; fo.y += Math.sin(t / 300 + fo.f) * dt * 20;
        ctx.fillStyle = fo.f > 3 ? "#7a9a3a" : "#a8743a"; ctx.fillRect(fo.x, fo.y, Math.floor(t / 200 + fo.f) % 2 ? 2 : 1, 1);
      }
      ctx.restore();
      folhas = folhas.filter(fo => fo.x > -4);
    } else folhas.length = 0;
    if (k === "neve") {
      while (flocos.length < 260) flocos.push({ x: Math.random() * W, y: Math.random() * H, v: 18 + Math.random() * 22, f: Math.random() * 6 });
      neveAcumulada = Math.min(1, neveAcumulada + dt / 120);
      ctx.save(); clipFora(ctx, p);
      ctx.fillStyle = `rgba(245,248,255,${0.55 * neveAcumulada})`; ctx.fillRect(0, 0, W, H);  // chão branquinho
      ctx.fillStyle = "rgba(255,255,255,.9)";
      for (const f of flocos) {
        f.y += f.v * dt; f.x += (Math.sin(t / 700 + f.f) * 8 - vento * 45) * dt;
        if (f.y > H) { f.y = -2; f.x = Math.random() * W; }
        if (f.x < -2) f.x = W + 2;
        ctx.fillRect(f.x, f.y, f.f > 4 ? 2 : 1, f.f > 4 ? 2 : 1);
      }
      ctx.restore();
    } else neveAcumulada = Math.max(0, neveAcumulada - dt / 60);
    if (k === "neblina") { ctx.save(); clipFora(ctx, p); ctx.fillStyle = "rgba(220,225,235,.35)"; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  }

  // o desenho do raio: um tronco em zigue-zague do topo até "fim" e, às vezes, um galho saindo do meio
  function zigue(x, fim) {
    const tronco = [[x, 0]];
    for (let y = 0; y < fim; y += 6 + Math.random() * 6) tronco.push([tronco[tronco.length - 1][0] + (Math.random() - 0.5) * 12, y]);
    const linhas = [tronco], meio = tronco[Math.floor(tronco.length / 2)];
    if (Math.random() < 0.6 && meio) {
      const galho = [meio];
      for (let i = 0; i < 3; i++) galho.push([galho[i][0] + 3 + Math.random() * 6, galho[i][1] + 5 + Math.random() * 5]);
      linhas.push(galho);
    }
    return linhas;
  }

  function clipFora(ctx, p) { // recorta só a área externa (fora do prédio)
    const r = p.predioRet;
    ctx.beginPath(); ctx.rect(0, 0, p.W, p.H); ctx.rect(r.x + r.w, r.y, -r.w, r.h); ctx.clip("evenodd");
  }

  // efeitos do clima na janela (chamado depois do céu)
  function naJanela(ctx, j, t) {
    const k = tipo();
    if (k === "nublado" || chove() || k === "neblina") { ctx.fillStyle = k === "neblina" ? "rgba(210,214,224,.55)" : "rgba(90,98,120,.35)"; ctx.fillRect(j.x, j.y, j.w, j.h); }
    if (chove()) { // gotas escorrendo no vidro, puxadas de lado pelo vento
      ctx.fillStyle = "rgba(200,220,255,.75)";
      for (let i = 0; i < (k === "garoa" ? 3 : 7); i++) {
        const desce = (t / (k === "garoa" ? 90 : 45) + i * 11) % (j.h + 6);
        const x = j.x + (((i * 7 + 3) - desce * vento * 0.6) % j.w + j.w) % j.w, y = j.y + desce - 4;
        ctx.fillRect(x, y, 1, 3);
      }
    }
    if (k === "neve") { ctx.fillStyle = "#ffffff"; for (let i = 0; i < 6; i++) ctx.fillRect(j.x + (((i * 5 + t / 400 - desvio) % j.w) + j.w) % j.w, j.y + ((t / 120 + i * 9) % j.h), 1, 1); ctx.fillRect(j.x, j.y + j.h - 2, j.w, 2); }
    if (raio > 0.05) {
      ctx.fillStyle = `rgba(255,255,255,${raio})`; ctx.fillRect(j.x, j.y, j.w, j.h);
      if (faisca && raio > 0.35 && j.h >= 8) { // o raio visto pela janela: um zigue-zague escuro sobre o clarão
        ctx.fillStyle = "rgba(70,80,120,.8)";
        const x0 = j.x + Math.floor(j.w * (0.25 + 0.5 * ((faisca[0][0][0] % 7) / 7)));
        for (let y = 0, x = x0; y < j.h - 1; y++) { ctx.fillRect(x, j.y + y, 1, 1); if (y % 3 === 2) x += (y % 6 === 2 ? 1 : -1); }
      }
    }
  }

  return { definir, desenhar, naJanela, texto, tipo, chove, balanco, get vento() { return vento; }, get raio() { return raio; } };
})();

window.Clima = Clima;
