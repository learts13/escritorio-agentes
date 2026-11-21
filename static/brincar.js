// Brincadeiras do mapa (passo 3): objetos que respondem a clique, toque e teclado; modo foto;
// modo demonstração (agentes fictícios, dia acelerado, sem servidor); e o código Konami.
// Quem anda e reage é a vida.js (Vida.objetoClicado / Vida.festaGeral); aqui ficam o objeto, o clique e o efeito.
"use strict";

const Brincar = (() => {
  const calmo = matchMedia("(prefers-reduced-motion: reduce)");
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  const agora = () => performance.now();
  const el = (tag, classe, texto) => { const e = document.createElement(tag); if (classe) e.className = classe; if (texto != null) e.textContent = texto; return e; };
  const som = nome => { if (window.Som) Som.evento(nome); };
  let P = null, itens = [], hover = null, focado = null, camada = null, aviso = null, ultimaCam = null, faixa = 0, recadosDe = null, proxDanca = 0;
  const reacoes = [];   // { it, tipo, inicio, dur, texto }

  // ---------------- objetos interativos
  const DO_OBJETO = [ // nome do objeto -> [tipo para a vida.js, rótulo, o que faz]
    [/^arcade/, "arcade", "Fliperama", "jogar uma rodada"], [/^jukebox$/, "jukebox", "Jukebox", "trocar a música"],
    [/^(balcao|cafeteira)$/, "cafe", "Cafeteira", "passar um café"], [/^aquario$/, "aquario", "Aquário", "chamar os peixes"],
    [/^(luminaria|luminaria_chao|luminaria_arco|ring_light)$/, "luminaria", "Luminária", "ligar ou desligar"],
    [/^quadro_avisos$/, "quadro_avisos", "Quadro de avisos", "ler os recados"], [/^planta/, "planta", "Planta", "balançar"],
    [/^placa_expediente$/, "expediente", "Placa do expediente", demo ? "ver o horário" : "ver e mudar o horário"],
  ];
  const DO_QUADRO = { relogio: ["relogio", "Relógio", "ver a hora e o tempo"], assinatura_dev: ["lousa", "Lousa de código", "ler a lousa"],
    assinatura_vendas: ["sino", "Sino das vendas", "tocar o sino"], assinatura_produto: ["lousa", "Kanban", "ver o kanban"], assinatura_marketing: ["lousa", "Moodboard", "ver o moodboard"],
    radio: ["radio", "Rádio", "ligar, trocar de estação e mudar o volume"] };
  const salaEm = (x, y) => [...P.salas, ...P.baixo].find(s => x >= s.px && x <= s.px + s.pw && y >= s.py && y <= s.py + s.ph + 2) || null;

  function montar(predio) {
    P = predio; hover = focado = null; reacoes.length = 0;
    itens = [];
    const add = (tipo, rotulo, dica, r, ref) => {
      const sala = salaEm(r.x + r.w / 2, r.y + r.h);
      if (!sala && tipo === "planta") return;   // árvores e canteiros de fora ficam de fora
      itens.push({ tipo, rotulo, dica, x: r.x, y: r.y, w: r.w, h: r.h, ref, sala, teclado: tipo !== "planta" });
    };
    for (const o of P.objetos) { if (!o.nome || o.chave < 0) continue; const d = DO_OBJETO.find(([re]) => re.test(o.nome)); if (d) add(d[1], d[2], d[3], o, o); }
    for (const a of P.animados) {
      if (a.tipo === "tela" && a.w) add("tv", "TV", "trocar de canal", a, a);
      else if (a.tipo === "gato") add("gato", "Gato", "fazer carinho", a, a);
    }
    for (const q of P.quadros || []) { const d = DO_QUADRO[q.nome]; if (d) add(d[0], d[1], d[2], q, q); }
    if (P.ringue) add("placar", "Placar do ringue", "ver o ranking", P.ringue, P.ringue);   // a arena (o ringue e o quadro só aparecem na briga) abre o ranking
    itens.sort((a, b) => a.y - b.y || a.x - b.x);   // ordem de leitura para o Tab
    montarCamada();
  }

  // camada de botões sobre o canvas: só para teclado e leitor de tela (o mouse e o toque usam o hit-test)
  function montarCamada() {
    const palco = document.getElementById("palco"); if (!palco) return;
    if (!camada) {
      camada = el("div", "objetos-mapa"); camada.setAttribute("role", "group"); camada.setAttribute("aria-label", "Objetos do escritório");
      aviso = el("p", "oculto"); aviso.setAttribute("aria-live", "polite");
      palco.append(camada, aviso);
    }
    camada.replaceChildren(...itens.filter(it => it.teclado).map(it => {
      const b = el("button", "obj-mapa"); b.type = "button"; b.hidden = true;
      b.setAttribute("aria-label", `${it.rotulo}${it.sala ? ` (${it.sala.nome})` : ""}: ${it.dica}`);
      b.addEventListener("focus", () => { focado = it; });
      b.addEventListener("blur", () => { if (focado === it) focado = null; });
      b.addEventListener("click", () => acionar(it));
      it.botao = b; return b;
    }));
    ultimaCam = null;
  }

  // posição na tela (px CSS dentro do palco) de um ponto do mundo
  const naTela = (x, y) => [((x - cam.x) * cam.k + tela.width / 2) / dpr, ((y - cam.y) * cam.k + tela.height / 2) / dpr];
  function posicionar() {
    if (!camada || camada.hidden) return;
    const u = ultimaCam;   // só reposiciona quando a câmera ou o palco mudam
    if (u && u[0] === cam.x && u[1] === cam.y && u[2] === cam.k && u[3] === vw && u[4] === vh) return;
    ultimaCam = [cam.x, cam.y, cam.k, vw, vh];
    for (const it of itens) {
      const b = it.botao; if (!b) continue;
      const [x0, y0] = naTela(it.x, it.y), [x1, y1] = naTela(it.x + it.w, it.y + it.h);
      const w = Math.max(44, x1 - x0), h = Math.max(44, y1 - y0), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const fora = cx < 0 || cy < 0 || cx > vw || cy > vh;
      if (b.hidden !== fora) b.hidden = fora;
      if (!fora) { b.style.transform = `translate(${Math.round(cx - w / 2)}px, ${Math.round(cy - h / 2)}px)`; b.style.width = `${Math.round(w)}px`; b.style.height = `${Math.round(h)}px`; }
    }
  }

  // greve da vida social (o vida.js encena e põe b.placa em quem senta): as plaquinhas são um alvo de clique e toque; o
  // teclado e o leitor de tela usam o aviso "Atender o pedido" do app.js, sempre à vista enquanto a greve durar
  const greve = { tipo: "greve", rotulo: "Greve", dica: "atender o pedido", teclado: false };
  function itemGreve() {
    const cs = typeof mundo !== "undefined" && mundo && mundo.cenaSocial;
    if (!cs || cs.tipo !== "greve" || cs.fase !== "greve") return null;
    const qs = (cs.participantes || []).map(id => mundo.bonecos.get(id)).filter(b => b && b.placa && b.x > -20);
    if (!qs.length) return null;
    const xs = qs.map(b => b.x), ys = qs.map(b => b.y);
    greve.x = Math.min(...xs) - 22; greve.w = Math.max(...xs) + 22 - greve.x; greve.y = Math.min(...ys) - 54; greve.h = Math.max(...ys) - 20 - greve.y;   // a faixa das placas, acima das cabeças
    greve.sala = salaEm(cs.x, cs.y);
    return greve;
  }
  // objeto sob o ponto do mundo; no toque, o alvo tem pelo menos 44 px de tela
  function itemEm(p, toque) {
    const minimo = toque ? 44 * dpr / cam.k : 0;   // 44 px de tela, em unidades do mundo
    let melhor = null, dist = Infinity;
    const g = itemGreve();
    for (const it of g ? [g, ...itens] : itens) {
      const fx = Math.max(1, (minimo - it.w) / 2), fy = Math.max(1, (minimo - it.h) / 2);
      if (p.x < it.x - fx || p.x > it.x + it.w + fx || p.y < it.y - fy || p.y > it.y + it.h + fy) continue;
      const d = Math.hypot(p.x - (it.x + it.w / 2), p.y - (it.y + it.h / 2));
      if (d < dist) { dist = d; melhor = it; }
    }
    return melhor;
  }
  function sobre(p) { hover = P ? itemEm(p, false) : null; return !!hover; }
  function tocar(p, tipoPonteiro) { const it = P && itemEm(p, tipoPonteiro === "touch"); if (!it) return false; acionar(it); return true; }

  // ---------------- o que cada objeto faz
  const PIADAS = ["// funciona na minha máquina", "git commit -m \"agora vai\"", "TODO: dormir", "if (cafe) { codar() }", "0 bugs* (*conhecidos)"];
  const RECADOS = ["Café novo na cozinha às 15h30.", "Daily às 9h30, na sala de reunião.", "Sexta tem pizza depois das 18h.", "Quem pegou o grampeador azul?",
    "Lembrete: beba água.", "Sala de reunião reservada para o planejamento.", "Parabéns ao time pelo lançamento!", "Silêncio na biblioteca, por favor."];
  const ACOES = {
    tv: it => { it.ref.canal = (it.ref.canal || 0) + 1; it.ref.trocou = agora(); return "Canal trocado"; },
    arcade: it => { som("jogo_arcade"); const pts = (100 + Math.floor(Math.random() * 900)) * 10; reagir(it, "bolha", 2600, `RECORDE ${pts}`); return `Fliperama: ${pts} pontos`; },
    jukebox: it => { som("jukebox"); faixa = faixa % 9 + 1; reagir(it, "notas", 2600, `FAIXA ${faixa}`); return `Jukebox: faixa ${faixa}`; },
    cafe: it => { som("cafe"); reagir(it, "vapor", 2400, "CAFÉ PASSANDO"); return "Cafeteira: café passando"; },
    aquario: it => { reagir(it, "peixes", 3000); return "Os peixes vieram ao vidro"; },
    relogio: it => { const c = Ceu.agora(), cl = window.Clima ? Clima.texto(true) : ""; const t = `${c.hora}${cl ? ` · ${cl}` : ""}`; reagir(it, "bolha", 3000, t.toUpperCase()); return `São ${t}`; },
    luminaria: it => { const o = it.ref, s = it.sala, acesa = o.aceso ?? (!s || s.luz > 0.5); o.aceso = !acesa; reagir(it, "luz", 900); return o.aceso ? "Luminária ligada" : "Luminária desligada"; },
    gato: it => { som("ronrono"); reagir(it, "coracoes", 2400, "PRRR"); return "O gato ronronou"; },
    quadro_avisos: it => { abrirRecados(it); return "Quadro de avisos aberto"; },
    lousa: it => { const t = it.rotulo === "Lousa de código" ? PIADAS[Math.floor(Math.random() * PIADAS.length)] : it.rotulo === "Kanban" ? "3 FEITOS HOJE" : "INSPIRAÇÃO DO DIA"; reagir(it, "bolha", 3000, t.toUpperCase()); return `${it.rotulo}: ${t}`; },
    placar: () => { abrirPlacar(); return "Placar do ringue aberto"; },   // diálogo do ranking (app.js)
    greve: () => { atenderGreve(); return ""; },   // o app.js atende e anuncia
    radio: it => { if (!window.Radio) return ""; Radio.abrir(it.botao); return "Controle do rádio aberto"; },   // radio.js
    sino: it => { som("sino"); reagir(it, "ding", 1800, "DING!"); return "Sino tocado: venda fechada!"; },
    planta: it => { it.ref.agita = agora(); return "A planta balançou"; },
    expediente: it => { // fora da demonstração, abre o Personalizar no "Abre às" (app.js); na demonstração, só mostra o horário
      const E = window.Expediente; if (!E) return "";
      const fechado = E.fora(Ceu.agora().h), t = fechado ? `Fechado. Abre às ${E.proximaAbertura()}` : `Aberto, das ${E.abre} às ${E.fecha}`;
      if (demo) reagir(it, "bolha", 3000, (fechado ? `ABRE ÀS ${E.proximaAbertura()}` : `${E.abre} ÀS ${E.fecha}`));
      else abrirExpediente();
      return t;
    },
  };
  function acionar(it) {
    const texto = ACOES[it.tipo](it);
    if (aviso && texto) { aviso.textContent = ""; aviso.textContent = texto; }
    if (it.tipo !== "greve" && window.Vida && Vida.objetoClicado && mundo) Vida.objetoClicado(mundo, { tipo: it.tipo, x: it.x + it.w / 2, y: it.y + it.h, sala: it.sala });
  }
  function reagir(it, tipo, dur, texto) {
    for (let i = reacoes.length - 1; i >= 0; i--) if (reacoes[i].it === it) reacoes.splice(i, 1);
    reacoes.push({ it, tipo, inicio: agora(), dur, texto });
  }

  // rádio ligado (só para quem ligou, neste navegador): notinhas saindo dele e, de vez em quando, quem está livre e de
  // pé por perto dança (sem dança com movimento reduzido); no modo TV e no modo apresentação ele se desliga
  function radioTocando(t) {
    if (!window.Radio || !Radio.tocando) return;
    if (Radio.bloqueado()) { Radio.desligar(); return; }
    const it = itens.find(x => x.tipo === "radio"); if (!it) return;
    if (!reacoes.some(r => r.it === it)) reagir(it, "notas", 2600);
    if (t < proxDanca || calmo.matches) return;
    proxDanca = t + 7000 + Math.random() * 8000;
    if (window.Vida && Vida.dancarPerto && typeof mundo !== "undefined" && mundo) Vida.dancarPerto(mundo, it.x + it.w / 2, it.y + it.h + 30, 150, 5);
  }

  // quadro de avisos: recados genéricos (nada de dado real), num painel pequeno que fecha com Esc
  function abrirRecados(it) {
    const palco = document.getElementById("palco"); fecharRecados();
    const caixa = el("div", "recados"); caixa.setAttribute("role", "dialog"); caixa.setAttribute("aria-label", "Quadro de avisos");
    const fechar = el("button", "fechar", "×"); fechar.type = "button"; fechar.setAttribute("aria-label", "Fechar o quadro de avisos");
    const lista = el("ul"), base = Math.floor(Math.random() * RECADOS.length);
    for (let i = 0; i < 4; i++) lista.append(el("li", null, RECADOS[(base + i * 3) % RECADOS.length]));
    caixa.append(fechar, el("strong", null, "Quadro de avisos"), lista);
    fechar.addEventListener("click", () => fecharRecados(true));
    palco.append(caixa); recadosDe = it; fechar.focus();
  }
  // fecha o quadro de avisos; foco: devolve o foco ao botão do objeto (clique no × ou Esc)
  function fecharRecados(foco) {
    const r = document.querySelector("#palco .recados"); if (!r) return false;
    r.remove();
    const it = recadosDe; recadosDe = null;
    if (foco && it && it.botao && !it.botao.hidden) it.botao.focus();
    return true;
  }

  // ---------------- desenho por quadro (depois dos agentes): realce, reações, confete e surpresa
  // balão de texto do objeto: 5 px do mundo de perto, mas nunca menor que ~9 px na tela (legível com o prédio inteiro)
  function bolha(c, x, y, txt) {
    const e = Math.max(1, 9 / (5 * cam.k / dpr)), f = 5 * e, h = 9 * e;
    c.font = `${f}px Silkscreen, monospace`; const w = Math.ceil(c.measureText(txt).width) + 6 * e;
    c.fillStyle = "rgba(21,21,28,.92)"; c.fillRect(x - w / 2, y - h, w, h);
    c.fillStyle = Mapa.cor("destaque"); c.fillRect(x - w / 2, y - h, w, e);
    c.fillStyle = "#ffffff"; c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillText(txt, x, y - 2 * e);
  }
  const px = (c, x, y, w, h, cor) => { c.fillStyle = cor; c.fillRect(Math.round(x), Math.round(y), w, h); };
  function desenhar(c) {
    if (!P) return;
    posicionar();
    const marca = focado || (hover === greve ? itemGreve() : hover);   // a greve anda com quem está sentado (e some quando acaba)
    if (marca) { // contorno do objeto em foco ou sob o mouse
      const k = Mapa.cor("destaque");
      px(c, marca.x - 2, marca.y - 2, marca.w + 4, 1, k); px(c, marca.x - 2, marca.y + marca.h + 1, marca.w + 4, 1, k);
      px(c, marca.x - 2, marca.y - 2, 1, marca.h + 4, k); px(c, marca.x + marca.w + 1, marca.y - 2, 1, marca.h + 4, k);
    }
    const t = agora();
    radioTocando(t);
    for (let i = reacoes.length - 1; i >= 0; i--) {
      const r = reacoes[i], f = (t - r.inicio) / r.dur; if (f >= 1) { reacoes.splice(i, 1); continue; }
      const it = r.it, cx = it.x + it.w / 2, g = calmo.matches ? 0.4 : f;   // com menos movimento: um quadro parado
      if (r.tipo === "vapor") for (let k = 0; k < 5; k++) { const q = (g + k / 5) % 1; px(c, cx - 6 + k * 3 + Math.sin(q * 6 + k) * 2, it.y + 2 - q * 18, 3, 2, `rgba(255,255,255,${0.7 * (1 - q)})`); }
      if (r.tipo === "notas") for (let k = 0; k < 3; k++) { const q = (g + k / 3) % 1, x = cx - 8 + k * 8 + Math.sin(q * 5) * 3, y = it.y - 2 - q * 16, cor = ["#f472b6", "#60a5fa", "#facc15"][k]; px(c, x, y, 2, 2, cor); px(c, x + 1, y - 4, 1, 4, cor); px(c, x + 2, y - 4, 2, 1, cor); }
      if (r.tipo === "coracoes") for (let k = 0; k < 3; k++) { const q = (g + k / 3) % 1, x = cx - 6 + k * 6, y = it.y - q * 14; for (const [a, b] of [[0, 0], [2, 0], [0, 1], [1, 1], [2, 1], [1, 2]]) px(c, x + a, y + b, 1, 1, "#ff5d8f"); }
      if (r.tipo === "ding") for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2, d = 8 + g * 6; px(c, cx + Math.cos(a) * d, it.y + it.h / 2 + Math.sin(a) * d, 2, 1, "#ffd36b"); }
      if (r.tipo === "peixes") for (let k = 0; k < 4; k++) { // os peixes no vidro da frente, olhando para fora
        const x = cx - 8 + k * 4 + Math.sin(t / 300 + k) * (calmo.matches ? 0 : 1), y = it.y + it.h - 16 + (k % 2) * 3;
        px(c, x, y, 3, 2, ["#ff8c42", "#ffd23f", "#3ec1d3", "#ff5d8f"][k]); px(c, x + 1, y, 1, 1, "#1b1b22");
      }
      if (r.tipo === "luz" && it.ref.aceso) { c.globalCompositeOperation = "lighter"; const gr = c.createRadialGradient(cx, it.y + 6, 0, cx, it.y + 6, 26); gr.addColorStop(0, "rgba(255,210,130,.35)"); gr.addColorStop(1, "rgba(0,0,0,0)"); c.fillStyle = gr; c.fillRect(cx - 26, it.y - 20, 52, 52); c.globalCompositeOperation = "source-over"; }
      if (r.texto) bolha(c, cx, it.y - 3 - (calmo.matches ? 0 : Math.min(1, f * 4) * 3), r.texto);
    }
    desenharFesta(c, t);
  }

  // ---------------- Konami: ↑↑↓↓←→←→BA (no celular, 7 toques rápidos no logo do topo)
  const CODIGO = ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a"];
  let pos = 0, festaAte = 0, toques = [];
  const confete = [];
  function surpresa() {
    if (!P || festaAte > agora()) return;
    festaAte = agora() + 8000;
    document.getElementById("palco").classList.add("crt");
    setTimeout(() => document.getElementById("palco").classList.remove("crt"), 8000);
    som("konami");
    if (window.Vida && Vida.festaGeral && mundo) Vida.festaGeral(mundo, 8);
    if (aviso) aviso.textContent = "Surpresa: festa geral no escritório!";
  }
  function desenharFesta(c, t) { // em coordenadas da tela: o confete e o letreiro têm o mesmo tamanho em qualquer zoom
    if (festaAte < t) { confete.length = 0; return; }
    const W = tela.width, H = tela.height, k = dpr;
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0);
    if (!calmo.matches) {
      if (confete.length < 220) for (let i = 0; i < 8; i++) confete.push({ x: Math.random() * W, y: -Math.random() * 40 * k, v: (60 + Math.random() * 90) * k, f: Math.random() * 6, cor: ["#f43f5e", "#facc15", "#22d3ee", "#a3e635", "#a855f7", "#fb923c"][i % 6] });
      for (const p of confete) {
        p.y += p.v * dtQuadro; p.f += dtQuadro * 5;
        if (p.y > H) { p.y = -10 * k; p.x = Math.random() * W; }
        c.fillStyle = p.cor; c.fillRect(Math.round(p.x + Math.sin(p.f) * 4 * k), Math.round(p.y), Math.round((Math.cos(p.f) > 0 ? 5 : 2) * k), Math.round(5 * k));
      }
    }
    const txt = "FESTA GERAL!", fs = Math.round(22 * k), y = Math.round(H * 0.16 + (calmo.matches ? 0 : Math.sin(t / 200) * 3 * k));
    c.font = `${fs}px Silkscreen, monospace`; c.textAlign = "center"; c.textBaseline = "middle";
    const w = c.measureText(txt).width + 28 * k;
    c.fillStyle = "rgba(21,21,28,.9)"; c.fillRect(Math.round(W / 2 - w / 2), Math.round(y - fs * 0.9), Math.round(w), Math.round(fs * 1.8));
    c.fillStyle = Mapa.cor("destaque"); c.fillRect(Math.round(W / 2 - w / 2), Math.round(y - fs * 0.9), Math.round(w), Math.round(3 * k));
    c.fillStyle = "#ffffff"; c.fillText(txt, W / 2, y);
    c.restore();
  }

  // ---------------- modo foto: sem interface, câmera livre, moldura opcional e PNG salvo no aparelho
  let foto = null;
  function modoFoto(ligar) {
    const corpo = document.body, cartao = document.getElementById("palco-cartao");
    if (ligar === !!foto) return;
    if (ligar) {
      foto = { ligouCheio: !cartao.classList.contains("cheio"), moldura: false };
      corpo.classList.add("modo-foto"); if (foto.ligouCheio) telaCheia(true);
      const barra = el("div", "barra-foto"); barra.setAttribute("role", "toolbar"); barra.setAttribute("aria-label", "Modo foto");
      const bMol = el("button", null, "Moldura"), bSalvar = el("button", "primario", "Salvar PNG"), bSair = el("button", null, "Sair (Esc)");
      for (const b of [bMol, bSalvar, bSair]) b.type = "button";
      bMol.setAttribute("aria-pressed", "false");
      bMol.addEventListener("click", () => { foto.moldura = !foto.moldura; bMol.setAttribute("aria-pressed", String(foto.moldura)); corpo.classList.toggle("moldura", foto.moldura); });
      bSalvar.addEventListener("click", salvarFoto); bSair.addEventListener("click", () => modoFoto(false));
      barra.append(bMol, bSalvar, bSair); cartao.append(barra);
      ajustarEscala(); bSalvar.focus();
      if (aviso) aviso.textContent = "Modo foto: arraste e dê zoom; Esc sai.";
    } else {
      document.querySelector(".barra-foto")?.remove();
      corpo.classList.remove("modo-foto", "moldura");
      if (foto.ligouCheio) telaCheia(false); else ajustarEscala();
      foto = null; const bt = document.getElementById("modo-foto"); if (window.focarOuMenu) focarOuMenu(bt); else bt?.focus();
    }
  }
  function salvarFoto() {
    hover = focado = null; desenharCena(agora());   // quadro limpo, sem o contorno de foco
    let saida = tela;
    if (foto && foto.moldura) { // moldura de foto instantânea com o nome da empresa e a data
      const b = Math.round(18 * dpr), rodape = Math.round(46 * dpr);
      saida = document.createElement("canvas"); saida.width = tela.width + 2 * b; saida.height = tela.height + b + rodape;
      const c = saida.getContext("2d");
      c.fillStyle = "#f4efe6"; c.fillRect(0, 0, saida.width, saida.height); c.drawImage(tela, b, b);
      c.fillStyle = "#3a3040"; c.font = `${Math.round(10 * dpr)}px Silkscreen, monospace`; c.textAlign = "center";
      c.fillText(`${(config.empresa || "Escritório").toUpperCase()} · ${new Date().toLocaleDateString("pt-BR")}`, saida.width / 2, tela.height + b + rodape * 0.62);
    }
    const a = document.createElement("a");
    a.href = saida.toDataURL("image/png"); a.download = `escritorio-${new Date().toISOString().slice(0, 10)}.png`;
    document.body.append(a); a.click(); a.remove();
    som("camera");
    if (aviso) aviso.textContent = "Foto salva no aparelho.";
  }

  // ---------------- modo demonstração: dados fictícios, nada vai nem vem do servidor
  const NOMES = [["aurora", "Aurora", "Front-end e acessibilidade"], ["bento", "Bento", "Back-end e APIs"], ["cacau", "Cacau", "Testes e qualidade"],
    ["dara", "Dara", "Produto e roadmap"], ["enzo", "Enzo", "Pesquisa com usuários"], ["flora", "Flora", "Conteúdo e redes sociais"], ["gael", "Gael", "Design e marca"],
    ["hana", "Hana", "Vendas e propostas"], ["icaro", "Ícaro", "Sucesso do cliente"], ["jade", "Jade", "Infraestrutura e monitoramento"]];
  const TAREFAS = ["Revisando o PR da página de preços", "Escrevendo o post da semana", "Montando o relatório de métricas", "Respondendo um cliente",
    "Ajustando o contraste do botão", "Preparando a proposta comercial", "Rodando os testes de regressão", "Planejando a sprint", "Atualizando o servidor de testes", "Desenhando a nova tela de cadastro"];
  function configDemo() {
    const grupo = (nome, tipo, cor, icone, hs) => ({ nome, tipo, cor, icone, agentes: hs });
    return { empresa: "Estúdio Exemplo", cor: "#a855f7", app_url: "https://agentes.chat", aparencia: {}, clima: true,
      times: [grupo("Dev", "mesas", "#3b82f6", "codigo", ["aurora", "bento", "cacau"]), grupo("Produto", "mesas", "#8b5cf6", "grafico", ["dara", "enzo"]),
        grupo("Marketing", "mesas", "#e8587a", "megafone", ["flora", "gael"]), grupo("Vendas", "mesas", "#f59e0b", "estrela", ["hana", "icaro"]), grupo("Ops", "ops", "#10b981", "servidor", ["jade"])] };
  }
  const demoEstado = new Map();   // handle -> trabalho atual (ou null)
  function estadoDemo() {
    const h = Ceu.agora().h, expediente = h >= 8.5 && h < 19, almoco = h >= 12 && h < 13;
    const trabalhos = [], noRingue = !SOC.cena ? [] : SOC.cena.tipo === "greve" ? SOC.cena.participantes : [SOC.cena.a, SOC.cena.b];
    NOMES.forEach(([handle], i) => {
      let t = demoEstado.get(handle) || null;
      if (!expediente) t = null;
      else if (!noRingue.includes(`demo-${handle}`) && Math.random() < 0.35) { // muda de estado de vez em quando (quem está no ringue espera a briga acabar)
        const sorte = Math.random();
        t = almoco && sorte < 0.6 ? null : sorte < 0.62 ? { status: "running" } : sorte < 0.72 ? { status: "waiting_approval" } : sorte < 0.8 ? { status: "waiting_input" } : null;
        if (t) Object.assign(t, { rotulo: TAREFAS[(i + Math.floor(h * 3)) % TAREFAS.length], inicio: new Date().toISOString(), run_id: `demo-${handle}-${Math.floor(agora())}` });
      }
      demoEstado.set(handle, t);
      if (t) trabalhos.push({ agente_id: `demo-${handle}`, started_at: t.inicio, desde: t.inicio, url: "https://agentes.chat", ...t });
    });
    return { agentes: NOMES.map(([handle, nome, funcao]) => ({ id: `demo-${handle}`, nome, handle, funcao })), trabalhos, tarefas: [],
      atualizado: new Date().toISOString(), erro: null, usuario: null, clima: { tipo: "limpo", codigo: 0, temperatura: 26, vento: 6, nuvens: 10, cidade: "Demonstração" },
      social: socialDemo(trabalhos) };
  }
  // vida social da demonstração: o mesmo bloco do /api/estado (contrato S2), montado aqui; uma briga a cada uns 2 min
  // e uns cafés e papos. Sem servidor, o sorteio é local; o vida.js encena do mesmo jeito
  const SOC = { cena: null, eventos: [], proxima: Date.now() + 40000, proximaGreve: Date.now() + 100000,   // a greve vem depois da primeira briga   // o placar começa com umas lutas de mentira, para o quadro não nascer vazio
    placar: { "demo-aurora": { v: 3, d: 1, seq: 2 }, "demo-gael": { v: 2, d: 0, seq: 2 }, "demo-jade": { v: 1, d: 2, seq: -1 } }, anterior: { id: "demo-hana", v: 6, d: 1 } };
  const iso = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  const idDemo = () => Math.random().toString(36).slice(2, 10);
  const livresDemo = trabalhos => NOMES.map(([h]) => `demo-${h}`).filter(id => !trabalhos.some(t => t.agente_id === id));
  const noExpediente = (ms = 0) => !Expediente.fora(Ceu.agora().h + ms / 3600000);
  function marcarDemo(a, b, origem) {
    const inicio = Date.now() + 15000;
    SOC.cena = { id: idDemo(), tipo: "briga", a, b, vencedor: Math.random() < 0.5 ? a : b, inicio: iso(inicio), fim: iso(inicio + 30000), origem };
    return SOC.cena;
  }
  function socialDemo(trabalhos) {
    const agora = Date.now(), livres = livresDemo(trabalhos), c = SOC.cena;
    if (c && c.tipo === "greve" && agora > Date.parse(c.ate)) { SOC.cena = null; SOC.proximaGreve = agora + 300000; }   // deu a hora: "Por hoje chega…"
    else if (c && c.tipo === "briga" && (agora > Date.parse(c.fim) + 10000 || (agora < Date.parse(c.inicio) && !(livres.includes(c.a) && livres.includes(c.b))))) { // acabou, ou um lutador pegou tarefa antes do gongo
      if (agora > Date.parse(c.fim)) contarDemo(c);   // só a briga que chegou ao fim entra no placar
      SOC.cena = null; SOC.proxima = agora + 120000;
    }
    if (!SOC.cena && agora >= SOC.proxima && livres.length >= 2 && noExpediente(60000)) {
      const a = livres[Math.floor(Math.random() * livres.length)], resto = livres.filter(x => x !== a);
      marcarDemo(a, resto[Math.floor(Math.random() * resto.length)], "auto");
    }
    if (!SOC.cena && agora >= SOC.proximaGreve && livres.length >= 4 && noExpediente(180000)) { // greve de demonstração: uns 2 min e meio
      const quem = livres.slice().sort(() => Math.random() - 0.5).slice(0, Math.min(6, livres.length));
      SOC.cena = { id: idDemo(), tipo: "greve", participantes: quem, motivo: Math.floor(Math.random() * 100), inicio: iso(agora), ate: iso(agora + 150000), origem: "auto" };
      SOC.proxima = Math.max(SOC.proxima, agora + 240000);
    }
    const soltos = livres.filter(id => !(SOC.cena && (SOC.cena.tipo === "greve" ? SOC.cena.participantes : [SOC.cena.a, SOC.cena.b]).includes(id)));
    if (soltos.length >= 3 && Math.random() < 0.2) { // café, papo, reclamação, sugestão e fofoca (fatia 2), no formato do servidor
      const sorteia = l => l[Math.floor(Math.random() * l.length)], a = sorteia(soltos), b = sorteia(soltos.filter(x => x !== a));
      const tipo = sorteia(["cafe", "papo", "reclamacao", "sugestao", "fofoca"]), e = { id: idDemo(), tipo, a, em: iso(agora) };
      if (tipo === "cafe" || tipo === "papo") e.b = b;
      if (tipo === "fofoca") Object.assign(e, { b, sobre: sorteia(livresDemo([]).filter(x => x !== a && x !== b)) });
      SOC.eventos.unshift(e);
    }
    SOC.eventos = SOC.eventos.filter(e => agora - Date.parse(e.em) < 120000).slice(0, 10);
    return { v: 1, agora: iso(agora), serio: false, cena: SOC.cena, eventos: SOC.eventos, placar: { semana: segundaDemo(), top: rankingDemo().slice(0, 3), anterior: SOC.anterior } };
  }
  function contarDemo(c) { // as mesmas contas do servidor (adendo, seção 1)
    const perdeu = c.vencedor === c.a ? c.b : c.a, p = id => SOC.placar[id] || (SOC.placar[id] = { v: 0, d: 0, seq: 0 });
    const g = p(c.vencedor), q = p(perdeu);
    g.v++; g.seq = Math.max(g.seq, 0) + 1; q.d++; q.seq = Math.min(q.seq, 0) - 1;
  }
  const rankingDemo = () => Object.entries(SOC.placar).map(([id, x]) => ({ id, ...x })).filter(x => x.v + x.d > 0)
    .sort((a, b) => b.v - a.v || a.d - b.d || (a.id < b.id ? -1 : 1));
  function segundaDemo() { const d = new Date(Date.now() - 3 * 3600000); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); }   // segunda desta semana, em Brasília
  const placarDemo = () => ({ semana: segundaDemo(), ranking: rankingDemo(), anterior: SOC.anterior });
  // "Mandar pro ringue" na demonstração: as mesmas regras do POST, sem sair do navegador (resposta no formato do servidor)
  function brigaDemo(a, b) {
    const recusa = (status, erro, mensagem, extra) => ({ status, d: { erro, mensagem, ...extra } });
    const ocupados = new Set([...demoEstado].filter(([, t]) => t).map(([h]) => `demo-${h}`));
    if (a === b) return recusa(409, "mesmo_agente", "Escolha dois agentes diferentes.");
    if (!noExpediente(47000)) return recusa(409, "fora_do_expediente", "Fora do expediente: o ringue está fechado.");
    if (ocupados.has(a) || ocupados.has(b)) return recusa(409, "trabalhando", "Um dos dois está trabalhando agora.");
    if (SOC.cena) return recusa(409, "ocupado", SOC.cena.tipo === "greve" ? "Tem greve na Sala comunal; o ringue espera." : "Já tem briga no ringue; espere um minuto.", { cena: SOC.cena });
    return { status: 200, d: { cena: marcarDemo(a, b, "ordem") } };
  }
  // "Atender o pedido" na demonstração: as mesmas respostas do POST /api/social/greve/atender, sem sair do navegador
  function atenderDemo(id) {
    const c = SOC.cena;
    if (!c || c.tipo !== "greve" || c.id !== id) return { status: 404, d: { erro: "greve", mensagem: "Essa greve já acabou." } };
    SOC.eventos.unshift({ id: idDemo(), tipo: "atendida", greve: c.id, motivo: c.motivo, participantes: c.participantes.slice(), em: iso(Date.now()) });   // o motivo escolhe a entrega
    SOC.cena = null; SOC.proximaGreve = Date.now() + 300000;
    return { status: 200, d: { cena: null } };
  }

  // ---------------- início: atalhos, faixa da demonstração e botão do modo foto
  function iniciar() {
    if (demo) {
      document.body.classList.add("demo");
      const faixaDemo = el("div", "faixa-demo"); faixaDemo.setAttribute("role", "status");
      const sair = el("a", null, "Sair da demonstração"); sair.href = location.pathname;
      faixaDemo.append(el("strong", null, "Demonstração"), el("span", null, " · agentes e dados fictícios · "), sair);
      document.body.prepend(faixaDemo);
      if (location.hash === "#personalizar") location.hash = "#escritorio";
    }
    document.getElementById("modo-foto")?.addEventListener("click", () => modoFoto(!foto));
    document.addEventListener("keydown", ev => {
      if (ev.key === "Escape" && (foto || fecharRecados(true) || (window.Radio && Radio.fechar(true)))) { if (foto) modoFoto(false); ev.stopImmediatePropagation(); return; }
      if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const k = ev.key.length === 1 ? ev.key.toLowerCase() : ev.key;
      pos = k === CODIGO[pos] ? pos + 1 : k === CODIGO[0] ? 1 : 0;
      if (pos === CODIGO.length) { pos = 0; surpresa(); }
    }, true);
    document.querySelector(".marca")?.addEventListener("click", () => {
      const t = agora(); toques = toques.filter(x => t - x < 2500); toques.push(t);
      if (toques.length >= 7) { toques = []; surpresa(); }
    });
  }

  return { demo, iniciar, montar, desenhar, sobre, tocar, configDemo, estadoDemo, brigaDemo, atenderDemo, placarDemo, surpresa, modoFoto };
})();
window.Brincar = Brincar;
