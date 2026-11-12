// Mundo dos escritórios: orquestra os níveis (Globo → Brasil → Cidade → Bairro), a câmera e a entrada.
// Nível: {entrar(params), sair(), quadro(ctx, dt, t) -> ação | null, clique(x, y) -> ação | null, camera}, com sobre(x, y)
// e alvos() opcionais (a dica do mouse e os botões de teclado). O globo traz também zoom(sinal, sx, sy) -> ação | null,
// arrastar(dx, dy), soltar(lancado) e mergulho(): ele gira em vez de mover a câmera. Ação: {ir: "globo" | "brasil" |
// "cidade" | "bairro", cidade?: id}. O endereço guarda o nível (#globo, #brasil, #cidade=<id>, #bairro); sem fragmento,
// abre no globo. O bairro é sempre o da casa (a cidade do escritório), quando ela é conhecida: só ela tem o chalé com a
// placa. O convite que vier no fragmento sai da barra na hora e segue só pela porta do chalé, como antes.
// O tempo das cidades vem de POST /api/mundo/clima ao abrir e a cada 15 min.
"use strict";
const Mundo = (() => {
  // Câmera de um nível: centro (x, y) no mundo e zoom z de 1x ao teto (4x, ou opcoes.max) sobre a escala base, a maior
  // escala (pode ser fracionária) em que a caixa do nível cabe inteira na tela. O 1x é sempre a base exata; acima dele,
  // parada, a escala final (base·z) é inteira (múltipla de opcoes.multiplo: o Brasil usa 2, para a camada de perto no
  // dobro da resolução cair em pixel inteiro) até o teto, e no teto pode ser fracionária (com múltiplo, não: o teto
  // desce ao múltiplo de baixo). A origem cai sempre em pixel inteiro. O nível pode baixar o teto com camera.teto() (o z
  // máximo agora; a cidade: o que ainda mostra uma quadra inteira); camera.maximo() diz o teto valendo.
  function Camera(caixa, opcoes = {}) {
    const MIN = 1, MAX = opcoes.max || 4, M = opcoes.multiplo || 1;
    const teto = () => {
      const t = c.teto ? Math.max(MIN, Math.min(MAX, c.teto() || MAX)) : MAX;   // tetoExato: o nível já escolheu a escala
      return M > 1 && !c.tetoExato ? Math.max(MIN, Math.floor(c.base * t / M + 1e-9) * M / c.base) : t;
    };
    const prender = z => Math.min(teto(), Math.max(MIN, z));
    // o zoom parado: a escala inteira (múltipla de M) mais perto de base·z, ou 1 (a base exata) se ela não passar da base
    // arredondada
    const parado = z => {
      const p = Math.round(c.base * z);
      return p <= Math.round(c.base) ? 1 : prender(Math.max(M, Math.round(c.base * z / M) * M) / c.base);
    };
    const c = {
      caixa, x: (caixa[0] + caixa[2]) / 2, y: (caixa[1] + caixa[3]) / 2, z: 1, alvoZ: 1, W: 1, H: 1, dpr: 1, base: 1,
      vx: 0, vy: 0, ancora: null, voo: null,
      get P() { const p = c.base * c.z, r = Math.round(p); return Math.abs(p - r) < 1e-6 ? r : p; },
      tamanho(W, H, dpr) { c.W = Math.max(1, W); c.H = Math.max(1, H); c.dpr = dpr || 1; return c.limitar(); },
      // prende o zoom (1x a 4x) e o centro, para a vista não sair da caixa; maior que a caixa, a vista fica no meio
      limitar(nova) {
        if (nova) c.caixa = nova;
        const [x0, y0, x1, y1] = c.caixa;
        c.base = Math.max(0.05, Math.min(c.W / (x1 - x0), c.H / (y1 - y0)));   // a 1x a caixa cabe inteira, na maior escala
        c.z = prender(Number.isFinite(c.z) ? c.z : 1); c.alvoZ = prender(Number.isFinite(c.alvoZ) ? c.alvoZ : 1);
        const mw = c.W / 2 / c.P, mh = c.H / 2 / c.P;
        c.x = mw * 2 >= x1 - x0 || !Number.isFinite(c.x) ? (x0 + x1) / 2 : Math.min(x1 - mw, Math.max(x0 + mw, c.x));
        c.y = mh * 2 >= y1 - y0 || !Number.isFinite(c.y) ? (y0 + y1) / 2 : Math.min(y1 - mh, Math.max(y0 + mh, c.y));
        return c;
      },
      origem() { return [Math.round(c.W / 2 - c.x * c.P), Math.round(c.H / 2 - c.y * c.P)]; },
      tela(x, y) { const [ox, oy] = c.origem(); return [ox + x * c.P, oy + y * c.P]; },
      mundo(sx, sy) { const [ox, oy] = c.origem(); return [(sx - ox) / c.P, (sy - oy) / c.P]; },
      arrastar(dx, dy) { c.x -= dx / c.P; c.y -= dy / c.P; c.voo = c.ancora = null; return c.limitar(); },
      // zoom até z (escala inteira acima de 1x; o 1x é a base exata), com o ponto (sx, sy) da tela parado
      zoomPara(z, sx, sy) {
        c.alvoZ = parado(z);
        if (sx != null) { const [wx, wy] = c.mundo(sx, sy); c.ancora = { sx, sy, wx, wy }; c.voo = null; } else c.ancora = null;
      },
      passoZoom(sinal, sx = c.W / 2, sy = c.H / 2) {   // um degrau: 1,5 vez a escala (com múltiplo, o par de baixo)
        const p = Math.round(c.base * c.alvoZ);
        const q = M === 1 ? (sinal > 0 ? Math.max(p + 1, Math.round(p * 1.5)) : Math.min(p - 1, Math.round(p / 1.5)))
          : sinal > 0 ? Math.max(p + M, Math.floor(p * 1.5 / M) * M) : Math.min(p - M, Math.ceil(p / 1.5 / M) * M);
        c.zoomPara(q / c.base, sx, sy);
      },
      maximo: () => teto(),
      voar(x, y, z) { c.voo = { x, y }; c.ancora = null; c.vx = c.vy = 0; if (z != null) c.alvoZ = parado(z); },
      passo(dt, imediato) {
        const k = imediato ? 1 : 1 - Math.exp(-dt * 12), x = c.x, y = c.y;
        if (c.vx || c.vy) {   // inércia do arraste
          c.x += c.vx * dt; c.y += c.vy * dt;
          const f = Math.exp(-dt * 4); c.vx *= f; c.vy *= f;
          if (Math.hypot(c.vx, c.vy) * c.P < 8) c.vx = c.vy = 0;
        }
        if (c.z !== c.alvoZ) { c.z += (c.alvoZ - c.z) * k; if (Math.abs(c.alvoZ - c.z) * c.base < 0.01) c.z = c.alvoZ; }
        if (c.ancora) { const a = c.ancora; c.x = a.wx - (a.sx - c.W / 2) / c.P; c.y = a.wy - (a.sy - c.H / 2) / c.P; if (c.z === c.alvoZ) c.ancora = null; }
        if (c.voo) { c.x += (c.voo.x - c.x) * k; c.y += (c.voo.y - c.y) * k; }
        c.limitar();
        if (c.voo && Math.hypot(c.x - x, c.y - y) * c.P < 0.05 && c.z === c.alvoZ) c.voo = null;   // chegou (ou bateu na borda)
      },
    };
    return c;
  }

  const canvas = document.getElementById("mundo");
  if (!canvas) return { Camera };
  const ctx = canvas.getContext("2d"), $ = id => document.getElementById(id);
  const estado = $("mundo-estado"), botaoEntrar = $("entrar"), voltar = $("mundo-voltar"), caixaAlvos = $("mundo-alvos"), dica = $("mundo-dica");
  const menos = $("mundo-menos");
  const reduzido = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const tv = new URLSearchParams(location.search).get("tv") === "1";   // passeio sozinho (passear), sem painel nem botões
  if (tv) document.querySelector(".mundo").classList.add("tv");
  const ORDEM = ["globo", "brasil", "cidade", "bairro"], ACIMA = { bairro: "cidade", cidade: "brasil", brasil: "globo" };
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5], FUNDO = "#0b0d12";

  // o convite, se veio no link, sai da barra já e segue só pela porta do chalé
  const convite = /^[A-Za-z0-9_-]{43}$/.test(location.hash.slice(1)) ? location.hash.slice(1) : "";
  const pedido = convite ? "#brasil" : location.hash;   // o convite colado abre no Brasil, como um fragmento inválido
  if (convite) history.replaceState(null, "", location.pathname + location.search);
  const entrar = () => { location.href = "/visita.html" + (convite ? "#" + convite : ""); };
  botaoEntrar.addEventListener("click", entrar);
  botaoEntrar.textContent = convite ? "Entrar com convite" : "Entrar na recepção";

  let W = 0, H = 0, dpr = 1, mapa = null, nome = null, nivel = null, atualCidade = null, ultimaCidade = null, trans = null;
  let botoes = [], chaveAlvos = "", dicaAlvo = null, anterior = performance.now(), pedido_ = false, gesto = null, roda = 0;
  let toque = null;   // o último toque solto (tempo e ponto): o segundo, logo depois e perto, aproxima no ponto
  // a festa do dia (festas.js): só depois da resposta do clima, que traz as festas desligadas (antes dela, nada de
  // enfeite). Só o calendário embutido: as datas próprias da empresa nunca chegam à página pública
  let festa = null, restoChuva = 0;
  function definirFesta(resp) {
    if (!window.Festas) return;
    const d = resp && Array.isArray(resp.festas_desligadas) ? resp.festas_desligadas : [];
    Festas.configurar({ desligadas: d.filter(k => typeof k === "string") });
    festa = Festas.ativa();
  }
  const hojeE = () => (festa ? ` Hoje é ${festa.nome}.` : "");
  const niveis = { bairro: nivelBairro() }, toques = new Map();

  // o bairro de hoje, desenhado 1:1 num quadro de 320x180 e ampliado pela câmera (a 1x, na escala fracionária que enche
  // o palco, com uma pequena irregularidade de pixel; acima de 1x, em escala inteira)
  function nivelBairro() {
    const cena = MundoBairro.cena(entrar, { reduzido }), camera = Camera([0, 0, MundoBairro.W, MundoBairro.H]), p = cena.porta;
    const quadro = document.createElement("canvas"); quadro.width = MundoBairro.W; quadro.height = MundoBairro.H;
    const qctx = quadro.getContext("2d");
    const porta = { id: "porta", x: p.x + p.w / 2, y: p.y + p.h / 2, alto: 0, titulo: "Recepção",
      texto: convite ? "Entrar com convite" : "Entrar na recepção", rotulo: "Porta do chalé com a placa: entrar na recepção" };
    return {
      nome: "bairro", camera,
      entrar() { climaDaCidade(); }, sair() {},
      quadro(c, dt, t) { qctx.imageSmoothingEnabled = false; cena.quadro(qctx, dt, t); c.drawImage(quadro, 0, 0); },
      clique(x, y) { cena.clique(x, y); return null; },
      sobre(x, y) { return cena.sobre(x, y) ? porta : null; },
      alvos() { return [porta]; },
    };
  }
  function climaDaCidade() {   // a cidade e o bairro chovem como ela (o vento público vai de 0 a 1, o Clima conta em km/h)
    const c = mapa && atualCidade && mapa.porId.get(atualCidade);
    Clima.definir(c ? { tipo: c.tempo.tipo, vento: Math.round(c.tempo.vento * 50) } : null);
  }

  function ler(h) {
    const s = String(h || "").replace(/^#/, ""), m = /^cidade=([a-z0-9-]{1,40})$/.exec(s);
    return s === "" || s === "globo" ? { ir: "globo" } : s === "bairro" ? { ir: "bairro" } : m ? { ir: "cidade", cidade: m[1] } : { ir: "brasil" };
  }
  function normalizar(a) {   // a ação pedida vira um nível que existe; cidade fora da lista cai no Brasil
    if (!mapa) return { ir: "bairro", cidade: null };
    let ir = a.ir, id = a.cidade;
    if (ir === "cidade" && !mapa.porId.has(id)) ir = "brasil";
    if (ir === "bairro") id = mapa.casa || (mapa.porId.has(id) ? id : ultimaCidade || null);
    if (!niveis[ir]) ir = "brasil";
    return { ir, cidade: ir === "brasil" || ir === "globo" ? null : id };
  }
  function endereco(a, substituir) {
    const h = a.ir === "cidade" ? "#cidade=" + a.cidade : "#" + a.ir;
    if (location.hash === h) return;
    if (substituir) history.replaceState(null, "", location.pathname + location.search + h); else location.hash = h;
  }
  function ir(alvo, params = {}, opcoes = {}) {
    if (trans && trans.fase === 0) return;
    trans = null;
    const a = normalizar({ ...params, ir: alvo });
    if (nivel && a.ir === nome && a.cidade === atualCidade) return endereco(a, opcoes.substituir);
    if (!nivel || reduzido || opcoes.instantaneo) return trocar(a, opcoes);
    const cam = nivel.camera, c = a.cidade && mapa && mapa.porId.get(a.cidade);
    if (ORDEM.indexOf(a.ir) > ORDEM.indexOf(nome)) {   // descendo: mergulha na cidade (ou no meio da tela)
      if (nome === "brasil" && c && !c.fora) cam.voar(c.x, c.y, cam.maximo());
      else if (nivel.mergulho) cam.zoomPara(4, ...cam.tela(...nivel.mergulho(a)));   // do globo, no Brasil (ou na cidade de fora); da cidade, na casa
      else if (c) cam.zoomPara(4, ...cam.tela(c.x, c.y));
    } else cam.zoomPara(1, cam.W / 2, cam.H / 2);
    if (nivel.partindo) nivel.partindo();   // o nível que sai não pede mais nada (o mapa: os azulejos da vista do mergulho)
    trans = { fase: 0, k: 0, a, opcoes };
  }
  let etiquetaAte = 0, ultimoT = 0;   // até quando o status mostra a etiqueta de uma construção (etiquetar)
  function trocar(a, opcoes = {}) {
    const deCidade = atualCidade, deNivel = nome;
    if (nivel) nivel.sair();
    etiquetaAte = 0;   // o tempo da etiqueta de uma construção não passa para o nível seguinte
    nome = a.ir; nivel = niveis[nome]; atualCidade = a.cidade || null;
    if (atualCidade) ultimaCidade = atualCidade;
    cobrir(nivel.camera.tamanho(W, H, dpr));
    nivel.entrar({ cidade: atualCidade, de: deCidade, nivel: deNivel });
    endereco(a, opcoes.substituir);
    voltar.disabled = !niveis[ACIMA[nome]];   // sem o nível de cima (o globo que não abriu), nada a subir
    menos.disabled = nome === "globo";        // o globo não se afasta: o − ficaria mudo
    anunciado = null; rotular(); montarAlvos(); destacar(null); mostrar();
  }
  // o rótulo do canvas; o da cidade vem dela (marco, chalé da casa) e é refeito quando a casa ou o atlas chegam
  const ROTULOS = {
    globo: "Globo terrestre em pixel art girando, com biomas, nuvens, a noite de agora e as luzes das cidades, estrelas e a lua",
    brasil: "Mapa ilustrado do Brasil em pixel art, com biomas, rios e serras, o marco de cada capital e de Mateus Leme, o tempo de " +
      "agora em cada uma, barcos na costa, aviões nas rotas e a noite pelo horário. De perto aparecem rodovias, rios menores, os " +
      "nomes dos estados e as cidades médias; o cursor sobre um estado diz o nome e a capital",
    bairro: "Bairro com o chalé deste escritório, rua, pessoas, cachorro, carro e céu do horário atual",
  };
  function rotular() { if (nivel) canvas.setAttribute("aria-label", nivel.rotulo ? nivel.rotulo() : ROTULOS[nome]); }
  // da cidade de fora do Brasil, sobe-se direto ao globo (ela não está no mapa do Brasil)
  const fora = () => nome === "cidade" && mapa && !!(mapa.porId.get(atualCidade) || {}).fora;
  function subir() { if (nivel && ACIMA[nome]) ir(fora() ? "globo" : ACIMA[nome], { cidade: atualCidade }); }
  // a ação de um clique: ir a um nível ou, numa construção da cidade, anunciar no status o nome que a etiqueta mostra
  function executar(a) { if (a && a.ir) ir(a.ir, a); else if (a && a.anuncio) etiquetar(a.anuncio); }
  // o nome da etiqueta no status por 5 s (o tempo dela), e depois o texto do nível de volta. O mesmo nome de novo (o Enter
  // repetido) troca o espaço final, para o leitor de tela anunciar outra vez
  function etiquetar(texto) {
    estado.textContent = estado.textContent === texto ? texto + "\u00a0" : texto;
    etiquetaAte = ultimoT + 5000;
  }
  // roda, botões, teclado, duplo clique e pinça: o globo decide o próprio zoom (desce ao Brasil); os outros níveis
  // aproximam, e o que mergulha (o Brasil) troca de nível no teto ou no mínimo do zoom
  function aproximar(sinal, sx = W / 2, sy = H / 2, daRoda = false) {
    if (!nivel) return;
    if (nivel.zoom) { if (!trans) executar(nivel.zoom(sinal, sx, sy)); return; }
    const mergulho = nivel.mergulhar && !trans ? nivel.mergulhar(sinal, sx, sy, daRoda) : null;
    if (mergulho) executar(mergulho); else nivel.camera.passoZoom(sinal, sx, sy);
  }
  let anunciado = null;   // o estado sob o cursor na linha de status (o Brasil diz qual), até ele sair de baixo do cursor
  function anunciar() {
    const s = nivel && nivel.anuncio ? nivel.anuncio() : null;
    if (s === anunciado) return;
    anunciado = s;
    if (s) estado.textContent = s; else mostrar();
  }

  function mostrar() {
    const hora = Ceu.agora().hora, c = atualCidade && mapa && mapa.porId.get(atualCidade);
    if (!mapa) estado.textContent = `${hora} · ${Clima.texto()} · O mapa não abriu agora; o bairro e a recepção seguem aqui.`;
    else if (nome === "globo") estado.textContent = `Terra, ${hora} em Brasília. Clique no Brasil ou aproxime para descer ao mapa; ` +
      "os pontos dourados são cidades de outros países.";
    else if (nome === "brasil") {
      const casa = mapa.casa && mapa.porId.get(mapa.casa);
      estado.textContent = `Brasil, ${hora}.${hojeE()} Escolha uma cidade no mapa.${casa ? ` O escritório fica em ${casa.nome}.` : ""}`;
    } else if (nome === "cidade") {
      const casa = mapa.casa && mapa.porId.get(mapa.casa);
      estado.textContent = `${c.nome} (${c.uf}), ${mapa.texto(c)}.${hojeE()} ` +
        (casa === c ? "O chalé com a placa é o escritório: clique nele para descer ao bairro."
        : casa ? `O escritório fica em ${casa.nome}; Esc volta ${c.fora ? "ao globo" : "ao mapa"}.` : `Esc volta ${c.fora ? "ao globo" : "ao mapa"}.`);
    }
    else estado.textContent = `${hora} · ${Clima.texto()}${c ? " · " + c.nome : ""}`;
  }

  // botões invisíveis sobre as cidades (e a porta): Tab passa por eles, Enter escolhe, o foco mostra a dica
  function montarAlvos() {
    const lista = nivel && nivel.alvos ? nivel.alvos() : [];
    if (botoes.length === lista.length && botoes.every(([, a], i) => a.id === lista[i].id)) {
      botoes.forEach((b, i) => { b[1] = lista[i]; b[0].setAttribute("aria-label", lista[i].rotulo); });
    } else {
      caixaAlvos.replaceChildren();
      botoes = lista.map(a => {
        const b = document.createElement("button"), par = [b, a];
        b.type = "button"; b.className = "mundo-alvo"; b.setAttribute("aria-label", a.rotulo);
        b.addEventListener("click", () => {   // Enter: a ação do alvo, a etiqueta dele ou, por último, o clique no ponto
          if (trans) return;
          const a = par[1];
          executar(a.acao ? a.acao : a.etiqueta && nivel.escolher ? nivel.escolher(a.id) : nivel.clique(a.x, a.y));
        });
        // o foco mostra a dica; se o alvo tem anúncio (a cidade do mapa: o estado dela), ele vai à linha de status
        b.addEventListener("focus", () => { destacar(par[1]); verAlvo(par[1]); if (par[1].anuncio) estado.textContent = par[1].anuncio; });
        b.addEventListener("blur", () => { destacar(null); if (par[1].anuncio) mostrar(); });
        caixaAlvos.appendChild(b);
        return par;
      });
    }
    chaveAlvos = "";
  }
  function verAlvo(a) {   // com o teclado, a câmera vai até a cidade que estiver fora da vista
    const cam = nivel.camera, [x, y] = cam.tela(a.x, a.y), m = 40 * dpr;
    if (x < m || y < m || x > W - m || y > H - m) cam.voar(a.x, a.y);
  }
  function destacar(a) {
    if (nivel) nivel.destaque = a ? a.id : null;
    dicaAlvo = a && !a.etiqueta ? a : null;   // a etiqueta, o próprio nível desenha (a cidade, em Silkscreen no canvas)
    if (!dicaAlvo) { dica.hidden = true; return; }
    const forte = document.createElement("strong"), texto = document.createElement("span");
    forte.textContent = a.titulo; texto.textContent = a.texto;
    dica.replaceChildren(forte, texto); dica.hidden = false; chaveAlvos = "";
  }
  function posicionar() {   // botões e dica acompanham a câmera e os ícones (o atlas que chega muda o arranjo do mapa)
    const cam = nivel.camera, chave = cam.origem().join() + "," + cam.P + "," + W + "," + H + "," + (nivel.assinatura ? nivel.assinatura() : "");
    if (chave === chaveAlvos) return;
    chaveAlvos = chave;
    for (const [b, a] of botoes) { const [x, y] = cam.tela(a.x, a.y); b.style.transform = `translate(${x / dpr}px, ${y / dpr - a.alto / 2}px)`; }
    if (dicaAlvo) { const [x, y] = cam.tela(dicaAlvo.x, dicaAlvo.y); dica.style.transform = `translate(${x / dpr}px, ${y / dpr - dicaAlvo.alto}px)`; }
  }

  function medir() {
    const r = canvas.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (w === W && h === H && d === dpr) return;
    W = w; H = h; dpr = d; canvas.width = W; canvas.height = H; chaveAlvos = "";
    for (const n of Object.values(niveis)) cobrir(n.camera.tamanho(W, H, dpr));
  }
  // o que os botões (Voltar, + e −) cobrem do canvas, em pixels dele, com 6 px de CSS de folga: o nível não põe nome nem
  // enfeite embaixo deles (camera.cobertos, uma lista de {x, y, w, h})
  // (refeito quando a fonte carrega: o VOLTAR em Silkscreen alarga)
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { for (const n of Object.values(niveis)) cobrir(n.camera); });
  function cobrir(cam) {
    const r = canvas.getBoundingClientRect(), f = 6;
    cam.cobertos = [voltar, $("mundo-mais"), menos].map(b => b.getBoundingClientRect())
      .filter(b => b.width > 0 && b.height > 0 && b.left < r.left + r.width && b.top < r.top + r.height)
      .map(b => ({ x: Math.round((b.left - r.left - f) * dpr), y: Math.round((b.top - r.top - f) * dpr),
        w: Math.round((b.width + 2 * f) * dpr), h: Math.round((b.height + 2 * f) * dpr) }));
    return cam;
  }
  function cortina(k) {   // transição em pontilhado (Bayer 4x4) de blocos inteiros: fecha e abre sem borrão
    if (k <= 0) return;
    const b = Math.max(4, Math.round(8 * dpr)), limite = k * 16;
    ctx.fillStyle = FUNDO; ctx.beginPath();
    for (let j = 0; j * b < H; j++) for (let i = 0; i * b < W; i++) if (BAYER[(j & 3) * 4 + (i & 3)] < limite) ctx.rect(i * b, j * b, b, b);
    ctx.fill();
  }
  function quadro(t) {
    pedido_ = false;
    if (document.hidden) return;   // aba escondida: nada de quadro; o visibilitychange retoma
    const dt = Math.min(0.25, Math.max(0, (t - anterior) / 1000));   // um quadro atrasado anda até 0,25 s, não mais
    anterior = ultimoT = t;
    if (etiquetaAte && t > etiquetaAte) { etiquetaAte = 0; mostrar(); }   // acabou o tempo da etiqueta: o status do nível
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = FUNDO; ctx.fillRect(0, 0, W, H);
    if (nivel) {
      if (trans && (trans.k += dt / 0.24) >= 1) {
        if (trans.fase === 0) { const { a, opcoes } = trans; trans = null; trocar(a, opcoes); trans = { fase: 1, k: 0 }; } else trans = null;
      }
      const cam = nivel.camera;
      cam.passo(dt, reduzido);
      const [ox, oy] = cam.origem();
      ctx.setTransform(cam.P, 0, 0, cam.P, ox, oy);
      const acao = nivel.quadro(ctx, dt, t);   // o globo devolve o mergulho quando termina de girar até o Brasil
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      // a chuva do som só vale na cidade e no bairro (o Clima a ajusta a cada quadro). Saindo deles para o globo ou o
      // Brasil, vai a zero aos poucos (Som.chuva aproxima o volume 5% a cada chamada): uns 6 s de chamadas e mais
      // nenhuma, para não criar o áudio sem nada tocando
      if (nome === "cidade" || nome === "bairro") restoChuva = 360;
      else if (restoChuva > 0) { restoChuva--; if (window.Som && Som.ligado) Som.chuva(0); }
      if (trans) cortina(trans.fase === 0 ? trans.k : 1 - trans.k);
      posicionar();
      if (acao && !trans) executar(acao);
    }
    pedir();
  }
  function pedir() { if (!pedido_ && !document.hidden) { pedido_ = true; requestAnimationFrame(quadro); } }

  // entrada: arrastar (com inércia), pinça, roda, duplo clique, botões e teclado
  function ponto(ev) {
    const r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left) * W / (r.width || 1), (ev.clientY - r.top) * H / (r.height || 1)];
  }
  function clicar(sx, sy) { if (nivel && !trans) executar(nivel.clique(...nivel.camera.mundo(sx, sy))); }
  function dois() { const [[ax, ay], [bx, by]] = [...toques.values()]; return [Math.hypot(ax - bx, ay - by) || 1, (ax + bx) / 2, (ay + by) / 2]; }
  canvas.addEventListener("pointerdown", ev => {
    if (!nivel || ev.button > 0) return;
    if (canvas.setPointerCapture) canvas.setPointerCapture(ev.pointerId);
    const [x, y] = ponto(ev), cam = nivel.camera;
    toques.set(ev.pointerId, [x, y]);
    cam.vx = cam.vy = 0; cam.voo = cam.ancora = null;
    if (toques.size === 1) gesto = { x0: x, y0: y, x, y, moveu: false, t: performance.now(), vx: 0, vy: 0, pinca: null };
    else if (toques.size === 2 && gesto) { const [d, mx, my] = dois(), [wx, wy] = cam.mundo(mx, my); gesto.pinca = { d, z: cam.z, wx, wy }; gesto.moveu = true; }
  });
  canvas.addEventListener("pointermove", ev => {
    const [x, y] = ponto(ev);
    if (!toques.has(ev.pointerId)) {   // passando o mouse: dica e cursor
      if (!nivel || !nivel.sobre || trans) return;
      const a = nivel.sobre(...nivel.camera.mundo(x, y));
      canvas.style.cursor = a ? "pointer" : "grab";
      if ((a && a.id) !== (dicaAlvo && dicaAlvo.id)) destacar(a);
      anunciar();
      return;
    }
    toques.set(ev.pointerId, [x, y]);
    const cam = nivel.camera;
    if (gesto.pinca && toques.size >= 2) {
      const [d, mx, my] = dois(), p = gesto.pinca;
      if (nivel.zoom) { if (!p.feito && d / p.d > 1.25) { p.feito = true; aproximar(1, mx, my); } return; }
      // a pinça que começa no teto e abre (ou começa no mínimo e fecha) além de um quarto troca de nível, uma vez por gesto
      const sinal = d > p.d ? 1 : -1, naBeira = sinal > 0 ? p.z >= cam.maximo() - 1e-9 : p.z <= 1;
      if (nivel.mergulhar && !p.feito && naBeira && (d / p.d > 1.25 || d / p.d < 0.8)) {
        const m = nivel.mergulhar(sinal, mx, my);
        if (m) { p.feito = true; executar(m); return; }
      }
      cam.z = cam.alvoZ = Math.max(1, p.z * d / p.d);
      cam.x = p.wx - (mx - W / 2) / cam.P; cam.y = p.wy - (my - H / 2) / cam.P; cam.limitar();
      p.mx = mx; p.my = my;
      return;
    }
    if (toques.size > 1) return;
    if (!gesto.moveu && Math.hypot(x - gesto.x0, y - gesto.y0) < 6 * dpr) return;   // tremida do dedo ainda é clique
    if (!gesto.moveu) { gesto.moveu = true; canvas.style.cursor = "grabbing"; destacar(null); }
    const agora = performance.now(), dtm = Math.max(8, agora - gesto.t) / 1000, max = 3000 / cam.P;
    if (nivel.arrastar) nivel.arrastar(x - gesto.x, y - gesto.y); else cam.arrastar(x - gesto.x, y - gesto.y);
    gesto.vx = Math.max(-max, Math.min(max, 0.7 * (-(x - gesto.x) / cam.P / dtm) + 0.3 * gesto.vx));
    gesto.vy = Math.max(-max, Math.min(max, 0.7 * (-(y - gesto.y) / cam.P / dtm) + 0.3 * gesto.vy));
    gesto.x = x; gesto.y = y; gesto.t = agora;
  });
  function soltar(ev, cancelado) {
    if (!toques.delete(ev.pointerId) || !gesto) return;
    const cam = nivel.camera;
    if (toques.size === 1) {   // largou um dedo da pinça: o outro segue arrastando (o zoom assenta no meio da pinça)
      const [[x, y]] = [...toques.values()], p = gesto.pinca;
      Object.assign(gesto, { x, y, pinca: null, t: performance.now(), vx: 0, vy: 0 });
      if (p && p.mx != null) cam.zoomPara(cam.z, p.mx, p.my); else cam.zoomPara(cam.z);
      return;
    }
    if (toques.size) return;
    if (nivel.soltar) nivel.soltar(gesto.moveu && !gesto.pinca && !cancelado && performance.now() - gesto.t < 90);
    const agora = performance.now(), duplo = ev.pointerType === "touch" && !gesto.moveu && !cancelado && toque &&
      agora - toque.t < 320 && Math.hypot(gesto.x0 - toque.x, gesto.y0 - toque.y) < 30 * dpr;
    toque = ev.pointerType === "touch" && !gesto.moveu && !cancelado && !duplo ? { t: agora, x: gesto.x0, y: gesto.y0 } : null;
    if (duplo) { aproximar(1, gesto.x0, gesto.y0); toque = { t: agora, x: -1e9, y: -1e9, zoom: true }; }   // duplo toque
    else if (!gesto.moveu && !cancelado) clicar(gesto.x0, gesto.y0);
    else if (gesto.pinca) cam.zoomPara(cam.z, gesto.pinca.mx != null ? gesto.pinca.mx : W / 2, gesto.pinca.my != null ? gesto.pinca.my : H / 2);
    else if (!nivel.soltar && !reduzido && !cancelado && performance.now() - gesto.t < 90) { cam.vx = gesto.vx; cam.vy = gesto.vy; }   // o globo cuida da própria inércia
    gesto = null; canvas.style.cursor = "grab";
  }
  canvas.addEventListener("pointerup", ev => soltar(ev, false));
  canvas.addEventListener("pointercancel", ev => soltar(ev, true));
  canvas.addEventListener("pointerleave", () => { if (!gesto) { destacar(null); if (nivel && nivel.fora) nivel.fora(); anunciar(); } });
  canvas.addEventListener("wheel", ev => {
    if (!nivel || trans) return;
    ev.preventDefault();
    roda += ev.deltaY * (ev.deltaMode === 1 ? 40 : 1);
    if (Math.abs(roda) < 50) return;
    aproximar(roda < 0 ? 1 : -1, ...ponto(ev), true); roda = 0;
  }, { passive: false });
  canvas.addEventListener("dblclick", ev => {   // (o duplo toque já aproximou: o dblclick que o navegador manda depois não conta)
    if (nivel && !trans && !(toque && toque.zoom && performance.now() - toque.t < 600)) aproximar(1, ...ponto(ev));
  });
  $("mundo-mais").addEventListener("click", () => aproximar(1));
  menos.addEventListener("click", () => aproximar(-1));
  voltar.addEventListener("click", subir);
  window.addEventListener("keydown", ev => {
    const alvo = ev.target, campo = alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName || "");
    if (!nivel || campo || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    const cam = nivel.camera, d = 80 * dpr / cam.P, noMapa = alvo === canvas || caixaAlvos.contains(alvo) || alvo === document.body;
    // as setas movem a vista; no globo, giram (como arrastar o mundo no sentido contrário)
    const mover = (dx, dy) => nivel.arrastar ? (nivel.arrastar(-dx * 80 * dpr, -dy * 80 * dpr), nivel.soltar(false)) : cam.voar(cam.x + dx * d, cam.y + dy * d);
    const acoes = { Escape: subir, "+": () => aproximar(1), "=": () => aproximar(1), "-": () => aproximar(-1), _: () => aproximar(-1),
      ArrowLeft: () => mover(-1, 0), ArrowRight: () => mover(1, 0), ArrowUp: () => mover(0, -1), ArrowDown: () => mover(0, 1) };
    if (!acoes[ev.key] || (ev.key.startsWith("Arrow") && !noMapa)) return;   // setas fora do mapa seguem rolando a página
    ev.preventDefault(); acoes[ev.key]();
  });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { anterior = performance.now(); pedir(); } });
  window.addEventListener("hashchange", () => { if (nivel) { const a = ler(location.hash); ir(a.ir, a, { substituir: true }); } });
  if (window.ResizeObserver) new ResizeObserver(medir).observe(canvas); else window.addEventListener("resize", medir);
  medir();
  pedir();

  function pedirClima() {   // só tipo, vento e noite por cidade; sem cookie, com o limite das rotas públicas
    fetch("/api/mundo/clima", { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(r => r.ok ? r.json() : null).catch(() => null)
      .then(d => {
        definirFesta(d);   // sem resposta (a rota falhou), vale o calendário sem desligadas
        if (mapa) mapa.clima(d);
        if (nome === "bairro" && !atualCidade && mapa && mapa.casa) atualCidade = ultimaCidade = mapa.casa;   // #bairro direto: o da casa
        if (nome === "bairro" || nome === "cidade") climaDaCidade();
        rotular(); montarAlvos(); mostrar();
      });
  }
  fetch("/mundo/mundo.json", { credentials: "omit", cache: "no-cache" })
    .then(r => r.ok ? r.json() : Promise.reject(new Error("mundo.json " + r.status)))
    .then(dados => {
      mapa = MundoMapa.criar({ dados, Camera, reduzido, festa: () => festa });
      Object.assign(niveis, mapa.niveis, {
        cidade: MundoCidade.criar({ dados, Camera, reduzido, mapa, clima: climaDaCidade, festa: () => festa,
          avisar: () => { if (nome === "cidade") { rotular(); montarAlvos(); } } }) });   // o atlas chegou: placa, porta e marco
      // sem o globo, a página abre no Brasil; a falha fica no console
      try { niveis.globo = Globo.criar({ dados, Camera, reduzido }); } catch (e) { console.error("Globo não abriu:", e); }
    })
    .catch(() => { mapa = null; })   // sem o mapa, a página segue com o bairro, como antes
    .then(() => {
      trocar(normalizar(ler(pedido)), { substituir: true });
      pedirClima();
      setInterval(pedirClima, 15 * 60 * 1000);
      setInterval(() => { if (nome === "bairro") mostrar(); }, 30000);
      if (tv && mapa) passear();
    });

  // Passeio (?tv=1): a tela da sala e o Modo TV do escritório. Do globo ao Brasil, à cidade e ao bairro da casa, e
  // depois duas cidades sorteadas, em voltas. Um toque, a roda ou uma tecla devolvem o controle por 30 s.
  function passear() {
    let roteiro = [], i = 0, proximo = 0, pausa = 0;
    const montar = () => {
      const outras = [...mapa.porId.keys()].filter(id => id !== mapa.casa).sort(() => Math.random() - 0.5).slice(0, 2);
      const acima = id => (mapa.porId.get(id).fora ? "globo" : "brasil");   // a cidade de fora desce do globo
      return [["globo", 9000], ...(mapa.casa ? [[acima(mapa.casa), 8000], ["cidade", 14000, mapa.casa], ["bairro", 9000]] : [["brasil", 8000]]),
        ...outras.flatMap(id => [[acima(id), 5000], ["cidade", 14000, id]])];
    };
    for (const ev of ["pointerdown", "wheel", "keydown"]) window.addEventListener(ev, () => { pausa = performance.now() + 30000; }, { passive: true });
    setInterval(() => {
      const agora = performance.now();
      if (trans || document.hidden || agora < pausa || agora < proximo) return;
      if (i >= roteiro.length) { roteiro = montar(); i = 0; }
      const [alvo, fica, cidade] = roteiro[i++];
      ir(alvo, { cidade }); proximo = agora + fica;
    }, 500);
  }

  return { ir: (alvo, params) => ir(alvo, params || {}), subir, Camera, niveis,
           get nivel() { return nome; }, get camera() { return nivel ? nivel.camera : null; } };
})();
window.Mundo = Mundo;
